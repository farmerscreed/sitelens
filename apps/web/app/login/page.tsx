"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Login: email OTP (default — reliable for the web console) or phone OTP (for field
// users / mobile). Both use Supabase signInWithOtp → verifyOtp with a 6-digit code.
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+234");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"identify" | "code">("identify");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true); setError(null);
    const { error } = method === "email"
      ? await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      : await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) setError(error.message);
    else setStage("code");
  }

  async function verify() {
    setBusy(true); setError(null);
    const { error } = method === "email"
      ? await supabase.auth.verifyOtp({ email, token: code, type: "email" })
      : await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace("/dashboard");
  }

  return (
    <main className="mx-auto max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SiteLens</h1>
        <p className="text-sm text-neutral-500">Command console — sign in</p>
      </div>

      {stage === "identify" ? (
        <div className="space-y-3">
          <div className="flex rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700">
            {(["email", "phone"] as const).map((m) => (
              <button key={m}
                className={`flex-1 rounded px-3 py-1 ${method === m ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-500"}`}
                onClick={() => { setMethod(m); setError(null); }}>
                {m === "email" ? "Email" : "Phone"}
              </button>
            ))}
          </div>

          {method === "email" ? (
            <input type="email" autoComplete="email"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          ) : (
            <input inputMode="tel"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="+234…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          )}

          <button
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            onClick={sendCode} disabled={busy || (method === "email" ? !email : phone.length < 7)}>
            {busy ? "Sending…" : "Send code"}
          </button>
          <p className="text-xs text-neutral-500">
            We&apos;ll {method === "email" ? "email" : "text"} you a 6-digit code.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Enter the 6-digit code</label>
          <input
            className="w-full rounded-md border border-neutral-300 px-3 py-2 tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="123456" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <button
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            onClick={verify} disabled={busy || code.length < 6}>
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button className="w-full text-sm text-neutral-500 underline" onClick={() => { setStage("identify"); setCode(""); }}>
            Start over
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
