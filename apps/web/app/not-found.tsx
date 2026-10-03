import Link from "next/link";
export default function NotFound() {
  return (
    <main className="center">
      <h1>This page isn’t here.</h1>
      <Link href="/">Back to Today</Link>
    </main>
  );
}
