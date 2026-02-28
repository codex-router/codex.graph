import argparse
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import sys

from models import (
    AnalyzeRequest, WorkflowGraph,
    MetadataRequest, FileMetadataResult, FunctionMetadata,
    CondenseRequest,
    TokenUsage, CostData, AnalyzeResponse
)
from prompts import build_metadata_only_prompt, USE_MERMAID_FORMAT
from mermaid_parser import parse_mermaid_response
from gemini_client import llm_client

app = FastAPI(title="Codag")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Analysis Endpoint
# =============================================================================

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_workflow(
    request: AnalyzeRequest,
):
    """
    Analyze code for LLM workflow patterns.
    """
    if not llm_client.client:
        raise HTTPException(status_code=503, detail=llm_client.missing_config_message())

    # Track cumulative cost across retries
    total_usage = TokenUsage(input_tokens=0, output_tokens=0, total_tokens=0, cached_tokens=0)
    total_cost = CostData(input_cost=0.0, output_cost=0.0, total_cost=0.0)

    # Input validation
    MAX_CODE_SIZE = 5_000_000  # 5MB limit
    MAX_FILES = 50  # Reasonable limit on number of files

    if len(request.code) > MAX_CODE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Code size ({len(request.code)} bytes) exceeds maximum allowed size ({MAX_CODE_SIZE} bytes). Try analyzing fewer files or smaller files."
        )

    if request.file_paths and len(request.file_paths) > MAX_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Number of files ({len(request.file_paths)}) exceeds maximum allowed ({MAX_FILES}). Try analyzing fewer files at once."
        )

    # Convert metadata to dict format
    metadata_dicts = [m.model_dump() for m in request.metadata] if request.metadata else None

    # Helper to accumulate usage/cost
    def accumulate_cost(usage: TokenUsage, cost: CostData):
        nonlocal total_usage, total_cost
        total_usage = TokenUsage(
            input_tokens=total_usage.input_tokens + usage.input_tokens,
            output_tokens=total_usage.output_tokens + usage.output_tokens,
            total_tokens=total_usage.total_tokens + usage.total_tokens,
            cached_tokens=total_usage.cached_tokens + usage.cached_tokens
        )
        total_cost = CostData(
            input_cost=total_cost.input_cost + cost.input_cost,
            output_cost=total_cost.output_cost + cost.output_cost,
            total_cost=total_cost.total_cost + cost.total_cost
        )

    # LLM analysis
    try:
        result, usage, cost = await llm_client.analyze_workflow(
            request.code,
            metadata_dicts,
            http_connections=request.http_connections
        )
        accumulate_cost(usage, cost)
        result = result.strip()

        # Helper to fix file paths from LLM (handles both relative and mangled absolute paths)
        def fix_file_path(path: str, file_paths: list) -> str:
            if not path:
                return path
            if path in file_paths:
                return path
            filename = path.split('/')[-1]
            for input_path in file_paths:
                if input_path.endswith('/' + filename):
                    return input_path
            return path

        # Parse response based on format
        if USE_MERMAID_FORMAT:
            # Parse Mermaid + Metadata format with retry on failure
            MAX_RETRIES = 2

            for attempt in range(MAX_RETRIES + 1):
                # Strip markdown wrappers if present
                clean_result = result
                if clean_result.startswith("```"):
                    clean_result = clean_result.split("\n", 1)[1] if "\n" in clean_result else clean_result[3:]
                if clean_result.endswith("```"):
                    clean_result = clean_result.rsplit("```", 1)[0]

                try:
                    graph = parse_mermaid_response(clean_result.strip())
                    break  # Success - exit retry loop
                except ValueError as e:
                    if attempt < MAX_RETRIES:
                        # Retry with a correction prompt
                        correction_prompt = f"""Your previous response could not be parsed. Error: {str(e)[:200]}

CRITICAL FORMAT REMINDER:
1. Output RAW TEXT only - NO markdown backticks
2. Mermaid diagram(s) FIRST, then "---" separator, then "metadata:" section
3. The metadata section must be valid YAML

Example format:
flowchart TD
    %% Workflow: Example
    A[Step] --> B([LLM])

---
metadata:
A: {{file: "file.py", line: 1, function: "func", type: "step"}}
B: {{file: "file.py", line: 10, function: "llm", type: "llm"}}

Please re-analyze the code and output in the CORRECT format."""
                        try:
                            result, retry_usage, retry_cost = await llm_client.analyze_workflow(
                                request.code,
                                metadata_dicts,
                                correction_prompt
                            )
                            accumulate_cost(retry_usage, retry_cost)
                            result = result.strip()
                        except Exception as retry_err:
                            raise HTTPException(
                                status_code=500,
                                detail=f"Analysis failed after retry: {str(e)}"
                            )
                    else:
                        # All retries exhausted
                        raise HTTPException(
                            status_code=500,
                            detail=f"Analysis failed after {MAX_RETRIES + 1} attempts: Could not parse Mermaid response. {str(e)}"
                        )

            # Empty graph is valid - code has no LLM calls
            if not graph.nodes:
                return AnalyzeResponse(graph=graph, usage=total_usage, cost=total_cost)

            # Fix file paths in nodes
            for node in graph.nodes:
                if node.source and node.source.file:
                    node.source.file = fix_file_path(node.source.file, request.file_paths)

            return AnalyzeResponse(graph=graph, usage=total_usage, cost=total_cost)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/analyze/metadata-only")
