import type { ReactNode } from "react";
import { statusLabel, type Translate } from "../../lib/i18n/index.ts";
import type { PriceCardView } from "../../lib/prices.ts";

export const Section = ({ title, children }: { title: string; children?: ReactNode }) => <section className="card"><h2>{title}</h2>{children}</section>;

export const Badge = ({ t, status }: { t: Translate; status: string }) => <span className="badge">{statusLabel(t, status)}</span>;

export const Empty = ({ t }: { t: Translate }) => <p className="hint">{t("common.none")}</p>;

export const Kv = ({ obj }: { obj: Record<string, unknown> }) => (
  <table><tbody>{Object.entries(obj).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")}</td></tr>)}</tbody></table>
);

/** One price card. Links go to the evidence page and the alert form for the card's price bucket. */
export function PriceCard({ v, t }: { v: PriceCardView; t: Translate }) {
  const q = new URLSearchParams(v.bucket).toString();
  return (
    <article className={`card fresh-${v.freshness.toLowerCase()}`} aria-label={v.title}>
      <h2>{v.title}</h2>
      <p className="hint">{v.meta}</p>
      <dl className="range">{v.range.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
      <p><strong>{v.status}</strong></p>
      <p className="hint">{v.reported}</p>
      <p className="hint">{v.evidence}</p>
      {v.note ? <p className="note">{v.note}</p> : null}
      <p className="row">
        <a className="btn secondary" href={`/prices/evidence?${q}`}>{t("prices.evidence")}</a>
        <a className="btn secondary" href={`/alerts?${q}`}>{t("prices.alert")}</a>
      </p>
    </article>
  );
}
