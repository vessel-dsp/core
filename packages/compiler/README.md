# @vessel-dsp/compiler

Headless circuit compiler turning `.vdsp` / `CircuitDocument` schematic data into compiled simulation `Program` ROMs for VesselDSP. Pure TypeScript, deterministic, rate independent, headless. It depends on `@vessel-dsp/core` and `js-yaml` only.

## Install

`@vessel-dsp/compiler` 0.4.0 is on npm:

```bash
bun add @vessel-dsp/compiler
```

Subpath exports: `.` (compile, registries, the supply-stamp join, and every `Program` type), `./diagnostics` (the report-only reach into stages for instruments), and `./fixtures` (the synthetic circuits the engine is graded on, with hand-computed expectations).

## Minimal example

Compile takes `.vdsp` source text and an optional part registry. It returns a result, never a throw, for a document it cannot use. The fixtures below ship with the package under `./fixtures`, so this runs as written:

```ts
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { resistorDivider } from "@vessel-dsp/compiler/fixtures";

const result = compile(resistorDivider, { registry: emptyRegistry });

if (result.status === "ok") {
  console.log("Compiled program blocks:", result.program.blocks.length);
  console.log("Warnings:", result.warnings.length);
} else {
  console.error("Compilation refused:", result.reasons);
}
```

```text
Compiled program blocks: 1
Warnings: 0
```

## Which registry to pass

`compile(source, options)` defaults to `emptyRegistry` when no registry is given. The empty registry models only device class laws (resistor, capacitor, plain op-amp stages) and refuses parts that need catalog identity. `pedalPartCatalog` is the corpus facing catalog injected by scripts and tests.

Over the eight fixtures used in the guides (`resistorDivider`, `rcLowPass`, `diodeClipper`, `invertingAmplifier`, `potDivider`, `commonEmitterAmplifier`, `emitterFollower`, `triodeGainStage`), both registries compile 8 of 8. Measured over the 121 top level packets in the artifacts corpus (read only, not committed):

- `emptyRegistry`: 74 of 121 compile.
- `pedalPartCatalog`: 119 of 121 compile. The two refusals are `boss-dd-3t.vdsp` and `boss-dd-5.vdsp`, both undisclosed DSP parts.

Use `pedalPartCatalog` for real pedal packets. Use `emptyRegistry` only to measure what works with no part knowledge, or for synthetic device class probes.

One refusal shape, for the `unknownChip` fixture with `emptyRegistry`:

```text
[{ "stage": "device-laws", "device": "U1",
   "reason": "integrated circuit has no model: its part number
   \"UNKNOWN-PART-XYZ\" matched no registry entry, and a declared
   class may not supply a macro for a part whose identity is unresolved" }]
```

## Result shape

`compile` returns `CompileResult`:

- `{ status: "ok", program, warnings }`. Warnings never block a program. A pedal with a dead knob is still worth hearing, but it must not be silent about it. Each warning carries a closed `code` callers can switch on, plus human readable `detail`.
- `{ status: "unsupported", reasons }`. Each reason is a `CompileRefusal` with `stage` (`netlist`, `device-laws`, `partition`, `lower`, or `link`), `device` (component id or null), and a human readable `reason`. `device-laws` means a part could not be modelled; any other stage means the document itself does not support a program. A floating wiper that disconnects the circuit refuses at the `link` stage instead of warning.

Only a `StageRefusal` becomes a result. Anything else (a compiler bug) propagates as a throw, because a bug reported as an unsupported pedal would be a wrong answer about someone's circuit.

`compileToArtifact(source, options)` runs `compile` and pairs it with `emit`: `{ result, artifact }` where `artifact` is null unless the result is ok. `emit` renders the deterministic serializable form (`{ text, digest }`). There is no public `decode` in 0.2.0: program JSON is consumed by the consoles.

`readNetlist(source, options?)` runs the first stage only: document text to a law free `Netlist` with `inputJack`/`outputJack` overrides and `parseQuantity` for SI values (`10k` to 10000).

## The Program

A `Program` is rate independent: it carries no sample rate. The runtime supplies the rate at `prepare()`. Top level keys:

`formatVersion` (6 in 0.2.0), `requiredOperators`, `requiredModels`, `costPredictors`, `blocks`, `order`, `controls`, `ports`, `supplyReference`, `portReferenceVolts`, `portFullScaleVolts`, `stageCoverage`, `portImpedanceOhms`, `bypass`.

Compiled `Program`s carry `formatVersion` 6. Named I/O ports and the `bufferProgram` bypass are deferred to a later `formatVersion`; from here any change to `Program`, the `Stamp` union, `ProgramJson.cpp` or `Program.h` is a package minor bump.

`requiredOperators` lists every stamp operator the executed blocks present, sorted, so a runtime can refuse by name at load. `requiredModels` lists every macro DSP model id the same way. `order` is the block execution order and may omit blocks `blocks` retains. `supplyReference` is `negative-ground`, `positive-ground`, `dual-rail`, or `unpowered`, derived from `dc-source` signs. `stageCoverage` is `instrument`, `preamp`, `speaker-electrical`, or `miked`. `portFullScaleVolts` (a ceiling derived from the rails) and `portReferenceVolts` (the 0 dBFS voltage the jack declares) are different quantities; either entry may be `null`.

