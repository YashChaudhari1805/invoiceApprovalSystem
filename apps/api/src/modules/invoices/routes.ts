import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { can } from "../../shared/permissions";
import { fail, sendFailure } from "../../shared/http";
import { isUuid } from "../../shared/uuid";
import { mapCreateError, mapTransitionError, mapUpdateError } from "./errors";
import * as repo from "./repository";
import { createInvoiceSchema, listQuerySchema, transitionSchema, updateInvoiceSchema } from "./schemas";

// A malformed id cannot exist. Without this check Postgres fails the uuid cast
// and the client gets a 500 instead of a 404.
async function requireValidInvoiceId(req: FastifyRequest, reply: FastifyReply) {
  const { invoiceId } = req.params as { invoiceId: string };
  if (!isUuid(invoiceId)) return sendFailure(req, reply, fail(404, "Invoice not found"));
}

export default async function invoiceRoutes(app: FastifyInstance) {
  const preHandler = [app.authenticate, app.requireMembership];
  const withInvoiceId = [...preHandler, requireValidInvoiceId];

  // POST /orgs/:orgId/invoices
  //
  // Optional Idempotency-Key header: one value per logical "create" attempt,
  // unchanged across retries. The same key + body returns the ORIGINAL response;
  // the same key with a different body is rejected (see migrations/0012_idempotency.sql).
  app.post("/orgs/:orgId/invoices", { preHandler }, async (req, reply) => {
    if (!can(req.membership.role, "invoice:create")) {
      return sendFailure(req, reply, fail(403, "You do not have permission to create invoices"));
    }
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid input", { details: parsed.error.flatten() }));
    }

    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" && header.trim() !== "" ? header : null;

    const { data, error } = await repo.createInvoice(req.supabase, req.membership.organizationId, parsed.data, idempotencyKey);
    if (error) return sendFailure(req, reply, mapCreateError(error), error);
    return reply.code(201).send(data);
  });

  // GET /orgs/:orgId/invoices?search=&vendor=&status=&page=&pageSize=
  app.get("/orgs/:orgId/invoices", { preHandler }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid query parameters", { details: parsed.error.flatten() }));
    }
    const { data, count, error } = await repo.listInvoices(req.supabase, req.membership.organizationId, parsed.data);
    if (error) return sendFailure(req, reply, fail(500, "Failed to list invoices"), error);
    return reply.send({ items: data, total: count, page: parsed.data.page, pageSize: parsed.data.pageSize });
  });

  // GET /orgs/:orgId/invoices/summary: counts for the triage widgets.
  app.get("/orgs/:orgId/invoices/summary", { preHandler }, async (req, reply) => {
    const { error, counts } = await repo.getSummary(req.supabase, req.membership.organizationId);
    if (error) return sendFailure(req, reply, fail(500, "Failed to load invoice summary"), error);
    return reply.send(counts);
  });

  // GET /orgs/:orgId/invoices/:invoiceId
  // `availableActions` is a UX hint only; the transition endpoint re-checks everything.
  app.get("/orgs/:orgId/invoices/:invoiceId", { preHandler: withInvoiceId }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };

    const { data: invoice, error: invoiceError } = await repo.findInvoice(req.supabase, req.membership.organizationId, invoiceId);
    if (invoiceError) return sendFailure(req, reply, fail(500, "Failed to load invoice"), invoiceError);
    // Covers "doesn't exist" and "belongs to another org": RLS returns no row, so this 404 is safe either way.
    if (!invoice) return sendFailure(req, reply, fail(404, "Invoice not found"));

    const [{ data: lineItems, error: lineItemsError }, { data: activity, error: activityError }] = await Promise.all([
      repo.findLineItems(req.supabase, invoiceId),
      repo.findInvoiceActivity(req.supabase, invoiceId),
    ]);
    if (lineItemsError || activityError) {
      return sendFailure(req, reply, fail(500, "Failed to load invoice details"), lineItemsError ?? activityError);
    }

    const availableActions: string[] = [];
    if (invoice.status === "DRAFT" && can(req.membership.role, "invoice:create")) {
      availableActions.push("SUBMIT_FOR_REVIEW");
    }
    if (invoice.status === "REVIEW" && can(req.membership.role, "invoice:approve") && invoice.created_by !== req.user.userId) {
      availableActions.push("APPROVE", "REJECT");
    }

    return reply.send({ ...invoice, lineItems, activity, availableActions });
  });

  // PATCH /orgs/:orgId/invoices/:invoiceId
  // Body: { version, vendor?, invoiceNumber?, invoiceDate?, lineItems? }. The version check, permission
  // check, update and audit entry are one update_invoice() transaction (migrations/0008).
  app.patch("/orgs/:orgId/invoices/:invoiceId", { preHandler: withInvoiceId }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = updateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid input", { details: parsed.error.flatten() }));
    }
    const { data, error } = await repo.updateInvoice(req.supabase, req.membership.organizationId, invoiceId, parsed.data);
    if (error) return sendFailure(req, reply, mapUpdateError(error), error);
    return reply.send(data);
  });

  // POST /orgs/:orgId/invoices/:invoiceId/transition
  // transition_invoice() in Postgres is the single source of truth for the status whitelist and maker-checker rule.
  app.post("/orgs/:orgId/invoices/:invoiceId/transition", { preHandler: withInvoiceId }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendFailure(req, reply, fail(400, "Invalid input", { details: parsed.error.flatten() }));
    }
    const { data, error } = await repo.transitionInvoice(req.supabase, invoiceId, parsed.data.toStatus, parsed.data.expectedVersion);
    if (error) return sendFailure(req, reply, mapTransitionError(error), error);
    return reply.send(data);
  });
}
