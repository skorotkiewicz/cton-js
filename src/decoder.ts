/**
 * CTON Decoder - Converts CTON strings to JavaScript objects
 */

export interface DecoderOptions {
  symbolizeNames?: boolean;
}

export interface ParseErrorInfo {
  line?: number;
  column?: number;
  sourceExcerpt?: string;
  suggestions?: string[];
}

export class ParseError extends Error {
  line?: number;
  column?: number;
  sourceExcerpt?: string;
  suggestions: string[];

  constructor(message: string, info: ParseErrorInfo = {}) {
    let fullMessage = message;
    if (info.line && info.column) {
      fullMessage += ` at line ${info.line}, column ${info.column}`;
    }
    if (info.sourceExcerpt) {
      fullMessage += ` near '${info.sourceExcerpt}'`;
    }
    if (info.suggestions && info.suggestions.length > 0) {
      fullMessage += `. ${info.suggestions.join(". ")}`;
    }
    super(fullMessage);
    this.line = info.line;
    this.column = info.column;
    this.sourceExcerpt = info.sourceExcerpt;
    this.suggestions = info.suggestions || [];
  }

  toJSON(): Record<string, unknown> {
    return {
      message: this.message,
      line: this.line,
      column: this.column,
      sourceExcerpt: this.sourceExcerpt,
      suggestions: this.suggestions,
    };
  }
}

export class Decoder {
  private rawString: string = "";
  private pos: number = 0;
  private symbolizeNames: boolean;

  constructor(options: DecoderOptions = {}) {
    this.symbolizeNames = options.symbolizeNames ?? false;
  }

  private makeKey(name: string): string | symbol {
    return this.symbolizeNames ? Symbol(name) : name;
  }

  decode(ctonString: string | number): unknown {
    this.rawString = String(ctonString);
    this.pos = 0;
    this.skipWsAndComments();

    let value: unknown;
    if (this.keyAhead()) {
      value = this.parseDocument();
    } else {
      value = this.parseValue({ allowKeyBoundary: true });
    }

    this.skipWsAndComments();
    if (!this.eos()) {
      this.raiseError("Unexpected trailing data");
    }

    return value;
  }

  private eos(): boolean {
    return this.pos >= this.rawString.length;
  }

  private peek(n: number = 1): string {
    return this.rawString.slice(this.pos, this.pos + n);
  }

  private getch(): string | null {
    if (this.eos()) return null;
    return this.rawString[this.pos++];
  }

  private scan(char: string): boolean {
    if (this.peek() === char) {
      this.pos++;
      return true;
    }
    return false;
  }

  private calculateLocation(pos: number): [number, number] {
    const consumed = this.rawString.slice(0, pos);
    const lines = consumed.split("\n");
    const line = lines.length;
    const lastNewline = consumed.lastIndexOf("\n");
    const col = lastNewline >= 0 ? pos - lastNewline : pos + 1;
    return [line, col];
  }

  private extractSourceExcerpt(pos: number, length: number = 30): string {
    const start = Math.max(pos - 10, 0);
    const finish = Math.min(pos + length, this.rawString.length);
    let excerpt = this.rawString.slice(start, finish);
    if (start > 0) excerpt = `...${excerpt}`;
    if (finish < this.rawString.length) excerpt = `${excerpt}...`;
    return excerpt.replace(/\s+/g, " ");
  }

  private raiseError(message: string, info: { suggestions?: string[] } = {}): never {
    const [line, col] = this.calculateLocation(this.pos);
    const excerpt = this.extractSourceExcerpt(this.pos);
    throw new ParseError(message, {
      line,
      column: col,
      sourceExcerpt: excerpt,
      suggestions: info.suggestions,
    });
  }

  private skipWs(): void {
    while (!this.eos() && /^\s$/.test(this.peek())) {
      this.pos++;
    }
  }

