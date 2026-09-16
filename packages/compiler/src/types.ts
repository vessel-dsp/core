// Compiler-owned types. Nothing here is imported from the old spine.
//
// The central design property: **geometry and prose are not representable**. There is
// no origin, rotation, x/y, name, Description or Role in any type below, so no stage
// can read one. Evidence discipline is enforced by the shapes, not by review.
//
// The one exception is `DeviceIdentity`, which carries the closed evidence a part can
// be recognised by. Only stage 2 (identify) may read it; it is nested rather than
// inline so that "who is allowed to look at this" is visible at a glance.

/** Electrical node. 0 is always ground. */
export type NodeId = number;

export const GROUND: NodeId = 0;

export type DeviceId = string;
export type ControlId = string;

/**
 * What a device is electrically. Derived from the source's typed component kind, never
 * from a name. For everything except `ic`, the constitutive law follows from this plus
 * parameters, so no identification is required.
 */
export type DeviceKind =
	| "resistor"
	| "capacitor"
	| "inductor"
	| "diode"
	| "potentiometer"
	/** Two-terminal variable resistor. Not a pot: one element, not two halves. */
	| "rheostat"
	| "opamp"
	| "bjt"
	| "jfet"
	| "mosfet"
	/**
	 * A vacuum triode. Grid, cathode and plate — three terminals like a BJT and a
	 * fundamentally different law: no junction, no exponential, and plate current in one
	 * direction only.
	 */
	| "triode"
	/**
	 * A vacuum pentode or beam tetrode. The triode's three electrodes plus a **screen**,
	 * which is what sets the cathode current and makes the plate characteristic flat. 42 of
	 * the corpus's 56 declare exactly `plate, grid, screen, cathode`.
	 */
	| "pentode"
	/**
	 * A vacuum rectifier: plates and one cathode, no grid, and current in one direction only
	 * by the physics rather than by a junction. Every instance in the amp corpus is a **dual**
	 * diode — two plates sharing a directly heated cathode — which is one component and two
	 * elements.
	 */
	| "tube-diode"
	| "transformer"
	| "voltage-source"
	| "jack"
	| "ground"
	| "rail"
	| "switch"
	| "ic"
	| "ota"
	| "inverter"
	| "nand-gate"
	| "clock-driver"
	| "optocoupler"
	| "logic-divider"
	| "analog-switch"
	| "compandor"
	| "bbd"
	| "comparator"
	| "power-amp";

/**
 * Evidence a part can be recognised by, in the order stage 2 consults it.
 *
 * **`partNumber` and `declaredType` are stage 2's alone.** They answer "what is this
 * thing", and a later stage reading them would be deciding behaviour from identity.
 * Everything downstream sees a resolved identity or a refusal, never that evidence.
 *
 * `terminalRoles` is different and is deliberately shared with stage 5, which reads it
 * to tell a diode's anode from its cathode, a pot's wiper from its ends, an op-amp's
 * inverting input, and a supply's polarity. That is not identification: it is which of a
 * device's own terminals is which, it is a whole-token comparison against a closed set,
 * and reading it by position instead is what silently inverted rails, exchanged
 * transistor terminals and shorted pot tracks to ground. An earlier version of this
 * comment said stage 2 only, which the code has never done.
 */
export type DeviceIdentity = {
	/** Manufacturer part number as authored, compared whole and case-folded. */
	readonly partNumber: string | null;
	/** A value from the source's closed type vocabulary, e.g. `Circuit.DelayMemoryChip`. */
	readonly declaredType: string | null;
	/**
	 * Terminal role tokens, in terminal order. Compared as whole tokens against a
	 * closed alias list, never by substring. `null` where a terminal is bare-numbered.
	 */
	readonly terminalRoles: readonly (string | null)[];
	/**
	 * The `role` each terminal **declares**, as core parsed it, or null where it declares none.
	 *
	 * Distinct from `terminalRoles`, which is the folded *name* token. A name is the pin's
	 * identity and a role is what the electrode does; conflating them is what made every stage
	 * carry a spelling table. Prefer this: it is the source's own statement, needs no vocabulary
	 * to interpret, and cannot be ambiguous.
	 *
	 * Null throughout for a document written before `role` existed, which is why the resolvers
	 * keep their declaration-order fallback.
	 */
	readonly declaredTerminalRoles: readonly (string | null)[];
	/**
	 * The coupled coils this component **declares**, as terminal indices in coil order, or null
	 * where it declares none.
	 *
	 * A transformer's terminals belong to coils and the format used not to say which, so this
	 * stage reconstructed the grouping from terminal spellings -- a 110-entry table that covered
	 * the corpus because it was written from it, one packet at a time. `@vessel-dsp/core@0.6.35`
	 * makes the grouping a declaration, so it is read.
	 *
	 * Order is coil order: the ends are the terminals whose own role is `winding`, and a tap sits
	 * physically where the list puts it. That is the fact no spelling could carry --
	 * `secondary_4`/`secondary_8`/`secondary_16` are ordered by their names only by luck.
	 */
	readonly declaredWindings: readonly DeclaredWinding[] | null;
};

/** One declared coil: its role, its optional name, and its terminals in coil order. */
export type DeclaredWinding = Readonly<{
	role: string;
	id: string | null;
	terminalIndices: readonly number[];
	/**
	 * The index, within `terminalIndices`, of the coil's reference tap -- the terminal declaring
	 * `windingCenterTap` -- or null where it declares none.
	 *
	 * A centre tap and an output tap are the same shape and different circuits: about a centre
	 * tap both halves of the coil are live at once, which is what makes a full-wave rectifier
	 * full-wave, while output taps are alternatives of which a selector makes one live. Nothing
	 * this stage can compute separates them, so `@vessel-dsp/core@0.6.36` splits the role and
	 * this is the read.
	 */
	centerTapAt: number | null;
	/**
	 * This coil's rated AC voltage in volts RMS, or null where the source states none.
	 *
	 * Replaced eight component-property spellings folding to five winding classes. A property
	 * keyed on a class holds one value per class, so `orange-rockerverb`'s two filament coils
	 * collapsed into a single `voltsFilament` and its 3.15-0-3.15 V winding was driven at 6 V per
	 * half. Per the coil, per the source (`@vessel-dsp/core@0.6.37`).
	 *
	 * **Per half where the coil declares a centre tap**, end to end otherwise -- the convention a
	 * transformer is printed by, made unambiguous by the declared tap.
	 */
	voltageRmsVolts: number | null;
	/**
	 * Rated impedances, each with the two terminal indices it is rated across.
	 *
	 * The pair is carried because transformers are not rated by one convention: a primary is
	 * printed plate-to-plate, across its centre tap, and a secondary from its common to each tap.
	 * A coil may carry several -- `orange-rockerverb`'s output secondary rates two taps that are
	 * loaded at the same time.
	 */
	readonly impedances: readonly DeclaredWindingImpedance[];
}>;

/** One rated impedance of a coil: the terminal indices it spans, and the value in ohms. */
export type DeclaredWindingImpedance = Readonly<{
	across: readonly [number, number];
	ohms: number;
}>;

export type Device = {
	readonly id: DeviceId;
	readonly kind: DeviceKind;
	/** Node per terminal, in terminal order. Terminal index is the port index. */
	readonly nodes: readonly NodeId[];
	/** Parameters in SI base units. `10k` has already become `10000`. */
	readonly parameters: Readonly<Record<string, number>>;
	/** Set when a control varies this device's parameters. */
	readonly control: ControlId | null;
	readonly identity: DeviceIdentity;
	readonly isLed?: boolean;
	/**
	 * This device's id **within its package**, when the source split the package itself.
	 *
	 * Set only by a `devices:` declaration read through core's `componentDevices`, never by a
	 * registry `sections` expansion -- those two splits must stay tellable apart, because a
	 * registry split already carries the part's law and a source split does not. What reads this
	 * is `packageDeviceParameters`, which is how a registered part's numbers reach a device its
	 * document, rather than its part entry, decided the shape of.
	 */
	readonly packageDeviceId?: string;
};

/**
 * How a 0..1 control position maps to a fraction of a parameter's range.
 *
 * `reverse-linear` is a real track the corpus declares (`klon-centaur`,
 * `vemuram-jan-ray`, `jhs-morning-glory`) and is not the same device as
 * `reverse-logarithmic`: the track is linear, only its direction is reversed.
 */
export type TaperKind =
	| "linear"
	| "logarithmic"
	| "reverse-logarithmic"
	| "reverse-linear";

export type Control = {
	readonly id: ControlId;
	readonly taper: TaperKind;
	/** Position in 0..1. Units never cross this boundary. */
	readonly defaultPosition: number;
	/**
	 * The panel role the document declares for this control, verbatim, or `null` when it
	 * declares none. A closed vocabulary compared as a whole value -- never matched by
	 * substring, and never inferred from the control's id.
	 *
	 * It exists because two devices can straddle the same timing pins with nothing electrical
	 * to separate them: `mxr-carbon-copy` puts `VR3` (the DELAY knob) and `TR3` (a 500k internal
	 * trimmer) across the identical three nodes, so resistance, span and document order all
	 * pick arbitrarily. What the pedal knows and the netlist did not carry is that one of them
	 * is declared `delay-time` and the other is not.
	 */
	readonly role?: string | null;
	/** The panel label declared in deviceInterface.controls, or null when absent. */
	readonly label?: string | null;
};

export type Ports = {
	readonly input: NodeId;
	readonly output: NodeId;
};

export type Netlist = {
	readonly nodes: readonly NodeId[];
	readonly devices: readonly Device[];
	readonly controls: readonly Control[];
	readonly ports: Ports;
	/** What each port's own jack declares, for the chain's seam divider. `null` where absent. */
	readonly portImpedanceOhms: {
		readonly input: number | null;
		readonly output: number | null;
	};
	/**
	 * The full scale a port's own jack declares via `V0dBFS`, in volts. `null` where absent.
	 *
	 * Preferred over the bound `port-full-scale.ts` derives, because it is the source saying
	 * directly what that derivation infers -- and it is the only number at all for a preamp
	 * monitor tap, which has no output transformer to step a rail down.
	 */
	readonly portDeclaredFullScaleVolts: {
		readonly input: number | null;
		readonly output: number | null;
	};
	readonly warnings?: readonly CompileWarning[];
};

// --- stage 2 -----------------------------------------------------------------

/**
 * A resolved part identity. There is deliberately **no confidence field**: a ranked
 * guess has no consumer, and a wrong identity is worse than none because it renders a
 * plausible wrong pedal instead of refusing.
 */
export type PartIdentity = {
	readonly partId: string;
	readonly evidence: "exact-part" | "declared-type" | "pinout";
};

// --- stage 3 -----------------------------------------------------------------

