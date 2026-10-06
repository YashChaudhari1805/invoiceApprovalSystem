import type { FastifyInstance } from "fastify";
import { fail, sendFailure } from "../../shared/http";

export default async function activityRoutes(app: FastifyInstance) {
  // GET /orgs/:orgId/activity: org-wide audit trail covering invoice events and
  // membership events (adds, role changes, removals).
  app.get("/orgs/:orgId/activity", { preHandler: [app.authenticate, app.requireMembership] }, async (req, reply) => {
    const { data, error } = await req.supabase
      .from("activity_log")
      .select("id, action, metadata, created_at, actor:profiles(id, name), invoice:invoices(id, invoice_number)")
      .eq("organization_id", req.membership.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return sendFailure(req, reply, fail(500, "Failed to load activity"), error);
    return reply.send({ activity: data });
  });
}
