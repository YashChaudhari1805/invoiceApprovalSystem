import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { can } from "../../shared/permissions";
import { fail, sendFailure } from "../../shared/http";
import { mapAddError, mapRemoveError, mapRoleError } from "./errors";
import { addMemberSchema, updateMemberRoleSchema } from "./schemas";

// The whole members screen is Admin-only, so every route here shares this guard.
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!can(req.membership.role, "member:manage")) {
    return sendFailure(req, reply, fail(403, "Only Admins can manage organization members"));
  }
}

export default async function memberRoutes(app: FastifyInstance) {
  const preHandler = [app.authenticate, app.requireMembership, requireAdmin];

  app.get("/orgs/:orgId/members", { preHandler }, async (req, reply) => {
    const { data, error } = await req.supabase
      .from("memberships")
      .select("id, role, created_at, user:profiles(id, name, email)")
      .eq("organization_id", req.membership.organizationId)
      .order("created_at", { ascending: true });

    if (error) return sendFailure(req, reply, fail(500, "Failed to load members"), error);
    return reply.send({ members: data });
  });

  // Add an existing user (by email). The membership insert and its MEMBER_ADDED audit entry
  // happen together in add_org_member() (migrations/0009), which also does the by-email lookup.
  app.post("/orgs/:orgId/members", { preHandler }, async (req, reply) => {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid input", { details: parsed.error.flatten() }));
    }
    const { data, error } = await req.supabase.rpc("add_org_member", {
      p_organization_id: req.membership.organizationId,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    });
    if (error) return sendFailure(req, reply, mapAddError(error), error);
    return reply.code(201).send(data);
  });

  // Change a member's role (lookup, self-demotion check, update and audit entry in one transaction).
  app.patch("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    const { membershipId } = req.params as { membershipId: string };
    const parsed = updateMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid input", { details: parsed.error.flatten() }));
    }
    const { data, error } = await req.supabase.rpc("update_member_role", {
      p_organization_id: req.membership.organizationId,
      p_membership_id: membershipId,
      p_role: parsed.data.role,
    });
    if (error) return sendFailure(req, reply, mapRoleError(error), error);
    return reply.send(data);
  });

  // Remove a member (lookup, self-removal check, delete and audit entry in one transaction).
  app.delete("/orgs/:orgId/members/:membershipId", { preHandler }, async (req, reply) => {
    const { membershipId } = req.params as { membershipId: string };
    const { error } = await req.supabase.rpc("remove_org_member", {
      p_organization_id: req.membership.organizationId,
      p_membership_id: membershipId,
    });
    if (error) return sendFailure(req, reply, mapRemoveError(error), error);
    return reply.code(204).send();
  });
}
