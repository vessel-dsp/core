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
