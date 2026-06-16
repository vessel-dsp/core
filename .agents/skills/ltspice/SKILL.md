---
name: ltspice
description: Work on LTspice .asc schematic support in any codebase. Use this whenever importing, parsing, serializing, validating, testing, rendering, documenting, or auditing LTspice ASC schematics; SYMBOL/SYMATTR catalogs; .asy symbol-library coverage; WIRE/FLAG/IOPIN/TEXT handling; terminal geometry; round-trip fidelity; or audio pedal fixture gaps.
---

# LTspice

Use this skill when a task touches LTspice `.asc` schematics.

LTspice `.asc` files are line-oriented schematic source documents. Treat them as graphical source files with symbol placements, attributes, wires, flags, I/O pins, directives, and labels. Do not treat `.asc` as a SPICE `.cir`/`.net` text netlist, and do not claim simulation accuracy from importer support alone.

Assume this skill is installed inside a project that already has LTspice support or `.asc` files. Work from that project's parser, serializer, fixtures, tests, and conventions. Use search to find local names and nearby tests, not to decide whether LTspice exists.

This skill is intentionally project-portable. It includes bundled `.asc` examples under `examples/` and a standard-library validation script under `scripts/`, so the workflow does not depend on fixtures from the repository where the skill was authored.

When editing code, add or update the smallest fixture/test that exposes the behavior before changing mapping or conversion logic. Keep source fidelity ahead of normalization, especially for data the current model cannot honestly interpret.

## File Shape

A typical `.asc` file has:

- `Version <n>` as the first non-empty line;
- `SHEET <sheet> <width> <height>`;
- `WIRE x1 y1 x2 y2` segments in LTspice grid coordinates;
- `FLAG x y name` for ground (`0`), net labels, or I/O endpoints;
- `IOPIN x y In|Out|BiDir` paired with a `FLAG` at the same point;
- `SYMBOL <symbol-path> x y R0|R90|R180|R270|M0|M90|M180|M270`;
- `SYMATTR <key> <value>` lines attached to the preceding `SYMBOL`;
- `TEXT x y alignment size !directive` for SPICE directives;
- `TEXT x y alignment size ;label` or plain text for schematic labels/comments.

Preserve unknown commands, source symbol paths, `SYMATTR` values, directives, labels, flags, and raw coordinate/orientation strings where possible. Strip symbol paths only for catalog lookup; keep the original source name in source metadata.

## Bundled Examples

Use these bundled examples when you need a compact fixture, reproduction case, or parser/serializer sanity check. They are deliberately small enough to copy into a target project's fixture directory.

- `examples/simple-rc.asc`: baseline RC low-pass schematic with symbols, wires, flags, I/O pins, directive text, and label text.
- `examples/t-junction.asc`: wire-topology fixture where a wire endpoint lands on another wire body.
- `examples/unknown-symbol.asc`: unsupported vendor-style symbol with source-only attributes.
- `examples/opamp-path.asc`: `Opamps/<model>` symbol path fixture for op-amp model-from-path behavior.
- `examples/README.md`: notes for bundled fixtures.

Good first assertions for `simple-rc.asc`:

- parses two symbols, four wires, three flags, two I/O pins, one directive, and one label;
- recognizes `res` and `cap` symbols;
- preserves `InstName`, `Value`, `FLAG`, `IOPIN`, and `TEXT` content;
- keeps coordinate and orientation metadata sufficient for round-trip or audit;
- resolves input, output, resistor, capacitor, and ground connectivity in the target project's graph model.

Good first assertions for `t-junction.asc`:

- preserves the horizontal wire and vertical branch;
- reports one electrical junction where the branch endpoint touches the horizontal wire body;
- keeps enough source metadata to serialize or audit the pre-split wire topology.

Good first assertions for `unknown-symbol.asc`:

- keeps the component visible as unsupported/view-only;
- emits a diagnostic for `vendor\mystery_amp`;
- preserves `InstName`, `Value`, and `VendorOnly`.

