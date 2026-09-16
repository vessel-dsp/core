// Synthetic circuits, written as `.vdsp` source text.
//
// Source text rather than hand-built objects on purpose: a fixture that skips stage 1
// cannot catch a stage-1 defect, and a hand-built netlist silently encodes
// assumptions the parser does not actually make.
//
// **Every circuit carries adversarial prose and misleading names** -- a resistor
// called `BBD_DELAY`, descriptions claiming components are clock drivers and reverb
// tanks. Correct behaviour is that none of it changes any result. That is how the
// type-level discipline gets proven rather than asserted: if a stage ever starts
// reading prose, these fixtures fail rather than silently agreeing.
//
// No corpus packets and no real pedal names: identity assertions are forbidden, and a
// corpus fixture would also import the corpus's bias, where every packet is
// well-formed and nothing exercises refusal.

/**
 * Derive one fixture from another, refusing a replacement that matched nothing.
 *
 * A bare `.replace` whose target has drifted returns the original string, so the
 * derived fixture silently becomes a copy of its parent and its test passes while
 * asserting nothing about the variation it was written for.
 */
export const derive = (source: string, from: string, to: string): string => {
	if (!source.includes(from)) {
		throw new Error(`fixture derivation matched nothing: ${from.slice(0, 60)}`);
	}
	return source.replace(from, to);
};

const header = (name: string): string => `schema: circuit-interchange/v3
metadata:
  name: "${name}"
  description: "Bucket brigade delay with reverb tank and clock driver."
  partNumber: ""
source:
  format: vdsp
  filename: fixture.vdsp
`;

const jacks = `  - id: JIN
    kind: jack
    name: BBD_DELAY_INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input for the delay memory chip."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank recovery output stage."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 100
    properties: {}
`;

/**
 * Two 10k resistors from input to ground, output at the midpoint. Forces nodes,
 * device laws, a linear solve, and the end-to-end slice. Expected gain is exactly 0.5.
 */
export const resistorDivider = `${header("Divider Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: BBD_DELAY_MEMORY
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "MN3007 bucket brigade delay memory, clock phase 1."
  - id: R2
    kind: resistor
    name: MN3101_CLOCK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Clock driver support, not a signal element."
wires: []
`;

/**
 * The same divider with one inline terminal node contradicting the declared ledger.
 *
 * `R1.b` is authored inline on node 9 while `nodes:` places it on node 2 with `R2.a` and
 * the output jack. Stage 1 should follow the ledger and still warn that the document is
 * inconsistent with itself.
 */
export const ledgerOverridesInlineDivider = derive(
	resistorDivider,
	'      - name: b\n        node: 2\n',
	'      - name: b\n        node: 9\n',
).replace(
	"wires: []",
`nodes:
  - id: 1
    members:
      - componentId: JIN
        terminalName: tip
      - componentId: R1
        terminalName: a
  - id: 2
    members:
      - componentId: R1
        terminalName: b
      - componentId: R2
        terminalName: a
      - componentId: JOUT
        terminalName: tip
  - id: 0
    members:
      - componentId: R2
        terminalName: b
      - componentId: GND1
        terminalName: terminal
wires: []`,
);

/**
 * A divider with a **0 ohm link** in series ahead of it: the schematic-capture convention for
 * an ideal wire, drawn as a resistor because the board really does have a jumper there.
 *
 * The behaviour existed and was untested, which is the gap this closes. `device-laws.ts` stamps
 * a declared zero as `SWITCH_ON_OHMS` -- the same electrically-indistinguishable-from-ideal
 * short a closed switch gets -- because `1/0` is not a representable conductance. Untested
 * behaviour is how the CD4047 pin binding silently regressed: a fact verified and never turned
 * into an assertion.
 *
 * The assertion is behavioural rather than structural: the link is in series with the signal, so
 * a divider with it must measure the same gain as `resistorDivider` without it. A link stamped
 * as anything but a near-short would show up as a divider ratio, and one stamped as an open
 * would take the gain to zero.
 *
 * `mxr-noise-gate-line-driver`'s `R_U1B_FB` is the corpus instance -- `Resistance: { raw: "0
 * Ohm", value: 0, unit: "Ω" }`, and the only resistor of 3090 in the corpus declaring exactly
 * zero.
 */
export const zeroOhmLinkDivider = derive(
	derive(
		resistorDivider,
		"      - name: a\n        node: 1\n",
		"      - name: a\n        node: 4\n",
	),
	"  - id: R1\n",
	`  - id: RLINK
    kind: resistor
    name: RLINK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: -20
      - name: b
        node: 4
        position:
          x: 0
          y: 20
    properties:
      Resistance: "0 Ohm"
      Description: "Bucket brigade clock phase 2 driver."
  - id: R1
`,
);

/**
 * A resistor that declares no resistance at all, and is not marked unpopulated.
 *
 * **The control that keeps the 0 ohm link honest.** A stated zero and an absent value look
 * similar in a diff and mean opposite things: one is a jumper the board really has, the other is
 * a value nobody recorded. Reading the second as the first would silently short a circuit --
 * exactly the wrong-answer-that-still-renders this pipeline refuses.
 *
 * So this must refuse, and it must keep refusing. `mxr-carbon-copy`'s `R4` is the corpus
 * instance: `SourceValue: visible-no-value-or-DNP`, `SourceConfidence: medium`,
 * `SourceStatus: defer` -- the source itself declines to say. The refusal is the correct
 * consumer behaviour there, not a gap.
 */
export const resistorWithNoResistance = derive(
	resistorDivider,
	'      Resistance: "10k"\n      Description: "Clock driver support, not a signal element."',
	'      Description: "Clock driver support, not a signal element."',
);

/**
 * A `DNP` position that *does* declare its value: R2 keeps its 10k and is marked unpopulated.
 *
 * The corroborated shape, and the counterpart to `notPopulatedResistor`'s load-bearing one. The
 * document says "this is a 10k position, unfitted": the part still leaves the solve, but nothing
 * is concealed by its leaving — a reader can see what would sit there and check it against a
 * board. Distinguishing the two is the whole of `report-source-integrity`'s DNP handling, so both
 * need a fixture or the distinction is asserted only in prose.
 */
export const notPopulatedResistorWithValue = derive(
	resistorDivider,
	'      Resistance: "10k"\n      Description: "Clock driver support, not a signal element."',
	'      Resistance: "10k"\n      DNP: \'true\'\n      Description: "Clock driver support, not a signal element."',
);

/**
 * A resistor declaring a **negative** resistance.
 *
 * The other side of the zero boundary, and the control that says where the line is: zero is a
 * jumper the board really has, and below zero is not a resistor at all. `device-laws.ts` refuses
 * it (`!(ohms > 0)` after the zero case is taken), and that refusal is the reason a declared zero
 * can be admitted safely -- the pipeline is not simply accepting whatever number appears.
 *
 * No corpus packet declares one; all 3090 corpus resistors are positive or zero. That is why it
 * is a fixture: a boundary defended only where the corpus happens to push is not defended.
 */
export const resistorWithNegativeResistance = derive(
	resistorDivider,
	'      Resistance: "10k"\n      Description: "Clock driver support, not a signal element."',
	'      Resistance: "-10k"\n      Description: "Clock driver support, not a signal element."',
);

/**
 * The same value-less resistor, marked `DNP: 'true'`.
 *
 * An unpopulated position is an open circuit -- a stated fact about the board, not a missing
 * value -- so this compiles with the component dropped, where the fixture above refuses. The
 * pair is the whole point: the same absent value is a refusal or a legitimate open depending on
 * one typed flag, and nothing else distinguishes them.
 *
 * `mxr-carbon-copy` carries four of these (`R45`, `R50`, `C32`, `C34`) and is the only corpus
 * packet that does.
 */
export const notPopulatedResistor = derive(
	resistorWithNoResistance,
	'      Description: "Clock driver support, not a signal element."',
	"      DNP: 'true'\n      Description: \"Clock driver support, not a signal element.\"",
);

/**
 * A divider plus an `InterfaceOnly` open resistor that declares no resistance. Without the
 * interface/source-only read this fixture refuses -- a resistor with no `Resistance` throws in
 * the parameter stage. The flag is the source's way of saying "panel-LED shell, no driver
 * specified, do not model it", and the correct answer is to drop it (with a warning), not to
 * refuse the whole circuit over a value the source deliberately omits. `SourceOnly` is the
 * twin: the negative control derives it by flipping the flag, and it must behave identically.
 */
export const interfaceOnlyPlaceholder = `${header("Interface-Only Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: SIGNAL_DIVIDER
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "A real resistor in the signal path."
  - id: R_LED
    kind: resistor
    name: PANEL_LED_SHELL
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 3
        position:
          x: 90
          y: 0
      - name: cathode
        node: 0
        position:
          x: 110
          y: 0
    properties:
      InterfaceOnly: "true"
      Value: "open"
      Description: "Open placeholder preserving the panel LED shell; no driver is specified."
wires: []
`;

export const sourceOnlyPlaceholder = derive(
	interfaceOnlyPlaceholder,
	'InterfaceOnly: "true"',
	'SourceOnly: "true"',
);

/**
 * 10k into 10n to ground, output across the capacitor. Forces state, the integration
 * method, and a corner frequency that can be checked by hand.
 */
export const rcLowPass = `${header("RC Low Pass Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: PT2399_ECHO
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Echo processor feedback network."
  - id: C1
    kind: capacitor
    name: REVERB_TANK
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Capacitance: "10n"
      Description: "Reverb tank coupling."
wires: []
`;

/** A pot as a divider. Forces control binding, 0..1 positions, and emitted taper. */
export const potDivider = `${header("Pot Divider Fixture")}deviceInterface:
  controls:
    - id: Level
      label: VOLUME
      kind: knob
      role: output-level
      taper: linear
components:
${jacks}  - id: VR1
    kind: potentiometer
    name: FUZZ_CONTROL_DELAY_TIME
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: end1
        role: end
        node: 1
        position:
          x: -20
          y: 0
      - name: wiper
        role: wiper
        node: 2
        position:
          x: 0
          y: 0
      - name: end2
        role: end
        node: 0
        position:
          x: 20
          y: 0
    properties:
      Resistance: "10k"
      ControlId: "Level"
      Description: "Delay time control for the bucket brigade clock."
wires: []
`;

/**
 * A **rheostat** wired so the two orientation rules disagree.
 *
 * `end1` sits on ground and the wiper shares node 2 with `end2`, so the live leg is
 * `end1`-to-wiper. Quiet-distance sees the grounded end as the quiet one and swaps the ends,
 * putting the live leg on `lower`; declaration order leaves it on `upper`. The two rules give
 * different answers here, which is what makes this fixture worth having.
 *
 * The control declares a time-constant role, so `potTerminals` steps aside from quiet-distance:
 * its premise -- a rising knob should be louder -- says nothing about a pot setting an RC, and
 * on `boss-nf-1-noise-gate`'s `DECAY` it picked the side that ran the knob backwards.
 */
export const rheostatWithTimeConstantRole = derive(
	derive(
		derive(
			potDivider,
			"      role: output-level",
			"      role: decay",
		),
		`      - name: end1
        role: end
        node: 1`,
		`      - name: end1
        role: end
        node: 0`,
	),
	`      - name: end2
        role: end
        node: 0`,
	`      - name: end2
        role: end
        node: 2`,
);

/**
 * The same shape and the same disagreement, with a level role instead. The exemption must NOT
 * fire here: letting declaration order win for every rheostat was measured across the corpus and
 * inverts four knobs that are right today, `boss-fa-1`'s `VOLUME` among them.
 */
export const rheostatWithLevelRole = derive(
	derive(
		potDivider,
		`      - name: end1
        role: end
        node: 1`,
		`      - name: end1
        role: end
        node: 0`,
	),
	`      - name: end2
        role: end
        node: 0`,
	`      - name: end2
        role: end
        node: 2`,
);

/**
 * The same pot with its wiper hanging off node 3, which nothing else touches, and its
 * track carrying the signal from input to output instead.
 *
 * Electrically a fixed 10k in series: the two halves stay in series through a floating
 * junction, so their sum is the whole track wherever the knob sits and the control
 * cannot move a node voltage. It still compiles and still renders -- which is the
 * defect, since `ibanez-ts808` shipped exactly this and rendered bit-identical output
 * at `Drive=0.1` and `Drive=0.9`.
 */
export const potWithFloatingWiper = `${header("Floating Wiper Fixture")}deviceInterface:
  controls:
    - id: Level
      label: VOLUME
      kind: knob
      role: output-level
      taper: linear
components:
${jacks}  - id: VR1
    kind: potentiometer
    name: FUZZ_CONTROL_DELAY_TIME
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: end1
        role: end
        node: 1
        position:
          x: -20
          y: 0
      - name: wiper
        role: wiper
        node: 3
        position:
          x: 0
          y: 0
      - name: end2
        role: end
        node: 2
        position:
          x: 20
          y: 0
    properties:
      Resistance: "10k"
      ControlId: "Level"
      Description: "Delay time control for the bucket brigade clock."
  - id: R1
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade bias leg."
wires: []
`;

/** Anti-parallel diodes to ground after a series resistor. Forces Newton. */
export const diodeClipper = `${header("Diode Clipper Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: R_SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Series element."
  - id: D1
    kind: diode
    name: D_UP
    sourceTypeName: Circuit.Diode
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 2
        position:
          x: 60
          y: -20
      - name: cathode
        role: cathode
        node: 0
        position:
          x: 60
          y: 20
    properties:
      Description: "Clipping diode."
  - id: D2
    kind: diode
    name: D_DOWN
    sourceTypeName: Circuit.Diode
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 0
        position:
          x: 120
          y: -20
      - name: cathode
        role: cathode
        node: 2
        position:
          x: 120
          y: 20
    properties:
      Description: "Clipping diode."
wires: []
`;

/** Anti-parallel LEDs to ground after a series resistor. Moves clipping knee higher. */
export const ledClipper = derive(
	diodeClipper,
	"    kind: diode\n    name: D_UP\n    sourceTypeName: Circuit.Diode",
	"    kind: led\n    name: D_UP\n    sourceTypeName: Circuit.Led",
).replace(
	"    kind: diode\n    name: D_DOWN\n    sourceTypeName: Circuit.Diode",
	"    kind: led\n    name: D_DOWN\n    sourceTypeName: Circuit.Led",
);


/**
 * Inverting amplifier: 10k in, 100k feedback, non-inverting leg at ground. Forces the
 * auxiliary-constraint row, which is the same mechanism an ideal transformer needs.
 * Gain is -R_f/R_in = -10 exactly, so the magnitude is a hand-checkable 10.
 */
export const invertingAmplifier = `${header("Inverting Amplifier Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 3
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade input coupling."
  - id: R2
    kind: resistor
    name: R_FEEDBACK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -20
          y: -60
      - name: b
        node: 2
        position:
          x: 20
          y: -60
    properties:
      Resistance: "100k"
      Description: "Reverb tank feedback."
  - id: U1
    kind: opamp
    name: DELAY_MEMORY_CHIP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
    properties:
      Description: "MN3007 bucket brigade delay memory."
wires: []
`;
/**
 * The same amplifier with the feedback **resistor replaced by a capacitor**: an integrator
 * with no DC feedback path.
 *
 * Nothing pins the inverting node's operating point -- at DC the capacitor is an open
 * circuit, so the output cannot influence its own input -- and any standing differential
 * integrates. `ibanez-pql` ships this shape on its signal path and diverges to `8.55e+12 V`
 * from a 9 V supply. Kept minimal deliberately: swapping one element is what separates a
 * bounded stage from an unbounded one, and the fixture should show exactly that.
 */
export const opampCapacitiveFeedbackOnly = invertingAmplifier
	.replace("name: R_FEEDBACK", "name: C_FEEDBACK")
	.replace(
		"kind: resistor\n    name: C_FEEDBACK",
		"kind: capacitor\n    name: C_FEEDBACK",
	)
	.replace(
		'      Resistance: "100k"\n      Description: "Reverb tank feedback."',
		'      Capacitance: "39n"\n      Description: "Reverb tank feedback."',
	);

/**
 * The same inverting amplifier with a 9 V supply present. Gain is still -10, but the
 * output cannot leave the 0..9 V rails, so a hot input clips instead of producing
 * a voltage the pedal could not make.
 */
export const railedAmplifier = `${header("Railed Amplifier Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 3
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade input coupling."
  - id: R2
    kind: resistor
    name: R_FEEDBACK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -20
          y: -60
      - name: b
        node: 2
        position:
          x: 20
          y: -60
    properties:
      Resistance: "100k"
      Description: "Reverb tank feedback."
  - id: U1
    kind: opamp
    name: DELAY_MEMORY_CHIP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
    properties:
      Description: "MN3007 bucket brigade delay memory."
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 9
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Positive rail."
  - id: V2
    kind: voltage-source
    name: SUPPLY_NEG
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 60
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 8
        position:
          x: 60
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 60
          y: -180
    properties:
      Voltage: "-9"
      Description: "Negative rail."
wires: []
`;

/**
 * An op-amp powered from a rail of its own, spelled the way this corpus actually spells it.
 *
 * The circuit's supply set is +9 / -9, but this op-amp's `vPlus` sits on a separate +4 V node
 * and its `vMinus` on ground, so the rails it should clip at are 4 and 0 -- neither of them a
 * circuit extreme. While the rail lookup read only the exact spellings `vcc`/`vee`, this
 * op-amp was given 9 and -9: a clipping ceiling more than twice its real one, on a part whose
 * whole audible contribution in a drive pedal is where it clips.
 *
 * `boss-bd-2-blues-driver` is the corpus instance and it is not a corner case -- it declares
 * three supply ports (9 V, 8 V, 4 V) and both its op-amps' `vPlus` is on the 8 V one, while
 * the compiler handed them the 9 V inlet rail.
 */
export const opampOnItsOwnRail = derive(
	derive(
		railedAmplifier,
		"      - name: output\n        role: output\n        node: 2\n",
		`      - name: vPlus
        role: supplyPositive
        node: 7
        position:
          x: 60
          y: 30
      - name: vMinus
        role: supplyNegative
        node: 0
        position:
          x: 60
          y: -30
      - name: output
        role: output
        node: 2
`,
	),
	"  - id: V1\n",
	`  - id: V3
    kind: voltage-source
    name: SUPPLY_OPAMP
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 200
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 7
        position:
          x: 200
          y: 200
      - name: minus
        role: negative
        node: 0
        position:
          x: 200
          y: 220
    properties:
      Voltage: "4"
      Description: "Clock phase driver for the delay memory."
  - id: V1
`,
);

/**
 * The same op-amp with both supply pins on the one node.
 *
 * A degenerate pair -- `railHigh == railLow` -- which is not a narrow clipping window but a
 * contradiction: the linear region has negative width and the output pins wherever the
 * limiter lands. Reading a document's own supply pins can produce it, so `opampRails`
 * requires an ordered pair and keeps the circuit set when it does not get one.
 *
 * Measured rather than hypothetical: `mxr-m117r-flanger`'s `U4` declares `pin8_vplus` and
 * `pin4_vminus` and **both resolve to the same node** -- ground, carrying a declared +15 V,
 * because that packet puts its `V15` rail component on the ground node. Eight op-amp stamps
 * came out at `high = low = 15` before the invariant existed.
 */
export const opampWithDegenerateRails = derive(
	opampOnItsOwnRail,
	"      - name: vMinus\n        role: supplyNegative\n        node: 0\n",
	"      - name: vMinus\n        role: supplyNegative\n        node: 7\n",
);

/**
 * An op-amp that names no inputs at all: `vPlus`, `vMinus`, `output`, in that order.
 *
 * The reason the supply vocabulary is split in two rather than being one list.
 * `vplus`/`vminus` is how every corpus op-amp that declares supplies spells them -- but it is
 * also the natural spelling for a bare differential pair, and `opampTerminals` falls back to
 * declaration order when it cannot resolve a named input pair, so here those two terminals
 * are wired as **the inputs**. Reading them as rails as well would clamp this op-amp to its
 * own input voltages. The rails must come from the circuit set, +9 / -9.
 *
 * This is the invariant the guard protects -- a terminal cannot be both a signal input and a
 * rail -- and it is a control no corpus census could have supplied, because the corpus
 * happens to contain no such part. A vocabulary justified only by what the corpus does today
 * is a vocabulary that breaks on the next document.
 */
export const opampWithUnnamedInputs = derive(
	railedAmplifier,
	`      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
`,
	`      - name: vPlus
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: vMinus
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
`,
);

/**
 * A divider whose lower leg can be shorted by a switch. Open, the output is the
 * divider's half; closed, the lower leg is shorted and the output collapses. Forces
 * topology that changes with a control, without a second netlist.
 */
export const switchedDivider = `${header("Switched Divider Fixture")}deviceInterface:
  controls:
    - id: Bypass
      label: BYPASS
      kind: switch
      role: bypass
components:
${jacks}  - id: R1
    kind: resistor
    name: R_TOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Clock driver network."
  - id: R2
    kind: resistor
    name: R_BOTTOM
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade bias leg."
  - id: SW1
    kind: switch
    name: FOOTSWITCH
    sourceTypeName: Circuit.Switch
    origin:
      x: 160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 160
          y: -20
      - name: b
        node: 0
        position:
          x: 160
          y: 20
    properties:
      ControlId: "Bypass"
      Description: "True bypass footswitch."
wires: []
`;

/**
 * The same switch, but stating its contact state the way nine corpus switches do -- a
 * `State` rather than a `Position` or a `Wipe`. Derived from `switchedDivider` by adding
 * exactly one property, so a difference between the two can only be that property.
 */
export const switchedDividerStatingClosed = switchedDivider.replace(
	'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
	'      ControlId: "Bypass"\n      State: "closed"\n      Description: "True bypass footswitch."',
);

/** The amp corpus's spelling of the same fact: `SelectedState` rather than `State`. */
export const switchedDividerStatingSelectedState = switchedDivider.replace(
	'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
	'      ControlId: "Bypass"\n      SelectedState: "closed/on"\n      Description: "True bypass footswitch."',
);

/**
 * `SelectedState` carrying something that is not a contact state at all, which the corpus also
 * does (`16 ohms`, `90w full-power silicon path`). It must be ignored rather than refused: unlike
 * `State`, this field is not only about contacts.
 */
export const switchedDividerStatingUnrelatedSelectedState =
	switchedDivider.replace(
		'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
		'      ControlId: "Bypass"\n      SelectedState: "16 ohms"\n      Description: "True bypass footswitch."',
	);

/** A fuse, which conducts unless a source says it has blown. */
export const switchedDividerWithFuseRating = switchedDivider.replace(
	'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
	'      ControlId: "Bypass"\n      FuseRating: "T250mA"\n      Description: "True bypass footswitch."',
);

/** The same again with a contact state no closed vocabulary contains. */
export const switchedDividerStatingUnknownContact = switchedDivider.replace(
	'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
	'      ControlId: "Bypass"\n      State: "halfway-ish"\n      Description: "True bypass footswitch."',
);

/**
 * The same unpositioned switch, wired the other way round: in series between the input
 * port and the divider rather than shunting the midpoint to ground, so the only path
 * from input to output runs through it. `switchedDivider`'s switch has a path around
 * it; this one is the path. Both senses appear in the corpus under identical terminal
 * naming, which is why the default cannot be a constant.
 */
export const switchInSignalPath = `${header("Series Switch Fixture")}deviceInterface:
  controls:
    - id: Bypass
      label: BYPASS
      kind: switch
      role: bypass
components:
${jacks}  - id: SW1
    kind: switch
    name: FOOTSWITCH
    sourceTypeName: Circuit.Switch
    origin:
      x: -160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -160
          y: -20
      - name: b
        node: 3
        position:
          x: -160
          y: 20
    properties:
      ControlId: "Bypass"
      Description: "True bypass footswitch."
  - id: R1
    kind: resistor
    name: R_TOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Clock driver network."
  - id: R2
    kind: resistor
    name: R_BOTTOM
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade bias leg."
wires: []
`;

/**
 * A JFET whose **drain sits below its source**, so `vds` is negative and only a symmetric channel
 * conducts. The gate is at the input, the source is pulled up through 10k and the drain pulled
 * down through 10k.
 *
 * A channel conducts both ways -- which is why a JFET works as an analogue switch -- and the
 * runtime treated reverse as cutoff until 2026-08-12. With the old law the two resistors were
 * independent and the operating point sat at 9 V and 0 V; symmetric, it solves to 7.42 V and
 * 1.58 V, matching ngspice to 0.08%. `boss-hm-2` has three signal-path FETs spending most samples
 * here.
 */
export const jfetReverseBiased = `${header("Reverse-Biased JFET Fixture")}components:
${jacks}  - id: VP
    kind: rail
    name: V_PLUS
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 4
        position:
          x: 0
          y: -100
    properties:
      Voltage: "9"
      Description: "Delay memory supply."
  - id: RUP
    kind: resistor
    name: R_PULLUP
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 60
          y: -70
      - name: b
        node: 3
        position:
          x: 60
          y: -30
    properties:
      Resistance: "10k"
      Description: "Clock driver pullup."
  - id: RDN
    kind: resistor
    name: R_PULLDOWN
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: 50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 60
          y: 30
      - name: b
        node: 0
        position:
          x: 60
          y: 70
    properties:
      Resistance: "10k"
      Description: "Reverb tank pulldown."
  - id: RG
    kind: resistor
    name: R_GATE
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: 30
      - name: b
        node: 0
        position:
          x: -100
          y: 70
    properties:
      Resistance: "1M"
      Description: "Bucket brigade gate leak."
  - id: Q1
    kind: jfet
    name: BBD_SWITCH_FET
    sourceTypeName: Circuit.JFET
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: gate
        role: gate
        node: 1
        position:
          x: -20
          y: 0
      - name: drain
        role: drain
        node: 2
        position:
          x: 0
          y: 20
      - name: source
        role: source
        node: 3
        position:
          x: 0
          y: -20
    properties:
      Description: "MN3007 delay memory switch."
wires: []
`;

/**
 * A supply with a protection diode wired the wrong way round: anode on the 9 V rail, cathode on
 * ground, so the whole supply forward biases it.
 *
 * `ibanez-ts808` and `ibanez-ts9` both ship this, each carrying **1.074 A** through it while
 * rendering a plausible level, because the runtime clamps the junction voltage instead of
 * diverging. Reversing the two terminal roles turns this fixture into the correct arrangement,
 * which is what the paired test checks.
 */
