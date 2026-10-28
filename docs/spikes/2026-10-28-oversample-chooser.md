# Per-device oversample chooser for the web player (2026-10-28)

Worktree `~/projects/VesselDSP/core/os-chooser`, branch
`indiejoseph/os-chooser`. Implements the task: the player measures, on this
device, whether the pedal runtime fits its real-time deadline at each
candidate oversample factor and prepares the runtime at the highest factor
that fits (accuracy first), stepping down to 1x. No per-packet gating, no
per-packet constants, no new `.vdsp` field: the only inputs are the measured
cost and typed program facts.

## What changed (source)

- `packages/player/src/engine/oversample-chooser.ts` (new): the whole
  policy, dependency-free so both the page engine and the worklet bundle
  import it. Constants, the rate-dependent exclusion, the pure decision
  (`chooseOversampleFactor`), the rebuild re-decision
  (`redecideOversampleOnRebuild`), and the override validation.
- `packages/player/src/engine/worklet/player-worklet.ts`: the `load` handler
  reads the player-only `oversample` / `oversampleReason` fields, prices
  candidates 4 then 2 on the shipped WASM console on the audio thread (hot
  0.3 V peak 1 kHz sine, 16 warm-up + 100 timed 128-frame blocks per
  factor), decides with the shared rule, prepares everything at the chosen
  factor, and reports `{factor, reason, costs, latencyHostSamples}` on
  `loaded`. The admission gate input is now the hot mean at the prepared
  factor (was the quiet 0.1 probe); the gate itself is unchanged.
