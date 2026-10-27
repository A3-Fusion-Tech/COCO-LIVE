import { isApiError } from "../../../../lib/api/errors.ts";
import type { QueueItem } from "../../../../lib/api/types.ts";
import { when } from "../../../../lib/format.ts";
import { opt, type FieldSpec } from "../../../../lib/forms.ts";
import type { Translate } from "../../../../lib/i18n/index.ts";
import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Section } from "../../../_components/ui.tsx";
import { getApi, getLocale, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { decideQueueItem, requestStepUp, stepUp } from "./actions.ts";

type Names = Awaited<ReturnType<typeof getNames>>;

/** Decision fields per queue; a reason is always required. */
function decisionFields(it: QueueItem, t: Translate, names: Names): FieldSpec[] {
  const select = (label: string, values: string[]): FieldSpec => ({ name: "decision", label, type: "select", options: values.map((x) => opt(x)) });
  switch (it.queue) {
    case "PRICE_REVIEW": return [{ name: "decision", label: t("ops.decide"), type: "select", options: [opt("APPROVE", t("ops.approve")), opt("REJECT", t("ops.reject"))] }];
    case "MAPPING": return [
      { name: "productId", label: t("sell.product"), type: "select", options: names.productOptions() },
      { name: "marketId", label: t("sell.origin"), type: "select", options: names.marketOptions() },
      { name: "unit", label: t("sell.unit"), type: "select", options: names.unitOptions() },
    ];
    case "VERIFICATION": return [select(t("ops.decide"), ["APPROVED", "REJECTED", ...(it.subject.startsWith("org_") ? [] : ["NEEDS_MORE_INFORMATION"])])];
    case "LISTING_REVIEW": return [select(t("ops.decide"), ["APPROVE", "SUSPEND", "RETURN"])];
    case "DISPUTE": return [select(t("ops.outcome"), ["UPHELD", "PARTIALLY_UPHELD", "REJECTED", "WITHDRAWN", "SETTLED"])];
    case "RISK": return [];
  }
}

/** Operations console: review queues, source health and audit. Needs an ops capability and a fresh OTP step-up. */
export default async function OpsPage() {
  const me = await requireMe();
  const [api, t, locale, names] = await Promise.all([getApi(), getT(), getLocale(), getNames()]);
  if (!me.capabilities.some((c) => c.startsWith("ops."))) return <><h1>{t("ops.title")}</h1><p className="err">{t("err.forbidden")}</p></>;
  let queue: QueueItem[];
  try {
    queue = (await api.opsQueues()).items;
  } catch (e) {
    if (!isApiError(e) || e.code !== "STEP_UP_REQUIRED") throw e;
    return (
      <>
        <h1>{t("ops.title")}</h1>
        <Section title={t("ops.stepup")}>
          <ActionForm action={requestStepUp} submit={t("ops.sendCode")} variant="secondary" />
          <ActionForm action={stepUp} submit={t("ops.verify")} fields={[{ name: "code", label: t("login.code"), mode: "numeric", required: true }]} />
        </Section>
      </>
    );
  }
  const can = (cap: string) => me.capabilities.includes(cap);
  const [health, audit] = await Promise.all([can("ops.source_health") ? api.opsSourceHealth() : null, can("ops.audit") ? api.opsAudit() : null]);
  return (
    <>
      <h1>{t("ops.title")}</h1>
      <p className="hint">{t("ops.reasonRequired")}</p>
      <h2>{t("ops.queues")}</h2>
      {queue.length ? null : <p>{t("ops.queueEmpty")}</p>}
      {queue.map((it) => (
        <div className="card" key={it.queueItemId}>
          <b>{`${it.queue} · P${it.priority} · ${it.ageMinutes} min`}</b>
          <p>{it.summary}</p>
          <p className="hint">{it.reasons.join(", ")}</p>
          <ActionForm action={decideQueueItem.bind(null, it.queueItemId)} submit={it.queue === "MAPPING" || it.queue === "DISPUTE" ? t("ops.resolve") : t("ops.decide")}
            fields={[...decisionFields(it, t, names), { name: "reason", label: t("common.reason"), required: true }]} />
        </div>
      ))}
      {health ? (
        <Section title={t("ops.health")}>
          <table><tbody>{health.items.map((x) => (
            <tr key={x.source}><td>{x.source}</td><td><Badge t={t} status={x.status} /></td><td>{`retrieved ${x.retrieved} · unmapped ${x.unmapped} · rejected ${x.rejected}`}</td><td>{x.lastSuccessAt ? when(locale, x.lastSuccessAt) : "—"}</td></tr>
          ))}</tbody></table>
        </Section>
      ) : null}
      {audit ? (
        <Section title={t("ops.audit")}>
          <table><tbody>{audit.items.slice(-30).reverse().map((x) => (
            <tr key={x.seq}><td>{when(locale, x.at)}</td><td>{x.action}</td><td>{x.subject}</td><td>{x.reason ?? ""}</td></tr>
          ))}</tbody></table>
        </Section>
      ) : null}
    </>
  );
}
