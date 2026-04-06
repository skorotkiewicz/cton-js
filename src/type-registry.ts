/**
 * CTON Type Registry - Custom type serializers
 * Allows users to define how custom classes should be encoded to CTON
 */

export type TransformMode = "object" | "array" | "scalar";

export type TransformFunction = (value: unknown) => unknown;

// Type for a class constructor - uses any to allow flexible constructor signatures
// biome-ignore lint/suspicious/noExplicitAny: Required for flexible constructor matching
export type Constructor = new (...args: any[]) => unknown;

export class Handler {
  klass: Constructor;
  mode: TransformMode;
  transform: TransformFunction;

  constructor(klass: Constructor, mode: TransformMode, transform: TransformFunction) {
    this.klass = klass;
    this.mode = mode;
    this.transform = transform;
  }
}

export class TypeRegistry {
  private handlers: Map<Constructor, Handler>;

  constructor() {
    this.handlers = new Map();
  }

  /**
   * Register a custom type handler
   * @param klass - The class/constructor to handle
   * @param as - How to serialize: 'object', 'array', or 'scalar'
   * @param transform - Transformation function
   *
   * @example
   * registry.register(Money, 'object', (money) => ({
   *   amount: money.cents,
   *   currency: money.currency
   * }));
   *
   * @example
   * registry.register(UUID, 'scalar', (uuid) => uuid.toString());
   */
  register<T>(
    klass: Constructor,
    as: TransformMode = "object",
    transform: (value: T) => unknown,
  ): void {
    if (typeof transform !== "function") {
      throw new Error("Transform function required for type registration");
    }

    const validModes: TransformMode[] = ["object", "array", "scalar"];
    if (!validModes.includes(as)) {
      throw new Error(`"as" must be one of: ${validModes.join(", ")}`);
    }

    this.handlers.set(klass, new Handler(klass, as, transform as TransformFunction));
  }

  /**
   * Unregister a type handler
   * @param klass - The class/constructor to unregister
   */
  unregister(klass: Constructor): void {
    this.handlers.delete(klass);
  }

  /**
   * Check if a handler exists for a class
   * @param klass - The class to check
   * @returns boolean
   */
  registered(klass: Constructor): boolean {
    if (this.handlers.has(klass)) return true;
    return this.findHandlerForAncestors(klass) !== null;
  }

  /**
   * Transform a value using its registered handler
   * Returns the value unchanged if no handler is registered
   * @param value - The value to transform
   * @returns The transformed value
   */
  transform(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    const handler = this.findHandler((value as object).constructor as Constructor);
    if (!handler) return value;

    return handler.transform(value);
  }

  /**
   * Get the handler for a class
   * @param klass - The class to look up
   * @returns Handler or null
   */
  handlerFor(klass: Constructor): Handler | null {
    return this.findHandler(klass);
  }

  /**
   * List all registered types
   * @returns Array of constructors
   */
  get registeredTypes(): Constructor[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all registered handlers
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Find handler for a class
   * @private
   */
  private findHandler(klass: Constructor): Handler | null {
    // Direct match
    if (this.handlers.has(klass)) {
      return this.handlers.get(klass) || null;
    }

    // Check ancestors (for inheritance support)
    return this.findHandlerForAncestors(klass);
  }

  /**
   * Find handler for class ancestors
   * @private
   */
  private findHandlerForAncestors(klass: Constructor): Handler | null {
    // Walk up the prototype chain
    let current: Constructor | null = klass;
    while (current && current !== Object) {
      if (this.handlers.has(current)) {
        return this.handlers.get(current) || null;
      }
      current = Object.getPrototypeOf(current) as Constructor | null;
    }
    return null;
  }
}
