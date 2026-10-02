"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiCall, problemOf, translate, type Catalog, type Lang, type Me } from "./lib.ts";
import { PAGES, makeCtx, type Shell } from "./pages.tsx";

/** Nav entries by session: public pages, signed-in workflows, the ops console for operators. */
function navLinks(me: Me | null): [route: string, key: string][] {
  const links: [string, string][] = [["prices", "nav.prices"], ["market", "nav.market"]];
  if (me) links.push(["sell", "nav.sell"], ["buy", "nav.buy"], ["deals", "nav.deals"], ["org", "nav.org"], ["partner", "nav.partner"], ["me", "nav.me"]);
  if (me?.capabilities.some((c) => c.startsWith("ops."))) links.push(["ops", "nav.ops"]);
  if (!me) links.push(["login", "nav.login"]);
  return links;
}
const go = (route: string) => { location.hash = `#/${route}`; };

/**
 * The authenticated app shell: hash routing (`#/route/param`), Tamil/English toggle, toast, and a page area
 * that swaps in each page only once its data has loaded (a stale load is dropped if the route changed).
 */
export function App() {
  const [lang, setLang] = useState<Lang>("ta");
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [hash, setHash] = useState("");
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<{ node: ReactNode; seq: number }>({ node: <p>Loading…</p>, seq: 0 });
  const [toast, setToast] = useState<{ msg: string; bad: boolean; id: number } | null>(null);
  const langRef = useRef<Lang>("ta");
  const meRef = useRef<Me | null>(null);
  const catalogRef = useRef<Catalog | null>(null);
  const seqRef = useRef(0);
  const mainRef = useRef<HTMLElement>(null);

  const api: Shell["api"] = useCallback((method, path, body, opts) => apiCall(langRef.current, method, path, body, opts), []);
  const loadMe = useCallback(async () => {
    let m: Me | null = null;
    try { m = await api("GET", "/v1/me"); } catch { m = null; }
    meRef.current = m; setMe(m);
  }, [api]);
  const logout = useCallback(async () => {
    await fetch("/session/logout", { method: "POST", headers: { "x-requested-with": "livecoco" } });
    meRef.current = null; setMe(null); go("prices");
  }, []);
  const showToast = useCallback((msg: string, bad = false) => setToast({ msg, bad, id: Date.now() + Math.random() }), []);

  useEffect(() => {
    try { langRef.current = localStorage.getItem("lc_lang") === "en" ? "en" : "ta"; } catch { langRef.current = "ta"; }
    setLang(langRef.current);
    const onHash = () => setHash(location.hash);
    onHash();
    window.addEventListener("hashchange", onHash);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    void loadMe().then(() => setReady(true));
    return () => window.removeEventListener("hashchange", onHash);
  }, [loadMe]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4000); return () => clearTimeout(id); }, [toast]);

  useEffect(() => {
    if (!ready) return;
    const seq = ++seqRef.current;
    const [route = "prices", param] = (hash.slice(2) || "prices").split("/");
    const t = (k: string) => translate(lang, k);
    void (async () => {
      let node: ReactNode;
      try {
        catalogRef.current ??= await api("GET", "/v1/catalog");
        const shell: Shell = { lang, me: meRef.current, catalog: catalogRef.current, t, api, toast: showToast, reload: () => setVersion((v) => v + 1), go, loadMe, logout };
        node = await (PAGES[route] ?? PAGES.prices)!(makeCtx(shell), param);
      } catch (e) {
        const p = problemOf(e);
        node = <p className="err">{p.message ?? t("err.generic")}</p>;
        if (p.status === 401) go("login");
      }
      if (seq === seqRef.current) setView({ node, seq });
    })();
  }, [ready, hash, lang, version, api, loadMe, logout, showToast]);

  useEffect(() => { if (view.seq) mainRef.current?.focus({ preventScroll: true }); }, [view.seq]);

  const cur = (hash.slice(2) || "prices").split("/")[0];
  const switchLang = () => {
    const next: Lang = lang === "ta" ? "en" : "ta";
    try { localStorage.setItem("lc_lang", next); } catch { /* storage unavailable */ }
    langRef.current = next; setLang(next);
  };
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="top">
      <a className="brand" href="#/prices">LiveCoco</a>
      <nav id="nav" aria-label="Main">{navLinks(me).map(([r, k]) => <a key={r} href={`#/${r}`} aria-current={cur === r ? "page" : undefined}>{translate(lang, k)}</a>)}</nav>
      <button id="lang" type="button" aria-label="Language" onClick={switchLang}>{lang === "ta" ? "English" : "தமிழ்"}</button>
    </header>
    <div id="toast" role="status" aria-live="polite">{toast ? <span className={toast.bad ? "err" : ""}>{toast.msg}</span> : null}</div>
    <main id="main" tabIndex={-1} ref={mainRef} key={view.seq}>{view.node}</main>
    <noscript>This application needs JavaScript. Public prices are available at <a href="/">the price page</a>.</noscript>
  </>;
}
