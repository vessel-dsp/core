## 0. Predictions, written BEFORE any engine render of this spike

Frozen copy of this section: `docs/spikes/host-rate/PREDICTIONS.md`, sha256 in `logs/00-predictions-frozen.log` (taken before the first
accuracy, latency, cost or time-behaviour render). Numbers come from the arithmetic in `predict.ts` / `logs/00-predictions-arithmetic.log`, whose only
inputs are figures already recorded in the phase-1 note (§3 baseline droop, §4b os8, §7 cost), the Newton-predictor notes
(`2026-10-09-newton-predictor-wasm-port.md` §1, `2026-10-09-newton-iteration-budget.md` line 688) and the half-band stage designs
(a frequency-response calculation on the coefficients, not a render).

**What existed before this section was written, disclosed.** (a) I read the phase-1 harness and note and the sources listed in §5b. (b) I ran one
instrument probe (scratch, not in the harness): headless Chromium `OfflineAudioContext` at 8 k / 44.1 k / 48 k / 96 k / 192 k / 384 k / 768 k and a live
`AudioContext` at 48 k / 96 k / 192 k / default. Its readings are reported as instrument facts in §1 and §3b, not as predictions. (c) `predict.ts`.
No pedal, chain or worklet was rendered at any host rate before this section was frozen.

**Stop conditions (task, binding):** any engine change needed to run a rate; **equal-internal-rate arms disagreeing by more than 0.05 dB on any pedal**;
a WASM stall on an arm that main does at 48 kHz x1 without one; a patch or wasm hash that is not what the task names.

### P1 Same internal rate, same answer (the main prediction)

Equal-internal-rate groups: 192 kHz = {48k os4, 96k os2, 192k x1}; 96 kHz = {48k os2, 96k x1}; 384 kHz = {96k os4, 192k os2}.

- At 1 k / 4 k / 8 k / 12.5 k / 16 kHz, 10 mV, Muff / SD-1 / TS-9, each pair inside a group agrees within **0.01 dB**, and each arm reads within **0.01 dB**
  of the native `ChainRuntime` render at its own internal rate. The resampler's own passband term, calculated from the stage designs, is inside
  **+-0.0075 dB** over 1-16 kHz for every resampled arm (largest: 48k os2 at 16 kHz +0.0075; 48k os4 at 16 kHz +0.0056; 96k os2 +0.0062 at 4 kHz and +0.0028 at 16 kHz;
  192k os2 +0.0062 at 8 kHz); phase 1 measured +0.0099 for 48k os4 at 16 kHz, so I allow **0.004 dB** of unmodelled slack on top. 192k x1 against native 192k is the same engine at the same rate (only the DAC scale and the 128- against 512-frame
  blocking differ): **at most 0.001 dB**, on both consoles. TS and WASM consoles agree within **0.001 dB** (phase 1: four decimals).
- **Falsifier:** any pair differing by more than **0.02 dB**. **Stop:** more than **0.05 dB**.
- 20 kHz (representable at 48 kHz: it is below the 24 kHz Nyquist, so the task's "above 24 kHz" reading applies from 24 kHz up; I measure 20 kHz on every arm and
  add 30 kHz on the 96 k / 192 k hosts): the 48 kHz-host resampled arms sit in stage 1's transition band (19.2-28.8 kHz) and read **-0.137 dB** against their own native
  render (calculated: -0.1366 / -0.1363 / -0.1372 at os2 / os4 / os8); the 96 k / 192 k host arms read within **0.01 dB** of their own native render (calculated
  +0.0023 .. +0.0026). **Falsifier:** a 48k-host arm at 20 kHz inside +-0.05 dB or beyond -0.25 dB of its own native render.
  30 kHz at 96 k host: 96k os2 within 0.02 dB of native 192k (calculated +0.0080).

### P2 The x1 warp falls with host rate (derived from the measured 48 kHz data)

Model: trapezoidal integration at solver rate R shows the network at Omega = 2R tan(pi f/R); level error T(R) = s x ln(tan x / x), x = pi f / R, with s the local
slope fitted to the measured 48 kHz point. **Checked on existing data before use:** fitted to the Muff's 48 kHz droop it predicts native384 - native192 =
+0.0204 / +0.1039 / +0.4494 dB at 4 / 8 / 16 kHz against phase 1's measured +0.0197 / +0.1027 / +0.4454 (within 0.004 dB).

| 16 kHz | x1 @ 96k vs native 192k | x1 @ 96k vs native 768k | native 192k vs 768k | native 384k vs 768k |
|---|---|---|---|---|
| Big Muff (pure warp) | **-1.92** | **-2.48** | -0.56 | -0.11 |
| SD-1 (warp only .. warp + dt term) | -0.77 .. **-1.02** | -0.99 .. -1.53 | -0.23 .. -0.51 | -0.04 .. -0.15 |
| TS-9 (warp only .. warp + dt term) | -0.88 .. **-1.12** | -1.14 .. -1.66 | -0.26 .. -0.54 | -0.05 .. -0.15 |

