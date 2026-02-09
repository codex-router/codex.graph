#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphLoader } from "./graph-loader.js";
import { listWorkflows, getWorkflow, getNode, getFileContext, initialContext, graphSummaryResource, wrapResult } from "./tools.js";

const workspacePath = process.argv[2];
if (!workspacePath) {
    process.stderr.write("Usage: codag-mcp <workspace-path>\n");
    process.exit(1);
}

const loader = new GraphLoader(workspacePath);

const server = new McpServer({
    name: "codag",
    version: "0.2.0",
});

// ---------------------------------------------------------------------------
// Resources (auto-injected into system prompt by supporting clients)
// ---------------------------------------------------------------------------

server.resource(
    "graph-summary",
    "codag://graph/summary",
    { description: "Compact summary of all LLM/AI workflows in the codebase. Auto-included in context." },
    async () => ({
        contents: [{
            uri: "codag://graph/summary",
            mimeType: "text/markdown",
            text: graphSummaryResource(loader.getIndex()),
        }],
    })
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.tool(
    "initial_context",
    "Get a compact summary of all workflows, file mappings, and cross-file edges in one call. Call this FIRST when starting any task involving LLM/AI code. Replaces the need for list_workflows + get_workflow + get_file_context chain.",
    {},
    async () => ({
        content: [{ type: "text", text: wrapResult("initial_context", initialContext(loader.getIndex())) }],
    })
);

server.tool(
    "list_workflows",
    "List all AI/LLM workflow pipelines. Use initial_context instead for first-time orientation.",
    {},
    async () => ({
        content: [{ type: "text", text: wrapResult("list_workflows", listWorkflows(loader.getIndex())) }],
    })
);

server.tool(
    "get_workflow",
    "Get full details of a workflow pipeline: all nodes, edges, and topological order.",
    { workflow_name: z.string().describe("Workflow name or ID (fuzzy matched)") },
    async ({ workflow_name }) => ({
        content: [{ type: "text", text: wrapResult("get_workflow", getWorkflow(loader.getIndex(), workflow_name)) }],
    })
);

server.tool(
    "get_node",
    "Get details of a specific workflow node: its type, source location, workflow membership, and input/output connections.",
    { node_id: z.string().describe("Node ID (e.g. 'api.ts::analyzeWorkflow::106') or function name") },
    async ({ node_id }) => ({
        content: [{ type: "text", text: wrapResult("get_node", getNode(loader.getIndex(), node_id)) }],
    })
);

server.tool(
    "get_file_context",
    "Get LLM workflow context for specific files you plan to modify. Returns which pipelines they belong to, nodes, LLM calls, and connected files.",
    { files: z.array(z.string()).describe("File paths to look up (relative to workspace root)") },
    async ({ files }) => ({
        content: [{ type: "text", text: wrapResult("get_file_context", getFileContext(loader.getIndex(), files)) }],
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
