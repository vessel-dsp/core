# Changelog

## 0.6.28

- Add a **required** `role` field to `Terminal`, with an optional `index`. A terminal's name is
  the pin's identity in the `nodes` ledger and must be unique within its component, so it cannot
  also carry the electrode - a dual rectifier has two plates and can only name one of them
  `plate`. The role is now its own typed field, and the name goes back to being whatever the
  source printed.
- This supersedes 0.6.27's approach, which inferred the role from the name against a canonical
  vocabulary. That was the wrong layer: it made the name normative and left every consumer
  parsing text. 0.6.27's `classifyDeviceTerminalRole` remains, now as the **migration reader** -
  it is what writes a `role` into the 26,016 terminals written before the field existed.
- `TERMINAL_ROLES_BY_KIND` declares which roles each of the 32 component kinds may carry, and
  `isLegalTerminalRole(kind, role)` checks one. `screen` is legal on a pentode and not a triode;
  `wiper` on a potentiometer and not a diode.
- Two values exist so that a required field is satisfiable on every kind, and neither is a
  loophole. **`pin`** is an opaque part's numbered pin - pin 7 of an unknown IC has no electrode
  meaning, and 2,648 `ic` terminals across 1,566 spellings are exactly this. **`end`** is one of
  two interchangeable ends, so `end` twice on a resistor is correct rather than under-specified.
  A role may repeat within a component; a name may not.
- `collectTerminalRoleWarnings()` reports two distinct things: `terminal-role-missing` for a
  terminal that declares none, and `terminal-role-illegal` for a role its kind cannot carry. The
  missing case is a **warning, not a refusal**, because refusing would reject every document
  written before this release; the warning count is the backfill's remaining work. The illegal
  case is always the document's error.
- `transformer` and `switch` take deliberately coarse roles (`winding`/`windingTap`/`shield`,
  `common`/`throw`/`coil`). A transformer terminal's role is that it is a winding end; *which*
  winding it belongs to is membership, which a flat role cannot express and which those packets'
  107 spellings currently carry inside names. That needs a winding construct.
- Parser and serializer round-trip `role` and `index`, and emit them only when declared, so a
  document written before this release serializes back unchanged.

## 0.6.27

- Add a canonical terminal-role vocabulary for the active devices whose electrodes are
  asymmetric: `triode`, `pentode`, `tube-diode`, `bjt`, `jfet`, `mosfet`. Exchange a BJT's base
  and collector, or a triode's plate and cathode, and the circuit still solves - so the wrong
  answer is silent, and the role has to come from the document read against one declared
  vocabulary. `classifyDeviceTerminalRole(kind, terminalName)` returns `canonical`, `ambiguous`,
  `package-pin`, `unrecognized`, or `out-of-scope`.
- Keyed by `ComponentKind`, not one flat table, because the same token is different electrodes on
  different devices: `c` is a BJT collector and a tube cathode, `screen` exists on a pentode and
  not a triode, `input`/`output` name a FET's channel ends and nothing on a tube.
- **No alias table, deliberately.** A spelling outside the vocabulary is reported as
  `unrecognized` rather than translated, so it becomes a document to correct instead of an
  accommodation the vocabulary carries forever. Measured against a 142-document, 26,016-terminal
  corpus, the whole cost of that stance is 10 declarations across 3 spellings (`input`/`control`/
  `output` on two FETs, `body` on one MOSFET, `cathode_filament` on three rectifiers).
- Electrodes that legitimately repeat carry an index instead: `plate_a`/`plate_b` resolve to one
  `plate` role with `index`. This is forced by the format rather than a spelling preference - a
  terminal name is the pin's identity in the `nodes` ledger, so a dual rectifier cannot name both
  plates `plate`.
- Under-specified tokens resolve to no role, following the potentiometer vocabulary's rule: there
  is nothing to correct in `a`, it simply does not say which electrode it is. A bare `filament`
  is in the same class, being indistinguishable from a heater tap.
- A bare pin number (`pin7`, `terminal4`) reports as `package-pin` rather than `unrecognized`: it
  names where a wire lands, not what the electrode does, and a consumer holding the package pinout
  can still use it.
- Coverage over the same corpus: 2,204 of 2,251 terminals on covered kinds resolve canonically
  (97.9%), with `triode` and `pentode` at 100%. Of the 39 that do not, 29 are three components
  that are not the device they declare - two multi-device shells holding four transistors and
  five diodes between them, and a unijunction transistor declared `kind: bjt`.

