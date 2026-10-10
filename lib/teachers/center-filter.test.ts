// Chính sách gắn giáo viên — ĐÃ ĐỔI 06/08/2026.
//
// Trước: GV phải CÙNG cơ sở với lớp (T-RBAC-1…8, cách ly CS1↔CS2).
// Nay:   GV là nguồn lực chung của Hội sở, được phân lịch xuống mọi cơ sở ⇒ gắn
//        được BẤT KỲ GV nào cho lớp / lịch trial. Chủ dự án chốt.
//
// Các ca T-RBAC cũ khoá chính sách đã bỏ nên đã gỡ — KHÔNG phải hạ chuẩn test.
// Guard duy nhất còn lại là "teacherId không tồn tại", vẫn được khoá bên dưới.
import { describe, it, expect } from "vitest";
import { filterTeachersByCenter, teacherCenterAssignmentError } from "./center-filter";

describe("gắn GV không còn ràng buộc cơ sở", () => {
  const gv = (id: string, centerId: string | null) => ({ id, centerId });

  it("GV cơ sở KHÁC → cho phép (trước đây chặn)", () => {
    expect(teacherCenterAssignmentError("cs1", [gv("t1", "cs2")])).toBeNull();
  });

  it("GV Hội sở → cho phép", () => {
    expect(teacherCenterAssignmentError("cs1", [gv("t1", "hoi-so")])).toBeNull();
  });

  it("GV cùng cơ sở → cho phép", () => {
    expect(teacherCenterAssignmentError("cs1", [gv("t1", "cs1")])).toBeNull();
  });

  it("GV chưa gán cơ sở (null) → cho phép — cơ sở không còn là điều kiện", () => {
    expect(teacherCenterAssignmentError("cs1", [gv("t1", null)])).toBeNull();
  });

  it("VẪN chặn teacherId không tồn tại — guard chống IDOR/typo, không phải chính sách cơ sở", () => {
    expect(teacherCenterAssignmentError("cs1", [{ id: "ghost", centerId: undefined }]))
      .toMatch(/không hợp lệ/);
  });

  it("dropdown hiện ĐỦ mọi GV dù chọn cơ sở nào", () => {
    const ds = [gv("a", "cs1"), gv("b", "cs2"), gv("c", "hoi-so"), gv("d", null)];
    expect(filterTeachersByCenter(ds, "cs1").map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });
});
