// Ca [CSPB-*] — chính sách hoá đơn CÓ PHIÊN BẢN (lát S7, Invoice Hub): nội dung (zod), máy trạng thái, chồng/hở hiệu lực, ánh xạ sang engine,
// vị từ quyền. THUẦN — không DB; xanh khi DB trỏ cổng chết. Mỗi ca xanh khi chạy MỘT MÌNH (không phụ thuộc thứ tự).
// Luật 14: các lưới trọng yếu ([CSPB-06] cap SHADOW, [CSPB-09] lý do (luật maker≠checker ĐÃ BỎ 02/11/2026),[CSPB-10] hash, [CSPB-11] biên ngày) đã được CẤY LẠI lỗi và thấy ĐỎ
// — xem báo cáo lát S7.
import { readFileSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANG_CHUYEN,
  CAC_TRANG_THAI,
  QR_TTL_GIO_MAC_DINH,
  QR_TTL_GIO_TOI_DA,
  QR_TTL_GIO_TOI_THIEU,
  kiemChongHoPhienBan,
  kiemChuyen,
  kiemKhoangHieuLuc,
  kiemNgayKetThuc,
  kiemBoSauKhiThem,
  phanTichNoiDung,
  qrTtlGioHieuLuc,
  sangQuyTac,
  type NoiDungChinhSach,
  type TrangThaiChinhSach,
} from "./chinh-sach-phien-ban";
import { resolve } from "./engine/chinh-sach";
import { TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";
import { duocDuyetChinhSach, duocGhiChinhSach, hanhDongChinhSachChoPhep } from "./quyen";

const dong = (loaiKhoan: string, phanTram = 8) => ({
  loaiKhoan,
  mucThue: { kieu: "SUAT" as const, phanTram },
  kieuGia: "DA_GOM_THUE" as const,
  donViTinh: "Lần",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI" as const,
  mauMoTaSoBuoi: "({n} buổi)",
});
const canCu = (o: Record<string, unknown> = {}) => ({ vanBan: "Văn bản thử nghiệm", doTinCay: "TRUNG", canKeToanXacNhan: false, ...o });
const thoNoiDung = (o: Record<string, unknown> = {}) => ({
  anhXaThue: [dong("COURSE"), dong("EXAM", 10)],
  thoiDiemLap: "DO_KE_TOAN_CHOT",
  cheDoToiDa: "SHADOW",
  nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG" },
  lamTron: "HALF_UP",
  legalBasisRef: [canCu()],
  ...o,
});
const hopLe = (o: Record<string, unknown> = {}): NoiDungChinhSach => {
  const r = phanTichNoiDung(thoNoiDung(o));
  if (!r.ok) throw new Error(r.loi.join(" | "));
  return r.noiDung;
};
const loi = (raw: unknown) => {
  const r = phanTichNoiDung(raw);
  return r.ok ? [] : r.loi;
};

/** Chữ đọc được không có chú thích — để quét mã nguồn không bị câu giải thích lừa. */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[CSPB-01] nội dung hợp lệ được chuẩn hoá", () => {
  it("parse được; anhXaThue sắp theo loại khoản; trường tuỳ chọn thiếu ⇒ null (một hình dạng duy nhất)", () => {
    const nd = hopLe({ anhXaThue: [dong("PRODUCT"), dong("COURSE")] });
    expect(nd.anhXaThue.map((d) => d.loaiKhoan)).toEqual(["COURSE", "PRODUCT"]);
    expect(nd.nguoiMua.qrTtlGio).toBeNull();
    expect(nd.legalBasisRef[0]).toMatchObject({ dieu: null, khoan: null, daKyDuyetBoi: null, daKyDuyetLuc: null });
  });
  it("khoá lạ bị bỏ (không lưu rác); chuỗi được cắt khoảng trắng", () => {
    const nd = hopLe({ rac: 1, anhXaThue: [{ ...dong("  COURSE "), thua: 1 }] });
    expect(nd).not.toHaveProperty("rac");
    expect(nd.anhXaThue[0]).not.toHaveProperty("thua");
    expect(nd.anhXaThue[0]!.loaiKhoan).toBe("COURSE");
  });
});

