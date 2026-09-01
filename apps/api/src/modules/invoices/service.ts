import { InvoiceStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { can } from "../../plugins/tenant";

// Explicit allowed-transition map. Anything not listed here is rejected —
// this is what "invalid transitions prevented on the backend" means in practice.
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export class InvoiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function createInvoice(params: {
  organizationId: string;
  createdById: string;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: Date;
  lineItems: { description: string; quantity: number; rate: number; taxRate: number }[];
}) {
  // Totals are always derived server-side from line items — the client can
  // send whatever it wants in these fields and it will be ignored.
  let taxableAmount = 0;
  let taxAmount = 0;
  const computedLineItems = params.lineItems.map((li) => {
    const lineTaxable = li.quantity * li.rate;
    const lineTax = lineTaxable * (li.taxRate / 100);
    taxableAmount += lineTaxable;
    taxAmount += lineTax;
    return { ...li, amount: lineTaxable + lineTax };
  });
  const totalAmount = taxableAmount + taxAmount;

  try {
    // The (organizationId, vendor, invoiceNumber) unique constraint in the
    // schema is what actually makes this safe under concurrent duplicate
    // requests — two simultaneous inserts will race at the DB level and
    // Postgres guarantees only one wins; we just translate the resulting
    // unique-violation into a clean 409 instead of a 500.
    return await prisma.invoice.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.createdById,
        vendor: params.vendor,
        invoiceNumber: params.invoiceNumber,
        invoiceDate: params.invoiceDate,
        taxableAmount,
        taxAmount,
        totalAmount,
        lineItems: { create: computedLineItems },
        activities: {
          create: {
            organizationId: params.organizationId,
            actorId: params.createdById,
            action: "INVOICE_CREATED",
          },
        },
      },
      include: { lineItems: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new InvoiceError(409, "An invoice with this vendor and invoice number already exists");
    }
    throw e;
  }
}

export async function transitionInvoice(params: {
  invoiceId: string;
  organizationId: string;
  actorId: string;
  actorRole: Role;
  toStatus: InvoiceStatus;
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
  });
  if (!invoice) throw new InvoiceError(404, "Invoice not found");

  if (!ALLOWED_TRANSITIONS[invoice.status].includes(params.toStatus)) {
    throw new InvoiceError(400, `Cannot move invoice from ${invoice.status} to ${params.toStatus}`);
  }

  const isApprovalStep = params.toStatus === "APPROVED" || params.toStatus === "REJECTED";

  if (isApprovalStep) {
    if (!can(params.actorRole, "invoice:approve")) {
      throw new InvoiceError(403, "You do not have permission to approve or reject invoices");
    }
    // Maker-checker: the creator can never approve/reject their own invoice,
    // regardless of role. Checked here, server-side, unconditionally.
    if (invoice.createdById === params.actorId) {
      throw new InvoiceError(403, "You cannot approve or reject an invoice you created");
    }
  } else {
    // Draft -> Review (submit): creator or any operator/admin can do this.
    if (!can(params.actorRole, "invoice:create")) {
      throw new InvoiceError(403, "You do not have permission to submit this invoice");
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: params.toStatus,
        approvedById: isApprovalStep ? params.actorId : invoice.approvedById,
      },
    });
    await tx.activityLog.create({
      data: {
        organizationId: params.organizationId,
        invoiceId: invoice.id,
        actorId: params.actorId,
        action: params.toStatus === "APPROVED" ? "INVOICE_APPROVED"
              : params.toStatus === "REJECTED" ? "INVOICE_REJECTED"
              : "INVOICE_SUBMITTED",
        metadata: { from: invoice.status, to: params.toStatus },
      },
    });
    return updated;
  });
}
