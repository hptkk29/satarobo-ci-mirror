/**
 * FL2-06 — Đảo thứ tự truy vấn cho liền mạch (BA #07 US-LEAD-5):
 *  - AC1 Chuyển cơ sở: chọn CƠ SỞ trước → danh sách HỌC SINH thuộc cơ sở đó.
 *  - AC2 Hoàn thành khoá: HỌC VIÊN → KHOÁ đang học (theo enrollment) → LỚP (theo khoá).
 *
 * ⚠️ SPEC PHÁC (không nằm trong CI run mặc định của lane). Phần helper dây chuyền
 * assert runnable; luồng UI phụ thuộc để fixme khi dựng fixture.
 */
import { test, expect } from "@playwright/test";
import { buildStudentCourseChain } from "../../../lib/enrollment-flow";

const e = (courseId: string, courseName: string, classId: string, name: string, classCode: string | null = null) => ({
  courseId,
  course: { name: courseName },
  classId,
  class: { name, classCode },
});

test.describe("[FL2-06] Chuyển cơ sở (cơ sở→HS) & Hoàn thành khoá (HS→khoá→lớp)", () => {
  // AC2 — dây chuyền HS → khoá đang học → lớp. Gom enrollment theo khoá, lớp theo khoá.
  test("[FL2-06-T1] buildStudentCourseChain: khoá → lớp phụ thuộc", async () => {
    const chain = buildStudentCourseChain([
      e("co-1", "Sata 1", "cl-1", "Lớp A", "A01"),
      e("co-1", "Sata 1", "cl-2", "Lớp B"),
      e("co-2", "Sata 2", "cl-3", "Lớp C"),
    ]);
    expect(chain.map((c) => c.courseId)).toEqual(["co-1", "co-2"]);
    expect(chain[0].classes.map((c) => c.classId)).toEqual(["cl-1", "cl-2"]);
    expect(chain[0].classes[0].label).toBe("Lớp A (A01)");
  });

  test("[FL2-06-T2] HV không có khoá đang học → chuỗi rỗng (UI báo trống)", async () => {
    expect(buildStudentCourseChain([])).toEqual([]);
  });

  // AC1 (UI) — chuyển cơ sở: chọn cơ sở nguồn trước → student select đổ HV cơ sở đó.
  test.fixme("[FL2-06-T3] chuyen-lop: chọn cơ sở nguồn → list HS thuộc cơ sở", async () => {
    // TODO(fixture): seed HV@CS1 + HV@CS2 (đều có enrollment active). Mở /admin/chuyen-lop:
    //  - Trước khi chọn cơ sở: student select disabled ("Chọn cơ sở nguồn trước").
    //  - Chọn CS1 → URL ?fromCenterId=CS1, student select chỉ HV của CS1, không có HV CS2.
  });

  // AC2 (UI) — hoàn thành khoá: chọn HV → khoá đang học → lớp (3 bước phụ thuộc).
  test.fixme("[FL2-06-T4] hoan-thanh-khoa: HV → khoá → lớp dây chuyền", async () => {
    // TODO(fixture): seed HV có 1 enrollment active (Course X, Class Y). Mở /admin/hoan-thanh-khoa:
    //  - Chọn HV → khoá select đổ "Course X"; chọn khoá → lớp select đổ "Class Y" (auto-chọn nếu 1 lớp).
    //  - Submit + đánh giá GV → toast chứng chỉ; CourseCompletion gắn classId Y.
  });

  // Cách ly cơ sở: CS1 chọn fromCenterId=CS2 (ngoài tầm nhìn) → student list rỗng.
  test.fixme("[FL2-06-T5] chuyen-lop: fromCenterId ngoài scope → rỗng (cách ly)", async () => {
    // TODO(fixture): đăng nhập CENTER_MANAGER@CS1, ép ?fromCenterId=<CS2> → student select rỗng.
  });
});
