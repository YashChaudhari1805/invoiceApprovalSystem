import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth";
import tenantPlugin from "./plugins/tenant";
import orgRoutes from "./routes/orgs";
import invoiceRoutes from "./routes/invoices";
import memberRoutes from "./routes/members";

export function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  // Fail closed. With FRONTEND_URL unset, `origin: true` would reflect ANY
  // requesting origin back alongside `credentials: true`. Instead: allow only
  // the configured frontend; outside production fall back to the local dev
  // server; in production with nothing configured, send no CORS headers at all.
  // (The Next.js app calls this API from its server, so browsers never need
  // cross-origin access in the first place.)
  const allowedOrigin =
    process.env.FRONTEND_URL ?? (process.env.NODE_ENV === "production" ? false : "http://localhost:3000");
  app.register(cors, {
    origin: allowedOrigin,
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
