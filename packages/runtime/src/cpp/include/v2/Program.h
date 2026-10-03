#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <optional>
#include <unordered_map>

namespace vessel_dsp::v2 {

using NodeId = int32_t;
using ControlId = std::string;

enum class TaperKind {
    Linear,
    Logarithmic,
    AntiLogarithmic,
    ReverseLinear
};

enum class StampKind {
    Conductance,
    ControlledConductance,
    ControlledResistance,
    Optocoupler,
    Capacitor,
    Inductor,
    Diode,
    Switch,
    Selector,
    LogicDivider,
    AnalogSwitch,
    DcSource,
    AcSource,
    Bjt,
    Triode,
    Pentode,
    Fet,
    TubeDiode,
    Transformer,
    InputSource,
    IdealOpAmp,
    Vccs,
    Ota,
    Compandor,
    LinearVca,
    ClockDriver,
    Comparator,
    SpringReverb,
    MacroAudioSource,
    Unknown
};

struct Stamp {
    StampKind kind = StampKind::Unknown;
    std::string kindStr;

    // Terminals / Nodes
    NodeId node = -1;
    NodeId a = -1;
    NodeId b = -1;
    NodeId positive = -1;
    NodeId negative = -1;
    NodeId anode = -1;
    NodeId cathode = -1;
    NodeId base = -1;
    NodeId collector = -1;
    NodeId emitter = -1;
    NodeId gate = -1;
    NodeId drain = -1;
    NodeId source = -1;
    NodeId grid = -1;
    NodeId plate = -1;
    NodeId screen = -1;
    NodeId plus = -1;
    NodeId minus = -1;
    NodeId output = -1;
    NodeId common = -1;
    NodeId throwNode = -1;
    std::vector<NodeId> throwsList;
    NodeId primaryPlus = -1;
    NodeId primaryMinus = -1;
    NodeId secondaryPlus = -1;
    NodeId secondaryMinus = -1;
    NodeId inP = -1;
    NodeId inN = -1;
    NodeId outP = -1;
    NodeId outN = -1;
    NodeId bias = -1;
    NodeId vee = -1;
    NodeId vdd = -1;
    NodeId vss = -1;
    NodeId clockNode = -1;
    NodeId qNode = -1;
    NodeId gndNode = -1;
    NodeId cp1 = -1;
    NodeId cp2 = -1;
    NodeId vgg = -1;
    NodeId ox1 = -1;
    // The clock driver's own GND pin, distinct from `gndNode` (the logic divider's). Not circuit
    // ground: the MN3101/MN3102 run on a negative supply, so a +9 V pedal puts this on the rail.
    NodeId gnd = -1;
    NodeId controlNode = -1;
    NodeId ledAnode = -1;
    NodeId ledCathode = -1;
    NodeId ldrA = -1;
    NodeId ldrB = -1;
    NodeId rectIn = -1;
    NodeId gainCellInNode = -1;
    NodeId rectCap = -1;
    NodeId cellIn = -1;
    NodeId sumNode = -1;
    NodeId vref = -1;
    NodeId clk1 = -1;
    NodeId clk2 = -1;
    NodeId input = -1;
    NodeId out1 = -1;
    NodeId out2 = -1;
    NodeId inputPlus = -1;
    NodeId inputMinus = -1;
    NodeId outputPlus = -1;
    NodeId outputMinus = -1;

    // Auxiliary / State Indices
    int32_t sourceIndex = -1;
    int32_t stateIndex = -1;
    int32_t throwIndex = 0;
    int32_t throwCount = 1;

    // Controls & Tapers
    ControlId control;
    int32_t controlIndex = -1;
    TaperKind taper = TaperKind::Linear;
    std::string side; // "upper" | "lower"
    std::string macroId;

