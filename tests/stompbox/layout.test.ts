import { describe, expect, test } from 'bun:test';
import { parseCircuitDocumentFile } from '@vessel-dsp/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
    DEFAULT_STOMPBOX_STYLE_PROFILE_ID,
    STOMPBOX_DRILL_HOLE_PROFILE_CATALOG,
    STOMPBOX_ENCLOSURE_CATALOG,
    STOMPBOX_PART_CATALOG,
    STOMPBOX_STYLE_PROFILES,
    createStompboxAppearancePatch,
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
    getAvailableStompboxStyleProfiles,
    resolveStompboxAppearance,
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
    materials?: readonly Readonly<{
        name?: string;
        pbrMetallicRoughness?: Readonly<{
            baseColorFactor?: readonly number[];
            metallicFactor?: number;
            roughnessFactor?: number;
        }>;
        emissiveFactor?: readonly number[];
    }>[];
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
    appearance?: unknown;
    material?: unknown;
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

function vdspWithPotentiometers(ids: readonly string[], extraComponents = ''): string {
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
    sourceTypeName: "Circuit.Potentiometer, Circuit"`).join('\n')}${extraComponents}
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;
}

function visibleKnobDiameterMm(partId: string): number {
    const profile = STOMPBOX_PART_CATALOG[partId];
    expect(profile).toBeDefined();
    expect(profile?.geometry.kind).toBe('knob');
    if (profile?.geometry.kind !== 'knob') {
        return 0;
    }
    return profile.geometry.diameterMm;
}

function minimumKnobClearanceMm(
    holes: readonly Readonly<{ partId: string; centerMm: Readonly<{ x: number; y: number }> }>[],
): number {
    return Math.min(...holes.flatMap((first, firstIndex) =>
        holes.slice(firstIndex + 1).map((second) => {
            const distance = Math.hypot(
                first.centerMm.x - second.centerMm.x,
                first.centerMm.y - second.centerMm.y,
            );
            return distance - (visibleKnobDiameterMm(first.partId) + visibleKnobDiameterMm(second.partId)) / 2;
        })
    ));
}

function drillTemplateHoleGroup(svg: string, holeId: string): string {
    const groupMatch = new RegExp(`<g[^>]*data-hole-id="${holeId}"[^>]*>(.*?)</g>`).exec(svg);
    expect(groupMatch?.[1]).toBeDefined();
    return groupMatch?.[1] ?? '';
}

function drillTemplateLabelY(svg: string, holeId: string, label: string): number {
    const labelMatch = new RegExp(`<text[^>]*y="([^"]+)"[^>]*>${label}</text>`).exec(
        drillTemplateHoleGroup(svg, holeId),
    );
    expect(labelMatch?.[1]).toBeDefined();
    return Number(labelMatch?.[1]);
}

