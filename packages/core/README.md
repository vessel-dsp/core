# @vessel-dsp/core

Headless VesselDSP circuit, device, format conversion, and layout model APIs.

This package has no React, DOM rendering, AudioContext, or AudioWorklet
dependency.

`.vdsp` is the portable CircuitDocument source for hosts that want an
inspectable schematic and a simulatable circuit. Core preserves source-visible
components, layout, controls, and metadata so downstream apps can show a
source-like schematic view while their own runtime lowers that graph into MNA,
kernel, or macro DSP execution. Source-trace ledgers, private artifact paths,
and provenance-only evidence should stay in the consuming project's packet or
catalog metadata instead of being embedded in the portable `.vdsp`.

`.vdsp` parsing supports current `circuit-interchange/v3` documents, preserving
reviewed physical build metadata such as build scope,
mechanical envelopes, BOM rows, embedded part and footprint catalogs,
off-board wiring, panel drill placement, and board realizations for stripboard,
perfboard, breadboard-pattern protoboard, and fabricated PCB.

Conversions from v3 `.vdsp` to formats that cannot represent those physical
fields throw by default. Use `convertCircuitDocumentFileWithReport()` with
`lossPolicy: 'drop-with-diagnostics'` when intentional lossy export is needed.

Core validates semantic `ControlRole` values on source component properties and
`controlInterfaces[].controlRole`. Roles are optional for source/read-only
schematics; unknown roles warn by default and become errors when callers pass
`validateDocument(document, { playbackClaim: true })`. Hosts can add
lowering-specific diagnostics with `validateDocument(document, { rules: [...] })`
without embedding runtime policy in core.

For canonical `.vdsp` intake, use `validateSourceRuntimeBoundary(document)` or
`createSourceRuntimeBoundaryRule()` to report legacy runtime/admission/proxy
selectors in component properties or top-level raw attributes, such as
`RuntimeMatchKey`, `RuntimeDescriptor`, `DescriptorType`, stored compiler
certificate/admission metadata, and nested
`BehaviorRole.firmwareRef.behaviorOwner`. The parser remains tolerant so legacy
documents can still be inspected and migrated without rewriting source files
during import.

## Advisory trace warnings

Trace plausibility checks are warnings for source review, not import gates or
proof of circuit correctness. Structural checks run by default and fail closed
when connectivity is incomplete. Role-aware audio checks are opt-in:

```ts
import {
  parseVdspCircuitDocumentWithTopology,
  validateTracePlausibility,
} from "@vessel-dsp/core";

const parsed = parseVdspCircuitDocumentWithTopology(source);
const issues = validateTracePlausibility(parsed.document, {
  connectivity: parsed.connectivity,
  nodeRoles: parsed.nodeRoles,
  includeAudioTopology: true,
});
```

The audio checks warn about destructive signal-path RC shunts, extreme direct
input loading, and explicitly declared audio buffers without a passive
negative-feedback path. They require unique audio input/output roles and
locally connected boundary nodes; unavailable coverage is reported explicitly.

## Supply-rail ownership

Every modeled supply voltage must have a single owner. A mains PSU (a referenced
`transformer`) owns the voltages it produces, a battery/DC-adapter owns a direct
DC boundary, and a converter/regulator/divider owns its produced output. A
`kind: rail` that asserts an ideal source on top of an already-owned voltage is a
`power-rail-fixed-owner-conflict` error from `validateDocument`. Declare the
boundary with the optional `CircuitPowerDomain.sourceKind`
(`mains-ac` | `external-dc`); when absent it is inferred from the domain's source
components. The check is power-model driven and connectivity-independent — it
never reads wires, node identity, or component voltage properties, so it produces
the same verdict for `wires: []` and a fully connected drawing. Represent a
produced/derived node as `kind: port` (a named net) with its `rails[]` binding
instead of a second ideal source.

## InterfaceOnly usage

`InterfaceOnly: true` marks a component with no real electrical branch — an
unpopulated/DNP position or a panel/UI reference stub with no wired terminals.
`validateDocument` warns with `interface-only-active-device` when it is used on
a wired active-device kind (diode, LED, transistor, op-amp, tube, IC, and
similar `model`-identity kinds) with two or more declared terminals; use a
generic `model`/`Type` value plus an honest source-gap disclosure instead of an
`InterfaceOnly` waiver. Legacy `Support: "view-only"` is no longer treated as an
interface-only marker; it is reported as
`schema-invalid-legacy-support-view-only`, since playable/support status is
derived downstream by the host runtime/compiler.
