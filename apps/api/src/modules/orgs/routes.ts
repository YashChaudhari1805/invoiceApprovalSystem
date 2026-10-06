import type { FastifyInstance } from "fastify";
import { fail, sendFailure } from "../../shared/http";
import type { Role } from "../../shared/permissions";

// Shape of the `memberships` + joined `organizations` select. The Supabase client
// can't infer a join's cardinality without generated types, so it is stated once here.
interface MembershipWithOrg {
  role: Role;
  organization: { id: string; name: string; slug: string } | null;
}

export default async function orgRoutes(app: FastifyInstance) {
  // GET /orgs: every org the caller belongs to, with their role. Powers the org switcher.
  // RLS already limits `organizations` to rows the user can see.
  app.get("/orgs", { preHandler: app.authenticate }, async (req, reply) => {
    const { data, error } = await req.supabase
      .from("memberships")
      .select("role, organization:organizations(id, name, slug)")
      .eq("user_id", req.user.userId);

    if (error) return sendFailure(req, reply, fail(500, "Failed to load organizations"), error);

    const orgs = (data as unknown as MembershipWithOrg[]).flatMap((m) =>
      m.organization ? [{ id: m.organization.id, name: m.organization.name, slug: m.organization.slug, role: m.role }] : []
    );
    return reply.send({ orgs });
  });

  // GET /orgs/:orgId: the org plus the caller's role (requireMembership does the enforcement).
  app.get("/orgs/:orgId", { preHandler: [app.authenticate, app.requireMembership] }, async (req, reply) => {
    const { data, error } = await req.supabase
      .from("organizations")
      .select("id, name, slug")
      .eq("id", req.membership.organizationId)
      .single();

    if (error) return sendFailure(req, reply, fail(500, "Failed to load organization"), error);
    return reply.send({ ...data, role: req.membership.role });
  });
}
