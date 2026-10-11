# host-rate harness (2026-10-11)

Scratch instruments for `docs/spikes/2026-10-10-host-rate.md`. Nothing here is a test or a shipped script. The engine under test is core main `49cc15c` plus
`~/worklet-oversample-phase1.patch` (sha256 `711df0f32e9328ff1951e6a4fc6e565e61dda3716221fbaf5b048f8f6641bada`), which is **not merged and not changed**;
`lib.ts` is adapted from that patch's `docs/spikes/worklet-oversample/lib.ts`.

**Every measurement runs in a fresh CLONE** (the nested worktree resolves into the main checkout's stale `dist`):

```
git clone <core> <scratch>/core-clone && cd <scratch>/core-clone && git checkout 49cc15c && git apply ~/worklet-oversample-phase1.patch
bun install --frozen-lockfile
source ~/projects/emsdk/emsdk_env.sh
bun run --cwd packages/runtime build:wasm     # v2_dsp.wasm cd27e58e63e8e9a92a52fe24cc4bcc1e6f97166ac795eef31e567f044f17c84a (as the phase-1 note)
bun run build
bun run --cwd packages/runtime build:worklet  # v2-audio-worklet.js 21dfa65a86ef616f2740a9d74b19c12f83e1ae6f93e28b9dd2b78502394b7286 (as the phase-1 note)
bash <worktree>/docs/spikes/host-rate/sync.sh <scratch>/core-clone   # copies this directory (not logs) to <clone>/docs/spikes/host-rate
export NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules   # playwright-core; bun honours it, node ESM does not
cd <scratch>/core-clone && bun docs/spikes/host-rate/<script>.ts ...
```

Browser legs render through the **real worklet bundle** in headless Chromium (149) `OfflineAudioContext`, which is as-fast-as-possible rendering and NOT a real-time audio
thread. `blocks.ts` drives the same bundle on the page's main thread (stub AudioWorkletGlobalScope, `performance.now()` per `process()` call).

| file | what it does |
|---|---|
| `probe-rates.mjs` | the first instrument probe (offline contexts at 8 k-768 k, live contexts at 48 k / 96 k / 192 k), run before the predictions were frozen |
| `predict.ts`, `PREDICTIONS.md` | the predictions as arithmetic (inputs: phase-1 figures and the stage designs only) and the frozen text; hashes in `logs/00-predictions-frozen.log` |
| `lib.ts` | host-rate-generalised browser harness (`render`, `blocks`, `page`), the probe fit, native references, idle gate, the resampler's calculated response |
| `validity.ts` | check 1: rates are real (A), determinism (B), NEGATIVE control (C), RC closed-form POSITIVE control (D) |
| `natives.ts` | native `ChainRuntime` references at 48 / 96 / 192 / 384 / 768 kHz (also the convergence column) |
| `accuracy.ts`, `accuracy-report.ts` | check 2: every arm x pedal x frequency x console through the worklet, and the joined tables |
| `latency.ts` | check 3 (offline): phase slope and impulse per arm, 1 slot and a 3-slot chain, and the real chain's `loaded.latencyHostSamples` |
| `live.ts` | check 3b: live `AudioContext` API readings and a clock-driven worklet run (no audio device on this box) |
| `cost.ts`, `blocks.ts`, `iterations.ts`, `subjects.ts` | check 4: xRT and telemetry, per-block p50/p99/max against 128/H, iterations per host / internal sample |
| `time-based.ts` | check 5a: delay repeat time, LFO rate, envelope time constants at each host rate |
| `audit-rates.sh`, `rate-constants.ts`, `nam-ir.ts` | check 5b / 5c: every hard-coded rate with file:line, the sample-count constants, NAM and IR at another host rate |
| `timing-report.ts`, `run-timing.sh` | check 4 tables (per-block, xRT, instrument cross-check, P4 ratios, P5 scoring) and the idle-gated order the timing series ran in |
| `clock-probe.ts` | what clock a worklet scope has (`typeof performance` is `undefined`; `Date.now()` steps 1 ms) |
| `table.ts` | check 6: the owner table and the computed dominance (two views) |
| `logs/` | the output of every run quoted in the note (scratch paths scrubbed to `<scratch>/`); first-run FAIL logs are kept beside the corrected runs |
