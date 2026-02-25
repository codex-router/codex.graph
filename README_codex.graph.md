# codex.graph

This document covers the local Docker workflow for `codex.graph` using:

- `build.sh` to build the backend image from `docker-compose.yml`
- `test.sh` to run a Docker smoke test and verify health endpoint readiness

## Prerequisites

- Docker installed and running
- Docker Compose v2 available (`docker compose version`)

## Build

Run from `codex.graph`:

```bash
./build.sh
```

What it does:

1. Validates Docker + Docker Compose availability
2. Optionally creates `backend/.env` from `backend/.env.example` when missing (for local defaults)
3. Builds `backend` service image via Compose as `craftslab/codex-graph:latest`:

```bash
docker compose build backend
```

Equivalent image reference:

```bash
docker image ls craftslab/codex-graph:latest
```

Provider configuration supports both `environment` and `env_file`:

- Preferred: export variables in your shell (Compose `environment`)
- Optional: put variables in `backend/.env` (Compose `env_file`, now optional)

LiteLLM variables:

- LiteLLM gateway:
	- `LITELLM_BASE_URL=...`
	- `LITELLM_API_KEY=...`
	- `LITELLM_MODEL=...`

`docker-compose.yml` no longer fails when `backend/.env` is missing.

## Generate Code Graph via REST API (LiteLLM only)

The `example.sh` script calls the local backend REST API (`/analyze`) and prints the generated graph JSON.

Prerequisites:

- Backend already running on `localhost` (for example: `docker compose up -d backend`)
- LiteLLM env vars set in your shell (must all be present):
	- `LITELLM_BASE_URL`
	- `LITELLM_API_KEY`
	- `LITELLM_MODEL`

Run:

```bash
export LITELLM_BASE_URL="http://your-litellm-gateway"
export LITELLM_API_KEY="your-api-key"
export LITELLM_MODEL="ollama-gemini-3-flash-preview"

./example.sh
```

Optional override (defaults to `http://localhost:52104`):

```bash
API_BASE_URL="http://localhost:52104" ./example.sh
```

The script verifies `/health` first and requires backend `provider` to be `litellm`.

## Test (Docker smoke test)

Run:

```bash
./test.sh
```

What it does:

1. Runs `./build.sh`
2. Starts backend container:

```bash
docker compose up -d backend
```

3. Polls health endpoint from the main README:

```bash
curl http://localhost:52104/health
```

If health check fails within timeout, it prints:

- `docker compose ps`
- `docker compose logs backend`

## Useful Commands

Start backend in Docker mode:

```bash
docker compose up -d
```

Stop backend:

```bash
docker compose down
```
