import { InvoiceStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// All search/filter/pagination happens in the WHERE clause and take/skip —
// the frontend only ever gets back the one page it asked for, never the
// full invoice list, so it can't do this filtering client-side even if it wanted to.
export async function listInvoices(params: {
  organizationId: string;
  search?: string;
  vendor?: string;
  status?: InvoiceStatus;
  page: number;
  pageSize: number;
}) {
  const where = {
    organizationId: params.organizationId,
    ...(params.search ? { invoiceNumber: { contains: params.search, mode: "insensitive" as const } } : {}),
    ...(params.vendor ? { vendor: params.vendor } : {}),
    ...(params.status ? { status: params.status } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.invoice.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize };
}
