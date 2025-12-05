// Node rendering
import * as state from './state';
import { getNodeIcon } from './icons';
import { TYPE_COLORS, NODE_WIDTH, NODE_HEIGHT, NODE_HALF_WIDTH, NODE_HALF_HEIGHT, NODE_BORDER_RADIUS, NODE_ICON_SCALE } from './constants';
import { getWorkflowNodeIds } from './helpers';

declare const d3: any;

export function renderNodes(
    dragstarted: (event: any, d: any) => void,
    dragged: (event: any, d: any) => void,
    dragended: (event: any, d: any) => void
): void {
    const { g, currentGraphData, workflowGroups } = state;

    // Filter nodes to only render those in workflow groups WITH 3+ NODES
    const allWorkflowNodeIds = getWorkflowNodeIds(workflowGroups);
    const nodesToRender = currentGraphData.nodes.filter((n: any) => allWorkflowNodeIds.has(n.id));

    // Create nodes
    const node = g.append('g')
        .attr('class', 'nodes-container')
        .selectAll('g')
        .data(nodesToRender)
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-node-id', (d: any) => d.id)
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    // Add full background fill
    node.append('rect')
        .attr('width', NODE_WIDTH)
        .attr('height', NODE_HEIGHT)
        .attr('x', -NODE_HALF_WIDTH)
        .attr('y', -NODE_HALF_HEIGHT)
        .attr('rx', NODE_BORDER_RADIUS)
        .style('fill', 'var(--vscode-editor-background)')
        .style('stroke', 'none');

    // Add dark header background (top 30px, rounded top corners)
    node.append('path')
        .attr('class', 'node-header')
        .attr('d', 'M -66,-61 L 66,-61 A 4,4 0 0,1 70,-57 L 70,-31 L -70,-31 L -70,-57 A 4,4 0 0,1 -66,-61 Z')
        .style('fill', 'var(--vscode-editor-background)')
        .style('stroke', 'none');

    // Add grey body background (bottom 92px, rounded bottom corners)
    node.append('path')
        .attr('class', 'node-body')
        .attr('d', 'M -70,-31 L 70,-31 L 70,57 A 4,4 0 0,1 66,61 L -66,61 A 4,4 0 0,1 -70,57 Z')
        .style('fill', 'color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editor-foreground))')
        .style('stroke', 'none');

    // Add type-colored border
    node.append('rect')
        .attr('class', 'node-border')
        .attr('width', NODE_WIDTH)
        .attr('height', NODE_HEIGHT)
        .attr('x', -NODE_HALF_WIDTH)
        .attr('y', -NODE_HALF_HEIGHT)
        .attr('rx', NODE_BORDER_RADIUS)
        .style('fill', 'none')
        .style('stroke', (d: any) => TYPE_COLORS[d.type] || '#90A4AE')
        .style('stroke-width', '2px')
        .style('pointer-events', 'all');

    // Add title centered in body with text wrapping
    // Body spans from y=-31 (header bottom) to y=+61 (node bottom) = 92px
    // 5px padding matches horizontal, -1px shift up for visual alignment
    node.append('foreignObject')
        .attr('x', -65)
        .attr('y', -27)
        .attr('width', 130)
        .attr('height', 83)
        .append('xhtml:div')
        .attr('class', 'node-title-wrapper')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('text-align', 'center')
        .style('color', 'var(--vscode-editor-foreground)')
        .style('font-family', '"DM Sans", "Inter", "Segoe UI", -apple-system, sans-serif')
        .style('font-size', '17px')
        .style('font-weight', '400')
        .style('letter-spacing', '-0.01em')
        .style('line-height', '1.35')
        .style('overflow', 'hidden')
        .style('word-wrap', 'break-word')
        .text((d: any) => d.label);

    // Add icon at top-left of header (centered vertically with type label)
    node.append('g')
        .attr('class', (d: any) => `node-icon ${d.type}`)
        .attr('transform', `translate(-62, -55) scale(${NODE_ICON_SCALE})`)
        .html((d: any) => getNodeIcon(d.type));

    // Add node type label next to icon in header
    node.append('text')
        .attr('class', 'node-type')
        .text((d: any) => d.type.toUpperCase())
        .attr('x', -38)
        .attr('y', -43)
        .attr('dominant-baseline', 'middle')
        .style('text-anchor', 'start');

    // Add entry icon (top-right, green door with arrow in)
    node.filter((d: any) => d.isEntryPoint)
        .append('g')
        .attr('class', 'entry-icon')
        .attr('transform', 'translate(52, -52) scale(0.7)')
        .html('<svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" stroke="#4CAF50" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');

    // Add exit icon (top-right, red door with arrow out)
    node.filter((d: any) => d.isExitPoint)
        .append('g')
        .attr('class', 'exit-icon')
        .attr('transform', (d: any) => d.isEntryPoint ? 'translate(32, -52) scale(0.7)' : 'translate(52, -52) scale(0.7)')
        .html('<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="#f44336" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');

    // Add selection indicator (camera corners)
    const cornerSize = 8;
    const cornerOffsetX = 78;
    const cornerOffsetY = 69;
    node.append('g')
        .attr('class', 'node-selection-indicator')
        .attr('data-node-id', (d: any) => d.id)
        .style('display', 'none')
        .each(function(this: SVGGElement) {
            const group = d3.select(this);
            group.append('path').attr('d', `M -${cornerOffsetX} -${cornerOffsetY - cornerSize} L -${cornerOffsetX} -${cornerOffsetY} L -${cornerOffsetX - cornerSize} -${cornerOffsetY}`);
            group.append('path').attr('d', `M ${cornerOffsetX - cornerSize} -${cornerOffsetY} L ${cornerOffsetX} -${cornerOffsetY} L ${cornerOffsetX} -${cornerOffsetY - cornerSize}`);
            group.append('path').attr('d', `M -${cornerOffsetX} ${cornerOffsetY - cornerSize} L -${cornerOffsetX} ${cornerOffsetY} L -${cornerOffsetX - cornerSize} ${cornerOffsetY}`);
            group.append('path').attr('d', `M ${cornerOffsetX - cornerSize} ${cornerOffsetY} L ${cornerOffsetX} ${cornerOffsetY} L ${cornerOffsetX} ${cornerOffsetY - cornerSize}`);
        });

    // Tooltip on hover
    node.append('title')
        .text((d: any) => {
            let text = `${d.label}\nType: ${d.type}`;
            if (d.description) {
                text += `\n\n${d.description}`;
            }
            return text;
        });

    // Set initial positions
    node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

    state.setNode(node);
}
