// Main entry point for webview client
import './types';
import * as state from './state';
import { setupSVG } from './setup';
import { layoutWorkflows } from './layout';
import { renderGroups, renderCollapsedGroups } from './groups';
import { renderEdges } from './edges';
import { renderNodes } from './nodes';
import { dragstarted, dragged, dragended } from './drag';
import { setupControls, fitToScreen, formatGraph } from './controls';
import { renderMinimap, setupMinimapZoomListener } from './minimap';
import { setupClosePanel, closePanel } from './panel';
import { setupMessageHandler } from './messages';
import { updateGroupVisibility } from './visibility';
import { ensureVisualCues, detectWorkflowGroups, updateSnapshotStats } from './workflow-detection';
import { setupDirectory } from './directory';

declare const d3: any;
declare function acquireVsCodeApi(): any;

// Initialize on load
(function init() {
    // Get VSCode API
    const vscode = acquireVsCodeApi();

    // Get graph data from window
    const graphData = (window as any).__GRAPH_DATA__;

    if (!graphData) {
        console.error('No graph data found');
        return;
    }

    // Ensure visual cues (entry/exit points, critical path)
    ensureVisualCues(graphData);

    // Detect workflow groups
    const groups = detectWorkflowGroups(graphData);

    // Setup SVG
    const { svg, g, zoom, defs } = setupSVG();

    // Initialize state
    state.initState(vscode, svg, g, zoom);
    state.setGraphData(graphData);
    state.setWorkflowGroups(groups);

    // Layout workflows using Dagre
    layoutWorkflows(defs);

    // Render groups (before edges/nodes for z-index)
    renderGroups(updateGroupVisibility);

    // Render edges
    renderEdges();

    // Render nodes
    renderNodes(dragstarted, dragged, dragended);

    // Render collapsed groups (after edges/nodes for z-index)
    renderCollapsedGroups(updateGroupVisibility);

    // Setup controls (zoom, expand/collapse, format, refresh)
    setupControls(updateGroupVisibility);
    setupClosePanel();
    setupDirectory();

    // Setup message handler
    setupMessageHandler();

    // Setup minimap zoom listener
    setupMinimapZoomListener();

    // Close panel when clicking on SVG background
    svg.on('click', function(event: any) {
        const target = event.target;
        if (target.tagName === 'svg' || (target.tagName === 'rect' && target.classList.contains('pegboard-bg'))) {
            closePanel();
        }
    });

    // Initial view - fit entire graph to screen
    setTimeout(() => {
        // Reset layout to clean Dagre positions
        formatGraph(updateGroupVisibility);
        renderMinimap();
        fitToScreen();
        // Apply initial group collapse states (also populates directory)
        updateGroupVisibility();
        // Update header stats
        updateSnapshotStats(state.workflowGroups, state.currentGraphData);
    }, 100);

    // Re-render minimap on window resize (debounced)
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderMinimap();
        }, 150);
    });
})();
