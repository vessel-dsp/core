// The part registry is an injected parameter, never an import.
//
// This file defines the *shape* of a registry and contains no parts. The compiler
// therefore has no knowledge of any specific chip, which buys three things:
//
//   - tests run against a fake registry: no corpus, no real parts, fast;
//   - compiling with an EMPTY registry shows exactly what works with no part
//     knowledge at all, which is the arbitrary-schematic measurement as a compiler
//     input rather than a separate harness;
//   - the catalog can be artifact-owned data, matching the ownership boundary --
//     this repo owns the compiler, vessel-dsp/artifacts owns what an MN3007 is.

import type { DeviceLaw, MacroModel, PartIdentity } from "./types";

/**
 * One section of a multi-section part: a law plus which of the device's terminals it uses.
 *
 * `terminals` are indices into the device's own terminal list, given in the canonical order the
 * law's lowering expects -- two ends for a two-terminal law, `plus, minus, output` for an op-amp.
 * That order is the contract, because a section bypasses the terminal-role lookup lowering does
 * for a whole device: an 8-pin dual op-amp has two outputs and two inverting inputs, so no single
 * role token can name either of them unambiguously.
 */
export type PartSection = {
	readonly law: DeviceLaw;
	readonly terminals: readonly number[];
};

/**
 * The terminal order a `sections` model's indices assume, as role tokens, index-aligned with the
 * device's own terminal list. `null` means that position carries no role token to check against.
 *
 * **Positional indices are only meaningful against a known declaration order, and the corpus proves
 * two documents can order the same chip differently.** `boss-ce-2b` declares a `TL022CP` as
 * `pin1_OUT_B, pin2_IN_B_MINUS, pin3_IN_B_PLUS, pin4_VEE, pin5_IN_A_PLUS, ...` -- physical pin
 * order -- while `boss-bf-2` declares the same part number grouped by section, as
 * `outA, invertingInputA, nonInvertingInputA, outB, ...`. One entry's `terminals` indices are
 * correct for exactly one of those, and applied to the other they wire an amplifier's output to
 * its input.
 *
 * Without this field that mistake is silent: every index resolves, every section stamps, and the
 * pedal renders a plausible wrong circuit. With it, a document the entry was not written against
 * refuses by name instead. It is the same reasoning as `identify`'s whole-token comparison -- a
 * coverage bound is acceptable, a wrong answer is not.
 */
export type PartPinout = readonly (string | null)[];

/**
 * What the registry knows about a part. Either it reduces to lumped elements the
 * solver can stamp, or it is a DSP algorithm with ports that the runtime implements.
 *
 * **`sections` exists because most real chips are multi-section and neither other arm can express
 * one.** A dual op-amp is two amplifiers on eight pins: not one `law`, which produces a single
 * element, and not a `macro` either, because a macro becomes its own block solved *outside* the MNA
 * system while an op-amp's output depends on the feedback network that depends on its output.
 * Lowering it to a separate DSP block breaks the loop that makes it an amplifier.
 *
 * A `sections` part is expanded by stage 3 into one ordinary device per section, so partitioning,
 * lowering and the runtime see nothing new.
 */
/**
 * Where a macro's ports sit, named by terminal role rather than by terminal index.
 *
 * **This is the same problem `PartPinout` solves for `sections`, with a better answer available.**
 * A positional index is only meaningful against a known declaration order, and the corpus orders
 * one bucket brigade three ways: `boss-ce-2` declares `gnd, cp1, in, vgg, vdd, cp2, out1, out2`,
 * `boss-dm-2` declares the same family part as `gnd, cp2, out1, out2, vdd, cp1, in, vgg`, and
 * `electro-harmonix-electric-mistress` declares a two-terminal shell as `input, output`. One entry
 * carrying indices is correct for exactly one of those and silently mis-wires the rest.
 *
 * `sections` cannot escape indices — a dual op-amp has two outputs and two inverting inputs, so no
 * single role token names either unambiguously, which is why that arm refuses on a pinout guard
 * instead. A macro's audio in and audio out are exactly one terminal each, so a role token *does*
 * name them, and resolving by role is order-independent rather than order-checked. One entry then
 * serves every declaration order that names its terminals at all.
 *
 * The bound is the same one `identify` accepts: whole-token comparison cannot invent a match, but
 * the transcriber must have used a spelling listed here. A packet numbering its pins `pin1..pin8`
 * produces no role tokens and is refused by name rather than guessed at.
 */
