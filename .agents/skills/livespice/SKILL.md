---
name: livespice
description: Work on LiveSPICE .schx schematic support in any codebase. Use this whenever importing, parsing, serializing, validating, testing, rendering, documenting, or auditing LiveSPICE schematics; _Type component catalogs; terminal geometry; wire/junction connectivity; round-trip fidelity; or audio pedal and amp fixture coverage.
---

# LiveSPICE

Use this skill when a task touches LiveSPICE `.schx` schematics.

LiveSPICE `.schx` files are XML schematic documents for audio-oriented circuit simulation. Treat them as a graphical source format with layout, component metadata, terminals, and wires. Do not treat `.schx` as a SPICE `.cir`/`.net` text netlist, and do not claim simulator accuracy from importer support alone.

Assume this skill is installed inside a project that already has LiveSPICE support or `.schx` files. Work from that project's existing parser, serializer, fixtures, tests, and conventions. Use search only to find the local names and nearby tests, not to decide whether LiveSPICE exists.

This skill is intentionally project-portable. It includes bundled `.schx` examples under `examples/` so the workflow does not depend on fixtures from the repository where the skill was authored.

When editing code, add or update the smallest fixture/test that exposes the behavior before changing mapping or conversion logic. Keep source fidelity ahead of normalization, especially for data the current model cannot honestly interpret.

## File Shape

A typical `.schx` file has:

- a root `<Schematic>` element with attributes such as `Name`, `Description`, and `PartNumber`;
- symbol elements: `<Element Type="Circuit.Symbol, ...">` with `Rotation`, `Flip`, and `Position`;
- a nested `<Component>` with a `_Type` such as `Circuit.Resistor, Circuit, ...` and component-specific attributes;
- wire elements: `<Element Type="Circuit.Wire, ...">` with endpoints `A="x,y"` and `B="x,y"`;
- UTF-8 text and unit strings, often including source-specific unit spellings.

Preserve unknown root, element, component, and wire attributes. Assembly-qualified `Type` and `_Type` strings are source identity, not noise.

## Bundled Examples

Use these bundled examples when you need a compact fixture, reproduction case, or parser/serializer sanity check. They are deliberately small enough to copy into a target project's fixture directory.

- `examples/passive-lowpass-rc.schx`: copied from upstream `dsharlet/LiveSPICE` `Tests/Examples/Passive 1stOrder Lowpass RC.schx`. Use it for baseline parsing, Unicode unit values, basic wire topology, and round-trip checks.
- `examples/t-junction.schx`: custom compact fixture where a wire endpoint lands on another wire body. Use it for junction splitting and connectivity behavior.
- `examples/unknown-component.schx`: custom compact fixture with an unsupported `_Type` plus extra source-only attributes. Use it for diagnostics and source-fidelity behavior.
- `examples/README.md`: attribution and notes for bundled fixtures.

Good first assertions for `passive-lowpass-rc.schx`:

- parses five symbols and ten wires;
- preserves each symbol `Position`, `Rotation`, and `Flip`;
- recognizes `Input`, `Resistor`, `Capacitor`, `Ground`, and `Speaker` `_Type` names;
- preserves raw value strings even if normalized numeric values are also produced;
- round-trips without dropping unknown attributes or changing element order unless the project explicitly defines canonical ordering.

Good first assertions for `t-junction.schx`:

- preserves the horizontal wire and the vertical branch;
- reports one electrical junction where the vertical endpoint touches the horizontal wire body;
- keeps enough source metadata to serialize or audit the pre-split wire topology.

Good first assertions for `unknown-component.schx`:

- keeps the component visible as unsupported/view-only;
- emits a diagnostic for `Circuit.DoesNotExist`;
- preserves `SourceOnlyAttribute`, `MysteryValue`, and `SourceWireAttribute`.

## Validation Script

Use `scripts/validate_schx.py` for a quick source-shape check before adding fixtures to a project or when auditing a corpus. The script uses only the Python standard library so it stays portable with the skill.

