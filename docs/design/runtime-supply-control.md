# Runtime supply control: real power-supply sag in compiled programs

Design note with working proof of concept. Worktree
`/home/joseph/projects/VesselDSP/core/supply-sag-design`, branch
`indiejoseph/supply-sag-design`, base `b8e6a24`. Bun 1.3.14, `bun install`
run first. No file under `packages/`, `tests/` or `.github/` was changed or
read for writing; the workbench repo was read only. The only repo file created
is this note. Scratch scripts live under `/tmp/sag-poc/` and are pasted in
full in section 3 with their exact outputs.

Status of the rejected predecessor: the old `PowerSupplyNode` (git history
only, branch `feat/player-plan`, commit `781bd92`,
`packages/chain/src/nodes/power-supply-node.ts`) was an audio-domain
waveshaper placed after the circuit. It tracked an envelope of the audio
signal amplitude and applied headroom scaling plus soft saturation with a
fixed ceiling. It never read the circuit's current draw. It was read for its
profile list only and is not reused here.

## 1. Inventory: how dc-source and sourceOhms work today

Representation. `Stamp` variant `dc-source` carries `positive`, `negative`,
`volts`, `sourceIndex`, `sourceOhms`
(`packages/compiler/src/types.ts:1170-1184`). `sourceOhms` is series impedance
in ohms and `0` is an ideal source. The type comment already names this the
supply state step of the power-domain rail/sag contract and cites the
workbench experiment directory. `ac-source` is a sine EMF in series with its
own `sourceOhms` (`types.ts:1203-1209`), a separate operator so an old runtime
refuses a mains inlet by name instead of running it as a battery.

Lowering. A document `voltage-source` law lowers to one `dc-source` stamp with
`sourceOhms: law.sourceOhms` (`packages/compiler/src/lower.ts:565-573`).
Duplicate declarations across one node span collapse to one stamp; a reversed
duplicate is a refusal (`lower.ts:538-564`). An `ac-source` law lowers the
same way (`lower.ts:589-598`). `kind: battery` is aliased to `voltage-source`
in `packages/compiler/src/netlist.ts:79`. A `kind: rail` with declared volts
becomes a `voltage-source` law (`device-laws.ts:2042-2057`); a rail with no
volts stays `open`.

Correction to the brief: supplies do NOT lower as ideal anymore. Every supply
law takes `SUPPLY_SOURCE_OHMS`, which is `1`
(`packages/compiler/src/device-laws.ts:86-109`). The comment there records the
decision (Joseph, 2026-08-13): source impedance is a user-selectable power
profile that does not exist yet, so `1` is the low end default that errs
toward ideal, and zero is the one value known to be wrong because it let
`ibanez-ts808` draw 193 A through a short and still render plausible gain.
The as-compiled probe in section 3 confirms `sourceOhms: 1` on the stamp.

Partitioning. `dc-source` and `ac-source` have no `control` flag in
`STAMP_SHAPES` (`packages/compiler/src/stamp-partition.ts:72-83`); only
`controlled-conductance`, `controlled-resistance`, `switch` and `selector`
carry one (`stamp-partition.ts:28-62`). `stampControl` returns null for supply
stamps (`stamp-partition.ts:297-301`). In `computeStampPartition`, a
`dc-source` is linear, not control-driven, not dynamic, and not a signal
source, so it lands in `constantStampIndices`
(`stamp-partition.ts:378-385`). An `ac-source` is linear but is classified as
a signal source, so it is excluded from the constant set and is reapplied per
sample. Consequence: both supply kinds are absent from every control-driven
matrix update today.

Solving. The TS ReferenceRuntime stamps the row as
`V(positive) - V(negative) - sourceOhms * i = volts`
(`packages/runtime/src/reference-runtime.ts:4489-4511`), with `-sourceOhms`
on the auxiliary row diagonal and `volts * sourceScale` on the RHS
(`reference-runtime.ts:4502-4510`). At `sourceOhms = 0` the term vanishes and
the stamp is bit-for-bit the ideal form. The `ac-source` case is the same row
with a time-varying RHS (`reference-runtime.ts:4513-4542`), zero at DC to
match ngspice `SIN` initial conditions. Supply current is reported two ways:
`operatingPointSupplyAmps`, the largest DC-solve branch magnitude across
`dc-source` branches (`reference-runtime.ts:72-89`, accumulated at
`reference-runtime.ts:3626-3635`), and `renderedSupplyPeakAmps`, the largest
render-time magnitude across `dc-source` and `ac-source` branches, null until
a sample renders (`reference-runtime.ts:90-110`). Branch currents are also
readable per stamp from `branchCurrentSnapshot()`
(`reference-runtime.ts:2040-2069`); sign convention is current into the first
terminal, so a delivering supply reads negative.

Fixed versus varying. Constant stamps are folded once per `prepare()` into
per-block base matrices (`reference-runtime.ts:1378-1396`, built at
`reference-runtime.ts:1854-1899`); per sample the runtime copies the base and
applies only the non-constant stamps (`reference-runtime.ts:2900-2930`).
Control-driven stamps stay live because `setControl` writes positions that
`applyStamp` reads every sample (example: `controlled-conductance` at
`reference-runtime.ts:4129-4154`). `setControl` also bumps a global
`controlGeneration` (`reference-runtime.ts:2119-2157`) that invalidates the
eliminated-path factorisation cache (`reference-runtime.ts:3323-3385`) and
the port analysis derived from it.

