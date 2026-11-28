import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  dieuKienBuoiTinhCong,
  giaoVienDuocQuyCong,
  isSessionOwnedByTeacher,
} from "./session-ownership";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

describe("isSessionOwnedByTeacher — câu hỏi QUYỀN", () => {
  const gv = { userId: "u1", assignedClassIds: new Set(["c1"]) };

  it("lớp được phân ⇒ sở hữu mọi buổi của lớp", () => {
    expect(
      isSessionOwnedByTeacher(
        { classId: "c1", substituteTeacherId: null, actualTeacherId: null },
        gv,
      ),
    ).toBe(true);
  });

  it("dạy thay / thực dạy buổi của lớp KHÁC ⇒ vẫn sở hữu buổi đó", () => {
    expect(
      isSessionOwnedByTeacher(
        { classId: "cX", substituteTeacherId: "u1", actualTeacherId: null },
        gv,
      ),
    ).toBe(true);
    expect(
      isSessionOwnedByTeacher(
        { classId: "cX", substituteTeacherId: null, actualTeacherId: "u1" },
        gv,
      ),
    ).toBe(true);
  });

  it("không dính gì ⇒ không sở hữu", () => {
    expect(
      isSessionOwnedByTeacher(
        { classId: "cX", substituteTeacherId: "u9", actualTeacherId: "u9" },
        gv,
      ),
    ).toBe(false);
  });
});

// ── QUYỀN ≠ CÔNG ────────────────────────────────────────────────────────────
//
// Prod 08/09/2026: dùng `assignedClassIds` làm thước đo công quy cho một TRỢ GIẢNG
// **76 buổi** người ấy không đứng lớp. Hai hàm dưới đây là câu trả lời cho câu CÔNG.
describe("giaoVienDuocQuyCong — ai được tính buổi này", () => {
  const lop = { teacherId: "gv-lop" };

  it("thực dạy THẮNG mọi thứ — đó là sự thật sau cùng", () => {
    expect(
      giaoVienDuocQuyCong({
        actualTeacherId: "thuc",
        substituteTeacherId: "thay",
        class: lop,
      }),
    ).toBe("thuc");
  });

  // ⚠️ CA SINH RA BẢN VÁ. Ba chỗ đếm cũ viết `actualTeacherId ?? class.teacherId`, nên
  // buổi có dạy thay mà chưa ai bấm hoàn tất bị quy công cho GIÁO VIÊN LỚP.
  it("chưa có thực dạy ⇒ DẠY THAY, KHÔNG phải giáo viên lớp", () => {
    expect(
      giaoVienDuocQuyCong({
        actualTeacherId: null,
        substituteTeacherId: "thay",
        class: lop,
      }),
    ).toBe("thay");
  });

  it("không đổi gì ⇒ giáo viên phụ trách lớp", () => {
    expect(
      giaoVienDuocQuyCong({
        actualTeacherId: null,
        substituteTeacherId: null,
        class: lop,
      }),
    ).toBe("gv-lop");
  });

  it("không xác định được ⇒ null, KHÔNG bịa", () => {
    // `null` để người gọi tự quyết bỏ qua hay rơi về nguồn khác. Trả một chuỗi rỗng hay
    // một id mặc định ở đây là quy công cho một người không có thật.
    expect(
      giaoVienDuocQuyCong({
        actualTeacherId: null,
        substituteTeacherId: null,
        class: null,
      }),
    ).toBeNull();
    expect(
      giaoVienDuocQuyCong({ actualTeacherId: null, substituteTeacherId: null }),
    ).toBeNull();
  });
});

describe("dieuKienBuoiTinhCong — bảng công cá nhân", () => {
  it("có đủ BA nhánh: lớp phụ trách · thực dạy · DẠY THAY", () => {
    const w = dieuKienBuoiTinhCong("u1", ["c1", "c2"]);
    expect(w.OR).toEqual([
      { classId: { in: ["c1", "c2"] } },
      { actualTeacherId: "u1" },
      { substituteTeacherId: "u1" },
    ]);
  });

  it("không có lớp nào ⇒ BỎ HẲN nhánh classId, không gửi `in: []`", () => {
    // `in: []` khớp 0 dòng nên vô hại về kết quả, nhưng nó là một mệnh đề rác trong mọi
    // truy vấn của người chưa được phân lớp — và repo đã có tiền lệ tránh nó.
    const w = dieuKienBuoiTinhCong("u1", []);
    expect(w.OR).toEqual([
      { actualTeacherId: "u1" },
      { substituteTeacherId: "u1" },
    ]);
  });

  it("KHÔNG chứa assignedClassIds — quyền xem không phải công đứng lớp", () => {
    // Anti-vacuity theo chiều ngược: hàm này phải KHÁC `isSessionOwnedByTeacher`.
    const src = doc("lib/lms/session-ownership.ts");
    const i = src.indexOf("export function dieuKienBuoiTinhCong");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i)).not.toContain("assignedClassIds");
  });
});

// ── Ba chỗ đếm phải ĐI QUA luật chung ───────────────────────────────────────
//
// Chép lại chuỗi `?? class.teacherId` ở chỗ thứ tư là tái tạo đúng bug này. Ca dưới
// canh cả ba chỗ vẫn gọi hàm chung, VÀ vẫn `select` cột mà hàm cần.
describe("ba chỗ đếm buổi dạy dùng luật chung", () => {
  const CHO = [
    "app/(admin)/admin/bao-cao/hieu-suat-gv/page.tsx",
    "app/(admin)/admin/dashboard/_components/manager-dashboard.tsx",
  ];

  it("hai chỗ quy công gọi `giaoVienDuocQuyCong`", () => {
    for (const f of CHO) expect(doc(f), f).toContain("giaoVienDuocQuyCong(");
  });

  it("… và KHÔNG còn chuỗi cũ `actualTeacherId ?? …class.teacherId`", () => {
    for (const f of CHO) {
      const src = doc(f);
      expect(src, f).not.toContain("s.actualTeacherId ?? s.class?.teacherId");
      expect(src, f).not.toContain(
        "s.actualTeacherId ?? classToTeacher.get(s.classId)",
      );
    }
  });

  it("… và có `select` cột `substituteTeacherId` — thiếu là bug quay lại im lặng", () => {
    for (const f of CHO)
      expect(doc(f), f).toContain("substituteTeacherId: true");
  });

  it("bảng công giáo viên dùng `dieuKienBuoiTinhCong`", () => {
    const src = doc("app/(teacher)/teacher/bang-cong/page.tsx");
    expect(src).toContain("dieuKienBuoiTinhCong(");
    expect(src).not.toContain("{ actualTeacherId: session.user.id },");
  });
});
