/**
 * CTON (Compact Token-Oriented Notation)
 * A token-efficient, JSON-compatible wire format built for LLM prompts.
 */

import { Encoder, type EncoderOptions } from "./encoder";
import { Decoder, type DecoderOptions, ParseError } from "./decoder";
import { Validator, ValidationResult, ValidationError } from "./validator";
import {
  Schema,
  Builder,
  type Node as SchemaNode,
  type Result as SchemaResult,
  Schema as SchemaNamespace,
} from "./schema";
import { Stats, type StatsOptions } from "./stats";
import { TypeRegistry } from "./type-registry";
import { Binary, type BinaryDumpOptions } from "./binary";
import { StreamReader, StreamWriter } from "./stream";

// Re-export runtime values
export {
  Encoder,
  Decoder,
  ParseError,
  Validator,
  ValidationError,
  Schema,
  Builder,
  SchemaNamespace,
  Stats,
  TypeRegistry,
  Binary,
  StreamReader,
  StreamWriter,
};

// Re-export types separately
export type {
  EncoderOptions,
  DecoderOptions,
  ValidationResult,
  SchemaNode,
  SchemaResult,
  StatsOptions,
  BinaryDumpOptions,
};

// Global type registry instance
const typeRegistry = new TypeRegistry();

export interface DumpOptions {
  separator?: string;
  pretty?: boolean;
  decimalMode?: "fast" | "precise";
  comments?: Record<string, string>;
}

/**
 * Encode a JavaScript value to CTON string
 * @param payload - The value to encode
 * @param options - Encoding options
 * @returns CTON encoded string
 */
export function dump(payload: unknown, options: DumpOptions = {}): string {
  const encoder = new Encoder({
    separator: options.separator ?? "\n",
    pretty: options.pretty ?? false,
    decimalMode: options.decimalMode ?? "fast",
    comments: options.comments,
    typeRegistry,
  });
  return encoder.encode(payload);
}

/**
 * Alias for dump
 */
export const generate = dump;

export interface LoadOptions {
  symbolizeNames?: boolean;
}

/**
 * Parse a CTON string to JavaScript value
 * @param ctonString - The CTON string to parse
 * @param options - Parsing options
 * @returns Parsed JavaScript value
 */
export function load(ctonString: string | number, options: LoadOptions = {}): unknown {
  const decoder = new Decoder({ symbolizeNames: options.symbolizeNames ?? false });
  return decoder.decode(ctonString);
}

/**
 * Alias for load
 */
export const parse = load;

/**
 * Validate a CTON string without fully parsing
 * @param ctonString - The CTON string to validate
 * @returns Validation result object
 */
export function validate(ctonString: string): ValidationResult {
  const validator = new Validator();
  return validator.validate(ctonString);
}

/**
 * Check if a CTON string is valid
 * @param ctonString - The CTON string to check
 * @returns true if valid, false otherwise
 */
export function isValid(ctonString: string): boolean {
  return validate(ctonString).valid;
}

/**
 * Get token statistics comparing CTON vs JSON
 * @param data - The data to analyze
 * @returns Statistics object
 */
export function stats(data: unknown): Stats {
  return new Stats(data, { typeRegistry });
}

/**
 * Get statistics as a plain object
 * @param data - The data to analyze
 * @returns Statistics hash
 */
export function statsHash(data: unknown): ReturnType<Stats["toJSON"]> {
  return stats(data).toJSON();
}

/**
 * Define a schema using the DSL
 * @param block - Schema definition function
 * @returns Schema definition
 */
export function schema(block: (builder: Builder) => SchemaNode): SchemaNode {
  if (typeof block !== "function") {
    throw new TypeError("Schema definition must be a function");
  }
  const builder = new Builder();
  return block(builder);
}

/**
 * Validate data against a schema
 * @param data - Data to validate
 * @param schemaDef - Schema definition
 * @returns Validation result
 */
export function validateSchema(data: unknown, schemaDef: SchemaNode): SchemaResult {
  const errors: InstanceType<typeof Schema.Error>[] = [];
  schemaDef.validate(data, Schema.PATH_ROOT, errors);
  return new Schema.Result(errors);
}

export interface StreamOptions {
  separator?: string;
  symbolizeNames?: boolean;
}

/**
 * Stream parse CTON documents from a readable stream
 * @param io - Input stream
 * @param options - Options
 * @returns Generator yielding parsed documents
 */
