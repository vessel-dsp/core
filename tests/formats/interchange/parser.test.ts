import { describe, expect, test } from 'bun:test';
import {
    EMPTY_DOCUMENT,
    isParsedQuantity,
    parseCircuitDocument,
    parseInterchangeYaml,
    serializeInterchangeYaml,
    type CircuitDocument,
} from '../../../packages/core/src';

const source = `<?xml version="1.0" encoding="utf-8"?>
<Schematic Name="Test filter">
  <Element Type="Circuit.Symbol, Circuit" Position="0,0" Rotation="0" Flip="false">
    <Component _Type="Circuit.Resistor, Circuit" Name="R1" Resistance="10 kΩ" Wipe="0.5" />
  </Element>
  <Element Type="Circuit.Symbol, Circuit" Position="0,80" Rotation="0" Flip="false">
    <Component _Type="Circuit.Ground, Circuit" Name="GND" />
  </Element>
  <Element Type="Circuit.Wire, Circuit" A="0,20" B="0,80" />
</Schematic>`;

const runtimeDescriptorSource = `<?xml version="1.0" encoding="utf-8"?>
<Schematic Name="Runtime descriptor">
  <Element Type="Circuit.Symbol, Circuit" Position="-300,140" Rotation="0" Flip="false">
    <Component _Type="Circuit.Input, Circuit" Name="V1" />
  </Element>
  <Element Type="Circuit.Symbol, Circuit" Position="0,140" Rotation="0" Flip="false">
    <Component _Type="Circuit.MicroBlockDelayChip, Circuit" Name="U1" Profile="BbdMn3007Style" StereoOutputMode="WetDry" Feedback="1e-12" Level="1.0" />
  </Element>
  <Element Type="Circuit.Symbol, Circuit" Position="200,140" Rotation="0" Flip="false">
    <Component _Type="Circuit.MicroBlockReverb, Circuit" Name="U2" Profile="hall-style" StereoOutputMode="Spread" Decay="0.72" />
  </Element>
  <Element Type="Circuit.Symbol, Circuit" Position="400,140" Rotation="0" Flip="false">
    <Component _Type="Circuit.Speaker, Circuit" Name="S1" />
  </Element>
  <Element Type="Circuit.Wire, Circuit" A="-300,120" B="0,120" />
  <Element Type="Circuit.Wire, Circuit" A="0,160" B="200,120" />
  <Element Type="Circuit.Wire, Circuit" A="200,160" B="400,120" />
</Schematic>`;

const V3_MECHANICAL_BOARD_URL = new URL(
    '../../fixtures/interchange/vdsp-v3-mechanical-board-realization.vdsp',
    import.meta.url,
);