export type MacroPortRoles = {
	/** Aliases for the audio input terminal. Compared as whole folded tokens. */
	readonly audioIn: readonly string[];
	/** Aliases for the audio output terminal. Compared as whole folded tokens. */
	readonly audioOut: readonly string[];
	/**
	 * Aliases for a **second** audio output terminal, for a part that has two.
	 *
	 * A BBD is the case this exists for: an MN3208/BL3208 brings out OUT1 and OUT2, and a design
	 * puts a balance trimmer across them because the signal appears on both while the clock
	 * feedthrough appears in antiphase, so the pot nulls the clock and keeps the audio. Declaring
	 * only OUT1 left OUT2 driven by nothing, and the trimmer then acted as a plain attenuator
	 * against whatever bled through its own track -- measured on `mxr-carbon-copy` as **6.0 dB
	 * lost across four brigades at the trimmers' centre default against 0.67 dB with the wipers
	 * on the driven pin**, which a compandor downstream then squared.
	 *
	 * Empty (the default for every part that does not set it) means the part has one output, and
	 * nothing about the single-output path changes.
	 */
	readonly audioOut2?: readonly string[];
	/**
	 * Aliases for the terminal whose network derives the `parameter` port, if the part has one.
	 *
	 * Optional in effect rather than in type: an empty list means the part has none. Unlike the
	 * audio ports, failing to resolve this is not a refusal — `couple.ts` documents an absent
	 * `parameter` port as the safe default, where an absent audio port is an amputation.
	 */
	readonly parameter: readonly string[];
};

/**
 * A macro as the registry states it: everything `MacroModel` carries except the terminal indices
 * and the pedal-specific parameters, which stage 3 resolves per device.
 *
 * Same split as `sections`' op-amp rails, and for the same reason — a registry describes a part,
 * and where its terminals landed and how fast its clock runs are properties of the pedal it was
 * fitted to.
 */
/**
 * 0-indexed physical terminal positions for a document that numbers its pins (`pin1`, `pin2`, ...
 * -- `terminalRoleToken` returns null for those) and so carries no role tokens. Only consulted when
 * every terminal is bare; a document that names even one terminal resolves by role, never by these.
 */
export type MacroBarePinPositions = {
	readonly audioIn: number;
	readonly audioOut: number;
	readonly parameter?: number;
};

export type MacroPartModel = {
	readonly modelId: string;
	/** Part-intrinsic parameters only. Pedal-specific ones are merged in at resolution. */
	readonly parameters: Readonly<Record<string, number>>;
	readonly ports: MacroPortRoles;
	readonly barePinPositions?: MacroBarePinPositions;
	readonly audioPortImpedanceOhms: MacroModel["audioPortImpedanceOhms"];
	readonly parameterReferenceVolts: number | null;
};

export type PartModel =
	| { readonly kind: "law"; readonly law: DeviceLaw }
	| {
			readonly kind: "sections";
			readonly sections: readonly PartSection[];
			/** The declaration order `sections[*].terminals` index into. See `PartPinout`. */
			readonly pinout: PartPinout;
	  }
	| { readonly kind: "macro"; readonly macro: MacroPartModel };

/**
 * The index of the one terminal whose role matches any of `aliases`, or `null`.
 *
 * `null` for no match and for an ambiguous one. Two terminals answering to the same port role is a
 * declaration this entry cannot address — a `SAD1024`'s two cascaded sections both carry an
 * `input` if a document names them that way — and picking the first would be a guess about which
 * half the audio enters.
 */
export function terminalWithRole(
	terminalRoles: readonly (string | null)[],
	aliases: readonly string[],
): number | null {
	const folded = new Set(aliases.map(foldToken));
	const matches = terminalRoles.flatMap((role, index) =>
		role !== null && folded.has(role) ? [index] : [],
	);
	return matches.length === 1 ? (matches[0] as number) : null;
}

/**
 * Does this device declare the terminal order a `sections` entry's indices were written against?
 *
 * Length must match, and every position the entry names must carry that role token. A position the
 * entry leaves `null` is unchecked, which is what lets a part whose document numbers its pins
 * (`pin1`, `pin2`, ... -- `terminalRoleToken` returns null for those) still be expanded.
 */
export function pinoutMatches(
	pinout: PartPinout,
	terminalRoles: readonly (string | null)[],
): boolean {
	if (pinout.length !== terminalRoles.length) {
		return false;
	}
	return pinout.every(
		(role, index) => role === null || foldToken(role) === terminalRoles[index],
	);
}

import type { FirmwareEvidence } from "./firmware-class";
import type { TerminalProfile } from "./terminal-role";
import type { ProxyDeclaration } from "./proxy-declaration";

