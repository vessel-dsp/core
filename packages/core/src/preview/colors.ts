import type { ComponentKind } from "../model/types";

const KIND_COLOR: Readonly<Record<ComponentKind, string>> = {
	resistor: "#3b82f6",
	capacitor: "#3b82f6",
	inductor: "#3b82f6",
	potentiometer: "#3b82f6",
	"variable-resistor": "#3b82f6",
	transformer: "#14b8a6",
	diode: "#ef4444",
	led: "#ef4444",
	display: "#06b6d4",
	bjt: "#ef4444",
	jfet: "#ef4444",
	mosfet: "#ef4444",
	opamp: "#14b8a6",
	ota: "#14b8a6",
	optocoupler: "#14b8a6",
	bbd: "#14b8a6",
	"delay-ic": "#14b8a6",
	"power-amp": "#14b8a6",
	regulator: "#f97316",
	"power-converter": "#f97316",
	"analog-switch": "#eab308",
	flipflop: "#a855f7",
	ic: "#14b8a6",
	triode: "#a855f7",
	pentode: "#a855f7",
	"tube-diode": "#a855f7",
	"voltage-source": "#f97316",
	"current-source": "#f97316",
	battery: "#f97316",
	rail: "#f97316",
	ground: "#64748b",
	switch: "#eab308",
	// A protective conductor, drawn with the passives it behaves as while intact.
	fuse: "#3b82f6",
	// A logic gate, drawn with the active devices it is built from.
	inverter: "#8b5cf6",
	jack: "#ec4899",
	label: "#64748b",
	"named-wire": "#64748b",
	port: "#64748b",
	unsupported: "#94a3b8",
};

export function colorForKind(kind: ComponentKind): string {
	return KIND_COLOR[kind];
}