/** A lumped constitutive relation the solver can stamp into a matrix. */
export type DeviceLaw =
	| { readonly kind: "conductance"; readonly siemens: number }
	| {
			/** Conductance that depends on a control position, e.g. a pot. */
			readonly kind: "controlled-conductance";
			readonly control: ControlId;
			readonly taper: TaperKind;
			readonly totalOhms: number;
			/** Which side of the wiper this element is. */
			readonly side: "upper" | "lower";
			/**
			 * Declared-only end resistance: the ohms a leg keeps when the wiper is driven
			 * fully to that end, because a real wiper cannot reach the track's last
			 * millimetre. 0 means an ideal pot whose leg reaches zero.
			 *
			 * Applied so the two legs still sum to `totalOhms` exactly -- each leg is
			 * `residualOhms + share * (totalOhms - 2 * residualOhms)`, so the wiper
			 * travels between the two residuals instead of end to end. That is what makes
			 * this different from `controlled-resistance`'s `minOhms`, which is the bottom
			 * of an independent sweep with no complementary half to conserve.
			 */
			readonly residualOhms: number;
	  }
	| {
			/**
			 * A two-terminal rheostat, whose resistance sweeps `minOhms`..`maxOhms`.
			 *
			 * Deliberately not `controlled-conductance` with a third node left out. A
			 * pot's halves are complementary shares of one fixed track, so `side` is
			 * meaningful; a rheostat is one element sweeping a range, so it carries a
			 * range instead. Sharing the law would make both wrong.
			 *
			 * Both do carry an end resistance, under different names and different
			 * arithmetic: `minOhms` here is the floor of a free sweep, while a pot's
			 * `residualOhms` must be taken out of a fixed track that the other half
			 * still has to complete. An earlier version of this comment said a minimum
			 * was not meaningful for a pot, which confused those two arithmetics for the
			 * physical claim -- a real pot's wiper does stop short of the track end.
			 */
			readonly kind: "controlled-resistance";
			readonly control: ControlId;
			readonly taper: TaperKind;
			readonly minOhms: number;
			readonly maxOhms: number;
	  }
	| {
			/**
			 * A jack's switch contact, closed in the normal playing configuration.
			 *
			 * **Engagement is a property of the port, not a control.** A switched jack's
			 * contact makes or breaks when a plug goes in, and the *sense* follows from the
			 * port's role rather than from the terminal: an input jack closes its contact
			 * when a cable is inserted (grounding the battery, powering the pedal), while a
			 * power jack breaks its contact when an adaptor is inserted (isolating the
			 * battery). Opposite engage states, and both reach the same powered
			 * configuration -- which is why the abstraction has to be the port and not a
			 * switch element with a hardcoded polarity per packet.
			 *
			 * Treating a jack as a pure interface symbol severed the battery return on 5
			 * packets, leaving the supply floating and every op-amp pinned at 0 V.
			 *
			 * The default here is the powered configuration, which both roles agree on.
			 * When ports become first-class, this moves onto the port as an engage state
			 * with a role-derived sense, and the runtime can then unplug the cable.
			 *
			 * The terminals are carried as indices because they are *derived*, not named:
			 * `device-laws` finds the contact by which end of a supply was stranded on it,
			 * and `againstIndex` is whichever terminal completes that supply's path --
			 * the jack's return for a stranded return, the remaining terminal for a
			 * stranded drive. Lowering must not re-guess them from role names: there is no
			 * closed contact-name vocabulary, and the corpus's contacts carry opposite
			 * senses under the same name.
			 */
			readonly kind: "port-engage";
			readonly contactIndex: number;
			readonly againstIndex: number;
	  }
	| {
			readonly kind: "capacitance";
			readonly farads: number;
			/**
			 * Declared-only DC leakage through the dielectric, as a parallel conductance.
			 * 0 means ideal, and ideal is the diagnostic default: at DC an open capacitor
			 * is what makes a mis-transcribed bias network show up as a floating operating
			 * point instead of rendering a plausible wrong answer. A capacitor only gets a
			 * leak when its source declares one, never from a class convention.
			 */
			readonly leakageSiemens: number;
	  }
	| {
			readonly kind: "inductance";
			readonly henries: number;
			/**
			 * Winding DC resistance, ohms. **Absent is not zero**, and the distinction is the point:
			 * every real winding has copper resistance, so zero is physically impossible rather than
			 * merely unusual. A lossless inductor in a feedback loop has unbounded Q, which is how a
			 * marginally stable real amplifier becomes an unstable simulated one.
			 *
			 * Three states, the same three-outcome rule every screen in this corpus needed: a number
			 * (stamped), `"unknown"` (the packet states the source does not give it -- reported as an
			 * unmodelled parameter, stamped as lossless), and absent (nobody has said anything --
			 * a diagnostic). There is deliberately **no default**: defaulting to zero would preserve
			 * every current number and leave all 67 corpus windings quietly wrong, which is how this
			 * arrived.
			 */
			readonly seriesResistanceOhms?: number | "unknown";
		}
	| {
			readonly kind: "diode";
			readonly saturationCurrent: number;
			readonly emissionCoefficient: number;
			readonly thermalVoltage: number;
			/**
			 * Reverse breakdown voltage in volts, or 0 for an ordinary diode.
			 *
			 * A zener's whole purpose is to conduct in reverse at a defined voltage, so without
			 * this a zener-regulated rail never clamps and floats to the supply instead. 25 of
			 * the corpus's diodes declare it, across 18 packets.
			 */
			readonly breakdownVolts: number;
			/**
			 * Series bulk resistance in ohms (Rs). Real diodes have ohmic resistance (e.g. 0.05 Ohm for
			 * power rectifiers like 1N4007, 0.5-1.0 Ohm for signal diodes like 1N4148). Solved in
			 * closed form via Lambert-W junction split with no extra matrix unknowns.
			 */
			readonly seriesResistance?: number;
			readonly isLed?: boolean;
	  }
	| {
			readonly kind: "voltage-source";
			readonly volts: number;
			/** Series source impedance in ohms. See `SUPPLY_SOURCE_OHMS` in `device-laws.ts`. */
			readonly sourceOhms: number;
	  }
	| {
			/**
			 * A sinusoidal EMF at a declared frequency: a mains inlet, a filament winding, a
			 * signal generator. The DC law above with a frequency is **not** the same device,
			 * which is why this is a separate kind rather than an optional field.
			 *
			 * The name asymmetry is historical: the DC law is `voltage-source` because it was the
			 * only one, and the two stamps it lowers to are `dc-source` and `ac-source`.
			 */
			readonly kind: "ac-source";
			/**
			 * Peak amplitude in volts, for both the runtime's `sin()` evaluation and the ngspice
			 * deck's `SIN` amplitude parameter (itself peak). The source states an RMS magnitude
			 * and a unit (`{value: 120, unit: "V"}`) — that reading is a project convention, not
			 * a prose read: the word "RMS" lives only in `raw`, which no stage may read, and
			 * mains is quoted RMS by universal convention. `device-laws.ts`'s `ac-source` branch
			 * of `voltage-source` converts the declared RMS magnitude to this peak amplitude via
			 * `AC_SOURCE_RMS_TO_PEAK`; see that branch for the full reasoning and the escape
			 * hatch for a packet that ever means peak.
			 */
			readonly amplitudeVolts: number;
			readonly frequencyHz: number;
			/** Series source impedance in ohms, exactly as the DC law carries it. */
			readonly sourceOhms: number;
	  }
	| {
			/**
			 * A switch is a conductance controlled by a 0..1 position, which is why it
			 * needs no new solver capability: it is just another controlled element.
			 * Modelling it this way keeps one document yielding one netlist, instead of
			 * compiling a separate program per switch combination.
			 */
			readonly kind: "switch";
			readonly control: ControlId;
			readonly onOhms: number;
			readonly offOhms: number;
	  }
	| {
			/**
			 * A switch with a common terminal and two or more throws, which routes
			 * rather than opens. Distinct from `switch`, whose two terminals only make
			 * or break: a selector's throws are alternatives, so the same control that
			 * closes one opens the others.
			 */
			readonly kind: "selector";
			readonly control: ControlId;
			readonly onOhms: number;
			readonly offOhms: number;
	  }
	| {
			/** Ebers-Moll, transport form. NPN or PNP by polarity. */
			readonly kind: "bjt";
			readonly polarity: "npn" | "pnp";
			readonly saturationCurrent: number;
			readonly forwardBeta: number;
			readonly reverseBeta: number;
			readonly thermalVoltage: number;
			/**
			 * Excess collector-base leakage beyond the ideal junction, in amps, or 0.
			 *
			 * This is germanium's defining electrical difference and the reason a Fuzz Face
			 * biases at all: the leakage flowing out of the base through its bias resistor is
			 * what sets the operating point, which is also why those pedals drift with
			 * temperature. Ebers-Moll's ideal reverse current is the declared saturation
			 * current, around 1 nA, and a real germanium part leaks 100 to 1000 times that.
			 */
			readonly leakageAmps: number;
	  }
	| {
			/**
			 * Shichman-Hodges, shared by JFET and MOSFET: they differ in the sign and
			 * magnitude of the threshold, not in the equations, so one law serves both
			 * rather than two nearly-identical code paths.
			 */
			readonly kind: "fet";
			readonly channel: "n" | "p";
			/** Pinch-off (JFET, negative) or threshold (enhancement MOSFET, positive). */
			readonly thresholdVolts: number;
			readonly transconductance: number;
			readonly channelLengthModulation: number;
			/**
			 * Gate-source junction conduction, the same softplus the triode's grid uses:
			 * `Ig = gateSaturationCurrent * log1p(exp((Vgs - onset)/scale))`, with `Vgs`
			 * already channel-signed so one law covers n and p.
			 *
			 * **`gateSaturationCurrent: 0` disables it, and that is the correct value for a
			 * MOSFET** — an insulated gate draws no current at any bias, which is what this
			 * law did for every FET before. A *JFET's* gate is a real PN junction, and
			 * without it the solver can park at a forward-biased `Vgs` no physical part can
			 * hold: `boss-cs-2`'s `Q2` sat at `+0.350 V` and `boss-ds-2`'s `Q15` at
			 * `+0.596 V`, both with zero gate current, which made two switch diagnoses
			 * unreadable until the junction was added.
			 *
			 * On the law rather than as runtime constants for the reason the triode's grid
			 * states: when a gate starts drawing current is a property of the device.
			 */
			readonly gateSaturationCurrent: number;
			readonly gateOnsetVolts: number;
			readonly gateScaleVolts: number;
	  }
	| {
			/**
			 * Koren's triode: `Ip = (2/kg1) * E1^ex` with
			 * `E1 = (Vpk/kp) * ln(1 + exp(kp * (1/mu + Vgk/sqrt(kvb + Vpk^2))))`.
			 *
			 * Five parameters and no part number, which is the same shape the generic BJT
			 * already has: the law is the device class, and a registry entry refines it.
			 */
			readonly kind: "triode";
			readonly mu: number;
			readonly kg1: number;
			readonly kp: number;
			readonly kvb: number;
			readonly ex: number;
			/**
			 * Grid conduction: `Ig = gridSaturationCurrent * log1p(exp((Vgk - onset)/scale))`.
			 *
			 * On the law rather than as runtime constants, because when a grid starts drawing
			 * current is a property of the tube. The runtime plan's own audit lists
			 * `OPAMP_OPEN_LOOP_GAIN` living in the engine as a defect — "a *device parameter*"
			 * — and this would be the same mistake.
			 */
			readonly gridSaturationCurrent: number;
			readonly gridOnsetVolts: number;
			readonly gridScaleVolts: number;
			/**
			 * Contact potential, added to `Vgk` inside the Koren exponent.
			 *
			 * A standard term in this model that this law omitted. It is load-bearing, not a
			 * correction: the published Koren 12AX7 set reproduces RCA's typical point to +2% with
			 * `Vct = 0.5` and to **-58%** without it. A fit made against a law that has no `Vct`
			 * must absorb it by distorting the other coefficients, which is what an `ex` of 1.0
			 * and a `kvb` of 9707 look like. `0` reproduces the previous behaviour exactly.
			 */
			readonly contactPotentialVolts: number;
	  }
	| {
			/**
			 * Koren again, but **screen-referenced**: the screen sets the cathode current and
			 * the plate only gates it, which is why a pentode's plate curves are flat where a
			 * triode's are not.
			 *
			 *   E1 = (Vsk/kp) * ln(1 + exp(kp * (1/mu + Vgk/sqrt(kvb + Vsk^2))))
			 *   Ip = (2/kg1) * E1^ex * atan(Vpk / kvb)
			 *
			 * Note `Vsk` where the triode has `Vpk`. Exactly the triode's five coefficients --
			 * `kvb` does double duty, conditioning the screen term and setting the plate knee.
			 *
			 * **`atan`, not `tanh`, and this was worth 26-34% of plate current.** The gate used to
			 * be `tanh` against a shared, invented 40 V knee, which saturates at 1.0 by ~150 V.
			 * Koren's pentode gates with `atan(Vp/Kvb)`, which reaches 1.34-1.52 at 250 V and keeps
			 * rising, and every catalogued fit was generated against it -- so `kg1` already carried
			 * that factor and `tanh` discarded it. Switching the gate moved five tubes from 26-34%
			 * low at their own datasheet point to within 1.5% for four of them, each by a factor
			 * equal to `atan(Va/kvb)` for its *own* `kvb`, which is why one shared correction could
			 * not have faked it. `scripts/check-tube-curves.ts` is the check.
			 *
			 * It is also the more physical shape: `tanh` flattens to a dead-level top, so plate
			 * resistance went to infinity and needed a `1e-12` conductance floor to keep the matrix
			 * non-singular. `atan` keeps a gentle finite slope above the knee, which is what a real
			 * pentode's plate curves do.
			 */
			readonly kind: "pentode";
			readonly mu: number;
			readonly kg1: number;
			readonly kp: number;
			readonly kvb: number;
			readonly ex: number;
			readonly gridSaturationCurrent: number;
			readonly gridOnsetVolts: number;
			readonly gridScaleVolts: number;
			/**
			 * Contact potential, added to `Vgk` inside the Koren exponent.
			 *
			 * A standard term in this model that this law omitted. It is load-bearing, not a
			 * correction: the published Koren 12AX7 set reproduces RCA's typical point to +2% with
			 * `Vct = 0.5` and to **-58%** without it. A fit made against a law that has no `Vct`
			 * must absorb it by distorting the other coefficients, which is what an `ex` of 1.0
			 * and a `kvb` of 9707 look like. `0` reproduces the previous behaviour exactly.
			 */
			readonly contactPotentialVolts: number;
			/**
			 * The screen's share of the plate current, as a fraction. The screen draws a SHARE of
			 * the conduction, never a constant: a fixed Ig2 cannot be supplied through a
			 * high-impedance feed (245 V through 4.7 M is 52 uA at most), so it drove the screen to
			 * -2575 V and the solver from 3 to 1024 Newton iterations with 100 % held samples. The
			 * share is the 5:1 plate:screen split at the datasheet point (Ig2 0.6 mA / Ia 3.0 mA,
			 * i.e. the screen's 1/6 share of the total cathode current), so `screenShare = 0.2`
			 * gives `screenCurrent = plateCurrent * 0.2`. Self-consistent and degrading gracefully:
			 * as the screen sags, conduction falls, the share falls, the feed drop falls, and the
			 * loop settles instead of diverging. `0` or absent reproduces today's behaviour (no
			 * screen<->cathode source). Present only where a datasheet figure exists.
			 */
			readonly screenShare?: number;
	  }
	| {
			/**
			 * Child-Langmuir space charge: `Ia = perveance * max(Vak, 0)^exponent`, and nothing in
			 * reverse.
			 *
			 * Two parameters where the triode has eight, because a rectifier has no grid to
			 * control it: what it does is drop a voltage that depends on the current drawn through
			 * it, which is the whole of tube-rectifier sag.
			 */
			readonly kind: "tube-diode";
			/** `K` in amps per volt^exponent. Datasheet-anchored; see `GENERIC_TUBE_DIODE`. */
			readonly perveance: number;
			/**
			 * The space-charge exponent, 3/2.
			 *
			 * Carried on the law rather than hardcoded in the executor for the reason the runtime
			 * plan's audit names: a device parameter living in the engine is the
			 * `OPAMP_OPEN_LOOP_GAIN` defect. It is physics rather than a fit, and it is **held
			 * constant far from the anchor**, which is a known limitation of this law rather than a
			 * knob — a wide-tolerance datasheet cross-check on a GZ34 recorded ~22% drift from a
			 * constant exponent far from its anchor current.
			 */
			readonly exponent: number;
	  }
	| {
			/** Ideal transformer: V_primary = ratio * V_secondary, power conserved. */
			readonly kind: "transformer";
			/**
			 * Winding DC resistance, ohms, per winding. Three states exactly as `inductance`:
			 * a number, `"unknown"` when the packet states the source does not print it, and
			 * absent. **No default** -- zero is physically impossible for a winding, and
			 * defaulting to it is how every corpus transformer came to be ideal.
			 */
			readonly seriesResistanceOhms?: number | "unknown";
			/**
			 * The single declared ratio, from a source `Ratio` or a typed impedance pair.
			 * Applied uniformly to every secondary winding by `transformerWindings` -- exact
			 * for a transformer with one secondary (tapped or not), and the only path for a
			 * transformer whose primary carries signal, which is every output transformer
			 * and every reverb tank.
			 */
			readonly turnsRatio: number;
			/**
			 * Each declared coil's own EMF as a **peak** amplitude in volts, **one entry per
			 * declared winding in declaration order**, `null` where the source states no
			 * voltage for that coil. Peak rather than RMS for the same reason `ac-source`'s
			 * `amplitudeVolts` is, and converted in the same one place: the source states
			 * RMS, `device-laws.ts` applies `sqrt(2)` once.
			 *
			 * **Positional, not keyed by winding class.** It was a `Record` keyed on a class
			 * name, and a class holds one value: `orange-rockerverb`'s two filament coils
			 * collapsed into one entry and its 3.15-0-3.15 V winding was driven at 6 V per
			 * half. Index alignment with `identity.declaredWindings` is by construction --
			 * both are built from the same array in the same order.
			 *
			 * Contains a non-null entry only for a transformer the source specifies by its
			 * **coil voltages** rather than by a ratio, which in practice is a mains power
			 * transformer. Then `turnsRatio` is meaningless and unused: the coils are lowered
			 * as independent `ac-source` EMFs and no primary is modelled at all. See
			 * `transformerWindings` in `transformer.ts` for what that models and what it
			 * cannot.
			 *
			 * A value is exact whether or not the coil is centre-tapped -- it is the voltage
			 * across the pair a stamp uses, which for a tapped coil is the per-half figure by
			 * the corpus's own convention (`370-0-370` is stated as `370`), so it is applied
			 * to each half directly and never doubled.
			 */
			readonly windingAmplitudeVolts: readonly (number | null)[];
			/**
			 * The mains frequency in Hz the driven windings run at, or `null` when the
			 * document states none. Only read when `windingAmplitudeVolts` is non-empty, and
			 * a `null` there is a refusal rather than a default: a winding voltage with no
			 * frequency is not a waveform.
			 */
			readonly mainsFrequencyHz: number | null;
			/** Series impedance of each driven winding, in ohms. See `SUPPLY_SOURCE_OHMS`. */
			readonly windingSourceOhms: number;
	  }
	| { readonly kind: "open" }
	| {
			/**
			 * Operational Transconductance Amplifier (OTA): output current is transconductance
			 * times the input voltage difference: I_out = gm * (V_in+ - V_in-).
			 */
			readonly kind: "ota";
			readonly transconductance: number;
			readonly saturationCurrent?: number;
			readonly thermalVoltage?: number;
			/**
			 * Index of the negative supply terminal.
			 *
			 * Which array it indexes depends on which path built this law, and the two
			 * frames are deliberately different: a `sections` catalog entry indexes the
			 * section's *own* mapped terminals, while the role-bound path below indexes
			 * the device's full declared terminal list. Each path sets it in its own
			 * frame, so never move a `veeIndex` between them.
			 */
			readonly veeIndex?: number;
			/**
			 * Which declared terminals carry the signal pins, when they were bound by
			 * role rather than by position.
			 *
			 * Absent means "index positionally", which is what a `sections` catalog entry
			 * wants: it has already reordered the section's terminals, so 0/1/2/3 are
			 * correct there. Present means the device named its own terminals and those
			 * names were matched as whole tokens.
			 *
			 * `bias: null` is a positive statement, not a missing value: the device
			 * declares no amplifier-bias terminal, so this is a linear OTA. Falling back
			 * to position 3 there is what silently bound `moogerfooger-mf-102`'s bias to
			 * its positive supply rail.
			 */
			readonly terminalIndices?: {
				readonly plus: number;
				readonly minus: number;
				readonly output: number;
				readonly bias: number | null;
			};
	  }
	| {
			/** CMOS Inverter Gate: complementary MOSFET pair or transconductance current injection. */
			readonly kind: "inverter";
			readonly transconductance: number;
			readonly biasVolts?: number;
			readonly thresholdVolts?: number;
	  }
	| {
			/** CMOS NAND Logic Gate: output is high (VDD) if not both inputs are high. */
			readonly kind: "nand-gate";
			readonly thresholdVolts: number;
			readonly transconductance: number;
	  }
	| {
			/** BBD Clock Driver: propagates the slowly-varying LFO control rate. */
			readonly kind: "clock-driver";
			readonly defaultFrequency?: number;
	  }
	| {
			/** Optocoupler / Vactrol: input LED and output light-dependent resistor (LDR) */
			readonly kind: "optocoupler";
			readonly ledThresholdVolts: number;
			readonly ledTransconductance: number;
			readonly ldrMinOhms: number;
			readonly ldrMaxOhms: number;
			/**
			 * A part-specific LED-current -> LDR-resistance curve, `ohms = coefficient *
			 * amps^exponent`, clamped to `[ldrMinOhms, ldrMaxOhms]`. Both fields must be present
			 * together or both absent. Absent (the default for every part except one with a cited
			 * datasheet curve) keeps the existing `ldrMinOhms + (ldrMaxOhms-ldrMinOhms) *
			 * exp(-1000*amps)` law bit-identical -- see `runoffgroove-tremulus-lune`'s VTL5C2 entry
			 * in `part-catalog.ts` for the one part currently carrying this fit.
			 */
			readonly ldrPowerLawCoefficientOhms?: number;
			readonly ldrPowerLawExponent?: number;
	  }
	| {
			/**
			 * Op-amp: the output is driven so that v(+) == v(-), until it reaches a
			 * supply rail and saturates. The rails are not a part fact and do not need
			 * a part number -- they come from the supplies present in the circuit, so
			 * an unlabelled op-amp still clips correctly.
			 */
			readonly kind: "ideal-opamp";
			readonly railHigh: number | null;
			readonly railLow: number | null;
			/**
			 * Open-loop DC gain, dimensionless.
			 *
			 * A class default of 1e5 was used for every op-amp in the corpus while 31 of 52 declared
			 * something else -- 200k on 21 of them, 300k on five, and 3000 on one. Every measurement of
			 * op-amp stiffness, the saturation band and the step limiter was taken at the default.
			 */
			readonly openLoopGain: number;
	  }
	| {
			readonly kind: "logic-divider";
			readonly thresholdVolts: number;
			readonly highVolts: number;
	  }
	| {
			readonly kind: "analog-switch";
			readonly onOhms: number;
			readonly offOhms: number;
			readonly thresholdVolts: number;
	  }
	| {
			/**
			 * One channel of an NE570/571-class compandor, as the datasheet's own block
			 * diagram draws it (onsemi NE570/D Rev. 4, Figure 5).
			 *
			 * **This law describes the chip, not one of its application circuits.** The
			 * datasheet builds an expander (Figure 6) and a compressor (Figure 7) from the
			 * same silicon -- "a compressor is essentially an expander placed in the
			 * feedback loop of the op amp" -- so the compression *direction* is a property
			 * of how the packet wires these pins, never of this law. An earlier version
			 * hard-coded gain proportional to `1/envelope`, which is to say it hard-coded
			 * the compressor: a packet wired as Figure 7 then compressed twice, and one
			 * wired as Figure 6 expanded not at all.
			 *
			 * All five resistors are internal to the chip and all are read from Figure 5,
			 * where each is drawn with its value. They are fields rather than constants
			 * because `R3` and `R4` are the two the datasheet explicitly invites the
			 * designer to change ("External resistors may be placed in series with R3 ...
			 * or in parallel with R4").
			 */
			readonly kind: "compandor";
			/** Rectifier input resistor, 10 k. `IG = 2 * VIN(avg) / R1` (Figure 9). */
			readonly r1: number;
			/** G-cell input resistor, 20 k. `IIN = VIN / R2` (Figure 12). */
			readonly r2: number;
			/** Internal op-amp feedback resistor, 20 k, brought out on pin 6/11. */
			readonly r3: number;
			/**
			 * Summing-node bias resistor, 30 k, to **ground** rather than to VREF.
			 *
			 * Ground is not a guess: the datasheet states the expander output "will bias
			 * to 3.0 V" via `VOUT_DC = (1 + R3/R4) * VREF = (1 + 20k/30k) * 1.8 V`. That
			 * is the non-inverting-amplifier form, which only holds with R4 to ground --
			 * returned to VREF it would carry no current and leave the output at 1.8 V.
			 * The stated 3.0 V is therefore an arithmetic check on the topology, and it
			 * is asserted as one.
			 */
			readonly r4: number;
			/**
			 * Rectifier averaging resistor, 10 k (Figure 8's `R5`).
			 *
			 * With the **external** CRECT on pin 1/16 this sets the detector time
			 * constant, `tau = R5 * CRECT`. Nothing here fixes that time constant: the
			 * capacitor is a real component in the packet and the MNA solve integrates
			 * it, which is the whole reason the chip brings the node out to a pin.
			 */
			readonly r5: number;
			/** The G cell's reference current `I1`, 140 uA (Figure 12's `IB`). */
			readonly iBias: number;
			/** Internal band-gap reference, 1.8 V. The op-amp's non-inverting input. */
			readonly vrefVolts: number;
			/** Open-loop DC gain of the internal op-amp. */
			readonly openLoopGain: number;
			/**
			 * Supply rails for the internal op-amp, null in the registry and substituted by
			 * stage 3 from the package's own supply pins -- the same treatment a declared
			 * `ideal-opamp` section gets, and for the same reason: a registry describes a
			 * part, and the rails belong to the pedal it is fitted to.
			 *
			 * Not cosmetic. In the Figure 7 compressor the gain cell is the *only* AC
			 * feedback -- the external network is a T whose midpoint is shunted to ground,
			 * so it feeds back at DC and not at audio. Gain is therefore set by the cell
			 * alone and is unbounded until the detector charges, `R5 * CRECT` = 2.2 ms on
			 * an SA571 with the datasheet's 0.22 uF. Left unrailed, `mxr-carbon-copy`'s
			 * compressor answered a 2 ms burst with a **195 V** excursion out of a part
			 * running on 9 V, and drove 8 V of AC into a BBD input.
			 */
			readonly railHigh: number | null;
			readonly railLow: number | null;
	  }
	| {
			/**
			 * Spring reverb tank -- a **mechanical** delay medium, not a circuit.
			 *
			 * This is the same category as the BBD die: no arrangement of R, L and C in the
			 * netlist produces it, so MNA cannot make it emerge and it needs its own operator.
			 * A tank was previously admitted as a two-winding `transformer` (its declared
			 * `Circuit.Transformer` shell with `InputImpedance`/`OutputImpedance`), which is
			 * electrically the right *interface* and acoustically silent: an ideal transformer
			 * is memoryless, so send-to-return was a wire with a turns ratio and every Fender
			 * reverb amp rendered its reverb control as a mix of a signal with no reverb in it.
			 *
			 * The parameters are device facts keyed to an exact part number, the same standing
			 * `part-catalog.ts` entries have. Accutronics/Belton codes state them directly:
			 * `4AB3C1B` is input code `A` (8 Ohm), output code `B` (2250 Ohm), decay code `3`
			 * (long, 2.75-4.0 s). The impedances are cross-checked against the packet's own
			 * declared `InputImpedance`/`OutputImpedance` rather than replacing them.
			 */
			readonly kind: "spring-reverb";
			readonly inputOhms: number;
			readonly outputOhms: number;
			/** Transducer-to-transducer transit time of the longest spring. */
			readonly delaySeconds: number;
			/** Time to -60 dB, from the part number's decay code. */
			readonly decaySeconds: number;
			/**
			 * Allpass sections per spring. A real spring is dispersive -- high frequencies
			 * travel faster than low -- which is what makes the "boing" rather than an echo.
			 */
			readonly dispersionStages: number;
	  }
	| {
			readonly kind: "comparator";
			readonly pullDownOhms: number;
			readonly floatOhms: number;
			readonly sensitivity: number;
	  };

