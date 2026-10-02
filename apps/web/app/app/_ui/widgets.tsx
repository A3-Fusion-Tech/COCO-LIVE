"use client";
import { Fragment, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

export interface Option { value: string; label: string }
export interface Field {
  name: string; label: string;
  type?: "text" | "number" | "tel" | "select" | "textarea" | "checkbox" | "datetime-local";
  value?: string | number | boolean; options?: Option[]; required?: boolean; hint?: string;
  /** `inputmode` for text inputs. */
  mode?: "numeric" | "decimal";
  onChange?: (value: string) => void;
}
/** Submitted values by field name: strings, booleans for checkboxes. */
export type Values = Record<string, any>;
export const opt = (value: string, label: string): Option => ({ value, label });

/** A form built from field specs; values are read by name on submit and the submit button is disabled meanwhile. */
export function Form({ fields, submit, onSubmit, danger }: { fields: Field[]; submit: string; onSubmit: (v: Values) => Promise<unknown>; danger?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const handle = async (e: FormEvent) => {
    e.preventDefault();
    const els = ref.current?.elements;
    const v: Record<string, string | boolean> = {};
    for (const f of fields) { const el = els?.namedItem(f.name) as HTMLInputElement | null; v[f.name] = f.type === "checkbox" ? !!el?.checked : el?.value ?? ""; }
    setBusy(true);
    try { await onSubmit(v); } finally { setBusy(false); }
  };
  return (
    <form ref={ref} noValidate onSubmit={handle}>
      {fields.map((f, n) => {
        const fid = `${id}${n}`;
        const text = f.value === undefined || typeof f.value === "boolean" ? "" : String(f.value);
        const change = f.onChange ? (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => f.onChange?.(e.target.value) : undefined;
        let input: ReactNode;
        if (f.type === "select") input = <select id={fid} name={f.name} defaultValue={f.value === undefined ? undefined : text} onChange={change}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
        else if (f.type === "textarea") input = <textarea id={fid} name={f.name} rows={3} defaultValue={text} />;
        else input = <input id={fid} name={f.name} type={f.type ?? "text"} required={f.required} onChange={change}
          {...(f.type === "checkbox" ? { defaultChecked: !!f.value } : { defaultValue: text })}
          {...(f.type === "number" ? { step: "any", inputMode: "decimal" as const } : {})}
          {...(f.type === "tel" ? { inputMode: "tel" as const, autoComplete: "tel" } : {})}
          {...((!f.type || f.type === "text") && f.mode ? { inputMode: f.mode } : {})} />;
        return (
          <Fragment key={f.name}>
            {f.type === "checkbox" ? <div className="row">{input}<label htmlFor={fid} className="inline">{f.label}</label></div> : <><label htmlFor={fid}>{f.label}</label>{input}</>}
            {f.hint ? <p className="hint">{f.hint}</p> : null}
          </Fragment>
        );
      })}
      <div className="row actions"><button type="submit" className={danger ? "danger" : ""} disabled={busy}>{submit}</button></div>
    </form>
  );
}

/** A placeholder whose content the children can replace (evidence, alert forms, match lists…). */
export function Slot({ children }: { children: (set: (n: ReactNode) => void, content: ReactNode) => ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  return <>{children(setContent, content)}</>;
}

export const Section = ({ title, children }: { title: string; children?: ReactNode }) => <section className="card"><h2>{title}</h2>{children}</section>;

export const Kv = ({ obj }: { obj: Record<string, unknown> }) => (
  <table><tbody>{Object.entries(obj).map(([k, v]) => <tr key={k}><th>{k}</th><td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>)}</tbody></table>
);