    // Numeric Parameters
    double siemens = 0.0;
    double totalOhms = 0.0;
    double minOhms = 0.0;
    // A pot's declared end resistance. 0 is an ideal pot whose leg reaches zero, and is
    // the default so a program emitted before this field keeps the previous behaviour.
    double residualOhms = 0.0;
    double maxOhms = 0.0;
    double onOhms = 0.0;
    double offOhms = 0.0;
    double sourceOhms = 0.0;
    double farads = 0.0;
    double henries = 0.0;
    double volts = 0.0;
    double amplitudeVolts = 0.0;
    double frequencyHz = 0.0;
    double saturationCurrent = 1e-14;
    double emissionCoefficient = 1.0;
    double thermalVoltage = 0.026;
    double breakdownVolts = 0.0;
    double seriesResistance = 0.05;
    double forwardBeta = 100.0;
    double reverseBeta = 1.0;
    double leakageAmps = 0.0;
    double thresholdVolts = 2.5;
    double transconductance = 0.001;
    double channelLengthModulation = 0.0;
    // JFET subthreshold slope (natural-log volts); 0 keeps the legacy hard cutoff
    // and is the correct value for MOSFETs. Default 0 so programs predating the
    // field behave exactly as before.
    double subthresholdVolts = 0.0;
    // JFET gate-source junction, mirroring the triode's grid below. 0 disables it and is
    // the correct value for a MOSFET's insulated gate; the default is 0 so a program that
    // predates these fields keeps the old free-gate behaviour rather than inventing one.
    double gateSaturationCurrent = 0.0;
    double gateOnsetVolts = 0.5;
    double gateScaleVolts = 0.06;
    double mu = 100.0;
    double kg1 = 1000.0;
    double kp = 500.0;
    double kvb = 300.0;
    double ex = 1.5;
    double gridSaturationCurrent = 1e-6;
    double gridOnsetVolts = 0.0;
    double gridScaleVolts = 0.1;
    double contactPotentialVolts = 0.0;
    double screenShare = 0.0;
    double perveance = 0.001;
    double exponent = 1.5;
    double turnsRatio = 1.0;
    double openLoopGain = 100000.0;
    std::optional<double> railHigh;
    std::optional<double> railLow;
    double biasVolts = 0.0;
    double highVolts = 5.0;
    double defaultFrequency = 50000.0;
    double ledThresholdVolts = 1.8;
    double ledTransconductance = 0.01;
    double ldrMinOhms = 100.0;
    double ldrMaxOhms = 1e6;
    // Part-specific LED-current -> LDR-resistance curve, ohms = coefficient * amps^exponent,
    // clamped to [ldrMinOhms, ldrMaxOhms]. Both present together or both absent; absent keeps
    // the generic exponential law (see Engine.cpp's optocoupler stamp) bit-identical. Mirrors
    // `ldrPowerLawCoefficientOhms`/`ldrPowerLawExponent` in src/compiler/types.ts.
    std::optional<double> ldrPowerLawCoefficientOhms;
    std::optional<double> ldrPowerLawExponent;
    double r1 = 10000.0;
    double r2 = 10000.0;
    double r5 = 10000.0;
    double iBias = 140e-6;
    // Linear-control VCA cell (M5207L01): input conductance, control-volts
    // for unity gain, gain floor. Mirrors `inputSiemens`/`vrefVolts`/`minGain`
    // in src/compiler/types.ts; defaults keep older programs behavior-neutral
    // (a program predating these fields carries no linear-vca stamp anyway).
    double inputSiemens = 0.0;
    double vrefVolts = 1.0;
    double minGain = 0.0;
    double vggBiasVolts = 0.0;
    int32_t stages = 1024;
    double sensitivity = 1.0;
    double pullDownOhms = 100.0;
    double floatOhms = 1e6;
    double inputOhms = 600.0;
    double outputOhms = 600.0;
    double delaySeconds = 0.035;
    double decaySeconds = 2.75;
    int32_t dispersionStages = 3;

    std::string polarity; // "npn" | "pnp"
    std::string channel;  // "n" | "p"
};

struct StampPartition {
    std::vector<int32_t> portRows;
    std::vector<int32_t> linearStampIndices;
    std::vector<int32_t> nonlinearStampIndices;
    std::vector<int32_t> constantStampIndices;
    std::vector<int32_t> controlStampIndices;
    std::vector<int32_t> dynamicStampIndices;
};

struct SparseOp {
    int32_t op = 0;
    int32_t a = 0;
    int32_t b = 0;
    int32_t c = 0;
};

struct SparseSchedule {
    std::vector<int32_t> ops;
    std::vector<SparseOp> structuredOps;
    int32_t slots = 0;
    int32_t factorCount = 0;
    std::vector<int32_t> gatherRow;
    std::vector<int32_t> gatherColumn;
    std::vector<int32_t> gatherOffsets;
    int32_t size = 0;
    int32_t sparseOps = 0;
    int32_t denseOps = 0;
    int32_t unprovenPivots = 0;
};

struct OperatingPointSeed {
    NodeId node = -1;
    double initialVolts = 0.0;
};

enum class BlockKind {
    Mna,
    Composed
};

/** A closed-vocabulary DSP primitive op (board-p3 row 4). */
struct PrimitiveOp {
    enum class Op {
        DelayTap,
        DelayTapFractional,
        DelayTapReverse,
        HoldLoop,
        DelayPush,
        Mix,
        FilterDcblock,
        Comb,
        Allpass,
        PitchShift,
        PitchTracker
    };
    enum class LengthMode {
        Capacity,
        Clock,
        Modulation,
        ClockLaw,
        Parameter
    };
    struct Source {
        enum class Kind { Input, Const, Temp };
        Kind kind = Kind::Input;
        double value = 0.0;
        int32_t temp = 0;
    };
    struct Term {
        Source source;
        double gain = 0.0;
        /**
         * A knob sweeping this gain, read by position through its taper:
         * `min + fraction * (max - min)`, and `gain` unused. Absent is a fixed gain.
         */
        bool swept = false;
        std::string sweepControl;
        double sweepMin = 0.0;
        double sweepMax = 0.0;
    };

