// Stage 1 contract: source text -> Netlist, with geometry and prose gone.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import { NetlistError, isUserPanelControl, parseQuantity, readNetlist } from "../src/netlist";
import { GROUND } from "../src/types";
import {
	bypassEngagedFixture,
	centerTappedVoltageDerivedTransformer,
	derive,
	dividerWithUnconnectedParts,
	fixedContactSwitchCircuit,
	gangedRheostats,
	interfaceOnlyPlaceholder,
	jacksTypedOnlyByRole,
	jfetSpiceCasedParameters,
	kilohmStructuredValue,
	ledgerOverridesInlineDivider,
	malformed,
	namedNodeDivider,
	panelKnobAndHardwareControls,
	potAntiLogarithmicTaper,
	potDivider,
	potReverseLinearTaper,
	potLogarithmicTaper,
	potSourceUnmarkedTaper,
	potSteppedTaper,
	potUnknownTaperCode,
	powerTransformerVoltageDerived,
	quotedNodeDivider,
	rcLowPass,
	resistorDivider,
	resistorDividerRedrawn,
	resistorDividerRelabelled,
	sourceOnlyPlaceholder,
	switchedDivider,
	switchedDividerStatingClosed,
	switchedDividerStatingSelectedState,
	switchedDividerStatingUnknownContact,
	switchedDividerStatingUnrelatedSelectedState,
	switchedDividerWithFuseRating,
	switchInSignalPath,
	taperCodeStructuredValue,
	transformerUnlistedWindingSpelling,
	twoWindingVoltageDerivedTransformer,
	unparseableValue,
	unreadableNonBaseUnit,
	wireAxisAligned,
	wireDiagonal,
	speakerBehindSelector,
} from "../src/fixtures/circuits";
import {
	centerTappedVoltageDerivedRmsPerHalf,
	powerTransformerFilamentRms,
	powerTransformerHvRmsPerHalf,
	powerTransformerRectifierHeaterRms,
	twoWindingVoltageDerivedRms,
} from "../src/fixtures/expected";

