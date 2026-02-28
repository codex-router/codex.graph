#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

IMAGE_NAME="craftslab/codex-graph:latest"
CLI_IMAGE_NAME="${CODEX_GRAPH_CLI_IMAGE:-craftslab/codex-graph-cli:latest}"

if ! command -v docker >/dev/null 2>&1; then
	echo "Error: docker is not installed or not in PATH."
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	echo "Error: docker compose is not available."
	exit 1
fi

if [ ! -f backend/.env ] && [ -f backend/.env.example ]; then
	cp backend/.env.example backend/.env
	echo "Created backend/.env from backend/.env.example"
fi

echo "Building Docker image ${IMAGE_NAME} from docker-compose.yml..."
docker compose build backend

echo "Building CLI Docker image ${CLI_IMAGE_NAME} from Dockerfile_codex.graph..."
docker build -t "${CLI_IMAGE_NAME}" -f Dockerfile_codex.graph .

echo "Build complete: ${IMAGE_NAME}"
echo "Start service with: docker compose up -d"
echo "CLI image ready: ${CLI_IMAGE_NAME}"
echo "Run one-shot analyze with:"
echo "  docker run --rm -i ${CLI_IMAGE_NAME} analyze --request-json -"
