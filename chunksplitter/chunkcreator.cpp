#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>
#include <nlohmann/json.hpp>
#include <chrono>
#include <cmath>

namespace fs = std::filesystem;
using json = nlohmann::json;

void split_json_messages(const std::string& file_path, int chunk_size) {
    auto start_time = std::chrono::high_resolution_clock::now();

    std::ifstream input_file(file_path);
    if (!input_file) {
        std::cerr << "Failed to open file: " << file_path << std::endl;
        return;
    }

    json data;
    input_file >> data;

    if (!data.contains("messages") || !data["messages"].is_array()) {
        std::cerr << "The JSON does not contain a valid 'messages' array." << std::endl;
        return;
    }

    const auto& messages = data["messages"];
    size_t total_messages = messages.size();
    size_t chunks_count = static_cast<size_t>(std::ceil(static_cast<double>(total_messages) / chunk_size));

    fs::path base_path(file_path);
    std::string base_name = base_path.stem().string();
    fs::path chunk_dir = base_path.parent_path() / (base_name + "_chunks");

    fs::create_directories(chunk_dir);

    json chunk_base = data;
    chunk_base.erase("messages");

    for (size_t i = 0; i < chunks_count; ++i) {
        size_t start_index = i * chunk_size;
        size_t end_index = std::min(start_index + chunk_size, total_messages);

        json chunk_data = chunk_base;
        chunk_data["messages"] = json::array();
        for (size_t j = start_index; j < end_index; ++j) {
            chunk_data["messages"].push_back(messages[j]);
        }
        chunk_data["messageCount"] = chunk_data["messages"].size();

        std::string filename = base_name + "_part" + std::to_string(i + 1) + ".json";
        fs::path output_file = chunk_dir / filename;

        std::ofstream out(output_file);
        out << chunk_data.dump(2);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed = end_time - start_time;

    std::cout << "Saved " << chunks_count << " chunk files to '" << chunk_dir << "'.\n";
    std::cout << "Chunk creation took " << elapsed.count() << " seconds.\n";
}

int main(int argc, char* argv[]) {
    std::string export_path;
    int chunk_size = 0;

    // Simple argument parsing
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if ((arg == "--chunk-size" || arg == "-s") && i + 1 < argc) {
            chunk_size = std::stoi(argv[++i]);
        } else if ((arg == "--export-path" || arg == "-e") && i + 1 < argc) {
            export_path = argv[++i];
        } else {
            std::cerr << "Unknown argument: " << arg << "\n";
            return 1;
        }
    }

    if (chunk_size <= 0 || export_path.empty()) {
        std::cerr << "Usage: " << argv[0] 
                  << " --chunk-size <size> --export-path <file.json>\n"
                  << "  -s, --chunk-size   Number of messages per chunk\n"
                  << "  -e, --export-path  Path to JSON export file\n";
        return 1;
    }

    split_json_messages(export_path, chunk_size);
    return 0;
}

