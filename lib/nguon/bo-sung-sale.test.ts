// @vitest-environment node
/**
 * [BSS-*] — NÚT «BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH» (khối Nguồn của lead): MỘT hàm thuần quyết định nút có vẽ không, và nếu không thì nói gì.
 *
 * Luật 12 (CLAUDE.md): nút chỉ vẽ khi máy chủ SẼ nhận. «Máy chủ sẽ nhận» = lead đúng hình dạng (PH giới thiệu, chưa có Sale, có phụ huynh/bé) ∧ đủ quyền
 * (`quyenDoiNguon` — CÙNG hàm cổng `boSungSalePhuHuynh` → `doiNguonLead` → `quyetDinhDoiNguon` gọi) ∧ nguồn của lead còn chọn được (cổng 3 của `quyetDinhDoiNguon`).
 * Bộ này canh phép ghép ba vế; ma trận vai thật nằm ở `tests/hoa-hong/nguon-bo-sung-sale.spec.ts` (Postgres).
 *
 * Đã CẤY (luật 14) — xem commit.
 */
import { describe, expect, it } from "vitest";
import { quyenDoiNguon } from "./doi-nguon";
import { quyetDinhNutBoSungSale, type DauVaoNutBoSungSale } from "./bo-sung-sale";

const NOW = new Date("2026-10-09T03:00:00.000Z");
const quyen = (o: Partial<{ overwrite: boolean; overrideSauThanhToan: boolean; quanLyNguon: boolean }>, daThu = false, khoa = false) =>
  quyenDoiNguon({ daCoThucThu: daThu, nguonDangKhoa: khoa, quyen: { overwrite: false, overrideSauThanhToan: false, quanLyNguon: false, ...o } });

const NGUON_TOT: DauVaoNutBoSungSale["nguon"] = { code: "PARENT_REFERRAL", name: "Nguồn từ phụ huynh giới thiệu", status: "ACTIVE", selectable: true, effectiveFrom: null, effectiveTo: null };
const base = (over: Partial<DauVaoNutBoSungSale> = {}): DauVaoNutBoSungSale => ({
  referrerKind: "PARENT",
  coPhuHuynhHoacBe: true,
  referrerSaleUserId: null,
  nguon: NGUON_TOT,
  quyen: quyen({ overwrite: true }),
  coQuyenQuanLyNguon: false,
  now: NOW,
  ...over,
});

