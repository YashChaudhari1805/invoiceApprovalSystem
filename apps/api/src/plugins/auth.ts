import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin, createUserClient } from "../lib/supabase";

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

      // Verifying via supabaseAdmin.auth.getUser confirms the token is a
      // genuine, unexpired Supabase-issued token for a real user — this is
      // the only thing the admin client is used for on this request.
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }

      req.user = { userId: data.user.id, email: data.user.email! };
      req.supabase = createUserClient(token);
    }
  );
});
