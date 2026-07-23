import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, makeThreadProjectionFixture } from "./test-fixtures";

describe("V2 thread fixtures", () => {
  it("creates projection fixtures with explicit active settlement state", () => {
    const projection = makeThreadProjectionFixture();

    expect(projection.thread.settledOverride).toBeNull();
    expect(projection.thread.settledAt).toBeNull();
  });

  it("projects settlement overrides into both shell and source fields", () => {
    const settledAt = "2026-01-02T03:04:05.000Z";
    const thread = makeThreadFixture({ settledOverride: "settled", settledAt });

    expect(thread.settledOverride).toBe("settled");
    expect(thread.settledAt).toBe(settledAt);
    expect(thread.source.settledOverride).toBe("settled");
    expect(
      thread.source.settledAt === null ? null : DateTime.formatIso(thread.source.settledAt),
    ).toBe(settledAt);
  });
});
