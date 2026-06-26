import { propertyValueForSourceAttribute } from "../../model/properties";
import type {
	CircuitDocument,
	Component,
	Point,
	PropertyValue,
	Wire,
} from "../../model/types";
import {
	defaultDefForKind,
	fullSchxType,
	SCHX_SYMBOL_ELEMENT_TYPE,
	SCHX_WIRE_ELEMENT_TYPE,
	shortenSchxType,
} from "./catalog";

export function serializeSchx(doc: CircuitDocument): string {
	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="utf-8"?>');
	lines.push(`<Schematic ${formatAttrs(rootAttributes(doc))}>`);

	for (const component of doc.components) {
		lines.push(`  <Element ${formatAttrs(elementAttributes(component))}>`);
		lines.push(
			`    <Component ${formatAttrs(componentAttributes(component))} />`,
		);
		lines.push("  </Element>");
	}

	for (const wire of doc.wires) {
		lines.push(`  <Element ${formatAttrs(wireAttributes(wire))} />`);
	}

	lines.push("</Schematic>");
	return `${lines.join("\n")}\n`;
}

function rootAttributes(doc: CircuitDocument): Record<string, string> {
	const attrs: Record<string, string> = {
		Name: doc.metadata.name,
		Description: doc.metadata.description,
		PartNumber: doc.metadata.partNumber,
	};
	for (const [key, value] of Object.entries(doc.rawAttributes)) {
		if (key === "Name" || key === "Description" || key === "PartNumber") {
			continue;
		}
		attrs[key] = value;
	}
	return attrs;
}

function elementAttributes(component: Component): Record<string, string> {
	return {
		Type: SCHX_SYMBOL_ELEMENT_TYPE,
		Rotation: String(component.rotation),
		Flip: component.flipped ? "true" : "false",
		Position: pointToString(component.origin),
	};
}

function componentAttributes(component: Component): Record<string, string> {
	const type = component.sourceTypeName ?? guessSourceType(component);
	const attrs: Record<string, string> = { _Type: type };
	const skipDerivedDescriptorKeys =
		component.properties.RuntimeDescriptor === "true";

	for (const [key, value] of Object.entries(component.properties)) {
		if (skipDerivedDescriptorKeys && DERIVED_RUNTIME_DESCRIPTOR_KEYS.has(key)) {
			continue;
		}
		const serialized = stringifyPropertyValue(value);
		if (serialized !== null) {
			attrs[key] = serialized;
		}
	}

	if (component.kind === "led" && attrs.Type === undefined) {
		attrs.Type = "LED";
	}

	attrs.Name = component.name;
	return attrs;
}

function wireAttributes(wire: Wire): Record<string, string> {
	return {
		Type: SCHX_WIRE_ELEMENT_TYPE,
		A: pointToString(wire.endpoints[0]),
		B: pointToString(wire.endpoints[1]),
	};
}

function guessSourceType(component: Component): string {
	if (component.kind === "led") {
		return fullSchxType("Diode");
	}

	const def = defaultDefForKind(component.kind);
	if (def === undefined) {
		return fullSchxType("Unknown");
	}
	const shortName =
		component.kind === "tube-diode" ? "TubeDiode" : def.shortType;
	return fullSchxType(shortName);
}

function stringifyPropertyValue(value: PropertyValue): string | null {
	return propertyValueForSourceAttribute(value);
}

const DERIVED_RUNTIME_DESCRIPTOR_KEYS: ReadonlySet<string> = new Set([
	"DescriptorType",
	"mechanism",
	"algorithm",
	"topology",
	"descriptor",
	"bands",
	"sections",
	"controlLaw",
	"overallGainDb",
	"maxSections",
	"toneControlName",
	"minToneWipe",
	"maxToneWipe",
	"defaultToneWipe",
	"defaultBassWipe",
	"defaultMiddleWipe",
	"defaultTrebleWipe",
	"inputGain",
	"outputGain",
	"minDelayMs",
	"maxDelayMs",
	"defaultDelayMs",
	"feedback",
	"minFeedback",
	"maxFeedback",
	"mix",
	"minMix",
	"maxMix",
	"level",
	"minOutputLevel",
	"maxOutputLevel",
	"tone",
	"modRateHz",
	"minModRateHz",
	"maxModRateHz",
	"modDepthMs",
	"minModDepthMs",
	"maxModDepthMs",
	"inputDrive",
	"minInputDrive",
	"maxInputDrive",
	"headroom",
	"stereoOutputMode",
	"wetOnly",
	"dryUnity",
	"hold",
	"samplerRecordPlay",
	"preDelayMs",
	"decay",
	"damping",
	"size",
	"detectorMode",
	"sensitivity",
	"minSensitivity",
	"maxSensitivity",
	"attackMs",
	"minAttackMs",
	"maxAttackMs",
	"releaseMs",
	"minReleaseMs",
	"maxReleaseMs",
	"ratio",
	"thresholdDb",
	"kneeDb",
	"dividerMode",
	"dividerStages",
	"trackerCutoffHz",
	"schmittHysteresis",
	"gateThreshold",
	"gateRelease",
	"square1CutoffHz",
	"square2CutoffHz",
	"chopperPreCutoffHz",
	"chopperPostCutoffHz",
	"chopperControlCutoffHz",
	"directLevel",
	"oct1Level",
	"oct2Level",
	"toneHz",
	"minToneHz",
	"maxToneHz",
	"carrierModRateHz",
	"minCarrierModRateHz",
	"maxCarrierModRateHz",
	"carrierModAmount",
	"carrierModShape",
]);

function pointToString(p: Point): string {
	return `${p.x},${p.y}`;
}

function formatAttrs(attrs: Record<string, string>): string {
	return Object.entries(attrs)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}="${escapeXml(value)}"`)
		.join(" ");
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export { shortenSchxType };
