// Reading a component's devices, and validating a declared device list.
//
// A component models a schematic symbol -- a package -- and a package may hold several devices.
// `Component.devices` states the split; omitting it means the component is one device. Every
// consumer should read through `componentDevices()` so the two shapes are one shape, because the
// alternative is what this construct exists to end: each consumer reconstructing the split from
// terminal names.
//
// See `docs/device-construct-design.md`.

import { isLegalTerminalRole, terminalRolesFor } from "./device-terminal-roles";
import type { Component, ComponentKind } from "./types";

/** A device with its defaults resolved: `kind` filled in, terminals as declared. */
export type ResolvedComponentDevice = Readonly<{
	id: string;
	kind: ComponentKind;
	/** Terminal names, in declaration order. Order carries no meaning; a law binds by role. */
	terminals: readonly string[];
}>;

/**
 * Every device in a component, with defaults resolved.
 *
 * A component that declares no `devices` yields exactly one, whose id is the component's own,
 * whose kind is the component's, and which uses every terminal. That is the overwhelming majority
 * of components, and it is a default rather than a special case: a caller never branches on
 * whether the list was written down.
 */
export function componentDevices(
	component: Component,
): readonly ResolvedComponentDevice[] {
	const declared = component.devices;
	if (declared === undefined || declared.length === 0) {
		return [
			{
				id: component.id,
				kind: component.kind,
				terminals: component.terminals.map((terminal) => terminal.name),
			},
		];
	}
	return declared.map((device) => ({
		id: device.id,
		kind: device.kind ?? component.kind,
		terminals: device.terminals,
	}));
}

/**
 * The role each of a device's terminals declares, keyed by terminal name.
 *
 * This is the binding a device law reads. Scoped to one device on purpose: a dual op-amp declares
 * two of every signal role across its package, and only inside a device is the read unambiguous.
 * A terminal the device names but the component does not declare, or one carrying no role, is
 * absent from the map rather than guessed at -- `validateComponentDevices` is what reports it.
 */
export function deviceTerminalRoles(
	component: Component,
	device: ResolvedComponentDevice,
): ReadonlyMap<string, string> {
	const byName = new Map(
		component.terminals.map((terminal) => [terminal.name, terminal] as const),
	);
	const roles = new Map<string, string>();
	for (const name of device.terminals) {
		const role = byName.get(name)?.role;
		if (role !== undefined) {
			roles.set(name, role);
		}
	}
	return roles;
}

/**
 * One problem with a declared device list.
 *
 * `error` is a malformed declaration -- it refers to a terminal that does not exist, names a
 * device twice, or claims a role the device's kind cannot carry. `warning` is a well-formed
 * declaration that may still be incomplete: a terminal belonging to no device is either
 * decorative or an omission, and the document cannot tell core which.
 */
export type DeviceValidationIssue = Readonly<{
	code: string;
	severity: "error" | "warning";
	message: string;
	componentId: string;
}>;

/**
 * Whether a declared device list is well-formed.
 *
 * **Errors are the document's; the sufficiency of a device's roles is not checked here.** How
 * many plates a rectifier law needs, or whether an op-amp may run without its supplies declared,
 * is the consuming law's question, and encoding one law's expectations in the format would make
 * the format wrong for the next law. What this checks is that the declaration refers to things
 * that exist, does not name the same device twice, and does not claim a role the kind cannot
 * carry.
 *
 * A terminal in no device is a **warning**: it is either decorative (a shield, an unwired lug) or
 * an omission, and the document cannot tell core which.
 */
export function validateComponentDevices(
	component: Component,
): readonly DeviceValidationIssue[] {
	const warnings: DeviceValidationIssue[] = [];
	const declaredNames = new Set(
		component.terminals.map((terminal) => terminal.name),
	);
	const seenDeviceIds = new Set<string>();
	const claimed = new Set<string>();

	for (const device of component.devices ?? []) {
		if (seenDeviceIds.has(device.id)) {
			warnings.push({
				code: "component-device-id-duplicate",
				severity: "error",
				message: `device "${device.id}" is declared more than once`,
				componentId: component.id,
			});
		}
		seenDeviceIds.add(device.id);

		if (device.terminals.length === 0) {
			warnings.push({
				code: "component-device-empty",
				severity: "error",
				message: `device "${device.id}" names no terminals`,
				componentId: component.id,
			});
		}

		const kind = device.kind ?? component.kind;
		const seenInDevice = new Set<string>();
		for (const name of device.terminals) {
			if (!declaredNames.has(name)) {
				warnings.push({
					code: "component-device-terminal-unknown",
					severity: "error",
					message: `device "${device.id}" names terminal "${name}", which this component does not declare`,
					componentId: component.id,
				});
				continue;
			}
			if (seenInDevice.has(name)) {
				warnings.push({
					code: "component-device-terminal-repeated",
					severity: "error",
					message: `device "${device.id}" names terminal "${name}" twice`,
					componentId: component.id,
				});
			}
			seenInDevice.add(name);
			claimed.add(name);

			// A role legal for the package may be illegal for a device of a different kind --
			// an optocoupler's `led` device cannot carry a `wiper`.
			const role = component.terminals.find(
				(terminal) => terminal.name === name,
			)?.role;
			if (role !== undefined && !isLegalTerminalRole(kind, role)) {
				warnings.push({
					code: "component-device-role-illegal",
					severity: "error",
					message: `device "${device.id}" is a ${kind} and uses terminal "${name}", whose role "${role}" a ${kind} cannot carry; legal roles: ${terminalRolesFor(kind).join(", ") || "(none)"}`,
					componentId: component.id,
				});
			}
		}
	}

	if ((component.devices ?? []).length > 0) {
		for (const name of declaredNames) {
			if (!claimed.has(name)) {
				warnings.push({
					code: "component-device-terminal-orphaned",
					severity: "warning",
					message: `terminal "${name}" belongs to no device, so nothing executes it`,
					componentId: component.id,
				});
			}
		}
	}
	return warnings;
}
