import { ActionForm } from "../../../_components/ActionForm.tsx";
import { Badge, Empty } from "../../../_components/ui.tsx";
import { getApi, getNames, getT, requireMe } from "../../../_lib/server.ts";
import { addMemberLot, buildAggregate, draftSettlement, reviewMemberLot } from "./actions.ts";

/** FPO / farmer-group workspace: member lots, aggregation into one sell lot, and member settlements. */
export default async function OrgPage() {
  const me = await requireMe();
  const [api, t, names] = await Promise.all([getApi(), getT(), getNames()]);
  const orgs = (await api.myOrganizations()).items.filter((o) => o.kind === "FPO" || o.kind === "FARMER_GROUP");
  if (!orgs.length) return <><h1>{t("org.title")}</h1><Empty t={t} /></>;
  const [members, deals] = await Promise.all([Promise.all(orgs.map((o) => api.memberLots(o.organizationId))), api.deals()]);
  const settleable = deals.items.filter((d) => ["ACCEPTED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(d.status) && d.sellerId === me.userId);
  return (
    <>
      <h1>{t("org.title")}</h1>
      {orgs.map((o, n) => {
        const lots = members[n]?.items ?? [];
        const approved = lots.filter((m) => m.status === "APPROVED");
        return (
          <div className="card" key={o.organizationId}>
            <h2>{`${o.name} (${o.role ?? ""})`}</h2>
            <details>
              <summary>{t("org.addMember")}</summary>
              <ActionForm action={addMemberLot.bind(null, o.organizationId)} submit={t("org.addMember")} fields={[
                { name: "memberName", label: t("org.memberName"), required: true },
                { name: "productId", label: t("sell.product"), type: "select", options: names.productOptions() },
                { name: "unit", label: t("sell.unit"), type: "select", options: names.unitOptions() },
                { name: "quantity", label: t("sell.quantity"), mode: "decimal", required: true },
                { name: "gradeGroup", label: t("sell.grade"), value: "FAQ" },
                { name: "origin", label: t("sell.origin"), type: "select", options: names.marketOptions() },
                { name: "husk", label: t("sell.husk"), value: "WITH_HUSK" },
              ]} />
            </details>
            <h3>{t("org.members")}</h3>
            {lots.length ? (
              <table><tbody>{lots.map((m) => (
                <tr key={m.memberLotId}>
                  <td>{`${m.memberName} — ${m.quantity} ${m.unit}`}</td>
                  <td><Badge t={t} status={m.status} /></td>
                  <td>{m.status === "PENDING_REVIEW" ? (
                    <div className="forms">
                      <ActionForm action={reviewMemberLot.bind(null, m.memberLotId, true)} submit={t("org.review")} />
                      <ActionForm action={reviewMemberLot.bind(null, m.memberLotId, false)} submit={t("org.reject")} variant="danger" />
                    </div>
                  ) : null}</td>
                </tr>
              ))}</tbody></table>
            ) : <Empty t={t} />}
            <h3>{t("org.aggregate")}</h3>
            {approved.length ? (
              <ActionForm action={buildAggregate.bind(null, o.organizationId)} submit={t("org.aggregate")} fields={[
                { name: "from", label: t("sell.from"), type: "datetime-local", required: true },
                { name: "to", label: t("sell.to"), type: "datetime-local", required: true },
                { name: "expires", label: t("sell.expires"), type: "datetime-local", required: true },
                { name: "tol", label: t("org.tolerance"), type: "number", value: "2" },
              ]}>
                <fieldset>
                  <legend>{t("org.select")}</legend>
                  {approved.map((m) => (
                    <div className="row" key={m.memberLotId}>
                      <input type="checkbox" id={`m-${m.memberLotId}`} name="memberLotIds" value={m.memberLotId} />
                      <label className="inline" htmlFor={`m-${m.memberLotId}`}>{`${m.memberName} — ${m.quantity} ${m.unit}`}</label>
                    </div>
                  ))}
                </fieldset>
              </ActionForm>
            ) : <Empty t={t} />}
            <h3>{t("org.settlements")}</h3>
            {settleable.length ? settleable.map((d) => (
              <div className="card" key={d.dealId}>
                <b>{d.dealId}</b>
                <ActionForm action={draftSettlement.bind(null, d.dealId)} submit={t("deals.settlement")} fields={[{ name: "ded", label: t("deals.deductions"), hint: "TRANSPORT:1500, COMMISSION:500" }]} />
              </div>
            )) : <Empty t={t} />}
          </div>
        );
      })}
    </>
  );
}
