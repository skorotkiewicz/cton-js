/**
 * CTON Schema - Validation DSL for CTON data
 */

export const PATH_ROOT = "root";

export interface SchemaErrorJSON {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export class SchemaError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;

  constructor({
    path,
    message,
    expected,
    actual,
  }: { path: string; message: string; expected?: string; actual?: string }) {
    this.path = path;
    this.message = message;
    this.expected = expected;
    this.actual = actual;
  }

  toString(): string {
    const details: string[] = [];
    if (this.expected) details.push(`expected ${this.expected}`);
    if (this.actual) details.push(`got ${this.actual}`);
    const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
    return `${this.path}: ${this.message}${suffix}`;
  }

  toJSON(): SchemaErrorJSON {
    return {
      path: this.path,
      message: this.message,
      expected: this.expected,
      actual: this.actual,
    };
  }
}

export interface ResultJSON {
  valid: boolean;
  errors: SchemaErrorJSON[];
}

export class Result {
  errors: SchemaError[];

  constructor(errors: SchemaError[] = []) {
    this.errors = errors;
  }

  get valid(): boolean {
    return this.errors.length === 0;
  }

  toString(): string {
    if (this.valid) return "Valid schema";
    const messages = this.errors.map((e) => e.toString());
    return `Schema violations:\n  ${messages.join("\n  ")}`;
  }

  toJSON(): ResultJSON {
    return {
      valid: this.valid,
      errors: this.errors.map((e) => e.toJSON()),
    };
  }
}

export abstract class Node {
  abstract validate(value: unknown, path: string, errors: SchemaError[]): void;
}

export class AnySchema extends Node {
  validate(_value: unknown, _path: string, _errors: SchemaError[]): void {
    // Accepts any value
  }
}

export class NullableSchema extends Node {
  inner: Node;

  constructor(inner: Node) {
    super();
    this.inner = inner;
  }

  validate(value: unknown, path: string, errors: SchemaError[]): void {
    if (value === null || value === undefined) return;
    this.inner.validate(value, path, errors);
  }
}

export class OptionalSchema extends Node {
  inner: Node;

  constructor(inner: Node) {
    super();
    this.inner = inner;
  }

  validate(value: unknown, path: string, errors: SchemaError[]): void {
    if (value === null || value === undefined) return;
    this.inner.validate(value, path, errors);
  }
}

export class ScalarSchema extends Node {
  types: string[];
  enum: unknown[] | null;

  constructor({
    types = null,
    enum: enumValues = null,
  }: { types?: string[] | null; enum?: unknown[] | null } = {}) {
    super();
    this.types = types || ["string", "number", "boolean", "null"];
    this.enum = enumValues ?? null;
  }

  validate(value: unknown, path: string, errors: SchemaError[]): void {
    if (this.enum !== null && !this.enum.includes(value)) {
      errors.push(
        new SchemaError({
          path,
          message: "Unexpected value",
          expected: JSON.stringify(this.enum),
          actual: JSON.stringify(value),
        }),
      );
      return;
    }

    const valueType = value === null ? "null" : typeof value;
    if (!this.types.includes(valueType)) {
      errors.push(
        new SchemaError({
          path,
          message: "Unexpected type",
          expected: this.types.join(" | "),
          actual: valueType,
        }),
      );
    }
  }
}

export class ObjectSchema extends Node {
  required: Record<string, Node>;
  optionalKeys: Record<string, Node>;
  allowExtra: boolean;

  constructor({
    required,
    optionalKeys,
    allowExtra,
  }: { required: Record<string, Node>; optionalKeys: Record<string, Node>; allowExtra: boolean }) {
    super();
    this.required = required;
    this.optionalKeys = optionalKeys;
    this.allowExtra = allowExtra;
  }

  validate(value: unknown, path: string, errors: SchemaError[]): void {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(
        new SchemaError({
          path,
          message: "Expected object",
          expected: "object",
          actual: value === null ? "null" : typeof value,
        }),
      );
      return;
    }

