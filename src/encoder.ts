/**
 * CTON Encoder - Converts JavaScript objects to CTON format
 */

import type { TypeRegistry } from "./type-registry";

export interface EncoderOptions {
  separator?: string;
  pretty?: boolean;
  decimalMode?: "fast" | "precise";
  comments?: Record<string, string>;
  typeRegistry?: TypeRegistry;
}

export class Encoder {
  private separator: string;
  private pretty: boolean;
  private decimalMode: "fast" | "precise";
  private comments: Record<string, string>;
  private indentLevel: number = 0;
  private tableSchemaCache: WeakMap<object, string[] | null> = new WeakMap();
  private output: string = "";

  private static readonly SAFE_TOKEN = /^[0-9A-Za-z_.:-]+$/;
  private static readonly NUMERIC_TOKEN = /^-?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  private static readonly RESERVED_LITERALS = new Set(["true", "false", "null"]);

  constructor(options: EncoderOptions = {}) {
    this.separator = options.separator !== undefined ? options.separator : "\n";
    this.pretty = options.pretty || false;
    this.decimalMode = options.decimalMode || "fast";
    this.comments = options.comments || {};
  }

  encode(payload: unknown): string {
    this.output = "";
    this.encodeRoot(payload);
    return this.output;
  }

  private encodeRoot(value: unknown): void {
    if (this.isPlainObject(value)) {
      let first = true;
      for (const [key, nested] of Object.entries(value)) {
        if (!first) {
          this.output += this.separator;
        }
        this.emitComment(key);
        this.encodeTopLevelPair(key, nested);
        first = false;
      }
    } else {
      this.encodeValue(value, "standalone");
    }
  }

  private encodeTopLevelPair(key: string, value: unknown): void {
    this.output += this.formatKey(key);
    this.encodeValue(value, "top-pair");
  }

  private encodeValue(
    value: unknown,
    context: "standalone" | "top-pair" | "object" | "array",
  ): void {
    if (this.isPlainObject(value)) {
      this.encodeObject(value);
    } else if (Array.isArray(value)) {
      this.encodeArray(value);
    } else {
      if (context === "top-pair") {
        this.output += "=";
      }
      this.encodeScalar(value);
    }
  }

  private encodeObject(hash: Record<string, unknown>): void {
    const keys = Object.keys(hash);
    if (keys.length === 0) {
      this.output += "()";
      return;
    }

    this.output += "(";
    if (this.pretty) this.indent();

    let first = true;
    for (const [key, val] of Object.entries(hash)) {
      if (first) {
        first = false;
      } else {
        this.output += ",";
        if (this.pretty) this.newline();
      }
      this.output += `${this.formatKey(key)}=`;
      this.encodeValue(val, "object");
    }

    if (this.pretty) this.outdent();
    this.output += ")";
  }

  private encodeArray(list: unknown[]): void {
    const length = list.length;
    if (length === 0) {
      this.output += "[0]=";
      return;
    }

    this.output += `[${length}]`;

    const header = this.tableSchemaFor(list);
    if (header) {
      this.encodeTable(list as Array<Record<string, unknown>>, header);
    } else {
      this.output += "=";
      if (list.every((v) => this.isScalar(v))) {
        this.encodeScalarList(list);
      } else {
        this.encodeMixedList(list);
      }
    }
  }

  private encodeTable(rows: Array<Record<string, unknown>>, header: string[]): void {
    this.output += "{";
    this.output += header.map((k) => this.formatKey(k)).join(",");
    this.output += "}=";

    if (this.pretty) this.indent();

    let firstRow = true;
    for (const row of rows) {
      if (firstRow) {
        firstRow = false;
      } else {
        this.output += ";";
        if (this.pretty) this.newline();
      }

      let firstCol = true;
      for (const field of header) {
        if (!firstCol) this.output += ",";
        this.encodeScalar(row[field]);
        firstCol = false;
      }
    }

    if (this.pretty) this.outdent();
  }

  private encodeScalarList(list: unknown[]): void {
    if (this.pretty) {
      this.indent();
      let first = true;
      for (const value of list) {
        if (first) {
          first = false;
        } else {
          this.output += ",";
          this.newline();
        }
        this.encodeScalar(value);
      }
      this.outdent();
    } else {
      let first = true;
      for (const value of list) {
        if (!first) this.output += ",";
        this.encodeScalar(value);
        first = false;
      }
    }
  }

