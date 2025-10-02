import json

# Input and output file paths
input_file = "specialjson.json"
output_file = "m2k0.json"

def transform_json():
    # Read the original JSON
    with open(input_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Extract just the name and content
    simplified = []
    for msg in data.get("messages", []):
        name = msg.get("author", {}).get("name")
        content = msg.get("content")
        simplified.append({
            "name": name,
            "content": content
        })

    # Write the simplified JSON
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(simplified, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    transform_json()
    print(f"Transformed data written to {output_file}")

