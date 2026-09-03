# The `devices` construct

**Status:** design, not implemented. Written 2026-09-03 against the 26,016-terminal survey.

## The problem in one sentence

A component models a schematic **symbol** — a physical package, which may contain several
devices — while every consumer needs **devices**, so each consumer reconstructs the split by
parsing terminal names.

A netlist never has this problem. SPICE has no packages, only elements, and each element carries
its own complete positional node list:

```spice
Q1 nc nb ne QMODEL          * one BJT: position is the role
Bt1 plate_a cathode I={...}  * a dual rectifier is two lines,
Bt2 plate_b cathode I={...}  * not one component with two plates
```

## What the corpus actually contains

Every one of these is a single `.vdsp` component today:

| case | devices inside | shared terminals | derivable from roles alone? |
| --- | ---: | --- | --- |
| dual tube rectifier (`V3_5Y3GT`) | 2 diodes | the cathode, the heater | yes — 2 plates, 1 cathode |
| bridge rectifier | 4 diodes | both AC legs, both DC rails | yes — from the AC/DC role shape |
| bi-colour LED | 2 LEDs | the cathode | yes |
| **dual op-amp (`boss-dm-3` `IC1`)** | **2 op-amps** | both supply pins | **no** |
| optocoupler | 1 LED + 1 photoresistor | none | yes, by differing kinds |
| quad transistor array (`MPQ3906`) | 4 BJTs | nothing | no |
| **`boss-ce-1` clock bridge** | **4 BJTs + 5 diodes** | several internal nodes | **no** |

The two bold rows are why the construct is needed. A dual op-amp declares two of every signal
role, and **nothing in the roles says which output belongs with which input pair**. That is the
`boss-dm-3` defect found on 2026-09-03: the compiler guessed, put both inputs on one node, and
drove a bias rail.

## The construct

```yaml
- id: IC1
  kind: opamp                    # the package's primary kind
  terminals:
    - { name: out_a,   role: output,       node: 4 }
    - { name: in_a_neg, role: inverting,   node: 4 }
    - { name: in_a_pos, role: nonInverting, node: 10 }
    - { name: v_neg,   role: supplyNegative, node: 0 }
    - { name: in_b_pos, role: nonInverting, node: 10 }
    - { name: in_b_neg, role: inverting,   node: 8 }
    - { name: out_b,   role: output,       node: 8 }
    - { name: v_pos,   role: supplyPositive, node: 9 }
  devices:
    - id: A
      terminals: [out_a, in_a_neg, in_a_pos, v_pos, v_neg]   # shown inline for brevity;
    - id: B                                                   # the format needs block form
      terminals: [out_b, in_b_neg, in_b_pos, v_pos, v_neg]    # -- see the note below
```

**A note on YAML shape.** The interchange format parses a deliberate *subset* of YAML in which the
only flow collections are the empty `[]` and `{}`. A device's terminal list is therefore written in
block form; the inline lists in this document are shorthand for readability, not valid source:

```yaml
  devices:
    - id: A
      terminals:
        - out_a
        - in_a_neg
        - in_a_pos
        - v_pos
        - v_neg
```

### Three rules, and that is the whole construct

1. **A device names its terminals by `name`.** Names are already unique within a component (the
   `nodes` ledger addresses pins as `<componentId>.<name>`, and core refuses duplicates), so a
   name is a sufficient reference. This is why no index is needed: `plate_a` and `plate_b` are
   distinguished by name, and *which device each serves* is stated here.
2. **A device binds by role among its own terminals.** The law does not read position or order.
   For device `A` above: one `output`, one `inverting`, one `nonInverting` — unambiguous, because
   the ambiguity was only ever across the whole package.
3. **A terminal may belong to several devices.** The cathode of a dual rectifier, the supply pins
   of a dual op-amp. Membership is many-to-many and needs no special case.

### `kind` per device, defaulting to the component's

An optocoupler holds an LED and a photoresistor — two different laws in one package — so `kind`
must be declarable per device:

```yaml
- id: PC1
  kind: optocoupler
  devices:
    - { id: LED, kind: led,               terminals: [anode, cathode] }
    - { id: LDR, kind: variable-resistor, terminals: [ldr_a, ldr_b] }
```

A device without `kind` inherits the component's. The component's `kind` therefore means "what
this package primarily is", which is also what makes it a useful catalog key.

### One device is the default, not a special case