  private encodeMixedList(list: unknown[]): void {
    if (this.pretty) this.indent();

    let first = true;
    for (const value of list) {
      if (first) {
        first = false;
      } else {
        this.output += ",";
        if (this.pretty) this.newline();
      }
      this.encodeValue(value, "array");
    }

    if (this.pretty) this.outdent();
  }

  private encodeScalar(value: unknown): void {
    this.output += this.scalarToString(value);
  }

  private scalarToString(value: unknown): string {
    if (typeof value === "string") {
      return this.formatString(value);
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (value === null) {
      return "null";
    }
    if (typeof value === "number") {
      return this.formatNumber(value);
    }
    if (value instanceof Date) {
      return this.formatString(value.toISOString());
    }
    throw new Error(`Unsupported value type: ${typeof value}`);
  }

  private formatString(value: string): string {
    if (value === "") {
      return '""';
    }
    if (this.stringNeedsQuotes(value)) {
      return this.quoteString(value);
    }
    return value;
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
      return "null";
    }

    if (Number.isInteger(value)) {
      return value.toString();
    }

    // Float
    if (this.decimalMode === "precise") {
      return this.preciseFloatString(value);
    }

    const str = value.toString();
    if (str.includes("e") || str.includes("E")) {
      return this.preciseFloatString(value);
    }
    return this.normalizeDecimalString(str);
  }

  private normalizeDecimalString(str: string): string {
    let stripped = str.startsWith("+") ? str.slice(1) : str;
    if (this.isZeroString(stripped)) return "0";

    if (stripped.includes(".")) {
      stripped = stripped.replace(/0+$/, "");
      stripped = stripped.replace(/\.$/, "");
    }
    return stripped;
  }

  private isZeroString(str: string): boolean {
    return /^-?0+(?:\.0+)?$/.test(str);
  }

  private preciseFloatString(value: number): string {
    return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  }

  private formatKey(key: string): string {
    const keyString = String(key);
    if (!Encoder.SAFE_TOKEN.test(keyString)) {
      throw new Error(`Invalid key: ${JSON.stringify(keyString)}`);
    }
    return keyString;
  }

  private stringNeedsQuotes(value: string): boolean {
    if (!Encoder.SAFE_TOKEN.test(value)) return true;
    if (Encoder.RESERVED_LITERALS.has(value)) return true;
    if (this.numericLike(value)) return true;
    return false;
  }

  private numericLike(value: string): boolean {
    return Encoder.NUMERIC_TOKEN.test(value);
  }

  private quoteString(value: string): string {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }

  private isScalar(value: unknown): boolean {
    const type = typeof value;
    return (
      type === "string" ||
      type === "number" ||
      type === "boolean" ||
      value === null ||
      value instanceof Date
    );
  }

  private tableSchemaFor(rows: unknown[]): string[] | null {
    const cached = this.tableSchemaCache.get(rows);
    if (cached !== undefined) return cached;

    const schema = this.computeTableSchema(rows);
    this.tableSchemaCache.set(rows, schema);
    return schema;
  }

  private computeTableSchema(rows: unknown[]): string[] | null {
    if (rows.length === 0) return null;

    const first = rows[0];
    if (!this.isPlainObject(first) || Object.keys(first).length === 0) {
      return null;
    }

    const header = Object.keys(first);

    for (const row of rows) {
      if (!this.isPlainObject(row)) return null;
      const rowKeys = Object.keys(row);
      if (rowKeys.length !== header.length) return null;
      for (let i = 0; i < header.length; i++) {
        if (rowKeys[i] !== header[i]) return null;
      }
      if (!Object.values(row).every((v) => this.isScalar(v))) return null;
    }

    return header;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  private indent(): void {
    this.indentLevel++;
    this.newline();
  }

  private outdent(): void {
    this.indentLevel--;
    this.newline();
  }

  private newline(): void {
    this.output += `\n${"  ".repeat(this.indentLevel)}`;
  }

  private emitComment(key: string): void {
    const comment = this.comments[key];
    if (!comment) return;

    const lines = String(comment).split("\n");
    for (const line of lines) {
      this.output += `# ${line}\n`;
    }
  }
}
