/**
 * CTON Streaming IO - Handle newline-delimited CTON streams
 */

import { Decoder, type DecoderOptions } from "./decoder";
import { Encoder, type EncoderOptions } from "./encoder";

export interface StreamReaderOptions extends DecoderOptions {
  separator?: string;
}

/**
 * Reads CTON documents from a stream
 */
export class StreamReader implements Iterable<unknown>, AsyncIterable<unknown> {
  private io: Iterable<string> | AsyncIterable<string>;
  private separator: string;
  private symbolizeNames: boolean;

  /**
   * @param io - Input stream (iterable of chunks/lines)
   * @param options - Options
   */
  constructor(io: Iterable<string> | AsyncIterable<string>, options: StreamReaderOptions = {}) {
    this.io = io;
    this.separator = options.separator ?? "\n";
    this.symbolizeNames = options.symbolizeNames ?? false;
  }

  /**
   * Iterate over all documents in the stream
   * @returns Generator yielding parsed documents
   */
  *[Symbol.iterator](): Generator<unknown> {
    let buffer = "";
    const decoder = new Decoder({ symbolizeNames: this.symbolizeNames });

    for (const chunk of this.io as Iterable<string>) {
      buffer += chunk;

      // Split on separator
      let separatorIndex: number;
      while (true) {
        separatorIndex = buffer.indexOf(this.separator);
        if (separatorIndex === -1) break;
        const doc = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + this.separator.length);

        const trimmed = doc.trim();
        if (trimmed.length > 0) {
          yield decoder.decode(trimmed);
        }
      }
    }

    // Process remaining buffer
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      yield decoder.decode(trimmed);
    }
  }

  /**
   * Async iterator for async streams
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    let buffer = "";
    const decoder = new Decoder({ symbolizeNames: this.symbolizeNames });

    for await (const chunk of this.io as AsyncIterable<string>) {
      buffer += chunk;

      let separatorIndex: number;
      while (true) {
        separatorIndex = buffer.indexOf(this.separator);
        if (separatorIndex === -1) break;
        const doc = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + this.separator.length);

        const trimmed = doc.trim();
        if (trimmed.length > 0) {
          yield decoder.decode(trimmed);
        }
      }
    }

    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      yield decoder.decode(trimmed);
    }
  }
}

export interface StreamWriterOptions extends EncoderOptions {
  separator?: string;
}

export interface WritableStream {
  write(chunk: string): void;
}

/**
 * Writes CTON documents to a stream
 */
export class StreamWriter {
  private io: WritableStream;
  private separator: string;
  private encoder: Encoder;
  private first: boolean;

  /**
   * @param io - Output stream (must have write method)
   * @param options - Options
   */
  constructor(io: WritableStream, options: StreamWriterOptions = {}) {
    this.io = io;
    this.separator = options.separator ?? "\n";
    this.encoder = new Encoder({ ...options, separator: this.separator });
    this.first = true;
  }

  /**
   * Write a value to the stream
   * @param value - Value to encode and write
   */
  write(value: unknown): void {
    if (!this.first) {
      this.io.write(this.separator);
    }
    const encoded = this.encoder.encode(value);
    this.io.write(encoded);
    this.first = false;
  }

  /**
   * Write multiple values
   * @param values - Values to write
   */
  writeAll(values: Iterable<unknown>): void {
    for (const value of values) {
      this.write(value);
    }
  }
}
