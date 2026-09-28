import { FastifyInstance } from "fastify";
import { can } from "../lib/invoice-rules";
import { escapeLikePattern } from "../lib/search";
import {
  createInvoiceSchema,
  listQuerySchema,
  transitionSchema,
  updateInvoiceSchema,
} from "../modules/invoices/schemas";

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

    // One database call does everything: it re-checks the caller's role in this
    // org, computes the totals itself from the line items (so no client- or
    // API-supplied amount is ever trusted), and inserts the invoice, its line
    // items and the INVOICE_CREATED activity entry in a single transaction. If
    // any step fails, nothing is saved — see migrations/0007_atomic_create_invoice.sql.
    const { data, error } = await req.supabase.rpc("create_invoice", {
      p_organization_id: req.membership.organizationId,
      p_vendor: vendor,
      p_invoice_number: invoiceNumber,
      p_invoice_date: invoiceDate,
      p_line_items: lineItems,
    });

    if (error) {
      switch (error.code) {
        case "23505":
          // unique (organization_id, vendor, invoice_number) — also what stops
          // two simultaneous identical requests from both succeeding.
          return reply.code(409).send({ error: "An invoice with this vendor and invoice number already exists" });
        case "42501":
          return reply.code(403).send({ error: "You do not have permission to create invoices" });
        case "22023":
          return reply.code(400).send({ error: error.message });
        case "22003":
          return reply.code(400).send({ error: "A number on this invoice is too large" });
        default:
          req.log.error(error);
          return reply.code(500).send({ error: "Failed to create invoice" });
      }
    }

    return reply.code(201).send(data);
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

    // Both are case-insensitive partial matches (ILIKE), e.g. "tata" matches
    // "Tata Metals" and "inv-1" matches "INV-1002". User-supplied % and _ are
    // escaped first so they're treated as literal characters, not SQL
    // wildcards — otherwise typing "50%" would match anything.
    if (search) query = query.ilike("invoice_number", `%${escapeLikePattern(search)}%`);
    if (vendor) query = query.ilike("vendor", `%${escapeLikePattern(vendor)}%`);
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

  // GET /orgs/:orgId/invoices/summary — counts backing the "Command Center"
  // triage widgets (In review / Drafts / Processed this week). Cheap,
  // count-only (head: true) queries scoped the same way the list endpoint
  // is, independent of whatever search/vendor/status/page filters the list
  // view currently has applied — the widgets always reflect the whole org.
  app.get("/orgs/:orgId/invoices/summary", { preHandler }, async (req, reply) => {
    const orgId = req.membership.organizationId;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [draft, review, processedRecently] = await Promise.all([
      req.supabase.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "DRAFT"),
      req.supabase.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "REVIEW"),
      req.supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["APPROVED", "REJECTED"])
        .gte("updated_at", sevenDaysAgo),
    ]);

    const firstError = draft.error ?? review.error ?? processedRecently.error;
    if (firstError) {
      req.log.error(firstError);
      return reply.code(500).send({ error: "Failed to load invoice summary" });
    }

    return reply.send({
      draft: draft.count ?? 0,
      review: review.count ?? 0,
      processedRecently: processedRecently.count ?? 0,
    });
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
      .select(
        "*, creator:profiles!invoices_created_by_fkey(id, name, email), approver:profiles!invoices_approved_by_fkey(id, name, email)"
      )
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

  // PATCH /orgs/:orgId/invoices/:invoiceId
  // Body: { version, vendor?, invoiceNumber?, invoiceDate?, lineItems? }
  // where `version` is the invoice version the client originally loaded.
  //
  // Everything happens in one update_invoice() database call (see
  // migrations/0008_atomic_edit_and_optimistic_locking.sql): the version
  // check, the permission check (Admin any status; Operator only while
  // Draft/Review), the header update, replacing the line items, recomputing
  // the totals and the activity entry — all in a single transaction, so a
  // failure part-way leaves the previous invoice exactly as it was. The
  // permission rule is deliberately checked there, against the locked row,
  // rather than in a separate read here that could go stale before the write.
  app.patch("/orgs/:orgId/invoices/:invoiceId", { preHandler }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };

    const parsed = updateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { version, vendor, invoiceNumber, invoiceDate, lineItems } = parsed.data;

    // Only fields the client actually sent are included (undefined keys are
    // dropped by JSON serialization), so status — or anything else not listed
    // here — can never ride along in the patch.
    const { data, error } = await req.supabase.rpc("update_invoice", {
      p_organization_id: req.membership.organizationId,
      p_invoice_id: invoiceId,
      p_expected_version: version,
      p_patch: { vendor, invoiceNumber, invoiceDate, lineItems },
    });

    if (error) {
      switch (error.code) {
        case "PT409":
          // Optimistic-lock conflict: someone else changed this invoice after
          // the client loaded it. `code` lets the UI tell this apart from the
          // duplicate-invoice 409 below and offer a refresh.
          return reply.code(409).send({ error: error.message, code: "VERSION_CONFLICT" });
        case "23505":
          return reply
            .code(409)
            .send({ error: "An invoice with this vendor and invoice number already exists", code: "DUPLICATE_INVOICE" });
        case "P0002":
          return reply.code(404).send({ error: "Invoice not found" });
        case "42501":
          return reply.code(403).send({ error: error.message });
        case "22023":
          return reply.code(400).send({ error: error.message });
        case "22007":
        case "22008":
          return reply.code(400).send({ error: "Invalid invoice date" });
        case "22003":
          return reply.code(400).send({ error: "A number on this invoice is too large" });
        default:
          req.log.error(error);
          return reply.code(500).send({ error: "Failed to update invoice" });
      }
    }

    return reply.send(data);
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
      if (/status changed by another request/i.test(message)) {
        return reply.code(409).send({ error: message });
      }
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to update invoice status" });
    }

    return reply.send(data);
  });

  // GET /orgs/:orgId/activity — org-wide audit trail covering both invoice
  // events and membership events (role changes, adds, removes), per spec
  // section 11. Invoice-scoped activity already appears on each invoice's
  // detail page; this is the org-level view tying it all together in one place.
  app.get("/orgs/:orgId/activity", { preHandler }, async (req, reply) => {
    const { data, error } = await req.supabase
      .from("activity_log")
      .select("id, action, metadata, created_at, actor:profiles(id, name), invoice:invoices(id, invoice_number)")
      .eq("organization_id", req.membership.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: "Failed to load activity" });
    }
    return reply.send({ activity: data });
  });
}
