#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

API_BASE_URL="${API_BASE_URL:-http://localhost:52104}"
HEALTH_URL="${API_BASE_URL}/health"
ANALYZE_URL="${API_BASE_URL}/analyze"
GRAPH_ANALYZE_MODE="${GRAPH_ANALYZE_MODE:-http}"
GRAPH_BACKEND_DIR="${GRAPH_BACKEND_DIR:-$(pwd)/backend}"

LITELLM_BASE_URL="${LITELLM_BASE_URL:-}"
LITELLM_API_KEY="${LITELLM_API_KEY:-}"
LITELLM_MODEL="${LITELLM_MODEL:-}"

if [ "${GRAPH_ANALYZE_MODE}" = "http" ] && ! command -v curl >/dev/null 2>&1; then
	echo "Error: curl is not installed or not in PATH."
	exit 1
fi

if [ -z "${LITELLM_BASE_URL}" ] || [ -z "${LITELLM_API_KEY}" ] || [ -z "${LITELLM_MODEL}" ]; then
	echo "Error: LiteLLM configuration is required."
	echo "Set all of: LITELLM_BASE_URL, LITELLM_API_KEY, LITELLM_MODEL"
	exit 1
fi

if [ "${GRAPH_ANALYZE_MODE}" = "http" ]; then
	echo "[1/3] Checking backend health at ${HEALTH_URL}"
	HEALTH_JSON=""

	for _ in $(seq 1 30); do
		HEALTH_JSON="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
		if [ -n "${HEALTH_JSON}" ]; then
			break
		fi
		sleep 1
	done

 	if [ -z "${HEALTH_JSON}" ] && echo "${API_BASE_URL}" | grep -Eq '^http://localhost:'; then
		FALLBACK_API_BASE_URL="$(echo "${API_BASE_URL}" | sed 's#http://localhost:#http://127.0.0.1:#')"
		FALLBACK_HEALTH_URL="${FALLBACK_API_BASE_URL}/health"
		FALLBACK_ANALYZE_URL="${FALLBACK_API_BASE_URL}/analyze"

 		for _ in $(seq 1 10); do
			HEALTH_JSON="$(curl -fsS "${FALLBACK_HEALTH_URL}" 2>/dev/null || true)"
			if [ -n "${HEALTH_JSON}" ]; then
				API_BASE_URL="${FALLBACK_API_BASE_URL}"
				HEALTH_URL="${FALLBACK_HEALTH_URL}"
				ANALYZE_URL="${FALLBACK_ANALYZE_URL}"
				echo "Using fallback API base URL: ${API_BASE_URL}"
				break
			fi
			sleep 1
		done
	fi

 	if [ -z "${HEALTH_JSON}" ]; then
		echo "Error: codex.graph backend is not reachable at ${HEALTH_URL}"
		echo "Start it first (for example): docker compose up -d backend"
		exit 1
	fi

 	if echo "${HEALTH_JSON}" | grep -Eq '"api_key_status"[[:space:]]*:[[:space:]]*"missing"'; then
		if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
			echo "Detected missing backend LLM config; recreating docker backend to pick up current environment..."
			docker compose up -d --force-recreate backend >/dev/null

 			for _ in $(seq 1 30); do
				HEALTH_JSON="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
				if [ -n "${HEALTH_JSON}" ]; then
					break
				fi
				sleep 1
			done
		fi
	fi

 	if ! echo "${HEALTH_JSON}" | grep -Eq '"provider"[[:space:]]*:[[:space:]]*"litellm"'; then
		if echo "${HEALTH_JSON}" | grep -Eq '"provider"[[:space:]]*:'; then
			echo "Error: backend provider is not litellm"
			echo "Health response: ${HEALTH_JSON}"
			exit 1
		fi
	fi

 	if ! echo "${HEALTH_JSON}" | grep -Eq '"api_key_status"[[:space:]]*:[[:space:]]*"valid"'; then
		echo "Warning: health endpoint reports non-valid api_key_status; will continue and verify via /analyze."
		echo "Health response: ${HEALTH_JSON}"
	fi

 	if echo "${HEALTH_JSON}" | grep -Eq '"model"[[:space:]]*:' && ! echo "${HEALTH_JSON}" | grep -Eq '"model"[[:space:]]*:[[:space:]]*"[^"]+'; then
		echo "Error: backend model is empty"
		echo "Health response: ${HEALTH_JSON}"
		exit 1
	fi
else
	echo "[1/3] Skipping HTTP health check (GRAPH_ANALYZE_MODE=cli)"
fi

echo "[2/3] Generating a sample code graph"

TMP_RESPONSE="$(mktemp)"
trap 'rm -f "${TMP_RESPONSE}"' EXIT

cat > "${TMP_RESPONSE}.request.json" <<'JSON'
{
	"code": "from openai import OpenAI\n\nclient = OpenAI()\n\ndef summarize(text):\n    if len(text) > 200:\n        prompt = 'Summarize this long text'\n    else:\n        prompt = 'Answer this short question'\n\n    response = client.chat.completions.create(\n        model='gpt-4o-mini',\n        messages=[\n            {'role': 'system', 'content': prompt},\n            {'role': 'user', 'content': text}\n        ]\n    )\n    return response.choices[0].message.content\n",
	"file_paths": [
		"example/sample_workflow.py"
	],
	"framework_hint": "openai"
}
JSON

if [ "${GRAPH_ANALYZE_MODE}" = "cli" ]; then
	if [ ! -d "${GRAPH_BACKEND_DIR}" ]; then
		echo "Error: GRAPH_BACKEND_DIR does not exist: ${GRAPH_BACKEND_DIR}"
		exit 1
	fi
	if ! command -v python3 >/dev/null 2>&1; then
		echo "Error: python3 is not installed or not in PATH."
		exit 1
	fi
	bash -lc "cd \"${GRAPH_BACKEND_DIR}\" && python3 main.py analyze --request-json \"${TMP_RESPONSE}.request.json\" --output \"${TMP_RESPONSE}\"" || {
		echo "Error: CLI analyze request failed"
		cat "${TMP_RESPONSE}" 2>/dev/null || true
		exit 1
	}
else
	HTTP_STATUS="$({
		curl -sS -o "${TMP_RESPONSE}" -w "%{http_code}" \
			-X POST "${ANALYZE_URL}" \
			-H "Content-Type: application/json" \
			--data-binary "@${TMP_RESPONSE}.request.json"
	} )"

	if [ "${HTTP_STATUS}" -lt 200 ] || [ "${HTTP_STATUS}" -ge 300 ]; then
		echo "Error: analyze request failed with HTTP ${HTTP_STATUS}"
		echo "Response:"
		cat "${TMP_RESPONSE}"
		echo
		exit 1
	fi
fi

echo "[3/3] Analyze response"
cat "${TMP_RESPONSE}"
echo

rm -f "${TMP_RESPONSE}.request.json"

echo "Done."
