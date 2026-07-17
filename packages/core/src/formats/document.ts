import type { CircuitDocument, DocumentSource } from "../model/types";
import { parseLtspiceAsc } from "./ltspice/parser";
import { serializeLtspiceAsc } from "./ltspice/serializer";
import { parseSchx } from "./schx/parser";
import { serializeSchx } from "./schx/serializer";
import { parseSpiceNetlist } from "./spice/parser";
import { serializeSpiceNetlist } from "./spice/serializer";
import { parseInterchangeYaml } from "./interchange/parser";
import { serializeInterchangeYaml } from "./interchange/serializer";
import {
	parseCircuitJsonDocument,
	serializeCircuitJsonDocument,
} from "./circuit-json/serializer";

export type CircuitFormat = "schx" | "spice" | "ltspice-asc";

export type CircuitDocumentFileFormat =
	| CircuitFormat
	| "vdsp"
	| "yaml"
	| "circuit-json";

export type ParseCircuitDocumentOptions = Readonly<{
	filename?: string;
	format?: CircuitFormat;
}>;

export type ParseCircuitDocumentFileOptions = Readonly<{
	filename: string;
}>;

export type SerializeVdspCircuitDocumentOptions = Readonly<{
	filename?: string;
	source?: DocumentSource;
}>;

export type SerializeCircuitDocumentFileOptions = Readonly<{
	format: CircuitDocumentFileFormat;
	filename?: string;
}>;

export type ConvertCircuitDocumentFileOptions = Readonly<{
	inputFilename: string;
	outputFormat: CircuitDocumentFileFormat;
	outputFilename?: string;
}>;

export type CircuitDocumentConversionLossPolicy =
	| "error"
	| "drop-with-diagnostics";

export type CircuitDocumentConversionDiagnostic = Readonly<{
	code: "v3-data-dropped";
	message: string;
	field: string;
}>;

export type ConvertCircuitDocumentFileWithReportOptions =
	ConvertCircuitDocumentFileOptions &
		Readonly<{
			lossPolicy?: CircuitDocumentConversionLossPolicy;
		}>;

export type CircuitDocumentFileConversionReport = Readonly<{
	output: string;
	diagnostics: readonly CircuitDocumentConversionDiagnostic[];
	droppedFields: readonly string[];
}>;

export type VdspSchemaValidationIssue = Readonly<{
	code: "vdsp-schema-invalid" | "duplicate-key";
	message: string;
	path?: string;
}>;

export type VdspSchemaValidationResult =
	| Readonly<{
			valid: true;
			document: CircuitDocument;
			errors: readonly [];
	  }>
	| Readonly<{
			valid: false;
			errors: readonly VdspSchemaValidationIssue[];
	  }>;

export const vdspFileExtension = ".vdsp";

export function detectCircuitFormat(filename: string): CircuitFormat | null {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".schx")) {
		return "schx";
	}
	if (
		lower.endsWith(".cir") ||
		lower.endsWith(".net") ||
		lower.endsWith(".spice")
	) {
		return "spice";
	}
	if (lower.endsWith(".asc")) {
		return "ltspice-asc";
	}
	return null;
}

export function parseCircuitDocument(
	source: string,
	options: ParseCircuitDocumentOptions = {},
): CircuitDocument {
	const format = options.format ?? detectFormat(source, options.filename);
	if (format === null) {
		throw new Error(
			"unsupported circuit format: provide a supported filename or explicit format",
		);
	}

	switch (format) {
		case "schx":
			return parseSchx(source);
		case "spice":
			return parseSpiceNetlist(source);
		case "ltspice-asc":
			return parseLtspiceAsc(source);
	}
}

function detectFormat(
	source: string,
	filename: string | undefined,
): CircuitFormat | null {
	if (filename !== undefined) {
		return detectCircuitFormat(filename);
	}
	const firstLine =
		source
			.replace(/^﻿/, "")
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0)
			?.trim() ?? "";

	if (firstLine.startsWith("<?xml") || firstLine.startsWith("<Schematic")) {
		return "schx";
	}
	if (firstLine.toUpperCase().startsWith("VERSION ")) {
		return "ltspice-asc";
	}
	if (firstLine.startsWith(".") || /^[A-Za-z]/.test(firstLine)) {
		return "spice";
	}
	return null;
}

export function isVdspFilename(filename: string): boolean {
	return filename.trim().toLowerCase().endsWith(vdspFileExtension);
}

export function detectCircuitDocumentFileFormat(
	filename: string,
): CircuitDocumentFileFormat | null {
	const lower = filename.trim().toLowerCase();
	if (lower.endsWith(".vdsp")) {
		return "vdsp";
	}
	if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
		return "yaml";
	}
	if (lower.endsWith(".circuit.json")) {
		return "circuit-json";
	}
	return detectCircuitFormat(filename);
}

