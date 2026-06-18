import { describe, expect, test } from 'bun:test';
import { parseCircuitDocumentFile } from '@vessel-dsp/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
    STOMPBOX_PART_CATALOG,
    createStompboxDrillTemplateSvg,
    createStompboxDrillTemplateSvgFromVdsp,
    createStompboxPreviewGlbFromVdsp,
    createStompboxPreviewSvgViewsFromVdsp,
    createStompboxDrillLayout,
    createStompboxDrillLayoutFromVdsp,
    createStompboxDrillTemplate,
    createStompboxDrillTemplateFromVdsp,
    createStompboxPreview,
    createStompboxPreviewFromVdsp,
    resolveStompboxAssetPaths,
} from '@vessel-dsp/stompbox';

type GltfJson = Readonly<{
    asset?: Readonly<{
        version?: string;
        generator?: string;
        extras?: unknown;
    }>;
    nodes?: readonly Readonly<{
        name?: string;
        translation?: readonly number[];
        rotation?: readonly number[];
        children?: readonly number[];
        extras?: unknown;
    }>[];
    scenes?: readonly Readonly<{
        nodes?: readonly number[];
    }>[];
    buffers?: readonly Readonly<{
        byteLength?: number;
    }>[];
    bufferViews?: readonly unknown[];
    accessors?: readonly unknown[];
    meshes?: readonly unknown[];
}>;

type GltfExtras = Readonly<{
    schema?: string;
    units?: string;
    kind?: string;
    decalKind?: string;
    text?: string;
    svg?: string;
    glb?: string;
    step?: string;
    sourceAssets?: readonly Readonly<{
        id?: string;
        glb?: string;
        step?: string;
    }>[];
}>;

function parseJsonChunkFromGlb(bytes: Uint8Array): GltfJson {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    expect(jsonChunkType).toBe(0x4e4f534a);

    const chunk = bytes.slice(20, 20 + jsonChunkLength);
    return JSON.parse(new TextDecoder().decode(chunk).trim()) as GltfJson;
}

function glbChunkTypes(bytes: Uint8Array): readonly string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const types: string[] = [];
    let offset = 12;
    while (offset < bytes.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        types.push(chunkType === 0x4e4f534a ? 'JSON' : chunkType === 0x004e4942 ? 'BIN' : `0x${chunkType.toString(16)}`);
        offset += 8 + chunkLength;
    }
    return types;
}

function gltfExtras(value: unknown): GltfExtras {
    expect(typeof value).toBe('object');
    expect(value).not.toBeNull();
    return value as GltfExtras;
}

function vdspWithPotentiometers(ids: readonly string[]): string {
    return `schema: circuit-interchange/v2
metadata:
  name: ${ids.length} Knob Pedal
source:
  format: interchange
  filename: ${ids.length}-knob.vdsp
components:
${ids.map((id, index) => `  - id: ${id}
    kind: potentiometer
    name: ${id}
    origin:
      x: ${index * 40}
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"`).join('\n')}
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;
}

const customDecals = [
    {
        id: 'brand',
        kind: 'text',
        text: 'Fuzz Lab',
        centerMm: { x: 0, y: 9 },
        sizeMm: { widthMm: 34, heightMm: 7 },
        color: '#f97316',
        fontFamily: 'Arial',
    },
    {
        id: 'badge',
        kind: 'svg',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 1 L9 9 H1 Z" fill="none" stroke="black"/></svg>',
        centerMm: { x: 0, y: -12 },
        sizeMm: { widthMm: 14, heightMm: 12 },
    },
] as const;

const vdspWithoutPhysicalPlacement = `schema: circuit-interchange/v2
metadata:
  name: Auto Layout Pedal
source:
  format: interchange
  filename: auto-layout.vdsp
components:
  - id: GAIN
    kind: potentiometer
    name: Gain
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.25
      Taper: log
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: LEVEL
    kind: potentiometer
    name: Level
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.8
      Taper: log
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: LED1
    kind: led
    name: Status
    origin:
      x: 20
      y: 40
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Color: red
    sourceTypeName: "Circuit.LED, Circuit"
  - id: SW1
    kind: switch
    name: Bypass
    origin:
      x: 20
      y: 80
    rotation: 0
    flipped: false
    terminals: []
    properties:
      SwitchKind: 3PDT
      PartNumber: 3PDT footswitch
    sourceTypeName: "Circuit.Switch, Circuit"
  - id: IN
    kind: jack
    name: Input
    origin:
      x: -40
      y: 20
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Role: input
      Interface: audio
    sourceTypeName: "Circuit.Input, Circuit"
  - id: OUT
    kind: jack
    name: Output
    origin:
      x: 80
      y: 20
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Role: output
      Interface: audio
    sourceTypeName: "Circuit.Speaker, Circuit"
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

const vdspWithControlsOnly = `schema: circuit-interchange/v2
metadata:
  name: Controls Only Pedal
