import { describe, expect, it } from "vitest";
import {
  apButToan,
  butToanCap,
  butToanDieuChinh,
  butToanGiu,
  butToanKhoiTao,
  butToanNha,
  butToanTieu,
  conLai,
  gioiHanDieuChinhGiam,
  khoaCap,
  khoaDieuChinh,
  khoaGiu,
  khoaNha,
  khoaTieu,
  soVuotKhiKhoiTao,
  tongTuSo,
  type SoLuot,
} from "./so-luot-thuan";

const so = (granted: number, held = 0, consumed = 0): SoLuot => ({ granted, held, consumed });
const GIU = { caseStudentId: "cs1", makeupNeedId: "n1" };

describe("[SL] sổ lượt học bù — toán thuần (T06)", () => {
  it("[SL-01] còn = granted − held − consumed", () => {
    expect(conLai(so(5, 2, 1))).toBe(2);
    expect(conLai(so(0))).toBe(0);
  });

  it("[SL-02] vòng đời đủ: cấp 2 → giữ → tiêu; còn 1; held về 0, consumed 1", () => {
    let t = so(0);
    for (const b of [butToanCap(2, { reason: "x" }), butToanGiu(GIU), butToanTieu({ makeupNeedId: "n1", caseStudentId: "cs1", daGiu: true })]) {
      const r = apButToan(t, b);
      expect(r.ok).toBe(true);
      if (r.ok) t = r.sau;
    }
    expect(t).toEqual(so(2, 0, 1));
    expect(conLai(t)).toBe(1);
  });

  it("[SL-03] HB-20: giữ khi đã hết lượt ⇒ VUOT — KHÔNG che bằng Math.max(0, …)", () => {
    const r = apButToan(so(1, 1, 0), butToanGiu({ caseStudentId: "cs2", makeupNeedId: "n2" }));
    expect(r).toMatchObject({ ok: false, ma: "VUOT" });
  });

  it("[SL-04] nhả khi không có gì đang giữ ⇒ AM (sổ hỏng, không âm thầm đưa held xuống −1)", () => {
    const r = apButToan(so(2, 0, 0), butToanNha({ ...GIU, reason: "gỡ" }));
    expect(r).toMatchObject({ ok: false, ma: "AM" });
  });

  it("[SL-05] tiêu có `daGiu` đổi held→consumed; không `daGiu` (dòng cũ nhập vào sổ) chỉ cộng consumed", () => {
    expect(apButToan(so(2, 1, 0), butToanTieu({ makeupNeedId: "n1", caseStudentId: null, daGiu: true }))).toEqual({ ok: true, sau: so(2, 0, 1) });
    expect(apButToan(so(2, 0, 0), butToanTieu({ makeupNeedId: "n1", caseStudentId: null, daGiu: false }))).toEqual({ ok: true, sau: so(2, 0, 1) });
  });

  it("[SL-06] tiêu vượt số còn ⇒ VUOT (dòng cũ không có HOLD cũng không tiêu được lượt không tồn tại)", () => {
    expect(apButToan(so(1, 0, 1), butToanTieu({ makeupNeedId: "n1", caseStudentId: null, daGiu: false }))).toMatchObject({ ok: false, ma: "VUOT" });
  });

  it("[SL-07] điều chỉnh GIẢM bị chặn ở số còn — lượt đã giữ/đã tiêu là sự thật, không rút lại bằng đơn huỷ", () => {
    expect(gioiHanDieuChinhGiam(so(3, 1, 1), -5)).toEqual({ ap: -1, giuLai: 4 });
    expect(gioiHanDieuChinhGiam(so(3, 0, 0), -2)).toEqual({ ap: -2, giuLai: 0 });
    expect(gioiHanDieuChinhGiam(so(1, 1, 0), -1)).toEqual({ ap: 0, giuLai: 1 });
    expect(gioiHanDieuChinhGiam(so(3, 0, 0), 2)).toEqual({ ap: 2, giuLai: 0 });
  });

  it("[SL-08] ADJUSTMENT phải có lý do và khác 0; GRANT phải dương", () => {
    expect(() => butToanDieuChinh({ delta: 0, nguon: "a", reason: "x" })).toThrow();
    expect(() => butToanDieuChinh({ delta: 1, nguon: "a", reason: "   " })).toThrow();
    expect(() => butToanCap(0, { reason: null })).toThrow();
    expect(() => butToanCap(1.5, { reason: null })).toThrow();
  });

  it("[SL-09] khoá chống lặp: mỗi loại một dạng, HOLD/RELEASE theo mục case, CONSUME theo dòng", () => {
    expect(khoaGiu("a")).not.toBe(khoaNha("a"));
    expect(khoaGiu("a")).not.toBe(khoaGiu("b"));
    expect(khoaTieu("n")).toBe("CONSUME:n");
    expect(khoaCap()).toBe("GRANT:khoi-tao");
    expect(khoaDieuChinh("don-1")).toBe("ADJUSTMENT:don-1");
  });

  it("[SL-10] khởi tạo thường: cấp theo công thức + phát lại đang giữ + đã tiêu; số khớp từng bút toán", () => {
    const buts = butToanKhoiTao({
      tongCongThuc: 3,
      dangGiu: [{ caseStudentId: "cs1", makeupNeedId: "n1" }],
      daTieu: [{ makeupNeedId: "n2", caseStudentId: null }],
    });
    expect(buts.map((b) => b.type)).toEqual(["GRANT", "HOLD", "CONSUME"]);
    expect(tongTuSo(buts)).toEqual(so(3, 1, 1));
    expect(conLai(tongTuSo(buts))).toBe(1);
  });

  it("[SL-11] khởi tạo khi dữ liệu cũ ĐÃ vượt công thức (HB-20): thêm ADJUSTMENT dương CÓ LÝ DO; sổ không âm, con số vượt hiện ra", () => {
    const d = { tongCongThuc: 1, dangGiu: [], daTieu: [{ makeupNeedId: "a", caseStudentId: null }, { makeupNeedId: "b", caseStudentId: null }, { makeupNeedId: "c", caseStudentId: null }] };
    const buts = butToanKhoiTao(d);
    const adj = buts.filter((b) => b.type === "ADJUSTMENT");
    expect(adj).toHaveLength(1);
    expect(adj[0]!.grantedDelta).toBe(2);
    expect(adj[0]!.reason).toMatch(/vượt/);
    expect(conLai(tongTuSo(buts))).toBe(0);
    expect(soVuotKhiKhoiTao(d)).toBe(2);
    // Mọi bước trung gian cũng không âm (DB có CHECK sau mỗi câu lệnh).
    let t = so(0);
    for (const b of buts) {
      const r = apButToan(t, b);
      expect(r.ok).toBe(true);
      if (r.ok) t = r.sau;
    }
  });

  it("[SL-12] công thức cấp 0 (khoá không cho bù / HB-18 đơn huỷ): không sinh bút toán GRANT rỗng", () => {
    expect(butToanKhoiTao({ tongCongThuc: 0, dangGiu: [], daTieu: [] })).toEqual([]);
  });
});
