# AI Workflow Visualizer

VSCode extension that visualizes AI/LLM workflows using Gemini 2.5 Flash. Analyzes code containing LLM API calls and frameworks to generate interactive workflow graphs.

## Supported Technologies

**LLM APIs**: OpenAI, Anthropic, Gemini, Groq, Ollama, Cohere, Hugging Face
**Frameworks**: LangGraph, Mastra, LangChain, CrewAI

## Quick Start

```bash
make setup  # Install all dependencies
make run    # Start backend + launch extension
```

Requirements: Python 3.8+, Node.js 16+, VSCode

## Setup

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:
```bash
GEMINI_API_KEY=your-key-here
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run compile
```

### 3. Launch Extension

Press F5 in VSCode to open extension development host.

## Usage

In the extension development window:

1. **Auto-detect Workspace**: `CMD+Shift+P` → "AI Workflow: Auto-detect and Visualize"
   - Scans workspace for LLM-related files
   - Analyzes all files together as unified workflow

2. **Visualize Current File**: `CMD+Shift+P` → "AI Workflow: Visualize Current File"
   - Analyze single file

**Click nodes** to view source location and jump to code.

## Workflow Components

The system identifies 8 node types:

- **Triggers**: Entry points (API endpoints, main functions)
- **LLM Calls**: LLM API invocations
- **Tools**: Functions callable by LLMs
- **Decisions**: Conditional logic on LLM output
- **Integrations**: External APIs, databases
- **Memory**: State/conversation storage
- **Parsers**: Data transformation, formatting
- **Output**: Return statements, responses

## Architecture

**Two-part system:**
- **Backend** (Python/FastAPI): Port 8000, uses Gemini 2.5 Flash for code analysis
- **Frontend** (TypeScript/VSCode): D3.js + Dagre visualization in webview panel

**Data Flow:**
1. Frontend detects LLM files via regex patterns
2. Sends code to backend `/analyze` endpoint
3. Backend uses Gemini to extract workflow nodes/edges
4. Frontend caches results by file hash
5. Webview displays interactive graph

**Note**: Auth is currently disabled (TODOs exist in code for re-enabling).

## Development Commands

```bash
make run      # Compile frontend, start backend, launch extension
make stop     # Stop backend server
make debug    # Launch extension without starting backend
make setup    # Install dependencies
```

Manual backend start:
```bash
cd backend
. venv/bin/activate
python main.py  # Runs on http://localhost:8000
```

## Key Files

**Backend:**
- `gemini_client.py` - LLM prompt for workflow extraction
- `models.py` - Pydantic models (`WorkflowGraph`, `SourceLocation`)
- `analyzer.py` - Static analysis patterns

**Frontend:**
- `extension.ts` - VSCode commands, file navigation
- `webview.ts` - D3.js/Dagre visualization
- `analyzer.ts` - Client-side LLM detection
- `cache.ts` - Multi-file workspace caching

## Adding LLM Providers

1. Add import pattern to `frontend/src/analyzer.ts` → `LLM_CLIENT_PATTERNS`
2. Add API call pattern to `frontend/src/analyzer.ts` → `LLM_CALL_PATTERNS`
3. Add detection logic to `backend/gemini_client.py` → "DETECT LLM PROVIDERS" section
4. Run `cd frontend && npm run compile`
