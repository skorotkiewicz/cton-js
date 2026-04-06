#!/usr/bin/env node

/**
 * CTON CLI - Command-line interface for CTON encoding/decoding
 */

import * as fs from "node:fs";
import * as CTON from "../index";

function showHelp(): void {
  console.log(`
CTON (Compact Token-Oriented Notation) - CLI Tool

Usage:
  cton [input]                    Auto-detect and convert JSON/CTON
  cton --to-json input.cton        CTON → JSON
  cton --to-cton input.json        JSON → CTON
  cton --to-binary input.json      JSON → CTON-B (binary)
  cton --from-binary input.ctonb   CTON-B → JSON/CTON
  cton --minify input.json         Output compact CTON (no separators)
  cton --pretty input.json         Pretty-print CTON with indentation
  cton --stats input.json          Show token statistics
  cton --stream input.ndjson       Stream process newline-delimited JSON
  cton --schema schema.ts input.cton  Validate against schema

Options:
  -h, --help          Show this help message
  -v, --version       Show version
  -o, --output FILE   Write output to file instead of stdout

Examples:
  cton data.json                    # Convert JSON to CTON
  cton --to-json data.cton          # Convert CTON to JSON
  cton --pretty data.json           # Pretty-print CTON
  echo '{"a":1}' | cton --to-cton   # Pipe input
`);
}

function showVersion(): void {
  console.log(`CTON v${CTON.VERSION}`);
}

function detectFormat(content: string): "json" | "cton" | "binary" | "unknown" {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  // Check for CTON patterns: key=value, key[N]=..., key(N)...
  if (/^[A-Za-z_][A-Za-z0-9_.:-]*[([=]/.test(trimmed)) {
    return "cton";
  }
  // Check for binary magic
  if (trimmed.startsWith("CTON")) {
    return "binary";
  }
  return "unknown";
}

function readInput(source: string | null): string {
  if (!source || source === "-") {
    // Read from stdin
    return fs.readFileSync(0, "utf-8");
  }
  if (!fs.existsSync(source)) {
    throw new Error(`File not found: ${source}`);
  }
  return fs.readFileSync(source, "utf-8");
}

function writeOutput(content: string, destination: string | null): void {
  if (!destination || destination === "-") {
    console.log(content);
  } else {
    fs.writeFileSync(destination, content);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  // Parse flags
  let inputFile: string | null = null;
  let outputFile: string | null = null;
  let toJson = false;
  let toCton = false;
  let toBinary = false;
  let fromBinary = false;
  let minify = false;
  let pretty = false;
  let showStats = false;
  let streamMode = false;
  let schemaFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
        break;
      case "-v":
      case "--version":
        showVersion();
        process.exit(0);
        break;
      case "--to-json":
        toJson = true;
        break;
      case "--to-cton":
        toCton = true;
        break;
      case "--to-binary":
        toBinary = true;
        break;
      case "--from-binary":
        fromBinary = true;
        break;
      case "--minify":
        minify = true;
        break;
      case "--pretty":
        pretty = true;
        break;
      case "--stats":
        showStats = true;
        break;
      case "--stream":
        streamMode = true;
        break;
      case "-o":
      case "--output":
        outputFile = args[++i];
        break;
      case "--schema":
        schemaFile = args[++i];
        break;
      default:
        if (!arg.startsWith("-")) {
          inputFile = arg;
        }
        break;
    }
  }

  try {
    // Handle schema validation
    if (schemaFile) {
      if (!fs.existsSync(schemaFile)) {
        throw new Error(`Schema file not found: ${schemaFile}`);
      }

      // Load and evaluate schema
      const schemaCode = fs.readFileSync(schemaFile, "utf-8");
      const schemaFn = new Function("CTON", `return ${schemaCode}`);
      const schemaDef = schemaFn(CTON);

      const input = readInput(inputFile);
      const format = detectFormat(input);

      let data: unknown;
      if (format === "cton") {
        data = CTON.load(input);
      } else {
        data = JSON.parse(input);
      }

      const result = CTON.validateSchema(data, schemaDef);
      if (result.valid) {
        console.log("Schema validation: PASSED");
        process.exit(0);
      } else {
        console.error("Schema validation: FAILED");
        console.error(result.toString());
        process.exit(1);
      }
    }

    // Handle binary output
    if (toBinary) {
      const input = readInput(inputFile);
      const data = JSON.parse(input);
      const binary = CTON.dumpBinary(data, { compress: true });

      if (outputFile) {
        fs.writeFileSync(outputFile, binary);
      } else {
        // Output as base64 for terminal
        console.log(binary.toString("base64"));
      }
      process.exit(0);
    }

    // Handle binary input
    if (fromBinary) {
      const input = readInput(inputFile);
      // Try base64 first, then raw binary
      let binary: Buffer;
      try {
        binary = Buffer.from(input, "base64");
      } catch {
        binary = Buffer.from(input, "binary");
      }

      const data = CTON.loadBinary(binary);

      if (outputFile) {
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      process.exit(0);
    }

    // Handle stats mode
    if (showStats) {
      const input = readInput(inputFile);
      const data = JSON.parse(input);
      const stats = CTON.stats(data);
      console.log(stats.toString());
      process.exit(0);
    }

    // Handle stream mode
    if (streamMode) {
      const input = readInput(inputFile);
      const lines = input.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        const data = JSON.parse(line);
        const cton = CTON.dump(data, { separator: "" });
        console.log(cton);
      }
      process.exit(0);
    }

    // Handle conversion modes
    const input = readInput(inputFile);
    const format = detectFormat(input);

    let output: string;

    if (toJson || (format === "cton" && !toCton)) {
      // Convert CTON to JSON
      const data = CTON.load(input);
      output = JSON.stringify(data, null, pretty ? 2 : 0);
    } else if (toCton || format === "json") {
      // Convert JSON to CTON
      const data = JSON.parse(input);
      const options: CTON.DumpOptions = {};
      if (minify) {
        options.separator = "";
      }
      if (pretty) {
        options.pretty = true;
      }
      output = CTON.dump(data, options);
    } else {
      throw new Error(`Could not detect input format. Input starts with: ${input.slice(0, 50)}...`);
    }

    writeOutput(output, outputFile);
  } catch (err: unknown) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
