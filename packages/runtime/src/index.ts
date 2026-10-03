// Public surface of the v2 runtime: a compiled Program to audio.
//
// The runtime is a generic console and a compiled pedal is a ROM; the only thing it
// shares with the compiler is the Program contract, imported as types. Everything the
// browser surface and the report scripts use is exported here, and nothing outside
// `src/runtime/` reaches a console file directly.

export { ChainRuntime } from "./chain";
export {
	bypassNotModelledAdvisories,
	chainAdvisories,
	seamScale,
	type ChainAdvisory,
} from "./chain-advisories";
export { dacScaleFactor, outputConversionFullScale, outputDbfs } from "./chain-scale";
export {
	processorSlot,
	programSlot,
	resolveBypassMode,
	slotContract,
	type ChainSlot,
	type ExternalProcessor,
	type SlotContract,
	type StageCoverage,
} from "./chain-slot";
export {
	DEFAULT_NEWTON_MAX_ITERATIONS,
	ReferenceRuntime,
	RuntimeError,
	type RuntimeNodeVoltageSnapshot,
} from "./reference-runtime";
export type { SupplyAddress, SupplyInfo } from "./supply";
export {
	SETTLE_DEFAULTS,
	measureInputAttributable,
	measureSharedWindow,
	settledRender,
	settledSweepVerified,
	type SettleOptions,
} from "./settle";
export { supplyGroundConflicts, type SupplyGroundConflict } from "./supply-ground";
export { taperFraction } from "./taper";
export { V2WasmEngine } from "./v2-wasm-engine";
export * from "./calibrate";
export { admissionVerdict, predictedWorstCaseNs } from "./admission";
export type { AdmissionVerdict, RealtimeBudget } from "./admission";
// Worklet message contract: the only host-side surface for driving the bundled
// `dist/worklet/v2-audio-worklet.js` (shipped behind the `./worklet.js` subpath).
// Values: the processor name `addModule` registers, and the type-checked post
// helper. Types: the inbound/outbound messages, the chain slot descriptors, the
// bypass vocabulary, and the minimal port surface the helper needs.
export {
	postV2WorkletMessage,
	v2WorkletProcessorName,
	type BypassMode,
	type V2WorkletInboundMessage,
	type V2WorkletOutboundMessage,
	type V2WorkletPort,
	type V2WorkletSlot,
} from "./worklet/v2-worklet-protocol";
