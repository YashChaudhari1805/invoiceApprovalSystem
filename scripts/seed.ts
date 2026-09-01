// Run with: npx tsx scripts/seed.ts
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// (service role key only — never expose this key to the frontend)

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

// service role client bypasses RLS entirely — that's expected and required
// for a seed script, since nothing is authenticated as a real user yet
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createUser(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true, // skip the confirmation email for seed users
    user_metadata: { name },
  });
  if (error) throw error;
  return data.user.id; // profiles row is auto-created by the on_auth_user_created trigger
}

async function main() {
  console.log("Creating users...");
  const rahulId = await createUser("rahul@example.com", "Rahul");
  const priyaId = await createUser("priya@example.com", "Priya");

  console.log("Creating organizations...");
  const { data: abcSteel, error: abcErr } = await admin
    .from("organizations")
    .insert({ name: "ABC Steel", slug: "abc-steel" })
    .select()
    .single();
  if (abcErr) throw abcErr;

  const { data: xyzMetals, error: xyzErr } = await admin
    .from("organizations")
    .insert({ name: "XYZ Metals", slug: "xyz-metals" })
    .select()
    .single();
  if (xyzErr) throw xyzErr;

  console.log("Creating memberships...");
  const { error: memErr } = await admin.from("memberships").insert([
    { user_id: rahulId, organization_id: abcSteel.id, role: "ADMIN" },
    { user_id: rahulId, organization_id: xyzMetals.id, role: "VIEWER" },
    { user_id: priyaId, organization_id: abcSteel.id, role: "REVIEWER" },
  ]);
  if (memErr) throw memErr;

  console.log("\nSeed complete.");
  console.log("Login as rahul@example.com or priya@example.com, password: password123");
  console.log(`ABC Steel org id: ${abcSteel.id}`);
  console.log(`XYZ Metals org id: ${xyzMetals.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
