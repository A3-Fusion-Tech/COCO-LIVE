"use client";

/**
 * Error boundary for every app page (API unreachable, unexpected API errors). In production Next.js replaces
 * server error messages with a digest, so the message is generic and bilingual.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <h1>LiveCoco</h1>
      <p className="err" role="alert">ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும். <span lang="en">Something went wrong. Try again.</span></p>
      {error.digest ? <p className="hint">ref: {error.digest}</p> : null}
      <button type="button" onClick={() => retry()}>மீண்டும் முயற்சி · Try again</button>
    </>
  );
}
