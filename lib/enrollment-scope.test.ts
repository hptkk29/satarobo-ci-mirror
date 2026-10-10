// Canh gác cho lib/enrollment-scope.ts — QA site GV vòng 1, nguyên nhân gốc RC-1.
//
// Bộ test này KHÔNG chỉ kiểm hàm chạy đúng; nó chốt các BẤT BIẾN mà 22 chỗ đọc ghi
// danh đang phụ thuộc vào. Đỏ ở đây nghĩa là một trong các số liệu sĩ số / điểm danh /
// học bạ / chấm bài vừa lệch đi mà không ai nhận ra.
import { describe, expect, it } from "vitest";

import {
  inRosterScope,
  rosterStatuses,
  rosterWhere,
  type RosterScope,
} from "@/lib/enrollment-scope";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";

const SCOPES: RosterScope[] = ["dang-hoc", "ket-khoa", "lich-su"];

describe("rosterWhere — ba tầng lọc luôn đi cùng nhau", () => {
  it.each(SCOPES)("phạm vi %s có đủ cả ba tầng", (scope) => {
    const w = rosterWhere(scope);
    expect(w.deletedAt).toBe(null);
    expect(w.student).toEqual({ deletedAt: null });
    expect(w.status).toEqual({ in: rosterStatuses(scope) });
  });

  it("hình dạng khớp mẫu đang dùng ở hub-students-tab (chỗ viết ĐÚNG sẵn có)", () => {
    expect(rosterWhere("dang-hoc")).toEqual({
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
      deletedAt: null,
      student: { deletedAt: null },
    });
  });
});

describe("rosterStatuses — ba tập lồng nhau đúng thứ tự", () => {
  it("dang-hoc ⊂ ket-khoa ⊂ lich-su", () => {
    const dangHoc = new Set(rosterStatuses("dang-hoc"));
    const ketKhoa = new Set(rosterStatuses("ket-khoa"));
    const lichSu = new Set(rosterStatuses("lich-su"));

    for (const s of dangHoc) expect(ketKhoa.has(s)).toBe(true);
    for (const s of ketKhoa) expect(lichSu.has(s)).toBe(true);
    expect(ketKhoa.size).toBeGreaterThan(dangHoc.size);
    expect(lichSu.size).toBeGreaterThan(ketKhoa.size);
  });

  it("ket-khoa thêm COMPLETED và KHÔNG thêm WITHDREW", () => {
    expect(rosterStatuses("ket-khoa")).toContain("COMPLETED");
    // Em nghỉ giữa chừng không phải "kết khoá" — đưa vào là sai nghiệp vụ, và làm
    // mẫu số của màn Hoàn thành khoá phồng lên.
    expect(rosterStatuses("ket-khoa")).not.toContain("WITHDREW");
  });

  it("lich-su gồm cả COMPLETED lẫn WITHDREW", () => {
    expect(rosterStatuses("lich-su")).toEqual(
      expect.arrayContaining(["COMPLETED", "WITHDREW"]),
    );
  });

  it.each(SCOPES)("phạm vi %s không bao giờ chứa PENDING/CANCELLED/TRANSFERRED", (scope) => {
    const st = rosterStatuses(scope);
    // PENDING = chờ xác nhận, chưa vào lớp. TRANSFERRED = đã thuộc lớp khác.
    expect(st).not.toContain("PENDING");
    expect(st).not.toContain("CANCELLED");
    expect(st).not.toContain("TRANSFERRED");
  });

  it("trả bản sao — người gọi sửa không hỏng nguồn", () => {
    const a = rosterStatuses("dang-hoc");
    a.push("WITHDREW");
    expect(rosterStatuses("dang-hoc")).not.toContain("WITHDREW");
  });

  it("ENROLLMENT_ACTIVE_STATUS_LIST vẫn đúng 4 phần tử — canh gác chống vá tắt", () => {
    // Cả 4 site đọc hằng này (109 lượt gọi ở 45 file). Ai đó "sửa bug" bằng cách thêm
    // COMPLETED vào đây sẽ làm lớp đã kết khoá hiện lại ở MỌI màn, gồm cả điểm danh.
    // Muốn thêm trạng thái thì mở phạm vi mới ở file này, đừng đụng hằng gốc.
    expect(ENROLLMENT_ACTIVE_STATUS_LIST).toEqual([
      "ACTIVE",
      "CONFIRMED",
      "STUDYING",
      "PAUSED",
    ]);
  });

  it("ACTIVE phải nằm trong dang-hoc — nó là giá trị MẶC ĐỊNH của schema", () => {
    // Đường convert lead không truyền status ⇒ phần lớn học viên THẬT mang ACTIVE.
    // Bỏ nó ra là bug nghỉ học 21/08 quay lại.
    expect(rosterStatuses("dang-hoc")).toContain("ACTIVE");
  });
});

describe("inRosterScope — bản lọc trong bộ nhớ khớp bản truy vấn", () => {
  it("loại hàng đã gỡ mềm ở mọi phạm vi", () => {
    for (const scope of SCOPES) {
      expect(inRosterScope({ status: "ACTIVE", deletedAt: new Date() }, scope)).toBe(false);
    }
  });

  it("thiếu trường deletedAt thì coi là CHƯA xoá, không loại im lặng", () => {
    expect(inRosterScope({ status: "ACTIVE" }, "dang-hoc")).toBe(true);
  });

  it("COMPLETED: ngoài dang-hoc, trong ket-khoa và lich-su", () => {
    const row = { status: "COMPLETED", deletedAt: null };
    expect(inRosterScope(row, "dang-hoc")).toBe(false);
    expect(inRosterScope(row, "ket-khoa")).toBe(true);
    expect(inRosterScope(row, "lich-su")).toBe(true);
  });

  it("WITHDREW: chỉ có ở lich-su", () => {
    const row = { status: "WITHDREW", deletedAt: null };
    expect(inRosterScope(row, "dang-hoc")).toBe(false);
    expect(inRosterScope(row, "ket-khoa")).toBe(false);
    expect(inRosterScope(row, "lich-su")).toBe(true);
  });

  it("PENDING không lọt vào phạm vi nào", () => {
    const row = { status: "PENDING", deletedAt: null };
    for (const scope of SCOPES) expect(inRosterScope(row, scope)).toBe(false);
  });

  it("khớp từng status một với rosterStatuses — hai đường không được lệch", () => {
    const ALL = [
      "ACTIVE",
      "CANCELLED",
      "PENDING",
      "CONFIRMED",
      "STUDYING",
      "PAUSED",
      "COMPLETED",
      "WITHDREW",
      "TRANSFERRED",
    ];
    for (const scope of SCOPES) {
      const allowed = new Set(rosterStatuses(scope) as string[]);
      for (const status of ALL) {
        expect(inRosterScope({ status, deletedAt: null }, scope)).toBe(allowed.has(status));
      }
    }
  });
});
