#include "v2/ProgramJson.h"
#include <cctype>
#include <charconv>
#include <cstdlib>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace vessel_dsp::v2 {

namespace {

enum class JsonType {
    Null,
    Boolean,
    Number,
    String,
    Array,
    Object
};

struct JsonValue {
    JsonType type = JsonType::Null;
    bool boolValue = false;
    double numberValue = 0.0;
    std::string stringValue;
    std::vector<JsonValue> arrayValue;
    std::unordered_map<std::string, JsonValue> objectValue;

    bool isNull() const { return type == JsonType::Null; }
    bool isBool() const { return type == JsonType::Boolean; }
    bool isNumber() const { return type == JsonType::Number; }
    bool isString() const { return type == JsonType::String; }
    bool isArray() const { return type == JsonType::Array; }
    bool isObject() const { return type == JsonType::Object; }

    const JsonValue* find(const std::string& key) const {
        if (type != JsonType::Object) return nullptr;
        auto it = objectValue.find(key);
        if (it != objectValue.end()) {
            return &it->second;
        }
        return nullptr;
    }

    double getDouble(const std::string& key, double defaultVal = 0.0) const {
        const auto* val = find(key);
        if (val && val->isNumber()) return val->numberValue;
        return defaultVal;
    }

    int32_t getInt(const std::string& key, int32_t defaultVal = 0) const {
        const auto* val = find(key);
        if (val && val->isNumber()) return static_cast<int32_t>(val->numberValue);
        return defaultVal;
    }

    bool getBool(const std::string& key, bool defaultVal = false) const {
        const auto* val = find(key);
        if (val && val->isBool()) return val->boolValue;
        return defaultVal;
    }

    std::string getString(const std::string& key, const std::string& defaultVal = "") const {
        const auto* val = find(key);
        if (val && val->isString()) return val->stringValue;
        return defaultVal;
    }

    std::optional<double> getOptionalDouble(const std::string& key) const {
        const auto* val = find(key);
        if (val && val->isNumber()) return val->numberValue;
        return std::nullopt;
    }

    std::optional<int32_t> getOptionalInt(const std::string& key) const {
        const auto* val = find(key);
        if (val && val->isNumber()) return static_cast<int32_t>(val->numberValue);
        return std::nullopt;
    }

    std::optional<std::string> getOptionalString(const std::string& key) const {
        const auto* val = find(key);
        if (val && val->isString()) return val->stringValue;
        return std::nullopt;
    }
};

class JsonParser {
public:
    explicit JsonParser(std::string_view src) : src_(src), pos_(0) {}

    JsonValue parse() {
        skipWhitespace();
        if (pos_ >= src_.size()) {
            throw std::runtime_error("Empty JSON input");
        }
        JsonValue val = parseValue();
        skipWhitespace();
        if (pos_ < src_.size()) {
            throw std::runtime_error("Trailing characters after JSON value");
        }
        return val;
    }

private:
    std::string_view src_;
    size_t pos_;

    void skipWhitespace() {
        while (pos_ < src_.size() && (src_[pos_] == ' ' || src_[pos_] == '\t' || src_[pos_] == '\r' || src_[pos_] == '\n')) {
            ++pos_;
        }
    }

    char peek() {
        skipWhitespace();
        if (pos_ >= src_.size()) return '\0';
        return src_[pos_];
    }

    char get() {
        skipWhitespace();
        if (pos_ >= src_.size()) throw std::runtime_error("Unexpected EOF");
        return src_[pos_++];
    }

    JsonValue parseValue() {
        skipWhitespace();
        if (pos_ >= src_.size()) throw std::runtime_error("Unexpected EOF");
        char c = src_[pos_];
        if (c == 'n') return parseNull();
        if (c == 't' || c == 'f') return parseBool();
        if (c == '"') return parseString();
        if (c == '[') return parseArray();
        if (c == '{') return parseObject();
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
        throw std::runtime_error(std::string("Unexpected character in JSON: '") + c + "'");
    }

    JsonValue parseNull() {
        if (src_.substr(pos_, 4) == "null") {
            pos_ += 4;
            JsonValue val;
            val.type = JsonType::Null;
            return val;
        }
        throw std::runtime_error("Invalid null literal");
    }

    JsonValue parseBool() {
        if (src_.substr(pos_, 4) == "true") {
            pos_ += 4;
            JsonValue val;
            val.type = JsonType::Boolean;
            val.boolValue = true;
            return val;
        }
        if (src_.substr(pos_, 5) == "false") {
            pos_ += 5;
            JsonValue val;
            val.type = JsonType::Boolean;
            val.boolValue = false;
            return val;
        }
        throw std::runtime_error("Invalid bool literal");
    }

    JsonValue parseNumber() {
        size_t start = pos_;
        if (pos_ < src_.size() && src_[pos_] == '-') ++pos_;
        while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        if (pos_ < src_.size() && src_[pos_] == '.') {
            ++pos_;
            while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        }
        if (pos_ < src_.size() && (src_[pos_] == 'e' || src_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < src_.size() && (src_[pos_] == '+' || src_[pos_] == '-')) ++pos_;
            while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        }
        std::string numStr(src_.substr(start, pos_ - start));
        char* end = nullptr;
        double d = std::strtod(numStr.c_str(), &end);
        JsonValue val;
        val.type = JsonType::Number;
        val.numberValue = d;
        return val;
    }