    Op op = Op::DelayTap;
    std::string line;
    LengthMode length = LengthMode::Capacity;
    Source input;
    std::vector<Term> terms;
    int32_t out = 0;
    int32_t index = 0;
    double decaySeconds = 0.0;
    double ratio = 1.0;
    /** Open-OX2 law constants carried by a `clock-law` length mode. */
    double clockLawROhms = 0.0;
    double clockLawCFarads = 0.0;
    double clockLawVddVolts = 0.0;
    double clockLawVthVolts = 0.0;
    double clockLawVfVolts = 0.0;
    double clockLawFloorVolts = 0.0;
    double clockLawStages = 0.0;
    /** `hold-loop`'s pedal, read like a swept gain; on at 0.5 or above. */
    std::string gateControl;
    double gateMin = 0.0;
    double gateMax = 1.0;
};

/**
 * One selectable program: the ops, the temporary the block publishes, and the delay
 * lines those ops address.
 *
 * Lines are per position because two modes need not share a buffer. Prepare
 * allocates every position's state, so selecting is an index change and never an
 * allocation -- switching modes on the audio thread must not touch the heap.
 */
struct ComposedPosition {
    std::string id;
    std::vector<PrimitiveOp> ops;
    int32_t out = 0;
    std::unordered_map<std::string, double> lineDelaySeconds;
    /**
     * Each line's cited floor: the shortest delay a `parameter` read may produce, so a
     * control sweeps min..max rather than 0..max. 0 reproduces the old reading exactly.
     */
    std::unordered_map<std::string, double> lineMinSeconds;
    /**
     * A line's own control, read directly (per line: a DD-5's DELAY and TEMPO positions read
     * different controls). `tapped` reads the interval between the control's last two presses
     * times `ratio`; otherwise `scanned`, the control's position through its taper.
     */
    struct LineSweep {
        std::string controlId;
        bool tapped = false;
        double ratio = 1.0;
    };
    std::unordered_map<std::string, LineSweep> lineSweep;
};

struct AudioInPort {
    std::string block;
    NodeId node = -1;
};

struct ParameterPort {
    std::string block;
    NodeId node = -1;
    double referenceVolts = 0.0;
};

/**
 * The pin that selects which program a composed block runs.
 *
 * Deliberately the same shape and the same reading as `ParameterPort`: one
 * mechanism for "a solved node voltage drives this block", used twice. A knob does
 * not reach the runtime, a pin does -- the panel control is wired to the chip
 * through the circuit, so the mode arrives as a node voltage the MNA already
 * solves.
 *
 * The fraction is `|volts| / referenceVolts` spread across the position count and
 * clamped, so a pin at or below 0 V selects the first program and one at or above
 * the reference selects the last.
 */
struct SelectorPort {
    std::string block;
    NodeId node = -1;
    double referenceVolts = 0.0;
};

/**
 * The router that turns a control's position into a running program.
 *
 * Models the thing that exists. On a DD-5 the MODE knob is an 11-detent pot whose
 * wiper reaches the CPU's analog input; the CPU quantizes that voltage and tells the
 * DSP which program to run. The CPU is a router.
 *
 * `routes` is dense and `positions` long: routes[detent] indexes `positions` on the
 * block, or -1 where the source declares no program for that detent. Dense so a
 * lookup is an array index rather than a search, because this runs every sample.
 */
struct ComposedRouter {
    /** The panel control this router reads. */
    std::string controlId;
    /**
     * The node carrying the selection, or absent where the control is **scanned** and the
     * engine reads its position directly.
     *
     * A node is the stronger claim and the default. Absent is for a control whose path to
     * the chip no source resolves: modelling that transport would be precision about the
     * wrong thing, since firmware quantizes the voltage by rules no dump exists for.
     */
    std::optional<SelectorPort> port;
    int32_t positions = 0;
    std::vector<int32_t> routes;
};

/**
 * The signal-rate `modulation` port (plan M3, mirrored in M4).
 *
 * The TS reference runtime reads this node every sample and scales the delay
 * length by `Vdc / V`; this console mirrors that branch exactly.
 */
struct ModulationPort {
    std::string block;
    NodeId node = -1;
    std::string steeredBy;
};

/**
 * The signal-rate `clock-law` port (CE-2 open-OX2 law, 2026-09-28).
 *
 * The slow diode's anode-side divider node, read every sample by a
 * `clock-law` length mode evaluating the relaxation equation. `steeredBy`
 * names the discharge transistor, for diagnostics.
 */
struct ClockLawPort {
    std::string block;
    NodeId node = -1;
    std::string steeredBy;
};

struct MacroClockControl {
    ControlId controlId;
    TaperKind taper = TaperKind::Linear;
    double ohmsAtControlMin = 0.0;
    double ohmsAtControlMax = 0.0;
    double farads = 0.0;
    double stages = 0.0;
    double formulaConstant = 0.0;
    double offsetSeconds = 0.0;
};

struct Block {
    BlockKind kind = BlockKind::Mna;
    std::string id;

