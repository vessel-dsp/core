import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
    movePanelElement,
    parseCircuitDocumentFile,
    serializeCircuitDocumentFile,
} from '../../packages/core/src/index';
import {
    EMPTY_DOCUMENT,
    type CircuitDocument,
    type PanelElementPlacement,
} from '../../packages/core/src/model/types';

const PLACEMENT_SOURCE = readFileSync(
    new URL('../../packages/core/src/panel/placement.ts', import.meta.url),
    'utf8',
);

const TONE_ELEMENT: PanelElementPlacement = {
    id: 'tone-knob',
    bind: {
        componentId: 'Tone',
        controlId: 'Tone',
    },
    kind: 'knob',
    label: 'Tone',
    grid: {
        row: 1,
        column: 1,
    },
    physical: {
        units: 'mm',
        centerMm: {
            x: -14,
            y: 32,
        },
        drillDiameterMm: 6,
        partProfileId: 'knob-cm42-bb',
        locked: true,
    },
};

const VOLUME_ELEMENT: PanelElementPlacement = {
    id: 'volume-knob',
    bind: {
        componentId: 'Volume',
        controlId: 'Volume',
    },
    kind: 'knob',
    label: 'Volume',
    grid: {
        row: 1,
        column: 2,
    },
};

function panelDocument(elements: readonly PanelElementPlacement[]): CircuitDocument {
    return {
        ...EMPTY_DOCUMENT,
        panel: {
            faces: [{
                id: 'top',
                label: 'Top',
                layout: {
                    kind: 'stompbox-grid',
                    rows: 2,
                    columns: 2,
                    indexing: 'one-based',
                },
                elements,
            }],
        },
    };
}

describe('movePanelElement', () => {
    test('documents that conflict resolution is delegated to stompbox diagnostics', () => {
        expect(PLACEMENT_SOURCE).toContain('does not resolve physical conflicts');
        expect(PLACEMENT_SOURCE).toContain('placement-collision');
        expect(PLACEMENT_SOURCE).toContain('placement-clearance');
        expect(PLACEMENT_SOURCE).toContain('placement-out-of-bounds');
    });

    test('updates an existing physical center by panel element id and preserves fabrication metadata', () => {
        const doc = panelDocument([TONE_ELEMENT, VOLUME_ELEMENT]);

        const next = movePanelElement(doc, {
            faceId: 'top',
            elementId: 'tone-knob',
            centerMm: { x: 12, y: -18 },
        });

        expect(next).not.toBe(doc);
        expect(next.panel?.faces[0]?.elements[0]?.physical).toEqual({
            units: 'mm',
            centerMm: { x: 12, y: -18 },
            drillDiameterMm: 6,
            partProfileId: 'knob-cm42-bb',
            locked: true,
        });
        expect(doc.panel?.faces[0]?.elements[0]?.physical?.centerMm).toEqual({ x: -14, y: 32 });
        expect(next.panel?.faces[0]?.elements[1]).toBe(doc.panel?.faces[0]?.elements[1]);
    });

    test('creates VDSP physical placement for an existing element matched by binding', () => {
        const doc = panelDocument([{
            bind: {
                componentId: 'Tone',
                controlId: 'Tone',
            },
            kind: 'knob',
            label: 'Tone',
            grid: {
                row: 1,
                column: 1,
            },
        }]);

        const next = movePanelElement(doc, {
            componentId: 'Tone',
            controlId: 'Tone',
            centerMm: { x: 4, y: -9 },
        });

        expect(next.panel?.faces[0]?.elements[0]?.physical).toEqual({
            units: 'mm',
            centerMm: { x: 4, y: -9 },
        });

        const vdsp = serializeCircuitDocumentFile(next, {
            format: 'vdsp',
            filename: 'moved-tone.vdsp',
        });
        const reparsed = parseCircuitDocumentFile(vdsp, { filename: 'moved-tone.vdsp' });

        expect(vdsp).toContain('schema: circuit-interchange/v3');
        expect(reparsed.panel?.faces[0]?.elements[0]?.physical?.centerMm).toEqual({ x: 4, y: -9 });
    });

    test('returns the same document when the requested panel element is absent', () => {
        const doc = panelDocument([TONE_ELEMENT]);

        const next = movePanelElement(doc, {
            faceId: 'top',
            elementId: 'missing-knob',
            centerMm: { x: 1, y: 2 },
        });

        expect(next).toBe(doc);
    });
});