describe("readNetlist", () => {
	it("reads SPICE-cased JFET parameter keys", () => {
		// The corpus spells them Vt0/Beta; the reader only knew VTO/BETA, so the
		// declared values fell back to the law defaults (-2 V, 1 mS) silently.
		const netlist = readNetlist(jfetSpiceCasedParameters);
		for (const id of ["Q_SPICE", "Q_LEGACY"]) {
			const device = netlist.devices.find((candidate) => candidate.id === id);
			expect(device?.kind).toBe("jfet");
			expect(device?.parameters.thresholdVolts).toBe(-2.02);
			expect(device?.parameters.transconductance).toBe(0.001314);
		}
	});
	it("reads devices, nodes and ports", () => {
		const netlist = readNetlist(resistorDivider);
		const resistors = netlist.devices.filter(
			(device) => device.kind === "resistor",
		);
		expect(resistors).toHaveLength(2);
		expect(resistors[0]?.parameters.ohms).toBe(10_000);
		expect(netlist.nodes).toContain(0);
		expect(netlist.ports.input).not.toBe(netlist.ports.output);
	});

	it("drops an interface-only or source-only placeholder instead of refusing it", () => {
		// Both flags name the same disposition: context the source says not to model. The
		// placeholder declares no resistance, which would throw in the parameter stage were it
		// lowered as an ordinary resistor; the correct answer is to drop it and say so.
		for (const source of [interfaceOnlyPlaceholder, sourceOnlyPlaceholder]) {
			const netlist = readNetlist(source);
			expect(netlist.devices.some((device) => device.id === "R_LED")).toBe(
				false,
			);
			expect(netlist.devices.some((device) => device.id === "R1")).toBe(true);
			expect(
				(netlist.warnings ?? []).some(
					(warning) => warning.code === "interface-or-source-only",
				),
			).toBe(true);
		}
	});

	it("carries no geometry or prose into the netlist", () => {
		const netlist = readNetlist(resistorDivider);
		const serialized = JSON.stringify(netlist);
		// The fixtures deliberately contain these; none may survive stage 1.
		expect(serialized).not.toContain("origin");
		expect(serialized).not.toContain("rotation");
		expect(serialized).not.toContain("flipped");
		expect(serialized).not.toContain("Description");
		expect(serialized).not.toContain("bucket brigade");
		expect(serialized).not.toContain("BBD_DELAY_MEMORY");
	});

	it("is unchanged by adversarial names and descriptions", () => {
		// Every fixture claims to be a delay/reverb/clock circuit in its prose. If any
		// stage ever starts reading that text, this is the test that fails.
		const netlist = readNetlist(resistorDivider);
		expect(
			netlist.devices.every(
				(device) =>
					device.kind === "resistor" ||
					device.kind === "jack" ||
					device.kind === "ground",
			),
		).toBe(true);
	});

	it("yields the same netlist when the same circuit is drawn differently", () => {
		const first = readNetlist(resistorDivider);
		const second = readNetlist(resistorDividerRedrawn);
		const shape = (netlist: ReturnType<typeof readNetlist>) =>
			netlist.devices
				.map(
					(device) =>
						`${device.kind}:${JSON.stringify(device.parameters)}:${device.nodes.join("-")}`,
				)
				.sort();
		expect(shape(second)).toEqual(shape(first));
	});

	it("yields the same netlist when the nodes are numbered differently", () => {
		// The invariant is equality *up to node relabeling*, which the test above cannot
		// show: its two drawings happen to agree on every node id. A node id is a label
		// the document chose, so the only fixed points are ground and the two ports.
		const shapeUpToRelabeling = (netlist: ReturnType<typeof readNetlist>) => {
			const anchors = new Map<number, string>([
				[GROUND, "ground"],
				[netlist.ports.input, "in"],
				[netlist.ports.output, "out"],
			]);
			const label = (node: number): string => {
				const anchor = anchors.get(node);
				if (anchor === undefined) {
					// Extend the anchoring before adding a fixture with internal nodes:
					// silently labelling one would make this comparison meaningless.
					throw new Error(`fixture has an unanchored node: ${node}`);
				}
				return anchor;
			};
			return netlist.devices
				.map(
					(device) =>
						`${device.kind}:${JSON.stringify(device.parameters)}:${device.nodes.map(label).join("-")}`,
				)
				.sort();
		};

		const numbered = readNetlist(resistorDivider);
		const relabelled = readNetlist(resistorDividerRelabelled);
		// The premise: the two documents really do disagree about the node ids.
		expect(relabelled.ports.input).not.toBe(numbered.ports.input);
		expect(shapeUpToRelabeling(relabelled)).toEqual(
			shapeUpToRelabeling(numbered),
		);
	});

	it("reads a declared taper as a whole value, not by its first letters", () => {
		const taperOf = (source: string) => readNetlist(source).controls[0]?.taper;
		// Both spellings are in the corpus and prefix matching read both wrongly:
		// `AntiLogarithmic` matched no rule and became linear, and `ReverseLinear`
		// matched "rev" and became reverse-logarithmic -- a bent track, not a reversed
		// one. Taper is among the most audible things about a pedal.
		expect(taperOf(potAntiLogarithmicTaper)).toBe("reverse-logarithmic");
		expect(taperOf(potReverseLinearTaper)).toBe("reverse-linear");
	});

	it("leaves a taper it does not know unrecognised", () => {
		// `W20` is a manufacturer's own curve. Falling back to linear is honest; landing
		// on a plausible neighbour because three letters matched is not.
		expect(readNetlist(potUnknownTaperCode).controls[0]?.taper).toBe("linear");
	});

	it("names a taper it cannot execute, and stays quiet when the source states none", () => {
		// **The three outcomes, and the two negatives are the point.** 69 of the corpus's 608
		// declared tapers fell through to linear and every one did it silently; an audio pot
		// rendered linear is audible across the whole sweep. But a fallback is only worth naming
		// where something was lost, so this pins all three cases at once.
		const taperWarnings = (source: string): readonly { declared: string }[] =>
			(readNetlist(source).warnings ?? [])
				.filter((warning) => warning.code === "taper-not-executable")
				.map((warning) => ({
					declared: (warning as { declared: string }).declared,
				}));

		// A marking whose curve is not derivable here: linear, and said out loud.
		expect(taperWarnings(potUnknownTaperCode).map((w) => w.declared)).toEqual([
			"W20",
		]);
		// A taper the format carries and this runtime has no law for: same treatment.
		expect(taperWarnings(potSteppedTaper).map((w) => w.declared)).toEqual([
			"stepped",
		]);
		// The source saying it does not know is a complete statement, so nothing was lost.
		expect(taperWarnings(potSourceUnmarkedTaper)).toEqual([]);
		expect(readNetlist(potSourceUnmarkedTaper).controls[0]?.taper).toBe("linear");
		// And a taper that resolves is silent, or the warning would be "this pedal has a pot".
		expect(taperWarnings(potLogarithmicTaper)).toEqual([]);
	});

	it("binds a control to the device it varies", () => {
		const netlist = readNetlist(potDivider);
		const pot = netlist.devices.find(
			(device) => device.kind === "potentiometer",
		);
		expect(pot?.control).toBe("Level");
		expect(netlist.controls.map((control) => control.id)).toContain("Level");
	});

	it("defaults an unpositioned switch that the signal can route around to open", () => {
		// Closing it would short the divider midpoint to ground, which is why half
		// travel was wrong here.
		const netlist = readNetlist(switchedDivider);
		expect(
			netlist.controls.find((control) => control.id === "Bypass")
				?.defaultPosition,
		).toBe(0);
	});

	it("defaults a maintained bypass switch to its declared engaged position", () => {
		// The same shunt graph as above, but the document declares the switch
		// engaged at position 1: every fallback would rest it at 0, so every
		// default render would play bypass while the product shows the pedal
		// engaged. The declaration wins, silently: the override doing its job
		// is the one case that raises no warning.
		const netlist = readNetlist(bypassEngagedFixture(1));
		expect(
			netlist.controls.find((control) => control.id === "SW1")
				?.defaultPosition,
		).toBe(1);
		const compiled = compile(bypassEngagedFixture(1));
		if (compiled.status === "ok") {
			expect(
				compiled.warnings.map((warning) => warning.code),
			).not.toContain("bypass-engaged-disagrees");
		} else {
			throw new Error("did not compile");
		}
	});

	it("keeps the connectivity default when engagedPosition 0 is declared", () => {
		// A declared 0 does not override a real derived position: it keeps whatever
		// the fallbacks derive (here open, like the undeclared case above), and
		// agreeing with the derivation is silent too.
		const netlist = readNetlist(bypassEngagedFixture(0));
		expect(
			netlist.controls.find((control) => control.id === "SW1")
				?.defaultPosition,
		).toBe(0);
		const compiled = compile(bypassEngagedFixture(0));
		if (compiled.status === "ok") {
			expect(
				compiled.warnings.map((warning) => warning.code),
			).not.toContain("bypass-engaged-disagrees");
		} else {
			throw new Error("did not compile");
		}
	});

	it("lets a declared engaged 0 replace a default that is no position", () => {
		// A stated Position the Options cannot place on a throw reads as half
		// travel, the boundary between a two-position switch's throws, which the
		// runtime plays as one of them. The declaration names the position, so it
		// wins, silently. The fixture without the stated Position is the control.
		expect(
			readNetlist(bypassEngagedFixture(1, false, true)).controls.find(
				(control) => control.id === "SW1",
			)?.defaultPosition,
		).toBe(1);
		const netlist = readNetlist(bypassEngagedFixture(0, false, true));
		expect(
			netlist.controls.find((control) => control.id === "SW1")
				?.defaultPosition,
		).toBe(0);
		const compiled = compile(bypassEngagedFixture(0, false, true));
		if (compiled.status === "ok") {
			expect(
				compiled.warnings.map((warning) => warning.code),
			).not.toContain("bypass-engaged-disagrees");
		} else {
			throw new Error("did not compile");
		}
	});

	it("withholds the engaged override from a latch-toggled bypass switch", () => {
		// A momentary contact declaring engaged 1 would rest "held pressed",
		// and its first press would produce no rising edge -- so it keeps 0,
		// and the disagreement is named rather than silently kept or dropped.
		const netlist = readNetlist(bypassEngagedFixture(1, true));
		expect(
			netlist.controls.find((control) => control.id === "SW1")
				?.defaultPosition,
		).toBe(0);
		const compiled = compile(bypassEngagedFixture(1, true));
		if (compiled.status === "ok") {
			expect(
				compiled.warnings.map((warning) => warning.code),
			).toContain("bypass-engaged-disagrees");
		} else {
			throw new Error("did not compile");
		}
	});

	it("reads a switch's stated contact state instead of defaulting it", () => {
		// The fixture above is the negative control: the same switch, same shunt
		// wiring, same routable-around path, defaults to open. Adding the one property
		// the source uses to say the contacts are made has to beat that default --
		// otherwise a switch the document positions is decided by connectivity, which
		// is what left `pro-co-rat`'s bypass-control contact open against a source
		// saying `effect-on`.
		const netlist = readNetlist(switchedDividerStatingClosed);
		expect(
			netlist.controls.find((control) => control.id === "Bypass")
				?.defaultPosition,
		).toBe(1);
	});

	it("reads the amp corpus's second spelling of a stated contact state", () => {
		// `SelectedState: "closed/on"` is how three amps state the standby switch that feeds
		// their B+. Nothing read it, so every plate in those amps sat at 0 V while their
		// rectifiers reached 424 V, and all three rendered silence.
		expect(
			readNetlist(switchedDividerStatingSelectedState).controls.find(
				(control) => control.id === "Bypass",
			)?.defaultPosition,
		).toBe(1);
	});

	it("ignores a SelectedState that is not a contact state, rather than refusing it", () => {
		// The negative control that separates the two spellings: `State` means a contact and an
		// unrecognised value there is an error, while `SelectedState` also carries impedance taps
		// and power modes. Throwing on those would refuse packets over a field making a different
		// claim, so this one falls back to the connectivity default.
		expect(
			readNetlist(switchedDividerStatingUnrelatedSelectedState).controls.find(
				(control) => control.id === "Bypass",
			)?.defaultPosition,
		).toBe(0);
	});

	it("defaults a fuse to conducting", () => {
		// A blown fuse is a fault a source would have to state. 26 switch components across the
		// amp corpus declare a `FuseRating` and none states a contact position, so every fuse in
		// every amp defaulted open -- one of them an HT fuse holding B+ off an entire amp.
		expect(
			readNetlist(switchedDividerWithFuseRating).controls.find(
				(control) => control.id === "Bypass",
			)?.defaultPosition,
		).toBe(1);
	});

	it("refuses a contact state outside the closed vocabulary rather than guessing one", () => {
		// A switch quietly defaulted to the wrong contact renders a plausible wrong
		// circuit, so an unrecognised state is a refusal that names it.
		expect(() => readNetlist(switchedDividerStatingUnknownContact)).toThrow(
			NetlistError,
		);
	});

	it("defaults an unpositioned switch that carries the only path to closed", () => {
		// The same switch component and the same terminal names as above, in series
		// instead of in shunt. Opening it disconnects the pedal, so a constant open
		// default is as wrong here as a constant closed one is above; only the path
		// between the ports separates them.
		const netlist = readNetlist(switchInSignalPath);
		expect(
			netlist.controls.find((control) => control.id === "Bypass")
				?.defaultPosition,
		).toBe(1);
	});

	it("excludes hardware and power switches from Program.controls while retaining fixed state", () => {
		const hardwarePowerSwitchCircuit = switchedDivider.replace(
			'      ControlId: "Bypass"\n      Description: "True bypass footswitch."',
			'      SwitchKind: "mains-power"\n      Description: "Mains power switch."',
		);
		const netlist = readNetlist(hardwarePowerSwitchCircuit);
		// Hardware mains switch must NOT be emitted as a user control
		expect(netlist.controls.find((c) => c.id === "Bypass")).toBeUndefined();
		expect(netlist.controls.find((c) => c.id === "SW1")).toBeUndefined();
		// But the switch device still exists in netlist with position 1 (closed)
		const switchDev = netlist.devices.find((d) => d.kind === "switch");
		expect(switchDev).toBeDefined();
		expect(switchDev?.control).toBeNull();
		expect(switchDev?.parameters.position).toBe(1);
	});

	it("excludes jacks and leds from Program.controls while keeping the knob and the devices", () => {
		// `boss-od-1` declares `INPUT_JACK`, `OUTPUT_JACK` and `CHECK_LED` alongside
		// its knobs, and all three leak into `Program.controls`; the kind is a
		// closed vocabulary (`jack`, `led`, `display`), so the exclusion is a
		// whole-value kind compare, never a read of the control's name or prose.
		const netlist = readNetlist(panelKnobAndHardwareControls);
		expect(netlist.controls.map((c) => c.id)).toEqual(["Level"]);
		// Dropping the control must not drop the device.
		for (const id of ["JIN", "JOUT"]) {
			const device = netlist.devices.find((d) => d.id === id);
			expect(device).toBeDefined();
			expect(device?.control).toBeNull();
		}
	});

	it("admits and refuses declared controls by kind and role as whole values", () => {
		// Knobs and the switches a player operates are admitted; jacks, leds,
		// displays and indicator/battery-contact roles are not. An absent kind or
		// role passes, because an older document that states neither is not assumed
		// to be hardware.
		expect(isUserPanelControl({ kind: "knob", role: "output-level" })).toBe(
			true,
		);
		expect(isUserPanelControl({ kind: "slider", role: "bass" })).toBe(true);
		expect(isUserPanelControl({ kind: "switch" })).toBe(true);
		expect(isUserPanelControl({ kind: "selector" })).toBe(true);
		expect(isUserPanelControl({ kind: "footswitch" })).toBe(true);
		expect(isUserPanelControl({})).toBe(true);
		expect(isUserPanelControl({ kind: "jack" })).toBe(false);
		expect(isUserPanelControl({ kind: "led" })).toBe(false);
		expect(isUserPanelControl({ kind: "display" })).toBe(false);
		expect(isUserPanelControl({ kind: "knob", role: "indicator" })).toBe(false);
		expect(
			isUserPanelControl({ kind: "switch", role: "battery-contact" }),
		).toBe(false);
		expect(isUserPanelControl({ kind: "switch", role: "standby" })).toBe(false);
		// A name that merely looks like a knob must still be refused by its kind,
		// and a hardware role must refuse regardless of the id it is carried under.
		expect(isUserPanelControl({ kind: "led", role: "output-level" })).toBe(
			false,
		);
		expect(
			isUserPanelControl({ kind: "knob", role: "indicator" }),
		).toBe(false);
	});

	it("manufactures no control for a switch whose terminals all share one node", () => {
		// `boss-od-1`'s `INPUT_BATTERY_CONTACT` is a two-terminal switch with both
		// ends on node 0: a permanent bridge that can never change the circuit.
		// It is refused by connectivity alone, because the source gives it no role
		// to refuse by. The unbound second switch (`SWX`) on distinct nodes keeps
		// its invented control, so this test proves it can fail for the claimed
		// reason.
		const netlist = readNetlist(fixedContactSwitchCircuit);
		expect(netlist.controls.some((c) => c.id === "BAT_CONTACT")).toBe(false);
		expect(netlist.controls.find((c) => c.id === "SWX")).toBeDefined();
		expect(
			netlist.devices.find((d) => d.id === "BAT_CONTACT")?.control,
		).toBeNull();
	});

	it("binds multi-pole ganged switches to a single base control ID", () => {
		const gangedSwitchCircuit = resistorDivider.replace(
			"wires: []",
			`  - id: "SW1A"
    kind: "switch"
    name: "SW1A"
    sourceTypeName: "Circuit.Switch"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: "throw"
        node: 2
        position:
          x: 0
          y: 0
      - name: "common"
        node: 0
        position:
          x: 0
          y: 0
  - id: "SW1B"
    kind: "switch"
    name: "SW1B"
    sourceTypeName: "Circuit.Switch"
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: "throw"
        node: 1
        position:
          x: 0
          y: 0
      - name: "common"
        node: 0
        position:
          x: 0
          y: 0
wires: []`,
		);
		const netlist = readNetlist(gangedSwitchCircuit);
		// Both SW1A and SW1B should bind to the shared base control SW1
		const sw1Controls = netlist.controls.filter((c) => c.id === "SW1");
		expect(sw1Controls.length).toBe(1);
		expect(netlist.controls.find((c) => c.id === "SW1A")).toBeUndefined();
		expect(netlist.controls.find((c) => c.id === "SW1B")).toBeUndefined();
	});

	it("quantizes discrete switch positions to 2 and keeps potentiometers continuous (null)", () => {
		const netlist = readNetlist(potDivider);
		const potControl = netlist.controls.find((c) => c.id === "Level");
		expect(potControl).toBeDefined();
		expect(potControl?.positions).toBeNull();

		const switchNetlist = readNetlist(switchInSignalPath);
		const switchControl = switchNetlist.controls.find((c) => c.id === "Bypass");
		expect(switchControl).toBeDefined();
		expect(switchControl?.positions).toBe(2);
	});

	it("keeps identity evidence separate from behaviour", () => {
		const netlist = readNetlist(rcLowPass);
		const resistor = netlist.devices.find(
			(device) => device.kind === "resistor",
		);
		// Evidence exists for stage 2, but it is nested, not mixed into parameters.
		expect(resistor?.identity).toBeDefined();
		expect(Object.keys(resistor?.parameters ?? {})).toEqual(["ohms"]);
	});

	it("refuses a malformed document", () => {
		expect(() => readNetlist(malformed)).toThrow(NetlistError);
	});

	it("refuses an unparseable quantity rather than defaulting it", () => {
		expect(() => readNetlist(unparseableValue)).toThrow(NetlistError);
	});

	it("reads a node id as a token, quoted or named", () => {
		// A node id is written bare, quoted, or as a name, and all three mean the same
		// connection. Requiring a number silently drops the other two and then reports
		// the terminal as unconnected -- a check that examines nothing.
		const bare = readNetlist(resistorDivider);
		for (const source of [quotedNodeDivider, namedNodeDivider]) {
			const netlist = readNetlist(source);
			const resistors = netlist.devices.filter(
				(device) => device.kind === "resistor",
			);
			expect(resistors).toHaveLength(2);
			expect(netlist.nodes).toHaveLength(bare.nodes.length);
			// Same topology: two resistors sharing one node, one of them on ground.
			const [first, second] = resistors;
			const shared = first?.nodes.filter((node) =>
				second?.nodes.includes(node),
			);
			expect(shared).toHaveLength(1);
			expect(resistors.some((device) => device.nodes.includes(GROUND))).toBe(
				true,
			);
		}
	});

	it("grounds a node by the symbol on it, never by what it is called", () => {
		// The ground token in this fixture is named `n_delay_clock_bus`.
		const netlist = readNetlist(namedNodeDivider);
		expect(netlist.nodes).toContain(GROUND);
		expect(JSON.stringify(netlist)).not.toContain("n_delay_clock_bus");
	});

	it("refuses a document whose ledger and inline terminal nodes disagree", () => {
		// This used to resolve, with the ledger winning and a `ledger-divergence` warning.
		// `@vessel-dsp/core`'s interchange contract v1 merges the two declarations and refuses
		// a disagreement rather than picking a side, so a document that describes two different
		// circuits is now an answer about the source instead of a silent choice between them.
		expect(() => readNetlist(ledgerOverridesInlineDivider)).toThrow(
			/already belongs to node/u,
		);
	});

	it("ignores a component that declares no terminals", () => {
		// Not because it is called STATUS_LED or described as panel hardware -- both
		// stay unread. Because with no terminals it has no nodes, so it cannot
		// contribute a row or a column to any matrix. The proof is that the netlist is
		// identical with and without it, except for the unconnected behavior component warnings.
		const withUnconnected = readNetlist(dividerWithUnconnectedParts);
		const withoutUnconnected = readNetlist(resistorDivider);
		expect({ ...withUnconnected, warnings: [] }).toEqual({
			...withoutUnconnected,
			warnings: [],
		});
		// Check that the unconnected components are indeed warned about honestly!
		expect(withUnconnected.warnings).toContainEqual({
			code: "unconnected-behavior-component",
			device: "R99",
			detail: expect.any(String),
		});
		expect(withUnconnected.warnings).toContainEqual({
			code: "unconnected-behavior-component",
			device: "EFFECT_FOOTSWITCH",
			detail: expect.any(String),
		});
	});

	it("binds both gangs of one knob to one control", () => {
		// A control names itself twice -- as `id`, and as the component name its
		// `audioBinding` points at -- and components reference whichever their author
		// had to hand. Matching only the id leaves both gangs unbound, and each
		// invents a control of its own: one physical knob becomes two that each move
		// half the circuit, which renders and sounds like a working pedal.
		const netlist = readNetlist(gangedRheostats);
		const gangs = netlist.devices.filter(
			(device) => device.kind === "rheostat",
		);
		expect(gangs).toHaveLength(2);
		expect(gangs.map((device) => device.control)).toEqual([
			"SAG_CTL",
			"SAG_CTL",
		]);
		expect(netlist.controls).toHaveLength(1);
		// The panel control states no taper; the gangs do. The declaration wins.
		expect(netlist.controls[0]?.taper).toBe("logarithmic");
	});

	it("resolves a port from the declared role, reached through the panel binding", () => {
		// Both jacks are typed `Circuit.Jack`, so no type-name table can answer this.
		// The roles are declared against panel-facing ids and the panel binds them to
		// the components, which is how most of the corpus states it.
		const netlist = readNetlist(jacksTypedOnlyByRole);
		const bare = readNetlist(resistorDivider);
		expect(netlist.ports.input).toBe(bare.ports.input);
		expect(netlist.ports.output).toBe(bare.ports.output);
	});

	it("does not mistake a dry send for the output", () => {
		// `direct-output` is declared first and shares the input node. Choosing by
		// position, or treating every output-ish jack alike, takes it and the pedal
		// renders its own input back.
		const netlist = readNetlist(jacksTypedOnlyByRole);
		expect(netlist.ports.output).not.toBe(netlist.ports.input);
	});

	it("honors explicitly requested input and output jacks", () => {
		const directOut = readNetlist(jacksTypedOnlyByRole, {
			outputJack: "JDIRECT",
		});
		// Direct out shares the input node:
		expect(directOut.ports.output).toBe(directOut.ports.input);

		expect(() =>
			readNetlist(jacksTypedOnlyByRole, { inputJack: "NONEXISTENT" }),
		).toThrow(NetlistError);
	});

	it("reads a structured quantity in the unit it was stated in", () => {
		const kilohms = readNetlist(kilohmStructuredValue);
		const resistor = kilohms.devices.find(
			(device) => device.kind === "resistor",
		);
		expect(resistor?.parameters.ohms).toBe(10_000);

		// Notation this stage cannot read, already resolved in base units.
		const taper = readNetlist(taperCodeStructuredValue);
		const resolved = taper.devices.find((device) => device.kind === "resistor");
		expect(resolved?.parameters.ohms).toBe(50_000);

		// Unreadable notation and a unit this stage will not scale: refuse.
		expect(() => readNetlist(unreadableNonBaseUnit)).toThrow(NetlistError);
	});
});

