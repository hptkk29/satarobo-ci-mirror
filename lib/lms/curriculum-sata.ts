// lib/lms/curriculum-sata.ts — GIÁO TRÌNH SATA dưới dạng dữ liệu chuẩn hoá.
//
// Vì sao file này tồn tại: tên dự án thật của từng buổi ("Bàn Tay Ma Thuật",
// "Đấu Trường Con Quay", …) từ trước tới nay CHỈ nằm hardcode trong data marketing
// của site public (`components/legacy-laptrinhrobot/_data/*`) và chưa bao giờ được
// đổ vào bảng `Lesson`. Hệ quả: phiếu nhận xét gửi phụ huynh in ra tên bịa
// ("Dự án 3: Buổi 3", hoặc hằng "Dự án 1: Làm quen hệ thống") cho MỌI giáo trình —
// đúng thứ chủ dự án phàn nàn 25/08.
//
// File này PURE (không DB, không React): nó chỉ dịch 2 nguồn marketing thành một
// bản thiết kế giáo trình để `prisma/seed-curriculum-sata.ts` nạp xuống
// Curriculum + Lesson. Tách ra để test được bằng vitest mà không cần Postgres.
//
// ⚠️ Nguồn marketing là SỰ THẬT DUY NHẤT về tên bài. Muốn sửa tên dự án thì sửa
// `roadmap-5-years.ts` / `exam-roadmap.ts` rồi chạy lại seed — ĐỪNG gõ tay vào DB,
// vì lần seed sau sẽ ghi đè.
import { examRoadmap } from "@/components/legacy-laptrinhrobot/_data/exam-roadmap";
import { roadmap5Years } from "@/components/legacy-laptrinhrobot/_data/roadmap-5-years";

/** Một bài trong giáo trình — khớp 1-1 với `Lesson`. */
export type SataLessonBlueprint = {
  /** Số thứ tự trong TOÀN khoá (1..48), không phải trong học phần. → Lesson.order */
  order: number;
  /** Tên dự án của buổi, chuỗi TRẦN — "Bàn Tay Ma Thuật". → Lesson.title */
  title: string;
  /** "HP1" | null (khoá không chia học phần). → Lesson.moduleCode */
  moduleCode: string | null;
  /** "Học phần 1" | null. → Lesson.moduleName */
  moduleName: string | null;
  /** Loại buổi theo giáo trình: "Dự án" / "Ôn tập" / "Demo cuối học phần"… */
  kind: string | null;
  /** Mô tả học phần chứa bài này. → Lesson.description */
  description: string | null;
  /** Kỹ năng của học phần. → Lesson.objectives */
  objectives: string[];
};

/** Một giáo trình — khớp 1-1 với `Curriculum` + đàn `Lesson` của nó. */
export type SataCurriculumBlueprint = {
  /** slug của `Course` (khớp `prisma/seed-courses.ts`: "sata3", "combo-luyen-thi"…). */
  courseSlug: string;
  /** Mã sản phẩm gốc — "Sata3", "Combo". */
  productCode: string;
  /** → Curriculum.name */
  name: string;
  /** → Curriculum.description */
  description: string | null;
  lessons: SataLessonBlueprint[];
};

/** Cùng quy tắc slug với `prisma/seed-courses.ts` — khoá phải khớp thì mới nối được. */
export function courseSlugFor(productCode: string): string {
  return productCode === "Combo" ? "combo-luyen-thi" : productCode.toLowerCase();
}

/**
 * Sata3–Sata7 — lộ trình 5 năm, mỗi khoá 4 học phần × 12 buổi = 48 buổi.
 * `order` đánh liên tục 1..48 xuyên học phần (khớp cách `ClassSession` đếm buổi),
 * còn học phần đi vào `moduleCode`/`moduleName`.
 */
function longTermCurricula(): SataCurriculumBlueprint[] {
  return roadmap5Years.map((course) => {
    const lessons: SataLessonBlueprint[] = [];
    let order = 0;
    for (const mod of course.modules) {
      for (const s of mod.sessionList) {
        order += 1;
        lessons.push({
          order,
          title: s.content,
          moduleCode: mod.id, // "HP1"
          moduleName: mod.name, // "Học phần 1"
          kind: s.type ?? null,
          description: mod.description ?? null,
          objectives: mod.skills ?? [],
        });
      }
    }
    return {
      courseSlug: courseSlugFor(course.productCode),
      productCode: course.productCode,
      name: `Giáo trình ${course.productCode} — ${course.academicName || course.name}`,
      description: course.description ?? null,
      lessons,
    };
  });
}

