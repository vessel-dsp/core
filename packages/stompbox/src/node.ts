import { readFileSync } from "node:fs";
import type { CircuitDocument } from "@vessel-dsp/core";
import {
	createStompboxPreviewGlb as createStompboxPreviewGlbBase,
	createStompboxPreviewGlbFromVdsp as createStompboxPreviewGlbFromVdspBase,
	validateStompboxGlbAssetFromPath,
	validateStompboxHardwareProfileAssets as validateStompboxHardwareProfileAssetsBase,
	type StompboxGlbAssetValidation,
	type StompboxHardwareProfile,
	type StompboxHardwareProfileAssetValidation,
	type StompboxHardwareProfileAssetValidationOptions,
	type StompboxPartProfile,
	type StompboxPreviewGlb,
	type StompboxPreviewGlbFromVdspOptions,
	type StompboxPreviewGlbOptions,
} from "./index.js";

export * from "./index.js";

function readNodeAssetFile(path: string): Uint8Array {
	return new Uint8Array(readFileSync(path));
}

export function validateStompboxGlbAssetFile(
	path: string,
	partProfile: StompboxPartProfile,
): StompboxGlbAssetValidation {
	return validateStompboxGlbAssetFromPath(path, partProfile, readNodeAssetFile);
}

export function validateStompboxHardwareProfileAssets(
	hardwareProfile: StompboxHardwareProfile,
	options: StompboxHardwareProfileAssetValidationOptions = {},
): StompboxHardwareProfileAssetValidation {
	return validateStompboxHardwareProfileAssetsBase(hardwareProfile, {
		...options,
		readAssetFile: readNodeAssetFile,
	});
}

export function createStompboxPreviewGlb(
	document: CircuitDocument,
	options: StompboxPreviewGlbOptions = {},
): StompboxPreviewGlb {
	return createStompboxPreviewGlbBase(document, {
		...options,
		readAssetFile: readNodeAssetFile,
	});
}

export function createStompboxPreviewGlbFromVdsp(
	source: string,
	options: StompboxPreviewGlbFromVdspOptions = {},
): StompboxPreviewGlb {
	return createStompboxPreviewGlbFromVdspBase(source, {
		...options,
		readAssetFile: readNodeAssetFile,
	});
}
