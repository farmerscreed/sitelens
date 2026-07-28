// Supabase Send-SMS auth hook → Termii. GoTrue generates the OTP and calls this signed
// webhook; we verify the Standard-Webhooks signature (anti-abuse) and send the code via
// Termii's SMS API. Termii isn't a native Supabase provider, so this hook is the bridge.
// Secrets: SEND_SMS_HOOK_SECRET ("v1,whsec_…"), TERMII_API_KEY.

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function b64encode(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b));
}

async function verify(secret: string, id: string, ts: string, body: string, sigHeader: string): Promise<boolean> {
  const raw = b64decode(secret.replace(/^v1,/, "").replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const expected = b64encode(new Uint8Array(mac));
  return sigHeader.split(" ").some((s) => s.split(",")[1] === expected);
}

Deno.serve(async (req) => {
  const body = await req.text();
  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "";
  const id = req.headers.get("webhook-id") ?? "";
  const ts = req.headers.get("webhook-timestamp") ?? "";
  const sig = req.headers.get("webhook-signature") ?? "";

  if (secret && !(await verify(secret, id, ts, body, sig))) {
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const payload = JSON.parse(body);
  const phone = String(payload.user?.phone ?? "").replace(/^\+/, ""); // Termii wants no '+'
  const otp = String(payload.sms?.otp ?? "");
  if (!phone || !otp) return new Response(JSON.stringify({ error: "missing phone/otp" }), { status: 400 });

  const res = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: phone,
      from: "N-Alert",           // Termii's approved OTP sender id
      sms: `Your SiteLens verification code is ${otp}. Valid for 60 seconds.`,
      type: "plain",
      channel: "dnd",            // reaches DND-registered numbers (OTP/transactional)
      api_key: Deno.env.get("TERMII_API_KEY"),
    }),
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `termii ${res.status}: ${await res.text()}` }), { status: 500 });
  }
  return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
});