- `packages/player/src/engine/player-engine.ts`: computes the exclusion
  from the loaded program, posts the forced factor (override or 1x hold) or
  leaves the decision to the worklet, records the `loaded` report, exposes
  it via `getOversampleDecision()`, and re-decides from cached per-factor
  costs on selection rebuilds (no mid-playback re-measurement; steps down
  through measured factors, 1x is today's path). New `oversample?: number`
  engine option is the ONLY configuration surface (explicit override for
  tests/benchmarking).
- `packages/player/src/engine/admission-report.ts`: `PlayerOversampleFlag`
  (inbound forced factor) and the `oversample` report shape (outbound).
- Chain plumbing (headless, unchanged runtime semantics):
  `packages/chain/src/types.ts` (`ChainPrepareOptions`),
  `packages/chain/src/chain.ts` (`SignalChain` stores/forwards),
  `packages/chain/src/nodes/runtime-node.ts` (`prepare`/`reset` carry the
  factor into `ReferenceRuntime.prepare`, `getOversample()`),
  `packages/chain/src/oversample.ts` (one validation rule, mirroring the
  runtime's message).
- Runtime host plumbing (not the resampler/solver/wasm, all untouched):
  `packages/runtime/src/chain.ts` (`ChainRuntime.prepare` forwards
  `oversample` to `ReferenceRuntime` slots and injected consoles),
  `packages/runtime/src/chain-slot.ts` (`ExternalProcessor.prepare` takes an
  optional second param; NAM/IR ignore it),
  `packages/runtime/src/worklet/v2-audio-worklet.ts` (its WASM wrapper
  forwards the option; the runtime worklet never sends one, so it stays 1x).

## Decision rule and every constant

- Candidates measured, highest first: **4, 2**. 8 is not tried: parity at
  2/4/8 on the bench pedal was 0.9964/0.9988/0.9993, so 8 buys ~0.0005 of
  correlation for ~2x the cost of 4. 1 is the fail-closed default, never
  measured (it is today's behaviour).
- Quantum **128 frames** (the real path: both worklets render 128-frame
  quanta). Deadline 2.667 ms at 48 kHz.
- Drive **0.3 V peak 1 kHz sine**, same for every packet: cost is much lower
  at quiet input (1-2 Newton iterations), so a quiet probe would price the
  linear regime and admit a factor the guitar then blows past. 0.3 V is
  above the ~70-100 mV point where the bench pedal breaks from ngspice.
- Warm-up **16 blocks**, timed **100 blocks** per factor; statistic **p99**
  (nearest-rank, 2nd-worst of 100) against **50% of the quantum**
  (1.333 ms at 48 kHz). The 50% holds the 1% tail, the NAM/IR extras priced
  by the admission gate, and device load variance.
- Exclusion: programs needing `pitch-shift`/`pitch-tracker` stay at 1x,
  read from `requiredModels` (registry compositions) and composed-block
  primitive ops (declared compositions) -- typed program facts, never pedal
  identity. NO MNA stamp kind (`requiredOperators`) is rate-dependent: the
  host-rate audit (`2026-10-10-host-rate.md` §5b) classified every
  rate/sample-count site, and every delay length, LFO increment, envelope
  alpha and tap-tempo time derives from the solver rate in seconds (measured
  identical in §5a); the pitch windows are the only fixed-sample counters
  in the solve path.
- Measurement failure (throw, non-finite) fails closed to 1x with the reason
  recorded. If even 1x does not fit, the existing admission refusal is
  unchanged. A factor change is a re-`prepare`; the context stays pinned at
  48 kHz.

## Measured numbers (this box, 2026-10-28)

Instrument `measure-chooser.ts` (scratch, deleted per hygiene): the
worklet's own pricing loop headless on the shipping WASM console
(`V2WasmEngine` from the worktree's `dist`), shared pure decision from
the player `dist`, parity vs ngspice via the workbench helpers at the
task's 0.1 V point. Wasm built here sha256 `2bbea146...` (emsdk 6.0.4,
reproduced byte-identical in the fresh clone below); the deployed binary
is `dfe8af77...` -- different bytes from build drift, functionally
identical here: the parity figures below reproduce the task's
deployed-console table exactly.

Test pedal `distortion-plus.vdsp` (single MNA block, operators
capacitor/conductance/controlled-conductance/controlled-resistance/
dc-source/diode/ideal-opamp/input-source, no models, no exclusion).
Worktree run:

```text
cand os=4: p99 1.187 ms  mean 0.768 ms  max 1.192 ms  blocks over 2.67 ms: 0 of 100 | latency 26.25 host samples = 0.547 ms
cand os=2: p99 0.442 ms  mean 0.417 ms  max 0.517 ms  blocks over 2.67 ms: 0 of 100 | latency 19.5 host samples = 0.406 ms
decision: factor=4 excluded=false
reason: 4x: p99 1.19 ms of 2.67 ms quantum (headroom 50%)
WASM chosen os=4       disagrees      corr=-0.7369 gain=0.996
         reported latency=26.25 host samples | best lag=-70 -> agrees corr=0.9941 gain=0.996
WASM 1x contrast       disagrees      corr=-0.1900 gain=0.546
         reported latency=0 host samples | best lag=-22 -> disagrees corr=0.6619 gain=0.546
TS ref os=4 hostRate=48000 latency=26.25
```

Fresh-clone runs (same instrument repointed at the fresh `dist`; the box
was under different load, which is the point -- the decision is
per-device, per-moment). Run A stepped down:

```text
cand os=4: p99 1.379 ms ... | latency 26.25 host samples = 0.547 ms
cand os=2: p99 0.694 ms ... | latency 19.5 host samples = 0.406 ms
decision: factor=2 excluded=false
reason: 2x: p99 0.69 ms of 2.67 ms quantum (headroom 50%); 4x p99 1.38 ms exceeded 1.33 ms budget
WASM chosen os=2       disagrees      corr=-0.5191 gain=0.994
         reported latency=19.5 host samples | best lag=-77 -> close corr=0.9818 gain=0.994
WASM 1x contrast       disagrees      corr=-0.1900 gain=0.546
```

Run B (quieter box) chose 4x again with `agrees corr=0.9941
gain=0.996`, 1x `disagrees corr=0.6619 gain=0.546` -- identical to the
worktree run. Acceptance read: every chosen factor agrees at >= 0.98
corr and within 2% gain (4x: 0.9941/0.996; 2x: 0.9818/0.994) where 1x
disagrees (0.66/0.546). TS console reports the same latencies (19.5/26.25
host samples at 2x/4x).

Focused tests: `tests/player/oversample-chooser.test.ts` (25 tests: pure
4->2->1 step-down with an injected clock, fail-closed, exclusion,
override) and `tests/player/engine.test.ts` (+5: report ride, override,
1x hold, no-report fail-closed, rebuild repost) plus
`tests/chain/runtime-oversample.test.ts` (plumbing incl. reset
preservation). Full `bun test` 2452 pass; `bun run typecheck` clean.

## What was NOT measured

- No real AudioWorklet thread: the pricing above runs the shipping console
  on the main thread with `performance.now`. The production measurement
  runs the same console and the same loop in the worklet; thread
  contention and timer resolution differ and are not priced here.
- No slower device (phone, old laptop): the 4x choice above is THIS box's
  answer; a slower device steps down by the same rule, unmeasured here.
- No real browser: bun headless, no `AudioContext`, no audio device.
- No multi-pedal chain pricing: the player loads one program slot; the
  3-pedal over-deadline finding from the host-rate note is unchanged and
  unaddressed.

## How to reproduce

Fresh clone of this branch (validates the stale-`dist` trap: this worktree
nests in the main checkout): `git clone <worktree> fresh && bun install
--frozen-lockfile && bun run typecheck`, then `bun run --cwd
packages/runtime build:wasm` -- REQUIRED before `build` although
deploy.yml does not list it: `packages/runtime/src/wasm/` is gitignored,
so a truly fresh clone has no wasm and the runtime `cp -r src/wasm
dist/wasm` fails (pre-existing repo condition, publish.yml already builds
it the same way). Then `bun run build && bun test && bun run build:pages`.
Observed 2026-10-28: typecheck 0 errors; build ok (both worklet bundles
pass their no-external-imports assertions); `bun test` 2452 pass in 3 of 4
runs, the 4th showing one 5 s-timeout flake in a single file under a loaded
shared box (focused oversample suites 5/5 clean); `build:pages` 936 pages.
Then copy the chooser loop above pointed at the fresh `dist`; the
deterministic rule is covered without hardware by `bun test
tests/player/oversample-chooser.test.ts tests/player/engine.test.ts`.