source:
  format: interchange
  filename: controls-only.vdsp
components:
  - id: GAIN
    kind: potentiometer
    name: Gain
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.25
      Taper: log
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: LEVEL
    kind: potentiometer
    name: Level
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.8
      Taper: log
    sourceTypeName: "Circuit.Potentiometer, Circuit"
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

const vdspWithPhysicalPlacement = `schema: circuit-interchange/v3
metadata:
  name: Declared Layout Pedal
source:
  format: interchange
  filename: declared-layout.vdsp
components:
  - id: TONE
    kind: potentiometer
    name: Tone
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: LED1
    kind: led
    name: Status
    origin:
      x: 20
      y: 20
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Color: red
    sourceTypeName: "Circuit.LED, Circuit"
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
panel:
  faces:
    - id: top
      label: Top
      layout:
        kind: stompbox-grid
        rows: 2
        columns: 2
        indexing: one-based
      geometry:
        units: mm
        surface: enclosure-top
        usableRectMm:
          x: -25
          y: -45
          width: 50
          height: 90
      elements:
        - id: tone-knob
          bind:
            componentId: TONE
            controlId: TONE
          kind: knob
          label: Tone
          grid:
            row: 1
            column: 1
          physical:
            units: mm
            centerMm:
              x: -14
              y: 32
            drillDiameterMm: 6
            partProfileId: knob-cm42-bb
            locked: true
        - id: status-led
          bind:
            componentId: LED1
            controlId: LED1
          kind: led
          label: Status
          grid:
            row: 2
            column: 1
          physical:
            units: mm
            centerMm:
              x: 14
              y: 12
            drillDiameterMm: 7.94
            partProfileId: led-bezel-lh5
            locked: true
`;

const vdspWithDiagnosticPlacements = `schema: circuit-interchange/v3
metadata:
  name: Diagnostic Layout Pedal
source:
  format: interchange
  filename: diagnostic-layout.vdsp
components:
  - id: A
    kind: potentiometer
    name: A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: B
    kind: potentiometer
    name: B
    origin:
      x: 20
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: C
    kind: potentiometer
    name: C
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
panel:
  faces:
    - id: top
      label: Top
      layout:
        kind: stompbox-grid
        rows: 2
        columns: 2
        indexing: one-based
      geometry:
        units: mm
        surface: enclosure-top
        usableRectMm:
          x: -25
          y: -45
          width: 50
          height: 90
      elements:
        - id: unknown-part-knob
          bind:
            componentId: A
            controlId: A
          kind: knob
          label: A
          grid:
            row: 1
            column: 1
          physical:
            units: mm
            centerMm:
              x: -5
              y: 0
            drillDiameterMm: 12
            partProfileId: missing-knob-profile
        - id: colliding-knob
          bind:
            componentId: B
            controlId: B
          kind: knob
          label: B
          grid:
            row: 1
            column: 2
          physical:
            units: mm
            centerMm:
              x: -4
              y: 0
            drillDiameterMm: 12
        - id: out-of-bounds-knob
          bind:
            componentId: C
            controlId: C
          kind: knob
          label: C
          grid:
            row: 2
            column: 1
          physical:
            units: mm
            centerMm:
              x: 100
              y: 0
            drillDiameterMm: 6
        - id: unsupported-slider
          bind:
            componentId: SLD
            controlId: SLD
          kind: slider
          label: Slider
          grid:
            row: 2
            column: 2
          physical:
            units: mm
            centerMm:
              x: 0
              y: 20
            drillDiameterMm: 4
`;

