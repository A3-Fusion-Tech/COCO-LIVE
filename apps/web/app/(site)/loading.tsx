import { getT } from "../_lib/server.ts";

export default async function Loading() {
  const t = await getT();
  return <p aria-busy="true">{t("common.loading")}</p>;
}