/** A region the compiler does not solve. Exists only when the registry fills it. */
export type MacroModel = {
	/**
	 * Which DSP algorithm executes this region — **not which chip this is.**
	 *
	 * A runtime implements a closed set of algorithms and refuses any other by name (see
	 * `IMPLEMENTED_MODELS` in `src/runtime/reference-runtime.ts`); a registry entry names one of
	 * them and carries the part's own numbers in `parameters`. That split is what keeps the
	 * console/ROM invariant true for *parts* as well as for stamps: an MN3007 and an MN3005 are
	 * both a bucket-brigade delay line differing in `stages`, so adding either is registry data
	 * and no runtime change — while a compander, an OTA or a PT2399's digital core is a
	 * different algorithm, and legitimately does need runtime work before it can be heard.
	 *
	 * Deliberately `string` and not a union declared here. The vocabulary belongs to whichever
	 * runtime is executing rather than to this compiler: a second implementer (C++, WASM,
	 * ESP32) holds a shorter list than the reference runtime, and a `decode`d program's
	 * `modelId` is untrusted text from another producer. A closed union here would make the
	 * runtime's check read as vacuous — the same reasoning `unimplementedOperators` records for
	 * taking `readonly string[]`.
	 */
	readonly modelId: string;
	readonly parameters: Readonly<Record<string, number>>;
	/** Port index -> terminal index on the device. `portTerminals[0]` is audio in, `[1]` audio out. */
	readonly portTerminals: readonly number[];
	/**
	 * The `coupled` port's boundary impedances (build-order step 1, spec clause 2): `input` is
	 * the admittance this macro presents to its driver (stamped as an ordinary `conductance`
	 * into the driver's own block), `output` is the source impedance behind its write-back
	 * (stamped as a `macro-audio-source`, which carries the same `sourceOhms` shape
	 * `dc-source` already does). `null` when the part declares no audio boundary at all, which
	 * keeps the port absent rather than defaulted to an ideal (zero-impedance) one nothing in
	 * a registry ever measured.
	 */
	readonly audioPortImpedanceOhms: {
		readonly input: number;
		readonly output: number;
	} | null;
	/**
	 * Device terminal index whose node feeds the `parameter` port's derivation (a clock
	 * network setting a delay time), or `null` when this part has none. Distinct from
	 * `portTerminals`, which is audio only.
	 */
	/**
	 * The source node an LFO reaches a modulated BBD clock on, resolved by
	 * `resolveClockModulationSource`, with the device that steers it.
	 *
	 * A **source node**, not a terminal index, because unlike `parameterTerminal` this node is
	 * not on the delay device at all -- it is the control terminal of a transistor elsewhere in
	 * the clock circuit. `couple.ts` maps it to a block row.
	 */
	readonly modulationNode?: number | null;
	readonly modulationSteeredBy?: string | null;
	readonly parameterTerminal: number | null;
	/**
	 * The clock network's own nominal reference voltage -- part-intrinsic data, like the
	 * impedances above, not a fact `couple.ts` could derive from the netlist. `null` exactly
	 * when `parameterTerminal` is `null`.
	 */
	readonly parameterReferenceVolts: number | null;
	/**
	 * Clock-governed control binding (Phase 4): when the delay macro's clock network contains
	 * a potentiometer or rheostat bound to a control, this carries the physical parameters
	 * so the runtime can dynamically evaluate the live delay time as the knob sweeps.
	 */
	readonly clockControl?: MacroClockControl | null;
	/**
	 * Whether `parameters.delaySeconds` was DERIVED from the clock network in the packet, or
	 * DECLARED as a `DelayMs` property and copied through. `null` for a macro whose model has no
	 * delay at all.
	 *
	 * Carried so a consumer can tell a simulated delay from a reported one without re-deriving
	 * it, and so `compile` can warn about the second without refusing it.
	 */
	readonly delayProvenance?: "derived" | "declared" | null;
	/** Why derivation did not happen, when `delayProvenance` is `declared`. */
	readonly delayDeclaredReason?: string | null;
};

