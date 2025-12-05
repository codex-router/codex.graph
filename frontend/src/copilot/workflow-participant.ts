/**
 * Chat Participant for providing workflow context to Copilot
 * Users invoke with @workflow in Copilot Chat
 */

import * as vscode from 'vscode';
import { CacheManager } from '../cache';
import { WorkflowGraph } from '../api';
import { WorkflowMetadataProvider } from './metadata-provider';
import { ViewState, WorkflowMetadata } from './types';
import { CodeModifier } from './code-modifier';
import { filterOrphanedNodes } from './graph-filter';
import { TYPE_SYMBOLS, createNodeLink, formatWorkflowsCompact, formatLegend } from './compact-formatter';

export function registerWorkflowParticipant(
  context: vscode.ExtensionContext,
  cacheManager: CacheManager,
  getViewState: () => ViewState | null
): vscode.Disposable {

  const metadataProvider = new WorkflowMetadataProvider();
  const codeModifier = new CodeModifier();

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    console.log('🎯 [@workflow] Participant invoked');
    console.log('📝 [@workflow] User prompt:', request.prompt);
    console.log('🔧 [@workflow] Command:', request.command);

    try {
      stream.progress('Loading workflow context...');

      let filePath: string | undefined;
      let fileContent: string | undefined;
      let graph: WorkflowGraph | null = null;

      // Strategy 1: Check view state for selected node
      const viewState = getViewState();
      if (viewState?.selectedNodeId) {
        console.log('📍 [@workflow] Selected node detected:', viewState.selectedNodeId);
        graph = await cacheManager.getMostRecentWorkflows();
        if (graph) {
          const selectedNode = graph.nodes.find((n: any) => n.id === viewState.selectedNodeId);
          if (selectedNode?.source) {
            filePath = selectedNode.source.file;
            console.log('📁 [@workflow] Using file from selected node:', filePath);
            try {
              const uri = vscode.Uri.file(filePath);
              const document = await vscode.workspace.openTextDocument(uri);
              fileContent = document.getText();
            } catch (error) {
              console.warn('⚠️  [@workflow] Failed to read selected node file:', error);
            }
          }
        }
      }

      // Strategy 2: Fall back to active editor
      if (!graph || !filePath) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          filePath = editor.document.uri.fsPath;
          fileContent = editor.document.getText();
          console.log('📁 [@workflow] Using active editor file:', filePath);
          graph = await cacheManager.getPerFile(filePath, fileContent);
        }
      }

      // Strategy 3: Fall back to all cached workflows
      if (!graph) {
        console.log('📊 [@workflow] No file context, using workspace-level cache');
        graph = await cacheManager.getMostRecentWorkflows();
      }

      // Only error if no cache exists at all
      if (!graph) {
        stream.markdown('⚠️ No workflow data found.\n\n');
        stream.markdown('Run **Codag: Auto-detect and Visualize** first to analyze workflows.');
        return { metadata: { command: request.command } };
      }

      console.log('✅ [@workflow] Found graph with', graph.nodes.length, 'nodes');

      // Filter out orphaned nodes and their edges (match webview rendering)
      const filteredGraph = filterOrphanedNodes(graph);
      console.log('🔍 [@workflow] Filtered to', filteredGraph.nodes.length, 'nodes in LLM workflows');

      // Extract metadata with view awareness (including code snippets for visible nodes)
      const selectedNodeId = viewState?.selectedNodeId || undefined;
      const visibleNodeIds = viewState?.visibleNodeIds || undefined;
      const targetFile = filePath || (selectedNodeId ? filteredGraph.nodes.find((n: any) => n.id === selectedNodeId)?.source?.file : undefined) || '';
      const metadata = await metadataProvider.extractMetadata(
        filteredGraph,
        targetFile,
        selectedNodeId,
        visibleNodeIds,
        {
          includeCodeSnippets: visibleNodeIds && visibleNodeIds.length > 0,
          contextLines: 3
        }
      );

      // Build context string
      const contextStr = formatMetadata(metadata, targetFile, viewState, filteredGraph);
      console.log('📊 [@workflow] Context size:', contextStr.length, 'chars');

      // Show selected node compactly
      if (viewState?.selectedNodeId) {
        const node = filteredGraph.nodes.find((n: any) => n.id === viewState.selectedNodeId);
        if (node) {
          const sym = TYPE_SYMBOLS[node.type] || '□';
          stream.markdown(`**Viewing:** ${sym} ${node.label}\n\n`);
        }
      }

      // Build LLM messages with workflow context
      stream.progress('Analyzing workflow with AI...');

      const systemPrompt = `You are Codag, a workflow visualization assistant.

NODE TYPES: ⚡trigger 🧠llm 🔧tool ◇decision 🔌integration 💾memory ⚙️parser ✓output

RESPONSE FORMAT:
- When asked about workflows: Use clickable workflow names from context - DON'T list individual nodes
- Only show individual nodes if user specifically asks for node details
- Keep responses concise - workflow links are already clickable and will zoom to that workflow
- Workflow and node names in context are clickable links that zoom to their location

FOR CODE CHANGES:
- Say "I can prepare the exact changes" then show the diff/snippet
- Never say "I can't modify files" - show what to change instead

If context is empty, suggest running "Codag: Auto-detect and Visualize".

CONTEXT:
${contextStr}`;

      const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(request.prompt)
      ];

      const chatResponse = await request.model.sendRequest(messages, {}, token);

      // Stream response to user immediately (don't wait for full response)
      let fullResponse = '';
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
        fullResponse += fragment;
      }

      // Check if the response contains code modifications
      await detectAndApplyCodeModifications(fullResponse, graph, viewState, codeModifier, stream);

      console.log('✅ [@workflow] Response completed');

      return { metadata: { command: request.command } };

    } catch (error) {
      console.error('❌ [@workflow] Error:', error);
      stream.markdown(`❌ Error: ${error}`);
      return { metadata: { command: request.command, error: String(error) } };
    }
  };

  // Create and register participant
  const participant = vscode.chat.createChatParticipant(
    'codag.workflow',
    handler
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media/icon-chat.png');

  context.subscriptions.push(participant);
  console.log('✅ Registered @codag chat participant');

  return participant;
}

