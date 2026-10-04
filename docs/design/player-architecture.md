# Player architecture: pedal + NAM + IR on WebAssembly in `@vessel-dsp/player`

Status: design note, 2026-10-02. Question: can `@vessel-dsp/player` in this
repo play a compiled `.vdsp` plus NAM plus IR inside an AudioWorklet on the
workbench's wasm consoles, and what must be built for the blog to embed it.

Verdict: the mechanism is proven in a real browser tab (section 3), but a
player compiled by core's compiler runs on nothing today: core emits
`formatVersion: 1` and the current C++ console requires 6, so 152 of 152
core-compiled corpus programs are refused by name (section 2). Ship audio
only after the extraction plan's phase 2. Shell, fallback, and input work
can start now (section 8).

Conventions: all paths below are absolute or repo-relative as stated.
`core` means this worktree (`/home/joseph/projects/VesselDSP/core/player-design`).
`workbench`, `blog`, `website`, `artifacts` mean the sibling checkouts of
those names. Numbers come from commands the author ran, shown with the
command. File:line cites refer to the file named in the same sentence.

## 1. Inventory: how the workbench real-time path works

Main thread (`workbench/src/web/App.tsx`). Programs come from precompiled
catalogs, not from compiling in the page. `updateWorkletChain` (App.tsx:1276)
builds an ordered `V2WorkletSlot` list: one `program` slot per pedal and amp
with its bypass mode (1299), at most one `nam` slot (1323), at most one `ir`
or cab-sim-taps-as-`ir` slot (1338). NAM carries fetched wasm bytes plus the
`.nam` text with `produces: speaker-electrical, expects: instrument` (1327).
IR carries taps already resampled to the context rate
(`loadCabinetIrTaps(irPreset, rate)`, 1340) with `produces: miked,
expects: speaker-electrical` (1344). The v2 wasm bytes are fetched with a
manifest hash check (`loadWasmBytes`, App.tsx:791) and posted as
`wasmConsole: { wasmBytes }` (1362). Context setup is
`new AudioContext({ latencyHint: 0 })` with no requested rate (App.tsx:933),
`addModule("./v2-audio-worklet.js")` (961), one `AudioWorkletNode` (963).
Knobs post `setControl` by (slot, id) (977). `loaded` and `telemetry`
messages drive the panel (969).

Protocol (`workbench/src/web/v2-worklet-protocol.ts:113`). Three inbound
shapes, not two: `load` (ordered slots plus optional `wasmConsole`),
`setControl` (slot, id, 0..1 position), `setBypassMode` (slot, mode).
Outbound: `loaded` (per-slot controls, supply-ground conflicts, chain
advisories), `telemetry` (per-slot held samples and peaks, separate
`wasmSlots` peak-iteration rows, mean/peak/p95/session-peak CPU, overruns),
`error` (refusal text; the worklet goes silent, never kills the graph).

Worklet (`workbench/src/web/v2-audio-worklet.ts`). `buildSlots` (208)
instantiates one shared wasm module from the posted bytes, because an
AudioWorkletGlobalScope cannot fetch (218). Each `program` slot becomes a
`V2WasmEngine` wrapped as an `ExternalProcessor` (160) or a TS
`programSlot` when no `wasmConsole` was sent (251). Each `nam` slot becomes
`createNamProcessor` on a memoized engine (272). Each `ir` slot becomes
`createIrProcessor` with `filterFullScale(upstreamOutputVolts)` bounds (293).
`runtime.prepare(sampleRate)` takes the real context rate (348). Output is
scaled by `dacScaleFactor` (384, 553). WASM control routing goes to the
engine behind the C ABI (432). Per-quantum CPU is binned into a 128-bin
histogram for peak and p95 (538).
Level staging, pedal volts to NAM digital full scale. Between slots the
chain multiplies by `upstream.output / downstream.input` full-scale volts
times a resistive divider (`seamScale`, core
`packages/runtime/src/chain-advisories.ts:237`), with unity when either side
is null. An IR is a filter, so it borrows the upstream slot's own output
bound on both ports and the seam into it is exactly 1 (`filterFullScale`,
workbench `src/web/chain-processor-slots.ts:112`); when the upstream states
no bound, null propagates and `unscalable-seam` reports it. A NAM declares
`{ input: null, output: null }` ports (chain-processor-slots.ts:245), so the
seam into a NAM is unity and reported, never invented; into a nonlinear slot
that is a tone error, not just a level error (chain-slot.ts:97). NAM slot
defaults are `produces: speaker-electrical, expects: instrument` (279);
IR defaults are `produces: miked, expects: speaker-electrical` (144).
At the DAC, `dacScaleFactor` divides by the output full scale only above
1.0 V, never a gain (core `packages/runtime/src/chain-scale.ts:79`); the
declared 0 dBFS reference wins over the derived ceiling
(`outputConversionFullScale`, chain-scale.ts:111). Example measured in
section 3: the LPB-1 program declares reference 1 V, so scale is 1.0 and
0.25 V in renders 1.92 V peak out.