export const diodeShortingSupply = `${header("Reversed Protection Diode Fixture")}components:
${jacks}  - id: R1
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Clock driver network."
  - id: R2
    kind: resistor
    name: R_BOTTOM
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade bias leg."
  - id: VPLUS
    kind: rail
    name: V_PLUS
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 3
        position:
          x: 0
          y: -100
    properties:
      Voltage: "9"
      Description: "Delay memory supply."
  - id: RFEED
    kind: resistor
    name: R_FEED
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 60
          y: -80
      - name: b
        node: 2
        position:
          x: 60
          y: -40
    properties:
      Resistance: "100k"
      Description: "Reverb tank feed."
  - id: DPROT
    kind: diode
    name: D_PROTECTION
    sourceTypeName: Circuit.Diode
    origin:
      x: -60
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 3
        position:
          x: -60
          y: -80
      - name: cathode
        role: cathode
        node: 0
        position:
          x: -60
          y: -40
    properties:
      Description: "Power-entry protection diode to ground."
wires: []
`;

/** The same supply with the protection diode the right way round: cathode to the rail. */
// Through `derive`, not `String.replace`. When the diode terminals gained `role:` lines these
// patterns stopped matching, both replaces returned their input, and this fixture **became
// `diodeShortingSupply`** -- so the supply's hand-computed 85.7 uA read 4.02 A and the
// reverse-biased case was silently testing the shorted one. `derive` throws instead.
export const diodeProtectingSupply = derive(
	derive(
		diodeShortingSupply,
		"      - name: anode\n        role: anode\n        node: 3",
		"      - name: anode\n        role: anode\n        node: 0",
	),
	"      - name: cathode\n        role: cathode\n        node: 0",
	"      - name: cathode\n        role: cathode\n        node: 3",
);

/**
 * The 5F1's V1A triode stage, built to match `whole-amp-5f1` exactly so its operating point is
 * a validated oracle rather than a snapshot: 68k grid stopper from the input, 1M grid leak,
 * 1.5k cathode to ground, 100k plate load to a 250 V rail.
 *
 * That experiment solves `Vk 1.251`, `Vp 166.6`, `Ip 0.83 mA`, and those three are consistent
 * by hand (`1.251/1500 = 0.834 mA`; `250 - 0.834e-3 * 100e3 = 166.6`), so the fixture is
 * checkable without trusting the experiment's solver.
 */
export const triodeGainStage = `${header("Triode Gain Stage Fixture")}components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 4
        position:
          x: 300
          y: 0
    properties:
      Description: "Reverb tank out."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 100
    properties: {}
  - id: RSTOP
    kind: resistor
    name: GRID_STOPPER
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -220
          y: 0
      - name: b
        node: 2
        position:
          x: -180
          y: 0
    properties:
      Resistance: "68k"
      Description: "Bucket brigade grid stopper."
  - id: RLEAK
    kind: resistor
    name: GRID_LEAK
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: -140
          y: 40
      - name: b
        node: 0
        position:
          x: -140
          y: 80
    properties:
      Resistance: "1M"
      Description: "Reverb tank grid leak."
  - id: RK
    kind: resistor
    name: CATHODE
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 0
          y: 40
      - name: b
        node: 0
        position:
          x: 0
          y: 80
    properties:
      Resistance: "1500"
      Description: "Delay memory cathode."
  - id: RP
    kind: resistor
    name: PLATE_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 0
          y: -40
      - name: b
        node: 5
        position:
          x: 0
          y: -80
    properties:
      Resistance: "100k"
      Description: "Clock driver plate load."
  - id: BPLUS
    kind: rail
    name: B_PLUS
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -120
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 5
        position:
          x: 0
          y: -120
    properties:
      Voltage: "250"
      Description: "Bucket brigade supply."
  - id: V1A
    kind: triode
    name: BBD_DELAY_TRIODE
    sourceTypeName: Circuit.Triode
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: grid
        role: grid
        node: 2
        position:
          x: -20
          y: 0
      - name: cathode
        role: cathode
        node: 3
        position:
          x: 0
          y: 20
      - name: plate
        role: plate
        node: 4
        position:
          x: 0
          y: -20
    properties:
      Description: "MN3007 bucket brigade delay memory."
wires: []
`;

/**
 * Emitter follower on a 9 V rail: 10k/10k base bias, 4k7 emitter, signal coupled in
 * through 1u. Forces Ebers-Moll, junction limiting, a DC operating point, and a
 * voltage source. Voltage gain is Re/(Re + re) with re = Vt/Ie, so just under unity.
 */
export const emitterFollower = `${header("Emitter Follower Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: BBD_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 4
        position:
          x: 300
          y: 0
    properties:
      Description: "Reverb recovery."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Battery rail."
  - id: RB1
    kind: resistor
    name: RB1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: -100
          y: -120
      - name: b
        node: 3
        position:
          x: -100
          y: -80
    properties:
      Resistance: "10k"
      Description: "Bias."
  - id: RB2
    kind: resistor
    name: RB2
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -100
          y: 80
      - name: b
        node: 0
        position:
          x: -100
          y: 120
    properties:
      Resistance: "10k"
      Description: "Bias."
  - id: C1
    kind: capacitor
    name: CIN
    sourceTypeName: Circuit.Capacitor
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -220
          y: 0
      - name: b
        node: 3
        position:
          x: -180
          y: 0
    properties:
      Capacitance: "1u"
      Description: "Coupling."
  - id: Q1
    kind: bjt
    name: MN3007
    sourceTypeName: Circuit.BJT
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: base
        role: base
        node: 3
        position:
          x: 80
          y: 0
      - name: collector
        role: collector
        node: 5
        position:
          x: 120
          y: -20
      - name: emitter
        role: emitter
        node: 4
        position:
          x: 120
          y: 20
    properties:
      Description: "Bucket brigade delay memory chip."
  - id: RE
    kind: resistor
    name: RE
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 200
          y: 80
      - name: b
        node: 0
        position:
          x: 200
          y: 120
    properties:
      Resistance: "4k7"
      Description: "Emitter degeneration."
wires: []
`;

/**
 * A standard NPN common-emitter amplifier stage with 4-resistor bias.
 *
 * 9 V rail, RB1=100k, RB2=22k base divider, RC=4.7k collector load, RE=1k emitter resistor,
 * 10u input/output coupling caps into a 1M load.
 *
 * Expected small-signal AC gain is -(RC || RLOAD) / (RE + re) ~ -4.53 V/V.
 */
export const commonEmitterAmplifier = `${header("Common Emitter Amplifier Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_DELAY_INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -400
          y: 0
    properties:
      Description: "Bucket brigade clock input."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 6
        position:
          x: 400
          y: 0
    properties:
      Description: "Reverb recovery output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Battery rail."
  - id: CIN
    kind: capacitor
    name: CIN
    sourceTypeName: Circuit.Capacitor
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -320
          y: 0
      - name: b
        node: 2
        position:
          x: -280
          y: 0
    properties:
      Capacitance: "10u"
      Description: "Input coupling."
  - id: RB1
    kind: resistor
    name: RB1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: -200
          y: -120
      - name: b
        node: 2
        position:
          x: -200
          y: -80
    properties:
      Resistance: "100k"
      Description: "Upper bias divider."
  - id: RB2
    kind: resistor
    name: RB2
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: -200
          y: 80
      - name: b
        node: 0
        position:
          x: -200
          y: 120
    properties:
      Resistance: "22k"
      Description: "Lower bias divider."
  - id: Q1
    kind: bjt
    name: MN3007
    sourceTypeName: Circuit.BJT
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: base
        role: base
        node: 2
        position:
          x: -20
          y: 0
      - name: collector
        role: collector
        node: 3
        position:
          x: 20
          y: -20
      - name: emitter
        role: emitter
        node: 4
        position:
          x: 20
          y: 20
    properties:
      Type: "NPN"
      Description: "Bucket brigade delay element."
  - id: RC
    kind: resistor
    name: RC
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 100
          y: -120
      - name: b
        node: 3
        position:
          x: 100
          y: -80
    properties:
      Resistance: "4.7k"
      Description: "Collector load resistor."
  - id: RE
    kind: resistor
    name: RE
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 100
          y: 80
      - name: b
        node: 0
        position:
          x: 100
          y: 120
    properties:
      Resistance: "1k"
      Description: "Emitter degeneration resistor."
  - id: COUT
    kind: capacitor
    name: COUT
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 180
          y: 0
      - name: b
        node: 6
        position:
          x: 220
          y: 0
    properties:
      Capacitance: "10u"
      Description: "Output coupling."
  - id: RLOAD
    kind: resistor
    name: RLOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 300
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 300
          y: 80
      - name: b
        node: 0
        position:
          x: 300
          y: 120
    properties:
      Resistance: "1meg"
      Description: "Load resistance."
wires: []
`;

export const commonEmitterAmplifierHalvedRe = derive(
	commonEmitterAmplifier,
	'Resistance: "1k"',
	'Resistance: "470"',
);

/**
 * A DC-driven transformer secondary carrying a declared-voltage port, for the milestone that a
 * transformer winding may borrow generated status from another winding of the same transformer.
 *
 * `VBATT` (10 V, DC) drives the primary; the secondary is fixed by the ideal transformer's own
 * constraint at exactly `10 / 2 = 5 V`, independent of `RLOAD`, which only sets the current. The
 * declared `BPLUS_PORT` states `6 V` -- a plausible chart value, deliberately not the true `5 V`
 * -- so a promoted ideal rail and the real transformer answer are distinguishable by more than
 * rounding, the same shape `tubeDiodeIntoLoadWithDeclaredPort` uses for the rectifier case.
 *
 * DC rather than AC on purpose, matching `tubeDiodeIntoLoad`'s own reasoning: it isolates the
 * transformer-coupling question from the AC source and its own RMS-to-peak conversion, so a
 * failure here is the coupling rule and nothing else.
 */
export const transformerSecondaryWithDeclaredPort = `${header("Transformer Coupling Fixture")}components:
${jacks}  - id: VBATT
    kind: voltage-source
    name: BBD_CLOCK_SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -200
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 3
        position:
          x: -200
          y: -120
      - name: neutral
        role: negative
        node: 0
        position:
          x: -200
          y: -80
    properties:
      Voltage: "10"
      Description: "Delay memory driver supply."
  - id: T1
    kind: transformer
    name: BBD_CLOCK_TRANSFORMER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 3
        position:
          x: -20
          y: -120
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: -80
      - name: secondary_a
        role: winding
        node: 2
        position:
          x: 20
          y: -120
      - name: secondary_b
        role: winding
        node: 0
        position:
          x: 20
          y: -80
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
      - role: secondary
        terminals:
          - secondary_b
          - secondary_a
    properties:
      Ratio: "2"
      Description: "Bucket brigade clock step-down transformer."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -120
      - name: b
        node: 0
        position:
          x: 100
          y: -80
    properties:
      Resistance: "1k"
      Description: "Reverb tank load."
  - id: BPLUS_PORT
    kind: port
    name: REVERB_TANK_BPLUS
    sourceTypeName: Circuit.Port
    origin:
      x: 160
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 2
        position:
          x: 160
          y: -100
    properties:
      Voltage: "6"
      Description: "Chart secondary voltage for the reverb tank driver."
wires: []
`;

/** Ideal 1:2 step-up into a 10k load. Forces the four-terminal constraint row. */
export const stepUpTransformer = `${header("Transformer Fixture")}components:
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: OUTPUT_TRANSFORMER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_plus
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_minus
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: secondary_plus
        role: winding
        node: 2
        position:
          x: 20
          y: -20
      - name: secondary_minus
        role: winding
        node: 0
        position:
          x: 20
          y: 20
    windings:
      - role: primary
        terminals:
          - primary_plus
          - primary_minus
      - role: secondary
        terminals:
          - secondary_minus
          - secondary_plus
    properties:
      Ratio: "0.5"
      Description: "Bucket brigade clock transformer."
  - id: RL
    kind: resistor
    name: LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 80
      - name: b
        node: 0
        position:
          x: 120
          y: 120
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/** Ideal 2:1 step-down transformer: turns ratio 2.0, so gain is 0.5. */
export const stepDownTransformer = derive(
	stepUpTransformer,
	'      Ratio: "0.5"',
	'      Ratio: "2.0"',
);


/** JFET source follower on a 9 V rail, gate at 0 V through 1M, 2k2 source. */
export const jfetFollower = `${header("JFET Follower Fixture")}components:
  - id: JIN
    kind: jack
    name: IN
    sourceTypeName: Circuit.Input
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Delay input."
  - id: JOUT
    kind: jack
    name: OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 4
        position:
          x: 300
          y: 0
    properties:
      Description: "Delay output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Rail."
  - id: RG
    kind: resistor
    name: RG
    sourceTypeName: Circuit.Resistor
    origin:
      x: -150
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -150
          y: 80
      - name: b
        node: 0
        position:
          x: -150
          y: 120
    properties:
      Resistance: "1meg"
      Description: "Gate reference."
  - id: C1
    kind: capacitor
    name: CIN
    sourceTypeName: Circuit.Capacitor
    origin:
      x: -220
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -240
          y: 0
      - name: b
        node: 3
        position:
          x: -200
          y: 0
    properties:
      Capacitance: "1u"
      Description: "Coupling."
  - id: Q1
    kind: jfet
    name: MN3101
    sourceTypeName: Circuit.JFET
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: gate
        role: gate
        node: 3
        position:
          x: 80
          y: 0
      - name: drain
        role: drain
        node: 5
        position:
          x: 120
          y: -20
      - name: source
        role: source
        node: 4
        position:
          x: 120
          y: 20
    properties:
      Description: "Clock driver chip."
  - id: RS
    kind: resistor
    name: RS
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 200
          y: 80
      - name: b
        node: 0
        position:
          x: 200
          y: 120
    properties:
      Resistance: "2k2"
      Description: "Source resistor."
wires: []
`;
/**
 * MOSFET source follower. Enhancement mode is off at zero gate bias, so unlike the
 * JFET the gate is biased from the rail by a divider rather than referenced to
 * ground. The divider is 10k/10k rather than 1M/1M for a reason worth recording: an
 * uncharged coupling capacitor starts as a near-short, so the gate is dragged to 0 V
 * and charges with tau = C * (R1 || R2). At 1M that is 0.5 s, far longer than any
 * test window. The JFET fixture escapes this only because its bias point is 0 V, so
 * it needs no settling at all. Same law as the JFET, opposite threshold sign.
 */
export const mosfetFollower = `${header("MOSFET Follower Fixture")}components:
  - id: JIN
    kind: jack
    name: IN
    sourceTypeName: Circuit.Input
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Delay input."
  - id: JOUT
    kind: jack
    name: OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 4
        position:
          x: 300
          y: 0
    properties:
      Description: "Delay output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: V1
    kind: voltage-source
    name: SUPPLY
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "9"
      Description: "Rail."
  - id: RG1
    kind: resistor
    name: RG1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -150
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: -150
          y: -120
      - name: b
        node: 3
        position:
          x: -150
          y: -80
    properties:
      Resistance: "10k"
      Description: "Gate bias upper."
  - id: RG2
    kind: resistor
    name: RG
    sourceTypeName: Circuit.Resistor
    origin:
      x: -150
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -150
          y: 80
      - name: b
        node: 0
        position:
          x: -150
          y: 120
    properties:
      Resistance: "10k"
      Description: "Gate bias lower."
  - id: C1
    kind: capacitor
    name: CIN
    sourceTypeName: Circuit.Capacitor
    origin:
      x: -220
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -240
          y: 0
      - name: b
        node: 3
        position:
          x: -200
          y: 0
    properties:
      Capacitance: "1u"
      Description: "Coupling."
  - id: Q1
    kind: mosfet
    name: MN3101
    sourceTypeName: Circuit.MOSFET
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: gate
        role: gate
        node: 3
        position:
          x: 80
          y: 0
      - name: drain
        role: drain
        node: 5
        position:
          x: 120
          y: -20
      - name: source
        role: source
        node: 4
        position:
          x: 120
          y: 20
    properties:
      Description: "Clock driver chip."
  - id: RS
    kind: resistor
    name: RS
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 200
          y: 80
      - name: b
        node: 0
        position:
          x: 200
          y: 120
    properties:
      Resistance: "2k2"
      Description: "Source resistor."
wires: []
`;

/** 1 H into 10k to ground, output across the resistor: an RL low pass at R/(2*pi*L). */
export const rlLowPass = `${header("RL Low Pass Fixture")}components:
${jacks}  - id: L1
    kind: inductor
    name: BBD_CLOCK_COIL
    sourceTypeName: Circuit.Inductor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Inductance: "1"
      Description: "Wah inductor."
  - id: R1
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/** An IC with no registry entry. Forces the unsupported outcome. */
export const unknownChip = `${header("Unknown Chip Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: MN3007
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 1
        position:
          x: -20
          y: 0
      - name: out
        node: 2
        position:
          x: 20
          y: 0
    properties:
      PartNumber: "UNKNOWN-PART-XYZ"
      DelayMs: "3"
      Description: "Bucket brigade delay memory."
wires: []
`;

/**
 * An 8-pin chip a registry supplies as **two** sections, the shape a dual op-amp takes.
 *
 * Bare `pin1`..`pin8` names on purpose: a section indexes terminals positionally, so this proves
 * the expansion does not depend on role tokens -- which is the whole reason sections exist, since an
 * 8-pin dual op-amp has two outputs and no role token can name either unambiguously.
 */
export const dualSectionChip = `${header("Dual Section Chip Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: DUAL
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 10
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 10
          y: 0
      - name: pin3
        node: 12
        position:
          x: 20
          y: 0
      - name: pin4
        node: 13
        position:
          x: 30
          y: 0
      - name: pin5
        node: 14
        position:
          x: 40
          y: 0
      - name: pin6
        node: 15
        position:
          x: 50
          y: 0
      - name: pin7
        node: 16
        position:
          x: 60
          y: 0
      - name: pin8
        node: 17
        position:
          x: 70
          y: 0
    properties:
      PartNumber: "FIXTURE-DUAL-OPAMP-1"
  - id: VBATT
    kind: voltage-source
    name: BATT
    sourceTypeName: Circuit.Battery
    origin:
      x: 100
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 30
        position:
          x: 100
          y: 90
      - name: negative
        role: negative
        node: 0
        position:
          x: 100
          y: 110
    properties:
      Voltage: "9 V"
wires: []
`;

/** The same IC, with a part number a fixture registry can supply a macro model for. */
export const knownChip = derive(
	unknownChip,
	'PartNumber: "UNKNOWN-PART-XYZ"',
	'PartNumber: "FIXTURE-DELAY-1"',
);

/**
 * The same IC again, with a part number a registry supplies a *lumped law* for.
 *
 * Three documents, one device, three answers -- and the document is identical apart from
 * the part number: unsupported with no model, a macro region with one, an ordinary
 * two-terminal element with another. That is the injected registry doing its job:
 * opacity is a property of what the registry knows, never of the device.
 */
export const resistiveChip = derive(
	unknownChip,
	'PartNumber: "UNKNOWN-PART-XYZ"',
	'PartNumber: "FIXTURE-RESISTIVE-1"',
);

/**
 * The pinout rung, positive control: an `ic` whose only identity is two terminal roles,
 * both covered by the fixture registry's groups (`cp1`, `vgg`). No part id, no declared
 * type -- so it reaches the pinout rung and must match exactly.
 */
export const chipPinoutExact = `${header("Pinout Exact Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: CHIP
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: cp1
        node: 3
        position:
          x: -20
          y: 0
      - name: vgg
        node: 4
        position:
          x: 20
          y: 0
    properties:
      PartNumber: "UNKNOWN-PART-XYZ"
      Description: "A chip the registry knows only by its terminal roles."
wires: []
`;

/**
 * The pinout rung, negative control: the same two roles plus `reset`, which the
 * registry's groups do not cover. Presence alone would satisfy both groups and stamp a
 * macro identity; the exact test must refuse it instead, because a role no group
 * accounts for is evidence this is not that part.
 */
export const chipPinoutSuperset = `${header("Pinout Superset Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: CHIP
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: cp1
        node: 3
        position:
          x: -20
          y: 0
      - name: vgg
        node: 4
        position:
          x: 20
          y: 0
      - name: reset
        node: 5
        position:
          x: 40
          y: 0
    properties:
      PartNumber: "UNKNOWN-PART-XYZ"
      Description: "The same roles plus one the registry's groups do not cover."
wires: []
`;

/**
 * The divider again: different coordinates, different component order, different
 * names. Must yield the same netlist up to node relabeling.
 */
export const resistorDividerRedrawn = `${header("Redrawn Divider Fixture")}components:
  - id: R2
    kind: resistor
    name: totally_different_name
    sourceTypeName: Circuit.Resistor
    origin:
      x: -9000
      y: 4200
    rotation: 2
    flipped: true
    terminals:
      - name: a
        node: 2
        position:
          x: -9000
          y: 4180
      - name: b
        node: 0
        position:
          x: -9000
          y: 4220
    properties:
      Resistance: "10000"
      Description: "No description at all like the other one."
  - id: R1
    kind: resistor
    name: another_name
    sourceTypeName: Circuit.Resistor
    origin:
      x: 7777
      y: -3131
    rotation: 1
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 7777
          y: -3151
      - name: b
        node: 2
        position:
          x: 7777
          y: -3111
    properties:
      Resistance: "10k"
      Description: ""
${jacks}wires: []
`;

/**
 * Two clippers that share only ground, so partitioning yields two nonlinear regions.
 *
 * The second pair sits on nodes 7 and 8, reachable from neither port, which is what
 * makes it a second *region* rather than more devices in the first one. Needed because a
 * failure counted per block cannot be told from one counted per sample until a document
 * has two blocks that can fail on the same sample.
 */
export const twoDiodeClippers = derive(
	diodeClipper,
	"wires: []",
	`  - id: R9
    kind: resistor
    name: R_SECOND_ISLAND
    sourceTypeName: Circuit.Resistor
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 7
        position:
          x: 380
          y: 0
      - name: b
        node: 8
        position:
          x: 420
          y: 0
    properties:
      Resistance: "1k"
      Description: "Clock driver series resistor."
  - id: D9
    kind: diode
    name: D_SECOND_ISLAND
    sourceTypeName: Circuit.Diode
    origin:
      x: 460
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 8
        position:
          x: 460
          y: -20
      - name: cathode
        role: cathode
        node: 0
        position:
          x: 460
          y: 20
    properties:
      Description: "Clipping diode, reverb tank side."
  - id: V9
    kind: voltage-source
    name: V_SECOND_ISLAND
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 340
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 7
        position:
          x: 340
          y: -20
      - name: negative
        role: negative
        node: 0
        position:
          x: 340
          y: 20
    properties:
      Voltage: "9"
      Description: "Bucket brigade rail."
wires: []`,
);

/**
 * The redrawn divider with its non-ground nodes renumbered.
 *
 * `resistorDividerRedrawn` varies coordinates, order, names and value notation but keeps
 * node 1 and node 2, so it cannot show whether a node id is a label or a meaning. Here
 * the same circuit calls them 5 and 7. Ground stays 0 because ground is not a label the
 * document is free to choose -- the ground symbol decides it.
 */
export const resistorDividerRelabelled = resistorDividerRedrawn
	.replaceAll(/node: 1$/gmu, "node: 5")
	.replaceAll(/node: 2$/gmu, "node: 7");

/** Malformed: not valid interchange YAML. */
export const malformed = "schema: circuit-interchange/v3\n  : : :\n";

/** A resistor whose value cannot be parsed. Must refuse rather than default. */
export const unparseableValue = resistorDivider.replace(
	'Resistance: "10k"',
	'Resistance: "about ten kilohms"',
);

/** The divider with every node id quoted. A node id is a token, not a number. */
export const quotedNodeDivider = resistorDivider.replaceAll(
	/node: (\d+)$/gmu,
	'node: "$1"',
);

/**
 * The divider with named node ids and a ground symbol.
 *
 * The ground token is called `n_delay_clock_bus` on purpose. Nothing in that name says
 * ground; the only thing that does is the ground symbol sitting on it. A rule that
 * matched node names for `gnd` would pass this fixture while being wrong, and a rule
 * that reads the symbol passes it for the right reason.
 */
export const namedNodeDivider = `${resistorDivider
	.replaceAll(/node: 1$/gmu, "node: n_in_bus")
	.replaceAll(/node: 2$/gmu, 'node: "n_mid_bus"')
	.replaceAll(/node: 0$/gmu, "node: n_delay_clock_bus")
	.replace(/wires: \[\]\n$/u, "")}  - id: GND1
    kind: ground
    name: MN3101_CLOCK_RETURN
    sourceTypeName: Circuit.Ground
    origin:
      x: 100
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: n_delay_clock_bus
        position:
          x: 100
          y: 60
    properties:
      Description: "Clock phase return for the bucket brigade delay memory."
wires: []
`;

/**
 * A structured quantity whose value is stated in kilohms.
 *
 * Ten kilohms, not ten ohms. The format library reports `value` in whatever unit it
 * read, so a stage that trusts `value` without reading `unit` turns every `10k` in the
 * corpus into 10 -- a wrong answer that still renders.
 */
export const kilohmStructuredValue = resistorDivider.replace(
	'Resistance: "10k"',
	'Resistance: { raw: "10k", value: 10, unit: "kohm" }',
);

/** A taper code this stage cannot read, resolved by the library in base units. */
export const taperCodeStructuredValue = resistorDivider.replace(
	'Resistance: "10k"',
	'Resistance: { raw: "A50K", value: 50000, unit: "ohm" }',
);

/** Unreadable notation *and* a non-base unit: no answer is better than a wrong one. */
export const unreadableNonBaseUnit = resistorDivider.replace(
	'Resistance: "10k"',
	'Resistance: { raw: "A50K", value: 50, unit: "kohm" }',
);

/**
 * The same inverting amplifier with its op-amp inputs declared in the other order.
 *
 * Electrically identical: `inverting` is still node 3 and `noninverting` still node 0.
 * Only the order the document lists them in changes, and the corpus really does write
 * it both ways. A stage reading position instead of role exchanges the two inputs
 * here, which inverts the stage while still rendering plausible audio.
 */
export const invertingAmplifierReordered = derive(
	invertingAmplifier,
	`      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
`,
	`      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
`,
);

/**
 * A two-terminal rheostat: 100k track, control at mid travel, feeding ground through
 * a 100k series resistor. A linear sweep at 0.5 is 50k, so the divider reads 100k over
 * 150k = 2/3. Hand-computed before it was measured.
 */
