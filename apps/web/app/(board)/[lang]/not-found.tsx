/** Unknown single-segment paths (`/anything`) reach the board route and end here. */
export default function NotFound() {
  return (
    <main id="main">
      <h1>404</h1>
      <p>இந்தப் பக்கம் இல்லை. <span lang="en">This page does not exist.</span></p>
      <p><a href="/">LiveCoco</a></p>
    </main>
  );
}