Sample rate handling. The runtime is rate-agnostic; the worklet always
passes the real context rate (v2-audio-worklet.ts:348) and the app never
requests one. NAM fixes its rate at instance creation
(chain-processor-slots.ts:281,321) because its DC blocker derives from it.
Correction to the brief: the NAM engine does not refuse on a rate mismatch.
`expectedSampleRate` is reported on the handle (310,346) and then discarded
by the worklet (287) and never read by the app (no use of the field in
App.tsx). A model run at the wrong rate plays at the wrong pitch character
silently. The player must compare and surface this itself (section 6).

What exists in core today. `ChainRuntime` plus program/processor slots and
contracts (`packages/runtime/src/chain.ts`, `chain-slot.ts`), seam and
divider arithmetic with advisories (`chain-advisories.ts`, `chain-scale.ts`),
`admissionVerdict` with `RealtimeBudget` (`admission.ts`),
`ReferenceRuntime` (`reference-runtime.ts`), and a `V2WasmEngine` wrapper
(`v2-wasm-engine.ts`) whose default module import reads
`../../build/v2_dsp.cjs` (v2-wasm-engine.ts:12), a path absent from this repo
and from the published package. Only in the workbench: the worklet
processor and its bundle config, the protocol, the NAM/IR slot adapters,
the NAM engine module boundary, the C++ source plus `scripts/build-v2-dsp.sh`
plus both binaries, the manifest hash check, the app wiring, and the parity
harness `scripts/test-v2-wasm-parity.ts`.
## 2. Compatibility proof of concept (required)

Method. Scripts live in `docs/design/player-poc/` and were run from the
workbench checkout with bun (its `node_modules` resolves workbench imports;
core imports resolve through absolute paths to this worktree). Corpus is the
156 `.vdsp` files under `/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp/`
(read-only). Metric and stimulus match the workbench parity harness
(`scripts/test-v2-wasm-parity.ts:17`, 379): 2048 samples of 440 Hz at 0.25
plus 1320 Hz at 0.1, verdict over samples [100, 2048), pass when correlation
is at least 0.9999 and max delta under 1e-4 (or both silent with delta under
1e-4). Newton cap pinned to 1024 on both consoles.

Headline command and result (`docs/design/player-poc/compat.ts`):

```
bun /tmp/player-poc/compat.ts   # from the workbench checkout; full 156-file corpus
corpus files: 156, testing: 156
core compiled ok: 152, core refused/skip: 4
wasm accepted: 0, wasm refused: 152
--- refusal texts ---
  [x152] Failed to load program into V2 C++ Engine: unsupported program format version 1
NEGATIVE-CONTROL operator: refused as required: ... unimplemented operators: no-such-operator
NEGATIVE-CONTROL version: refused as required: ... unsupported program format version 999
```

One sentence: 0 of 152 core-compiled programs load on the workbench wasm
console; all 152 are refused with the single text above, because core emits
`formatVersion: 1` (`packages/compiler/src/link.ts:58`) and the console
requires 6 (`workbench/src/runtime/cpp/ProgramJson.cpp:989`).