async def analyze_metadata_only(request: MetadataRequest):
    """Generate metadata (labels, descriptions) for functions.

    This is a lightweight endpoint for incremental updates.
    Structure is already known from local tree-sitter analysis.
    Only needs LLM for human-readable labels and descriptions.
    """
    if not llm_client.client:
        raise HTTPException(status_code=503, detail=llm_client.missing_config_message())
    # Build prompt from structure context
    files_data = [f.model_dump() for f in request.files]
    prompt = build_metadata_only_prompt(files_data)

    # Add code context if provided
    if request.code:
        prompt += f"\n\nFull code for context:\n{request.code[:8000]}"

    try:
        result, usage, cost = await llm_client.generate_metadata(prompt)

        # Clean markdown if present
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:]
        if result.startswith("```"):
            result = result[3:]
        if result.endswith("```"):
            result = result[:-3]

        # Parse response
        try:
            metadata_data = json.loads(result.strip())
        except json.JSONDecodeError:
            # Try to recover
            result_clean = result.strip()
            open_braces = result_clean.count('{') - result_clean.count('}')
            open_brackets = result_clean.count('[') - result_clean.count(']')
            result_clean += ']' * max(0, open_brackets)
            result_clean += '}' * max(0, open_braces)
            metadata_data = json.loads(result_clean)

        # Convert to response model
        files_result = []
        for file_data in metadata_data.get('files', []):
            functions = [
                FunctionMetadata(
                    name=f.get('name', ''),
                    label=f.get('label', f.get('name', '')),
                    description=f.get('description', '')
                )
                for f in file_data.get('functions', [])
            ]
            files_result.append(FileMetadataResult(
                filePath=file_data.get('filePath', ''),
                functions=functions,
                edgeLabels=file_data.get('edgeLabels', {})
            ))

        return {
            "files": [f.model_dump() for f in files_result],
            "usage": usage.model_dump(),
            "cost": cost.model_dump()
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Metadata analysis failed: {str(e)}")


@app.post("/condense-structure")
async def condense_structure(request: CondenseRequest):
    """Condense raw repo structure into workflow-relevant summary.

    Uses LLM to:
    1. Filter out irrelevant files (tests, configs, utilities)
    2. Identify LLM/AI workflow entry points
    3. Create condensed structure for cross-batch context
    """
    if not llm_client.client:
        raise HTTPException(status_code=503, detail=llm_client.missing_config_message())
    try:
        condensed, usage, cost = await llm_client.condense_repo_structure(request.raw_structure)
        return {
            "condensed_structure": condensed,
            "usage": usage.model_dump(),
            "cost": cost.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Structure condensation failed: {str(e)}")


@app.get("/health")
async def health():
    api_key_status = await llm_client.check_health()
    provider = llm_client.provider or "none"
    model = llm_client.model if llm_client.provider else ""
    return {
        "status": "ok",
        "api_key_status": api_key_status,
        "provider": provider,
        "model": model,
    }


def _read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as fp:
        return fp.read()


def _load_json_from_text(raw_text: str, source_name: str):
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {source_name}: {exc}") from exc


def _build_cli_analyze_request(args: argparse.Namespace) -> AnalyzeRequest:
    if args.request_json:
        if args.request_json == "-":
            raw_text = sys.stdin.read()
            payload = _load_json_from_text(raw_text, "stdin")
        else:
            raw_text = _read_text_file(args.request_json)
            payload = _load_json_from_text(raw_text, args.request_json)
        return AnalyzeRequest.model_validate(payload)

    if args.metadata_json and args.metadata_file:
        raise ValueError("Use only one of --metadata-json or --metadata-file")

    if args.http_connections and args.http_connections_file:
        raise ValueError("Use only one of --http-connections or --http-connections-file")

    code = (args.code or "").strip()
    if not code and args.code_file:
        code = _read_text_file(args.code_file)
    if not code:
        raise ValueError("code is required (use --code, --code-file, or --request-json)")

    file_paths = []
    for item in args.file_path or []:
        normalized = (item or "").strip()
        if normalized:
            file_paths.append(normalized)
    if args.file_paths:
        for item in args.file_paths.split(","):
            normalized = item.strip()
            if normalized:
                file_paths.append(normalized)
    if not file_paths:
        raise ValueError("file_paths is required (use --file-path/--file-paths or --request-json)")

    metadata = []
    if args.metadata_json:
        parsed = _load_json_from_text(args.metadata_json, "--metadata-json")
        if isinstance(parsed, list):
            metadata = parsed
        else:
            raise ValueError("--metadata-json must be a JSON array")
    elif args.metadata_file:
        parsed = _load_json_from_text(_read_text_file(args.metadata_file), args.metadata_file)
        if isinstance(parsed, list):
            metadata = parsed
        else:
            raise ValueError("--metadata-file must contain a JSON array")

    http_connections = args.http_connections
    if http_connections is None and args.http_connections_file:
        http_connections = _read_text_file(args.http_connections_file)

    payload = {
        "code": code,
        "file_paths": file_paths,
        "metadata": metadata,
    }
    if args.framework_hint:
        payload["framework_hint"] = args.framework_hint
    if http_connections is not None:
        payload["http_connections"] = http_connections

    return AnalyzeRequest.model_validate(payload)


async def _run_cli_analyze(args: argparse.Namespace) -> int:
    try:
        request = _build_cli_analyze_request(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        response = await analyze_workflow(request)
    except HTTPException as exc:
        print(json.dumps({"status_code": exc.status_code, "detail": exc.detail}, ensure_ascii=False), file=sys.stderr)
        return 1

    body = response.model_dump()
    if args.pretty:
        output_text = json.dumps(body, ensure_ascii=False, indent=2)
    else:
        output_text = json.dumps(body, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fp:
            fp.write(output_text)
    else:
        print(output_text)
    return 0


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="codex.graph backend")
    subparsers = parser.add_subparsers(dest="command")

    serve_parser = subparsers.add_parser("serve", help="Run HTTP API server")
    serve_parser.add_argument("--host", default="0.0.0.0")
    serve_parser.add_argument("--port", type=int, default=52104)

    analyze_parser = subparsers.add_parser("analyze", help="Run one-shot analysis from CLI")
    analyze_parser.add_argument("--request-json", help="Path to AnalyzeRequest JSON file, or '-' for stdin")
    analyze_parser.add_argument("--code", help="Inline code text")
    analyze_parser.add_argument("--code-file", help="Path to code text file")
    analyze_parser.add_argument("--file-path", action="append", default=[], help="Single file path (repeatable)")
    analyze_parser.add_argument("--file-paths", help="Comma-separated file paths")
    analyze_parser.add_argument("--framework-hint", help="Optional framework hint")
    analyze_parser.add_argument("--metadata-json", help="Metadata JSON array string")
    analyze_parser.add_argument("--metadata-file", help="Path to metadata JSON array file")
    analyze_parser.add_argument("--http-connections", help="HTTP connections context text")
    analyze_parser.add_argument("--http-connections-file", help="Path to HTTP connections context file")
    analyze_parser.add_argument("--output", help="Write JSON output to file instead of stdout")
    analyze_parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")

    return parser


def _main() -> int:
    parser = _build_arg_parser()
    args = parser.parse_args()

    if args.command == "analyze":
        return asyncio.run(_run_cli_analyze(args))

    host = "0.0.0.0"
    port = 52104
    if args.command == "serve":
        host = args.host
        port = args.port

    import uvicorn
    uvicorn.run(app, host=host, port=port)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
