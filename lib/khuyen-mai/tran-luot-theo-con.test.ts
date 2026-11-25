// [TLC] Trần lượt dùng mã THEO CON — luật thuần. Phần chạm DB: tests/finance/don-pham-vi-db.test.ts `[GT-DB-11b]`.
import { describe, expect, it } from "vitest";
import {
  danhTinhConCuaDong,
  demLuotDaDung,
  leadChildTuMetadata,
  tapDanhTinhCon,
  type DanhTinhCon,
} from "./tran-luot-theo-con";

const A: DanhTinhCon = { studentId: null, leadChildId: "lcA" };
const B: DanhTinhCon = { studentId: null, leadChildId: "lcB" };
const tap = (c: DanhTinhCon, gd: { studentId: string | null; leadChildId: string | null }[] = []) => tapDanhTinhCon(c, gd);

describe("[TLC-01] danh tính con của một dòng", () => {
  it("không khai gì ⇒ null; chuỗi rỗng/khoảng trắng cũng là không khai", () => {
    expect(danhTinhConCuaDong({})).toBeNull();
    expect(danhTinhConCuaDong({ studentId: "  ", leadChildId: "" })).toBeNull();
  });
  it("dòng khai bé thắng cấp đơn; cấp đơn chỉ làm nền khi dòng không khai", () => {
    expect(danhTinhConCuaDong({ leadChildId: "lcA", leadChildCuaDon: "lcZ" })).toEqual({ studentId: null, leadChildId: "lcA" });
    expect(danhTinhConCuaDong({ leadChildCuaDon: "lcZ" })).toEqual({ studentId: null, leadChildId: "lcZ" });
  });
  it("đọc leadChildId từ metadata Json bất kỳ mà không ném", () => {
    expect(leadChildTuMetadata({ leadChildId: " lcA " })).toBe("lcA");
    for (const x of [null, undefined, 5, "x", [], { leadChildId: 7 }]) expect(leadChildTuMetadata(x)).toBeNull();
  });
});

describe("[TLC-02] đếm lượt", () => {
  it("CA GỐC: lượt cũ của bé A không tính cho bé B (cùng SĐT)", () => {
    expect(demLuotDaDung([A], tap(B), []).tong).toBe(0);
  });
  it("cùng bé dùng lần hai ⇒ tính", () => {
    expect(demLuotDaDung([A], tap(A), []).tong).toBe(1);
  });
  it("lượt cũ KHÔNG ghi rõ bé: không loại trừ được ⇒ tính cho bé có tên (khỏi lách trần bằng ô trống)", () => {
    const r = demLuotDaDung([null], tap(B), []);
    expect(r).toMatchObject({ tong: 1, khongRoCon: 1, theoCon: true });
  });
  it("dòng mới KHÔNG nhận ra bé ⇒ luật cũ: đếm MỌI lượt của SĐT, cả của bé A lẫn bé B", () => {
    expect(demLuotDaDung([A, B, null], null, [A])).toEqual({ tong: 3, khongRoCon: 0, trongDonNay: 0, theoCon: false });
  });
  it("cùng ĐƠN: dòng trước cùng bé tính; khác bé hoặc không nhận ra bé thì không", () => {
    expect(demLuotDaDung([], tap(A), [A]).trongDonNay).toBe(1);
    expect(demLuotDaDung([], tap(A), [B, null]).tong).toBe(0);
  });
});

describe("[TLC-03] một bé hiện bằng hai khoá (LeadChild ↔ Student qua ghi danh)", () => {
  const hv: DanhTinhCon = { studentId: "S1", leadChildId: null };
  it("đơn đầu mang leadChildId, đơn gia hạn mang studentId ⇒ cùng một bé khi có cầu nối", () => {
    const cau = [{ studentId: "S1", leadChildId: "lcA" }];
    expect(demLuotDaDung([A], tap(hv, cau), []).tong).toBe(1);
    expect(demLuotDaDung([hv], tap(A, cau), []).tong).toBe(1);
  });
  it("THIẾU cầu nối ⇒ hai bé xa lạ (đây là chỗ gia hạn lọt trần nếu quên truy vấn ghi danh)", () => {
    expect(demLuotDaDung([A], tap(hv), []).tong).toBe(0);
  });
  it("cầu nối chỉ kéo ghi danh KHỚP khoá của bé — ghi danh lạ không kéo họ hàng vào", () => {
    const t = tap(hv, [{ studentId: "S9", leadChildId: "lcZ" }]);
    expect([...t.leadChildIds]).toEqual([]);
    expect([...t.studentIds]).toEqual(["S1"]);
  });
});