Runtime mutation verdict, measured in section 3 script 4: mutating a live
`Program` object's `dc-source` stamps between `process()` calls has no
effect, because `volts` and `sourceOhms` are already baked into the base
matrix and base RHS at `prepare()`. A fresh runtime on the same mutated
object solves the new values exactly. So changing `volts` at run time would
invalidate the cached base RHS, and changing `sourceOhms` would invalidate
the cached base matrix plus any eliminated-path factorisation. Neither is
RHS-only today. The sparse schedule pattern is unaffected by either change:
it is built from terminal squares only
(`packages/compiler/src/sparse-schedule.ts:204-223`), and the `-R` diagonal
is deliberately not a pivot candidate
(`sparse-schedule.ts:76-85`), so value changes cannot change pivot order.

## 2. Which rails a "supply" means

Typed evidence available. The document model declares power structure in
`CircuitPowerDomain` and `CircuitPowerRailBinding`
(`packages/core/src/model/types.ts:974-1023`): a domain names
`sourceComponentIds`, `ratedVoltage`, `groundPolarity`, optional
`sourceKind` (`mains-ac` or `external-dc`), and `rails` with `role`
(`main-supply`, `bias-reference`, `regulated-output`, `charge-pump-output`,
`negative-supply`), `derivation` (`direct`, `divider`, `regulator`,
`inverter`, `doubler`, `isolated`, `unspecified`),
`parentRailComponentId`, `converterComponentId`, and `nominalVoltage`. The
core parser reads them (`packages/core/src/formats/interchange/parser.ts`,
`parsePowerDomain` near line 1351, `parsePowerRailBinding` near line 1436).
`Program.supplyReference` derives only ground polarity from lowered
`dc-source` signs (`packages/compiler/src/supply-reference.ts:39-70`); it
names which terminal is ground for chain sharing checks
(`packages/runtime/src/supply-ground.ts`), nothing about which rail is
external. The klon-centaur (+9, +18, -9) and Plumes (+9, -9) multi-rail cases
are documented in `supply-reference.ts:32-37`: derived rails come from an
internal charge pump inside an ordinary pedal.

What the compiler does with it. Nothing at lowering time. No reference to
power domains or rail bindings exists in `lower.ts` or `device-laws.ts`
(verified by search). Charge-pump clusters that share no nets lower as `open`
with a loud warning while their declared rails still stamp as independent
`dc-source` rows (`device-laws.ts:1385-1400` describes the klon view-only
cluster). So a Program's three dc-source stamps for +9/+18/-9 are
indistinguishable as external versus derived without the document.

Decision. A single supply profile maps to stamps by a host-side join over
typed evidence only, never component names or prose:

1. From the document's `power.domains`, take rails in an `external-dc`
   domain whose `derivation` is `direct` and whose `role` is `main-supply`.
2. Resolve each such `railComponentId` through the document connectivity to
   its authored node label, then to Program stamp rows via
   `block.nodeIds`. The stamp whose terminal row carries that label is the
   external rail.
3. Rails with `derivation` of `doubler`, `inverter`, `regulator`, `divider`,
   or `isolated` keep their compiled values. They are converter outputs, not
   battery terminals; giving each of klon's three rails its own 30 ohm
   battery would triple-count one cell.
4. When the document carries no `power` section, or a rail binding is
   missing, the mapping is refused for that rail: fall back to the compiled
   `volts`/`sourceOhms` and report which rails were left untouched. A
   `sourceKind` of `mains-ac` is likewise refused by this API (rectifier
   behavior is section 6 out of scope).

## 3. Proof of concept

Method. Three inline `circuit-interchange/v3` probe documents were compiled
with `compile(doc, { registry: emptyRegistry })`. Each compiled Program was
cloned with `structuredClone` and the clone's `dc-source` stamps were given
the test `volts`/`sourceOhms`; the original was never modified. Each clone
ran on a fresh `ReferenceRuntime` at 48000 Hz. Rail voltage was read from
`nodeVoltageSnapshot()` at the stamp's `positive` row (lowering remaps stamp
terminals to row indices; `nodeIds[row]` is the authored label). Supply
current came from `branchCurrentSnapshot()` and `telemetry()`.

Note on fixtures: `tests/compiler/fixtures/` named in the brief does not
exist. The probes below are synthetic documents in the style of
`tests/simulation.test.ts`; `tests/fixtures/interchange/` holds only parser
fixtures. No corpus packet was used.

Rerun commands (bun 1.3.14, run from the worktree after `bun install`):

```
bun /tmp/sag-poc/sag-resistive.ts
bun /tmp/sag-poc/sag-bjt.ts
bun /tmp/sag-poc/sag-clipper.ts
bun /tmp/sag-poc/sag-midrun.ts
```

### 3a. Shared helper `/tmp/sag-poc/common.ts`

```typescript
import { compile, emptyRegistry } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
import type { Program } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
import { ReferenceRuntime } from "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

export const COMPILER = "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/compiler/src/index.ts";
export const RUNTIME = "/home/joseph/projects/VesselDSP/core/supply-sag-design/packages/runtime/src/index.ts";

export function head(name: string, filename: string): string {
  return `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "supply sag proof of concept probe."
  partNumber: ""
source:
  format: vdsp
  filename: ${filename}
components:
`;
}

export function jack(id: string, name: string, node: number, x: number, stn: string): string {
  return `  - id: ${id}
    kind: jack
    name: ${name}
    sourceTypeName: ${stn}
    origin:
      x: ${x}
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: ${node}
        position:
          x: ${x}
          y: 0
`;
}

export function ground(): string {
  return `  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
`;
}

export function battery(node: number): string {
  return `  - id: BATT1
    kind: battery
    name: BATT1
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        node: ${node}
        position:
          x: 0
          y: 90
      - name: negative
        node: 0
        position:
          x: 0
          y: 110
    properties:
      Voltage: "9V"