export const rheostatDivider = `${header("Rheostat Fixture")}deviceInterface:
  controls:
    - id: Sag
      label: SAG
      kind: knob
      role: drive
      taper: linear
components:
${jacks}  - id: R1
    kind: resistor
    name: BBD_CLOCK_FEED
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "100k"
      Description: "Clock feed for the delay memory."
  - id: VR1
    kind: variable-resistor
    name: SAG_RHEOSTAT
    sourceTypeName: Circuit.VariableResistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 2
        position:
          x: 100
          y: -20
      - name: cathode
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "100k"
      Wipe: "0.5"
      Sweep: Linear
      ControlId: "Sag"
      Description: "Reverb tank damping, per the clock driver."
wires: []
`;

/**
 * Two rheostats that are the two gangs of one physical knob.
 *
 * The declared control's id is `SAG_CTL`, but each gang names it the way the packets
 * do: one by the control's `audioBinding.controlName`, the other by `PhysicalControl`.
 * Matching only the id leaves both unbound and each invents a control of its own, so
 * one knob silently becomes two that each move half the circuit.
 */
export const gangedRheostats = `${header("Ganged Fixture")}deviceInterface:
  controls:
    - id: SAG_CTL
      label: SAG
      kind: knob
      role: drive
      audioBinding:
        kind: control
        controlName: "Sag Amount"
components:
${jacks}  - id: VR1A
    kind: variable-resistor
    name: VR1A
    sourceTypeName: Circuit.VariableResistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 1
        position:
          x: -100
          y: -20
      - name: cathode
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "100k"
      Wipe: "0.5"
      Sweep: Logarithmic
      ControlRole: "Sag Amount"
      Group: VR1_SAG_GANG_A
      Description: "Clock driver gang A for the delay memory."
  - id: VR1B
    kind: variable-resistor
    name: VR1B
    sourceTypeName: Circuit.VariableResistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 2
        position:
          x: 100
          y: -20
      - name: cathode
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "100k"
      Wipe: "0.5"
      Sweep: Logarithmic
      PhysicalControl: SAG_CTL
      Group: VR1_SAG_GANG_B
      Description: "Reverb tank gang B, per the clock driver."
wires: []
`;

/** The same rheostat with a residual minimum, so the bottom of the sweep is not zero. */
export const rheostatWithMinimum = rheostatDivider.replace(
	'      Resistance: "100k"\n      Wipe: "0.5"',
	'      Resistance: "100k"\n      MinResistance: "20k"\n      Wipe: "0.5"',
);

/**
 * A three-terminal pot wired as a rheostat -- its wiper node **is** its `lug3` -- with both
 * track ends cut off from every DC reference: the far end (node 4) reaches a second op-amp's
 * `vplus` rail node in one hop, and the input-end (node 5) reaches the first op-amp's
 * inverting input in three.
 *
 * This is the narrow path of the pot's orientation evidence. Before 2026-08-25 `vplus` and
 * `vminus` were seeds for that evidence's distance map, so the rail-adjacent end read one hop
 * from an "op-amp input" that was in fact a supply rail: the track oriented to the rail end
 * and the control swept the stage's gain the wrong way, silent at full. Nothing else saw it --
 * the pot still swept, the circuit still converged, and at half travel both orientations agree
 * because a linear taper's midpoint is its own mirror. Only the off-centre values differ, and
 * they are written down in `expected.ts` from the divider arithmetic, not captured from a run.
 *
 * The second op-amp is electrically dead on purpose: its non-inverting input is grounded and
 * its inverting input hangs off a single 100k to ground, so the whole pocket settles at zero
 * and no floating island in the fixture needs gmin to land somewhere.
 */
export const quietSeedRheostat = `${header("Quiet Seed Rheostat Fixture")}deviceInterface:
  controls:
    - id: Level
      label: VOLUME
      kind: knob
      role: output-level
      taper: linear
components:
${jacks}  - id: R1
    kind: resistor
    name: R_INPUT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 3
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade input coupling."
  - id: U1
    kind: opamp
    name: DELAY_MEMORY_CHIP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: -20
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: -20
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 20
          y: 0
    properties:
      Description: "MN3007 bucket brigade delay memory."
  - id: R_FB
    kind: resistor
    name: R_FEEDBACK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 20
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: -60
      - name: b
        node: 3
        position:
          x: 40
          y: -60
    properties:
      Resistance: "100k"
      Description: "Reverb tank feedback."
  - id: C_F
    kind: capacitor
    name: C_MEMORY
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 40
          y: 0
      - name: b
        node: 4
        position:
          x: 80
          y: 0
    properties:
      Capacitance: "10u"
      Description: "Delay memory coupling."
  - id: VR1
    kind: potentiometer
    name: DELAY_MEMORY_CONTROL
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: lug1
        role: end
        node: 5
        position:
          x: 100
          y: -20
      - name: wiper
        role: wiper
        node: 4
        position:
          x: 100
          y: 0
      - name: lug3
        role: end
        node: 4
        position:
          x: 100
          y: 20
    properties:
      Resistance: "100k"
      ControlId: "Level"
      Description: "Delay memory control for the bucket brigade."
  - id: R2A
    kind: resistor
    name: R_FEEDBACK_A
    sourceTypeName: Circuit.Resistor
    origin:
      x: -40
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 8
        position:
          x: -60
          y: -100
      - name: b
        node: 3
        position:
          x: -20
          y: -100
    properties:
      Resistance: "10k"
      Description: "Reverb tank feedback branch."
  - id: R2B
    kind: resistor
    name: R_FEEDBACK_B
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 80
          y: 40
      - name: b
        node: 7
        position:
          x: 120
          y: 40
    properties:
      Resistance: "10k"
      Description: "Reverb tank feedback branch."
  - id: R2C
    kind: resistor
    name: R_FEEDBACK_C
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 7
        position:
          x: 120
          y: 60
      - name: b
        node: 8
        position:
          x: 160
          y: 60
    properties:
      Resistance: "10k"
      Description: "Reverb tank feedback branch."
  - id: R3
    kind: resistor
    name: R_BIAS_LEAF
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 100
          y: -40
      - name: b
        node: 6
        position:
          x: 140
          y: -40
    properties:
      Resistance: "100k"
      Description: "Bias leaf for the clock driver."
  - id: U2
    kind: opamp
    name: CLOCK_DRIVER_CHIP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 180
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 180
          y: 0
      - name: inverting
        role: inverting
        node: 9
        position:
          x: 160
          y: -60
      - name: vplus
        role: supplyPositive
        node: 6
        position:
          x: 200
          y: -80
      - name: vminus
        role: supplyNegative
        node: 0
        position:
          x: 200
          y: 20
      - name: output
        role: output
        node: 10
        position:
          x: 220
          y: -40
    properties:
      Description: "Clock driver for the delay memory."
  - id: R_IB
    kind: resistor
    name: R_BIAS
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 9
        position:
          x: 120
          y: -60
      - name: b
        node: 0
        position:
          x: 160
          y: -60
    properties:
      Resistance: "100k"
      Description: "Clock driver bias."
  - id: R_OUT
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 240
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: 220
          y: -20
      - name: b
        node: 0
        position:
          x: 260
          y: -20
    properties:
      Resistance: "1M"
      Description: "Reverb tank recovery load."
wires: []
`;

/**
 * The divider plus a resistor, an LED and a footswitch that declare no terminals.
 *
 * The corpus is full of these: panel hardware from a photo, bias markers from a build
 * document. They are named and described exactly like circuit elements, so the only
 * honest reason to ignore them is the empty terminal list. Adding them must change
 * nothing at all.
 */
export const dividerWithUnconnectedParts = resistorDivider.replace(
	"wires: []",
	`  - id: R99
    kind: resistor
    name: R99
    sourceTypeName: Circuit.Resistor
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Resistance: "47k"
      Description: "47k half-supply bias-divider source marker."
  - id: STATUS_LED
    kind: led
    name: STATUS_LED
    sourceTypeName: Circuit.Led
    origin:
      x: 340
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Description: "Effect-status LED from the front-panel photo."
  - id: EFFECT_FOOTSWITCH
    kind: switch
    name: EFFECT_FOOTSWITCH
    sourceTypeName: Circuit.Switch
    origin:
      x: 380
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      Description: "Top-mounted stomp footswitch visible in the panel photo."
wires: []`,
);

/**
 * The same emitter follower with its transistor terminals in the corpus's usual order.
 *
 * `collector,base,emitter` is how **282 of the corpus's 490 transistors** are written,
 * against 15 for `base,collector,emitter`. Electrically identical to the fixture above
 * -- the base is still node 3 -- but a stage reading position exchanges base and
 * collector, the transistor never turns on, and the pedal renders silence.
 */
/**
 * The same follower with the supply's two terminals declared the other way round.
 *
 * Electrically identical -- node 5 is still the 9 V rail and node 0 is still the return --
 * but read by position the rail inverts to -9 V, and the packet still compiles `ok`. A
 * supply was the last asymmetric device in the pipeline read by declaration order, and a
 * rail's sign is not a subtle error: every bias point in the circuit hangs off it.
 */
export const emitterFollowerSupplyReversed = derive(
	emitterFollower,
	`      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
`,
	`      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
`,
);

/**
 * The follower's rail stated the way most corpus rails are: one node, against ground.
 *
 * No fixture had this shape, so reading a supply's polarity by role -- which needs two
 * terminals -- refused **34 packets** and took the corpus from 52 compiled to 19, with
 * the whole unit suite still green. The scoreboard caught it; no test could.
 */
export const emitterFollowerRailToGround = derive(
	emitterFollower,
	`      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
`,
	`      - name: plus
        role: positive
        node: 5
        position:
          x: 0
          y: -200
`,
);

/**
 * The same supply stated twice, the second time reversed.
 *
 * Two rows asserting opposite signs across one pair of nodes is a contradiction, not a
 * duplicate -- and keying the dedup on `positive:negative` made the reversed twin look
 * like a different supply, so both were stamped.
 */
export const contradictorySupplyTwin = derive(
	emitterFollower,
	`  - id: V1
    kind: voltage-source`,
	`  - id: V1_TWIN
    kind: voltage-source
    name: SUPPLY_TWIN
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 40
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 0
        position:
          x: 40
          y: -200
      - name: minus
        role: negative
        node: 5
        position:
          x: 40
          y: -180
    properties:
      Voltage: "9"
      Description: "Reverb tank rail, stated a second time."
  - id: V1
    kind: voltage-source`,
);

export const emitterFollowerReordered = derive(
	emitterFollower,
	`      - name: base
        role: base
        node: 3
        position:
          x: 80
          y: 0
      - name: collector
        role: collector
        node: 5
        position:
          x: 120
          y: -20
      - name: emitter
        role: emitter
        node: 4
        position:
          x: 120
          y: 20
`,
	`      - name: collector
        role: collector
        node: 5
        position:
          x: 120
          y: -20
      - name: base
        role: base
        node: 3
        position:
          x: 80
          y: 0
      - name: emitter
        role: emitter
        node: 4
        position:
          x: 120
          y: 20
`,
);

/**
 * The pot divider with the wiper declared last instead of in the middle.
 *
 * `anode,cathode,wiper` is 64 of the corpus's 331 three-terminal pots. Reading position
 * 2 as the wiper makes the grounded end the wiper, which shorts both halves of the
 * track to ground and cuts the output off from the input entirely.
 */
export const potDividerWiperLast = derive(
	potDivider,
	`      - name: end1
        role: end
        node: 1
        position:
          x: -20
          y: 0
      - name: wiper
        role: wiper
        node: 2
        position:
          x: 0
          y: 0
      - name: end2
        role: end
        node: 0
        position:
          x: 20
          y: 0
`,
	`      - name: anode
        role: end
        node: 1
        position:
          x: -20
          y: 0
      - name: cathode
        role: end
        node: 0
        position:
          x: 20
          y: 0
      - name: wiper
        role: wiper
        node: 2
        position:
          x: 0
          y: 0
`,
);

/**
 * The divider with a third jack, and no jack declaring a role.
 *
 * `Circuit.Jack` is the corpus's untyped catch-all: it absorbs DC inlets, remote
 * sockets and second outputs alongside the real pair. The roles here are only in the
 * names, which no stage may read, so there is nothing to resolve a port from. The
 * third jack is declared last on purpose -- a positional fallback would take it as the
 * output, which is how a DC inlet came to be read as a pedal's output.
 */
export const untypedJacks = resistorDivider
	.replace("sourceTypeName: Circuit.Input", "sourceTypeName: Circuit.Jack")
	.replace("sourceTypeName: Circuit.Output", "sourceTypeName: Circuit.Jack")
	.replace(
		"wires: []",
		`  - id: DC_JACK
    kind: jack
    name: DC_JACK
    sourceTypeName: Circuit.Jack
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 400
          y: 0
    properties:
      Description: "Nine volt adaptor inlet for the delay memory clock."
wires: []`,
	);

/**
 * Jacks whose declared roles reach them only through the panel binding.
 *
 * Both jacks are typed `Circuit.Jack`, so the type name says nothing. The roles are
 * declared against panel-facing ids (`INPUT_JACK`, `OUTPUT_JACK`) and the panel binds
 * those to the components — which is how most of the corpus states it, and it is a
 * chain no type-name table can substitute for.
 *
 * A third jack carries `role: direct-output` and is declared **first**, so anything
 * choosing by position or by "the first jack that looks like an output" takes the dry
 * send instead of the effect output.
 */
export const jacksTypedOnlyByRole = `${header("Role Fixture")}deviceInterface:
  controls:
    - id: DIRECT_OUT_JACK
      label: DIRECT
      kind: jack
      role: direct-output
    - id: INPUT_JACK
      label: INPUT
      kind: jack
      role: input
    - id: OUTPUT_JACK
      label: OUTPUT
      kind: jack
      role: output
panel:
  faces:
    - id: top
      layout:
        kind: stompbox-grid
        rows: 1
        columns: 3
        indexing: one-based
      elements:
        - bind:
            componentId: JDIRECT
            controlId: DIRECT_OUT_JACK
          kind: jack
          grid:
            row: 1
            column: 1
        - bind:
            componentId: JIN
            controlId: INPUT_JACK
          kind: jack
          grid:
            row: 1
            column: 2
        - bind:
            componentId: JOUT
            controlId: OUTPUT_JACK
          kind: jack
          grid:
            row: 1
            column: 3
components:
  - id: JDIRECT
    kind: jack
    name: BBD_CLOCK_TAP
    sourceTypeName: Circuit.Jack
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Dry send for the delay memory clock."
${jacks
	.replaceAll("sourceTypeName: Circuit.Input", "sourceTypeName: Circuit.Jack")
	.replaceAll(
		"sourceTypeName: Circuit.Output",
		"sourceTypeName: Circuit.Jack",
	)}  - id: R1
    kind: resistor
    name: BBD_DELAY_MEMORY
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "MN3007 bucket brigade delay memory, clock phase 1."
  - id: R2
    kind: resistor
    name: MN3101_CLOCK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Clock driver support, not a signal element."
wires: []
`;

/**
 * A single-pole, two-throw selector routing the input to one of two resistors.
 *
 * The throws are declared in the opposite order to the options — `throws` are
 * `bright,dark` while `Options` is `Dark,Bright` — because three corpus selectors do
 * exactly that, and taking the option's index would select the other throw. `Position`
 * names the option rather than giving a number, which is how the corpus states it and
 * why `Number(position)` silently becomes half travel.
 */
export const selectorRouting = `${header("Selector Fixture")}deviceInterface:
  controls:
    - id: Range
      label: RANGE
      kind: switch
      role: mode
components:
${jacks}  - id: SW1
    kind: switch
    name: BBD_CLOCK_SELECT
    sourceTypeName: Circuit.Switch
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: common
        role: common
        node: 1
        position:
          x: 0
          y: 0
      - name: bright
        role: throw
        node: 3
        position:
          x: 20
          y: -20
      - name: dark
        role: throw
        node: 4
        position:
          x: 20
          y: 20
    properties:
      Options: "Dark,Bright"
      Position: "Bright"
      ControlId: "Range"
      Description: "Clock phase select for the delay memory."
  - id: R_BRIGHT
    kind: resistor
    name: R_BRIGHT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: -20
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 100
          y: -40
      - name: b
        node: 2
        position:
          x: 100
          y: 0
    properties:
      Resistance: "1k"
      Description: "Bright leg."
  - id: R_DARK
    kind: resistor
    name: R_DARK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 100
          y: 0
      - name: b
        node: 2
        position:
          x: 100
          y: 40
    properties:
      Resistance: "1meg"
      Description: "Dark leg."
  - id: RLOAD
    kind: resistor
    name: RLOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 200
          y: -20
      - name: b
        node: 0
        position:
          x: 200
          y: 20
    properties:
      Resistance: "1k"
      Description: "Load."
wires: []
`;

/**
 * The same selector with its common terminal declared **last**.
 *
 * `throw0,throw1,common` is a real corpus shape, and `marshall-blues-breaker` wires its
 * input jack to exactly such a switch. Attaching throws to a preceding common builds a
 * pole out of the first throw and drops the real common entirely — which left the input
 * jack's node connected to nothing and the pedal silent, while every stage reported
 * success.
 */
export const selectorCommonLast = derive(
	selectorRouting,
	`      - name: common
        role: common
        node: 1
        position:
          x: 0
          y: 0
      - name: bright
        role: throw
        node: 3
        position:
          x: 20
          y: -20
      - name: dark
        role: throw
        node: 4
        position:
          x: 20
          y: 20
`,
	`      - name: bright
        role: throw
        node: 3
        position:
          x: 20
          y: -20
      - name: dark
        role: throw
        node: 4
        position:
          x: 20
          y: 20
      - name: common
        role: common
        node: 1
        position:
          x: 0
          y: 0
`,
);

/**
 * Two jacks whose third terminals carry the **same role name** and opposite senses.
 *
 * `IN.switch` is where the battery's negative landed, so it has to make against the
 * sleeve or the supply has no return and the whole circuit floats. `OUT.switch` carries
 * signal, and making *it* against the sleeve shorts the output to ground.
 *
 * One name, two required answers, so no contact-name vocabulary can decide this. The
 * fixture exists because a name table was tried and shorted 13 corpus jacks, five of
 * them supply rails.
 */
export const switchedJackContacts = `${header("Engage Fixture")}deviceInterface:
  controls:
    - id: IN
      label: INPUT
      kind: jack
      role: input
    - id: OUT
      label: OUTPUT
      kind: jack
      role: output
components:
  - id: IN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Jack
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 1
        position:
          x: -300
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: -300
          y: 20
      - name: switch
        role: switchContact
        node: 5
        position:
          x: -300
          y: 40
    properties:
      Description: "Battery return runs through this contact."
  - id: OUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Jack
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 2
        position:
          x: 300
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 300
          y: 20
      - name: switch
        role: switchContact
        node: 2
        position:
          x: 300
          y: 40
    properties:
      Description: "Normalling contact on the send, carrying signal."
  - id: R1
    kind: resistor
    name: SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: -20
      - name: b
        node: 2
        position:
          x: 0
          y: 20
    properties:
      Resistance: "10k"
  - id: R2
    kind: resistor
    name: SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 5
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
  - id: BT1
    kind: battery
    name: SUPPLY
    sourceTypeName: Circuit.Battery
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 6
        position:
          x: 0
          y: 180
      - name: negative
        role: negative
        node: 5
        position:
          x: 0
          y: 220
    properties:
      Voltage: "9"
  - id: R3
    kind: resistor
    name: RAIL_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 200
          y: 180
      - name: b
        node: 2
        position:
          x: 200
          y: 220
    properties:
      Resistance: "100k"
wires: []
`;

/**
 * A power jack that strands the supply behind its switch contact.
 *
 * `BT1.positive` and `PWR.tip` are alone on node 5, and the circuit's rail is node 6 on
 * the jack's contact. This is the battery-saving arrangement: the contact routes the
 * battery to the pedal and inserting an adaptor breaks it. `boss-od-3` and `boss-mt-2`
 * are exactly this shape.
 *
 * The element has to be tip-to-contact. Closing the contact to the *sleeve* instead is
 * what a contact-name table does, and it shorts the 9 V rail to ground; leaving it open
 * strands the supply and the whole pedal solves with every node at 0 V. So the assertion
 * that matters is which terminal it makes against, not that a law exists.
 */
export const powerJackStrandedSupply = `${header("Stranded Supply Fixture")}deviceInterface:
  controls:
    - id: IN
      label: INPUT
      kind: jack
      role: input
    - id: OUT
      label: OUTPUT
      kind: jack
      role: output
components:
  - id: IN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Jack
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 1
        position:
          x: -300
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: -300
          y: 20
  - id: OUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Jack
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 2
        position:
          x: 300
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 300
          y: 20
  - id: PWR
    kind: jack
    name: DC_JACK
    sourceTypeName: Circuit.PowerJack
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 5
        position:
          x: 0
          y: 180
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 0
          y: 200
      - name: switch
        role: switchContact
        node: 6
        position:
          x: 0
          y: 220
    properties:
      Description: "Battery reaches the circuit only through this contact."
  - id: BT1
    kind: battery
    name: SUPPLY
    sourceTypeName: Circuit.Battery
    origin:
      x: -200
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 5
        position:
          x: -200
          y: 180
      - name: negative
        role: negative
        node: 0
        position:
          x: -200
          y: 220
    properties:
      Voltage: "9"
  - id: R_RAIL
    kind: resistor
    name: RAIL_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 200
          y: 180
      - name: b
        node: 2
        position:
          x: 200
          y: 220
    properties:
      Resistance: "100k"
  - id: PWR_REACHED
    kind: jack
    name: DC_JACK_ALREADY_WIRED
    sourceTypeName: Circuit.PowerJack
    origin:
      x: 0
      y: 400
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 7
        position:
          x: 0
          y: 380
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 0
          y: 400
      - name: switch
        role: switchContact
        node: 8
        position:
          x: 0
          y: 420
    properties:
      Description: "Its supply already reaches the circuit, so no element is needed."
  - id: BT2
    kind: battery
    name: SECOND_SUPPLY
    sourceTypeName: Circuit.Battery
    origin:
      x: -200
      y: 400
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 7
        position:
          x: -200
          y: 380
      - name: negative
        role: negative
        node: 0
        position:
          x: -200
          y: 420
    properties:
      Voltage: "9"
  - id: R_REACHED
    kind: resistor
    name: SECOND_RAIL_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 400
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 7
        position:
          x: 200
          y: 380
      - name: b
        node: 2
        position:
          x: 200
          y: 420
    properties:
      Resistance: "100k"
  - id: PWR_AMBIGUOUS
    kind: jack
    name: DC_JACK_TWO_CONTACTS
    sourceTypeName: Circuit.PowerJack
    origin:
      x: 0
      y: 600
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 9
        position:
          x: 0
          y: 580
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 0
          y: 600
      - name: switch_a
        node: 10
        position:
          x: 0
          y: 620
      - name: switch_b
        node: 11
        position:
          x: 0
          y: 640
    properties:
      Description: "Two candidate destinations, so which one is wired is not stated."
  - id: BT3
    kind: battery
    name: THIRD_SUPPLY
    sourceTypeName: Circuit.Battery
    origin:
      x: -200
      y: 600
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 9
        position:
          x: -200
          y: 580
      - name: negative
        role: negative
        node: 0
        position:
          x: -200
          y: 620
    properties:
      Voltage: "9"
  - id: R1
    kind: resistor
    name: SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: -20
      - name: b
        node: 2
        position:
          x: 0
          y: 20
    properties:
      Resistance: "10k"
  - id: R2
    kind: resistor
    name: SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
wires: []
`;

/**
 * Wired jacks and a ground, and every other component declaring no terminals.
 *
 * `boss-ps-2` is exactly this: 223 real, electrically active parts that are correctly
 * dropped for having no terminals, leaving nothing to solve. Every stage succeeds and
 * the result is a program with no blocks, which can only ever render silence.
 */
export const nothingToExecute = derive(
	derive(
		resistorDivider,
		`      - name: a
        node: 1
        position:
          x: -100
          y: -20
      - name: b
        node: 2
        position:
          x: -100
          y: 20
`,
		"",
	),
		`      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
`,
		"",
	)
	.replaceAll(
		"    terminals:\n    properties:",
		"    terminals: []\n    properties:",
	);

/**
 * The soft-clipping overdrive stage: anti-parallel diodes across an op-amp's feedback
 * resistor, on rails. This is what a Tube Screamer, an OD-1 and a Blues Breaker all
 * are, and the pipeline had no fixture for it.
 *
 * It is also the shape that exposes an undamped op-amp. A diode limits its own Newton
 * step; an op-amp at a gain of 1e5 did not, so the two fought and the iterate cycled
 * rail to rail forever. Every simpler op-amp fixture here converges with or without
 * that damping, including one clipping hard against its rails -- only the two
 * nonlinearities in one loop show it.
 */
export const clippingOverdriveStage = railedAmplifier.replace(
	"wires: []",
	`  - id: D_UP
    kind: diode
    name: MN3007_CLOCK
    sourceTypeName: Circuit.Diode
    origin:
      x: 60
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 3
        position:
          x: 60
          y: -80
      - name: cathode
        role: cathode
        node: 2
        position:
          x: 60
          y: -40
    properties:
      Description: "Feedback clipping diode for the delay memory."
  - id: D_DOWN
    kind: diode
    name: BBD_CLOCK_RETURN
    sourceTypeName: Circuit.Diode
    origin:
      x: 120
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: 2
        position:
          x: 120
          y: -80
      - name: cathode
        role: cathode
        node: 3
        position:
          x: 120
          y: -40
    properties:
      Description: "Feedback clipping diode, reverb tank side."
wires: []`,
)

/**
 * The hybrid the pipeline has never had a case for: analog, then a macro, then analog.
 *
 * An input shell feeds the delay memory's `in`; its `out` feeds an output shell; and a
 * separate RC clock network sits on `cp1`, which is what sets a bucket brigade's delay
 * time. So three analog regions each share exactly one node with the macro, and none
 * shares a node with another — the macro is the only thing between input and output.
 *
 * Three things this is the first case for, all of them written and none exercised:
 *
 *   - `partition.ts` computes `dependencies[macro] = analog regions sharing a node`, and
 *     every case so far has produced `[]`.
 *   - `MacroModel.portTerminals` is declared in the types and read nowhere.
 *   - `Block`'s macro variant has no `inputNode`/`outputNode`, so audio cannot pass
 *     through it. That is the defect this fixture exists to hold still: it compiles, the
 *     macro is placed correctly, and the output region receives nothing.
 *
 * When the operator format lands, the acceptance criterion inverts and this renders.
 */
