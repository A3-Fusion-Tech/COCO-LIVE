"use client";

/**
 * Shown when the board cannot be rendered and there is no earlier good copy to serve, i.e. the API is down.
 * Error boundaries render on the client without the server's locale, so the message is bilingual.
 */
export default function PricesUnavailable({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main">
      <h1>தேங்காய் விலைகள் · Coconut prices</h1>
      <p className="err" role="alert">விலைகள் தற்காலிகமாகக் கிடைக்கவில்லை. ஒரு நிமிடத்தில் மீண்டும் முயற்சிக்கவும்.</p>
      <p className="err" lang="en">Prices are temporarily unavailable. Please try again in a minute.</p>
      <button type="button" onClick={() => retry()}>மீண்டும் முயற்சி · Try again</button>
    </main>
  );
}
