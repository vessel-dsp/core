# Changelog

## 0.6.7

- Add `.vdsp` `deviceInterface.controls[].audioBinding` parsing, validation,
  serialization, and public typing so physical control labels can bind to
  differently named audio/runtime controls without host-side alias tables.

## 0.6.6

- Bump version; add `crt` and `glitch` fields to previewPresets type in docs test.

## 0.6.5

- Add core-owned amp and cabinet preview profile schemas, readonly public
  types, and migration-friendly validators that can check artifact JSON without
  importing Three.js preview packages.
- Reuse the core amp/cabinet profile validators from `@vessel-dsp/amp` and
  `@vessel-dsp/cabinet` so preview packages and artifact tooling share one
  published contract.

## Unreleased

- Add `createStompboxHardwareProfileFromVdsp()` and
  `createStompboxHardwareProfileFromDocument()` to derive generated-stub
  stompbox hardware profiles from existing `.vdsp` mechanical metadata.
- Add `.vdsp` v3 `appearance.kind` metadata so stompbox and amp visual design
  can be self-contained while remaining mutually exclusive.
- Add `createAmpProfileFromVdsp()` and `createAmpProfileFromDocument()` to
  derive generated/defaulted amp preview profiles from `.vdsp` panel controls.
- Document `.vdsp` as the portable source-visible CircuitDocument for
  schematic inspection and host-owned simulation/runtime lowering, while
  keeping provenance-only evidence outside the portable file.
- Add physical mount metadata for concentric panel controls, including `mountId`/`surface` parsing, model types, validation, and `.vdsp` round-trip coverage.
- Add stompbox concentric control support that collapses stacked dial surfaces into one drill hole while preserving per-surface preview and layout metadata.
- Add Control UI rendering for concentric knobs and panel jacks, plus docs for control semantics, physical controls, and CAD-style preview linework.
- Add `@vessel-dsp/visual-effects` for reusable Three.js toon, grain, and glitch preview effects.
- Add `@vessel-dsp/amp` and `@vessel-dsp/cabinet` for generated profile-based Three.js object graphs and GLB preview metadata.

## 0.6.4

- Add `.vdsp` control group membership records so one physical device-interface control can appear in multiple channel/context layouts without cloned control identities.
- Validate control group member references, context predicates, and duplicate member order while treating ordered memberships as the layout distinction for same-role physical controls.
- Expose resolved `extractDeviceInterface().groupMemberships` alongside one-row-per-physical-control device interface extraction.

## 0.6.3

- Fix the exported `VERSION` constant in source and built package artifacts so it matches the published package manifest.
- Add `@vessel-dsp/control-ui` as the optional React control-surface package for core `Panel` data, including default CSS, class hooks, and a theme provider.
- Add optional WebGL CRT and digital-glitch screen effects to the GitHub Pages stompbox GLB preview viewer (vendored from `gingerbeardman/webgl-crt-shader` and three.js `DigitalGlitch`, both MIT), with tunable scanlines, curvature, vignette, bloom, RGB shift, screen-space grain composited inside the CRT pass, and a randomized, motion-safe glitch schedule.

## 0.6.2

- Preserve `SourceOnly`, runtime ownership, source boundary, rail, source reference, and can-cap section metadata through schema-valid Circuit JSON source-property sidecars.
- Represent multi-section can capacitors as ordinary capacitor source components grouped with VesselDSP `source_group` metadata, and restore those groups on Circuit JSON import without treating generic groups or non-capacitors as can caps.
- Include source-only R/C parts and deterministic metadata comments in SPICE source/reference exports.

## 0.6.1

- Fix npm packaging so published tarballs build and ship `dist/` artifacts, omit `src/`, and keep all runtime export conditions pointed at compiled files.

## 0.6.0

- Add `circuit-interchange/v3` parsing and serialization for physical build metadata, including build scope, mechanical envelopes, BOM rows, part profiles, footprint catalogs, off-board wiring, physical panel placement, and board realizations.
- Add typed board realization support for stripboard, perfboard, breadboard-pattern protoboard, and fabricated PCB data with selected-build validation.
- Add explicit lossy-conversion handling for v3-only data, including `convertCircuitDocumentFileWithReport()` and `drop-with-diagnostics`.
- Export v3 model types and update package/API documentation for the v3 build-data contract.

## 0.5.0

- Pivot the repository to the single publishable `@vessel-dsp/core` package for headless `.vdsp`, `.asc`, `.schx`, and Circuit JSON conversion.
- Remove the reusable React component package, workspace-private simulation package, and repo-owned playground; GitHub Pages now publishes static core conversion API docs only.
- Add Circuit JSON import, validation, file conversion helpers, and LTspice `.asc` serialization.
- Add top-level `.vdsp` `controlGroups`, `controlContexts`, and `deviceInterface` metadata for stable semantic device controls.
- Preserve semantic controls, group/context registries, applicability predicates, bindings, and panel `interfaceControlId` joins through strict `circuit-interchange/v2` parse/serialize flows.
- Add `extractDeviceInterface()` so hosts can merge declared `.vdsp` controls with inferred panel, runtime descriptor, and external interface controls without mutating authored metadata.
- Validate semantic interface ids, group/context references, source bindings, external interface bindings, duplicate unordered roles, and panel semantic joins.
- Waive required electrical properties for interface-only/view-only controls while still validating present values.

## 0.4.0