describe("[CSPB-02] KHÔNG có mặc định pháp lý — thiếu là nội dung sai (fail-closed)", () => {
  it.each(["thoiDiemLap", "cheDoToiDa", "lamTron", "nguoiMua", "anhXaThue", "legalBasisRef"])("thiếu %s ⇒ từ chối", (khoa) => {
    const raw = thoNoiDung() as Record<string, unknown>;
    delete raw[khoa];
    expect(loi(raw).length, khoa).toBeGreaterThan(0);
  });
  it("anhXaThue rỗng ⇒ từ chối; buyerInfoLevel thiếu ⇒ từ chối; giá trị lạ của thoiDiemLap/lamTron ⇒ từ chối", () => {
    expect(loi(thoNoiDung({ anhXaThue: [] }))).not.toEqual([]);
    expect(loi(thoNoiDung({ nguoiMua: {} }))).not.toEqual([]);
    expect(loi(thoNoiDung({ thoiDiemLap: "LUC_NAO_CUNG_DUOC" }))).not.toEqual([]);
    expect(loi(thoNoiDung({ lamTron: "HALF_DOWN" }))).not.toEqual([]);
  });
  it("dòng thiếu đơn vị tính ⇒ từ chối, không tự điền 'Lần'", () => {
    const d = { ...dong("COURSE"), donViTinh: "" };
    expect(loi(thoNoiDung({ anhXaThue: [d] })).join("|")).toMatch(/Đơn vị tính/);
  });
  it("đối chứng dương: đủ trường ⇒ hợp lệ", () => {
    expect(loi(thoNoiDung())).toEqual([]);
  });
});

describe("[CSPB-03] mức thuế: chỉ kiểm HÌNH DẠNG (số nguyên 0–100), không kiểm 'mức đúng luật'", () => {
  it.each([0, 5, 8, 10, 100])("SUAT %i ⇒ hợp lệ (mã không biết mức nào 'đúng')", (p) => {
    expect(loi(thoNoiDung({ anhXaThue: [dong("COURSE", p)] }))).toEqual([]);
  });
  it.each([-1, 101, 8.5, Number.NaN])("SUAT %s ⇒ từ chối", (p) => {
    expect(loi(thoNoiDung({ anhXaThue: [dong("COURSE", p)] })).join("|")).toMatch(/Thuế suất/);
  });
  it("KCT và KKKNT hợp lệ; SUAT thiếu phanTram ⇒ từ chối; kiểu lạ ⇒ từ chối", () => {
    expect(loi(thoNoiDung({ anhXaThue: [{ ...dong("A"), mucThue: { kieu: "KCT" } }, { ...dong("B"), mucThue: { kieu: "KKKNT" } }] }))).toEqual([]);
    expect(loi(thoNoiDung({ anhXaThue: [{ ...dong("A"), mucThue: { kieu: "SUAT" } }] }))).not.toEqual([]);
    expect(loi(thoNoiDung({ anhXaThue: [{ ...dong("A"), mucThue: { kieu: "KHAC" } }] }))).not.toEqual([]);
  });
});

describe("[CSPB-04] ràng buộc trong một phiên bản", () => {
  it("trùng loại khoản trong CÙNG phiên bản ⇒ từ chối, nói rõ loại nào", () => {
    expect(loi(thoNoiDung({ anhXaThue: [dong("COURSE"), dong("COURSE", 10)] })).join("|")).toMatch(/COURSE.*hai lần/);
  });
  it("cách thể hiện MOT_KHOA_MO_TA_SO_BUOI mà mẫu không có {n} ⇒ từ chối; SO_BUOI_LA_SO_LUONG không cần {n}", () => {
    expect(loi(thoNoiDung({ anhXaThue: [{ ...dong("COURSE"), mauMoTaSoBuoi: "buổi" }] })).join("|")).toMatch(/\{n\}/);
    expect(loi(thoNoiDung({ anhXaThue: [{ ...dong("COURSE"), cachThuSoBuoi: "SO_BUOI_LA_SO_LUONG", mauMoTaSoBuoi: "" }] }))).toEqual([]);
  });
});

