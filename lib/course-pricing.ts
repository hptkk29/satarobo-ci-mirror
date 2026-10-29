/**
 * Course pricing / roadmap data source (2-phase additive, DB-driven).
 *
 * `getCourseGroups()` trả về ĐÚNG shape `CourseGroup[]` mà các component legacy
 * (Roadmap5Years, RegistrationForm) đang dùng. Hiện trạng: nguồn là static
 * `courseGroups` trong `_data/courses-pricing.ts`.
 *
 * Pha DB: query `CoursePackage` (đã seed bởi seed-coursepackage-content.ts).
 * LƯU Ý — mapping CoursePackage → CourseGroup là LOSSY: shape `Course` chứa
 * nhiều field nghiệp vụ phái sinh (comboPrice/fixedPrice/installmentOutside/
 * earlyBirdOutside/durationPerSession/totalDuration/`value` string dropdown…) và
 * cấu trúc nhóm ("Khóa luyện thi" vs "Khóa chuyên sâu 48 buổi") KHÔNG có cột
 * tương ứng trong CoursePackage. Vì vậy, để giữ ZERO thay đổi giao diện + giữ
 * nguyên semantics `id`/`value` mà dropdown đăng ký phụ thuộc, pha hiện tại
 * fall back về static `courseGroups`. Helper vẫn query DB trong try/catch để
 * sẵn sàng cho pha sau (khi schema CoursePackage đủ field để map không mất mát).
 */
import { db } from "@/lib/db";
import { courseGroups, type CourseGroup } from "@/components/legacy-laptrinhrobot/_data/courses-pricing";

export type { CourseGroup };

/**
 * Nguồn dữ liệu nhóm khoá học + bảng giá.
 * Trả static `courseGroups` khi DB trống / lỗi / mapping chưa đủ (an toàn, đồng nhất visual).
 */
export async function getCourseGroups(): Promise<CourseGroup[]> {
  try {
    const packages = await db.coursePackage.findMany({
      where: { isPublished: true },
      orderBy: { displayOrder: "asc" },
    });

    // DB trống → static fallback.
    if (packages.length === 0) return courseGroups;

    // Mapping CoursePackage → CourseGroup hiện chưa đủ field (lossy, xem chú thích
    // đầu file). Giữ static làm nguồn cấu trúc cho tới khi schema đủ để map không
    // mất mát. KHÔNG bịa field.
    return courseGroups;
  } catch {
    return courseGroups;
  }
}
