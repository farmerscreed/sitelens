"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconLogo, IconCheck, IconAlert } from "@/components/icons";

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

  const target = method === "email" ? email : phone;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-accent-500/10 blur-[120px]" />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-sheen text-ink-950 shadow-glow">
            <IconLogo className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">
            Site<span className="gradient-text">Lens</span>
          </h1>
          <p className="mt-1 text-sm text-[#8b95a7]">Construction command console</p>
        </div>

        <div className="card shadow-lift">
          {stage === "identify" ? (
            <div className="space-y-5">
              {/* Method toggle */}
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
                {(["email", "phone"] as const).map((m) => (
                  <button key={m} type="button"
                    onClick={() => { setMethod(m); setError(null); }}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      method === m ? "bg-accent-sheen text-ink-950 shadow" : "text-[#8b95a7] hover:text-white"
                    }`}>
                    {m === "email" ? "Email" : "Phone"}
                  </button>
                ))}
              </div>

              <div>
                <label className="label">{method === "email" ? "Email address" : "Phone number"}</label>
                {method === "email" ? (
                  <input type="email" autoComplete="email" className="input"
                    placeholder="you@company.com" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && email && sendCode()} />
                ) : (
                  <input inputMode="tel" className="input"
                    placeholder="+234…" value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && phone.length >= 7 && sendCode()} />
                )}
              </div>

              <button className="btn btn-primary w-full" onClick={sendCode}
                disabled={busy || (method === "email" ? !email : phone.length < 7)}>
                {busy ? "Sending…" : "Send login code"}
              </button>
              <p className="text-center text-xs text-[#5b6473]">
                We&apos;ll {method === "email" ? "email" : "text"} you a 6-digit code. No password needed.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3.5 py-2.5 text-sm text-emerald-300">
                <IconCheck className="h-4 w-4 shrink-0" />
                <span className="truncate">Code sent to <span className="font-medium text-emerald-200">{target}</span></span>
              </div>
              <div>
                <label className="label">Login code</label>
                <input className="input text-center text-lg font-semibold tracking-[0.3em]"
                  placeholder="••••••" inputMode="numeric" maxLength={8} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && code.length >= 6 && verify()} autoFocus />
              </div>
              <button className="btn btn-primary w-full" onClick={verify} disabled={busy || code.length < 6}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button className="w-full text-center text-sm text-[#8b95a7] transition hover:text-white"
                onClick={() => { setStage("identify"); setCode(""); setError(null); }}>
                ← Use a different {method === "email" ? "email" : "number"}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-300">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[#5b6473]">
          Secured by tenant isolation · every session scoped to one organisation
        </p>
      </div>
    </div>
  );
}