    JsonValue parseString() {
        if (get() != '"') throw std::runtime_error("Expected opening '\"'");
        std::string result;
        while (pos_ < src_.size()) {
            char c = src_[pos_++];
            if (c == '"') {
                JsonValue val;
                val.type = JsonType::String;
                val.stringValue = std::move(result);
                return val;
            }
            if (c == '\\') {
                if (pos_ >= src_.size()) throw std::runtime_error("Unterminated escape sequence");
                char esc = src_[pos_++];
                switch (esc) {
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    case '/': result += '/'; break;
                    case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break;
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case 'u': {
                        if (pos_ + 4 > src_.size()) throw std::runtime_error("Invalid unicode escape");
                        std::string hex(src_.substr(pos_, 4));
                        pos_ += 4;
                        uint32_t codepoint = static_cast<uint32_t>(std::strtoul(hex.c_str(), nullptr, 16));
                        if (codepoint < 0x80) {
                            result += static_cast<char>(codepoint);
                        } else if (codepoint < 0x800) {
                            result += static_cast<char>(0xC0 | (codepoint >> 6));
                            result += static_cast<char>(0x80 | (codepoint & 0x3F));
                        } else {
                            result += static_cast<char>(0xE0 | (codepoint >> 12));
                            result += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
                            result += static_cast<char>(0x80 | (codepoint & 0x3F));
                        }
                        break;
                    }
                    default: result += esc; break;
                }
            } else {
                result += c;
            }
        }
        throw std::runtime_error("Unterminated string");
    }

    JsonValue parseArray() {
        if (get() != '[') throw std::runtime_error("Expected opening '['");
        JsonValue val;
        val.type = JsonType::Array;
        skipWhitespace();
        if (peek() == ']') {
            get();
            return val;
        }
        while (true) {
            val.arrayValue.push_back(parseValue());
            skipWhitespace();
            char next = peek();
            if (next == ']') {
                get();
                break;
            }
            if (next == ',') {
                get();
                continue;
            }
            throw std::runtime_error(std::string("Expected ',' or ']', found '") + next + "'");
        }
        return val;
    }

