import { describe, it, expect } from "vitest";
import { isUuid } from "../../src/lib/uuid";

describe("isUuid", () => {
  it("accepts ordinary v4 UUIDs, in either case", () => {
    expect(isUuid("9103ce8d-59a5-445a-ba1b-9bd2d1a13dfc")).toBe(true);
    expect(isUuid("9103CE8D-59A5-445A-BA1B-9BD2D1A13DFC")).toBe(true);
  });

  it("accepts the all-zero and other synthetic UUIDs Postgres itself accepts", () => {
    // Stricter validators (e.g. zod 4's .uuid()) reject these; the tests use
    // them as "valid but nonexistent" ids, so this must stay permissive.
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("rejects anything that would fail Postgres' uuid cast", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "9103ce8d59a5445aba1b9bd2d1a13dfc", // no dashes
      "9103ce8d-59a5-445a-ba1b-9bd2d1a13df", // one digit short
      "9103ce8d-59a5-445a-ba1b-9bd2d1a13dfcc", // one digit long
      "9103ce8d-59a5-445a-ba1b-9bd2d1a13dfz", // non-hex
      " 9103ce8d-59a5-445a-ba1b-9bd2d1a13dfc", // leading space
      "9103ce8d-59a5-445a-ba1b-9bd2d1a13dfc\n", // trailing newline ($ must not match before it)
      "1' OR '1'='1",
    ]) {
      expect(isUuid(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const bad of [undefined, null, 42, {}, ["9103ce8d-59a5-445a-ba1b-9bd2d1a13dfc"]]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});