    // MNA block fields
    int32_t nodeCount = 0;
    std::vector<NodeId> nodeIds;
    int32_t auxCount = 0;
    std::vector<Stamp> stamps;
    StampPartition stampPartition;
    std::optional<SparseSchedule> sparseSchedule;
    int32_t stateCount = 0;
    bool linear = false;
    bool controlFree = false;
    bool eliminate = false;
    std::optional<NodeId> inputNode;
    std::optional<NodeId> outputNode;
    std::vector<OperatingPointSeed> operatingPointSeeds;

    // Macro block fields
    std::string modelId;
    std::vector<std::string> inputs;
    std::vector<std::string> outputs;
    std::vector<std::string> controls;
    std::unordered_map<std::string, double> parameters;
    std::optional<AudioInPort> audioIn;
    bool audioOut = false;
    std::optional<ParameterPort> parameter;
    std::optional<ModulationPort> modulation;
    std::optional<ClockLawPort> clockLaw;
    std::optional<MacroClockControl> clockControl;

    // Composed block fields (board-p3 row 4): a data-driven primitive graph
    // executing under `modelId`, which still names the algorithm for
    // admission pricing and traceability.
    //
    // A composition carries one program per selectable position. A part that does
    // one thing has exactly one; a reprogrammable chip has one per mode, and
    // `selector` names the pin that chooses. This replaced a single ops/out/lines
    // triple on the block -- the single-program case is this one with size 1, not a
    // different shape.
    std::vector<ComposedPosition> positions;
    std::optional<ComposedRouter> router;
};

struct Control {
    ControlId id;
    TaperKind taper = TaperKind::Linear;
    double defaultPosition = 0.5;
    std::optional<std::string> role;
    /** Derived by the compiler: a contact a chip times by its presses. */
    bool momentary = false;
    /** A controller latch: the control whose rising edge flips it. Empty for a panel control. */
    std::string latchToggledBy;
    /** The tap law this control's presses are read with (core 0.16.0); presses 0 means none. */
    int32_t tapPresses = 0;
    double tapTimeoutSeconds = 0.0;
    double tapDefaultSeconds = -1.0;
};

struct Ports {
    NodeId input = -1;
    NodeId output = -1;
};

struct CostPredictors {
    int32_t executedBlockCount = 0;
    int32_t stateCount = 0;
    struct SolvedBlock {
        std::string blockId;
        int32_t unknownCount = 0;
        bool linear = false;
    };
    std::vector<SolvedBlock> solvedBlocks;
    struct MacroBlock {
        std::string blockId;
        std::string modelId;
    };
    std::vector<MacroBlock> macroBlocks;
};

struct Program {
    int32_t formatVersion = 6;
    std::vector<std::string> requiredOperators;
    std::vector<std::string> requiredModels;
    CostPredictors costPredictors;
    std::vector<Block> blocks;
    std::vector<std::string> order;
    std::vector<Control> controls;
    Ports ports;
    std::string supplyReference;
    struct PortFullScaleVolts {
        std::optional<double> input;
        std::optional<double> output;
    } portFullScaleVolts;
    std::string stageCoverage;
    struct PortImpedanceOhms {
        std::optional<double> input;
        std::optional<double> output;
    } portImpedanceOhms;
};

} // namespace vessel_dsp::v2