export type PartEntry = {
	/** Matched whole and case-folded against a device's part number. */
	readonly partIds: readonly string[];
	/** Matched whole against the source's closed type vocabulary. */
	readonly declaredTypes: readonly string[];
	/**
	 * Required terminal role tokens. Every group must be satisfied by at least one
	 * alias, compared as whole tokens. Empty means this part has no pinout signature.
	 */
	readonly terminalRoleGroups: readonly (readonly string[])[];
	readonly model: PartModel;
	/**
	 * **Present when this entry's model is a STAND-IN for a part it is not.** Required for any
	 * macro binding a part whose packets declare its behaviour unavailable, and read by
	 * `report-record-behaviour.ts`: a firmware-blocked part that executes a macro is a fidelity
	 * overclaim **unless** the binding declares itself a proxy and says what it fails to
	 * reproduce. Absent means the entry asserts it models the part.
	 */
	readonly proxy?: ProxyDeclaration;
	/**
	 * **Whether this chip's behaviour comes from a program — typed, with positive evidence.**
	 * Absent means `undetermined`, which is **not** a scope boundary. See `firmware-class.ts`: the
	 * compiler's current operative test reads the packet's *record* rather than the chip, so a
	 * failed dump search becomes "this contains firmware" with nothing demonstrating it.
	 */
	readonly firmware?: FirmwareEvidence;
	/**
	 * **What each terminal IS, with per-terminal evidence.** Absent means `unpopulated`, which is a
	 * correct state rather than a gap: a consumer that needs audio terminals must fall back to
	 * bridging everything and **report its result as an upper bound**.
	 */
	readonly terminalProfile?: TerminalProfile;
	/**
	 * **Which other parts this entry's model ACCOUNTS FOR.** Canonical part ids of devices whose
	 * behaviour is inside this model's abstraction, so a consumer can move them out of an engine-gap
	 * count **with evidence** rather than by a packet-level guess.
	 *
	 * **This is the third instance of one defect.** A macro block carries `kind id modelId
	 * parameters audioIn audioOut parameter modulation clockControl` and **no way to say what it
	 * stands for** — so whoever bound `RDD63H101` to a bucket-brigade had nowhere to write *"and
	 * this also accounts for the three DRAMs and the ladder"*, exactly as whoever wrote
	 * `undisclosed-roland-boss-dsp` had nowhere to write *"this part has no name"*, and exactly as
	 * `open` stood in for five different claims. **Prose in an identity field, a catch-all value,
	 * and a macro that cannot name its scope: three coping strategies, one missing field each.**
	 *
	 * **Deliberately on the ENTRY rather than inside `proxy`**, because subsumption and
	 * approximation are independent: `M50195` is a legitimate model of a fixed-function chip — not
	 * a proxy at all — and it still subsumes the `4164` DRAM it addresses.
	 *
	 * **WITHDRAWN ON ITS FIRST DAY, and that is the field working.** Two entries declared
	 * `subsumes` on 2026-09-11 -- `RDD63H101` claiming three DRAMs and an R2R ladder, `M50195P`
	 * claiming a `4164` -- and all nine claims passed the structural check (12-14 shared nodes) and
	 * then **all nine collapsed under the parameter mutant**. `stages: 1024` is a catalog constant
	 * and `delaySeconds` comes from the owner's own `DelayMs`; neither moves when the subsumed
	 * device's part is changed. The macros are not parameterised by what they claimed to account
	 * for, so the claims were decorative. **A shared bus looks identical either way, which is
	 * exactly what the structural check cannot see.**
	 *
	 * **The field stays; the claims go.** Any future `subsumes` entry must pass
	 * `scripts/report-subsumption-mutant.ts`: mutate the subsumed device's spec and the claiming
	 * macro's parameters must move. **THE DERIVATION IS THE EVIDENCE** -- a subsumption claim that
	 * cannot name which macro parameter the subsumed device determines is as empty as a device
	 * parameter with no source citation, which the triode registry already knows how to carry.
	 */
	readonly subsumes?: readonly string[];
	/**
	 * **Claims that were MADE and REFUTED, kept rather than erased.** "Declared and refuted" is a
	 * different failure from "the record said nothing", and a census that collapses them loses the
	 * distinction between a packet that never spoke and one that spoke and was wrong.
	 */
	readonly subsumesRefuted?: readonly {
		readonly parts: readonly string[];
		readonly refutedBy: string;
		readonly on: string;
	}[];
};

export type PartRegistry = {
	readonly entries: readonly PartEntry[];
};

export const emptyRegistry: PartRegistry = { entries: [] };

/**
 * **A RECORDED READ SET: which part entries a macro's parameter computation actually consulted.**
 *
 * `subsumes` claims that a macro accounts for another device. The mutant tests that claim by
 * changing the device and watching the parameters move — which can fail vacuously if the mutation
 * breaks the packet, as it did on its first run. **This is the cheaper primary check and it cannot
 * fail that way**: if the packet does not compile there is no read set at all, so the verdict is
 * INVALID rather than HOLD.
 *
 * **It is a recorded read, not source analysis.** Parsing our own code to decide what it consults
 * is brittle and rots; wrapping the accessor is exact. And the read set is reusable — it answers
 * *"what does this macro's behaviour actually depend on"* for every macro, not only those carrying
 * a claim.
 */
