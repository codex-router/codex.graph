// Edge rendering and hover effects
import * as state from './state';
import { generateEdgePath, getNodeOrCollapsedGroup } from './utils';
import {
    NODE_WIDTH, NODE_HEIGHT,
    EDGE_STROKE_WIDTH, EDGE_HOVER_STROKE_WIDTH, EDGE_HOVER_HIT_WIDTH,
    EDGE_COLOR_HOVER, CRITICAL_PATH_COLOR, CRITICAL_PATH_COLOR_HOVER
} from './constants';
import { getWorkflowNodeIds, getNodeDimensions, findReverseEdge, getBidirectionalEdgeKey, positionTooltipNearMouse } from './helpers';

declare const d3: any;

export function renderEdges(): void {
    const { g, currentGraphData, workflowGroups } = state;

    // Filter nodes to only render those in workflow groups WITH 3+ NODES
    const allWorkflowNodeIds = getWorkflowNodeIds(workflowGroups);

    // Filter edges to only those where BOTH nodes are rendered
    const allEdges = currentGraphData.edges.filter((e: any) =>
        allWorkflowNodeIds.has(e.source) && allWorkflowNodeIds.has(e.target)
    );

    // Track which bidirectional pairs we've already processed
    const processedBidirectional = new Set<string>();

    // Separate unidirectional and bidirectional edges
    const edgesToRender: any[] = [];
    allEdges.forEach((edge: any) => {
        const reverseEdge = findReverseEdge(edge, allEdges);
        if (reverseEdge) {
            // Bidirectional - only render once per pair
            const key = getBidirectionalEdgeKey(edge);
            if (!processedBidirectional.has(key)) {
                processedBidirectional.add(key);
                // Mark as bidirectional and store reverse edge data
                edgesToRender.push({
                    ...edge,
                    isBidirectional: true,
                    reverseEdge: reverseEdge
                });
            }
        } else {
            // Unidirectional
            edgesToRender.push({ ...edge, isBidirectional: false });
        }
    });

    // Create container for edge paths
    const edgePathsContainer = g.append('g').attr('class', 'edge-paths-container');
    state.setEdgePathsContainer(edgePathsContainer);

    // Create edge path groups
    const linkGroup = edgePathsContainer
        .selectAll('g')
        .data(edgesToRender)
        .enter()
        .append('g')
        .attr('class', (d: any) => d.isBidirectional ? 'link-group bidirectional' : 'link-group')
        .attr('data-edge-key', (d: any) => d.isBidirectional
            ? getBidirectionalEdgeKey(d)
            : `${d.source}->${d.target}`);

    const link = linkGroup.append('path')
        .attr('class', (d: any) => d.isCriticalPath ? 'link critical-path' : 'link')
        .style('stroke-width', `${EDGE_STROKE_WIDTH}px`)
        .style('pointer-events', 'none')
        .attr('marker-end', (d: any) => d.isCriticalPath ? 'url(#arrowhead-critical)' : 'url(#arrowhead)')
        .attr('marker-start', (d: any) => d.isBidirectional ? 'url(#arrowhead-start)' : null);

    // Add invisible wider path for easier hovering
    const linkHover = linkGroup.insert('path', '.link')
        .attr('class', 'link-hover')
        .style('stroke', 'transparent')
        .style('stroke-width', `${EDGE_HOVER_HIT_WIDTH}px`)
        .style('fill', 'none')
        .style('cursor', 'pointer')
        .on('mouseenter', function(event: any, d: any) {
            // Highlight edge path
            const index = edgesToRender.indexOf(d);
            const linkElement = d3.select(edgePathsContainer.node().children[index]).select('.link');

            if (d.isCriticalPath) {
                linkElement.style('stroke', CRITICAL_PATH_COLOR_HOVER).style('stroke-width', `${EDGE_HOVER_STROKE_WIDTH}px`);
            } else {
                linkElement.style('stroke', EDGE_COLOR_HOVER).style('stroke-width', `${EDGE_HOVER_STROKE_WIDTH}px`);
            }

            // Show tooltip
            showEdgeTooltip(d, event);
        })
        .on('mousemove', function(event: any, d: any) {
            // Update tooltip position as mouse moves
            updateTooltipPosition(event);
        })
        .on('mouseleave', function(event: any, d: any) {
            // Reset edge path
            const index = edgesToRender.indexOf(d);
            const linkElement = d3.select(edgePathsContainer.node().children[index]).select('.link');

            if (d.isCriticalPath) {
                linkElement.style('stroke', CRITICAL_PATH_COLOR).style('stroke-width', `${EDGE_STROKE_WIDTH}px`);
            } else {
                linkElement.style('stroke', null).style('stroke-width', null);
            }

            // Hide tooltip
            const tooltip = document.getElementById('edgeTooltip');
            if (tooltip) tooltip.style.display = 'none';
        })
        .on('click', function(event: any, d: any) {
            event.stopPropagation();
            if (d.sourceLocation) {
                state.vscode.postMessage({
                    command: 'openFile',
                    file: d.sourceLocation.file,
                    line: d.sourceLocation.line
                });
            }
        });

    // Set initial edge paths
    link.attr('d', (d: any) => {
        const sourceNode = currentGraphData.nodes.find((n: any) => n.id === d.source);
        const targetNode = currentGraphData.nodes.find((n: any) => n.id === d.target);
        return generateEdgePath(d, sourceNode, targetNode, workflowGroups, NODE_WIDTH, NODE_HEIGHT, NODE_WIDTH, NODE_HEIGHT, currentGraphData.edges);
    });

    linkHover.attr('d', (d: any) => {
        const sourceNode = currentGraphData.nodes.find((n: any) => n.id === d.source);
        const targetNode = currentGraphData.nodes.find((n: any) => n.id === d.target);
        return generateEdgePath(d, sourceNode, targetNode, workflowGroups, NODE_WIDTH, NODE_HEIGHT, NODE_WIDTH, NODE_HEIGHT, currentGraphData.edges);
    });

    state.setLinkSelections(link, linkHover, linkGroup);
}