export const hybridDelayPedal = `${header("Hybrid Delay Fixture")}components:
${jacks}  - id: R_IN
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -160
          y: -20
      - name: b
        node: 3
        position:
          x: -160
          y: 20
    properties:
      Resistance: "10k"
      Description: "Input shell into the delay memory."
  - id: R_IN_SHUNT
    kind: resistor
    name: R_IN_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -120
          y: -20
      - name: b
        node: 0
        position:
          x: -120
          y: 20
    properties:
      Resistance: "10k"
      Description: "Input shell shunt."
  - id: U1
    kind: bbd
    name: U1
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 3
        position:
          x: -20
          y: -20
      - name: out
        node: 4
        position:
          x: 20
          y: -20
      - name: cp1
        node: 5
        position:
          x: -20
          y: 20
      - name: vgg
        node: 6
        position:
          x: 20
          y: 20
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "Bucket brigade delay memory, clocked."
  - id: V_CLK
    kind: rail
    name: V_CLK
    sourceTypeName: Circuit.Rail
    origin:
      x: -80
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 7
        position:
          x: -80
          y: 100
    properties:
      Voltage: "9"
      Description: "Clock network reference rail, so the parameter port has a genuine operating point to read rather than a driveless node at 0 V."
  - id: R_CLK
    kind: resistor
    name: R_CLK
    sourceTypeName: Circuit.Resistor
    origin:
      x: -40
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: -40
          y: 60
      - name: b
        node: 7
        position:
          x: -40
          y: 100
    properties:
      Resistance: "22k"
      Description: "Clock network timing resistor, fed from the reference rail."
  - id: C_CLK
    kind: capacitor
    name: C_CLK
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 40
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 40
          y: 60
      - name: b
        node: 0
        position:
          x: 40
          y: 100
    properties:
      Capacitance: "1n"
      Description: "Clock network timing capacitor."
  - id: R_VGG
    kind: resistor
    name: R_VGG
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 100
          y: 60
      - name: b
        node: 0
        position:
          x: 100
          y: 100
    properties:
      Resistance: "47k"
      Description: "Gate bias network."
  - id: R_OUT
    kind: resistor
    name: R_OUT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 160
          y: -20
      - name: b
        node: 2
        position:
          x: 160
          y: 20
    properties:
      Resistance: "10k"
      Description: "Output shell from the delay memory."
  - id: R_OUT_LOAD
    kind: resistor
    name: R_OUT_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 200
          y: -20
      - name: b
        node: 0
        position:
          x: 200
          y: 20
    properties:
      Resistance: "1meg"
      Description: "Output shell load."
wires: []
`;

/**
 * `hybridDelayPedal` with a control-bearing trim pot added across the clock network's own
 * nodes -- the `parameter` port's negative control. `region.controls` is no longer empty for
 * the clock region, so `couple.ts`'s purity gate must refuse to classify the derivation as
 * `parameter`, per the spec's safe default (missing or negative evidence -> never `parameter`).
 * The macro still compiles and still passes audio; only `parameter` on its block should differ.
 */
/**
 * S1's delay-model controls: the same pedal with one thing changed each time.
 *
 * The BBD delay model is **capacity-based** -- the document's `DelayMs`, converted to samples at
 * the host's rate, then scaled by the `parameter` port's voltage ratio. That decision is recorded
 * in `thoughts/shared/plans/2026-08-25-v2-bbd-pipeline-readiness.md` §5, and these fixtures are
 * what make it a behavioural fact rather than a note: each one moves exactly one input and the
 * delay has to respond, or not, in the one way the model predicts.
 *
 * Every prediction below is hand-derived before measuring, not read off the output:
 * 3 ms x 48 kHz = 144 samples; 6 ms = 288; a clock rail halved against an unchanged 9 V
 * reference halves the scale to 72; and the resolver's stand-in is 50 ms = 2400.
 */
export const hybridDelayPedalLongerDelay = derive(
	hybridDelayPedal,
	'DelayMs: "3"',
	'DelayMs: "6"',
);

/**
 * `hybridDelayPedal` with `R_OUT_LOAD` changed from 1meg to 10k.
 *
 * S2 negative control: the macro output has an internal 1k impedance and 10k series resistor.
 * Dividing into a 10k load yields an output divider of 10k/(10k + 10k + 1k) = 10/21 (~0.4762),
 * shifting total gain from ~0.4470 to ~0.2152, verifying that output loading is modeled.
 */
export const hybridDelayPedalLoadedOutput = derive(
	hybridDelayPedal,
	'      Resistance: "1meg"\n',
	'      Resistance: "10k"\n',
);

/**
 * The clock rail halved, 9 V to 4.5 V, against a `parameterReferenceVolts` still 9.
 *
 * This is the coupling the delay model *does* have, and naming it is the honest complement to
 * the frequency-independence assertion: the `parameter` port reads the clock node's **voltage**
 * and scales the capacity by `|volts| / referenceVolts`. Nothing reads a frequency anywhere.
 * A real BBD's delay is `stages / (2 * f_clock)`, so this is a capacity model with a voltage
 * trim, not a clock model -- which is exactly what §5 chose and what S6 revisits.
 */
export const hybridDelayPedalHalfClockRail = derive(
	hybridDelayPedal,
	'      Voltage: "9"\n',
	'      Voltage: "4.5"\n',
);

/**
 * `DelayMs` removed while the `cp1` parameter terminal remains.
 *
 * The resolver substitutes a 50 ms stand-in rather than refusing, on the grounds that a part
 * with a clock terminal has *somewhere* the delay could have come from. **This fixture exists to
 * pin that number as a deliberate, visible choice rather than a silent one** -- it is the
 * mechanism by which all four of the Deluxe Memory Man's MN3008 macros resolve to
 * `delaySeconds: 0.05` while the document declares no delay at all, and it is BBD plan S1's
 * open question: a stand-in the size of a real echo is indistinguishable from a modelled one.
 */
export const hybridDelayPedalNoDeclaredDelay = derive(
	hybridDelayPedal,
	'      DelayMs: "3"\n',
	"",
);

/**
 * `DelayMs` removed *and* the `cp1` parameter terminal removed.
 *
 * With no declared delay and no clock terminal there is nothing left to derive a delay from, so
 * the pipeline refuses by name. The pair with the fixture above is the whole point: the same
 * missing property is a 50 ms stand-in or a refusal depending on one terminal, and a reader
 * should be able to see which lever decides it.
 */
export const hybridDelayPedalNoDelayNoClock = derive(
	hybridDelayPedalNoDeclaredDelay,
	"      - name: cp1\n        node: 5\n        position:\n          x: -20\n          y: 20\n",
	"",
);

export const hybridDelayPedalMovableClock = derive(
	derive(
		hybridDelayPedal,
		"components:",
		`deviceInterface:
  controls:
    - id: ClockTrim
      label: TRIM
      kind: knob
      role: rate
      taper: linear
components:`,
	),
	"  - id: V_CLK",
	`  - id: VR_CLK_TRIM
    kind: potentiometer
    name: VR_CLK_TRIM
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: -120
      y: 120
    rotation: 0
    flipped: false
    terminals:
      - name: end1
        role: end
        node: 5
        position:
          x: -140
          y: 120
      - name: wiper
        role: wiper
        node: 7
        position:
          x: -120
          y: 120
      - name: end2
        role: end
        node: 7
        position:
          x: -100
          y: 120
    properties:
      Resistance: "10k"
      ControlId: "ClockTrim"
      Description: "Clock trim, so the clock network is no longer control-free."
  - id: V_CLK`,
);

/**
 * `hybridDelayPedal` with a resistor joining the input shell's node (3, the macro's audio-in
 * tap) directly to the output shell's node (2, downstream of the macro's audio-out write-back)
 * -- the region SCHEDULE's coincident case. This merges what were two separate analog regions
 * into one, so that ONE region is both the macro's driver and its downstream: an unbuffered
 * dry-blend/regen network, exactly the topology all three real delay/BBD packets that clear
 * device-law identification (`pt2399-delay`, `boss-ce-2`, `boss-ce-5`) actually wire.
 *
 * Refused by `link.ts`'s `topologicalOrder` from 2026-08-14's first landing of clause 3 through
 * the same day's correction: a genuine 2-cycle (the region must run both before the macro, for
 * audio-in, and after it, for the write-back) with both directions added unconditionally. Now
 * resolved with a documented one-sample write-back lag in exactly this case -- see the
 * "coincident case" comment in `couple.ts` for the mechanism -- so this fixture **compiles**,
 * which is what changed; `hybridDelayPedalChainedMacroCycle` below is the fixture that still
 * refuses.
 */
export const hybridDelayPedalCyclicSchedule = derive(
	hybridDelayPedal,
	"wires: []",
	`  - id: R_LOOP
    kind: resistor
    name: R_LOOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -20
          y: -80
      - name: b
        node: 2
        position:
          x: 20
          y: -80
    properties:
      Resistance: "100k"
      Description: "Joins the input and output shells, so the macro's driver and downstream become one region."
wires: []`,
);

/**
 * `hybridDelayPedal` with a SECOND macro, `U2`, chained the opposite way round: its audio-in
 * sits on node 2 (U1's downstream region) and its audio-out sits on node 3 (U1's own driver
 * region) -- a loop through two DISTINCT regions and two DISTINCT macros, not one macro whose
 * own driver and downstream coincide. `couple.ts`'s coincident-case lag only applies when a
 * single macro's driver and downstream are the SAME region (a direct check on that one macro's
 * own edges); it does not and should not paper over a longer cycle chained through a second
 * macro, so this must still refuse exactly as before -- the negative control the resolved
 * `hybridDelayPedalCyclicSchedule` above can no longer serve now that it compiles.
 */
export const hybridDelayPedalChainedMacroCycle = derive(
	hybridDelayPedal,
	"wires: []",
	`  - id: U2
    kind: bbd
    name: U2
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: 0
      y: -160
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 2
        position:
          x: -20
          y: -160
      - name: out
        node: 3
        position:
          x: 20
          y: -160
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "Second macro, chained the other way: driven from the first macro's downstream region, writing back into the first macro's own driver region."
wires: []`,
);

/**
 * The pot divider with no taper on the panel control, so the pot's own spelling is what
 * has to resolve. Three spellings the corpus actually writes, two of which prefix
 * matching read wrongly: `AntiLogarithmic` matched no rule and fell through to linear,
 * and `ReverseLinear` matched `startsWith("rev")` and became reverse-logarithmic.
 */
const potWithoutPanelTaper = derive(potDivider, "      taper: linear\n", "");

const potWithTaper = (declared: string): string =>
	derive(
		potWithoutPanelTaper,
		'      ControlId: "Level"',
		`      ControlId: "Level"\n      Taper: "${declared}"`,
	);

export const potAntiLogarithmicTaper = potWithTaper("AntiLogarithmic");
export const potReverseLinearTaper = potWithTaper("ReverseLinear");
export const potLogarithmicTaper = potWithTaper("Logarithmic");
export const potLinearTaper = potWithTaper("Linear");
/** A manufacturer's own curve. We do not know its shape, so it must not be guessed. */
export const potUnknownTaperCode = potWithTaper("W20");

/**
 * The source recording that it does **not** state a taper, which is a complete statement rather
 * than a marking this stage failed to read. 18 corpus declarations are this shape.
 */
export const potSourceUnmarkedTaper = potWithTaper("source-unmarked");

/**
 * A taper `@vessel-dsp/core`'s format carries and this runtime has no curve for. `TaperKind` has
 * four laws; `PotentiometerTaper` has seven. Stating one of the other three is a real taper the
 * render cannot produce, which is a different thing from an unreadable marking.
 */
export const potSteppedTaper = potWithTaper("stepped");

/** A pot wired as a two-terminal rheostat, which lowering cannot stamp. */
// Through `derive`, not `String.replace`: a replace that stops matching **silently returns its
// input**, and this fixture then becomes a copy of `potDivider` and compiles. That happened the
// moment the pot terminals gained `role:` lines, and the only sign was a refusal test reporting
// `ok`. `derive` throws instead.
export const rheostatPot = derive(
	potDivider,
	`      - name: end2
        role: end
        node: 0
        position:
          x: 20
          y: 0
`,
	"",
);

/**
 * One control on two pots in different regions, which the partition invariant refuses.
 * A dual-gang pot is the real circuit this shape comes from.
 */
export const straddlingControl = potDivider.replace(
	"wires: []",
	`  - id: VR2
    kind: potentiometer
    name: SECOND_GANG
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: end1
        role: end
        node: 7
        position:
          x: 380
          y: 0
      - name: wiper
        role: wiper
        node: 8
        position:
          x: 400
          y: 0
      - name: end2
        role: end
        node: 0
        position:
          x: 420
          y: 0
    properties:
      Resistance: "10k"
      ControlId: "Level"
      Description: "Second gang of the same physical knob."
wires: []`,
);

/**
 * A mains inlet feeding a resistive divider, and the only fixture whose supply moves.
 *
 * Written in the shape the amp packets use: the voltage and the frequency are both structured
 * `{raw, value, unit}` with prose in `raw`, so this exercises the reading a bare `"10"` would
 * not. `hot`/`neutral` are the mains pair those packets declare.
 *
 * Hand-computable, and the numbers are chosen so the supply's own impedance is *visible* in the
 * answer: `SUPPLY_SOURCE_OHMS` is 1, so the loop is `1 + 999 + 1000 = 2000` ohms and the
 * midpoint sits at exactly half the EMF. A stamp that dropped `sourceOhms` would read
 * `1000/1999` and be wrong in the fourth digit.
 *
 * The input jack is deliberately alone on node 1. This circuit has no signal path -- it is a
 * supply -- and an input source stamped onto a divider node would force the voltage this
 * fixture is measuring.
 */
export const acMainsDivider = `${header("AC Mains Divider Fixture")}components:
${jacks}  - id: VMAINS
    kind: voltage-source
    name: BBD_CLOCK_GENERATOR
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -100
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 3
        position:
          x: -100
          y: -120
      - name: neutral
        role: negative
        node: 0
        position:
          x: -100
          y: -80
    properties:
      Voltage:
        raw: 10 VAC RMS assumed nominal
        value: 10
        unit: V
      Frequency:
        raw: 60 Hz assumed nominal
        value: 60
        unit: Hz
      Description: "Delay clock driver rail for the bucket brigade."
  - id: R1
    kind: resistor
    name: R_UPPER
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 0
          y: -70
      - name: b
        node: 2
        position:
          x: 0
          y: -30
    properties:
      Resistance: "999"
      Description: "Reverb tank send."
  - id: R2
    kind: resistor
    name: R_LOWER
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 0
          y: 30
      - name: b
        node: 0
        position:
          x: 0
          y: 70
    properties:
      Resistance: "1000"
      Description: "Reverb tank recovery."
wires: []
`;

/**
 * The same document with **only the frequency removed**, which is the whole discriminator.
 *
 * The negative control for the AC source: one deleted property has to turn a sine into a
 * battery, and nothing else about the document changes. A `derive` rather than a copy, so the
 * two cannot drift apart silently.
 */
export const dcMainsDivider = derive(
	acMainsDivider,
	`      Frequency:
        raw: 60 Hz assumed nominal
        value: 60
        unit: Hz
`,
	"",
);

/**
 * A tube rectifier passing DC into a load, which makes its space-charge law hand-checkable.
 *
 * A 300 V rail through 100 ohms into the plate, cathode into 10k. At the solved point two
 * independent equations must both hold — the load's `I = V(cathode)/10k` and the tube's
 * `I = K * (V(plate) - V(cathode))^1.5` — so the fixed point of
 * `I = K * (300 - 10101*I)^1.5` is the answer without trusting any solver: `I = 27.9 mA` at a
 * `18.4 V` drop, leaving the cathode at `278.8 V`. (The 10101 is 10k of load plus 100 ohms of
 * series resistance plus the rail's own 1 ohm.)
 *
 * DC rather than mains on purpose: it isolates the tube's law from the AC source and the
 * reservoir, so a failure here is the law and nothing else.
 */
export const tubeDiodeIntoLoad = `${header("Tube Rectifier Fixture")}components:
${jacks}  - id: VPLUS
    kind: rail
    name: BBD_CLOCK_RAIL
    sourceTypeName: Circuit.Rail
    origin:
      x: -200
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 3
        position:
          x: -200
          y: -200
    properties:
      Voltage: "300"
      Description: "Delay memory supply."
  - id: RSERIES
    kind: resistor
    name: R_SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: -150
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -100
          y: -170
      - name: b
        node: 4
        position:
          x: -100
          y: -130
    properties:
      Resistance: "100"
      Description: "Clock driver series resistance."
  - id: V1_RECT
    kind: tube-diode
    name: REVERB_TANK_DRIVER
    sourceTypeName: Circuit.TubeDiode
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: plate
        role: plate
        node: 4
        position:
          x: 0
          y: -120
      - name: cathode
        role: cathode
        node: 2
        position:
          x: 0
          y: -80
    properties:
      Description: "Bucket brigade clock rectifier."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Reverb tank load."
wires: []
`;

/**
 * The same rectifier, with a declared-voltage port added on the cathode/load node.
 *
 * `BPLUS_PORT` states `280 V` on node 2 — a plausible nominal chart value, deliberately not the
 * `278.8 V` the tube law and the 10k load actually solve to, so a promoted ideal source and a
 * real rectifier answer are distinguishable by more than rounding. Before this milestone,
 * `voltagePortRails` had no way to see that node 2 is already generated (a `tube-diode` did not
 * count as DC-conducting), so it promoted this port to an ideal `280 V` rail, deleting
 * `V1_RECT`/`RLOAD`/`RSERIES` from the answer entirely. The fix is exactly the claim under test:
 * the solved cathode voltage must still be `278.8 V` from the tube law, not the declared `280 V`.
 */
export const tubeDiodeIntoLoadWithDeclaredPort = derive(
	tubeDiodeIntoLoad,
	"wires: []\n",
	`  - id: BPLUS_PORT
    kind: port
    name: REVERB_TANK_BPLUS
    sourceTypeName: Circuit.Port
    origin:
      x: 200
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 2
        position:
          x: 200
          y: -100
    properties:
      Voltage: "280"
      Description: "Chart B+ for the reverb tank driver."
wires: []
`,
);

/**
 * The same rectifier with its plate and cathode exchanged, and nothing else.
 *
 * The negative control for terminal roles: reversed, a rectifier conducts on the other
 * half-cycle, and at DC it conducts nothing at all — so the load sits at zero instead of at
 * 278.8 V. A positional reading of these two terminals would pass the fixture above and this
 * one, which is why the pair exists.
 */
const tubeDiodeReversedPlate = derive(
	tubeDiodeIntoLoad,
	`      - name: plate
        role: plate
        node: 4`,
	`      - name: plate
        role: plate
        node: 2`,
);
// Second swap through `derive` rather than `String.replace`: a raw replace that stops matching
// no-ops silently, which is how a "reversed" fixture becomes a copy of its parent and its
// negative control asserts nothing. That is this file's own stated hazard, and it bit here when
// the role line was added between `name` and `node`.
export const tubeDiodeReversed = derive(
	tubeDiodeReversedPlate,
	`      - name: cathode
        role: cathode
        node: 2`,
	`      - name: cathode
        role: cathode
        node: 4`,
);

/**
 * The five-terminal dual rectifier the amp corpus actually declares: `plate_a`, `plate_b`, one
 * `cathode_filament`, and two heaters that carry no signal.
 *
 * Both plates are fed from the same 300 V rail through their own 150 ohms, which is a stand-in
 * for the centre-tapped secondary the real supplies use — this fixture is about how one component
 * becomes two elements, not about the winding. The heater nodes are wired to nothing else, which
 * is exactly how they appear in the packets.
 */
export const dualPlateTubeRectifier = `${header("Dual Rectifier Fixture")}components:
${jacks}  - id: VPLUS
    kind: rail
    name: BBD_CLOCK_RAIL
    sourceTypeName: Circuit.Rail
    origin:
      x: -200
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 3
        position:
          x: -200
          y: -200
    properties:
      Voltage: "300"
      Description: "Delay memory supply."
  - id: RSERIES_A
    kind: resistor
    name: R_SERIES_A
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: -150
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -100
          y: -170
      - name: b
        node: 4
        position:
          x: -100
          y: -130
    properties:
      Resistance: "150"
      Description: "Clock driver series resistance."
  - id: RSERIES_B
    kind: resistor
    name: R_SERIES_B
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -100
          y: -70
      - name: b
        node: 5
        position:
          x: -100
          y: -30
    properties:
      Resistance: "150"
      Description: "Second clock driver series resistance."
  - id: V3_5Y3
    kind: tube-diode
    name: REVERB_TANK_DRIVER
    sourceTypeName: Circuit.TubeDiode
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: plate_a
        role: plate
        node: 4
        position:
          x: 0
          y: -140
      - name: plate_b
        role: plate
        node: 5
        position:
          x: 0
          y: -100
      - name: cathode_filament
        role: cathode
        node: 2
        position:
          x: 40
          y: -120
      - name: heater_a
        role: heater
        node: 6
        position:
          x: 0
          y: -60
      - name: heater_b
        role: heater
        node: 7
        position:
          x: 40
          y: -60
    properties:
      Description: "Bucket brigade dual clock rectifier."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Reverb tank load."
wires: []
`;

/**
 * A working divider plus a pot in its **own galvanic island**, which the emitted program
 * therefore does not execute.
 *
 * Every earlier way of being a dead knob is deliberately excluded: `VR9`'s wiper is loaded by
 * `R91` so it is not floating, and every one of the island's nodes is shared, so no device is
 * joined to nothing. The pot is real, grounded through `R92`, and its coefficients move with
 * the knob -- and its region owns neither jack, so nothing it computes can reach the output
 * and `link` leaves it out of the execution order.
 *
 * The island touches the signal path only at ground, which is what makes it a separate region:
 * stage 4 groups by shared *non-ground* node. Its prose says the opposite, as every fixture's
 * does -- `MASTER_VOLUME`, `role: output-level`, a description calling it the output control --
 * so a stage reading names would report the most important knob on the pedal.
 */
export const controlInUnexecutedRegion = derive(
	derive(
		resistorDivider,
		"components:",
		`deviceInterface:
  controls:
    - id: Trim
      label: MASTER_VOLUME
      kind: knob
      role: output-level
      taper: linear
components:`,
	),
	"wires: []",
	`  - id: VR9
    kind: potentiometer
    name: MASTER_VOLUME
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: end1
        role: end
        node: 10
        position:
          x: 280
          y: 0
      - name: wiper
        role: wiper
        node: 11
        position:
          x: 300
          y: 0
      - name: end2
        role: end
        node: 12
        position:
          x: 320
          y: 0
    properties:
      Resistance: "10k"
      ControlId: "Trim"
      Description: "Output level control feeding the reverb tank recovery stage."
  - id: R91
    kind: resistor
    name: WIPER_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 300
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 11
        position:
          x: 300
          y: 40
      - name: b
        node: 12
        position:
          x: 300
          y: 80
    properties:
      Resistance: "22k"
      Description: "Wiper load, so the track is not merely two halves in series."
  - id: R92
    kind: resistor
    name: ISLAND_RETURN
    sourceTypeName: Circuit.Resistor
    origin:
      x: 360
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 12
        position:
          x: 360
          y: -20
      - name: b
        node: 0
        position:
          x: 360
          y: 20
    properties:
      Resistance: "4k7"
      Description: "Island return to ground."
  - id: R93
    kind: resistor
    name: ISLAND_TOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: 240
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: 240
          y: -20
      - name: b
        node: 0
        position:
          x: 240
          y: 20
    properties:
      Resistance: "4k7"
      Description: "Island supply leg."
wires: []`,
);

/**
 * The negative control for the fixture above: the same island, returned to the **output node**
 * instead of to ground.
 *
 * One node changes, and with it the island stops being an island -- it joins the signal path's
 * region, gets scheduled, and the knob really does load the output. Nothing else differs, so a
 * warning that fires on both is reporting the pot rather than the schedule.
 */
export const controlInScheduledRegion = derive(
	controlInUnexecutedRegion,
	`      - name: b
        node: 0
        position:
          x: 360
          y: 20
    properties:
      Resistance: "4k7"
      Description: "Island return to ground."`,
	`      - name: b
        node: 2
        position:
          x: 360
          y: 20
    properties:
      Resistance: "4k7"
      Description: "Island return to the output node."`,
);

/**
 * The same mains inlet drawing amps instead of milliamps, for the supply-current telemetry.
 *
 * `3 ohms` and `1 ohm` in place of the divider's kilohms, so with the supply's own ohm the loop is
 * `5 ohms`. The declared `10 V` is read as RMS by the `ac-source` law's convention and converted
 * to `10 * sqrt(2)` V peak, so the peak current is exactly `10 * sqrt(2) / 5 = 2.8284... A` — a
 * draw three orders of magnitude past anything a pedal makes, and one the **operating point
 * cannot see at all**, because it evaluates an AC source at its `t = 0` zero.
 */
export const acSupplyDrawingAmps = derive(
	derive(acMainsDivider, `      Resistance: "999"`, `      Resistance: "3"`),
	`      Resistance: "1000"`,
	`      Resistance: "1"`,
);

/**
 * A bridge rectifier as one component, which is what four of the amp corpus's and two of the
 * pedal corpus's diode components are: `[ac_a, ac_b, positive, negative]`.
 *
 * Resistive load and **no reservoir**, deliberately: the rail then follows the rectified sine
 * instantaneously, so every sample is hand-computable with no settling to wait for. At the sine's
 * peak the loop is `20 V = rail + two junction drops`, and with the class-default silicon junction
 * (`IS = 2.52e-9`, `N = 1.752`) carrying `rail/1k`, that fixed point is `18.57 V`:
 * `2 * 1.752 * 0.025852 * ln(0.01857/2.52e-9) = 1.43 V` of drop.
 *
 * The **negative** peak is the point of the fixture. A bridge rectifies both halves, so the rail
 * must read the same there; the single junction this used to lower to gives a rail of nothing at
 * both peaks, with the two DC terminals touching nothing at all.
 */
