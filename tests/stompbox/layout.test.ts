import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCircuitDocumentFile } from "@vessel-dsp/core";
import {
	applyStompboxPreviewInteraction,
	createDefaultStompboxPedalStateFromVdsp,
	createStompboxAppearancePatch,
	createStompboxControlSurface,
	createStompboxDrillLayout as createStompboxDrillLayoutBase,
	createStompboxDrillLayoutFromVdsp as createStompboxDrillLayoutFromVdspBase,
	createStompboxDrillTemplate,
	createStompboxDrillTemplateFromVdsp as createStompboxDrillTemplateFromVdspBase,
	createStompboxDrillTemplateSvg,
	createStompboxDrillTemplateSvgFromVdsp as createStompboxDrillTemplateSvgFromVdspBase,
	createStompboxFootswitchPressCommand,
	createStompboxKnobTurnCommand,
	createStompboxPedalStateStore,
	createStompboxPreview as createStompboxPreviewBase,
	createStompboxPreviewFromVdsp as createStompboxPreviewFromVdspBase,
	createStompboxPreviewGlbFromVdsp as createStompboxPreviewGlbFromVdspBase,
	createStompboxPreviewStatePatch,
	createStompboxPreviewSvgViewsFromVdsp as createStompboxPreviewSvgViewsFromVdspBase,
	getAvailableStompboxStyleProfiles,
	knobRotationDegForPosition,
	resolveStompboxAppearance,
	resolveStompboxAssetPaths,
	STOMPBOX_DRILL_HOLE_PROFILE_CATALOG,
	type StompboxAppearance,
	type StompboxEnclosureProfileCatalog,
	type StompboxHardwareProfile,
	type StompboxPartProfileCatalog,
	type StompboxPedalStateCommand,
	type StompboxStyleProfile,
	validateStompboxGlbAssetFile,
	validateStompboxHardwareProfileAssets,
} from "@vessel-dsp/stompbox";

type GltfJson = Readonly<{
	asset?: Readonly<{
		version?: string;
		generator?: string;
		extras?: unknown;
	}>;
	nodes?: readonly Readonly<{
		name?: string;
		mesh?: number;
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
	accessors?: readonly Readonly<{
		min?: readonly number[];
		max?: readonly number[];
	}>[];
	meshes?: readonly Readonly<{
		name?: string;
		primitives?: readonly Readonly<{
			attributes?: Readonly<Record<string, number>>;
			material?: number;
		}>[];
	}>[];
	materials?: readonly Readonly<{
		name?: string;
		doubleSided?: boolean;
		pbrMetallicRoughness?: Readonly<{
			baseColorFactor?: readonly number[];
			metallicFactor?: number;
			roughnessFactor?: number;
		}>;
		emissiveFactor?: readonly number[];
		extras?: unknown;
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
	partId?: string;
	controlId?: string;
	color?: string;
	sourceAssets?: readonly Readonly<{
		id?: string;
		glb?: string;
		step?: string;
	}>[];
	appearance?: unknown;
	appearanceMaterial?: unknown;
	material?: unknown;
	renderColorMode?: string;
	stateTargets?: unknown;
}>;

type GltfAccessor = NonNullable<GltfJson["accessors"]>[number];

type DemoProfiles = Readonly<{
	artifactCadPartsRoot: string;
	defaultStyleProfileId: string;
	defaultHardwareProfile: Omit<
		StompboxHardwareProfile,
		"partProfiles" | "enclosureProfiles"
	>;
	partProfiles: StompboxPartProfileCatalog;
	enclosureProfiles: StompboxEnclosureProfileCatalog;
	styleProfiles: readonly StompboxStyleProfile[];
}>;

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const DEMO_PROFILES = JSON.parse(
	readFileSync(
		join(REPOSITORY_ROOT, "docs/src/data/stompbox-demo-profiles.json"),
		"utf8",
	),
) as DemoProfiles;
const DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT = join(
	REPOSITORY_ROOT,
	DEMO_PROFILES.artifactCadPartsRoot,
);
const DEFAULT_STOMPBOX_STYLE_PROFILE_ID = DEMO_PROFILES.defaultStyleProfileId;
const STOMPBOX_ENCLOSURE_CATALOG = DEMO_PROFILES.enclosureProfiles;
const STOMPBOX_PART_CATALOG = DEMO_PROFILES.partProfiles;
const STOMPBOX_STYLE_PROFILES = DEMO_PROFILES.styleProfiles;
const DEMO_STOMPBOX_HARDWARE_PROFILE: StompboxHardwareProfile = {
	...DEMO_PROFILES.defaultHardwareProfile,
	partProfiles: STOMPBOX_PART_CATALOG,
	enclosureProfiles: STOMPBOX_ENCLOSURE_CATALOG,
};
const DEFAULT_STOMPBOX_STYLE_PROFILE = styleProfileById(
	DEFAULT_STOMPBOX_STYLE_PROFILE_ID,
);
const BOSS_STOMPBOX_STYLE_PROFILE = styleProfileById("boss-style");
const MXR_SMALL_KNOB_ID = "knob-mxr-style-fluted-small";
const MXR_MEDIUM_KNOB_ID = "knob-mxr-style-fluted-medium";
const MXR_LARGE_KNOB_ID = "knob-mxr-style-fluted-large";
const BOSS_SMALL_KNOB_ID = "knob-davies-1900h";
const BOSS_MEDIUM_KNOB_ID = "knob-davies-1100";
const BOSS_LARGE_KNOB_ID = "knob-davies-1105";

function styleProfileById(id: string): StompboxStyleProfile {
	const profile = STOMPBOX_STYLE_PROFILES.find(
		(candidate) => candidate.id === id,
	);
	if (profile === undefined) {
		throw new Error(`missing docs stompbox style profile: ${id}`);
	}
	return profile;
}

function withDemoHardware<T extends object>(
	options?: T,
): T &
	Readonly<{
		hardwareProfile: StompboxHardwareProfile;
		styleProfile: StompboxStyleProfile;
	}> {
	return {
		hardwareProfile: DEMO_STOMPBOX_HARDWARE_PROFILE,
		styleProfile: DEFAULT_STOMPBOX_STYLE_PROFILE,
		...(options ?? {}),
	} as T &
		Readonly<{
			hardwareProfile: StompboxHardwareProfile;
			styleProfile: StompboxStyleProfile;
		}>;
}

function createStompboxDrillLayoutFromVdsp(
	source: Parameters<typeof createStompboxDrillLayoutFromVdspBase>[0],
	options?: Parameters<typeof createStompboxDrillLayoutFromVdspBase>[1],
): ReturnType<typeof createStompboxDrillLayoutFromVdspBase> {
	return createStompboxDrillLayoutFromVdspBase(
		source,
		withDemoHardware(options),
	);
}

function createStompboxDrillLayout(
	document: Parameters<typeof createStompboxDrillLayoutBase>[0],
	options?: Parameters<typeof createStompboxDrillLayoutBase>[1],
): ReturnType<typeof createStompboxDrillLayoutBase> {
	return createStompboxDrillLayoutBase(document, withDemoHardware(options));
}

function createStompboxDrillTemplateFromVdsp(
	source: Parameters<typeof createStompboxDrillTemplateFromVdspBase>[0],
	options: Parameters<typeof createStompboxDrillTemplateFromVdspBase>[1],
): ReturnType<typeof createStompboxDrillTemplateFromVdspBase> {
	return createStompboxDrillTemplateFromVdspBase(
		source,
		withDemoHardware(options),
	);
}

function createStompboxDrillTemplateSvgFromVdsp(
	source: Parameters<typeof createStompboxDrillTemplateSvgFromVdspBase>[0],
	options: Parameters<typeof createStompboxDrillTemplateSvgFromVdspBase>[1],
): ReturnType<typeof createStompboxDrillTemplateSvgFromVdspBase> {
	return createStompboxDrillTemplateSvgFromVdspBase(
		source,
		withDemoHardware(options),
	);
}

function createStompboxPreviewFromVdsp(
	source: Parameters<typeof createStompboxPreviewFromVdspBase>[0],
	options?: Parameters<typeof createStompboxPreviewFromVdspBase>[1],
): ReturnType<typeof createStompboxPreviewFromVdspBase> {
	return createStompboxPreviewFromVdspBase(source, withDemoHardware(options));
}

function createStompboxPreview(
	document: Parameters<typeof createStompboxPreviewBase>[0],
	options?: Parameters<typeof createStompboxPreviewBase>[1],
): ReturnType<typeof createStompboxPreviewBase> {
	return createStompboxPreviewBase(document, withDemoHardware(options));
}

function createStompboxPreviewSvgViewsFromVdsp(
	source: Parameters<typeof createStompboxPreviewSvgViewsFromVdspBase>[0],
	options?: Parameters<typeof createStompboxPreviewSvgViewsFromVdspBase>[1],
): ReturnType<typeof createStompboxPreviewSvgViewsFromVdspBase> {
	return createStompboxPreviewSvgViewsFromVdspBase(
		source,
		withDemoHardware(options),
	);
}

function createStompboxPreviewGlbFromVdsp(
	source: Parameters<typeof createStompboxPreviewGlbFromVdspBase>[0],
	options?: Parameters<typeof createStompboxPreviewGlbFromVdspBase>[1],
): ReturnType<typeof createStompboxPreviewGlbFromVdspBase> {
	return createStompboxPreviewGlbFromVdspBase(
		source,
		withDemoHardware(options),
	);
}

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
		types.push(
			chunkType === 0x4e4f534a
				? "JSON"
				: chunkType === 0x004e4942
					? "BIN"
					: `0x${chunkType.toString(16)}`,
		);
		offset += 8 + chunkLength;
	}
	return types;
}

function gltfExtras(value: unknown): GltfExtras {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	return value as GltfExtras;
}

function positionAccessorForNode(
	gltf: GltfJson,
	node: Readonly<{ mesh?: number }> | undefined,
): GltfAccessor | undefined {
	const meshIndex = node?.mesh;
	if (meshIndex === undefined) {
		return undefined;
	}
	const positionAccessorIndex =
		gltf.meshes?.[meshIndex]?.primitives?.[0]?.attributes?.POSITION;
	if (positionAccessorIndex === undefined) {
		return undefined;
	}
	return gltf.accessors?.[positionAccessorIndex];
}

function vdspWithPotentiometers(
	ids: readonly string[],
	extraComponents = "",
): string {
	return `schema: circuit-interchange/v2
metadata:
  name: ${ids.length} Knob Pedal
source:
  format: interchange
  filename: ${ids.length}-knob.vdsp
components:
${ids
	.map(
		(id, index) => `  - id: ${id}
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
    sourceTypeName: "Circuit.Potentiometer, Circuit"`,
	)
	.join("\n")}${extraComponents}
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
	expect(profile?.geometry.kind).toBe("knob");
	if (profile?.geometry.kind !== "knob") {
		return 0;
	}
	return profile.geometry.diameterMm;
}

function minimumKnobClearanceMm(
	holes: readonly Readonly<{
		partId: string;
		centerMm: Readonly<{ x: number; y: number }>;
	}>[],
): number {
	return Math.min(
		...holes.flatMap((first, firstIndex) =>
			holes.slice(firstIndex + 1).map((second) => {
				const distance = Math.hypot(
					first.centerMm.x - second.centerMm.x,
					first.centerMm.y - second.centerMm.y,
				);
				return (
					distance -
					(visibleKnobDiameterMm(first.partId) +
						visibleKnobDiameterMm(second.partId)) /
						2
				);
			}),
		),
	);
}

function drillTemplateHoleGroup(svg: string, holeId: string): string {
	const groupMatch = new RegExp(
		`<g[^>]*data-hole-id="${holeId}"[^>]*>(.*?)</g>`,
	).exec(svg);
	expect(groupMatch?.[1]).toBeDefined();
	return groupMatch?.[1] ?? "";
}

function drillTemplateLabelY(
	svg: string,
	holeId: string,
	label: string,
): number {
	const labelMatch = new RegExp(
		`<text[^>]*y="([^"]+)"[^>]*>${label}</text>`,
	).exec(drillTemplateHoleGroup(svg, holeId));
	expect(labelMatch?.[1]).toBeDefined();
	return Number(labelMatch?.[1]);
}