Compile gaps (`gap.ts`): 152 packets compile on both; 3 are refused by both
with identical text (`boss-dd-3t` undisclosed DSP part, `canonical-ideal-opamp`
unidentified op-amp, `wien-bridge-oscillator` no input jack); 1 is refused by
core but compiles on workbench (`boss-dd-5`: core's stale registry has no
model for `AK5345-VS` / `uPD6379`); none compile only on core.
Field differences between the two compilers on the 152 jointly compiled
packets (`fielddiff.ts`): `formatVersion` differs on all 152 (core always 1,
workbench always 6); the top-level `bypass` key is absent from core on all
152 (the P2 row 8 step 3 bypass vocabulary, an extraction gate item);
22 packets emit `macro` blocks on core where workbench emits `composed`
(belton-brick-reverb, boss-bf-2, boss-ce-1, boss-ce-2, boss-ce-2b, boss-ce-5,
boss-ch-1, boss-dd-2, boss-dm-2, boss-dm-3, boss-dsd-3, boss-ps-2,
boss-vb-2, electro-harmonix-deluxe-memory-man plus eh7550,
electro-harmonix-electric-mistress, electro-harmonix-slapback-echo,
ibanez-dl5, mxr-carbon-copy, mxr-m117r-flanger, mxr-micro-flanger,
pt2399-delay); stamp kind `linear-vca` appears only in workbench output;
composed-instruction ops (`delay-push`, `delay-tap`, `delay-tap-fractional`,
`filter-dcblock`, `comb`, `allpass`, `mix`) appear only in workbench output.
`requiredOperators` diffs: core-only `selector` on 9 packets (marshall-jcm800,
mesa-boogie-dual-rectifier, boss-cs-2, boss-cs-3, boss-hm-2, boss-dm-3,
boss-nf-1-noise-gate, boss-ph-1r, boss-sp-1-spectrum) and core-only `switch`
on 2 (dumble-overdrive-special, marshall-jcm800); workbench-only `switch` on
10 (boss-cs-2, boss-cs-3, boss-dm-3, boss-ds-2, boss-hm-2, boss-nf-1-noise-gate,
boss-os-2, boss-ph-1r, boss-sp-1-spectrum, boss-tw-1), plus `linear-vca`
(boss-tr-2) and `ideal-opamp` (pt2399-delay). The `switch`/`selector` drift
is the P3 row 7 macro-dispatch retirement, also a gate item.

Version-bump diagnostic (`bump.ts`): with only `formatVersion` changed 1 to
6, the wasm accepts 130 of 152. The other 22 are refused, every one naming a
dispatched macro: 19 `bucket-brigade-delay-line`, 2 `digital-delay-line`
(ibanez-dl5, pt2399-delay), 1 `digital-reverb-module`
(belton-brick-reverb), each ending "this runtime executes compositions only
(macro dispatch retired, board-p3 row 7)".
Adjudication over the 130 bump-accepted packets (`adjudicate.ts`): A is
wasm(core-bumped) vs core TS, B is wasm(workbench) vs workbench TS, C is
wasm(core-bumped) vs wasm(workbench), same pass bar throughout.

```
AAA (A,B,C agree): 87   AAc (consoles agree, compilers differ): 14
AaC: 1 (moogerfooger-mf-102)   Aac: 0
aAA (consoles diverge, compilers agree): 14   aAc: 7
aaC (tube-path console divergence, compilers bit-identical): 6
aac (everything diverges): 1 (boss-tw-1)
```

C agrees on 108 of 130 (many bit-identical, maxDelta 0.00e+0, e.g. all
listed Fender amps and big-muff-pi) and disagrees on 22. The 14 pure
compiler divergences (AAc) include pro-co-rat (5.11e-4), pro-co-rat-2
(1.03e-1), boss-od-1 (4.41e-2), boss-sd-1 (2.49e-1), boss-mt-2, boss-hm-2,
boss-cs-2, boss-cs-3, boss-bd-2, sunn-beta-lead (1.39e+0). The 14 aAA rows
show pre-existing console divergence the workbench owns (ibanez-ts9 and
ts808 agree across compilers to 2e-9 yet miss the console bar). The 6 aaC
rows are known tube-path console divergence (dumble, three Marshalls,
orange-rockerverb, vox-ac30) with compilers bit-identical. A 1e-12 input
poke chaos probe over core TS tags 0 of the 22 C-disagree rows as chaotic,
so those are genuine compiler differences, not chaos artifacts.

Positive control (workbench compiles, own wasm vs own TS): 4 of 5 agree at
1e-10 to 1e-12; dumble misses at 2.843e-3, and the core-bumped dumble renders
bit-identically to it (maxDelta 0.000e+0 between the two wasm renders).

Section 2 verdict: the player cannot ship audio before extraction phase 2.
Even a version-bump shim would refuse all delay, reverb, and modulation
packets and mistranslate about 17 percent of the loadable ones, including
the RAT family. The blocking fields are exactly the gate rows: format
version plus bypass vocabulary, the composed instruction set with macro
retirement, and device-law/registry drift.
## 3. Browser proof (ran, in Orca's embedded browser)

Page: static files under `/tmp/player-page/` (not in the repo) served by
`python3 -m http.server 8471`: the workbench `v2-audio-worklet.js` bundle and
`v2_dsp.wasm` copied read-only from `workbench/src/web/public/`, plus a
core-compiled LPB-1 program as v1 JSON and as v6-bumped JSON
(`docs/design/player-poc/genprog.ts`). Three tabs were driven with
`orca tab create --url` and `orca eval --expression`:

