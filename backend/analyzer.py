import re
from typing import Optional

class StaticAnalyzer:
    # LLM Client Detection Patterns
    LLM_CLIENT_PATTERNS = [
        # OpenAI
        r"from\s+openai\s+import",
        r"import\s+openai",
        r"OpenAI\s*\(",
        r"import\s+.*from\s+['\"]openai['\"]",

        # Anthropic
        r"from\s+anthropic\s+import",
        r"import\s+anthropic",
        r"Anthropic\s*\(",
        r"import\s+.*from\s+['\"]@anthropic-ai/sdk['\"]",

        # Google Gemini
        r"import\s+google\.generativeai",
        r"genai\.configure",
        r"genai\.GenerativeModel",
        r"from\s+['\"]@google/generative-ai['\"]",
        r"GoogleGenerativeAI",

        # Groq
        r"from\s+groq\s+import",
        r"import\s+groq",
        r"Groq\s*\(",
        r"import\s+.*from\s+['\"]groq-sdk['\"]",

        # Ollama
        r"from\s+ollama\s+import",
        r"import\s+ollama",
        r"import\s+.*from\s+['\"]ollama['\"]",

        # Cohere
        r"import\s+cohere",
        r"cohere\.Client",
        r"from\s+['\"]cohere-ai['\"]",

        # Hugging Face
        r"from\s+huggingface_hub\s+import",
        r"InferenceClient",
        r"from\s+['\"]@huggingface/inference['\"]",
    ]

    # LLM API Call Patterns
    LLM_CALL_PATTERNS = [
        r"\.chat\.completions\.create",
        r"\.completions\.create",
        r"\.messages\.create",
        r"\.generate_content",
        r"\.generateContent",
        r"\.chat\(",
        r"\.generate\(",
    ]

    # Tool/Function Patterns
    TOOL_PATTERNS = [
        r"tools\s*=",
        r"tool_choice\s*=",
        r"@tool",
        r"tool_use",
        r"function_call",
    ]

    # Framework Patterns (keep for framework-specific detection)
    FRAMEWORK_PATTERNS = {
        "langgraph": [
            r"from\s+langgraph",
            r"import\s+.*from\s+['\"]@langchain/langgraph['\"]",
            r"StateGraph|MessageGraph",
        ],
        "mastra": [
            r"from\s+mastra",
            r"import\s+.*from\s+['\"]mastra['\"]",
            r"@mastra/",
        ],
        "langchain": [
            r"from\s+langchain",
            r"import\s+.*from\s+['\"]@langchain",
            r"LLMChain|SequentialChain",
        ],
        "crewai": [
            r"from\s+crewai",
            r"import\s+.*from\s+['\"]crewai['\"]",
            r"Crew\s*\(",
        ]
    }

    @staticmethod
    def detect_workflow(code: str) -> bool:
        """Detect if code contains LLM workflow patterns"""

        # Check for LLM client imports
        has_llm_client = any(re.search(pattern, code) for pattern in StaticAnalyzer.LLM_CLIENT_PATTERNS)

        # Check for actual LLM API calls
        has_llm_calls = any(re.search(pattern, code) for pattern in StaticAnalyzer.LLM_CALL_PATTERNS)

        # Check for framework usage
        has_framework = any(
            any(re.search(pattern, code) for pattern in patterns)
            for patterns in StaticAnalyzer.FRAMEWORK_PATTERNS.values()
        )

        # File is a workflow if it has LLM clients + calls, or uses a framework
        return (has_llm_client and has_llm_calls) or has_framework

    @staticmethod
    def detect_framework(code: str, file_path: str) -> Optional[str]:
        """Detect workflow framework from actual imports"""

        # Check for specific frameworks first
        for framework, patterns in StaticAnalyzer.FRAMEWORK_PATTERNS.items():
            if any(re.search(pattern, code) for pattern in patterns):
                return framework

        # Detect generic LLM usage and identify the client
        if re.search(r"from\s+openai\s+import|import\s+openai|OpenAI\s*\(", code):
            return "openai"
        if re.search(r"from\s+anthropic\s+import|import\s+anthropic|Anthropic\s*\(", code):
            return "anthropic"
        if re.search(r"import\s+google\.generativeai|genai\.|GoogleGenerativeAI", code):
            return "gemini"
        if re.search(r"from\s+groq\s+import|import\s+groq|Groq\s*\(", code):
            return "groq"
        if re.search(r"from\s+ollama\s+import|import\s+ollama", code):
            return "ollama"

        # Check if it has any LLM patterns
        if StaticAnalyzer.detect_workflow(code):
            return "generic-llm"

        return None

    @staticmethod
    def should_analyze_file(file_path: str) -> bool:
        """Check if file is worth analyzing"""
        return file_path.endswith(('.py', '.ts', '.js', '.tsx', '.jsx'))

static_analyzer = StaticAnalyzer()
