import { fail, type HttpFailure, type PgError } from "../../shared/http";

export function mapAddError(error: PgError): HttpFailure {
  switch (error.code) {
    case "P0002":
      return fail(404, "No user found with that email. They must sign up first.");
    case "23505":
      return fail(409, "This user is already a member of this organization");
    case "42501":
      return fail(403, "Only Admins can manage organization members");
    case "22023":
      return fail(400, error.message);
    default:
      return fail(500, "Failed to add member");
  }
}

export function mapRoleError(error: PgError): HttpFailure {
  switch (error.code) {
    case "P0002":
      return fail(404, "Membership not found");
    case "42501":
      // "not an Admin" and "you cannot change your own role"; the message tells them apart.
      return fail(403, error.message);
    case "22023":
      return fail(400, error.message);
    default:
      return fail(500, "Failed to update role");
  }
}

export function mapRemoveError(error: PgError): HttpFailure {
  switch (error.code) {
    case "P0002":
      return fail(404, "Membership not found");
    case "42501":
      return fail(403, error.message);
    default:
      return fail(500, "Failed to remove member");
  }
}
