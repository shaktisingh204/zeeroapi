import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOC_SLUGS, getProviderDoc } from "@/lib/docsContent";
import ProviderDocPage from "./provider-doc";

export function generateStaticParams() {
  return DOC_SLUGS.map((provider) => ({ provider }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ provider: string }>;
}): Promise<Metadata> {
  const { provider } = await params;
  const doc = getProviderDoc(provider);
  if (!doc) return { title: "Provider not found · ZeroApi docs" };
  return {
    title: `${doc.name} API · ZeroApi docs`,
    description: doc.tagline,
  };
}

export default async function Page({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const doc = getProviderDoc(provider);
  if (!doc) notFound();
  return <ProviderDocPage slug={doc.slug} />;
}
