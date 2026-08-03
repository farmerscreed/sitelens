"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert, IconUsers } from "@/components/icons";
import type { Member } from "@/app/team/page";

const ROLES: { value: string; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Full access + can manage members" },
  { value: "pm", label: "Project manager", hint: "Runs projects, budgets, reports" },
  { value: "engineer", label: "Engineer", hint: "Site work on assigned projects" },
  { value: "client", label: "Client", hint: "Limited, view-oriented access" },
];
const roleLabel = (v: string) => ROLES.find((r) => r.value === v)?.label ?? v;

export function TeamPanel({ members, orgName }: { members: Member[]; orgName: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("engineer");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function invite() {
    setBusy(true); setErr(null); setOk(null);
    const { data, error } = await supabase.functions.invoke("invite-member", {
      body: { email: email.trim(), name: name.trim(), role },
    });
    setBusy(false);
    if (error) {
      let msg = error.message;
      // Edge Function returns { error } with a non-2xx status; surface that message.
      try { const b = await (error as { context?: Response }).context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
      return setErr(msg);
    }
    if (data?.error) return setErr(data.error);
    setOk(`${email.trim()} was invited as ${roleLabel(role)}. They can sign in on the login page with this email.`);
    setEmail(""); setName(""); router.refresh();
  }

  async function setActive(m: Member, active: boolean) {
    setBusy(true); setErr(null); setOk(null);
    const { error } = await supabase.rpc("fn_set_member_active", { p_membership: m.membership_id, p_active: active });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Members of {orgName}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[620px]">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membership_id}>
                  <td className="font-medium text-white">
                    {m.full_name ?? "—"}
                    {m.is_self && <span className="ml-1.5 text-[10px] text-[#5b6473]">(you)</span>}
                  </td>
                  <td className="text-[#8b95a7]">{m.email ?? "—"}</td>
                  <td className="text-[#8b95a7]">{roleLabel(m.role)}</td>
                  <td>
                    <span className={`badge ${m.is_active ? "badge-green" : "badge-muted"}`}>
                      {m.is_active ? "active" : "deactivated"}
                    </span>
                  </td>
                  <td className="text-right">
                    {m.is_self ? (
                      <span className="text-[11px] text-[#5b6473]">—</span>
                    ) : m.is_active ? (
                      <button className="btn btn-danger px-2.5 py-1 text-xs" disabled={busy} onClick={() => setActive(m, false)}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setActive(m, true)}>
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-[#8b95a7]">No members yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card max-w-xl">
        <h2 className="text-sm font-semibold text-white">Invite a member</h2>
        <p className="mt-0.5 text-xs text-[#8b95a7]">They sign in with this email — no password, just a 6-digit code. No self-signup exists, so only people you invite here can get in.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" placeholder="friend@email.com" value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="Their name" value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Role</label>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary mt-4" disabled={busy || !email.trim()} onClick={invite}>
          <IconUsers className="h-4 w-4" />{busy ? "Inviting…" : "Send invite"}
        </button>

        {ok && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-emerald-300">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />{ok}
          </p>
        )}
        {err && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-red-300">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />{err}
          </p>
        )}
      </section>
    </div>
  );
}