export const bridgeRectifier = `${header("Bridge Rectifier Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_CLOCK_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -300
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 4
        position:
          x: 300
          y: 0
    properties:
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: VSEC
    kind: voltage-source
    name: BBD_CLOCK_WINDING
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -200
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 2
        position:
          x: -200
          y: -120
      - name: neutral
        role: negative
        node: 3
        position:
          x: -200
          y: -80
    properties:
      Voltage:
        raw: 20 V secondary peak
        value: 20
        unit: V
      Frequency:
        raw: 60 Hz nominal
        value: 60
        unit: Hz
      Description: "Delay clock winding."
  - id: DBRIDGE
    kind: diode
    name: BBD_CLOCK_RECTIFIER
    sourceTypeName: Circuit.Diode
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: ac_a
        role: ac
        node: 2
        position:
          x: -20
          y: -120
      - name: ac_b
        role: ac
        node: 3
        position:
          x: -20
          y: -80
      - name: positive
        role: positive
        node: 4
        position:
          x: 20
          y: -120
      - name: negative
        role: negative
        node: 0
        position:
          x: 20
          y: -80
    properties:
      Description: "Clock rectifier bridge."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 200
          y: -20
      - name: b
        node: 0
        position:
          x: 200
          y: 20
    properties:
      Resistance: "1k"
      Description: "Reverb tank load."
wires: []
`;

/**
 * The same bridge with its four terminals named as a three-pin clamp package, which is a shape
 * the role table deliberately does not cover.
 *
 * The refusal control. Before the multi-junction reading, a diode component naming no `anode`
 * fell through to declaration order and lowered to a junction between its **first two**
 * terminals, whatever they were — so this compiled, rendered, and modelled a device the source
 * does not contain. `pin1_`/`pin2_`/`pin3_` are stripped by the role folding exactly as stage 1
 * strips them (`^pin\d+`, which also eats the leading `5` in `pin2_5a_clamp`), so the tokens
 * this refuses on are `groundclamp`, `aclamp` and `signal` — checked against
 * `electro-harmonix-holy-grail`'s real `D1`, the shape this fixture is transcribed from.
 */
export const clampPackageDiode = derive(
	bridgeRectifier,
	`      - name: ac_a
        role: ac
        node: 2
        position:
          x: -20
          y: -120
      - name: ac_b
        role: ac
        node: 3
        position:
          x: -20
          y: -80
      - name: positive
        role: positive
        node: 4
        position:
          x: 20
          y: -120
      - name: negative
        role: negative
        node: 0
        position:
          x: 20
          y: -80`,
	`      - name: pin1_ground_clamp
        node: 0
        position:
          x: -20
          y: -120
      - name: pin2_5a_clamp
        node: 2
        position:
          x: -20
          y: -80
      - name: pin3_signal
        node: 4
        position:
          x: 20
          y: -120`,
);

/**
 * A dual rectifier sharing one cathode, declared under `kind: diode` with tube electrode names —
 * the shape eight of the amp corpus's rectifiers use (`plate_a`, `plate_b`, `cathode`, plus two
 * heaters that carry no signal).
 *
 * The same winding as the bridge above, wired the way a shared-cathode pack is: `plate_a` driven,
 * `plate_b` at ground, cathode into the load. So it rectifies **one** half — at the positive peak
 * the loop is `20 V = rail + one junction drop`, giving `19.28 V`, and at the negative peak the
 * rail is nothing. That is the pair of numbers that tells this topology from the bridge's, which
 * reads the same at both peaks.
 *
 * Two junctions, and **both keep the silicon law the declared kind asks for**. The lowering fixes
 * the wiring; it does not read a vacuum device out of a terminal name.
 */
export const dualAnodeRectifier = derive(
	derive(
		bridgeRectifier,
		`      - name: ac_a
        role: ac
        node: 2
        position:
          x: -20
          y: -120
      - name: ac_b
        role: ac
        node: 3
        position:
          x: -20
          y: -80
      - name: positive
        role: positive
        node: 4
        position:
          x: 20
          y: -120
      - name: negative
        role: negative
        node: 0
        position:
          x: 20
          y: -80`,
		`      - name: plate_a
        role: plate
        node: 2
        position:
          x: -20
          y: -120
      - name: plate_b
        role: plate
        node: 0
        position:
          x: -20
          y: -80
      - name: cathode
        role: cathode
        node: 4
        position:
          x: 20
          y: -120
      - name: heater_a
        role: heater
        node: 5
        position:
          x: 20
          y: -80
      - name: heater_b
        role: heater
        node: 6
        position:
          x: 40
          y: -80`,
	),
	`      - name: neutral
        role: negative
        node: 3`,
	`      - name: neutral
        role: negative
        node: 0`,
);

/**
 * A transformer with one primary and one untapped secondary, specified by winding voltages
 * rather than by a `Ratio` or an impedance pair -- the "2-winding case". `PrimaryVoltage` (not
 * `Primary`) is the spelling declared here, and as of 2026-08-14 nothing reads it: a winding
 * specified this way is driven at its own stated voltage and no primary is modelled. It is
 * left in the fixture deliberately, as the check that it is now inert.
 *
 * `MAINS` carries the frequency the driven winding runs at. A transformer does not change
 * frequency, so a document with no AC supply in it states none and refuses.
 */
export const twoWindingVoltageDerivedTransformer = `${header("Two-Winding Voltage-Derived Transformer Fixture")}components:
  - id: MAINS
    kind: voltage-source
    name: MAINS_INLET
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 1
        position:
          x: -300
          y: -20
      - name: neutral
        role: negative
        node: 0
        position:
          x: -300
          y: 20
    properties:
      Voltage:
        raw: 120 VAC RMS nominal
        value: 120
        unit: V
      Frequency:
        raw: 60 Hz nominal
        value: 60
        unit: Hz
      Description: "Mains inlet."
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: filament_a
        role: winding
        node: 2
        position:
          x: 20
          y: -20
      - name: filament_b
        role: winding
        node: 0
        position:
          x: 20
          y: 20
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
      - role: filament
        terminals:
          - filament_a
          - filament_b
        voltage:
          raw: "6 VAC filament winding"
          value: 6
          unit: "V"
    properties:
      PrimaryVoltage:
        raw: "120 VAC nominal"
        value: 120
        unit: V
      Description: "Reverb tank recovery filament supply."
  - id: RL
    kind: resistor
    name: LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 80
      - name: b
        node: 0
        position:
          x: 120
          y: 120
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/**
 * A transformer with one primary and one **centre-tapped** secondary, specified by a single
 * per-half winding voltage and isolated from any other winding so the centre-tap arithmetic is
 * the only thing under test. `Primary` (not `PrimaryVoltage`) is the spelling declared here,
 * and like `twoWindingVoltageDerivedTransformer`'s it is now inert.
 */
export const centerTappedVoltageDerivedTransformer = `${header("Centre-Tapped Voltage-Derived Transformer Fixture")}components:
  - id: MAINS
    kind: voltage-source
    name: MAINS_INLET
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 1
        position:
          x: -300
          y: -20
      - name: neutral
        role: negative
        node: 0
        position:
          x: -300
          y: 20
    properties:
      Voltage:
        raw: 120 VAC RMS nominal
        value: 120
        unit: V
      Frequency:
        raw: 60 Hz nominal
        value: 60
        unit: Hz
      Description: "Mains inlet."
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: hv_a
        role: winding
        node: 2
        position:
          x: 20
          y: -30
      - name: hv_center_tap
        role: windingCenterTap
        node: 0
        position:
          x: 20
          y: 0
      - name: hv_b
        role: winding
        node: 3
        position:
          x: 20
          y: 30
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
      - role: hv
        terminals:
          - hv_a
          - hv_center_tap
          - hv_b
        voltage:
          raw: "20-0-20 VAC RMS, the per-half voltage of the centre-tapped winding"
          value: 20
          unit: "V"
    properties:
      Primary:
        raw: "60 VAC nominal"
        value: 60
        unit: V
      Description: "Reverb tank recovery high-voltage supply."
  - id: RLA
    kind: resistor
    name: LOAD_A
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 40
      - name: b
        node: 0
        position:
          x: 120
          y: 80
    properties:
      Resistance: "10k"
      Description: "Load A."
  - id: RLB
    kind: resistor
    name: LOAD_B
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 140
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 120
          y: 120
      - name: b
        node: 0
        position:
          x: 120
          y: 160
    properties:
      Resistance: "10k"
      Description: "Load B."
wires: []
`;

/**
 * A power transformer with three secondaries off one primary -- a centre-tapped HV winding
 * plus two untapped windings -- shaped exactly like `fender-5e3-deluxe-tweed`'s
 * `PT_5E3_POWER_TRANSFORMER` but with round numbers. Three windings at three different
 * voltages off one core is what no single `Ratio` can express, and what the driven-winding
 * lowering handles without needing a primary at all.
 */
export const powerTransformerVoltageDerived = `${header("Power Transformer Voltage-Derived Fixture")}components:
  - id: MAINS
    kind: voltage-source
    name: MAINS_INLET
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: hot
        role: positive
        node: 1
        position:
          x: -300
          y: -20
      - name: neutral
        role: negative
        node: 0
        position:
          x: -300
          y: 20
    properties:
      Voltage:
        raw: 120 VAC RMS nominal
        value: 120
        unit: V
      Frequency:
        raw: 60 Hz nominal
        value: 60
        unit: Hz
      Description: "Mains inlet."
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: hv_a
        role: winding
        node: 2
        position:
          x: 20
          y: -60
      - name: hv_center_tap
        role: windingCenterTap
        node: 0
        position:
          x: 20
          y: -30
      - name: hv_b
        role: winding
        node: 3
        position:
          x: 20
          y: 0
      - name: rectifier_heater_a
        role: winding
        node: 4
        position:
          x: 20
          y: 30
      - name: rectifier_heater_b
        role: winding
        node: 0
        position:
          x: 20
          y: 60
      - name: filament_a
        role: winding
        node: 5
        position:
          x: 20
          y: 90
      - name: filament_b
        role: winding
        node: 0
        position:
          x: 20
          y: 120
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
      - role: hv
        terminals:
          - hv_a
          - hv_center_tap
          - hv_b
        voltage:
          raw: "250-0-250 VAC RMS derived, per-half voltage"
          value: 250
          unit: "V"
      - role: rectifier-heater
        terminals:
          - rectifier_heater_a
          - rectifier_heater_b
        voltage:
          raw: "5 VAC rectifier heater winding"
          value: 5
          unit: "V"
      - role: filament
        terminals:
          - filament_a
          - filament_b
        voltage:
          raw: "10 VAC filament winding"
          value: 10
          unit: "V"
    properties:
      Primary:
        raw: "100 VAC assumed nominal"
        value: 100
        unit: V
      Description: "Reverb tank recovery power supply."
  - id: RL_HVA
    kind: resistor
    name: LOAD_HV_A
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 20
      - name: b
        node: 0
        position:
          x: 120
          y: 60
    properties:
      Resistance: "100k"
      Description: "Load HV A."
  - id: RL_HVB
    kind: resistor
    name: LOAD_HV_B
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 120
          y: 80
      - name: b
        node: 0
        position:
          x: 120
          y: 120
    properties:
      Resistance: "100k"
      Description: "Load HV B."
  - id: RL_RECT
    kind: resistor
    name: LOAD_RECTIFIER_HEATER
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 160
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: 120
          y: 140
      - name: b
        node: 0
        position:
          x: 120
          y: 180
    properties:
      Resistance: "10k"
      Description: "Load rectifier heater."
  - id: RL_FIL
    kind: resistor
    name: LOAD_FILAMENT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 220
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 120
          y: 200
      - name: b
        node: 0
        position:
          x: 120
          y: 240
    properties:
      Resistance: "10k"
      Description: "Load filament."
wires: []
`;

/**
 * A transformer whose typed winding voltages include one this stage does not recognise --
 * `ScreenSecondary`, typed exactly like the recognised ones but under a spelling nothing
 * reads -- alongside a `FilamentSecondary` that *is* recognised. The v2-transformer-ratio
 * milestone's refusal case: this must refuse by name rather than silently deriving a ratio
 * from the winding it does recognise and dropping the one it does not.
 */
export const transformerUnlistedWindingSpelling = `${header("Unlisted Winding Spelling Fixture")}components:
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: filament_a
        role: winding
        node: 2
        position:
          x: 20
          y: -30
      - name: filament_b
        role: winding
        node: 0
        position:
          x: 20
          y: 0
      - name: screen_a
        role: winding
        node: 3
        position:
          x: 20
          y: 30
      - name: screen_b
        role: winding
        node: 0
        position:
          x: 20
          y: 60
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
      - role: filament
        terminals:
          - filament_a
          - filament_b
        voltage:
          raw: "10 VAC filament winding"
          value: 10
          unit: "V"
      - role: secondary
        terminals:
          - screen_a
          - screen_b
    properties:
      Primary:
        raw: "100 VAC assumed nominal"
        value: 100
        unit: V
      ScreenSecondary:
        raw: "50 VAC screen winding, a spelling nothing reads"
        value: 50
        unit: V
      Description: "Reverb tank recovery power supply."
  - id: RL
    kind: resistor
    name: LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 20
      - name: b
        node: 0
        position:
          x: 120
          y: 60
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/**
 * A transformer with a **centre-tapped primary** (the ordinary push-pull output-transformer
 * shape) and one untapped secondary, its ratio typed as an impedance pair -- the
 * v2-transformer-primary-tap milestone's core case. `PrimaryImpedance`/`SecondaryImpedance` give
 * `declaredRatio = sqrt(4000/10) = 20`; the shared-primary reduction has no single reference
 * winding to pivot on (the primary itself is tapped), so it swaps to the untapped secondary and
 * halves+inverts the ratio to `2/20 = 0.1` per half.
 */
export const tappedPrimaryOutputTransformer = `${header("Tapped-Primary Output Transformer Fixture")}components:
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 3
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -40
      - name: primary_ct
        role: windingCenterTap
        node: 4
        position:
          x: -20
          y: 0
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 40
      - name: secondary_hot
        role: winding
        node: 3
        position:
          x: 20
          y: -20
      - name: secondary_common
        role: winding
        node: 0
        position:
          x: 20
          y: 20
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_ct
          - primary_b
        impedances:
          - across:
              - primary_a
              - primary_b
            impedance:
              raw: "4 kΩ plate-to-plate reference"
              value: 4000
              unit: "Ω"
      - role: secondary
        terminals:
          - secondary_common
          - secondary_hot
        impedances:
          - across:
              - secondary_common
              - secondary_hot
            impedance:
              raw: "10 Ω speaker load"
              value: 10
              unit: "Ω"
    properties:
      Description: "Reverb tank recovery output transformer."
  - id: RL
    kind: resistor
    name: LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: 120
          y: 80
      - name: b
        node: 0
        position:
          x: 120
          y: 120
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/**
 * Same tapped primary as `tappedPrimaryOutputTransformer`, plus an alternate impedance tap
 * (`secondary_8`) that connects to nothing else in the document -- `vox-ac30-top-boost`'s exact
 * shape, "8 Ω alternate source-visible tap" beside its typed, wired 16 ohm one. The
 * v2-transformer-primary-tap milestone's dangling-tap case: this must compile with exactly the
 * same two stamps as `tappedPrimaryOutputTransformer`, silently dropping the extra terminal
 * rather than refusing or guessing a ratio for it.
 */
export const danglingAlternateTapTransformer = derive(
	derive(
		tappedPrimaryOutputTransformer,
		`      - name: secondary_hot
        role: winding
        node: 3`,
		`      - name: secondary_8
        role: windingTap
        node: 5
        position:
          x: 20
          y: 50
      - name: secondary_hot
        role: winding
        node: 3`,
	),
	`        terminals:
          - secondary_common
          - secondary_hot`,
	`        terminals:
          - secondary_common
          - secondary_8
          - secondary_hot`,
);

/**
 * The negative control for `danglingAlternateTapTransformer`: the same alternate tap, but wired
 * to a load like any other winding would be. Connectivity now says it is *not* dangling, so this
 * must refuse by name rather than silently dropping a terminal that is actually in use.
 */
export const connectedAlternateTapTransformer = `${derive(
	danglingAlternateTapTransformer,
	"wires: []",
	`  - id: RL8
    kind: resistor
    name: LOAD_8
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 160
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 120
          y: 140
      - name: b
        node: 0
        position:
          x: 120
          y: 180
    properties:
      Resistance: "10k"
      Description: "Load 8."
wires: []`,
)}`;


/**
 * A tank-shaped shell whose part number is not a tank's, so it lowers as an ordinary transformer
 * -- `fender-super-reverb`'s `SRC_REVERB_TANK_4AB3C1B` terminals with `125A9A` on the label.
 *
 * Its coils declare `drive`/`pickup`, which is what a tank's coils are: neither transforms the
 * other's voltage. This is the fixture that proves `drive` is treated as the primary on the
 * ordinary-transformer path, so a mislabelled tank still lowers instead of refusing for want of a
 * winding called `primary`. `InputImpedance`/`OutputImpedance` remain property-side synonyms for
 * `PrimaryImpedance`/`SecondaryImpedance` (`parametersFor` in `netlist.ts`).
 */
export const reverbTankInputOutputTransformer = `${header("Reverb Tank Input/Output Naming Fixture")}components:
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: input_hot
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: input_return
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: output_hot
        role: winding
        node: 2
        position:
          x: 20
          y: -20
      - name: output_return
        role: winding
        node: 0
        position:
          x: 20
          y: 20
    windings:
      - role: drive
        terminals:
          - input_hot
          - input_return
        impedances:
          - across:
              - input_hot
              - input_return
            impedance:
              raw: "8 Ω reverb tank drive impedance"
              value: 8
              unit: "Ω"
      - role: pickup
        terminals:
          - output_hot
          - output_return
        impedances:
          - across:
              - output_hot
              - output_return
            impedance:
              raw: "2250 Ω reverb tank recovery impedance"
              value: 2250
              unit: "Ω"
    properties:
      Description: "Reverb tank connectors."
  - id: RL
    kind: resistor
    name: LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: 80
      - name: b
        node: 0
        position:
          x: 120
          y: 120
    properties:
      Resistance: "10k"
      Description: "Load."
wires: []
`;

/**
 * `tappedPrimaryOutputTransformer` plus a **third** impedance tap, `secondary_4`, dangling
 * (connected to nothing else) beside the wired reference winding -- the same shape
 * `danglingAlternateTapTransformer` tests for `secondary_8`. Must compile to the identical two
 * stamps as the base fixture -- no third stamp, no stamp touching node 5.
 */
export const danglingSecondary4Transformer = derive(
	derive(
		tappedPrimaryOutputTransformer,
		`      - name: secondary_hot
        role: winding
        node: 3`,
		`      - name: secondary_4
        role: windingTap
        node: 5
        position:
          x: 20
          y: 50
      - name: secondary_hot
        role: winding
        node: 3`,
	),
	`        terminals:
          - secondary_common
          - secondary_hot`,
	`        terminals:
          - secondary_common
          - secondary_4
          - secondary_hot`,
);

/**
 * `connectedAlternateTapTransformer` (its `secondary_8` wired to a load) plus a **third** tap,
 * `secondary_4`, dangling.
 *
 * The refusal must fire exactly as it does with no `secondary_4` present -- not be masked,
 * changed, or made order-dependent by the extra tap. It used to prove that two alternate taps
 * held separate winding groups and so could not overwrite one another's node; they are one coil's
 * taps now, and the property that matters is that the connectivity test finds the loaded tap
 * regardless of how many others the coil declares.
 */
export const distinctAlternateTapsTransformer = derive(
	derive(
		connectedAlternateTapTransformer,
		`      - name: secondary_8
        role: windingTap
        node: 5`,
		`      - name: secondary_4
        role: windingTap
        node: 6
        position:
          x: 20
          y: 80
      - name: secondary_8
        role: windingTap
        node: 5`,
	),
	`        terminals:
          - secondary_common
          - secondary_8`,
	`        terminals:
          - secondary_common
          - secondary_4
          - secondary_8`,
);

/**
 * A tapped primary with no other complete, untapped winding to pivot the shared-primary
 * reduction on -- only a shield beside it, which declares `role: shield` and belongs to no coil.
 * The v2-transformer-primary-tap milestone's "no reference available" refusal case.
 *
 * States its ratio as a typed `TurnsRatio` rather than as an impedance pair, because a rating
 * belongs to a coil and the secondary it would rate is exactly what this document does not
 * declare. That is also what keeps the fixture reaching the refusal it is here for: a document
 * stating no ratio at all refuses earlier, in `requireWindingSpecification`.
 */
export const tappedPrimaryNoReferenceTransformer = `${header("Tapped Primary With No Reference Fixture")}components:
  - id: JIN
    kind: jack
    name: PRIMARY_IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Clock driver input."
  - id: JOUT
    kind: jack
    name: SECONDARY_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 200
          y: 0
    properties:
      Description: "Reverb tank."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: T1
    kind: transformer
    name: BUCKET_BRIGADE_CLOCK_DRIVER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -40
      - name: primary_ct
        role: windingCenterTap
        node: 4
        position:
          x: -20
          y: 0
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 40
      - name: shield_nc
        role: shield
        node: 5
        position:
          x: 20
          y: 0
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_ct
          - primary_b
    properties:
      TurnsRatio:
        raw: "20:1, from a 4 kΩ plate-to-plate primary into a 10 Ω speaker load printed for a secondary this document declares no terminal for"
        value: 20
        unit: ""
      Description: "Reverb tank recovery output transformer with no working secondary."