`;
}

export function resistor(id: string, a: number, b: number, value: string): string {
  return `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
    origin:
      x: 10
      y: 10
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: 0
      - name: b
        node: ${b}
        position:
          x: 20
          y: 20
    properties:
      Resistance: "${value}"
`;
}

export function compileOrThrow(doc: string): Program {
  const result = compile(doc, { registry: emptyRegistry });
  if (result.status !== "ok") {
    throw new Error("compile failed: " + JSON.stringify(result.reasons, null, 2));
  }
  return result.program;
}

/** Plain-data clone of a Program with every dc-source stamp's volts/sourceOhms replaced. */
export function cloneWithSupply(program: Program, volts: number, sourceOhms: number): Program {
  const clone = structuredClone(program);
  for (const block of clone.blocks) {
    if (block.kind !== "mna") continue;
    for (const stamp of block.stamps) {
      if (stamp.kind === "dc-source") {
        (stamp as { volts: number }).volts = volts;
        (stamp as { sourceOhms: number }).sourceOhms = sourceOhms;
      }
    }
  }
  return clone;
}

export type SupplyReading = {
  readonly volts: number;
  readonly sourceOhms: number;
  readonly railLabel: number;
  readonly railVolts: number;
  readonly supplyAmps: number;
  readonly ipeakRenderAmps: number | null;
  readonly outMean: number;
  readonly outRms: number;
  readonly outPeakPos: number;
  readonly outPeakNeg: number;
  readonly output: Float64Array;
};

export function runProgram(program: Program, input: Float64Array, volts: number, sourceOhms: number): SupplyReading {
  const runtime = new ReferenceRuntime(program);
  runtime.prepare(48000);
  const output = runtime.process(input);
  let railLabel = NaN;
  let railVolts = NaN;
  outer: for (const block of program.blocks) {
    if (block.kind !== "mna") continue;
    for (const stamp of block.stamps) {
      if (stamp.kind === "dc-source") {
        const snap = runtime.nodeVoltageSnapshot().find((s) => s.blockId === block.id);
        if (snap) {
          // Lowering remaps stamp terminals to row indices, so `positive` is
          // already the row; nodeIds[row] is the authored label for reporting.
          railLabel = (snap.nodeIds as readonly number[])[stamp.positive] ?? NaN;
          railVolts = snap.voltages[stamp.positive] ?? NaN;
        }
        break outer;
      }
    }
  }
  const branch = runtime.branchCurrentSnapshot().find((b) => b.kind === "dc-source");
  let mean = 0;
  let ms = 0;
  let peakPos = -Infinity;
  let peakNeg = Infinity;
  for (const v of output) {
    mean += v;
    ms += v * v;
    if (v > peakPos) peakPos = v;
    if (v < peakNeg) peakNeg = v;
  }
  mean /= output.length;
  ms /= output.length;
  return {
    volts, sourceOhms, railLabel, railVolts,
    supplyAmps: branch?.amps ?? NaN,
    ipeakRenderAmps: runtime.telemetry().renderedSupplyPeakAmps,
    outMean: mean, outRms: Math.sqrt(ms), outPeakPos: peakPos, outPeakNeg: peakNeg,
    output,
  };
}

export function sine(n: number, peak: number, freqHz = 1000, rate = 48000): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = peak * Math.sin((2 * Math.PI * freqHz * i) / rate);
  return out;
}

export function fmt(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(digits);
}
```

Two declaration facts this established: a `kind: battery` component needs
the property spelled `Voltage` (a `V` spelling is refused at netlist stage
with `voltage-source has no Voltage`), and the supply terminals must be named
`positive`/`negative` to resolve drive and return.

### 3b. Resistive load: Thevenin exactness `/tmp/sag-poc/sag-resistive.ts`

9 V battery into a 9k load to ground, plus a 10k input-to-output resistor so
the program has audio ports. Expected rail is `E * 9000 / (9000 + Rint)`.

```typescript
// Script 1: resistive load Thevenin check + negative controls.
// Run: bun /tmp/sag-poc/sag-resistive.ts  (from anywhere; paths inside are absolute)
import { battery, cloneWithSupply, compileOrThrow, fmt, ground, head, jack, resistor, runProgram } from "./common.ts";

const doc =
  head("Sag probe: resistive load", "sag_resistive.vdsp") +
  jack("JIN", "INPUT", 1, -200, "Circuit.Input") +
  jack("JOUT", "OUTPUT", 2, 200, "Circuit.Output") +
  ground() +
  battery(3) +
  resistor("RLOAD", 3, 0, "9k") +
  resistor("R1", 1, 2, "10k");

const program = compileOrThrow(doc);
const compiledOhms = (() => {
  for (const b of program.blocks) {
    if (b.kind !== "mna") continue;
    for (const s of b.stamps) if (s.kind === "dc-source") return (s as unknown as { sourceOhms: number }).sourceOhms;
  }
  return NaN;
})();
console.log("as-compiled dc-source sourceOhms:", compiledOhms);

const N = 480;
const silence = new Float64Array(N);
const RLOAD = 9000;
const E = 9;

for (const rint of [compiledOhms, 0, 1, 30]) {
  const clone = cloneWithSupply(program, E, rint);
  const r = runProgram(clone, silence, E, rint);
  const expected = (E * RLOAD) / (RLOAD + rint);
  console.log(
    `Rint=${rint} ohm  rail=${fmt(r.railVolts)} V  expected=${fmt(expected)} V  ` +
    `err=${(Math.abs(r.railVolts - expected)).toExponential(2)} V  ` +
    `Isupply=${fmt(r.supplyAmps * 1000, 6)} mA  expected=${fmt((E / (RLOAD + rint)) * 1000, 6)} mA`,
  );
}

// Volts variant: dying battery 6.8 V through 30 ohm.
{
  const clone = cloneWithSupply(program, 6.8, 30);
  const r = runProgram(clone, silence, 6.8, 30);
  const expected = (6.8 * RLOAD) / (RLOAD + 30);
  console.log(`E=6.8 Rint=30  rail=${fmt(r.railVolts)} V  expected=${fmt(expected)} V  Isupply=${fmt(r.supplyAmps * 1000, 6)} mA`);
}

// Negative control 1: untouched clone reproduces the as-compiled program bit for bit.
{
  const a = runProgram(program, silence, E, compiledOhms).output;
  const b = runProgram(structuredClone(program), silence, E, compiledOhms).output;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 1) maxDelta = Math.max(maxDelta, Math.abs(a[i]! - b[i]!));
  console.log(`negative control (unmodified clone vs original output): max abs delta = ${maxDelta}`);
}
```

