"use client";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { createPhotoUpload } from "./actions.ts";

/** Lot photo picker: gets a signed upload URL from a server action, then PUTs the file to it (same origin). */
export function PhotoUpload({ lotId, label, done, failed }: { lotId: string; label: string; done: string; failed: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const intent = await createPhotoUpload(lotId, file.type, file.size);
      if (!intent.ok) { setMsg({ text: intent.message, bad: true }); return; }
      const res = await fetch(intent.path, { method: "PUT", body: file, headers: { "content-type": file.type }, credentials: "omit" });
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
        setMsg({ text: p.message ?? p.detail ?? failed, bad: true });
        return;
      }
      setMsg({ text: done, bad: false });
      router.refresh();
    } catch {
      setMsg({ text: failed, bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label className="btn secondary pick" aria-disabled={busy}>
        {label}
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" disabled={busy} onChange={upload} />
      </label>
      <span role="status" aria-live="polite">{msg ? <span className={msg.bad ? "err" : "ok"}>{msg.text}</span> : null}</span>
    </>
  );
}
