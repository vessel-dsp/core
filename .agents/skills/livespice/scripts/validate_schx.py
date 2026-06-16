#!/usr/bin/env python3
"""Source-derived validation for LiveSPICE .schx files.

This is a validation-only Python port of selected LiveSPICE source rules. It
does not execute the LiveSPICE runtime, build a circuit, or simulate anything.
Pass --source-root pointing at a LiveSPICE checkout to derive the component
catalog and serialized property names from the C# source.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


COMMON_COMPONENT_PROPERTIES = {"Name", "PartNumber", "Description"}

FALLBACK_COMPONENT_TYPES = {
    "BipolarJunctionTransistor",
    "Buffer",
    "Capacitor",
    "CenterTapTransformer",
    "ChildLangmuirTriode",
    "Circuit",
    "Conductor",
    "CurrentDefinition",
    "CurrentSource",
    "DelayBuffer",
    "Diode",
    "Ground",
    "IdealOpAmp",
    "Inductor",
    "Input",
    "JunctionFieldEffectTransistor",
    "KorenTriode",
    "Label",
    "NamedWire",
    "OpAmp",
    "Pentode",
    "Port",
    "Potentiometer",
    "Rail",
    "Resistor",
    "SP3T",
    "SP4T",
    "SP5T",
    "SPDT",
    "Speaker",
    "Specialization",
    "Switch",
    "Transformer",
    "Triode",
    "VariableResistor",
    "VoltageDefinition",
    "VoltageSource",
}

FALLBACK_COMPONENT_PROPERTIES = {
    "BipolarJunctionTransistor": {"Type", "IS", "BF", "BR"},
    "Capacitor": {"Capacitance"},
    "CenterTapTransformer": {"Turns"},
    "Circuit": set(),
    "Conductor": set(),
    "CurrentDefinition": set(),
    "CurrentSource": {"Current"},
    "Diode": {"IS", "n", "Type", "K", "Exp"},
    "Ground": {"WireName"},
    "Inductor": {"Inductance"},
    "Input": {"V0dBFS"},
    "JunctionFieldEffectTransistor": {"Type", "IS", "n", "Vt0", "Beta", "Lambda"},
    "Label": {"Text", "Subtext"},
    "NamedWire": {"WireName"},
    "OpAmp": {"Rin", "Rout", "Aol", "GBP"},
    "Pentode": {"Mu", "Kg1", "Kg2", "Kp", "Kvb", "Ex", "Rgk", "Kn", "Vg"},
    "Port": {"Number", "Name"},
    "Potentiometer": {"Resistance", "Wipe", "Sweep", "Group"},
    "Rail": {"Voltage", "WireName"},
    "Resistor": {"Resistance"},
    "SP3T": {"Position", "Group"},
    "SP4T": {"Position", "Group"},
    "SP5T": {"Position", "Group"},
    "SPDT": {"Position", "Group"},
    "Speaker": {"V0dBFS", "Impedance"},
    "Switch": {"Closed"},
    "Transformer": {"Turns"},
    "Triode": {
        "Model",
        "SimulateCapacitances",
        "Mu",
        "K",
        "Ex",
        "Kg",
        "Kp",
        "Kvb",
        "Rgk",
        "Kn",
        "Vg",
        "Gamma",
        "G",
        "Gg",
        "C",
        "Cg",
        "Xi",
        "Ig0",
        "Cgp",
        "Cgk",
        "Cpk",
    },
    "ChildLangmuirTriode": {
        "Model",
        "SimulateCapacitances",
        "Mu",
        "K",
        "Ex",
        "Kg",
        "Kp",
        "Kvb",
        "Rgk",
        "Kn",
        "Vg",
        "Gamma",
        "G",
        "Gg",
        "C",
        "Cg",
        "Xi",
        "Ig0",
        "Cgp",
        "Cgk",
        "Cpk",
    },
    "KorenTriode": {
        "Model",
        "SimulateCapacitances",
        "Mu",
        "K",
        "Ex",
        "Kg",
        "Kp",
        "Kvb",
        "Rgk",
        "Kn",
        "Vg",
        "Gamma",
        "G",
        "Gg",
        "C",
        "Cg",
        "Xi",
        "Ig0",
        "Cgp",
        "Cgk",
        "Cpk",
    },
    "VariableResistor": {"Resistance", "Wipe", "Sweep", "Group"},
    "VoltageDefinition": set(),
    "VoltageSource": {"Voltage"},
}

for _component_type in FALLBACK_COMPONENT_TYPES:
    FALLBACK_COMPONENT_PROPERTIES.setdefault(_component_type, set())
    FALLBACK_COMPONENT_PROPERTIES[_component_type] = (
        set(FALLBACK_COMPONENT_PROPERTIES[_component_type]) | COMMON_COMPONENT_PROPERTIES
    )


@dataclass
class ComponentClass:
    public: bool = False
    abstract: bool = False
    bases: set[str] = field(default_factory=set)


@dataclass
class ComponentCatalog:
    source: str
    component_types: set[str]
    component_properties: dict[str, set[str]]


@dataclass
class ValidationContext:
    catalog: ComponentCatalog
    strict_known_types: bool = False
    strict_properties: bool = False


@dataclass
class SchxReport:
    path: str
    ok: bool = True
    symbols: int = 0
    wires: int = 0
    other_elements: int = 0
    unknown_component_types: list[str] = field(default_factory=list)
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


CLASS_RE = re.compile(
    r"^\s*public\s+(?:(abstract)\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)"
    r"(?:\s*:\s*([^{\n]+))?"
)
PROPERTY_RE = re.compile(
    r"\bpublic\s+(?:(?:override|virtual|new)\s+)?[A-Za-z_][A-Za-z0-9_<>\.\[\]?]*\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)\s*\{"
)


def class_name(type_name: str | None) -> str:
    if not type_name:
        return ""
    qualified = type_name.split(",", 1)[0].strip()
    return qualified.rsplit(".", 1)[-1]


def merge_class(classes: dict[str, ComponentClass], name: str, info: ComponentClass) -> None:
    if name not in classes:
        classes[name] = info
        return
    existing = classes[name]
    existing.public = existing.public or info.public
    existing.abstract = existing.abstract and info.abstract
    existing.bases.update(info.bases)


def parse_bases(raw_bases: str | None) -> set[str]:
    if not raw_bases:
        return set()
    bases: set[str] = set()
    for raw_base in raw_bases.split(","):
        base = raw_base.strip().split("<", 1)[0].rsplit(".", 1)[-1]
        if base:
            bases.add(base)
    return bases


def scan_csharp_files(source_root: Path) -> tuple[dict[str, ComponentClass], dict[str, set[str]]]:
    classes: dict[str, ComponentClass] = {}
    direct_properties: dict[str, set[str]] = {}
    root = source_root / "Circuit" if (source_root / "Circuit").is_dir() else source_root

    for path in sorted(root.rglob("*.cs")):
        current_class = ""
        pending_serialize = False
        try:
            lines = path.read_text(encoding="utf-8-sig").splitlines()
        except UnicodeDecodeError:
            lines = path.read_text(errors="ignore").splitlines()

        for line in lines:
            class_match = CLASS_RE.match(line)
            if class_match:
                current_class = class_match.group(2)
                merge_class(
                    classes,
                    current_class,
                    ComponentClass(
                        public=True,
                        abstract=bool(class_match.group(1)),
                        bases=parse_bases(class_match.group(3)),
                    ),
                )
                direct_properties.setdefault(current_class, set())

            if "[Serialize" in line:
                property_match = PROPERTY_RE.search(line)
                if property_match and current_class:
                    direct_properties.setdefault(current_class, set()).add(property_match.group(1))
                    pending_serialize = False
                else:
                    pending_serialize = True
                continue

            if pending_serialize and line.strip().startswith("["):
                continue

            if pending_serialize:
                property_match = PROPERTY_RE.search(line)
                if property_match and current_class:
                    direct_properties.setdefault(current_class, set()).add(property_match.group(1))
                pending_serialize = False

    return classes, direct_properties


def derive_source_catalog(source_root: Path) -> ComponentCatalog:
    classes, direct_properties = scan_csharp_files(source_root)

    def derives_from_component(name: str, visited: set[str] | None = None) -> bool:
        if name == "Component":
            return True
        if visited is None:
            visited = set()
        if name in visited:
            return False
        visited.add(name)
        info = classes.get(name)
        if not info:
            return False
        return any(derives_from_component(base, visited) for base in info.bases)

    def collect_properties(name: str, visited: set[str] | None = None) -> set[str]:
        if visited is None:
            visited = set()
        if name in visited:
            return set()
        visited.add(name)
        properties = set(direct_properties.get(name, set()))
        for base in classes.get(name, ComponentClass()).bases:
            properties.update(collect_properties(base, visited))
        return properties

    excluded = {"Component", "Error", "Warning", "UnserializedComponent"}
    component_types = {
        name
        for name, info in classes.items()
        if info.public and not info.abstract and name not in excluded and derives_from_component(name)
    }
    component_properties = {
        name: collect_properties(name) | COMMON_COMPONENT_PROPERTIES for name in component_types
    }
    return ComponentCatalog(
        source=str(source_root),
        component_types=component_types,
        component_properties=component_properties,
    )


def fallback_catalog() -> ComponentCatalog:
    return ComponentCatalog(
        source="embedded fallback",
        component_types=set(FALLBACK_COMPONENT_TYPES),
        component_properties={name: set(props) for name, props in FALLBACK_COMPONENT_PROPERTIES.items()},
    )


def parse_coordinate(raw: str | None, field_name: str, report: SchxReport) -> tuple[int, int] | None:
    if raw is None:
        report.error(f"missing {field_name} coordinate")
        return None
    parts = [part.strip() for part in raw.split(",")]
    if len(parts) != 2:
        report.error(f"{field_name} coordinate must be x,y: {raw!r}")
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        report.error(f"{field_name} coordinate must contain integer values: {raw!r}")
        return None


def validate_component_attributes(
    component: ET.Element,
    component_type: str,
    index: int,
    report: SchxReport,
    context: ValidationContext,
) -> None:
    allowed = context.catalog.component_properties.get(component_type)
    if allowed is None:
        return
    for attr in sorted(component.attrib):
        if attr == "_Type":
            continue
        if attr not in allowed:
            report.issue(
                f"Element[{index}] Component {component_type} has non-serialized attribute {attr!r}",
                context.strict_properties,
            )


def validate_symbol(element: ET.Element, index: int, report: SchxReport, context: ValidationContext) -> None:
    report.symbols += 1
    parse_coordinate(element.get("Position"), f"Element[{index}] Position", report)

    rotation = element.get("Rotation")
    if rotation is None:
        report.error(f"Element[{index}] symbol missing Rotation")
    else:
        try:
            int(rotation)
        except ValueError:
            report.error(f"Element[{index}] Rotation must be an integer: {rotation!r}")

    flip = element.get("Flip")
    if flip is None:
        report.error(f"Element[{index}] symbol missing Flip")
    elif flip.lower() not in {"true", "false"}:
        report.error(f"Element[{index}] Flip must parse as a boolean: {flip!r}")

    components = [child for child in element if child.tag == "Component"]
    if not components:
        report.issue(
            f"Element[{index}] symbol has no Component; LiveSPICE will deserialize it as an Error symbol",
            context.strict_known_types,
        )
        return
    if len(components) > 1:
        report.warning(f"Element[{index}] symbol has multiple Component children; LiveSPICE uses the first")

    component = components[0]
    component_type_raw = component.get("_Type")
    if not component_type_raw:
        report.issue(
            f"Element[{index}] Component missing _Type; LiveSPICE will deserialize it as an Error symbol",
            context.strict_known_types,
        )
        return

    component_type = class_name(component_type_raw)
    if component_type not in context.catalog.component_types:
        report.unknown_component_types.append(component_type)
        report.issue(
            f"Element[{index}] unknown Component _Type: {component_type_raw}",
            context.strict_known_types,
        )
        return

    validate_component_attributes(component, component_type, index, report, context)


def validate_wire(element: ET.Element, index: int, report: SchxReport) -> None:
    report.wires += 1
    a = parse_coordinate(element.get("A"), f"Element[{index}] A", report)
    b = parse_coordinate(element.get("B"), f"Element[{index}] B", report)
    if a is not None and b is not None and a == b:
        report.warning(f"Element[{index}] zero-length wire deserializes as a Warning symbol")


def validate_file(path: Path, context: ValidationContext) -> SchxReport:
    report = SchxReport(path=str(path))
    if path.suffix.lower() != ".schx":
        report.warning("file extension is not .schx")
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        report.error(f"XML parse error: {exc}")
        return report
    except OSError as exc:
        report.error(f"file read error: {exc}")
        return report

    root = tree.getroot()
    if root.tag != "Schematic":
        report.error(f"root element must be Schematic, got {root.tag!r}")
        return report

    for attr in ("Name", "Description", "PartNumber"):
        if attr not in root.attrib:
            report.warning(f"root missing {attr} attribute")

    for index, element in enumerate(list(root)):
        if element.tag != "Element":
            report.warning(f"child[{index}] is not an Element: {element.tag!r}")
            continue

        element_type_raw = element.get("Type")
        element_type = class_name(element_type_raw)
        if not element_type_raw:
            report.error(f"Element[{index}] missing Type")
        elif element_type == "Symbol":
            validate_symbol(element, index, report, context)
        elif element_type == "Wire":
            validate_wire(element, index, report)
        else:
            report.other_elements += 1
            report.error(f"Element[{index}] unsupported Element Type: {element_type_raw}")

    return report


def expand_paths(paths: Iterable[str]) -> list[Path]:
    expanded: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            expanded.extend(sorted(path.rglob("*.schx")))
        else:
            expanded.append(path)
    return expanded


def print_text_report(reports: list[SchxReport], catalog: ComponentCatalog) -> None:
    print(
        f"catalog: {catalog.source} "
        f"component_types={len(catalog.component_types)} "
        f"component_property_sets={len(catalog.component_properties)}"
    )
    for report in reports:
        status = "ok" if report.ok else "fail"
        print(
            f"{status}: {report.path} "
            f"symbols={report.symbols} wires={report.wires} "
            f"warnings={len(report.warnings)} errors={len(report.errors)}"
        )
        for warning in report.warnings:
            print(f"  warning: {warning}")
        for error in report.errors:
            print(f"  error: {error}")


def report_to_json(report: SchxReport) -> dict[str, object]:
    return {
        "path": report.path,
        "ok": report.ok,
        "symbols": report.symbols,
        "wires": report.wires,
        "other_elements": report.other_elements,
        "unknown_component_types": report.unknown_component_types,
        "warnings": report.warnings,
        "errors": report.errors,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate LiveSPICE .schx schematic files.")
    parser.add_argument("paths", nargs="+", help="Files or directories to validate.")
    parser.add_argument(
        "--source-root",
        type=Path,
        help="Path to a LiveSPICE checkout; derives component types and serialized properties from C# source.",
    )
    parser.add_argument(
        "--strict-known-types",
        action="store_true",
        help="Treat unknown or missing Component _Type values as errors instead of warnings.",
    )
    parser.add_argument(
        "--strict-properties",
        action="store_true",
        help="Treat attributes not marked [Serialize] in LiveSPICE components as errors instead of warnings.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args(argv)

    if args.source_root:
        try:
            catalog = derive_source_catalog(args.source_root)
        except OSError as exc:
            print(f"failed to read LiveSPICE source root: {exc}", file=sys.stderr)
            return 1
        if not catalog.component_types:
            print(f"no LiveSPICE component classes found under {args.source_root}", file=sys.stderr)
            return 1
    else:
        catalog = fallback_catalog()

    context = ValidationContext(
        catalog=catalog,
        strict_known_types=args.strict_known_types,
        strict_properties=args.strict_properties,
    )
    paths = expand_paths(args.paths)
    if not paths:
        print("no .schx files found", file=sys.stderr)
        return 1

    reports = [validate_file(path, context) for path in paths]
    if args.json:
        print(
            json.dumps(
                {
                    "catalog": {
                        "source": catalog.source,
                        "component_types": sorted(catalog.component_types),
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
