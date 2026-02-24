#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

cleanup() {
	echo "[cleanup] Stopping and removing test containers"
	docker compose down --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
	echo "Error: docker is not installed or not in PATH."
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	echo "Error: docker compose is not available."
	exit 1
fi

if [ ! -x ./build.sh ]; then
	echo "Error: ./build.sh is missing or not executable."
	exit 1
fi

echo "[1/4] Building Docker image via ./build.sh"
./build.sh

echo "[2/4] Starting backend service with docker compose"
docker compose up -d backend

echo "[3/4] Waiting for backend health endpoint"
HEALTH_URL="http://localhost:52104/health"
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
	echo "--- docker compose ps ---"
	docker compose ps || true
	echo "--- backend logs ---"
	docker compose logs backend || true
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