Good first assertions for `opamp-path.asc`:

- keeps the raw source symbol path;
- derives or preserves model identity as `LM308` if the project supports op-amp path fallback;
- stays view-only or terminal-less unless the project reads the matching `.asy` symbol geometry.

## Validation Script

Use `scripts/validate_asc.py` for a quick source-shape check before adding fixtures to a project or when auditing a corpus. The script uses only the Python standard library so it stays portable with the skill.

```bash
python3 /path/to/ltspice/scripts/validate_asc.py /path/to/file-or-directory
python3 /path/to/ltspice/scripts/validate_asc.py --json /path/to/file-or-directory
python3 /path/to/ltspice/scripts/validate_asc.py --source-root /path/to/project-or-ltspice-lib /path/to/file-or-directory
python3 /path/to/ltspice/scripts/validate_asc.py --catalog-ts /path/to/ltspice/catalog.ts /path/to/file-or-directory
python3 /path/to/ltspice/scripts/validate_asc.py --symbol-root /path/to/LTspice/lib/sym /path/to/file-or-directory
python3 /path/to/ltspice/scripts/validate_asc.py --strict-symbols --strict-lines /path/to/file-or-directory
```

The validator is source-derived and validation-only. It checks the `Version` header, `SHEET`, `WIRE`, `FLAG`, `IOPIN`, `SYMBOL`, `SYMATTR`, `TEXT`, integer coordinates, symbol orientations, unknown commands, duplicate `InstName` values, orphan `SYMATTR`, `IOPIN` without matching `FLAG`, and wire-body junction counts. It does not import into a circuit model, execute LTspice, or prove simulation behavior.

LTspice itself is proprietary, so source-derived validation means deriving symbol knowledge from the target project and installed symbol files:

- `--catalog-ts` scans a TypeScript parser catalog for `symbolName: '...'` entries.
- `--symbol-root` scans an LTspice `.asy` symbol directory for symbol names.
- `--source-root` discovers both `catalog.ts` files and `.asy` files under a project or library root.

Unknown symbols and unsupported commands are warnings by default because importers should preserve unsupported/view-only elements. Use `--strict-symbols` when auditing catalog coverage and `--strict-lines` when checking whether a corpus only uses recognized ASC commands.

## Reference Points

Use the target project's parser and fixture corpus as the compatibility reference. When available, also inspect an installed LTspice symbol library:

- Windows: commonly under `Documents/LTspiceXVII/lib/sym` or the LTspice installation directory.
- macOS: commonly under the LTspice application support or application bundle resources.
- Project-specific symbols: often committed as `.asy` files next to `.asc` fixtures or under `lib/sym`.

Do not claim custom `.asy` support unless the importer actually reads `.asy` files and has fixture coverage for terminal geometry.

## Parsing Rules

- Parse `.asc` as line-oriented text with a real tokenizer strategy, not a SPICE netlist parser.
- Decode UTF-8 and Windows-1252 text where the target project accepts raw LTspice files; values may contain `u`, `µ`, braces, expressions, or model strings.
- Preserve raw `SYMBOL` paths such as `Opamps\LM308`, `sym/res.asy`, and vendor folders.
- Normalize symbol names only for matching: slash/backslash-insensitive basename, optional `.asy` suffix stripped, case-insensitive.
- `SYMATTR` belongs to the preceding `SYMBOL`. Preserve unknown attributes.
- `TEXT ... !...` is a directive source. `TEXT ... ;...` is a schematic label/comment source.
- `FLAG 0` is ground in many importers; other flags may be net labels or named wires.
- `IOPIN` should be paired with a `FLAG` at the same coordinate.
- Unknown `SYMBOL` names should stay visible as unsupported/view-only elements and should produce a diagnostic. Do not silently drop them.

## Component Mapping

Common built-in symbol names to look for:

