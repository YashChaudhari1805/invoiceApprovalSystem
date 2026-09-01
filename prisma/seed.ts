import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const abcSteel = await prisma.organization.create({
    data: { name: "ABC Steel", slug: "abc-steel" },
  });
  const xyzMetals = await prisma.organization.create({
    data: { name: "XYZ Metals", slug: "xyz-metals" },
  });

  const rahul = await prisma.user.create({
    data: { name: "Rahul", email: "rahul@example.com", passwordHash },
  });
  const priya = await prisma.user.create({
    data: { name: "Priya", email: "priya@example.com", passwordHash },
  });

  // Rahul: Admin at ABC Steel, Viewer at XYZ Metals — mirrors the spec's example.
  await prisma.membership.createMany({
    data: [
      { userId: rahul.id, organizationId: abcSteel.id, role: "ADMIN" },
      { userId: rahul.id, organizationId: xyzMetals.id, role: "VIEWER" },
      { userId: priya.id, organizationId: abcSteel.id, role: "REVIEWER" },
    ],
  });

  console.log("Seeded. Login as rahul@example.com / priya@example.com, password: password123");
}

main().finally(() => prisma.$disconnect());