`devices` omitted means exactly one device, of the component's `kind`, using all its terminals.
Every resistor, capacitor and single transistor in the corpus — the overwhelming majority — says
nothing. A format that made 8,462 resistors declare a device block would be worse, not stricter.

## Why `role` and `devices` are complementary, not redundant

- `role` answers **what is this pin** — `plate`, `inverting`, `gate`.
- `devices` answers **which pins form one device**.

Neither derives the other. Roles alone cannot split a dual op-amp; a device list alone cannot say
which of its terminals is the anode. The 0.6.27–0.6.29 releases delivered the first; this is the
second.

## Worked examples from the survey

**Dual rectifier** — the shared cathode and heater appear in both devices:

```yaml
- id: V3_5Y3GT
  kind: tube-diode
  terminals:
    - { name: plate_a, role: plate }
    - { name: plate_b, role: plate }
    - { name: cathode, role: cathode }
    - { name: heater_a, role: heater }
    - { name: heater_b, role: heater }
  devices:
    - { id: A, terminals: [plate_a, cathode, heater_a, heater_b] }
    - { id: B, terminals: [plate_b, cathode, heater_a, heater_b] }
```

**Bridge rectifier** — four junctions, each naming the pair it connects. Derivable from roles,
but declaring it removes the topology inference in the consumer entirely:

```yaml
  devices:
    - { id: D1, terminals: [ac_a, dc_pos] }
    - { id: D2, terminals: [ac_b, dc_pos] }
    - { id: D3, terminals: [dc_neg, ac_a] }
    - { id: D4, terminals: [dc_neg, ac_b] }
```

**A package whose internals are unresolved** — `boss-ce-1`'s clock bridge stands for four
transistors and five diodes, and the packet's own trace records that the C/B/E orientation is not
recoverable from the source. The construct lets the document say *how many devices are here*
while `role` absence says *which electrode each pin is, is unknown*:

```yaml
  devices:
    - { id: Q3, kind: bjt, terminals: [q3_base_r26_d01_side, q3_q5_left_clock_column, ...] }
    - { id: Q4, kind: bjt, terminals: [...] }
    # ... 7 more
```

That is strictly better than today, where the whole shell is stamped as one fictional BJT. It is
also honest: a device whose roles are missing is refused by the consumer with a reason, instead of
being modelled as something it is not.

## Validation core owes

| check | verdict |
| --- | --- |
| a device terminal names a terminal the component does not declare | error |
| duplicate device `id` within a component | error |
| a device `kind` outside `ComponentKind` | error |
| a terminal belonging to no device | warning — decorative or unwired |
| a device whose terminals cannot supply its kind's required roles | **consumer's** call, not core's |

The last row matters: how many `plate`s a law needs is the law's business. Core validates that the
declaration is well-formed and that roles are legal for the kind; it does not encode device laws.

## What this deliberately does not solve

1. **Transformer windings are a sibling construct, not a use of this one.** A transformer is *one*
   device whose terminals group into coupled coils. Modelling each winding as a device would claim
   they are independent, which is the opposite of what a transformer is. That needs `windings[]`,
   with per-tap metadata — 53 transformers carrying 107 distinct spellings are waiting on it.
2. **A missing device law.** `Q1_UJT` is one device; the problem is that no `ComponentKind` names
   a unijunction. Grouping does not help.
3. **Switch contacts.** 232 spellings naming what each contact connects to. A pole is closer to a
   winding than to a device: one mechanism, several grouped contacts.

## What it deletes downstream

In `vessel-dsp/workbench` the package→device reconstruction becomes a read instead of an
inference: `sectionDevices` and its registry-pinout bijection, `diodeJunctions`' topology table,
the multi-device-shell predicate added 2026-09-03, and the arity guards in the five terminal
resolvers. Those exist only because the split had to be guessed.

## Open questions

1. **Does a device need its own properties?** A dual op-amp's two sections share the part's
   open-loop gain, and a dual rectifier's junctions share perveance, so component-level properties
   suffice for everything in the survey. Add per-device properties only when a real packet needs
   asymmetric ones.
2. **Should `devices` be required for a package the catalog knows is multi-device?** The part
   catalog already knows an `NJM4558DD` has two sections. Core could refuse a single-device
   declaration of a known dual — stricter, and it needs the catalog inside core, which it is not
   today.
3. **Is `<componentId>.<deviceId>` worth making an addressable reference?** It mirrors pin
   addressing and would let a future construct point at one device. No consumer needs it yet.