describe("an amp's output port behind an impedance selector", () => {
	// `orange-gro100` is the corpus case and it was the only one in 142 documents. Its
	// `J_SPEAKER` sits on node 79 and its `S_SPEAKER_IMPEDANCE` joins that to the output
	// transformer's 76/77/78 taps, so the "after the transformer" test -- which required the
	// jack to be *on* a winding node -- missed it. The port then fell through to `Output`, a jack
	// whose own `SourceBoundaryRole` reads "tone-stack output-amp handoff label", and the amp
	// rendered its tone stack: 35 V of speaker swing replaced by 3 V of preamp node, with no
	// transformer bounding it so the file clipped 10,991 samples of 96,000.

	it("takes the speaker jack a selector hop from the winding, over a nearer monitor tap", () => {
		const netlist = readNetlist(speakerBehindSelector);
		const chosen = netlist.devices.find(
			(device) =>
				device.kind === "jack" && device.nodes.includes(netlist.ports.output),
		);
		expect(chosen?.id).toBe("J_SPEAKER");
	});

	it("does not carry the label across an unrelated switch chain", () => {
		// The negative control for the hop budget. A switch that touches no winding must not put
		// its jack on the speaker side, or every contact in an amp would qualify.
		const detached = derive(
			speakerBehindSelector,
			`      - name: throw_16
        role: throw
        node: 3`,
			`      - name: throw_16
        role: throw
        node: 9`,
		);
		const netlist = readNetlist(detached);
		const chosen = netlist.devices.find(
			(device) =>
				device.kind === "jack" && device.nodes.includes(netlist.ports.output),
		);
		expect(chosen?.id).not.toBe("J_SPEAKER");
	});
});

