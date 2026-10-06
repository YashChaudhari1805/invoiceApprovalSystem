// Postgres ILIKE treats "%" and "_" as wildcards. Any value a user types
// into a search/filter box is untrusted from the query planner's point of
// view, so before we wrap it in %...% for a partial match, escape any
// wildcard characters the user typed so they're matched literally instead
// of changing the meaning of the pattern (e.g. searching "50%" should look
// for the three literal characters "50%", not "50" followed by anything).
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
