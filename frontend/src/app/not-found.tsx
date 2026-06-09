import Link from "next/link";
import { Activity } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 mb-10">
          <span className="h-9 w-9 rounded-xl bg-brand flex items-center justify-center">
            <Activity size={20} className="text-black" />
          </span>
          <span className="text-lg font-semibold text-white">ZeroApi</span>
        </Link>
        <p className="eyebrow justify-center">Error 404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-3 text-muted">
          The page you&apos;re looking for may have moved or never existed. Check the URL, or head
          back and try again.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/" className="btn-primary">
            Back to home
          </Link>
          <Link href="/docs" className="btn-ghost">
            Read the docs
          </Link>
        </div>
      </div>
    </main>
  );
}
