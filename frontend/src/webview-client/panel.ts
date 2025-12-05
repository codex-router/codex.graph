// Side panel for node details
import * as state from './state';

declare const d3: any;

export function openPanel(nodeData: any): void {
    const { vscode, currentGraphData, workflowGroups } = state;

    const panel = document.getElementById('sidePanel');
    const title = document.getElementById('panelTitle');
    const type = document.getElementById('panelType');
    const descriptionSection = document.getElementById('descriptionSection');
    const description = document.getElementById('panelDescription');
    const sourceSection = document.getElementById('sourceSection');
    const source = document.getElementById('panelSource');
    const incomingSection = document.getElementById('incomingSection');
    const incoming = document.getElementById('panelIncoming');
    const outgoingSection = document.getElementById('outgoingSection');
    const outgoing = document.getElementById('panelOutgoing');

    if (!panel || !title || !type || !sourceSection || !source || !descriptionSection || !description || !incomingSection || !incoming || !outgoingSection || !outgoing) {
        return;
    }

    title.textContent = nodeData.label;

    // Set workflow name
    const workflowEl = document.getElementById('panelWorkflow');
    if (workflowEl) {
        const workflow = workflowGroups?.find(
            (g: any) => g.nodes.includes(nodeData.id)
        );
        if (workflow) {
            workflowEl.textContent = workflow.name;
            workflowEl.style.display = 'block';
        } else {
            workflowEl.style.display = 'none';
        }
    }

    type.textContent = nodeData.type;
    type.className = `type-badge ${nodeData.type}`;

    if (nodeData.description) {
        description.textContent = nodeData.description;
        descriptionSection.style.display = 'block';
    } else {
        descriptionSection.style.display = 'none';
    }

    if (nodeData.source) {
        const fileName = nodeData.source.file.split('/').pop();
        const funcName = nodeData.source.function.endsWith('()') ? nodeData.source.function : `${nodeData.source.function}()`;
        source.textContent = `${funcName} in ${fileName}:${nodeData.source.line}`;
        (source as HTMLAnchorElement).onclick = (e: Event) => {
            e.preventDefault();
            vscode.postMessage({
                command: 'openFile',
                file: nodeData.source.file,
                line: nodeData.source.line
            });
        };
        sourceSection.style.display = 'block';
    } else {
        sourceSection.style.display = 'none';
    }

    // Find incoming edges
    const incomingEdges = currentGraphData.edges.filter((e: any) => {
        if (e.target !== nodeData.id) return false;
        return currentGraphData.nodes.some((n: any) => n.id === e.source);
    });

    if (incomingEdges.length > 0) {
        incoming.innerHTML = incomingEdges.map((edge: any) => {
            const sourceNode = currentGraphData.nodes.find((n: any) => n.id === edge.source);
            return `<div style="margin: 8px 0; padding: 8px; background: var(--vscode-input-background); border-radius: 4px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    ${edge.sourceLocation ? `<a href="#" class="source-link incoming-data-link" data-file="${edge.sourceLocation.file}" data-line="${edge.sourceLocation.line}"><strong>${edge.label}</strong></a>` : `<strong>${edge.label}</strong>`}
                    ${edge.dataType ? `<span style="font-size: 10px; padding: 2px 6px; background: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-editor-foreground)); color: var(--vscode-editor-foreground); border-radius: 3px;">${edge.dataType}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">From: ${sourceNode ? sourceNode.label : edge.source}</div>
                ${edge.description ? `<div style="font-size: 11px; margin-top: 4px; font-style: italic;">${edge.description}</div>` : ''}
            </div>`;
        }).join('');

        // Add event listeners
        incoming.querySelectorAll('.incoming-data-link').forEach((link, index) => {
            const edge = incomingEdges[index];
            (link as HTMLAnchorElement).onclick = (e) => {
                e.preventDefault();
                if (edge.sourceLocation) {
                    vscode.postMessage({
                        command: 'openFile',
                        file: edge.sourceLocation.file,
                        line: edge.sourceLocation.line
                    });
                }
            };
        });

        incomingSection.style.display = 'block';
    } else {
        incomingSection.style.display = 'none';
    }

    // Find outgoing edges
    const outgoingEdges = currentGraphData.edges.filter((e: any) => {
        if (e.source !== nodeData.id) return false;
        return currentGraphData.nodes.some((n: any) => n.id === e.target);
    });

    if (outgoingEdges.length > 0) {
        outgoing.innerHTML = outgoingEdges.map((edge: any) => {
            const targetNode = currentGraphData.nodes.find((n: any) => n.id === edge.target);
            return `<div style="margin: 8px 0; padding: 8px; background: var(--vscode-input-background); border-radius: 4px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    ${edge.sourceLocation ? `<a href="#" class="source-link outgoing-data-link" data-file="${edge.sourceLocation.file}" data-line="${edge.sourceLocation.line}"><strong>${edge.label}</strong></a>` : `<strong>${edge.label}</strong>`}
                    ${edge.dataType ? `<span style="font-size: 10px; padding: 2px 6px; background: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-editor-foreground)); color: var(--vscode-editor-foreground); border-radius: 3px;">${edge.dataType}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">To: ${targetNode ? targetNode.label : edge.target}</div>
                ${edge.description ? `<div style="font-size: 11px; margin-top: 4px; font-style: italic;">${edge.description}</div>` : ''}
            </div>`;
        }).join('');

        // Add event listeners
        outgoing.querySelectorAll('.outgoing-data-link').forEach((link, index) => {
            const edge = outgoingEdges[index];
            (link as HTMLAnchorElement).onclick = (e) => {
                e.preventDefault();
                if (edge.sourceLocation) {
                    vscode.postMessage({
                        command: 'openFile',
                        file: edge.sourceLocation.file,
                        line: edge.sourceLocation.line
                    });
                }
            };
        });

        outgoingSection.style.display = 'block';
    } else {
        outgoingSection.style.display = 'none';
    }

    panel.classList.add('open');

    // Track currently open node
    state.setCurrentlyOpenNodeId(nodeData.id);

    // Notify extension
    vscode.postMessage({
        command: 'nodeSelected',
        nodeId: nodeData.id,
        nodeLabel: nodeData.label,
        nodeType: nodeData.type
    });

    // Show selection indicator
    d3.selectAll('.node-selection-indicator').style('display', 'none');
    d3.select(`.node-selection-indicator[data-node-id="${nodeData.id}"]`).style('display', 'block');
}

export function closePanel(): void {
    const { vscode } = state;
    const panel = document.getElementById('sidePanel');
    if (panel) panel.classList.remove('open');

    state.setCurrentlyOpenNodeId(null);

    vscode.postMessage({ command: 'nodeDeselected' });

    d3.selectAll('.node-selection-indicator').style('display', 'none');
}

export function setupClosePanel(): void {
    document.getElementById('btn-close-panel')?.addEventListener('click', closePanel);
}
