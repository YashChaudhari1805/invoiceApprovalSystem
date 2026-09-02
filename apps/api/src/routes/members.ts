import { FastifyInstance } from "fastify";
import { can } from "../lib/invoice-rules";
import { getSupabaseAdmin } from "../lib/supabase";
import { addMemberSchema, updateMemberRoleSchema } from "../modules/members/schemas";

export default async function memberRoutes(app: FastifyInstance) {
  const preHandler = [app.authenticate, app.requireMembership];

  // The entire members screen is Admin-only per the spec ("accessible to
  // Admin users"), so every route in this file gets this same guard rather
  // than allowing broader read access.
  function requireAdmin(req: any, reply: any) {
    if (!can(req.membership.role, "member:manage")) {
      reply.code(403).send({ error: "Only Admins can manage organization members" });
      return false;
    }
    return true;
  }

  // GET /orgs/:orgId/members
  app.get("/orgs/:orgId/members", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { data, error } = await req.supabase
      .from("memberships")
      .select("id, role, created_at, user:profiles(id, name, email)")
      .eq("organization_id", req.membership.organizationId)
      .order("created_at", { ascending: true });

    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to load members" });
    }
    return reply.send({ members: data });
  });

  // POST /orgs/:orgId/members — add an existing user (by email) to this org
  app.post("/orgs/:orgId/members", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { email, role } = parsed.data;

    // Looking up a user by email has to use the admin client: the caller's
    // RLS-scoped client can only see profiles of people who already share
    // an org with them, which by definition excludes someone not yet
    // added — a chicken-and-egg problem inherent to invite flows. The admin
    // client is used ONLY for this read; the actual membership insert below
    // still goes through the caller's own RLS-scoped client, so "can this
    // admin actually add members to this org" is still enforced by the
    // `memberships manageable by admins` policy, not bypassed.
    const { data: targetUser, error: lookupError } = await getSupabaseAdmin()
      .from("profiles")
      .select("id, name, email")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      req.log.error(lookupError);
      return reply.code(500).send({ error: "Failed to look up user" });
    }
    if (!targetUser) {
      return reply.code(404).send({ error: "No user found with that email. They must sign up first." });
    }

    const { data: membership, error: insertError } = await req.supabase
      .from("memberships")
      .insert({
        user_id: targetUser.id,
        organization_id: req.membership.organizationId,
        role,
      })
      .select("id, role, created_at, user:profiles(id, name, email)")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return reply.code(409).send({ error: "This user is already a member of this organization" });
      }
      req.log.error(insertError);
      return reply.code(500).send({ error: "Failed to add member" });
    }

    await req.supabase.from("activity_log").insert({
      organization_id: req.membership.organizationId,
      actor_id: req.user.userId,
      action: "MEMBER_ADDED",
      metadata: { targetUserId: targetUser.id, role },
    });

    return reply.code(201).send(membership);
  });

  // PATCH /orgs/:orgId/members/:membershipId — change a member's role.
  // This updates the existing membership row, never touches the User/
  // profiles account itself (per spec: "should update the membership
  // without recreating the user account").
  app.patch("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { membershipId } = req.params as { membershipId: string };
    const parsed = updateMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { data: before, error: beforeError } = await req.supabase
      .from("memberships")
      .select("role")
      .eq("id", membershipId)
      .eq("organization_id", req.membership.organizationId)
      .maybeSingle();

    if (beforeError) {
      req.log.error(beforeError);
      return reply.code(500).send({ error: "Failed to load membership" });
    }
    if (!before) {
      return reply.code(404).send({ error: "Membership not found" });
    }

    const { data: updated, error: updateError } = await req.supabase
      .from("memberships")
      .update({ role: parsed.data.role })
      .eq("id", membershipId)
      .select("id, role, created_at, user:profiles(id, name, email)")
      .single();

    if (updateError) {
      req.log.error(updateError);
      return reply.code(500).send({ error: "Failed to update role" });
    }

    await req.supabase.from("activity_log").insert({
      organization_id: req.membership.organizationId,
      actor_id: req.user.userId,
      action: "MEMBER_ROLE_CHANGED",
      metadata: { membershipId, from: before.role, to: parsed.data.role },
    });

    return reply.send(updated);
  });

  // DELETE /orgs/:orgId/members/:membershipId
  app.delete("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { membershipId } = req.params as { membershipId: string };

    const { data: existing, error: fetchError } = await req.supabase
      .from("memberships")
      .select("id, user_id")
      .eq("id", membershipId)
      .eq("organization_id", req.membership.organizationId)
      .maybeSingle();

    if (fetchError) {
      req.log.error(fetchError);
      return reply.code(500).send({ error: "Failed to load membership" });
    }
    if (!existing) {
      return reply.code(404).send({ error: "Membership not found" });
    }

    const { error: deleteError } = await req.supabase.from("memberships").delete().eq("id", membershipId);
    if (deleteError) {
      req.log.error(deleteError);
      return reply.code(500).send({ error: "Failed to remove member" });
    }

    await req.supabase.from("activity_log").insert({
      organization_id: req.membership.organizationId,
      actor_id: req.user.userId,
      action: "MEMBER_REMOVED",
      metadata: { removedUserId: existing.user_id },
    });

    return reply.code(204).send();
  });
}