describe("[CSPB-05] QR người mua: TTL cấu hình được, mặc định 4 giờ chỉ khi chính sách không khai", () => {
  it("hằng mặc định = 4 (owner xác nhận 01/11/2026)", () => {
    expect(QR_TTL_GIO_MAC_DINH).toBe(4);
  });
  it.each([QR_TTL_GIO_TOI_THIEU, 4, 24, QR_TTL_GIO_TOI_DA])("qrTtlGio %i ⇒ hợp lệ và được dùng đúng giá trị khai", (g) => {
    const nd = hopLe({ nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: g } });
    expect(qrTtlGioHieuLuc(nd)).toBe(g);
  });
  it.each([0, -1, QR_TTL_GIO_TOI_DA + 1, 4.5, Number.NaN, "4"])("qrTtlGio %s ⇒ từ chối", (g) => {
    expect(loi(thoNoiDung({ nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: g } })).join("|")).toMatch(/hiệu lực QR/);
  });
  it("không khai (thiếu hoặc null) ⇒ rơi về mặc định 4", () => {
    expect(qrTtlGioHieuLuc(hopLe())).toBe(QR_TTL_GIO_MAC_DINH);
    expect(qrTtlGioHieuLuc(hopLe({ nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: null } }))).toBe(QR_TTL_GIO_MAC_DINH);
  });
});

describe("[CSPB-06] căn cứ cần kế toán xác nhận mà CHƯA ký duyệt ⇒ cheDoToiDa tối đa SHADOW", () => {
  const chuaKy = [canCu({ canKeToanXacNhan: true })];
  it.each(["DE_XUAT", "TU_DONG"])("chưa ký + %s ⇒ từ chối", (che) => {
    expect(loi(thoNoiDung({ legalBasisRef: chuaKy, cheDoToiDa: che })).join("|")).toMatch(/chưa ai ký duyệt/);
  });
  it.each(["TAT", "SHADOW"])("chưa ký + %s ⇒ được (đối chứng dương)", (che) => {
    expect(loi(thoNoiDung({ legalBasisRef: chuaKy, cheDoToiDa: che }))).toEqual([]);
  });
  it("ĐÃ ký (người + ngày) ⇒ TU_DONG được (đối chứng dương)", () => {
    const daKy = [canCu({ canKeToanXacNhan: true, daKyDuyetBoi: "Kế toán trưởng", daKyDuyetLuc: "2026-11-01" })];
    expect(loi(thoNoiDung({ legalBasisRef: daKy, cheDoToiDa: "TU_DONG" }))).toEqual([]);
  });
  it("một căn cứ đã ký, một căn cứ chưa ký ⇒ vẫn bị cap (mọi căn cứ phải có chữ ký)", () => {
    const hon = [canCu({ canKeToanXacNhan: true, daKyDuyetBoi: "KT", daKyDuyetLuc: "2026-11-01" }), canCu({ canKeToanXacNhan: true })];
    expect(loi(thoNoiDung({ legalBasisRef: hon, cheDoToiDa: "DE_XUAT" })).length).toBeGreaterThan(0);
  });
  it("không căn cứ nào cần xác nhận ⇒ TU_DONG được", () => {
    expect(loi(thoNoiDung({ legalBasisRef: [canCu()], cheDoToiDa: "TU_DONG" }))).toEqual([]);
  });
  it("ghi người ký mà thiếu ngày (và ngược lại) ⇒ từ chối", () => {
    expect(loi(thoNoiDung({ legalBasisRef: [canCu({ daKyDuyetBoi: "KT" })] })).join("|")).toMatch(/ngày ký/);
    expect(loi(thoNoiDung({ legalBasisRef: [canCu({ daKyDuyetLuc: "2026-11-01" })] })).join("|")).toMatch(/người ký/);
    expect(loi(thoNoiDung({ legalBasisRef: [canCu({ daKyDuyetBoi: "KT", daKyDuyetLuc: "2026-02-31" })] })).length).toBeGreaterThan(0);
  });
});

describe("[CSPB-07] TD-10 — không điều luật nào trong mã validate", () => {
  it("văn bản bất kỳ (kể cả tên không có thật) vẫn hợp lệ: mã không có danh mục văn bản", () => {
    expect(loi(thoNoiDung({ legalBasisRef: [canCu({ vanBan: "Văn bản số 000 chưa từng ban hành", dieu: "999" })] }))).toEqual([]);
  });
  it("tệp nguồn (đã bỏ chú thích) không nhắc số hiệu văn bản / điều luật / mức thuế cụ thể", () => {
    for (const tep of ["chinh-sach-phien-ban.ts", "chinh-sach-mo-phong.ts"]) {
      const ma = boChuThich(readFileSync(duongDan(process.cwd(), "lib/finance/hoa-don", tep), "utf8"));
      expect(ma, tep).not.toMatch(/Nghị định|Thông tư|\bNĐ[- ]?\d|\bTT[- ]?\d|Luật\s+\d|\b\d{2,3}\/\d{4}\/(?:NĐ|TT|QH)/i);
      expect(ma, tep).not.toMatch(/phanTram\s*[=:]\s*(?:5|8|10)\b/);
    }
  });
});

