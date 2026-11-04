/**
 * Cách ly cơ sở ở danh sách "học viên gán được vào lớp" (chủ dự án chốt 04/08/2026:
 * chỉ xếp học viên CS mình vào lớp CS mình).
 *
 * Bản cũ: `if (cls.centerId) student.centerId = cls.centerId` — ràng buộc TỰ TẮT khi
 * lớp chưa gán cơ sở, nên lớp đó hiện học viên của MỌI cơ sở trong danh sách gán.
 */
import { describe, it, expect } from "vitest";
import { buildAssignableWhere } from "./assign";

const cls = (centerId: string | null) => ({ id: "cls-1", courseId: "khoa-1", centerId });

describe("buildAssignableWhere — cách ly cơ sở", () => {
  it("lớp CS1 → chỉ lấy học viên CS1", () => {
    const w = buildAssignableWhere(cls("cs1"));
    expect((w.student as { centerId?: string }).centerId).toBe("cs1");
  });

  it("[GUARD TỰ TẮT] lớp chưa gán cơ sở → KHÔNG mở toang cho mọi cơ sở", () => {
    const w = buildAssignableWhere(cls(null));
    const centerId = (w.student as { centerId?: string }).centerId;
    // Điều cốt lõi: phải CÓ ràng buộc centerId (không undefined) và không khớp cơ sở thật nào.
    expect(centerId).toBeDefined();
    expect(centerId).not.toBe("cs1");
    expect(centerId).not.toBe("cs2");
  });

  it("giữ nguyên các điều kiện còn lại (khoá, trạng thái, khác lớp hiện tại)", () => {
    const w = buildAssignableWhere(cls("cs2"));
    expect(w.courseId).toBe("khoa-1");
    expect(w.classId).toEqual({ not: "cls-1" });
    expect(w.status).toBeDefined();
  });
});
