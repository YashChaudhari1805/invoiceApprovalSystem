import { FastifyInstance } from "fastify";
import { computeInvoiceTotals, can } from "../lib/invoice-rules";
import { createInvoiceSchema, listQuerySchema } from "../modules/invoices/schemas";

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
}
