#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

IMAGE_NAME="craftslab/codex-graph:latest"

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

echo "Build complete: ${IMAGE_NAME}"
echo "Start service with: docker compose up -d"
