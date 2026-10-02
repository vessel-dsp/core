// Player input shared types.
//
// These two aliases are owned by player-inputs and must stay verbatim so the
// shell, IR, and input workers join without drift. Nothing in this file
// touches a browser global at import time.

export type InputChoice = { readonly kind: "wav"; readonly id: string; readonly label: string; readonly src: string } | { readonly kind: "browser"; readonly id: "browser-audio"; readonly label: string };

export type WavInput = { readonly sampleRate: number; readonly channels: readonly Float32Array[]; readonly frames: number };
