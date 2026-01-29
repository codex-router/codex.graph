/**
 * File watching and change detection handler.
 * Handles debouncing, live indicators, and analysis scheduling.
 */

import * as vscode from 'vscode';
import { CacheManager } from '../cache';
import { WebviewManager } from '../webview';
import { MetadataBatcher, buildMetadataContext } from '../metadata-batcher';
import { performLocalUpdate } from './local-update';
import { withHttpEdges } from '../analysis/helpers';
import {
    clearPendingChange, setPendingChange, deletePendingChange,
    getCachedCallGraph,
    clearActivelyEditing, setActivelyEditing,
    clearChangedFunctions, setChangedFunctions
} from '../analysis/state';

/**
 * Context needed for file analysis scheduling.
 */
export interface FileWatchingContext {
    cache: CacheManager;
    webview: WebviewManager;
    log: (msg: string) => void;
    metadataBatcher: MetadataBatcher;
}

/**
 * Configuration for file watching.
 */
export interface FileWatchingConfig {
    debounceMs: number;
    activeToChangedMs: number;
}

/**
 * Schedule file analysis with debouncing.
 * Tries instant local update first, falls back to LLM analysis.
 *
 * @param ctx - Context with cache, webview, log, and metadataBatcher
 * @param uri - URI of the file that changed
 * @param source - Source of the change (watcher, save, create)
 * @param config - Debounce and timing configuration
 * @param fallbackAnalyze - Callback for full LLM analysis fallback
 */
export async function scheduleFileAnalysis(
    ctx: FileWatchingContext,
    uri: vscode.Uri,
    source: string,
    config: FileWatchingConfig,
    fallbackAnalyze: (uri: vscode.Uri) => Promise<void>
): Promise<void> {
    const { cache, webview, log, metadataBatcher } = ctx;
    const filePath = uri.fsPath;

    // Ignore compiled output files (they change when source files compile)
    if (filePath.includes('/out/') || filePath.includes('\\out\\')) {
        return;
    }

    // NOTE: We don't send immediate notification here.
    // We wait for tree-sitter diff to know WHICH functions changed.
    // Notification is sent after performLocalUpdate() completes.

    // Clear existing timeout for this file
    clearPendingChange(filePath);

    // Use shorter debounce for file creation (fast feedback for AI scaffolding)
    const debounceMs = source === 'create' ? 100 : config.debounceMs;

    // Schedule new analysis after debounce period
    const timeout = setTimeout(async () => {
        deletePendingChange(filePath);
        log(`File changed (${source}): ${filePath}`);

        // Try instant local update first (handles both cached and new LLM files)
        const localResult = await performLocalUpdate({ cache, log }, uri);

        if (localResult) {
            // Local update succeeded
            if (localResult.nodesAdded.length > 0 || localResult.nodesRemoved.length > 0 ||
                localResult.edgesAdded > 0 || localResult.edgesRemoved > 0) {
                const relativePath = vscode.workspace.asRelativePath(filePath);

                // Update graph in webview (with HTTP edges)
                // Pass pending node IDs and file change info (applied after graph renders)
                const fileChange = localResult.changedFunctions.length > 0
                    ? { filePath: relativePath, functions: localResult.changedFunctions }
                    : undefined;
                webview.updateGraph(withHttpEdges(localResult.graph, log)!, localResult.needsMetadata, fileChange);
                log(`Graph updated locally (instant) via tree-sitter`);

                // Queue for metadata if new nodes need labels
                if (localResult.needsMetadata.length > 0) {
                    const newCallGraph = getCachedCallGraph(filePath);
                    const context = buildMetadataContext(relativePath, cache, newCallGraph);
                    if (context) {
                        metadataBatcher.queueFile(relativePath, context);
                        log(`Queued ${relativePath} for metadata batch (${context.functions.length} functions)`);
                    }
                }

                // === Live file indicator: Set timer to transition from active → changed ===
                if (localResult.changedFunctions.length > 0) {
                    // Clear existing transition timer
                    clearActivelyEditing(filePath);

                    // Set timer to transition to "changed" state after inactivity
                    const transitionTimer = setTimeout(() => {
                        clearActivelyEditing(filePath);
                        setChangedFunctions(filePath, localResult.changedFunctions);
                        webview.notifyFileStateChange([{
                            filePath: relativePath,
                            functions: localResult.changedFunctions,
                            state: 'changed'
                        }]);
                    }, config.activeToChangedMs);

                    setActivelyEditing(filePath, {
                        timer: transitionTimer,
                        functions: localResult.changedFunctions
                    });
                }
            } else {
                // No structural changes - clear any existing indicators
                clearActivelyEditing(filePath);
                clearChangedFunctions(filePath);
                const relativePath = vscode.workspace.asRelativePath(filePath);
                webview.notifyFileStateChange([{ filePath: relativePath, state: 'unchanged' }]);
            }
        } else {
            // Local update returned null - check if file was previously analyzed
            const isCached = await cache.isFileCached(filePath);
            if (isCached) {
                // File was analyzed before - fall back to LLM analysis
                log(`Falling back to full analysis: ${filePath}`);
                webview.showLoading('Detecting changes...');
                await fallbackAnalyze(uri);

                // Clear file change indicator after LLM analysis
                clearChangedFunctions(filePath);
                const relativePath = vscode.workspace.asRelativePath(filePath);
                webview.notifyFileStateChange([{ filePath: relativePath, state: 'unchanged' }]);
            }
            // If not cached, ignore - not an LLM file worth tracking
        }
    }, debounceMs);

    setPendingChange(filePath, timeout);
}
