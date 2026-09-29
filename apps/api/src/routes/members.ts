import { FastifyInstance } from "fastify";
import { can } from "../lib/invoice-rules";
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

  // POST /orgs/:orgId/members — add an existing user (by email) to this org.
  //
  // The membership insert and its MEMBER_ADDED activity entry now happen
  // together inside add_org_member() (see
  // migrations/0009_lockdown_and_audit.sql), instead of as two separate
  // client calls: one fewer place a partial write could happen, and the
  // by-email lookup (which needs to see a profile the caller isn't
  // otherwise allowed to see under RLS, since the target isn't a member of
  // this org yet) happens inside that SECURITY DEFINER function rather than
  // requiring the API to reach for the raw admin/service-role client.
  app.post("/orgs/:orgId/members", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { email, role } = parsed.data;

    const { data, error } = await req.supabase.rpc("add_org_member", {
      p_organization_id: req.membership.organizationId,
      p_email: email,
      p_role: role,
    });

    if (error) {
      switch (error.code) {
        case "P0002":
          return reply.code(404).send({ error: "No user found with that email. They must sign up first." });
        case "23505":
          return reply.code(409).send({ error: "This user is already a member of this organization" });
        case "42501":
          return reply.code(403).send({ error: "Only Admins can manage organization members" });
        case "22023":
          return reply.code(400).send({ error: error.message });
        default:
          req.log.error(error);
          return reply.code(500).send({ error: "Failed to add member" });
      }
    }

    return reply.code(201).send(data);
  });

  // PATCH /orgs/:orgId/members/:membershipId — change a member's role.
  // update_member_role() does the lookup, the self-demotion check, the
  // update and the MEMBER_ROLE_CHANGED entry in one transaction.
  app.patch("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { membershipId } = req.params as { membershipId: string };
    const parsed = updateMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { data, error } = await req.supabase.rpc("update_member_role", {
      p_organization_id: req.membership.organizationId,
      p_membership_id: membershipId,
      p_role: parsed.data.role,
    });

    if (error) {
      switch (error.code) {
        case "P0002":
          return reply.code(404).send({ error: "Membership not found" });
        case "42501":
          // Covers both "not an Admin" and "you cannot change your own role" —
          // the function's message distinguishes them for the client.
          return reply.code(403).send({ error: error.message });
        case "22023":
          return reply.code(400).send({ error: error.message });
        default:
          req.log.error(error);
          return reply.code(500).send({ error: "Failed to update role" });
      }
    }

    return reply.send(data);
  });

  // DELETE /orgs/:orgId/members/:membershipId
  // remove_org_member() does the lookup, the self-removal check, the delete
  // and the MEMBER_REMOVED entry in one transaction.
  app.delete("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { membershipId } = req.params as { membershipId: string };

    const { error } = await req.supabase.rpc("remove_org_member", {
      p_organization_id: req.membership.organizationId,
      p_membership_id: membershipId,
    });

    if (error) {
      switch (error.code) {
        case "P0002":
          return reply.code(404).send({ error: "Membership not found" });
        case "42501":
          return reply.code(403).send({ error: error.message });
        default:
          req.log.error(error);
          return reply.code(500).send({ error: "Failed to remove member" });
      }
    }

    return reply.code(204).send();
  });
}
