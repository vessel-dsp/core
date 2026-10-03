// Converter full scale: the gain a program between an ADC and a DAC actually has.
//
// A composed program runs in volts: its input is the solved voltage at its input node and its
// output drives its output node in volts. That is exact only when the chip's converters have
// equal full scales. In the pedal the ADC maps its full scale to digital 1.0 and the DAC maps
// digital 1.0 back to its own, so the program's volts-to-volts gain is `dac / adc` times
// whatever the firmware does. The firmware is the program; the ratio is a fact about two parts.
//
// **Connectivity, not names.** A converter is the one on the block's input or output node, found
// by the node the circuit shares with it, and it is a converter because its exact part id has a
// `converter` entry in the catalog. Nothing is declared in the document.
//
// **Unity and a warning, never a guess, when a side is unknown.** The ratio is applied only when
// both sides are wired and both full scales are cited. Otherwise the program stays unity in volts,
// which is a level assumption the reader must be told about: `boss-dd-5` sits ~7.5 dB below
// its own deck for exactly this reason.

import { canonicalPartId } from "./part-number";
import {
	type ConverterDeclaration,
	foldPartId,
	type PartRegistry,
} from "./registry";
import type {
	ConverterScaleNotModelledWarning,
	Device,
	Netlist,
	NodeId,
	Program,
} from "./types";

type Converter = { readonly device: Device; readonly declaration: ConverterDeclaration };

/** The catalog's converter declaration for a device's exact part id, or null. */
function converterOf(device: Device, registry: PartRegistry): ConverterDeclaration | null {
	const partNumber = device.identity.partNumber;
	if (partNumber === null) return null;
	const canonical = foldPartId(canonicalPartId(partNumber));
	for (const entry of registry.entries) {
		if (
			entry.converter !== undefined &&
			entry.partIds.some((id) => foldPartId(canonicalPartId(id)) === canonical)
		) {
			return entry.converter;
		}
	}
	return null;
}

function describe(converter: Converter): string {
	const fullScale = converter.declaration.fullScaleVoltsPeakToPeak;
	return (
		`${converter.device.id} ${converter.device.identity.partNumber} ` +
		(fullScale === null ? "(full scale not cited)" : `(${fullScale} Vp-p full scale)`)
	);
}

/**
 * Scale every composed block that sits between two cited converters, and name every one that
 * touches a converter but cannot be scaled.
 *
 * A block no converter touches is left alone and raises nothing: a bucket-brigade composition
 * is analog end to end and has no full scale to be wrong about.
 */
export function applyConverterScale(
	program: Program,
	netlist: Netlist,
	registry: PartRegistry,
): { readonly program: Program; readonly warnings: readonly ConverterScaleNotModelledWarning[] } {
	const converters: Converter[] = netlist.devices.flatMap((device) => {
		const declaration = converterOf(device, registry);
		return declaration === null ? [] : [{ device, declaration }];
	});
	if (converters.length === 0) return { program, warnings: [] };

	// Ports and stamps address MNA rows, not source nodes, so both are translated through the
	// owning block's `nodeIds` before they can be compared with a converter's terminals.
	const sourceNode = new Map<string, readonly NodeId[]>();
	const outputNodeOf = new Map<string, NodeId>();
	for (const block of program.blocks) {
		if (block.kind !== "mna") continue;
		sourceNode.set(block.id, block.nodeIds);
		for (const stamp of block.stamps) {
			const node = block.nodeIds[stamp.kind === "macro-audio-source" ? stamp.node : -1];
			if (stamp.kind === "macro-audio-source" && node !== undefined) {
				outputNodeOf.set(stamp.macroId, node);
			}
		}
	}
	const on = (node: NodeId | undefined, direction: "adc" | "dac") =>
		node === undefined
			? []
			: converters.filter(
					(converter) =>
						converter.declaration.direction === direction &&
						converter.device.nodes.includes(node),
				);

	const warnings: ConverterScaleNotModelledWarning[] = [];
	const blocks = program.blocks.map((block) => {
		if (block.kind !== "composed") return block;
		const adcs = on(
			block.audioIn === null
				? undefined
				: sourceNode.get(block.audioIn.block)?.[block.audioIn.node],
			"adc",
		);
		const dacs = on(outputNodeOf.get(block.id), "dac");
		// A reprogrammable chip's program sits behind converters by construction, so in a document
		// that has them its volts-in, volts-out assumption is named even where neither is wired to it.
		if (adcs.length === 0 && dacs.length === 0 && block.modelSource !== "declared") return block;

		const adc = adcs.length === 1 ? adcs[0] : undefined;
		const dac = dacs.length === 1 ? dacs[0] : undefined;
		const adcScale = adc?.declaration.fullScaleVoltsPeakToPeak ?? null;
		const dacScale = dac?.declaration.fullScaleVoltsPeakToPeak ?? null;
		if (adcScale !== null && dacScale !== null) {
			const gain = dacScale / adcScale;
			return {
				...block,
				positions: block.positions.map((position) => ({
					...position,
					ops: [
						...position.ops,
						{
							op: "mix" as const,
							terms: [{ source: { kind: "temp" as const, index: position.out }, gain }],
							out: position.ops.length,
						},
					],
					out: position.ops.length,
				})),
			};
		}

		const side = (
			found: readonly Converter[],
			direction: "adc" | "dac",
			node: string,
		): string => {
			if (found.length === 1) return `its ${node} is ${describe(found[0]!)}`;
			if (found.length > 1) {
				return `its ${node} touches ${found.length} ${direction.toUpperCase()}s (${found.map((c) => c.device.id).join(", ")}), so which one converts is not decidable`;
			}
			const elsewhere = converters.filter((c) => c.declaration.direction === direction);
			return (
				`its ${node} reaches no ${direction.toUpperCase()}` +
				(elsewhere.length > 0
					? `; ${elsewhere.map(describe).join(" and ")} ${elsewhere.length === 1 ? "is" : "are"} in the document, not wired to it`
					: "")
			);
		};
		warnings.push({
			code: "converter-scale-not-modelled",
			device: null,
			detail:
				`${block.id} runs in volts, unity from input to output, but ` +
				`${side(adcs, "adc", "input")}, and ${side(dacs, "dac", "output")}. ` +
				"The pedal's gain there is the DAC's full scale over the ADC's, so the level of " +
				"everything this program outputs is unmodelled by that ratio." +
				[...adcs, ...dacs, ...converters]
					.filter((c, i, all) => all.indexOf(c) === i && c.declaration.fullScaleVoltsPeakToPeak === null)
					.map((c) => ` ${c.device.identity.partNumber}: ${c.declaration.basis}`)
					.join(""),
		});
		return block;
	});
	return { program: { ...program, blocks }, warnings };
}
