// [ND13-HV] — 3 ô người lớn mới trên hồ sơ học viên (25/09/2026) phải có trong luồng
// XOÁ (ẩn danh) và luồng MANG THEO (xuất dữ liệu) của NĐ13.
//
// Vì sao cần lưới: thêm cột PII vào `Student` mà quên hai danh sách này thì không gì đỏ —
// xoá theo yêu cầu vẫn báo "đã xoá" trong khi ngày sinh + link Facebook phụ huynh còn
// nguyên, và bản xuất cho phụ huynh thiếu dữ liệu của chính họ. Cả hai là lỗi CÂM.
//
// Khẳng định HÀNH VI (giá trị trả về / tham số truyền cho Prisma), không grep mã nguồn.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, findManyRong } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findManyRong: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  db: {
    student: { findUnique },
    enrollment: { findMany: findManyRong },
    attendance: { findMany: findManyRong },
    examAttempt: { findMany: findManyRong },
    assignmentSubmission: { findMany: findManyRong },
    payment: { findMany: findManyRong },
    studentSkillAssessment: { findMany: findManyRong },
  },
}));

import { buildErasureData } from "./erasure";
import { exportStudentData } from "./portability";
import { tenLaDaAnDanh } from "@/lib/students/da-an-danh";

const BA_O_MOI = ["parentGender", "parentDob", "parentFacebookUrl"] as const;

describe("[ND13-HV] ô phụ huynh mới trong luồng NĐ13", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("[ND13-HV-01] xoá (ẩn danh) ghi NULL cho cả 3 ô — khoá CÓ MẶT (Prisma mới ghi)", () => {
    const data = buildErasureData("stu_abcdef123");
    for (const k of BA_O_MOI) {
      expect(k in data, k).toBe(true);
      expect((data as Record<string, unknown>)[k], k).toBeNull();
    }
  });

  it("[ND13-HV-02] xuất dữ liệu (mang theo) chọn cả 3 ô", async () => {
    findUnique.mockResolvedValue({ id: "stu_1", name: "HV" });
    await exportStudentData("stu_1");
    expect(findUnique).toHaveBeenCalledTimes(1);
    const arg = findUnique.mock.calls[0]?.[0] as { select?: Record<string, unknown> };
    for (const k of BA_O_MOI) {
      expect(arg.select?.[k], k).toBe(true);
    }
  });
});

// 25/09/2026 — lượt rà đối kháng: hồ sơ đã ẩn danh vẫn giữ `leadId` ⇒ khối "Lead nguồn"
// in tên + SĐT gia đình ngay cạnh "[Đã xoá …]"; và các đường nối lead không nhận ra hồ sơ
// đã ẩn danh ⇒ điền LẠI PII vừa xoá. Hai ca dưới khoá cả hai vế.
describe("[ND13-HV] ẩn danh cắt liên kết lead và mang dấu nhận biết", () => {
  it("[ND13-HV-03] xoá (ẩn danh) ghi NULL cho leadId + leadChildId — khoá CÓ MẶT", () => {
    const data = buildErasureData("stu_abcdef123") as Record<string, unknown>;
    for (const k of ["leadId", "leadChildId"]) {
      expect(k in data, k).toBe(true);
      expect(data[k], k).toBeNull();
    }
  });

  it("[ND13-HV-04] tên sau ẩn danh được `tenLaDaAnDanh` nhận ra (hai phía dùng CHUNG một tiền tố)", () => {
    const { name } = buildErasureData("stu_abcdef123");
    expect(tenLaDaAnDanh(name)).toBe(true);
    expect(tenLaDaAnDanh("Nguyễn Văn A")).toBe(false);
  });
});
