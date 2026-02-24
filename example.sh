#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

API_BASE_URL="${API_BASE_URL:-http://localhost:52104}"
HEALTH_URL="${API_BASE_URL}/health"
ANALYZE_URL="${API_BASE_URL}/analyze"

LITELLM_BASE_URL="${LITELLM_BASE_URL:-}"
LITELLM_API_KEY="${LITELLM_API_KEY:-}"
LITELLM_MODEL="${LITELLM_MODEL:-}"

if ! command -v curl >/dev/null 2>&1; then
	echo "Error: curl is not installed or not in PATH."
	exit 1
fi

if [ -z "${LITELLM_BASE_URL}" ] || [ -z "${LITELLM_API_KEY}" ] || [ -z "${LITELLM_MODEL}" ]; then
	echo "Error: LiteLLM configuration is required."
	echo "Set all of: LITELLM_BASE_URL, LITELLM_API_KEY, LITELLM_MODEL"
	exit 1
fi

echo "[1/3] Checking backend health at ${HEALTH_URL}"
HEALTH_JSON="$(curl -fsS "${HEALTH_URL}" 2>/dev/null || true)"
if [ -z "${HEALTH_JSON}" ]; then
	echo "Error: codex.graph backend is not reachable at ${HEALTH_URL}"
	echo "Start it first (for example): docker compose up -d backend"
	exit 1
fi

if ! echo "${HEALTH_JSON}" | grep -Eq '"provider"[[:space:]]*:[[:space:]]*"litellm"'; then
	echo "Error: backend provider is not litellm"
	echo "Health response: ${HEALTH_JSON}"
	exit 1
fi

if ! echo "${HEALTH_JSON}" | grep -Eq '"model"[[:space:]]*:[[:space:]]*"'

echo "[2/3] Generating a sample code graph via ${ANALYZE_URL}"

TMP_RESPONSE="$(mktemp)"
trap 'rm -f "${TMP_RESPONSE}"' EXIT

HTTP_STATUS="$({
	curl -sS -o "${TMP_RESPONSE}" -w "%{http_code}" \
		-X POST "${ANALYZE_URL}" \
		-H "Content-Type: application/json" \
		--data-binary @- <<'JSON'
{
	"code": "from openai import OpenAI\n\nclient = OpenAI()\n\ndef summarize(text):\n    if len(text) > 200:\n        prompt = 'Summarize this long text'\n    else:\n        prompt = 'Answer this short question'\n\n    response = client.chat.completions.create(\n        model='gpt-4o-mini',\n        messages=[\n            {'role': 'system', 'content': prompt},\n            {'role': 'user', 'content': text}\n        ]\n    )\n    return response.choices[0].message.content\n",
	"file_paths": [
		"example/sample_workflow.py"
	],
	"framework_hint": "openai"
}
JSON
} )"

if [ "${HTTP_STATUS}" -lt 200 ] || [ "${HTTP_STATUS}" -ge 300 ]; then
	echo "Error: analyze request failed with HTTP ${HTTP_STATUS}"
	echo "Response:"
	cat "${TMP_RESPONSE}"
	echo
	exit 1
fi

echo "[3/3] Analyze response"
cat "${TMP_RESPONSE}"
echo

echo "Done."