    const valueKeys = Object.keys(value as Record<string, unknown>);
    const allSchemas = { ...this.required, ...this.optionalKeys };
    const allSchemaKeys = Object.keys(allSchemas);

    // Check required keys
    for (const key of Object.keys(this.required)) {
      if (!valueKeys.includes(key)) {
        errors.push(
          new SchemaError({
            path: `${path}.${key}`,
            message: "Missing required key",
            expected: key,
            actual: "missing",
          }),
        );
      }
    }

    // Validate present keys
    for (const key of Object.keys(allSchemas)) {
      if (valueKeys.includes(key)) {
        allSchemas[key].validate((value as Record<string, unknown>)[key], `${path}.${key}`, errors);
      }
    }

    // Check for extra keys
    if (!this.allowExtra) {
      const extras = valueKeys.filter((k) => !allSchemaKeys.includes(k));
      for (const key of extras) {
        errors.push(
          new SchemaError({
            path: `${path}.${key}`,
            message: "Unexpected key",
            expected: allSchemaKeys.join(", "),
            actual: key,
          }),
        );
      }
    }
  }
}

export class ArraySchema extends Node {
  itemSchema: Node;
  length?: number | null;
  min?: number | null;
  max?: number | null;

  constructor({
    itemSchema,
    length,
    min,
    max,
  }: { itemSchema?: Node; length?: number | null; min?: number | null; max?: number | null } = {}) {
    super();
    this.itemSchema = itemSchema || new AnySchema();
    this.length = length;
    this.min = min;
    this.max = max;
  }

  validate(value: unknown, path: string, errors: SchemaError[]): void {
    if (!Array.isArray(value)) {
      errors.push(
        new SchemaError({
          path,
          message: "Expected array",
          expected: "array",
          actual: typeof value,
        }),
      );
      return;
    }

    if (this.length !== undefined && this.length !== null && value.length !== this.length) {
      errors.push(
        new SchemaError({
          path,
          message: "Unexpected array length",
          expected: String(this.length),
          actual: String(value.length),
        }),
      );
    }

    if (this.min !== undefined && this.min !== null && value.length < this.min) {
      errors.push(
        new SchemaError({
          path,
          message: "Array length below minimum",
          expected: String(this.min),
          actual: String(value.length),
        }),
      );
    }

    if (this.max !== undefined && this.max !== null && value.length > this.max) {
      errors.push(
        new SchemaError({
          path,
          message: "Array length above maximum",
          expected: String(this.max),
          actual: String(value.length),
        }),
      );
    }

    value.forEach((item, index) => {
      this.itemSchema.validate(item, `${path}[${index}]`, errors);
    });
  }
}

export interface ArrayOptions {
  length?: number;
  min?: number;
  max?: number;
  of?: Node;
}

export class Builder {
  object(
    { allowExtra = false }: { allowExtra?: boolean } = {},
    block?: (builder: ObjectBuilder) => void,
  ): ObjectSchema {
    const builder = new ObjectBuilder({ allowExtra });
    if (block) block(builder);
    return builder.toSchema();
  }

  array(
    { length, min, max, of }: ArrayOptions = {},
    block?: (builder: ArrayBuilder) => void,
  ): ArraySchema {
    const builder = new ArrayBuilder({ length, min, max });
    if (of) builder.items(of);
    if (block) block(builder);
    return builder.toSchema();
  }

  nullable(schema: Node): NullableSchema {
    return new NullableSchema(schema);
  }

  optional(schema: Node): OptionalSchema {
    return new OptionalSchema(schema);
  }

  any(): AnySchema {
    return new AnySchema();
  }

  scalar(...types: (string | { enum: unknown[] })[]): ScalarSchema {
    let enumValues: unknown[] | null = null;
    const options = types.find((t) => t && typeof t === "object" && "enum" in t) as
      | { enum: unknown[] }
      | undefined;
    if (options) {
      enumValues = options.enum;
      types = types.filter((t) => t !== options);
    }
    return new ScalarSchema({ types: this.normalizeTypes(types as string[]), enum: enumValues });
  }

