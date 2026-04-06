/**
 * CTON Validator - Validates CTON syntax without fully parsing
 */

export interface ValidationErrorJSON {
  message: string;
  line: number;
  column: number;
  sourceExcerpt: string | null;
}

export class ValidationError {
  message: string;
  line: number;
  column: number;
  sourceExcerpt: string | null;

  constructor(message: string, line: number, column: number, sourceExcerpt: string | null) {
    this.message = message;
    this.line = line;
    this.column = column;
    this.sourceExcerpt = sourceExcerpt;
  }

  toString(): string {
    const loc = `line ${this.line}, column ${this.column}`;
    const excerptStr = this.sourceExcerpt ? ` near '${this.sourceExcerpt}'` : "";
    return `${this.message} at ${loc}${excerptStr}`;
  }

  toJSON(): ValidationErrorJSON {
    return {
      message: this.message,
      line: this.line,
      column: this.column,
      sourceExcerpt: this.sourceExcerpt,
    };
  }
}

export interface ValidationResultJSON {
  valid: boolean;
  errors: ValidationErrorJSON[];
}

export class ValidationResult {
  errors: ValidationError[];

  constructor(errors: ValidationError[] = []) {
    this.errors = errors;
  }

  get valid(): boolean {
    return this.errors.length === 0;
  }

  toString(): string {
    if (this.valid) return "Valid CTON";
    const messages = this.errors.map((e) => e.toString());
    return `Invalid CTON:\n  ${messages.join("\n  ")}`;
  }

  toJSON(): ValidationResultJSON {
    return {
      valid: this.valid,
      errors: this.errors.map((e) => e.toJSON()),
    };
  }
}

export class Validator {
  private errors: ValidationError[];
  private rawString: string;
  private pos: number;
  private length: number;

  constructor() {
    this.errors = [];
    this.rawString = "";
    this.pos = 0;
    this.length = 0;
  }

  validate(ctonString: string): ValidationResult {
    this.errors = [];
    this.rawString = String(ctonString);
    this.pos = 0;
    this.length = this.rawString.length;

    try {
      this.validateDocument();
      this.checkTrailingContent();
    } catch (_e) {
      // Validation stopped
    }

    return new ValidationResult(this.errors);
  }

  // Utility methods
  private eos(): boolean {
    return this.pos >= this.length;
  }

  private peek(): string | null {
    return this.eos() ? null : this.rawString[this.pos];
  }

  private advance(): string {
    return this.rawString[this.pos++];
  }

  private consume(char: string): boolean {
    if (this.peek() === char) {
      this.pos++;
      return true;
    }
    return false;
  }

  // Location tracking
  private calculateLocation(pos: number): [number, number] {
    const consumed = this.rawString.slice(0, pos);
    const lines = consumed.split("\n");
    const line = lines.length;
    const lastNewline = consumed.lastIndexOf("\n");
    const col = lastNewline >= 0 ? pos - lastNewline : pos + 1;
    return [line, col];
  }

  private extractExcerpt(pos: number, length: number = 20): string {
    const start = Math.max(pos - 5, 0);
    const finish = Math.min(pos + length, this.length);
    let excerpt = this.rawString.slice(start, finish);
    if (start > 0) excerpt = `...${excerpt}`;
    if (finish < this.length) excerpt = `${excerpt}...`;
    return excerpt.replace(/\s+/g, " ");
  }

  private addError(message: string, pos: number): void {
    const [line, col] = this.calculateLocation(pos);
    const excerpt = this.extractExcerpt(pos);
    this.errors.push(new ValidationError(message, line, col, excerpt));
  }

