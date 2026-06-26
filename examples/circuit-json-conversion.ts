import {
	convertCircuitDocumentFile,
	parseCircuitDocumentFile,
	serializeCircuitJsonDocument,
} from "@vessel-dsp/core";

export function convertSourceToCircuitJson(
	sourceText: string,
	filename: string,
): string {
	const document = parseCircuitDocumentFile(sourceText, { filename });
	return `${JSON.stringify(serializeCircuitJsonDocument(document).elements, null, 2)}\n`;
}

export function convertCircuitJsonToVdsp(circuitJsonText: string): string {
	return convertCircuitDocumentFile(circuitJsonText, {
		inputFilename: "import.circuit.json",
		outputFormat: "vdsp",
		outputFilename: "import.vdsp",
	});
}
