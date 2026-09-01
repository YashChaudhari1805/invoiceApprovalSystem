// Runs the actual Fastify app in-process (no port bound) and sends it real
// HTTP requests via .inject(), using real access tokens from your live
// Supabase project. This is the closest thing to an end-to-end test without
// needing a deployed server.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
// env vars are loaded by test/setup.ts (see vitest.config.ts's setupFiles)
// before this file — and its import of src/app.ts — is evaluated
import { buildApp } from "../../src/app";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

async function tokenFor(email: string): Promise<string> {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return data.session!.access_token;
}

const app = buildApp({ logger: false });
let rahulToken: string;

beforeAll(async () => {
  await app.ready();
  rahulToken = await tokenFor("rahul@example.com");
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("responds ok with no auth required", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("GET /orgs", () => {
  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/orgs" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orgs",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns Rahul's orgs with his correct per-org role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orgs",
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const abc = body.orgs.find((o: any) => o.slug === "abc-steel");
    const xyz = body.orgs.find((o: any) => o.slug === "xyz-metals");
    expect(abc.role).toBe("ADMIN");
    expect(xyz.role).toBe("VIEWER");
  });
});

describe("GET /orgs/:orgId", () => {
  it("404s (via requireMembership's 403) for a made-up org id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/orgs/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
