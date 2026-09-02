import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";
import { SupabaseClient } from "@supabase/supabase-js";
import { verifyAccessToken, createUserClient } from "../lib/supabase";

export interface AuthUser {
  userId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser;
    // A Supabase client authenticated as this specific user — every query
    // made through it is subject to RLS. Route handlers should use this,
    // not supabaseAdmin, for anything that reads or writes tenant data.
    supabase: SupabaseClient;
  }
}

export default fp(async (app) => {
  app.decorate(
    "authenticate",
    async function (req: FastifyRequest, reply: FastifyReply) {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Missing bearer token" });
        return;
      }
      const token = header.slice("Bearer ".length);

      try {
        // Verified locally against Supabase's cached public JWKS keys — no
        // network round trip to the Auth API on every request. See
        // verifyAccessToken's comment in lib/supabase.ts.
        req.user = await verifyAccessToken(token);
      } catch (err) {
        req.log.warn({ err }, "token verification failed");
        reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }

      req.supabase = createUserClient(token);
    }
  );
});
