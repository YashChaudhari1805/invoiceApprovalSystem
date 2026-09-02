import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../../src/app";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function loginAs(email: string) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
  return data.session!.access_token;
}

const app = buildApp({ logger: false });
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

let rahulToken: string; // Admin @ ABC Steel
let priyaToken: string; // Reviewer @ ABC Steel — not allowed to manage members
let abcSteelId: string;

// A disposable user created fresh for this test file, added to and removed
// from ABC Steel over the course of the tests, then deleted entirely in
// afterAll — this file doesn't touch Rahul/Priya's own memberships at all.
let tempUserEmail: string;
let tempUserId: string;

beforeAll(async () => {
  await app.ready();
  rahulToken = await loginAs("rahul@example.com");
  priyaToken = await loginAs("priya@example.com");

  const orgsRes = await app.inject({
    method: "GET",
    url: "/orgs",
    headers: { authorization: `Bearer ${rahulToken}` },
  });
  abcSteelId = orgsRes.json().orgs.find((o: any) => o.slug === "abc-steel").id;

  tempUserEmail = `member-test-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email: tempUserEmail,
    password: "password123",
    email_confirm: true,
    user_metadata: { name: "Temp Test User" },
  });
  if (error) throw error;
  tempUserId = data.user!.id;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(tempUserId);
  await app.close();
});

describe("GET /orgs/:orgId/members", () => {
  it("Admin can list members", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().members.length).toBeGreaterThanOrEqual(2); // Rahul + Priya at minimum
  });

  it("Reviewer (Priya) is forbidden from viewing the members screen", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${priyaToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /orgs/:orgId/members", () => {
  it("Admin can add an existing user by email", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { email: tempUserEmail, role: "VIEWER" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("VIEWER");
  });

  it("returns 409 when adding the same user to the same org twice", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { email: tempUserEmail, role: "OPERATOR" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for an email with no matching account", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { email: "nobody-real@example.com", role: "VIEWER" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("Reviewer cannot add members", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${priyaToken}` },
      payload: { email: tempUserEmail, role: "VIEWER" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /orgs/:orgId/members/:membershipId", () => {
  it("Admin can change the temp user's role from Viewer to Operator", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    const membership = listRes.json().members.find((m: any) => m.user.id === tempUserId);

    const res = await app.inject({
      method: "PATCH",
      url: `/orgs/${abcSteelId}/members/${membership.id}`,
      headers: { authorization: `Bearer ${rahulToken}` },
      payload: { role: "OPERATOR" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("OPERATOR");
    // Same underlying user id — confirms this was an update, not a
    // delete-and-recreate of the account.
    expect(res.json().user.id).toBe(tempUserId);
  });
});

describe("DELETE /orgs/:orgId/members/:membershipId", () => {
  it("Admin can remove the temp user from the org", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    const membership = listRes.json().members.find((m: any) => m.user.id === tempUserId);

    const res = await app.inject({
      method: "DELETE",
      url: `/orgs/${abcSteelId}/members/${membership.id}`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(res.statusCode).toBe(204);

    const listAfter = await app.inject({
      method: "GET",
      url: `/orgs/${abcSteelId}/members`,
      headers: { authorization: `Bearer ${rahulToken}` },
    });
    expect(listAfter.json().members.find((m: any) => m.user.id === tempUserId)).toBeUndefined();
  });
});