describe('parseInterchangeYaml', () => {
    test('parses circuit-interchange/v3 mechanical build metadata without dropping physical fields', async () => {
        const yaml = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.build).toMatchObject({
            schema: 'build-scope/v1',
            intent: 'diy-build-artifact',
            completeness: 'complete-selected-build',
            selectedBoardId: 'main-vero',
            selectedOffBoardWiringHarnessIds: ['panel-to-board'],
            alternateBoardIds: ['perfboard-alt', 'breadboard-pattern-proto', 'fabricated-pcb'],
            bomScope: 'selected-board-plus-shared-build-items',
        });
        expect(parsed.mechanical?.enclosure).toMatchObject({
            profileId: 'enclosure-1590b',
            label: 'Hammond 1590B',
        });
        expect(parsed.bom?.items.some((item) => item.id === 'bom-dc-jack' && item.sku === 'JACK-DC-2.1MM')).toBe(true);
        expect(parsed.partProfiles?.profiles.some((profile) => profile.id === 'dc-jack-2.1mm-panel')).toBe(true);
        expect(parsed.footprints?.footprints.some((footprint) => footprint.id === 'axial-resistor-7.5mm-through-hole')).toBe(true);
        expect(parsed.offBoardWiring?.coverage).toBe('selected-build-complete');
        expect(parsed.offBoardWiring?.harnesses[0]?.status).toBe('complete');
        expect(parsed.panel?.faces[0]?.geometry).toMatchObject({
            units: 'mm',
            surface: 'top',
        });
        expect(parsed.panel?.faces[0]?.elements[2]).toMatchObject({
            id: 'panel-tone-mode',
            kind: 'selector',
            physical: {
                units: 'mm',
                drillDiameterMm: 6.5,
                partProfileId: 'toggle-spdt-mini',
                locked: true,
            },
        });
        expect(parsed.panel?.faces[0]?.elements[4]?.kind).toBe('footswitch');
        expect(parsed.boards?.map((board) => [board.id, board.family, board.kind, board.subtype])).toEqual([
            ['main-vero', 'prototype-board', 'stripboard', 'veroboard'],
            ['perfboard-alt', 'prototype-board', 'perfboard', 'isolated-pad'],
            ['breadboard-pattern-proto', 'prototype-board', 'breadboard-pattern', 'solderable-half-breadboard'],
            ['fabricated-pcb', 'fabricated-board', 'pcb', 'single-sided-through-hole'],
        ]);
        expect(parsed.boards?.[0]?.sourceCircuit?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(parsed.boards?.[3]?.routes[0]?.locked).toBe(false);
        expect(parsed.boards?.[3]?.zones?.[0]?.id).toBe('ground-fill-bottom');
        expect(parsed.boards?.[3]?.drills?.[0]?.id).toBe('mounting-hole-1');
    });

    test('rejects v3 build metadata with unknown strict enum values', () => {
        const yaml = `schema: circuit-interchange/v3
metadata:
  name: Bad v3 enum
  description: ""
  partNumber: ""
source: {}
build:
  schema: build-scope/v1
  intent: product-build
  completeness: complete-selected-build
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('build.intent');
    });

    test('rejects reviewed board source hashes that are not digest-shaped', () => {
        const yaml = `schema: circuit-interchange/v3
metadata:
  name: Bad v3 hash
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
boards:
  - id: main-vero
    schema: circuit-board/v1
    family: prototype-board
    kind: stripboard
    subtype: veroboard
    source: user-customized
    units: mm
    locked: true
    sourceCircuit:
      schema: canonical-circuit-facts-hash/v1
      hashAlgorithm: sha256
      hash: sha256:reviewed-canonical-circuit-facts
    prototypeGrid:
      pitchMm: 2.54
      rows: 1
      columns: 1
      copperPattern:
        kind: row-strips
        stripAxis: horizontal
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('boards[0].sourceCircuit.hash');
    });

    test('round-trips device interface groups, contexts, semantic controls, and panel joins', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            metadata: {
                name: 'Channel interface',
                description: 'Declared semantic controls with placement joins.',
                partNumber: '',
            },
            controlGroups: [{
                id: 'channel-1-panel',
                name: 'Channel 1',
                role: 'channel-section',
                contextIds: ['channel-1'],
                members: [{
                    controlId: 'ch1-gain',
                    order: 1,
                    appliesWhen: {
                        anyOf: ['channel-1'],
                    },
                    description: 'First control in the Channel 1 strip.',
                }],
            }],
            controlContexts: [{
                id: 'channel-1',
                name: 'Channel 1',
                role: 'channel',
            }],
            deviceInterface: {
                controls: [{
                    id: 'ch1-gain',
                    label: 'Gain',
                    kind: 'knob',
                    role: 'gain',
                    binding: {
                        componentId: 'CH1_GAIN',
                        controlId: 'CH1_GAIN',
                        property: 'Wipe',
                    },
                    appliesWhen: {
                        allOf: ['channel-1'],
                    },
                    description: 'Channel 1 preamp gain.',
                }],
            },
            components: [{
                id: 'CH1_GAIN',
                kind: 'potentiometer',
                name: 'Gain',
                origin: { x: 0, y: 0 },
                rotation: 0,
                flipped: false,
                terminals: [],
                properties: {
                    R: { raw: '1 MΩ', value: 1_000_000, unit: 'Ω' },
                    Wipe: '0.5',
                },
                sourceTypeName: 'Circuit.Potentiometer',
            }],
            panel: {
                faces: [{
                    id: 'front',
                    layout: {
                        kind: 'stompbox-grid',
                        rows: 1,
                        columns: 1,
                        indexing: 'one-based',
                    },
                    elements: [{
                        bind: {
                            componentId: 'CH1_GAIN',
                            controlId: 'CH1_GAIN',
                        },
                        kind: 'knob',
                        interfaceControlId: 'ch1-gain',
                        grid: { row: 1, column: 1 },
                    }],
                }],
            },
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);

        expect(yaml).toContain('controlGroups:');
        expect(yaml).toContain('members:');
        expect(yaml).toContain('controlId: ch1-gain');
        expect(yaml).toContain('controlContexts:');
        expect(yaml).toContain('deviceInterface:');
        expect(yaml).toContain('interfaceControlId: ch1-gain');
        expect(parsed.controlGroups).toEqual(doc.controlGroups);
        expect(parsed.controlContexts).toEqual(doc.controlContexts);
        expect(parsed.deviceInterface).toEqual(doc.deviceInterface);
        expect(parsed.panel).toEqual(doc.panel);
    });

    test('round-trips named panel faces with bound element placement metadata', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            metadata: {
                name: 'Three knob drive',
                description: 'Grid-annotated stompbox control surface.',
                partNumber: '',
            },
            components: [{
                id: 'LEVEL',
                kind: 'potentiometer',
                name: 'Level',
                origin: { x: 0, y: 0 },
                rotation: 0,
                flipped: false,
                terminals: [
                    { name: 'a', position: { x: 0, y: -20 } },
                    { name: 'wiper', position: { x: 20, y: 0 } },
                    { name: 'b', position: { x: 0, y: 20 } },
                ],
                properties: {
                    Resistance: { raw: '100 kΩ', value: 100_000, unit: 'Ω' },
                    Wipe: '0.8',
                    Sweep: 'Logarithmic',
                },
                sourceTypeName: 'Circuit.Potentiometer',
            }],
            panel: {
                faces: [{
                    id: 'top',
                    label: 'Top',
                    layout: {
                        kind: 'stompbox-grid',
                        rows: 2,
                        columns: 3,
                        indexing: 'one-based',
                        rowOrder: 'top-to-bottom',
                        columnOrder: 'left-to-right',
                    },
                    elements: [{
                        bind: {
                            componentId: 'LEVEL',
                            controlId: 'LEVEL',
                        },
                        kind: 'knob',
                        grid: {
                            row: 1,
                            column: 3,
                            rowSpan: 1,
                            columnSpan: 1,
                        },
                        label: 'Level',
                    }],
                }],
            },
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);

        expect(yaml).toContain('panel:');
        expect(yaml).toContain('faces:');
        expect(yaml).toContain('elements:');
        expect(yaml).toContain('bind:');
        expect(yaml).toContain('kind: stompbox-grid');
        expect(yaml).toContain('indexing: one-based');
        expect(yaml).toContain('componentId: LEVEL');
        expect(yaml).toContain('controlId: LEVEL');
        expect(yaml).toContain('rowSpan: 1');
        expect(parsed.panel).toEqual(doc.panel);
    });

    test('round-trips audio jack subtype and label metadata as component properties', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            metadata: {
                name: 'BF-3 style routing',
                description: 'Multiple source-visible audio jacks.',
                partNumber: '',
            },
            components: [{
                id: 'J_OUT_A',
                kind: 'jack',
                name: 'J_OUT_A',
                origin: { x: 120, y: 40 },
                rotation: 0,
                flipped: false,
                terminals: [
                    { name: 'tip', position: { x: 120, y: 40 } },
                    { name: 'sleeve', position: { x: 120, y: 60 } },
                ],
                properties: {
                    Role: 'output',
                    Interface: 'audio',
                    AudioRole: 'output-a-mono',
                    JackLabel: 'Output A (Mono)',
                    Label: 'Output A',
                },
                sourceTypeName: 'Circuit.Speaker',
            }],
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);

        expect(yaml).toContain('AudioRole: output-a-mono');
        expect(yaml).toContain('JackLabel: "Output A (Mono)"');
        expect(parsed.components[0]?.properties).toEqual(doc.components[0]?.properties);
    });

    test('parses panel faces with multi-control runtime descriptor bindings', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: DD-3 panel
  description: ""
  partNumber: ""
source: {}
panel:
  faces:
    - id: top
      label: Top
      layout:
        kind: stompbox-grid
        rows: 1
        columns: 4
        indexing: one-based
      elements:
        - bind:
            componentId: U1
            controlId: "U1:time"
          kind: knob
          label: D.TIME
          grid:
            row: 1
            column: 3
        - bind:
            componentId: U1
            controlId: "U1:mode"
          kind: switch
          label: MODE
          grid:
            row: 1
            column: 4
    - id: right-side
      layout:
        kind: stompbox-grid
        rows: 2
        columns: 1
        indexing: one-based
      elements:
        - bind:
            componentId: V1
          kind: jack
          label: Input
          grid:
            row: 1
            column: 1
        - bind:
            componentId: U1
            controlId: "U1:direct-out"
          kind: jack
          label: Direct Out
          grid:
            row: 2
            column: 1
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.panel?.faces).toHaveLength(2);
        expect(parsed.panel?.faces[0]?.elements.map((element) => element.bind.controlId)).toEqual([
            'U1:time',
            'U1:mode',
        ]);
        expect(parsed.panel?.faces[1]?.elements[1]).toMatchObject({
            bind: { componentId: 'U1', controlId: 'U1:direct-out' },
            kind: 'jack',
            label: 'Direct Out',
            grid: { row: 2, column: 1 },
        });
    });

    test('normalizes legacy single-grid controls to one top face', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Legacy panel
  description: ""
  partNumber: ""
source: {}
panel:
  layout:
    kind: stompbox-grid
    rows: 1
    columns: 2
    indexing: one-based
  controls:
    - componentId: LEVEL
      controlKind: knob
      grid:
        row: 1
        column: 2
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.panel).toEqual({
            faces: [{
                id: 'top',
                layout: {
                    kind: 'stompbox-grid',
                    rows: 1,
                    columns: 2,
                    indexing: 'one-based',
                },
                elements: [{
                    bind: { componentId: 'LEVEL' },
                    kind: 'knob',
                    grid: { row: 1, column: 2 },
                }],
            }],
        });
    });

    test('round-trips external control interface metadata', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            metadata: {
                name: 'Boss DD-3 external controls',
                description: 'Runtime controls that are not panel toggles.',
                partNumber: '',
            },
            controlInterfaces: [
                {
                    id: 'trigger-input',
                    name: 'TRIGGER external',
                    role: 'trigger',
                    controlRole: 'sampler-trigger',
                    interface: 'external-control-input',
                    connector: '1/4-inch-mono-ts',
                    assignmentHint: 'momentary-or-latching',
                    polarity: 'normally-open',
                    binding: {
                        sourceComponentId: 'U1',
                        controlId: 'U1:sampler-trigger',
                        controlName: 'TRIGGER',
                        property: 'SamplerTriggerControl',
                    },
                    description: 'Sampler record/play trigger input.',
                },
                {
                    id: 'reset-input',
                    name: 'RESET external',
                    role: 'reset',
                    controlRole: 'reset',
                    interface: 'external-control-input',
                    connector: '1/4-inch-mono-ts',
                    assignmentHint: 'momentary-or-latching',
                    polarity: 'normally-open',
                    binding: {
                        sourceComponentId: 'U1',
                        controlId: 'U1:reset',
                        controlName: 'RESET',
                        property: 'ResetControl',
                    },
                },
            ],
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);

        expect(yaml).toContain('controlInterfaces:');
        expect(parsed.controlInterfaces).toEqual(doc.controlInterfaces);
    });

    test('round-trips standalone control accessory device metadata and outputs', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            metadata: {
                name: 'Boss FS-5U Foot Switch',
                description: 'Momentary external footswitch accessory.',
                partNumber: 'FS-5U',
            },
            device: {
                id: 'boss-fs-5u',
                version: 1,
                kind: 'control-accessory',
                family: 'external-footswitch',
                model: 'boss-fs-5u',
                audioProcessing: false,
            },
            controlOutputs: [{
                id: 'output',
                name: 'Output',
                role: 'external-control',
                connector: '1/4-inch-mono-ts',
                switchMode: 'momentary',
                polarity: 'normally-open',
                inactiveValue: 0,
                activeValue: 1,
                componentId: 'J1',
                description: 'Mono TS contact-closure output.',
            }],
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.device).toEqual(doc.device);
        expect(parsed.controlOutputs).toEqual(doc.controlOutputs);
    });

    test('rejects unsupported standalone control accessory schema values', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad accessory
  description: ""
  partNumber: ""
source: {}
device:
  id: bad-accessory
  version: 1
  kind: audio-widget
controlOutputs:
  - id: output
    name: Output
    role: external-control
    switchMode: push-push
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('device.kind');
    });

    test('rejects unsupported standalone control accessory output switch modes', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad accessory output
  description: ""
  partNumber: ""
source: {}
device:
  id: bad-accessory
  version: 1
  kind: control-accessory
controlOutputs:
  - id: output
    name: Output
    role: external-control
    switchMode: push-push
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('controlOutputs[0].switchMode');
    });

    test('rejects unsupported panel grid indexing annotations', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad panel
  description: ""
  partNumber: ""
source: {}
panel:
  layout:
    kind: stompbox-grid
    rows: 1
    columns: 1
    indexing: diagonal
  controls: []
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('panel.layout.indexing');
    });

    test('rejects malformed panel faces with missing binding component ids', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad panel binding
  description: ""
  partNumber: ""
source: {}
panel:
  faces:
    - id: top
      layout:
        kind: stompbox-grid
        rows: 1
        columns: 1
        indexing: one-based
      elements:
        - bind: {}
          kind: knob
          grid:
            row: 1
            column: 1
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('panel.faces[0].elements[0].bind.componentId');
    });

    test('rejects out-of-bounds grid coordinates per panel face', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad face coordinate
  description: ""
  partNumber: ""
source: {}
panel:
  faces:
    - id: right-side
      layout:
        kind: stompbox-grid
        rows: 2
        columns: 1
        indexing: one-based
      elements:
        - bind:
            componentId: V1
          kind: jack
          grid:
            row: 3
            column: 1
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        expect(() => parseInterchangeYaml(yaml)).toThrow('panel.faces[0].elements[0].grid.row');
    });

    test('validates panel grid coordinates against the declared indexing mode', () => {
        const oneBasedWithZero = `schema: circuit-interchange/v2
metadata:
  name: Bad panel coordinate
  description: ""
  partNumber: ""
source: {}
panel:
  layout:
    kind: stompbox-grid
    rows: 1
    columns: 1
    indexing: one-based
  controls:
    - componentId: LEVEL
      controlKind: knob
      grid:
        row: 0
        column: 1
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        const zeroBased = oneBasedWithZero.replace('indexing: one-based', 'indexing: zero-based').replace('column: 1', 'column: 0');

        expect(() => parseInterchangeYaml(oneBasedWithZero)).toThrow('panel.controls[0].grid.row');
        expect(parseInterchangeYaml(zeroBased).panel?.faces[0]?.elements[0]?.grid).toEqual({ row: 0, column: 0 });
    });

    test('parses the project interchange YAML shape back into a CircuitDocument', () => {
        const original = parseCircuitDocument(source, { filename: 'test-filter.schx' });
        const yaml = serializeInterchangeYaml(original, {
            filename: 'test-filter.schx',
            sourceFormat: 'schx',
        }).replace('name: "Test filter"', 'name: "Edited source"');

        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.metadata.name).toBe('Edited source');
        expect(parsed.components).toHaveLength(2);
        expect(parsed.components[0]?.id).toBe('R1');
        expect(parsed.components[0]?.kind).toBe('resistor');
        expect(parsed.components[0]?.terminals[0]?.name).toBe('a');
        expect(parsed.components[0]?.terminals[0]?.position).toEqual({ x: 0, y: -20 });
        expect(parsed.wires).toEqual([{ id: 'wire-1', endpoints: [{ x: 0, y: 20 }, { x: 0, y: 80 }] }]);
    });

    test('preserves scalar component properties as strings even when they look numeric', () => {
        const original = parseCircuitDocument(source, { filename: 'test-filter.schx' });
        const yaml = serializeInterchangeYaml(original, {
            filename: 'test-filter.schx',
            sourceFormat: 'schx',
        });

        const parsed = parseInterchangeYaml(yaml);

        expect(parsed.components[0]?.properties.Wipe).toBe('0.5');
    });

    test('round-trips freeform passive material metadata as scalar properties', () => {
        const doc: CircuitDocument = {
            ...EMPTY_DOCUMENT,
            components: [{
                id: 'R1',
                kind: 'resistor',
                name: 'R1',
                origin: { x: 0, y: 0 },
                rotation: 0,
                flipped: false,
                terminals: [
                    { name: 'a', position: { x: 0, y: -20 } },
                    { name: 'b', position: { x: 0, y: 20 } },
                ],
                properties: {
                    Resistance: { raw: '10 kΩ', value: 10_000, unit: 'Ω' },
                    Material: 'carbon-film',
                    OrganicMaterial: 'carbon-comp',
                },
                sourceTypeName: 'Circuit.Resistor',
            }],
        };

        const yaml = serializeInterchangeYaml(doc);
        const parsed = parseInterchangeYaml(yaml);
        const resistor = parsed.components[0];

        expect(yaml).toContain('Material: carbon-film');
        expect(yaml).toContain('OrganicMaterial: carbon-comp');
        expect(resistor?.properties.Material).toBe('carbon-film');
        expect(resistor?.properties.OrganicMaterial).toBe('carbon-comp');
    });

    test('round-trips runtime descriptor metadata and numeric-looking raw strings', () => {
        const original = parseCircuitDocument(runtimeDescriptorSource, { filename: 'runtime-descriptor.schx' });
        const yaml = serializeInterchangeYaml(original, {
            filename: 'runtime-descriptor.schx',
            sourceFormat: 'schx',
        });

        const parsed = parseInterchangeYaml(yaml);
        const delay = parsed.components.find((component) => component.id === 'U1');
        const reverb = parsed.components.find((component) => component.id === 'U2');
        const feedback = delay?.properties.Feedback;

        expect(delay?.sourceTypeName).toBe('Circuit.MicroBlockDelayChip');
        expect(reverb?.sourceTypeName).toBe('Circuit.MicroBlockReverb');
        expect(delay?.terminals.map((terminal) => terminal.name)).toEqual(['input', 'output']);
        expect(reverb?.terminals.map((terminal) => terminal.name)).toEqual(['input', 'output']);
        expect(delay?.properties.RuntimeDescriptor).toBe('true');
        expect(reverb?.properties.RuntimeDescriptor).toBe('true');
        expect(delay?.properties.StereoOutputMode).toBe('WetDry');
        expect(reverb?.properties.StereoOutputMode).toBe('Spread');
        expect(delay?.properties.Level).toBe('1.0');
        if (!isParsedQuantity(feedback)) {
            throw new Error('Feedback should parse as a quantity');
        }
        expect(feedback.raw).toBe('1e-12');
        expect(parsed.warnings.filter((warning) => warning.code === 'runtime-descriptor-imported')).toHaveLength(2);
    });

    test('round-trips v2 explicit microblock descriptor properties without a Profile property', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Explicit microblocks
  description: Reusable descriptors, not profile aliases.
  partNumber: ""
source: {}
components:
  - id: TS1
    kind: ic
    name: TS1
    sourceTypeName: Circuit.MicroBlockToneStack
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-tone-stack
      overallGainDb: -3
      maxSections: 2
      sections:
        - gain: 1
          zeroHz: 720
          poleHz: 1600
        - gain: 0.8
          zeroHz: 2500
          poleHz: 8000
  - id: EQ1
    kind: ic
    name: EQ1
    sourceTypeName: Circuit.MicroBlockActiveEq
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-active-eq
      descriptor:
        preEmphasisGainDb: 3
        saturationMode: asymmetric-input
        saturationPositiveScale: 0.8
        saturationNegativeScale: 0.6
      bands:
        - type: low-shelf
          frequencyHz: 120
          minFrequencyHz: 80
          maxFrequencyHz: 240
          gainDb: 4
          minGainDb: -15
          maxGainDb: 15
          q: 0.7
  - id: DLY1
    kind: ic
    name: DLY1
    sourceTypeName: Circuit.MicroBlockDelayChip
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-delay-chip
      mechanism:
        memoryType: bbd
        stageCount: 3207
        artifactSeed: 17
        clockNoiseRms: 0.001
        clockFeedthroughHz: 12000
        clockJitterDepthMs: 0.02
        companderResidualAmount: 0.1
        baseBandwidthHz: 6200
        darkBandwidthHz: 1800
        feedbackLimit: 0.92
        quantizationBits: 12
        memoryCompressionMode: none
        supplySensitive: true
        minDelayFloorMs: 4
        dryBlendPolicy: dry-unity
      minDelayMs: 12.5
      maxDelayMs: 800
  - id: RVB1
    kind: ic
    name: RVB1
    sourceTypeName: Circuit.MicroBlockReverb
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-reverb
      algorithm:
        profileAllPassMode: plate
        tankBaseMs:
          - 29
          - 37
          - 41
          - 43
        profileAllPassBaseMs:
          - 4
          - 8
        profileAllPassSizeMs:
          - 2
          - 4
        brightBandwidthHz: 8500
        darkBandwidthHz: 2400
        feedbackTrim: 0.82
        springFlutterBaseSamples: 0
        springFlutterSizeSamples: 0
        dampingMinimum: 0.1
        dampingScale: 0.7
  - id: CMP1
    kind: ic
    name: CMP1
    sourceTypeName: Circuit.MicroBlockCompressor
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-compressor
      topology:
        topology: ota
        otaProfileScale: 0.98
        makeupGainScale: 2.8
      detectorMode: rms
      ratio: 4
      thresholdDb: -24
  - id: OCT1
    kind: ic
    name: OCT1
    sourceTypeName: Circuit.MicroBlockOctave
    origin:
      x: 500
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      RuntimeDescriptor: "true"
      DescriptorType: microblock-octave
      algorithm: octave-down-flipflop
      dividerMode: 4013-toggle
      dividerStages: 2
      trackerCutoffHz: 800
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        const parsed = parseInterchangeYaml(yaml);
        const serialized = serializeInterchangeYaml(parsed);
        const reparsed = parseInterchangeYaml(serialized);

        expect(parsed.components[0]?.properties.sections).toEqual([
            { gain: 1, zeroHz: 720, poleHz: 1600 },
            { gain: 0.8, zeroHz: 2500, poleHz: 8000 },
        ]);
        expect(parsed.components[1]?.properties.descriptor).toEqual({
            preEmphasisGainDb: 3,
            saturationMode: 'asymmetric-input',
            saturationPositiveScale: 0.8,
            saturationNegativeScale: 0.6,
        });
        expect(parsed.components[2]?.properties.mechanism).toMatchObject({
            memoryType: 'bbd',
            stageCount: 3207,
            supplySensitive: true,
            dryBlendPolicy: 'dry-unity',
        });
        expect(parsed.components[3]?.properties.algorithm).toMatchObject({
            profileAllPassMode: 'plate',
            tankBaseMs: [29, 37, 41, 43],
        });
        expect(parsed.components[4]?.properties.topology).toEqual({
            topology: 'ota',
            otaProfileScale: 0.98,
            makeupGainScale: 2.8,
        });
        expect(parsed.components[5]?.properties.algorithm).toBe('octave-down-flipflop');
        expect(serialized).toContain('schema: circuit-interchange/v2');
        expect(serialized).not.toContain('Profile:');
        expect(reparsed.components.map((component) => component.properties)).toEqual(
            parsed.components.map((component) => component.properties),
        );
    });

    test('preserves source provenance fields through parse and serialize', () => {
        const yaml = `schema: circuit-interchange/v2
metadata:
  name: Boss DM-3
  description: Source-visible analog delay graph.
  partNumber: ''
source:
  format: schx
  filename: schematics/livespice/boss-dm-3.schx
  version: "sha256:0123456789abcdef"
  url: "https://example.test/BOSS-DM3_Schematic.pdf"
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

        const parsed = parseInterchangeYaml(yaml);
        const serialized = serializeInterchangeYaml(parsed);
        const reparsed = parseInterchangeYaml(serialized);

        expect(parsed.source).toEqual({
            format: 'schx',
            filename: 'schematics/livespice/boss-dm-3.schx',
            version: 'sha256:0123456789abcdef',
            url: 'https://example.test/BOSS-DM3_Schematic.pdf',
        });
        expect(reparsed.source).toEqual(parsed.source);
    });

    test('rejects YAML without the supported interchange schema', () => {
        expect(() => parseInterchangeYaml('schema: something-else\ncomponents: []\n')).toThrow(
            'unsupported interchange schema',
        );
    });

    test('rejects v1 interchange YAML as an unsupported schema', () => {
        expect(() => parseInterchangeYaml('schema: circuit-interchange/v1\ncomponents: []\n')).toThrow(
            'unsupported interchange schema: circuit-interchange/v1',
        );
    });
});