export function* loadStream(
  io: Iterable<string>,
  options: StreamOptions = {},
): Generator<unknown, void, unknown> {
  const reader = new StreamReader(io, {
    separator: options.separator ?? "\n",
    symbolizeNames: options.symbolizeNames ?? false,
  });
  yield* reader;
}

/**
 * Async stream parse CTON documents
 * @param io - Async input stream
 * @param options - Options
 * @returns Async generator yielding parsed documents
 */
export async function* loadStreamAsync(
  io: AsyncIterable<string>,
  options: StreamOptions = {},
): AsyncGenerator<unknown, void, unknown> {
  let buffer = "";
  for await (const chunk of io) {
    buffer += chunk;
    let separatorIndex: number;
    while (true) {
      separatorIndex = buffer.indexOf(options.separator ?? "\n");
      if (separatorIndex === -1) break;
      const doc = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + (options.separator ?? "\n").length);
      const trimmed = doc.trim();
      if (trimmed.length > 0) {
        yield new Decoder({ symbolizeNames: options.symbolizeNames ?? false }).decode(trimmed);
      }
    }
  }

  const trimmed = buffer.trim();
  if (trimmed.length > 0) {
    yield new Decoder({ symbolizeNames: options.symbolizeNames ?? false }).decode(trimmed);
  }
}

export interface DumpStreamOptions extends DumpOptions {
  separator?: string;
}

interface WritableStreamLike {
  write(chunk: string): void;
}

/**
 * Stream encode CTON documents to a writable stream
 * @param enumerable - Objects to encode
 * @param io - Output stream
 * @param options - Encoding options
 */
export function dumpStream(
  enumerable: Iterable<unknown>,
  io: WritableStreamLike,
  options: DumpStreamOptions = {},
): WritableStreamLike {
  const writer = new StreamWriter(io, {
    separator: options.separator ?? "\n",
    ...options,
    typeRegistry,
  });
  for (const value of enumerable) {
    writer.write(value);
  }
  return io;
}

export interface BinaryOptions {
  compress?: boolean;
}

/**
 * Encode to CTON-B (binary) format
 * @param data - Data to encode
 * @param options - Options
 * @returns Binary data
 */
export function dumpBinary(data: unknown, options: BinaryOptions = {}): Buffer {
  return Binary.dump(
    data,
    {
      compress: options.compress ?? true,
    },
    typeRegistry,
  );
}

/**
 * Decode from CTON-B (binary) format
 * @param binary - Binary data
 * @returns Decoded data
 */
export function loadBinary(binary: Buffer | ArrayBuffer | Uint8Array): unknown {
  return Binary.load(binary);
}

export interface RegisterTypeOptions {
  as?: "object" | "array" | "scalar";
}

/**
 * Register a custom type handler
 * @param T - The class/constructor to handle
 * @param options - Registration options
 * @param transform - Transformation function
 */
export function registerType<T>(
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible constructor matching
  ctor: new (...args: any[]) => T,
  options: RegisterTypeOptions = {},
  transform: (value: T) => unknown,
): void {
  typeRegistry.register(ctor, options.as ?? "object", transform);
}

/**
 * Unregister a custom type handler
 * @param T - The class/constructor to handle
 */
export function unregisterType<T>(
  // biome-ignore lint/suspicious/noExplicitAny: Required for flexible constructor matching
  ctor: new (...args: any[]) => T,
): void {
  typeRegistry.unregister(ctor);
}

/**
 * Clear all custom type handlers
 */
export function clearTypeRegistry(): void {
  typeRegistry.clear();
}

// Export type registry instance
export { typeRegistry };

// Default export
export default {
  dump,
  generate,
  load,
  parse,
  validate,
  isValid,
  stats,
  statsHash,
  schema,
  validateSchema,
  loadStream,
  loadStreamAsync,
  dumpStream,
  dumpBinary,
  loadBinary,
  registerType,
  unregisterType,
  clearTypeRegistry,
  typeRegistry,
  Schema,
  Encoder,
  Decoder,
  ParseError,
  Validator,
  ValidationResult,
  ValidationError,
  Stats,
  TypeRegistry,
  Binary,
  StreamReader,
  StreamWriter,
  VERSION: "1.0.0",
};

// Version
export const VERSION = "1.0.0";