/**
 * Sata1 / Sata2 / Sata8 — MỘT học phần trọn khoá.
 *
 * ⚠️ ĐẢO CHỐT CŨ [chủ dự án ký 26/09/2026]: *"sata1, sata2 gồm 1 học phần 16 bài … sata8:
 * 1 học phần 5 buổi"*. Luật cũ để `moduleCode = null` (khoá luyện thi KHÔNG chia học
 * phần) để nhãn buổi rút gọn còn `"Buổi 1 - <tên bài>"`.
 *
 * Hệ quả người dùng THẤY, đã đo trước khi đổi (`lib/lms/session-project-name.ts`):
 *   · NHÃN BUỔI đổi `"Buổi 3 - Tên bài"` → `"Buổi 3 - HP1 - Tên bài"` (màn GV/admin);
 *   · PHIẾU GỬI PHỤ HUYNH KHÔNG đổi — `deriveSessionProjectName` cắt tiền tố học phần,
 *     phụ huynh vẫn đọc tên trần. Đây là chốt 25/08 và bản đổi này không đụng tới.
 *
 * Ca ghim luật cũ (`"khoá luyện thi Sata1/2/8 KHÔNG chia học phần"`) đã được ĐẢO kèm đối
 * chứng dương, không xoá lặng — xem `curriculum-sata.test.ts`.
 *
 * Combo (32 buổi) không có mảng `lessons` riêng vì bản chất nó là Sata1 + Sata2 ghép
 * lại — nên ở đây ghép đúng như vậy và ĐẶT học phần theo tên khoá con, để phiếu buổi
 * 17 không lẫn với buổi 1.
 */
function examCurricula(): SataCurriculumBlueprint[] {
  const byId = new Map(examRoadmap.map((c) => [c.id, c]));
  const out: SataCurriculumBlueprint[] = [];

  for (const c of examRoadmap) {
    if (c.id === "Combo") continue; // xử lý riêng bên dưới
    const titles = c.lessons ?? [];
    if (titles.length === 0) continue;
    out.push({
      courseSlug: courseSlugFor(c.id),
      productCode: c.id,
      name: `Giáo trình ${c.id} — ${c.displayName}`,
      description: c.description ?? null,
      lessons: titles.map((title, i) => ({
        order: i + 1,
        title,
        // MỘT học phần trọn khoá (chủ dự án ký 26/09/2026). Tên đặt `"Học phần 1"` cho
        // khớp Sata3–7 — với khoá một học phần thì nhắc lại tên khoá không thêm gì.
        moduleCode: "HP1",
        moduleName: "Học phần 1",
        kind: null,
        description: c.goal ?? null,
        objectives: c.outcomes ?? [],
      })),
    });
  }

  const combo = byId.get("Combo");
  const sata1 = byId.get("Sata1");
  const sata2 = byId.get("Sata2");
  if (combo && sata1?.lessons?.length && sata2?.lessons?.length) {
    const parts: { code: string; name: string; titles: string[] }[] = [
      { code: "HP1", name: sata1.displayName, titles: sata1.lessons },
      { code: "HP2", name: sata2.displayName, titles: sata2.lessons },
    ];
    const lessons: SataLessonBlueprint[] = [];
    let order = 0;
    for (const p of parts) {
      for (const title of p.titles) {
        order += 1;
        lessons.push({
          order,
          title,
          moduleCode: p.code,
          moduleName: p.name,
          kind: null,
          description: combo.description ?? null,
          objectives: [],
        });
      }
    }
    out.push({
      courseSlug: courseSlugFor("Combo"),
      productCode: "Combo",
      name: `Giáo trình Combo — ${combo.displayName}`,
      description: combo.description ?? null,
      lessons,
    });
  }

  return out;
}

/**
 * Toàn bộ giáo trình Sata (9 khoá: Sata1–Sata8 + Combo), sắp theo mã khoá.
 * Gọi mỗi lần đều trả cùng kết quả — không đọc DB, không đọc env.
 */
export function buildSataCurricula(): SataCurriculumBlueprint[] {
  const all = [...longTermCurricula(), ...examCurricula()];
  return all.sort((a, b) => a.productCode.localeCompare(b.productCode, "vi"));
}