wires: []
`;

/**
 * A divider whose midpoint (the output) is formed by a T-junction in the middle of a
 * diagonal wire. `wireAxisAligned` is the same circuit with that wire redrawn horizontal,
 * so the two must yield the same netlist up to node relabeling.
 *
 * The midpoint terminals sit on the segment, not at an endpoint, so they are visible only
 * through the point-on-segment test. Before diagonal segments were recognised that test
 * returned false for them, the midpoint was dropped as unconnected, and this document
 * refused where its horizontal sibling compiled.
 */
export const wireDiagonal = `${header("Diagonal Bus Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_DELAY_INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        position:
          x: 0
          y: 0
    properties:
      Description: "Clock driver input for the delay memory chip."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 100
      y: 50
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        position:
          x: 100
          y: 50
    properties:
      Description: "Reverb tank recovery output stage."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 100
      y: 90
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 100
          y: 90
    properties: {}
  - id: R1
    kind: resistor
    name: MN3101_CLOCK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 40
          y: 0
      - name: b
        position:
          x: 100
          y: 50
    properties:
      Resistance: "10k"
      Description: "Delay memory load, not a clock element."
  - id: R2
    kind: resistor
    name: BBD_DELAY_MEMORY
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 70
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 100
          y: 50
      - name: b
        node: 0
        position:
          x: 100
          y: 90
    properties:
      Resistance: "10k"
      Description: "Reverb tank bleed to ground."
wires:
  - id: W_IN
    points:
      - x: 0
        y: 0
      - x: 40
        y: 0
  - id: W_MID
    points:
      - x: 50
        y: 0
      - x: 150
        y: 100
`;

/**
 * `wireDiagonal` redrawn with the midpoint wire horizontal. The midpoint terminals still
 * sit in the middle of the segment; only the segment's angle changes. The two must resolve
 * to the same netlist up to node relabeling, which is the invariant the angle must not
 * break.
 */
export const wireAxisAligned = `${header("Axis Aligned Bus Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_DELAY_INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        position:
          x: 0
          y: 0
    properties:
      Description: "Clock driver input for the delay memory chip."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 100
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        position:
          x: 100
          y: 20
    properties:
      Description: "Reverb tank recovery output stage."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 100
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 100
          y: 60
    properties: {}
  - id: R1
    kind: resistor
    name: MN3101_CLOCK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 40
          y: 0
      - name: b
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Delay memory load, not a clock element."
  - id: R2
    kind: resistor
    name: BBD_DELAY_MEMORY
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 100
          y: 20
      - name: b
        node: 0
        position:
          x: 100
          y: 60
    properties:
      Resistance: "10k"
      Description: "Reverb tank bleed to ground."
wires:
  - id: W_IN
    points:
      - x: 0
        y: 0
      - x: 40
        y: 0
  - id: W_MID
    points:
      - x: 50
        y: 20
      - x: 150
        y: 20
`;

/**
 * NE570 compandor terminal-mapping contract.
 *
 * Sixteen bare-pin terminals in strict sequential `pin1`..`pin16` order, each on a
 * distinct node (10–25). The part catalog binds section A to [rectIn=pin2,
 * rectCap=pin1, cellIn=pin5/INV_IN, output=pin7] and section B to the channel-2
 * pins. This fixture asserts that binding is stable: a catalogue edit that
 * re-points any of the four section terminals fails here rather than surfacing
 * as a silent audio defect months later.
 */
export const ne570TerminalMap = `${header("NE570 Terminal Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 NE570
    sourceTypeName: Circuit.Compander
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 10
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 0
          y: 1
      - name: pin3
        node: 12
        position:
          x: 0
          y: 2
      - name: pin4
        node: 0
        position:
          x: 0
          y: 3
      - name: pin5
        node: 13
        position:
          x: 0
          y: 4
      - name: pin6
        node: 14
        position:
          x: 0
          y: 5
      - name: pin7
        node: 15
        position:
          x: 0
          y: 6
      - name: pin8
        node: 16
        position:
          x: 0
          y: 7
      - name: pin9
        node: 0
        position:
          x: 0
          y: 8
      - name: pin10
        node: 17
        position:
          x: 0
          y: 9
      - name: pin11
        node: 18
        position:
          x: 0
          y: 10
      - name: pin12
        node: 19
        position:
          x: 0
          y: 11
      - name: pin13
        node: 20
        position:
          x: 0
          y: 12
      - name: pin14
        node: 21
        position:
          x: 0
          y: 13
      - name: pin15
        node: 22
        position:
          x: 0
          y: 14
      - name: pin16
        node: 23
        position:
          x: 0
          y: 15
    properties:
      Name: U1_NE570
      PartNumber: NE570
      Description: "Dual compander terminal map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: "10k"
wires: []
`;

/**
 * The datasheet's own expander, wired exactly as onsemi NE570/D Rev. 4 Figure 6 draws
 * it, and the reason this fixture exists rather than a bare transconductance probe: the
 * datasheet states a closed form for this circuit's gain, so the reference is external
 * to our code rather than a number read off our own output.
 *
 *   GAIN = 2 * R3 * VIN(avg) / (R1 * R2 * IB)
 *
 * The input drives the rectifier (pin 2) and the gain cell (pin 3) through separate
 * coupling caps; pin 6 is tied to pin 7, which is what makes the internal 20k R3 the
 * op-amp's feedback resistor. Both couplings are 1 uF into 10k/20k, corners at 16 Hz and
 * 8 Hz, so at the 1 kHz test tone they pass unity and the gain is the chip's alone.
 *
 * Two independent numbers fall out of this one circuit, which is what makes it a
 * settlement rather than a smoke test: the AC gain above, and a quiescent output of
 * `(1 + R3/R4) * VREF` = 3.0 V that the datasheet also states outright. The DC figure
 * pins down the topology -- it only comes out at 3.0 V with R4 returned to ground -- and
 * the AC figure pins down the gain cell's scaling. See `ne570ExpanderGainAt`.
 *
 * CRECT is 2.2 uF as in the datasheet's own test circuit (Figure 3), giving the detector
 * `tau = R5 * CRECT` = 22 ms. That is a real external component, not a constant: the
 * negative control halves it and expects the attack to track.
 */
export const ne570Expander = `${header("NE570 Expander Fixture")}components:
${jacks}  - id: CIN1
    kind: capacitor
    name: TREMOLO_DEPTH
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 11
        position:
          x: 0
          y: 20
    properties:
      Capacitance: "1u"
      Description: "Rectifier input coupling; the prose here is deliberately wrong."
  - id: CIN2
    kind: capacitor
    name: BBD_CLOCK_FEED
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12
        position:
          x: 0
          y: 20
    properties:
      Capacitance: "1u"
      Description: "Gain cell input coupling."
  - id: CRECT
    kind: capacitor
    name: REVERB_TANK_DWELL
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: 0
          y: 0
      - name: b
        node: 0
        position:
          x: 0
          y: 20
    properties:
      Capacitance: "2u2"
      Description: "Rectifier averaging capacitor on pin 1."
  - id: RLOAD
    kind: resistor
    name: RLOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 300
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 300
          y: 0
      - name: b
        node: 0
        position:
          x: 300
          y: 20
    properties:
      Resistance: "100k"
      Description: "Output load."
  - id: U1
    kind: ic
    name: U1 NE570
    sourceTypeName: Circuit.Compander
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 10
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 0
          y: 0
      - name: pin3
        node: 12
        position:
          x: 0
          y: 0
      - name: pin4
        node: 0
        position:
          x: 0
          y: 0
      - name: pin5
        node: 13
        position:
          x: 0
          y: 0
      - name: pin6
        node: 2
        position:
          x: 0
          y: 0
      - name: pin7
        node: 2
        position:
          x: 0
          y: 0
      - name: pin8
        node: 14
        position:
          x: 0
          y: 0
      - name: pin9
        node: 15
        position:
          x: 0
          y: 0
      - name: pin10
        node: 17
        position:
          x: 0
          y: 0
      - name: pin11
        node: 18
        position:
          x: 0
          y: 0
      - name: pin12
        node: 19
        position:
          x: 0
          y: 0
      - name: pin13
        node: 20
        position:
          x: 0
          y: 0
      - name: pin14
        node: 21
        position:
          x: 0
          y: 0
      - name: pin15
        node: 22
        position:
          x: 0
          y: 0
      - name: pin16
        node: 23
        position:
          x: 0
          y: 0
    properties:
      Name: U1_NE570
      PartNumber: NE570
      Description: "Bucket brigade delay line with an internal clock divider."
`;

/**
 * The extra parts a compressor needs and an expander does not: a signal input into the R3 pin,
 * and a resistive feedback leg from the summing node to the output.
 *
 * The feedback leg is not decoration. In Figure 6 the op amp's DC feedback runs through the
 * internal 20k R3, because pin 6 is tied to pin 7. Figure 7 takes pin 6 away for the input, so
 * without an external leg the summing node's only return path is the gain cell -- which carries
 * no current at DC, leaving the op amp open loop and its output undefined. That would diverge
 * for a reason that has nothing to do with the gain cell, and would make this fixture prove
 * nothing.
 */
const ne570CompressorInput = `  - id: CSIG
    kind: capacitor
    name: CSIG
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 25
        position:
          x: 0
          y: 20
    properties:
      Capacitance: "1u"
      Description: "Signal input coupling."
  - id: RIN
    kind: resistor
    name: RIN
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 25
        position:
          x: 0
          y: 0
      - name: b
        node: 24
        position:
          x: 0
          y: 20
    properties:
      Resistance: "20k"
      Description: "Series input resistor into the R3 pin."
  - id: RFB
    kind: resistor
    name: RFB
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 13
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 20
    properties:
      Resistance: "36k"
      Description: "Op-amp feedback leg from the summing node to the output."
`;

/**
 * The datasheet's compressor: onsemi NE570/D Rev. 4's own sentence, "a compressor is essentially
 * an expander placed in the feedback loop of the op amp", applied to `ne570Expander` and nothing
 * else. It is four derivations off that fixture, so the two provably differ only in the wiring
 * under test, and the same gain cell, the same internal resistors and the same reference serve
 * both.
 *
 * The three moves, and each is that sentence read literally:
 *
 *   - the rectifier (pin 2) and the gain cell (pin 3) are driven from the **output** rather than
 *     from the input, which is what "in the feedback loop" means for this chip;
 *   - the signal enters at the **R3 pin** (pin 6), which the expander had tied to pin 7, and
 *     reaches the summing node through the internal 20k;
 *   - an external leg closes the op amp's DC loop, per `ne570CompressorInput` above.
 *
 * `mxr-carbon-copy`'s own traced schematic is an independent instance of the same topology --
 * R31 into pin 6, C24 from pin 7 back to pins 2 and 3, R34+R33 from pin 5 to pin 7 -- which is
 * why this is a reading of the datasheet rather than an invention: two sources drawn by
 * different people agree on it.
 *
 * **What this fixture is for.** The expander pins the gain cell's *magnitude* against a stated
 * closed form, and pins nothing about its *direction*: the cell carries no current at DC, so the
 * stated 3.0 V quiescent cannot see the sign, and the gain formula is a magnitude. Direction only
 * becomes observable when the cell sits inside the loop, because then it either adds to the
 * feedback conductance or subtracts from it. So this is the two-sided control the compandor
 * rebuild never had:
 *
 *   - a compressor's gain must **fall** as its input level rises, and stay bounded;
 *   - `ne570Expander`'s gain must still **rise**, which is what stops a sign flip being a free fix.
 */
export const ne570Compressor = derive(
	derive(
		derive(
			derive(
				ne570Expander,
				// CIN1 now couples the OUTPUT into the rectifier input, not the source.
				`      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 11`,
				`      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 11`,
			),
			// CIN2 does the same for the gain cell input.
			`      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12`,
			`      - name: a
        node: 2
        position:
          x: 0
          y: 0
      - name: b
        node: 12`,
		),
		// Pin 6 stops being tied to the output and becomes the signal entry point.
		`      - name: pin6
        node: 2`,
		`      - name: pin6
        node: 24`,
	),
	"  - id: U1\n",
	`${ne570CompressorInput}  - id: U1\n`,
);

/**
 * The same expander with a tenth of the averaging capacitance.
 *
 * The negative control that proves CRECT is load-bearing. Before this rewrite the
 * detector integrated a private state variable against a hard-coded 50 ms and never read
 * the CRECT node at all, so this fixture and its parent rendered identically -- the
 * external component the chip devotes a pin to did nothing. `tau = R5 * CRECT` drops from
 * 22 ms to 2.2 ms here, which must show up as a faster attack.
 */
export const ne570ExpanderFastDetector = derive(
	ne570Expander,
	'Capacitance: "2u2"',
	'Capacitance: "220n"',
);

/**
 * CD4047 bare-pin position-resolution contract.
 *
 * Fourteen terminals: `pin1`..`pin13` are bare (no role suffix) and `pin14_vdd`
 * carries the only role token. The part catalog's pinout is `[null × 13, "vdd"]`,
 * so position 13 must fold to `vdd` and the remaining thirteen positions accept
 * any (null) token. This fixture asserts that a bare-pin CD4047 still compiles
 * and that the clock-driver section resolves its five terminals by position:
 * cp1=pin10(9), cp2=pin11(10), vgg=pin13(12), vdd=pin14(13), ox1=pin3(2).
 */
export const cd4047BarePinMap = `${header("CD4047 Bare Pin Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 CD4047
    sourceTypeName: Circuit.LogicIC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 10
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 0
          y: 1
      - name: pin3
        node: 12
        position:
          x: 0
          y: 2
      - name: pin4
        node: 13
        position:
          x: 0
          y: 3
      - name: pin5
        node: 14
        position:
          x: 0
          y: 4
      - name: pin6
        node: 15
        position:
          x: 0
          y: 5
      - name: pin7
        node: 0
        position:
          x: 0
          y: 6
      - name: pin8
        node: 16
        position:
          x: 0
          y: 7
      - name: pin9
        node: 17
        position:
          x: 0
          y: 8
      - name: pin10
        node: 18
        position:
          x: 0
          y: 9
      - name: pin11
        node: 19
        position:
          x: 0
          y: 10
      - name: pin12
        node: 20
        position:
          x: 0
          y: 11
      - name: pin13
        node: 21
        position:
          x: 0
          y: 12
      - name: pin14_vdd
        node: 22
        position:
          x: 0
          y: 13
    properties:
      Name: U1_CD4047
      PartNumber: CD4047
      Description: "Gatable astable multivibrator bare-pin map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: "10k"
wires: []
`;

/**
 * A spring reverb tank alone: input jack straight into the drive coil, pickup into the output
 * jack across a load.
 *
 * Deliberately nothing else. A tank inside a real amp is buried behind a driver stage, a
 * recovery stage and a mix control, so a level measured there cannot say whether the *tank*
 * reverberates. Here the only thing between the jacks is the tank.
 *
 * `PartNumber` is the whole of the classification evidence: the shell declares itself a
 * `Circuit.Transformer`, exactly as the corpus packets do, and only the exact part id
 * distinguishes a tank from the output transformer sitting next to it.
 */
export const springReverbTank = `${header("Spring Reverb Tank")}components:
${jacks}  - id: TANK
    kind: transformer
    name: 4AB3C1B reverb tank shell
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: input_hot
        role: winding
        node: 1
        position:
          x: 0
          y: 0
      - name: input_return
        role: winding
        node: 0
        position:
          x: 0
          y: 1
      - name: output_hot
        role: winding
        node: 2
        position:
          x: 0
          y: 2
      - name: output_return
        role: winding
        node: 0
        position:
          x: 0
          y: 3
    windings:
      - role: drive
        terminals:
          - input_hot
          - input_return
        impedances:
          - across:
              - input_hot
              - input_return
            impedance:
              raw: "8 Ohm"
              value: 8
              unit: "Ω"
      - role: pickup
        terminals:
          - output_hot
          - output_return
        impedances:
          - across:
              - output_hot
              - output_return
            impedance:
              raw: "2250 Ohm"
              value: 2250
              unit: "Ω"
    properties:
      PartNumber: "4AB3C1B"
  - id: RLOAD
    kind: resistor
    name: RLOAD 1M
    sourceTypeName: Circuit.Resistor
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 200
          y: 100
      - name: b
        node: 0
        position:
          x: 200
          y: 101
    properties:
      Resistance: "1M"
`;

/**
 * A variable attenuator using an optocoupler / Vactrol (VTL5C1).
 *
 * Series resistor R1=10k, shunt element is the LDR of the optocoupler to ground.
 * VLED drives the LED anode with respect to ground.
 *
 * - When VLED = 0 V (dark): LDR resistance is ~10 MΩ (ldrMaxOhms), so attenuation is 10M / (10k + 10M) ~ 0.999 V/V.
 * - When VLED = 2 V (illuminated): LED conducts forward current, LDR drops to ~100 Ω (ldrMinOhms), attenuation is 100 / (10k + 100) ~ 0.0099 V/V (-40 dB).
 * - When VLED = 0.5 V (sub-threshold): LED remains non-conducting, LDR remains dark at ~10 MΩ.
 */
export const optocouplerAttenuator = `${header("Optocoupler Attenuator Fixture")}components:
  - id: JIN
    kind: jack
    name: BBD_DELAY_INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -400
          y: 0
    properties:
      Description: "Bucket brigade clock input."
  - id: JOUT
    kind: jack
    name: REVERB_TANK_OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 400
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 3
        position:
          x: 400
          y: 0
    properties:
      Description: "Reverb recovery output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 200
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 200
    properties: {}
  - id: VLED
    kind: voltage-source
    name: VLED
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: -200
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: 4
        position:
          x: -200
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: -200
          y: -180
    properties:
      Voltage: "0"
      Description: "LED control drive."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -120
          y: 0
      - name: b
        node: 3
        position:
          x: -80
          y: 0
    properties:
      Resistance: "10k"
      Description: "Series divider resistor."
  - id: VACTROL
    kind: ic
    name: VACTROL
    sourceTypeName: Circuit.SupportChip
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "VTL5C1"
      Description: "Optocoupler / photocell module."
    terminals:
      - name: anode
        node: 4
        position:
          x: 80
          y: -20
      - name: cathode
        node: 0
        position:
          x: 80
          y: 20
      - name: ldr_a
        node: 3
        position:
          x: 120
          y: -20
      - name: ldr_b
        node: 0
        position:
          x: 120
          y: 20
wires: []
`;

export const optocouplerAttenuatorIlluminated = derive(
	optocouplerAttenuator,
	'Voltage: "0"',
	'Voltage: "2"',
);

export const optocouplerAttenuatorSubThreshold = derive(
	optocouplerAttenuator,
	'Voltage: "0"',
	'Voltage: "0.5"',
);

/**
 * The LED biased into the middle of the LDR's range, at 1.14 V.
 *
 * **The control the two extremes cannot supply.** Dark and illuminated both agree with a model
 * that is a two-state switch, and the sub-threshold fixture agrees with one whose LED does
 * nothing at all -- all three read as one of the two endpoints. Only a bias that lands *between*
 * them shows the LDR curve is continuous and actually traversed.
 *
 * Measured sweep across the knee, 0.1 V drive at 1 kHz: 1.00 V -> 0.9984, 1.05 -> 0.9964,
 * 1.10 -> 0.9722, 1.12 -> 0.8865, **1.14 -> 0.4936**, 1.16 -> 0.0621, 1.18 -> 0.0112,
 * 1.20 -> 0.0099 (floored). The assertion deliberately checks the *property* -- strictly between
 * the endpoints -- rather than pinning 0.4936, because this is the steepest point on a steep
 * curve and a brittle number here would fail for changes that are not defects.
 *
 * **A fidelity note the endpoints hide.** That whole traversal happens in an 80 mV window
 * (1.10 V to 1.18 V). A real Vactrol's LDR responds gradually over *decades* of LED current --
 * the slow, smooth knee is the part's musical character, and what an optocoupler tremolo or
 * compressor is chosen for. So "the optocoupler operator is settled" means its endpoints and its
 * continuity are pinned, **not** that the Vactrol's response shape is modelled; that lives in
 * `ledTransconductance` and the LDR exponent's scaling and is not settled by these fixtures.
 */
export const optocouplerAttenuatorPartial = derive(
	optocouplerAttenuator,
	'Voltage: "0"',
	// Half-traversal, re-measured when the LED's saturation current was corrected to the cited
	// `LED-RED` entry. It moved from 1.14 V to 1.90 V, and the traversal now brackets the cited
	// `forwardVoltageAt1mA` of 1.8 V instead of sitting 0.76 V below it.
	//
	// **Measured, not derived.** The closed form put the midpoint at 1.781 V and the fixture
	// puts it at 1.90: the ideal source feeding this LED carries a series resistance, so the
	// junction never sees the declared bias. Sweeping the fixture is the only way to place this
	// number, which is the same reason the assertion below is a property rather than a value.
	'Voltage: "1.90"',
);

export const mn3007RoleMap = `${header("MN3007 Role Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 MN3007
    sourceTypeName: Circuit.Bbd
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1_gnd
        node: 0
        position:
          x: 0
          y: 0
      - name: pin2_cp1
        node: 11
        position:
          x: 0
          y: 1
      - name: pin3_in
        node: 12
        position:
          x: 0
          y: 2
      - name: pin4_vgg
        node: 13
        position:
          x: 0
          y: 3
      - name: pin5_vdd
        node: 14
        position:
          x: 0
          y: 4
      - name: pin6_cp2
        node: 15
        position:
          x: 0
          y: 5
      - name: pin7_out1
        node: 16
        position:
          x: 0
          y: 6
      - name: pin8_out2
        node: 17
        position:
          x: 0
          y: 7
    properties:
      Name: U1_MN3007
      PartNumber: MN3007
      DelayMs: "5"
      Description: "BBD role map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
  - id: R2
    kind: resistor
    name: R2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 16
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
`;

/**
 * MN3007 bare-pin position-resolution contract.
 *
 * Eight terminals named `pin1`..`pin8` with NO role suffixes.
 * Asserts that bare-pin DIP-8 positions resolve identically to the role-mapped
 * IC: clk1=pin2(node 11), clk2=pin6(node 15), in=pin3(node 12),
 * out1=pin7(node 16), out2=pin8(node 17).
 */
export const mn3007BarePinMap = `${header("MN3007 Bare Pin Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 MN3007
    sourceTypeName: Circuit.Bbd
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 0
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 0
          y: 1
      - name: pin3
        node: 12
        position:
          x: 0
          y: 2
      - name: pin4
        node: 13
        position:
          x: 0
          y: 3
      - name: pin5
        node: 14
        position:
          x: 0
          y: 4
      - name: pin6
        node: 15
        position:
          x: 0
          y: 5
      - name: pin7
        node: 16
        position:
          x: 0
          y: 6
      - name: pin8
        node: 17
        position:
          x: 0
          y: 7
    properties:
      Name: U1_MN3007
      PartNumber: MN3007
      DelayMs: "5"
      Description: "BBD bare-pin map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
  - id: R2
    kind: resistor
    name: R2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 16
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
`;

/**
 * MN3207 role-based terminal-resolution contract.
 */
export const mn3207RoleMap = `${header("MN3207 Role Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 MN3207
    sourceTypeName: Circuit.Bbd
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: vgg
        node: 13
        position:
          x: 0
          y: 0
      - name: cp1
        node: 11
        position:
          x: 0
          y: 1
      - name: cp2
        node: 15
        position:
          x: 0
          y: 2
      - name: gnd
        node: 0
        position:
          x: 0
          y: 3
      - name: out1
        node: 16
        position:
          x: 0
          y: 4
      - name: out2
        node: 17
        position:
          x: 0
          y: 5
      - name: vdd
        node: 14
        position:
          x: 0
          y: 6
      - name: in
        node: 12
        position:
          x: 0
          y: 7
    properties:
      Name: U1_MN3207
      PartNumber: MN3207
      DelayMs: "5"
      Description: "MN3207 BBD role map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
  - id: R2
    kind: resistor
    name: R2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 16
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
`;

/**
 * MN3207 bare-pin position-resolution contract.
 *
 * Physical 8-pin DIP pinout per Panasonic datasheet and Boss VB-2 IC2:
 * Pin 1 (VGG) = node 13
 * Pin 2 (CP1) = node 11
 * Pin 3 (CP2) = node 15
 * Pin 4 (GND) = node 0
 * Pin 5 (OUT1) = node 16
 * Pin 6 (OUT2) = node 17
 * Pin 7 (VDD) = node 14
 * Pin 8 (IN) = node 12
 */
export const mn3207BarePinMap = `${header("MN3207 Bare Pin Map")}components:
${jacks}  - id: U1
    kind: ic
    name: U1 MN3207
    sourceTypeName: Circuit.Bbd
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 13
        position:
          x: 0
          y: 0
      - name: pin2
        node: 11
        position:
          x: 0
          y: 1
      - name: pin3
        node: 15
        position:
          x: 0
          y: 2
      - name: pin4
        node: 0
        position:
          x: 0
          y: 3
      - name: pin5
        node: 16
        position:
          x: 0
          y: 4
      - name: pin6
        node: 17
        position:
          x: 0
          y: 5
      - name: pin7
        node: 14
        position:
          x: 0
          y: 6
      - name: pin8
        node: 12
        position:
          x: 0
          y: 7
    properties:
      Name: U1_MN3207
      PartNumber: MN3207
      DelayMs: "5"
      Description: "MN3207 BBD bare-pin map contract."
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        node: 12
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
  - id: R2
    kind: resistor
    name: R2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 16
        position:
          x: 0
          y: 0
      - name: b
        node: 2
        position:
          x: 0
          y: 1
    properties:
      Resistance: 10 kOhm
`;

/**
 * Four bucket-brigade delay lines chained in series (S4).
 *
 * Models a multi-BBD cascade such as the SAD1024A 4-stage delay in the EH-7550 Deluxe Memory Man.
 * Each BBD declares DelayMs: 3 (144 samples at 48 kHz).
 * Total cascade delay across 4 stages = 4 * 3 ms = 12 ms (576 samples at 48 kHz).
 */
export const hybridCascade4DelayPedal = `${header("Hybrid 4-BBD Cascade Delay Fixture")}components:
${jacks}  - id: R_IN
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -240
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -240
          y: -20
      - name: b
        node: 3
        position:
          x: -240
          y: 20
    properties:
      Resistance: "10k"
      Description: "Input shell."
  - id: R_IN_SHUNT
    kind: resistor
    name: R_IN_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 3
        position:
          x: -200
          y: -20
      - name: b
        node: 0
        position:
          x: -200
          y: 20
    properties:
      Resistance: "10k"
      Description: "Input shunt."
  - id: U1
    kind: bbd
    name: U1
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: -160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 3
        position:
          x: -180
          y: -20
      - name: out
        node: 4
        position:
          x: -140
          y: -20
      - name: cp1
        node: 5
        position:
          x: -180
          y: 20
      - name: vgg
        node: 6
        position:
          x: -140
          y: 20
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "BBD stage 1."
  - id: R_MID1
    kind: resistor
    name: R_MID1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: -120
          y: -20
      - name: b
        node: 8
        position:
          x: -120
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 1 resistor."
  - id: R_MID1_SHUNT
    kind: resistor
    name: R_MID1_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 8
        position:
          x: -100
          y: -20
      - name: b
        node: 0
        position:
          x: -100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 1 shunt."
  - id: U2
    kind: bbd
    name: U2
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: -60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 8
        position:
          x: -80
          y: -20
      - name: out
        node: 9
        position:
          x: -40
          y: -20
      - name: cp1
        node: 5
        position:
          x: -80
          y: 20
      - name: vgg
        node: 6
        position:
          x: -40
          y: 20
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "BBD stage 2."
  - id: R_MID2
    kind: resistor
    name: R_MID2
    sourceTypeName: Circuit.Resistor
    origin:
      x: -20
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 9
        position:
          x: -20
          y: -20
      - name: b
        node: 10
        position:
          x: -20
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 2 resistor."
  - id: R_MID2_SHUNT
    kind: resistor
    name: R_MID2_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: 0
          y: -20
      - name: b
        node: 0
        position:
          x: 0
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 2 shunt."
  - id: U3
    kind: bbd
    name: U3
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 10
        position:
          x: 20
          y: -20
      - name: out
        node: 11
        position:
          x: 60
          y: -20
      - name: cp1
        node: 5
        position:
          x: 20
          y: 20
      - name: vgg
        node: 6
        position:
          x: 60
          y: 20
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "BBD stage 3."
  - id: R_MID3
    kind: resistor
    name: R_MID3
    sourceTypeName: Circuit.Resistor
    origin:
      x: 80
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 11
        position:
          x: 80
          y: -20
      - name: b
        node: 12
        position:
          x: 80
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 3 resistor."
  - id: R_MID3_SHUNT
    kind: resistor
    name: R_MID3_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 12
        position:
          x: 100
          y: -20
      - name: b
        node: 0
        position:
          x: 100
          y: 20
    properties:
      Resistance: "10k"
      Description: "Interstage 3 shunt."
  - id: U4
    kind: bbd
    name: U4
    sourceTypeName: Circuit.FixtureDelayMemory
    origin:
      x: 140
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        node: 12
        position:
          x: 120
          y: -20
      - name: out
        node: 13
        position:
          x: 160
          y: -20
      - name: cp1
        node: 5
        position:
          x: 120
          y: 20
      - name: vgg
        node: 6
        position:
          x: 160
          y: 20
    properties:
      PartNumber: "FIXTURE-DELAY-1"
      DelayMs: "3"
      Description: "BBD stage 4."
  - id: R_OUT
    kind: resistor
    name: R_OUT
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 13
        position:
          x: 180
          y: -20
      - name: b
        node: 2
        position:
          x: 180
          y: 20
    properties:
      Resistance: "10k"
      Description: "Output shell resistor."
  - id: R_OUT_LOAD
    kind: resistor
    name: R_OUT_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 220
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 220
          y: -20
      - name: b
        node: 0
        position:
          x: 220
          y: 20
    properties:
      Resistance: "1meg"
      Description: "Output shell load."
  - id: V_CLK
    kind: rail
    name: V_CLK
    sourceTypeName: Circuit.Rail
    origin:
      x: -80
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 7
        position:
          x: -80
          y: 100
    properties:
      Voltage: "9"
      Description: "Clock rail."
  - id: R_CLK
    kind: resistor
    name: R_CLK
    sourceTypeName: Circuit.Resistor
    origin:
      x: -40
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: -40
          y: 60
      - name: b
        node: 7
        position:
          x: -40
          y: 100
    properties:
      Resistance: "22k"
      Description: "Clock resistor."
  - id: C_CLK
    kind: capacitor
    name: C_CLK
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 40
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 5
        position:
          x: 40
          y: 60
      - name: b
        node: 0
        position:
          x: 40
          y: 100
    properties:
      Capacitance: "1n"
      Description: "Clock capacitor."
  - id: R_VGG
    kind: resistor
    name: R_VGG
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 100
          y: 60
      - name: b
        node: 0
        position:
          x: 100
          y: 100
    properties:
      Resistance: "47k"
      Description: "Gate bias resistor."
wires: []
`;

/**
 * 4-BBD cascade with heterogeneous delays: U1=3ms, U2=6ms, U3=3ms, U4=3ms.
 * Total cascade delay = 3 + 6 + 3 + 3 = 15 ms (720 samples at 48 kHz).
 */
export const hybridCascade4DelayPedalUnequalDelays = derive(
	hybridCascade4DelayPedal,
	'  - id: U2\n    kind: bbd\n    name: U2\n    sourceTypeName: Circuit.FixtureDelayMemory\n    origin:\n      x: -60\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: in\n        node: 8\n        position:\n          x: -80\n          y: -20\n      - name: out\n        node: 9\n        position:\n          x: -40\n          y: -20\n      - name: cp1\n        node: 5\n        position:\n          x: -80\n          y: 20\n      - name: vgg\n        node: 6\n        position:\n          x: -40\n          y: 20\n    properties:\n      PartNumber: "FIXTURE-DELAY-1"\n      DelayMs: "3"',
	'  - id: U2\n    kind: bbd\n    name: U2\n    sourceTypeName: Circuit.FixtureDelayMemory\n    origin:\n      x: -60\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: in\n        node: 8\n        position:\n          x: -80\n          y: -20\n      - name: out\n        node: 9\n        position:\n          x: -40\n          y: -20\n      - name: cp1\n        node: 5\n        position:\n          x: -80\n          y: 20\n      - name: vgg\n        node: 6\n        position:\n          x: -40\n          y: 20\n    properties:\n      PartNumber: "FIXTURE-DELAY-1"\n      DelayMs: "6"',
);

/**
 * 3-BBD cascade: 3 stages of 3 ms each.
 * Total cascade delay = 3 * 3 ms = 9 ms (432 samples at 48 kHz).
 */
export const hybridCascade3DelayPedal = derive(
	hybridCascade4DelayPedal,
	'  - id: R_MID3\n    kind: resistor\n    name: R_MID3\n    sourceTypeName: Circuit.Resistor\n    origin:\n      x: 80\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: a\n        node: 11\n        position:\n          x: 80\n          y: -20\n      - name: b\n        node: 12\n        position:\n          x: 80\n          y: 20\n    properties:\n      Resistance: "10k"\n      Description: "Interstage 3 resistor."\n  - id: R_MID3_SHUNT\n    kind: resistor\n    name: R_MID3_SHUNT\n    sourceTypeName: Circuit.Resistor\n    origin:\n      x: 100\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: a\n        node: 12\n        position:\n          x: 100\n          y: -20\n      - name: b\n        node: 0\n        position:\n          x: 100\n          y: 20\n    properties:\n      Resistance: "10k"\n      Description: "Interstage 3 shunt."\n  - id: U4\n    kind: bbd\n    name: U4\n    sourceTypeName: Circuit.FixtureDelayMemory\n    origin:\n      x: 140\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: in\n        node: 12\n        position:\n          x: 120\n          y: -20\n      - name: out\n        node: 13\n        position:\n          x: 160\n          y: -20\n      - name: cp1\n        node: 5\n        position:\n          x: 120\n          y: 20\n      - name: vgg\n        node: 6\n        position:\n          x: 160\n          y: 20\n    properties:\n      PartNumber: "FIXTURE-DELAY-1"\n      DelayMs: "3"\n      Description: "BBD stage 4."\n  - id: R_OUT\n    kind: resistor\n    name: R_OUT\n    sourceTypeName: Circuit.Resistor\n    origin:\n      x: 180\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: a\n        node: 13\n        position:\n          x: 180\n          y: -20\n      - name: b\n        node: 2\n        position:\n          x: 180\n          y: 20',
	'  - id: R_OUT\n    kind: resistor\n    name: R_OUT\n    sourceTypeName: Circuit.Resistor\n    origin:\n      x: 180\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: a\n        node: 11\n        position:\n          x: 180\n          y: -20\n      - name: b\n        node: 2\n        position:\n          x: 180\n          y: 20',
);

/**
 * `hybridDelayPedal` with a schematic feedback resistor `R_FB` (10k) from BBD output (node 4)
 * back to BBD input (node 3) (S5).
 *
 * An impulse at t=0 produces repeating, geometrically decaying echoes spaced at 3 ms
 * (144 samples at 48 kHz): t = 144, 288, 432, 576, ...
 */
export const hybridFeedbackDelayPedal = derive(
	hybridDelayPedal,
	"wires: []",
	`  - id: R_FB
    kind: resistor
    name: R_FB
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: -20
          y: -60
      - name: b
        node: 3
        position:
          x: 20
          y: -60
    properties:
      Resistance: "10k"
      Description: "Schematic feedback resistor."
wires: []`,
);

/**
 * `hybridFeedbackDelayPedal` with higher feedback resistance (30k) -> lower loop gain (S5).
 * Echoes decay faster than the 10k baseline.
 */
export const hybridFeedbackDelayPedalLowFeedback = derive(
	hybridFeedbackDelayPedal,
	'      Resistance: "10k"\n      Description: "Schematic feedback resistor."',
	'      Resistance: "30k"\n      Description: "Lower feedback gain resistor."',
);

/**
 * `hybridFeedbackDelayPedal` with lower feedback resistance (4.7k) -> higher loop gain (S5).
 * Echoes decay slower than the 10k baseline.
 */
export const hybridFeedbackDelayPedalHighFeedback = derive(
	hybridFeedbackDelayPedal,
	'      Resistance: "10k"\n      Description: "Schematic feedback resistor."',
	'      Resistance: "4.7k"\n      Description: "Higher feedback gain resistor."',
);

/**
 * Active feedback delay fixture with op-amp gain in the feedback loop making loop gain > 1 (S5).
 * Demonstrates sustained/diverging echoes when loop gain exceeds unity.
 */
export const hybridFeedbackDelayPedalUnstableLoop = derive(
	hybridFeedbackDelayPedal,
	'  - id: R_FB\n    kind: resistor\n    name: R_FB\n    sourceTypeName: Circuit.Resistor\n    origin:\n      x: 0\n      y: -60\n    rotation: 0\n    flipped: false\n    terminals:\n      - name: a\n        node: 4\n        position:\n          x: -20\n          y: -60\n      - name: b\n        node: 3\n        position:\n          x: 20\n          y: -60\n    properties:\n      Resistance: "10k"\n      Description: "Schematic feedback resistor."\nwires: []',
	`  - id: U_FB_AMP
    kind: opamp
    name: U_FB_AMP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 0
      y: -120
    rotation: 0
    flipped: false
    terminals:
      - name: inverting
        role: inverting
        node: 9
        position:
          x: -20
          y: -130
      - name: nonInverting
        role: nonInverting
        node: 4
        position:
          x: -20
          y: -110
      - name: output
        role: output
        node: 10
        position:
          x: 20
          y: -120
      - name: vPlus
        role: supplyPositive
        node: 7
        position:
          x: 0
          y: -140
      - name: vMinus
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: -100
    properties:
      PartNumber: "TL072"
      Description: "Active feedback amplifier."
  - id: R_F_GND
    kind: resistor
    name: R_F_GND
    sourceTypeName: Circuit.Resistor
    origin:
      x: -40
      y: -140
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 9
        position:
          x: -40
          y: -150
      - name: b
        node: 0
        position:
          x: -40
          y: -130
    properties:
      Resistance: "10k"
      Description: "Inverting divider ground leg."
  - id: R_F_BACK
    kind: resistor
    name: R_F_BACK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -160
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: 20
          y: -160
      - name: b
        node: 9
        position:
          x: -20
          y: -160
    properties:
      Resistance: "40k"
      Description: "Feedback gain resistor (Av = 1 + 40k/10k = 5)."
  - id: R_FB
    kind: resistor
    name: R_FB
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 10
        position:
          x: -20
          y: -60
      - name: b
        node: 3
        position:
          x: 20
          y: -60
    properties:
      Resistance: "10k"
      Description: "Schematic feedback resistor from active stage."
wires: []`,
);

/**
 * A tapped secondary loaded at **both** taps, with nothing in it ngspice cannot express.
 *
 * `orange-rockerverb`'s output transformer is the corpus shape -- a 16 Ω jack and an 8 Ω jack each
 * with its own feedback resistor -- and that packet cannot be graded against ngspice, because a
 * spring reverb tank is a DSP operator with no circuit-level deck (5 of the 24 corpus amps are
 * excluded for the same reason). This is the claim on its own: two loaded taps are two coupled
 * windings, each at the turns ratio its own rating gives.
 *
 * Checked once against ngspice through the parity report's `--source=` mode: `agrees`,
 * corr 1.0000, gain 1.000, with that report's `--self-check` confirming a corrupted deck
 * disagrees and its 2% gain gate refuses a 3% level error. Both decks there are emitted from the
 * program, so that bounds the *solve*, not the stamps -- which is what the ratio assertions below
 * are for.
 */
export const twoLiveSecondaryTaps = `${header("Two Live Secondary Taps Fixture")}components:
  - id: JIN
    kind: jack
    name: IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Primary drive."
  - id: T1
    kind: transformer
    name: OUTPUT_TRANSFORMER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: secondary_common
        role: winding
        node: 0
        position:
          x: 20
          y: 20
      - name: secondary_8
        role: windingTap
        node: 2
        position:
          x: 20
          y: 0
      - name: secondary_16
        role: winding
        node: 3
        position:
          x: 20
          y: -20
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
        impedances:
          - across:
              - primary_a
              - primary_b
            impedance:
              raw: "3.2 kΩ plate-to-plate"
              value: 3200
              unit: "Ω"
      - role: secondary
        terminals:
          - secondary_common
          - secondary_8
          - secondary_16
        impedances:
          - across:
              - secondary_common
              - secondary_8
            impedance:
              raw: "8 Ω"
              value: 8
              unit: "Ω"
          - across:
              - secondary_common
              - secondary_16
            impedance:
              raw: "16 Ω"
              value: 16
              unit: "Ω"
    properties:
      Description: "Tapped secondary loaded at both taps."
  - id: RL8
    kind: resistor
    name: LOAD_8
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 2
        position:
          x: 120
          y: -20
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 20
    properties:
      Resistance: "8"
      Description: "8 ohm speaker load."
  - id: RL16
    kind: resistor
    name: LOAD_16
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 3
        position:
          x: 180
          y: -20
      - name: b
        role: end
        node: 0
        position:
          x: 180
          y: 20
    properties:
      Resistance: "16"
      Description: "16 ohm speaker load."
  - id: JOUT
    kind: jack
    name: OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 260
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 3
        position:
          x: 260
          y: 0
    properties:
      Description: "Taken at the 16 ohm tap."
  - id: GND
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 80
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: ground
        node: 0
        position:
          x: 0
          y: 80
    properties: {}
wires: []
`;

/**
 * A speaker jack one impedance-selector hop from the output transformer, which is where a real
 * amp puts it.
 *
 * `orange-gro100` is the corpus case and was the only one in 142 documents: `J_SPEAKER` on node 79
 * with `S_SPEAKER_IMPEDANCE` joining it to the winding's 76/77/78 taps. `resolvePorts`'s "after
 * the transformer" test required the jack to be *on* a winding node, so it missed, and the output
 * port fell through to a jack whose own `SourceBoundaryRole` reads "tone-stack output-amp handoff
 * label". The amp rendered its tone stack -- 3 V of preamp node in place of 35 V of speaker swing,
 * with no transformer bounding it, so the file clipped 10,991 samples of 96,000.
 */
export const speakerBehindSelector = `${header("Speaker Behind A Selector Fixture")}components:
${jacks}  - id: T_OUTPUT
    kind: transformer
    name: OUTPUT_TRANSFORMER
    sourceTypeName: Circuit.Transformer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 1
        position:
          x: -20
          y: -20
      - name: primary_b
        role: winding
        node: 0
        position:
          x: -20
          y: 20
      - name: secondary_common
        role: winding
        node: 0
        position:
          x: 20
          y: 20
      - name: secondary_16
        role: winding
        node: 3
        position:
          x: 20
          y: -20
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
        impedances:
          - across:
              - primary_a
              - primary_b
            impedance:
              raw: "3.2 kΩ plate-to-plate"
              value: 3200
              unit: "Ω"
      - role: secondary
        terminals:
          - secondary_common
          - secondary_16
        impedances:
          - across:
              - secondary_common
              - secondary_16
            impedance:
              raw: "16 Ω"
              value: 16
              unit: "Ω"
    properties:
      Description: "Output transformer."
  - id: S_SPEAKER_IMPEDANCE
    kind: switch
    name: IMPEDANCE_SELECTOR
    sourceTypeName: Circuit.Switch
    origin:
      x: 80
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: common
        role: common
        node: 4
        position:
          x: 80
          y: -20
      - name: throw_16
        role: throw
        node: 3
        position:
          x: 80
          y: 20
    properties:
      Description: "Speaker impedance selector."
  - id: J_SPEAKER
    kind: jack
    name: SPEAKER
    sourceTypeName: Circuit.Speaker
    origin:
      x: 160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: signal
        node: 4
        position:
          x: 160
          y: -20
      - name: cathode
        role: ground
        node: 0
        position:
          x: 160
          y: 20
    properties:
      Description: "Speaker jack behind the selector."
wires: []
`;

/**
 * A three-terminal 5 V regulator whose pins are named `pin1`/`pin2`/`pin3` and whose *roles* say
 * which is the output and which the reference — the shape `moogerfooger-mf-102`'s `U13` has.
 *
 * The registry's 78Lxx entry lists `pin2` among its ground aliases and `pin3` among its output
 * aliases, so a reader that goes by the names puts the reference on the rail here. This fixture
 * declares the opposite, which is the only evidence that settles it.
 */
export const declaredRegulator = `${header("Declared Regulator")}deviceInterface:
  controls:
    - id: JIN
      label: INPUT
      kind: jack
      role: input
    - id: JOUT
      label: OUTPUT
      kind: jack
      role: output
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 2
        position:
          x: -200
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: -200
          y: 20
    properties:
      Name: INPUT
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: tip
        node: 2
        position:
          x: 200
          y: -20
      - name: sleeve
        role: sleeve
        node: 0
        position:
          x: 200
          y: 20
    properties:
      Name: OUTPUT
  - id: PWR
    kind: rail
    name: RAW
    sourceTypeName: Circuit.Rail
    origin:
      x: -100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 1
        position:
          x: -100
          y: 0
    properties:
      Voltage: 9V
      Name: RAW
  - id: REG
    kind: regulator
    name: REG
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        role: pin
        node: 1
        position:
          x: 0
          y: -20
      - name: pin2
        role: positive
        node: 2
        position:
          x: 0
          y: 0
      - name: pin3
        role: ground
        node: 0
        position:
          x: 0
          y: 20
    properties:
      Name: REG
      PartNumber: 78L05
  - id: RLOAD
    kind: resistor
    name: RLOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 2
        position:
          x: 100
          y: -20
      - name: b
        role: end
        node: 0
        position:
          x: 100
          y: 20
    properties:
      R: 1k
      Name: RLOAD
nodes:
  - id: 0
    name: GND
  - id: 1
    name: RAW
  - id: 2
    name: PLUS5
`;

/** The same regulator with its electrode roles removed, so only the entry's pin naming is left. */
export const undeclaredRegulator = derive(
	derive(
		declaredRegulator,
		"        role: positive\n        node: 2\n",
		"        node: 2\n",
	),
	"        role: ground\n        node: 0\n        position:\n          x: 0\n          y: 20\n",
	"        node: 0\n        position:\n          x: 0\n          y: 20\n",
);

/**
 * `invertingAmplifier` with the op-amp **packaged as an eight-pin chip**, expanded by
 * `sectionsRegistry`.
 *
 * Deliberately the same circuit, so the only variable is how the op-amp arrives. A discrete
 * `kind: opamp` states its own three terminals by role; this one states eight numbered pins and
 * a part number, and the registry says which three of them are the section and in what order.
 * That is the path most of the corpus's registry-expanded devices take, and nothing graded it
 * against a second solver before: if this row disagrees while `inverting-amplifier` agrees, the
 * defect is in expansion rather than in the op-amp law.
 *
 * Pins 4-8 are in no section and connect to nothing, which is the ordinary shape of a real
 * package -- supply pins and a second half nobody used. They must contribute nothing.
 */
export const packagedOpamp = derive(
	invertingAmplifier,
	`  - id: U1
    kind: opamp
    name: DELAY_MEMORY_CHIP
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 0
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 3
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
    properties:
      Description: "MN3007 bucket brigade delay memory."`,
	`  - id: U1
    kind: ic
    name: DELAY_MEMORY_CHIP
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 0
        position:
          x: 50
          y: 0
      - name: pin2
        node: 3
        position:
          x: 60
          y: 0
      - name: pin3
        node: 2
        position:
          x: 70
          y: 0
      - name: pin4
        node: 20
        position:
          x: 80
          y: 0
      - name: pin5
        node: 21
        position:
          x: 90
          y: 0
      - name: pin6
        node: 22
        position:
          x: 100
          y: 0
      - name: pin7
        node: 23
        position:
          x: 110
          y: 0
      - name: pin8
        node: 24
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-OPAMP-1"
      Description: "MN3007 bucket brigade delay memory."`,
);

/**
 * An OTA on an eight-pin chip, driving a load resistor.
 *
 * `ota` is five corpus packets and had no fixture at all, because every real OTA arrives inside
 * an `ic` and an `ic` was refused whole. Output current is `gm` times the input difference, so
 * the stage's gain is `gm * Rload` -- 1 mS into 10k, a gain of ten -- which is a number the deck
 * and the program must both produce from the same declaration rather than a shape either could
 * fake.
 *
 * Three mapped pins and no fourth means no amplifier-bias terminal, which is the linear OTA.
 */
export const packagedOta = `${header("Packaged OTA Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: CLOCK_DRIVER
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 1
        position:
          x: 50
          y: 0
      - name: pin2
        node: 0
        position:
          x: 60
          y: 0
      - name: pin3
        node: 2
        position:
          x: 70
          y: 0
      - name: pin4
        node: 30
        position:
          x: 80
          y: 0
      - name: pin5
        node: 31
        position:
          x: 90
          y: 0
      - name: pin6
        node: 32
        position:
          x: 100
          y: 0
      - name: pin7
        node: 33
        position:
          x: 110
          y: 0
      - name: pin8
        node: 34
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-OTA-1"
      Description: "Compandor expander with reverb tank drive."
  - id: RLOAD
    kind: resistor
    name: R_TANK
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 140
          y: 20
      - name: b
        node: 0
        position:
          x: 140
          y: 60
    properties:
      Resistance: "10k"
      Description: "Bucket brigade output filter."
wires: []
`;

/**
 * The four-terminal nonlinear OTA on an eight-pin chip.
 *
 * `ota` is five corpus packets -- the phaser and chorus OTAs -- and had no fixture, because
 * every real one arrives inside an `ic`. The linear `packagedOta` reaches `vccs`, which is
 * a different stamp: a fourth mapped terminal is an amplifier-bias pin, and its presence is what
 * selects the compressive `2 * Iabc * tanh(vDiff / 2Vt)` law over the linear fallback.
 *
 * The input is divided down to about 20 mV before the OTA sees it, on purpose. The parity
 * harness drives every fixture at 0.1 V, and `tanh(0.1 / 2Vt)` is 0.96 -- pinned against the
 * compression knee, where the row would grade almost nothing but the saturation limit. At 20 mV
 * the stage runs about 5% compressed: nonlinear enough that a linear model fails the row, gentle
 * enough that the verdict is about the law rather than about clipping.
 *
 * `RBIAS` from the 9 V rail sets `Iabc` near 0.47 mA. That number is the output's scale, so a
 * bias pin mapped to the wrong node changes the gain instead of changing nothing.
 */
export const packagedNonlinearOta = `${header("Packaged Nonlinear OTA Fixture")}components:
${jacks}  - id: RDIV
    kind: resistor
    name: R_SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -160
          y: 0
      - name: b
        node: 4
        position:
          x: -120
          y: 0
    properties:
      Resistance: "39k"
      Description: "Clock driver attenuator for the delay memory."
  - id: RSHUNT
    kind: resistor
    name: R_SHUNT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -100
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 4
        position:
          x: -100
          y: 20
      - name: b
        node: 0
        position:
          x: -100
          y: 60
    properties:
      Resistance: "10k"
      Description: "Reverb tank damping."
  - id: U1
    kind: ic
    name: BBD_CLOCK
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 4
        position:
          x: 50
          y: 0
      - name: pin2
        node: 0
        position:
          x: 60
          y: 0
      - name: pin3
        node: 2
        position:
          x: 70
          y: 0
      - name: pin4
        node: 5
        position:
          x: 80
          y: 0
      - name: pin5
        node: 40
        position:
          x: 90
          y: 0
      - name: pin6
        node: 41
        position:
          x: 100
          y: 0
      - name: pin7
        node: 42
        position:
          x: 110
          y: 0
      - name: pin8
        node: 43
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-OTA-NL-1"
      Description: "Bucket brigade delay memory with internal clock."
  - id: RBIAS
    kind: resistor
    name: R_BIAS
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 60
          y: -80
      - name: b
        node: 5
        position:
          x: 60
          y: -40
    properties:
      Resistance: "18k"
      Description: "Compandor rectifier bias."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 140
          y: 20
      - name: b
        node: 0
        position:
          x: 140
          y: 60
    properties:
      Resistance: "10k"
      Description: "Bucket brigade output filter."
  - id: VBATT
    kind: voltage-source
    name: BATT
    sourceTypeName: Circuit.Battery
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 6
        position:
          x: 200
          y: 80
      - name: negative
        role: negative
        node: 0
        position:
          x: 200
          y: 120
    properties:
      Voltage: "9 V"
wires: []
`;

/**
 * A CMOS transmission gate whose own signal drives its control pin.
 *
 * `analog-switch` is two corpus packets and had no fixture. The law is a smooth sigmoid on the
 * control voltage, not a hard throw, so it has a curve worth grading -- but only if the control
 * actually moves. Tying the gate to a DC bias would leave the conductance constant and reduce
 * the row to a resistor divider that happens to be computed through an exponential.
 *
 * So the gate is driven by the signal it passes, with the threshold at 0 V. The conductance then
 * swings across the sigmoid every cycle -- about 1/171 ohm at the positive peak against 1/465 at
 * the negative one -- and the stage distorts asymmetrically. That asymmetry is the law; a linear
 * on-resistance would not produce it.
 */
export const packagedAnalogSwitch = `${header("Packaged Analog Switch Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: LFO_GATE
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 1
        position:
          x: 50
          y: 0
      - name: pin2
        node: 2
        position:
          x: 60
          y: 0
      - name: pin3
        node: 1
        position:
          x: 70
          y: 0
      - name: pin4
        node: 50
        position:
          x: 80
          y: 0
      - name: pin5
        node: 51
        position:
          x: 90
          y: 0
      - name: pin6
        node: 52
        position:
          x: 100
          y: 0
      - name: pin7
        node: 53
        position:
          x: 110
          y: 0
      - name: pin8
        node: 54
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-SWITCH-1"
      Description: "Clock divider gate for the bucket brigade."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 140
          y: 20
      - name: b
        node: 0
        position:
          x: 140
          y: 60
    properties:
      Resistance: "10k"
      Description: "Reverb tank damping network."
wires: []
`;

/**
 * An open-collector comparator with a pull-up.
 *
 * `comparator` is one corpus packet. The law is `gOn / (1 + exp(k * vDiff)) + gOff` between the
 * output and `vee`, so the output is pulled down or left to float up through `RPULLUP`. Three
 * mapped terminals leaves `vee` at ground.
 *
 * At sensitivity 50 and this harness's 0.1 V drive the output traverses roughly 0.09 V to 5.4 V
 * as a smooth curve rather than a switching edge -- deliberate, because an edge's *timing* is
 * resolved differently by a fixed-step runtime and an adaptive-step ngspice, and a row that
 * disagreed about that would be reporting the integrator rather than the comparator.
 */
export const packagedComparator = `${header("Packaged Comparator Fixture")}components:
${jacks}  - id: U1
    kind: ic
    name: CLOCK_COMPARATOR
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 1
        position:
          x: 50
          y: 0
      - name: pin2
        node: 0
        position:
          x: 60
          y: 0
      - name: pin3
        node: 2
        position:
          x: 70
          y: 0
      - name: pin4
        node: 60
        position:
          x: 80
          y: 0
      - name: pin5
        node: 61
        position:
          x: 90
          y: 0
      - name: pin6
        node: 62
        position:
          x: 100
          y: 0
      - name: pin7
        node: 63
        position:
          x: 110
          y: 0
      - name: pin8
        node: 64
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-COMPARATOR-1"
      Description: "Compandor rectifier threshold detector."
  - id: RPULLUP
    kind: resistor
    name: R_PULLUP
    sourceTypeName: Circuit.Resistor
    origin:
      x: 140
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 140
          y: -60
      - name: b
        node: 2
        position:
          x: 140
          y: -20
    properties:
      Resistance: "10k"
      Description: "Bucket brigade output pull-up."
  - id: VBATT
    kind: voltage-source
    name: BATT
    sourceTypeName: Circuit.Battery
    origin:
      x: 200
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 6
        position:
          x: 200
          y: 80
      - name: negative
        role: negative
        node: 0
        position:
          x: 200
          y: 120
    properties:
      Voltage: "9 V"
wires: []
`;

/**
 * An optocoupler as a modulated optical attenuator, which is what the corpus uses them for.
 *
 * `optocoupler` is four corpus packets -- the Fender tremolos -- and it is a **stamp in the
 * matrix**, not a lifted macro, which is the whole reason it can be referenced against ngspice
 * where a BBD cannot. The LDR shunts the signal to ground and its resistance falls exponentially
 * with LED current, so the LED is driven from the signal as well as from a bias, and the shunt
 * therefore moves with the signal: the row grades the coupling *curve* rather than one point on
 * it, which is what gives the harmonic check something to measure.
 *
 * **`RLED` is 2k7 because of a measurement, and the first value was wrong twice over.** At 8k2
 * the bias node sat near 0.98 V, which cleared the LED knee only while that knee was at the
 * uncorrected 1.036 V; once the emitter was corrected to the cited `LED-RED` entry the LDR
 * pinned fully dark and the row silently stopped grading any curve at all -- `agrees` at
 * correlation 1.0000 with h2 and h3 at 1e-9. Re-biasing to 2k7 puts the reference's distortion
 * at 0.86%, well clear of the shape check's floor, and its `h3Delta` at 0.0001. Values that put
 * the distortion just above the floor instead (8k2/2k2 reads 0.18%) measure mostly their own
 * noise and report deltas up to 0.05.
 *
 * **What this row cannot grade**, and it is worth knowing before reading a green verdict: the
 * LED's own law is three constants hardcoded in the stamp -- a 50 mV ideality, `Is = 1e-12`, and
 * a coupling `alpha` of 1000 -- which the source has no way to state, so the deck can only
 * restate them. What the row does grade independently is the pin mapping, the LDR span, and the
 * shape of the exponential coupling.
 */
export const packagedOptocoupler = `${header("Packaged Optocoupler Fixture")}components:
${jacks}  - id: RSERIES
    kind: resistor
    name: R_SERIES
    sourceTypeName: Circuit.Resistor
    origin:
      x: -120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -120
          y: -20
      - name: b
        node: 2
        position:
          x: -120
          y: 20
    properties:
      Resistance: "10k"
      Description: "Reverb tank series feed."
  - id: U1
    kind: ic
    name: TREMOLO_LFO
    sourceTypeName: Circuit.IC
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        node: 5
        position:
          x: 50
          y: 0
      - name: pin2
        node: 0
        position:
          x: 60
          y: 0
      - name: pin3
        node: 2
        position:
          x: 70
          y: 0
      - name: pin4
        node: 0
        position:
          x: 80
          y: 0
      - name: pin5
        node: 70
        position:
          x: 90
          y: 0
      - name: pin6
        node: 71
        position:
          x: 100
          y: 0
      - name: pin7
        node: 72
        position:
          x: 110
          y: 0
      - name: pin8
        node: 73
        position:
          x: 120
          y: 0
    properties:
      PartNumber: "PKG-OPTO-1"
      Description: "Bucket brigade clock optocoupler."
  - id: RLED
    kind: resistor
    name: R_LED
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: 120
          y: -80
      - name: b
        node: 5
        position:
          x: 120
          y: -40
    properties:
      Resistance: "2k7"
      Description: "Compandor rectifier bias."
  - id: RMOD
    kind: resistor
    name: R_MOD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 40
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: 40
          y: -120
      - name: b
        node: 5
        position:
          x: 40
          y: -80
    properties:
      Resistance: "1k"
      Description: "Clock driver injection."
  - id: VBATT
    kind: voltage-source
    name: BATT
    sourceTypeName: Circuit.Battery
    origin:
      x: 240
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 6
        position:
          x: 240
          y: 80
      - name: negative
        role: negative
        node: 0
        position:
          x: 240
          y: 120
    properties:
      Voltage: "9 V"
wires: []
`;

/**
 * A VTL5C2 optocoupler, resolved through `pedalPartCatalog` (not the mock `sectionsRegistry`
 * every other resident in this file uses) so this pins the actual production catalog entry, not a
 * fixture-only copy of it.
 *
 * **What it is for.** `runoffgroove-tremulus-lune`'s VTL5C2 sat in the generic optocoupler bucket
 * (`ldrMinOhms=100, ldrMaxOhms=10_000_000`, the module-wide `exp(-1000*amps)` coupling) until
 * 2026-09-15: that law put a genuinely-lit LED (0.567 mA, confirmed against an independent ngspice
 * diode solve) 56.7% of the way to its dark ceiling, because the generic bucket's bounds are
 * placeholders and VTL5C2's own datasheet -- cited in the packet's own
 * `SelectedLaneLedCurrentToResistanceLaw` property (R@1mA=5.5k, R@10mA=800, R@40mA=200,
 * dark>=1M) -- was never fit to a law at all. `part-catalog.ts`'s dedicated VTL5C2 entry carries
 * that fit now (`ldrPowerLawCoefficientOhms`/`ldrPowerLawExponent`); this fixture is what keeps it
 * pinned, since nothing else in this suite exercises it.
 *
 * **Bias.** `R_LED` (7k2 from the 9 V rail) puts the LED within a few percent of the datasheet's
 * 1 mA anchor -- close enough that a regression in the fit or an accidental fallback to the generic
 * exponential moves the verdict, not so exact that the fixture is fragile to the diode law's own
 * rounding. `RLOAD` (10k from output to ground) turns the LDR into a divider so its resistance is
 * what decides the gain, rather than leaving `ldrA`/`ldrB` floating in series with nothing to load
 * against.
 *
 * **What this proves and what it cannot** -- same limit `emitOptocoupler`'s own comment states for
 * every optocoupler resident: the from-source deck's LDR side is a `B`-source that *restates* the
 * runtime's own formula (now the power law, when the device carries one) rather than deriving it
 * independently, so ngspice cannot catch an error shared between the restatement and the runtime.
 * What it grades independently is the pin mapping, the part-specific `ldrMinOhms`/`ldrMaxOhms`
 * clamp, and -- because `source-to-spice.ts` reads the law fields off the same compiled program,
 * not off a second constant -- that the compiled program actually carries the VTL5C2-specific
 * fields rather than silently falling back to the generic law for this part.
 */
export const packagedOptocouplerVtl5c2 = `${header("VTL5C2 Datasheet-Pinned Optocoupler Fixture")}components:
${jacks}  - id: OPTO1
    kind: optocoupler
    name: TAP_DELAY_CELL
    sourceTypeName: Circuit.Optocoupler
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 5
        position:
          x: 20
          y: -20
      - name: cathode
        node: 0
        position:
          x: 20
          y: 20
      - name: ldra
        node: 1
        position:
          x: 60
          y: -20
      - name: ldrb
        node: 2
        position:
          x: 60
          y: 20
    properties:
      PartNumber: "VTL5C2"
      Description: "Spring reverb dwell trimmer."
  - id: RLED
    kind: resistor
    name: CLOCK_PULLUP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -40
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 6
        position:
          x: -40
          y: -80
      - name: b
        node: 5
        position:
          x: -40
          y: -40
    properties:
      Resistance: "7200"
      Description: "Delay memory clock termination."
  - id: RLOAD
    kind: resistor
    name: RECTIFIER_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 160
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 160
          y: 40
      - name: b
        node: 0
        position:
          x: 160
          y: 80
    properties:
      Resistance: "10k"
      Description: "Compandor bias return."
  - id: VBATT
    kind: voltage-source
    name: BATT
    sourceTypeName: Circuit.Battery
    origin:
      x: -120
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: positive
        role: positive
        node: 6
        position:
          x: -120
          y: 40
      - name: negative
        role: negative
        node: 0
        position:
          x: -120
          y: 80
    properties:
      Voltage: "9 V"
wires: []
`;

/**
 * A Belton BTDR-2H reverb brick in the smallest analog shell that can carry it.
 *
 * **Why this fixture exists.** `digital-reverb-module` was the one device law in the corpus with
 * no behavioural gate anywhere: no parity fixture -- correctly, since it is an `ic` macro the
 * runtime executes as DSP and ngspice has no circuit to compare -- and no test either. Worse, the
 * runtime's own `reverbCombGain` comment claimed "`belton-brick-reverb`'s measured T60 is checked
 * against the datasheet's 2.5 s", and nothing checked it. One packet in the corpus reaches this
 * law, so a change to the macro scheduler, the tap, or the output source could quietly silence
 * every reverb in the product and no gate here would have said a word.
 *
 * **The shell is deliberately trivial**, because the brick is what is under test. Input divides
 * 2:1 into the module's `pin3_input` through `10k`/`10k` (its datasheet Z_in is 10k, so this is
 * the impedance the part expects); `pin6_output_1` drives a `10k` load through the registry's
 * stated 220R output impedance; `pin5_output_2` is terminated so the second output is not a
 * dangling active terminal. The `5 V` rail is the module's own supply. No op-amps, because an
 * op-amp's own operating point would be a second thing to explain when a level moves.
 *
 * Node 1 is the input and node 2 the output, which is what the shared `jacks` helper already
 * declares -- so the module's output pin *is* the output port and nothing sits between them but
 * the load.
 */
export const beltonBrickReverb = `${header("Belton Brick Reverb Fixture")}components:
${jacks}  - id: VCC
    kind: rail
    name: V_5V
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -120
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 101
        position:
          x: 0
          y: -120
    properties:
      Voltage: "5"
      Description: "Module supply."
  - id: RIN
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 1
        position:
          x: -120
          y: -20
      - name: b
        role: end
        node: 3
        position:
          x: -120
          y: 20
    properties:
      Resistance: "10k"
      Description: "Module input feed."
  - id: RTAP
    kind: resistor
    name: R_TAP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -60
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 3
        position:
          x: -60
          y: 20
      - name: b
        role: end
        node: 0
        position:
          x: -60
          y: 60
    properties:
      Resistance: "10k"
      Description: "Module input reference."
  - id: BTDR2H
    kind: ic
    name: BTDR2H
    sourceTypeName: Circuit.ReverbModule
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1_5v
        role: pin
        node: 101
        position:
          x: -30
          y: -40
      - name: pin2_power_gnd
        role: pin
        node: 0
        position:
          x: -30
          y: 80
      - name: pin3_input
        role: pin
        node: 3
        position:
          x: -40
          y: 20
      - name: pin4_signal_gnd
        role: pin
        node: 0
        position:
          x: 30
          y: 80
      - name: pin5_output_2
        role: pin
        node: 4
        position:
          x: 40
          y: 20
      - name: pin6_output_1
        role: pin
        node: 2
        position:
          x: 0
          y: -20
    properties:
      PartNumber: BTDR-2H
      SourcePartFamily: BTDR-2
      SourceTraceStatus: complete-pin-shell
      Description: "Six-pin Belton BTDR-2H reverb module primitive."
  - id: RLOAD
    kind: resistor
    name: R_LOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 2
        position:
          x: 120
          y: 20
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 60
    properties:
      Resistance: "10k"
      Description: "Output 1 load."
  - id: RLOAD2
    kind: resistor
    name: R_LOAD2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 4
        position:
          x: 60
          y: 20
      - name: b
        role: end
        node: 0
        position:
          x: 60
          y: 60
    properties:
      Resistance: "10k"
      Description: "Output 2 load."
`;

/**
 * A CD4013 dual D flip-flop wired as a clock divider, lifted out of `pipeline.test.ts`.
 *
 * **Why it moved.** This was the only fixture in the repository reaching a device law that no
 * exported fixture reached: `logic-divider`. It lived as an inline template literal inside its
 * own test, and `report:fixture-parity --corpus` -- which indexes `circuits.ts` and nothing else
 * -- therefore reported "no fixture compiles to it under any known registry" about a law with a
 * working test. Seventeen fixtures were written inline that way; measured, this was the one whose
 * absence from here made a coverage report state a falsehood, which is why it is the one that
 * moved rather than all of them.
 *
 * The document is unchanged: its test still compiles it under `pedalPartCatalog` and asserts the
 * same things, and this file is now the complete set of laws the fixtures can reach.
 */
export const cd4013LogicDivider = `schema: circuit-interchange/v3
deviceInterface:
  controls:
    - id: INPUT_JACK
      label: "Input Jack"
      kind: jack
      role: "input"
    - id: OUTPUT_JACK
      label: "Output Jack"
      kind: jack
      role: "output"
components:
  - id: INPUT_JACK
    kind: jack
    name: "INPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: -480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: OUTPUT_JACK
    kind: jack
    name: "OUTPUT_JACK"
    sourceTypeName: "Circuit.Jack"
    origin:
      x: 480
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 0
          y: 0
      - name: sleeve
        node: 0
        position:
          x: 0
          y: 0
  - id: FLIP_FLOP
    kind: ic
    name: "FLIP_FLOP"
    sourceTypeName: "Circuit.IC"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "CD4013"
    terminals:
      - name: 1q
        node: 2
        position:
          x: 0
          y: 0
      - name: 1q_bar
        node: 0
        position:
          x: 0
          y: 0
      - name: 1clock
        node: 1
        position:
          x: 0
          y: 0
      - name: 1reset
        node: 0
        position:
          x: 0
          y: 0
      - name: 1data
        node: 0
        position:
          x: 0
          y: 0
      - name: 1set
        node: 0
        position:
          x: 0
          y: 0
      - name: gnd
        node: 0
        position:
          x: 0
          y: 0
      - name: 2set
        node: 0
        position:
          x: 0
          y: 0
      - name: 2reset
        node: 0
        position:
          x: 0
          y: 0
      - name: 2data
        node: 0
        position:
          x: 0
          y: 0
      - name: 2clock
        node: 0
        position:
          x: 0
          y: 0
      - name: 2q_bar
        node: 0
        position:
          x: 0
          y: 0
      - name: 2q
        node: 0
        position:
          x: 0
          y: 0
      - name: vDD
        node: 0
        position:
          x: 0
          y: 0
`;

/**
 * An MN3101 BBD clock generator with its oscillator pin biased, and the first fixture in this
 * repository to reach the `clock-driver` law at all.
 *
 * **Why it did not exist.** `report:fixture-parity --scoreboard` reads one row per corpus device
 * law and says what pins it. On 2026-09-07 exactly one law read `UNGATED: no fixture at all`:
 * `clock-driver`, needed by 7 corpus packets. Every mention of it in the test tree was about its
 * *absence* -- `non-executable-clock-driver`, `no-clock-driver`, and one adversarial-prose test
 * that requires a divider to render identically despite naming a clock driver in its text. The
 * law owns three stamped outputs and a sampled oscillator and nothing rendered it.
 *
 * **The wiring is the stamp's convention, not a real pedal's, and that is a finding rather than a
 * shortcut.** `part-catalog.ts` states the polarity plainly: the MN3101 runs on a single negative
 * supply, so a +9 V pedal ties the part's GND pin to +9 V and its VDD pin to circuit ground. The
 * runtime stamp instead treats `vdd` as the high rail and skips the coupling entirely when that
 * node *is* ground, so a correctly-wired pedal renders CP1, CP2 and VGG all pinned at zero -- and
 * two corpus packets, `boss-ch-1` and `boss-dm-3`, resolve `vdd` to node 0 and do exactly that.
 * See `docs/troubleshootings/a-correctly-wired-bbd-clock-driver-outputs-nothing.md`.
 *
 * This fixture therefore wires VDD to the +9 V rail, which is what the stamp as written needs in
 * order to oscillate. It pins the law's designed behaviour so the polarity can be corrected
 * against something; pinning first is the whole argument for the scoreboard that found it.
 *
 * OX1 sits on a `6k5`/`2k5` divider off 9 V, which is 2.5000 V exactly and therefore `fScale`
 * of 1, so the rendered rate is the declared `defaultFrequency` with nothing to subtract.
 */
export const mn3101ClockDriver = `${header("MN3101 Clock Driver Fixture")}components:
${jacks}  - id: VCC
    kind: rail
    name: V_SUPPLY
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -140
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 9
        position:
          x: 0
          y: -140
    properties:
      Voltage: "9"
      Description: "Clock driver supply."
  - id: U_CLK
    kind: ic
    name: MN3101
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        role: pin
        node: 0
        position:
          x: -40
          y: -60
      - name: pin2
        role: pin
        node: 2
        position:
          x: -40
          y: -20
      - name: pin3
        role: pin
        node: 9
        position:
          x: -40
          y: 20
      - name: pin4
        role: pin
        node: 3
        position:
          x: -40
          y: 60
      - name: pin5
        role: pin
        node: 6
        position:
          x: 40
          y: 60
      - name: pin6
        role: pin
        node: 7
        position:
          x: 40
          y: 20
      - name: pin7
        role: pin
        node: 5
        position:
          x: 40
          y: -20
      - name: pin8
        role: pin
        node: 4
        position:
          x: 40
          y: -60
    properties:
      PartNumber: "MN3101"
      SourceTraceStatus: terminal-traced
      Description: "Panasonic MN3101 BBD clock generator: 1 GND, 2 CP1, 3 VDD, 4 CP2, 5 OX3, 6 OX2, 7 OX1, 8 VGG."
  - id: R_OX_TOP
    kind: resistor
    name: R_OX_TOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 9
        position:
          x: -140
          y: -60
      - name: b
        role: end
        node: 5
        position:
          x: -140
          y: -20
    properties:
      Resistance: "6k5"
      Description: "OX1 bias, upper leg."
  - id: R_OX_BOT
    kind: resistor
    name: R_OX_BOT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 5
        position:
          x: -140
          y: 20
      - name: b
        role: end
        node: 0
        position:
          x: -140
          y: 60
    properties:
      Resistance: "2k5"
      Description: "OX1 bias, lower leg: 2.5000 V exactly."
  - id: R_CP1
    kind: resistor
    name: R_CP1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 2
        position:
          x: 120
          y: -80
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: -40
    properties:
      Resistance: "10k"
      Description: "CP1 load."
  - id: R_CP2
    kind: resistor
    name: R_CP2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 3
        position:
          x: 120
          y: -20
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 20
    properties:
      Resistance: "10k"
      Description: "CP2 load."
  - id: R_VGG
    kind: resistor
    name: R_VGG
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 4
        position:
          x: 120
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 80
    properties:
      Resistance: "10k"
      Description: "VGG load."
  - id: R_OX2
    kind: resistor
    name: R_OX2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 7
        position:
          x: 180
          y: 0
      - name: b
        role: end
        node: 0
        position:
          x: 180
          y: 40
    properties:
      Resistance: "100k"
      Description: "OX2 termination."
  - id: R_OX3
    kind: resistor
    name: R_OX3
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 6
        position:
          x: 180
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: 180
          y: 80
    properties:
      Resistance: "100k"
      Description: "OX3 termination."
  - id: R_IN
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 1
        position:
          x: -200
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: -200
          y: 80
    properties:
      Resistance: "1M"
      Description: "Input termination: this fixture's output is the clock."
`;

/**
 * The same clock driver with one divider leg changed, and nothing else.
 *
 * `4k`/`5k` off 9 V is 5.0000 V exactly, so `fScale` is 2 and the rendered rate must be twice the
 * declared frequency. Without a second bias the OX1 coupling is unpinned: at 2.5 V the scale
 * factor is 1, so a runtime that ignored the oscillator pin and hardcoded `fScale = 1` would
 * satisfy every assertion the fixture above can make. The BBD's delay time is derived from this
 * rate, so "the clock is a constant" and "the clock follows its control pin" are exactly the two
 * possibilities that need separating.
 */
export const mn3101ClockDriverFastOscillator = `${header("MN3101 Clock Driver Fixture, Fast Oscillator")}components:
${jacks}  - id: VCC
    kind: rail
    name: V_SUPPLY
    sourceTypeName: Circuit.Rail
    origin:
      x: 0
      y: -140
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        role: end
        node: 9
        position:
          x: 0
          y: -140
    properties:
      Voltage: "9"
      Description: "Clock driver supply."
  - id: U_CLK
    kind: ic
    name: MN3101
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: pin1
        role: pin
        node: 0
        position:
          x: -40
          y: -60
      - name: pin2
        role: pin
        node: 2
        position:
          x: -40
          y: -20
      - name: pin3
        role: pin
        node: 9
        position:
          x: -40
          y: 20
      - name: pin4
        role: pin
        node: 3
        position:
          x: -40
          y: 60
      - name: pin5
        role: pin
        node: 6
        position:
          x: 40
          y: 60
      - name: pin6
        role: pin
        node: 7
        position:
          x: 40
          y: 20
      - name: pin7
        role: pin
        node: 5
        position:
          x: 40
          y: -20
      - name: pin8
        role: pin
        node: 4
        position:
          x: 40
          y: -60
    properties:
      PartNumber: "MN3101"
      SourceTraceStatus: terminal-traced
      Description: "Panasonic MN3101 BBD clock generator: 1 GND, 2 CP1, 3 VDD, 4 CP2, 5 OX3, 6 OX2, 7 OX1, 8 VGG."
  - id: R_OX_TOP
    kind: resistor
    name: R_OX_TOP
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: -40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 9
        position:
          x: -140
          y: -60
      - name: b
        role: end
        node: 5
        position:
          x: -140
          y: -20
    properties:
      Resistance: "4k"
      Description: "OX1 bias, upper leg."
  - id: R_OX_BOT
    kind: resistor
    name: R_OX_BOT
    sourceTypeName: Circuit.Resistor
    origin:
      x: -140
      y: 40
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 5
        position:
          x: -140
          y: 20
      - name: b
        role: end
        node: 0
        position:
          x: -140
          y: 60
    properties:
      Resistance: "5k"
      Description: "OX1 bias, lower leg: 5.0000 V exactly, so fScale is 2."
  - id: R_CP1
    kind: resistor
    name: R_CP1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: -60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 2
        position:
          x: 120
          y: -80
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: -40
    properties:
      Resistance: "10k"
      Description: "CP1 load."
  - id: R_CP2
    kind: resistor
    name: R_CP2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 3
        position:
          x: 120
          y: -20
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 20
    properties:
      Resistance: "10k"
      Description: "CP2 load."
  - id: R_VGG
    kind: resistor
    name: R_VGG
    sourceTypeName: Circuit.Resistor
    origin:
      x: 120
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 4
        position:
          x: 120
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: 120
          y: 80
    properties:
      Resistance: "10k"
      Description: "VGG load."
  - id: R_OX2
    kind: resistor
    name: R_OX2
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 7
        position:
          x: 180
          y: 0
      - name: b
        role: end
        node: 0
        position:
          x: 180
          y: 40
    properties:
      Resistance: "100k"
      Description: "OX2 termination."
  - id: R_OX3
    kind: resistor
    name: R_OX3
    sourceTypeName: Circuit.Resistor
    origin:
      x: 180
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 6
        position:
          x: 180
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: 180
          y: 80
    properties:
      Resistance: "100k"
      Description: "OX3 termination."
  - id: R_IN
    kind: resistor
    name: R_IN
    sourceTypeName: Circuit.Resistor
    origin:
      x: -200
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: end
        node: 1
        position:
          x: -200
          y: 40
      - name: b
        role: end
        node: 0
        position:
          x: -200
          y: 80
    properties:
      Resistance: "1M"
      Description: "Input termination: this fixture's output is the clock."
`;

/**
 * **Synthetic dry wire -- positive control for `detectDryWire` (report-input-dependence.ts:1002).**
 *
 * The corpus lost its dry-wire packet on 2026-09-15 when tremulus-lune was cured by the
 * optocoupler LDR fix, so *every* dry-wire row in the report now asserts `false` and the
 * detector can never prove it FIRES. This synthetic restores the positive control in the
 * compiler-lane fixtures: one bypass-switch position carries the input near-unity (inside the
 * detector's 2 % passthrough bar) and the other position is dead (below the detector's
 * -60 dBFS floor, full scale * 1e-3). A prose reader is told it is a working spring-reverb
 * tank; the *structure* is what the detector must flag, never the prose.
 *
 * **The first build of this fixture was wrong and never fired -- worth recording why, since the
 * mistake is the instructive part.** `SW1` bridged input to *ground*, not to the output probe, so
 * bypassing it collapsed the whole source to ~0 V instead of passing it through, and a fixed
 * R1/R2 divider sat in the signal path in *both* switch positions, so neither position was ever
 * unity: measured `-20.8 dB` (bypass) and `0.09x` (tank), never near-unity and dead. A divider is
 * not a wire. The fix moves the switch itself onto the input/output path (`a: node 1`,
 * `b: node 2`) so closing it *is* the wire, and removes the always-present divider from the live
 * path entirely.
 *
 * `detectDryWire`'s own `measure()` drives through `ReferenceRuntime.prepare(SAMPLE_RATE)` with
 * no `inputSourceOhms` option, so the input source is ideal (0 ohm) here -- **not** the ~10 kOhm
 * guitar-ish default `render:v2`'s CLI applies to its own stimulus. That matters for R2 below: an
 * ideal source means R2 barely attenuates the closed-switch reading (it only divides against the
 * switch's own ~0.01 ohm on-resistance), so a small, unremarkable termination value is safe to
 * leave in the live path on both sides of the switch.
 *
 * - **`SW1`**: `a` on the input node, `b` on the output-probe node. Bypassed (on-resistance) is a
 *   near-direct wire; tank (off-resistance, ~1e9 ohm) is effectively open.
 * - **`R2`**: output probe node to ground, 1 kOhm. Always present. With an ideal source this costs
 *   the bypassed reading nothing (1 kOhm >> the switch's ~0.01 ohm on-resistance), and in the tank
 *   position it is the dominant path to ground against the switch's ~1e9 ohm off-resistance, which
 *   is what pins the dead reading far below the floor rather than leaving the output node to a bare
 *   gmin (1e12 ohm) shunt -- gmin alone against a 1e9 ohm off-switch would leak ~99.9 % of the input
 *   through, not read dead at all.
 * - **`R1`**: input node to output-probe node, in parallel with the switch, always present at a
 *   deliberately huge value (100 Mohm) so it changes neither reading by more than a part in 1e5 --
 *   present only so the mutation control below has one property to change.
 */
export const syntheticDryWire = `${header("Synthetic Dry-Wire Fixture")}deviceInterface:
  controls:
    - id: Bypass
      label: BYPASS
      kind: switch
      role: bypass
components:
${jacks}  - id: JOUT_PROBE
    kind: jack
    name: OUTPUT_PROBE
    sourceTypeName: Circuit.Speaker
    origin:
      x: 180
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 180
          y: 0
    properties:
      V0dBFS:
        raw: 1 V
        value: 1
        unit: V
      Role: output
      Description: "Synthetic dry-wire output probe; 1 V full scale mirrors boss-sd-1's declared output conversion reference verbatim."
  - id: SW1
    kind: switch
    name: REVERB_TANK_SELECT
    sourceTypeName: Circuit.Switch
    origin:
      x: -160
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -160
          y: -20
      - name: b
        node: 2
        position:
          x: -160
          y: 20
    properties:
      ControlId: "Bypass"
      Description: "Spring reverb tank recovery select: bypassed wires the input straight through to the output probe; tank position opens that path and leaves the tank arm to recover through the termination network below."
  - id: R1
    kind: resistor
    name: TANK_RECOVERY_UPPER
    sourceTypeName: Circuit.Resistor
    origin:
      x: -60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -60
          y: -20
      - name: b
        node: 2
        position:
          x: -60
          y: 20
    properties:
      Resistance: "100M"
      Description: "Tank recovery leakage bridge, always present in parallel with SW1; deliberately weak so it never competes with either switch position."
  - id: R2
    kind: resistor
    name: TANK_RECOVERY_LOWER
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 60
          y: 0
      - name: b
        node: 0
        position:
          x: 60
          y: 40
    properties:
      Resistance: "1k"
      Description: "Tank output termination to ground; negligible against SW1 closed, dominant against SW1 open, which is what pins the tank position dead."
wires: []
`;

/**
 * **Mutation control for the synthetic dry wire.**
 *
 * The same fixture with the dead arm made alive: R1's 100 Mohm leakage bridge (negligible in
 * both switch positions) is replaced by a 1 kOhm live arm, so it now competes evenly with R2
 * even when SW1 is open -- both switch positions read roughly half the input, neither dead nor
 * near-unity. `detectDryWire` must NOT fire here -- if it fired, it would be firing because a
 * bypass switch exists, not because a wire is dry. This is the negative control that proves the
 * positive control fires for the right reason.
 *
 * `derive()`, not a bare `.replace()`: the first build of this control used `.replace()` against
 * a `"1M"` target the base fixture had already stopped declaring, so the replacement silently
 * matched nothing and the control was comparing the base fixture against an unmodified copy of
 * itself the entire time. `derive()` throws instead of returning a silent no-op.
 */
export const syntheticDryWireMutation = derive(
	syntheticDryWire,
	'Resistance: "100M"',
	'Resistance: "1k"',
);
