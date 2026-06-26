# VesselDSP Core

[![core npm version](https://img.shields.io/npm/v/%40vessel-dsp%2Fcore.svg)](https://www.npmjs.com/package/@vessel-dsp/core)

TypeScript tooling for converting audio-circuit documents between project
`.vdsp`, LTspice `.asc`, LiveSPICE `.schx`, and tscircuit Circuit JSON, plus an
optional React package for core `Panel` controls.

`@vessel-dsp/core` and `@vessel-dsp/stompbox` are React-free and do not include
a custom editor or realtime simulator. They do preserve the source-visible
CircuitDocument data that downstream apps need to render, edit, or simulate a
`.vdsp` as an inspectable schematic. A host runtime may lower that document into
compact MNA, reusable kernels, or macro DSP, but the `.vdsp` authoring graph
should remain the user-facing schematic and control surface. Downstream apps can
use tscircuit tooling to render or edit emitted Circuit JSON.

## Package

| Package | Status | Use it for |
| --- | --- | --- |
| `@vessel-dsp/core` | Public npm package | Parsing, validation, normalized `CircuitDocument` data, `.vdsp` / `.asc` / `.schx` serialization, and Circuit JSON import/export. |
| `@vessel-dsp/stompbox` | Public npm package | Headless stompbox drill layouts, SVG/GLB previews, physical hardware defaults, live preview state patches, and GLB state-target validation. |
| `@vessel-dsp/control-ui` | Public npm package | Optional React controls for core `Panel` data, with default CSS, class hooks, and a theme provider. |

## Install

```bash
npm install @vessel-dsp/core
npm install @vessel-dsp/control-ui react react-dom
```

## Convert Through Circuit JSON

```ts
import {
    convertCircuitDocumentFileWithReport,
    parseCircuitDocumentFile,
    serializeCircuitJsonDocument,
    convertCircuitDocumentFile,
} from '@vessel-dsp/core';

const document = parseCircuitDocumentFile(sourceText, {
    filename: 'pedal.asc',
});

const circuitJson = serializeCircuitJsonDocument(document).elements;

const vdsp = convertCircuitDocumentFile(JSON.stringify(circuitJson), {
    inputFilename: 'pedal.circuit.json',
    outputFormat: 'vdsp',
    outputFilename: 'pedal.vdsp',
});

const lossyCircuitJson = convertCircuitDocumentFileWithReport(vdsp, {
    inputFilename: 'pedal.vdsp',
    outputFormat: 'circuit-json',
    outputFilename: 'pedal.circuit.json',
    lossPolicy: 'drop-with-diagnostics',
});
```

## Supported Conversion Inputs

- Project-native `.vdsp` Source documents (`circuit-interchange/v2` and
  `circuit-interchange/v3` YAML)
- LTspice `.asc`
- LiveSPICE `.schx`
- tscircuit `.circuit.json`

`.vdsp` v3 adds reviewed physical build metadata: build scope, mechanical
enclosure data, BOM rows, embedded part profiles and board footprints,
off-board wiring, panel drill placement, and board realizations for stripboard,
perfboard, breadboard-pattern protoboard, and fabricated PCB. Conversion from
v3 `.vdsp` to formats that cannot preserve those fields errors by default; use
`convertCircuitDocumentFileWithReport()` with `lossPolicy:
'drop-with-diagnostics'` only when that loss is intentional.

`.vdsp` is also the portable source-visible circuit document for simulation
hosts. It can carry schematic layout, source component identity, reference
labels, controls, and boundary metadata so users can inspect a source-like
schematic while the host owns any realtime/kernel lowering. Provenance ledgers,
private source paths, and source-trace evidence should live beside the `.vdsp`
in the consuming project's packet or catalog metadata, not inside the portable
file.

SPICE `.cir` / `.net` parsing remains available as legacy connectivity support,
but it is not part of the new v1 bidirectional Circuit JSON contract.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run pack:dry-run
bun run build:pages
```

## License

MIT License. See [LICENSE.md](./LICENSE.md).
