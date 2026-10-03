"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center">
      <h1>We couldn’t open this page.</h1>
      <p>Your saved library is still on this device.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
