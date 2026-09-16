/**
 * **What a terminal IS — typed, with per-terminal evidence.**
 *
 * **The defect:** 1260 terminals across the corpus's open devices carry `role: pin`. One value.
 * `vinl` is indistinguishable from `A0`, `SUM` from `VCC`. It is the fourth instance of the
 * missing-field defect and the worst of them, because the first three blocked a classification, a
 * declaration and an ownership claim while **this one blocks a MEASUREMENT**: the fidelity
 * counterfactual must bridge a device's audio-bearing terminals, cannot tell which those are, and
 * therefore bridges all of them — a DRAM's address bus included — giving an upper bound (37) where
 * a number was wanted.
 *
 * **The remediation is a pattern this repository already trusts, not a new design.** The triode
 * registry carries per-parameter `source` citations plus an entry-level
 * `terminalProfileEvidenceStatus`; `CLAUDE.md` names it the provenance template for the whole
 * registry. This is that template extended to the classes that never got it.
 */
export type TerminalRole =
	/** Carries signal. The only role the audio-path counterfactual may bridge. */
	| "audio"
	| "supply"
	| "ground"
	/** Address lines: a bus, never a signal path. */
	| "address"
	/** Data lines, parallel or serial. */
	| "data"
	| "clock"
	/** Mode, enable, reset, chip-select: a parameter stream, not audio. */
	| "control"
	/**
	 * **Added because the corpus forces it.** A DAC's `VREF` sets full-scale output: it is neither a
	 * supply rail nor a signal, and calling it either loses the distinction that makes it useful.
	 * `RKM14L492-103F` in `boss-dd-2` and `boss-dsd-3` carries one.
	 */
	| "reference";

/**
 * **How a role is known. Two kinds, and the second is deliberately weaker.**
 *
 * `direct-source` is the strong kind: a datasheet pinout, a service-note terminal map, or the
 * packet's own declared node role (for `supply`/`ground`, cited to the node ledger) — the way the
 * triode registry cites a Koren coefficient.
 *
 * **`packet-validated-shell` is circumstantial and is named so it reads that way**: it is not the
 * source document saying what a terminal is, it is *our own packet's deck* having pushed a signal
 * through it. It buys the shells that have **no part number at all** —
 * `boss-st-2:ANALOG_INPUT_SUPPORT` can never have a datasheet — at the price of being admissible
 * for exactly one role.
 *
 * **It is asymmetric, and the direction is the unwelcome one.** A deck can only ever ADD an audio
 * terminal, never remove one, so this kind can move a device from `drops` to `stays` and never the
 * reverse. A ceiling that improves because of it is a bug, not a result.
 */
export type TerminalRoleEvidenceKind = "direct-source" | "packet-validated-shell";

/**
 * **A role and the evidence for it. Both required — a role without evidence is refused.**
 *
 * **The banned inference is reading the pin's NAME.** `vinl` looking like audio and `A0` looking
 * like an address is exactly the substring classification `CLAUDE.md` forbids, and it is forbidden
 * because **a pin name is a label, not a fact**. It is also how this corpus already went wrong once:
 * four tremolo optocouplers are wired from their terminals' *names*, one of the two surviving name
 * vocabularies.
 */
export type TerminalRoleEvidence =
	| {
			readonly kind: "direct-source";
			readonly role: TerminalRole;
			/** The cited authority: a datasheet pinout, a service-note terminal map, a node ledger. */
			readonly source: string;
	  }
	| {
			/**
			 * **Admissible for `audio` and nothing else.** Address, data and clock are not evidenceable
			 * this way at all: a deck that drives a bus line proves nothing about what the line carries,
			 * and supply/ground need no deck because the packet already declares them.
			 */
			readonly kind: "packet-validated-shell";
			readonly role: "audio";
			/** The packet-local deck, by path. It must exist and must have passed. */
			readonly deck: string;
			/**
			 * **The specific path through this terminal that the deck exercises**, as the deck's own
			 * driven node and probed node. "The deck covers this component" is NOT this field: the
			 * claim is that signal passes through *this terminal*, and a component-level citation
			 * cannot support a per-terminal claim.
			 */
			readonly signalPath: string;
	  };

/** Strong or circumstantial. Reported wherever a populated profile is summarised. */
export function evidenceStrength(
	e: TerminalRoleEvidence,
): "source" | "circumstantial" {
	return e.kind === "direct-source" ? "source" : "circumstantial";
}

/**
 * **`unpopulated` is a first-class state and a CORRECT outcome**, not a gap. If a role cannot be
 * evidenced it stays unpopulated, and a consumer must handle that rather than guess.
 */
export type TerminalProfile =
	| { readonly status: "unpopulated"; readonly reason: string }
	| {
			readonly status: "populated";
			/** Keyed by the terminal's declared name. */
			readonly terminals: Readonly<Record<string, TerminalRoleEvidence>>;
	  };

export function validateTerminalProfile(p: TerminalProfile): readonly string[] {
	if (p.status === "unpopulated")
		return p.reason.trim() === ""
			? ["`unpopulated` must say why -- an unexplained absence is indistinguishable from an oversight"]
			: [];
	const out: string[] = [];
	for (const [name, e] of Object.entries(p.terminals)) {
		if (e.kind === "direct-source") {
			if (e.source.trim() === "")
				out.push(
					`terminal "${name}" declares role \`${e.role}\` with no source -- A ROLE ASSIGNED WITHOUT EVIDENCE IS REFUSED. Cite a datasheet pinout, a service-note terminal map, or the packet's declared node role.`,
				);
			continue;
		}
		// Checked at runtime as well as in the types: registry entries are authored as data and can
		// reach this function from JSON, where the union's discrimination buys nothing.
		if ((e.role as TerminalRole) !== "audio")
			out.push(
				`terminal "${name}" claims role \`${e.role}\` from \`packet-validated-shell\` -- REFUSED. That kind evidences \`audio\` and nothing else: address, data and clock are not evidenceable from a deck at all, and supply/ground are already evidenced by the packet's declared node role.`,
			);
		if (e.deck.trim() === "")
			out.push(
				`terminal "${name}" claims \`packet-validated-shell\` with no deck -- REFUSED. Name the packet-local deck that passed.`,
			);
		if (e.signalPath.trim() === "")
			out.push(
				`terminal "${name}" claims \`packet-validated-shell\` with no signal path -- REFUSED. "The deck covers this component" cannot support a per-terminal claim; name the driven node and the probed node.`,
			);
	}
	return out;
}

/**
 * **The terminals the audio-path counterfactual may bridge.**
 *
 * **Returns `null` when the profile is unpopulated**, and the caller must then fall back to
 * bridging everything and **report its result as an upper bound** — which is exactly what the
 * ceiling of 37 is today. The distinction between "measured" and "bounded" lives here.
 *
 * **A device needs at least TWO audio terminals to bridge anything.** One audio pin connects
 * nothing, which is why an R2R ladder with eleven data lines and a single `SUM` should leave the
 * audio path once its profile is populated.
 */
export function audioTerminals(p: TerminalProfile | undefined): readonly string[] | null {
	if (p === undefined || p.status === "unpopulated") return null;
	return Object.entries(p.terminals)
		.filter(([, e]) => e.role === "audio")
		.map(([name]) => name);
}
