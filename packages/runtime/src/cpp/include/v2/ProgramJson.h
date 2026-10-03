#pragma once

#include "v2/Program.h"
#include <string>
#include <string_view>
#include <memory>

namespace vessel_dsp::v2 {

struct ProgramLoadResult {
    bool ok = false;
    std::string error;
    Program program;
};

ProgramLoadResult parseProgramJson(std::string_view json);

} // namespace vessel_dsp::v2
