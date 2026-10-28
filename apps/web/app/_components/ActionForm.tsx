"use client";
import { Fragment, useActionState, useId, type ChangeEvent, type ReactNode } from "react";
import { IDLE, type FieldSpec, type FormAction } from "../../lib/forms.ts";

interface Props {
  /** A server action (possibly with bound arguments). */
  action: FormAction;
  fields?: FieldSpec[];
  submit: string;
  variant?: "primary" | "secondary" | "danger";
  /** Extra content inside the form, after the fields (e.g. a checkbox list). */
  children?: ReactNode;
  /** Called when a field changes, with its name and value (for forms whose fields depend on each other). */
  onFieldChange?: (name: string, value: string) => void;
  className?: string;
}

/**
 * A form posting to a server action. Works without JavaScript (plain form POST); with it, the submit button is
 * disabled while pending and the action's message or error is announced next to the form. After an error the
 * submitted values are shown again.
 */
export function ActionForm({ action, fields = [], submit, variant = "primary", children, onFieldChange, className }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const id = useId();
  const values = state.status === "error" ? state.values : undefined;
  const change = onFieldChange ? (e: ChangeEvent<HTMLFormElement>) => { const el = e.target as unknown as HTMLInputElement; if (el.name) onFieldChange(el.name, el.value); } : undefined;
  return (
    // Remounting on each result restores `values` as defaults after React resets the submitted form.
    <form key={state.status === "idle" ? 0 : state.at} action={formAction} onChange={change} className={className}>
      {fields.map((f, n) => <Field key={f.name} f={f} id={`${id}${n}`} value={values?.[f.name]} />)}
      {children}
      <div className="row actions">
        <button type="submit" className={variant === "primary" ? "" : variant} disabled={pending} aria-busy={pending}>{submit}</button>
      </div>
      <div role="status" aria-live="polite">
        {state.status === "error" ? <p className="err">{state.message}</p> : null}
        {state.status === "ok" && state.message ? <p className="ok">{state.message}</p> : null}
      </div>
    </form>
  );
}

function Field({ f, id, value }: { f: FieldSpec; id: string; value: string | undefined }) {
  const text = value ?? (typeof f.value === "string" ? f.value : "");
  let input: ReactNode;
  switch (f.type) {
    case "hidden":
      return <input type="hidden" name={f.name} value={text} />;
    case "select":
      input = <select id={id} name={f.name} defaultValue={text || undefined}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
      break;
    case "textarea":
      input = <textarea id={id} name={f.name} rows={3} defaultValue={text} required={f.required} />;
      break;
    case "checkbox":
      return (
        <div className="row">
          <input id={id} name={f.name} type="checkbox" defaultChecked={value !== undefined ? value === "on" : f.value === true} />
          <label htmlFor={id} className="inline">{f.label}</label>
          {f.hint ? <p className="hint">{f.hint}</p> : null}
        </div>
      );
    default:
      input = <input id={id} name={f.name} type={f.type ?? "text"} required={f.required} defaultValue={text}
        {...(f.type === "number" ? { step: "any", inputMode: "decimal" as const } : {})}
        {...(f.type === "tel" ? { inputMode: "tel" as const, autoComplete: "tel" } : {})}
        {...((!f.type || f.type === "text") && f.mode ? { inputMode: f.mode, ...(f.mode === "numeric" ? { autoComplete: "one-time-code" } : {}) } : {})} />;
  }
  return (
    <Fragment>
      <label htmlFor={id}>{f.label}</label>
      {input}
      {f.hint ? <p className="hint">{f.hint}</p> : null}
    </Fragment>
  );
}
