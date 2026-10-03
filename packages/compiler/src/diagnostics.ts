// Report-only reach into compiler stages.
//
// The instruments under `scripts/` need to see inside a stage -- which nodes a stamp
// touches, how a block row reads, whether a packet is disconnected -- without those
// helpers becoming the compiler's public API. They are exported here, and only here, so
// the boundary stays checkable: `index.ts` is what a consumer builds on, this file is what
// a maintainer's instrument reads.

export { clockTimingNodes, deriveBbdDelayFromNetlist, findClockDriverDevice } from "./bbd-clock";
export { blockRow, describeRow, nodeAt } from "./block-row";
export { stampNodes } from "./dangling-active-terminal";
export { perSample, type PerSample } from "./denomination";
export { SILICON_FORWARD_BETA, SILICON_SATURATION_CURRENT, THERMAL_VOLTAGE } from "./device-laws";
export type { FirmwareClass } from "./firmware-class";
export { findBistableLatches, type BistableLatch } from "./latch-seed";
export { stampInSourceNodes } from "./lower";
export {
	OPEN_RULES,
	connectedToBothPorts,
	isPacketDisconnected,
	outputDependence,
	type NetGraph,
} from "./open-category";
export { validateProxy } from "./proxy-declaration";
export { clearRecordedReads, recordedReads, withRecordedReads } from "./registry";
export { speakerImpedance, speakerImpedanceMagnitude, speakerOnePort } from "./speaker-load";
