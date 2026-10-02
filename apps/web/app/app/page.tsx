import { connection } from "next/server";
import { App } from "./_ui/App.tsx";
import "./app.css";

/** The authenticated app. Rendered per request so each response carries the nonce from `proxy.ts`. */
export default async function AppPage() {
  await connection();
  return <App />;
}
