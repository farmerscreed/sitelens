"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconUpload, IconAlert } from "@/components/icons";

// A recipe's cover: the render/elevation of what the structure will look like.
// One display-size image (design asset, not site media — the three-derivative
// pipeline is for field photos). Downscaled client-side, stored under the org's
// own prefix (storage RLS), attached via fn_set_type_cover (server write path).
const MAX_EDGE = 1600;

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === "image/jpeg") return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), "image/jpeg", 0.85));
}

export function TypeCoverUpload({ orgId, typeId, hasCover }: { orgId: string; typeId: string; hasCover: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const blob = await downscale(file);
      const key = `${orgId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("type-covers")
        .upload(key, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { error: setErr2 } = await supabase.rpc("fn_set_type_cover", { p_type: typeId, p_key: key });
      if (setErr2) throw new Error(setErr2.message);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy}
        onClick={() => inputRef.current?.click()}>
        <IconUpload className="h-3.5 w-3.5" />
        {busy ? "Uploading…" : hasCover ? "Change photo" : "Add a photo of the structure"}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {err && <p className="mt-1 flex items-center gap-1 text-xs text-red-300"><IconAlert className="h-3.5 w-3.5" />{err}</p>}
    </div>
  );
}
