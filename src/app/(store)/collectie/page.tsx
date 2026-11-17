import type { Metadata } from "next";
import { CatalogView } from "./catalog-view";

export const metadata: Metadata = { title: "Collectie", alternates: { canonical: "/collectie" } };

export default async function CollectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CatalogView searchParams={await searchParams} />;
}