    JsonValue parseObject() {
        if (get() != '{') throw std::runtime_error("Expected opening '{'");
        JsonValue val;
        val.type = JsonType::Object;
        skipWhitespace();
        if (peek() == '}') {
            get();
            return val;
        }
        while (true) {
            skipWhitespace();
            if (peek() != '"') throw std::runtime_error("Expected object string key");
            JsonValue keyVal = parseString();
            skipWhitespace();
            if (get() != ':') throw std::runtime_error("Expected ':' after object key");
            JsonValue itemVal = parseValue();
            val.objectValue.emplace(std::move(keyVal.stringValue), std::move(itemVal));
            skipWhitespace();
            char next = peek();
            if (next == '}') {
                get();
                break;
            }
            if (next == ',') {
                get();
                continue;
            }
            throw std::runtime_error(std::string("Expected ',' or '}', found '") + next + "'");
        }
        return val;
    }
};

StampKind parseStampKind(const std::string& s) {
    if (s == "conductance") return StampKind::Conductance;
    if (s == "controlled-conductance") return StampKind::ControlledConductance;
    if (s == "controlled-resistance") return StampKind::ControlledResistance;
    if (s == "optocoupler") return StampKind::Optocoupler;
    if (s == "capacitor") return StampKind::Capacitor;
    if (s == "inductor") return StampKind::Inductor;
    if (s == "diode") return StampKind::Diode;
    if (s == "switch") return StampKind::Switch;
    if (s == "selector") return StampKind::Selector;
    if (s == "logic-divider") return StampKind::LogicDivider;
    if (s == "analog-switch") return StampKind::AnalogSwitch;
    if (s == "dc-source") return StampKind::DcSource;
    if (s == "ac-source") return StampKind::AcSource;
    if (s == "bjt") return StampKind::Bjt;
    if (s == "triode") return StampKind::Triode;
    if (s == "pentode") return StampKind::Pentode;
    if (s == "fet") return StampKind::Fet;
    if (s == "tube-diode") return StampKind::TubeDiode;
    if (s == "transformer") return StampKind::Transformer;
    if (s == "input-source") return StampKind::InputSource;
    if (s == "ideal-opamp") return StampKind::IdealOpAmp;
    if (s == "vccs") return StampKind::Vccs;
    if (s == "ota") return StampKind::Ota;
    if (s == "compandor") return StampKind::Compandor;
    if (s == "linear-vca") return StampKind::LinearVca;
    if (s == "clock-driver") return StampKind::ClockDriver;
    if (s == "comparator") return StampKind::Comparator;
    if (s == "spring-reverb") return StampKind::SpringReverb;
    if (s == "macro-audio-source") return StampKind::MacroAudioSource;
    return StampKind::Unknown;
}

TaperKind parseTaperKind(const std::string& s) {
    if (s == "logarithmic") return TaperKind::Logarithmic;
    if (s == "anti-logarithmic" || s == "reverse-logarithmic") return TaperKind::AntiLogarithmic;
    if (s == "reverse-linear") return TaperKind::ReverseLinear;
    return TaperKind::Linear;
}

Stamp parseStamp(const JsonValue& obj) {
    Stamp st;
    st.kindStr = obj.getString("kind");
    st.kind = parseStampKind(st.kindStr);

    st.node = obj.getInt("node", -1);
    st.a = obj.getInt("a", -1);
    st.b = obj.getInt("b", -1);
    st.positive = obj.getInt("positive", -1);
    st.negative = obj.getInt("negative", -1);
    st.anode = obj.getInt("anode", -1);
    st.cathode = obj.getInt("cathode", -1);
    st.collector = obj.getInt("collector", -1);
    st.base = obj.getInt("base", -1);
    st.emitter = obj.getInt("emitter", -1);
    st.gate = obj.getInt("gate", -1);
    st.drain = obj.getInt("drain", -1);
    st.source = obj.getInt("source", -1);
    st.grid = obj.getInt("grid", -1);
    st.plate = obj.getInt("plate", -1);
    st.screen = obj.getInt("screen", -1);
    st.plus = obj.getInt("plus", -1);
    st.minus = obj.getInt("minus", -1);
    st.output = obj.getInt("output", -1);
    st.common = obj.getInt("common", -1);
    st.throwNode = obj.getInt("throwNode", -1);

    const auto* throwsArr = obj.find("throws");
    if (throwsArr && throwsArr->isArray()) {
        for (const auto& el : throwsArr->arrayValue) {
            if (el.isNumber()) st.throwsList.push_back(static_cast<int32_t>(el.numberValue));
        }
    }

    st.primaryPlus = obj.getInt("primaryPlus", -1);
    st.primaryMinus = obj.getInt("primaryMinus", -1);
    st.secondaryPlus = obj.getInt("secondaryPlus", -1);
    st.secondaryMinus = obj.getInt("secondaryMinus", -1);
    st.inP = obj.getInt("inP", -1);
    st.inN = obj.getInt("inN", -1);
    st.outP = obj.getInt("outP", -1);
    st.outN = obj.getInt("outN", -1);
    st.bias = obj.getInt("bias", -1);
    st.vee = obj.getInt("vee", -1);
    st.vdd = obj.getInt("vdd", -1);
    st.vss = obj.getInt("vss", -1);
    st.clockNode = obj.getInt("clockNode", -1);
    st.qNode = obj.getInt("qNode", -1);
    st.gndNode = obj.getInt("gndNode", -1);
    st.cp1 = obj.getInt("cp1", -1);
    st.cp2 = obj.getInt("cp2", -1);
    st.vgg = obj.getInt("vgg", -1);
    st.ox1 = obj.getInt("ox1", -1);
    st.gnd = obj.getInt("gnd", -1);
    st.controlNode = obj.getInt("control", -1);
    st.ledAnode = obj.getInt("ledAnode", -1);
    st.ledCathode = obj.getInt("ledCathode", -1);
    st.ldrA = obj.getInt("ldrA", -1);
    st.ldrB = obj.getInt("ldrB", -1);
    st.rectIn = obj.getInt("rectIn", -1);
    st.gainCellInNode = obj.getInt("gainCellInNode", -1);
    st.rectCap = obj.getInt("rectCap", -1);
    st.cellIn = obj.getInt("cellIn", -1);
    st.sumNode = obj.getInt("sumNode", -1);
    st.vref = obj.getInt("vref", -1);
    st.clk1 = obj.getInt("clk1", -1);
    st.clk2 = obj.getInt("clk2", -1);
    st.input = obj.getInt("input", -1);
    st.out1 = obj.getInt("out1", -1);
    st.out2 = obj.getInt("out2", -1);
    st.inputPlus = obj.getInt("inputPlus", -1);
    st.inputMinus = obj.getInt("inputMinus", -1);
    st.outputPlus = obj.getInt("outputPlus", -1);
    st.outputMinus = obj.getInt("outputMinus", -1);

    st.sourceIndex = obj.getInt("sourceIndex", -1);
    st.stateIndex = obj.getInt("stateIndex", -1);
    st.throwIndex = obj.getInt("throwIndex", 0);
    st.throwCount = obj.getInt("throwCount", 1);

    st.control = obj.getString("control");
    st.taper = parseTaperKind(obj.getString("taper"));
    st.side = obj.getString("side");
    st.macroId = obj.getString("macroId");

    st.siemens = obj.getDouble("siemens", 0.0);
    st.totalOhms = obj.getDouble("totalOhms", 0.0);
    st.minOhms = obj.getDouble("minOhms", 0.0);
    st.residualOhms = obj.getDouble("residualOhms", 0.0);
    st.maxOhms = obj.getDouble("maxOhms", 0.0);
    st.onOhms = obj.getDouble("onOhms", 0.0);
    st.offOhms = obj.getDouble("offOhms", 0.0);
    st.sourceOhms = obj.getDouble("sourceOhms", 0.0);
    st.farads = obj.getDouble("farads", 0.0);
    st.henries = obj.getDouble("henries", 0.0);
    st.volts = obj.getDouble("volts", 0.0);
    st.amplitudeVolts = obj.getDouble("amplitudeVolts", 0.0);
    st.frequencyHz = obj.getDouble("frequencyHz", 0.0);
    st.saturationCurrent = obj.getDouble("saturationCurrent", 1e-14);
    st.emissionCoefficient = obj.getDouble("emissionCoefficient", 1.0);
    st.thermalVoltage = obj.getDouble("thermalVoltage", 0.026);
    st.breakdownVolts = obj.getDouble("breakdownVolts", 0.0);
    st.seriesResistance = obj.getDouble("seriesResistance", 0.05);
    st.forwardBeta = obj.getDouble("forwardBeta", 100.0);
    st.reverseBeta = obj.getDouble("reverseBeta", 1.0);
    st.leakageAmps = obj.getDouble("leakageAmps", 0.0);
    st.thresholdVolts = obj.getDouble("thresholdVolts", 2.5);
    st.transconductance = obj.getDouble("transconductance", 0.001);
    st.channelLengthModulation = obj.getDouble("channelLengthModulation", 0.0);
    st.subthresholdVolts = obj.getDouble("subthresholdVolts", 0.0);
    st.gateSaturationCurrent = obj.getDouble("gateSaturationCurrent", 0.0);
    st.gateOnsetVolts = obj.getDouble("gateOnsetVolts", 0.5);
    st.gateScaleVolts = obj.getDouble("gateScaleVolts", 0.06);
    st.mu = obj.getDouble("mu", 100.0);
    st.kg1 = obj.getDouble("kg1", 1000.0);
    st.kp = obj.getDouble("kp", 500.0);
    st.kvb = obj.getDouble("kvb", 300.0);
    st.ex = obj.getDouble("ex", 1.5);
    st.gridSaturationCurrent = obj.getDouble("gridSaturationCurrent", 1e-6);
    st.gridOnsetVolts = obj.getDouble("gridOnsetVolts", 0.0);
    st.gridScaleVolts = obj.getDouble("gridScaleVolts", 0.1);
    st.contactPotentialVolts = obj.getDouble("contactPotentialVolts", 0.0);
    st.screenShare = obj.getDouble("screenShare", 0.0);
    st.perveance = obj.getDouble("perveance", 0.001);
    st.exponent = obj.getDouble("exponent", 1.5);
    st.turnsRatio = obj.getDouble("turnsRatio", 1.0);
    st.openLoopGain = obj.getDouble("openLoopGain", 100000.0);
    st.inputSiemens = obj.getDouble("inputSiemens", 0.0);
    st.vrefVolts = obj.getDouble("vrefVolts", 1.0);
    st.minGain = obj.getDouble("minGain", 0.0);

    const auto* rh = obj.find("railHigh");
    if (rh && rh->isNumber()) st.railHigh = rh->numberValue;
    const auto* rl = obj.find("railLow");
    if (rl && rl->isNumber()) st.railLow = rl->numberValue;

    st.biasVolts = obj.getDouble("biasVolts", 0.0);
    st.highVolts = obj.getDouble("highVolts", 5.0);
    st.defaultFrequency = obj.getDouble("defaultFrequency", 50000.0);
    st.ledThresholdVolts = obj.getDouble("ledThresholdVolts", 1.8);
    st.ledTransconductance = obj.getDouble("ledTransconductance", 0.01);
    st.ldrMinOhms = obj.getDouble("ldrMinOhms", 100.0);
    st.ldrMaxOhms = obj.getDouble("ldrMaxOhms", 1e6);
    const auto* lpc = obj.find("ldrPowerLawCoefficientOhms");
    if (lpc && lpc->isNumber()) st.ldrPowerLawCoefficientOhms = lpc->numberValue;
    const auto* lpe = obj.find("ldrPowerLawExponent");
    if (lpe && lpe->isNumber()) st.ldrPowerLawExponent = lpe->numberValue;
    st.r1 = obj.getDouble("r1", 10000.0);
    st.r2 = obj.getDouble("r2", 10000.0);
    st.r5 = obj.getDouble("r5", 10000.0);
    st.iBias = obj.getDouble("iBias", 140e-6);
    st.vggBiasVolts = obj.getDouble("vggBiasVolts", 0.0);
    st.stages = obj.getInt("stages", 1024);
    st.sensitivity = obj.getDouble("sensitivity", 1.0);
    st.pullDownOhms = obj.getDouble("pullDownOhms", 100.0);
    st.floatOhms = obj.getDouble("floatOhms", 1e6);
    st.inputOhms = obj.getDouble("inputOhms", 600.0);
    st.outputOhms = obj.getDouble("outputOhms", 600.0);
    st.delaySeconds = obj.getDouble("delaySeconds", 0.035);
    st.decaySeconds = obj.getDouble("decaySeconds", 2.75);
    st.dispersionStages = obj.getInt("dispersionStages", 3);

    st.polarity = obj.getString("polarity");
    st.channel = obj.getString("channel");

    return st;
}

StampPartition parseStampPartition(const JsonValue& obj) {
    StampPartition sp;
    auto readIntArray = [&](const std::string& key, std::vector<int32_t>& out) {
        const auto* arr = obj.find(key);
        if (arr && arr->isArray()) {
            for (const auto& el : arr->arrayValue) {
                if (el.isNumber()) out.push_back(static_cast<int32_t>(el.numberValue));
            }
        }
    };
    readIntArray("portRows", sp.portRows);
    readIntArray("linearStampIndices", sp.linearStampIndices);
    readIntArray("nonlinearStampIndices", sp.nonlinearStampIndices);
    readIntArray("constantStampIndices", sp.constantStampIndices);
    readIntArray("controlStampIndices", sp.controlStampIndices);
    readIntArray("dynamicStampIndices", sp.dynamicStampIndices);
    return sp;
}

SparseSchedule parseSparseSchedule(const JsonValue& obj) {
    SparseSchedule ss;
    ss.slots = obj.getInt("slots", 0);
    ss.factorCount = obj.getInt("factorCount", 0);
    ss.size = obj.getInt("size", 0);
    ss.sparseOps = obj.getInt("sparseOps", 0);
    ss.denseOps = obj.getInt("denseOps", 0);
    ss.unprovenPivots = obj.getInt("unprovenPivots", 0);

    auto readIntArray = [&](const std::string& key, std::vector<int32_t>& out) {
        const auto* arr = obj.find(key);
        if (arr && arr->isArray()) {
            for (const auto& el : arr->arrayValue) {
                if (el.isNumber()) out.push_back(static_cast<int32_t>(el.numberValue));
            }
        }
    };
    readIntArray("ops", ss.ops);
    readIntArray("gatherRow", ss.gatherRow);
    readIntArray("gatherColumn", ss.gatherColumn);

    ss.gatherOffsets.resize(ss.slots);
    for (int32_t i = 0; i < ss.slots && i < static_cast<int32_t>(ss.gatherRow.size()) && i < static_cast<int32_t>(ss.gatherColumn.size()); ++i) {
        ss.gatherOffsets[i] = ss.gatherRow[i] * ss.size + ss.gatherColumn[i];
    }

    size_t numOps = ss.ops.size() / 4;
    ss.structuredOps.resize(numOps);
    for (size_t i = 0; i < numOps; ++i) {
        ss.structuredOps[i].op = ss.ops[i * 4];
        ss.structuredOps[i].a = ss.ops[i * 4 + 1];
        ss.structuredOps[i].b = ss.ops[i * 4 + 2];
        ss.structuredOps[i].c = ss.ops[i * 4 + 3];
    }
    return ss;
}

static void parseMacroPorts(const JsonValue& obj, Block& b) {
    const auto* inObj = obj.find("audioIn");
    if (inObj && inObj->isObject()) {
        AudioInPort ai;
        ai.block = inObj->getString("block");
        ai.node = inObj->getInt("node", -1);
        b.audioIn = ai;
    }

    const auto* paramObj = obj.find("parameter");
    if (paramObj && paramObj->isObject()) {
        ParameterPort pp;
        pp.block = paramObj->getString("block");
        pp.node = paramObj->getInt("node", -1);
        pp.referenceVolts = paramObj->getDouble("referenceVolts", 0.0);
        b.parameter = pp;
    }

    const auto* modObj = obj.find("modulation");
    if (modObj && modObj->isObject()) {
        ModulationPort mp;
        mp.block = modObj->getString("block");
        mp.node = modObj->getInt("node", -1);
        mp.steeredBy = modObj->getString("steeredBy");
        b.modulation = mp;
    }

    const auto* lawObj = obj.find("clockLaw");
    if (lawObj && lawObj->isObject()) {
        ClockLawPort cp;
        cp.block = lawObj->getString("block");
        cp.node = lawObj->getInt("node", -1);
        cp.steeredBy = lawObj->getString("steeredBy");
        b.clockLaw = cp;
    }

    const auto* ccObj = obj.find("clockControl");
    if (ccObj && ccObj->isObject()) {
        MacroClockControl cc;
        cc.controlId = ccObj->getString("controlId");
        cc.taper = parseTaperKind(ccObj->getString("taper"));
        cc.ohmsAtControlMin = ccObj->getDouble("ohmsAtControlMin", 0.0);
        cc.ohmsAtControlMax = ccObj->getDouble("ohmsAtControlMax", 0.0);
        cc.farads = ccObj->getDouble("farads", 0.0);
        cc.stages = ccObj->getDouble("stages", 0.0);
        cc.formulaConstant = ccObj->getDouble("formulaConstant", 0.0);
        const auto* offsetObj = ccObj->find("offsetSeconds");
        if (!offsetObj || !offsetObj->isNumber()) {
            throw std::runtime_error("composed block \"" + b.id + "\" names a clockControl without offsetSeconds");
        }
        cc.offsetSeconds = ccObj->getDouble("offsetSeconds", 0.0);
        b.clockControl = cc;
    }

    const auto* inArr = obj.find("inputs");
    if (inArr && inArr->isArray()) {
        for (const auto& el : inArr->arrayValue) {
            if (el.isString()) b.inputs.push_back(el.stringValue);
        }
    }
    const auto* outArr = obj.find("outputs");
    if (outArr && outArr->isArray()) {
        for (const auto& el : outArr->arrayValue) {
            if (el.isString()) b.outputs.push_back(el.stringValue);
        }
    }
    const auto* ctrlArr = obj.find("controls");
    if (ctrlArr && ctrlArr->isArray()) {
        for (const auto& el : ctrlArr->arrayValue) {
            if (el.isString()) b.controls.push_back(el.stringValue);
        }
    }
    const auto* params = obj.find("parameters");
    if (params && params->isObject()) {
        for (const auto& [k, v] : params->objectValue) {
            if (v.isNumber()) b.parameters.emplace(k, v.numberValue);
        }
    }
}

static PrimitiveOp::Source parseComposedSource(const JsonValue& obj, const std::string& blockId) {
    PrimitiveOp::Source source;
    std::string kind = obj.getString("kind");
    if (kind == "input") {
        source.kind = PrimitiveOp::Source::Kind::Input;
    } else if (kind == "const") {
        source.kind = PrimitiveOp::Source::Kind::Const;
        source.value = obj.getDouble("value", 0.0);
    } else if (kind == "temp") {
        source.kind = PrimitiveOp::Source::Kind::Temp;
        source.temp = obj.getInt("index", 0);
    } else {
        throw std::runtime_error("composed block \"" + blockId + "\" names an unknown op source: " + kind);
    }
    return source;
}

static PrimitiveOp parsePrimitiveOp(const JsonValue& obj, const std::string& blockId) {
    PrimitiveOp op;
    std::string name = obj.getString("op");
    if (name == "delay-tap") {
        op.op = PrimitiveOp::Op::DelayTap;
    } else if (name == "delay-tap-fractional") {
        op.op = PrimitiveOp::Op::DelayTapFractional;
    } else if (name == "delay-tap-reverse") {
        op.op = PrimitiveOp::Op::DelayTapReverse;
    } else if (name == "hold-loop") {
        op.op = PrimitiveOp::Op::HoldLoop;
    } else if (name == "delay-push") {
        op.op = PrimitiveOp::Op::DelayPush;
    } else if (name == "mix") {
        op.op = PrimitiveOp::Op::Mix;
    } else if (name == "filter-dcblock") {
        op.op = PrimitiveOp::Op::FilterDcblock;
    } else if (name == "comb") {
        op.op = PrimitiveOp::Op::Comb;
    } else if (name == "allpass") {
        op.op = PrimitiveOp::Op::Allpass;
    } else if (name == "pitch-shift") {
        op.op = PrimitiveOp::Op::PitchShift;
    } else if (name == "pitch-tracker") {
        op.op = PrimitiveOp::Op::PitchTracker;
    } else {
        throw std::runtime_error("composed block \"" + blockId + "\" names a DSP primitive this runtime does not implement: " + name);
    }
    op.line = obj.getString("line", "");
    op.index = obj.getInt("index", 0);
    op.decaySeconds = obj.getDouble("decaySeconds", 0.0);
    op.ratio = obj.getDouble("ratio", 0.0);
    op.out = obj.getInt("out", 0);

    const auto* lengthObj = obj.find("length");
    if (lengthObj && lengthObj->isObject()) {
        std::string mode = lengthObj->getString("mode");
        if (mode == "capacity") {
            op.length = PrimitiveOp::LengthMode::Capacity;
        } else if (mode == "clock") {
            op.length = PrimitiveOp::LengthMode::Clock;
        } else if (mode == "modulation") {
            op.length = PrimitiveOp::LengthMode::Modulation;
        } else if (mode == "clock-law") {
            op.length = PrimitiveOp::LengthMode::ClockLaw;
            op.clockLawROhms = lengthObj->getDouble("rOhms", 0.0);
            op.clockLawCFarads = lengthObj->getDouble("cFarads", 0.0);
            op.clockLawVddVolts = lengthObj->getDouble("vddVolts", 0.0);
            op.clockLawVthVolts = lengthObj->getDouble("vthVolts", 0.0);
            op.clockLawVfVolts = lengthObj->getDouble("vfVolts", 0.0);
            op.clockLawFloorVolts = lengthObj->getDouble("floorVolts", 0.0);
            op.clockLawStages = lengthObj->getDouble("stages", 0.0);
            if (!(op.clockLawROhms > 0.0) || !(op.clockLawCFarads > 0.0) ||
                !(op.clockLawStages > 0.0) ||
                !(op.clockLawVthVolts < op.clockLawVddVolts)) {
                throw std::runtime_error("composed block \"" + blockId + "\" names a clock-law length without a usable law");
            }
        } else if (mode == "parameter") {
            op.length = PrimitiveOp::LengthMode::Parameter;
        } else {
            throw std::runtime_error("composed block \"" + blockId + "\" names an unknown delay length: " + mode);
        }
    }

    const auto* inputObj = obj.find("input");
    if (inputObj && inputObj->isObject()) {
        op.input = parseComposedSource(*inputObj, blockId);
    }
    if (op.op == PrimitiveOp::Op::HoldLoop) {
        const auto* gateObj = obj.find("gate");
        if (!gateObj || !gateObj->isObject() || gateObj->getString("controlId").empty()) {
            throw std::runtime_error("composed block \"" + blockId + "\" has a hold-loop with no gate control");
        }
        op.gateControl = gateObj->getString("controlId");
        op.gateMin = gateObj->getDouble("min", 0.0);
        op.gateMax = gateObj->getDouble("max", 1.0);
    }
    const auto* termsArr = obj.find("terms");
    if (termsArr && termsArr->isArray()) {
        for (const auto& el : termsArr->arrayValue) {
            if (!el.isObject()) {
                throw std::runtime_error("composed block \"" + blockId + "\" has a non-object mix term");
            }
            PrimitiveOp::Term term;
            const auto* sourceObj = el.find("source");
            if (sourceObj && sourceObj->isObject()) {
                term.source = parseComposedSource(*sourceObj, blockId);
            }
            term.gain = el.getDouble("gain", 0.0);
            const auto* sweepObj = el.find("sweep");
            if (sweepObj && sweepObj->isObject()) {
                term.swept = true;
                term.sweepControl = sweepObj->getString("controlId");
                term.sweepMin = sweepObj->getDouble("min", 0.0);
                term.sweepMax = sweepObj->getDouble("max", 0.0);
                if (term.sweepControl.empty()) {
                    throw std::runtime_error("composed block \"" + blockId + "\" has a swept mix term naming no control");
                }
            }
            op.terms.push_back(term);
        }
    }
    if ((op.op == PrimitiveOp::Op::DelayTap ||
         op.op == PrimitiveOp::Op::DelayTapFractional ||
         op.op == PrimitiveOp::Op::DelayTapReverse ||
         op.op == PrimitiveOp::Op::HoldLoop ||
         op.op == PrimitiveOp::Op::DelayPush) &&
        op.line.empty()) {
        throw std::runtime_error("composed block \"" + blockId + "\" has a delay op without a line");
    }
    return op;
}

Block parseBlock(const JsonValue& obj) {
    Block b;
    std::string kind = obj.getString("kind");
    b.id = obj.getString("id");

    // A dispatched macro block is refused by name, never executed and never ignored.
    // Its three kernels were deleted in board-p3 row 7: the models they implemented ship as
    // compositions now, so a program still carrying one was produced by a compiler older than
    // this runtime. Silence would be the one outcome the console/ROM contract forbids.
    if (kind == "macro") {
        throw std::runtime_error(
            "block \"" + b.id + "\" is a dispatched macro naming model \"" +
            obj.getString("modelId") +
            "\"; this runtime executes compositions only (macro dispatch retired, board-p3 row 7)");
    }

    if (kind == "composed") {
        b.kind = BlockKind::Composed;
        b.modelId = obj.getString("modelId");
        b.audioOut = obj.getBool("audioOut", false);

        parseMacroPorts(obj, b);

        const auto* positionsArr = obj.find("positions");
        if (!positionsArr || !positionsArr->isArray() || positionsArr->arrayValue.empty()) {
            // A composition with nothing to run is not a degraded program, it is an
            // unreadable one: there is no position to fall back to and silence would
            // be indistinguishable from a working block whose input is dead.
            throw std::runtime_error("composed block \"" + b.id +
                                     "\" declares no program positions");
        }
        for (const auto& posEl : positionsArr->arrayValue) {
            if (!posEl.isObject()) {
                throw std::runtime_error("composed block \"" + b.id +
                                         "\" has a non-object position");
            }
            ComposedPosition position;
            position.id = posEl.getString("id");
            const auto* opsArr = posEl.find("ops");
            if (opsArr && opsArr->isArray()) {
                for (const auto& el : opsArr->arrayValue) {
                    if (!el.isObject()) {
                        throw std::runtime_error("composed block \"" + b.id +
                                                 "\" has a non-object op");
                    }
                    position.ops.push_back(parsePrimitiveOp(el, b.id));
                }
            }
            position.out = posEl.getInt("out", 0);
            const auto* linesObj = posEl.find("lines");
            if (linesObj && linesObj->isObject()) {
                for (const auto& [lineId, lineVal] : linesObj->objectValue) {
                    if (!lineVal.isObject()) {
                        throw std::runtime_error("composed block \"" + b.id +
                                                 "\" has a non-object line");
                    }
                    position.lineDelaySeconds.emplace(
                        lineId, lineVal.getDouble("delaySeconds", 0.0));
                    position.lineMinSeconds.emplace(
                        lineId, lineVal.getDouble("minSeconds", 0.0));
                    const auto* sweepObj = lineVal.find("sweep");
                    if (sweepObj && sweepObj->isObject()) {
                        ComposedPosition::LineSweep sweep;
                        sweep.controlId = sweepObj->getString("controlId");
                        sweep.tapped = sweepObj->getString("read") == "tapped";
                        sweep.ratio = sweepObj->getDouble("ratio", 1.0);
                        if (sweep.controlId.empty()) {
                            throw std::runtime_error("composed block \"" + b.id + "\" has a line sweep naming no control");
                        }
                        position.lineSweep.emplace(lineId, sweep);
                    }
                }
            }
            b.positions.push_back(std::move(position));
        }

        const auto* routerObj = obj.find("router");
        if (routerObj && routerObj->isObject()) {
            ComposedRouter router;
            router.controlId = routerObj->getString("controlId");
            if (router.controlId.empty()) {
                throw std::runtime_error("composed block \"" + b.id +
                                         "\" has a router naming no control");
            }
            // A scanned control carries no port: the engine reads the control's own position.
            const auto* portObj = routerObj->find("port");
            if (portObj && portObj->isObject()) {
                SelectorPort port;
                port.block = portObj->getString("block");
                port.node = portObj->getInt("node", -1);
                port.referenceVolts = portObj->getDouble("referenceVolts", 0.0);
                router.port = port;
            }
            router.positions = routerObj->getInt("positions", 0);
            if (router.positions < 2) {
                throw std::runtime_error("composed block \"" + b.id +
                                         "\" has a router whose control declares fewer than 2 positions");
            }
            const auto* routesArr = routerObj->find("routes");
            if (!routesArr || !routesArr->isArray() ||
                static_cast<int32_t>(routesArr->arrayValue.size()) != router.positions) {
                // Dense by contract: one entry per detent. A short list would make an
                // out-of-range detent read as "no program" by accident rather than by
                // declaration, which is the difference this format exists to keep.
                throw std::runtime_error("composed block \"" + b.id +
                                         "\" has a router whose routes do not cover its " +
                                         std::to_string(router.positions) + " positions");
            }
            for (const auto& el : routesArr->arrayValue) {
                router.routes.push_back(static_cast<int32_t>(el.numberValue));
            }
            b.router = router;
        }
        if (b.positions.size() > 1 && !b.router.has_value()) {
            // Several programs and nothing choosing between them. Taking the first would be
            // the guess the declaration format refuses at parse, and it must not become
            // reachable by a program that lost its router downstream.
            throw std::runtime_error("composed block \"" + b.id + "\" declares " +
                                     std::to_string(b.positions.size()) +
                                     " program positions and no router to choose one");
        }
        return b;
    }

    if (kind != "mna") {
        throw std::runtime_error("unimplemented block kind: " + kind);
    }

    b.kind = BlockKind::Mna;
    b.nodeCount = obj.getInt("nodeCount", 0);
    b.auxCount = obj.getInt("auxCount", 0);
    b.stateCount = obj.getInt("stateCount", 0);
    b.linear = obj.getBool("linear", false);
    b.controlFree = obj.getBool("controlFree", false);
    b.eliminate = obj.getBool("eliminate", false);

    b.inputNode = obj.getOptionalInt("inputNode");
    b.outputNode = obj.getOptionalInt("outputNode");

    const auto* nodeIdsArr = obj.find("nodeIds");
    if (nodeIdsArr && nodeIdsArr->isArray()) {
        for (const auto& el : nodeIdsArr->arrayValue) {
            if (el.isNumber()) b.nodeIds.push_back(static_cast<int32_t>(el.numberValue));
        }
    }

    const auto* stampsArr = obj.find("stamps");
    if (stampsArr && stampsArr->isArray()) {
        for (const auto& el : stampsArr->arrayValue) {
            if (el.isObject()) b.stamps.push_back(parseStamp(el));
        }
    }

    const auto* partObj = obj.find("stampPartition");
    if (partObj && partObj->isObject()) {
        b.stampPartition = parseStampPartition(*partObj);
    }

    const auto* schedObj = obj.find("sparseSchedule");
    if (schedObj && schedObj->isObject()) {
        b.sparseSchedule = parseSparseSchedule(*schedObj);
    }

    const auto* seedsArr = obj.find("operatingPointSeeds");
    if (seedsArr && seedsArr->isArray()) {
        for (const auto& el : seedsArr->arrayValue) {
            if (el.isObject()) {
                OperatingPointSeed seed;
                seed.node = el.getInt("node", -1);
                seed.initialVolts = el.getDouble("volts", el.getDouble("initialVolts", 0.0));
                b.operatingPointSeeds.push_back(seed);
            }
        }
    }

    return b;
}

Control parseControl(const JsonValue& obj) {
    Control c;
    c.id = obj.getString("id");
    c.taper = parseTaperKind(obj.getString("taper"));
    c.defaultPosition = obj.getDouble("defaultPosition", 0.5);
    c.role = obj.getOptionalString("role");
    c.momentary = obj.getBool("momentary", false);
    if (const auto* tap = obj.find("tap"); tap != nullptr && tap->isObject()) {
        c.tapPresses = tap->getInt("presses", 0);
        c.tapTimeoutSeconds = tap->getDouble("timeoutSeconds", 0.0);
        if (const auto* d = tap->find("defaultSeconds"); d != nullptr && d->type == JsonType::Number) {
            c.tapDefaultSeconds = d->numberValue;
        }
    }
    if (const auto* latch = obj.find("latch"); latch != nullptr && latch->isObject()) {
        c.latchToggledBy = latch->getString("toggledBy");
        if (c.latchToggledBy.empty()) {
            throw std::runtime_error("control \"" + c.id + "\" is a latch toggled by no control");
        }
    }
    return c;
}

} // namespace

