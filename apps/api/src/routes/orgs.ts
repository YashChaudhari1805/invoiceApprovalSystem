import { FastifyInstance } from "fastify";

export default async function orgRoutes(app: FastifyInstance) {
  // GET /orgs — every org the caller has a membership in, plus their role
  // in each. This is what powers the org switcher: RLS already restricts
  // `organizations` to rows the user can see, so no manual filtering needed
  // here for the org list itself.
  app.get("/orgs", { preHandler: app.authenticate }, async (req, reply) => {
    const { data: memberships, error } = await req.supabase
      .from("memberships")
      .select("role, organization:organizations(id, name, slug)")
      .eq("user_id", req.user.userId);

    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to load organizations" });
    }

    // Flatten into { id, name, slug, role } — the shape the frontend org
    // switcher actually wants, rather than the nested join shape.
    const orgs = memberships.map((m: any) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: m.role,
    }));

    return reply.send({ orgs });
  });

  // GET /orgs/:orgId — confirms membership and returns the org + the
  // caller's role in it. requireMembership does the actual enforcement;
  // this route just returns what it resolved.
  app.get(
    "/orgs/:orgId",
    { preHandler: [app.authenticate, app.requireMembership] },
    async (req, reply) => {
      const { data, error } = await req.supabase
        .from("organizations")
        .select("id, name, slug")
        .eq("id", req.membership.organizationId)
        .single();

      if (error) {
        req.log.error(error);
        return reply.code(500).send({ error: "Failed to load organization" });
      }

      return reply.send({ ...data, role: req.membership.role });
    }
  );
}
