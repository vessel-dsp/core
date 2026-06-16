import { toNetlistView, type NetlistComponent } from '../../model/netlist';
import type { CircuitDocument } from '../../model/types';

export function serializeSpiceNetlist(doc: CircuitDocument): string {
    const lines: string[] = [];
    const titleLine = doc.metadata.name.trim();
    if (titleLine.length > 0) {
        lines.push(`.TITLE ${titleLine}`);
    } else {
        lines.push('* @vessel-dsp/core — serialized netlist');
    }

    const view = toNetlistView(doc);
    for (const entry of view.components) {
        const formatted = formatComponent(entry);
        if (formatted !== null) {
            lines.push(...formatted);
        }
    }

    for (const directive of doc.directives) {
        lines.push(directive);
    }

    lines.push('.END');
    return `${lines.join('\n')}\n`;
}

function formatComponent(entry: NetlistComponent): readonly string[] | null {
    if (entry.spiceLetter === null) {
        return [`* ${entry.id} (${entry.kind}) skipped — needs subcircuit expansion`];
    }
    const id = ensurePrefix(entry.id, entry.spiceLetter);
    const nodes = entry.nodes.join(' ');
    const tail = entry.model ?? entry.value?.raw ?? '';
    const extras = entry.extras.spiceExtras ?? '';
    const parts = [id, nodes, tail, extras].filter((s) => typeof s === 'string' && s.length > 0);
    return [...metadataCommentLines(entry), parts.join(' ').trim()];
}

function ensurePrefix(id: string, letter: string): string {
    return id.charAt(0).toUpperCase() === letter ? id : `${letter}${id}`;
}

function metadataCommentLines(entry: NetlistComponent): readonly string[] {
    return Object.entries(entry.extras)
        .filter(([key]) => key !== 'spiceExtras')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `* ${entry.id} ${key}=${formatMetadataCommentValue(value)}`);
}

function formatMetadataCommentValue(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}
