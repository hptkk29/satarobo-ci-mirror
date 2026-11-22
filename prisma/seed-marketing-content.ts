import { PrismaClient } from "@prisma/client";
import { promotions } from "../components/legacy-laptrinhrobot/_data/promotions";

// Seed nội dung marketing (Promotion) từ dữ liệu tĩnh _data/*.
// Idempotent: Promotion upsert theo slug.
// Nguồn gốc: trang khoá học Lập trình Robot (courseSlug = "laptrinhrobot").
// (Testimonial tách sang prisma/seed-testimonials.ts.)
export async function seedMarketingContent(db: PrismaClient) {
  console.log("🎁 Seeding marketing content (Promotion)...");

  // ─── Promotions ─────────────────────────────────────────────────────────────
  let order = 0;
  for (const p of promotions.primary) {
    await db.promotion.upsert({
      where: { slug: p.id },
      update: {
        kind: "PRIMARY",
        title: p.title,
        highlight: p.highlight,
        description: p.description,
        details: p.details,
        cta: p.cta,
        target: p.target,
        icon: p.icon,
        featured: p.featured ?? false,
        courseSlug: "laptrinhrobot",
        displayOrder: order,
      },
      create: {
        slug: p.id,
        kind: "PRIMARY",
        title: p.title,
        highlight: p.highlight,
        description: p.description,
        details: p.details,
        cta: p.cta,
        target: p.target,
        icon: p.icon,
        featured: p.featured ?? false,
        courseSlug: "laptrinhrobot",
        displayOrder: order,
      },
    });
    order++;
  }

  order = 0;
  for (const s of promotions.secondary) {
    await db.promotion.upsert({
      where: { slug: s.id },
      update: {
        kind: "SECONDARY",
        title: s.title,
        highlight: s.highlight,
        description: s.description,
        condition: s.condition,
        note: s.note,
        icon: s.icon,
        courseSlug: "laptrinhrobot",
        displayOrder: order,
      },
      create: {
        slug: s.id,
        kind: "SECONDARY",
        title: s.title,
        highlight: s.highlight,
        description: s.description,
        condition: s.condition,
        note: s.note,
        icon: s.icon,
        courseSlug: "laptrinhrobot",
        displayOrder: order,
      },
    });
    order++;
  }

  console.log(
    `✅ Marketing content: ${promotions.primary.length + promotions.secondary.length} promotion`,
  );
}

// Cho phép chạy độc lập: tsx prisma/seed-marketing-content.ts
if (require.main === module) {
  const db = new PrismaClient();
  seedMarketingContent(db)
    .catch((e) => {
      console.error("❌ Seed marketing content thất bại:", e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
