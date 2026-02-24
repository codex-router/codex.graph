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
2. Creates `backend/.env` from `backend/.env.example` when missing
3. Builds `backend` service image via Compose as `craftslab/codex-graph:latest`:

```bash
docker compose build backend
```

Equivalent image reference:

```bash
docker image ls craftslab/codex-graph:latest
```

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