describe("[CSPB-08] máy trạng thái: đúng 5 cạnh hợp lệ, mọi cạnh khác bị từ chối kèm lý do", () => {
  const ctxOk = { lyDo: "Đã soát với kế toán trưởng", moPhong: { hashUi: "h", hashServer: "h" } };
  const HOP_LE: [TrangThaiChinhSach, TrangThaiChinhSach][] = [
    ["NHAP", "CHO_DUYET"],
    ["CHO_DUYET", "HIEU_LUC"],
    ["CHO_DUYET", "TU_CHOI"],
    ["HIEU_LUC", "HET_HIEU_LUC"],
  ];
  it("bảng chuyển có đúng bốn cạnh", () => {
    const cac = CAC_TRANG_THAI.flatMap((a) => BANG_CHUYEN[a].map((b) => `${a}>${b}`));
    expect(cac.sort()).toEqual(HOP_LE.map(([a, b]) => `${a}>${b}`).sort());
  });
  it.each(HOP_LE)("%s → %s hợp lệ khi đủ điều kiện (đối chứng dương)", (a, b) => {
    expect(kiemChuyen(a, b, ctxOk)).toEqual({ ok: true });
  });
  it("mọi cặp còn lại bị từ chối, có thông điệp tiếng Việt", () => {
    let dem = 0;
    for (const a of CAC_TRANG_THAI)
      for (const b of CAC_TRANG_THAI) {
        if (HOP_LE.some(([x, y]) => x === a && y === b)) continue;
        const r = kiemChuyen(a, b, ctxOk);
        expect(r.ok, `${a}>${b}`).toBe(false);
        if (!r.ok) expect(r.thongDiep.length).toBeGreaterThan(10);
        dem += 1;
      }
    expect(dem).toBe(25 - HOP_LE.length);
  });
  it("sửa phiên bản ĐANG HIỆU LỰC ⇒ lý do riêng: 'tạo phiên bản mới'", () => {
    for (const toi of ["NHAP", "CHO_DUYET", "TU_CHOI"] as const) {
      const r = kiemChuyen("HIEU_LUC", toi, ctxOk);
      expect(r).toMatchObject({ ok: false, ma: "DA_HIEU_LUC_KHONG_SUA" });
    }
  });
  it("trạng thái cuối (TU_CHOI, HET_HIEU_LUC) không đi đâu nữa", () => {
    expect(BANG_CHUYEN.TU_CHOI).toEqual([]);
    expect(BANG_CHUYEN.HET_HIEU_LUC).toEqual([]);
  });
});

describe("[CSPB-09] lý do bắt buộc; KHÔNG còn luật «người duyệt ≠ người soạn» (chủ dự án chốt 02/11/2026)", () => {
  const ctx = (o: Partial<Parameters<typeof kiemChuyen>[2]> = {}) => ({
    lyDo: "Đã soát với kế toán trưởng",
    moPhong: { hashUi: "h", hashServer: "h" },
    ...o,
  });
  it("DUYỆT / TỪ CHỐI chỉ đòi lý do + mô phỏng khớp — hàm KHÔNG nhận danh tính người thao tác nên không thể so người soạn", () => {
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx())).toEqual({ ok: true });
    expect(kiemChuyen("CHO_DUYET", "TU_CHOI", ctx({ moPhong: null }))).toEqual({ ok: true });
    // Đối chứng ÂM: hai cổng còn lại của cạnh duyệt vẫn chặn — bỏ luật người không được kéo theo bỏ nhầm các cổng khác.
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ lyDo: "ngắn" }))).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ moPhong: { hashUi: "a", hashServer: "b" } }))).toMatchObject({ ok: false, ma: "MO_PHONG_LECH" });
  });
  it("gửi duyệt / kết thúc hiệu lực đi qua cổng lý do như cũ", () => {
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx({ moPhong: null }))).toEqual({ ok: true });
    expect(kiemChuyen("HIEU_LUC", "HET_HIEU_LUC", ctx({ moPhong: null }))).toEqual({ ok: true });
  });
  it(`lý do dưới ${TOI_THIEU_LY_DO_HOA_DON} ký tự (sau khi cắt trắng) ⇒ từ chối; đúng ${TOI_THIEU_LY_DO_HOA_DON} ⇒ được; rỗng/null ⇒ từ chối`, () => {
    const chin = "a".repeat(TOI_THIEU_LY_DO_HOA_DON - 1);
    const muoi = "a".repeat(TOI_THIEU_LY_DO_HOA_DON);
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx({ lyDo: chin }))).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx({ lyDo: `   ${chin}   ` }))).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx({ lyDo: muoi }))).toEqual({ ok: true });
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx({ lyDo: null }))).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
  });
});