/**
 * Format metadata in compact format for the LLM
 */
function formatMetadata(
  metadata: WorkflowMetadata,
  filePath: string,
  viewState: ViewState | null,
  graph: WorkflowGraph
): string {
  const parts: string[] = [];

  // Selected node (if any)
  if (viewState?.selectedNodeId) {
    const node = graph.nodes.find(n => n.id === viewState.selectedNodeId);
    if (node) {
      const sym = TYPE_SYMBOLS[node.type] || '□';
      const link = createNodeLink(node.id, node.label);
      const location = node.source ? `→ ${node.source.file}:${node.source.line}` : '';
      parts.push(`Selected: ${sym} ${link} ${location}`);
      parts.push('');
    }
  }

  // Workflows as clickable links (not verbose tree structure)
  if (metadata.workflows.length > 0) {
    parts.push(formatWorkflowsCompact(metadata.workflows));
  }

  // All nodes list (compact)
  if (metadata.adjacentNodes.length > 0) {
    const visibleNodeIds = viewState?.visibleNodeIds || [];
    const nodeLimit = visibleNodeIds.length > 0 ? 25 : 15;
    const displayNodes = metadata.adjacentNodes.slice(0, nodeLimit);

    parts.push('Nodes:');
    displayNodes.forEach(node => {
      const sym = TYPE_SYMBOLS[node.type] || '□';
      const link = createNodeLink(node.nodeId, node.label);
      const location = `→ ${node.source.file}:${node.source.line}`;

      // Adjacency on same line if present
      const adj: string[] = [];
      if (node.beforeNodes.length > 0) {
        const beforeLinks = node.beforeNodes.slice(0, 2).map(id => {
          const n = graph.nodes.find(n => n.id === id);
          return n ? createNodeLink(id, n.label) : id;
        });
        adj.push(`← ${beforeLinks.join(', ')}`);
      }
      if (node.afterNodes.length > 0) {
        const afterLinks = node.afterNodes.slice(0, 2).map(id => {
          const n = graph.nodes.find(n => n.id === id);
          return n ? createNodeLink(id, n.label) : id;
        });
        adj.push(`→ ${afterLinks.join(', ')}`);
      }

      const adjStr = adj.length > 0 ? ` | ${adj.join(' | ')}` : '';
      parts.push(`${sym} ${link} ${location}${adjStr}`);
    });

    if (metadata.adjacentNodes.length > nodeLimit) {
      parts.push(`... +${metadata.adjacentNodes.length - nodeLimit} more`);
    }
    parts.push('');
  }

  // Cross-file connections (compact)
  if (metadata.crossFileEdges.length > 0) {
    parts.push('Cross-file:');
    metadata.crossFileEdges.slice(0, 5).forEach(edge => {
      const fromNode = graph.nodes.find(n => n.id === edge.from.nodeId);
      const toNode = graph.nodes.find(n => n.id === edge.to.nodeId);
      const fromLink = fromNode ? createNodeLink(edge.from.nodeId, fromNode.label) : edge.from.nodeId;
      const toLink = toNode ? createNodeLink(edge.to.nodeId, toNode.label) : edge.to.nodeId;
      parts.push(`${fromLink} → ${toLink}`);
    });
    parts.push('');
  }

  parts.push(formatLegend());

  return parts.join('\n');
}

