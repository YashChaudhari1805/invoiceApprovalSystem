import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { FastifyReply, FastifyRequest } from "fastify";

// What we put in the JWT: just identity. Org + role are resolved per-request
// from the DB (see tenant.ts), never trusted from the token itself — that's
// what stops someone from forging a role by editing a cached token.
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
  }
}

export default fp(async (app) => {
  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET as string,
    cookie: { cookieName: "token", signed: false },
  });

  app.decorate(
    "authenticate",
    async function (req: FastifyRequest, reply: FastifyReply) {
      try {
        await req.jwtVerify();
      } catch {
        reply.code(401).send({ error: "Unauthorized" });
      }
    }
  );
});