```bash
python3 /path/to/livespice/scripts/validate_schx.py /path/to/file-or-directory
python3 /path/to/livespice/scripts/validate_schx.py --source-root /path/to/LiveSPICE /path/to/file-or-directory
python3 /path/to/livespice/scripts/validate_schx.py --json /path/to/file-or-directory
python3 /path/to/livespice/scripts/validate_schx.py --source-root /path/to/LiveSPICE --strict-known-types --strict-properties /path/to/file-or-directory
```

The validator is the portable Python port of selected LiveSPICE source-shape checks that matter for fixture validation. It checks XML well-formedness, `<Schematic>` root shape, LiveSPICE `Element` dispatch, symbol and wire element structure, integer coordinate fields, rotation/flip fields, component `_Type`, and LiveSPICE serialized component attributes. With `--source-root`, it derives component class names and `[Serialize]` property names from the upstream C# source. Without `--source-root`, it uses an embedded fallback catalog so the skill stays copy/paste portable.

Unknown component types and non-serialized component attributes are warnings by default because importers should preserve unsupported/view-only elements. Use `--strict-known-types` when auditing catalog coverage and `--strict-properties` when checking whether fixture attributes match LiveSPICE's serialized properties. Zero-length wires are warnings because upstream LiveSPICE deserializes them as warning symbols rather than normal wires.

This validator is source-derived and validation-only, not a full port of the LiveSPICE runtime. It does not execute C# reflection, component constructors, `TypeConverter` parsing, terminal layout, node rebuilding, duplicate-name checks, `Schematic.Build()`, or simulation behavior.

## Upstream Reference Points

Use the upstream `dsharlet/LiveSPICE` repository as the compatibility reference:

- Repository: `https://github.com/dsharlet/LiveSPICE`
- Examples: `https://github.com/dsharlet/LiveSPICE/tree/master/Tests/Examples`
- Smaller circuits: `https://github.com/dsharlet/LiveSPICE/tree/master/Tests/Circuits`
- Components: `https://github.com/dsharlet/LiveSPICE/tree/master/Circuit/Components`

Reference surfaces:

- `Tests/Examples/*.schx` contains real audio examples such as Big Muff Pi, Pro Co Rat, Tube Screamer, Boss SD-1, MXR Distortion+, MXR Phase 90, Cry Baby, Fender 5e3, Bassman, JCM800, and Rockerverb.
- `Tests/Circuits/*.schx` contains smaller circuit fixtures for filters, rectifiers, switches, transformers, op-amps, JFETs, subcircuits, and edge cases.
- `Circuit/Components/*.cs` and `Circuit/Components/*.xml` are useful when auditing component class names and model-library identity.
- The installer includes `Circuit/Components/*.xml` and `Tests/Examples/*.schx`, which makes those examples a practical compatibility corpus.

When copying upstream fixtures into a project, keep an attribution notice for the MIT-licensed upstream repository and verify the current upstream file list before claiming coverage.

## Parsing Rules

- Parse XML with a real XML parser, not regular expressions.
- Strip the assembly qualification only for matching the component class name; keep the original `Type` and `_Type` strings in source metadata.
- Treat `Position`, `A`, and `B` as coordinate pairs. Preserve raw strings if parsing fails.
- Treat `Rotation` and `Flip` as source transform metadata. Validate the known values, but preserve unknown values.
- Preserve `Name`, `Description`, `PartNumber`, labels, subtexts, model identities, and raw component values.
- Unknown `_Type` values should stay visible as unsupported/view-only elements and should produce a diagnostic. Do not silently drop them.
- Recognized-but-not-modeled components may still be unsupported if the local normalized model has no honest semantic representation yet.
- Do not synthesize electrical semantics from a drawing alone. Prefer explicit unsupported diagnostics over false support.

## Component Mapping

LiveSPICE component class names appear in `.schx` as `_Type` values, usually with an assembly-qualified prefix like `Circuit.Resistor, Circuit, Version=...`.

Common mappings to look for:

- Passives: `Resistor`, `Capacitor`, `Inductor`, `Conductor`
- I/O and references: `Input`, `Speaker`, `Ground`, `Rail`, `VoltageSource`, `CurrentSource`, `NamedWire`, `Port`, `Label`
- Controls: `Potentiometer`, `VariableResistor`, `Switch`, `SPDT`, `SP3T`, `SP4T`
- Semiconductors: `Diode`, `BipolarJunctionTransistor`, `JunctionFieldEffectTransistor`
- ICs and helpers: `OpAmp`, `IdealOpAmp`, `Buffer`, `DelayBuffer`
- Magnetics and tubes: `Transformer`, `CenterTapTransformer`, `Triode`, `Pentode`, tube `Diode`
- Definitions and diagnostics: `VoltageDefinition`, current definitions, warning/error placeholders

For each new mapping, prove:

- source `_Type` and local semantic kind;
- source and normalized properties;
- terminal count and terminal names;
- terminal coordinates after rotation/flip;
- behavior for unknown or malformed property values;
- serializer output, if export is supported.

## Connectivity And Geometry

LiveSPICE schematics are coordinate-based. Wires and terminals connect by geometry, so parser and renderer decisions must be test-driven.

- Derive terminal geometry from source behavior, upstream component code, or fixtures. Do not infer terminal locations from a pretty preview symbol.
- Test with named pin assertions or graph connectivity assertions. Visual overlap is not enough.
- Preserve T-junctions where a wire endpoint lands on another wire body.
- If the local model splits wires at junctions, keep enough source metadata to serialize or audit the original topology.
- Keep labels and named wires as explicit connectivity data only when the source semantics prove they connect nets.

## Round-Trip Policy

Round-trip tests should check material topology rather than byte-for-byte XML unless the project explicitly promises stable formatting.

Check at least:

- component count and wire count;
- recognized kind or unsupported kind;
- source name/id behavior;
- origin/position, rotation, and flip;
- terminal count and selected pin names;
- selected component values and raw source values;
- diagnostics for unsupported, lossy, or synthesized data.

Do not serialize unrelated formats through the `.schx` path. If a project supports LTspice, SPICE netlists, Circuit JSON, or another normalized format, conversions should pass through the project's documented normalized model and target-specific serializer.

## Audio Circuit Gap Checks

Use pedal and amp knowledge to catch importer gaps:

- Pro Co Rat: LM308 identity, hard clipping diodes, tone/filter network, JFET buffer, volume control, and I/O.
- Tube Screamer / Boss SD-1: feedback-loop clipping vs output shunt clipping, 4558-style op-amp identity, tone/drive/level controls.
- Big Muff: cascaded transistor stages, clipping diode pairs, passive tone stack, sustain/volume controls.
- MXR Distortion+: op-amp hard clipper topology and gain/level controls.
- Cry Baby / Phase 90: inductors, JFETs, switching/control metadata, and view-only handling where needed.
- Amp examples: Bassman, JCM800, Rockerverb, Fender 5e3, transformers, tubes, pentodes, tone stacks, and multi-stage preamps.

Importer support means the schematic can be represented faithfully enough for the project's goals. It is not proof that the local project simulates the audio circuit like LiveSPICE.

## Verification

Use the smallest checks available in the current project:

```bash
# Validate .schx source shape first when adding or auditing fixtures.
python3 /path/to/livespice/scripts/validate_schx.py /path/to/schx-fixtures
python3 /path/to/livespice/scripts/validate_schx.py --source-root /path/to/LiveSPICE --strict-properties /path/to/schx-fixtures

# Find candidate tests first.
rg --files | rg -i "(schx|livespice).*test|test.*(schx|livespice)"

# Then run the focused parser/serializer/round-trip/connectivity tests with
# the project's normal test runner.
```

For a new parser or mapping, create tests that fail before the implementation and pass afterward:

- parser fixture test for recognized components and preserved metadata;
- unsupported `_Type` fixture test with a diagnostic;
- connectivity test for terminal-to-wire and T-junction behavior;
- serializer or round-trip test if export is in scope.

After significant changes, run the project's typecheck/build/static checks if they exist.