/**
 * Detect code modifications in LLM response and offer to apply them
 */
async function detectAndApplyCodeModifications(
  response: string,
  graph: WorkflowGraph,
  viewState: ViewState | null,
  codeModifier: CodeModifier,
  stream: vscode.ChatResponseStream
): Promise<void> {
  // Look for code blocks with file paths
  const codeBlockRegex = /```(\w+)\n\/\/\s*File:\s*(.+?)\n\/\/\s*Insert after line (\d+).*?\n([\s\S]*?)```/g;
  const modifyBlockRegex = /```(\w+)\n\/\/\s*File:\s*(.+?)\n\/\/\s*Modify.*?line (\d+).*?\n([\s\S]*?)```/g;

  let match;
  const modifications: Array<{ type: 'insert' | 'modify', file: string, line: number, code: string, language: string }> = [];

  // Detect insertions
  while ((match = codeBlockRegex.exec(response)) !== null) {
    modifications.push({
      type: 'insert',
      language: match[1],
      file: match[2].trim(),
      line: parseInt(match[3]),
      code: match[4].trim()
    });
  }

  // Detect modifications
  while ((match = modifyBlockRegex.exec(response)) !== null) {
    modifications.push({
      type: 'modify',
      language: match[1],
      file: match[2].trim(),
      line: parseInt(match[3]),
      code: match[4].trim()
    });
  }

  if (modifications.length === 0) {
    return;
  }

  // Offer to apply modifications
  stream.markdown('\n\n---\n\n');
  stream.markdown(`**💡 Code modifications detected** (${modifications.length})\n\n`);

  for (const mod of modifications) {
    const button = stream.button({
      command: 'codag.applyCodeModification',
      arguments: [mod],
      title: `Apply ${mod.type} to ${mod.file}:${mod.line}`
    });

    stream.markdown(`- ${mod.type === 'insert' ? '➕ Insert' : '✏️ Modify'} code in \`${mod.file}\` at line ${mod.line}\n`);
  }

  stream.markdown('\n*Click a button above to preview and apply the changes*\n');
}
