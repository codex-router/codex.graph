# AI Workflow Visualizer

VSCode extension that visualizes ANY AI/LLM workflow using Gemini 2.5 Flash and static analysis.

Detects workflows from:
- **LLM APIs**: OpenAI, Anthropic, Gemini, Groq, Ollama, Cohere, Hugging Face
- **Frameworks**: LangGraph, Mastra, LangChain, CrewAI
- **Custom Implementations**: Any code using LLM APIs

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your Gemini API key
python main.py
```

Backend runs on http://localhost:8000

### Frontend

```bash
cd frontend
npm install
npm run compile
```

Press F5 in VSCode to launch extension in debug mode.

## Usage

**Quick Start**:
```bash
make run
```

Then in the new VSCode window:
1. **Auto-detect Workspace**: `CMD+Shift+P` → "AI Workflow: Auto-detect and Visualize"
   - Scans entire workspace for AI/LLM files
   - Analyzes all detected files together as one workflow
   - No file picker - fully automatic!
2. **Visualize Current File**: `CMD+Shift+P` → "AI Workflow: Visualize Current File"
   - Analyze just the currently open file

**Detected Workflow Components**:
- **Triggers**: Webhooks, API endpoints, user input
- **LLM Calls**: OpenAI, Anthropic, Gemini, etc.
- **Tools**: Functions used by LLMs
- **Decisions**: Conditional logic based on LLM output
- **Integrations**: Slack, Jira, HTTP APIs
- **Memory**: Conversation history
- **Parsers**: Output structuring
- **Output**: Final results

## Features

- **Universal LLM Detection**: Detects OpenAI, Anthropic, Gemini, Groq, Ollama, and more
- **Framework Support**: LangGraph, Mastra, LangChain, CrewAI
- **Smart Analysis**: Identifies triggers, LLM calls, tools, decisions, integrations, memory, parsers
- **File hash-based caching**: Only re-analyze when code changes
- **D3.js interactive graph**: Force-directed visualization
- **JWT auth** with free trial (10 requests/day) - currently disabled for testing

## Architecture

**Frontend**: TypeScript VSCode extension with webview
**Backend**: FastAPI + Gemini 2.5 Flash
**Auth**: JWT tokens
**Caching**: Local (VSCode storage)