function drillTemplateOuterCircleBottom(svg: string, holeId: string): number {
    const circleMatch = /<circle class="hole drill-hole-profile-outer"[^>]*cy="([^"]+)"[^>]*r="([^"]+)"/.exec(
        drillTemplateHoleGroup(svg, holeId),
    );
    expect(circleMatch?.[1]).toBeDefined();
    expect(circleMatch?.[2]).toBeDefined();
    return Number(circleMatch?.[1]) + Number(circleMatch?.[2]);
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

const vdspWithBossStyleControls = `schema: circuit-interchange/v2
metadata:
  name: Boss Style Pedal
source:
  format: interchange
  filename: boss-style.vdsp
components:
  - id: LEVEL
    kind: potentiometer
    name: Level
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: TONE
    kind: potentiometer
    name: Tone
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: DIST
    kind: potentiometer
    name: Dist
    origin:
      x: 80
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: CHECK
    kind: led
    name: Check
    origin:
      x: 20
      y: 40
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Color: red
    sourceTypeName: "Circuit.LED, Circuit"
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

const vdspWithOpaqueJackNames = `schema: circuit-interchange/v2
metadata:
  name: Opaque Jack Labels Pedal
source:
  format: interchange
  filename: opaque-jack-labels.vdsp
components:
  - id: J1
    kind: jack
    name: V1
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
  - id: J2
    kind: jack
    name: S1
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

const vdspWithStackedSideJacks = `schema: circuit-interchange/v2
metadata:
  name: Stacked Side Jacks Pedal
source:
  format: interchange
  filename: stacked-side-jacks.vdsp
components:
  - id: IN_A
    kind: jack
    name: Input A
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
  - id: IN_B
    kind: jack
    name: Input B
    origin:
      x: -40
      y: 40
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Role: input
      Interface: audio
    sourceTypeName: "Circuit.Input, Circuit"
  - id: OUT_A
    kind: jack
    name: Output A
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
  - id: OUT_B
    kind: jack
    name: Output B
    origin:
      x: 80
      y: 40
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

const vdspWithTightKnobClearance = `schema: circuit-interchange/v3
metadata:
  name: Tight Clearance Pedal
source:
  format: interchange
  filename: tight-clearance.vdsp
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
        rows: 1
        columns: 2
        indexing: one-based
      elements:
        - id: knob-a
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
              x: -12
              y: 20
        - id: knob-b
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
              x: 12
              y: 20
`;

describe('stompbox catalog and assets', () => {
    test('profiles enclosure dimensions used by the placement grid', () => {
        expect(STOMPBOX_ENCLOSURE_CATALOG['box-1590b']?.dimensionsMm).toEqual({
            widthMm: 60.5,
            lengthMm: 111.5,
            depthMm: 31,
        });
        expect(STOMPBOX_ENCLOSURE_CATALOG['box-1590a']?.dimensionsMm).toEqual({
            widthMm: 39,
            lengthMm: 92.5,
            depthMm: 31,
        });
    });

    test('profiles drilling-hole markers from the reference SVG sheet', () => {
        expect(Object.keys(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG).sort()).toEqual([
            'audio-jack-24mm-pot-3-8',
            'dc-jack-3pdt-1-2',
            'five-mm-led-13-64',
            'metal-5mm-led-bezel-5-16',
            'mini-toggle-switch-1-4',
            'pilot-hole-1-16',
            'sixteen-mm-pot-9-32',
            'three-mm-led-1-8',
        ]);
        expect(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG['dc-jack-3pdt-1-2']).toMatchObject({
            label: 'DC Jack / 3PDT',
            diameterMm: 12.7,
            fractionInches: '1/2"',
            marker: 'ring-with-center-dot',
        });
        expect(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG['audio-jack-24mm-pot-3-8']).toMatchObject({
            label: 'Audio Jacks / 24mm Pots',
            diameterMm: 9.525,
            fractionInches: '3/8"',
            marker: 'ring-with-center-dot',
        });
        expect(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG['five-mm-led-13-64']).toMatchObject({
            label: '5mm LED',
            diameterMm: 5.159375,
            fractionInches: '13/64"',
            marker: 'ring-with-center-dot',
        });
        expect(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG['pilot-hole-1-16']).toMatchObject({
            label: 'Pilot Hole',
            diameterMm: 1.5875,
            fractionInches: '1/16"',
            marker: 'center-dot',
        });
    });

    test('covers the v1 exterior stub families with GLB and STEP references', () => {
        expect(Object.keys(STOMPBOX_PART_CATALOG).sort()).toEqual([
            'dc-socket-dc099',
            'jack-ts-pj629han',
            'knob-chickenhead-lms-30mm',
            'knob-cm42-bb',
            'knob-davies-1510bg-14mm',
            'knob-davies-1510bg-mini',
            'knob-mxr-style-fluted',
            'knob-mxr-style-fluted-large',
            'led-3mm-red-kento-5408urc',
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
        expect(audioJack.panelHoleDrillMm).toBe(9.525);
        expect(audioJack.drillHoleProfileId).toBe('audio-jack-24mm-pot-3-8');
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
        expect(dcJack.panelHoleDrillMm).toBe(12.7);
        expect(dcJack.drillHoleProfileId).toBe('dc-jack-3pdt-1-2');
        expect(dcJack.assets.glbRelativePath).toBe('dc-socket-dc099/.dc099.step.glb');
        expect(dcJack.assets.stepRelativePath).toBe('dc-socket-dc099/dc099.step');

        const bossSecondRowKnob = STOMPBOX_PART_CATALOG['knob-davies-1510bg-14mm'];
        expect(bossSecondRowKnob).toBeDefined();
        if (bossSecondRowKnob === undefined) {
            return;
        }
        expect(bossSecondRowKnob.geometry.kind).toBe('knob');
        if (bossSecondRowKnob.geometry.kind !== 'knob') {
            return;
        }
        expect(bossSecondRowKnob.geometry.diameterMm).toBe(14.5);
        expect(bossSecondRowKnob.panelHoleDrillMm).toBe(7.14375);
        expect(bossSecondRowKnob.drillHoleProfileId).toBe('sixteen-mm-pot-9-32');
        expect(bossSecondRowKnob.assets.glbRelativePath).toBe('knob-davies-instrument-series/.davies-1510bg.step.glb');
        expect(bossSecondRowKnob.assets.stepRelativePath).toBe('knob-davies-instrument-series/davies-1510bg.step');

        const mxrLargeKnob = STOMPBOX_PART_CATALOG['knob-mxr-style-fluted-large'];
        expect(mxrLargeKnob).toBeDefined();
        if (mxrLargeKnob === undefined) {
            return;
        }
        expect(mxrLargeKnob.geometry.kind).toBe('knob');
        if (mxrLargeKnob.geometry.kind !== 'knob') {
            return;
        }
        expect(mxrLargeKnob.geometry.diameterMm).toBe(20);
        expect(mxrLargeKnob.panelHoleDrillMm).toBe(7.14375);
        expect(mxrLargeKnob.drillHoleProfileId).toBe('sixteen-mm-pot-9-32');
        expect(mxrLargeKnob.assetScale).toBeUndefined();
        expect(mxrLargeKnob.assets.glbRelativePath).toBe('knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb');
        expect(mxrLargeKnob.assets.stepRelativePath).toBe('knob-mxr-style-fluted/tayda-a1829-tymf-b00.step');

        const defaultLed = STOMPBOX_PART_CATALOG['led-3mm-red-kento-5408urc'];
        expect(defaultLed).toBeDefined();
        if (defaultLed === undefined) {
            return;
        }
        expect(defaultLed.geometry.kind).toBe('led');
        if (defaultLed.geometry.kind !== 'led') {
            return;
        }
        expect(defaultLed.geometry.lensDiameterMm).toBe(3);
        expect(defaultLed.geometry.flangeDiameterMm).toBe(3.48);
        expect(defaultLed.panelHoleDrillMm).toBe(3.175);
        expect(defaultLed.drillHoleProfileId).toBe('three-mm-led-1-8');
        expect(defaultLed.assetScale).toBe(0.6);
        expect(defaultLed.assets.glbRelativePath).toBe('led-5mm-red-kento-5408urc/.kento-5408urc.step.glb');
        expect(defaultLed.assets.stepRelativePath).toBe('led-5mm-red-kento-5408urc/kento-5408urc.step');
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

describe('stompbox style profiles', () => {
    test('exposes MXR as the default profile and filters UI choices by knob count', () => {
        expect(DEFAULT_STOMPBOX_STYLE_PROFILE_ID).toBe('mxr-style');
        expect(STOMPBOX_STYLE_PROFILES.map((profile) => ({
            id: profile.id,
            supportedKnobCounts: profile.supportedKnobCounts,
        }))).toEqual([
            { id: 'mxr-style', supportedKnobCounts: [1, 2, 3, 4, 5, 6] },
            { id: 'boss-style', supportedKnobCounts: [2, 3, 4] },
        ]);

        expect(getAvailableStompboxStyleProfiles({ knobCount: 2 }).map((profile) => profile.id)).toEqual([
            'mxr-style',
            'boss-style',
        ]);
        expect(getAvailableStompboxStyleProfiles({ knobCount: 4 }).map((profile) => profile.id)).toEqual([
            'mxr-style',
            'boss-style',
        ]);
        expect(getAvailableStompboxStyleProfiles({ knobCount: 5 }).map((profile) => profile.id)).toEqual([
            'mxr-style',
        ]);
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
                partId: 'knob-mxr-style-fluted-large',
                face: 'top',
                centerMm: { x: -12.625, y: 30.45 },
                drillDiameterMm: 7.14375,
                provenance: 'auto-generated',
            },
            {
                id: 'knob-LEVEL',
                controlId: 'LEVEL',
                partId: 'knob-mxr-style-fluted-large',
                face: 'top',
                centerMm: { x: 12.625, y: 30.45 },
                drillDiameterMm: 7.14375,
                provenance: 'auto-generated',
            },
            {
                id: 'led-LED1',
                controlId: 'LED1',
                partId: 'led-3mm-red-kento-5408urc',
                face: 'top',
                centerMm: { x: 0, y: -5.075 },
                drillDiameterMm: 3.175,
                provenance: 'auto-generated',
            },
            {
                id: 'switch-SW1',
                controlId: 'SW1',
                partId: 'switch-3pdt-pic-pbs24302',
                face: 'top',
                centerMm: { x: 0, y: -20.3 },
                drillDiameterMm: 12.7,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-IN',
                controlId: 'IN',
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30.25, y: 0 },
                drillDiameterMm: 9.525,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-OUT',
                controlId: 'OUT',
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30.25, y: 0 },
                drillDiameterMm: 9.525,
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'right',
                centerMm: { x: 30.25, y: -12.55 },
                drillDiameterMm: 12.7,
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
                partId: 'knob-mxr-style-fluted-large',
                face: 'top',
                centerMm: { x: -12.625, y: 30.45 },
                provenance: 'auto-generated',
            },
            {
                id: 'knob-LEVEL',
                controlId: 'LEVEL',
                partId: 'knob-mxr-style-fluted-large',
                face: 'top',
                centerMm: { x: 12.625, y: 30.45 },
                provenance: 'auto-generated',
            },
            {
                id: 'led-status',
                controlId: undefined,
                partId: 'led-3mm-red-kento-5408urc',
                face: 'top',
                centerMm: { x: 0, y: -5.075 },
                provenance: 'auto-generated',
            },
            {
                id: 'switch-bypass',
                controlId: undefined,
                partId: 'switch-3pdt-pic-pbs24302',
                face: 'top',
                centerMm: { x: 0, y: -20.3 },
                provenance: 'auto-generated',
            },
            {
                id: 'jack-input',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30.25, y: 0 },
                provenance: 'auto-generated',
            },
            {
                id: 'jack-output',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30.25, y: 0 },
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'right',
                centerMm: { x: 30.25, y: -12.55 },
                provenance: 'auto-generated',
            },
        ]);
    });

    test('uses a merged upper row for one- and two-knob MXR layouts', () => {
        const oneKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['VOLUME']), {
            includePowerJack: false,
        });
        const twoKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['GAIN', 'LEVEL']), {
            includePowerJack: false,
        });

        expect(oneKnobLayout.holes.map((hole) => ({
            id: hole.id,
            partId: hole.partId,
            centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-VOLUME', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 0, y: 30.45 } },
            { id: 'led-status', partId: 'led-3mm-red-kento-5408urc', centerMm: { x: 0, y: -5.075 } },
            { id: 'switch-bypass', partId: 'switch-3pdt-pic-pbs24302', centerMm: { x: 0, y: -20.3 } },
            { id: 'jack-input', partId: 'jack-ts-pj629han', centerMm: { x: 30.25, y: 0 } },
            { id: 'jack-output', partId: 'jack-ts-pj629han', centerMm: { x: -30.25, y: 0 } },
        ]);
        expect(oneKnobLayout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
        expect(twoKnobLayout.holes.map((hole) => ({
            id: hole.id,
            partId: hole.partId,
            centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-GAIN', partId: 'knob-mxr-style-fluted-large', centerMm: { x: -12.625, y: 30.45 } },
            { id: 'knob-LEVEL', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 12.625, y: 30.45 } },
            { id: 'led-status', partId: 'led-3mm-red-kento-5408urc', centerMm: { x: 0, y: -5.075 } },
            { id: 'switch-bypass', partId: 'switch-3pdt-pic-pbs24302', centerMm: { x: 0, y: -20.3 } },
            { id: 'jack-input', partId: 'jack-ts-pj629han', centerMm: { x: 30.25, y: 0 } },
            { id: 'jack-output', partId: 'jack-ts-pj629han', centerMm: { x: -30.25, y: 0 } },
        ]);
        expect(twoKnobLayout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses MXR large knobs for one and two knob default layouts', () => {
        const oneKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['VOLUME']), {
            includePowerJack: false,
        });
        const twoKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['GAIN', 'LEVEL']), {
            includePowerJack: false,
        });
        const twoKnobHoles = twoKnobLayout.holes.filter((hole) => hole.id.startsWith('knob-'));

        expect(oneKnobLayout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-VOLUME', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 0, y: 30.45 } },
        ]);
        expect(twoKnobHoles.map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-GAIN', partId: 'knob-mxr-style-fluted-large', centerMm: { x: -12.625, y: 30.45 } },
            { id: 'knob-LEVEL', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 12.625, y: 30.45 } },
        ]);
        expect(minimumKnobClearanceMm(twoKnobHoles)).toBeGreaterThanOrEqual(5);
    });

    test('sizes the knob grid from the selected enclosure width', () => {
        const oneKnob1590a = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['VOLUME']), {
            enclosureId: 'box-1590a',
            includePowerJack: false,
        });
        const twoKnob1590a = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['GAIN', 'LEVEL']), {
            enclosureId: 'box-1590a',
            includePowerJack: false,
        });
        const twoKnob1590b = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['GAIN', 'LEVEL']), {
            enclosureId: 'box-1590b',
            includePowerJack: false,
        });

        expect(oneKnob1590a.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-VOLUME', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 0, y: 20.625 } },
        ]);
        expect(twoKnob1590a.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-GAIN', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -7.25, y: 20.625 } },
            { id: 'knob-LEVEL', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 7.25, y: 20.625 } },
        ]);
        expect(twoKnob1590b.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-GAIN', partId: 'knob-mxr-style-fluted-large', centerMm: { x: -12.625, y: 30.45 } },
            { id: 'knob-LEVEL', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 12.625, y: 30.45 } },
        ]);
    });

    test('uses MXR-style as the default profile for three normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['SUSTAIN', 'TONE', 'LEVEL']), {
            includePowerJack: false,
        });
        const knobHoles = layout.holes.filter((hole) => hole.id.startsWith('knob-'));

        expect(knobHoles.map((hole) => ({
            id: hole.id,
            partId: hole.partId,
            centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-SUSTAIN', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 0, y: 40.6 } },
            { id: 'knob-TONE', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -12.625, y: 20.3 } },
            { id: 'knob-LEVEL', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 12.625, y: 20.3 } },
        ]);
        expect(minimumKnobClearanceMm(knobHoles)).toBeGreaterThanOrEqual(5);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses Boss-style when explicitly selected for two normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['RATE', 'DEPTH']), {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });

        expect(layout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({
                id: hole.id,
                partId: hole.partId,
                centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-RATE', partId: 'knob-mxr-style-fluted-large', centerMm: { x: -12.625, y: 30.45 } },
            { id: 'knob-DEPTH', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 12.625, y: 30.45 } },
        ]);
    });

    test('uses Boss-style when explicitly selected for three normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['SUSTAIN', 'TONE', 'LEVEL']), {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });

        expect(layout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({
                id: hole.id,
                partId: hole.partId,
                centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-SUSTAIN', partId: 'knob-mxr-style-fluted-large', centerMm: { x: -12.625, y: 40.6 } },
            { id: 'knob-TONE', partId: 'knob-mxr-style-fluted-large', centerMm: { x: 12.625, y: 40.6 } },
            { id: 'knob-LEVEL', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 0, y: 20.3 } },
        ]);
    });

    test('places Boss-style LEDs, side audio jacks, and 9V connector around the three-knob profile', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithBossStyleControls, {
            includePowerJack: true,
            styleProfile: 'boss-style',
        });

        expect(layout.holes.map((hole) => ({
            id: hole.id,
            face: hole.face,
            centerMm: hole.centerMm,
            partId: hole.partId,
        }))).toContainEqual({
            id: 'led-CHECK',
            face: 'top',
            centerMm: { x: 0, y: 49.01 },
            partId: 'led-3mm-red-kento-5408urc',
        });
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'jack-IN',
            face: 'right',
            centerMm: { x: 30.25, y: 5.075 },
        }));
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'jack-OUT',
            face: 'left',
            centerMm: { x: -30.25, y: 5.075 },
        }));
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'power-9v',
            face: 'back',
            centerMm: { x: 0, y: 50.75 },
        }));
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'switch-bypass',
            face: 'top',
            centerMm: { x: 0, y: -30.45 },
        }));
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('places MXR-style audio and power jacks on a five-slot side grid', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement, {
            includePowerJack: true,
        });

        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'jack-IN',
            face: 'right',
            centerMm: { x: 30.25, y: 0 },
        }));
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'jack-OUT',
            face: 'left',
            centerMm: { x: -30.25, y: 0 },
        }));
        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'power-9v',
            face: 'right',
            centerMm: { x: 30.25, y: -12.55 },
        }));
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('stacks multiple audio jacks on the same side face using the Boss-style side grid', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithStackedSideJacks, {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });

        expect(layout.holes
            .filter((hole) => hole.partId === 'jack-ts-pj629han')
            .map((hole) => ({
                id: hole.id,
                face: hole.face,
                centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'jack-IN_A', face: 'right', centerMm: { x: 30.25, y: 5.075 } },
            { id: 'jack-IN_B', face: 'right', centerMm: { x: 30.25, y: -5.075 } },
            { id: 'jack-OUT_A', face: 'left', centerMm: { x: -30.25, y: 5.075 } },
            { id: 'jack-OUT_B', face: 'left', centerMm: { x: -30.25, y: -5.075 } },
        ]);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses MXR-style as the default profile for four normal knobs', () => {
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
            { id: 'knob-A', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -12.625, y: 40.6 } },
            { id: 'knob-B', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 12.625, y: 40.6 } },
            { id: 'knob-C', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -12.625, y: 20.3 } },
            { id: 'knob-D', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 12.625, y: 20.3 } },
        ]);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses Boss-style when explicitly selected for four normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['A', 'B', 'C', 'D']), {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });

        expect(layout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({
                id: hole.id,
                partId: hole.partId,
                centerMm: hole.centerMm,
        }))).toEqual([
            { id: 'knob-A', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -21.75, y: 30.45 } },
            { id: 'knob-B', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -7.25, y: 30.45 } },
            { id: 'knob-C', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 7.25, y: 30.45 } },
            { id: 'knob-D', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 21.75, y: 30.45 } },
        ]);
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('uses MXR-style default rows for five and six normal knobs', () => {
        const fiveKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['A', 'B', 'C', 'D', 'E']), {
            includePowerJack: false,
        });
        const sixKnobLayout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['A', 'B', 'C', 'D', 'E', 'F']), {
            includePowerJack: false,
        });

        expect(fiveKnobLayout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-A', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -12.625, y: 40.6 } },
            { id: 'knob-B', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 12.625, y: 40.6 } },
            { id: 'knob-C', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -16.833, y: 20.3 } },
            { id: 'knob-D', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 0, y: 20.3 } },
            { id: 'knob-E', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 16.833, y: 20.3 } },
        ]);
        expect(sixKnobLayout.holes
            .filter((hole) => hole.id.startsWith('knob-'))
            .map((hole) => ({ id: hole.id, partId: hole.partId, centerMm: hole.centerMm }))).toEqual([
            { id: 'knob-A', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -16.833, y: 40.6 } },
            { id: 'knob-B', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 0, y: 40.6 } },
            { id: 'knob-C', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 16.833, y: 40.6 } },
            { id: 'knob-D', partId: 'knob-davies-1510bg-14mm', centerMm: { x: -16.833, y: 20.3 } },
            { id: 'knob-E', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 0, y: 20.3 } },
            { id: 'knob-F', partId: 'knob-davies-1510bg-14mm', centerMm: { x: 16.833, y: 20.3 } },
        ]);
        expect(fiveKnobLayout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
        expect(sixKnobLayout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
    });

    test('keeps the Boss-style LED row above four normal knobs', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithPotentiometers(['A', 'B', 'C', 'D'], `
  - id: CHECK
    kind: led
    name: Check
    origin:
      x: 80
      y: 40
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Color: red
    sourceTypeName: "Circuit.LED, Circuit"`), {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });

        expect(layout.holes).toContainEqual(expect.objectContaining({
            id: 'led-CHECK',
            face: 'top',
            centerMm: { x: 0, y: 49.01 },
        }));
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
                centerMm: { x: 0, y: -40.6 },
                drillDiameterMm: 12.7,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-input',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'right',
                centerMm: { x: 30.25, y: 0 },
                drillDiameterMm: 9.525,
                provenance: 'auto-generated',
            },
            {
                id: 'jack-output',
                controlId: undefined,
                partId: 'jack-ts-pj629han',
                face: 'left',
                centerMm: { x: -30.25, y: 0 },
                drillDiameterMm: 9.525,
                provenance: 'auto-generated',
            },
            {
                id: 'power-9v',
                controlId: undefined,
                partId: 'dc-socket-dc099',
                face: 'right',
                centerMm: { x: 30.25, y: -12.55 },
                drillDiameterMm: 12.7,
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

    test('reports configurable part-clearance violations without treating them as collisions', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithTightKnobClearance, {
            includePowerJack: false,
            minPartClearanceMm: 5,
        });

        expect(layout.diagnostics).toContainEqual({
            code: 'placement-clearance',
            message: 'Placements "knob-a" and "knob-b" have 4 mm clearance on top, below required 5 mm',
            placementId: 'knob-a',
            face: 'top',
        });
        expect(layout.diagnostics.some((diagnostic) => diagnostic.code === 'placement-collision')).toBe(false);
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
        expect(template.canvasMm).toEqual({ widthMm: 122.5, heightMm: 173.5 });
        expect(template.scaleMarks).toEqual([]);
        expect(template.holeTable).toEqual([]);
        expect(template.holes).toHaveLength(7);
        expect(template.holes.find((hole) => hole.id === 'knob-GAIN')?.templateCenterMm).toEqual({ x: 48.625, y: 56.3 });
        expect(template.holes.find((hole) => hole.id === 'jack-IN')?.templateCenterMm).toEqual({ x: 107, y: 86.75 });
        expect(template.holes.find((hole) => hole.id === 'jack-OUT')?.templateCenterMm).toEqual({ x: 15.5, y: 86.75 });
        expect(template.holes.find((hole) => hole.id === 'power-9v')?.templateCenterMm).toEqual({ x: 107, y: 99.3 });
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
            { id: 'knob-GAIN', face: 'top', centerMm: { x: -12.625, y: 30.45 }, drillDiameterMm: 7.14375, provenance: 'auto-generated' },
            { id: 'knob-LEVEL', face: 'top', centerMm: { x: 12.625, y: 30.45 }, drillDiameterMm: 7.14375, provenance: 'auto-generated' },
            { id: 'led-LED1', face: 'top', centerMm: { x: 0, y: -5.075 }, drillDiameterMm: 3.175, provenance: 'auto-generated' },
            { id: 'switch-SW1', face: 'top', centerMm: { x: 0, y: -20.3 }, drillDiameterMm: 12.7, provenance: 'auto-generated' },
            { id: 'jack-IN', face: 'right', centerMm: { x: 30.25, y: 0 }, drillDiameterMm: 9.525, provenance: 'auto-generated' },
            { id: 'jack-OUT', face: 'left', centerMm: { x: -30.25, y: 0 }, drillDiameterMm: 9.525, provenance: 'auto-generated' },
            { id: 'power-9v', face: 'right', centerMm: { x: 30.25, y: -12.55 }, drillDiameterMm: 12.7, provenance: 'auto-generated' },
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
        expect(previewSvg).toContain('viewBox="0 0 122.5 173.5"');
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
        expect(previewSvg).toContain('data-provenance="auto-generated"');
        expect(previewSvg).toContain('data-hole-id="jack-IN" data-part-profile-id="jack-ts-pj629han" data-face="right" data-template-face="right" data-provenance="auto-generated" data-drill-diameter-mm="9.525" data-drill-radius-mm="4.7625" data-part-visible-diameter-mm="11"');
        expect(previewSvg).toContain('data-hole-id="jack-OUT" data-part-profile-id="jack-ts-pj629han" data-face="left" data-template-face="left" data-provenance="auto-generated" data-drill-diameter-mm="9.525" data-drill-radius-mm="4.7625" data-part-visible-diameter-mm="11"');
        expect(previewSvg).toContain('data-hole-id="power-9v" data-part-profile-id="dc-socket-dc099" data-face="right" data-template-face="right" data-provenance="auto-generated" data-drill-diameter-mm="12.7" data-drill-radius-mm="6.35" data-part-visible-diameter-mm="14.1"');
        expect(drillTemplateLabelY(previewSvg, 'power-9v', '9V DC'))
            .toBeGreaterThan(drillTemplateOuterCircleBottom(previewSvg, 'power-9v'));
        expect(previewSvg).toContain('data-drill-hole-profile-id="audio-jack-24mm-pot-3-8"');
        expect(previewSvg).toContain('data-drill-hole-profile-id="dc-jack-3pdt-1-2"');
        expect(previewSvg).toContain('data-drill-hole-profile-id="three-mm-led-1-8"');
        expect(previewSvg).toContain('data-drill-hole-profile-fraction-inches="3/8&quot;"');
        expect(previewSvg).toContain('class="hole drill-hole-profile-outer"');
        expect(previewSvg).toContain('class="drill-hole-center-dot"');
        expect(previewSvg).toContain('r="4.7625"');
        expect(previewSvg).toContain('r="6.35"');
        expect(previewSvg).not.toContain('class="crosshair"');
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
        expect(printSvg).toContain('<text class="label"');
        expect(printSvg).toContain('>Gain</text>');
        expect(printSvg).toContain('>Level</text>');
        expect(printSvg).toContain('>Status</text>');
        expect(printSvg).not.toContain('>Bypass</text>');
        expect(printSvg).toContain('>Input</text>');
        expect(printSvg).toContain('>Output</text>');
        expect(printSvg).toContain('>9V DC</text>');
        expect(printSvg).toContain('power-9v');
        expect(drillTemplateLabelY(printSvg, 'power-9v', '9V DC'))
            .toBeGreaterThan(drillTemplateOuterCircleBottom(printSvg, 'power-9v'));
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

    test('applies programmable appearance to drill-template enclosure, holes, guides, and labels', () => {
        const layout = createStompboxDrillLayoutFromVdsp(vdspWithoutPhysicalPlacement);
        const svg = createStompboxDrillTemplateSvg(layout, {
            mode: 'preview',
            appearance: {
                enclosure: {
                    color: '#ffedd5',
                    strokeColor: '#9a3412',
                },
                template: {
                    guideColor: '#0ea5e9',
                    foldColor: '#f97316',
                    holeStrokeColor: '#7c3aed',
                    holeFillColor: '#faf5ff',
                    centerDotColor: '#581c87',
                },
                defaults: {
                    label: { color: '#14532d' },
                },
                controls: {
                    GAIN: { label: { text: 'DRIVE', color: '#166534' } },
                },
            },
        });

        expect(svg).toContain('data-face-panel="top"');
        expect(svg).toContain('class="panel top-panel enclosure"');
        expect(svg).toContain('fill="#ffedd5"');
        expect(svg).toContain('stroke="#9a3412"');
        expect(svg).toContain('class="fold-line"');
        expect(svg).toContain('stroke="#f97316"');
        expect(svg).toContain('class="guide-line"');
        expect(svg).toContain('stroke="#0ea5e9"');
        expect(svg).toContain('class="hole drill-hole-profile-outer"');
        expect(svg).toContain('fill="#faf5ff"');
        expect(svg).toContain('stroke="#7c3aed"');
        expect(svg).toContain('class="drill-hole-center-dot"');
        expect(svg).toContain('fill="#581c87"');
        expect(svg).toContain('<text class="label"');
        expect(svg).toContain('fill="#166534"');
        expect(svg).toContain('>DRIVE</text>');
        expect(svg).toContain('fill="#14532d"');
    });
});

describe('stompbox preview manifest', () => {
    test('normalizes text and SVG customization decals for preview outputs', () => {
        const preview = createStompboxPreviewFromVdsp(vdspWithoutPhysicalPlacement, {
            decals: customDecals,
        });

        expect(preview.decals.slice(0, 2)).toEqual([
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
        expect(preview.decals).toContainEqual(expect.objectContaining({
            id: 'label-knob-GAIN',
            kind: 'text',
            text: 'GAIN',
        }));
    });

    test('adds style-aware labels for every preview control', () => {
        const mxrPreview = createStompboxPreviewFromVdsp(vdspWithoutPhysicalPlacement, {
            includePowerJack: true,
        });
        const bossPreview = createStompboxPreviewFromVdsp(vdspWithBossStyleControls, {
            includePowerJack: true,
            styleProfile: 'boss-style',
        });
        const bossSynthesizedLedPreview = createStompboxPreviewFromVdsp(vdspWithPotentiometers(['A', 'B', 'C']), {
            includePowerJack: false,
            styleProfile: 'boss-style',
        });
        const opaqueJackPreview = createStompboxPreviewFromVdsp(vdspWithOpaqueJackNames, {
            includePowerJack: false,
        });

        expect(mxrPreview.decals
            .filter((decal) => decal.id.startsWith('label-'))
            .map((decal) => ({
                id: decal.id,
                kind: decal.kind,
                text: decal.kind === 'text' ? decal.text : '',
                face: decal.face,
                rotationDeg: decal.rotationDeg,
        }))).toEqual([
            { id: 'label-knob-GAIN', kind: 'text', text: 'GAIN', face: 'top', rotationDeg: 0 },
            { id: 'label-knob-LEVEL', kind: 'text', text: 'LEVEL', face: 'top', rotationDeg: 0 },
            { id: 'label-led-LED1', kind: 'text', text: 'STATUS', face: 'top', rotationDeg: 0 },
            { id: 'label-jack-IN', kind: 'text', text: 'INPUT', face: 'top', rotationDeg: -90 },
            { id: 'label-jack-OUT', kind: 'text', text: 'OUTPUT', face: 'top', rotationDeg: -90 },
            { id: 'label-power-9v', kind: 'text', text: '9V DC', face: 'right', rotationDeg: 0 },
        ]);
        expect(mxrPreview.decals.some((decal) => decal.id.startsWith('label-switch-'))).toBe(false);
        expect(bossPreview.decals.some((decal) => decal.id.startsWith('label-switch-'))).toBe(false);
        expect(mxrPreview.drillLayout.holes.find((hole) => hole.id === 'switch-SW1')?.label).toBeUndefined();

        expect(bossPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-led-CHECK',
            kind: 'text',
            text: 'CHECK',
            face: 'top',
        }));
        expect(bossPreview.decals.find((decal) => decal.id === 'label-led-CHECK')?.centerMm.y)
            .toBeGreaterThan(bossPreview.drillLayout.holes.find((hole) => hole.id === 'led-CHECK')?.centerMm.y ?? 0);
        expect(bossPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-jack-IN',
            kind: 'text',
            text: 'INPUT',
            face: 'top',
            rotationDeg: 0,
        }));
        expect(bossPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-jack-OUT',
            kind: 'text',
            text: 'OUTPUT',
            face: 'top',
            rotationDeg: 0,
        }));
        expect(bossPreview.decals.find((decal) => decal.id === 'label-jack-IN')?.centerMm.y).toBe(5.075);
        expect(bossPreview.decals.find((decal) => decal.id === 'label-jack-OUT')?.centerMm.y).toBe(5.075);
        expect(bossSynthesizedLedPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-led-status',
            kind: 'text',
            text: 'CHECK',
            face: 'top',
        }));
        expect(opaqueJackPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-jack-J1',
            kind: 'text',
            text: 'INPUT',
            face: 'top',
        }));
        expect(opaqueJackPreview.decals).toContainEqual(expect.objectContaining({
            id: 'label-jack-J2',
            kind: 'text',
            text: 'OUTPUT',
            face: 'top',
        }));
    });

    test('applies programmable appearance to preview parts, labels, SVG hooks, and GLB metadata', () => {
        const appearance = {
            enclosure: { color: '#f97316', strokeColor: '#7c2d12', roughnessFactor: 0.45 },
            defaults: {
                knob: { color: '#111827', indicatorColor: '#f8fafc', strokeColor: '#020617' },
                led: { color: '#ef4444', offColor: '#fee2e2', strokeColor: '#7f1d1d' },
                label: { color: '#111827', fontFamily: 'Arial,sans-serif' },
            },
            controls: {
                GAIN: {
                    knob: { color: '#facc15', indicatorColor: '#111827', strokeColor: '#854d0e' },
                    label: { text: 'DRIVE', color: '#ffffff' },
                },
                LED1: {
                    led: { color: '#22c55e', offColor: '#064e3b', strokeColor: '#052e16' },
                    label: { text: 'READY', color: '#16a34a' },
                },
            },
        } as const;
        const preview = createStompboxPreviewFromVdsp(vdspWithoutPhysicalPlacement, {
            appearance,
            state: {
                LED1: { kind: 'led', on: true, intensity: 0.6 },
            },
        });
        const views = createStompboxPreviewSvgViewsFromVdsp(vdspWithoutPhysicalPlacement, {
            appearance,
            state: {
                LED1: { kind: 'led', on: true, intensity: 0.6 },
            },
        });
        const assembly = createStompboxPreviewGlbFromVdsp(vdspWithoutPhysicalPlacement, {
            appearance,
            basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
            state: {
                LED1: { kind: 'led', on: true, intensity: 0.6 },
            },
        });
        const gltf = parseJsonChunkFromGlb(assembly.bytes);
        const patch = createStompboxAppearancePatch(preview);
        const resolved = resolveStompboxAppearance(preview);

        expect(preview.enclosure.material).toEqual({
            color: '#f97316',
            strokeColor: '#7c2d12',
            roughnessFactor: 0.45,
        });
        expect(preview.parts.find((part) => part.id === 'knob-GAIN')?.material).toEqual({
            color: '#facc15',
            indicatorColor: '#111827',
            strokeColor: '#854d0e',
        });
        expect(preview.parts.find((part) => part.id === 'knob-LEVEL')?.material).toEqual({
            color: '#111827',
            indicatorColor: '#f8fafc',
            strokeColor: '#020617',
        });
        expect(preview.parts.find((part) => part.id === 'led-LED1')?.material).toEqual({
            color: '#22c55e',
            emissive: true,
            intensity: 0.6,
            offColor: '#064e3b',
            strokeColor: '#052e16',
        });
        expect(preview.decals.find((decal) => decal.id === 'label-knob-GAIN')).toEqual(expect.objectContaining({
            kind: 'text',
            text: 'DRIVE',
            color: '#ffffff',
        }));
        expect(preview.decals.find((decal) => decal.id === 'label-led-LED1')).toEqual(expect.objectContaining({
            kind: 'text',
            text: 'READY',
            color: '#16a34a',
        }));

        expect(patch).toEqual(resolved);
        expect(patch.enclosure).toEqual({
            targetId: 'enclosure-box-1590b',
            color: '#f97316',
            strokeColor: '#7c2d12',
            roughnessFactor: 0.45,
        });
        expect(patch.parts['part-knob-GAIN']).toEqual({
            targetId: 'part-knob-GAIN',
            partId: 'knob-mxr-style-fluted-large',
            controlId: 'GAIN',
            family: 'knob',
            color: '#facc15',
            indicatorColor: '#111827',
            strokeColor: '#854d0e',
        });
        expect(patch.parts['part-led-LED1']).toEqual({
            targetId: 'part-led-LED1',
            partId: 'led-3mm-red-kento-5408urc',
            controlId: 'LED1',
            family: 'led',
            color: '#22c55e',
            emissive: true,
            intensity: 0.6,
            offColor: '#064e3b',
            strokeColor: '#052e16',
        });
        expect(patch.decals['decal-label-knob-GAIN']).toEqual({
            targetId: 'decal-label-knob-GAIN',
            decalId: 'label-knob-GAIN',
            kind: 'text',
            face: 'top',
            text: 'DRIVE',
            color: '#ffffff',
            fontFamily: 'Arial,sans-serif',
            fontSizeMm: 3.2,
        });

        expect(views.views.top).toContain('data-part-family="knob"');
        expect(views.views.top).toContain('data-control-id="GAIN"');
        expect(views.views.top).toContain('class="knob-body"');
        expect(views.views.top).toContain('fill="#facc15"');
        expect(views.views.top).toContain('stroke="#854d0e"');
        expect(views.views.top).toContain('class="knob-indicator"');
        expect(views.views.top).toContain('stroke="#111827"');
        expect(views.views.top).toContain('class="led-lens"');
        expect(views.views.top).toContain('fill="#22c55e"');
        expect(views.views.top).toContain('>DRIVE</text>');
        expect(views.views.top).toContain('class="label-text"');
        expect(views.views.top).toContain('fill="#ffffff"');

        const extras = gltfExtras(gltf.asset?.extras);
        const appearanceExtras = extras.appearance as typeof patch;
        expect(appearanceExtras.parts['part-knob-GAIN']?.color).toBe('#facc15');
        expect(appearanceExtras.decals['decal-label-knob-GAIN']?.text).toBe('DRIVE');
        const gainNode = gltf.nodes?.find((node) => node.name === 'part-knob-GAIN');
        expect(gltfExtras(gainNode?.extras).material).toEqual({
            color: '#facc15',
            indicatorColor: '#111827',
            strokeColor: '#854d0e',
        });
        expect(gltf.materials?.some((material) =>
            material.name?.startsWith('knob-GAIN/')
            && material.pbrMetallicRoughness?.baseColorFactor?.[0] === 250 / 255
            && material.pbrMetallicRoughness.baseColorFactor[1] === 204 / 255
            && material.pbrMetallicRoughness.baseColorFactor[2] === 21 / 255
        )).toBe(true);
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
        expect(gain.transform.translationMm).toEqual({ x: -12.625, y: 30.45, z: 15.5 });
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
                translationMm: { x: 0, y: -40.6, z: 15.5 },
            },
            {
                id: 'jack-input',
                partId: 'jack-ts-pj629han',
                provenance: 'auto-generated',
                glb: '/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb',
                translationMm: { x: 30.25, y: 0, z: 0 },
            },
            {
                id: 'jack-output',
                partId: 'jack-ts-pj629han',
                provenance: 'auto-generated',
                glb: '/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb',
                translationMm: { x: -30.25, y: 0, z: 0 },
            },
            {
                id: 'power-9v',
                partId: 'dc-socket-dc099',
                provenance: 'auto-generated',
                glb: '/cad/parts/dc-socket-dc099/.dc099.step.glb',
                translationMm: { x: 30.25, y: -12.55, z: 0 },
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
        expect(views.views.top).toContain('data-decal-id="label-knob-GAIN"');
        expect(views.views.top).toContain('GAIN');
        expect(views.views.top).toContain('data-decal-id="label-jack-IN"');
        expect(views.views.top).toContain('INPUT');
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
        expect(assembly.preview.decals.slice(0, 2).map((decal) => decal.id)).toEqual(['brand', 'badge']);
        expect(assembly.preview.decals.map((decal) => decal.id)).toContain('label-knob-GAIN');

        const gainNode = nodes.find((node) => node.name === 'part-knob-GAIN');
        const switchNode = nodes.find((node) => node.name === 'part-switch-SW1');
        const brandNode = nodes.find((node) => node.name === 'decal-brand');
        const badgeNode = nodes.find((node) => node.name === 'decal-badge');
        const gainLabelNode = nodes.find((node) => node.name === 'decal-label-knob-GAIN');
        expect(gainNode?.children?.length).toBeGreaterThan(0);
        expect(gainNode?.translation).toEqual([-12.625, 30.45, 15.5]);
        expect(gainNode?.rotation).toEqual([0, 0, 0.92388, 0.382683]);
        expect(gltfExtras(gainNode?.extras).glb).toBe(
            join(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT, 'knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb'),
        );
        expect(switchNode?.translation).toEqual([0, -20.3, 14.3]);
        expect(brandNode?.translation).toEqual([0, 9, 15.7]);
        expect(brandNode?.rotation).toEqual([0, 0, 0, 1]);
        expect(gltfExtras(brandNode?.extras).kind).toBe('decal');
        expect(gltfExtras(brandNode?.extras).decalKind).toBe('text');
        expect(gltfExtras(brandNode?.extras).text).toBe('Fuzz Lab');
        expect(gltfExtras(badgeNode?.extras).decalKind).toBe('svg');
        expect(gltfExtras(badgeNode?.extras).svg).toContain('<path');
        expect(gltfExtras(gainLabelNode?.extras).decalKind).toBe('text');
        expect(gltfExtras(gainLabelNode?.extras).text).toBe('GAIN');
    });
});
