import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

declare module "fastify" {
  interface FastifyRequest {
    membership: { organizationId: string; role: Role };
  }
}

/**
 * Every org-scoped route reads the org id from the URL (e.g. /orgs/:orgId/invoices)
 * and this hook re-derives the caller's membership fresh from the DB on every
 * request. It never trusts a client-supplied role/org claim. If the user has
 * no membership row for that org, the request is rejected before it ever
 * touches invoice data — so tampering with an invoice id or org id in the
 * URL can't leak another tenant's data, because the lookups below are always
 * scoped by (organizationId AND membership), not by invoice id alone.
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

      const membership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: req.user.userId,
            organizationId: orgId,
          },
        },
      });

      if (!membership) {
        // Deliberately the same 403 whether the org doesn't exist or the
        // user just isn't a member of it — don't leak which orgs exist.
        reply.code(403).send({ error: "Forbidden" });
        return;
      }

      req.membership = {
        organizationId: membership.organizationId,
        role: membership.role,
      };
    }
  );
});

// Simple declarative permission table, checked against req.membership.role.
// Keeping this as data (not scattered if-statements) makes it easy to audit
// against the spec's permission matrix and to unit test directly.
const PERMISSIONS: Record<string, Role[]> = {
  "invoice:view": ["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"],
  "invoice:create": ["ADMIN", "OPERATOR"],
  "invoice:edit": ["ADMIN", "OPERATOR"], // edit-in-draft/review is checked against invoice.status separately
  "invoice:approve": ["ADMIN", "REVIEWER"],
  "member:manage": ["ADMIN"],
};

export function can(role: Role, permission: keyof typeof PERMISSIONS) {
  return PERMISSIONS[permission].includes(role);
}

export function requirePermission(permission: keyof typeof PERMISSIONS) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!can(req.membership.role, permission)) {
      reply.code(403).send({ error: "Forbidden" });
    }
  };
}
