import Fastify from "fastify";
import corsPlugin from "./plugins/cors";
import authPlugin from "./plugins/auth";
import tenantPlugin from "./plugins/tenant";
import healthRoutes from "./modules/health/routes";
import orgRoutes from "./modules/orgs/routes";
import invoiceRoutes from "./modules/invoices/routes";
import activityRoutes from "./modules/activity/routes";
import memberRoutes from "./modules/members/routes";

export function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  // Cross-cutting plugins first, then feature modules.
  app.register(corsPlugin);
  app.register(authPlugin);
  app.register(tenantPlugin);

  app.register(healthRoutes);
  app.register(orgRoutes);
  app.register(invoiceRoutes);
  app.register(activityRoutes);
  app.register(memberRoutes);

  return app;
}