describe("[BSS] quyết định nút «Bổ sung Sale phụ trách phụ huynh»", () => {
  it("[BSS-01] lead PH giới thiệu, thiếu Sale, đủ quyền, nguồn chọn được ⇒ DUOC (đối chứng dương cho mọi ca dưới)", () => {
    expect(quyetDinhNutBoSungSale(base())).toEqual({ kieu: "DUOC" });
  });

  it("[BSS-02] lead KHÔNG thiếu Sale ⇒ KHONG_CAN: không phải PH giới thiệu · đã có Sale · không có phụ huynh/bé để đối chiếu (service từ chối cả ba)", () => {
    for (const kind of ["EMPLOYEE", "AFFILIATE", null] as const) expect(quyetDinhNutBoSungSale(base({ referrerKind: kind }))).toEqual({ kieu: "KHONG_CAN" });
    expect(quyetDinhNutBoSungSale(base({ referrerSaleUserId: "u-sale" }))).toEqual({ kieu: "KHONG_CAN" });
    expect(quyetDinhNutBoSungSale(base({ coPhuHuynhHoacBe: false }))).toEqual({ kieu: "KHONG_CAN" });
  });

  it("[BSS-03] thiếu quyền ⇒ THIEU_QUYEN kèm TÊN khoá thật; chưa thu: cần leads:overwrite", () => {
    const k = quyetDinhNutBoSungSale(base({ quyen: quyen({}) }));
    expect(k).toMatchObject({ kieu: "THIEU_QUYEN", thieu: ["leads:overwrite"] });
  });

  it("[BSS-04] ĐÃ CÓ THU: leads:overwrite KHÔNG đủ (đòi sources:override-after-payment); có khoá riêng thì DUOC — đúng ma trận của `quyenDoiNguon`", () => {
    expect(quyetDinhNutBoSungSale(base({ quyen: quyen({ overwrite: true }, true) }))).toMatchObject({ kieu: "THIEU_QUYEN", thieu: ["sources:override-after-payment"] });
    expect(quyetDinhNutBoSungSale(base({ quyen: quyen({ overrideSauThanhToan: true }, true) }))).toEqual({ kieu: "DUOC" });
  });

  it("[BSS-05] nguồn đang KHOÁ mà thiếu sources:manage ⇒ THIEU_QUYEN (khoá nằm trong `quyenDoiNguon`, nút không viết lại)", () => {
    expect(quyetDinhNutBoSungSale(base({ quyen: quyen({ overwrite: true }, false, true) }))).toMatchObject({ kieu: "THIEU_QUYEN", thieu: ["sources:manage"] });
    expect(quyetDinhNutBoSungSale(base({ quyen: quyen({ overwrite: true, quanLyNguon: true }, false, true) }))).toEqual({ kieu: "DUOC" });
  });

  it("[BSS-06] nguồn của lead KHÔNG chọn được (ngừng · nháp · lưu trữ · tắt chọn · ngoài hiệu lực) ⇒ NGUON_NGUNG: nút KHÔNG vẽ (service sẽ từ chối «Nguồn mới không còn dùng được»)", () => {
    const ngung = (o: Partial<DauVaoNutBoSungSale["nguon"]>) => quyetDinhNutBoSungSale(base({ nguon: { ...NGUON_TOT, ...o } }));
    for (const status of ["INACTIVE", "DRAFT", "ARCHIVED"]) expect(ngung({ status }), status).toMatchObject({ kieu: "NGUON_NGUNG", maNguon: "PARENT_REFERRAL" });
    expect(ngung({ selectable: false })).toMatchObject({ kieu: "NGUON_NGUNG" });
    expect(ngung({ effectiveTo: new Date("2026-10-09T03:00:00.000Z") }), "biên kết thúc MỞ").toMatchObject({ kieu: "NGUON_NGUNG" });
    expect(ngung({ effectiveFrom: new Date("2026-10-10T00:00:00.000Z") })).toMatchObject({ kieu: "NGUON_NGUNG" });
    // đối chứng dương: trong khoảng ⇒ DUOC
    expect(ngung({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: new Date("2026-12-01T00:00:00.000Z") })).toEqual({ kieu: "DUOC" });
  });

  it("[BSS-07] NGUON_NGUNG nói đúng ai mở lại được: chỉ người có sources:manage; ARCHIVED phải qua «ngừng» trước (chuyển trạng thái chỉ đi ARCHIVED→INACTIVE→ACTIVE)", () => {
    const co = quyetDinhNutBoSungSale(base({ nguon: { ...NGUON_TOT, status: "INACTIVE" }, coQuyenQuanLyNguon: true }));
    expect(co).toMatchObject({ kieu: "NGUON_NGUNG", coTheMoLai: true, lyDo: "TRANG_THAI" });
    const khong = quyetDinhNutBoSungSale(base({ nguon: { ...NGUON_TOT, status: "INACTIVE" }, coQuyenQuanLyNguon: false }));
    expect(khong).toMatchObject({ kieu: "NGUON_NGUNG", coTheMoLai: false });
    expect(quyetDinhNutBoSungSale(base({ nguon: { ...NGUON_TOT, status: "ARCHIVED" }, coQuyenQuanLyNguon: true }))).toMatchObject({ lyDo: "LUU_TRU" });
    expect(quyetDinhNutBoSungSale(base({ nguon: { ...NGUON_TOT, effectiveTo: new Date("2026-01-01T00:00:00.000Z") }, coQuyenQuanLyNguon: true }))).toMatchObject({ lyDo: "NGOAI_HIEU_LUC" });
  });

  it("[BSS-08] thứ tự: thiếu quyền thắng nguồn ngừng (người không làm được gì thì chỉ cần biết khoá còn thiếu); lead không thiếu Sale thắng tất cả", () => {
    expect(quyetDinhNutBoSungSale(base({ quyen: quyen({}), nguon: { ...NGUON_TOT, status: "INACTIVE" } }))).toMatchObject({ kieu: "THIEU_QUYEN" });
    expect(quyetDinhNutBoSungSale(base({ referrerSaleUserId: "u", quyen: quyen({}), nguon: { ...NGUON_TOT, status: "INACTIVE" } }))).toEqual({ kieu: "KHONG_CAN" });
  });
});
