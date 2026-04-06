/**
 * CTON-B Binary Format
 * Binary envelope for compact transport with optional compression
 */

import * as zlib from "node:zlib";
import { Encoder } from "./encoder";
import { Decoder } from "./decoder";
import type { TypeRegistry } from "./type-registry";

export const MAGIC = Buffer.from("CTON");
export const VERSION = 1;
export const FLAG_COMPRESSED = 1;

export interface BinaryDumpOptions {
  compress?: boolean;
  [key: string]: unknown;
}

/**
 * Encode a value as a variable-length integer
 * @param value - The value to encode
 * @returns Encoded varint
 */
export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

/**
 * Decode a variable-length integer from a buffer
 * @param source - The buffer to read from
 * @param offset - Starting offset
 * @returns [decoded value, bytes consumed]
 */
export function decodeVarint(source: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let index = offset;

  while (true) {
    if (index >= source.length) {
      throw new Error("Invalid CTON-B varint: unexpected end of data");
    }
    const byte = source[index];
    result |= (byte & 0x7f) << shift;
    index++;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }

  return [result, index - offset];
}

export interface BinaryStatic {
  dump(data: unknown, options?: BinaryDumpOptions, typeRegistry?: TypeRegistry): Buffer;
  load(binary: Buffer | ArrayBuffer | Uint8Array): unknown;
}

export const Binary: BinaryStatic = {
  /**
   * Encode data to CTON-B binary format
   * @param data - Data to encode
   * @param options - Encoding options
   * @param options.compress - Enable compression (default: true)
   * @returns Binary encoded data
   */
  dump(data: unknown, options: BinaryDumpOptions = {}, typeRegistry?: TypeRegistry): Buffer {
    const compress = options.compress !== false;

    // Encode to CTON text first using Encoder
    const encoder = new Encoder({
      separator: "",
      pretty: false,
      decimalMode: "fast",
      typeRegistry,
    });
    let payload = Buffer.from(encoder.encode(data), "utf-8");
    let flags = 0;

    if (compress) {
      payload = zlib.deflateSync(payload);
      flags |= FLAG_COMPRESSED;
    }

    // Build header: MAGIC + VERSION + FLAGS
    const header = Buffer.concat([MAGIC, Buffer.from([VERSION, flags])]);

    // Encode payload length as varint
    const lengthBytes = encodeVarint(payload.length);

    // Combine all parts
    return Buffer.concat([header, lengthBytes, payload]);
  },

  /**
   * Decode data from CTON-B binary format
   * @param binary - Binary data to decode
   * @returns Decoded data
   */
  load(binary: Buffer | ArrayBuffer | Uint8Array): unknown {
    // Convert to Buffer if needed
    let source: Buffer;
    if (binary instanceof Buffer) {
      source = binary;
    } else if (binary instanceof ArrayBuffer) {
      source = Buffer.from(binary);
    } else if (binary instanceof Uint8Array) {
      source = Buffer.from(binary);
    } else {
      throw new Error("Binary data must be a Buffer, ArrayBuffer, or Uint8Array");
    }

    // Check magic header
    if (source.length < 4 || !source.slice(0, 4).equals(MAGIC)) {
      throw new Error("Invalid CTON-B header");
    }

    if (source.length < 6) {
      throw new Error("CTON-B data too short");
    }

    const version = source[4];
    const flags = source[5];

    if (version !== VERSION) {
      throw new Error(`Unsupported CTON-B version: ${version}`);
    }

    // Decode varint length
    const [length, consumed] = decodeVarint(source, 6);
    const payloadStart = 6 + consumed;

    if (payloadStart + length > source.length) {
      throw new Error("Invalid CTON-B payload length");
    }

    let payload = source.slice(payloadStart, payloadStart + length);

    // Decompress if needed
    if ((flags & FLAG_COMPRESSED) !== 0) {
      payload = zlib.inflateSync(payload);
    }

    // Decode CTON text using Decoder
    const decoder = new Decoder();
    return decoder.decode(payload.toString("utf-8"));
  },
};
