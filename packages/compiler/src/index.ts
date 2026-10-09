// Public surface of the v2 compiler: `.vdsp` source text to a compiled Program.
//
// This is the whole of what leaves the module. `@vessel-dsp/runtime`, the browser
// surface and the report scripts import from here; nothing outside `src/compiler/`
// reaches a stage file directly. Report-only helpers live in `./diagnostics`, and the
// synthetic circuits the tests and the parity instruments share live in `./fixtures`.
//
// Adding a name here is a public-API decision. A stage that needs to be reached from a
// script is a diagnostics export, not a public one.

export { compile, compileToArtifact, type CompileOptions } from "./compile";
export { emit } from "./emit";
export { parseQuantity, readNetlist } from "./netlist";
export {
	emptyRegistry,
	foldPartId,
	foldToken,
	registryEntryFor,
	registryLawFor,
	type PartEntry,
	type PartRegistry,
	type PartSection,
} from "./registry";
export { canonicalPartId } from "./part-number";
export { pedalPartCatalog, zenerCatalogPartIds, gateOnlyFetPartIds } from "./part-catalog";
export {
	resolveSupplyStamps,
	type RefusedSupply,
	type ResolvedSupply,
	type SupplyAddress,
	type SupplyRefusalReason,
	type SupplyResolution,
} from "./supply-stamps";
export { attachDeviceLaws } from "./device-laws";
// Order construction for the runtime's sparse path: the value-blind static
// schedule is built at compile time, and the value-aware re-pivot is built by
// the runtime from the operating-point matrix at `prepare()`. Both are
// schedule-builder work, so both live here; the C++ console ports the latter.
export { NUMERIC_REPIVOT_TAU, computeNumericRepivot } from "./sparse-schedule";
export * from "./types";