export type MacroClockControl = {
	readonly controlId: ControlId;
	readonly taper: TaperKind;
	readonly ohmsAtControlMin: number;
	readonly ohmsAtControlMax: number;
	readonly farads: number;
	readonly stages: number;
	readonly formulaConstant: number;
};

/**
 * Why an identification-requiring device was given an `open` law.
 *
 * Recorded at the one place that knows -- the branch in `resolveDevice` that chose it -- rather
 * than re-derived by the reporter from the same predicates. That is deliberate and it is the
 * lesson of two separate defects on 2026-09-03: a reporter that asks its own copy of the
 * resolver's question drifts from it silently, and the drift shows up as a device wired one way
 * and reported another. Here the reporter reads the decision instead of repeating it.
 *
 * `electrically-isolated` has its own dedicated warning (`electrically-isolated-ic`) and is
 * tagged only so `findIcsNotExecuted` can exclude it by the decision rather than by guessing.
 */
export type OpenIcReason =
	| "source-boundary-shell"
	| "registry-arity-mismatch"
	| "electrically-isolated"
	| "charge-pump-declared-rail"
	| "registry-open"
	| "declared-class-without-model";

export type DeviceResolution =
	| {
			readonly outcome: "law";
			readonly device: DeviceId;
			readonly law: DeviceLaw;
			/**
			 * Set only on an `open` law for an `ic`/`power-amp`. Absent everywhere else, including
			 * on the `open` a ground symbol or an unwired jack contact gets -- those carry no
			 * element because the symbol has none, which is not a hole in the model.
			 */
			readonly openReason?: OpenIcReason;
			/**
			 * For `declared-class-without-model`: the refusal this `open` replaced, verbatim.
			 *
			 * Carried so the warning is actionable. "No model bound" is a fact; *which* lookup
			 * failed and how is what tells a reader whether the fix is a registry entry, a pinout,
			 * or a packet correction.
			 */
			readonly insteadOfRefusal?: string;
	  }
	| {
			readonly outcome: "macro";
			readonly device: DeviceId;
			readonly macro: MacroModel;
	  }
	| {
			readonly outcome: "unsupported";
			readonly device: DeviceId;
			readonly reason: string;
	  };

export type LawedNetlist = {
	readonly netlist: Netlist;
	readonly resolutions: readonly DeviceResolution[];
};

// --- stage 4 -----------------------------------------------------------------

export type RegionKind = "linear" | "nonlinear" | "macro";

export type Region = {
	readonly id: string;
	readonly kind: RegionKind;
	readonly devices: readonly DeviceId[];
	readonly nodes: readonly NodeId[];
	/** Set when kind is "macro". */
	readonly macro: MacroModel | null;
	/** Controls whose devices sit inside this region. */
	readonly controls: readonly ControlId[];
};

export type Partitioning = {
	readonly regions: readonly Region[];
	/** Region ids this region's parameters depend on. A dependency graph, not a list. */
	readonly dependencies: Readonly<Record<string, readonly string[]>>;
};

// --- stage 5 / 6 -------------------------------------------------------------

/**
 * A stamp contributes to the MNA system. Values that depend on a control or on the
 * sample rate are left symbolic here and evaluated at initialization, which is what
 * makes a program rate-independent and knob-responsive without re-lowering.
 */