describe("[CSPB-10] mô phỏng bắt buộc: băm UI phải KHỚP băm server", () => {
  const ctx = (m: { hashUi: string | null; hashServer: string } | null) => ({ lyDo: "Đã xem mô phỏng", moPhong: m });
  it("thiếu / rỗng băm UI ⇒ CHUA_MO_PHONG", () => {
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx(null))).toMatchObject({ ok: false, ma: "CHUA_MO_PHONG" });
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ hashUi: null, hashServer: "a" }))).toMatchObject({ ok: false, ma: "CHUA_MO_PHONG" });
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ hashUi: "", hashServer: "a" }))).toMatchObject({ ok: false, ma: "CHUA_MO_PHONG" });
  });
  it("băm lệch ⇒ MO_PHONG_LECH; khớp ⇒ được", () => {
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ hashUi: "a", hashServer: "b" }))).toMatchObject({ ok: false, ma: "MO_PHONG_LECH" });
    expect(kiemChuyen("CHO_DUYET", "HIEU_LUC", ctx({ hashUi: "a", hashServer: "a" }))).toEqual({ ok: true });
  });
  it("điều kiện mô phỏng CHỈ áp cho cạnh duyệt: từ chối / gửi duyệt không cần băm", () => {
    expect(kiemChuyen("CHO_DUYET", "TU_CHOI", ctx(null))).toEqual({ ok: true });
    expect(kiemChuyen("NHAP", "CHO_DUYET", ctx(null))).toEqual({ ok: true });
  });
});

describe("[CSPB-11] chồng / hở hiệu lực cùng phạm vi — khoảng ĐÓNG hai đầu", () => {
  const ban = (id: string, v: number, tu: string, den: string | null) => ({ id, phienBan: v, hieuLucTu: tu, hieuLucDen: den });
  const v1 = ban("a", 1, "2026-01-01", "2026-06-30");
  it("bản đầu tiên (không có bản nào khác) ⇒ sạch", () => {
    expect(kiemChongHoPhienBan([], ban("b", 1, "2026-01-01", null))).toEqual([]);
  });
  it("liền nhau đúng một ngày (30/06 → 01/07) ⇒ sạch (đối chứng dương cho biên)", () => {
    expect(kiemChongHoPhienBan([v1], ban("b", 2, "2026-07-01", null))).toEqual([]);
  });
  it("dùng chung đúng MỘT ngày biên (30/06) ⇒ chồng", () => {
    expect(kiemChongHoPhienBan([v1], ban("b", 2, "2026-06-30", null)).join("|")).toMatch(/Chồng/);
  });
  it("hở một ngày (02/07 sau 30/06) ⇒ hở, TỪ CHỐI", () => {
    expect(kiemChongHoPhienBan([v1], ban("b", 2, "2026-07-02", null)).join("|")).toMatch(/Hở ngày/);
  });
  it("bản cũ MỞ (không hạn) mà bản mới bắt đầu sau nó ⇒ chồng (phải kết thúc bản cũ trước)", () => {
    expect(kiemChongHoPhienBan([ban("a", 1, "2026-01-01", null)], ban("b", 2, "2026-07-01", null)).join("|")).toMatch(/Chồng/);
  });
  it("chèn bản VÀO GIỮA hai bản: sạch khi kín cả hai đầu; hở đầu sau ⇒ hở", () => {
    const hai = [ban("a", 1, "2026-01-01", "2026-03-31"), ban("c", 3, "2026-07-01", null)];
    expect(kiemChongHoPhienBan(hai, ban("b", 2, "2026-04-01", "2026-06-30"))).toEqual([]);
    expect(kiemChongHoPhienBan(hai, ban("b", 2, "2026-04-01", "2026-06-29")).join("|")).toMatch(/Hở ngày giữa phiên bản này/);
  });
  it("chính nó (cùng id) không tự chồng với mình", () => {
    expect(kiemChongHoPhienBan([v1], v1)).toEqual([]);
  });
  it("khoảng nhập vào: ngược ⇒ lỗi; ngày sai ⇒ lỗi; hợp lệ ⇒ null", () => {
    expect(kiemKhoangHieuLuc("2026-02-01", "2026-01-31")).toMatch(/trước ngày bắt đầu/);
    expect(kiemKhoangHieuLuc("2026-13-01", null)).toMatch(/Ngày bắt đầu/);
    expect(kiemKhoangHieuLuc("2026-02-01", "2026-02-01")).toBeNull();
    expect(kiemKhoangHieuLuc("2026-02-01", null)).toBeNull();
  });
  it("kết thúc hiệu lực: trước ngày bắt đầu ⇒ lỗi; sau hạn đã khai ⇒ lỗi; đúng ngày bắt đầu ⇒ được; bản mở ⇒ ngày nào sau từ cũng được", () => {
    expect(kiemNgayKetThuc(v1, "2025-12-31")).toMatch(/trước ngày bắt đầu/);
    expect(kiemNgayKetThuc(v1, "2026-07-01")).toMatch(/sau ngày hết hạn/);
    expect(kiemNgayKetThuc(v1, "2026-01-01")).toBeNull();
    expect(kiemNgayKetThuc(ban("m", 1, "2026-01-01", null), "2030-01-01")).toBeNull();
  });
});

