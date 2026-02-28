#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

IMAGE_NAME="${CODEX_GRAPH_IMAGE:-craftslab/codex-graph:latest}"
CONTAINER_NAME="${GRAPH_CONTAINER_NAME:-codex-graph}"
HOST_PORT="${GRAPH_HOST_PORT:-52104}"
CONTAINER_PORT="${GRAPH_CONTAINER_PORT:-52104}"

if ! command -v docker >/dev/null 2>&1; then
	echo "Error: docker is not installed or not in PATH."
	exit 1
fi

echo "Ensuring image exists: ${IMAGE_NAME}"
if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
	echo "Image not found locally, building via ./build.sh"
	./build.sh
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
	echo "Removing existing container: ${CONTAINER_NAME}"
	docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "Starting codex.graph with docker run"
COMMAND=(
	docker run -d
	--name "${CONTAINER_NAME}"
	-p "${HOST_PORT}:${CONTAINER_PORT}"
)

for env_key in GEMINI_API_KEY LITELLM_BASE_URL LITELLM_API_KEY LITELLM_MODEL LITELLM_SSL_VERIFY LITELLM_CA_BUNDLE; do
	if [ -n "${!env_key:-}" ]; then
		COMMAND+=( -e "${env_key}=${!env_key}" )
	fi
done

COMMAND+=( "${IMAGE_NAME}" )

"${COMMAND[@]}" >/dev/null

echo "Started ${CONTAINER_NAME} from ${IMAGE_NAME}"
echo "Health URL: http://localhost:${HOST_PORT}/health"
