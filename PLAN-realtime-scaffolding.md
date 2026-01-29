# Real-Time Scaffolding Feature Plan

## Goal
Make Codag the visual component of vibecoding - instant graph updates as AI agents scaffold/modify code.

## Current State Analysis (2024-01)

### What Already Exists

| Component | File | Status |
|-----------|------|--------|
| Graph builder from call graph | `local-graph-updater.ts` → `createGraphFromCallGraph()` | ✅ Built, **unused** |
| Call graph extraction | `call-graph-extractor.ts` | ✅ Works (acorn/ts-estree) |
| Call graph diffing | `call-graph-extractor.ts` → `diffCallGraphs()` | ✅ Works |
| Local update application | `local-graph-updater.ts` → `applyLocalUpdate()` | ✅ Works |
| Metadata batcher | `metadata-batcher.ts` | ✅ Built, partially wired |
| Live file CSS (active/changed) | `styles.css:1480-1517` | ✅ Works |
| Local update orchestration | `local-update.ts` → `performLocalUpdate()` | ✅ Built, **gated** |
| File watcher + debouncing | `handler.ts` | ✅ Works |

### What's Broken

1. **`isCached` gate** (`handler.ts:75-76`)
   - New files blocked entirely
   - Files not selected for analysis blocked

2. **Call graphs not populated during initial analysis**
   - `setCachedCallGraph()` only called in `local-update.ts`
   - First edit after analysis has no "old" state to diff against

3. **Call graphs not persisted**
   - In-memory Map in `state.ts`
   - Lost on VSCode reload
   - Breaks live updates until file is edited twice

4. **`createGraphFromCallGraph()` never called**
   - Function exists but isn't wired up
   - Could create instant graphs for new files

5. **No pending visual state**
   - CSS doesn't exist for nodes awaiting LLM metadata

## Architecture: Current vs Desired

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│  File Change → handler.ts → isCached? ──NO──> BLOCKED           │
│                               │                                  │
│                              YES                                 │
│                               ↓                                  │
│                    getCachedCallGraph() ──NULL──> store & exit   │
│                               │                                  │
│                            EXISTS                                │
│                               ↓                                  │
│                         diffCallGraphs()                         │
│                               ↓                                  │
│                      applyLocalUpdate()                          │
│                               ↓                                  │
│                        updateGraph()                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     DESIRED FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│  File Change → handler.ts → isLLMFile? ──NO──> ignore            │
│                               │                                  │
│                              YES                                 │
│                               ↓                                  │
│                    getCachedCallGraph() ──NULL──┐                │
│                               │                  ↓               │
│                            EXISTS    createGraphFromCallGraph()  │
│                               ↓                  ↓               │
│                         diffCallGraphs()    show "pending" nodes │
│                               ↓                  ↓               │
│                      applyLocalUpdate()   queue for LLM metadata │
│                               ↓                  │               │
│                        updateGraph() ←───────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 0: Fix Call Graph Population (get live updates working) ✅
**Goal:** Make first edit after analysis trigger live updates

- [x] **0.1** Add call graph extraction during initial LLM analysis
  - `workspace.ts`: After `cache.setAnalysisResult()`, extract and cache call graph
  - `single-file.ts`: Same
  - `selected-files.ts`: Same

- [x] **0.2** Persist call graphs in cache
  - Added serialization/deserialization in `analysis/state.ts`
  - Save to globalState with debounced writes
  - Load on extension activation via `initCallGraphPersistence()`

- [ ] **0.3** Verify flow works
  - Run analysis → edit file → see live update on first edit

### Phase 1: Remove Gates for New Files ✅
**Goal:** Instant visualization when AI agents create new LLM files

- [x] **1.1** Replace `isCached` check with `isLLMFile()` detection
  - Removed gate in `handler.ts`
  - Now tries local update first for ALL files
  - Falls back to LLM only if file was previously cached

- [x] **1.2** Handle new LLM files
  - `local-update.ts` now uses `createGraphFromCallGraph()` for new LLM files
  - Build initial graph with function names as labels
  - Returns `needsMetadata` list for pending nodes

