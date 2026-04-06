/**
 * CTON Stats - Token statistics for comparing CTON vs JSON efficiency
 */

import { Encoder } from "./encoder";
import type { TypeRegistry } from "./type-registry";

export interface StatsOptions {
  typeRegistry?: TypeRegistry;
}

export interface StatsJSON {
  json_chars: number;
  cton_chars: number;
  json_bytes: number;
  cton_bytes: number;
  savings_chars: number;
  savings_bytes: number;
  savings_percent: number;
  estimated_tokens: {
    json: number;
    cton: number;
    savings: number;
  };
}

export interface EncodingComparison {
  cton: StatsJSON;
  cton_inline: { chars: number; bytes: number };
  cton_pretty: { chars: number; bytes: number };
  json: { chars: number; bytes: number };
  json_pretty: { chars: number; bytes: number };
}

export class Stats {
  // Rough estimate: GPT models average ~4 characters per token
  static readonly CHARS_PER_TOKEN = 4;
  private typeRegistry: TypeRegistry | undefined;
  private jsonString: string;
  private ctonString: string;

  constructor(data: unknown, options: StatsOptions = {}) {
    this.typeRegistry = options.typeRegistry;

    // Generate JSON
    this.jsonString = JSON.stringify(data);

    // Generate CTON
    const encoder = new Encoder({
      separator: "\n",
      typeRegistry: this.typeRegistry,
    });
    this.ctonString = encoder.encode(data);
  }

  get jsonChars(): number {
    return this.jsonString.length;
  }

  get ctonChars(): number {
    return this.ctonString.length;
  }

  get jsonBytes(): number {
    return Buffer.byteLength(this.jsonString, "utf8");
  }

  get ctonBytes(): number {
    return Buffer.byteLength(this.ctonString, "utf8");
  }

  get savingsChars(): number {
    return this.jsonChars - this.ctonChars;
  }

  get savingsBytes(): number {
    return this.jsonBytes - this.ctonBytes;
  }

  get savingsPercent(): number {
    if (this.jsonChars === 0) return 0.0;
    return parseFloat(((1 - this.ctonChars / this.jsonChars) * 100).toFixed(1));
  }

  get estimatedJsonTokens(): number {
    return Math.ceil(this.jsonChars / Stats.CHARS_PER_TOKEN);
  }

  get estimatedCtonTokens(): number {
    return Math.ceil(this.ctonChars / Stats.CHARS_PER_TOKEN);
  }

  get estimatedTokenSavings(): number {
    return this.estimatedJsonTokens - this.estimatedCtonTokens;
  }

  toJSON(): StatsJSON {
    return {
      json_chars: this.jsonChars,
      cton_chars: this.ctonChars,
      json_bytes: this.jsonBytes,
      cton_bytes: this.ctonBytes,
      savings_chars: this.savingsChars,
      savings_bytes: this.savingsBytes,
      savings_percent: this.savingsPercent,
      estimated_tokens: {
        json: this.estimatedJsonTokens,
        cton: this.estimatedCtonTokens,
        savings: this.estimatedTokenSavings,
      },
    };
  }

  toString(): string {
    return `JSON:  ${this.jsonChars} chars / ${this.jsonBytes} bytes (~${this.estimatedJsonTokens} tokens)
CTON:  ${this.ctonChars} chars / ${this.ctonBytes} bytes (~${this.estimatedCtonTokens} tokens)
Saved: ${this.savingsPercent}% (${this.savingsChars} chars, ~${this.estimatedTokenSavings} tokens)`;
  }

  /**
   * Compare multiple encoding options
   * @param data - Data to analyze
   * @param options - Options including typeRegistry
   * @returns Comparison results
   */
  static compare(data: unknown, options: StatsOptions = {}): EncodingComparison {
    const results = {} as EncodingComparison;
    const { typeRegistry } = options;

    // Standard CTON
    results.cton = new Stats(data, { typeRegistry }).toJSON();

    // Inline CTON (no separators)
    const inlineEncoder = new Encoder({ separator: "", typeRegistry });
    const inlineCton = inlineEncoder.encode(data);
    results.cton_inline = {
      chars: inlineCton.length,
      bytes: Buffer.byteLength(inlineCton, "utf8"),
    };

    // Pretty CTON
    const prettyEncoder = new Encoder({ pretty: true, typeRegistry });
    const prettyCton = prettyEncoder.encode(data);
    results.cton_pretty = {
      chars: prettyCton.length,
      bytes: Buffer.byteLength(prettyCton, "utf8"),
    };

    // JSON variants
    const json = JSON.stringify(data);
    results.json = {
      chars: json.length,
      bytes: Buffer.byteLength(json, "utf8"),
    };

    const prettyJson = JSON.stringify(data, null, 2);
    results.json_pretty = {
      chars: prettyJson.length,
      bytes: Buffer.byteLength(prettyJson, "utf8"),
    };

    return results;
  }
}
