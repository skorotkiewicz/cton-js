# CTON

[![npm version](https://badge.fury.io/js/cton-js.svg)](https://www.npmjs.com/package/cton-js)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/skorotkiewicz/cton-js/blob/master/LICENSE)

CTON (Compact Token-Oriented Notation) is a token-efficient, JSON-compatible wire format built for LLM prompts. It keeps structure explicit (objects, arrays, table arrays) while removing syntactic noise, so prompts are shorter and outputs are easier to validate. CTON is deterministic and round-trippable, making it safe for LLM workflows.

**CTON is designed to be the reference language for LLM data exchange**: short, deterministic, schema-aware.

---

## Quickstart

```bash
npm install cton-js
```

```javascript
const Cton = require('cton-js');

const payload = {
  user: { id: 42, name: "Ada" },
  tags: ["llm", "compact"],
  events: [
    { id: 1, action: "login" },
    { id: 2, action: "upload" }
  ]
};

const cton = Cton.dump(payload);
// => user(id=42,name=Ada)
// => tags[2]=llm,compact
// => events[2]{id,action}=1,login;2,upload

const roundTrip = Cton.load(cton);
// => same as payload
```

```bash
# CLI usage
npx cton input.json
npx cton --to-json data.cton
npx cton --stats input.json
```

---

## Why CTON for LLMs?

- **Shorter prompts**: CTON removes braces, indentation, and repeated keys.
- **Schema hints built-in**: arrays include length and tables include headers.
- **Deterministic output**: round-trip safe and validates structure.
- **LLM-friendly**: small grammar + clear guardrails for generation.

---

## CTON in 60 seconds

### Objects & Scalars

```text
task=planning,urgent=true,id=123
```

### Nested Objects

```text
user(name=Ada,settings(theme=dark))
```

### Arrays & Tables

```text
tags[3]=ruby,gem,llm
files[2]{name,size}=README.md,1024;lib/cton.rb,2048
```

---

## LLM Prompt Kit (Recommended)

System prompt template:

```markdown
You are an expert in CTON (Compact Token-Oriented Notation). Convert between JSON and CTON following the rules below and preserve the schema exactly.

Rules:
1. Do not wrap the root in `{}`.
2. Objects use `key=value` and nested objects use `key(...)`.
3. Arrays are `key[N]=v1,v2` and table arrays are `key[N]{k1,k2}=v1,v2;v1,v2`.
4. Use unquoted literals for `true`, `false`, and `null`.
5. Quote strings containing reserved characters (`,`, `;`, `=`, `(`, `)`) or whitespace.
6. Always keep array length and table headers accurate.
```

Few-shot example:

```text
JSON: {"team":[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}]}
CTON: team[2]{id,name}=1,Ada;2,Lin
```

---

## Schema Validation (1.0.0)

CTON ships with a schema DSL for validation inside your LLM pipeline.

```javascript
import * as Cton from 'cton-js';

const schema = Cton.schema(b => b.object({}, builder => {
  builder.key("user", b.object({}, userBuilder => {
    userBuilder.key("id", b.integer());
    userBuilder.key("name", b.string());
    userBuilder.optionalKey("role", b.enum("admin", "viewer"));
  }));
  builder.key("tags", b.array({ of: b.string() }));
}));

const result = Cton.validateSchema(payload, schema);
console.log(result.valid); // true/false
```

---

## Streaming IO (1.0.0)

Handle newline-delimited CTON streams efficiently:

```javascript
import * as fs from 'node:fs';
import * as Cton from 'cton-js';

// Reading stream
const readable = fs.createReadStream('events.cton', { encoding: 'utf-8' });
const reader = Cton.StreamReader(readable);
for await (const event of reader) {
  // process event
}

// Writing stream
const writable = fs.createWriteStream('events.cton');
Cton.dumpStream(events, writable);
```

---

## CTON-B (Binary Mode)

CTON-B is an optional binary envelope for compact transport (with optional compression):

```javascript
import * as Cton from 'cton-js';

const binary = Cton.dumpBinary(payload);
const roundTrip = Cton.loadBinary(binary);
```

CLI:

```bash
npx cton --to-binary input.json > output.ctonb
npx cton --from-binary output.ctonb
```

Note: `--stream` with binary assumes newline-delimited binary frames.

---

## Performance & Benchmarks

CTON focuses on throughput: memoized table schemas, low-allocation scalar streams, and fast boundary detection for inline docs.

Run benchmarks:

```bash
npm test
node bench/benchmark.js
```

---

## CLI Reference

```bash
npx cton [input]                 # auto-detect JSON/CTON
npx cton --to-json input.cton     # CTON → JSON
npx cton --to-cton input.json     # JSON → CTON
npx cton --to-binary input.json   # JSON → CTON-B
npx cton --from-binary input.ctonb
npx cton --minify input.json      # no separators
npx cton --pretty input.json
npx cton --stream input.ndjson
npx cton --schema schema.js input.cton
```

---

## API Reference

### Core Functions

#### `dump(payload, options)` / `generate(payload, options)`
Encode a JavaScript value to CTON string.

**Options:**
- `separator` (string): Separator between top-level entries (default: `'\n'`)
- `pretty` (boolean): Pretty print with indentation (default: `false`)
- `decimalMode` (string): Float precision mode: `'fast'` or `'precise'` (default: `'fast'`)
- `comments` (object): Comments to include (key → comment string)

#### `load(ctonString, options)` / `parse(ctonString, options)`
Parse a CTON string to JavaScript value.

**Options:**
- `symbolizeNames` (boolean): Convert keys to Symbols (default: `false`)

#### `validate(ctonString)`
Validate a CTON string without fully parsing. Returns a `ValidationResult`.

#### `isValid(ctonString)`
Check if a CTON string is valid. Returns boolean.

### Schema Validation

#### `schema(builderFunction)`
Define a schema using the DSL.

```javascript
const schema = Cton.schema(b => b.object({}, builder => {
  builder.key("name", b.string());
  builder.key("age", b.optionalKey(b.integer()));
}));
```

#### `validateSchema(data, schema)`
Validate data against a schema definition.

### Statistics

#### `stats(data)`
Get token statistics comparing CTON vs JSON. Returns a `Stats` object.

#### `statsHash(data)`
Get statistics as a plain object.

### Streaming

#### `loadStream(io, options)`
Stream parse CTON documents from a readable stream. Returns an async generator.

#### `dumpStream(enumerable, io, options)`
Stream encode CTON documents to a writable stream.

### Binary

#### `dumpBinary(data, options)`
Encode to CTON-B (binary) format. Returns a `Buffer`.

**Options:**
- `compress` (boolean): Enable compression (default: `true`)

#### `loadBinary(binary)`
Decode from CTON-B (binary) format.

### Type Registry

#### `registerType(constructor, options, transform)`
Register a custom type handler.

```javascript
import * as Cton from 'cton-js';

class Money {
  constructor(cents, currency) {
    this.cents = cents;
    this.currency = currency;
  }
}

Cton.registerType(Money, { as: 'object' }, money => ({
  amount: money.cents,
  currency: money.currency
}));
```

#### `unregisterType(constructor)`
Unregister a custom type handler.

#### `clearTypeRegistry()`
Clear all custom type handlers.

---

## Development

```bash
npm install        # install dependencies
npm test           # run tests
node bin/cton.js   # interactive playground
```

---

## Contributing

Bug reports and pull requests are welcome at https://github.com/skorotkiewicz/cton-js. Please follow the Code of Conduct.

## License

MIT © [Sebastian Korotkiewicz](https://github.com/skorotkiewicz)
MIT © [Davide Santangelo](https://github.com/davidesantangelo)