ProgramLoadResult parseProgramJson(std::string_view json) {
    ProgramLoadResult res;
    try {
        JsonParser parser(json);
        JsonValue root = parser.parse();
        if (!root.isObject()) {
            res.ok = false;
            res.error = "Root JSON element is not an object";
            return res;
        }

        Program& p = res.program;
        p.formatVersion = root.getInt("formatVersion", 6);
        if (p.formatVersion != 6) {
            // Version 6 moved a scanned delay control from the block onto each line and added
            // `tapped`; a version 5 program's block-level control would be silently unread.
            // Version 5 added a swept mix-term gain; a version 4 reader would play every knob
            // that sweeps one at its fixed fallback, silently.
            // Version 4 added a line's cited floor and a scanned parameter control; a version
            // 3 artifact would read every declared range from zero, which renders plausibly.
            // The container versions which keys exist and how they nest. Version 2 moved a
            // composed block's ops, out and lines into a `positions` list so a chip can
            // hold more than one program. A version 1 artifact has none, and reading it
            // here would refuse per block instead of once, by name, before a note plays.
            throw std::runtime_error("unsupported program format version " +
                                     std::to_string(p.formatVersion));
        }
        p.supplyReference = root.getString("supplyReference");
        p.stageCoverage = root.getString("stageCoverage");

        const auto* reqOps = root.find("requiredOperators");
        if (reqOps && reqOps->isArray()) {
            for (const auto& el : reqOps->arrayValue) {
                if (el.isString()) p.requiredOperators.push_back(el.stringValue);
            }
        }

        const auto* reqModels = root.find("requiredModels");
        if (reqModels && reqModels->isArray()) {
            for (const auto& el : reqModels->arrayValue) {
                if (el.isString()) p.requiredModels.push_back(el.stringValue);
            }
        }

        const auto* blocksArr = root.find("blocks");
        if (blocksArr && blocksArr->isArray()) {
            for (const auto& el : blocksArr->arrayValue) {
                if (el.isObject()) p.blocks.push_back(parseBlock(el));
            }
        }

        const auto* orderArr = root.find("order");
        if (orderArr && orderArr->isArray()) {
            for (const auto& el : orderArr->arrayValue) {
                if (el.isString()) p.order.push_back(el.stringValue);
            }
        }

        const auto* ctrlArr = root.find("controls");
        if (ctrlArr && ctrlArr->isArray()) {
            for (const auto& el : ctrlArr->arrayValue) {
                if (el.isObject()) p.controls.push_back(parseControl(el));
            }
        }

        const auto* portsObj = root.find("ports");
        if (portsObj && portsObj->isObject()) {
            p.ports.input = portsObj->getInt("input", -1);
            p.ports.output = portsObj->getInt("output", -1);
        }

        const auto* fullScaleObj = root.find("portFullScaleVolts");
        if (fullScaleObj && fullScaleObj->isObject()) {
            p.portFullScaleVolts.input = fullScaleObj->getOptionalDouble("input");
            p.portFullScaleVolts.output = fullScaleObj->getOptionalDouble("output");
        }

        const auto* impedObj = root.find("portImpedanceOhms");
        if (impedObj && impedObj->isObject()) {
            p.portImpedanceOhms.input = impedObj->getOptionalDouble("input");
            p.portImpedanceOhms.output = impedObj->getOptionalDouble("output");
        }

        res.ok = true;
    } catch (const std::exception& ex) {
        res.ok = false;
        res.error = ex.what();
    }
    return res;
}

} // namespace vessel_dsp::v2