  enum(...values: unknown[]): ScalarSchema {
    return new ScalarSchema({
      types: values.map((v) => (v === null ? "null" : typeof v)),
      enum: values,
    });
  }

  string(): ScalarSchema {
    return new ScalarSchema({ types: ["string"] });
  }

  integer(): ScalarSchema {
    return new ScalarSchema({ types: ["number"] });
  }

  float(): ScalarSchema {
    return new ScalarSchema({ types: ["number"] });
  }

  number(): ScalarSchema {
    return new ScalarSchema({ types: ["number"] });
  }

  boolean(): ScalarSchema {
    return new ScalarSchema({ types: ["boolean"] });
  }

  null(): ScalarSchema {
    return new ScalarSchema({ types: ["null"] });
  }

  private normalizeTypes(types: string[]): string[] | null {
    if (types.length === 0) return null;
    return types.flatMap((type) => {
      if (type === "boolean") return ["boolean"];
      if (type === "null") return ["null"];
      if (type === "number") return ["number"];
      return [type];
    });
  }
}

export class ObjectBuilder extends Builder {
  required: Record<string, Node>;
  optionalKeys: Record<string, Node>;
  allowExtra: boolean;

  constructor({ allowExtra = false }: { allowExtra?: boolean } = {}) {
    super();
    this.required = {};
    this.optionalKeys = {};
    this.allowExtra = allowExtra;
  }

  key(name: string | number, schema?: Node | null, block?: (builder: Builder) => Node): void {
    this.required[String(name)] = this.resolveSchema(schema, block);
  }

  optionalKey(
    name: string | number,
    schema?: Node | null,
    block?: (builder: Builder) => Node,
  ): void {
    this.optionalKeys[String(name)] = this.resolveSchema(schema, block);
  }

  allowExtraKeys(): void {
    this.allowExtra = true;
  }

  toSchema(): ObjectSchema {
    return new ObjectSchema({
      required: this.required,
      optionalKeys: this.optionalKeys,
      allowExtra: this.allowExtra,
    });
  }

  private resolveSchema(schema: Node | null | undefined, block?: (builder: Builder) => Node): Node {
    if (schema instanceof Node) return schema;
    if (block) {
      const builder = new Builder();
      return block(builder);
    }
    return new AnySchema();
  }
}

export class ArrayBuilder extends Builder {
  length?: number | null;
  min?: number | null;
  max?: number | null;
  itemSchema?: Node;

  constructor({
    length,
    min,
    max,
  }: { length?: number | null; min?: number | null; max?: number | null } = {}) {
    super();
    this.length = length;
    this.min = min;
    this.max = max;
    this.itemSchema = undefined;
  }

  items(schema: Node, block?: (builder: Builder) => Node): void {
    this.itemSchema =
      schema instanceof Node ? schema : block ? block(new Builder()) : new AnySchema();
  }

  of(schema: Node, block?: (builder: Builder) => Node): void {
    this.items(schema, block);
  }

  toSchema(): ArraySchema {
    return new ArraySchema({
      itemSchema: this.itemSchema,
      length: this.length,
      min: this.min,
      max: this.max,
    });
  }
}

export function define(block: (builder: Builder) => Node): Node {
  const builder = new Builder();
  const schema = block(builder);
  if (!(schema instanceof Node)) {
    throw new Error("Schema definition must return a schema");
  }
  return schema;
}

// Create Schema namespace object
export const Schema = {
  PATH_ROOT,
  Error: SchemaError,
  Result,
  Node,
  AnySchema,
  NullableSchema,
  OptionalSchema,
  ScalarSchema,
  ObjectSchema,
  ArraySchema,
  Builder,
  ObjectBuilder,
  ArrayBuilder,
  define,
};
