"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";

type Role = "ADMIN" | "OPERATOR" | "REVIEWER" | "VIEWER";

async function getAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export async function addMemberAction(
  orgId: string,
  email: string,
  role: Role
): Promise<{ error?: string }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/members`, token, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    revalidatePath(`/orgs/${orgId}/members`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add member" };
  }
}

export async function updateMemberRoleAction(
  orgId: string,
  membershipId: string,
  role: Role
): Promise<{ error?: string }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/members/${membershipId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    revalidatePath(`/orgs/${orgId}/members`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update role" };
  }
}

export async function removeMemberAction(
  orgId: string,
  membershipId: string
): Promise<{ error?: string }> {
  try {
    const token = await getAccessToken();
    await apiFetch(`/orgs/${orgId}/members/${membershipId}`, token, { method: "DELETE" });
    revalidatePath(`/orgs/${orgId}/members`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}