`commonEmitterAmplifier` with `emptyRegistry` compiles to 1 block (`order: ["analog:0"]`) with stamp kinds `dc-source` 1, `capacitor` 2, `conductance` 5, `bjt` 1, `input-source` 1. The `potDivider` fixture declares one control, `Level` (`taper: linear`, default 0.5, continuous so `positions: null`, role `output-level`, label `VOLUME`).

Each `mna` block carries `nodeIds` (row to source node map), `auxCount`, `stamps`, `stampPartition`, `sparseSchedule`, `stateCount`, `linear`, `controlFree`, `eliminate`, input/output nodes, and operating point seeds. A `macro` block carries a DSP `modelId` with parameters instead of stamps.

## Supply stamps

`resolveSupplyStamps(source, program)` joins the document power domains to the compiled `dc-source` stamps. It takes the same source text the program was compiled from and returns `{ supplies, refused }`. Only rails in an external DC domain with `derivation: direct` and `role: main-supply` are candidates; derived rails (divider, regulator, inverter, doubler, isolated) keep their compiled values.

The closed refusal reasons are `no-power-section`, `mains-ac-source`, `unknown-source-kind`, `source-kind-conflict`, `derived-rail`, `rail-not-main-supply`, `no-stamp-for-rail`, `ambiguous-stamp`. Callers switch on `reason`; `detail` is prose for a human report. Mains fed amp B+ rails are refused by design: a battery profile must never be applied downstream of a rectifier.

See the Compiler guide for a worked `resolveSupplyStamps` example, and the [runtime supply-control design note](https://github.com/vessel-dsp/core/blob/main/docs/design/runtime-supply-control.md) for the full design.

## Public exports

Values on `.`:

| Name | What it is |
| --- | --- |
| `compile` | Compile, or explain the refusal. Never throws for a document it cannot use. |
| `compileToArtifact` | `compile` plus `emit`, paired as `{ result, artifact }`. |
| `emit` | Render a `Program` to its serializable `{ text, digest }` artifact. |
| `readNetlist` | First stage only: source text to a law free netlist. |
| `parseQuantity` | Parse a quantity to SI base units (`10k` to 10000). |
| `emptyRegistry` | No part knowledge; measures what device class laws alone cover. |
| `pedalPartCatalog` | The catalog corpus facing scripts inject. |
| `foldPartId` | Fold case and separators (`MN-3007` is `mn3007`). |
| `foldToken` | Fold case and whitespace for typed vocabulary values. |
| `registryEntryFor` | Entry lookup for a device. |
| `registryLawFor` | The law a registered part supplies for a device. |
| `canonicalPartId` | Canonical part identity spelling. |
| `zenerCatalogPartIds` | Part ids the catalog treats as zeners. |
| `resolveSupplyStamps` | Join document power domains to compiled `dc-source` stamps. |
| `attachDeviceLaws` | Stage 2: attach laws to every netlist device. |
| `gateOnlyFetPartIds` | Part ids (folded) whose catalog `fet` entry refines the gate junction only, so the channel stays at the class default. |
| `computeNumericRepivot` | Value-aware re-pivot of a block's sparse schedule from its operating-point matrix (the runtime calls it at `prepare()`; the C++ console ports it). Returns `null` when no candidate meets the threshold. |
| `NUMERIC_REPIVOT_TAU` | The one pivot threshold (1e-3) `computeNumericRepivot` defaults to. |

Types on `.` (import with `import type`): `CompileOptions`, `CompileResult`, `CompileSuccess`, `CompileFailure`, `CompileRefusal`, every `Program`/`Block`/`Stamp`/`Control`/cost type (`Program`, `Block`, `Stamp`, `OperatorKind`, `Control`, `ControlId`, `TaperKind`, `Ports`, `CostPredictors`, `NodeId`, `GROUND`, and the rest in `types.ts`), and the supply-join types (`SupplyAddress`, `ResolvedSupply`, `RefusedSupply`, `SupplyResolution`, `SupplyRefusalReason`).

`./diagnostics` (report-only reach into stages for instruments, not consumer API): `blockRow`, `describeRow`, `nodeAt`, `stampNodes`, `stampInSourceNodes`, `perSample`, `SILICON_FORWARD_BETA`, `SILICON_SATURATION_CURRENT`, `THERMAL_VOLTAGE`, `findBistableLatches`, `OPEN_RULES`, `connectedToBothPorts`, `isPacketDisconnected`, `outputDependence`, `validateProxy`, `recordedReads`, `withRecordedReads`, `clearRecordedReads`, `speakerImpedance`, `speakerImpedanceMagnitude`, `speakerOnePort`, `clockTimingNodes`, `deriveBbdDelayFromNetlist`, `findClockDriverDevice`, plus the accompanying types (`PerSample`, `BistableLatch`, `NetGraph`, `FirmwareClass`, and the violation types).

`./fixtures` (248 exports: synthetic circuits, hand-computed expectations, and their registries): `resistorDivider`, `rcLowPass`, `diodeClipper`, `invertingAmplifier`, `potDivider`, `commonEmitterAmplifier`, `emitterFollower`, `triodeGainStage`, `unknownChip`, `dividerGain`, `potGainAt`, `fixtureRegistry`, and the rest. These are the only circuits whose answers are known independently of the instruments, which is what makes them shippable.
