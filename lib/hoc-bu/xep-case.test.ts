import { describe, it, expect } from "vitest";
import { cungNhom, trangThaiPhi, duocXep, kiemNhom, caseNhanThem, type NhomBu } from "./xep-case";

const A: NhomBu = { centerId: "cs1", courseId: "sata3", lessonId: "bai2" };

describe("cungNhom / kiemNhom — cùng cơ sở + cùng khoá + cùng buổi bù", () => {
  it("[XC-01] trùng cả ba mới cùng nhóm; buổi chưa gắn bài không nhóm với ai", () => {
    expect(cungNhom(A, { ...A })).toBe(true);
    expect(cungNhom(A, { ...A, centerId: "cs2" })).toBe(false);
    expect(cungNhom(A, { ...A, courseId: "sata4" })).toBe(false);
    expect(cungNhom(A, { ...A, lessonId: "bai5" })).toBe(false);
    expect(cungNhom({ ...A, lessonId: null }, { ...A, lessonId: null })).toBe(false);
  });

  it("[XC-02] nhóm lệch ⇒ từ chối, câu lý do nói ĐÚNG vế lệch + tên bé", () => {
    const be = (hocVien: string, p: Partial<NhomBu> = {}) => ({ ...A, ...p, hocVien });
    expect(kiemNhom([be("An"), be("Bình")])).toEqual({ ok: true, nhom: A });
    const r1 = kiemNhom([be("An"), be("Bình", { centerId: "cs2" })]);
    expect(r1.ok === false && r1.lyDo).toContain("Bình khác cơ sở");
    const r2 = kiemNhom([be("An"), be("Chi", { courseId: "x" })]);
    expect(r2.ok === false && r2.lyDo).toContain("khác khoá");
    const r3 = kiemNhom([be("An"), be("Dũng", { lessonId: "bai9" })]);
    expect(r3.ok === false && r3.lyDo).toContain("vắng buổi khác");
    expect(kiemNhom([]).ok).toBe(false);
    expect(kiemNhom([be("An", { lessonId: null })]).ok).toBe(false);
  });
});

describe("trangThaiPhi / duocXep — hết lượt phải thu tiền trước", () => {
  it("[XC-03] còn lượt ⇒ xếp bằng lượt", () => {
    const p = trangThaiPhi({ conLuot: 2, freeApproved: false, phi: null });
    expect(p.loai).toBe("LUOT");
    expect(duocXep(p)).toEqual({ ok: true, dungLuot: true });
  });

  it("[XC-04] hết lượt, chưa tạo phí / phí chưa thu đủ ⇒ CHẶN", () => {
    expect(duocXep(trangThaiPhi({ conLuot: 0, freeApproved: false, phi: null })).ok).toBe(false);
    const cho = trangThaiPhi({ conLuot: 0, freeApproved: false, phi: { orderId: "o1", daThuDu: false } });
    expect(cho).toEqual({ loai: "CHO_THU", orderId: "o1" });
    expect(duocXep(cho).ok).toBe(false);
  });

  it("[XC-05] hết lượt nhưng đã thu đủ / miễn phí ngoại lệ ⇒ xếp được, KHÔNG tiêu lượt", () => {
    expect(duocXep(trangThaiPhi({ conLuot: 0, freeApproved: false, phi: { orderId: "o", daThuDu: true } }))).toEqual({
      ok: true,
      dungLuot: false,
    });
    expect(duocXep(trangThaiPhi({ conLuot: 0, freeApproved: true, phi: null }))).toEqual({ ok: true, dungLuot: false });
  });

  it("[XC-06] phí đã thu thắng lượt còn lại (bé vắng buổi bù có phí ⇒ lần sau không tiêu lượt)", () => {
    expect(trangThaiPhi({ conLuot: 3, freeApproved: false, phi: { orderId: "o", daThuDu: true } }).loai).toBe("DA_THU");
  });
});

describe("caseNhanThem", () => {
  it("[XC-07] case đã điểm danh/huỷ hoặc khác nhóm ⇒ không nhận", () => {
    expect(caseNhanThem({ ...A, status: "SCHEDULED" }, A)).toEqual({ ok: true });
    expect(caseNhanThem({ ...A, status: "COMPLETED" }, A).ok).toBe(false);
    expect(caseNhanThem({ ...A, status: "SCHEDULED" }, { ...A, lessonId: "bai3" }).ok).toBe(false);
  });
});

import { laDonPhiHocBu } from "./don-phi";
describe("laDonPhiHocBu", () => {
  it("[XC-08] chỉ đơn TOÀN dòng phí bù mới là đơn phí bù", () => {
    expect(laDonPhiHocBu([{ type: "MAKEUP_FEE" }])).toBe(true);
    expect(laDonPhiHocBu([{ type: "MAKEUP_FEE" }, { type: "COURSE_ENROLLMENT" }])).toBe(false);
    expect(laDonPhiHocBu([])).toBe(false);
  });
});
