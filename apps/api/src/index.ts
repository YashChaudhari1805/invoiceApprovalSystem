import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth";
import tenantPlugin from "./plugins/tenant";

const app = Fastify({ logger: true });

app.register(cors, { origin: true, credentials: true });
app.register(authPlugin);
app.register(tenantPlugin);

app.get("/health", async () => ({ ok: true }));

// Route modules (invoices, orgs, members) get registered here as they're
// built — kept out of this file so it stays a thin bootstrap.

const port = Number(process.env.PORT) || 4000;
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