describe('stompbox catalog and assets', () => {
    test('covers the v1 exterior stub families with GLB and STEP references', () => {
        expect(Object.keys(STOMPBOX_PART_CATALOG).sort()).toEqual([
            'dc-socket-dc099',
            'jack-ts-pj629han',
            'knob-chickenhead-lms-30mm',
            'knob-cm42-bb',
            'knob-davies-1510bg-mini',
            'knob-mxr-style-fluted',
            'led-5mm-red-kento-5408urc',
            'led-bezel-lh5',
            'switch-3pdt-pic-pbs24302',
        ]);

        const audioJack = STOMPBOX_PART_CATALOG['jack-ts-pj629han'];
        expect(audioJack).toBeDefined();
        if (audioJack === undefined) {
            return;
        }
        expect(audioJack.status).toBe('generated-stub');
        expect(audioJack.level).toBe('exterior');
        expect(audioJack.geometry.kind).toBe('ring');
        if (audioJack.geometry.kind !== 'ring') {
            return;
        }
        expect(audioJack.geometry.outerDiameterMm).toBe(11);
        expect(audioJack.geometry.innerDiameterMm).toBe(6.43);
        expect(audioJack.panelHoleDrillMm).toBe(9.5);
        expect(audioJack.assets.glbRelativePath).toBe('jack-ts-pj629han/.pj-629han-05.step.glb');
        expect(audioJack.assets.stepRelativePath).toBe('jack-ts-pj629han/pj-629han-05.step');

        const dcJack = STOMPBOX_PART_CATALOG['dc-socket-dc099'];
        expect(dcJack).toBeDefined();
        if (dcJack === undefined) {
            return;
        }
        expect(dcJack.status).toBe('generated-stub');
        expect(dcJack.level).toBe('exterior');
        expect(dcJack.geometry.kind).toBe('ring');
        if (dcJack.geometry.kind !== 'ring') {
            return;
        }
        expect(dcJack.geometry.outerDiameterMm).toBe(14.1);
        expect(dcJack.geometry.innerDiameterMm).toBe(8);
        expect(dcJack.panelHoleDrillMm).toBe(8);
        expect(dcJack.assets.glbRelativePath).toBe('dc-socket-dc099/.dc099.step.glb');
        expect(dcJack.assets.stepRelativePath).toBe('dc-socket-dc099/dc099.step');
    });

    test('resolves catalog asset paths from a local base path or served base URL', () => {
        const jack = STOMPBOX_PART_CATALOG['jack-ts-pj629han'];
        expect(jack).toBeDefined();
        if (jack === undefined) {
            return;
        }

        expect(resolveStompboxAssetPaths(jack.assets, {
            basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
        })).toEqual({
            glb: join(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT, 'jack-ts-pj629han/.pj-629han-05.step.glb'),
            step: join(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT, 'jack-ts-pj629han/pj-629han-05.step'),
        });
        expect(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT).toContain('/packages/stompbox/assets/cad/parts');
        expect(existsSync(join(
            DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
            'jack-ts-pj629han/.pj-629han-05.step.glb',
        ))).toBe(true);
        expect(existsSync(join(
            DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
            'jack-ts-pj629han/pj-629han-05.step',
        ))).toBe(true);

        expect(resolveStompboxAssetPaths(jack.assets, {
            baseUrl: '/cad/parts/',
        })).toEqual({
            glb: '/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb',
            step: '/cad/parts/jack-ts-pj629han/pj-629han-05.step',
        });
    });
});

