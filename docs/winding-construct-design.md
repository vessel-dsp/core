# The `windings` construct

Sibling to [`devices`](./device-construct-design.md), and the same defect in a different shape.

## The problem in one sentence

A transformer's terminals belong to **coupled coils**, the format never said which, and every
consumer had to guess the grouping back out of terminal spellings.

## The measurement

55 transformers in the corpus, 363 terminals, and downstream a 110-entry table keyed on folded
terminal spellings — `primaryplus`, `hvreda345vac`, `powertubeheatercenter0v`, `tankreturnhot` —
mapping each to a `{ winding, end }` pair. The table reconstructs 12 winding classes:

| class | terminals | class | terminals |
|---|---|---|---|
| `primary` | 70 | `bias` | 17 |
| `secondary` | 59 | `secondaryalt3` | 7 |
| `hv` | 54 | `secondaryalt2` | 5 |
| `filament` | 40 | `secondaryalt` | 4 |
| `rectifierheater` | 20 | `secondaryline` | 1 |
| `lowvoltage` | 18 | `shield` | 1 |

(55 transformers, 363 terminals, counted after two files using a quoted-scalar style were found
to have been skipped by the first pass — the same shape that hid a pedal from an earlier backfill.)

`secondaryalt`, `secondaryalt2`, `secondaryalt3` and `secondaryline` are not four kinds of
winding. They are the table's way of saying "another secondary", because a `Record<string, …>`
keyed on a spelling has nowhere to put two coils with the same role. That is the tell: the
grouping is data, and it was being encoded in an identifier.

Every corpus terminal is in that table, which is exactly the problem. It covers the corpus
because it was written *from* the corpus, one packet at a time — the file's own docstring records
thirteen entries added for one Mesa Boogie power transformer. A transformer nobody has transcribed
yet contributes a spelling the table does not have, and the refusal names a winding class rather
than the real fault, which is that the document never said what its coils are.

## The construct

```yaml
- id: T1
  kind: transformer
  terminals:
    - name: primary_a
      role: winding
    - name: primary_b
      role: winding
    - name: hv_a
      role: winding
    - name: hv_center_tap
      role: windingTap
    - name: hv_b
      role: winding
  windings:
    - role: primary
      terminals:
        - primary_a
        - primary_b
    - id: hv
      role: hv
      terminals:
        - hv_a
        - hv_center_tap
        - hv_b
```

### Three rules

1. **A winding lists its terminals in coil order.** First and last are the ends; anything between
   is physically between them. Order is the only thing that can state a tap's position, and it is
   what a spelling table cannot recover: `secondary_4`, `secondary_8`, `secondary_16` are ordered
   by their names only by luck, and `hv_center_tap` says "centre" in prose.
2. **End versus tap comes from the terminal's own `role`,** which core already carries: `winding`
   for an end, `windingTap` or `windingCenterTap` for a tap. A winding entry therefore needs no
   per-terminal metadata — `role` plus ordered `terminals` is the whole entry.

   The two tap roles are the one thing a consumer cannot work out. A **centre tap** is the point
   the coil is referenced at, and both halves are live at once — that is what makes a full-wave
   rectifier full-wave and a push-pull primary push-pull. An **output tap** is one of several
   alternatives, of which a selector makes one live. Three consumer-side tests were tried and each
   was wrong on one shape: a grounded end finds the reference on a speaker winding but an output
   transformer's primary can have ground as an *end*; "every node carries a load" reads
   `orange-rockerverb`'s tapped secondary as centre-tapped, because every node of it does; and
   both kinds sit in the middle of the list. So it is declared.
3. **No terminal belongs to two windings.** Coupled coils share no conductor. An autotransformer
   is one tapped winding, not two overlapping ones, so a shared terminal is an error rather than a
   shape to support.

### Roles may repeat

`orange-rockerverb`'s power transformer carries **two filament windings** — a 3.15-0-3.15 V pair
for the power tube heaters and a separate 6.3 V pair for the preamp. A record keyed on a role, or
on a terminal spelling, has nowhere to put the second; the spelling table collapsed both into one
`filament` class. Windings are distinguished by their terminals, and by an optional `id` when a
consumer or a reader wants to name one. This is also what deletes `secondaryalt3`.

### Ten roles

`primary`, `secondary`, `hv`, `filament`, `rectifier-heater`, `bias`, `low-voltage`, `auxiliary`,
`drive`, `pickup`.

The first eight are the corpus's classes with the `alt`/`line` suffixes folded away. `drive` and
`pickup` are for a spring reverb tank, where neither coil transforms the other's voltage: one
drives the springs and one picks up what comes back. The table calls the tank's coils `secondary`
and `secondaryalt`, which is exactly wrong about what it is — and a reverb tank is the one
`transformer`-kind component in the corpus that is not a transformer.

There is deliberately no `shield` role. `tycobrahe-octavia`'s T1 brings out a `shield_nc` pin, and
a shield is a grounded foil between windings rather than a coil, so `role: shield` on the terminal
is the whole statement and no winding entry couples it.

### Declaring nothing is a valid statement

Absent and empty mean the same thing — this component has no declared coils — so an empty list is
dropped on parse rather than carried, and nothing is emitted for the components that are not
transformers.

## Electrical ratings belong to the coil

A winding entry carries two optional typed quantities, and they have different shapes because they
are different kinds of fact.

### `voltage` — one per coil

```yaml
  - id: power_tube_heater
    role: filament
    terminals: [power_tube_heater_a, power_tube_heater_center, power_tube_heater_b]
    voltage:
      raw: "3.15-0-3.15 VAC source-visible"
      value: 3.15
      unit: "V"
```

