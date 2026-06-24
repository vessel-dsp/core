# @vessel-dsp/core

Headless VesselDSP circuit, device, format conversion, and layout model APIs.

This package has no React, DOM rendering, AudioContext, or AudioWorklet
dependency.

`.vdsp` parsing supports current `circuit-interchange/v3` documents, preserving
reviewed physical build metadata such as build scope,
mechanical envelopes, BOM rows, embedded part and footprint catalogs,
off-board wiring, panel drill placement, and board realizations for stripboard,
perfboard, breadboard-pattern protoboard, and fabricated PCB.

Conversions from v3 `.vdsp` to formats that cannot represent those physical
fields throw by default. Use `convertCircuitDocumentFileWithReport()` with
`lossPolicy: 'drop-with-diagnostics'` when intentional lossy export is needed.
