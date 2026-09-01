import { FastifyInstance } from "fastify";
import { computeInvoiceTotals, can } from "../lib/invoice-rules";
import { createInvoiceSchema, listQuerySchema, transitionSchema } from "../modules/invoices/schemas";

export default async function invoiceRoutes(app: FastifyInstance) {
  const preHandler = [app.authenticate, app.requireMembership];

  // POST /orgs/:orgId/invoices
  app.post("/orgs/:orgId/invoices", { preHandler }, async (req, reply) => {
    if (!can(req.membership.role, "invoice:create")) {
      return reply.code(403).send({ error: "You do not have permission to create invoices" });
    }

    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { vendor, invoiceNumber, invoiceDate, lineItems } = parsed.data;

    // Totals are always derived server-side — client-submitted amounts, if
    // any were sent, are ignored entirely by not even accepting them in the schema.
    const totals = computeInvoiceTotals(lineItems);

    const { data: invoice, error: invoiceError } = await req.supabase
      .from("invoices")
      .insert({
        organization_id: req.membership.organizationId,
        vendor,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        taxable_amount: totals.taxableAmount,
        tax_amount: totals.taxAmount,
        total_amount: totals.totalAmount,
        created_by: req.user.userId,
      })
      .select()
      .single();

    if (invoiceError) {
      // Postgres unique_violation — the (org, vendor, invoice_number)
      // constraint caught a duplicate, including under concurrent requests.
      if (invoiceError.code === "23505") {
        return reply.code(409).send({ error: "An invoice with this vendor and invoice number already exists" });
      }
      req.log.error(invoiceError);
      return reply.code(500).send({ error: "Failed to create invoice" });
    }

    const { error: lineItemError } = await req.supabase.from("line_items").insert(
      totals.lineItems.map((li) => ({
        invoice_id: invoice.id,
        description: li.description,
        quantity: li.quantity,
        rate: li.rate,
        tax_rate: li.taxRate,
        amount: li.amount,
      }))
    );

    if (lineItemError) {
      req.log.error(lineItemError);
      // Best-effort cleanup so a failed line-item insert doesn't leave an
      // orphaned invoice with no line items behind.
      await req.supabase.from("invoices").delete().eq("id", invoice.id);
      return reply.code(500).send({ error: "Failed to save line items" });
    }

    // Activity log entry for creation (transitions log their own entries via
    // the transition_invoice RPC; creation isn't a transition, so it's logged here).
    await req.supabase.from("activity_log").insert({
      organization_id: req.membership.organizationId,
      invoice_id: invoice.id,
      actor_id: req.user.userId,
      action: "INVOICE_CREATED",
    });

    return reply.code(201).send({ ...invoice, lineItems: totals.lineItems });
  });

  // GET /orgs/:orgId/invoices?search=&vendor=&status=&page=&pageSize=
  app.get("/orgs/:orgId/invoices", { preHandler }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }
    const { search, vendor, status, page, pageSize } = parsed.data;

    // All filtering, search, and pagination happen in this single query —
    // never fetched in full and filtered client-side.
    let query = req.supabase
      .from("invoices")
      .select("id, vendor, invoice_number, invoice_date, status, total_amount, created_at, created_by", {
        count: "exact",
      })
      .eq("organization_id", req.membership.organizationId)
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("invoice_number", `%${search}%`);
    if (vendor) query = query.eq("vendor", vendor);
    if (status) query = query.eq("status", status);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to list invoices" });
    }

    return reply.send({ items: data, total: count, page, pageSize });
  });

  // GET /orgs/:orgId/invoices/:invoiceId
  // Returns invoice info, line items, activity history, and which actions
  // the frontend should show for this user — but that action list is purely
  // a UX convenience. The transition endpoint below re-checks everything
  // from scratch, so a stale or tampered action list can't grant real access.
  app.get("/orgs/:orgId/invoices/:invoiceId", { preHandler }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };

    const { data: invoice, error: invoiceError } = await req.supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .eq("organization_id", req.membership.organizationId)
      .maybeSingle();

    if (invoiceError) {
      req.log.error(invoiceError);
      return reply.code(500).send({ error: "Failed to load invoice" });
    }
    if (!invoice) {
      // Covers both "doesn't exist" and "belongs to another org" — RLS
      // already guarantees the latter returns no row rather than someone
      // else's data, so this 404 is safe either way.
      return reply.code(404).send({ error: "Invoice not found" });
    }

    const [{ data: lineItems, error: lineItemsError }, { data: activity, error: activityError }] =
      await Promise.all([
        req.supabase.from("line_items").select("*").eq("invoice_id", invoiceId),
        req.supabase
          .from("activity_log")
          .select("id, action, metadata, created_at, actor:profiles(id, name)")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: true }),
      ]);

    if (lineItemsError || activityError) {
      req.log.error(lineItemsError ?? activityError);
      return reply.code(500).send({ error: "Failed to load invoice details" });
    }

    const availableActions: string[] = [];
    if (invoice.status === "DRAFT" && can(req.membership.role, "invoice:create")) {
      availableActions.push("SUBMIT_FOR_REVIEW");
    }
    if (
      invoice.status === "REVIEW" &&
      can(req.membership.role, "invoice:approve") &&
      invoice.created_by !== req.user.userId // maker-checker reflected in the UI hint too
    ) {
      availableActions.push("APPROVE", "REJECT");
    }

    return reply.send({ ...invoice, lineItems, activity, availableActions });
  });

  // POST /orgs/:orgId/invoices/:invoiceId/transition
  // Thin wrapper around the transition_invoice() Postgres function, which is
  // the single source of truth for the transition whitelist and the
  // maker-checker rule (see supabase/migrations/0001_init.sql). This route's
  // only job is validating the input shape and translating Postgres errors
  // into sensible HTTP status codes.
  app.post("/orgs/:orgId/invoices/:invoiceId/transition", { preHandler }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { data, error } = await req.supabase.rpc("transition_invoice", {
      p_invoice_id: invoiceId,
      p_to_status: parsed.data.toStatus,
    });

    if (error) {
      const message = error.message ?? "";
      if (error.code === "42501") {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (/not found/i.test(message)) {
        return reply.code(404).send({ error: "Invoice not found" });
      }
      if (/cannot approve or reject/i.test(message)) {
        return reply.code(403).send({ error: message });
      }
      if (/invalid status transition/i.test(message)) {
        return reply.code(400).send({ error: message });
      }
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to update invoice status" });
    }

    return reply.send(data);
  });
}