## 0.6.26

- Merge inline terminal `node` keys and the `nodes` ledger into one declared
  connectivity interpretation during `.vdsp` parsing. Declaring any inline
  terminal node previously made the parser ignore every `members` list in the
  ledger, so a packet that split its declarations across both styles silently
  lost the ledger-only pins - including, in the reported case, leaving the
  ground node with no members at all and no warning.
- Agreement between the two styles is treated as redundant rather than
  ambiguous, which is what lets a serialized document (core writes both an
  inline `node` per terminal and a `nodes` ledger) round-trip unchanged.
  Disagreement about the same pin is refused with the existing
  `already belongs to node` error.
- The ledger is now validated on every document that has one, so a `members`
  entry naming an unknown component or terminal, or a duplicate node id, is
  reported instead of skipped whenever inline terminal nodes are also present.
- Accept declared `connectivity` and `nodeRoles` in
  `serializeInterchangeYaml()` and `serializeVdspCircuitDocument()`. Both wrote
  connectivity resolved from terminal geometry, so a parse/serialize round trip
  renumbered author-declared node ids and rewrote every node role to `ground`
  or `signal`, discarding tokens such as `supply`. Passing the values back from
  `parseInterchangeYamlWithTopology()` now preserves both; omitting them keeps
  the previous geometric behaviour.
- Add `INTERCHANGE_CONTRACT_VERSION` so consumers can gate adoption on parse
  behaviour instead of a package version range.
- Add a canonical potentiometer terminal-role vocabulary:
  `classifyPotentiometerTerminalRole()`, `resolvePotentiometerTerminalRoles()`
  and `resolveDocumentPotentiometerTerminalRoles()`. A pot's ends are only
  meaningful as a rotational pair, and rotation cannot be recovered from a
  schematic - terminal positions say which end is drawn where, not which way the
  shaft turns - so a consumer inferring it from topology produces controls that
  sweep backwards on some documents, silently.
- Lug numbers and spelling variants (`1`/`2`/`3`, `lug 2`, `Pin_3`,
  `counter-clockwise`, `slider`) normalize to `ccw`/`wiper`/`cw` with no
  diagnostic; the resolved role is keyed by the raw token, so nothing is
  rewritten. Tokens that name an end without its rotation (`a`, `b`, `left`)
  resolve to no role at all: `complete` stays false and a
  `potentiometer-terminal-role-ambiguous` diagnostic says the source does not
  carry the semantics, rather than a guess being supplied.
- `.vdsp` intake reports those diagnostics as parser warnings. No corpus
  document gains one: all 65 potentiometers surveyed either use lug numbers
  (the 2 in `.vdsp`) or arrive from `.schx` with core's own catalog names
  (the other 63), and warning an author about a token core invented would be
  noise.
- Parse `.schx` device-model parameters into structured quantities instead of
  leaving them as text: the tube set (`Kg`, `Rgk`, `Vg`, `Gamma`, `Ig0`, the
  interelectrode capacitances, and `Kg1`/`Kg2` on a pentode), op-amp `Rin`,
  `Rout`, `Aol` and `GBP`, the uppercase bipolar spellings `IS`/`BF`/`BR`/`n`
  that only the long `BipolarJunctionTransistor` shortType listed, and `Wipe`
  on a variable resistor. 137 values across the corpus that consumers had to
  re-parse. A discrete selector `Position` stays a string - it is state, not a
  device parameter.
- Extract the duplicated `normalizeToken()` into `model/tokens.ts`. It was
  byte-identical in `model/validation.ts` and `panel/extract.ts`, and a second
  copy is how two vocabularies drift apart.

## 0.6.25

- Validate `sourceTypeName` against an explicit vocabulary during `.vdsp`
  parsing. The field was typed `string | null` and parsed straight through, so
  any spelling was accepted silently; every consumer matches it exactly, which
  made each unrecognised spelling a component that quietly failed to resolve.
- Emit the first parser-generated warnings for it: `source-type-name-alias`
  names the canonical spelling for a known variant, and
  `source-type-name-not-a-device-class` covers values that record what a
  consumer does with a component rather than what the component is.
  `source-type-name-unsupported` covers everything else.
- Values are reported, never rewritten. Documents keep parsing, and the
  recorded spelling is preserved verbatim.

