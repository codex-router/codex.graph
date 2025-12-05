// Workflow directory panel
import * as state from './state';
import { TRANSITION_NORMAL } from './constants';
import { updateGroupVisibility } from './visibility';

declare const d3: any;

export function setupDirectory(): void {
    const directory = document.getElementById('workflowDirectory');
    const header = directory?.querySelector('.directory-header');
    const toggleBtn = document.getElementById('btn-toggle-directory');
    const listEl = document.getElementById('directoryList');

    // Toggle collapse on header click
    header?.addEventListener('click', () => {
        directory?.classList.toggle('collapsed');
    });

    // Also toggle on button click (same behavior)
    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        directory?.classList.toggle('collapsed');
    });

    // Setup scroll indicators
    if (listEl) {
        listEl.addEventListener('scroll', updateScrollIndicators);
    }
}

function updateScrollIndicators(): void {
    const listEl = document.getElementById('directoryList');
    const topIndicator = document.querySelector('.scroll-indicator-top');
    const bottomIndicator = document.querySelector('.scroll-indicator-bottom');

    if (!listEl || !topIndicator || !bottomIndicator) return;

    const { scrollTop, scrollHeight, clientHeight } = listEl;
    const hasScrollableContent = scrollHeight > clientHeight;
    const atTop = scrollTop <= 5;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 5;

    if (hasScrollableContent && !atTop) {
        topIndicator.classList.add('visible');
    } else {
        topIndicator.classList.remove('visible');
    }

    if (hasScrollableContent && !atBottom) {
        bottomIndicator.classList.add('visible');
    } else {
        bottomIndicator.classList.remove('visible');
    }
}

export { updateScrollIndicators };

export function populateDirectory(): void {
    const { workflowGroups } = state;
    const listEl = document.getElementById('directoryList');
    if (!listEl) return;

    // Clear existing items
    listEl.innerHTML = '';

    // Filter groups with 3+ nodes and sort alphabetically
    const validGroups = workflowGroups
        .filter((g: any) => g.nodes.length >= 3)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

    // Create list items
    validGroups.forEach((group: any) => {
        const item = document.createElement('div');
        item.className = 'directory-item';
        item.setAttribute('data-group-id', group.id);

        const dot = document.createElement('div');
        dot.className = 'directory-item-dot';
        dot.style.backgroundColor = group.color;

        const name = document.createElement('span');
        name.className = 'directory-item-name';
        name.textContent = group.name;
        name.title = group.name; // tooltip for long names

        item.appendChild(dot);
        item.appendChild(name);

        item.addEventListener('click', () => focusOnWorkflow(group));

        listEl.appendChild(item);
    });

    // Update scroll indicators after populating
    setTimeout(updateScrollIndicators, 0);
}

export function focusOnWorkflow(groupOrName: any | string): void {
    // If string, lookup group by name (case-insensitive)
    let group = groupOrName;
    if (typeof groupOrName === 'string') {
        const { workflowGroups } = state;
        group = workflowGroups.find((g: any) =>
            g.name.toLowerCase().includes(groupOrName.toLowerCase())
        );
        if (!group) {
            console.warn(`[directory] Workflow not found: ${groupOrName}`);
            return;
        }
    }
    const { svg, zoom } = state;
    if (!svg || !zoom || !group.bounds) return;

    const svgEl = svg.node();
    const width = svgEl.clientWidth;
    const height = svgEl.clientHeight;

    // Target: top-left of workflow bounds with title visible
    // Add some padding so title is clearly in view
    const targetX = group.bounds.minX - 50;
    const targetY = group.bounds.minY - 30;

    // Calculate scale to fit workflow width, but cap at reasonable zoom
    const workflowWidth = group.bounds.maxX - group.bounds.minX;
    const workflowHeight = group.bounds.maxY - group.bounds.minY;

    // Use a scale that shows the workflow nicely (not too zoomed)
    const scaleX = (width * 0.7) / workflowWidth;
    const scaleY = (height * 0.7) / workflowHeight;
    const scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.5), 1.2);

    // Calculate transform to center the workflow start
    const tx = width / 4 - targetX * scale;
    const ty = height / 3 - targetY * scale;

    // Expand workflow if collapsed
    if (group.collapsed) {
        group.collapsed = false;
        updateGroupVisibility();
    }

    // Check if workflow is already mostly in view
    const currentTransform = d3.zoomTransform(svgEl);
    const currentCenterX = (width / 2 - currentTransform.x) / currentTransform.k;
    const currentCenterY = (height / 2 - currentTransform.y) / currentTransform.k;
    const workflowCenterX = (group.bounds.minX + group.bounds.maxX) / 2;
    const workflowCenterY = (group.bounds.minY + group.bounds.maxY) / 2;
    const distance = Math.sqrt(
        Math.pow(currentCenterX - workflowCenterX, 2) +
        Math.pow(currentCenterY - workflowCenterY, 2)
    );

    // Shorter pan duration if already close
    const isClose = distance < 500;
    const panDuration = isClose ? 300 : TRANSITION_NORMAL;

    // Pulse effect function
    const pulseWorkflow = () => {
        const groupBg = d3.select(`.workflow-group[data-group-id="${group.id}"] .group-background`);
        groupBg
            .transition()
            .duration(150)
            .style('fill-opacity', 0.15)
            .transition()
            .duration(250)
            .style('fill-opacity', 0.03);
    };

    // Animate to the target position
    svg.transition()
        .duration(panDuration)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
        .on('end', pulseWorkflow);
}
