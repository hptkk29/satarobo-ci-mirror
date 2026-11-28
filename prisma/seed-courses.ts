// FIX 7 — Seed Sata1–8 + Combo vào model Course (đồng bộ từ courses-pricing.ts).
// Idempotent (upsert theo slug). KHÔNG đụng 2 khoá cũ (laptrinhrobot, luyenthirobosim)
// và KHÔNG re-map Class hiện có — chỉ THÊM khoá mới để dropdown tạo lớp + tiên quyết
// + tự-điền học phí (FIX 8) hoạt động. Seed sẵn cặp tiên quyết Sata8 ← Sata1.
//
// Chạy: pnpm exec dotenv -e .env -- tsx prisma/seed-courses.ts
import { db } from "../lib/db";
import { courseGroups } from "../components/legacy-laptrinhrobot/_data/courses-pricing";

function slugFor(id: string): string {
  return id === "Combo" ? "combo-luyen-thi" : id.toLowerCase();
}

async function main() {
  const flat = courseGroups.flatMap((g) => g.courses);
  let order = 10;
  for (const c of flat) {
    const price =
      c.earlyBirdPrice ?? c.fixedPrice ?? c.comboPrice ?? c.listPrice ?? null;
    const slug = slugFor(c.id);
    const name = `${c.id} — ${c.displayName}`;
    // ⚠️ `totalSessions` + `isTeachable` PHẢI được seed [28/09/2026].
    //
    // Cả hai cột trước đây bị bỏ trống, và cả hai đều hỏng CÂM:
    //  · `isTeachable` là cổng bày khoá trong form tạo đơn (`orders/_actions.ts:1632`
    //    — `where: { isActive: true, isTeachable: true }`). Mặc định của Prisma là
    //    `false` ⇒ máy mới seed xong mở `/admin/orders/new` ra danh sách khoá RỖNG,
    //    trông y hệt lỗi phân quyền.
    //  · `totalSessions` NULL làm luật "số buổi phải rơi đúng mốc học phần" thành
    //    no-op im lặng — nó chỉ áp khi `=== 48` (`lib/orders/so-buoi-hoc-phan.ts`).
    //    Không cổng nào đỏ, không lỗi nào báo; tính năng chỉ đơn giản không chạy.
    //
    // `c.sessions` là con số marketing đã công bố (`courses-pricing.ts`) và khớp đúng
    // số bài giáo trình mà `seed-curriculum-sata.ts` nạp — đo 28/09: 48/48/48/48/48 ·
    // 32 · 16 · 16 · 5, bằng chính giá trị đang chạy trên prod.
    const soBuoi = c.sessions ?? null;
    await db.course.upsert({
      where: { slug },
      update: { name, code: c.id, price, isActive: true, totalSessions: soBuoi, isTeachable: true },
      create: {
        name,
        slug,
        code: c.id,
        price,
        totalSessions: soBuoi,
        isTeachable: true,
        type: "OFFLINE",
        isActive: true,
        isPublished: false, // nội bộ LMS — public site dùng CoursePackage
        displayOrder: order,
      },
    });
    console.log(`  ✓ ${slug} — ${name} (${price ?? "—"}đ · ${soBuoi ?? "—"} buổi)`);
    order += 10;
  }

  // Cặp tiên quyết mẫu: Sata8 (Vé Vàng Chung Kết) yêu cầu Sata1 (Robosim Master).
  const [sata8, sata1] = await Promise.all([
    db.course.findUnique({ where: { slug: "sata8" }, select: { id: true } }),
    db.course.findUnique({ where: { slug: "sata1" }, select: { id: true } }),
  ]);
  if (sata8 && sata1) {
    await db.coursePrerequisite.upsert({
      where: {
        courseId_requiredCourseId: {
          courseId: sata8.id,
          requiredCourseId: sata1.id,
        },
      },
      update: {},
      create: { courseId: sata8.id, requiredCourseId: sata1.id },
    });
    console.log("  ✓ Tiên quyết: Sata8 ← Sata1");
  }

  console.log(`\nĐã upsert ${flat.length} khoá.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
