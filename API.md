# API Reference

`@vessel-dsp/core` is the conversion package. It is headless and has no React,
DOM rendering, custom editor, or realtime simulation dependency.

`@vessel-dsp/stompbox` is the companion headless stompbox package. Use it for
drill layouts, SVG/GLB stompbox previews, physical hardware defaults, and live
preview state patches, including validation for LED lens and footswitch actuator
targets in user-provided GLB assets. See `packages/stompbox/README.md` for the
stompbox helper map and interactive preview examples.

## Import

```ts
import {
    parseCircuitDocumentFile,
    serializeCircuitDocumentFile,
    convertCircuitDocumentFile,
    parseCircuitJsonDocument,
    serializeCircuitJsonDocument,
    validateCircuitJsonDocument,
    serializeLtspiceAsc,
} from '@vessel-dsp/core';
```

## Core Model

The normalized in-memory value is `CircuitDocument`:

```ts
type CircuitDocument = Readonly<{
    metadata: DocumentMetadata;
    source?: DocumentSource;
    components: readonly Component[];
    wires: readonly Wire[];
    directives: readonly string[];
    warnings: readonly Warning[];
    rawAttributes: Readonly<Record<string, string>>;
}>;
```

The model also preserves optional device, panel, semantic control, control
interface, and control output metadata for `.vdsp` documents.

## File Dispatch

| Export | Purpose |
| --- | --- |
| `detectCircuitDocumentFileFormat(filename)` | Detects `.vdsp`, `.yaml`, `.schx`, `.asc`, `.cir`, `.net`, `.spice`, and `.circuit.json`. |
| `parseCircuitDocumentFile(source, { filename })` | Parses supported document files into `CircuitDocument`. |
| `serializeCircuitDocumentFile(document, { format, filename? })` | Serializes a document to `.vdsp`, `.schx`, `.asc`, `.cir`/`.net`, or `.circuit.json`. |
| `convertCircuitDocumentFile(source, options)` | Parses one supported file and serializes it to another supported output format. |

The v1 bidirectional Circuit JSON contract is `.vdsp`, `.asc`, and `.schx`
`<->` `.circuit.json`. `.cir` / `.net` remains legacy parser/export support.

## Circuit JSON

| Export | Purpose |
| --- | --- |
| `serializeCircuitJsonDocument(document)` | Emits official tscircuit Circuit JSON elements plus export warnings. |
| `parseCircuitJsonDocument(elements, options?)` | Imports supported Circuit JSON source/schematic elements into `CircuitDocument`. |
| `validateCircuitJsonDocument(elements)` | Validates every element with the official `circuit-json` schema without throwing. |
| `CircuitJson`, `AnyCircuitElement`, `AnyCircuitElementInput` | Re-exported official Circuit JSON types. |

Supported Circuit JSON import elements include `source_project_metadata`,
`source_component`, `source_port`, `source_net`, `source_trace`,
`schematic_component`, `schematic_port`, `schematic_trace`, and directive-style
`schematic_text` values prefixed with `!`.

Unsupported PCB, fabrication, BOM, and simulation-only Circuit JSON elements
are not silently converted into schematic data; import emits diagnostics for
unsupported element families where they affect `CircuitDocument`.

## Source Serializers

| Export | Purpose |
| --- | --- |
| `serializeVdspCircuitDocument(document, options?)` | Serializes strict `circuit-interchange/v2` YAML. |
| `serializeSchx(document)` | Serializes LiveSPICE `.schx`. |
| `serializeLtspiceAsc(document, options?)` | Serializes LTspice `.asc`. |
| `serializeSpiceNetlist(document)` | Serializes legacy SPICE-style netlist output. |

## Validation

Use `validateDocument(document)` for normalized document checks. Parser and
conversion diagnostics are carried on `document.warnings`, while Circuit JSON
export returns additional `warnings` next to the emitted elements.