- Move `.vdsp` / interchange documents to strict `circuit-interchange/v2`; v1 documents are rejected without migration or fallback parsing.
- Add recursive structured component property values so Source YAML can preserve runtime descriptor objects, arrays, numbers, booleans, nulls, and parsed quantities.
- Extract explicit LiveSPICE microblock descriptor metadata for tone stack, active EQ, delay, reverb, compressor, and octave descriptors without depending on legacy `Profile` strings.

## 0.3.2

- Add `JackPort.audioRole` and `JackAudioRole` for source-visible audio jack subtypes such as `guitar-input`, `bass-input`, `output-a-mono`, and `stereo-output-b`.
- Preserve and document `.vdsp` jack metadata split across broad `Role`, port-family `Interface`, explicit lower-kebab `AudioRole`, and display `JackLabel` / `Label` properties.

## 0.3.1

- Document and test the open component property-map contract, including passive `Material` metadata round-tripping and resistor material remaining preview-neutral.
- Add top-level `.vdsp` `device` and `controlOutputs` metadata for standalone non-audio control accessories such as Boss FS-5U footswitches.
- Preserve control accessory metadata through strict `.vdsp` parse/serialize flows, with schema validation for device kind and output switch mode values.

## 0.3.0

- Replace flat `.vdsp` panel placement metadata with named `panel.faces[]` surfaces containing bound `elements[]`, while keeping legacy `panel.layout` + `controls[]` input accepted and normalized.
- Emit the new `faces` / `elements` / `bind` / `kind` panel shape from the interchange serializer by default.
- Add panel validation warnings for unresolved component bindings, unresolved runtime controls, kind mismatches, and overlapping grid cells.
- Add `direct-output` as a first-class jack role and expose runtime descriptor `DirectOutputJack` metadata as `U1:direct-out` panel jack ports.
- Document the updated `.vdsp` panel placement contract and mark the implementation plan complete.

## 0.2.9

- Add top-level `.vdsp` `controlInterfaces` metadata for external trigger/reset, tempo tap, expression, and similar control inputs.
- Preserve `controlInterfaces` through strict `.vdsp` parse/serialize flows, including connector, assignment hint, polarity, description, optional visible jack component links, and runtime binding metadata.
- Export the `ControlInterface*` model types from the core API so hosts can consume external control metadata without depending on panel extraction.
- Project `controlInterfaces` into extracted `JackPort` descriptors while keeping external footswitch/control targets out of `SwitchControl` and runtime switch state.
- Document the producer contract for external control interfaces separately from layout-only stompbox panel placement, including DD-3-style `TRIGGER`/`RESET` and DD-5-style tempo-tap semantics.

## 0.2.8

- Add non-throwing `.vdsp` schema validation and include API reference docs in the published package.
- Preserve optional stompbox panel placement metadata through `.vdsp` parse and serialize flows.
- Expose runtime descriptor panel controls such as time, feedback, mix, stepped mode selectors, and tempo-tap external control inputs.
- Add source-rated Fulltone OCD revision-3 fixture coverage for dual-opamp MOSFET clipping pedal parsing.
- Add source-rated TC Electronic Dark Matter Distortion fixture coverage for MC33178 stages, LL4148 clipping, and active tone controls.

## 0.2.7

- Treat imported runtime descriptor ICs as validation-safe opaque descriptors when `RuntimeDescriptor: "true"` is present.
- Rename SPDT/SP3T/SP4T catalog terminals from BJT-style names to switch-specific common/throw terminals.
- Parse common electronics shorthand quantities such as `1k5`, `4u7F`, and `2R2`.
- Export JFETs to Circuit JSON as schema-valid depletion-mode FET source metadata with an explicit lossy-mapping warning.

## 0.2.6

- Add a headless Circuit JSON source-domain exporter for `CircuitDocument`, with fixture coverage against the official `circuit-json` schema.
- Add playground keyboard shortcuts for undo, redo, and tidy layout while preserving normal shortcut behavior in editable inspector fields.

## 0.2.5

- Preserve `.vdsp` source provenance fields such as `source.version` and `source.url` through interchange parse/serialize round trips.

## 0.2.4

- Import LiveSPICE audio-engine runtime descriptors as stable opaque IC components with runtime metadata, diagnostics, and non-stage `input`/`output` terminal geometry.
- Preserve stereo runtime fields such as `StereoOutputMode` as component metadata instead of synthesizing extra schematic jacks.

## 0.2.3

- Treat the playground Source tab as a copyable conversion view with a format dropdown that defaults to `.vdsp`, supports `.schx` and `.cir`, and removes the separate Raw source tab.
- Add stepped knob panel metadata for detented controls, including `StepLabels`, numeric detent counts, snapping helpers, and message validation that rejects between-step knob positions.
- Add slider/fader panel controls for potentiometer metadata such as `ControlStyle: "Slider"` / `"Fader"`, with normalized slider runtime state and optional range metadata for graphic EQ style controls.
- Render stepped knob and slider control state overlays in `SchematicView`.
- Remove the playground Live Panel tab and demo surface while keeping the reusable panel/control-state library APIs available to host apps.

## 0.2.1

- Make the playground Source YAML and Raw `.schx` views editable with undoable document replacement.
- Keep Live Panel synchronized with the current edited schematic and preserve tab selection when changing fixtures.
- Add LiveSPICE opaque `MicroBlock...Stage` support for grey-box pedal descriptors.

## 0.2.0

- Add `controlState` and `controlOverlay` props to `SchematicView` for live LED, knob, and switch visualization driven by the `panel` protocol.
- Document virtual-component injection for hosts whose indicators live outside the parsed schematic.
- Add a playground Live Panel demo.
