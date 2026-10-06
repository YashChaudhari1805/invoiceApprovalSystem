import fp from "fastify-plugin";
import cors from "@fastify/cors";
import { getAllowedOrigin } from "../config/env";

export default fp(async (app) => {
  await app.register(cors, { origin: getAllowedOrigin(), credentials: true });
});