Exact output:

```
as-compiled dc-source sourceOhms: 1
Rint=1 ohm  rail=8.999000 V  expected=8.999000 V  err=9.00e-12 V  Isupply=-0.999889 mA  expected=0.999889 mA
Rint=0 ohm  rail=9.000000 V  expected=9.000000 V  err=0.00e+0 V  Isupply=-1.000000 mA  expected=1.000000 mA
Rint=1 ohm  rail=8.999000 V  expected=8.999000 V  err=9.00e-12 V  Isupply=-0.999889 mA  expected=0.999889 mA
Rint=30 ohm  rail=8.970100 V  expected=8.970100 V  err=2.68e-10 V  Isupply=-0.996678 mA  expected=0.996678 mA
E=6.8 Rint=30  rail=6.777409 V  expected=6.777409 V  Isupply=-0.753045 mA
negative control (unmodified clone vs original output): max abs delta = 0
```

Rail matches the divider to within 3e-10 V; supply current magnitude
matches `E / (R + Rint)` to 6 decimals (negative sign is the delivering
convention). An unmodified clone reproduces the original output bit for bit.
Correction to the brief: `sourceOhms = 0` does NOT reproduce the original
program bit for bit in this tree, because the as-compiled default is 1 ohm.
It reproduces the ideal rail exactly (error 0.00e+0), which differs from the
as-compiled 8.999000 V on this load.

### 3c. Biased gain stage `/tmp/sag-poc/sag-bjt.ts`

Common-emitter NPN (default silicon law, beta 100): 470k/100k base divider
from the rail, 4.7k collector resistor to the rail, 1k emitter resistor to
ground, 100n in/out coupling caps. One MNA block, 7 nodes. DC bias read with
a silent run; loud is a 0.3 V peak 1 kHz sine (output near 1.34 V peak, no
rail clipping); quiet is 5 mV peak.

Full script text is in `/tmp/sag-poc/sag-bjt.ts` (134 lines: the `capacitor`
and `bjt` builders plus the measurement loop; builders follow the same shape
as `resistor` with terminal names `a`/`b` and
`base`/`collector`/`emitter` and no properties).

Exact output:

```
Rint | railDC | Vb | Vc | Ve | IsupplyDC(mA) | IpeakRender(mA) | loudMean | loudAcRMS | loudPk+ | loudPk- | quietMean | quietAcRMS
0 | 9.000000 | 1.155824 | 6.588196 | 0.518281 | -0.5298 | 0.8136 | -0.003600 | 0.935904 | 1.3382 | -1.3369 | -0.000014 | 0.015660
1 | 8.999470 | 1.155772 | 6.587898 | 0.518232 | -0.5298 | 0.8136 | -0.003602 | 0.936098 | 1.3385 | -1.3372 | -0.000014 | 0.015664
30 | 8.984150 | 1.154260 | 6.579279 | 0.516791 | -0.5283 | 0.8121 | -0.003643 | 0.941699 | 1.3465 | -1.3453 | -0.000014 | 0.015758
100 | 8.947515 | 1.150644 | 6.558667 | 0.513348 | -0.5249 | 0.8085 | -0.003745 | 0.955207 | 1.3656 | -1.3647 | -0.000016 | 0.015985
negative control (unmodified clone, loud sine): max abs delta = 0
```

DC bias moves with the rail: Vc 6.588196 V at ideal down to 6.558667 V at
100 ohm (29.5 mV); Vb and Ve move 5.2 and 4.9 mV. Quiescent draw is about
0.53 mA, so the 100 ohm droop of 52.5 mV is consistent with
`I * Rint` (0.525 mA DC plus signal swing; peak render current 0.81 mA under
loud drive). Small-signal AC gain rises about 2.1 percent from Rint 0 to 100
(0.935904 to 0.955207 loud, 0.015660 to 0.015985 quiet, same fraction, so it
is gain and not a clipping artifact). The mechanism is not proven; the
working hypothesis is signal current through the bias network modulating the
finite-impedance rail, which then feeds back to the base. This is listed in
section 9 as the honest unknown, because the sign (gain rising as the rail
sags) needs a dedicated experiment before anyone designs around it.

### 3d. Rail-referenced clipper `/tmp/sag-poc/sag-clipper.ts`

Input through 1k into the output node; diode D1 anode at the signal, cathode
at the rail (positive clip at Vrail + Vf); diode D2 anode at ground, cathode
at the signal (negative clip at -Vf, ground-referenced). Loud is a 12 V peak
1 kHz sine (a 5 V first attempt never reached the 9 V rail and clipped only
on the ground side; the drive level is a probe choice, not a guitar level).
Quiet is 0.1 V peak.

