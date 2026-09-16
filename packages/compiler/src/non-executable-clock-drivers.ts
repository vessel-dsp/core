import type { CompileWarning, Netlist, PartIdentity } from "./types";
import type { PartRegistry } from "./registry";
import { registryModelFor } from "./registry";
import { identifyClockFamily } from "./bbd-clock";

/**
 * Scan the resolved lawed netlist for any active components that resolve to empty presence-shells
 * inside the registry, dynamically raising structured warnings to provide total architectural honesty.
 */
export function findNonExecutableClockDrivers(
	netlist: Netlist,
	registry: PartRegistry,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];

	for (const device of netlist.devices) {

		const partId = device.identity.partNumber ?? device.identity.declaredType ?? "";
		const partIdentity: PartIdentity = { partId, evidence: "exact-part" };

		const model = registryModelFor(registry, partIdentity, device.nodes.length);
		if (!model) continue;

		const isClockDriver = identifyClockFamily(device) !== "unknown";

		if (isClockDriver) {
			warnings.push({
				code: "non-executable-clock-driver",
				device: device.id,
				detail: `BBD clock driver ${device.identity.partNumber} is modeled as a non-executable support shell with its rate sweep bypassed and decoupled to BBD parameter ports at the macro level.`,
			});
		} else if (model.kind === "sections" && model.sections.length === 0) {
			warnings.push({
				code: "non-executable-support-shell",
				device: device.id,
				detail: `Component ${device.id} (${device.identity.partNumber}) is admitted as a non-executable support shell; its dynamic electrical and logic behaviors are not modeled.`,
			});
		}
	}

	return warnings;
}