export type Stamp =
	| {
			readonly kind: "conductance";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly siemens: number;
	  }
	| {
			readonly kind: "controlled-conductance";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly control: ControlId;
			readonly taper: TaperKind;
			readonly totalOhms: number;
			readonly side: "upper" | "lower";
			/** Declared-only end resistance; see the law of the same name. 0 is ideal. */
			readonly residualOhms: number;
	  }
	| {
			readonly kind: "controlled-resistance";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly control: ControlId;
			readonly taper: TaperKind;
			readonly minOhms: number;
			readonly maxOhms: number;
	  }
	| {
			readonly kind: "optocoupler";
			readonly ldrA: NodeId;
			readonly ldrB: NodeId;
			readonly ledAnode: NodeId;
			readonly ledCathode: NodeId;
			readonly ledThresholdVolts: number;
			readonly ledTransconductance: number;
			readonly ldrMinOhms: number;
			readonly ldrMaxOhms: number;
			readonly ldrPowerLawCoefficientOhms?: number;
			readonly ldrPowerLawExponent?: number;
	  }
	| {
			/** Trapezoidal companion; the conductance is 2C/dt, so it needs the rate. */
			readonly kind: "capacitor";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly farads: number;
			readonly stateIndex: number;
	  }
	| {
			/** Trapezoidal companion; the conductance is dt/2L, so it needs the rate. */
			readonly kind: "inductor";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly henries: number;
			readonly stateIndex: number;
			/**
			 * Series winding resistance, ohms. Absent means the law carried no value -- either the
			 * packet declared `unknown` or it said nothing -- and the branch is stamped lossless,
			 * which is the behaviour every corpus packet has today. It is never defaulted to zero,
			 * because absent and zero are different claims: see the `inductance` law.
			 */
			readonly seriesResistanceOhms?: number;
	  }
	| {
			readonly kind: "diode";
			readonly anode: NodeId;
			readonly cathode: NodeId;
			readonly saturationCurrent: number;
			readonly emissionCoefficient: number;
			readonly thermalVoltage: number;
			readonly breakdownVolts: number;
			readonly seriesResistance?: number;
			readonly device?: string;
			readonly isLed?: boolean;
	  }
	| {
			readonly kind: "switch";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly control: ControlId;
			readonly onOhms: number;
			readonly offOhms: number;
	  }
	| {
			/** One throw of a selector: closed only while the control selects it. */
			readonly kind: "selector";
			readonly common: NodeId;
			readonly throwNode: NodeId;
			readonly control: ControlId;
			readonly throwIndex: number;
			readonly throwCount: number;
			readonly onOhms: number;
			readonly offOhms: number;
	  }
	| {
			/**
			 * A supply between two nodes, not a potential asserted against ground.
			 *
			 * A battery names both terminals and 8 corpus packets return theirs to
			 * something other than ground; asserting `V(positive) = volts` there ties the
			 * wrong node to the supply and discards the span the source declares. A
			 * one-terminal rail sets `negative` to ground, which is what it means.
			 */
			readonly kind: "dc-source";
			readonly positive: NodeId;
			readonly negative: NodeId;
			readonly volts: number;
			readonly sourceIndex: number;
			/**
			 * Series source impedance in ohms. `0` is an ideal source and reduces the stamp
			 * exactly to the ideal form, so this is safe to ignore only when zero.
			 *
			 * This is what makes a rail's voltage depend on what the circuit draws from it —
			 * the "supply state" step of the power-domain rail/sag contract, and the thing
			 * that separates a battery from an adapter. See
			 * `thoughts/shared/experiments/power-domain-rail-sag-contract/`.
			 */
			readonly sourceOhms: number;
	  }
	| {
			/**
			 * A sine EMF between two nodes, in series with `sourceOhms`, exactly as `dc-source`
			 * sits between two nodes rather than asserting a potential against ground.
			 *
			 * **A separate operator rather than a field on `dc-source`.** A runtime that predates
			 * this kind refuses a program carrying it by name, which is the cartridge lockout the
			 * plan requires; an extra field would have let such a runtime execute a mains inlet as
			 * a 120 V battery — plausible, silent and completely wrong, which is the defect this
			 * operator exists to remove.
			 *
			 * The waveform is `amplitudeVolts * sin(2*pi*frequencyHz*t)`, with `t` measured from
			 * the runtime's `prepare`. There is no phase and no DC offset: nothing in the source
			 * states either, and a field no packet can fill is a field nothing checks. At `t = 0`
			 * the EMF is 0, which is also what ngspice's initial transient solution reports for
			 * `SIN(0 a f)` — measured, not assumed.
			 */
			readonly kind: "ac-source";
			readonly positive: NodeId;
			readonly negative: NodeId;
			readonly amplitudeVolts: number;
			readonly frequencyHz: number;
			readonly sourceIndex: number;
			readonly sourceOhms: number;
	  }
	| {
			readonly kind: "bjt";
			readonly base: NodeId;
			readonly collector: NodeId;
			readonly emitter: NodeId;
			readonly polarity: "npn" | "pnp";
			readonly saturationCurrent: number;
			readonly forwardBeta: number;
			readonly reverseBeta: number;
			readonly thermalVoltage: number;
			/**
			 * Excess collector-base leakage beyond the ideal junction, in amps, or 0.
			 *
			 * This is germanium's defining electrical difference and the reason a Fuzz Face
			 * biases at all: the leakage flowing out of the base through its bias resistor is
			 * what sets the operating point, which is also why those pedals drift with
			 * temperature. Ebers-Moll's ideal reverse current is the declared saturation
			 * current, around 1 nA, and a real germanium part leaks 100 to 1000 times that.
			 */
			readonly leakageAmps: number;
	  }
	| {
			readonly kind: "fet";
			readonly gate: NodeId;
			readonly drain: NodeId;
			readonly source: NodeId;
			readonly channel: "n" | "p";
			readonly thresholdVolts: number;
			readonly transconductance: number;
			readonly channelLengthModulation: number;
			/** See the `fet` device law: 0 means an insulated gate and stamps nothing. */
			readonly gateSaturationCurrent: number;
			readonly gateOnsetVolts: number;
			readonly gateScaleVolts: number;
	  }
	| {
			readonly kind: "triode";
			readonly grid: NodeId;
			readonly cathode: NodeId;
			readonly plate: NodeId;
			readonly mu: number;
			readonly kg1: number;
			readonly kp: number;
			readonly kvb: number;
			readonly ex: number;
			readonly gridSaturationCurrent: number;
			readonly gridOnsetVolts: number;
			readonly gridScaleVolts: number;
			/**
			 * Contact potential, added to `Vgk` inside the Koren exponent.
			 *
			 * A standard term in this model that this law omitted. It is load-bearing, not a
			 * correction: the published Koren 12AX7 set reproduces RCA's typical point to +2% with
			 * `Vct = 0.5` and to **-58%** without it. A fit made against a law that has no `Vct`
			 * must absorb it by distorting the other coefficients, which is what an `ex` of 1.0
			 * and a `kvb` of 9707 look like. `0` reproduces the previous behaviour exactly.
			 */
			readonly contactPotentialVolts: number;
	  }
	| {
			readonly kind: "pentode";
			readonly grid: NodeId;
			readonly cathode: NodeId;
			readonly plate: NodeId;
			readonly screen: NodeId;
			readonly mu: number;
			readonly kg1: number;
			readonly kp: number;
			readonly kvb: number;
			readonly ex: number;
			readonly gridSaturationCurrent: number;
			readonly gridOnsetVolts: number;
			readonly gridScaleVolts: number;
			/**
			 * Contact potential, added to `Vgk` inside the Koren exponent.
			 *
			 * A standard term in this model that this law omitted. It is load-bearing, not a
			 * correction: the published Koren 12AX7 set reproduces RCA's typical point to +2% with
			 * `Vct = 0.5` and to **-58%** without it. A fit made against a law that has no `Vct`
			 * must absorb it by distorting the other coefficients, which is what an `ex` of 1.0
			 * and a `kvb` of 9707 look like. `0` reproduces the previous behaviour exactly.
			 */
			readonly contactPotentialVolts: number;
			/**
			 * The screen's share of the plate current, stamped as a screen<->cathode source
			 * `screenCurrent = plateCurrent * screenShare`. `0` is a no-op (no screen source), so a
			 * law without a screen figure behaves exactly as before. See the DeviceLaw field for
			 * why a share rather than a fixed current.
			 */
			readonly screenShare: number;
	  }
	| {
			/**
			 * One plate of a vacuum rectifier against its cathode. A dual diode is **two of
			 * these** sharing a cathode node, which is what it is electrically -- one envelope,
			 * two independent conduction paths -- so no operator has to know about envelopes.
			 *
			 * Needs no auxiliary row: it is a two-terminal nonlinear conductance, exactly like a
			 * junction diode, and unlike one it carries no exponential.
			 */
			readonly kind: "tube-diode";
			readonly plate: NodeId;
			readonly cathode: NodeId;
			readonly perveance: number;
			readonly exponent: number;
	  }
	| {
			readonly kind: "transformer";
			readonly primaryPlus: NodeId;
			readonly primaryMinus: NodeId;
			readonly secondaryPlus: NodeId;
			readonly secondaryMinus: NodeId;
			readonly turnsRatio: number;
			readonly sourceIndex: number;
			/**
			 * Copper loss for this winding pair, as the loop resistance **referred to the
			 * primary**: `R_primary + turnsRatio^2 * R_secondary`. One number rather than two,
			 * because the constraint row carries a single auxiliary unknown (the primary current)
			 * and a series impedance there is one matrix entry -- the same shape `input-source`
			 * already uses. Absent means the windings declared nothing and the transformer is
			 * ideal, which is every corpus packet today.
			 *
			 * **This is copper only.** A real iron-core transformer also has core loss
			 * (hysteresis and eddy currents) and leakage inductance, and at low frequencies core
			 * loss is typically the LARGER damping term. Neither is modelled here, so a null
			 * result from adding this does not clear the ideal-transformer hypothesis -- see
			 * ledger 27.
			 */
			readonly seriesResistanceOhms?: number;
	  }
	| {
			readonly kind: "input-source";
			readonly node: NodeId;
			readonly sourceIndex: number;
	  }
	| {
			readonly kind: "ideal-opamp";
			readonly plus: NodeId;
			readonly minus: NodeId;
			readonly output: NodeId;
			/**
			 * Open-loop DC gain, dimensionless.
			 *
			 * A class default of 1e5 was used for every op-amp in the corpus while 31 of 52 declared
			 * something else -- 200k on 21 of them, 300k on five, and 3000 on one. Every measurement of
			 * op-amp stiffness, the saturation band and the step limiter was taken at the default.
			 */
			readonly openLoopGain: number;
			readonly sourceIndex: number;
			readonly railHigh: number | null;
			readonly railLow: number | null;
	  }
	| {
			/**
			 * The `coupled` port's load side (build-order step 1, spec clause 2): a same-sample
			 * voltage source whose magnitude is a named macro's current write-back rather than a
			 * value carried on the stamp, with a series `sourceOhms` exactly as `dc-source`
			 * already has -- the port carries value **and** admittance, never a bare sample. The
			 * runtime resolves `macroId` to whichever macro block declares `audioOut: true` with
			 * that id; there is exactly one such block in every program this compiler emits,
			 * because `couple.ts` only ever wires a macro's own output to one downstream stamp.
			 *
			 * Single-ended (implicit ground return), matching `input-source`'s shape rather than
			 * `dc-source`'s two-node one: a macro's boundary equivalent is a tap into one net, not
			 * a floating supply between two named terminals.
			 */
			readonly kind: "macro-audio-source";
			readonly node: NodeId;
			readonly macroId: string;
			readonly sourceOhms: number;
			readonly sourceIndex: number;
	  }
	| {
			/** Voltage-Controlled Current Source (VCCS), representing an OTA transconductance cell. */
			readonly kind: "vccs";
			readonly outP: NodeId;
			readonly outN: NodeId;
			readonly inP: NodeId;
			readonly inN: NodeId;
			readonly transconductance: number;
			readonly biasVolts?: number;
	  }
	| {
			readonly kind: "ota";
			readonly plus: NodeId;
			readonly minus: NodeId;
			readonly bias: NodeId;
			readonly output: NodeId;
			readonly vee: NodeId;
			readonly saturationCurrent: number;
			readonly thermalVoltage: number;
	  }
	| {
			readonly kind: "logic-divider";
			readonly clockNode: NodeId;
			readonly qNode: NodeId;
			readonly gndNode: NodeId;
			readonly thresholdVolts: number;
			readonly highVolts: number;
			readonly sourceIndex: number;
			readonly stateIndex: number;
	  }
	| {
			readonly kind: "clock-driver";
			readonly cp1: NodeId;
			readonly cp2: NodeId;
			readonly vgg: NodeId;
			readonly vdd: NodeId;
			readonly ox1: NodeId;
			/**
			 * The part's own GND pin, which is **not** circuit ground.
			 *
			 * The clock phases swing between the two supply pins. Before this row existed the
			 * stamp swung them between `vdd` and literal ground, which is right only when the
			 * GND pin happens to sit there -- and a faithful +9 V transcription puts it on the
			 * positive rail instead, leaving `vdd` at ground and every output pinned at zero.
			 * `boss-ch-1` and `boss-dm-3` were both silent for exactly that reason.
			 */
			readonly gnd: NodeId;
			readonly defaultFrequency: number;
			readonly stateIndex: number;
			readonly sourceIndex: number;
	  }
	| {
			readonly kind: "analog-switch";
			readonly a: NodeId;
			readonly b: NodeId;
			readonly control: NodeId;
			readonly onOhms: number;
			readonly offOhms: number;
			readonly thresholdVolts: number;
	  }
	| {
			/**
			 * The two *active* parts of a compandor channel: the full-wave averaging
			 * rectifier and the variable-gain cell.
			 *
			 * Everything else in the datasheet's Figure 5 -- the five internal resistors,
			 * the band-gap reference and the output op-amp -- lowers to ordinary
			 * `conductance`, `dc-source` and `ideal-opamp` stamps, so the runtime gained
			 * no new linear machinery for this part and the external circuit decides what
			 * the chip does. See `lower.ts`'s `compandor` case.
			 */
			readonly kind: "compandor";
			/** Pin 2/15, RECT_IN. Drives the detector through `r1`. */
			readonly rectIn: NodeId;
			/** Pin 1/16, CRECT. The averaging node; the packet's own cap sets `tau`. */
			readonly rectCap: NodeId;
			/** Pin 3/14, G_CELL_IN. The gain cell's signal input, through `r2`. */
			readonly cellIn: NodeId;
			/**
			 * Pin 5/12, INV_IN -- the internal op-amp's summing node, which is where the
			 * gain cell delivers its output *current*.
			 *
			 * Not the chip's OUTPUT pin. The gain cell is a current source and the op-amp
			 * converts that current to a voltage through whatever feedback the packet
			 * hangs on pin 6; injecting into the output pin instead would make the gain
			 * depend on the output loading rather than on the feedback resistor.
			 */
			readonly sumNode: NodeId;
			/** The internal 1.8 V band-gap node, allocated by lowering. */
			readonly vref: NodeId;
			readonly r1: number;
			readonly r2: number;
			readonly r5: number;
			readonly iBias: number;
			readonly stateIndex: number;
	  }
	| {
			/**
			 * Spring reverb tank. See the `spring-reverb` device law for why this is an
			 * operator rather than something MNA can produce.
			 *
			 * Two single-ended ports, both stamped the way the rest of this file stamps a
			 * source with an internal impedance: the input pair is the drive coil's load, and
			 * the output pair is a Thevenin source at the pickup's rated impedance whose value
			 * is the tank's own delayed, dispersed, decaying output. `sourceIndex` names the
			 * auxiliary row that carries it, and doubles as this tank's runtime state key --
			 * unique per stamp within a block, because `lower.ts` allocates it that way.
			 */
			readonly kind: "spring-reverb";
			readonly inputPlus: NodeId;
			readonly inputMinus: NodeId;
			readonly outputPlus: NodeId;
			readonly outputMinus: NodeId;
			readonly inputOhms: number;
			readonly outputOhms: number;
			readonly delaySeconds: number;
			readonly decaySeconds: number;
			readonly dispersionStages: number;
			readonly sourceIndex: number;
	  }
	| {
			readonly kind: "comparator";
			readonly plus: NodeId;
			readonly minus: NodeId;
			readonly output: NodeId;
			readonly vee: NodeId;
			readonly pullDownOhms: number;
			readonly floatOhms: number;
			readonly sensitivity: number;
	  };

/**
 * One operator the runtime must implement to execute a program: a stamp's kind.
 *
 * Named separately from `Stamp` because it is the unit of the **cartridge lockout** —
 * `Program.requiredOperators` is a list of these, and a runtime missing one refuses the
 * program instead of executing the rest. Derived from the union rather than written out,
 * so a new stamp kind cannot be added without joining the declared set.
 */
export type OperatorKind = Stamp["kind"];

export type StampPartition = {
	/**
	 * The full nonlinear port set for this block: every row some stamp's law actually writes,
	 * sorted and de-duplicated, strictly excluding ground (node 0).
	 */
	readonly portRows: readonly number[];
	/** Indices into `block.stamps` that are linear (`stampPortRows === null`). */
	readonly linearStampIndices: readonly number[];
	/** Indices into `block.stamps` that are nonlinear (`stampPortRows !== null`). */
	readonly nonlinearStampIndices: readonly number[];
	/** Indices into `block.stamps` that are constant (no control, state, or signal dependency). */
	readonly constantStampIndices: readonly number[];
	/** Indices into `block.stamps` that read a control knob. */
	readonly controlStampIndices: readonly number[];
	/** Indices into `block.stamps` that carry dynamic/reactive state (capacitors, inductors, logic dividers, etc.). */
	readonly dynamicStampIndices: readonly number[];
};

export type SparseSchedule = {
	readonly ops: readonly number[];
	/** Number of stored entries: the pattern plus its fill-in. */
	readonly slots: number;
	readonly factorCount: number;
	/** Slot -> matrix row/column, for gathering the stamped dense matrix into `values`. */
	readonly gatherRow: readonly number[];
	readonly gatherColumn: readonly number[];
	readonly size: number;
	/** Multiply-adds the schedule performs, against what the dense elimination would. */
	readonly sparseOps: number;
	readonly denseOps: number;
	/** Pivot steps that had to fall back to a not-provably-nonzero entry. Diagnostic. */
	readonly unprovenPivots: number;
};