Muff 8 kHz: x1 @ 96k vs 192k **-0.42**, vs 768k -0.55. SD-1 / TS-9 8 kHz (warp .. dt-only bound): -0.23 .. -0.40 / -0.24 .. -0.42 vs native 192k.
192k x1 against native 192k is 0 by construction; against native 768k it is the "native 192k vs 768k" column. The task's naive (f/fs)^2 reading (Muff 16 kHz
-3.08 dB at 96k, -0.77 at 192k) is a reading against the continuous solution; my number for the same quantity is **-2.48 dB** (96k) and **-0.56 dB** (192k).
- **Falsifier (task):** the Muff 16 kHz x1 @ 96k reading more than **1 dB** from -2.48 dB vs native 768k (or -1.92 vs native 192k). For SD-1 / TS-9: outside the
  stated range by more than 0.3 dB.
- **Convergence (native renders, check 2b):** native 192k reads **0.36-0.45 dB below native 384k at 16 kHz** on all three pedals (Muff -0.445 measured in phase 1;
  SD-1 -0.364 and TS-9 -0.385 derived from phase-1 os8 rows) and **0.51-0.56 dB below native 768k**; native 384k is **0.11-0.15 dB below 768k**. So 192 kHz is **not**
  converged at 16 kHz on any of the three (the op-amp pedals' dt term makes SD-1 / TS-9 converge more slowly than a pure warp would), and "native 192k as truth" carries
  about 0.5 dB at 16 kHz and 0.1-0.3 dB at 8 kHz. **Falsifier:** 384k-vs-768k off my range by more than 0.1 dB at 16 kHz (the model's form is wrong).

### P3 Engine latency in milliseconds = host samples / host rate

`loaded.latencyHostSamples` = 19.5 / 26.25 / 28.625 at os2 / os4 / os8 at **every** host rate (the stage designs are in host samples; there is no rate in them).
Measured phase slope within **0.05 sample** of that. In ms: 96k os2 **0.2031**, 96k os4 **0.2734**, 192k os2 **0.1016**, 192k x1 **0**, 48k os4 0.5469, 48k os2 0.4063. Three-slot
chain: 96k os2 0.609, 192k os2 0.305, 48k os4 1.641 ms. Quantum 128/H: 2.667 / 1.333 / 0.667 ms. **Falsifier:** any measured slope off by more than 0.05 sample, or
`loaded.latencyHostSamples` different at another host rate.

### P4 Cost per audio second: follows the internal rate, with one exception I expect

- **Same predictor state:** 96k os2 and 48k os4 (both `oversample > 1`, predictor on) within **+-15 %** of each other per pedal on the WASM console.
- **The exception (P7 below):** `oversample > 1` gates the Newton start predictor (`reference-runtime.ts:4884`, `Engine.cpp:2522`), so **192k x1 runs without it**. The predictor
  removed 39 / 41 / 45 % of the os4 iterations (Muff / SD-1 / TS-9), and phase 1 shows WASM cost following iterations (cost ratio os4/os1 2.11 / 2.00 / 2.37 against iteration ratio
  1.99 / 1.95 / 2.37). So I predict **192k x1 costs 1.64x (Muff), 1.69x (SD-1), 1.82x (TS-9) the 48k os4 cost, band 1.5-1.9x**. **The task's falsifier "192k x1 more than 1.5x the
  48k os4 cost" is therefore expected to TRIP, and I attribute it to iterations per internal sample, not to a fixed per-host-sample overhead.** The control that separates the two:
  the linear divider's cost per audio second at 192k x1 against 48k os4 (fixed overhead would make it >1.5x; I predict **0.6-1.5x**), and measured iterations per internal sample at 192k x1
  of **2.0-2.6 (Muff), 1.7-2.2 (SD-1), 1.6-2.1 (TS-9)** against 1.4 / 1.15 / 1.0 at 48k os4. What would make me wrong: 192k-x1 iterations per internal sample equal to 48k-os4's.
- **The cascade's own cost** (phase 1, `resampler-cost.ts`, TS console): 413 ns per host sample at 4x = 2.0 % of an audio second at 48k os4, 88 ns x 96 000 = 0.8 % at 96k os2, 0 at 192k x1.
  So the 192k x1 arm is "cheaper by the cascade" by at most **~2 %**, below the run-to-run noise: I do not expect to see it.

### P5 Deadline margin: a deliberate departure from the task's wording

The block time and the deadline (128/H) both scale with 1/H at fixed internal rate, so the **mean** block time / deadline is the arm's load fraction and is **equal across equal-internal-rate arms**
(not 2x and 4x), apart from the predictor effect above. Only the tail, driven by fixed-time jitter and by fewer solves per block, grows with H. I predict p99 = mean x k(H) with a **guessed**
k = 1.5 / 1.8 / 2.4 at 48 / 96 / 192 kHz. WASM console, V8 main thread, idle box; phase-1 anchors were taken at load 1.4-1.8, so allow **+-25 %** on every mean. Predicted mean (p99), percent of deadline:

| arm | internal | Muff | SD-1 | TS-9 | chain Muff+SD-1+TS-9 |
|---|---|---|---|---|---|
| 48k x1 | 48k | 46 (68) | 61 (91) | 28 (41) | 134 (201) |
| 48k os2 | 96k | 69 (103) | 93 (139) | 48 (72) | 210 (315) |
| 48k os4 | 192k | 96 (144) | 122 (183) | 65 (98) | 283 (425) |
| 96k x1 | 96k | 79 (142) | 103 (186) | 59 (107) | 241 (434) |
| 96k os2 | 192k | 96 (173) | 122 (219) | 65 (118) | 283 (509) |
| 96k os4 | 384k | 192 (346) | 243 (438) | 131 (235) | 566 (1019) |
| 192k x1 | 192k | 157 (378) | 206 (495) | 119 (285) | 482 (1158) |
| 192k os2 | 384k | 192 (461) | 243 (584) | 131 (313) | 566 (1358) |

The last two rows scale the 192k anchor by internal rate (low confidence). **p99 under 50 % of the deadline: TS-9 at 48k x1 only. p99 under 100 %: Muff, SD-1 (borderline) and TS-9 at 48k x1;
TS-9 at 48k os2 (and borderline at 48k os4); Muff borderline at 48k os2. Everything else, and the three-pedal chain at EVERY arm, over the deadline.** The offline render still finishes
(as-fast-as-possible), so I predict **no STALL** (a block over 8 s) on the WASM console at any arm. **Falsifier:** an arm I list as under 100 % reading over, or the reverse, by more than the +-25 % band.

### P6 NAM and IR at another host rate (read from source, to be run)

- `NamNode`: a model that **states** its rate (here 48 000) is refused at 96 k / 192 k by a thrown error naming both rates (`nam-node.ts:213-220`). A model that states **no** rate
  (`_nam_getExpectedSampleRate < 0`) is **not** checked and runs at the host rate: a silent wrong answer for a model trained at 48 kHz.
- `CabinetIrNode`: an IR with a declared source rate (and the built-in placeholder, `sourceRate = 48000`) is resampled to the host rate (`ir-node.ts:413-420`); an IR given with **no** declared rate
  is used as-is at the host rate (silently time-scaled by 48 000/H).
- The packaged core worklet refuses `nam` and `ir` slots by name at every rate (`v2-audio-worklet.ts:279-285`); the player worklet carries them but its engine pins `createContext({ sampleRate: 48000 })`
  (`player-engine.ts:453`): read, not run here.
- **Falsifier:** a declared-48k NAM running at 96 k without an error, or a declared-rate IR not resampled.

### P7 The predictor gate is keyed on the factor, not on the internal rate (new finding I expect)

Iterations per internal sample at 192k x1 (no predictor) will be 1.6-1.8x those at 48k os4 (P4 numbers), and at 96k x1 (internal 96k, no predictor) between the 48k-x1 and 192k-x1 figures. **Falsifier:** the 192k-x1 figure within 10 % of the
48k-os4 figure.

### P8 Time-based behaviour reads the same in seconds at every host rate

`ReferenceRuntime.prepare` sets `this.sampleRate = sampleRate x oversample` (`reference-runtime.ts:2415`) and the C++ engine `options_.sampleRate = host x oversample` (`Engine.cpp:1300`); every delay length, LFO increment,
envelope alpha and tap-tempo time I read derives from that solver rate and advances per solver sample. Prediction: delay repeat time (slapback echo, PT2399) equals its 48 kHz reading to within **one host sample plus the
analyser's 0.25 ms absolute tolerance**; LFO frequency (phase 90, tremolo) within **1 %**; envelope attack / release (dyna-comp) within **5 %** across 48 / 96 / 192 kHz x1 and 96k os2. The 10 Hz DC blocker is in Hz
(`chain.ts:306`). Hard-coded 48 000 sites I expect to list (none in the solve path): `ChainRuntime`/`SignalChain` default rates, `ir-node.ts:213, 498` (placeholder IR), `player-engine.ts:453`, `DEFAULT_MAX_IR_TAPS`.
**Falsifier:** any of the three differing across host rates by more than those bands.

### P9 What the owner should expect the table to say (stated now so it can be wrong)

96k os2 and 192k x1 deliver 48k os4's accuracy at 1-16 kHz, a flat 20 kHz and content above 24 kHz, at 0.203 ms / 0 engine latency per slot and a 1.33 / 0.67 ms quantum, and neither changes the ~0.5 dB 16 kHz gap between 192 kHz and the
continuous solution. 96k os2 costs the same as 48k os4 with a halved deadline; 192k x1 costs ~1.7x as much (P4) and quarters the deadline. 96k os4 and 192k os2 (384 kHz internal) are over the deadline for every pedal. 48 kHz x1 is the only
arm with p99 under the deadline for SD-1.

### P10 Live context

The box has no sound server (`pactl`, `pw-cli` absent; no PulseAudio or PipeWire socket under `/run/user/1000`) and the user is not in the `audio` group that owns `/dev/snd`, so Chromium cannot open a device: the live `AudioContext`
will report `running` on a fallback sink and the API values are **not a device latency**; I will say so and not put them in the owner table as browser latency.