describe('stompbox drill layout', () => {
    test('auto-generates deterministic physical placement when .vdsp has no panel physical coordinates', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement, { includePowerJack: true });

        expect(layout.schema).toBe('stompbox-drill-layout/v1');
        expect(layout.enclosure.variantId).toBe('box-1590b');
        expect(layout.holes.map((hole) => ({
            id: hole.id,
            controlId: hole.controlId,
            partId: hole.partId,
            face: hole.face,
            centerMm: hole.centerMm,
            drillDiameterMm: hole.drillDiameterMm,
            provenance: hole.provenance,
        }))).toEqual([
            {
                id: 'knob-GAIN',
                controlId: 'GAIN',
                partId: 'knob-mxr-style-fluted',
                face: 'top',
                centerMm: { x: -15, y: 28 },
                drillDiameterMm: 6.35,
                provenance: 'auto-generated',
            },
            {
                id: 'knob-LEVEL',
                controlId: 'LEVEL',
                partId: 'knob-mxr-style-fluted',
                face: 'top',
                centerMm: { x: 15, y: 28 },
                drillDiameterMm: 6.35,
                provenance: 'auto-generated',
            },
            {
                id: 'led-LED1',
                controlId: 'LED1',
                partId: 'led-5mm-red-kento-5408urc',
                face: 'top',
                centerMm: { x: 0, y: 3 },
                drillDiameterMm: 5,
                provenance: 'auto-generated',
            },
            {
                id: 'switch-SW1',
                controlId: 'SW1',
                partId: 'switch-3pdt-pic-pbs24302',
                face: 'top',
                centerMm: { x: 0, y: -34 },
                drillDiameterMm: 12,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-IN',
                controlId: 'IN',
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30, y: 20 },
                drillDiameterMm: 9.5,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-OUT',
                controlId: 'OUT',
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30, y: 20 },
                drillDiameterMm: 9.5,
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'back',
                centerMm: { x: 0, y: 56 },
                drillDiameterMm: 8,
                provenance: 'auto-generated',
            },
        ]);
        expect(layout.diagnostics.map((diagnostic) => diagnostic.code)).toContain('placement-auto-generated');
    });

    test('auto-generates omitted stompbox hardware for controls-only schematics', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithControlsOnly);

        expect(layout.holes.map((hole) => ({
            id: hole.id,
            controlId: hole.controlId,
            partId: hole.partId,
            face: hole.face,
            centerMm: hole.centerMm,
            provenance: hole.provenance,
        }))).toEqual([
            {
                id: 'knob-GAIN',
                controlId: 'GAIN',
                partId: 'knob-mxr-style-fluted',
                face: 'top',
                centerMm: { x: -15, y: 28 },
                provenance: 'auto-generated',
            },
            {
                id: 'knob-LEVEL',
                controlId: 'LEVEL',
                partId: 'knob-mxr-style-fluted',
                face: 'top',
                centerMm: { x: 15, y: 28 },
                provenance: 'auto-generated',
            },
            {
                id: 'led-status',
                controlId: undefined,
                partId: 'led-5mm-red-kento-5408urc',
                face: 'top',
                centerMm: { x: 0, y: 3 },
                provenance: 'auto-generated',
            },
            {
                id: 'switch-bypass',
                controlId: undefined,
                partId: 'switch-3pdt-pic-pbs24302',
                face: 'top',
                centerMm: { x: 0, y: -34 },
                provenance: 'auto-generated',
            },
            {
                id: 'jack-input',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30, y: 20 },
                provenance: 'auto-generated',
            },
            {
                id: 'jack-output',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30, y: 20 },
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'back',
                centerMm: { x: 0, y: 56 },
                provenance: 'auto-generated',
            },
        ]);
    });

    test('uses enclosure-width three-column spacing for normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['SUSTAIN', 'TONE', 'LEVEL']), {
            includePowerJack: false,
        });

        expect(layout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({
                id: hole.id,
                partId: hole.partId,
                centerMm: hole.centerMm,
            }))).toEqual([
            { id: 'knob-SUSTAIN', partId: 'knob-mxr-style-fluted', centerMm: { x: -20, y: 28 } },
            { id: 'knob-TONE', partId: 'knob-mxr-style-fluted', centerMm: { x: 0, y: 28 } },
            { id: 'knob-LEVEL', partId: 'knob-mxr-style-fluted', centerMm: { x: 20, y: 28 } },
        ]);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses a four-column grid with the mini knob profile for dense knob rows', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['A', 'B', 'C', 'D']), {
            includePowerJack: false,
        });

        expect(layout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({
                id: hole.id,
                partId: hole.partId,
                centerMm: hole.centerMm,
            }))).toEqual([
            { id: 'knob-A', partId: 'knob-davies-1510bg-mini', centerMm: { x: -22.5, y: 28 } },
            { id: 'knob-B', partId: 'knob-davies-1510bg-mini', centerMm: { x: -7.5, y: 28 } },
            { id: 'knob-C', partId: 'knob-davies-1510bg-mini', centerMm: { x: 7.5, y: 28 } },
            { id: 'knob-D', partId: 'knob-davies-1510bg-mini', centerMm: { x: 22.5, y: 28 } },
        ]);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('can omit the synthesized 9V connector explicitly', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithControlsOnly, { includePowerJack: false });

        expect(layout.holes.map((hole) => hole.id)).toEqual([
            'knob-GAIN',
            'knob-LEVEL',
            'led-status',
            'switch-bypass',
            'jack-input',
            'jack-output',
        ]);
    });

    test('uses declared .vdsp physical placement when available', () => {
        const document = parseCircuitDocumentFile(vdspWithPhysicalPlacement, { filename: 'declared-layout.vdsp' });
        const layout = createStompboxDrillLayout(document);

        expect(layout.holes.map((hole) => ({
            id: hole.id,
            controlId: hole.controlId,
            partId: hole.partId,
            face: hole.face,
            centerMm: hole.centerMm,
            drillDiameterMm: hole.drillDiameterMm,
            provenance: hole.provenance,
        }))).toEqual([
            {
                id: 'tone-knob',
                controlId: 'TONE',
                partId: 'knob-cm42-bb',
                face: 'top',
                centerMm: { x: -14, y: 32 },
                drillDiameterMm: 6,
                provenance: 'vdsp-declared',
            },
            {
                id: 'status-led',
                controlId: 'LED1',
                partId: 'led-bezel-lh5',
                face: 'top',
                centerMm: { x: 14, y: 12 },
                drillDiameterMm: 7.94,
                provenance: 'vdsp-declared',
            },
            {
                id: 'switch-bypass',
                controlId: undefined,
                partId: 'switch-3pdt-pic-pbs24302',
                face: 'top',
                centerMm: { x: 0, y: -34 },
                drillDiameterMm: 12,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-input',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30, y: 20 },
                drillDiameterMm: 9.5,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-output',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30, y: 20 },
                drillDiameterMm: 9.5,
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'back',
                centerMm: { x: 0, y: 56 },
                drillDiameterMm: 8,
                provenance: 'auto-generated',
            },
        ]);
        expect(layout.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            'placement-auto-generated',
            'placement-auto-generated',
            'placement-auto-generated',
            'placement-auto-generated',
        ]);
    });

    test('reports unsupported controls, unknown part mappings, collisions, and out-of-panel placements', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithDiagnosticPlacements);
        const diagnosticCodes = layout.diagnostics.map((diagnostic) => diagnostic.code);

        expect(diagnosticCodes).toContain('unknown-part-profile');
        expect(diagnosticCodes).toContain('unsupported-control');
        expect(diagnosticCodes).toContain('placement-collision');
        expect(diagnosticCodes).toContain('placement-out-of-bounds');
        expect(layout.diagnostics).toContainEqual({
            code: 'unknown-part-profile',
            message: 'Unknown stompbox part profile "missing-knob-profile"',
            controlId: 'A',
            placementId: 'unknown-part-knob',
        });
        expect(layout.diagnostics.some((diagnostic) =>
            diagnostic.code === 'placement-collision'
            && diagnostic.placementId === 'unknown-part-knob'
            && diagnostic.face === 'top'
        )).toBe(true);
        expect(layout.diagnostics.some((diagnostic) =>
            diagnostic.code === 'placement-out-of-bounds'
            && diagnostic.placementId === 'out-of-bounds-knob'
            && diagnostic.face === 'top'
        )).toBe(true);
    });
});

