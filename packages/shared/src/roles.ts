// Who may do what. The API enforces these rules; the web app uses the same
// functions only to decide what to show, so the UI never offers an action the
// API would refuse.
export const ROLES = ["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

const PERMISSIONS = {
  "invoice:view": ["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"],
  "invoice:create": ["ADMIN", "OPERATOR"],
  "invoice:approve": ["ADMIN", "REVIEWER"],
  "member:manage": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
