import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth";
import tenantPlugin from "./plugins/tenant";
import orgRoutes from "./routes/orgs";
import invoiceRoutes from "./routes/invoices";
import memberRoutes from "./routes/members";

export function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  app.register(cors, {
    origin: process.env.FRONTEND_URL ?? true,
    credentials: true,
  });
  app.register(authPlugin);
  app.register(tenantPlugin);
  app.register(orgRoutes);
  app.register(invoiceRoutes);
  app.register(memberRoutes);

  app.get("/health", async () => ({ ok: true }));

  return app;
}