describe('stompbox drill template modes', () => {
    test('creates a lightweight preview template for UI preview', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement);
        const template = createStompboxDrillTemplate(layout, { mode: 'preview' });

        expect(template).toMatchObject({
            schema: 'stompbox-drill-template/v1',
            mode: 'preview',
            units: 'mm',
            scale: 1,
            page: undefined,
            detailLevel: 'preview',
        });
        expect(template.canvasMm).toEqual({ widthMm: 122, heightMm: 174 });
        expect(template.scaleMarks).toEqual([]);
        expect(template.holeTable).toEqual([]);
        expect(template.holes).toHaveLength(7);
        expect(template.holes.find((hole) => hole.id === 'knob-GAIN')?.templateCenterMm).toEqual({ x: 46, y: 59 });
        expect(template.holes.find((hole) => hole.id === 'jack-IN')?.templateCenterMm).toEqual({ x: 106.5, y: 67 });
        expect(template.holes.find((hole) => hole.id === 'jack-OUT')?.templateCenterMm).toEqual({ x: 15.5, y: 67 });
        expect(template.holes.find((hole) => hole.id === 'power-9v')?.templateCenterMm).toEqual({ x: 61, y: 15.5 });
    });

    test('creates an A4 1:1 print template with scale marks', () => {
        const template = createStompboxDrillTemplateFromVdsp(vdspWithoutPhysicalPlacement, {
            mode: 'print',
            includePowerJack: true,
        });

        expect(template.schema).toBe('stompbox-drill-template/v1');
        expect(template.mode).toBe('print');
        expect(template.detailLevel).toBe('fabrication-detail');
        expect(template.scale).toBe(1);
        expect(template.page).toEqual({
            paper: 'A4',
            orientation: 'portrait',
            widthMm: 210,
            heightMm: 297,
            marginMm: 12,
        });
        expect(template.canvasMm).toEqual({ widthMm: 210, heightMm: 297 });
        expect(template.scaleMarks).toEqual([
            { id: 'scale-10mm', label: '10 mm', lengthMm: 10, startMm: { x: 12, y: 285 }, endMm: { x: 22, y: 285 } },
            { id: 'scale-50mm', label: '50 mm', lengthMm: 50, startMm: { x: 12, y: 278 }, endMm: { x: 62, y: 278 } },
        ]);
        expect(template.holeTable.map((hole) => ({
            id: hole.id,
            face: hole.face,
            centerMm: hole.centerMm,
            drillDiameterMm: hole.drillDiameterMm,
            provenance: hole.provenance,
        }))).toEqual([
            { id: 'knob-GAIN', face: 'top', centerMm: { x: -15, y: 28 }, drillDiameterMm: 6.35, provenance: 'auto-generated' },
            { id: 'knob-LEVEL', face: 'top', centerMm: { x: 15, y: 28 }, drillDiameterMm: 6.35, provenance: 'auto-generated' },
            { id: 'led-LED1', face: 'top', centerMm: { x: 0, y: 3 }, drillDiameterMm: 5, provenance: 'auto-generated' },
            { id: 'switch-SW1', face: 'top', centerMm: { x: 0, y: -34 }, drillDiameterMm: 12, provenance: 'auto-generated' },
            { id: 'jack-IN', face: 'right', centerMm: { x: 30, y: 20 }, drillDiameterMm: 9.5, provenance: 'auto-generated' },
            { id: 'jack-OUT', face: 'left', centerMm: { x: -30, y: 20 }, drillDiameterMm: 9.5, provenance: 'auto-generated' },
            { id: 'power-9v', face: 'back', centerMm: { x: 0, y: 56 }, drillDiameterMm: 8, provenance: 'auto-generated' },
        ]);
    });

    test('serializes drill templates as SVG in preview and A4 print modes', () => {
        const previewLayout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement);
        const previewSvg = createStompboxDrillTemplateSvg(previewLayout, { mode: 'preview' });
        const printSvg = createStompboxDrillTemplateSvgFromVdsp(vdspWithoutPhysicalPlacement, {
            mode: 'print',
            includePowerJack: true,
        });

        expect(previewSvg).toStartWith('<svg ');
        expect(previewSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(previewSvg).toContain('data-template-mode="preview"');
        expect(previewSvg).toContain('viewBox="0 0 122 174"');
        expect(previewSvg).toContain('<title id="stompbox-drill-preview-title">Stompbox drill template preview</title>');
        expect(previewSvg).toContain('data-template-view="outside-unfolded"');
        expect(previewSvg).toContain('data-face-panel="top"');
        expect(previewSvg).toContain('data-face-panel="left"');
        expect(previewSvg).toContain('data-face-panel="right"');
        expect(previewSvg).toContain('data-face-panel="back"');
        expect(previewSvg).toContain('data-face-panel="bottom"');
        expect(previewSvg).toContain('data-fold-line="left"');
        expect(previewSvg).toContain('data-fold-line="right"');
        expect(previewSvg).toContain('data-fold-line="back"');
        expect(previewSvg).toContain('data-fold-line="bottom"');
        expect(previewSvg).toContain('data-template-guide="vertical-centerline"');
        expect(previewSvg).toContain('data-template-guide="horizontal-centerline"');
        expect(previewSvg).toContain('data-hole-id="knob-GAIN"');
        expect(previewSvg).toContain('data-template-face="top"');
        expect(previewSvg).toContain('data-template-face="right"');
        expect(previewSvg).toContain('data-template-face="left"');
        expect(previewSvg).toContain('data-template-face="back"');
        expect(previewSvg).toContain('data-provenance="auto-generated"');
        expect(previewSvg).toContain('data-hole-id="jack-IN" data-part-profile-id="jack-ts-pj629han" data-face="right" data-template-face="right" data-provenance="auto-generated" data-drill-diameter-mm="9.5" data-drill-radius-mm="4.75" data-part-visible-diameter-mm="11"');
        expect(previewSvg).toContain('data-hole-id="jack-OUT" data-part-profile-id="jack-ts-pj629han" data-face="left" data-template-face="left" data-provenance="auto-generated" data-drill-diameter-mm="9.5" data-drill-radius-mm="4.75" data-part-visible-diameter-mm="11"');
        expect(previewSvg).toContain('data-hole-id="power-9v" data-part-profile-id="dc-socket-dc099" data-face="back" data-template-face="back" data-provenance="auto-generated" data-drill-diameter-mm="8" data-drill-radius-mm="4" data-part-visible-diameter-mm="14.1"');
        expect(previewSvg).toContain('class="hole"');
        expect(previewSvg).toContain('r="4.75"');
        expect(previewSvg).toContain('r="6"');
        expect(previewSvg).not.toContain('data-scale-mark-id="scale-50mm"');
        expect(previewSvg).not.toContain('A4 1:1');

        expect(printSvg).toStartWith('<svg ');
        expect(printSvg).toContain('width="210mm"');
        expect(printSvg).toContain('height="297mm"');
        expect(printSvg).toContain('viewBox="0 0 210 297"');
        expect(printSvg).toContain('data-template-mode="print"');
        expect(printSvg).toContain('<title id="stompbox-drill-print-title">Stompbox drill template print</title>');
        expect(printSvg).toContain('data-scale-mark-id="scale-10mm"');
        expect(printSvg).toContain('data-scale-mark-id="scale-50mm"');
        expect(printSvg).not.toContain('data-print-header="true"');
        expect(printSvg).not.toContain('data-hole-table="true"');
        expect(printSvg).not.toContain('<text ');
        expect(printSvg).toContain('power-9v');
    });

    test('renders customization decals as outlines in preview and print drill-template modes', () => {
        const previewLayout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement);
        const previewSvg = createStompboxDrillTemplateSvg(previewLayout, {
            mode: 'preview',
            decals: customDecals,
        });
        const printSvg = createStompboxDrillTemplateSvgFromVdsp(vdspWithoutPhysicalPlacement, {
            mode: 'print',
            includePowerJack: true,
            decals: customDecals,
        });

        expect(previewSvg).toContain('data-decal-outline="true"');
        expect(previewSvg).toContain('data-decal-id="brand"');
        expect(previewSvg).toContain('data-decal-id="badge"');
        expect(previewSvg).not.toContain('Fuzz Lab');
        expect(previewSvg).not.toContain('data:image/svg+xml');

        expect(printSvg).toContain('data-decal-outline="true"');
        expect(printSvg).toContain('data-decal-id="brand"');
        expect(printSvg).toContain('data-decal-id="badge"');
        expect(printSvg).not.toContain('data-decal-sheet="true"');
        expect(printSvg).not.toContain('Fuzz Lab');
        expect(printSvg).not.toContain('data:image/svg+xml');
    });
});

