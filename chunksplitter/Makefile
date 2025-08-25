CXX := g++
CXXFLAGS := -std=c++17 -Wall -Wextra -O2

# Optional: set this if nlohmann/json.hpp isn't in standard include path
# Uncomment and modify if needed:
# INCLUDES := -I/path/to/nlohmann

# Targets and sources
CHUNKCREATOR_TARGET := chunkcreator
CHUNKCREATOR_SRC := chunkcreator.cpp

RECHUNKER_TARGET := rechunker
RECHUNKER_SRC := rechunker.cpp

all: $(CHUNKCREATOR_TARGET) $(RECHUNKER_TARGET)

$(CHUNKCREATOR_TARGET): $(CHUNKCREATOR_SRC)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $(CHUNKCREATOR_TARGET) $(CHUNKCREATOR_SRC)

$(RECHUNKER_TARGET): $(RECHUNKER_SRC)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $(RECHUNKER_TARGET) $(RECHUNKER_SRC)

clean:
	rm -f $(CHUNKCREATOR_TARGET) $(RECHUNKER_TARGET)