describe("[CSPB-12] nội dung → QuyTac cho engine (cùng ngữ nghĩa resolve)", () => {
  const phamVi = { phapNhanMa: "NEW_VISION", centerId: "cs1" as string | null };
  it("mỗi dòng anhXaThue ⇒ một quy tắc, mang đúng phạm vi + khoảng hiệu lực của PHIÊN BẢN + thoiDiemLap; mã ổn định qua phiên bản", () => {
    const nd = hopLe({ thoiDiemLap: "KHI_THU_TIEN" });
    const q1 = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: "2026-06-30" }, nd);
    const q2 = sangQuyTac({ ...phamVi, phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: null }, nd);
    expect(q1).toHaveLength(2);
    expect(q1[0]).toMatchObject({ phapNhanMa: "NEW_VISION", centerId: "cs1", loaiKhoan: "COURSE", hieuLucTu: "2026-01-01", hieuLucDen: "2026-06-30", dangBat: true, nguon: "CAU_HINH" });
    expect(q1[0]!.thongSo.thoiDiemLap).toBe("KHI_THU_TIEN");
    expect(q1[0]!.ma).toBe(q2[0]!.ma);
    expect(q1[0]!.phienBan).toBe(1);
    expect(q2[0]!.phienBan).toBe(2);
  });
  it("chính sách DÙNG CHUNG (centerId null) ⇒ quy tắc có centerId null (khớp mọi cơ sở)", () => {
    const q = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: null, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, hopLe());
    expect(q.every((x) => x.centerId === null)).toBe(true);
    expect(resolve(q, { phapNhanMa: "NEW_VISION", centerId: "cs9", loaiKhoan: "COURSE" }, "2026-03-01")).toMatchObject({ ok: true });
  });
  it("hai phiên bản liền nhau: ngày chuyển (01/07) ra phiên bản MỚI; 30/06 ra bản cũ; hai đầu đều resolve được", () => {
    const q = [
      ...sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: "2026-06-30" }, hopLe()),
      ...sangQuyTac({ ...phamVi, phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: null }, hopLe({ anhXaThue: [dong("COURSE", 10)] })),
    ];
    const khoa = { phapNhanMa: "NEW_VISION", centerId: "cs1", loaiKhoan: "COURSE" };
    const a = resolve(q, khoa, "2026-06-30");
    const b = resolve(q, khoa, "2026-07-01");
    expect(a.ok && a.quyTac.phienBan).toBe(1);
    expect(b.ok && b.quyTac.phienBan).toBe(2);
  });
  it("phiên bản ĐÃ KẾT THÚC vẫn resolve cho ngày TRONG khoảng, và ra KHONG_CO sau ngày kết thúc (không dùng mức cũ)", () => {
    const q = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: "2026-03-31" }, hopLe());
    const khoa = { phapNhanMa: "NEW_VISION", centerId: "cs1", loaiKhoan: "COURSE" };
    expect(resolve(q, khoa, "2026-03-31").ok).toBe(true);
    expect(resolve(q, khoa, "2026-04-01")).toMatchObject({ ok: false, ma: "KHONG_CO" });
  });
  it("hai phiên bản chồng ngày CÙNG phạm vi ⇒ engine báo CHONG_HIEU_LUC (và kiemBoSauKhiThem bắt trước)", () => {
    const a = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, hopLe());
    const b = sangQuyTac({ ...phamVi, phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: null }, hopLe());
    expect(resolve([...a, ...b], { phapNhanMa: "NEW_VISION", centerId: "cs1", loaiKhoan: "COURSE" }, "2026-08-01")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC" });
    expect(kiemBoSauKhiThem(a, b).length).toBeGreaterThan(0);
  });
  it("chính sách riêng cơ sở THẮNG chính sách dùng chung cùng loại khoản (đích danh hơn)", () => {
    const chung = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: null, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, hopLe({ anhXaThue: [dong("COURSE", 8)] }));
    const rieng = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, hopLe({ anhXaThue: [dong("COURSE", 10)] }));
    const r = resolve([...chung, ...rieng], { phapNhanMa: "NEW_VISION", centerId: "cs1", loaiKhoan: "COURSE" }, "2026-05-05");
    expect(r.ok && r.quyTac.thongSo.mucThue).toEqual({ kieu: "SUAT", phanTram: 10 });
    const khac = resolve([...chung, ...rieng], { phapNhanMa: "NEW_VISION", centerId: "cs2", loaiKhoan: "COURSE" }, "2026-05-05");
    expect(khac.ok && khac.quyTac.thongSo.mucThue).toEqual({ kieu: "SUAT", phanTram: 8 });
  });
  it("canCuPhapLy chỉ là chữ để in", () => {
    const [q] = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, hopLe({ legalBasisRef: [canCu({ vanBan: "VB thử", dieu: "5", khoan: "2" })] }));
    expect(q!.canCuPhapLy).toBe("VB thử 5 2");
  });
});

