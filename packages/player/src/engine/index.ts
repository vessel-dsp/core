// `@vessel-dsp/player/engine` entry: opt-in real engine registration.
//
// Re-exports the registration surface. Importing this subpath (never the
// main barrel) is what pulls the compiler, the runtime, and the chain NAM
// boundary into a page bundle.
export { registerPlayerEngine, RealPlayerEngine, playerWorkletProcessorName } from "./register.js";
export type { RegisterPlayerEngineOptions, RealPlayerEngineOptions } from "./register.js";