- Passives: `res`, `res2`, `cap`, `cap2`, `ind`
- Sources: `voltage`, `current`
- Diodes: `diode`, `led`, `zener`, `schottky`
- BJTs: `npn`, `pnp`
- JFETs: `njf`, `pjf`
- MOSFETs: `nmos`, `pmos`
- Op-amps: path-style names such as `Opamps\LM308` or project-specific `.asy` symbols

For each new mapping, prove:

- source `SYMBOL` path and local semantic kind;
- source and normalized properties from `SYMATTR`;
- terminal count and terminal names;
- terminal coordinates after orientation and mirroring;
- behavior for unknown or malformed property values;
- serializer output, if export is supported.

Recognized-but-not-modeled symbols may still be unsupported if the normalized model has no honest semantic representation yet. Prefer explicit view-only behavior over false support.

## Connectivity And Geometry

LTspice schematics are coordinate-based. Wires and terminals connect by geometry, so parser and renderer decisions must be test-driven.

- Derive terminal geometry from `.asy` `PIN` positions, a proven local catalog, or fixtures. Do not infer terminal locations from a pretty preview symbol.
- Test with named pin assertions or graph connectivity assertions. Visual overlap is not enough.
- Preserve T-junctions where a wire endpoint lands on another wire body.
- If the local model splits wires at junctions, keep enough source metadata to serialize or audit the original topology.
- Keep labels, flags, and I/O pins as explicit connectivity data only when the source semantics prove they connect nets.

## Round-Trip Policy

Round-trip tests should check material topology rather than byte-for-byte text unless the project explicitly promises stable formatting.

Check at least:

- symbol, wire, flag, I/O pin, text, directive, and label counts;
- recognized kind or unsupported kind;
- source symbol path and instance name behavior;
- origin, orientation, and mirror state;
- terminal count and selected pin names;
- selected `SYMATTR` values and raw source values;
- diagnostics for unsupported, lossy, or synthesized data.

Do not serialize unrelated formats through the `.asc` path. If a project supports LiveSPICE, SPICE netlists, Circuit JSON, or another normalized format, conversions should pass through the project's documented normalized model and target-specific serializer.

## Audio Circuit Gap Checks

Use pedal-domain knowledge to catch importer gaps, not to make simulator claims:

- RAT-style circuits: LM308 identity, hard clipping diodes, tone/filter network, volume control, and JFET output buffer where present.
- Tube Screamer / Boss SD-1: feedback-loop clipping vs output shunt clipping, 4558-style op-amp identity, tone/drive/level controls.
- Big Muff style circuits: cascaded BJT gain stages, clipping diode pairs, passive tone stack, sustain/volume controls.
- MXR Distortion+: op-amp hard clipper topology and gain/level controls.
- Cry Baby / Phase 90: inductors, JFETs, switching/control metadata, and view-only handling where needed.

Importer support means the schematic can be represented faithfully enough for the project's goals. It is not proof that the local project simulates the audio circuit like LTspice.

## Verification

Use the smallest checks available in the current project:

```bash
# Validate .asc source shape first when adding or auditing fixtures.
python3 /path/to/ltspice/scripts/validate_asc.py /path/to/asc-fixtures
python3 /path/to/ltspice/scripts/validate_asc.py --source-root /path/to/project --strict-symbols /path/to/asc-fixtures

# Find candidate tests first.
rg --files | rg -i "(asc|ltspice).*test|test.*(asc|ltspice)"

# Then run the focused parser/serializer/round-trip/connectivity tests with
# the project's normal test runner.
```

For a new parser or mapping, create tests that fail before the implementation and pass afterward:

- parser fixture test for recognized symbols and preserved metadata;
- unsupported `SYMBOL` fixture test with a diagnostic;
- connectivity test for terminal-to-wire, flags, I/O pins, and T-junction behavior;
- serializer or round-trip test if export is in scope.

After significant changes, run the project's typecheck/build/static checks if they exist.