- [x] **1.3** Wire up MetadataBatcher
  - Already wired in `handler.ts`
  - Queue new files for LLM label fetching
  - Update node labels when metadata arrives
  - Remove "pending" state (Phase 2 for visual)

### Phase 2: Pending Visual State ✅
**Goal:** Clear visual distinction for nodes awaiting LLM metadata

- [x] **2.1** Add CSS for pending nodes
  - Added `.node-border.pending` with dashed border and reduced opacity
  - Added `.node.pending .node-title-wrapper span` for italic text
  - Added `.minimap-node.pending` for minimap

- [x] **2.2** Track pending state in webview
  - Added `pendingNodes: Set<string>` in messages.ts
  - `markNodesPending()` and `clearNodesPending()` in nodes.ts
  - `updateGraph` now accepts optional `pendingNodeIds` parameter
  - handler.ts passes `needsMetadata` to webview

- [x] **2.3** Clear pending on metadata arrival
  - `hydrateLabels` handler clears pending state before updating labels
  - Nodes transition smoothly from dashed to solid border

### Phase 3: Cross-File Edge Detection ✅
**Goal:** Show connections between files without LLM

- [x] **3.1** Use `extractFileStructure()` for imports/exports
  - `local-update.ts` now extracts file structure on every change
  - Resolves imports against known repo files
  - Updates `crossFileCalls` and `repoFiles` in state

- [x] **3.2** Create edges from import analysis
  - `updateCrossFileState()` resolves `module.function` calls to target files
  - `withHttpEdges()` (already called in handler.ts) picks up new cross-file edges
  - Both modified files and new files update cross-file state

### Phase 4: Polish & Performance ✅
**Goal:** Snappy UX for rapid file creation

- [x] **4.1** Differentiated debouncing
  - File creation: 100ms (fast feedback for AI scaffolding)
  - File modification: 2000ms (existing behavior)

- [x] **4.2** Batch rapid creates
  - Already handled by MetadataBatcher (3s aggregation window)

- [x] **4.3** Animate new nodes
  - Fade-in animation (400ms opacity transition) via `fadeInNodes()`
  - Replaces old pulse animation for cleaner entry effect

## Node ID Format

Consistent across frontend and backend:
```
{relative_path}::{function_name}
```

Examples:
- `backend/client.py::analyze_workflow`
- `src/api.ts::fetchData`

## Visual States

| State | CSS Class | Border | Opacity | Meaning |
|-------|-----------|--------|---------|---------|
| Normal | (none) | default | 1.0 | Fully hydrated with LLM metadata |
| Pending | `.pending` | dashed gray | 0.7 | Awaiting LLM metadata |
| Changed | `.file-changed` | solid green | 1.0 | Recently modified, not actively editing |
| Active | `.file-active` | animated neon green | 1.0 | Currently being edited |

## Files to Modify

### Phase 0
- `frontend/src/analysis/workspace.ts` - add call graph extraction
- `frontend/src/analysis/single-file.ts` - add call graph extraction
- `frontend/src/analysis/selected-files.ts` - add call graph extraction
- `frontend/src/cache.ts` - persist call graphs

### Phase 1
- `frontend/src/file-watching/handler.ts` - replace isCached gate
- `frontend/src/file-watching/local-update.ts` - use createGraphFromCallGraph
- `frontend/src/extension.ts` - wire up MetadataBatcher callbacks

### Phase 2
- `frontend/media/webview/styles.css` - pending CSS
- `frontend/src/webview-client/nodes.ts` - pending class application
- `frontend/src/webview-client/messages.ts` - handle labelUpdate

### Phase 3
- `frontend/src/file-watching/local-update.ts` - cross-file edge creation
- `frontend/src/repo-structure.ts` - expose import/export matching

## Testing Scenarios

1. **Fresh start**: Open workspace → Analyze → Edit file → See live update (first edit)
2. **Reload test**: Reload VSCode → Edit analyzed file → See live update (first edit)
3. **New file**: AI creates new file with LLM imports → Instant nodes appear
4. **Rapid creates**: AI creates 5 files in 2 seconds → All appear, single metadata batch
5. **Cross-file**: Edit file A that calls file B → Edge updates correctly
