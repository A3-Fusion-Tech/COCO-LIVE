import { getT } from "../_lib/server.ts";

export default async function NotFound() {
  const t = await getT();
  return (
    <>
      <h1>404</h1>
      <p>{t("err.notFound")}</p>
      <p><a href="/">{t("nav.prices")}</a></p>
    </>
  );
}
