import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function importDist(path) {
	return import(pathToFileURL(resolve(path)).href);
}

const core = await importDist("packages/core/dist/index.js");
const stompbox = await importDist("packages/stompbox/dist/index.js");
const controlUi = await importDist("packages/control-ui/dist/index.js");
const visualEffects = await importDist("packages/visual-effects/dist/index.js");
const amp = await importDist("packages/amp/dist/index.js");
const cabinet = await importDist("packages/cabinet/dist/index.js");
const compiler = await importDist("packages/compiler/dist/index.js");
const runtime = await importDist("packages/runtime/dist/index.js");
const chain = await importDist("packages/chain/dist/index.js");
const player = await importDist("packages/player/dist/index.js");

if (typeof core.parseCircuitDocument !== "function") {
	throw new Error(
		"packages/core/dist/index.js does not export parseCircuitDocument",
	);
}

if (typeof core.serializeCircuitJsonDocument !== "function") {
	throw new Error(
		"packages/core/dist/index.js does not export serializeCircuitJsonDocument",
	);
}

if (typeof core.parseCircuitJsonDocument !== "function") {
	throw new Error(
		"packages/core/dist/index.js does not export parseCircuitJsonDocument",
	);
}

if (typeof core.serializeLtspiceAsc !== "function") {
	throw new Error(
		"packages/core/dist/index.js does not export serializeLtspiceAsc",
	);
}

if (typeof core.convertCircuitDocumentFile !== "function") {
	throw new Error(
		"packages/core/dist/index.js does not export convertCircuitDocumentFile",
	);
}

if ("SchematicView" in core) {
	throw new Error(
		"packages/core/dist/index.js must stay headless and not export SchematicView",
	);
}

if (typeof stompbox.createStompboxDrillLayoutFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxDrillLayoutFromVdsp",
	);
}

if (typeof stompbox.createStompboxPreviewFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxPreviewFromVdsp",
	);
}

if (typeof stompbox.createStompboxDrillTemplateFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxDrillTemplateFromVdsp",
	);
}

if (typeof stompbox.createStompboxDrillTemplateSvgFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxDrillTemplateSvgFromVdsp",
	);
}

if (typeof stompbox.createStompboxPreviewGlbFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxPreviewGlbFromVdsp",
	);
}

if (typeof stompbox.createStompboxPreviewSvgViewsFromVdsp !== "function") {
	throw new Error(
		"packages/stompbox/dist/index.js does not export createStompboxPreviewSvgViewsFromVdsp",
	);
}

if ("SchematicView" in stompbox || "StompboxView" in stompbox) {
	throw new Error(
		"packages/stompbox/dist/index.js must stay headless and not export UI views",
	);
}

if (typeof controlUi.ControlSurface !== "function") {
	throw new Error(
		"packages/control-ui/dist/index.js does not export ControlSurface",
	);
}

if (typeof controlUi.KnobControl !== "function") {
	throw new Error(
		"packages/control-ui/dist/index.js does not export KnobControl",
	);
}

if (typeof controlUi.ControlUiThemeProvider !== "function") {
	throw new Error(
		"packages/control-ui/dist/index.js does not export ControlUiThemeProvider",
	);
}

if (typeof controlUi.createControlUiState !== "function") {
	throw new Error(
		"packages/control-ui/dist/index.js does not export createControlUiState",
	);
}

if (typeof visualEffects.resolvePreviewEffectPreset !== "function") {
	throw new Error(
		"packages/visual-effects/dist/index.js does not export resolvePreviewEffectPreset",
	);
}

if (typeof amp.createAmpPreviewLayout !== "function") {
	throw new Error(
		"packages/amp/dist/index.js does not export createAmpPreviewLayout",
	);
}

if (typeof cabinet.createCabinetPreviewLayout !== "function") {
	throw new Error(
		"packages/cabinet/dist/index.js does not export createCabinetPreviewLayout",
	);
}

if (typeof compiler.compile !== "function") {
	throw new Error("packages/compiler/dist/index.js does not export compile");
}

if (typeof runtime.ReferenceRuntime !== "function") {
	throw new Error(
		"packages/runtime/dist/index.js does not export ReferenceRuntime",
	);
}

if (typeof chain.SignalChain !== "function") {
	throw new Error("packages/chain/dist/index.js does not export SignalChain");
}

if (typeof chain.InputProfileNode !== "function") {
	throw new Error("packages/chain/dist/index.js does not export InputProfileNode");
}

if (typeof chain.NamNode !== "function") {
	throw new Error("packages/chain/dist/index.js does not export NamNode");
}

if (typeof chain.CabinetIrNode !== "function") {
	throw new Error("packages/chain/dist/index.js does not export CabinetIrNode");
}

if (typeof player.AudioEngine !== "function") {
	throw new Error("packages/player/dist/index.js does not export AudioEngine");
}

if (typeof player.SpectrumVisualizer !== "function") {
	throw new Error("packages/player/dist/index.js does not export SpectrumVisualizer");
}

if (typeof player.VesselPlayerElement !== "function") {
	throw new Error("packages/player/dist/index.js does not export VesselPlayerElement");
}

console.log("dist entrypoints ok");
