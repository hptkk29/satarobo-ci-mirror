// lib/enrollment-flow.ts — Helper cho luồng đăng ký / chuyển cơ sở / hoàn thành khoá
// (FixLMS FL2-05, FL2-06). Nhận diện "Hội sở" QUA OrgUnit tree (type ≠ CENTER) —
// KHÔNG hardcode mã "HO" hay tên cơ sở. Mở CS mới (type=CENTER) tự được coi là cơ
// sở nhận học viên mà không sửa code.
import { db } from "@/lib/db";
import type { OrgUnitType } from "@prisma/client";

// ─── FL2-05 — loại Hội sở khỏi picker/list đơn vị nhận học viên ───────────────

/**
 * Pure: `Center` nào KHÔNG nhận học viên. Cơ sở nhận HV = Center **có** một
 * `OrgUnit type=CENTER` (còn sống) trỏ tới. Mọi Center còn lại → loại.
 *
 * ⚠️ Bản cũ đi NGƯỢC chiều: lọc `OrgUnit` có `type != CENTER` **và** `centerId != null`.
 * Tổ hợp đó KHÔNG BAO GIỜ tồn tại — `prisma/seed-orgunit.ts` seed HO với `centerCode: null`
 * (và `schema.prisma` ghi rõ `centerId` "chỉ type=CENTER"). Nên hàm luôn trả `[]` và
 * "Hội sở" vẫn nằm trong picker chuyển lớp trên prod (phát hiện 10/07/2026). Test cũ vẫn
 * xanh vì nó dựng một thế giới giả trong đó `OrgUnit(HO)` CÓ `centerId` — thế giới mà
 * seed chưa bao giờ tạo ra.
 *
 * Đi từ `Center` ra thì bắt được cả `Center` MỒ CÔI (không OrgUnit nào trỏ tới) — đúng
 * hình dạng của `Center(hoi-so)` trên prod. Mở CS mới vẫn không cần sửa code: thêm
 * `OrgUnit type=CENTER` trỏ vào Center đó là nó tự được nhận học viên (Doc 15 OI-1).
 */
export function nonEnrollableCenterIds(
  centers: { id: string }[],
  orgUnits: { type: OrgUnitType; centerId: string | null; deletedAt?: Date | null }[],
): string[] {
  const enrollable = new Set(
    orgUnits
      .filter((o) => o.type === "CENTER" && o.deletedAt == null && o.centerId != null)
      .map((o) => o.centerId as string),
  );
  // Cây OrgUnit chưa dựng (fixture cũ, DB test tối giản) → đừng khoá sạch mọi picker.
  if (enrollable.size === 0) return [];
  return centers.filter((c) => !enrollable.has(c.id)).map((c) => c.id);
}

/** DB-backed: id các `Center` KHÔNG nhận học viên (vd Center "Hội sở"). */
export async function getNonEnrollableCenterIds(): Promise<string[]> {
  const [centers, orgUnits] = await Promise.all([
    db.center.findMany({ select: { id: true } }),
    db.orgUnit.findMany({ where: { deletedAt: null }, select: { type: true, centerId: true } }),
  ]);
  return nonEnrollableCenterIds(centers, orgUnits);
}

/**
 * Pure: học viên chỉ được xếp vào lớp CÙNG CƠ SỞ (chủ dự án chốt 04/08/2026).
 *
 * ⚠️ Bản cũ viết `if (cls.centerId && student.centerId !== cls.centerId)` — điều kiện
 * đầu làm guard TỰ TẮT khi lớp chưa gán cơ sở, nên lớp "không cơ sở" nhận được học
 * viên của MỌI cơ sở. Nay thiếu cơ sở ở bất kỳ bên nào đều chặn, kèm câu chỉ đường.
 *
 * Trả `null` = cho phép.
 */
export function crossCenterError(
  classCenterId: string | null | undefined,
  studentCenterId: string | null | undefined,
): string | null {
  if (!classCenterId) return "Lớp chưa gán cơ sở — sửa lớp và chọn cơ sở trước khi xếp học viên.";
  if (!studentCenterId) return "Học viên chưa gán cơ sở — sửa hồ sơ học viên và chọn cơ sở trước.";
  if (classCenterId !== studentCenterId) {
    return "Học viên thuộc cơ sở khác với lớp — chọn lớp cùng cơ sở hoặc chuyển cơ sở học viên trước.";
  }
  return null;
}