## 0.6.24

- Extend canonical `.vdsp` source/runtime boundary warnings to the legacy
  runtime marker cleanup set: `SourceOnly`, `InterfaceOnly`,
  `SourceBoundaryNote`, `FirmwareStatus`, `FirmwareExternalStop`, and
  `BehaviorRole`.
- Wire `validateVdspCircuitDocumentSchema()` to return those warnings during
  canonical `.vdsp` intake while keeping legacy parsing tolerant for inspection
  and migration.

## 0.6.23

- Add opt-in canonical `.vdsp` source/runtime boundary validation through
  `validateSourceRuntimeBoundary()` and `createSourceRuntimeBoundaryRule()`.
  The rule reports runtime, admission, and proxy metadata such as
  `RuntimeMatchKey`, `RuntimeDescriptor`, `DescriptorType`, stored compiler or
  admission metadata, and nested `BehaviorRole.firmwareRef.behaviorOwner` while
  keeping legacy parsing tolerant.
- Stop treating `RuntimeMatchKey` as required source firmware metadata.
  Firmware source evidence validation now checks `FirmwareRequired`,
  `FirmwareId`, and chip identity without encouraging runtime selector fields
  in canonical `.vdsp`.

## 0.6.22

- Warn when `InterfaceOnly` is used on a wired active-device kind (diode, LED,
  transistor, op-amp, tube, IC, and similar `model`-identity kinds) with two or
  more declared terminals. `InterfaceOnly` is for components with no real
  electrical branch (an unpopulated/DNP position or a panel/UI reference stub),
  not a waiver for a real device whose exact part is unconfirmed. New code:
  `interface-only-active-device`.
- Report legacy `Support: "view-only"` as a schema problem instead of treating
  it as a current interface-only marker. The property is legacy vocabulary from
  the pre-runtime-agnostic schema; playable/support status is derived downstream
  by the host runtime/compiler. New code:
  `schema-invalid-legacy-support-view-only`.

## 0.6.21

- Enforce single-owner supply rails in `@vessel-dsp/core`: a modeled voltage may
  have only one owner (a mains PSU/transformer, a battery/DC-adapter boundary, or
  a converter/regulator/divider output), so a `kind: rail` that asserts an ideal
  source on top of an already-owned voltage is a `power-rail-fixed-owner-conflict`
  validation error. The rule is power-model driven and connectivity-independent:
  it never reads wires, node identity, or component voltage properties, so the
  verdict is identical for `wires: []` and a fully connected drawing.
- Add the optional `CircuitPowerDomain.sourceKind` (`mains-ac` | `external-dc`)
  field and export the `CircuitPowerSourceKind` type. The interchange parser
  normalizes the provisional `powerSourceKind` alias into it and rejects
  conflicting values. New codes: `power-domain-source-kind-conflict`,
  `power-domain-source-kind-unresolved`, `power-domain-source-owner-unresolved`,
  and `power-rail-fixed-owner-conflict`.

## 0.6.20

- Add opt-in, topology-aware audio trace warnings for destructive capacitor
  shunts, extreme direct input loading, and declared op-amp buffers with open
  passive feedback paths. Ambiguous roles and incomplete boundary connectivity
  produce abstention warnings rather than circuit claims.
- Add `.vdsp` parsing that preserves source-declared node membership and roles
  for advisory validation, with geometric connectivity as an explicit fallback.

## 0.6.19

- Add advisory trace plausibility checks to `@vessel-dsp/core`, including
  coverage-gated structural checks plus opt-in preferred-value and RC-corner
  heuristics for source transcription review.
- Export trace plausibility APIs and validation issue codes for downstream
  conversion/audit tooling.

## 0.6.18

- Add phase-one display hardware metadata to `@vessel-dsp/core`: `display`
  component, panel, and device-interface kinds; typed `Panel.displays`
  descriptors; `.vdsp` parse/serialize round-trip support; validation for
  display kind, bus, grid dimensions, driver component links, and default text.
- Preserve display modules as visible panel metadata only. This release does
  not add display runtime values, framebuffer/matrix protocol, or runtime-driven
  display updates.
- Preserve source display panel metadata in `@vessel-dsp/stompbox` when panels
  are rebuilt from runtime descriptor controls.

## 0.6.17

