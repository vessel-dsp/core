// The AudioWorklet processor name the player worklet bundle registers.
//
// Separate from the runtime protocol's `v2WorkletProcessorName` on purpose:
// the two bundles host different slot kinds (the runtime's runs programs
// only; the player's runs programs plus NAM plus IR), so sharing a name
// would let a page `addModule` one and address the other. The engine posts
// to and instantiates exactly this name.
export const playerWorkletProcessorName = "vessel-player-processor";
