import { redirect } from "next/navigation";
import { safeNextPath } from "../../../../lib/gateway/session.ts";
import { getMe, getT } from "../../../_lib/server.ts";
import { LoginForm } from "./LoginForm.tsx";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next: raw } = await searchParams;
  const next = safeNextPath(typeof raw === "string" ? raw : undefined, "/market");
  if (await getMe().catch(() => null)) redirect(next);
  const t = await getT();
  return (
    <>
      <h1>{t("login.title")}</h1>
      <LoginForm next={next} labels={{ phone: t("login.phone"), send: t("login.send"), code: t("login.code"), verify: t("login.verify"), change: t("login.changePhone") }} />
    </>
  );
}