**Across the pair a stamp uses**: per half where the coil declares a `windingCenterTap`, end to
end otherwise. That is how a transformer is printed — nobody rates a 330-0-330 V winding "660 V",
and `fender-5e3-deluxe-tweed`'s own `Derivation` property says its 330 "is the per-half voltage of
the stated center-tapped 330-0-330 winding". The centre tap being declared (0.6.36) is what makes
this a convention with no ambiguity rather than a guess.

It has to live on the coil because a component property keyed on a winding class holds one value
per class. `orange-rockerverb`'s power transformer states 3.15 V for its power-tube heater winding
and 6 V for its preamp heater winding, and had to invent `PowerTubeFilamentSecondary` and
`PreampHeaterSecondary` to say so — the quantity-side twin of `secondaryalt3`. A consumer keyed on
the class collapsed both into one value anyway, and drove the 3.15-0-3.15 winding at 6 V per half.

Across the corpus, 10 property spellings state per-winding quantities today:
`HighVoltageSecondary` (21), `FilamentSecondary` (16), `BiasSecondary` (14),
`RectifierHeaterSecondary` (11), `LowVoltageSecondary` (7), `HeaterSecondary` (3),
`PowerTubeFilamentSecondary` (1), `PreampHeaterSecondary` (1), plus `InputImpedance` (5) and
`OutputImpedance` (5), which are the reverb tanks' drive and pickup ratings under a second name.
All of them become one field on the coil that owns them.

### `impedances` — one per rated pair

```yaml
  - role: primary
    terminals: [primary_a_yellow, primary_ct_red, primary_b_brown]
    impedances:
      - across: [primary_a_yellow, primary_b_brown]
        impedance: { raw: "3.4 kΩ plate-to-plate", value: 3400, unit: "Ω" }
  - role: secondary
    terminals: [secondary_common_black, secondary_8_yellow, secondary_hot]
    impedances:
      - across: [secondary_common_black, secondary_8_yellow]
        impedance: { raw: "8 Ω", value: 8, unit: "Ω" }
      - across: [secondary_common_black, secondary_hot]
        impedance: { raw: "16 Ω", value: 16, unit: "Ω" }
```

**The pair is explicit because transformers are not rated by one convention.** A primary is
printed *plate-to-plate* — end to end, across its centre tap — while a speaker secondary is
printed *from its common* to each tap. Every `PrimaryImpedance` in the corpus reads "… plate-to-
plate"; every `SecondaryImpedance` is a tap value. A bare number per winding would need a
convention, and either convention is wrong for one of the two.

One coil can carry several ratings, which is the case a single number cannot express at all:
`orange-gro100`'s output transformer states four on one winding (100 V line, 15 Ω, 7.5 Ω, 3.75 Ω)
and `orange-rockerverb`'s states two that are *simultaneously loaded* — a 16 Ω jack and an 8 Ω
jack, each with its own feedback resistor. That last one is why this field exists: a consumer that
could see only one rating had to drop a wired speaker branch.

**No per-tap turns ratio is needed.** Between any two rated pairs on one core the turns ratio is
the square root of the impedance ratio, so `windingImpedanceAcross()` plus arithmetic answers
every question a lowering asks. `TurnsRatio` stays a component property: it is a relation between
coils, not a property of one.

## What connectivity still owns, and windings must not

The old table's `end` vocabulary contained two values that are not winding structure at all:

- **`unconnected`** — a tap this document wires to nothing. Six terminals. That is a fact about
  the nodes ledger, readable from it.
- **`selectable`** — a mains tap going into a voltage selector. Four table entries, none of them
  reached by any corpus document today. Which tap is live is a property of the selector switch,
  not of the transformer; the table's own comment records an earlier pass that hard-coded one
  packet's stated 240 V assumption as a rule for every document, which would have strapped 240 V
  across a US-market amp that spelled its taps the same way.

Both stay derived. A declaration that repeated them would let a document assert a connectivity
fact that contradicts its own wiring.

## Validation core owes

Errors: unknown role, a terminal name no terminal has, a terminal listed twice in one winding, the
same terminal claimed by two windings, an empty terminal list, a duplicate `id`.

On ratings: a pair naming a terminal that is **not on this winding** (the one worth catching — it
reads as a valid pair and silently rates the wrong coil), a pair naming one terminal twice, and a
non-positive impedance or voltage. A negative voltage would state a phase the declaration cannot
carry; a non-positive impedance is a turns ratio nothing can be derived from.

Warnings: a single-terminal winding (real — a bias tap whose return is grounded inside the
transformer — but usually a transcription that stopped early), and a terminal with a winding role
that no winding couples.

Across the backfilled corpus that is 11 warnings and no errors. All 11 are single-ended `bias`
windings, which is the legitimate case the warning names.

## What it deletes downstream

In `vessel-dsp/workbench`, `src/compiler/transformer.ts`'s 110-entry `transformerTerminalRoles`
table and the winding-class reconstruction around it, plus `lower.ts`'s `springReverbTerminalRoles`
— the last remaining terminal-spelling vocabulary in that file. Both deleted 2026-09-03.

The ratings delete three more: `netlist.ts`'s `secondaryWindingVoltageProperties` (8 property
spellings folding to 5 winding classes, and the refusal that guards its `*Secondary` suffix),
`device-laws.ts`'s `windingVoltageParameters` (5 entries), and `transformer.ts`'s
`HEATER_CLASS_WINDINGS` (5 entries, which exists only to excuse a winding whose voltage the class
map could not carry).

## Open questions

1. **Winding polarity.** Coil order gives each winding an orientation, but nothing states the
   relative phase *between* two windings — the dot convention. No corpus document depends on it,
   and inverting a speaker winding is inaudible in a single-transformer signal path.
2. **Switch poles.** 232 contact spellings are waiting on the same shape: one mechanism, several
   grouped contacts. A pole is closer to a winding than to a device.