export function vdspFilenameFromName(name: string): string {
	const slug = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	return `${slug || "untitled-preset"}${vdspFileExtension}`;
}

export function parseVdspCircuitDocument(source: string): CircuitDocument {
	return parseInterchangeYaml(source);
}

export function validateVdspCircuitDocumentSchema(
	source: string,
): VdspSchemaValidationResult {
	try {
		return {
			valid: true,
			document: parseVdspCircuitDocument(source),
			errors: [],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const path = pathFromSchemaMessage(message);
		return {
			valid: false,
			errors: [
				{
					code: DUPLICATE_MAPPING_KEY_MESSAGE.test(message)
						? "duplicate-key"
						: "vdsp-schema-invalid",
					message,
					...(path === undefined ? {} : { path }),
				},
			],
		};
	}
}

export function parseCircuitDocumentFile(
	source: string,
	options: ParseCircuitDocumentFileOptions,
): CircuitDocument {
	const format = detectCircuitDocumentFileFormat(options.filename);
	if (format === null) {
		throw new Error(
			`unsupported circuit document file extension: ${options.filename}`,
		);
	}
	if (format === "vdsp" || format === "yaml") {
		return parseInterchangeYaml(source);
	}
	if (format === "circuit-json") {
		const parsed: unknown = JSON.parse(source);
		return parseCircuitJsonDocument(
			parsed,
			options.filename === undefined ? {} : { filename: options.filename },
		);
	}
	return parseCircuitDocument(source, {
		filename: options.filename,
		format,
	});
}

export function serializeCircuitDocumentFile(
	document: CircuitDocument,
	options: SerializeCircuitDocumentFileOptions,
): string {
	assertNoV3OnlyDataDrop(document, options.format);

	switch (options.format) {
		case "vdsp":
		case "yaml":
			return serializeVdspCircuitDocument(
				document,
				options.filename === undefined ? {} : { filename: options.filename },
			);
		case "schx":
			return serializeSchx(document);
		case "ltspice-asc":
			return serializeLtspiceAsc(document);
		case "spice":
			return serializeSpiceNetlist(document);
		case "circuit-json":
			return `${JSON.stringify(serializeCircuitJsonDocument(document).elements, null, 2)}\n`;
	}
}

export function convertCircuitDocumentFile(
	source: string,
	options: ConvertCircuitDocumentFileOptions,
): string {
	return convertCircuitDocumentFileWithReport(source, options).output;
}

export function convertCircuitDocumentFileWithReport(
	source: string,
	options: ConvertCircuitDocumentFileWithReportOptions,
): CircuitDocumentFileConversionReport {
	const document = parseCircuitDocumentFile(source, {
		filename: options.inputFilename,
	});
	const droppedFields = v3OnlyDroppedFields(document);
	const targetOptions: SerializeCircuitDocumentFileOptions = {
		format: options.outputFormat,
		...(options.outputFilename === undefined
			? {}
			: { filename: options.outputFilename }),
	};

	if (isVdspOutputFormat(options.outputFormat) || droppedFields.length === 0) {
		return {
			output: serializeCircuitDocumentFile(document, targetOptions),
			diagnostics: [],
			droppedFields: [],
		};
	}

	if (options.lossPolicy !== "drop-with-diagnostics") {
		throw new Error(v3DropMessage(options.outputFormat, droppedFields));
	}

	const diagnostics = droppedFields.map(
		(field): CircuitDocumentConversionDiagnostic => ({
			code: "v3-data-dropped",
			field,
			message: `Dropped v3-only field "${field}" while converting to ${options.outputFormat}`,
		}),
	);

	return {
		output: serializeCircuitDocumentFile(
			stripV3OnlyData(document),
			targetOptions,
		),
		diagnostics,
		droppedFields,
	};
}

export function serializeVdspCircuitDocument(
	document: CircuitDocument,
	options: SerializeVdspCircuitDocumentOptions = {},
): string {
	return serializeInterchangeYaml(document, {
		source: vdspSource(document, options),
	});
}

function vdspSource(
	document: CircuitDocument,
	options: SerializeVdspCircuitDocumentOptions,
): DocumentSource {
	const source: Record<string, string> = {
		...(document.source ?? {}),
		...(options.source ?? {}),
	};
	if (source.format === undefined) {
		source.format = "interchange";
	}
	if (options.filename !== undefined) {
		source.filename = normalizeVdspFilename(
			options.filename,
			document.metadata.name,
		);
	}
	if (source.filename === undefined || source.filename.length === 0) {
		source.filename = vdspFilenameFromName(document.metadata.name);
	}
	return source;
}

function normalizeVdspFilename(
	filename: string | undefined,
	fallbackName: string,
): string {
	const trimmed = filename?.trim() ?? "";
	if (trimmed.length === 0) {
		return vdspFilenameFromName(fallbackName);
	}
	if (isVdspFilename(trimmed)) {
		return trimmed;
	}
	const withoutExtension = trimmed.replace(/\.[^.\\\/]+$/, "");
	return `${withoutExtension || "untitled-preset"}${vdspFileExtension}`;
}

function assertNoV3OnlyDataDrop(
	document: CircuitDocument,
	format: CircuitDocumentFileFormat,
): void {
	if (isVdspOutputFormat(format)) {
		return;
	}
	const droppedFields = v3OnlyDroppedFields(document);
	if (droppedFields.length > 0) {
		throw new Error(v3DropMessage(format, droppedFields));
	}
}

function v3DropMessage(
	format: CircuitDocumentFileFormat,
	droppedFields: readonly string[],
): string {
	return `Converting to ${format} would drop v3-only fields: ${droppedFields.join(", ")}`;
}

function isVdspOutputFormat(format: CircuitDocumentFileFormat): boolean {
	return format === "vdsp" || format === "yaml";
}

function v3OnlyDroppedFields(document: CircuitDocument): readonly string[] {
	const fields: string[] = [];
	if (document.mechanical !== undefined) {
		fields.push("mechanical");
	}
	if (document.build !== undefined) {
		fields.push("build");
	}
	if (document.bom !== undefined) {
		fields.push("bom");
	}
	if (document.partProfiles !== undefined) {
		fields.push("partProfiles");
	}
	if (document.simulationProfiles !== undefined) {
		fields.push("simulationProfiles");
	}
	if (document.footprints !== undefined) {
		fields.push("footprints");
	}
	if (document.offBoardWiring !== undefined) {
		fields.push("offBoardWiring");
	}
	if (
		document.panel?.faces.some((face) => face.geometry !== undefined) === true
	) {
		fields.push("panel.faces[].geometry");
	}
	if (
		document.panel?.faces.some((face) =>
			face.elements.some((element) => element.id !== undefined),
		) === true
	) {
		fields.push("panel.faces[].elements[].id");
	}
	if (
		document.panel?.faces.some((face) =>
			face.elements.some((element) => element.physical !== undefined),
		) === true
	) {
		fields.push("panel.faces[].elements[].physical");
	}
	if (document.boards !== undefined) {
		fields.push("boards");
	}
	return fields;
}

function stripV3OnlyData(document: CircuitDocument): CircuitDocument {
	return {
		metadata: document.metadata,
		...(document.source === undefined ? {} : { source: document.source }),
		...(document.device === undefined ? {} : { device: document.device }),
		...(document.controlGroups === undefined
			? {}
			: { controlGroups: document.controlGroups }),
		...(document.controlContexts === undefined
			? {}
			: { controlContexts: document.controlContexts }),
		...(document.deviceInterface === undefined
			? {}
			: { deviceInterface: document.deviceInterface }),
		...(document.panel === undefined
			? {}
			: {
					panel: {
						faces: document.panel.faces.map((face) => ({
							id: face.id,
							...(face.label === undefined ? {} : { label: face.label }),
							layout: face.layout,
							elements: face.elements.map((element) => ({
								bind: element.bind,
								kind: element.kind,
								...(element.label === undefined
									? {}
									: { label: element.label }),
								...(element.interfaceControlId === undefined
									? {}
									: { interfaceControlId: element.interfaceControlId }),
								grid: element.grid,
							})),
						})),
					},
				}),
		...(document.controlInterfaces === undefined
			? {}
			: { controlInterfaces: document.controlInterfaces }),
		...(document.controlOutputs === undefined
			? {}
			: { controlOutputs: document.controlOutputs }),
		components: document.components,
		wires: document.wires,
		directives: document.directives,
		warnings: document.warnings,
		rawAttributes: document.rawAttributes,
	};
}

const DUPLICATE_MAPPING_KEY_MESSAGE = /^duplicate mapping key "([^"]+)"$/;

function pathFromSchemaMessage(message: string): string | undefined {
	const duplicateKeyMatch = DUPLICATE_MAPPING_KEY_MESSAGE.exec(message);
	if (duplicateKeyMatch !== null) {
		return duplicateKeyMatch[1];
	}
	const colonIndex = message.indexOf(":");
	if (colonIndex <= 0) {
		return undefined;
	}
	const candidate = message.slice(0, colonIndex);
	if (
		/^[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?)*$/.test(
			candidate,
		)
	) {
		return candidate;
	}
	return undefined;
}