- Extend `BehaviorRole.firmwareRef` in `@vessel-dsp/core` with richer firmware
  evidence metadata, including status, artifact/source visibility, behavior
  ownership, and optional component linkage fields while keeping the component
  role as the canonical firmware owner.
- Validate authored `firmwareRef` entries fail-closed for invalid shape,
  invalid status/enum values, unresolved component links, and
  recovered-ownership claims that are not backed by recovered or verified
  status.

## 0.6.16

- Release metadata only. This release did not include the intended
  `BehaviorRole.firmwareRef` schema and validation implementation; use 0.6.17
  or later for that support.

## 0.6.15

- Add typed source-visible cabinet, speaker-driver, microphone-transducer, and
  simulation profile schemas to `@vessel-dsp/core` without introducing runtime
  simulator admission rules.
- Add `simulationProfiles` to `.vdsp` v3 documents with parse/serialize
  round-trip preservation, namespaced extension preservation, and explicit
  conversion-loss diagnostics when exporting to non-VDSP formats.
- Validate profile catalog integrity, including duplicate IDs, dangling
  cabinet driver and simulation target references, malformed simulation units,
  and invalid non-positive physical quantities while allowing incomplete
  measured/profile seed records.

## 0.6.14

- Add a `power-converter` `ComponentKind` for source-visible converter ICs
  (charge pumps, regulators, etc.), with a required `ConverterKind` property
  (must-have value: `charge-pump`). Lets `CircuitDocument.power` rail
  derivations anchor charge-pump-derived rails (for example a Klon-style
  `+V2`/`V-` pair) to a real component instead of overclaiming topology from
  voltage labels alone.
- Add optional `nominalVoltage` on `CircuitPowerRailBinding` so a derived rail
  can carry its own voltage separate from the domain's `ratedVoltage`.
- Validate converter identity: `doubler`/`inverter` derivations require
  `converterComponentId`; `converterComponentId` must resolve to a
  `power-converter` component; `main-supply`/`regulated-output`/
  `charge-pump-output` roles reject electrically contradictory derivations;
  the same converter cannot claim the same rail role twice. Warn (don't fail)
  on a converter with no `PartNumber` or a charge-pump-derived rail with no
  `nominalVoltage`.
- Does not model MAX1044/ICL7660 switching transients, sag, ripple, or a sag
  knob — converter identity is structural metadata only.

## 0.6.13

- Reject duplicate YAML mapping keys instead of silently letting the later
  occurrence win. Enforced at every object nesting level (a duplicate
  top-level `power:` or `rawAttributes:` block, or a duplicate key inside
  `power.domains[0]`, and so on), since validation after parsing cannot tell
  that a key was overwritten during parse.
- `validateVdspCircuitDocumentSchema` reports duplicate keys with
  `code: "duplicate-key"` and `path` set to the offending key.

## 0.6.12

- Add a typed `circuit-power/v1` power-topology block (`CircuitPower`,
  `CircuitPowerDomain`, `CircuitPowerRailBinding`) to `circuit-interchange/v3`,
  describing supply domains, ground polarity, and rail role/derivation without
  introducing a new document schema version.
- Validate power topology: unresolved source, rail, parent-rail, and
  converter component references; duplicate domain ids; duplicate rail
  ownership across domains; `parentRailComponentId` cycles; and
  `coverage`/`domains` consistency.

## 0.6.11

- Add enum-backed semantic `ControlRole` validation for source component
  properties and `controlInterfaces[].controlRole`, with source-only warnings
  and playback-claimed errors.
- Export canonical control role constants and validation rule-pack hooks so
  hosts can layer lowering-specific diagnostics without embedding runtime
  policy in core.

## 0.6.10

- Preserve firmware-bound microcomputer runtime metadata such as `ChipClass`,
  `FirmwareId`, `FirmwareRequired`, and `RuntimeMatchKey` through `.vdsp`
  parse/serialize round trips so hosts can distinguish chip-only identities
  from chip-plus-firmware descriptors.
- Warn when firmware-required IC metadata is incomplete, including missing
  `FirmwareId`, missing `RuntimeMatchKey`, incomplete runtime match tokens, or
  missing chip identity.

## 0.6.9

- Bump all publishable packages and internal workspace dependency pins for the
  `.vdsp` appearance schema release.
- Keep release metadata, docs, and built package artifacts aligned with the
  `0.6.9` package version.

## 0.6.8

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
