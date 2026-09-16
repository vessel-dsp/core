// A tube running a device-class fit instead of its own.
//
// This exists because the alternative was measured: every triode in the corpus ran a 12AX7 fit and
// every pentode a 6V6 fit, silently, for as long as v2 has compiled an amp. `vox-ac15-top-boost`'s
// EL84s were handed `mu 8.0` where the part's own fit says 21.29, which biased the shared cathode
// resistor to 23 V, cut the output stage off and decayed the amp to 2.5 mV. Nothing reported it,
// because a fallback that returns a working law looks exactly like a fallback that returns the
// right one. See `docs/troubleshootings/every-tube-gets-a-generic-fit-not-its-declared-device.md`.
//
// A warning rather than a refusal: an unregistered tube still gets a device-class law, exactly as
// an unregistered transistor does, and refusing every amp whose tube is not catalogued would trade
// a working corpus for a complete one.

import { registryLawFor, type PartRegistry } from "./registry";
import type { CompileWarning, Netlist } from "./types";

/** The tube kinds whose law a part number can refine. */
const TUBE_KINDS = new Set(["triode", "pentode", "tube-diode"]);

/**
 * One warning per tube device whose part number the registry does not answer.
 *
 * Reported per device rather than per part number, because "which tube is generic" and "how much of
 * this amp is generic" are different questions and the second is the one that decides whether a
 * render can be quoted. An amp whose preamp is catalogued and whose output pair is not is a
 * different claim from one where nothing resolved.
 */
export function findGenericTubeFits(
	netlist: Netlist,
	registry: PartRegistry,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const device of netlist.devices) {
		if (!TUBE_KINDS.has(device.kind)) {
			continue;
		}
		const partNumber = device.identity.partNumber;
		if (registryLawFor(registry, partNumber, device.kind as never) !== null) {
			continue;
		}
		warnings.push({
			code: "generic-tube-fit",
			device: device.id,
			partNumber,
			detail:
				partNumber === null
					? `${device.kind} declares no part number, so it runs the generic device-class fit and its bias and gain are not this tube's`
					: `${device.kind} ${partNumber} is not in the catalog, so it runs the generic device-class fit -- its bias and gain are another tube's`,
		});
	}
	return warnings;
}