Rerun command: `bun /tmp/sag-poc/sag-clipper.ts` (kept copy:
`docs/design/sag-poc/sag-clipper.ts`, with `common.ts` beside it).

Exact output, trimmed to the table rows:

```
--- loud (12 V peak): Rint | railDC | IsupplyDC(mA) | IpeakRender(mA) | outPk+ | outPk- | outRMS
0 | 9.000000 | -0.0000 | 2.3746 | 9.6254 | -0.7050 | 5.41815
1 | 9.000000 | -0.0000 | 2.3722 | 9.6277 | -0.7050 | 5.41871
30 | 9.000000 | -0.0000 | 2.3068 | 9.6932 | -0.7050 | 5.43447
100 | 9.000000 | -0.0000 | 2.1627 | 9.8373 | -0.7050 | 5.46928
--- quiet (0.1 V peak): Rint | outRMS | maxDeltaVsRint0
0 | 0.0707038 | 0
1 | 0.0707038 | 3.469446951953614e-18
30 | 0.0707038 | 9.71445146547012e-17
100 | 0.0707038 | 2.7755575615628914e-16
negative control (unmodified clone, loud sine): max abs delta = 0
```

Positive clip threshold moves from 9.6254 V at ideal to 9.8373 V at 100
ohm (+212 mV); output RMS rises 0.9 percent. The ground-referenced negative
peak is nailed at -0.7050 V at every resistance. The quiet run is not
bit-identical: sample deltas against the Rint 0 run are 3.5e-18 at 1 ohm,
9.7e-17 at 30 ohm, and 2.8e-16 at 100 ohm. Those are solver-noise scale
(about 1e-16 relative on 0.07 RMS), not signal, and the RMS prints identical
to 7 decimals. The unmodified-clone negative control is exactly 0.

### 3e. The clipper finding: current flows back into the rail

In the clipper the loud signal pushes current back INTO the rail: during
positive clipping, current flows from the input source through RS and D1 into
the rail node, then through Rint back to the EMF. With series resistance that
charging current lifts the rail terminal (the solved row is
V(pos) - V(neg) = volts + R * i with i positive into the terminal), so the
clip threshold moves UP with resistance: outPk+ 9.6254 at Rint 0 to 9.8373
at Rint 100, while the idle rail stays 9.000000 V in every row because the
quiescent draw is zero. Peak render current falls as resistance rises (2.3746
to 2.1627 mA) because the lifted rail leaves less voltage across RS: the loop
is self-consistent.

Limitation. A real alkaline battery cannot absorb that current the way an
ideal EMF with a series resistor does. A cell is not a two-quadrant supply:
charging current is a different electrochemical regime, and a 9 V block has
no reservoir capacitor to take it. The model used here is symmetric by
construction and this probe exercised the charging quadrant, so the upward
threshold move is a property of the Thevenin equivalent, not a measured
property of a battery under backfeed. What this implies: a supply model that
claims battery fidelity needs a one-way source (sink no current, or clamp the
rail instead of lifting it), and that behavior needs its own probe with a
rectifier-style guard before any profile calls itself a battery. No such fix
was built or tested here; the proposed API in section 4 keeps the symmetric
mechanism and the limitation stands as stated.
## 4. Proposed API

### 4a. Runtime surface: `setSupplyVoltsAndOhms`

New method on `ReferenceRuntime`
(`packages/runtime/src/reference-runtime.ts`), next to `setControl`:

```typescript
setSupplyVoltsAndOhms(selector: SupplySelector, volts: number, sourceOhms: number): void
```

`SupplySelector` names stamps, not audio: either a list of
`(blockId, sourceIndex)` pairs or a predicate over `(positiveRow, volts)`.
The method writes the two fields on the matched live `dc-source` stamps, then
does the two invalidations section 1 proved necessary: rebuild the affected
blocks' `baseMatrices` entries exactly the way `prepare()` builds them
(`reference-runtime.ts:1854-1899`), and bump `controlGeneration` so the
eliminated-path factorisation, Z, and K_reduced rebuild on next use
(`reference-runtime.ts:3323-3385`). No sparse-schedule rebuild: the pattern is
value-independent (`sparse-schedule.ts:204-223`). No Program format change:
the fields already exist on the stamp, the Program stays plain data, and the
extraction plan's minor-bump rule for Program or Stamp changes
(workbench `2026-09-22-compiler-runtime-extraction-plan.md`, line 62) is not
triggered.

Behavior during audio. Same contract as `setControl`: call between
`process()` calls, never concurrently with one. Effect starts at the next
sample; reactive state (capacitors, op-amp pole memory) carries over, which is
the physically honest response to hot-swapping a battery, and the operating
point is deliberately not re-solved. Validation mirrors `setControl`:
`volts` finite, `sourceOhms` finite and non-negative; throw `RuntimeError`
otherwise. A negative resistance would be gain, not sag, and must be refused
rather than solved.

What a host passes. The host holds the document and the Program, runs the
section 2 join (external-dc domain, direct derivation, main-supply role,
railComponentId to node label to stamp row), and passes the resulting stamp
addresses plus the profile's volts and ohms. `ChainRuntime`
(`packages/runtime/src/chain.ts:180-197`) gains `setSupply(slot, ...)` by the
same addressing it already uses for controls. The chain package
(`packages/chain/src/nodes/runtime-node.ts`) gains a `SupplyProfile` apply
path described next.

### 4b. Chain-level model