describe("[CSPB-13] vị từ quyền: một hàm cho nút, action và dịch vụ", () => {
  type A = Parameters<typeof duocGhiChinhSach>[0];
  const quyen = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL" as const, orgUnitId: "ou", roleCode: "X", centerScope });
  const actor = (o: Partial<A> = {}): A => ({ isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [], ...o });
  const ktCs1 = actor({ permissions: [quyen(["cs1"])] });
  const ktHo = actor({ permissions: [quyen("ALL")] });

  it("kế toán CS1: ghi chính sách của CS1 được; của CS2 KHÔNG; dùng chung (null) KHÔNG", () => {
    expect(duocGhiChinhSach(ktCs1, "cs1")).toBe(true);
    expect(duocGhiChinhSach(ktCs1, "cs2")).toBe(false);
    expect(duocGhiChinhSach(ktCs1, null)).toBe(false);
  });
  it("kế toán Hội sở: ghi được mọi cơ sở và dùng chung (đối chứng dương)", () => {
    expect(duocGhiChinhSach(ktHo, "cs2")).toBe(true);
    expect(duocGhiChinhSach(ktHo, null)).toBe(true);
  });
  it("chỉ Hội sở được DUYỆT; kế toán cơ sở KHÔNG; người không có payments:confirm KHÔNG", () => {
    expect(duocDuyetChinhSach(ktHo)).toBe(true);
    expect(duocDuyetChinhSach(ktCs1)).toBe(false);
    expect(duocDuyetChinhSach(actor())).toBe(false);
    expect(duocGhiChinhSach(actor(), "cs1")).toBe(false);
  });
  it("SUPER_ADMIN đi đường ALL", () => {
    expect(duocDuyetChinhSach(actor({ isSuperAdmin: true }))).toBe(true);
    expect(duocGhiChinhSach(actor({ isSuperAdmin: true }), null)).toBe(true);
  });
  it("quyền payments:record (sale) KHÔNG đủ để ghi hay duyệt", () => {
    const sale = actor({ permissions: [{ action: "payments:record", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "S", centerScope: ["cs1"] }] });
    expect(duocGhiChinhSach(sale, "cs1")).toBe(false);
    expect(duocDuyetChinhSach(sale)).toBe(false);
  });
});

