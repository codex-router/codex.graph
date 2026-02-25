import asyncio
import re
import os

from google import genai
from google.genai import types
from openai import AsyncOpenAI

from config import settings
from prompts import SYSTEM_INSTRUCTION, build_user_prompt, CONDENSATION_SYSTEM_PROMPT
from models import TokenUsage, CostData

# Gemini 2.5 Flash pricing (per 1M tokens)
INPUT_PRICE_PER_1M = 0.075
OUTPUT_PRICE_PER_1M = 0.30


def extract_usage(response) -> TokenUsage:
    """Extract token usage from Gemini API response."""
    meta = response.usage_metadata
    return TokenUsage(
        input_tokens=meta.prompt_token_count or 0,
        output_tokens=meta.candidates_token_count or 0,
        total_tokens=meta.total_token_count or 0,
        cached_tokens=getattr(meta, 'cached_content_token_count', 0) or 0
    )


def calculate_cost(usage: TokenUsage) -> CostData:
    """Calculate cost from token usage."""
    input_cost = (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_1M
    output_cost = (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_1M
    return CostData(
        input_cost=input_cost,
        output_cost=output_cost,
        total_cost=input_cost + output_cost
    )


def extract_openai_usage(response) -> TokenUsage:
    """Extract token usage from OpenAI-compatible responses."""
    usage = getattr(response, "usage", None)
    if not usage:
        return TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0, cached_tokens=0)

    prompt_tokens_details = getattr(usage, "prompt_tokens_details", None)
    cached_tokens = 0
    if prompt_tokens_details:
        cached_tokens = getattr(prompt_tokens_details, "cached_tokens", 0) or 0

    return TokenUsage(
        input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        total_tokens=getattr(usage, "total_tokens", 0) or 0,
        cached_tokens=cached_tokens,
    )


def zero_cost() -> CostData:
    return CostData(input_cost=0.0, output_cost=0.0, total_cost=0.0)


class LLMClient:
    def __init__(self):
        self.gemini_model = 'gemini-2.5-flash'
        self.gemini_api_key = settings.gemini_api_key.strip()
        self.litellm_base_url = settings.litellm_base_url.strip()
        self.litellm_api_key = settings.litellm_api_key.strip()
        self.litellm_model = settings.litellm_model.strip()
        self.provider = self._detect_provider()
        self.gemini_client = genai.Client(api_key=self.gemini_api_key) if self.gemini_api_key else None
        self.litellm_client = None
        self._config_signature = self._compute_config_signature()

        if self.provider == "litellm":
            self.litellm_client = AsyncOpenAI(
                api_key=self.litellm_api_key,
                base_url=self._normalize_openai_base_url(self.litellm_base_url),
            )

        self.client = self.litellm_client if self.provider == "litellm" else self.gemini_client

    def _detect_provider(self) -> str | None:
        has_litellm = all([
            bool(self.litellm_base_url),
            bool(self.litellm_api_key),
            bool(self.litellm_model),
        ])
        if has_litellm:
            return "litellm"
        if self.gemini_api_key:
            return "gemini"
        return None

    def _compute_config_signature(self) -> tuple[str, str, str, str]:
        return (
            self.gemini_api_key,
            self.litellm_base_url,
            self.litellm_api_key,
            self.litellm_model,
        )

    def _normalize_openai_base_url(self, base_url: str) -> str:
        normalized = base_url.strip().rstrip("/")
        for suffix in ("/chat/completions", "/models"):
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)]
                break
        return normalized

    def _refresh_from_env_if_needed(self) -> None:
        gemini_api_key = os.getenv("GEMINI_API_KEY")
        litellm_base_url = os.getenv("LITELLM_BASE_URL")
        litellm_api_key = os.getenv("LITELLM_API_KEY")
        litellm_model = os.getenv("LITELLM_MODEL")

        gemini_api_key = self.gemini_api_key if gemini_api_key is None else gemini_api_key.strip()
        litellm_base_url = self.litellm_base_url if litellm_base_url is None else litellm_base_url.strip()
        litellm_api_key = self.litellm_api_key if litellm_api_key is None else litellm_api_key.strip()
        litellm_model = self.litellm_model if litellm_model is None else litellm_model.strip()

        new_signature = (
            gemini_api_key,
            litellm_base_url,
            litellm_api_key,
            litellm_model,
        )

        if new_signature == self._config_signature:
            return

        self.gemini_api_key = gemini_api_key
        self.litellm_base_url = litellm_base_url
        self.litellm_api_key = litellm_api_key
        self.litellm_model = litellm_model
        self.provider = self._detect_provider()

        self.gemini_client = genai.Client(api_key=self.gemini_api_key) if self.gemini_api_key else None
        self.litellm_client = None
        if self.provider == "litellm":
            self.litellm_client = AsyncOpenAI(
                api_key=self.litellm_api_key,
                base_url=self._normalize_openai_base_url(self.litellm_base_url),
            )

        self.client = self.litellm_client if self.provider == "litellm" else self.gemini_client
        self._config_signature = new_signature

    @property
    def model(self) -> str:
        if self.provider == "litellm":
            return self.litellm_model
        return self.gemini_model

    def provider_label(self) -> str:
        if self.provider == "litellm":
            return "LiteLLM"
        if self.provider == "gemini":
            return "Gemini"
        return "LLM"

    def missing_config_message(self) -> str:
        return (
            "Missing LLM configuration. Set either GEMINI_API_KEY, or all of "
            "LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_MODEL."
        )

    async def analyze_workflow(
        self,
        code: str,
        metadata: list = None,
        correction_prompt: str = None,
        http_connections: str = None
    ) -> tuple[str, TokenUsage, CostData]:
        """Analyze code for LLM workflow patterns using configured LLM provider."""
        self._refresh_from_env_if_needed()
        user_prompt = build_user_prompt(code, metadata, http_connections)

        # If correction prompt provided, append it for retry
        if correction_prompt:
            user_prompt = f"{user_prompt}\n\n{correction_prompt}"

        if self.provider == "litellm":
            return await self._analyze_with_litellm(user_prompt)
        if self.provider == "gemini":
            return await self._analyze_with_gemini(user_prompt)
        raise Exception(self.missing_config_message())

    async def _analyze_with_gemini(self, user_prompt: str) -> tuple[str, TokenUsage, CostData]:
        # Use system_instruction parameter (not concatenated into content)
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.0,
            top_p=1.0,
            top_k=1,
            max_output_tokens=65536,
        )

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.gemini_client.aio.models.generate_content(
                    model=self.gemini_model,
                    contents=user_prompt,
                    config=config,
                )

                # Check finish reason
                if response.candidates:
                    finish_reason = response.candidates[0].finish_reason
                    if finish_reason == 'MAX_TOKENS':
                        raise Exception("Output exceeded token limit. Try reducing batch size.")
                    elif finish_reason == 'SAFETY':
                        raise Exception("Response blocked by safety filters.")
                    elif finish_reason not in ['STOP', 'UNSPECIFIED', None]:
                        raise Exception(f"Generation failed: {finish_reason}")

                # Extract usage and calculate cost
                usage = extract_usage(response)
                cost = calculate_cost(usage)
                return response.text, usage, cost

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower() or 'rate' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        match = re.search(r'retry in ([\d.]+)', error_str, re.IGNORECASE)
                        if match:
                            wait_time = float(match.group(1)) / 1000 + 1
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise

    async def _analyze_with_litellm(self, user_prompt: str) -> tuple[str, TokenUsage, CostData]:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.litellm_client.chat.completions.create(
                    model=self.litellm_model,
                    messages=[
                        {"role": "system", "content": SYSTEM_INSTRUCTION},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.0,
                    top_p=1.0,
                    max_tokens=65536,
                )
                choices = getattr(response, "choices", []) or []
                if not choices or not choices[0].message or choices[0].message.content is None:
                    raise Exception("LiteLLM returned empty response.")

                usage = extract_openai_usage(response)
                return choices[0].message.content, usage, zero_cost()
            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower() or 'rate' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        match = re.search(r'retry in ([\d.]+)', error_str, re.IGNORECASE)
                        if match:
                            wait_time = float(match.group(1)) / 1000 + 1
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise


    async def condense_repo_structure(self, raw_structure: str) -> tuple[str, TokenUsage, CostData]:
        """Condense raw repo structure into workflow-relevant summary.

        Takes tree-sitter extracted structure and returns a condensed version
        containing only LLM/AI workflow-relevant files and functions.
        """
        self._refresh_from_env_if_needed()
        user_prompt = f"""Analyze this codebase structure and identify LLM/AI workflows.

<raw_structure>
{raw_structure}
</raw_structure>

Output a condensed workflow structure following the system instructions."""

        if self.provider == "litellm":
            return await self._condense_with_litellm(user_prompt)
        if self.provider == "gemini":
            return await self._condense_with_gemini(user_prompt)
        raise Exception(self.missing_config_message())

    async def _condense_with_gemini(self, user_prompt: str) -> tuple[str, TokenUsage, CostData]:
        config = types.GenerateContentConfig(
            system_instruction=CONDENSATION_SYSTEM_PROMPT,
            temperature=0.0,
            top_p=1.0,
            top_k=1,
            max_output_tokens=8192,
        )

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.gemini_client.aio.models.generate_content(
                    model=self.gemini_model,
                    contents=user_prompt,
                    config=config,
                )
                # Extract usage and calculate cost
                usage = extract_usage(response)
                cost = calculate_cost(usage)
                return response.text, usage, cost
            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise

    async def _condense_with_litellm(self, user_prompt: str) -> tuple[str, TokenUsage, CostData]:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.litellm_client.chat.completions.create(
                    model=self.litellm_model,
                    messages=[
                        {"role": "system", "content": CONDENSATION_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.0,
                    top_p=1.0,
                    max_tokens=8192,
                )
                choices = getattr(response, "choices", []) or []
                if not choices or not choices[0].message or choices[0].message.content is None:
                    raise Exception("LiteLLM returned empty response.")

                usage = extract_openai_usage(response)
                return choices[0].message.content, usage, zero_cost()
            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise


    async def generate_metadata(self, prompt: str) -> tuple[str, TokenUsage, CostData]:
        """Generate metadata using a simple prompt (no workflow analysis).

        Used for incremental updates where we just need labels/descriptions.
        """
        self._refresh_from_env_if_needed()
        if self.provider == "litellm":
            return await self._generate_metadata_with_litellm(prompt)
        if self.provider == "gemini":
            return await self._generate_metadata_with_gemini(prompt)
        raise Exception(self.missing_config_message())

    async def _generate_metadata_with_gemini(self, prompt: str) -> tuple[str, TokenUsage, CostData]:
        config = types.GenerateContentConfig(
            temperature=0.0,
            top_p=1.0,
            top_k=1,
            max_output_tokens=8192,
        )

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.gemini_client.aio.models.generate_content(
                    model=self.gemini_model,
                    contents=prompt,
                    config=config,
                )

                # Check finish reason
                if response.candidates:
                    finish_reason = response.candidates[0].finish_reason
                    if finish_reason == 'SAFETY':
                        raise Exception("Response blocked by safety filters.")
                    elif finish_reason not in ['STOP', 'UNSPECIFIED', None, 'MAX_TOKENS']:
                        raise Exception(f"Generation failed: {finish_reason}")

                usage = extract_usage(response)
                cost = calculate_cost(usage)
                return response.text, usage, cost

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise

    async def _generate_metadata_with_litellm(self, prompt: str) -> tuple[str, TokenUsage, CostData]:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self.litellm_client.chat.completions.create(
                    model=self.litellm_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                    top_p=1.0,
                    max_tokens=8192,
                )

                choices = getattr(response, "choices", []) or []
                if not choices or not choices[0].message or choices[0].message.content is None:
                    raise Exception("LiteLLM returned empty response.")

                usage = extract_openai_usage(response)
                return choices[0].message.content, usage, zero_cost()

            except Exception as e:
                error_str = str(e)
                if '429' in error_str or 'quota' in error_str.lower():
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        await asyncio.sleep(wait_time)
                    else:
                        raise
                else:
                    raise

    async def check_health(self) -> str:
        """Check provider credential validity: valid, invalid, or missing."""
        self._refresh_from_env_if_needed()
        if self.provider == "litellm":
            list_error = None
            try:
                await self.litellm_client.models.list()
                return "valid"
            except Exception as e:
                list_error = e

            try:
                await self.litellm_client.chat.completions.create(
                    model=self.litellm_model,
                    messages=[{"role": "user", "content": "health check"}],
                    max_tokens=1,
                    temperature=0.0,
                )
                return "valid"
            except Exception as completion_error:
                print(
                    "[HEALTH] LiteLLM config invalid: "
                    f"models.list failed ({list_error}); "
                    f"chat.completions.create failed ({completion_error})"
                )
                return "invalid"

        if self.provider == "gemini":
            try:
                list(self.gemini_client.models.list())
                return "valid"
            except Exception as e:
                print(f"[HEALTH] Gemini API key invalid: {e}")
                return "invalid"

        return "missing"


llm_client = LLMClient()
gemini_client = llm_client
