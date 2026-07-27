"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Phone-OTP login. Locally the OTP is a fixed dev code (config.toml [auth.sms.test_otp]);
// production uses Termii. Never requires a real SMS in dev.
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [phone, setPhone] = useState("+2348000000001");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) setError(error.message);
    else setStage("code");
  }

  async function verify() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: "sms" });
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

      {stage === "phone" ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Phone number</label>
          <input
            className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+234…"
          />
          <button
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            onClick={sendOtp}
            disabled={busy || !phone}
          >
            {busy ? "Sending…" : "Send code"}
          </button>
          <p className="text-xs text-neutral-500">Dev: code is 123456 for the seeded phones.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Enter the 6-digit code</label>
          <input
            className="w-full rounded-md border border-neutral-300 px-3 py-2 tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
          />
          <button
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            onClick={verify}
            disabled={busy || code.length < 6}
          >
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button className="w-full text-sm text-neutral-500 underline" onClick={() => setStage("phone")}>
            Use a different number
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
