"use client";
import { useActionState, useState } from "react";
import { IDLE, type ActionState } from "../../../../lib/forms.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { requestOtp, verifyOtp } from "./actions.ts";

export interface LoginLabels { phone: string; send: string; code: string; verify: string; change: string }

/** Two steps: send a code to the phone, then verify it (which sets the session cookie and redirects). */
export function LoginForm({ next, labels }: { next: string; labels: LoginLabels }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [sent, send, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const res = await requestOtp(prev, form);
    if (res.status === "ok") setPhone(String(form.get("phone") ?? ""));
    return res;
  }, IDLE);

  if (phone === null) {
    return (
      <form action={send}>
        <label htmlFor="phone">{labels.phone}</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required defaultValue={sent.status === "error" ? sent.values?.phone : undefined} />
        <p className="hint">+91 …</p>
        <div className="row actions"><button type="submit" disabled={pending}>{labels.send}</button></div>
        <div role="status" aria-live="polite">{sent.status === "error" ? <p className="err">{sent.message}</p> : null}</div>
      </form>
    );
  }
  return (
    <>
      {sent.status === "ok" ? <p className="ok" role="status">{sent.message}</p> : null}
      <ActionForm action={verifyOtp} submit={labels.verify} fields={[
        { name: "code", label: labels.code, mode: "numeric", required: true },
        { name: "phone", label: "", type: "hidden", value: phone },
        { name: "next", label: "", type: "hidden", value: next },
      ]} />
      <button type="button" className="secondary" onClick={() => setPhone(null)}>{labels.change}</button>
    </>
  );
}