export type Block =
	| {
			readonly kind: "mna";
			readonly id: string;
			/**
			 * How many node unknowns this block solves. Always `nodeIds.length` — the two are
			 * set together at the single site that builds them (`lowerRegion`), and this one
			 * exists because the runtime reads it in its innermost loops.
			 */
			readonly nodeCount: number;
			/**
			 * Row index -> the source `NodeId` that row stands for. `nodeIds[0]` is always
			 * `GROUND`, because the runtime pins row 0 and starts its gmin loop at 1.
			 *
			 * **A block's rows are numbered 0..nodeCount-1, not by the node ids the document
			 * authored.** They used to be the same thing: the row index *was* the authored id,
			 * so a block's matrix was sized by the largest node label in its region rather than
			 * by how many nodes it has. Two things then inflated it independently — a document
			 * numbering a net `900` (`jhs-424-gain-stage` labels its +10 V rail that, and got a
			 * 909-unknown matrix for a 30-node circuit), and a multi-region document, where
			 * regions are node-disjoint but each one's matrix still spanned the *global* id
			 * range up to its own maximum (`boss-os-2`: 46 regions, the driven one sized 354).
			 * Corpus-wide that was 77,062 analog rows where 4,829 nodes exist, and the padding
			 * rows carried nothing but `gmin`.
			 *
			 * This array is the inverse map, and it is not optional bookkeeping: several
			 * consumers bridge a solved row back to a declared net — the ngspice deck names
			 * (`scripts/lib/program-to-spice.ts`, which must stay in the same namespace as
			 * `source-to-spice.ts` or parity compares two different nodes and still reports
			 * agreement), the declared-rail check in `report-transistor-bias.ts`, and the node
			 * labels `report-signal-path.ts` and `render-v2-audio.ts --held` print. Use
			 * `blockNodeIndex` for the forward direction.
			 *
			 * Every node of every device in the region is kept, including terminals no device
			 * law stamps (an op-amp's `vcc`/`vee`). The renumbering is a bijection on the
			 * region's node set, so no node is removed and nothing about what the block models
			 * changes.
			 */
			readonly nodeIds: readonly NodeId[];
			/** Extra unknowns for voltage sources and op-amp outputs. */
			readonly auxCount: number;
			readonly stamps: readonly Stamp[];
			/**
			 * Compile-time stamp partition for linear/nonlinear, control, and constant stamps.
			 * Derived once at compile time and emitted on the program as data.
			 */
			readonly stampPartition: StampPartition;
			/**
			 * Compile-time static sparse elimination schedule.
			 * Derived once at compile time and emitted on the program as data.
			 */
			readonly sparseSchedule: SparseSchedule | null;
			readonly stateCount: number;
			/**
			 * No stamp here has to be re-evaluated inside a Newton loop, so the block solves in
			 * a single pass. Read by the runtime to choose between one solve and the iteration
			 * cap, and derived from the stamps rather than from the region's device list — see
			 * `stampNeedsNewton`.
			 *
			 * Stated positively rather than as `nonlinear` because it is a **licence**: the
			 * false case costs iterations, and the true case is what later build steps are
			 * allowed to exploit. A flag whose safe default is `false` should read as the thing
			 * being claimed.
			 */
			readonly linear: boolean;
			/**
			 * No stamp here reads a control, so this block's coefficients do not change when a
			 * knob moves.
			 *
			 * The other half of "may this be factored once at load". `linear` alone is not
			 * enough and the difference is not bookkeeping: gate 1c measured a state-space
			 * realisation derived at one control position and evaluated at another to be wrong
			 * by 80% of the signal (`4.19e-02` against a `5.23e-02` reference RMS). So a
			 * precomputation gated on `linear` alone would be exact on the fixture that derived
			 * it and wrong on the same circuit one knob-turn later.
			 *
			 * Also from the stamps, because a control-bearing *device* need not lower to a
			 * control-bearing stamp: a switched jack's `port-engage` contact becomes a plain
			 * conductance.
			 */
			readonly controlFree: boolean;
			/**
			 * True when symbolic elimination (DK reduction) is admitted for this block.
			 * Admitted when the block is nonlinear and the reduction ratio (unknowns / portCount) >= 4.0.
			 */
			readonly eliminate: boolean;
			/** Null when this region does not contain the circuit's input jack. */
			readonly inputNode: NodeId | null;
			/** Null when this region does not contain the circuit's output jack. */
			readonly outputNode: NodeId | null;
			/**
			 * Where the operating-point solve starts, for nodes whose initial value decides
			 * which of several DC solutions the block settles into. Empty for the ordinary
			 * case of a circuit with one solution.
			 */
			readonly operatingPointSeeds: readonly OperatingPointSeed[];
	  }
	| {
			readonly kind: "macro";
			readonly id: string;
			/**
			 * The DSP algorithm this block executes, copied from the registry's `MacroModel` —
			 * see `MacroModel.modelId` for what it names and why it is not a chip number.
			 *
			 * This is the block's whole instruction: the runtime's dispatch reads it, and
			 * `Program.requiredModels` declares it so a runtime that lacks the algorithm refuses
			 * the program by name at load instead of executing some other algorithm's code.
			 */
			readonly modelId: string;
			readonly parameters: Readonly<Record<string, number>>;
			/**
			 * The `coupled` port's driver side (build-order step 1, spec clause 2): the block and
			 * node this macro taps for its audio input. Same-sample and read-only from here --
			 * the *loading* this represents is stamped as a `conductance` into `block` itself, not
			 * modelled at this port, which is why this port carries no admittance of its own: it
			 * is a `Voc`-side tap, not the `Yin` (see `MacroModel.audioPortImpedanceOhms.input`,
			 * which is where that admittance is declared and stamped from).
			 */
			readonly audioIn: {
				readonly block: string;
				readonly node: NodeId;
			} | null;
			/**
			 * The `coupled` port's load side: `null` unless some block carries a
			 * `macro-audio-source` stamp naming this macro's `id`. Carried on the macro rather
			 * than derived, so the macro's own audio-out existence is a program fact rather than
			 * something a consumer has to search every block's stamps to learn.
			 */
			readonly audioOut: boolean;
			/**
			 * Whether this block's `parameters.delaySeconds` came from the packet's own clock
			 * network or from a `DelayMs` typed into the source. See `MacroModel.delayProvenance`.
			 */
			readonly delayProvenance?: "derived" | "declared" | null;
			readonly delayDeclaredReason?: string | null;
			/**
			 * Set when this part declares a modulation input, the document wires it, and
			 * admission refused it -- the difference between a flanger and a fixed comb filter.
			 * `null`/absent when the port was admitted or the part has none.
			 */
			readonly modulationRefusal?: string | null;
			/**
			 * The `parameter` port (build-order step 1, spec clause 1): present only when
			 * admission proved the PURITY precondition -- the derivation reads nothing but this
			 * node, and neither of gate 1b's two measured failure modes applies (no audio-path
			 * active device shares this node's region, no control is reachable from it). `null`
			 * on missing or negative evidence, which is the spec's safe default: this repository's
			 * runtime does not read an unvalidated node as a delay-scale substitute, `stages`
			 * alone is used instead, and no pedal is refused for lacking this port.
			 */
			readonly parameter: ParameterPort | null;
			/**
			 * The `modulation` port: the **signal-rate** sibling of `parameter`, read every
			 * sample rather than when a control moves.
			 *
			 * It exists because `parameter` deliberately cannot serve a chorus.
			 * `experiments/clock-parameter-port-gate/README.md` measured the boundary and named
			 * the failing case: an LFO-swept clock "turns the `parameter` port into a `signal`
			 * by definition". That finding is respected rather than worked around -- the gate
			 * stays narrow and this is a different port with a different contract.
			 *
			 * `null` unless the compiler resolved exactly one steering device with exactly one
			 * control terminal off the timing network. See `resolveClockModulationSource`.
			 */
			readonly modulation?: ModulationPort | null;
			readonly clockControl?: MacroClockControl | null;
	  };

/**
 * The `parameter` port: a scalar another operator derives, admitted only under the PURITY
 * precondition `clock-parameter-port-gate` measured -- gate 1b, and the compiler-plan's
 * operator-format spec clause 1. `referenceVolts` normalises the read node's solved voltage to
 * a ~1.0-scale factor the macro's own parameters (e.g. `stages`) are multiplied by, so a
 * fixture's registry data stays in its own natural units rather than volts.
 */
export type ParameterPort = {
	/** Which block's solved node this scalar is derived from. */
	readonly block: string;
	readonly node: NodeId;
	readonly referenceVolts: number;
};

/**
 * The `modulation` port: a solved node read every sample, scaling a delay macro's length.
 *
 * **The node is a steering device's control terminal, never the timing node itself.** A BBD's
 * timing node carries the oscillator at the clock rate -- ~100 kHz for a chorus -- which no
 * 48 kHz host can sample; reading it would alias. The control terminal carries the LFO alone.
 *
 * The law the runtime applies is `delay = base * (Vdc / V)`, where `Vdc` is the node's own
 * settled level. A steering transistor converts its control voltage into the charging current
 * of the oscillator's timing capacitor, so `f_clock` rises with `V` and the delay, being
 * `stages / (2 * f_clock)`, falls with it. Self-normalising by construction: at the operating
 * point `V == Vdc`, the scale is 1, and the delay is exactly the base the program carries.
 *
 * **What this does not claim.** The linear voltage-to-current assumption is the steering
 * device's small-signal behaviour, not a datasheet law, and no absolute clock frequency is
 * derived anywhere. The port modulates a base delay whose own provenance is unchanged and
 * separately reported by `delayProvenance` -- so a packet whose base is `declared` gets a sweep
 * around an unevidenced centre, which is an improvement in kind and not a fidelity claim.
 */
export type ModulationPort = {
	/** Which block's solved node this is read from, every sample. */
	readonly block: string;
	readonly node: NodeId;
	/** The device whose control terminal this is, carried for diagnostics. */
	readonly steeredBy: string;
};

/**
 * A `.nodeset`-style hint: where the operating-point solve starts, not a forced voltage.
 *
 * Newton still solves the circuit. This exists because a circuit with more than one DC
 * solution has its answer *chosen* by the initial guess, and `fill(0)` chooses the
 * symmetric one — see `latch-seed.ts`.
 */
export type OperatingPointSeed = {
	readonly node: NodeId;
	readonly volts: number;
};

/**
 * Rate-independent facts about the *executed* program (`order`'s blocks, not every
 * retained one — the same rule `requiredOperators` follows and for the identical reason:
 * a block `executionOrder` prunes never runs under any runtime, so its cost cannot be a
 * cost this program's execution needs to be admitted against) that a real-time admission
 * decision needs.
 *
 * **Deliberately excludes any bound on Newton iteration counts.** Peak and steady
 * iterations are properties of the signal and the control position, not of the circuit
 * alone — `scripts/report-newton-deadline.ts` measures them empirically for exactly this
 * reason, because there is no static derivation. Fabricating one here would be worse than
 * declaring none: an admission surface built on invented numbers is worse than no
 * admission surface. What bounds worst-case cost instead is the enforced iteration *cap*
 * (`prepare()`'s own `maxNewtonIterations`), which is a host/runtime parameter rather than
 * a program fact — it does not describe what this circuit needs, it describes how much
 * iteration any circuit is allowed before its sample is held rather than iterated further.
 * See `src/runtime/admission.ts` for how the cap and these predictors combine with a
 * host-supplied budget into a fail-closed decision, and why that combination — not this
 * type alone — is what the tension "cost is program x machine x rate x block size" means
 * in practice: this type is the program's honest half only.
 */
export type CostPredictors = {
	/** `order.length` — the blocks actually solved once per sample. */
	readonly executedBlockCount: number;
	/** Reactive/state memory summed across executed blocks. */
	readonly stateCount: number;
	/**
	 * Every executed MNA block's solved system size, and whether it may iterate.
	 * `linear: true` solves once per sample; `linear: false` may iterate up to the
	 * runtime's enforced cap. A `macro` block contributes nothing here — its `modelId`
	 * names DSP rather than a stamp, so it presents no system to solve. That is also why it
	 * contributes nothing to `requiredOperators`, and why it is declared in
	 * `requiredModels` instead rather than left undeclared.
	 *
	 * A macro's own per-sample cost is declared in `macroBlocks` instead — see that field for
	 * why it is a parallel list rather than a fabricated `unknownCount` here.
	 */
	readonly solvedBlocks: readonly {
		readonly blockId: string;
		/** `nodeCount + auxCount` — the size of the dense system one solve involves. */
		readonly unknownCount: number;
		readonly linear: boolean;
	}[];
	/**
	 * Every executed `macro` block, by id and by the algorithm it names.
	 *
	 * **This field exists because its absence was a hole in the gate, not a rounding error.**
	 * A macro presents no system to solve, so it contributes nothing to `solvedBlocks` — and
	 * admission summed `solvedBlocks` and nothing else, which meant a macro's per-sample work
	 * was not merely under-counted but *invisible*: a program of nothing but macro blocks was
	 * costed at zero and admitted unconditionally. That was survivable while one program held
	 * one delay line; it is not survivable in a chain, where the whole premise is that costs
	 * add and a slot whose cost reads zero silently buys headroom the host does not have.
	 *
	 * **It carries no number, deliberately, and that is the point.** Nothing in a `modelId` or
	 * its `parameters` bounds an algorithm's work, so a per-model nanosecond constant invented
	 * here would be the admission surface built on invented numbers this type's own doc
	 * refuses. What a program can honestly declare is *which algorithms run, and how many
	 * times per sample each one runs* — exactly the rate- and machine-independent half.
	 * Pricing them is the host's half, supplied as `RealtimeBudget.nsPerMacroSample`
	 * (`src/runtime/admission.ts`), which refuses by name when it has no price for a model
	 * this list declares. Same division as `requiredModels`: the compiler declares, the
	 * runtime refuses.
	 *
	 * **Still not gated: memory.** A bucket brigade's ring buffer is `delaySeconds x rate`
	 * slots, which is not a program fact (the rate is the host's) and is not a *time* cost,
	 * which is the only axis this budget has. Admission gates ns/sample; it does not gate
	 * allocation, and a chain of long delay lines can therefore still exhaust memory while
	 * passing this gate. Naming that here is the honest state rather than a second
	 * host-supplied axis nothing has asked for yet.
	 */
	readonly macroBlocks: readonly {
		readonly blockId: string;
		/** The algorithm, as declared in `requiredModels`. */
		readonly modelId: string;
	}[];
};

