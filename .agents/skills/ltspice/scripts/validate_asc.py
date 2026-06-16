#!/usr/bin/env python3
"""Source-derived validation for LTspice .asc schematic files.

This is a validation-only Python checker for LTspice's line-oriented ASC shape.
It does not import into a circuit model or simulate anything. It can optionally
derive known symbol names from a project catalog source or installed LTspice
.asy symbol library; without source inputs, it uses a compact embedded catalog.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


FALLBACK_SYMBOLS = {
    "cap",
    "cap2",
    "current",
    "diode",
    "ind",
    "led",
    "njf",
    "nmos",
    "npn",
    "pjf",
    "pmos",
    "pnp",
    "res",
    "res2",
    "schottky",
    "voltage",
    "zener",
}

IGNORED_COMMANDS = {
    "ARC",
    "BUSTAP",
    "CIRCLE",
    "DATAFLAG",
    "LINE",
    "RECTANGLE",
    "WINDOW",
}

SUPPORTED_COMMANDS = {
    "VERSION",
    "SHEET",
    "WIRE",
    "FLAG",
    "IOPIN",
    "SYMBOL",
    "SYMATTR",
    "TEXT",
} | IGNORED_COMMANDS

ORIENTATION_RE = re.compile(r"^[MR](0|90|180|270)$", re.IGNORECASE)
INTEGER_RE = re.compile(r"^[+-]?\d+$")
TS_SYMBOL_RE = re.compile(r"\bsymbolName\s*:\s*['\"]([^'\"]+)['\"]")


@dataclass
class SymbolCatalog:
    sources: list[str]
    symbol_names: set[str]
    allow_opamp_paths: bool = True


@dataclass
class ValidationContext:
    catalog: SymbolCatalog
    strict_symbols: bool = False
    strict_lines: bool = False


@dataclass
class ParsedSymbol:
    line_no: int
    raw_name: str
    normalized_name: str
    attrs: dict[str, str] = field(default_factory=dict)


@dataclass
class AscReport:
    path: str
    ok: bool = True
    version: str = ""
    sheet: str = ""
    symbols: int = 0
    wires: int = 0
    flags: int = 0
    iopins: int = 0
    texts: int = 0
    directives: int = 0
    labels: int = 0
    symattrs: int = 0
    wire_body_junctions: int = 0
    unknown_symbols: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, message: str) -> None:
        self.ok = False
        self.errors.append(message)

    def warning(self, message: str) -> None:
        self.warnings.append(message)

    def issue(self, message: str, as_error: bool) -> None:
        if as_error:
            self.error(message)
        else:
            self.warning(message)


def normalize_symbol_name(raw_name: str) -> str:
    base = raw_name.replace("\\", "/").split("/")[-1]
    if base.lower().endswith(".asy"):
        base = base[:-4]
    return base.lower()


def is_opamp_path(raw_name: str) -> bool:
    normalized = raw_name.replace("\\", "/").lower()
    return normalized.startswith("opamps/") or "/opamps/" in normalized


def parse_catalog_ts(path: Path) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(errors="ignore")
    return {
        normalized
        for normalized in (normalize_symbol_name(match.group(1)) for match in TS_SYMBOL_RE.finditer(text))
        if not normalized.startswith("_")
    }


def parse_symbol_root(path: Path) -> set[str]:
    if path.is_file() and path.suffix.lower() == ".asy":
        return {normalize_symbol_name(path.stem)}
    if not path.is_dir():
        return set()
    return {normalize_symbol_name(candidate.stem) for candidate in path.rglob("*.asy")}


def discover_source_symbols(path: Path) -> tuple[set[str], list[str]]:
    symbols: set[str] = set()
    sources: list[str] = []
    if path.is_file():
        if path.suffix.lower() == ".ts":
            discovered = parse_catalog_ts(path)
            if discovered:
                symbols.update(discovered)
                sources.append(str(path))
        elif path.suffix.lower() == ".asy":
            symbols.add(normalize_symbol_name(path.stem))
            sources.append(str(path))
        return symbols, sources

    if not path.is_dir():
        return symbols, sources

    for candidate in sorted(path.rglob("catalog.ts")):
        try:
            text = candidate.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = candidate.read_text(errors="ignore")
        if "LtspiceSymbolDef" not in text and "symbolName" not in text:
            continue
        discovered = {
            normalized
            for normalized in (normalize_symbol_name(match.group(1)) for match in TS_SYMBOL_RE.finditer(text))
            if not normalized.startswith("_")
        }
        if discovered:
            symbols.update(discovered)
            sources.append(str(candidate))

    asy_symbols = parse_symbol_root(path)
    if asy_symbols:
        symbols.update(asy_symbols)
        sources.append(f"{path} (*.asy)")

    return symbols, sources


def build_catalog(
    source_roots: Iterable[Path],
    catalog_ts_paths: Iterable[Path],
    symbol_roots: Iterable[Path],
) -> SymbolCatalog:
    symbols = set(FALLBACK_SYMBOLS)
    sources = ["embedded fallback"]

    for source_root in source_roots:
        discovered, discovered_sources = discover_source_symbols(source_root)
        if discovered:
            symbols.update(discovered)
            sources.extend(discovered_sources)

    for catalog_ts in catalog_ts_paths:
        discovered = parse_catalog_ts(catalog_ts)
        if discovered:
            symbols.update(discovered)
            sources.append(str(catalog_ts))

    for symbol_root in symbol_roots:
        discovered = parse_symbol_root(symbol_root)
        if discovered:
            symbols.update(discovered)
            sources.append(f"{symbol_root} (*.asy)")

    return SymbolCatalog(sources=sources, symbol_names=symbols)


def decode_asc_bytes(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def split_tokens(line: str) -> list[str]:
    return line.strip().split()


def is_integer(raw: str | None) -> bool:
    return raw is not None and INTEGER_RE.match(raw) is not None


def parse_point(tokens: list[str], x_index: int, y_index: int) -> tuple[int, int] | None:
    x = tokens[x_index] if x_index < len(tokens) else None
    y = tokens[y_index] if y_index < len(tokens) else None
    if not is_integer(x) or not is_integer(y):
        return None
    return int(x), int(y)


def validate_symbol_name(
    raw_name: str,
    line_no: int,
    report: AscReport,
    context: ValidationContext,
) -> str:
    normalized = normalize_symbol_name(raw_name)
    known = normalized in context.catalog.symbol_names
    known = known or (context.catalog.allow_opamp_paths and is_opamp_path(raw_name))
    if not known:
        report.unknown_symbols.append(raw_name)
        report.issue(
            f"Line {line_no}: unknown LTspice symbol {raw_name!r}",
            context.strict_symbols,
        )
    return normalized


def point_on_segment(point: tuple[int, int], a: tuple[int, int], b: tuple[int, int]) -> bool:
    px, py = point
    ax, ay = a
    bx, by = b
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if cross != 0:
        return False
    return min(ax, bx) <= px <= max(ax, bx) and min(ay, by) <= py <= max(ay, by)


def count_wire_body_junctions(
    wires: list[tuple[tuple[int, int], tuple[int, int]]],
) -> int:
    junctions: set[tuple[int, int]] = set()
    for wire_index, (a, b) in enumerate(wires):
        for endpoint in (a, b):
            for other_index, (other_a, other_b) in enumerate(wires):
                if wire_index == other_index:
                    continue
                if endpoint in {other_a, other_b}:
                    continue
                if point_on_segment(endpoint, other_a, other_b):
                    junctions.add(endpoint)
    return len(junctions)


def validate_file(path: Path, context: ValidationContext) -> AscReport:
    report = AscReport(path=str(path))
    if path.suffix.lower() != ".asc":
        report.warning("file extension is not .asc")

    try:
        text = decode_asc_bytes(path.read_bytes()).replace("\r\n", "\n").replace("\r", "\n")
    except OSError as exc:
        report.error(f"file read error: {exc}")
        return report

    lines = text.split("\n")
    first_nonempty = next((line.strip() for line in lines if line.strip()), "")
    if not first_nonempty.upper().startswith("VERSION "):
        report.error("missing LTspice Version header on first non-empty line")

    current_symbol: ParsedSymbol | None = None
    parsed_symbols: list[ParsedSymbol] = []
    wires: list[tuple[tuple[int, int], tuple[int, int]]] = []
    flag_points: set[tuple[int, int]] = set()
    iopin_points: set[tuple[int, int]] = set()
    inst_names: dict[str, int] = {}

    for line_index, line in enumerate(lines):
        line_no = line_index + 1
        trimmed = line.strip()
        if not trimmed:
            continue
        tokens = split_tokens(trimmed)
        keyword = (tokens[0] if tokens else "").upper()

        if keyword not in SUPPORTED_COMMANDS:
            report.issue(
                f"Line {line_no}: unsupported LTspice command {tokens[0]!r}",
                context.strict_lines,
            )
            continue

        if keyword == "VERSION":
            if len(tokens) < 2:
                report.error(f"Line {line_no}: Version requires a version value")
            else:
                report.version = " ".join(tokens[1:])
            continue

        if keyword == "SHEET":
            if len(tokens) < 4:
                report.error(f"Line {line_no}: SHEET requires sheet number, width, and height")
            elif not all(is_integer(token) for token in tokens[1:4]):
                report.error(f"Line {line_no}: SHEET dimensions must be integers")
            else:
                report.sheet = " ".join(tokens[1:])
            continue

        if keyword == "WIRE":
            if len(tokens) < 5:
                report.error(f"Line {line_no}: WIRE requires four coordinates")
                continue
            a = parse_point(tokens, 1, 2)
            b = parse_point(tokens, 3, 4)
            if a is None or b is None:
                report.error(f"Line {line_no}: WIRE coordinates must be integers")
                continue
            report.wires += 1
            wires.append((a, b))
            if a == b:
                report.warning(f"Line {line_no}: zero-length WIRE")
            elif a[0] != b[0] and a[1] != b[1]:
                report.warning(f"Line {line_no}: diagonal WIRE may not preserve LTspice connectivity as expected")
            continue

        if keyword == "FLAG":
            if len(tokens) < 4:
                report.error(f"Line {line_no}: FLAG requires x, y, and name")
                continue
            point = parse_point(tokens, 1, 2)
            if point is None:
                report.error(f"Line {line_no}: FLAG coordinates must be integers")
                continue
            report.flags += 1
            flag_points.add(point)
            continue

        if keyword == "IOPIN":
            if len(tokens) < 4:
                report.error(f"Line {line_no}: IOPIN requires x, y, and polarity")
                continue
            point = parse_point(tokens, 1, 2)
            if point is None:
                report.error(f"Line {line_no}: IOPIN coordinates must be integers")
                continue
            report.iopins += 1
            iopin_points.add(point)
            polarity = " ".join(tokens[3:]).lower()
            if polarity not in {"in", "out", "bidir"}:
                report.warning(f"Line {line_no}: unusual IOPIN polarity {polarity!r}")
            continue

        if keyword == "SYMBOL":
            if len(tokens) < 5:
                report.error(f"Line {line_no}: SYMBOL requires name, x, y, and orientation")
                current_symbol = None
                continue
            point = parse_point(tokens, 2, 3)
            if point is None:
                report.error(f"Line {line_no}: SYMBOL coordinates must be integers")
                current_symbol = None
                continue
            orientation = tokens[4]
            if ORIENTATION_RE.match(orientation) is None:
                report.error(f"Line {line_no}: SYMBOL orientation must be R0/R90/R180/R270 or M0/M90/M180/M270")
            normalized = validate_symbol_name(tokens[1], line_no, report, context)
            report.symbols += 1
            current_symbol = ParsedSymbol(line_no=line_no, raw_name=tokens[1], normalized_name=normalized)
            parsed_symbols.append(current_symbol)
            continue

        if keyword == "SYMATTR":
            if current_symbol is None:
                report.warning(f"Line {line_no}: SYMATTR without preceding SYMBOL")
                continue
            if len(tokens) < 3:
                report.error(f"Line {line_no}: SYMATTR requires key and value")
                continue
            key = tokens[1]
            value = " ".join(tokens[2:])
            report.symattrs += 1
            current_symbol.attrs[key] = value
            if key.lower() == "instname":
                inst_names[value] = inst_names.get(value, 0) + 1
            continue

        if keyword == "TEXT":
            if len(tokens) < 6:
                report.error(f"Line {line_no}: TEXT requires x, y, alignment, size, and text")
                continue
            point = parse_point(tokens, 1, 2)
            if point is None:
                report.error(f"Line {line_no}: TEXT coordinates must be integers")
                continue
            report.texts += 1
            raw_text = " ".join(tokens[5:])
            if raw_text.startswith("!"):
                report.directives += 1
            else:
                report.labels += 1
            continue

    if not report.sheet:
        report.warning("missing SHEET line")

    for symbol in parsed_symbols:
        if not any(key.lower() == "instname" for key in symbol.attrs):
            report.warning(f"Line {symbol.line_no}: SYMBOL {symbol.raw_name!r} has no SYMATTR InstName")

    for name, count in sorted(inst_names.items()):
        if count > 1:
            report.warning(f"duplicate SYMATTR InstName {name!r} appears {count} times")

    for point in sorted(iopin_points - flag_points):
        report.warning(f"IOPIN at {point[0]},{point[1]} has no matching FLAG")

    report.wire_body_junctions = count_wire_body_junctions(wires)
    return report


def expand_paths(paths: Iterable[str]) -> list[Path]:
    expanded: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            expanded.extend(sorted(path.rglob("*.asc")))
        else:
            expanded.append(path)
    return expanded


def print_text_report(reports: list[AscReport], catalog: SymbolCatalog) -> None:
    print(
        f"catalog: {', '.join(catalog.sources)} "
        f"symbol_names={len(catalog.symbol_names)} "
        f"allow_opamp_paths={str(catalog.allow_opamp_paths).lower()}"
    )
    for report in reports:
        status = "ok" if report.ok else "fail"
        print(
            f"{status}: {report.path} "
            f"symbols={report.symbols} wires={report.wires} flags={report.flags} "
            f"iopins={report.iopins} texts={report.texts} directives={report.directives} "
            f"junctions={report.wire_body_junctions} warnings={len(report.warnings)} errors={len(report.errors)}"
        )
        for warning in report.warnings:
            print(f"  warning: {warning}")
        for error in report.errors:
            print(f"  error: {error}")


def report_to_json(report: AscReport) -> dict[str, object]:
    return {
        "path": report.path,
        "ok": report.ok,
        "version": report.version,
        "sheet": report.sheet,
        "symbols": report.symbols,
        "wires": report.wires,
        "flags": report.flags,
        "iopins": report.iopins,
        "texts": report.texts,
        "directives": report.directives,
        "labels": report.labels,
        "symattrs": report.symattrs,
        "wire_body_junctions": report.wire_body_junctions,
        "unknown_symbols": report.unknown_symbols,
        "warnings": report.warnings,
        "errors": report.errors,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate LTspice .asc schematic files.")
    parser.add_argument("paths", nargs="+", help="Files or directories to validate.")
    parser.add_argument(
        "--source-root",
        action="append",
        type=Path,
        default=[],
        help="Project or LTspice library root to scan for catalog.ts and .asy symbol files.",
    )
    parser.add_argument(
        "--catalog-ts",
        action="append",
        type=Path,
        default=[],
        help="TypeScript parser catalog file to scan for symbolName entries.",
    )
    parser.add_argument(
        "--symbol-root",
        action="append",
        type=Path,
        default=[],
        help="Directory containing LTspice .asy symbol files.",
    )
    parser.add_argument(
        "--strict-symbols",
        action="store_true",
        help="Treat unknown SYMBOL names as errors instead of warnings.",
    )
    parser.add_argument(
        "--strict-lines",
        action="store_true",
        help="Treat unsupported ASC commands as errors instead of warnings.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args(argv)

    try:
        catalog = build_catalog(args.source_root, args.catalog_ts, args.symbol_root)
    except OSError as exc:
        print(f"failed to read source catalog: {exc}", file=sys.stderr)
        return 1

    context = ValidationContext(
        catalog=catalog,
        strict_symbols=args.strict_symbols,
        strict_lines=args.strict_lines,
    )
    paths = expand_paths(args.paths)
    if not paths:
        print("no .asc files found", file=sys.stderr)
        return 1

    reports = [validate_file(path, context) for path in paths]
    if args.json:
        print(
            json.dumps(
                {
                    "catalog": {
                        "sources": catalog.sources,
                        "symbol_names": sorted(catalog.symbol_names),
                        "allow_opamp_paths": catalog.allow_opamp_paths,
                    },
                    "reports": [report_to_json(report) for report in reports],
                },
                indent=2,
                sort_keys=True,
            )
        )
    else:
        print_text_report(reports, catalog)

    return 1 if any(not report.ok for report in reports) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