  private skipWsAndComments(): void {
    while (true) {
      this.skipWs();
      if (this.peek() === "#") {
        while (!this.eos() && this.peek() !== "\n") {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private keyAhead(): boolean {
    const savedPos = this.pos;
    this.skipWsAndComments();

    let keyLen = 0;
    while (keyLen < this.rawString.length - this.pos) {
      const char = this.rawString[this.pos + keyLen];
      if (!/[0-9A-Za-z_.:-]/.test(char)) break;
      keyLen++;
    }

    if (keyLen > 0) {
      const afterKey = this.pos + keyLen;
      const nextChar = this.rawString[afterKey];
      const isBoundary = ["(", "[", "="].includes(nextChar) || /^\s$/.test(nextChar);
      this.pos = savedPos;
      return isBoundary;
    }

    this.pos = savedPos;
    return false;
  }

  private parseDocument(): Record<string | symbol, unknown> {
    const result: Record<string | symbol, unknown> = {};
    while (!this.eos()) {
      this.skipWsAndComments();
      if (this.eos()) break;

      const key = this.parseKeyName();
      const value = this.parseValueForKey();
      result[this.makeKey(key)] = value;
      this.skipWsAndComments();
    }
    return result;
  }

  private parseValueForKey(): unknown {
    this.skipWsAndComments();
    if (this.scan("(")) {
      return this.parseObject();
    } else if (this.scan("[")) {
      return this.parseArray();
    } else if (this.scan("=")) {
      return this.parseScalar({ allowKeyBoundary: true });
    } else {
      this.raiseError("Unexpected token after key");
    }
  }

  private parseKeyName(): string {
    this.skipWsAndComments();
    const match = /^[0-9A-Za-z_.:-]+/.exec(this.rawString.slice(this.pos));
    if (!match) {
      this.raiseError("Invalid key");
    }
    this.pos += match[0].length;
    return match[0];
  }

  private parseObject(): Record<string | symbol, unknown> {
    this.skipWsAndComments();
    if (this.scan(")")) {
      return {};
    }

    const pairs: Record<string | symbol, unknown> = {};
    while (true) {
      const key = this.parseKeyName();
      if (!this.scan("=")) {
        this.raiseError("Expected '=' in object");
      }
      const value = this.parseValue();
      pairs[this.makeKey(key)] = value;
      this.skipWsAndComments();
      if (this.scan(")")) break;
      if (!this.scan(",")) {
        this.raiseError("Expected ',' or ')' in object");
      }
      this.skipWsAndComments();
    }
    return pairs;
  }

  private parseArray(): unknown[] {
    const length = this.parseIntegerLiteral();
    if (!this.scan("]")) {
      this.raiseError("Expected ']' after array length");
    }
    this.skipWsAndComments();

    const header = this.peek() === "{" ? this.parseHeader() : null;

    if (!this.scan("=")) {
      this.raiseError("Expected '=' after array declaration");
    }

    if (length === 0) {
      return [];
    }

    if (header) {
      return this.parseTableRows(length, header);
    } else {
      return this.parseArrayElements(length);
    }
  }

  private parseHeader(): string[] {
    this.scan("{");
    const fields: string[] = [];
    while (true) {
      const key = this.parseKeyName();
      fields.push(key);
      if (this.scan("}")) break;
      if (!this.scan(",")) {
        this.raiseError("Expected ',' or '}' in header");
      }
    }
    return fields;
  }

  private parseTableRows(
    length: number,
    header: string[],
  ): Array<Record<string | symbol, unknown>> {
    const rows: Array<Record<string | symbol, unknown>> = [];
    for (let rowIndex = 0; rowIndex < length; rowIndex++) {
      const row: Record<string | symbol, unknown> = {};
      for (let colIndex = 0; colIndex < header.length; colIndex++) {
        const field = header[colIndex];
        const allowBoundary = rowIndex === length - 1 && colIndex === header.length - 1;
        row[this.makeKey(field)] = this.parseScalar({ allowKeyBoundary: allowBoundary });
        if (colIndex < header.length - 1) {
          if (!this.scan(",")) {
            this.raiseError("Expected ',' between table cells");
          }
        }
      }
      rows.push(row);
      if (rowIndex < length - 1) {
        if (!this.scan(";")) {
          this.raiseError("Expected ';' between table rows");
        }
      }
    }
    return rows;
  }

  private parseArrayElements(length: number): unknown[] {
    const values: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const allowBoundary = i === length - 1;
      values.push(this.parseValue({ allowKeyBoundary: allowBoundary }));
      if (i < length - 1) {
        if (!this.scan(",")) {
          this.raiseError("Expected ',' between array elements");
        }
      }
    }
    return values;
  }

  private parseValue(options: { allowKeyBoundary?: boolean } = {}): unknown {
    this.skipWsAndComments();
    if (this.scan("(")) {
      return this.parseObject();
    } else if (this.scan("[")) {
      return this.parseArray();
    } else if (this.peek() === '"') {
      return this.parseString();
    } else {
      return this.parseScalar(options);
    }
  }

  private parseScalar(
    options: { allowKeyBoundary?: boolean } = {},
  ): string | number | boolean | null {
    this.skipWsAndComments();
    if (this.peek() === '"') {
      return this.parseString();
    }

    let token: string | null;
    if (options.allowKeyBoundary) {
      token = this.scanUntilBoundaryOrTerminator();
    } else {
      token = this.scanUntilTerminator();
    }

    if (!token || token.length === 0) {
      this.raiseError("Empty value");
    }

    return this.convertScalar(token);
  }

  private scanUntilTerminator(): string | null {
    const start = this.pos;
    const end = this.findTerminatorPosition(start);
    return this.consumeSlice(start, end);
  }

  private scanUntilBoundaryOrTerminator(): string | null {
    const start = this.pos;
    const boundaryPos = this.findKeyBoundary(start);
    const end = boundaryPos !== null ? boundaryPos : this.findTerminatorPosition(start);
    return this.consumeSlice(start, end);
  }

  private consumeSlice(start: number, end: number): string | null {
    if (end <= start) return null;
    const token = this.rawString.slice(start, end);
    this.pos = end;
    return token;
  }

  private findTerminatorPosition(start: number): number {
    const str = this.rawString;
    const len = str.length;
    let idx = start;
    const terminatorRegex = /[\s,;)\]}([{]/;

    while (idx < len) {
      if (terminatorRegex.test(str[idx])) {
        break;
      }
      idx++;
    }
    return idx;
  }

  private findKeyBoundary(fromIndex: number): number | null {
    const str = this.rawString;
    const len = str.length;
    let idx = fromIndex;

    while (idx < len) {
      const char = str[idx];

      if (this.terminator(char)) {
        return null;
      }

      if (/[0-9A-Za-z_.:-]/.test(char)) {
        let keyEnd = idx;
        while (keyEnd < len && /[0-9A-Za-z_.:-]/.test(str[keyEnd])) {
          keyEnd++;
        }

        const boundaryTokens = ["(", "[", "="];
        if (
          keyEnd < len &&
          boundaryTokens.includes(str[keyEnd]) &&
          idx > fromIndex &&
          /[A-Za-z_.:-]/.test(str[idx])
        ) {
          return idx;
        }
      }

      idx++;
    }

    return null;
  }

  private terminator(char: string): boolean {
    const terminators = [",", ";", ")", "]", "}"];
    const openers = ["(", "[", "{"];
    return terminators.includes(char) || /^\s$/.test(char) || openers.includes(char);
  }

  private convertScalar(token: string): string | number | boolean | null {
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;

    if (/^-?(?:0|[1-9]\d*)$/.test(token)) {
      return parseInt(token, 10);
    }

    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
      return parseFloat(token);
    }

    return token;
  }

  private parseString(): string {
    if (!this.scan('"')) {
      this.raiseError("Expected opening quote");
    }

    let buffer = "";
    while (true) {
      if (this.eos()) {
        this.raiseError("Unterminated string");
      }

      const char = this.getch();

      if (char === "\\") {
        const escaped = this.getch();
        if (escaped === null) {
          this.raiseError("Invalid escape sequence");
        }
        switch (escaped) {
          case "n":
            buffer += "\n";
            break;
          case "r":
            buffer += "\r";
            break;
          case "t":
            buffer += "\t";
            break;
          case '"':
            buffer += '"';
            break;
          case "\\":
            buffer += "\\";
            break;
          default:
            this.raiseError(`Unsupported escape sequence '\\${escaped}'`);
        }
      } else if (char === '"') {
        break;
      } else if (char !== null) {
        buffer += char;
      }
    }
    return buffer;
  }

  private parseIntegerLiteral(): number {
    const match = /^-?\d+/.exec(this.rawString.slice(this.pos));
    if (!match) {
      this.raiseError("Expected digits for array length");
    }
    this.pos += match[0].length;
    return parseInt(match[0], 10);
  }
}