describe("transformer per-winding voltages", () => {
	// A transformer the source specifies by its coil voltages carries each coil's own voltage,
	// the third and last precedence rung after a declared `Ratio` and a rated impedance pair. It
	// carries no ratio and asks for no primary voltage.
	//
	// The voltages live on `identity.declaredWindings`, not in `parameters`. A flat parameter map
	// had to key them by winding class, and a class holds one value -- which is how
	// `orange-rockerverb`'s two filament coils became a single `voltsFilament` and its
	// 3.15-0-3.15 V winding was driven at 6 V per half.
	const coils = (source: string) => {
		const transformer = readNetlist(source).devices.find(
			(device) => device.kind === "transformer",
		);
		return {
			transformer,
			volts: (transformer?.identity.declaredWindings ?? []).map(
				(winding) => winding.voltageRmsVolts,
			),
		};
	};

	it("reads an untapped coil's own voltage, and no longer reads a primary voltage", () => {
		const { transformer, volts } = coils(twoWindingVoltageDerivedTransformer);
		expect(volts).toContain(twoWindingVoltageDerivedRms);
		// No ratio of any kind, and the fixture's typed `PrimaryVoltage: 120` reaches nothing --
		// the negative control for the claim that the primary side dropped out. A ratio here
		// would mean the old primary-over-secondary derivation is still live.
		expect(transformer?.parameters.ratio).toBeUndefined();
		// And nothing lands in `parameters` under a winding-class key any more.
		expect(
			Object.keys(transformer?.parameters ?? {}).filter((key) =>
				key.startsWith("volts"),
			),
		).toEqual([]);
	});

	it("reads a centre-tapped coil's voltage as stated, per half", () => {
		// This stage does not know or care that the coil is centre-tapped; how the stated voltage
		// is applied to each half belongs to `transformerWindings`.
		expect(coils(centerTappedVoltageDerivedTransformer).volts).toContain(
			centerTappedVoltageDerivedRmsPerHalf,
		);
	});

	it("reads three different coil voltages off one core", () => {
		const { volts } = coils(powerTransformerVoltageDerived);
		expect(volts).toContain(powerTransformerHvRmsPerHalf);
		expect(volts).toContain(powerTransformerRectifierHeaterRms);
		expect(volts).toContain(powerTransformerFilamentRms);
		// Three coils stating a voltage, and each keeps its own -- the property this could not
		// have when they shared a class-keyed parameter map.
		expect(volts.filter((value) => value !== null)).toHaveLength(3);
	});

	it("refuses a typed winding voltage left on the component, where no coil claims it", () => {
		// `ScreenSecondary` is typed exactly like a coil voltage and names a winding this document
		// declares no terminals for -- `mesa-boogie-dual-rectifier`'s real shape. The previous
		// rung asked whether the *spelling* was one of eight it recognised, which could not see
		// this case at all: a recognised spelling with no coil was silently discarded. The
		// question now is whether any coil claims the value.
		expect(() => readNetlist(transformerUnlistedWindingSpelling)).toThrow(
			NetlistError,
		);
		try {
			readNetlist(transformerUnlistedWindingSpelling);
			throw new Error("expected a NetlistError");
		} catch (error) {
			expect(error).toBeInstanceOf(NetlistError);
			expect((error as Error).message).toContain("ScreenSecondary");
			expect((error as Error).message).toContain("belongs to the coil");
		}
	});

	it("resolves a terminal tapped in the middle of a wire, at any angle", () => {
		// The tap is a T-junction, so it is seen only through the point-on-segment test,
		// never through an endpoint union. The two fixtures are the same circuit with the
		// bus drawn diagonally and horizontally; the angle must not change the netlist.
		// Before diagonal segments were recognised, the diagonal tap was dropped and the
		// document refused, so this is the check that fails when that regression returns.
		const shapeUpToRelabeling = (
			netlist: ReturnType<typeof readNetlist>,
		): string => {
			const anchors = new Map<number, string>([
				[GROUND, "ground"],
				[netlist.ports.input, "in"],
				[netlist.ports.output, "out"],
			]);
			const label = (node: number): string => {
				const anchor = anchors.get(node);
				if (anchor === undefined) {
					throw new Error(`fixture has an unanchored node: ${node}`);
				}
				return anchor;
			};
			return netlist.devices
				.map(
					(device) =>
						`${device.kind}:${JSON.stringify(
							device.parameters,
						)}:${device.nodes.map(label).join("-")}`,
				)
				.sort()
				.join(";");
		};

		const diagonal = readNetlist(wireDiagonal);
		const aligned = readNetlist(wireAxisAligned);
		// Both drawings resolve the tap to the input node and ground; the diagonal one
		// used to refuse outright, so reaching this line is itself the negative control.
		expect(diagonal.ports.input).toBe(aligned.ports.input);
		expect(shapeUpToRelabeling(diagonal)).toEqual(shapeUpToRelabeling(aligned));
	});
});

describe("parseQuantity", () => {
	it("converts engineering notation to SI base units", () => {
		expect(parseQuantity("10k")).toBe(10_000);
		expect(parseQuantity("10n")).toBeCloseTo(1e-8, 20);
		expect(parseQuantity("1meg")).toBe(1e6);
		expect(parseQuantity("2.2")).toBeCloseTo(2.2, 10);
		expect(parseQuantity("470pF")).toBeCloseTo(4.7e-10, 20);
	});

	it("reads R-notation, where the multiplier letter is the decimal point", () => {
		expect(parseQuantity("4u7")).toBeCloseTo(4.7e-6, 12);
		expect(parseQuantity("4k7")).toBeCloseTo(4700, 8);
		expect(parseQuantity("2R2")).toBeCloseTo(2.2, 10);
	});

	it("throws rather than guessing", () => {
		expect(() => parseQuantity("about ten")).toThrow();
		expect(() => parseQuantity("")).toThrow();
	});
});
