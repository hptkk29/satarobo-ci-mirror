// Ca [CSMP-*] — mô phỏng bắt buộc trước duyệt + băm chứng minh "đã xem mô phỏng của CHÍNH nội dung này" (lát S7, Invoice Hub). THUẦN.
// Ca CSMP-W* là lưới ghim mã nguồn: neo vào LỜI GỌI / biểu thức, bỏ chú thích trước khi đếm, đếm cả SỐ LẦN khớp (luật 11).
import { readFileSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { describe, expect, it } from "vitest";
import { phanTichNoiDung, sangQuyTac, type NoiDungChinhSach } from "./chinh-sach-phien-ban";
import {
  chayMoPhong,
  chuoiChuan,
  dungMoPhong,
  dungTapMau,
  tinhMoPhongHash,
  type BoiCanhMoPhong,
  type MauMoPhong,
} from "./chinh-sach-mo-phong";
import { moPhong } from "./engine/chinh-sach";

const dong = (loaiKhoan: string, mucThue: unknown = { kieu: "SUAT", phanTram: 8 }) => ({
  loaiKhoan,
  mucThue,
  kieuGia: "DA_GOM_THUE",
  donViTinh: "Lần",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI",
  mauMoTaSoBuoi: "({n} buổi)",
});
const tho = (o: Record<string, unknown> = {}) => ({
  anhXaThue: [dong("COURSE"), dong("EXAM")],
  thoiDiemLap: "DO_KE_TOAN_CHOT",
  cheDoToiDa: "SHADOW",
  nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG" },
  lamTron: "HALF_UP",
  legalBasisRef: [{ vanBan: "Văn bản thử", doTinCay: "TRUNG", canKeToanXacNhan: false }],
  ...o,
});
const nd = (o: Record<string, unknown> = {}): NoiDungChinhSach => {
  const r = phanTichNoiDung(tho(o));
  if (!r.ok) throw new Error(r.loi.join("|"));
  return r.noiDung;
};
const BAN = { id: "cs-1", phienBan: 2, phapNhanMa: "NEW_VISION", centerId: "cs1" as string | null, hieuLucTu: "2026-07-01", hieuLucDen: null as string | null };
const boiCanh = (o: Partial<BoiCanhMoPhong> = {}): BoiCanhMoPhong => ({ ...BAN, ngay: "2026-07-01", hienHanh: ["NEW_VISION|cs1|COURSE@v1"], ...o });
const MAU: MauMoPhong[] = [{ ma: "mau-COURSE", tenGoc: "Khoá học (mẫu)", loaiKhoan: "COURSE", soTien: 8_976_000, soBuoi: 48 }];
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[CSMP-01] băm: tất định, độc lập thứ tự khoá, nhạy với MỌI thành phần", () => {
  const goc = tinhMoPhongHash(nd(), MAU, boiCanh());
  it("sha256 hex 64 ký tự, gọi lại ra cùng giá trị", () => {
    expect(goc).toMatch(/^[0-9a-f]{64}$/);
    expect(tinhMoPhongHash(nd(), MAU, boiCanh())).toBe(goc);
  });
  it("thứ tự khoá object không đổi băm (nội dung chuẩn hoá + chuỗi chuẩn)", () => {
    expect(chuoiChuan({ b: 1, a: { d: 2, c: 3 } })).toBe(chuoiChuan({ a: { c: 3, d: 2 }, b: 1 }));
    const daoThuTu = { ...boiCanh(), ngay: "2026-07-01" };
    const khac = Object.fromEntries(Object.entries(daoThuTu).reverse()) as unknown as BoiCanhMoPhong;
    expect(tinhMoPhongHash(nd(), MAU, khac)).toBe(goc);
  });
  it("thứ tự dòng anhXaThue không đổi băm (đã sắp khi chuẩn hoá); thứ tự mảng khác thì đổi", () => {
    expect(tinhMoPhongHash(nd({ anhXaThue: [dong("EXAM"), dong("COURSE")] }), MAU, boiCanh())).toBe(goc);
    expect(chuoiChuan([1, 2])).not.toBe(chuoiChuan([2, 1]));
  });
  it("đổi một thuế suất ⇒ băm đổi; đổi thoiDiemLap ⇒ đổi; đổi căn cứ (đã ký) ⇒ đổi; đổi qrTtlGio ⇒ đổi", () => {
    expect(tinhMoPhongHash(nd({ anhXaThue: [dong("COURSE", { kieu: "SUAT", phanTram: 10 }), dong("EXAM")] }), MAU, boiCanh())).not.toBe(goc);
    expect(tinhMoPhongHash(nd({ thoiDiemLap: "KHI_THU_TIEN" }), MAU, boiCanh())).not.toBe(goc);
    expect(tinhMoPhongHash(nd({ legalBasisRef: [{ vanBan: "Văn bản thử", doTinCay: "TRUNG", canKeToanXacNhan: true, daKyDuyetBoi: "KT", daKyDuyetLuc: "2026-11-01" }] }), MAU, boiCanh())).not.toBe(goc);
    expect(tinhMoPhongHash(nd({ nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG", qrTtlGio: 6 } }), MAU, boiCanh())).not.toBe(goc);
  });
  it("đổi tập mẫu (số tiền, thêm mẫu) ⇒ băm đổi", () => {
    expect(tinhMoPhongHash(nd(), [{ ...MAU[0]!, soTien: 8_976_001 }], boiCanh())).not.toBe(goc);
    expect(tinhMoPhongHash(nd(), [...MAU, { ...MAU[0]!, ma: "mau-2" }], boiCanh())).not.toBe(goc);
  });
  it.each([
    ["id bản ghi", { id: "cs-2" }],
    ["phiên bản", { phienBan: 3 }],
    ["cơ sở", { centerId: "cs2" }],
    ["dùng chung thay vì riêng", { centerId: null }],
    ["pháp nhân", { phapNhanMa: "SATA_ROBO" }],
    ["ngày bắt đầu", { hieuLucTu: "2026-07-02", ngay: "2026-07-02" }],
    ["ngày kết thúc", { hieuLucDen: "2026-12-31" }],
    ["chính sách đang hiệu lực làm mốc", { hienHanh: ["NEW_VISION|cs1|COURSE@v2"] }],
  ] as [string, Partial<BoiCanhMoPhong>][])("đổi %s ⇒ băm đổi (bản nháp giống hệt ở nơi khác không dùng lại được băm)", (_t, o) => {
    expect(tinhMoPhongHash(nd(), MAU, boiCanh(o))).not.toBe(goc);
  });
  it("chuỗi chuẩn: NFC (chữ có dấu gõ tổ hợp vs dựng sẵn cho cùng băm); số không hữu hạn ⇒ ném", () => {
    expect(chuoiChuan({ t: "Học phí".normalize("NFD") })).toBe(chuoiChuan({ t: "Học phí".normalize("NFC") }));
    expect(() => chuoiChuan({ x: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe("[CSMP-02] tập mẫu: server dựng, tất định, một mẫu mỗi loại khoản", () => {
  it("một mẫu mỗi loại, trùng thì gộp, sắp theo tên; COURSE có số buổi, loại khác không", () => {
    const t = dungTapMau(["EXAM", "COURSE", "EXAM", "TAT_CA"]);
    expect(t.map((m) => m.loaiKhoan)).toEqual(["COURSE", "EXAM", "TAT_CA"]);
    expect(t[0]).toMatchObject({ soBuoi: 48, soTien: 8_976_000 });
    expect(t[1]).toMatchObject({ soBuoi: null, soTien: 1_234_567 });
    expect(dungTapMau(["COURSE", "EXAM"])).toEqual(dungTapMau(["EXAM", "COURSE"]));
  });
  it("số tiền mẫu chia thuế ra phần lẻ (soi được sai số làm tròn): cả hai mẫu cho thuế suất 8% không chia hết", () => {
    for (const m of dungTapMau(["COURSE", "KHAC"])) expect((m.soTien * 100) % 108, m.loaiKhoan).not.toBe(0);
  });
  it("loại khoản của ứng viên VÀ của chính sách đang hiệu lực đều có mẫu (để thấy loại bị bỏ rơi)", () => {
    const ban = { ...BAN };
    const hienHanh = sangQuyTac({ ...ban, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: "2026-06-30" }, nd({ anhXaThue: [dong("COURSE"), dong("PRODUCT")] }));
    const r = dungMoPhong({ ban, noiDungTho: tho({ anhXaThue: [dong("COURSE")] }), hienHanh });
    expect(r.ok && r.tapMau.map((m) => m.loaiKhoan)).toEqual(["COURSE", "PRODUCT"]);
  });
});

describe("[CSMP-03] mô phỏng dùng ĐÚNG engine S3 (không bản riêng)", () => {
  it("kết quả một mẫu BẰNG kết quả gọi thẳng `moPhong` của engine với cùng đầu vào", () => {
    const q = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: "cs1", phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: null }, nd());
    const kq = chayMoPhong({ ungVien: q, hienHanh: [], phamVi: { phapNhanMa: "NEW_VISION", centerId: "cs1" }, ngay: "2026-07-01", tapMau: MAU });
    const thang = moPhong({
      chinhSach: q,
      phapNhanMa: "NEW_VISION",
      centerId: "cs1",
      ngay: "2026-07-01",
      dong: [{ ma: "mau-COURSE", tenGoc: "Khoá học (mẫu)", loaiKhoan: "COURSE", soTien: 8_976_000, soBuoi: 48 }],
      tongChietKhau: 0,
      laDieuChinh: false,
      canhBaoHetHanTrongNgay: 60,
    });
    expect(thang.ok).toBe(true);
    const sau = kq.dong[0]!.sau;
    expect(sau.ok).toBe(true);
    if (thang.ok && sau.ok) {
      expect(sau.tienThue).toBe(thang.tinh.tong.tienThue);
      expect(sau.thanhTienTruocThue).toBe(thang.tinh.tong.thanhTienTruocThue);
      expect(sau.congTien).toBe(thang.tinh.tong.congTienThanhToan);
      expect(sau.quyTac).toBe("NEW_VISION|cs1|COURSE@v2");
    }
  });
  it("số cụ thể (DA_GOM_THUE 8%): 8.976.000 ⇒ trước thuế 8.311.111, thuế 664.889 — khớp cách chia ngược của engine", () => {
    const q = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: "cs1", phienBan: 2, hieuLucTu: "2026-07-01", hieuLucDen: null }, nd());
    const kq = chayMoPhong({ ungVien: q, hienHanh: [], phamVi: { phapNhanMa: "NEW_VISION", centerId: "cs1" }, ngay: "2026-07-01", tapMau: MAU });
    const s = kq.dong[0]!.sau;
    expect(s.ok && [s.thanhTienTruocThue, s.tienThue, s.congTien]).toEqual([8_311_111, 664_889, 8_976_000]);
  });
});

describe("[CSMP-04] trước / sau", () => {
  const phamVi = { phapNhanMa: "NEW_VISION", centerId: "cs1" as string | null };
  const q = (v: number, tu: string, den: string | null, o: Record<string, unknown> = {}) => sangQuyTac({ ...phamVi, phienBan: v, hieuLucTu: tu, hieuLucDen: den }, nd(o));

  it("đổi thuế 8% → KCT: thuế sau = 0, chênh lệch = −664.889, mẫu COURSE đánh dấu `doi`", () => {
    const hienHanh = q(1, "2026-01-01", "2026-06-30");
    const ungVien = q(2, "2026-07-01", null, { anhXaThue: [dong("COURSE", { kieu: "KCT" })] });
    const kq = chayMoPhong({ ungVien, hienHanh, phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE"]) });
    // hienHanh hết hạn 30/06 ⇒ ngày 01/07 "trước" không có quy tắc — dùng bản chưa hết hạn để so:
    expect(kq.dong[0]!.truoc).toMatchObject({ ok: false, ma: "KHONG_CO" });
    const hienMo = q(1, "2026-01-01", null);
    const kq2 = chayMoPhong({ ungVien, hienHanh: hienMo, phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE"]) });
    const d = kq2.dong[0]!;
    expect(d.truoc.ok && d.truoc.tienThue).toBe(664_889);
    expect(d.sau.ok && d.sau.tienThue).toBe(0);
    expect(d.doi).toBe(true);
    expect(kq2.chenhLechThue).toBe(-664_889);
    expect(kq2.soMauDoiKetQua).toBe(1);
  });
  it("giữ nguyên nội dung ⇒ không mẫu nào `doi`, chênh lệch 0 (đối chứng dương)", () => {
    const hienMo = q(1, "2026-01-01", null);
    const ungVien = q(2, "2026-07-01", null);
    const kq = chayMoPhong({ ungVien, hienHanh: hienMo, phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE", "EXAM"]) });
    expect(kq.soMauDoiKetQua).toBe(0);
    expect(kq.chenhLechThue).toBe(0);
  });
  it("chưa có chính sách đang hiệu lực ⇒ 'trước' là KHONG_CO, 'sau' tính được; chênh lệch null (không có gì để so)", () => {
    const kq = chayMoPhong({ ungVien: q(1, "2026-07-01", null), hienHanh: [], phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE"]) });
    expect(kq.dong[0]!.truoc).toMatchObject({ ok: false, ma: "KHONG_CO" });
    expect(kq.dong[0]!.sau.ok).toBe(true);
    expect(kq.chenhLechThue).toBeNull();
    expect(kq.soMauSauLoi).toBe(0);
  });
  it("chính sách mới BỎ một loại khoản mà chính sách cũ có ⇒ mẫu đó 'sau' lỗi KHONG_CO, được đếm", () => {
    const hienMo = sangQuyTac({ ...phamVi, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, nd({ anhXaThue: [dong("COURSE"), dong("PRODUCT")] }));
    const ungVien = q(2, "2026-07-01", null, { anhXaThue: [dong("COURSE")] });
    const kq = chayMoPhong({ ungVien, hienHanh: hienMo, phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE", "PRODUCT"]) });
    expect(kq.soMauSauLoi).toBe(1);
    const sp = kq.dong.find((d) => d.mau.loaiKhoan === "PRODUCT")!;
    expect(sp.sau).toMatchObject({ ok: false, ma: "KHONG_CO" });
    expect(sp.doi).toBe(true);
  });
  it("quy tắc của phạm vi KHÁC (dùng chung) vẫn tính ở 'sau' — bản riêng cơ sở chỉ thay quy tắc cùng phạm vi", () => {
    const chung = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: null, phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, nd({ anhXaThue: [dong("EXAM")] }));
    const ungVien = q(1, "2026-07-01", null, { anhXaThue: [dong("COURSE")] });
    const kq = chayMoPhong({ ungVien, hienHanh: chung, phamVi, ngay: "2026-07-01", tapMau: dungTapMau(["COURSE", "EXAM"]) });
    expect(kq.dong.find((d) => d.mau.loaiKhoan === "EXAM")!.sau.ok).toBe(true);
  });
});

describe("[CSMP-05] dungMoPhong: một hàm cho trang và bước duyệt", () => {
  const hienHanh = sangQuyTac({ phapNhanMa: "NEW_VISION", centerId: "cs1", phienBan: 1, hieuLucTu: "2026-01-01", hieuLucDen: null }, nd());
  it("cùng đầu vào ⇒ cùng băm (trang và server tính ra đúng một giá trị)", () => {
    const a = dungMoPhong({ ban: BAN, noiDungTho: tho(), hienHanh });
    const b = dungMoPhong({ ban: BAN, noiDungTho: tho(), hienHanh });
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true);
  });
  it("chính sách đang hiệu lực đổi (vd phiên bản mốc đổi) ⇒ băm đổi, dù nội dung ứng viên y nguyên", () => {
    const a = dungMoPhong({ ban: BAN, noiDungTho: tho(), hienHanh });
    const doi = hienHanh.map((x) => ({ ...x, phienBan: 9 }));
    const b = dungMoPhong({ ban: BAN, noiDungTho: tho(), hienHanh: doi });
    expect(a.ok && b.ok && a.hash !== b.hash).toBe(true);
  });
  it("nội dung hỏng ⇒ { ok:false, loi } (không ném)", () => {
    const r = dungMoPhong({ ban: BAN, noiDungTho: { anhXaThue: [] }, hienHanh });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi.length).toBeGreaterThan(0);
  });
  it("ngày xét là ngày bắt đầu hiệu lực của phiên bản", () => {
    const r = dungMoPhong({ ban: { ...BAN, hieuLucTu: "2026-09-15" }, noiDungTho: tho(), hienHanh });
    expect(r.ok && r.ketQua.ngay).toBe("2026-09-15");
  });
});

describe("[CSMP-W1] lưới ghim mã nguồn: không có bản mô phỏng thứ hai, client không import tệp có node:crypto", () => {
  const doc = (p: string) => boChuThich(readFileSync(duongDan(process.cwd(), p), "utf8"));
  it("chinh-sach-mo-phong.ts gọi `moPhong(` đúng 1 lần và KHÔNG import tinhHoaDon/resolve", () => {
    const ma = doc("lib/finance/hoa-don/chinh-sach-mo-phong.ts");
    expect(ma.match(/\bmoPhong\s*\(/g)?.length).toBe(1);
    expect(ma).toMatch(/import\s*\{[^}]*\bmoPhong\b[^}]*\}\s*from\s*"\.\/engine\/chinh-sach"/);
    expect(ma).not.toMatch(/\btinhHoaDon\b/);
    expect(ma).not.toMatch(/import\s*\{[^}]*\bresolve\b[^}]*\}/);
  });
  it("chinh-sach-phien-ban.ts (client dùng được) không import node:* và không import tệp mô phỏng", () => {
    const ma = doc("lib/finance/hoa-don/chinh-sach-phien-ban.ts");
    expect(ma).not.toMatch(/from\s*"node:/);
    expect(ma).not.toMatch(/chinh-sach-mo-phong/);
    expect(ma).not.toMatch(/from\s*"@\/lib\/(?:db|auth)/);
  });
});
