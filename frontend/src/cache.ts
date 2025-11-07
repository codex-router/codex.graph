import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WorkflowGraph } from './api';

interface CacheEntry {
    hash: string;
    graph: WorkflowGraph;
    timestamp: number;
}

export class CacheManager {
    private static readonly CACHE_KEY = 'aiworkflowviz.cache';

    constructor(private context: vscode.ExtensionContext) {}

    private getCache(): Record<string, CacheEntry> {
        return this.context.globalState.get(CacheManager.CACHE_KEY, {});
    }

    private async setCache(cache: Record<string, CacheEntry>) {
        await this.context.globalState.update(CacheManager.CACHE_KEY, cache);
    }

    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    // Create a cache key from multiple file paths and contents
    private createWorkspaceCacheKey(filePaths: string[], contents: string[]): string {
        // Sort by path to ensure consistent ordering
        const sorted = filePaths
            .map((path, i) => ({ path, content: contents[i] }))
            .sort((a, b) => a.path.localeCompare(b.path));

        // Combine all paths and hashes
        const combined = sorted
            .map(f => `${f.path}:${this.hashContent(f.content)}`)
            .join('|');

        return this.hashContent(combined);
    }

    // Get cache for single file
    async get(filePath: string, content: string): Promise<WorkflowGraph | null> {
        return this.getMultiple([filePath], [content]);
    }

    // Get cache for multiple files (workspace)
    async getMultiple(filePaths: string[], contents: string[]): Promise<WorkflowGraph | null> {
        const cache = this.getCache();
        const cacheKey = this.createWorkspaceCacheKey(filePaths, contents);
        const entry = cache[cacheKey];

        if (!entry) return null;

        return entry.graph;
    }

    // Set cache for single file
    async set(filePath: string, content: string, graph: WorkflowGraph) {
        await this.setMultiple([filePath], [content], graph);
    }

    // Set cache for multiple files (workspace)
    async setMultiple(filePaths: string[], contents: string[], graph: WorkflowGraph) {
        const cache = this.getCache();
        const cacheKey = this.createWorkspaceCacheKey(filePaths, contents);
        cache[cacheKey] = {
            hash: cacheKey,
            graph,
            timestamp: Date.now()
        };
        await this.setCache(cache);
    }

    async clear() {
        await this.setCache({});
    }
}
