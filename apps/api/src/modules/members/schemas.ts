import { z } from "zod";

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"]),
});
