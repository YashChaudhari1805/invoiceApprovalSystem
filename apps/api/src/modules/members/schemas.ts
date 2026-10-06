import { z } from "zod";
import { ROLES } from "@invoice-app/shared";

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(ROLES),
});
