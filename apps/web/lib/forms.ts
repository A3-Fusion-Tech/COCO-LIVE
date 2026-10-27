/** Result of a server action, rendered by `ActionForm` (`useActionState`). */
export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string; at: number }
  /** `values` are the submitted fields, so the form can show them again after React resets it. */
  | { status: "error"; message: string; at: number; values?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };

/** A server action as `ActionForm` calls it. */
export type FormAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface Option { value: string; label: string }
/** A serialisable form field description (server components build these; `ActionForm` renders them). */
export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "number" | "tel" | "select" | "textarea" | "checkbox" | "datetime-local" | "hidden";
  value?: string | boolean;
  options?: Option[];
  required?: boolean;
  hint?: string;
  /** `inputmode` for text inputs. */
  mode?: "numeric" | "decimal";
}

export const opt = (value: string, label = value): Option => ({ value, label });

/** Typed reads from submitted `FormData`. */
export function fields(form: FormData) {
  return {
    str: (name: string) => { const v = form.get(name); return typeof v === "string" ? v.trim() : ""; },
    bool: (name: string) => form.get(name) === "on",
    all: (name: string) => form.getAll(name).filter((v): v is string => typeof v === "string"),
    values: () => Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$"))),
  };
}
