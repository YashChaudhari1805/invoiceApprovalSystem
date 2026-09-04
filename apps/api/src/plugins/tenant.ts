import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";
import { Role, can } from "../lib/invoice-rules";

declare module "fastify" {
  interface FastifyInstance {
    requireMembership: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    membership: { organizationId: string; role: Role };
  }
}

/**
 * Re-derives the caller's membership fresh on every request by querying
 * `memberships` through req.supabase — the user-scoped client from auth.ts.
 * This query is itself subject to RLS, so even this lookup can't be tricked
 * into returning another user's membership row. If no row comes back, the
 * request is rejected before any invoice data is touched, regardless of
 * what org id or invoice id is in the URL.
 */
export default fp(async (app) => {
  app.decorate(
    "requireMembership",
    async function (req: FastifyRequest, reply: FastifyReply) {
      const orgId = (req.params as any).orgId;
      if (!orgId) {
        reply.code(400).send({ error: "Missing organization id" });
        return;
      }

      const { data, error } = await req.supabase
        .from("memberships")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", req.user.userId)
        .maybeSingle();

      if (error) {
        req.log.error(error);
        reply.code(500).send({ error: "Failed to resolve membership" });
        return;
      }

      if (!data) {
        // Same 403 whether the org doesn't exist or the user just isn't a
        // member — don't leak which orgs exist to an unauthorized caller.
        reply.code(403).send({ error: "Forbidden" });
        return;
      }

      req.membership = { organizationId: orgId, role: data.role as Role };
    }
  );
});

export function requirePermission(permission: Parameters<typeof can>[1]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!can(req.membership.role, permission)) {
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
  };
}