function drillTemplateOuterCircleBottom(svg: string, holeId: string): number {
	const circleMatch =
		/<circle class="hole drill-hole-profile-outer"[^>]*cy="([^"]+)"[^>]*r="([^"]+)"/.exec(
			drillTemplateHoleGroup(svg, holeId),
		);
	expect(circleMatch?.[1]).toBeDefined();
	expect(circleMatch?.[2]).toBeDefined();
	return Number(circleMatch?.[1]) + Number(circleMatch?.[2]);
}

const customDecals = [
	{
		id: "brand",
		kind: "text",
		text: "Fuzz Lab",
		centerMm: { x: 0, y: 9 },
		sizeMm: { widthMm: 34, heightMm: 7 },
		color: "#f97316",
		fontFamily: "Arial",
	},
	{
		id: "badge",
		kind: "svg",
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

const vdspWithGridPlacementOnly = `schema: circuit-interchange/v3
metadata:
  name: Grid Layout Pedal
source:
  format: interchange
  filename: grid-layout.vdsp
components:
  - id: DRIVE
    kind: potentiometer
    name: Drive
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
      x: 20
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
        rows: 3
        columns: 3
        indexing: one-based
      elements:
        - id: drive-knob
          bind:
            componentId: DRIVE
            controlId: DRIVE
          kind: knob
          label: Drive
          grid:
            row: 1
            column: 1
        - id: tone-knob
          bind:
            componentId: TONE
            controlId: TONE
          kind: knob
          label: Tone
          grid:
            row: 2
            column: 1
        - id: level-knob
          bind:
            componentId: LEVEL
            controlId: LEVEL
          kind: knob
          label: Level
          grid:
            row: 1
            column: 3
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

describe("stompbox catalog and assets", () => {
	test("profiles enclosure dimensions used by the placement grid", () => {
		expect(STOMPBOX_ENCLOSURE_CATALOG["box-1590b"]?.dimensionsMm).toEqual({
			widthMm: 60.5,
			lengthMm: 111.5,
			depthMm: 31,
		});
		expect(
			STOMPBOX_ENCLOSURE_CATALOG["box-1590b"]?.topFace.usableRectMm,
		).toEqual({
			x: -29.25,
			y: -54.75,
			width: 58.5,
			height: 109.5,
		});
		expect(STOMPBOX_ENCLOSURE_CATALOG["box-1590a"]?.dimensionsMm).toEqual({
			widthMm: 39,
			lengthMm: 92.5,
			depthMm: 31,
		});
		expect(
			STOMPBOX_ENCLOSURE_CATALOG["box-1590a"]?.topFace.usableRectMm,
		).toEqual({
			x: -18.5,
			y: -45.25,
			width: 37,
			height: 90.5,
		});
	});

	test("profiles drilling-hole markers from the reference SVG sheet", () => {
		expect(Object.keys(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG).sort()).toEqual([
			"audio-jack-24mm-pot-3-8",
			"dc-jack-3pdt-1-2",
			"five-mm-led-13-64",
			"metal-5mm-led-bezel-5-16",
			"mini-toggle-switch-1-4",
			"pilot-hole-1-16",
			"sixteen-mm-pot-9-32",
			"three-mm-led-1-8",
		]);
		expect(
			STOMPBOX_DRILL_HOLE_PROFILE_CATALOG["dc-jack-3pdt-1-2"],
		).toMatchObject({
			label: "DC Jack / 3PDT",
			diameterMm: 12.7,
			fractionInches: '1/2"',
			marker: "ring-with-center-dot",
		});
		expect(
			STOMPBOX_DRILL_HOLE_PROFILE_CATALOG["audio-jack-24mm-pot-3-8"],
		).toMatchObject({
			label: "Audio Jacks / 24mm Pots",
			diameterMm: 9.525,
			fractionInches: '3/8"',
			marker: "ring-with-center-dot",
		});
		expect(
			STOMPBOX_DRILL_HOLE_PROFILE_CATALOG["five-mm-led-13-64"],
		).toMatchObject({
			label: "5mm LED",
			diameterMm: 5.159375,
			fractionInches: '13/64"',
			marker: "ring-with-center-dot",
		});
		expect(
			STOMPBOX_DRILL_HOLE_PROFILE_CATALOG["pilot-hole-1-16"],
		).toMatchObject({
			label: "Pilot Hole",
			diameterMm: 1.5875,
			fractionInches: '1/16"',
			marker: "center-dot",
		});
	});

	test("covers the v1 exterior stub families with GLB and STEP references", () => {
		expect(Object.keys(STOMPBOX_PART_CATALOG).sort()).toEqual([
			"dc-socket-dc099",
			"jack-ts-pj629han",
			"knob-chickenhead-lms-30mm",
			"knob-cm42-bb",
			BOSS_MEDIUM_KNOB_ID,
			BOSS_LARGE_KNOB_ID,
			BOSS_SMALL_KNOB_ID,
			MXR_LARGE_KNOB_ID,
			MXR_MEDIUM_KNOB_ID,
			MXR_SMALL_KNOB_ID,
			"led-3mm-red-kento-5408urc",
			"led-5mm-red-kento-5408urc",
			"led-bezel-lh5",
			"switch-3pdt-pic-pbs24302",
		]);

		const audioJack = STOMPBOX_PART_CATALOG["jack-ts-pj629han"];
		expect(audioJack).toBeDefined();
		if (audioJack === undefined) {
			return;
		}
		expect(audioJack.status).toBe("generated-stub");
		expect(audioJack.level).toBe("exterior");
		expect(audioJack.geometry.kind).toBe("ring");
		if (audioJack.geometry.kind !== "ring") {
			return;
		}
		expect(audioJack.geometry.outerDiameterMm).toBe(11);
		expect(audioJack.geometry.innerDiameterMm).toBe(6.43);
		expect(audioJack.panelHoleDrillMm).toBe(9.525);
		expect(audioJack.drillHoleProfileId).toBe("audio-jack-24mm-pot-3-8");
		expect(audioJack.assets.glbRelativePath).toBe(
			"jack-ts-pj629han/.pj-629han-05.step.glb",
		);
		expect(audioJack.assets.stepRelativePath).toBe(
			"jack-ts-pj629han/pj-629han-05.step",
		);

		const dcJack = STOMPBOX_PART_CATALOG["dc-socket-dc099"];
		expect(dcJack).toBeDefined();
		if (dcJack === undefined) {
			return;
		}
		expect(dcJack.status).toBe("generated-stub");
		expect(dcJack.level).toBe("exterior");
		expect(dcJack.geometry.kind).toBe("ring");
		if (dcJack.geometry.kind !== "ring") {
			return;
		}
		expect(dcJack.geometry.outerDiameterMm).toBe(14.1);
		expect(dcJack.geometry.innerDiameterMm).toBe(8);
		expect(dcJack.panelHoleDrillMm).toBe(12.7);
		expect(dcJack.drillHoleProfileId).toBe("dc-jack-3pdt-1-2");
		expect(dcJack.assets.glbRelativePath).toBe(
			"dc-socket-dc099/.dc099.step.glb",
		);
		expect(dcJack.assets.stepRelativePath).toBe("dc-socket-dc099/dc099.step");

		const bossMediumKnob = STOMPBOX_PART_CATALOG[BOSS_MEDIUM_KNOB_ID];
		expect(bossMediumKnob).toBeDefined();
		if (bossMediumKnob === undefined) {
			return;
		}
		expect(bossMediumKnob.geometry.kind).toBe("knob");
		if (bossMediumKnob.geometry.kind !== "knob") {
			return;
		}
		expect(bossMediumKnob.geometry.diameterMm).toBe(19.81);
		expect(bossMediumKnob.geometry.depthMm).toBe(11.43);
		expect(bossMediumKnob.geometry.shaftDiameterMm).toBe(6.35);
		expect(bossMediumKnob.panelHoleDrillMm).toBe(7.14375);
		expect(bossMediumKnob.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(bossMediumKnob.assets.glbRelativePath).toBe(
			"knob-davies-instrument-series/.davies-1100.step.glb",
		);
		expect(bossMediumKnob.assets.stepRelativePath).toBe(
			"knob-davies-instrument-series/davies-1100.step",
		);

		const bossLargeKnob = STOMPBOX_PART_CATALOG[BOSS_LARGE_KNOB_ID];
		expect(bossLargeKnob).toBeDefined();
		if (bossLargeKnob === undefined) {
			return;
		}
		expect(bossLargeKnob.geometry.kind).toBe("knob");
		if (bossLargeKnob.geometry.kind !== "knob") {
			return;
		}
		expect(bossLargeKnob.geometry.diameterMm).toBe(26.92);
		expect(bossLargeKnob.geometry.depthMm).toBe(15.75);
		expect(bossLargeKnob.geometry.shaftDiameterMm).toBe(6.35);
		expect(bossLargeKnob.panelHoleDrillMm).toBe(7.14375);
		expect(bossLargeKnob.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(bossLargeKnob.assets.glbRelativePath).toBe(
			"knob-davies-instrument-series/.davies-1105.step.glb",
		);
		expect(bossLargeKnob.assets.stepRelativePath).toBe(
			"knob-davies-instrument-series/davies-1105.step",
		);

		const davies1900 = STOMPBOX_PART_CATALOG[BOSS_SMALL_KNOB_ID];
		expect(davies1900).toBeDefined();
		if (davies1900 === undefined) {
			return;
		}
		expect(davies1900.geometry.kind).toBe("knob");
		if (davies1900.geometry.kind !== "knob") {
			return;
		}
		expect(davies1900.geometry.diameterMm).toBe(12.8);
		expect(davies1900.geometry.depthMm).toBe(15.8);
		expect(davies1900.geometry.shaftDiameterMm).toBe(6.35);
		expect(davies1900.panelHoleDrillMm).toBe(7.14375);
		expect(davies1900.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(davies1900.assetScale).toBeUndefined();
		expect(davies1900.assets.glbRelativePath).toBe(
			"knob-davies-instrument-series/.davies-1900.step.glb",
		);
		expect(davies1900.assets.stepRelativePath).toBe(
			"knob-davies-instrument-series/davies-1900.step",
		);

		const mxrSmallKnob = STOMPBOX_PART_CATALOG[MXR_SMALL_KNOB_ID];
		expect(mxrSmallKnob).toBeDefined();
		if (mxrSmallKnob === undefined) {
			return;
		}
		expect(mxrSmallKnob.geometry.kind).toBe("knob");
		if (mxrSmallKnob.geometry.kind !== "knob") {
			return;
		}
		expect(mxrSmallKnob.geometry.diameterMm).toBe(20.2);
		expect(mxrSmallKnob.panelHoleDrillMm).toBe(7.14375);
		expect(mxrSmallKnob.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(mxrSmallKnob.assetScale).toBeUndefined();
		expect(mxrSmallKnob.assets.glbRelativePath).toBe(
			"knob-mxr-style-fluted/.daier-mf-b01.step.glb",
		);
		expect(mxrSmallKnob.assets.stepRelativePath).toBe(
			"knob-mxr-style-fluted/daier-mf-b01.step",
		);

		const mxrMediumKnob = STOMPBOX_PART_CATALOG[MXR_MEDIUM_KNOB_ID];
		expect(mxrMediumKnob).toBeDefined();
		if (mxrMediumKnob === undefined) {
			return;
		}
		expect(mxrMediumKnob.geometry.kind).toBe("knob");
		if (mxrMediumKnob.geometry.kind !== "knob") {
			return;
		}
		expect(mxrMediumKnob.geometry.diameterMm).toBe(24.4);
		expect(mxrMediumKnob.panelHoleDrillMm).toBe(7.14375);
		expect(mxrMediumKnob.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(mxrMediumKnob.assetScale).toBeUndefined();
		expect(mxrMediumKnob.assets.glbRelativePath).toBe(
			"knob-mxr-style-fluted/.daier-mf-b02.step.glb",
		);
		expect(mxrMediumKnob.assets.stepRelativePath).toBe(
			"knob-mxr-style-fluted/daier-mf-b02.step",
		);

		const mxrLargeKnob = STOMPBOX_PART_CATALOG[MXR_LARGE_KNOB_ID];
		expect(mxrLargeKnob).toBeDefined();
		if (mxrLargeKnob === undefined) {
			return;
		}
		expect(mxrLargeKnob.geometry.kind).toBe("knob");
		if (mxrLargeKnob.geometry.kind !== "knob") {
			return;
		}
		expect(mxrLargeKnob.geometry.diameterMm).toBe(29.9);
		expect(mxrLargeKnob.panelHoleDrillMm).toBe(7.14375);
		expect(mxrLargeKnob.drillHoleProfileId).toBe("sixteen-mm-pot-9-32");
		expect(mxrLargeKnob.assetScale).toBeUndefined();
		expect(mxrLargeKnob.assets.glbRelativePath).toBe(
			"knob-mxr-style-fluted/.daier-mf-b03.step.glb",
		);
		expect(mxrLargeKnob.assets.stepRelativePath).toBe(
			"knob-mxr-style-fluted/daier-mf-b03.step",
		);

		const defaultLed = STOMPBOX_PART_CATALOG["led-bezel-lh5"];
		expect(defaultLed).toBeDefined();
		if (defaultLed === undefined) {
			return;
		}
		expect(defaultLed.geometry.kind).toBe("led-bezel");
		if (defaultLed.geometry.kind !== "led-bezel") {
			return;
		}
		expect(defaultLed.geometry.outerDiameterMm).toBe(9.2);
		expect(defaultLed.geometry.innerDiameterMm).toBe(5);
		expect(defaultLed.panelHoleDrillMm).toBe(7.9375);
		expect(defaultLed.drillHoleProfileId).toBe("metal-5mm-led-bezel-5-16");
		expect(defaultLed.assetScale).toBeUndefined();
		expect(defaultLed.assets.glbRelativePath).toBe(
			"led-bezel-lh5/.pedal-parts-and-kits-bzl-5mm-p.step.glb",
		);
		expect(defaultLed.assets.stepRelativePath).toBe(
			"led-bezel-lh5/pedal-parts-and-kits-bzl-5mm-p.step",
		);
		expect(defaultLed.stateTargets?.led?.lens.selector).toEqual({
			nodeName: "o1.2",
			meshNameIncludes: "5mm_led_lens",
		});

		const footswitch = STOMPBOX_PART_CATALOG["switch-3pdt-pic-pbs24302"];
		expect(footswitch).toBeDefined();
		if (footswitch === undefined) {
			return;
		}
		expect(footswitch.geometry.kind).toBe("footswitch");
		expect(footswitch.stateTargets?.footswitch?.actuator.selector).toEqual({
			nodeName: "o1.3",
			meshNameIncludes: "plunger",
		});
		expect(footswitch.stateTargets?.footswitch?.travelAxis).toBe("z");
		expect(footswitch.stateTargets?.footswitch?.travelMm).toBe(1.2);
	});

	test("validates live state targets in user-provided LED and footswitch GLBs", () => {
		const led = STOMPBOX_PART_CATALOG["led-bezel-lh5"];
		const footswitch = STOMPBOX_PART_CATALOG["switch-3pdt-pic-pbs24302"];
		expect(led).toBeDefined();
		expect(footswitch).toBeDefined();
		if (led === undefined || footswitch === undefined) {
			return;
		}

		const ledValidation = validateStompboxGlbAssetFile(
			join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				led.assets.glbRelativePath,
			),
			led,
		);
		const footswitchValidation = validateStompboxGlbAssetFile(
			join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				footswitch.assets.glbRelativePath,
			),
			footswitch,
		);
		const profileValidation = validateStompboxHardwareProfileAssets(
			DEMO_STOMPBOX_HARDWARE_PROFILE,
			{
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);

		expect(ledValidation.valid).toBe(true);
		expect(ledValidation.diagnostics).toEqual([]);
		expect(ledValidation.targets["led.lens"]).toEqual(
			expect.objectContaining({
				role: "led.lens",
				nodeName: "o1.2",
				meshName: "pedal_parts_and_kits_bzl_5mm_p_bezel_stub_5mm_led_lens",
			}),
		);
		expect(footswitchValidation.valid).toBe(true);
		expect(footswitchValidation.targets["footswitch.actuator"]).toEqual(
			expect.objectContaining({
				role: "footswitch.actuator",
				nodeName: "o1.3",
				meshName:
					"pic_pbs24302_3pdt_footswitch_exterior_stub_stepped_10mm_plunger_6p5mm_tall",
			}),
		);
		expect(profileValidation.valid).toBe(true);
		expect(
			profileValidation.assets["led-bezel-lh5"]?.targets["led.lens"]?.nodeName,
		).toBe("o1.2");
		expect(
			profileValidation.assets["switch-3pdt-pic-pbs24302"]?.targets[
				"footswitch.actuator"
			]?.nodeName,
		).toBe("o1.3");
	});

	test("reports live-state GLB diagnostics when required targets are missing", () => {
		const led = STOMPBOX_PART_CATALOG["led-bezel-lh5"];
		const footswitch = STOMPBOX_PART_CATALOG["switch-3pdt-pic-pbs24302"];
		expect(led).toBeDefined();
		expect(footswitch).toBeDefined();
		if (led === undefined || footswitch === undefined) {
			return;
		}

		const { stateTargets: _ledStateTargets, ...ledWithoutStateTargets } = led;
		const hardwareProfileWithoutTargets: StompboxHardwareProfile = {
			...DEMO_STOMPBOX_HARDWARE_PROFILE,
			partProfiles: {
				...DEMO_STOMPBOX_HARDWARE_PROFILE.partProfiles,
				[led.id]: ledWithoutStateTargets,
				[footswitch.id]: {
					...footswitch,
					stateTargets: {
						footswitch: {
							actuator: { selector: { nodeNameIncludes: "missing-plunger" } },
							travelAxis: "z",
							travelMm: 1.2,
						},
					},
				},
			},
		};
		const validation = validateStompboxHardwareProfileAssets(
			hardwareProfileWithoutTargets,
			{
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				hardwareProfile: hardwareProfileWithoutTargets,
				styleProfile: DEFAULT_STOMPBOX_STYLE_PROFILE,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);

		expect(validation.valid).toBe(false);
		expect(validation.assets["led-bezel-lh5"]?.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "missing-state-target-contract",
				partId: "led-bezel-lh5",
				targetRole: "led.lens",
			}),
		);
		expect(
			validation.assets["switch-3pdt-pic-pbs24302"]?.diagnostics,
		).toContainEqual(
			expect.objectContaining({
				code: "missing-state-target",
				partId: "switch-3pdt-pic-pbs24302",
				targetRole: "footswitch.actuator",
			}),
		);
		expect(assembly.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "missing-state-target-contract",
				partId: "led-bezel-lh5",
				targetRole: "led.lens",
			}),
		);
		expect(assembly.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "missing-state-target",
				partId: "switch-3pdt-pic-pbs24302",
				targetRole: "footswitch.actuator",
			}),
		);
	});

	test("resolves catalog asset paths from a local base path or served base URL", () => {
		const jack = STOMPBOX_PART_CATALOG["jack-ts-pj629han"];
		expect(jack).toBeDefined();
		if (jack === undefined) {
			return;
		}

		expect(
			resolveStompboxAssetPaths(jack.assets, {
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			}),
		).toEqual({
			glb: join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				"jack-ts-pj629han/.pj-629han-05.step.glb",
			),
			step: join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				"jack-ts-pj629han/pj-629han-05.step",
			),
		});
		expect(DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT).toContain(
			"/packages/stompbox/assets/cad/parts",
		);
		expect(
			existsSync(
				join(
					DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
					"jack-ts-pj629han/.pj-629han-05.step.glb",
				),
			),
		).toBe(true);
		expect(
			existsSync(
				join(
					DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
					"jack-ts-pj629han/pj-629han-05.step",
				),
			),
		).toBe(true);

		expect(
			resolveStompboxAssetPaths(jack.assets, {
				baseUrl: "/cad/parts/",
			}),
		).toEqual({
			glb: "/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb",
			step: "/cad/parts/jack-ts-pj629han/pj-629han-05.step",
		});
	});
});

describe("stompbox style profiles", () => {
	test("exposes MXR as the default profile and filters UI choices by knob count", () => {
		expect(DEFAULT_STOMPBOX_STYLE_PROFILE_ID).toBe("mxr-style");
		expect(
			STOMPBOX_STYLE_PROFILES.map((profile) => ({
				id: profile.id,
				supportedKnobCounts: profile.supportedKnobCounts,
			})),
		).toEqual([
			{ id: "mxr-style", supportedKnobCounts: [1, 2, 3, 4, 5, 6] },
			{ id: "boss-style", supportedKnobCounts: [2, 3, 4] },
		]);

		expect(
			getAvailableStompboxStyleProfiles(STOMPBOX_STYLE_PROFILES, {
				knobCount: 2,
			}).map((profile) => profile.id),
		).toEqual(["mxr-style", "boss-style"]);
		expect(
			getAvailableStompboxStyleProfiles(STOMPBOX_STYLE_PROFILES, {
				knobCount: 4,
			}).map((profile) => profile.id),
		).toEqual(["mxr-style", "boss-style"]);
		expect(
			getAvailableStompboxStyleProfiles(STOMPBOX_STYLE_PROFILES, {
				knobCount: 5,
			}).map((profile) => profile.id),
		).toEqual(["mxr-style"]);
	});
});

describe("stompbox drill layout", () => {
	test("requires a caller-provided hardware profile for part and enclosure resolution", () => {
		expect(() =>
			createStompboxDrillLayoutFromVdspBase(vdspWithControlsOnly),
		).toThrow("stompbox hardware profile is required");
	});

	test("auto-generates deterministic physical placement when .vdsp has no panel physical coordinates", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
			{ includePowerJack: true },
		);

		expect(layout.schema).toBe("stompbox-drill-layout/v1");
		expect(layout.enclosure.variantId).toBe("box-1590b");
		expect(
			layout.holes.map((hole) => ({
				id: hole.id,
				controlId: hole.controlId,
				partId: hole.partId,
				face: hole.face,
				centerMm: hole.centerMm,
				drillDiameterMm: hole.drillDiameterMm,
				provenance: hole.provenance,
			})),
		).toEqual([
			{
				id: "knob-GAIN",
				controlId: "GAIN",
				partId: MXR_SMALL_KNOB_ID,
				face: "top",
				centerMm: { x: -14.625, y: 32.85 },
				drillDiameterMm: 7.14375,
				provenance: "auto-generated",
			},
			{
				id: "knob-LEVEL",
				controlId: "LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				face: "top",
				centerMm: { x: 14.625, y: 32.85 },
				drillDiameterMm: 7.14375,
				provenance: "auto-generated",
			},
			{
				id: "led-LED1",
				controlId: "LED1",
				partId: "led-bezel-lh5",
				face: "top",
				centerMm: { x: 0, y: -5.475 },
				drillDiameterMm: 7.9375,
				provenance: "auto-generated",
			},
			{
				id: "switch-SW1",
				controlId: "SW1",
				partId: "switch-3pdt-pic-pbs24302",
				face: "top",
				centerMm: { x: 0, y: -21.9 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
			{
				id: "jack-IN",
				controlId: "IN",
				partId: "jack-ts-pj629han",
				face: "right",
				centerMm: { x: 30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "jack-OUT",
				controlId: "OUT",
				partId: "jack-ts-pj629han",
				face: "left",
				centerMm: { x: -30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "power-9v",
				controlId: undefined,
				partId: "dc-socket-dc099",
				face: "right",
				centerMm: { x: 30.25, y: -12.55 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
		]);
		expect(layout.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			"placement-auto-generated",
		);
	});

	test("auto-generates omitted stompbox hardware for controls-only schematics", () => {
		const layout = createStompboxDrillLayoutFromVdsp(vdspWithControlsOnly);

		expect(
			layout.holes.map((hole) => ({
				id: hole.id,
				controlId: hole.controlId,
				partId: hole.partId,
				face: hole.face,
				centerMm: hole.centerMm,
				provenance: hole.provenance,
			})),
		).toEqual([
			{
				id: "knob-GAIN",
				controlId: "GAIN",
				partId: MXR_SMALL_KNOB_ID,
				face: "top",
				centerMm: { x: -14.625, y: 32.85 },
				provenance: "auto-generated",
			},
			{
				id: "knob-LEVEL",
				controlId: "LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				face: "top",
				centerMm: { x: 14.625, y: 32.85 },
				provenance: "auto-generated",
			},
			{
				id: "led-status",
				controlId: undefined,
				partId: "led-bezel-lh5",
				face: "top",
				centerMm: { x: 0, y: -5.475 },
				provenance: "auto-generated",
			},
			{
				id: "switch-bypass",
				controlId: undefined,
				partId: "switch-3pdt-pic-pbs24302",
				face: "top",
				centerMm: { x: 0, y: -21.9 },
				provenance: "auto-generated",
			},
			{
				id: "jack-input",
				controlId: undefined,
				partId: "jack-ts-pj629han",
				face: "right",
				centerMm: { x: 30.25, y: 0 },
				provenance: "auto-generated",
			},
			{
				id: "jack-output",
				controlId: undefined,
				partId: "jack-ts-pj629han",
				face: "left",
				centerMm: { x: -30.25, y: 0 },
				provenance: "auto-generated",
			},
			{
				id: "power-9v",
				controlId: undefined,
				partId: "dc-socket-dc099",
				face: "right",
				centerMm: { x: 30.25, y: -12.55 },
				provenance: "auto-generated",
			},
		]);
	});

	test("uses a merged upper row for one- and two-knob MXR layouts", () => {
		const oneKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["VOLUME"]),
			{
				includePowerJack: false,
			},
		);
		const twoKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["GAIN", "LEVEL"]),
			{
				includePowerJack: false,
			},
		);

		expect(
			oneKnobLayout.holes.map((hole) => ({
				id: hole.id,
				partId: hole.partId,
				centerMm: hole.centerMm,
			})),
		).toEqual([
			{
				id: "knob-VOLUME",
				partId: MXR_LARGE_KNOB_ID,
				centerMm: { x: 0, y: 32.85 },
			},
			{
				id: "led-status",
				partId: "led-bezel-lh5",
				centerMm: { x: 0, y: -5.475 },
			},
			{
				id: "switch-bypass",
				partId: "switch-3pdt-pic-pbs24302",
				centerMm: { x: 0, y: -21.9 },
			},
			{
				id: "jack-input",
				partId: "jack-ts-pj629han",
				centerMm: { x: 30.25, y: 0 },
			},
			{
				id: "jack-output",
				partId: "jack-ts-pj629han",
				centerMm: { x: -30.25, y: 0 },
			},
		]);
		expect(
			oneKnobLayout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
		expect(
			twoKnobLayout.holes.map((hole) => ({
				id: hole.id,
				partId: hole.partId,
				centerMm: hole.centerMm,
			})),
		).toEqual([
			{
				id: "knob-GAIN",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 32.85 },
			},
			{
				id: "knob-LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 32.85 },
			},
			{
				id: "led-status",
				partId: "led-bezel-lh5",
				centerMm: { x: 0, y: -5.475 },
			},
			{
				id: "switch-bypass",
				partId: "switch-3pdt-pic-pbs24302",
				centerMm: { x: 0, y: -21.9 },
			},
			{
				id: "jack-input",
				partId: "jack-ts-pj629han",
				centerMm: { x: 30.25, y: 0 },
			},
			{
				id: "jack-output",
				partId: "jack-ts-pj629han",
				centerMm: { x: -30.25, y: 0 },
			},
		]);
		expect(
			twoKnobLayout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("uses fitting MXR knobs for one and two knob default layouts", () => {
		const oneKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["VOLUME"]),
			{
				includePowerJack: false,
			},
		);
		const twoKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["GAIN", "LEVEL"]),
			{
				includePowerJack: false,
			},
		);
		const twoKnobHoles = twoKnobLayout.holes.filter((hole) =>
			hole.id.startsWith("knob-"),
		);

		expect(
			oneKnobLayout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-VOLUME",
				partId: MXR_LARGE_KNOB_ID,
				centerMm: { x: 0, y: 32.85 },
			},
		]);
		expect(
			twoKnobHoles.map((hole) => ({
				id: hole.id,
				partId: hole.partId,
				centerMm: hole.centerMm,
			})),
		).toEqual([
			{
				id: "knob-GAIN",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 32.85 },
			},
			{
				id: "knob-LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 32.85 },
			},
		]);
		expect(minimumKnobClearanceMm(twoKnobHoles)).toBeGreaterThanOrEqual(5);
	});

	test("sizes the knob grid from the selected enclosure width", () => {
		const oneKnob1590a = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["VOLUME"]),
			{
				enclosureId: "box-1590a",
				includePowerJack: false,
			},
		);
		const twoKnob1590a = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["GAIN", "LEVEL"]),
			{
				enclosureId: "box-1590a",
				includePowerJack: false,
			},
		);
		const twoKnob1590b = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["GAIN", "LEVEL"]),
			{
				enclosureId: "box-1590b",
				includePowerJack: false,
			},
		);

		expect(
			oneKnob1590a.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-VOLUME",
				partId: MXR_LARGE_KNOB_ID,
				centerMm: { x: 0, y: 22.625 },
			},
		]);
		expect(
			twoKnob1590a.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-GAIN",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -10.1, y: 22.625 },
			},
			{
				id: "knob-LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 10.1, y: 22.625 },
			},
		]);
		expect(
			twoKnob1590b.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-GAIN",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 32.85 },
			},
			{
				id: "knob-LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 32.85 },
			},
		]);
	});

	test("uses MXR-style as the default profile for three normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["SUSTAIN", "TONE", "LEVEL"]),
			{
				includePowerJack: false,
			},
		);
		const knobHoles = layout.holes.filter((hole) =>
			hole.id.startsWith("knob-"),
		);

		expect(
			knobHoles.map((hole) => ({
				id: hole.id,
				partId: hole.partId,
				centerMm: hole.centerMm,
			})),
		).toEqual([
			{
				id: "knob-SUSTAIN",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 0, y: 43.8 },
			},
			{
				id: "knob-TONE",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 21.9 },
			},
			{
				id: "knob-LEVEL",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 21.9 },
			},
		]);
		expect(minimumKnobClearanceMm(knobHoles)).toBeGreaterThan(0);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("uses Boss-style when explicitly selected for two normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["RATE", "DEPTH"]),
			{
				includePowerJack: false,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);

		expect(
			layout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-RATE",
				partId: BOSS_MEDIUM_KNOB_ID,
				centerMm: { x: -14.625, y: 32.85 },
			},
			{
				id: "knob-DEPTH",
				partId: BOSS_MEDIUM_KNOB_ID,
				centerMm: { x: 14.625, y: 32.85 },
			},
		]);
	});

	test("uses Boss-style when explicitly selected for three normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["SUSTAIN", "TONE", "LEVEL"]),
			{
				includePowerJack: false,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);

		expect(
			layout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-SUSTAIN",
				partId: BOSS_MEDIUM_KNOB_ID,
				centerMm: { x: -14.625, y: 43.8 },
			},
			{
				id: "knob-TONE",
				partId: BOSS_MEDIUM_KNOB_ID,
				centerMm: { x: 14.625, y: 43.8 },
			},
			{
				id: "knob-LEVEL",
				partId: BOSS_SMALL_KNOB_ID,
				centerMm: { x: 0, y: 21.9 },
			},
		]);
	});

	test("places Boss-style LEDs, side audio jacks, and 9V connector around the three-knob profile", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithBossStyleControls,
			{
				includePowerJack: true,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);

		expect(
			layout.holes.map((hole) => ({
				id: hole.id,
				face: hole.face,
				centerMm: hole.centerMm,
				partId: hole.partId,
			})),
		).toContainEqual({
			id: "led-CHECK",
			face: "top",
			centerMm: { x: 0, y: 50.15 },
			partId: "led-bezel-lh5",
		});
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "jack-IN",
				face: "right",
				centerMm: { x: 30.25, y: 5.475 },
			}),
		);
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "jack-OUT",
				face: "left",
				centerMm: { x: -30.25, y: 5.475 },
			}),
		);
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "power-9v",
				face: "back",
				centerMm: { x: 0, y: 0 },
			}),
		);
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "switch-bypass",
				face: "top",
				centerMm: { x: 0, y: -32.85 },
			}),
		);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("places MXR-style audio and power jacks on a five-slot side grid", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				includePowerJack: true,
			},
		);

		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "jack-IN",
				face: "right",
				centerMm: { x: 30.25, y: 0 },
			}),
		);
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "jack-OUT",
				face: "left",
				centerMm: { x: -30.25, y: 0 },
			}),
		);
		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "power-9v",
				face: "right",
				centerMm: { x: 30.25, y: -12.55 },
			}),
		);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("stacks multiple audio jacks on the same side face using the Boss-style side grid", () => {
		const layout = createStompboxDrillLayoutFromVdsp(vdspWithStackedSideJacks, {
			includePowerJack: false,
			styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
		});

		expect(
			layout.holes
				.filter((hole) => hole.partId === "jack-ts-pj629han")
				.map((hole) => ({
					id: hole.id,
					face: hole.face,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{ id: "jack-IN_A", face: "right", centerMm: { x: 30.25, y: 5.475 } },
			{ id: "jack-IN_B", face: "right", centerMm: { x: 30.25, y: -5.475 } },
			{ id: "jack-OUT_A", face: "left", centerMm: { x: -30.25, y: 5.475 } },
			{ id: "jack-OUT_B", face: "left", centerMm: { x: -30.25, y: -5.475 } },
		]);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("uses MXR-style as the default profile for four normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["A", "B", "C", "D"]),
			{
				includePowerJack: false,
			},
		);

		expect(
			layout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-A",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 43.8 },
			},
			{
				id: "knob-B",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 43.8 },
			},
			{
				id: "knob-C",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 21.9 },
			},
			{
				id: "knob-D",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 21.9 },
			},
		]);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("uses Boss-style when explicitly selected for four normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["A", "B", "C", "D"]),
			{
				includePowerJack: false,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);

		expect(
			layout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-A",
				partId: BOSS_SMALL_KNOB_ID,
				centerMm: { x: -21.937, y: 32.85 },
			},
			{
				id: "knob-B",
				partId: BOSS_SMALL_KNOB_ID,
				centerMm: { x: -7.312, y: 32.85 },
			},
			{
				id: "knob-C",
				partId: BOSS_SMALL_KNOB_ID,
				centerMm: { x: 7.313, y: 32.85 },
			},
			{
				id: "knob-D",
				partId: BOSS_SMALL_KNOB_ID,
				centerMm: { x: 21.938, y: 32.85 },
			},
		]);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("uses MXR-style default rows for five and six normal knobs", () => {
		const fiveKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["A", "B", "C", "D", "E"]),
			{
				includePowerJack: false,
			},
		);
		const sixKnobLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(["A", "B", "C", "D", "E", "F"]),
			{
				includePowerJack: false,
			},
		);

		expect(
			fiveKnobLayout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-A",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -14.625, y: 43.8 },
			},
			{
				id: "knob-B",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 14.625, y: 43.8 },
			},
			{
				id: "knob-C",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -20.2, y: 21.9 },
			},
			{ id: "knob-D", partId: MXR_SMALL_KNOB_ID, centerMm: { x: 0, y: 21.9 } },
			{
				id: "knob-E",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 20.2, y: 21.9 },
			},
		]);
		expect(
			sixKnobLayout.holes
				.filter((hole) => hole.id.startsWith("knob-"))
				.map((hole) => ({
					id: hole.id,
					partId: hole.partId,
					centerMm: hole.centerMm,
				})),
		).toEqual([
			{
				id: "knob-A",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -20.2, y: 43.8 },
			},
			{ id: "knob-B", partId: MXR_SMALL_KNOB_ID, centerMm: { x: 0, y: 43.8 } },
			{
				id: "knob-C",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 20.2, y: 43.8 },
			},
			{
				id: "knob-D",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: -20.2, y: 21.9 },
			},
			{ id: "knob-E", partId: MXR_SMALL_KNOB_ID, centerMm: { x: 0, y: 21.9 } },
			{
				id: "knob-F",
				partId: MXR_SMALL_KNOB_ID,
				centerMm: { x: 20.2, y: 21.9 },
			},
		]);
		expect(
			fiveKnobLayout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
		expect(
			sixKnobLayout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("keeps the Boss-style LED row above four normal knobs", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithPotentiometers(
				["A", "B", "C", "D"],
				`
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
    sourceTypeName: "Circuit.LED, Circuit"`,
			),
			{
				includePowerJack: false,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);

		expect(layout.holes).toContainEqual(
			expect.objectContaining({
				id: "led-CHECK",
				face: "top",
				centerMm: { x: 0, y: 50.15 },
			}),
		);
	});

	test("can omit the synthesized 9V connector explicitly", () => {
		const layout = createStompboxDrillLayoutFromVdsp(vdspWithControlsOnly, {
			includePowerJack: false,
		});

		expect(layout.holes.map((hole) => hole.id)).toEqual([
			"knob-GAIN",
			"knob-LEVEL",
			"led-status",
			"switch-bypass",
			"jack-input",
			"jack-output",
		]);
	});

	test("uses declared .vdsp physical placement when available", () => {
		const document = parseCircuitDocumentFile(vdspWithPhysicalPlacement, {
			filename: "declared-layout.vdsp",
		});
		const layout = createStompboxDrillLayout(document);

		expect(
			layout.holes.map((hole) => ({
				id: hole.id,
				controlId: hole.controlId,
				partId: hole.partId,
				face: hole.face,
				centerMm: hole.centerMm,
				drillDiameterMm: hole.drillDiameterMm,
				provenance: hole.provenance,
			})),
		).toEqual([
			{
				id: "tone-knob",
				controlId: "TONE",
				partId: "knob-cm42-bb",
				face: "top",
				centerMm: { x: -14, y: 32 },
				drillDiameterMm: 6,
				provenance: "vdsp-declared",
			},
			{
				id: "status-led",
				controlId: "LED1",
				partId: "led-bezel-lh5",
				face: "top",
				centerMm: { x: 14, y: 12 },
				drillDiameterMm: 7.94,
				provenance: "vdsp-declared",
			},
			{
				id: "switch-bypass",
				controlId: undefined,
				partId: "switch-3pdt-pic-pbs24302",
				face: "top",
				centerMm: { x: 0, y: -43.8 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
			{
				id: "jack-input",
				controlId: undefined,
				partId: "jack-ts-pj629han",
				face: "right",
				centerMm: { x: 30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "jack-output",
				controlId: undefined,
				partId: "jack-ts-pj629han",
				face: "left",
				centerMm: { x: -30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "power-9v",
				controlId: undefined,
				partId: "dc-socket-dc099",
				face: "right",
				centerMm: { x: 30.25, y: -12.55 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
		]);
		expect(layout.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			"placement-auto-generated",
			"placement-auto-generated",
			"placement-auto-generated",
			"placement-auto-generated",
		]);
	});

	test("uses declared panel grid centers when .vdsp omits physical coordinates", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithGridPlacementOnly,
			{
				enclosureId: "box-1590a",
				includePowerJack: false,
			},
		);
		const knobs = layout.holes.filter((hole) => hole.id.endsWith("-knob"));

		expect(
			knobs.map((hole) => ({
				id: hole.id,
				controlId: hole.controlId,
				centerMm: hole.centerMm,
				provenance: hole.provenance,
			})),
		).toEqual([
			{
				id: "drive-knob",
				controlId: "DRIVE",
				centerMm: { x: -13, y: 30.833 },
				provenance: "auto-generated",
			},
			{
				id: "tone-knob",
				controlId: "TONE",
				centerMm: { x: -13, y: 0 },
				provenance: "auto-generated",
			},
			{
				id: "level-knob",
				controlId: "LEVEL",
				centerMm: { x: 13, y: 30.833 },
				provenance: "auto-generated",
			},
		]);
		expect(knobs[0]?.centerMm.x).toBe(knobs[1]?.centerMm.x);
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});

	test("reports unsupported controls, unknown part mappings, collisions, and out-of-panel placements", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithDiagnosticPlacements,
		);
		const diagnosticCodes = layout.diagnostics.map(
			(diagnostic) => diagnostic.code,
		);

		expect(diagnosticCodes).toContain("unknown-part-profile");
		expect(diagnosticCodes).toContain("unsupported-control");
		expect(diagnosticCodes).toContain("placement-collision");
		expect(diagnosticCodes).toContain("placement-out-of-bounds");
		expect(layout.diagnostics).toContainEqual({
			code: "unknown-part-profile",
			message: 'Unknown stompbox part profile "missing-knob-profile"',
			controlId: "A",
			placementId: "unknown-part-knob",
		});
		expect(
			layout.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "placement-collision" &&
					diagnostic.placementId === "unknown-part-knob" &&
					diagnostic.face === "top",
			),
		).toBe(true);
		expect(
			layout.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "placement-out-of-bounds" &&
					diagnostic.placementId === "out-of-bounds-knob" &&
					diagnostic.face === "top",
			),
		).toBe(true);
	});

	test("reports configurable part-clearance violations without treating them as collisions", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithTightKnobClearance,
			{
				includePowerJack: false,
				minPartClearanceMm: 5,
			},
		);

		expect(layout.diagnostics).toContainEqual({
			code: "placement-clearance",
			message:
				'Placements "knob-a" and "knob-b" have 3.8 mm clearance on top, below required 5 mm',
			placementId: "knob-a",
			face: "top",
		});
		expect(
			layout.diagnostics.some(
				(diagnostic) => diagnostic.code === "placement-collision",
			),
		).toBe(false);
	});
});

describe("stompbox drill template modes", () => {
	test("creates a lightweight preview template for UI preview", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
		);
		const template = createStompboxDrillTemplate(layout, { mode: "preview" });

		expect(template).toMatchObject({
			schema: "stompbox-drill-template/v1",
			mode: "preview",
			units: "mm",
			scale: 1,
			page: undefined,
			detailLevel: "preview",
		});
		expect(template.canvasMm).toEqual({ widthMm: 122.5, heightMm: 173.5 });
		expect(template.scaleMarks).toEqual([]);
		expect(template.holeTable).toEqual([]);
		expect(template.holes).toHaveLength(7);
		expect(
			template.holes.find((hole) => hole.id === "knob-GAIN")?.templateCenterMm,
		).toEqual({ x: 46.625, y: 53.9 });
		expect(
			template.holes.find((hole) => hole.id === "jack-IN")?.templateCenterMm,
		).toEqual({ x: 107, y: 86.75 });
		expect(
			template.holes.find((hole) => hole.id === "jack-OUT")?.templateCenterMm,
		).toEqual({ x: 15.5, y: 86.75 });
		expect(
			template.holes.find((hole) => hole.id === "power-9v")?.templateCenterMm,
		).toEqual({ x: 107, y: 99.3 });
	});

	test("creates an A4 1:1 print template with scale marks", () => {
		const template = createStompboxDrillTemplateFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				mode: "print",
				includePowerJack: true,
			},
		);

		expect(template.schema).toBe("stompbox-drill-template/v1");
		expect(template.mode).toBe("print");
		expect(template.detailLevel).toBe("fabrication-detail");
		expect(template.scale).toBe(1);
		expect(template.page).toEqual({
			paper: "A4",
			orientation: "portrait",
			widthMm: 210,
			heightMm: 297,
			marginMm: 12,
		});
		expect(template.canvasMm).toEqual({ widthMm: 210, heightMm: 297 });
		expect(template.scaleMarks).toEqual([
			{
				id: "scale-10mm",
				label: "10 mm",
				lengthMm: 10,
				startMm: { x: 12, y: 285 },
				endMm: { x: 22, y: 285 },
			},
			{
				id: "scale-50mm",
				label: "50 mm",
				lengthMm: 50,
				startMm: { x: 12, y: 278 },
				endMm: { x: 62, y: 278 },
			},
		]);
		expect(
			template.holeTable.map((hole) => ({
				id: hole.id,
				face: hole.face,
				centerMm: hole.centerMm,
				drillDiameterMm: hole.drillDiameterMm,
				provenance: hole.provenance,
			})),
		).toEqual([
			{
				id: "knob-GAIN",
				face: "top",
				centerMm: { x: -14.625, y: 32.85 },
				drillDiameterMm: 7.14375,
				provenance: "auto-generated",
			},
			{
				id: "knob-LEVEL",
				face: "top",
				centerMm: { x: 14.625, y: 32.85 },
				drillDiameterMm: 7.14375,
				provenance: "auto-generated",
			},
			{
				id: "led-LED1",
				face: "top",
				centerMm: { x: 0, y: -5.475 },
				drillDiameterMm: 7.9375,
				provenance: "auto-generated",
			},
			{
				id: "switch-SW1",
				face: "top",
				centerMm: { x: 0, y: -21.9 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
			{
				id: "jack-IN",
				face: "right",
				centerMm: { x: 30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "jack-OUT",
				face: "left",
				centerMm: { x: -30.25, y: 0 },
				drillDiameterMm: 9.525,
				provenance: "auto-generated",
			},
			{
				id: "power-9v",
				face: "right",
				centerMm: { x: 30.25, y: -12.55 },
				drillDiameterMm: 12.7,
				provenance: "auto-generated",
			},
		]);
	});

	test("serializes drill templates as SVG in preview and A4 print modes", () => {
		const previewLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
		);
		const previewSvg = createStompboxDrillTemplateSvg(previewLayout, {
			mode: "preview",
		});
		const printSvg = createStompboxDrillTemplateSvgFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				mode: "print",
				includePowerJack: true,
			},
		);

		expect(previewSvg).toStartWith("<svg ");
		expect(previewSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(previewSvg).toContain('data-template-mode="preview"');
		expect(previewSvg).toContain('viewBox="0 0 122.5 173.5"');
		expect(previewSvg).toContain(
			'<title id="stompbox-drill-preview-title">Stompbox drill template preview</title>',
		);
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
		expect(previewSvg).toContain(
			'data-hole-id="jack-IN" data-part-profile-id="jack-ts-pj629han" data-face="right" data-template-face="right" data-provenance="auto-generated" data-drill-diameter-mm="9.525" data-drill-radius-mm="4.7625" data-part-visible-diameter-mm="11"',
		);
		expect(previewSvg).toContain(
			'data-hole-id="jack-OUT" data-part-profile-id="jack-ts-pj629han" data-face="left" data-template-face="left" data-provenance="auto-generated" data-drill-diameter-mm="9.525" data-drill-radius-mm="4.7625" data-part-visible-diameter-mm="11"',
		);
		expect(previewSvg).toContain(
			'data-hole-id="power-9v" data-part-profile-id="dc-socket-dc099" data-face="right" data-template-face="right" data-provenance="auto-generated" data-drill-diameter-mm="12.7" data-drill-radius-mm="6.35" data-part-visible-diameter-mm="14.1"',
		);
		expect(
			drillTemplateLabelY(previewSvg, "power-9v", "9V DC"),
		).toBeGreaterThan(drillTemplateOuterCircleBottom(previewSvg, "power-9v"));
		expect(previewSvg).toContain(
			'data-drill-hole-profile-id="audio-jack-24mm-pot-3-8"',
		);
		expect(previewSvg).toContain(
			'data-drill-hole-profile-id="dc-jack-3pdt-1-2"',
		);
		expect(previewSvg).toContain(
			'data-drill-hole-profile-id="metal-5mm-led-bezel-5-16"',
		);
		expect(previewSvg).toContain(
			'data-drill-hole-profile-fraction-inches="3/8&quot;"',
		);
		expect(previewSvg).toContain('class="hole drill-hole-profile-outer"');
		expect(previewSvg).toContain(".hole{fill:none;");
		expect(previewSvg).not.toContain('fill="#fff"');
		expect(previewSvg).toContain('class="drill-hole-center-dot"');
		expect(previewSvg).toContain('r="4.7625"');
		expect(previewSvg).toContain('r="6.35"');
		expect(previewSvg).not.toContain('class="crosshair"');
		expect(previewSvg).not.toContain('data-scale-mark-id="scale-50mm"');
		expect(previewSvg).not.toContain("A4 1:1");

		expect(printSvg).toStartWith("<svg ");
		expect(printSvg).toContain('width="210mm"');
		expect(printSvg).toContain('height="297mm"');
		expect(printSvg).toContain('viewBox="0 0 210 297"');
		expect(printSvg).toContain('data-template-mode="print"');
		expect(printSvg).toContain(
			'<title id="stompbox-drill-print-title">Stompbox drill template print</title>',
		);
		expect(printSvg).toContain('data-scale-mark-id="scale-10mm"');
		expect(printSvg).toContain('data-scale-mark-id="scale-50mm"');
		expect(printSvg).not.toContain('data-print-header="true"');
		expect(printSvg).not.toContain('data-hole-table="true"');
		expect(printSvg).toContain('<text class="label"');
		expect(printSvg).toContain(">Gain</text>");
		expect(printSvg).toContain(">Level</text>");
		expect(printSvg).toContain(">Status</text>");
		expect(printSvg).not.toContain(">Bypass</text>");
		expect(printSvg).toContain(">Input</text>");
		expect(printSvg).toContain(">Output</text>");
		expect(printSvg).toContain(">9V DC</text>");
		expect(printSvg).toContain("power-9v");
		expect(drillTemplateLabelY(printSvg, "power-9v", "9V DC")).toBeGreaterThan(
			drillTemplateOuterCircleBottom(printSvg, "power-9v"),
		);
	});

	test("renders customization decals as outlines in preview and print drill-template modes", () => {
		const previewLayout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
		);
		const previewSvg = createStompboxDrillTemplateSvg(previewLayout, {
			mode: "preview",
			decals: customDecals,
		});
		const printSvg = createStompboxDrillTemplateSvgFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				mode: "print",
				includePowerJack: true,
				decals: customDecals,
			},
		);

		expect(previewSvg).toContain('data-decal-outline="true"');
		expect(previewSvg).toContain('data-decal-id="brand"');
		expect(previewSvg).toContain('data-decal-id="badge"');
		expect(previewSvg).not.toContain("Fuzz Lab");
		expect(previewSvg).not.toContain("data:image/svg+xml");

		expect(printSvg).toContain('data-decal-outline="true"');
		expect(printSvg).toContain('data-decal-id="brand"');
		expect(printSvg).toContain('data-decal-id="badge"');
		expect(printSvg).not.toContain('data-decal-sheet="true"');
		expect(printSvg).not.toContain("Fuzz Lab");
		expect(printSvg).not.toContain("data:image/svg+xml");
	});

	test("applies programmable appearance to drill-template enclosure, holes, guides, and labels", () => {
		const layout = createStompboxDrillLayoutFromVdsp(
			vdspWithoutPhysicalPlacement,
		);
		const svg = createStompboxDrillTemplateSvg(layout, {
			mode: "preview",
			appearance: {
				enclosure: {
					color: "#ffedd5",
					strokeColor: "#9a3412",
				},
				template: {
					guideColor: "#0ea5e9",
					foldColor: "#f97316",
					holeStrokeColor: "#7c3aed",
					holeFillColor: "#faf5ff",
					centerDotColor: "#581c87",
				},
				defaults: {
					label: { color: "#14532d" },
				},
				controls: {
					GAIN: { label: { text: "DRIVE", color: "#166534" } },
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
		expect(svg).toContain(">DRIVE</text>");
		expect(svg).toContain('fill="#14532d"');
	});
});

describe("stompbox runtime preview state", () => {
	test("merges source panel controls with compiled runtime controls without importing a runtime", () => {
		const document = parseCircuitDocumentFile(vdspWithGridPlacementOnly, {
			filename: "grid-layout.vdsp",
		});
		const surface = createStompboxControlSurface(document, {
			pedalId: "stage-1",
			compiledControls: [
				{
					id: "control-tone-runtime",
					sourceComponentId: "TONE",
					name: "Tone",
					kind: "potentiometer",
					value: 250,
					defaultBehavior: "source",
					min: 100,
					max: 1100,
					step: 10,
					unit: "ohm",
					sweep: "linear",
					targets: [{ resistorIndex: 0, role: "variable" }],
				},
				{
					id: "control-level-runtime",
					sourceComponentId: "LEVEL",
					name: "Level",
					kind: "potentiometer",
					value: 0.9,
					min: 0,
					max: 1,
					step: 0.01,
					sweep: "audio",
					targets: [{ resistorIndex: 1, role: "pot-upper" }],
				},
			],
		});

		expect(surface.schema).toBe("stompbox-control-surface/v1");
		expect(surface.pedalId).toBe("stage-1");
		expect(
			surface.controls.map((control) => ({
				id: control.id,
				runtimeControlId: control.runtimeControlId,
				source: control.source,
				label: control.label,
				defaultValue: control.value,
				unit: control.unit,
				sweep: control.sweep,
			})),
		).toEqual([
			{
				id: "DRIVE",
				runtimeControlId: undefined,
				source: "source-panel",
				label: "Drive",
				defaultValue: 0.5,
				unit: undefined,
				sweep: undefined,
			},
			{
				id: "TONE",
				runtimeControlId: "control-tone-runtime",
				source: "compiled",
				label: "Tone",
				defaultValue: 250,
				unit: "ohm",
				sweep: "linear",
			},
			{
				id: "LEVEL",
				runtimeControlId: "control-level-runtime",
				source: "compiled",
				label: "Level",
				defaultValue: 0.5,
				unit: undefined,
				sweep: "audio",
			},
		]);
		expect(
			surface.panel.knobs.map((knob) => ({
				id: knob.id,
				name: knob.name,
				defaultPosition: knob.defaultPosition,
			})),
		).toEqual([
			{ id: "DRIVE", name: "Drive", defaultPosition: 0.5 },
			{ id: "TONE", name: "Tone", defaultPosition: 0.15 },
			{ id: "LEVEL", name: "Level", defaultPosition: 0.5 },
		]);
	});

	test("turns knobs, presses synthesized footswitches, and emits preview patches without rendering", () => {
		const preview = createStompboxPreviewFromVdsp(vdspWithControlsOnly);
		const state = createDefaultStompboxPedalStateFromVdsp(
			vdspWithControlsOnly,
			{
				pedalId: "stage-1",
				enabled: false,
			},
		);
		const surface = createStompboxControlSurface(
			parseCircuitDocumentFile(vdspWithControlsOnly, {
				filename: "controls-only.vdsp",
			}),
			{ pedalId: "stage-1" },
		);
		const knobCommand = createStompboxKnobTurnCommand(surface, {
			controlId: "GAIN",
			position: 0.8,
		});
		const withGain = applyStompboxPreviewInteraction(state, knobCommand);
		const footswitchCommand = createStompboxFootswitchPressCommand(surface, {
			partId: "switch-bypass",
			pressed: true,
		});
		const enabled = applyStompboxPreviewInteraction(
			withGain,
			footswitchCommand,
		);
		const patch = createStompboxPreviewStatePatch(preview, enabled, state);

		expect(knobCommand).toEqual({
			type: "set-control-value",
			controlId: "GAIN",
			value: { kind: "knob", position: 0.8 },
		} satisfies StompboxPedalStateCommand);
		expect(footswitchCommand).toEqual({
			type: "set-enabled",
			enabled: true,
		} satisfies StompboxPedalStateCommand);
		expect(enabled.enabled).toBe(true);
		expect(enabled.controls.GAIN).toEqual({ kind: "knob", position: 0.8 });
		expect(enabled.revision).toBe(state.revision + 2);
		expect(patch.parts["part-knob-GAIN"]).toEqual(
			expect.objectContaining({
				targetId: "part-knob-GAIN",
				previewPartId: "knob-GAIN",
				controlId: "GAIN",
				value: { kind: "knob", position: 0.8 },
				transform: expect.objectContaining({
					rotationDeg: expect.objectContaining({ z: -81 }),
				}),
			}),
		);
		expect(patch.parts["part-switch-bypass"]).toEqual(
			expect.objectContaining({
				targetId: "part-switch-bypass",
				previewPartId: "switch-bypass",
				value: { kind: "switch", position: 1 },
				stateTarget: expect.objectContaining({
					role: "footswitch.actuator",
					nodeName: "switch-bypass/o1.3",
					travelAxis: "z",
					travelMm: 1.2,
				}),
			}),
		);
		expect(patch.parts["part-switch-bypass"]?.transform).toBeUndefined();
		expect(patch.parts["part-led-status"]).toEqual(
			expect.objectContaining({
				targetId: "part-led-status",
				previewPartId: "led-status",
				value: { kind: "led", on: true },
				stateTarget: expect.objectContaining({
					role: "led.lens",
					nodeName: "led-status/o1.2",
				}),
				material: expect.objectContaining({
					emissive: true,
					intensity: 1,
				}),
			}),
		);
		expect(patch.parts["part-knob-LEVEL"]).toBeUndefined();
	});

	test("presses source-backed footswitch preview parts by resolving their control id", () => {
		const state = createDefaultStompboxPedalStateFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				pedalId: "stage-1",
			},
		);
		const surface = createStompboxControlSurface(
			parseCircuitDocumentFile(vdspWithoutPhysicalPlacement, {
				filename: "auto-layout.vdsp",
			}),
			{ pedalId: "stage-1" },
		);
		const command = createStompboxFootswitchPressCommand(surface, {
			partId: "switch-SW1",
			pressed: true,
		});
		const store = createStompboxPedalStateStore(state);

		store.pressFootswitch("switch-SW1", true);

		expect(command).toEqual({
			type: "set-control-value",
			controlId: "SW1",
			value: { kind: "switch", position: 1 },
		} satisfies StompboxPedalStateCommand);
		expect(
			applyStompboxPreviewInteraction(state, command).controls.SW1,
		).toEqual({
			kind: "switch",
			position: 1,
		});
		expect(store.getSnapshot().controls.SW1).toEqual({
			kind: "switch",
			position: 1,
		});
	});

	test("notifies targeted subscribers and preview patch listeners from the headless store", () => {
		const preview = createStompboxPreviewFromVdsp(vdspWithControlsOnly);
		const state = createDefaultStompboxPedalStateFromVdsp(
			vdspWithControlsOnly,
			{
				pedalId: "stage-1",
			},
		);
		const store = createStompboxPedalStateStore(state, { preview });
		const allEvents: string[] = [];
		const gainEvents: unknown[] = [];
		const levelEvents: unknown[] = [];
		const patches: string[][] = [];

		const unsubscribeAll = store.subscribe((event) => {
			allEvents.push(`${event.previous.revision}->${event.current.revision}`);
		});
		const unsubscribeGain = store.subscribeControl("GAIN", (value) => {
			gainEvents.push(value);
		});
		const unsubscribeLevel = store.subscribeControl("LEVEL", (value) => {
			levelEvents.push(value);
		});
		const unsubscribePatch = store.subscribePreviewPatch((patch) => {
			patches.push(Object.keys(patch.parts).sort());
		});

		store.turnKnob("GAIN", 1);
		store.setEnabled(true);
		unsubscribeGain();
		store.turnKnob("GAIN", 0.25);
		unsubscribeAll();
		unsubscribeLevel();
		unsubscribePatch();
		store.turnKnob("LEVEL", 0.75);

		expect(allEvents).toEqual(["0->1", "1->2", "2->3"]);
		expect(gainEvents).toEqual([{ kind: "knob", position: 1 }]);
		expect(levelEvents).toEqual([]);
		expect(patches).toEqual([
			["part-knob-GAIN"],
			["part-led-status", "part-switch-bypass"],
			["part-knob-GAIN"],
		]);
		expect(store.getSnapshot().controls.LEVEL).toEqual({
			kind: "knob",
			position: 0.75,
		});
	});
});

describe("stompbox preview manifest", () => {
	test("normalizes text and SVG customization decals for preview outputs", () => {
		const preview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				decals: customDecals,
			},
		);

		expect(preview.decals.slice(0, 2)).toEqual([
			{
				id: "brand",
				kind: "text",
				text: "Fuzz Lab",
				face: "top",
				centerMm: { x: 0, y: 9 },
				sizeMm: { widthMm: 34, heightMm: 7 },
				rotationDeg: 0,
				color: "#f97316",
				fontFamily: "Arial",
				fontSizeMm: 4.55,
			},
			{
				id: "badge",
				kind: "svg",
				svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 1 L9 9 H1 Z" fill="none" stroke="black"/></svg>',
				face: "top",
				centerMm: { x: 0, y: -12 },
				sizeMm: { widthMm: 14, heightMm: 12 },
				rotationDeg: 0,
			},
		]);
		expect(preview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-knob-GAIN",
				kind: "text",
				text: "GAIN",
			}),
		);
	});

	test("adds style-aware labels for every preview control", () => {
		const mxrPreview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				includePowerJack: true,
			},
		);
		const bossPreview = createStompboxPreviewFromVdsp(
			vdspWithBossStyleControls,
			{
				includePowerJack: true,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);
		const bossSynthesizedLedPreview = createStompboxPreviewFromVdsp(
			vdspWithPotentiometers(["A", "B", "C"]),
			{
				includePowerJack: false,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);
		const opaqueJackPreview = createStompboxPreviewFromVdsp(
			vdspWithOpaqueJackNames,
			{
				includePowerJack: false,
			},
		);

		expect(
			mxrPreview.decals
				.filter((decal) => decal.id.startsWith("label-"))
				.map((decal) => ({
					id: decal.id,
					kind: decal.kind,
					text: decal.kind === "text" ? decal.text : "",
					face: decal.face,
					rotationDeg: decal.rotationDeg,
				})),
		).toEqual([
			{
				id: "label-knob-GAIN",
				kind: "text",
				text: "GAIN",
				face: "top",
				rotationDeg: 0,
			},
			{
				id: "label-knob-LEVEL",
				kind: "text",
				text: "LEVEL",
				face: "top",
				rotationDeg: 0,
			},
			{
				id: "label-led-LED1",
				kind: "text",
				text: "STATUS",
				face: "top",
				rotationDeg: 0,
			},
			{
				id: "label-jack-IN",
				kind: "text",
				text: "INPUT",
				face: "top",
				rotationDeg: 90,
			},
			{
				id: "label-jack-OUT",
				kind: "text",
				text: "OUTPUT",
				face: "top",
				rotationDeg: -90,
			},
			{
				id: "label-power-9v",
				kind: "text",
				text: "9V DC",
				face: "right",
				rotationDeg: 0,
			},
		]);
		expect(
			mxrPreview.decals.find((decal) => decal.id === "label-jack-IN"),
		).toEqual(
			expect.objectContaining({
				centerMm: { x: 23.95, y: 0 },
				rotationDeg: 90,
			}),
		);
		expect(
			mxrPreview.decals.find((decal) => decal.id === "label-jack-OUT"),
		).toEqual(
			expect.objectContaining({
				centerMm: { x: -23.95, y: 0 },
				rotationDeg: -90,
			}),
		);
		expect(
			mxrPreview.decals.some((decal) => decal.id.startsWith("label-switch-")),
		).toBe(false);
		expect(
			bossPreview.decals.some((decal) => decal.id.startsWith("label-switch-")),
		).toBe(false);
		expect(
			mxrPreview.drillLayout.holes.find((hole) => hole.id === "switch-SW1")
				?.label,
		).toBeUndefined();

		expect(bossPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-led-CHECK",
				kind: "text",
				text: "CHECK",
				face: "top",
			}),
		);
		expect(
			bossPreview.decals.find((decal) => decal.id === "label-led-CHECK")
				?.centerMm.y,
		).toBeGreaterThan(
			bossPreview.drillLayout.holes.find((hole) => hole.id === "led-CHECK")
				?.centerMm.y ?? 0,
		);
		expect(bossPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-jack-IN",
				kind: "text",
				text: "INPUT",
				face: "top",
				rotationDeg: 0,
			}),
		);
		expect(bossPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-jack-OUT",
				kind: "text",
				text: "OUTPUT",
				face: "top",
				rotationDeg: 0,
			}),
		);
		expect(
			bossPreview.decals.find((decal) => decal.id === "label-jack-IN")?.centerMm
				.y,
		).toBe(5.475);
		expect(
			bossPreview.decals.find((decal) => decal.id === "label-jack-OUT")
				?.centerMm.y,
		).toBe(5.475);
		expect(bossPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-power-9v",
				kind: "text",
				text: "9V DC",
				face: "back",
				centerMm: { x: 0, y: -11.05 },
				rotationDeg: 0,
			}),
		);
		expect(bossSynthesizedLedPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-led-status",
				kind: "text",
				text: "CHECK",
				face: "top",
			}),
		);
		expect(opaqueJackPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-jack-J1",
				kind: "text",
				text: "INPUT",
				face: "top",
			}),
		);
		expect(opaqueJackPreview.decals).toContainEqual(
			expect.objectContaining({
				id: "label-jack-J2",
				kind: "text",
				text: "OUTPUT",
				face: "top",
			}),
		);
	});

	test("ignores knob color appearance so source knob materials are preserved", () => {
		const appearance = {
			defaults: {
				knob: { color: "#facc15" },
			},
			controls: {
				LEVEL: {
					knob: {
						color: "#111827",
						indicatorColor: "#ef4444",
						strokeColor: "#020617",
					},
				},
			},
			parts: {
				"knob-GAIN": { color: "#facc15" },
				"part-knob-LEVEL": { color: "#111827", strokeColor: "#020617" },
			},
		} as unknown as StompboxAppearance;
		const preview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
			},
		);
		const views = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
			},
		);
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);
		const gltf = parseJsonChunkFromGlb(assembly.bytes);
		const patch = createStompboxAppearancePatch(preview);

		expect(
			preview.parts.find((part) => part.id === "knob-GAIN")?.material,
		).toBeUndefined();
		expect(
			preview.parts.find((part) => part.id === "knob-LEVEL")?.material,
		).toBeUndefined();
		expect(patch.parts["part-knob-GAIN"]).toBeUndefined();
		expect(patch.parts["part-knob-LEVEL"]).toBeUndefined();
		expect(views.views.top).toContain('class="knob-indicator"');
		expect(views.views.top).toContain('stroke="#f8fafc"');
		expect(views.views.top).not.toContain('fill="#facc15"');
		expect(views.views.top).not.toContain('stroke="#ef4444"');
		expect(
			(
				gltf.nodes?.find((node) => node.name === "part-knob-GAIN")?.extras as
					| GltfExtras
					| undefined
			)?.material,
		).toBeUndefined();
		expect(
			(
				gltf.nodes?.find((node) => node.name === "part-knob-LEVEL")?.extras as
					| GltfExtras
					| undefined
			)?.material,
		).toBeUndefined();
		expect(
			gltf.materials?.some(
				(material) =>
					material.name?.startsWith("knob-GAIN/") &&
					(material.extras as GltfExtras | undefined)?.renderColorMode ===
						"flat-color",
			),
		).toBe(false);
		expect(
			gltf.nodes?.some((node) => node.name?.startsWith("knob-indicator-")),
		).toBe(false);
		expect(
			gltf.materials?.some((material) =>
				material.name?.startsWith("knob-indicator-"),
			),
		).toBe(false);

		const explicitPreview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance: {
					controls: {
						GAIN: {
							knob: { color: "#facc15", indicatorColor: "#ef4444" },
						},
					},
				} as unknown as StompboxAppearance,
			},
		);
		expect(
			explicitPreview.parts.find((part) => part.id === "knob-GAIN")?.material,
		).toBeUndefined();
	});

	test("places text, vector, and image stickers on face grids without subdivision", () => {
		const decals = [
			{
				id: "grid-top-label",
				kind: "text",
				text: "TOP",
				face: "top",
				placement: { kind: "grid", columns: 4, rows: 4, column: 2, row: 3 },
				sizeMm: { widthMm: 18, heightMm: 6 },
				color: "#2563eb",
				fontFamily: '"Roboto", sans-serif',
				fontSizeMm: 3.5,
			},
			{
				id: "grid-left-image",
				kind: "image",
				href: "data:image/png;base64,AAAA",
				face: "left",
				placement: { kind: "grid", columns: 2, rows: 4, column: 1, row: 2 },
				sizeMm: { widthMm: 8, heightMm: 10 },
			},
			{
				id: "grid-right-vector",
				kind: "svg",
				svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 5 H9" stroke="currentColor"/></svg>',
				color: "#ef4444",
				face: "right",
				placement: { kind: "grid", columns: 2, rows: 4, column: 2, row: 2 },
				sizeMm: { widthMm: 10, heightMm: 8 },
			},
			{
				id: "grid-back-label",
				kind: "text",
				text: "BACK",
				face: "back",
				placement: { kind: "grid", columns: 4, rows: 1, column: 4, row: 1 },
				sizeMm: { widthMm: 16, heightMm: 5 },
				color: "#0f172a",
				fontFamily: '"Inter", sans-serif',
			},
			{
				id: "grid-bottom-label",
				kind: "text",
				text: "BOTTOM",
				face: "bottom",
				placement: { kind: "grid", columns: 4, rows: 2, column: 2, row: 2 },
				sizeMm: { widthMm: 22, heightMm: 5 },
				color: "#f97316",
			},
			{
				id: "dense-grid-label",
				kind: "text",
				text: "DENSE",
				face: "top",
				placement: { kind: "grid", columns: 8, rows: 10, column: 8, row: 10 },
				sizeMm: { widthMm: 14, heightMm: 5 },
			},
		] as const;
		const preview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{ decals },
		);
		const views = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
			{ decals },
		);
		const templateSvg = createStompboxDrillTemplateSvgFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				decals,
				mode: "preview",
			},
		);
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				decals,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);
		const gltf = parseJsonChunkFromGlb(assembly.bytes);

		expect(
			preview.decals.find((decal) => decal.id === "grid-top-label"),
		).toEqual(
			expect.objectContaining({
				kind: "text",
				face: "top",
				centerMm: { x: -7.562, y: -13.937 },
				color: "#2563eb",
				fontFamily: '"Roboto", sans-serif',
				fontSizeMm: 3.5,
				placement: { kind: "grid", columns: 4, rows: 4, column: 2, row: 3 },
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "grid-left-image"),
		).toEqual(
			expect.objectContaining({
				kind: "image",
				face: "left",
				centerMm: { x: -7.75, y: 13.938 },
				href: "data:image/png;base64,AAAA",
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "grid-right-vector"),
		).toEqual(
			expect.objectContaining({
				kind: "svg",
				face: "right",
				centerMm: { x: 7.75, y: 13.938 },
				color: "#ef4444",
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "grid-back-label"),
		).toEqual(
			expect.objectContaining({
				face: "back",
				centerMm: { x: 22.688, y: 0 },
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "grid-bottom-label"),
		).toEqual(
			expect.objectContaining({
				face: "bottom",
				centerMm: { x: -7.562, y: -7.75 },
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "dense-grid-label"),
		).toEqual(
			expect.objectContaining({
				face: "top",
				centerMm: { x: 24.2, y: -49.556 },
				placement: { kind: "grid", columns: 5, rows: 9, column: 5, row: 9 },
			}),
		);

		expect(views.views.top).toContain('data-decal-id="grid-top-label"');
		expect(views.views.top).toContain(
			'font-family="&quot;Roboto&quot;, sans-serif"',
		);
		expect(views.views.left).toContain('data-decal-id="grid-left-image"');
		expect(views.views.left).toContain(
			'transform="translate(7.75 41.812) rotate(0)"',
		);
		expect(views.views.left).toContain('href="data:image/png;base64,AAAA"');
		expect(views.views.right).toContain('data-decal-id="grid-right-vector"');
		expect(views.views.right).toContain(
			'transform="translate(23.25 41.812) rotate(0)"',
		);
		expect(views.views.right).toContain("%23ef4444");
		expect(views.views.back).toContain('data-view="back"');
		expect(views.views.back).toContain('data-decal-id="grid-back-label"');
		expect(views.views.back).toContain(
			'transform="translate(52.938 15.5) rotate(0)"',
		);
		expect(views.views.bottom).toContain('data-decal-id="grid-bottom-label"');

		expect(templateSvg).toContain('data-decal-id="grid-bottom-label"');
		expect(templateSvg).toContain('data-decal-kind="image"');
		expect(templateSvg).toContain('data-face="left"');

		expect(
			gltfExtras(
				gltf.nodes?.find((node) => node.name === "decal-grid-left-image")
					?.extras,
			),
		).toEqual(
			expect.objectContaining({
				kind: "decal",
				decalKind: "image",
				face: "left",
				href: "data:image/png;base64,AAAA",
				placement: { kind: "grid", columns: 2, rows: 4, column: 1, row: 2 },
			}),
		);
		expect(
			gltfExtras(
				gltf.nodes?.find((node) => node.name === "decal-grid-right-vector")
					?.extras,
			),
		).toEqual(
			expect.objectContaining({
				decalKind: "svg",
				color: "#ef4444",
			}),
		);
	});

	test("applies programmable appearance to preview parts, labels, SVG hooks, and GLB metadata", () => {
		const appearance = {
			enclosure: {
				color: "#f97316",
				strokeColor: "#7c2d12",
				roughnessFactor: 0.45,
			},
			defaults: {
				led: { color: "#ef4444", offColor: "#fee2e2", strokeColor: "#7f1d1d" },
				label: { color: "#111827", fontFamily: "Arial,sans-serif" },
			},
			controls: {
				GAIN: {
					label: { text: "DRIVE", color: "#ffffff" },
				},
				LED1: {
					led: {
						color: "#22c55e",
						offColor: "#064e3b",
						strokeColor: "#052e16",
					},
					label: { text: "READY", color: "#16a34a" },
				},
			},
		} as const;
		const preview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
				state: {
					LED1: { kind: "led", on: true, intensity: 0.6 },
				},
			},
		);
		const views = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
				state: {
					LED1: { kind: "led", on: true, intensity: 0.6 },
				},
			},
		);
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				appearance,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				state: {
					LED1: { kind: "led", on: true, intensity: 0.6 },
				},
			},
		);
		const gltf = parseJsonChunkFromGlb(assembly.bytes);
		const patch = createStompboxAppearancePatch(preview);
		const resolved = resolveStompboxAppearance(preview);

		expect(preview.enclosure.material).toEqual({
			color: "#f97316",
			strokeColor: "#7c2d12",
			roughnessFactor: 0.45,
		});
		expect(
			preview.parts.find((part) => part.id === "knob-GAIN")?.material,
		).toBeUndefined();
		expect(
			preview.parts.find((part) => part.id === "knob-LEVEL")?.material,
		).toBeUndefined();
		expect(
			preview.parts.find((part) => part.id === "led-LED1")?.material,
		).toEqual({
			color: "#22c55e",
			emissive: true,
			intensity: 0.6,
			offColor: "#064e3b",
			strokeColor: "#052e16",
		});
		expect(
			preview.decals.find((decal) => decal.id === "label-knob-GAIN"),
		).toEqual(
			expect.objectContaining({
				kind: "text",
				text: "DRIVE",
				color: "#ffffff",
			}),
		);
		expect(
			preview.decals.find((decal) => decal.id === "label-led-LED1"),
		).toEqual(
			expect.objectContaining({
				kind: "text",
				text: "READY",
				color: "#16a34a",
			}),
		);

		expect(patch).toEqual(resolved);
		expect(patch.enclosure).toEqual({
			targetId: "enclosure-box-1590b",
			color: "#f97316",
			strokeColor: "#7c2d12",
			roughnessFactor: 0.45,
		});
		expect(patch.parts["part-knob-GAIN"]).toBeUndefined();
		expect(patch.parts["part-led-LED1"]).toEqual({
			targetId: "part-led-LED1",
			partId: "led-bezel-lh5",
			controlId: "LED1",
			family: "led",
			color: "#22c55e",
			emissive: true,
			intensity: 0.6,
			offColor: "#064e3b",
			strokeColor: "#052e16",
		});
		expect(patch.decals["decal-label-knob-GAIN"]).toEqual({
			targetId: "decal-label-knob-GAIN",
			decalId: "label-knob-GAIN",
			kind: "text",
			face: "top",
			text: "DRIVE",
			color: "#ffffff",
			fontFamily: "Arial,sans-serif",
			fontSizeMm: 3.2,
		});

		expect(views.views.top).toContain('data-part-family="knob"');
		expect(views.views.top).toContain('data-control-id="GAIN"');
		expect(views.views.top).toContain('class="knob-body"');
		expect(views.views.top).not.toContain('fill="#facc15"');
		expect(views.views.top).not.toContain('stroke="#854d0e"');
		expect(views.views.top).toContain('class="knob-indicator"');
		expect(views.views.top).toContain('stroke="#f8fafc"');
		expect(views.views.top).toContain('class="led-lens"');
		expect(views.views.top).toContain('class="led-bezel-ring"');
		expect(views.views.top).toContain('fill="#22c55e"');
		expect(views.views.top).toContain(">DRIVE</text>");
		expect(views.views.top).toContain('class="label-text"');
		expect(views.views.top).toContain('fill="#ffffff"');

		const extras = gltfExtras(gltf.asset?.extras);
		const appearanceExtras = extras.appearance as typeof patch;
		expect(appearanceExtras.parts["part-knob-GAIN"]).toBeUndefined();
		expect(appearanceExtras.decals["decal-label-knob-GAIN"]?.text).toBe(
			"DRIVE",
		);
		const gainNode = gltf.nodes?.find((node) => node.name === "part-knob-GAIN");
		expect(
			(gainNode?.extras as GltfExtras | undefined)?.material,
		).toBeUndefined();
		expect(
			gltf.materials?.some(
				(material) =>
					material.name?.startsWith("knob-GAIN/") &&
					(material.extras as GltfExtras | undefined)?.renderColorMode ===
						"flat-color",
			),
		).toBe(false);
		const enclosureOrangeMaterial = gltf.materials?.find(
			(material) =>
				material.name?.startsWith("box-1590b/") &&
				material.pbrMetallicRoughness?.baseColorFactor?.[0] === 249 / 255 &&
				material.pbrMetallicRoughness.baseColorFactor[1] === 115 / 255 &&
				material.pbrMetallicRoughness.baseColorFactor[2] === 22 / 255,
		);
		expect(gltfExtras(enclosureOrangeMaterial?.extras)).toEqual(
			expect.objectContaining({
				appearanceMaterial: {
					color: "#f97316",
					strokeColor: "#7c2d12",
					roughnessFactor: 0.45,
				},
				renderColorMode: "flat-color",
			}),
		);
		expect(gltf.nodes?.some((node) => node.name === "part-led-LED1-lens")).toBe(
			false,
		);
		expect(
			gltf.materials?.some(
				(material) => material.name === "led-LED1/lens-material",
			),
		).toBe(false);
		const ledRingMesh = gltf.meshes?.find(
			(mesh) =>
				mesh.name?.includes("led-LED1/") &&
				mesh.name.includes("metal_bezel_ring"),
		);
		const ledLensMesh = gltf.meshes?.find(
			(mesh) =>
				mesh.name?.includes("led-LED1/") && mesh.name.includes("5mm_led_lens"),
		);
		const ledRingMaterialIndex = ledRingMesh?.primitives?.[0]?.material;
		const ledLensMaterialIndex = ledLensMesh?.primitives?.[0]?.material;
		const ledRingMaterial =
			ledRingMaterialIndex === undefined
				? undefined
				: gltf.materials?.[ledRingMaterialIndex];
		const ledLensMaterial =
			ledLensMaterialIndex === undefined
				? undefined
				: gltf.materials?.[ledLensMaterialIndex];
		expect(ledRingMaterial?.pbrMetallicRoughness?.baseColorFactor).not.toEqual([
			34 / 255,
			197 / 255,
			94 / 255,
			1,
		]);
		expect(ledLensMaterial?.pbrMetallicRoughness?.baseColorFactor).toEqual([
			34 / 255,
			197 / 255,
			94 / 255,
			1,
		]);
		expect(ledLensMaterial?.emissiveFactor).toEqual([
			(34 / 255) * 0.6,
			(197 / 255) * 0.6,
			(94 / 255) * 0.6,
		]);
	});

	test("maps knob positions from left end to right end", () => {
		expect(knobRotationDegForPosition(0)).toBe(135);
		expect(knobRotationDegForPosition(0.5)).toBe(0);
		expect(knobRotationDegForPosition(1)).toBe(-135);
	});

	test("uses drill placement and applies runtime visual state", () => {
		const preview = createStompboxPreviewFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				state: {
					GAIN: { kind: "knob", position: 1 },
					LED1: { kind: "led", on: true, intensity: 0.7 },
					SW1: { kind: "switch", position: 1 },
				},
			},
		);

		const gain = preview.parts.find((part) => part.id === "knob-GAIN")!;
		const status = preview.parts.find((part) => part.id === "led-LED1")!;
		const bypass = preview.parts.find((part) => part.id === "switch-SW1")!;
		const input = preview.parts.find((part) => part.id === "jack-IN")!;

		expect(preview.schema).toBe("stompbox-preview/v1");
		expect(gain.transform.translationMm).toEqual({
			x: -14.625,
			y: 32.85,
			z: 15.5,
		});
		expect(gain.transform.rotationDeg.z).toBe(-135);
		expect(status.material).toEqual({
			color: "red",
			emissive: true,
			intensity: 0.7,
		});
		expect(bypass.transform.translationMm.z).toBe(14.3);
		expect(input.transform.rotationDeg).toEqual({ x: 0, y: 90, z: 0 });
	});

	test("uses declared placement for preview part transforms and asset references", () => {
		const document = parseCircuitDocumentFile(vdspWithPhysicalPlacement, {
			filename: "declared-layout.vdsp",
		});
		const preview = createStompboxPreview(document, { baseUrl: "/cad/parts" });

		expect(
			preview.parts.map((part) => ({
				id: part.id,
				partId: part.partId,
				provenance: part.provenance,
				glb: part.assets.glb,
				translationMm: part.transform.translationMm,
			})),
		).toEqual([
			{
				id: "tone-knob",
				partId: "knob-cm42-bb",
				provenance: "vdsp-declared",
				glb: "/cad/parts/knob-cm42-bb/.tayda-a6078-cm42-bb.step.glb",
				translationMm: { x: -14, y: 32, z: 15.5 },
			},
			{
				id: "status-led",
				partId: "led-bezel-lh5",
				provenance: "vdsp-declared",
				glb: "/cad/parts/led-bezel-lh5/.pedal-parts-and-kits-bzl-5mm-p.step.glb",
				translationMm: { x: 14, y: 12, z: 15.5 },
			},
			{
				id: "switch-bypass",
				partId: "switch-3pdt-pic-pbs24302",
				provenance: "auto-generated",
				glb: "/cad/parts/switch-3pdt-pic-pbs24302/.pic-pbs24302.step.glb",
				translationMm: { x: 0, y: -43.8, z: 15.5 },
			},
			{
				id: "jack-input",
				partId: "jack-ts-pj629han",
				provenance: "auto-generated",
				glb: "/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb",
				translationMm: { x: 30.25, y: 0, z: 0 },
			},
			{
				id: "jack-output",
				partId: "jack-ts-pj629han",
				provenance: "auto-generated",
				glb: "/cad/parts/jack-ts-pj629han/.pj-629han-05.step.glb",
				translationMm: { x: -30.25, y: 0, z: 0 },
			},
			{
				id: "power-9v",
				partId: "dc-socket-dc099",
				provenance: "auto-generated",
				glb: "/cad/parts/dc-socket-dc099/.dc099.step.glb",
				translationMm: { x: 30.25, y: -12.55, z: 0 },
			},
		]);
	});

	test("serializes top, bottom, left, and right preview SVG views", () => {
		const views = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				includePowerJack: true,
				decals: customDecals,
				state: {
					GAIN: { kind: "knob", position: 1 },
					LED1: { kind: "led", on: true, intensity: 0.7 },
					SW1: { kind: "switch", position: 1 },
				},
			},
		);

		expect(views.schema).toBe("stompbox-preview-svg-views/v1");
		expect(views.preview.schema).toBe("stompbox-preview/v1");
		expect(views.views.top).toContain('data-view="top"');
		expect(views.views.top).toContain(
			'<title id="stompbox-preview-top-title">Stompbox preview top view</title>',
		);
		expect(views.views.top).toContain('data-part-id="knob-GAIN"');
		expect(views.views.top).toContain('data-knob-rotation-deg="-135"');
		expect(views.views.top).toContain('transform="rotate(135 15.625 22.9)"');
		expect(views.views.top).toContain('data-led-emissive="true"');
		expect(views.views.top).toContain('data-footswitch-pressed="true"');
		expect(views.views.top).toContain('data-decal-id="brand"');
		expect(views.views.top).toContain('data-decal-kind="text"');
		expect(views.views.top).toContain("Fuzz Lab");
		expect(views.views.top).toContain('data-decal-id="badge"');
		expect(views.views.top).toContain("data:image/svg+xml");
		expect(views.views.top).toContain('data-decal-id="label-knob-GAIN"');
		expect(views.views.top).toContain("GAIN");
		expect(views.views.top).toContain('data-decal-id="label-jack-IN"');
		expect(views.views.top).toContain(
			'transform="translate(54.2 55.75) rotate(90)"',
		);
		expect(views.views.top).toContain(
			'transform="translate(6.3 55.75) rotate(-90)"',
		);
		expect(views.views.top).toContain("INPUT");
		expect(views.views.top).not.toContain("data-top-edge-projection");
		expect(views.views.top).not.toContain('data-part-id="jack-IN"');
		expect(views.views.top).not.toContain('data-part-id="jack-OUT"');
		expect(views.views.top).not.toContain('data-part-id="power-9v"');
		expect(views.views.bottom).toContain('data-view="bottom"');
		expect(views.views.left).toContain('data-view="left"');
		expect(views.views.left).toContain('data-part-id="jack-OUT"');
		expect(views.views.left).toContain('class="ring-outer"');
		expect(views.views.right).toContain('data-view="right"');
		expect(views.views.right).toContain('data-part-id="jack-IN"');
		expect(views.views.right).toContain('data-part-id="power-9v"');
		expect(views.views.right).toContain('class="ring-outer"');
	});

	test("adds optional grain filter overlays to preview SVG views", () => {
		const cleanViews = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
		);
		const grainViews = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				grain: { opacity: 0.1 },
			},
		);

		expect(cleanViews.views.top).not.toContain('data-grain-overlay="true"');
		expect(grainViews.views.top).toContain(
			".grain-overlay{mix-blend-mode:soft-light}",
		);
		expect(grainViews.views.top).toContain(
			'<filter id="stompbox-preview-top-noise-filter"',
		);
		expect(grainViews.views.top).toContain(
			'<feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="10" stitchTiles="stitch" result="noise"',
		);
		expect(grainViews.views.top).toContain(
			'<feColorMatrix in="noise" type="saturate" values="0" result="mono-noise"',
		);
		expect(grainViews.views.top).toContain(
			'<feFuncR type="linear" slope="0.18" intercept="0.41"',
		);
		expect(grainViews.views.top).toContain('<feFuncA type="linear" slope="1"');
		expect(grainViews.views.top).toContain(
			'<clipPath id="stompbox-preview-top-grain-clip">',
		);
		expect(grainViews.views.top).toContain(
			'<rect x="0" y="0" width="60.5" height="111.5" rx="2.5"/>',
		);
		expect(grainViews.views.top).toContain('class="grain-overlay"');
		expect(grainViews.views.top).toContain('data-grain-overlay="true"');
		expect(grainViews.views.top).toContain('fill="#808080"');
		expect(grainViews.views.top).toContain(
			'filter="url(#stompbox-preview-top-noise-filter)"',
		);
		expect(grainViews.views.top).toContain(
			'clip-path="url(#stompbox-preview-top-grain-clip)"',
		);
		expect(grainViews.views.top).toContain('opacity="0.1"');
		expect(grainViews.views.top).toContain('pointer-events="none"');
		expect(grainViews.views.bottom).toContain(
			'filter="url(#stompbox-preview-bottom-noise-filter)"',
		);
		expect(grainViews.views.bottom).toContain(
			'clip-path="url(#stompbox-preview-bottom-grain-clip)"',
		);
	});

	test("renders Boss-style 9V connector and label on the back face", () => {
		const preview = createStompboxPreviewFromVdsp(vdspWithBossStyleControls, {
			includePowerJack: true,
			styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
		});
		const views = createStompboxPreviewSvgViewsFromVdsp(
			vdspWithBossStyleControls,
			{
				includePowerJack: true,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
			},
		);
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithBossStyleControls,
			{
				includePowerJack: true,
				styleProfile: BOSS_STOMPBOX_STYLE_PROFILE,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
			},
		);
		const gltf = parseJsonChunkFromGlb(assembly.bytes);
		const powerPart = preview.parts.find((part) => part.id === "power-9v");
		const powerLabel = preview.decals.find(
			(decal) => decal.id === "label-power-9v",
		);
		const powerNode = gltf.nodes?.find((node) => node.name === "part-power-9v");
		const powerHoleBackingNode = gltf.nodes?.find(
			(node) => node.name === "hole-backing-power-9v",
		);
		const powerLabelNode = gltf.nodes?.find(
			(node) => node.name === "decal-label-power-9v",
		);

		expect(powerPart?.face).toBe("back");
		expect(powerPart?.transform.translationMm).toEqual({
			x: 0,
			y: 55.75,
			z: 0,
		});
		expect(powerLabel).toEqual(
			expect.objectContaining({
				face: "back",
				centerMm: { x: 0, y: -11.05 },
			}),
		);
		expect(views.views.top).not.toContain('data-part-id="power-9v"');
		expect(views.views.right).not.toContain('data-part-id="power-9v"');
		expect(views.views.back).toContain('data-view="back"');
		expect(views.views.back).toContain('data-part-id="power-9v"');
		expect(views.views.back).toContain(
			'<circle class="ring-outer" cx="30.25" cy="15.5" r="7.05"',
		);
		expect(views.views.back).toContain('data-decal-id="label-power-9v"');
		expect(views.views.back).toContain(
			'transform="translate(30.25 26.55) rotate(0)"',
		);
		expect(views.views.back).toContain(">9V DC</text>");
		expect(powerNode?.translation).toEqual([0, 55.75, 0]);
		expect(powerHoleBackingNode?.translation).toEqual([0, 55.75, 0]);
		expect(gltfExtras(powerHoleBackingNode?.extras)).toEqual(
			expect.objectContaining({
				kind: "hole-backing",
				partId: "power-9v",
				sourcePartId: "dc-socket-dc099",
				face: "back",
			}),
		);
		expect(powerLabelNode?.translation).toEqual([0, 55.95, -11.05]);
	});

	test("serializes a binary GLB preview assembly with source GLB nodes and transforms", () => {
		const assembly = createStompboxPreviewGlbFromVdsp(
			vdspWithoutPhysicalPlacement,
			{
				includePowerJack: true,
				basePath: DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				decals: customDecals,
				state: {
					GAIN: { kind: "knob", position: 1 },
					LED1: { kind: "led", on: true, intensity: 0.7 },
					SW1: { kind: "switch", position: 1 },
				},
			},
		);
		const gltf = parseJsonChunkFromGlb(assembly.bytes);
		const extras = gltfExtras(gltf.asset?.extras);
		const nodes = gltf.nodes ?? [];

		expect(assembly.schema).toBe("stompbox-preview-glb/v1");
		expect(assembly.mimeType).toBe("model/gltf-binary");
		expect(assembly.bytes).toBeInstanceOf(Uint8Array);
		expect(assembly.preview.parts).toHaveLength(7);
		expect(glbChunkTypes(assembly.bytes)).toEqual(["JSON", "BIN"]);
		expect(gltf.asset?.version).toBe("2.0");
		expect(gltf.asset?.generator).toBe("@vessel-dsp/stompbox");
		expect(gltf.buffers?.[0]?.byteLength).toBeGreaterThan(0);
		expect(gltf.bufferViews?.length).toBeGreaterThan(0);
		expect(gltf.accessors?.length).toBeGreaterThan(0);
		expect(gltf.meshes?.length).toBeGreaterThan(0);
		expect(extras.schema).toBe("stompbox-preview-glb/v1");
		expect(extras.units).toBe("mm");
		expect(extras.sourceAssets?.map((asset) => asset.id)).toEqual([
			"box-1590b",
			"knob-GAIN",
			"knob-LEVEL",
			"led-LED1",
			"switch-SW1",
			"jack-IN",
			"jack-OUT",
			"power-9v",
		]);
		expect(extras.sourceAssets?.[1]?.glb).toBe(
			join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				"knob-mxr-style-fluted/.daier-mf-b01.step.glb",
			),
		);
		expect(nodes.some((node) => node.name === "enclosure-box-1590b")).toBe(
			true,
		);
		expect(
			assembly.preview.decals.slice(0, 2).map((decal) => decal.id),
		).toEqual(["brand", "badge"]);
		expect(assembly.preview.decals.map((decal) => decal.id)).toContain(
			"label-knob-GAIN",
		);

		const gainNode = nodes.find((node) => node.name === "part-knob-GAIN");
		const ledNode = nodes.find((node) => node.name === "part-led-LED1");
		const switchNode = nodes.find((node) => node.name === "part-switch-SW1");
		const inputHoleBackingNode = nodes.find(
			(node) => node.name === "hole-backing-jack-IN",
		);
		const outputHoleBackingNode = nodes.find(
			(node) => node.name === "hole-backing-jack-OUT",
		);
		const powerHoleBackingNode = nodes.find(
			(node) => node.name === "hole-backing-power-9v",
		);
		const brandNode = nodes.find((node) => node.name === "decal-brand");
		const badgeNode = nodes.find((node) => node.name === "decal-badge");
		const gainLabelNode = nodes.find(
			(node) => node.name === "decal-label-knob-GAIN",
		);
		const inputLabelNode = nodes.find(
			(node) => node.name === "decal-label-jack-IN",
		);
		const outputLabelNode = nodes.find(
			(node) => node.name === "decal-label-jack-OUT",
		);
		const brandMaterial = gltf.materials?.find(
			(material) => material.name === "decal-brand/material",
		);
		const holeBackingMaterial = gltf.materials?.find(
			(material) => material.name === "hole-backing/material",
		);
		expect(gainNode?.children?.length).toBeGreaterThan(0);
		expect(gainNode?.translation).toEqual([-14.625, 32.85, 15.5]);
		expect(gainNode?.rotation).toEqual([0, 0, -0.92388, 0.382683]);
		expect(gltfExtras(gainNode?.extras).glb).toBe(
			join(
				DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT,
				"knob-mxr-style-fluted/.daier-mf-b01.step.glb",
			),
		);
		expect(gltfExtras(ledNode?.extras).stateTargets).toEqual({
			led: {
				lens: expect.objectContaining({
					role: "led.lens",
					nodeName: "led-LED1/o1.2",
					meshName:
						"led-LED1/pedal_parts_and_kits_bzl_5mm_p_bezel_stub_5mm_led_lens",
				}),
			},
		});
		expect(switchNode?.translation).toEqual([0, -21.9, 14.3]);
		expect(gltfExtras(switchNode?.extras).stateTargets).toEqual({
			footswitch: {
				actuator: expect.objectContaining({
					role: "footswitch.actuator",
					nodeName: "switch-SW1/o1.3",
					meshName:
						"switch-SW1/pic_pbs24302_3pdt_footswitch_exterior_stub_stepped_10mm_plunger_6p5mm_tall",
					travelAxis: "z",
					travelMm: 1.2,
				}),
			},
		});
		expect(inputHoleBackingNode?.mesh).toBeDefined();
		expect(outputHoleBackingNode?.mesh).toBeDefined();
		expect(powerHoleBackingNode?.mesh).toBeDefined();
		expect(
			positionAccessorForNode(gltf, inputHoleBackingNode)?.min?.[2],
		).toBeGreaterThan(0);
		expect(
			positionAccessorForNode(gltf, inputHoleBackingNode)?.max?.[2],
		).toBeGreaterThan(0);
		expect(
			positionAccessorForNode(gltf, powerHoleBackingNode)?.min?.[2],
		).toBeGreaterThan(0);
		expect(
			positionAccessorForNode(gltf, powerHoleBackingNode)?.max?.[2],
		).toBeGreaterThan(0);
		expect(gltfExtras(inputHoleBackingNode?.extras)).toEqual(
			expect.objectContaining({
				kind: "hole-backing",
				partId: "jack-IN",
				sourcePartId: "jack-ts-pj629han",
				face: "right",
			}),
		);
		expect(gltfExtras(powerHoleBackingNode?.extras)).toEqual(
			expect.objectContaining({
				kind: "hole-backing",
				partId: "power-9v",
				sourcePartId: "dc-socket-dc099",
				face: "right",
				diameterMm: 12,
			}),
		);
		expect(holeBackingMaterial?.doubleSided).toBe(true);
		expect(holeBackingMaterial?.pbrMetallicRoughness?.baseColorFactor).toEqual([
			0, 0, 0, 1,
		]);
		expect(brandNode?.translation).toEqual([0, 9, 15.7]);
		expect(brandNode?.rotation).toEqual([0, 0, 0, 1]);
		expect(gltfExtras(brandNode?.extras).kind).toBe("decal");
		expect(gltfExtras(brandNode?.extras).decalKind).toBe("text");
		expect(gltfExtras(brandNode?.extras).text).toBe("Fuzz Lab");
		expect(brandMaterial?.pbrMetallicRoughness?.baseColorFactor?.[3]).toBe(0);
		expect(gltfExtras(badgeNode?.extras).decalKind).toBe("svg");
		expect(gltfExtras(badgeNode?.extras).svg).toContain("<path");
		expect(gltfExtras(gainLabelNode?.extras).decalKind).toBe("text");
		expect(gltfExtras(gainLabelNode?.extras).text).toBe("GAIN");
		expect(inputLabelNode?.translation).toEqual([23.95, 0, 15.7]);
		expect(inputLabelNode?.rotation).toEqual([0, 0, 0.707107, 0.707107]);
		expect(gltfExtras(inputLabelNode?.extras)).toEqual(
			expect.objectContaining({
				text: "INPUT",
				rotationDeg: 90,
			}),
		);
		expect(outputLabelNode?.translation).toEqual([-23.95, 0, 15.7]);
		expect(outputLabelNode?.rotation).toEqual([0, 0, -0.707107, 0.707107]);
		expect(gltfExtras(outputLabelNode?.extras)).toEqual(
			expect.objectContaining({
				text: "OUTPUT",
				rotationDeg: -90,
			}),
		);
	});
});
