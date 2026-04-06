/**
 * Basic tests for CTON npm package (TypeScript)
 * Run with: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import * as CTON from "../index";

describe("CTON Core", () => {
  it("dump and load round-trip", () => {
    const payload = {
      user: { id: 42, name: "Ada" },
      tags: ["llm", "compact"],
      events: [
        { id: 1, action: "login" },
        { id: 2, action: "upload" },
      ],
    };

    const cton = CTON.dump(payload);
    const roundTrip = CTON.load(cton);

    assert.deepStrictEqual(roundTrip, payload);
  });

  it("encodes simple object", () => {
    const result = CTON.dump({ a: 1, b: "hello" });
    assert.strictEqual(result, "a=1\nb=hello");
  });

  it("encodes nested object", () => {
    const result = CTON.dump({ user: { name: "Ada" } });
    assert.strictEqual(result, "user(name=Ada)");
  });

  it("encodes array", () => {
    const result = CTON.dump({ tags: ["a", "b", "c"] });
    assert.strictEqual(result, "tags[3]=a,b,c");
  });

  it("encodes table array", () => {
    const result = CTON.dump({
      users: [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bob" },
      ],
    });
    assert.strictEqual(result, "users[2]{id,name}=1,Ada;2,Bob");
  });

  it("handles booleans and null", () => {
    const result = CTON.dump({ flag: true, empty: null, nope: false });
    assert.strictEqual(result, "flag=true\nempty=null\nnope=false");
  });

  it("handles numbers", () => {
    const result = CTON.dump({ int: 42, float: 3.14 });
    assert.strictEqual(result, "int=42\nfloat=3.14");
  });

  it("quotes strings with special chars", () => {
    const result = CTON.dump({ msg: "hello, world" });
    assert.strictEqual(result, 'msg="hello, world"');
  });
});

describe("CTON Validation", () => {
  it("valid CTON passes", () => {
    const result = CTON.validate("key=value");
    assert.strictEqual(result.valid, true);
  });

  it("invalid CTON fails", () => {
    const result = CTON.validate("key=(broken");
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("isValid returns boolean", () => {
    assert.strictEqual(CTON.isValid("a=1"), true);
    assert.strictEqual(CTON.isValid("(broken"), false);
  });
});

describe("CTON Schema", () => {
  it("schema validation passes", () => {
    const schema = CTON.schema((b) =>
      b.object({}, (builder) => {
        builder.key("id", b.integer());
        builder.key("name", b.string());
      }),
    );

    const result = CTON.validateSchema({ id: 1, name: "Test" }, schema);
    assert.strictEqual(result.valid, true);
  });

  it("schema validation fails on type mismatch", () => {
    const schema = CTON.schema((b) =>
      b.object({}, (builder) => {
        builder.key("id", b.integer());
      }),
    );

    const result = CTON.validateSchema({ id: "not a number" }, schema);
    assert.strictEqual(result.valid, false);
  });

  it("schema validation fails on missing key", () => {
    const schema = CTON.schema((b) =>
      b.object({}, (builder) => {
        builder.key("required", b.string());
      }),
    );

    const result = CTON.validateSchema({}, schema);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("Missing required key")));
  });
});

describe("CTON Stats", () => {
  it("stats returns comparison data", () => {
    const data = { name: "test", values: [1, 2, 3] };
    const stats = CTON.stats(data);

    assert.ok(stats.jsonChars > 0);
    assert.ok(stats.ctonChars > 0);
    assert.ok(stats.savingsPercent >= 0);
  });

  it("stats toJSON returns plain object", () => {
    const data = { a: 1, b: 2 };
    const json = CTON.statsHash(data);

    assert.ok(typeof json === "object");
    assert.ok("json_chars" in json);
    assert.ok("cton_chars" in json);
  });
});

describe("CTON Binary", () => {
  it("binary round-trip", () => {
    const payload = { user: { id: 1, name: "Test" }, tags: ["a", "b"] };
    const binary = CTON.dumpBinary(payload);
    const roundTrip = CTON.loadBinary(binary);

    assert.deepStrictEqual(roundTrip, payload);
  });
});

describe("CTON Pretty Print", () => {
  it("pretty format adds newlines and indentation", () => {
    const payload = { a: { b: 1 } };
    const pretty = CTON.dump(payload, { pretty: true });

    assert.ok(pretty.includes("\n"));
    assert.ok(pretty.includes("  "));
  });
});

describe("CTON Type Registry", () => {
  it("custom type registration", () => {
    class Point {
      x: number;
      y: number;
      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
    }

    CTON.registerType(Point, { as: "object" }, (p: Point) => ({ x: p.x, y: p.y }));

    const point = new Point(10, 20);
    const result = CTON.dump({ point });

    assert.ok(result.includes("x=10"));
    assert.ok(result.includes("y=20"));

    CTON.unregisterType(Point);
  });
});
