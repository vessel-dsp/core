import {
    createStompboxDrillLayoutFromVdsp,
    createStompboxDrillTemplateSvgFromVdsp,
    createStompboxPreviewGlbFromVdsp,
    createStompboxPreviewSvgViewsFromVdsp,
    type StompboxAppearance,
    type StompboxEnclosureProfileCatalog,
    type StompboxHardwareProfile,
    type StompboxPartProfileCatalog,
    type StompboxStyleProfile,
} from '@vessel-dsp/stompbox';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type DemoProfiles = Readonly<{
    artifactCadPartsRoot: string;
    defaultStyleProfileId: string;
    defaultHardwareProfile: Omit<StompboxHardwareProfile, 'partProfiles' | 'enclosureProfiles'>;
    partProfiles: StompboxPartProfileCatalog;
    enclosureProfiles: StompboxEnclosureProfileCatalog;
    styleProfiles: readonly StompboxStyleProfile[];
}>;

type DemoAssetPreset = Readonly<{
    source: string;
    styleProfileId: string;
    appearance: StompboxAppearance;
    state?: NonNullable<Parameters<typeof createStompboxPreviewGlbFromVdsp>[1]>['state'];
    outputPrefix: string;
    writeTopPreviewSvg?: boolean;
}>;

const REPOSITORY_ROOT = join(import.meta.dir, '..');
const DOC_EXAMPLES_DIR = join(REPOSITORY_ROOT, 'docs/public/examples');
const DEMO_PROFILES = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, 'docs/src/data/stompbox-demo-profiles.json'), 'utf8'),
) as DemoProfiles;
const CAD_PARTS_ROOT = join(REPOSITORY_ROOT, DEMO_PROFILES.artifactCadPartsRoot);
const HARDWARE_PROFILE: StompboxHardwareProfile = {
    ...DEMO_PROFILES.defaultHardwareProfile,
    partProfiles: DEMO_PROFILES.partProfiles,
    enclosureProfiles: DEMO_PROFILES.enclosureProfiles,
};

const sharedLabelAppearance = {
    color: '#111827',
    fontFamily: 'Arial,sans-serif',
} as const;

const mxrAppearance = {
    enclosure: {
        color: '#f97316',
        strokeColor: '#7c2d12',
        roughnessFactor: 0.45,
    },
    defaults: {
        led: { color: '#ef4444', offColor: '#fee2e2' },
        label: sharedLabelAppearance,
    },
    labels: {
        'label-led-LED1': { text: '' },
    },
    controls: {
        GAIN: {
            label: { text: 'DRIVE', color: '#ffffff' },
        },
        LED1: {
            led: { color: '#22c55e', offColor: '#064e3b' },
        },
    },
} as const satisfies StompboxAppearance;

const mxrDrillTemplateAppearance = {
    ...mxrAppearance,
    enclosure: {
        color: '#f8fafc',
        strokeColor: '#334155',
    },
    controls: {
        ...mxrAppearance.controls,
        GAIN: {
            ...mxrAppearance.controls.GAIN,
            label: { text: 'DRIVE', color: '#111827' },
        },
    },
} as const satisfies StompboxAppearance;

const bossAppearance = {
    enclosure: { color: '#fae464' },
    defaults: {
        led: { color: '#ef4444', offColor: '#fee2e2' },
        label: sharedLabelAppearance,
    },
    labels: {
        'label-led-status': { text: '' },
    },
} as const satisfies StompboxAppearance;

const bossDrillTemplateAppearance = {
    ...bossAppearance,
    enclosure: {
        color: '#f8fafc',
        strokeColor: '#334155',
    },
} as const satisfies StompboxAppearance;

const mxrSource = `schema: circuit-interchange/v2
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

const bossSource = `schema: circuit-interchange/v2
metadata:
  name: Boss Style Demo Pedal
source:
  format: interchange
  filename: boss-style-demo.vdsp
components:
  - id: RATE
    kind: potentiometer
    name: Rate
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: DEPTH
    kind: potentiometer
    name: Depth
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Wipe: 0.5
    sourceTypeName: "Circuit.Potentiometer, Circuit"
  - id: LEVEL
    kind: potentiometer
    name: Level
    origin:
      x: 80
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
`;

const presets: readonly DemoAssetPreset[] = [
    {
        source: mxrSource,
        styleProfileId: 'mxr-style',
        appearance: mxrAppearance,
        state: {
            LED1: { kind: 'led', on: true, intensity: 0.6 },
        },
        outputPrefix: 'stompbox-mxr-style',
        writeTopPreviewSvg: true,
    },
    {
        source: bossSource,
        styleProfileId: 'boss-style',
        appearance: bossAppearance,
        outputPrefix: 'stompbox-boss-style',
    },
];

function styleProfileById(id: string): StompboxStyleProfile {
    const profile = DEMO_PROFILES.styleProfiles.find((candidate) => candidate.id === id);
    if (profile === undefined) {
        throw new Error(`Missing docs stompbox style profile: ${id}`);
    }
    return profile;
}

function drillTemplateAppearanceForPreset(preset: DemoAssetPreset): StompboxAppearance {
    return preset.outputPrefix === 'stompbox-mxr-style'
        ? mxrDrillTemplateAppearance
        : bossDrillTemplateAppearance;
}

mkdirSync(DOC_EXAMPLES_DIR, { recursive: true });

for (const preset of presets) {
    const styleProfile = styleProfileById(preset.styleProfileId);
    const commonOptions = {
        hardwareProfile: HARDWARE_PROFILE,
        styleProfile,
        includePowerJack: true,
    };
    const previewOptions = {
        ...commonOptions,
        appearance: preset.appearance,
        ...(preset.state === undefined ? {} : { state: preset.state }),
    };
    const glb = createStompboxPreviewGlbFromVdsp(preset.source, {
        ...previewOptions,
        basePath: CAD_PARTS_ROOT,
    });
    const drillLayout = createStompboxDrillLayoutFromVdsp(preset.source, commonOptions);
    const drillTemplateSvg = createStompboxDrillTemplateSvgFromVdsp(preset.source, {
        ...commonOptions,
        appearance: drillTemplateAppearanceForPreset(preset),
        mode: 'preview',
    });

    writeFileSync(join(DOC_EXAMPLES_DIR, `${preset.outputPrefix}-preview.glb`), glb.bytes);
    writeFileSync(
        join(DOC_EXAMPLES_DIR, `${preset.outputPrefix}-drill-layout.json`),
        `${JSON.stringify(drillLayout, null, 2)}\n`,
    );
    writeFileSync(join(DOC_EXAMPLES_DIR, `${preset.outputPrefix}-drill-template-preview.svg`), drillTemplateSvg);

    if (preset.writeTopPreviewSvg === true) {
        const views = createStompboxPreviewSvgViewsFromVdsp(preset.source, {
            ...previewOptions,
            grain: true,
        });
        writeFileSync(join(DOC_EXAMPLES_DIR, `${preset.outputPrefix}-preview-top.svg`), views.views.top);
    }
}
