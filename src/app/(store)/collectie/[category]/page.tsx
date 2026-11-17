import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "../catalog-view";
import { getCategoryTree } from "@/lib/data/catalog";

async function findCategory(slug: string) {
  const tree = await getCategoryTree();
  return tree.find((c) => c.slug === slug) ?? tree.flatMap((c) => c.children ?? []).find((c) => c.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const c = await findCategory(category);
  return c ? { title: c.name, description: `Shop ${c.name} bij THE SECRET SPOT – levering in heel Suriname.`, alternates: { canonical: `/collectie/${category}` } } : {};
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { category } = await params;
  if (!(await findCategory(category))) notFound();
  return <CatalogView searchParams={await searchParams} category={category} />;
}