export type Program = {
	readonly formatVersion: 1;
	/**
	 * Every operator this program needs a runtime to implement, sorted and without
	 * duplicates.
	 *
	 * **This is the version surface, and it is deliberately the whole of it.**
	 * `formatVersion` versions the container — which keys exist, how they nest — and says
	 * nothing about the instruction set, so a program using an operator the runtime
	 * predates had no defined behaviour: the executor's dispatch was exhaustive over a
	 * closed TypeScript union, which is a compile-time guarantee inside one repository and
	 * no guarantee at all across a serialized program or a second implementer. Declaring
	 * the set lets the refusal happen at load, by name, before a note is played, rather
	 * than mid-buffer when execution first meets the operator.
	 *
	 * It is emitted from the stamps the *executed* blocks actually present -- `order`'s, not
	 * every block `blocks` retains -- so it is exact rather than conservative: a program of
	 * resistors declares one operator, adding a device to a packet widens the declaration by
	 * exactly what the device stamps, and a block pruned for not reaching the output (never
	 * executed, by any runtime) contributes nothing here even though it stays in `blocks`.
	 * See `link.ts`'s `requiredOperators` for the corpus evidence this exclusion is load-
	 * bearing on, not merely tidy.
	 *
	 * A `macro` block contributes nothing here, and its `modelId` is declared in
	 * `requiredModels` instead — see that field for why the two sets are parallel rather
	 * than merged.
	 */
	readonly requiredOperators: readonly OperatorKind[];
	/**
	 * Every DSP algorithm this program needs a runtime to implement, sorted and without
	 * duplicates — the `macro` half of the same version surface `requiredOperators` is the
	 * stamp half of, and read at load by the same lockout for the same reason.
	 *
	 * **Why a parallel set rather than `modelId` joining `requiredOperators`** — the open
	 * question the operator-format decision left behind, answered here rather than deferred
	 * again. Three reasons, in the order they bite:
	 *
	 * - **They are two vocabularies, and one flat set cannot keep them apart.**
	 *   `requiredOperators` is typed `OperatorKind` = `Stamp["kind"]`, derived from the stamp
	 *   union precisely so a new stamp kind cannot be added without joining the declared set.
	 *   A `modelId` is free-form registry text (artifact-owned, see `MacroModel.modelId`), so
	 *   merging would have to widen that type to `string` and would delete the derivation that
	 *   makes the operator half honest.
	 * - **Merged, a name collision is a silent false pass.** A registry entry whose `modelId`
	 *   happened to be `diode` would be satisfied by the runtime's *stamp* implementation of a
	 *   diode and load cleanly — a plausible, silent, completely wrong admission of exactly the
	 *   shape this file's `ac-source` note argues against.
	 * - **The two demand different work from an implementer.** A missing operator is a stamp
	 *   function in the MNA assembler; a missing model is a DSP algorithm with its own state.
	 *   A refusal that cannot say which one is missing cannot say what a runtime would need to
	 *   gain, which is the whole purpose of naming it.
	 *
	 * Emitted from the *executed* macro blocks, the same exactness rule `requiredOperators`
	 * follows. This compiler deliberately does **not** validate the strings: which algorithms
	 * exist is a property of the runtime doing the executing, not of the program, so the
	 * compiler declares and the runtime refuses — the same division that lets one artifact be
	 * valid on a host whose instruction set is a superset and refused, by name, on one whose
	 * is not.
	 */
	readonly requiredModels: readonly string[];
	/**
	 * What this program can honestly declare about its own real-time cost, independent of
	 * rate, host CPU, or block size. See `CostPredictors`'s own doc for what it omits and
	 * why: a program alone cannot say whether it is playable, because playability is
	 * program x machine x rate x block size, not a program property — this is the program's
	 * honest half of that product, and `src/runtime/admission.ts` is where a host's half
	 * joins it.
	 */
	readonly costPredictors: CostPredictors;
	readonly blocks: readonly Block[];
	/** Execution order. */
	readonly order: readonly string[];
	readonly controls: readonly Control[];
	/**
	 * Absent by construction: there is no sampleRate field. A program is
	 * rate-independent and is given a rate at initialization.
	 */
	readonly ports: Ports;
	/**
	 * Which terminal of the supply this circuit references to ground, from the signs of its
	 * lowered `dc-source` stamps. See `../compiler/supply-reference.ts` for the derivation and
	 * for why barrel polarity (center-negative or center-positive) is deliberately not part of
	 * it.
	 *
	 * Not a simulation input — a program is solved against its declared rails whichever this
	 * says. It is here because it is the one supply fact a **chain** needs: pedals sharing one
	 * physical supply must agree about which terminal is ground, and
	 * `src/runtime/supply-ground.ts` is where a chain of programs can be checked for that.
	 */
	readonly supplyReference:
		| "negative-ground"
		| "positive-ground"
		| "dual-rail"
		| "unpowered";
	/**
	 * The largest voltage each port can physically present, or `null` where the program states no
	 * supply to derive it from. See `./port-full-scale.ts` for the derivation and for why an
	 * upper bound is the honest quantity here.
	 *
	 * This is what lets a chain compare two blocks: `src/runtime/chain.ts` scales between slots by
	 * the ratio of one slot's output full scale to the next's input full scale, so a pedal, an amp
	 * and a NAM profile are interchangeable in a slot instead of coincidentally compatible.
	 */
	/**
	 * The 0 dBFS reference each port's own jack **declares** (`V0dBFS`), in volts, or `null`.
	 *
	 * Distinct from `portFullScaleVolts`, which is a *ceiling* derived from the rails: 98 of the
	 * 142 corpus documents declare an input reference at 0.1 to 1 V while their derived output
	 * ceiling is a 9 V supply, and dividing one by the other is not a level match. A consumer
	 * reads whichever its question needs -- see `link.ts` for the measurement that separated them.
	 */
	readonly portReferenceVolts: {
		readonly input: number | null;
		readonly output: number | null;
	};
	readonly portFullScaleVolts: {
		readonly input: number | null;
		readonly output: number | null;
	};
	/**
	 * How far down the amplification chain this program's output already is — see
	 * `./stage-coverage.ts`. `miked` is never derived from a circuit; it exists for a NAM profile
	 * and for the chain rule that a miked signal must not be sent through a cabinet again.
	 */
	readonly stageCoverage:
		| "instrument"
		| "preamp"
		| "speaker-electrical"
		| "miked";
	/**
	 * The impedance each port declares, for the chain's seam divider (§3.3). `null` per port where
	 * the source states none, which is almost everywhere: zero corpus input jacks declare one.
	 *
	 * A circuit always *has* an electrical port even when its impedance is unstated, which is why
	 * this is an object of nullables rather than a nullable object. The runtime's `SlotContract`
	 * adds the second case -- a whole-object `null` for a NAM or an impulse response, whose ports
	 * are digital and have no impedance to state.
	 */
	readonly portImpedanceOhms: {
		readonly input: number | null;
		readonly output: number | null;
	};
};

// --- results -----------------------------------------------------------------

export type CompileRefusal = {
	/**
	 * Which stage refused. `device-laws` means the document was read and a part could
	 * not be modelled; any other value means the document itself does not support a
	 * program. A caller can tell those apart without catching anything.
	 */
	readonly stage: "netlist" | "device-laws" | "partition" | "lower" | "link";
	/** The component the refusal is about, or null when it is document-level. */
	readonly device: DeviceId | null;
	readonly reason: string;
};

export type CompileFailure = {
	readonly status: "unsupported";
	readonly reasons: readonly CompileRefusal[];
};

export type CompileSuccess = {
	readonly status: "ok";
	readonly program: Program;
	/**
	 * Things that compiled but will not behave. A warning never blocks a program --
	 * a pedal with a dead knob is still worth hearing -- but it must not be silent
	 * either, which is what shipping `ibanez-ts808` with an inert Drive was.
	 */
	readonly warnings: readonly CompileWarning[];
};

/**
 * Why a control cannot move the circuit. A closed vocabulary: callers switch on `code`,
 * and the prose in `detail` is for a human reading a report, never for a test to match.
 */
export type InertControlWarning = {
	readonly code: "control-cannot-affect-circuit";
	readonly control: ControlId;
	/** Why the control cannot affect the circuit: structural defect (disconnected/floating) vs unscheduled region */
	readonly reasonKind?: "floating-wiper" | "disconnected" | "unscheduled-region";
	readonly isStructuralDefect?: boolean;
	/** The components carrying the evidence, in document order. */
	readonly devices: readonly DeviceId[];
	readonly detail: string;
};

/**
 * An op-amp on the signal path with no DC-conducting path from its output back to its
 * inverting input. Nothing pins its operating point, so the DC solution rests on the input
 * network alone. Deliberately does **not** claim the circuit diverges: `ibanez-pql` does and
 * `boss-mt-2` is flagged and solves.
 */
