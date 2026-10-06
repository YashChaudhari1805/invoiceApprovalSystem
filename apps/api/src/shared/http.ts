import type { FastifyReply, FastifyRequest } from "fastify";

/** The subset of a Supabase/Postgres error the API cares about. */
export interface PgError {
  code?: string;
  message: string;
}

export interface HttpFailure {
  status: number;
  body: Record<string, unknown>;
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): HttpFailure => ({
  status,
  body: { error, ...extra },
});

/** Sends a failure; 5xx failures also log the underlying database error. */
export function sendFailure(req: FastifyRequest, reply: FastifyReply, failure: HttpFailure, cause?: unknown) {
  if (failure.status >= 500 && cause) req.log.error(cause);
  return reply.code(failure.status).send(failure.body);
}
