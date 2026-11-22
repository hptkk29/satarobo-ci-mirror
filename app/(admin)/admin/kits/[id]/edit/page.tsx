import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { KitForm } from "../../_components/kit-form";

interface Props {
  params: Promise<{ id: string }>;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function asStringRecord(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const result: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") result[k] = val;
      else if (typeof val === "number" || typeof val === "boolean") result[k] = String(val);
    }
    return result;
  }
  return {};
}

export default async function EditKitPage({ params }: Props) {
  // A0-04: layout admin đã gate auth; cần session để dựng actor cho scopedDb.
  // ZMRoboKit là catalog toàn cục (không scoped) — pass-through.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sdb = scopedDb(await resolveActor(session.user.id));

  const { id } = await params;
  const kit = await sdb.zMRoboKit.findUnique({ where: { id } });
  if (!kit) notFound();

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">
        Sửa Kit: <span className="font-bold text-primary">{kit.title}</span>
      </h1>
      <KitForm
        kit={{
          id: kit.id,
          slug: kit.slug,
          brand: kit.brand,
          series: kit.series,
          code: kit.code,
          title: kit.title,
          subtitle: kit.subtitle,
          shortDescription: kit.shortDescription,
          description: kit.description,
          priceDisplay: kit.priceDisplay,
          isAvailable: kit.isAvailable,
          specs: asStringRecord(kit.specs),
          features: asStringArray(kit.features),
          highlights: asStringArray(kit.highlights),
          mainImage: kit.mainImage,
          galleryImages: kit.galleryImages,
          sourceUrl: kit.sourceUrl,
          displayOrder: kit.displayOrder,
          isPublished: kit.isPublished,
        }}
      />
    </div>
  );
}