export type UnboundedOpampWarning = {
	readonly code: "opamp-operating-point-unbounded";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * A diode wired forward across a supply: anode on a supply node, cathode on ground. The compiled
 * circuit contains a short, and the runtime renders it rather than diverging only because the
 * junction voltage is clamped.
 */
export type SupplyShortWarning = {
	readonly code: "diode-forward-across-supply";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * Two or more ideal voltage sources -- op-amp outputs, supply drive terminals -- forcing one
 * node, which is over-determined rather than merely unusual. See `over-driven-node.ts`.
 */
export type OverDrivenNodeWarning = {
	readonly code: "node-driven-by-two-sources";
	/** Null: a stamp carries no device id, and the conflict is a property of the node. */
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * A switch throw or transformer winding tap alone on its node: a route that cannot carry anything.
 *
 * The general dangling-terminal rule was measured and rejected — 2020 findings, no signal-to-noise
 * (see `dangling-active-terminal.ts`). This is the same narrowing applied to routing rather than
 * to active devices, and measured the same way: of 1904 single-pin terminals in the corpus, 1858
 * are spare pins and test points, **25 are switch throws and 10 are winding taps** — 35 findings
 * across 18 packets. A throw that routes nowhere is a switch position that does nothing; a tap
 * joined to nothing is a tap that cannot be selected. Neither can be deliberate.
 */
export type UnroutableThrowWarning = {
	readonly code: "throw-or-winding-unwired";
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * An active device with a signal terminal on a node nothing else touches: it is stamped and cannot
 * conduct. See `dangling-active-terminal.ts`.
 */
export type DanglingActiveTerminalWarning = {
	readonly code: "active-device-terminal-unwired";
	/** Null: a stamp carries no device id, so the label in `detail` names it by nodes. */
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * A BBD clock driver or timing controller that is preserved in the netlist but bypassed
 * by the MNA analog solver, meaning its clock/timing/VGG behavior is not modeled dynamically.
 */
export type NonExecutableClockDriverWarning = {
	readonly code: "non-executable-clock-driver";
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * A clock driver with *both* supply terminals at ground, so its outputs render as zero.
 *
 * The MN3101/MN3102 run on a single **negative** supply: the datasheet's pin 1 is GND and pin 3
 * is VDD, so a +9 V pedal ties the part's GND pin to +9 V and its VDD pin to circuit ground. A
 * faithful transcription therefore puts `vdd` at node 0 and the GND pin on the rail, which the
 * stamp now models -- it binds both supply pins and swings the phases between them.
 *
 * What is left is the case with no supply at all: both pins at ground, nothing to swing between.
 * This warned on `vdd` alone for a few hours on 2026-09-07, while the stamp still swung against
 * literal ground; that reading was retired with the fix rather than left to fire falsely on the
 * two correctly-wired packets it was written for. See
 * `docs/troubleshootings/a-correctly-wired-bbd-clock-driver-outputs-nothing.md`.
 */
export type ClockDriverSupplyAtGroundWarning = {
	readonly code: "clock-driver-supply-at-ground";
	readonly device: DeviceId | null;
	readonly detail: string;
};

export type NonExecutableSupportShellWarning = {
	readonly code: "non-executable-support-shell";
	readonly device: DeviceId | null;
	readonly detail: string;
};

export type UnconnectedBehaviorComponentWarning = {
	readonly code: "unconnected-behavior-component";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * A device that named its terminals in a spelling its lowering could not place, and was wired by
 * declaration order instead. See `unreadable-terminal-role.ts` for why this is a warning rather
 * than a refusal, and for what it does and does not claim about the resulting wiring.
 */
export type UnreadableTerminalRoleWarning = {
	readonly code: "terminal-role-unreadable";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * A device whose source states, in its typed `sourceTypeName`, a device class this pipeline has no
 * law for — so it is not executed rather than modelled as the nearest kind the format could carry.
 * See `declaresUnimplementedDeviceLaw`.
 */
export type UnimplementedDeviceLawWarning = {
	readonly code: "device-law-not-implemented";
	readonly device: DeviceId;
	readonly detail: string;
};

export type UnexecutedActiveRegionWarning = {
	readonly code: "unexecuted-active-region";
	/** Null: a region is not a device, so `detail` names it by block id. */
	readonly device: DeviceId | null;
	readonly detail: string;
};

export type ElectricallyIsolatedIcWarning = {
	readonly code: "electrically-isolated-ic";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * An integrated circuit the source declares and the program does not execute.
 *
 * **The silent class this closes.** Five paths in `resolveDevice` give an `ic` an `open` law, and
 * before this only one of them said so: `electrically-isolated-ic` named the isolated chips, and
 * `non-executable-support-shell` names a *transistor* shell. Measured over the 142-document corpus
 * on 2026-09-03, 88 of 104 opened ICs were named by nothing at all -- a compandor, a DSP, three
 * memories and a 74HCU04 among them -- so a packet compiled `ok`, rendered, and sounded like
 * something with a chip missing from it and no line of output that mentioned the chip.
 *
 * **What it does not claim.** Not that the open is wrong. A charge pump whose rail the document
 * declares separately, and a shell the packet draws for continuity, are both correctly opened and
 * both stay opened. The claim is only that the component is in the source and not in the program,
 * which is a fact a reader is entitled to. `reason` says which path decided it and
 * `detail` says what a fix would have to change.
 */
/**
 * A compiled program that executes no blocks, so its output port is reachable by nothing.
 *
 * `device` is null because this is a property of the whole program rather than of one component;
 * the component responsible, where there is a single one, is named by the `ic-not-executed` or
 * `electrically-isolated-ic` warning sitting beside it.
 */
export type OutputPortUnreachableWarning = {
	readonly code: "output-port-unreachable";
	readonly device: DeviceId | null;
	readonly detail: string;
};

export type IcNotExecutedWarning = {
	readonly code: "ic-not-executed";
	readonly device: DeviceId;
	readonly reason: OpenIcReason | "unrecorded";
	readonly detail: string;
};

/**
 * A component the source marks `InterfaceOnly` or `SourceOnly` — interface or source
 * context (a panel-LED shell, a footswitch whose mechanical switching the source declines to
 * trace, an insert loop the product omits) that is not part of the modeled graph. v1 carried
 * this as an admission disposition; v2 now reads the same typed flag and drops the component
 * from the solve, so an open placeholder the source says not to model stops refusing the pedal.
 */
export type InterfaceOrSourceOnlyWarning = {
	readonly code: "interface-or-source-only";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * A board position the source marks `DNP` — the footprint is there and nothing is fitted in it.
 *
 * Kept distinct from `interface-or-source-only` rather than folded into it, because the two say
 * different things and a reader of these warnings should be able to tell them apart: that one
 * means "this component is context, not circuit", while this one means "this component is
 * genuinely absent from the board". An unpopulated two-terminal position is an **open
 * circuit** — a stated fact about the circuit, not a missing value — so the component is
 * dropped rather than refused for the value it correctly does not carry.
 */
export type NotPopulatedWarning = {
	readonly code: "not-populated";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * A `DNP` component that also declares no value — so dropping it is the only reason the
 * document compiles.
 *
 * **`DNP` is the one property whose effect is to make a refusal disappear.** Every other missing
 * fact refuses and names itself; `DNP` removes the component instead, and a removed component
 * cannot refuse. That asymmetry makes it the path of least resistance when a packet will not
 * compile, which is a pressure no other field is under.
 *
 * The distinction this warning draws is between two shapes that look identical in a diff:
 *
 *   - **Corroborated.** The component declares its value *and* is marked `DNP`: "this is a 10k
 *     position, unfitted". Nothing is concealed — a reader sees what would be there, and the
 *     claim can be checked against a board. This emits the ordinary `not-populated`.
 *   - **Load-bearing.** The component declares no value *and* is marked `DNP`. Without the mark
 *     it would have refused by name; with it, it silently leaves the circuit. The `DNP` is
 *     carrying the compile, and if the mark is wrong the part is simply gone with nothing
 *     reporting it.
 *
 * Load-bearing is not by itself a defect — an unpopulated position genuinely has no value to
 * declare, so this shape is exactly what a real DNP looks like. It is reported because it is the
 * shape in which a guess is indistinguishable from a fact, and the reader should get to see how
 * much of a document's compilation rests on it.
 *
 * Measured 2026-08-26: `mxr-carbon-copy` had eight components marked `DNP` in one edit, every one
 * of them carrying `SourceValue: visible-no-value-or-DNP` and `SourceStatus: defer` — the
 * tracer's own record that it could not tell whether the position was populated. All eight were
 * load-bearing, the packet compiled, and nothing in the pipeline said so.
 */
export type NotPopulatedWithoutValueWarning = {
	readonly code: "not-populated-without-value";
	readonly device: DeviceId;
	readonly detail: string;
};

/**
 * The output port sits upstream of the output transformer: an amp measured before its power
 * stage. See `resolvePorts`, which prefers a transformer-coupled jack precisely so this is rare.
 */
export type OutputPortNotTransformerCoupledWarning = {
	readonly code: "output-port-not-transformer-coupled";
	/** The jack the port resolved to, when one owns that node. */
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * An amp-shaped document -- one declaring a high-voltage power transformer -- whose graph
 * contains no output transformer, so its render is a preamp level. A documented packet boundary
 * in the one case that trips it, and never a pedal.
 */
export type NoOutputTransformerWarning = {
	readonly code: "no-output-transformer";
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * A tube lowered with its device-class fit because no catalog entry matched its part number.
 *
 * Not a defect on its own -- an unregistered tube gets a class law the way an unregistered
 * transistor does. It is a boundary on what the render can be quoted for: the tube's bias and gain
 * are another tube's. Every amp in the corpus carried this silently until it was measured.
 */
export type GenericTubeFitWarning = {
	readonly code: "generic-tube-fit";
	readonly device: DeviceId;
	/** The part number the source declared, or `null` when it declared none. */
	readonly partNumber: string | null;
	readonly detail: string;
};

/**
 * A control whose declared taper this stage could not turn into a law, so it renders linear.
 *
 * **Not the same thing as a document that states no taper.** A pot with no `Taper` at all, or one
 * whose source explicitly records the marking as unknown, has nothing for this stage to have
 * failed to read and is silent. This fires only where the source states something: a part marking
 * whose law is not derivable here (`W20`, `Boss-G-taper`, `BH`), or a taper core's format supports
 * and this runtime has no curve for (`s-curve`, `stepped`, `custom`).
 *
 * Measured 2026-09-03: 69 of the corpus's 608 declared tapers fell through to linear, and all 69
 * did it silently. An audio pot rendered linear is audible across the whole knob sweep, which is
 * why this is reported rather than left to a reader of the source.
 */
export type TaperNotExecutableWarning = {
	readonly code: "taper-not-executable";
	readonly device: DeviceId;
	/** Exactly what the source declared, unfolded. */
	readonly declared: string;
	readonly detail: string;
};

/**
 * A document whose declared `nodes:` ledger and inline terminal `node:` refs place one terminal on
 * different nodes — two encodings of one circuit that disagree.
 *
 * This compiler and `@vessel-dsp/core` both treat the declared ledger as authoritative when a
 * terminal has both encodings. Divergence is still a source defect because one terminal is authored
 * with contradictory connectivity and the inline ref is ignored until reconciled. Reported per
 * terminal, because which terminal moved is the whole question.
 */
export type LedgerDivergenceWarning = {
	readonly code: "ledger-divergence";
	readonly device: DeviceId;
	/** `componentId/terminalName`, the key both encodings are indexed by. */
	readonly terminal: string;
	readonly detail: string;
};

/**
 * A speaker load modelled with a generic driver profile rather than the one the amp uses.
 *
 * Stage B's impedance curve has a real driver's *shape* — resonance peak, inductive rise — but not
 * this amp's driver, because no corpus packet identifies one in a form that resolves without a
 * forbidden name inference. Carried per jack so a render is never quoted as this amp's speaker.
 */
export type GenericSpeakerProfileWarning = {
	readonly code: "generic-speaker-profile";
	readonly device: DeviceId;
	/** The declared nominal the generic profile was scaled to. */
	readonly nominalOhms: number;
	readonly detail: string;
};

/**
 * A part whose terminals reach their law slots by declaration order, with nothing asserting what
 * that order means -- see `findUnverifiedPinoutBindings` for the measurement and for why no
 * connectivity rule replaces it.
 */
export type UnverifiedPinoutBindingWarning = {
	readonly code: "unverified-pinout-binding";
	readonly device: DeviceId;
	/** The part id the device identified to. */
	readonly partNumber: string;
	readonly detail: string;
};

/**
 * A sweepable control that is really power-domain hardware -- see `findPowerDomainControls` for
 * the measurement and for why structure cannot settle it.
 */
/**
 * A control whose declared ROLE the engine implements no law for: accepted, lowered, and then
 * ignored. Distinct from `control-cannot-affect-circuit`, which is a fact about the CIRCUIT; this
 * is a fact about the ENGINE.
 */
export type UnimplementedControlRoleWarning = {
	readonly code: "control-role-not-implemented";
	readonly control: ControlId;
	readonly role: string;
	readonly detail: string;
};

export type PowerDomainControlWarning = {
	readonly code: "power-domain-control";
	readonly device: DeviceId;
	readonly detail: string;
};

export type CompileWarning =
	| UnroutableThrowWarning
	| GenericSpeakerProfileWarning
	| LedgerDivergenceWarning
	| GenericTubeFitWarning
	| InertControlWarning
	| UnboundedOpampWarning
	| SupplyShortWarning
	| TaperNotExecutableWarning
	| OverDrivenNodeWarning
	| DanglingActiveTerminalWarning
	| ClockDriverSupplyAtGroundWarning
	| NonExecutableClockDriverWarning
	| NonExecutableSupportShellWarning
	| UnconnectedBehaviorComponentWarning
	| UnreadableTerminalRoleWarning
	| UnverifiedPinoutBindingWarning
	| PowerDomainControlWarning
	| UnimplementedControlRoleWarning
	| UnimplementedDeviceLawWarning
	| ElectricallyIsolatedIcWarning
	| IcNotExecutedWarning
	| OutputPortUnreachableWarning
	| InterfaceOrSourceOnlyWarning
	| NotPopulatedWarning
	| NotPopulatedWithoutValueWarning
	| UnexecutedActiveRegionWarning
	| OutputPortNotTransformerCoupledWarning
	| NoOutputTransformerWarning
	| DeclaredDelayWarning
	| ControlPositionDisagreesWarning
	| ModulationNotModelledWarning;

/**
 * A delay macro whose modulation input the registry declares and the document wires, but which
 * admission refused -- so the delay is a constant and whatever sweeps it in the real pedal does
 * not reach it.
 *
 * Measured 2026-08-27: **no packet in the corpus modulates a delay from a solved node**, so every
 * flanger, chorus, vibrato and rotary renders as a fixed comb filter. That was invisible in the
 * program, which is the part this warning fixes -- not the modulation itself.
 */
export type ModulationNotModelledWarning = {
	readonly code: "modulation-not-modelled";
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * A delay macro whose delay time was **typed into the source** rather than derived from the
 * clock network it is wired to.
 *
 * This is the difference between simulating a delay and reporting one. A derived delay is a
 * consequence of the packet's own R and C and moves when either does; a declared `DelayMs` is a
 * number that renders whatever it says and cannot be wrong in any way a render could reveal --
 * so it must never be read as evidence about the circuit. Measured 2026-08-27: of 16 BBD
 * packets, 4 derive and 12 do not, and nothing distinguished them.
 *
 * A warning rather than a refusal: dropping twelve packets to punish their sources helps nobody,
 * and the fallback still produces a pedal worth hearing. What was not acceptable is shipping it
 * silently.
 */
export type DeclaredDelayWarning = {
	readonly code: "declared-delay-not-derived";
	readonly device: DeviceId | null;
	readonly detail: string;
};

/**
 * The panel and the component disagree about where a control is set.
 *
 * `deviceInterface.controls[].defaultPosition` states where a knob ships; a component's `Wipe`
 * or `Position` states where that part's wiper physically sits. For a panel control they describe
 * the same thing, so a disagreement is a contradiction inside one document rather than a
 * precedence question. The panel declaration is used and the conflict is named -- silently
 * picking one is how a pedal ends up rendering at an operating point its own source denies.
 */
export type ControlPositionDisagreesWarning = {
	readonly code: "control-position-disagrees";
	readonly device: DeviceId | null;
	readonly detail: string;
};

export type CompileResult = CompileFailure | CompileSuccess;
