{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "cpp-json-shell";

  buildInputs = [
    pkgs.gcc
    pkgs.nlohmann_json
    pkgs.pkg-config
  ];

  shellHook = ''
    echo "Run 'make' to build chunkcreator."
  '';
}