```
# probe: TS console (no wasmConsole), core-bumped program
N1 got: {"type":"loaded","controls":[{"slot":0,"id":"Level"},
  {"slot":0,"id":"V1"},{"slot":0,"id":"S1"}],"supplyGroundConflicts":[],
  "chainAdvisories":[]}
# probe2: wasm console, core v1 program
N got: {"type":"error","message":"Failed to load program into V2 C++
  Engine: unsupported program format version 1"}
# probe3: wasm console, core-bumped v6 program, 1 s OfflineAudioContext at 48 kHz
MSG: {"type":"loaded",...} isWasmConsole:true, wasmSlots:[{"slot":0,
  "peakIterations":8}], cpuLoadPercent 6..14, overrunCount:0
render: peak 1.9284, rms 1.26303, 1 s rendered in 85 ms (11.8x real time)
```

The same bumped program rendered under Node (`xcheck.ts`) gives peak
1.9214, rms 1.26267, agreeing with the browser render within 0.4 percent.
Browser was Chrome 150 (X11 Linux) per `navigator.userAgent`. One gotcha
for implementers: a worklet port using `addEventListener("message")`
needs an explicit `port.start()` or replies queue silently; assigning
`port.onmessage` starts it implicitly. The first attempt hung on this and
nothing else.

Not run, so a maintainer must verify by hand: `getUserMedia` permission
flows, autoplay policy on a real page, device sample rates other than
48 kHz, Safari and Firefox worklet plus wasm behavior, and realtime (not
offline) deadline compliance on listener hardware.

## 4. Package layout

