import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkflowGraph } from './api';
import { ViewState } from './copilot/types';
import { FileTreeNode } from './file-picker';

export interface LoadingOptions {
    loading?: boolean;
    progress?: { current: number; total: number };
}

export class WebviewManager {
    private panel: vscode.WebviewPanel | undefined;
    private viewState: ViewState = {
        selectedNodeId: null,
        expandedWorkflowIds: [],
        lastUpdated: Date.now()
    };
    private filePickerResolver: ((paths: string[] | null) => void) | null = null;

    constructor(private context: vscode.ExtensionContext) {}

    private getIconPath() {
        return {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon-dark.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon-light.svg')
        };
    }

    getViewState(): ViewState | null {
        return this.panel ? this.viewState : null;
    }

    updateViewState(update: Partial<ViewState>) {
        this.viewState = {
            ...this.viewState,
            ...update,
            lastUpdated: Date.now()
        };
    }

    notifyAnalysisStarted() {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'analysisStarted' });
        }
    }

    notifyAnalysisComplete(success: boolean, error?: string) {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'analysisComplete',
                success,
                error
            });
        }
    }

    notifyWarning(message: string) {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'warning',
                message
            });
        }
    }

    private setupMessageHandlers() {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'openFile') {
                    try {
                        const filePath = message.file;

                        if (!filePath || typeof filePath !== 'string') {
                            vscode.window.showErrorMessage(`Invalid file path: ${filePath}`);
                            return;
                        }

                        if (!filePath.startsWith('/')) {
                            vscode.window.showErrorMessage(`File path must be absolute: ${filePath}`);
                            return;
                        }

                        const fileUri = vscode.Uri.file(filePath);
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

                        const line = message.line - 1;
                        const range = new vscode.Range(line, 0, line, 0);
                        editor.selection = new vscode.Selection(range.start, range.end);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Could not open file: ${error.message}`);
                    }
                } else if (message.command === 'refreshAnalysis') {
                    vscode.commands.executeCommand('codag.refresh');
                } else if (message.command === 'nodeSelected') {
                    this.updateViewState({
                        selectedNodeId: message.nodeId,
                        selectedNodeLabel: message.nodeLabel,
                        selectedNodeType: message.nodeType
                    });
                } else if (message.command === 'nodeDeselected') {
                    this.updateViewState({
                        selectedNodeId: null,
                        selectedNodeLabel: undefined,
                        selectedNodeType: undefined
                    });
                } else if (message.command === 'workflowVisibilityChanged') {
                    this.updateViewState({
                        expandedWorkflowIds: message.expandedWorkflowIds || []
                    });
                } else if (message.command === 'viewportChanged') {
                    this.updateViewState({
                        visibleNodeIds: message.visibleNodeIds || []
                    });
                } else if (message.command === 'filePickerResult') {
                    // Handle file picker result from webview
                    if (this.filePickerResolver) {
                        this.filePickerResolver(message.selectedPaths);
                        this.filePickerResolver = null;
                    }
                } else if (message.command === 'openAnalyzePanel') {
                    // Just show the file picker on the existing graph
                    vscode.commands.executeCommand('codag.showFilePicker');
                } else if (message.command === 'clearCacheAndReanalyze') {
                    // Clear cache and trigger full reanalysis
                    vscode.commands.executeCommand('codag.refresh');
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * Show file picker in webview and wait for user selection
     */
    async showFilePicker(tree: FileTreeNode, totalFiles: number): Promise<string[] | null> {
        // Ensure panel is created
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'codag',
                'LLM Architecture',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                        vscode.Uri.joinPath(this.context.extensionUri, 'out')
                    ]
                }
            );

            this.panel.iconPath = this.getIconPath();

            this.panel.onDidDispose(() => {
                this.panel = undefined;
                // If file picker was open, resolve with null
                if (this.filePickerResolver) {
                    this.filePickerResolver(null);
                    this.filePickerResolver = null;
                }
            });

            this.setupMessageHandlers();

            // Show empty graph initially
            this.panel.webview.html = this.getHtml({ nodes: [], edges: [], llms_detected: [], workflows: [] });
        } else {
            this.panel.reveal();
        }

        // Send file picker message to webview
        this.panel.webview.postMessage({
            command: 'showFilePicker',
            tree,
            totalFiles
        });

        // Wait for result
        return new Promise((resolve) => {
            this.filePickerResolver = resolve;
        });
    }

    /**
     * Update file picker with LLM detection results (called after picker is shown)
     */
    updateFilePickerLLM(llmFilePaths: string[]) {
        this.panel?.webview.postMessage({
            command: 'updateFilePickerLLM',
            llmFiles: llmFilePaths
        });
    }

    showLoading(message: string) {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'codag',
                'LLM Architecture',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                        vscode.Uri.joinPath(this.context.extensionUri, 'out')
                    ]
                }
            );

            this.panel.iconPath = this.getIconPath();

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.setupMessageHandlers();

            this.panel.webview.html = this.getHtml({ nodes: [], edges: [], llms_detected: [], workflows: [] });
        } else {
            this.panel.reveal();
        }

        this.panel.webview.postMessage({ command: 'showLoading', text: message });
    }

    updateProgress(current: number, total: number) {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'updateProgress', current, total });
        }
    }

    updateGraph(graph: WorkflowGraph) {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'updateGraph',
                graph,
                preserveState: true
            });
        }
    }

    /**
     * Initialize graph after file picker closes (for cached data)
     */
    initGraph(graph: WorkflowGraph) {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'initGraph',
                graph
            });
        }
    }

    showProgressOverlay(message: string) {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'showProgressOverlay', text: message });
        }
    }

    hideProgressOverlay() {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'hideProgressOverlay' });
        }
    }

    focusNode(nodeId: string) {
        if (this.panel) {
            this.panel.reveal();
            this.panel.webview.postMessage({ command: 'focusNode', nodeId });
        }
    }

    focusWorkflow(workflowName: string) {
        if (this.panel) {
            this.panel.reveal();
            this.panel.webview.postMessage({ command: 'focusWorkflow', workflowName });
        }
    }

    show(graph: WorkflowGraph, loadingOptions?: LoadingOptions) {
        if (this.panel) {
            this.panel.reveal();
            this.panel.webview.html = this.getHtml(graph, loadingOptions);
            return;
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'codag',
                'LLM Architecture',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                        vscode.Uri.joinPath(this.context.extensionUri, 'out')
                    ]
                }
            );

            this.panel.iconPath = this.getIconPath();

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.setupMessageHandlers();
        }

        this.panel.webview.html = this.getHtml(graph, loadingOptions);
    }

    private getHtml(graph: WorkflowGraph, loadingOptions?: LoadingOptions): string {
        const webview = this.panel!.webview;

        // Generate nonce for CSP
        const nonce = this.getNonce();

        // Get URIs for static files
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview-client', 'main.js')
        );

        // Stringify graph data safely
        let graphJson: string;
        try {
            graphJson = JSON.stringify(graph);
        } catch (error) {
            console.error('Failed to stringify graph:', error);
            graphJson = '{"nodes":[],"edges":[],"llms_detected":[],"workflows":[]}';
        }

        // Read static HTML template
        const htmlPath = path.join(this.context.extensionPath, 'media', 'webview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
        html = html.replace(/\{\{stylesUri\}\}/g, stylesUri.toString());

        // Replace script tag with graph data injection and bundled script
        const scriptReplacement = `
    <script nonce="${nonce}">
        window.__GRAPH_DATA__ = ${graphJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>`;

        html = html.replace('</body>', scriptReplacement);

        return html;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
