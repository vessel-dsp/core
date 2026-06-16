# LTspice ASC Examples

These fixtures are intentionally small and self-contained so this skill can be copied into another project without depending on this repository's test files.

- `simple-rc.asc`: baseline LTspice RC low-pass schematic with `WIRE`, `FLAG`, `IOPIN`, `SYMBOL`, `SYMATTR`, directive text, and label text.
- `t-junction.asc`: compact wire-topology fixture where a wire endpoint lands on another wire body.
- `unknown-symbol.asc`: unsupported vendor-style symbol with source-only attributes for diagnostic and preservation tests.
- `opamp-path.asc`: `Opamps/<model>` symbol path fixture for projects that derive an op-amp model from the symbol path.

Use these as seed fixtures only. Real importer support should also be checked against the target project's own `.asc` corpus and any installed LTspice `.asy` symbol library.
