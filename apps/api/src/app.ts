import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth";
import tenantPlugin from "./plugins/tenant";
import orgRoutes from "./routes/orgs";
import invoiceRoutes from "./routes/invoices";
import memberRoutes from "./routes/members";

export function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  // In production, restrict CORS to the actual deployed frontend origin via
  // FRONTEND_URL — origin: true (reflect any request origin) is convenient
  // for local dev but has no business being on a deployed API, since it'd
  // let any website's JS make authenticated requests on a visitor's behalf.
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

  // Remaining route modules (invoices, members) get registered here as
  // they're built.

  return app;
}
