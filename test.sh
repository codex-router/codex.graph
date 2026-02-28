#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

GRAPH_START_MODE="${GRAPH_START_MODE:-compose}"
GRAPH_CONTAINER_NAME="${GRAPH_CONTAINER_NAME:-codex-graph}"
GRAPH_HOST_PORT="${GRAPH_HOST_PORT:-52104}"
GRAPH_LOCAL_PID_FILE="${GRAPH_LOCAL_PID_FILE:-/tmp/codex-graph-local.pid}"

cleanup() {
	echo "[cleanup] Stopping and removing test containers/processes"
	if [ "${GRAPH_START_MODE}" = "compose" ]; then
		docker compose down --remove-orphans >/dev/null 2>&1 || true
	fi
	if [ "${GRAPH_START_MODE}" = "run" ]; then
		docker rm -f "${GRAPH_CONTAINER_NAME}" >/dev/null 2>&1 || true
	fi
	if [ "${GRAPH_START_MODE}" = "local" ] && [ -f "${GRAPH_LOCAL_PID_FILE}" ]; then
		local_pid="$(cat "${GRAPH_LOCAL_PID_FILE}" 2>/dev/null || true)"
		if [ -n "${local_pid}" ] && kill -0 "${local_pid}" >/dev/null 2>&1; then
			kill "${local_pid}" >/dev/null 2>&1 || true
		fi
		rm -f "${GRAPH_LOCAL_PID_FILE}" >/dev/null 2>&1 || true
	fi
}

trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
	echo "Error: docker is not installed or not in PATH."
	exit 1
fi

if [ "${GRAPH_START_MODE}" = "compose" ]; then
	if ! docker compose version >/dev/null 2>&1; then
		echo "Error: docker compose is not available."
		exit 1
	fi
fi

if [ ! -x ./build.sh ]; then
	echo "Error: ./build.sh is missing or not executable."
	exit 1
fi

if [ "${GRAPH_START_MODE}" != "compose" ] && [ ! -x ./run.sh ]; then
	echo "Error: ./run.sh is missing or not executable."
	exit 1
fi

echo "[1/4] Building Docker image via ./build.sh"
./build.sh

if [ "${GRAPH_START_MODE}" = "compose" ]; then
	echo "[2/4] Starting backend service with docker compose"
	docker compose up -d backend
elif [ "${GRAPH_START_MODE}" = "run" ]; then
	echo "[2/4] Starting backend service with docker run"
	GRAPH_START_MODE=docker ./run.sh
elif [ "${GRAPH_START_MODE}" = "local" ]; then
	echo "[2/4] Starting backend service as local process"
	GRAPH_START_MODE=local ./run.sh
else
	echo "Error: unsupported GRAPH_START_MODE=${GRAPH_START_MODE} (expected compose|run|local)"
	exit 1
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
	if [ "${GRAPH_START_MODE}" = "compose" ]; then
		echo "--- docker compose ps ---"
		docker compose ps || true
		echo "--- backend logs ---"
		docker compose logs backend || true
	elif [ "${GRAPH_START_MODE}" = "run" ]; then
		echo "--- docker ps ---"
		docker ps --filter "name=${GRAPH_CONTAINER_NAME}" || true
		echo "--- backend logs ---"
		docker logs "${GRAPH_CONTAINER_NAME}" || true
	else
		echo "--- local backend pid/log ---"
		echo "pid file: ${GRAPH_LOCAL_PID_FILE}"
		if [ -f "${GRAPH_LOCAL_PID_FILE}" ]; then
			cat "${GRAPH_LOCAL_PID_FILE}" || true
		fi
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