describe("[CSPB-14] nút nào được VẼ (luật 12): CÙNG vị từ với dịch vụ, vai thấy / vai không thấy", () => {
  type A = Parameters<typeof duocGhiChinhSach>[0] & { userId: string };
  const quyen = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL" as const, orgUnitId: "ou", roleCode: "X", centerScope });
  const actor = (userId: string, scope: "ALL" | string[] | null): A => ({ userId, isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: scope === null ? [] : [quyen(scope)] });
  const ban = (trangThai: string, o: { centerId?: string | null } = {}) => ({ trangThai, centerId: o.centerId === undefined ? "cs1" : o.centerId });
  const HO = actor("u-ho", "ALL");
  const CS1 = actor("u-cs1", ["cs1"]);

  it("bản NHÁP: người có quyền ghi thấy Gửi duyệt, mọi nút khác tắt; người chỉ-xem không thấy nút nào", () => {
    expect(hanhDongChinhSachChoPhep(CS1, ban("NHAP"))).toEqual({ guiDuyet: true, apDungNgay: false, duyet: false, tuChoi: false, ketThuc: false, lyDoKhongDuyet: null });
    expect(hanhDongChinhSachChoPhep(actor("x", null), ban("NHAP")).guiDuyet).toBe(false);
    expect(hanhDongChinhSachChoPhep(actor("x", ["cs2"]), ban("NHAP")).guiDuyet).toBe(false);
  });
  it("«Gửi duyệt và áp dụng ngay» (apDungNgay): CHỈ bản NHÁP mà người xem vừa gửi duyệt được vừa duyệt được — Hội sở thấy, kế toán cơ sở KHÔNG, bản khác trạng thái KHÔNG", () => {
    expect(hanhDongChinhSachChoPhep(HO, ban("NHAP")).apDungNgay).toBe(true);
    expect(hanhDongChinhSachChoPhep(HO, ban("NHAP", { centerId: null })).apDungNgay).toBe(true);
    expect(hanhDongChinhSachChoPhep(CS1, ban("NHAP")).apDungNgay).toBe(false); // gửi duyệt được nhưng không có quyền duyệt
    expect(hanhDongChinhSachChoPhep(actor("x", null), ban("NHAP")).apDungNgay).toBe(false);
    for (const t of ["CHO_DUYET", "HIEU_LUC", "HET_HIEU_LUC", "TU_CHOI"]) expect(hanhDongChinhSachChoPhep(HO, ban(t)).apDungNgay, t).toBe(false);
  });
  it("bản NHÁP dùng chung: kế toán cơ sở KHÔNG gửi duyệt được, Hội sở được", () => {
    expect(hanhDongChinhSachChoPhep(CS1, ban("NHAP", { centerId: null })).guiDuyet).toBe(false);
    expect(hanhDongChinhSachChoPhep(HO, ban("NHAP", { centerId: null })).guiDuyet).toBe(true);
  });
  it("bản CHỜ DUYỆT: kế toán Hội sở ⇒ Duyệt + Từ chối (kể cả khi chính họ là người soạn — không còn luật người khác duyệt); kế toán cơ sở ⇒ KHÔNG, kèm lý do 'Hội sở'", () => {
    expect(hanhDongChinhSachChoPhep(HO, ban("CHO_DUYET"))).toMatchObject({ duyet: true, tuChoi: true, lyDoKhongDuyet: null });
    const cs = hanhDongChinhSachChoPhep(CS1, ban("CHO_DUYET"));
    expect(cs).toMatchObject({ duyet: false, tuChoi: false });
    expect(cs.lyDoKhongDuyet).toMatch(/Hội sở/);
  });
  it("bản HIỆU LỰC: chỉ Hội sở thấy Kết thúc; bản đã kết thúc / bị từ chối: không nút nào", () => {
    expect(hanhDongChinhSachChoPhep(HO, ban("HIEU_LUC")).ketThuc).toBe(true);
    expect(hanhDongChinhSachChoPhep(CS1, ban("HIEU_LUC")).ketThuc).toBe(false);
    for (const t of ["HET_HIEU_LUC", "TU_CHOI"]) expect(hanhDongChinhSachChoPhep(HO, ban(t))).toEqual({ guiDuyet: false, apDungNgay: false, duyet: false, tuChoi: false, ketThuc: false, lyDoKhongDuyet: null });
  });
  it("khớp với dịch vụ: nút Duyệt ⇔ có quyền duyệt (`duocDuyetChinhSach`) và `kiemChuyen` cho qua — không còn điều kiện về người soạn", () => {
    for (const nguoi of [HO, CS1, actor("u-tao", "ALL")]) {
      const nut = hanhDongChinhSachChoPhep(nguoi, ban("CHO_DUYET")).duyet;
      const kc = kiemChuyen("CHO_DUYET", "HIEU_LUC", { lyDo: "Đã soát cùng kế toán", moPhong: { hashUi: "h", hashServer: "h" } });
      expect(nut, nguoi.userId).toBe(kc.ok && duocDuyetChinhSach(nguoi));
    }
  });
});