function showEdgeTooltip(d: any, event: any): void {
    const tooltip = document.getElementById('edgeTooltip');
    if (!tooltip) return;

    const { currentGraphData } = state;

    // Helper to get node label from ID
    const getNodeLabel = (nodeId: string): string => {
        const node = currentGraphData.nodes.find((n: any) => n.id === nodeId);
        return node?.label || nodeId;
    };

    if (d.isBidirectional && d.reverseEdge) {
        // Bidirectional edge - show both directions
        const sourceLabel = getNodeLabel(d.source);
        const targetLabel = getNodeLabel(d.target);
        const forwardHtml = formatEdgeInfo(d, `${sourceLabel} → ${targetLabel}`);
        const reverseHtml = formatEdgeInfo(d.reverseEdge, `${targetLabel} → ${sourceLabel}`);

        tooltip.innerHTML = `
            <div class="bidirectional-tooltip">
                <div class="edge-direction">${forwardHtml}</div>
                <hr style="border: none; border-top: 1px solid var(--vscode-editorWidget-border); margin: 8px 0;">
                <div class="edge-direction">${reverseHtml}</div>
            </div>
        `;
    } else {
        // Unidirectional edge
        tooltip.innerHTML = formatEdgeInfo(d);
    }

    tooltip.style.display = 'block';
    updateTooltipPosition(event);
}

function formatEdgeInfo(edge: any, header?: string): string {
    let html = '<div style="position: relative;">';
    if (edge.isCriticalPath) {
        html += `<span style="position: absolute; top: 0; right: 0; background: ${CRITICAL_PATH_COLOR}; color: white; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 3px;">HOT PATH</span>`;
    }
    if (header) {
        html += `<div style="font-weight: 600; margin-bottom: 4px; color: var(--vscode-textLink-foreground);">${header}</div>`;
    }
    html += `<div><strong>Variable:</strong> ${edge.label || 'N/A'}</div>`;
    if (edge.dataType) html += `<div><strong>Type:</strong> ${edge.dataType}</div>`;
    if (edge.description) html += `<div><strong>Description:</strong> ${edge.description}</div>`;
    if (edge.sourceLocation) {
        html += `<div><strong>Location:</strong> ${edge.sourceLocation.file.split('/').pop()}:${edge.sourceLocation.line}</div>`;
    }
    html += '</div>';
    return html;
}

function updateTooltipPosition(event: any): void {
    const tooltip = document.getElementById('edgeTooltip');
    if (!tooltip) return;

    const mouseX = event.clientX || event.pageX;
    const mouseY = event.clientY || event.pageY;
    positionTooltipNearMouse(tooltip, mouseX, mouseY);
}

export function updateEdgePaths(): void {
    const { link, linkHover, currentGraphData, workflowGroups } = state;

    const getNode = (nodeId: string) => getNodeOrCollapsedGroup(nodeId, currentGraphData.nodes, workflowGroups);

    link.attr('d', function(l: any) {
        const sourceNode = getNode(l.source);
        const targetNode = getNode(l.target);
        const { width: targetWidth, height: targetHeight } = getNodeDimensions(targetNode);
        const { width: sourceWidth, height: sourceHeight } = getNodeDimensions(sourceNode);
        return generateEdgePath(l, sourceNode, targetNode, workflowGroups, targetWidth, targetHeight, sourceWidth, sourceHeight, currentGraphData.edges);
    });

    linkHover.attr('d', function(l: any) {
        const sourceNode = getNode(l.source);
        const targetNode = getNode(l.target);
        const { width: targetWidth, height: targetHeight } = getNodeDimensions(targetNode);
        const { width: sourceWidth, height: sourceHeight } = getNodeDimensions(sourceNode);
        return generateEdgePath(l, sourceNode, targetNode, workflowGroups, targetWidth, targetHeight, sourceWidth, sourceHeight, currentGraphData.edges);
    });
}