```typescript
type SupplyProfile = {
  readonly name: string;
  readonly nominalVolts: number;
  readonly internalResistanceOhms: number;
};
```

`RuntimeNode` applies a profile by calling the runtime method with the
section 2 stamp addresses. There is no audio-domain processing anywhere in
this path: no envelope follower, no waveshaper, no extra node in the signal
chain. The old node failed exactly because it shaped audio to imitate a
supply; this one moves the rail inside the solve and lets bias, headroom, and
clipping follow. A profile swap that resolves to the same numbers is a no-op
and must skip the rebuild.
## 5. Profile data with provenance

The only real document opened for this section is the AMZ article described
below. Every value not traceable to it is marked `unsourced`. In particular:
no manufacturer 9 V datasheet was opened (the Energizer 522 and Eveready 1222
sheets were found in search but their PDFs were never retrieved, so no page,
table, or figure can be cited from them); the Duracell MN1604 PDF fetch
failed; the Energizer internal-resistance white paper fetched as unreadable
binary. Search-result excerpts are not citations and are not used.

The opened document. "9v Battery Impedance", subtitle "Measuring the
Characteristics of Depleted Cells", by Jack Orman, copyright 2015, AMZ-FX Lab
Notebook, single HTML page (no page numbers), URL
http://www.muzique.com/lab/batteryz.htm (fetched 2026-10-02). Method, stated
in the "9 Volt Battery Basics" section: unloaded reading with a Fluke
multimeter (10 Mohm load), then loaded with a 560 ohm resistor (about 16 to
17 mA), internal resistance by Ohm's law from the drop. Relevant tables:

- Fresh table ("9v Battery Brand" / "DC Resistance in Ohms"): Sunbeam Heavy
  Duty #1 25.28, Sunbeam Heavy Duty #2 26.57, AC-Delco alkaline #1 5.99,
  AC-Delco alkaline #2 4.82.