let activeReadSet: Set<string> | null = null;
const recordedReadSets = new Map<string, Set<string>>();

/** Run `fn` with registry reads recorded against `owner`. Nesting is honoured; the outer set wins. */
export function withRecordedReads<T>(owner: string, fn: () => T): T {
	const previous = activeReadSet;
	const mine = recordedReadSets.get(owner) ?? new Set<string>();
	recordedReadSets.set(owner, mine);
	activeReadSet = mine;
	try {
		return fn();
	} finally {
		activeReadSet = previous;
	}
}

/** What each owner consulted. Keyed by the owner string passed to `withRecordedReads`. */
export function recordedReads(): ReadonlyMap<string, ReadonlySet<string>> {
	return recordedReadSets;
}

/** Forget everything recorded so far. Callers that measure one packet at a time need this. */
export function clearRecordedReads(): void {
	recordedReadSets.clear();
}

export function registryEntryFor(
	registry: PartRegistry,
	identity: PartIdentity,
	terminalCount?: number,
): PartEntry | null {
	if (!identity?.partId) {
		return null;
	}
	// Instrumentation only -- no behaviour change. The returned entry is recorded against
	// whichever owner is currently bracketing this call.
	activeReadSet?.add(foldPartId(identity.partId));
	const entries = registry?.entries ?? [];
	if (terminalCount !== undefined) {
		for (const entry of entries) {
			if (
				(entry.partIds ?? []).some(
					(id) => foldPartId(id) === foldPartId(identity.partId),
				) &&
				(entry.model.kind !== "sections" ||
					entry.model.pinout.length === terminalCount ||
					(entry.terminalRoleGroups?.length > 0 &&
						entry.terminalRoleGroups.length === terminalCount))
			) {
				return entry;
			}
			if (
				(entry.declaredTypes ?? []).some(
					(type) => foldToken(type) === foldToken(identity.partId),
				) &&
				(entry.model.kind !== "sections" ||
					entry.model.pinout.length === terminalCount ||
					(entry.terminalRoleGroups?.length > 0 &&
						entry.terminalRoleGroups.length === terminalCount))
			) {
				return entry;
			}
		}
	}
	for (const entry of entries) {
		if (
			(entry.partIds ?? []).some(
				(id) => foldPartId(id) === foldPartId(identity.partId),
			)
		) {
			return entry;
		}
		if (
			(entry.declaredTypes ?? []).some(
				(type) => foldToken(type) === foldToken(identity.partId),
			)
		) {
			return entry;
		}
	}
	return null;
}

export function registryModelFor(
	registry: PartRegistry,
	identity: PartIdentity,
	terminalCount?: number,
): PartModel | null {
	const entry = registryEntryFor(registry, identity, terminalCount);
	return entry === null ? null : entry.model;
}

/** Part numbers compare ignoring case and separators: `MN-3007` is `mn3007`. */
export function foldPartId(value: string | undefined | null): string {
	return (value ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/** Typed vocabulary values compare ignoring case and whitespace, keeping structure. */
export function foldToken(value: string | undefined | null): string {
	return (value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/gu, "");
}

/**
 * The law a registered part supplies for a device whose class already names its law kind.
 *
 * This is rung 1 of `identify.ts`'s evidence ladder and **only** rung 1: an exact manufacturer
 * part number, compared whole and case-folded. The other two rungs are deliberately unreachable
 * here.
 *
 * - **Declared type is not consulted.** `Circuit.Pentode` is a *class*, and resolving a class to
 *   one part's model would claim every pentode in the corpus is an EL84 — the same reason
 *   `part-catalog.ts` leaves `declaredTypes` empty for op-amps.
 * - **Pinout signature is not consulted.** Every pentode has the same electrodes, so a pinout
 *   match cannot tell an EL84 from a KT66. That is exactly the case where a wrong identity is
 *   worse than none.
 *
 * `lawKind` must match the law the device's class already implies, so an entry can only refine
 * the law that class was going to get. A triode cannot be handed a pentode's fit by a catalog
 * typo; it falls back instead.
 *
 * Returns `null` when nothing matches, which is a correct and expected answer — the caller keeps
 * its device-class default. See `findGenericTubeFits`, which reports every such fallback, because
 * a silent one is what let every amp in the corpus run a 6V6 fit.
 */
export function registryLawFor(
	registry: PartRegistry,
	partNumber: string | null,
	lawKind: DeviceLaw["kind"],
): DeviceLaw | null {
	if (partNumber === null) {
		return null;
	}
	const folded = foldPartId(partNumber);
	for (const entry of registry.entries) {
		if (!entry.partIds.some((id) => foldPartId(id) === folded)) {
			continue;
		}
		if (entry.model.kind === "law" && entry.model.law.kind === lawKind) {
			return entry.model.law;
		}
	}
	return null;
}
