# codex.graph

This document covers the local Docker workflow for `codex.graph` using:

- `build.sh` to build the backend image from `docker-compose.yml`
- `run.sh` to run backend with plain `docker run` (compatible with `codex.serve` auto-start style)
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

## Run with docker run (codex.serve compatible)

`codex.serve` proxies graph generation through its own `POST /graph/run` endpoint, which avoids browser-side CSRF issues from direct cross-origin POST requests.

To run `codex.graph` in the same plain Docker style used by `codex.serve`, use:

```bash
./run.sh
```

By default this starts:

- image: `craftslab/codex-graph:latest`
- container: `codex-graph`
- host port: `52104` -> container port `52104`

Optional overrides:

```bash
CODEX_GRAPH_IMAGE=craftslab/codex-graph:latest \
GRAPH_CONTAINER_NAME=codex-graph \
GRAPH_HOST_PORT=52104 \
./run.sh
```

`run.sh` forwards these env vars into the container when present:

- `GEMINI_API_KEY`
- `LITELLM_BASE_URL`
- `LITELLM_API_KEY`
- `LITELLM_MODEL`
- `LITELLM_SSL_VERIFY`
- `LITELLM_CA_BUNDLE`

Provider configuration supports both `environment` and `env_file`:

- Preferred: export variables in your shell (Compose `environment`)
- Optional: put variables in `backend/.env` (Compose `env_file`, now optional)

LiteLLM variables:

- LiteLLM gateway:
	- `LITELLM_BASE_URL=...`
	- `LITELLM_API_KEY=...`
	- `LITELLM_MODEL=...`
	- `LITELLM_SSL_VERIFY=true|false` (default: `false`)
	- `LITELLM_CA_BUNDLE=/path/to/ca.pem` (optional custom CA bundle)

`LITELLM_BASE_URL` accepts either the OpenAI root path or full endpoint paths, for example:

- `https://litellm.example/openai`
- `https://litellm.example/openai/models`
- `https://litellm.example/openai/chat/completions`

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

Self-signed certificate options:

```bash
# Option A (quick test): disable TLS verification
export LITELLM_SSL_VERIFY="false"

# Option B (recommended): keep verification and trust your CA
export LITELLM_SSL_VERIFY="true"
export LITELLM_CA_BUNDLE="/path/to/ca.pem"

./example.sh
```

Optional override (defaults to `http://localhost:52104`):

```bash
API_BASE_URL="http://localhost:52104" ./example.sh
```

The script verifies `/health` first and requires backend `provider` to be `litellm`.

If `/health` reports `api_key_status: missing` and Docker Compose is available, `example.sh` will try to recreate the backend container once to pick up current env vars.

If `/health` reports a non-valid API key status, `example.sh` logs a warning and still validates end-to-end by calling `/analyze`.

## Test (Docker smoke test)

Run:

```bash
./test.sh
```

You can validate the `docker run` startup path directly (same runtime pattern expected by `codex.serve`) with:

```bash
GRAPH_START_MODE=run ./test.sh
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
