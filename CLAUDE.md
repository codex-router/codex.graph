# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VSCode extension that visualizes AI/LLM workflows using Gemini 2.5 Flash. Analyzes code containing LLM API calls (OpenAI, Anthropic, Gemini, Groq, Ollama, Cohere, Hugging Face) and frameworks (LangGraph, Mastra, LangChain, CrewAI) to generate interactive workflow graphs.

## Architecture

**Two-part system:**
1. **Backend (Python/FastAPI)**: Runs on port 8000, uses Gemini 2.5 Flash for code analysis
2. **Frontend (TypeScript/VSCode Extension)**: Embeds D3.js + Dagre visualization in webview panel

**Data Flow:**
- Frontend detects LLM files via regex patterns (`frontend/src/analyzer.ts`)
- Sends code to backend `/analyze` endpoint
- Backend uses Gemini to extract workflow nodes/edges (`backend/gemini_client.py`)
- Frontend caches results by file hash (`frontend/src/cache.ts`)
- Webview displays interactive graph with clickable nodes

**Key Design Decisions:**
- Auth is **disabled** (TODOs in code for re-enabling)
- Multi-file analysis: Combines files with `# File: path` markers
- Deterministic LLM output: Temperature 0.0, specific prompt structure
- Caching: Workspace-level hash of all analyzed files

## Commands

**Setup:**
```bash
make setup          # Install backend + frontend dependencies
```

**Development:**
```bash
make run            # Compile frontend, start backend, launch extension
make stop           # Stop backend server
make debug          # Launch extension without starting backend
```

**Manual:**
```bash
# Backend
cd backend
. venv/bin/activate
python main.py      # Starts on port 8000

# Frontend
cd frontend
npm run compile     # Compile TypeScript
# Then press F5 in VSCode to launch extension
```

## Critical Files

**Backend:**
- `backend/gemini_client.py` - LLM prompt for workflow extraction (lines 17-108)
- `backend/models.py` - Pydantic models including `WorkflowGraph`, `SourceLocation`
- `backend/analyzer.py` - Static analysis patterns for LLM detection

**Frontend:**
- `frontend/src/extension.ts` - VSCode commands, handles `openFile` messages
- `frontend/src/webview.ts` - D3.js/Dagre visualization, side panel UI
- `frontend/src/analyzer.ts` - Client-side LLM detection patterns
- `frontend/src/cache.ts` - Multi-file workspace caching

## Workflow Node Types

The system identifies 8 node types (defined in Gemini prompt):
1. **trigger** - Entry points (API endpoints, main functions)
2. **llm** - LLM API calls
3. **tool** - Functions called by/available to LLM
4. **decision** - Conditional logic on LLM output
5. **integration** - External APIs, databases
6. **memory** - State/conversation storage
7. **parser** - Data transformation, formatting
8. **output** - Return statements, responses

Each node includes `source: {file, line, function}` for code navigation.

## Modifying LLM Detection

**Add new LLM provider:**
1. Add import pattern to `frontend/src/analyzer.ts` → `LLM_CLIENT_PATTERNS`
2. Add API call pattern to `frontend/src/analyzer.ts` → `LLM_CALL_PATTERNS`
3. Add detection logic to `backend/gemini_client.py` → "DETECT LLM PROVIDERS" section
4. Run `cd frontend && npm run compile`

**Change prompt behavior:**
- Edit `backend/gemini_client.py` lines 17-108
- Restart backend: `make stop && make run`
- Clear cache: Delete workspace state or change files

## Visualization

- **Layout**: Dagre hierarchical (left-to-right)
- **Interactions**: Click node → opens side panel with source link
- **Navigation**: Clicking source link jumps to code in editor
- **Styling**: VSCode theme variables, colored icons per node type

## Environment

Requires `backend/.env` with:
```
GEMINI_API_KEY=your-key-here
```

Backend logs to `backend.log`, PID stored in `backend.pid`.