  // Skip methods
  private skipWsAndComments(): void {
    while (true) {
      // Skip whitespace
      while (this.pos < this.length && /^\s$/.test(this.rawString[this.pos])) {
        this.pos++;
      }
      // Skip comments
      if (this.pos < this.length && this.rawString[this.pos] === "#") {
        while (this.pos < this.length && this.rawString[this.pos] !== "\n") {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private skipToRecoveryPoint(): void {
    while (this.pos < this.length) {
      const char = this.rawString[this.pos];
      if (["\n", ",", ";", ")", "]", "}"].includes(char)) {
        break;
      }
      this.pos++;
    }
    if (this.pos < this.length && [",", ";"].includes(this.rawString[this.pos])) {
      this.pos++;
    }
  }

  // Scanning
  private scanKey(): boolean {
    const start = this.pos;
    while (this.pos < this.length && /[0-9A-Za-z_.:-]/.test(this.rawString[this.pos])) {
      this.pos++;
    }
    return this.pos > start;
  }

  private scanInteger(): number | null {
    const start = this.pos;
    if (this.peek() === "-") this.advance();
    while (this.pos < this.length && /^\d$/.test(this.rawString[this.pos])) {
      this.pos++;
    }
    if (this.pos === start || (this.pos === start + 1 && this.rawString[start] === "-")) {
      return null;
    }
    return parseInt(this.rawString.slice(start, this.pos), 10);
  }

  // Key detection
  private keyAhead(): boolean {
    const savedPos = this.pos;
    this.skipWsAndComments();

    let result = false;
    if (this.scanKey()) {
      this.skipWsAndComments();
      result = ["(", "[", "="].includes(this.peek() || "");
    }

    this.pos = savedPos;
    return result;
  }

  // Validation methods
  private validateDocument(): void {
    this.skipWsAndComments();
    if (this.eos()) return;

    if (this.keyAhead()) {
      this.validateKeyValuePairs();
    } else {
      this.validateValue();
    }
  }

  private validateKeyValuePairs(): void {
    while (true) {
      this.skipWsAndComments();
      if (this.eos()) break;

      this.validateKey();
      this.validateValueForKey();
      this.skipWsAndComments();
    }
  }

  private validateKey(): void {
    this.skipWsAndComments();
    const start = this.pos;
    if (!this.scanKey()) {
      this.addError("Invalid key", start);
      this.skipToRecoveryPoint();
    }
  }

  private validateValueForKey(): void {
    this.skipWsAndComments();

    const char = this.peek();
    if (char === "(") {
      this.advance();
      this.validateObjectContents();
    } else if (char === "[") {
      this.advance();
      this.validateArrayContents();
    } else if (char === "=") {
      this.advance();
      this.skipWsAndComments();
      // After = we can have an object, array, or scalar
      const afterEquals = this.peek();
      if (afterEquals === "(") {
        this.advance();
        this.validateObjectContents();
      } else if (afterEquals === "[") {
        this.advance();
        this.validateArrayContents();
      } else {
        this.validateScalar({ allowBoundary: true });
      }
    } else {
      this.addError("Expected '(', '[', or '=' after key", this.pos);
      this.skipToRecoveryPoint();
    }
  }

  private validateObjectContents(): void {
    this.skipWsAndComments();
    if (this.consume(")")) return;

    while (true) {
      if (this.eos()) {
        this.addError("Unclosed object - expected ')'", this.pos);
        return;
      }

      this.validateKey();
      if (!this.consume("=")) {
        this.addError("Expected '=' in object", this.pos);
        this.skipToRecoveryPoint();
        return;
      }
      this.validateValue();

      this.skipWsAndComments();

      if (this.eos()) {
        this.addError("Unclosed object - expected ')'", this.pos);
        return;
      }

      if (this.consume(")")) break;

      if (!this.consume(",")) {
        this.addError("Expected ',' or ')' in object", this.pos);
        this.skipToRecoveryPoint();
        return;
      }
      this.skipWsAndComments();
    }
  }

  private validateArrayContents(): void {
    const lengthStart = this.pos;
    const length = this.scanInteger();
    if (length === null) {
      this.addError("Expected array length", lengthStart);
      this.skipToRecoveryPoint();
      return;
    }

    if (!this.consume("]")) {
      this.addError("Expected ']' after array length", this.pos);
      this.skipToRecoveryPoint();
      return;
    }

    this.skipWsAndComments();

    // Check for table header
    let headerLength = 0;
    const hasHeader = this.peek() === "{";
    if (hasHeader) {
      this.advance(); // consume {
      headerLength = this.validateHeader();
    }

    if (!this.consume("=")) {
      this.addError("Expected '=' after array declaration", this.pos);
      this.skipToRecoveryPoint();
      return;
    }

    if (length === 0) return;

    if (hasHeader) {
      this.validateTableRows(length, headerLength);
    } else {
      this.validateArrayElements(length);
    }
  }

  private validateHeader(): number {
    let count = 0;
    while (true) {
      this.validateKey();
      count++;
      this.skipWsAndComments();
      if (this.consume("}")) break;

      if (!this.consume(",")) {
        this.addError("Expected ',' or '}' in header", this.pos);
        this.skipToRecoveryPoint();
        return count;
      }
    }
    return count;
  }

  private validateTableRows(length: number, headerLength: number): void {
    for (let rowIndex = 0; rowIndex < length; rowIndex++) {
      for (let colIndex = 0; colIndex < headerLength; colIndex++) {
        const allowBoundary = rowIndex === length - 1 && colIndex === headerLength - 1;
        this.validateScalar({ allowBoundary });
        this.skipWsAndComments();
        // Consume comma between columns (except last column)
        if (colIndex < headerLength - 1) {
          this.consume(",");
        }
      }
      // Consume semicolon between rows (except last row)
      this.skipWsAndComments();
      if (rowIndex < length - 1) {
        this.consume(";");
      }
    }
  }

  private validateArrayElements(length: number): void {
    for (let i = 0; i < length; i++) {
      this.validateValue({ allowBoundary: i === length - 1 });
      this.skipWsAndComments();
      if (i < length - 1) {
        this.consume(",");
      }
    }
  }

  private validateValue({ allowBoundary = false }: { allowBoundary?: boolean } = {}): void {
    this.skipWsAndComments();

    const char = this.peek();
    if (char === "(") {
      this.advance();
      this.validateObjectContents();
    } else if (char === "[") {
      this.advance();
      this.validateArrayContents();
    } else {
      this.validateScalar({ allowBoundary });
    }
  }

  private validateScalar({
    allowBoundary: _allowBoundary = false,
  }: {
    allowBoundary?: boolean;
  } = {}): void {
    this.skipWsAndComments();
    if (this.peek() === '"') {
      this.validateString();
      return;
    }

    const start = this.pos;
    this.scanUntilTerminator();

    if (this.pos === start) {
      this.addError("Empty value", start);
    }
  }

  private scanUntilTerminator(): void {
    while (this.pos < this.length) {
      const char = this.rawString[this.pos];
      if ([",", ";", ")", "]", "}"].includes(char) || /^\s$/.test(char)) {
        break;
      }
      this.pos++;
    }
  }

  private validateString(): void {
    const start = this.pos;
    this.advance(); // consume opening quote

    while (true) {
      if (this.eos()) {
        this.addError("Unterminated string", start);
        return;
      }

      const char = this.advance();

      if (char === "\\") {
        if (this.eos()) {
          this.addError("Invalid escape sequence", this.pos - 1);
          return;
        }
        const escaped = this.advance();
        const validEscapes = ["n", "r", "t", '"', "\\"];
        if (!validEscapes.includes(escaped)) {
          this.addError(`Unsupported escape sequence '\\${escaped}'`, this.pos - 2);
        }
      } else if (char === '"') {
        return;
      }
    }
  }

  private checkTrailingContent(): void {
    this.skipWsAndComments();
    if (this.eos()) return;

    this.addError("Unexpected trailing data", this.pos);
  }
}