describe('stompbox preview manifest', () => {
    test('normalizes text and SVG customization decals for preview outputs', () => {
        const preview = createStompboxPreviewFromVdsp(vdspWithoutPhysicalPlacement, {
            decals: customDecals,
        });

        expect(preview.decals).toEqual([
            {
                id: 'brand',
                kind: 'text',
                text: 'Fuzz Lab',
                face: 'top',
                centerMm: { x: 0, y: 9 },
                sizeMm: { widthMm: 34, heightMm: 7 },
                rotationDeg: 0,
                color: '#f97316',
                fontFamily: 'Arial',
                fontSizeMm: 4.55,
            },
            {
                id: 'badge',
                kind: 'svg',
                svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 1 L9 9 H1 Z" fill="none" stroke="black"/></svg>',
                face: 'top',
                centerMm: { x: 0, y: -12 },
                sizeMm: { widthMm: 14, heightMm: 12 },
                rotationDeg: 0,
            },
        ]);
    });

    test('uses drill placement and applies runtime visual state', () => {
        const preview = createStompboxPreviewFromVdsp(vdspWithoutPhysicalPlacement, {
            state: {
                GAIN: { kind: 'knob', position: 1 },
                LED1: { kind: 'led', on: true, intensity: 0.7 },
                SW1: { kind: 'switch', position: 1 },
            },
        });

        const gain = preview.parts.find((part) => part.id === 'knob-GAIN')!;
        const status = preview.parts.find((part) => part.id === 'led-LED1')!;
        const bypass = preview.parts.find((part) => part.id === 'switch-SW1')!;
        const input = preview.parts.find((part) => part.id === 'jack-IN')!;

        expect(preview.schema).toBe('stompbox-preview/v1');
        expect(gain.transform.translationMm).toEqual({ x: -15, y: 28, z: 15.5 });
        expect(gain.transform.rotationDeg.z).toBe(135);
        expect(status.material).toEqual({ color: 'red', emissive: true, intensity: 0.7 });
        expect(bypass.transform.translationMm.z).toBe(14.3);
        expect(input.transform.rotationDeg).toEqual({ x: 0, y: 90, z: 0 });
    });

    test('uses declared placement for preview part transforms and asset references', () => {
        const document = parseCircuitDocumentFile(vdspWithPhysicalPlacement, { filename: 'declared-layout.vdsp' });
        const preview = createStompboxPreview(document, { baseUrl: '/cad/parts' });

        expect(preview.parts.map((part) => ({
            id: part.id,
            partId: part.partId,
            provenance: part.provenance,
            glb: part.assets.glb,
            translationMm: part.transform.translationMm,
        }))).toEqual([
            {
                id: 'tone-knob',
                partId: 'knob-cm42-bb',
                provenance: 'vdsp-declared',
                glb: '/cad/parts/knob-cm42-bb/.tayda-a6078-cm42-bb.step.glb',
                translationMm: { x: -14, y: 32, z: 15.5 },
            },
            {
                id: 'status-led',
                partId: 'led-bezel-lh5',
                provenance: 'vdsp-declared',
                glb: '/cad/parts/led-bezel-lh5/.pedal-parts-and-kits-bzl-5mm-p.step.glb',
                translationMm: { x: 14, y: 12, z: 15.5 },
            },
            {
                id: 'switch-bypass',
                partId: 'switch-3pdt-pic-pbs24302',
                provenance: 'auto-generated',
                glb: '/cad/parts/switch-3pdt-pic-pbs24302/.pic-pbs24302.step.glb',
                translationMm: { x: 0, y: -34, z: 15.5 },
            },
            {
                id: 'jack-input',
                partId: 'jack-ts-pj629han',
                provenance: 'auto-generated',
                glb: '/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb',
                translationMm: { x: 30, y: 20, z: 0 },
            },
            {
                id: 'jack-output',
                partId: 'jack-ts-pj629han',
                provenance: 'auto-generated',
                glb: '/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb',
                translationMm: { x: -30, y: 20, z: 0 },
            },
            {
                id: 'power-9v',
                partId: 'dc-socket-dc099',
                provenance: 'auto-generated',
                glb: '/cad/parts/dc-socket-dc099/.dc099.step.glb',
                translationMm: { x: 0, y: 56, z: 0 },
            },
        ]);
    });

    test('serializes top, bottom, left, and right preview SVG views', () => {
        const views = createStompboxPreviewSvgViewsFromVdsp(vdspWithoutPhysicalPlacement, {
            includePowerJack: true,
            decals: customDecals,
            state: {
                GAIN: { kind: 'knob', position: 1 },
                LED1: { kind: 'led', on: true, intensity: 0.7 },
                SW1: { kind: 'switch', position: 1 },
            },
        });

        expect(views.schema).toBe('stompbox-preview-svg-views/v1');
        expect(views.preview.schema).toBe('stompbox-preview/v1');
        expect(views.views.top).toContain('data-view="top"');
        expect(views.views.top).toContain('<title id="stompbox-preview-top-title">Stompbox preview top view</title>');
        expect(views.views.top).toContain('data-part-id="knob-GAIN"');
        expect(views.views.top).toContain('data-knob-rotation-deg="135"');
        expect(views.views.top).toContain('data-led-emissive="true"');
        expect(views.views.top).toContain('data-footswitch-pressed="true"');
        expect(views.views.top).toContain('data-decal-id="brand"');
        expect(views.views.top).toContain('data-decal-kind="text"');
        expect(views.views.top).toContain('Fuzz Lab');
        expect(views.views.top).toContain('data-decal-id="badge"');
        expect(views.views.top).toContain('data:image/svg+xml');
        expect(views.views.bottom).toContain('data-view="bottom"');
        expect(views.views.left).toContain('data-view="left"');
        expect(views.views.left).toContain('data-part-id="jack-OUT"');
        expect(views.views.right).toContain('data-view="right"');
        expect(views.views.right).toContain('data-part-id="jack-IN"');
    });

    test('serializes a binary GLB preview assembly with source GLB nodes and transforms', () => {
        const assembly = createStompboxPreviewGlbFromVdsp(vdspWithoutPhysicalPlacement, {
            includePowerJack: true,
            basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
            decals: customDecals,
            state: {
                GAIN: { kind: 'knob', position: 1 },
                LED1: { kind: 'led', on: true, intensity: 0.7 },
                SW1: { kind: 'switch', position: 1 },
            },
        });
        const gltf = parseJsonChunkFromGlb(assembly.bytes);
        const extras = gltfExtras(gltf.asset?.extras);
        const nodes = gltf.nodes ?? [];

        expect(assembly.schema).toBe('stompbox-preview-glb/v1');
        expect(assembly.mimeType).toBe('model/gltf-binary');
        expect(assembly.bytes).toBeInstanceOf(Uint8Array);
        expect(assembly.preview.parts).toHaveLength(7);
        expect(glbChunkTypes(assembly.bytes)).toEqual(['JSON', 'BIN']);
        expect(gltf.asset?.version).toBe('2.0');
        expect(gltf.asset?.generator).toBe('@vessel-dsp/stompbox');
        expect(gltf.buffers?.[0]?.byteLength).toBeGreaterThan(0);
        expect(gltf.bufferViews?.length).toBeGreaterThan(0);
        expect(gltf.accessors?.length).toBeGreaterThan(0);
        expect(gltf.meshes?.length).toBeGreaterThan(0);
        expect(extras.schema).toBe('stompbox-preview-glb/v1');
        expect(extras.units).toBe('mm');
        expect(extras.sourceAssets?.map((asset) => asset.id)).toEqual([
            'box-1590b',
            'knob-GAIN',
            'knob-LEVEL',
            'led-LED1',
            'switch-SW1',
            'jack-IN',
            'jack-OUT',
            'power-9v',
        ]);
        expect(extras.sourceAssets?.[1]?.glb).toBe(
            join(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT, 'knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb'),
        );
        expect(nodes.some((node) => node.name === 'enclosure-box-1590b')).toBe(true);
        expect(assembly.preview.decals.map((decal) => decal.id)).toEqual(['brand', 'badge']);

        const gainNode = nodes.find((node) => node.name === 'part-knob-GAIN');
        const switchNode = nodes.find((node) => node.name === 'part-switch-SW1');
        const brandNode = nodes.find((node) => node.name === 'decal-brand');
        const badgeNode = nodes.find((node) => node.name === 'decal-badge');
        expect(gainNode?.children?.length).toBeGreaterThan(0);
        expect(gainNode?.translation).toEqual([-15, 28, 15.5]);
        expect(gainNode?.rotation).toEqual([0, 0, 0.92388, 0.382683]);
        expect(gltfExtras(gainNode?.extras).glb).toBe(
            join(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT, 'knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb'),
        );
        expect(switchNode?.translation).toEqual([0, -34, 14.3]);
        expect(brandNode?.translation).toEqual([0, 9, 15.7]);
        expect(brandNode?.rotation).toEqual([0, 0, 0, 1]);
        expect(gltfExtras(brandNode?.extras).kind).toBe('decal');
        expect(gltfExtras(brandNode?.extras).decalKind).toBe('text');
        expect(gltfExtras(brandNode?.extras).text).toBe('Fuzz Lab');
        expect(gltfExtras(badgeNode?.extras).decalKind).toBe('svg');
        expect(gltfExtras(badgeNode?.extras).svg).toContain('<path');
    });
});
