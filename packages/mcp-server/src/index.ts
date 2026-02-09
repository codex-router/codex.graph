#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphLoader } from "./graph-loader.js";
import { listWorkflows, getWorkflow, getNode, getFileContext } from "./tools.js";

const workspacePath = process.argv[2];
if (!workspacePath) {
    process.stderr.write("Usage: codag-mcp <workspace-path>\n");
    process.exit(1);
}

const loader = new GraphLoader(workspacePath);

const server = new McpServer({
    name: "codag",
    version: "0.1.0",
});

server.tool(
    "list_workflows",
    "List all AI/LLM workflow pipelines in the codebase. Call this first to orient yourself before modifying code that involves LLM/AI calls.",
    {},
    async () => ({
        content: [{ type: "text", text: JSON.stringify(listWorkflows(loader.getIndex()), null, 2) }],
    })
);

server.tool(
    "get_workflow",
    "Get full details of a workflow pipeline: all nodes, edges, and topological order. Use this to understand how an AI/LLM workflow is structured end-to-end.",
    { workflow_name: z.string().describe("Workflow name or ID (fuzzy matched)") },
    async ({ workflow_name }) => ({
        content: [{ type: "text", text: JSON.stringify(getWorkflow(loader.getIndex(), workflow_name), null, 2) }],
    })
);

server.tool(
    "get_node",
    "Get details of a specific workflow node: its type, source location, workflow membership, and input/output connections.",
    { node_id: z.string().describe("Node ID (e.g. 'api.ts::analyzeWorkflow::106') or function name") },
    async ({ node_id }) => ({
        content: [{ type: "text", text: JSON.stringify(getNode(loader.getIndex(), node_id), null, 2) }],
    })
);

server.tool(
    "get_file_context",
    "Get LLM workflow context for files. Returns which pipelines they belong to, which nodes are in them, and which LLM API calls they make. Call this before modifying files that contain or interact with LLM/AI calls.",
    { files: z.array(z.string()).describe("File paths to look up (relative to workspace root)") },
    async ({ files }) => ({
        content: [{ type: "text", text: JSON.stringify(getFileContext(loader.getIndex(), files), null, 2) }],
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