- Used table ("Unloaded Voltage" / "Loaded Voltage" / "DC Resistance in
  Ohms"): AC-Delco Heavy Duty #1 9.49 / 9.08 / 37.91; Rayovac alkaline #2
  8.92 / 8.77 / 14.60; Sunbeam Heavy Duty #3 9.78 / 9.47 / 27.33; GI Heavy
  Duty #5 9.12 / 7.54 / 188.40; Duracell alkaline #6 7.73 / 6.43 / 195.00;
  Golden Power Heavy Duty #7 9.02 / 7.91 / 78.47.
- AC table ("Impedance at 220 Hz" / "at 1k Hz"): Rayovac alkaline #2 0.76 /
  unmeasured; GI Heavy Duty #5 145.73 / 135.82; Duracell alkaline #6 40.36 /
  38.55.
- Idle currents ("Circuit" / "Current Use in milliamps"): Jfet Buffer 0.54,
  Mosfet Booster 1.16, Mini-Booster 0.53, Fuzzface 1.38; no current change
  under 1 V of audio on the first three.
- Summary bullets: fresh 5 to 25 ohms by construction; resistance highest at
  DC and falling with frequency; depleted under 200 ohms; fuzz tone change
  comes from lower voltage, not resistance.

Candidate profiles:

| profile | nominal volts | internal resistance | provenance |
|---|---|---|---|
| fresh alkaline 9 V | `unsourced` (no opened doc states a nominal rating) | 5 to 6 ohm | AMZ article above, fresh table: AC-Delco alkaline 5.99 and 4.82 ohm |
| fresh zinc-carbon 9 V | `unsourced` | 25 to 27 ohm | AMZ article above, fresh table: Sunbeam Heavy Duty 25.28 and 26.57 ohm |
| depleted alkaline 9 V (single specimen, not a type rating) | 7.73 open / 6.43 loaded, that specimen only | 195 ohm, that specimen only | AMZ article above, used table: Duracell alkaline #6 row |
| used zinc-carbon, mid life | 9.02 open / 7.91 loaded, that specimen only | 78 ohm, that specimen only | AMZ article above, used table: Golden Power Heavy Duty #7 row |
| regulated 9 V adapter | `unsourced` | `unsourced` (no value proposed; no source found) | none |
| regulated 18 V adapter | `unsourced` | `unsourced` (series arithmetic from an 18 V rating may not be assumed without a source) | none |
| unregulated AC/DC adapter | out of scope (section 6) | out of scope | none |

Two repo-internal numbers for context, not provenance. The rejected
`PowerSupplyNode` profiles (alkaline 1.5, zinc-carbon 25, dying 180,
regulated 0.05, unregulated 15, custom 10 ohms) were read in git history
(`feat/player-plan`, commit `781bd92`,
`packages/chain/src/nodes/power-supply-node.ts`) and are unsourced guesses;
the zinc-carbon 25 and dying 180 sit near AMZ's 25 to 27 fresh and 188 to 195
depleted readings, but nearness is not provenance and they stay `unsourced`.
The compiled default `SUPPLY_SOURCE_OHMS = 1`
(`packages/compiler/src/device-laws.ts:86-109`) is a repo-internal prior
with a stated rationale (low end of the plausible range, errs toward ideal);
it is externally `unsourced`.

Measured-specimen entry. The user reads their own battery with a multimeter
and enters a custom profile, following the AMZ method: open-circuit volts is
E; then a loaded reading across a known resistor (AMZ used 560 ohm) gives
Rint = (Vopen - Vloaded) / (Vloaded / Rload). Two readings and one resistor
value are the whole procedure. Note AMZ's AC table: impedance at 220 Hz is a
fraction of the DC resistance, so a single Rint is a DC approximation and
high-frequency supply interaction is outside it.
## 6. Out of scope and why

AC ripple. Excluded because ripple is a time-varying EMF plus reservoir
state, not a scalar impedance. The `ac-source` stamp already carries the sine
evaluation and its own `sourceOhms` (`reference-runtime.ts:4513-4542`), but a
profile that injects ripple numbers into it would be re-creating the rejected
node's ripple oscillator inside the solver. Ripple emerges from rectifier and
reservoir modeling when that work happens; until then no profile carries a
ripple field.

State-of-charge dynamics (two-RC battery). Excluded because E and Rint become
functions of integrated current and rest time, which needs per-supply state
advanced per sample and chemistry parameters this note could not source
(section 5). The workbench contract experiment already accepted a generic
two-RC source-equivalent slice with exact callback invariance, but noted
chemistry-backed parameter rows still require published or bench-derived
parameters. The API leaves room: a future `advanceSupplyCharge(dt, current)`
can sit beside `setSupplyVoltsAndOhms` and write the same two fields.

Mains rectifier behavior. Excluded because it needs diode conduction,
reservoir capacitors, and filter ladders as solved components, which is the
amp lane's half of the power-domain contract, not a pedal profile. A
`mains-ac` domain is refused by the section 2 mapping. No room is taken away:
rectifier state would live in stamps and block state, addressed the same way.

What the API preserves for all three. `volts` and `sourceOhms` remain the only
supply scalars the solver reads, so any future dynamic (SoC integrator,
reservoir follower, thermal drift) can drive these two fields without
changing stamps, programs, or the schedule. The limitation in section 3e
(one-way source) is the one deliberate gap left open rather than closed.
## 7. Cross-repo and gating

The C++ console is not in this repo. Its source is read-only at
`workbench/src/runtime/` (`cpp/Engine.cpp`, `cpp/ProgramJson.cpp`,
`cpp/include/v2/Program.h`). What was verified by reading: the C++ engine
already mirrors the `-sourceOhms` diagonal in three stamp cases
(`Engine.cpp` near lines 2970, 2981, 3045), `Program.h` near line 147
defaults `sourceOhms` to 0.0, and `ProgramJson.cpp` near line 432 parses it.
So the sag mechanism needs no C++ solver change; what needs the workbench is
the control surface: a C++ setter that updates a loaded program's supply
fields and re-derives whatever the C++ console caches from them (the TS side
caches base matrices, and the C++ side must be audited for its own
equivalents rather than assumed identical), plus JSON round-trip if profiles
are ever persisted.

Required parity test. The workbench harness is
`workbench/scripts/test-v2-wasm-parity.ts`: it runs the TS reference console
and the C++/WASM console over the same programs, compares post-settle
windows (default 100 settle, 2048 window samples at 48 kHz), and refuses on
divergence. The supply gate adds rows that run the section 3 sweep (Rint 0,
1, 30, 100 and a volts variant) on both consoles and require identical rail
voltages within the harness tolerance, plus a row that calls the new setter
mid-stream on both consoles and requires the same post-change trajectory.
No WASM binary is built or committed from this worktree.

Gating rows. The extraction plan
(workbench `thoughts/shared/plans/2026-09-22-compiler-runtime-extraction-plan.md`)
blocks phase 2 on board X2 rows: (1) P9 subthreshold law committed, (2) P2
row 8 step 3 `bufferProgram` landed or explicitly deferred, (3) P3 row 7
macro-dispatch retirement landed, (4) unified-plan section 8(c) named-ports
decision, (5) the production-ready sweep. The C++ setter and its parity rows
are new work behind the same gate: they touch the C++ console and the shared
Program handling while the packages are not yet the source of truth, so they
land in the workbench first and are re-proposed here only after the flip.
The TS-side `setSupplyVoltsAndOhms` needs no gate: it changes no Program or
Stamp shape and triggers no minor bump under the plan's line 62 rule.
## 8. Work breakdown

Each row is one worker, with files touched and the test that gates it. Every
test uses hand-computed expected values plus a positive and a negative
control; no test asserts a value the author did not compute by hand first.

1. Runtime setter. Files: `packages/runtime/src/reference-runtime.ts`
   (method plus base-matrix rebuild helper). Test: compile the section 3b
   resistive probe in-repo, call the setter for Rint 0/1/30/100 between runs,
   expect `E * 9000 / (9000 + R)` to 1e-9 and branch current `E / (9000 + R)`;
   negative control: same numbers without the setter, and an unmodified clone
   bit-identical.
2. Stamp addressing. Files: `packages/runtime/src/reference-runtime.ts`
   (selector type). Test: two-supply program (9 V plus a 5 V vref-style
   source); address only one; expect the other rail unchanged to solver
   tolerance; negative control: empty selector changes nothing.
3. Elimination invalidation. Files: `packages/runtime/src/reference-runtime.ts`
   (`controlGeneration` bump path). Test: a 12-plus-unknown nonlinear block
   with `eliminate` set, setter sweep, expect identical rails to the dense
   path at each Rint; negative control: pre-fix behavior would freeze the
   first rail, assert it moves.
4. Document-to-stamp map. Files: new helper in `packages/compiler/src/` (or
   core if it needs the document model) plus `packages/core/src/model/`
   readers. Test: `voltage-divider-power-topology.vdsp` and
   `charge-pump-derived-rails-valid.vdsp` from `tests/fixtures/interchange/`;
   expect the direct rail mapped and the doubler/inverter rails refused with
   reasons; negative control: a power-less document maps nothing.
5. Chain profile. Files: `packages/chain/src/nodes/runtime-node.ts`,
   `packages/runtime/src/chain.ts`. Test: apply a `SupplyProfile` through
   `RuntimeNode`, expect sample-identical output to the equivalent direct
   runtime calls; negative control: same-numbers re-apply skips the rebuild
   (assert via telemetry or a rebuild counter), and no node in the chain
   performs audio waveshaping (assert output equals raw runtime output).
6. Profile data. Files: docs plus a `SupplyProfile` constant table in
   `packages/chain/src/`. Test: every table entry carries a source string or
   the literal `unsourced`; a lint test fails any numeric entry without one.
   Values only from opened documents (section 5 rule).
7. C++ mirror and parity (cross-repo, gated by section 7). Files:
   `workbench/src/runtime/cpp/Engine.cpp`, JSON layer, parity script rows.
   Test: `test-v2-wasm-parity.ts` supply rows green on both consoles.
8. Op-amp rail draw prerequisite (separate track, not this API). Files:
   compiler rail-node work per the workbench scoping note. Test: an op-amp
   packet's `operatingPointSupplyAmps` moves from near-zero to a datasheet
   scale quiescent figure. Until this lands, sag on op-amp-heavy pedals is
   wrong-low and must be documented as such wherever profiles are offered.
## 9. Risks and unknowns

What did not behave as expected. First, the BJT stage gain rises about 2
percent as the rail sags (section 3c); the sign is unexplained and the
rail-feedback hypothesis is untested, so no design decision may assume sag
always reduces gain. Second, the clipper pumps the rail upward under
clipping inflow (section 3e); anyone expecting only droop will misread that
probe. Third, mid-run stamp mutation is silently ignored today (section 3,
script 4): any host that writes Program fields directly gets stale rails with
no error, which is why the setter must own all mutation. Fourth, the first
clipper attempt at 5 V peak never reached the 9 V rail and clipped only on
the ground side; probe drive levels must be chosen against the rail or the
experiment tests nothing.

Structural risks. Op-amp packets draw near-zero supply current
(`ideal-opamp` sources its output from ground), so every sag figure for them
is wrong-low until row 8 of section 8 lands; offering battery profiles on
those pedals without that warning would be fiction. The symmetric Thevenin
source absorbs charging current a real cell cannot (section 3e). Derived
rails silently triple-count one cell if a host profiles every stamp. A missed
`controlGeneration` bump or base-matrix rebuild is a stale-rail wrong answer,
not a crash; row 3 of section 8 exists to pin it. Rebuild cost per call is
one base-matrix pass per affected block, acceptable between buffers but not
per sample.

Claims that could not be verified. (a) Any internal resistance or nominal
voltage for regulated 9 V or 18 V adapters: no source found, no numbers
proposed. (b) Zinc-carbon behavior beyond AMZ's fresh 25 to 27 and depleted
up-to-195 readings: single-source, small sample. (c) The C++ console's
caching around supply fields: source read, behavior not executed (no binary
in this repo). (d) `ac-source` mid-run `sourceOhms` freshness: inferred from
code reading (non-constant path), not executed. (e) The BJT gain-rise
mechanism. (f) Whether 12 V probe drive invalidates the clipper's audio
conclusions for guitar levels: the threshold-shift mechanism is
level-independent but the magnitude is not. (g) Workbench C++ line numbers (`Engine.cpp` 2970/2981/3045,
`Program.h` 147, `ProgramJson.cpp` 432) came from one `rg` run, not from
executed code; re-grep before building row 7 of section 8 in case the
workbench tree moved.

## 10. Implementation status

Row 4 of section 8 (document-to-stamp map) is implemented: `resolveSupplyStamps`
in `packages/compiler/src/supply-stamps.ts`, with `SupplyAddress`,
`ResolvedSupply`, `RefusedSupply`, `SupplyResolution`, and the closed
`SupplyRefusalReason` union exported from `packages/compiler/src/index.ts`.
Gated by `tests/compiler/supply-stamps.test.ts` (8 tests, all passing).

Departures from this note, where the task brief wins:

- The note's section 2 step 2 says the join resolves "railComponentId to node
  label to stamp row via block.nodeIds". `CircuitDocument` carries no declared
  node ledger (the parser drops terminal `node:` keys and `Terminal` has no
  node field), so the document side reads geometric connectivity through the
  already-exported `resolveConnectivity` / `getPinNode` from
  `@vessel-dsp/core`. For purely geometric documents both sides agree
  (ground 0, document order after); a declared-only topology with no matching
  geometry refuses as `no-stamp-for-rail` rather than guessing.
- The note lists five refusal causes; the union carries seven. Added
  `rail-not-main-supply` (external-dc, direct, but a non-main role) and
  `unknown-source-kind` (domain declares no `sourceKind`, so external versus
  derived cannot be shown from typed evidence). No core readers were missing,
  so `packages/core` was not touched.
- Ambiguity (`ambiguous-stamp`) is injected at the program level in tests,
  not authored in YAML: lowering collapses twin same-volt supplies on one node
  to one stamp and refuses contradictory ones, so two same-node sources are
  unrepresentable from source.
- Fixture status: `voltage-divider-power-topology.vdsp` and
  `charge-pump-derived-rails-valid.vdsp` do not compile as filed (no jacks;
  compile refuses with "document declares no connected jack"). Tests use
  compilable geometric derivatives (jacks, stub wires, typed `Voltage`,
  derived rails as `kind: rail` so they stamp) and keep the fixtures' domain
  and rail declarations; the charge-pump converter component is omitted
  (emptyRegistry has no model; the rails stay declared separately).
- Positive-ground resolution (germanium PNP style, rail on the stamp's
  negative terminal) is implemented and tested, not left open.
