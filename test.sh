#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

GRAPH_START_MODE="${GRAPH_START_MODE:-compose}"
GRAPH_CONTAINER_NAME="${GRAPH_CONTAINER_NAME:-codex-graph}"
GRAPH_HOST_PORT="${GRAPH_HOST_PORT:-52104}"

cleanup() {
	echo "[cleanup] Stopping and removing test containers"
	if [ "${GRAPH_START_MODE}" = "run" ]; then
		docker rm -f "${GRAPH_CONTAINER_NAME}" >/dev/null 2>&1 || true
	else
		docker compose down --remove-orphans >/dev/null 2>&1 || true
	fi
}

trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
	echo "Error: docker is not installed or not in PATH."
	exit 1
fi

if [ "${GRAPH_START_MODE}" != "run" ]; then
	if ! docker compose version >/dev/null 2>&1; then
		echo "Error: docker compose is not available."
		exit 1
	fi
fi

if [ ! -x ./build.sh ]; then
	echo "Error: ./build.sh is missing or not executable."
	exit 1
fi

if [ "${GRAPH_START_MODE}" = "run" ] && [ ! -x ./run.sh ]; then
	echo "Error: ./run.sh is missing or not executable."
	exit 1
fi

echo "[1/4] Building Docker image via ./build.sh"
./build.sh

if [ "${GRAPH_START_MODE}" = "run" ]; then
	echo "[2/4] Starting backend service with docker run"
	./run.sh
else
	echo "[2/4] Starting backend service with docker compose"
	docker compose up -d backend
fi

echo "[3/4] Waiting for backend health endpoint"
HEALTH_URL="http://localhost:${GRAPH_HOST_PORT}/health"
READY=0
for _ in $(seq 1 30); do
	if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
		READY=1
		break
	fi
	sleep 1
done

if [ "${READY}" -ne 1 ]; then
	echo "Backend did not become healthy in time: ${HEALTH_URL}"
	if [ "${GRAPH_START_MODE}" = "run" ]; then
		echo "--- docker ps ---"
		docker ps --filter "name=${GRAPH_CONTAINER_NAME}" || true
		echo "--- backend logs ---"
		docker logs "${GRAPH_CONTAINER_NAME}" || true
	else
		echo "--- docker compose ps ---"
		docker compose ps || true
		echo "--- backend logs ---"
		docker compose logs backend || true
	fi
	exit 1
fi

echo "[4/4] Validating health payload"
HEALTH_JSON="$(curl -fsS "${HEALTH_URL}")"
if ! echo "${HEALTH_JSON}" | grep -q '"status"'; then
	echo "Health response missing status field"
	echo "Response: ${HEALTH_JSON}"
	exit 1
fi

if ! echo "${HEALTH_JSON}" | grep -q '"api_key_status"'; then
	echo "Health response missing api_key_status field"
	echo "Response: ${HEALTH_JSON}"
	exit 1
fi

if ! echo "${HEALTH_JSON}" | grep -q '"provider"'; then
	echo "Health response missing provider field"
	echo "Response: ${HEALTH_JSON}"
	exit 1
fi

if ! echo "${HEALTH_JSON}" | grep -Eq '"provider"\s*:\s*"(none|gemini|litellm)"'; then
	echo "Health response has unexpected provider value"
	echo "Response: ${HEALTH_JSON}"
	exit 1
fi

echo "Docker backend smoke test passed"
echo "Backend is healthy at ${HEALTH_URL}"
