// Decode active_org_id from the access token (injected by the A0 hook). Display/
// convenience only — the DB still enforces everything via RLS + SECURITY DEFINER fns.
export function activeOrgFromToken(accessToken: string | undefined): string {
  if (!accessToken) return "";
  try {
    const [, payload] = accessToken.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).active_org_id ?? "";
  } catch {
    return "";
  }
}
