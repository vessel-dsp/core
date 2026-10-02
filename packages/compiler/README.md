# @vessel-dsp/compiler

Headless circuit compiler turning `.vdsp` / `CircuitDocument` schematic data into compiled simulation `Program` ROMs for VesselDSP. Pure TypeScript, deterministic, rate independent, headless. It depends on `@vessel-dsp/core` and `js-yaml` only.

## Install

`@vessel-dsp/compiler` 0.1.0 is not yet on npm. Until the release is published, use the package from this repository's workspace rather than an install command that will 404.

```bash
# once published:
bun add @vessel-dsp/compiler
```

## Minimal example

Compile takes `.vdsp` source text and an optional part registry. It returns a result, never a throw, for a document it cannot use.

```ts
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";

const source = readFileSync("big-muff-pi.vdsp", "utf8");
const result = compile(source, { registry: pedalPartCatalog });

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

Measured over the 121 top level packets in the artifacts corpus (read only, not committed):

- `emptyRegistry`: 74 of 121 compile.
- `pedalPartCatalog`: 119 of 121 compile. The two refusals are `boss-dd-3t.vdsp` and `boss-dd-5.vdsp`.

Use `pedalPartCatalog` for real pedal packets. Use `emptyRegistry` only to measure what works with no part knowledge, or for synthetic device class probes.

One refusal shape, for `boss-dd-3t.vdsp` with `pedalPartCatalog`:

```text
[{ "stage": "device-laws", "device": "U1",
   "reason": "integrated circuit has no model: its part number
   \"undisclosed-roland-boss-dsp\" matched no registry entry, and a declared
   class may not supply a macro for a part whose identity is unresolved" }]
```

## Result shape

`compile` returns `CompileResult`:

- `{ status: "ok", program, warnings }`. Warnings never block a program. A pedal with a dead knob is still worth hearing, but it must not be silent about it.
- `{ status: "unsupported", reasons }`. Each reason is a `CompileRefusal` with `stage` (`netlist`, `device-laws`, `partition`, `lower`, or `link`), `device` (component id or null), and a human readable `reason`. `device-laws` means a part could not be modelled; any other stage means the document itself does not support a program.

Only a `StageRefusal` becomes a result. Anything else (a compiler bug) propagates as a throw, because a bug reported as an unsupported pedal would be a wrong answer about someone's circuit.

`compileToArtifact(source, options)` runs `compile` and pairs it with `emit`: `{ result, artifact }` where `artifact` is null unless the result is ok. `decode(text)` parses an artifact back into a `Program`.

`readNetlist(source, options?)` runs the first stage only: document text to a law free `Netlist` with `inputJack`/`outputJack` overrides and `parseQuantity` for SI values (`10k` to 10000).

## The Program

A `Program` is rate independent: it carries no sample rate. The runtime supplies the rate at `prepare()`. Top level keys:

`formatVersion` (always 1), `requiredOperators`, `requiredModels`, `costPredictors`, `blocks`, `order`, `controls`, `ports`, `supplyReference`, `portReferenceVolts`, `portFullScaleVolts`, `stageCoverage`, `portImpedanceOhms`.

`requiredOperators` lists every stamp operator the executed blocks present, sorted, so a runtime can refuse by name at load. `requiredModels` lists every macro DSP model id the same way. `order` is the block execution order. `supplyReference` is `negative-ground`, `positive-ground`, `dual-rail`, or `unpowered`, derived from `dc-source` signs. `stageCoverage` is `instrument`, `preamp`, `speaker-electrical`, or `miked`.

`big-muff-pi.vdsp` with `pedalPartCatalog` compiles to 1 block (`order: ["analog:0"]`) with stamp kinds `dc-source` 1, `bjt` 4, `conductance` 22, `capacitor` 13, `controlled-conductance` 6, `diode` 4, `input-source` 1. Controls are `IN`, `OUT`, `SUSTAIN`, `TONE`, `VOLUME`, each 0..1 with default 0.5.

Each `mna` block carries `nodeIds` (row to source node map), `auxCount`, `stamps`, `stampPartition`, `sparseSchedule`, `stateCount`, `linear`, `controlFree`, `eliminate`, input/output nodes, and operating point seeds. A `macro` block carries a DSP `modelId` with parameters instead of stamps.

## Supply stamps

`resolveSupplyStamps(source, program)` joins the document power domains to the compiled `dc-source` stamps. It takes the same source text the program was compiled from and returns `{ supplies, refused }`. Only rails in an external DC domain with `derivation: direct` and `role: main-supply` are candidates; derived rails (divider, regulator, inverter, doubler, isolated) keep their compiled values.

Measured over the same 121 packets with `pedalPartCatalog`: 54 packets resolve at least one supply. Refusals by entry: `derived-rail` 60, `no-power-section` 42, `no-stamp-for-rail` 17, `mains-ac-source` 7, `unknown-source-kind` 4, plus 2 packets that do not compile at all. `big-muff-pi` resolves `VPLUS_RAIL` with role `main-supply`.

The closed refusal reasons are `no-power-section`, `mains-ac-source`, `unknown-source-kind`, `source-kind-conflict`, `derived-rail`, `rail-not-main-supply`, `no-stamp-for-rail`, `ambiguous-stamp`. Callers switch on `reason`; `detail` is prose for a human report.

## Public exports

### Compile

| Name | What it is |
| --- | --- |
| `compile` | Compile, or explain the refusal. Never throws for a document it cannot use. |
| `compileToArtifact` | `compile` plus `emit`, paired as `{ result, artifact }`. |
| `CompileOptions` | `{ registry, inputJack, outputJack }`. |
| `CompileResult` | `CompileSuccess` or `CompileFailure`. |
| `CompileSuccess` | `{ status: "ok", program, warnings }`. |
| `CompileFailure` | `{ status: "unsupported", reasons }`. |
| `CompileRefusal` | `{ stage, device, reason }`. |
| `CompilerStage` | `netlist`, `partition`, `lower`, or `link`. |
| `StageRefusal` | Stage error that becomes a result instead of a throw. |
| `LoweringError` | A device declared with a terminal count lowering cannot stamp. |
| `NetlistError` | Netlist stage refusal. |
| `PartitionError` | Partition stage refusal. |
| `LinkError` | Link stage refusal. |

### Artifacts

| Name | What it is |
| --- | --- |
| `emit` | Render a `Program` to its serializable `Artifact`. |
| `decode` | Parse an artifact back into a `Program`. |
| `Artifact` | The serializable form of a compiled program. |

### Netlist

| Name | What it is |
| --- | --- |
| `readNetlist` | First stage only: source text to a law free `Netlist`. |
| `ReadNetlistOptions` | `{ inputJack, outputJack }` overrides. |
| `Netlist` | Devices, controls, ports, and port metadata before laws attach. |
| `Device` | One lowered device with kind, identity, terminals, and parameters. |
| `DeviceId` | Component id string. |
| `DeviceKind` | What a device is electrically (resistor through power-amp, plus sources, rails, gates, BBD, compandor). |
| `DeviceIdentity` | Evidence a part is recognised by, in stage 2 order. |
| `DeviceLaw` | A lumped constitutive relation the solver can stamp. |
| `DeviceResolution` | Per device law outcome, including unsupported with reason. |
| `LawedNetlist` | Netlist plus per device resolutions. |
| `parseQuantity` | Parse a quantity to SI base units (`10k` to 10000). |
| `dcConductingKinds` | DC conducting device kinds, for asking whether a node potential is generated. |
| `deviceCountByNode` | How many devices touch each node. |
| `DeclaredWinding` | One declared coil: role, name, terminals in coil order. |
| `DeclaredWindingImpedance` | One rated coil impedance in ohms. |

### Registries

| Name | What it is |
| --- | --- |
| `emptyRegistry` | No part knowledge; measures what device class laws alone cover. |
| `pedalPartCatalog` | The catalog corpus facing scripts inject. |
| `PartRegistry` | `{ entries }` consulted by stage 2. |
| `PartEntry` | One catalog entry binding identity to a model. |
| `PartModel` | Law, sections, or macro model a part supplies. |
| `PartSection` | One section of a multi section part with its terminals. |
| `PartPinout` | Terminal order a sections model indices assume. |
| `PartIdentity` | A resolved part identity. |
| `MacroPartModel` | Macro model a registered part supplies. |
| `MacroPortRoles` | Where a macro ports sit, named by terminal role. |
| `MacroBarePinPositions` | Physical terminal positions for pin numbered documents. |
| `registryEntryFor` | Entry lookup for a device. |
| `registryModelFor` | Model lookup for a device. |
| `registryLawFor` | The law a registered part supplies for a device. |
| `terminalWithRole` | Index of the terminal whose role matches, or null. |
| `pinoutMatches` | Whether a device declares the order an entry was written against. |
| `foldPartId` | Fold case and separators (`MN-3007` is `mn3007`). |
| `foldToken` | Fold case and whitespace for typed vocabulary values. |
| `recordedReads` | What each owner consulted. |
| `withRecordedReads` | Run a function with registry reads recorded. |
| `clearRecordedReads` | Forget everything recorded so far. |

### Supply stamps

| Name | What it is |
| --- | --- |
| `resolveSupplyStamps` | Join document power domains to compiled `dc-source` stamps. |
| `SupplyAddress` | `{ blockIndex, sourceIndex }` naming one `dc-source` stamp. |
| `ResolvedSupply` | Address plus rail id, role, and nominal volts. |
| `RefusedSupply` | Unmapped rail with reason and human readable detail. |
| `SupplyResolution` | `{ supplies, refused }`. |
| `SupplyRefusalReason` | Closed union of eight refusal reasons. |

### Partition, lower, link, couple

| Name | What it is |
| --- | --- |
| `partition` | Split the lawed netlist into regions. |
| `Partitioning` | Regions plus dependencies. |
| `Region` | One coupled subgraph with its kind. |
| `RegionKind` | `linear`, `nonlinear`, or `macro`. |
| `lower` | Turn regions into MNA stamp blocks. |
| `lowerRegion` | Lower one region. |
| `link` | Order blocks and attach program metadata. |
| `couple` | Wire coupled and parameter ports after every region exists. |
| `Coupled` | Coupled seam record. |
| `blockNodeIndex` | A block row index for a source node id, or null. |

### Stamps, blocks, program

| Name | What it is |
| --- | --- |
| `Program` | The compiled ROM: operators, models, blocks, order, controls, ports, supply reference, scales, coverage. |
| `Block` | One `mna` solve block or one `macro` DSP block. |
| `Stamp` | One MNA contribution (conductance through switch families). |
| `OperatorKind` | A stamp kind a runtime must implement. |
| `StampPartition` | Compile time linear, control, constant, and dynamic partition. |
| `SparseSchedule` | Compile time static sparse elimination schedule. |
| `stampControl` | Control a stamp reads, or null. |
| `stampNeedsNewton` | Whether a stamp needs the Newton loop. |
| `stampNodes` | Every node a stamp names. |
| `stampInSourceNodes` | A stamp read back in document node ids. |
| `withStamp` | Add a stamp with linear and controlFree re-derived. |
| `Ports` | Input and output node ids. |
| `CostPredictors` | Rate independent cost facts for admission. |
| `OperatingPointSeed` | A nodeset style hint for the DC solve start. |
| `NodeId` | Electrical node number. |
| `GROUND` | Node 0. |
| `ModulationPort` | Solved node read every sample to scale a delay macro. |
| `ParameterPort` | Scalar another operator derives. |
| `MacroModel` | A region the compiler does not solve. |
| `MacroClockControl` | Clock control mapping for a macro block. |
| `SUPPLY_SOURCE_OHMS` | Default series impedance of a pedal supply in ohms (1). |
| `STATE_SLOTS_PER_REACTIVE_ELEMENT` | State slots a reactive element companion model needs. |
| `THERMAL_VOLTAGE` | Room temperature thermal voltage for the diode law. |
| `SILICON_SATURATION_CURRENT` | Default silicon saturation current. |
| `SILICON_FORWARD_BETA` | Default silicon forward beta (100). |
| `SWITCH_ON_OHMS` | Closed switch resistance. |
| `SWITCH_OFF_OHMS` | Open switch resistance. |

### Controls and tapers

| Name | What it is |
| --- | --- |
| `Control` | Compiled control with id, taper, default position, role, label. |
| `ControlId` | Control id string. |
| `TaperKind` | `linear`, `logarithmic`, `reverse-logarithmic`, or `reverse-linear`. |

### Clocks, timing, delay lines

| Name | What it is |
| --- | --- |
| `deriveBbdDelayFromNetlist` | Derive BBD delay from the clock network. |
| `derivePt2399DelayFromNetlist` | Derive PT2399 delay from the VCO resistor network. |
| `deriveM50195DelayFromNetlist` | Derive M50195P delay from the oscillator network. |
| `pt2399DelayFromOhms` | PT2399 delay formula from VCO resistance. |
| `identifyClockFamily` | Clock driver family for a device. |
| `ClockDriverFamily` | BBD clock family. |
| `clockTimingNodes` | Nodes a clock driver timing network hangs on. |
| `activeTimingDrivers` | Devices actively steering a timing network. |
| `ACTIVE_TIMING_KINDS` | Device kinds that can drive a timing node. |
| `findClockDriverDevice` | Locate the clock driver device. |
| `resolveClockModulationSource` | Node an LFO reaches a modulated BBD clock on. |
| `ClockModulationSource` | That modulation source. |
| `BbdClockDerivationOutcome` | BBD clock derivation result. |

### Device helpers

| Name | What it is |
| --- | --- |
| `attachDeviceLaws` | Stage 2: attach laws to every netlist device. |
| `declaredRegulatorTerminals` | Output and reference terminals of a regulator model. |
| `isElectricallyIsolated` | Whether every device node is private to itself. |
| `opampInputDistances` | Op-amp input network distances. |
| `quietDistances` | Quiet network distances. |
| `optocouplerBinding` | Which rung decided an optocoupler wiring. |
| `otaPackageOrderAssumed` | Whether an OTA used DIP-8 package order. |
| `potTerminals` | Potentiometer terminal roles. |
| `synthesizeOpampImplicitBias` | Add implicit DC bias where topology leaves it undefined. |
| `stageCoverage` | Amplification stage coverage read from lowered stamps. |

### Diagnostics (warnings and their finders)

| Name | What it is |
| --- | --- |
| `CompileWarning` | Union of every warning shape. |
| `findInertControls` | A pot whose wiper touches nothing is a fixed resistor. |
| `InertControlWarning` | Why a control cannot move the circuit. |
| `ControlPositionDisagreesWarning` | Panel and component disagree about a control setting. |
| `findUnboundedOpamps` | Op-amps with no DC feedback path. |
| `UnboundedOpampWarning` | Op-amp on the signal path with no DC feedback. |
| `findSupplyShorts` | Diodes forward across a supply. |
| `SupplyShortWarning` | A diode wired forward across a supply. |
| `findOverDrivenNodes` | Nodes driven by more than one ideal source. |
| `OverDrivenNodeWarning` | Over-determined node. |
| `findDanglingActiveTerminals` | Active terminals on untouched nodes. |
| `DanglingActiveTerminalWarning` | Active device terminal that cannot conduct. |
| `findGroundedClockSupplies` | Clock drivers with supply at ground. |
| `ClockDriverSupplyAtGroundWarning` | Clock driver rendering no clock at all. |
| `findUnimplementedDeviceLaws` | Devices with no law, told by name. |
| `UnimplementedDeviceLawWarning` | Device class with no law. |
| `UnimplementedControlRoleWarning` | Control role with no law: accepted, lowered, ignored. |
| `findUnreachableOutput` | Outputs reachable by nothing. |
| `OutputPortUnreachableWarning` | Program executing no blocks. |
| `OutputPortNotTransformerCoupledWarning` | Output measured before the power stage. |
| `NoOutputTransformerWarning` | Amp shaped document with no output transformer. |
| `findUnexecutedRegions` | Regions the program never executes. |
| `UnexecutedActiveRegionWarning` | Active region never executed. |
| `findIcsNotExecuted` | Declared ICs the program does not execute. |
| `IcNotExecutedWarning` | Declared but unexecuted IC. |
| `findElectricallyIsolatedIcs` | Identification devices with all private nodes. |
| `ElectricallyIsolatedIcWarning` | Isolated device given an open law. |
| `OpenIcReason` | Why a device got an open law. |
| `findPowerDomainControls` | Power hardware exposed as sweepable controls. |
| `PowerDomainControlWarning` | Power domain hardware outside the audio graph. |
| `findNonExecutableClockDrivers` | Clock drivers bypassed by the MNA solver. (finder; warning type `NonExecutableClockDriverWarning`) |
| `NonExecutableClockDriverWarning` | Clock behavior not modelled. |
| `NonExecutableSupportShellWarning` | Support shell preserved but not executed. |
| `findGenericTubeFits` | Tubes lowered with device class fits. (finder; types below) |
| `GenericTubeFitWarning` | Tube lowered without a catalog match. |
| `GenericSpeakerProfileWarning` | Speaker load with a generic driver profile. |
| `findUnverifiedPinoutBindings` | Parts wired by declaration order. (finder; type below) |
| `UnverifiedPinoutBindingWarning` | Terminals placed by order, not assertion. |
| `UnreadableTerminalRoleWarning` | Terminals wired by order after an unplaceable spelling. |
| `UnroutableThrowWarning` | Switch throw alone on its node. |
| `InterfaceOrSourceOnlyWarning` | Interface or source only component. |
| `UnconnectedBehaviorComponentWarning` | Behavior component with no connection to the audio graph. |
| `NotPopulatedWarning` | DNP position with nothing fitted. |
| `NotPopulatedWithoutValueWarning` | DNP component with no value. |
| `LedgerDivergenceWarning` | Nodes ledger and terminal refs disagree. |
| `DeclaredDelayWarning` | Delay typed into the source, not derived. |
| `ModulationNotModelledWarning` | Wired modulation input admission refused. |
| `TaperNotExecutableWarning` | Taper that renders linear. |