Put the realtime host in `@vessel-dsp/runtime`: the worklet processor
source, the message protocol, the fixed `V2WasmEngine` wrapper (loading the
wasm from the package's own release artifact, not `../../build`), the
`prepack` wasm build ported from `scripts/build-v2-dsp.sh`, and the wasm
plus glue as files behind a `./wasm` subpath. That matches extraction phase
2 (`packages/runtime/scripts/build-wasm.sh`, `dist/wasm/`) and lets Studio
import the same worklet in phase 3 instead of copying `web/`.

Put the NAM and IR slot adapters in `@vessel-dsp/player`, not runtime. The
runtime may import the program contract and nothing else (core
`packages/runtime/src/chain-slot.ts:8`), and a `.nam` profile or IR taps
are another kind of ROM, so adapters belong to the host. Player also owns
input handling (WAV decode and loop, mic stream), the custom element, the
mp3 fallback, and the calibration described in section 7.

Dependencies of `@vessel-dsp/player`: `@vessel-dsp/runtime` (worklet URL,
protocol types, wasm URL, admission check), `@vessel-dsp/compiler`
(compile the blog's fetched `.vdsp` text in the page; accept precompiled
Program JSON as a property to skip this), `@vessel-dsp/chain` for the input
profile and cable model only, `@vessel-dsp/core` for interchange parsing
via the compiler's existing dependency. No React in player; keep
React/browser UI in `control-ui` per repo rules. `packages/chain`'s
`RuntimeNode` (which wraps `ReferenceRuntime`,
`packages/chain/src/nodes/runtime-node.ts:3`) stays for offline and main
thread renders and tests, is documented as not real-time, and is never in
the worklet path. Chain's `NamNode` already drives the same NAM wasm engine
(`packages/chain/src/nam/engine.ts` exports the identical `_nam_*`
surface), so the player reuses that engine boundary rather than a third one.
## 5. Delivery to an npm consumer (Next.js blog)

Serve three files from the player package: the worklet script and the two
wasm binaries. Ship them as package files behind versioned subpath exports,
reusing the pattern `packages/chain/package.json` already uses for
`./nam-engine.wasm`, `./nam-engine.js`, and `./nam-engine.NOTICE.md`.
Resolve runtime URLs with `new URL(..., import.meta.url)` so the files work
from `node_modules` without a bundler rewrite, and add a documented
copy-to-public step for Next.js static export plus `workletUrl`,
`dspWasmUrl`, and `namWasmUrl` overrides for hosts that pin or CDN their
assets. Serve `.wasm` as `application/wasm` and the worklet as
`text/javascript`; no COOP/COEP headers are needed because both engines are
single-threaded builds. Blog-supplied NAM, IR, and WAV URLs are fetched by
the page, so cross-origin entries need `Access-Control-Allow-Origin`;
same-origin blog assets need nothing.

Measured payload (workbench `src/web/public/`, `gzip -c | wc -c`):

| file | bytes | gzip bytes |
|---|---|---|
| `v2_dsp.wasm` | 2,101,329 | 794,047 |
| `nam-engine.wasm` | 420,095 | 160,833 |
| `v2-audio-worklet.js` | 295,909 | 85,831 |
| total | 2,817,333 | 1,040,711 |

Loading strategy: lazy until the first user gesture. The embed shows the
blog's mp3 fallback player first; on play, in order: create the context,
`addModule` the worklet, fetch the wasm bytes (only the consoles the chain
needs: skip `nam-engine.wasm` when no NAM is selected), post `load`, then
start. Never fetch wasm or create a context on page load.

## 6. Embed API

Element `<vessel-player>` (keep the website package's tag name; the
attribute set below replaces its hosted-platform lookup). Attributes:
`src` (the `.vdsp` URL, required), `inputs`, `nam`, `ir` each as a JSON
array of `{ label, src }` in the attribute (e.g.
`nam='[{"label":"JCM800","src":"/models/jcm.nam"}]'`) with a matching
property setter taking the parsed array for framework users. Properties and
methods: `play()`, `pause()`, `setControl(slot, id, position)`,
`setInput(labelOrIndex)`, `setNam(labelOrIndex|null)`,
`setIr(labelOrIndex|null)`, read-only `state`. Events: `ready`, `load-error`
(fetch, compile, or wasm refusal text), `render-error` (mid-stream throw),
`statechange`, `clip`, `rate-mismatch` (section 6 rate policy).
Controls exposed: one slider per program control id plus input/NAM/IR
pickers and bypass. Defaults: first input selected, NAM off, IR off, all
controls at program defaults; an empty `nam` or `ir` list hides that picker.
"Browser audio" input calls `getUserMedia` with `echoCancellation: false,
noiseSuppression: false, autoGainControl: false, channelCount: 1` and offers
device choice from `enumerateDevices` via `deviceId`; the UI carries a
headphone feedback warning and shows permission errors inline instead of
throwing. (The website player requests `{ audio: true }`, leaving all
processing on, and never connects its mic node to the graph; both are fixed
by this design.) Autoplay policy: no context creation and no fetch before a
user gesture; `play()` outside a gesture resumes on the next one. WAV inputs
decode with `decodeAudioData` and loop. Sample-rate policy: request
`new AudioContext({ sampleRate: 48000 })`; when the device refuses, run at
the device rate (the pedal console is rate-agnostic) but compare the NAM
model's `expectedSampleRate` against the context rate and emit
`rate-mismatch`, refusing that NAM slot, because the engine will not refuse
itself (section 1). IR taps are resampled to the context rate before load,
as the workbench does caller-side. Errors surfaced to the page: fetch
failures, compile refusals, wasm refusals by name, rate mismatch, mic
denial, and worklet absence. Accessibility: native range inputs with labels,
keyboard-operable transport, visible focus, text status for state changes.
Fallback: when WebAssembly or AudioWorklet is missing, render the blog's
pre-rendered mp3 (today `blog/public/audio/buffer/*.mp3`) in a plain audio
element with the same transport buttons; never a silent embed.

## 7. Admission and performance policy

The player gates with the runtime's admission check: call `admissionVerdict`
over the whole ordered program list with a host-measured `RealtimeBudget`
(`nsPerSolve` calibrated on the listener machine at first gesture by timing
dense solves per unknown count, `nsPerMacroSample` per DSP model id,
`budgetedIterationsPerSample` default 64, `cpuBudgetFraction` at most 0.5 to
leave headroom for NAM/IR and the browser). `ChainRuntime.prepare` already
gates the whole chain once and prepares slots ungated
(`packages/runtime/src/chain.ts:95`), so the player passes the budget there
and a `fits: false` verdict becomes a polite refusal naming the block and
the numbers. Only compiled slots are charged; NAM and IR have no price, so
the calibration also times one NAM block and one IR length at the context
rate and refuses the combination when that plus the chain exceeds budget.
Measured through the workbench wasm console under Node in 128-sample blocks
(`docs/design/player-poc/perf.ts`, 5 s at 48 kHz; Node, not a browser):

| program (workbench-compiled) | 5 s render | faster than real time |
|---|---|---|
| blog pickup-cable-1m | 93 ms | 53.9x |
| blog pickup-cable-6m | 79 ms | 63.3x |
| blog pickup-buffer-cable-6m | 254 ms | 19.7x |
| blog pickup-cable-6m-fuzz | 65 ms | 76.4x |
| big-muff-pi | 700 ms | 7.1x |
| ibanez-ts9 | 1608 ms | 3.1x |
| pro-co-rat-2-v4b-op07cp | 1119 ms | 4.5x |

Same three heavy pedals through core's TypeScript `ReferenceRuntime` under
Bun (`tspref.ts`): big-muff-pi 1.26x, pro-co-rat 1.11x, ibanez-ts9 0.56x,
i.e. the TS9 is slower than real time on this machine, which contradicts the
1.1x figure in the brief (that figure was not re-measured here; signal and
machine differ). The wasm console is the only candidate for the audio
thread; the TS console stays an offline oracle.

## 8. Dependencies, gating, and order

Blocked on extraction phase 2 (gate rows X2 in
`workbench/thoughts/shared/plans/2026-09-22-compiler-runtime-extraction-plan.md:46`):
(1) P9 subthreshold law committed; (2) `bufferProgram`/bypass vocabulary
landed or explicitly deferred to a later `formatVersion`; (3) P3 row 7
macro-dispatch retirement landed (the TS side still dispatches legacy
macros while C++ refuses them); (4) the named-ports decision, landed or
explicitly punted to `formatVersion: 2`+; (5) the production-ready sweep
(`realtimeBudget` enforced or recorded as host duty, kernels and wasm
rebuilt, corpus ratchet re-baselined, `typecheck:checks` baseline
committed). Section 2 maps each row to a measured incompatibility, so none
can be waived.

Can start now, gated on nothing: the player shell (element, transport,
pickers, mp3 fallback) against a fake engine; the input path (WAV decode
and loop, mic constraints, device choice); the IR resample-to-rate path
(rate conversion is compiler-independent); the calibration harness that
measures `nsPerSolve`; packaging of the worklet bundle and protocol as
files (content-identical move, no behavior change); browser smoke pages.
Order: shell plus fallback first, inputs second, calibration third, cut the
audio path over to phase-2 packages the day they publish, browser deadline
signoff last on listener hardware.
## Cutover: where NAM and IR run (W3 decision, 2026-10-03)

Resolution: option (a). `@vessel-dsp/player` ships its own worklet bundle,
`dist/worklet/player-worklet.js`, built by esbuild in `packages/player`
(`scripts/build-player-worklet.ts`) and served as a package file behind a
subpath export, reusing the runtime's `./worklet.js` pattern. The bundle
composes the runtime's console path with the chain NAM engine boundary and a
chain-IR convolver inside ONE `ChainRuntime` in the audio thread, following
the workbench's `v2-audio-worklet.ts` `buildSlots` slot order and seam rules
exactly (program slots first, at most one `nam`, at most one `ir`;
`filterFullScale` unity seam into the IR; `{ input: null, output: null }`
NAM ports; `unscalable-seam` reported, never invented).

Why not the alternatives, each checked by run rather than by reading:

- Reusing the runtime's own bundle is refused by name: its `buildSlots`
  throws for `nam`/`ir` kinds (`packages/runtime/src/worklet/
  v2-audio-worklet.ts:261`), and the task bans engine edits in runtime, so
  no hook was requested and none is needed. No runtime change was required.
- A second worklet node outside the chain (NAM/IR as sibling graph nodes)
  would give up the seam arithmetic and advisories the chain exists to
  compute (`seamScale`, `filterFullScale`, `unscalable-seam`); the chain is
  one `process()` call over ordered slots, and splitting it across nodes
  reintroduces the level-staging errors section 1 documents.
- Main-thread inference is banned by the task constraints (NAM/IR run in
  the audio thread), and the chain's `RuntimeNode` stays documented as
  not-real-time and never enters the worklet path.

How the bundle stays dependency-clean, verified with `bun run build` plus
the bundle-content assertions in `scripts/build-player-worklet.ts`:

- Program slots: `ChainRuntime`, `programSlot`, seam/advisory/scale helpers,
  `V2WasmEngine`, and the protocol types come from `@vessel-dsp/runtime`
  (value imports, bundled). The v2 DSP glue is bundled statically from the
  runtime's `./wasm/v2_dsp.cjs` subpath; the `.wasm` binary is posted as
  bytes in `load.wasmConsole`, because the worklet scope cannot fetch.
- NAM slots: `instantiateNamEngine`, `loadNamModel`, `namLoudness` are
  imported from the `@vessel-dsp/chain` barrel (the chain package publishes
  no pure NAM subpath, only `.` and `./ir-resample`, so the barrel is the
  only reuse of that boundary rather than a third one). The NAM glue
  (`@vessel-dsp/chain/nam-engine.js`, ESM, no `require`) is bundled
  statically; the `nam-engine.wasm` bytes ride per-slot in
  `V2WorkletSlot.wasmBytes` and are fetched by the page ONLY when a NAM is
  selected (section 5 loading strategy, pinned by the lazy unit test and
  the proof's pre-click request log).
- IR slots: a `CabinetIrNode` (partitioned FFT convolution) from the same
  chain barrel, wrapped as an `ExternalProcessor` with `filterFullScale`
  bounds. Tap resampling stays caller-side on the main thread through the
  pure `@vessel-dsp/chain/ir-resample` subpath, exactly as the workbench
  does. No new chain subpath, no chain edit, no cycle: chain never imports
  player, and the player main barrel never imports chain (the existing
  `tests/player/bundle.test.ts` still guards the shell; the worklet bundle
  is a separate esbuild entry with its own no-external-imports check).

Phase-2 gate status at cutover time (ran, not inherited): the three proof
circuits compile with `formatVersion: 6`, zero `macro` blocks
(`bun /tmp/w3-compat.ts`: buffer 10 unknowns, fuzz 5, phase-90 42, all
`ok`), and all three load into `V2WasmEngine` on this checkout's fresh
`build:wasm` binary (`bun /tmp/w3-load.ts`: three `WASM-LOAD-OK` lines).
The section 2 refusal (`unsupported program format version 1`) no longer
fires for these programs. Nothing about Safari/Firefox, device rates other
than 48 kHz, or listener-hardware deadlines is claimed here; those stay
hand-verify items for the blog signoff task.

Lazy boundary, stated precisely because the controller calls `load()` at
page load: circuit-text fetch plus compile run at `load()` so `ready` and
the control list precede any gesture (otherwise `play()` could never leave
`loading`). Everything audio -- `AudioContext`, the worklet `addModule`,
both wasm binaries, the NAM glue probe, input WAV bytes, NAM text, and IR
audio bytes -- waits for the first `play()` gesture. The proof asserts
zero `*.wasm`/worklet requests and no `AudioContext` before the click.

## Cutover admission, second cut (W3b decision, 2026-10-03)

Problem: the W3 engine timed the decisive admission cost in a main-thread
WASM console, dynamically importing the runtime's `v2_dsp.cjs` glue. The
glue's node-only branch (`require("node:fs")`) hard-fails a real consumer
build -- reproduced: `next build` (Next.js 16.2.10, Turbopack) fails with
`Module not found: Can't resolve 'fs' in
.../@vessel-dsp/runtime/dist/wasm/v2_dsp.cjs`, import trace `LivePlayer.tsx
-> .../player/dist/engine/register.js -> .../player/dist/engine/
player-engine.js -> v2_dsp.cjs`. The W3 report's "may need an fs stub"
understated this: the real stack fails the build, and a stub is not
something to ask of every blog consumer.

Resolution: option (a). The admission measurement moved INSIDE the player
worklet, which already hosts the same console and the same wasm binary,
and the figure rides the `loaded` reply back over the port
(`measuredNsPerSample` plus per-slot schedule counters, as player-only
extra properties -- the runtime protocol is untouched). The main thread
keeps the static gate (calibration, macro refusal, model verdict) but no
longer refuses on it: after `loaded`, the measured figure plus the NAM/IR
extras gate decisively, and only when nothing was measured does the static
verdict decide (fail closed). The lazy-until-gesture rule, the typed
`admission-refused` refusal naming the numbers, and the §7 policy
(measured cost wins over the static model) are unchanged; the unit tests
pin all three, including a test where a fitting worklet measurement
overrules a refusing static model.

Why not the alternatives:

- (b) A prebuilt measuring module loaded by URL would duplicate the
  console the worklet already bundles and time a different engine instance
  than the one that plays -- the worklet times the instance that plays, so
  there is nothing to keep in sync.
- (c) A web-only glue build (`-sENVIRONMENT=web`) would fix only the
  explicit import; the page bundle would still traverse the runtime and
  chain barrels, whose graphs contain the same node-flavoured glue edge
  (verified with esbuild: even an entry importing only
  `{ admissionVerdict }` from the runtime dist fails a strict browser
  bundle). Whether Turbopack/webpack prune that unused edge under
  `sideEffects: false` is settled empirically by the real proof, not by
  reasoning: `packages/player/scripts/next-bundle-proof.ts` runs a real
  `next build` of a scratch blog on packed current-workspace tarballs and
  greps the client chunks for `v2_dsp`. No `packages/runtime/scripts`
  change was needed and none was made.

Selection rebuilds (NAM/IR/input picked mid-play) reuse the start-time
worklet measurement from a per-engine cache (same program object, same
rate) and re-gate with the fresh extras BEFORE replacing the chain, so a
refusal still touches nothing. Re-measuring on the audio thread
mid-playback would itself be a dropout, so rebuild `load`s carry
`playerMeasureProgram: false` (absent means measure -- the fail-closed
direction). A new program always goes through a measuring start.

Heavy-pedal note (revised after the coordinator's re-run): mxr-phase-90 measures 6250, 7813 and
10938 ns in the worklet (30%, 37% and 52% of a 48 kHz period) and, in the live browser proof,
costs 40-53% of a quantum on average with 10-166 overruns in 3 s, WORSE on a quieter box
(load ~2: 53% mean, 166 overruns) than a loaded one, so the overruns are not contention alone: a
chain whose average cost is that close to the deadline has no margin for any hiccup, and live CPU
runs above the offline figure (the scoreboard reads this pedal at 0.28x). Chains at 2-14% never
overran. The admission share is therefore 25% of the period (`ADMISSION_CPU_FRACTION`, 5208 ns
at 48 kHz), not 50%: a heavier chain is refused with its numbers instead of played into dropouts.
The browser proof's harvest leg reports that refusal as its cost figure. Kernel counters ride every
`loaded` reply, so the kernel path is auditable per load
(`kernelSolves === solves`, `fallbacks === 0` on the measured runs).

## 9. Work breakdown (one worker per task)

1. Player shell with fake engine. Files: `packages/player/src/*` (new
element, transport, pickers, mp3 fallback; no audio engine yet). Gate: none.
Test: deterministic fixture test with a fake engine object recording
`load`/`setControl` calls plus event assertions.
2. Input path. Files: `packages/player/src/inputs/*` (WAV fetch, decode,
loop; mic stream with the section 6 constraints; device list). Gate: none.
Test: fixture WAV decode and loop-length test; mic behind a stubbed
`getUserMedia` asserting the exact constraints object.
3. IR rate path. Files: `packages/player/src/ir/*` (fetch, resample to
context rate, tap health check). Gate: none. Test: resample a fixture IR
48k to 44.1k and back, assert peak drift bound; empty-taps refusal test.
4. Calibration harness. Files: `packages/runtime/src/calibrate.ts` (new;
measures `nsPerSolve` per unknown count on the host). Gate: none. Test:
returns finite positive figures; refusal on zero iterations input.
5. Runtime worklet packaging. Files: `packages/runtime/src/worklet/*`
(processor, protocol moved byte-identical), `scripts/build-wasm.sh`,
`prepack` wiring. Gate: phase 2 (needs the moved compiler/runtime first).
Test: bundled worklet loads in an OfflineAudioContext page (section 3
probe) and `pack:dry-run` lists `dist/wasm/*`.
6. NAM slot adapter in player. Files: `packages/player/src/nam/*`
(engine reuse of chain's boundary, `expectedSampleRate` compare and
`rate-mismatch`). Gate: phase 2 for the wasm console; adapter unit tests
need only the NAM engine. Test: fixture `.nam` loads, wrong-rate model
emits `rate-mismatch`, corrupt model surfaces engine text.
7. Audio cutover. Files: `packages/player/src/engine/*` (real load path,
admission gate, telemetry display). Gate: phase 2 published. Test: parity
rows for the blog circuits plus the three heavy pedals against the
section 7 table within 20 percent.
8. Blog embed and signoff. Files: blog repo only (this task changes nothing
there; listed for order). Gate: tasks 1..7. Test: real page check in two
browsers incl. a device-rate-not-48k machine, deadline telemetry with zero
overruns on the blog circuits.

## 10. Risks and unknowns

Audio ships only after phase 2; section 2 is the evidence. Core's TS9 at
0.56x under Bun contradicts the brief's 1.1x; treat all inherited speed
claims as unmeasured until rerun. The 22 compiler-divergent packets show
device-law and lowering drift beyond the version gate, so a shim is not a
shortcut. Browser coverage is one Chromium build, offline only; Safari,
Firefox, real-device rates, mic permission, and autoplay are hand-verify
items. The wasm binaries drift separately from source (worklet bundle built
Oct 1, NAM engine Sep 18); the manifest hash pattern from App.tsx:791 must
move with the packaging or stale bytes will be served silently. Peaks above
1.0 reach the destination (LPB-1 renders 1.92 V peak at scale 1.0), so the
player needs a stated limiter or clip policy before it is loud. NAM and IR
have no admission price today; the section 7 calibration is new code, not a
reuse. Blog asset CORS and the DI take licence (blog `docs/site-architecture.md:70`)
are unresolved outside this repo. Claims not verified by run: anything
about Safari/Firefox, about mic/audio-policy behavior, and about realtime
deadline compliance on listener hardware.