/** Đối tượng bị cấm gắn vào Hội sở (dùng cho câu báo lỗi). */
export type HeadOfficeSubject = "lead" | "học viên" | "lớp học";

/** Pure: có phải ca "gắn vào Hội sở" không (tách ra để test không cần DB). */
export function isHeadOfficePick(
  orgUnitId: string | null | undefined,
  resolvedCenterId: string | null | undefined,
  nonEnrollable: string[],
): boolean {
  // `centerIdForOrgUnit` map HO/ROOT → null. Nên "có chọn đơn vị nhưng ra null cơ sở"
  // CHÍNH LÀ ca chọn Hội sở — trước đây lọt êm: bản ghi ra KHÔNG CÓ cơ sở và biến mất
  // khỏi mọi màn lọc theo cơ sở, không một dòng báo lỗi nào.
  if (orgUnitId && !resolvedCenterId) return true;
  if (!resolvedCenterId) return false;
  return nonEnrollable.includes(resolvedCenterId);
}

/**
 * Chốt chặn server: **Hội sở không nhận lead / học viên / lớp học**.
 * Chủ dự án chốt 04/08/2026 — HO là cơ quan đầu não, không phải địa điểm dạy học
 * như CS1/CS2. Chặn ở server chứ không chỉ giấu khỏi dropdown: form vẫn có thể bị
 * POST thẳng, và bản ghi nằm ở HO thì kéo theo lớp/điểm danh/học phí sai.
 *
 * Trả `null` = hợp lệ, trả `string` = câu báo lỗi cho người dùng.
 */
export async function rejectHeadOffice(
  subject: HeadOfficeSubject,
  opts: { orgUnitId?: string | null; centerId?: string | null },
): Promise<string | null> {
  const nonEnrollable = await getNonEnrollableCenterIds();
  return isHeadOfficePick(opts.orgUnitId, opts.centerId, nonEnrollable)
    ? `Hội sở không nhận ${subject} — chọn cơ sở dạy học (CS1/CS2)`
    : null;
}

/**
 * Where-fragment loại các cơ sở khỏi truy vấn theo `centerId` model nghiệp vụ
 * (Student/Class…). GIỮ row có `centerId = null` (legacy chưa gán) để không ẩn nhầm,
 * chỉ loại đúng row trỏ tới cơ sở Hội sở. Rỗng → không thêm điều kiện (no-op).
 */
export function notHeadOfficeWhere(
  excludeCenterIds: string[],
): { OR: ({ centerId: null } | { centerId: { notIn: string[] } })[] } | Record<string, never> {
  if (excludeCenterIds.length === 0) return {};
  return { OR: [{ centerId: null }, { centerId: { notIn: excludeCenterIds } }] };
}

// ─── FL2-06 — dây chuyền HS → khoá đang học → lớp (hoàn thành khoá) ────────────

export type StudentCourseChain = {
  courseId: string;
  courseName: string;
  classes: { classId: string; label: string }[];
};

/**
 * Pure: gom enrollment ĐANG HỌC của 1 học viên thành dây chuyền khoá → lớp. Mỗi
 * khoá gom các lớp HV đang theo (khử trùng lớp). Dùng cho stepper hoàn thành khoá:
 * chọn HV → khoá (đang học) → lớp (theo khoá).
 */
export function buildStudentCourseChain(
  enrollments: {
    courseId: string;
    course: { name: string };
    classId: string;
    class: { name: string; classCode: string | null };
  }[],
): StudentCourseChain[] {
  const byCourse = new Map<string, StudentCourseChain>();
  for (const e of enrollments) {
    let entry = byCourse.get(e.courseId);
    if (!entry) {
      entry = { courseId: e.courseId, courseName: e.course.name, classes: [] };
      byCourse.set(e.courseId, entry);
    }
    if (!entry.classes.some((c) => c.classId === e.classId)) {
      entry.classes.push({
        classId: e.classId,
        label: e.class.name + (e.class.classCode ? ` (${e.class.classCode})` : ""),
      });
    }
  }
  return Array.from(byCourse.values());
}
