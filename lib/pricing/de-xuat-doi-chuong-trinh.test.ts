// @vitest-environment node
/**
 * `de-xuat-doi-chuong-trinh.ts` — Sale đề xuất THÊM / BỎ chương trình so với gợi ý, chờ QLCS duyệt (D5, chủ dự án chốt 18/10/2026).
 * Phần thuần. Dịch vụ ghi DB (quyền, cơ sở, khoá đơn, nhật ký, đồng thời) test ở `tests/finance/de-xuat-doi-chuong-trinh.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { goiYChuongTrinh, type NguCanhGoiY, type UngVienGiam } from "./goi-y-chuong-trinh";
import {
  LY_DO_TOI_THIEU,
  dauVanGoiY,
  deXuatTuLuaChon,
  kiemDeXuat,
  tapMaSauDuyet,
  xetQuyetDinh,
} from "./de-xuat-doi-chuong-trinh";

const ct = (id: string, nhom: UngVienGiam["nhom"], phanTram: number, dk: Partial<UngVienGiam["dieuKien"]> = {}, phienBan = "v1"): UngVienGiam => ({
  id,
  ma: id.toUpperCase(),
  maVanBan: "SR.QD.233",
  ten: `Chương trình ${id}`,
  nhom,
  phanTram,
  dieuKien: { soBuoi: [], thuTuCon: null, thuTuSanPham48: null, ...dk },
  phienBan,
});
const CTX: NguCanhGoiY = { soBuoi: 24, thuTuCon: 2, thuTuSanPham48: null, niemYet: 5_280_000 };
const UNG_VIEN = [
  ct("banga24", "BASE", 5, { soBuoi: [24] }),
  ct("anhem2", "ADD_ON", 10, { thuTuCon: { tu: 2, den: 2 } }),
];
const goiY = () => goiYChuongTrinh(CTX, UNG_VIEN, 25);
const LY_DO = "Khách có giấy xác nhận học bổng riêng";
const CHO_PHEP = new Set(["khac1", "khac2"]);

describe("[DXC-01..08] kiểm đề xuất thêm / bỏ so với gợi ý", () => {
  it("[DXC-01] gợi ý có cả hai thành phần (tiền đề của mọi ca dưới)", () => {
    expect(goiY().thanhPhan.map((t) => t.id).sort()).toEqual(["anhem2", "banga24"]);
  });
  it("[DXC-02] lý do dưới 10 ký tự (kể cả toàn khoảng trắng) ⇒ LY_DO_NGAN", () => {
    expect(LY_DO_TOI_THIEU).toBe(10);
    for (const lyDo of ["", "ngắn", "   ngắn      ", "123456789"]) {
      const r = kiemDeXuat({ goiY: goiY(), themVao: [], boBot: ["anhem2"], lyDo, choPhepThem: CHO_PHEP });
      expect(r).toMatchObject({ ok: false, ma: "LY_DO_NGAN" });
    }
  });
  it("[DXC-03] đề xuất rỗng ⇒ DE_XUAT_RONG", () => {
    expect(kiemDeXuat({ goiY: goiY(), themVao: [], boBot: [], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toMatchObject({ ok: false, ma: "DE_XUAT_RONG" });
  });
  it("[DXC-04] bỏ một mã hệ thống KHÔNG gợi ý ⇒ BO_MA_KHONG_CO_TRONG_GOI_Y (nêu mã nào)", () => {
    expect(kiemDeXuat({ goiY: goiY(), themVao: [], boBot: ["khac1"], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toEqual({
      ok: false,
      ma: "BO_MA_KHONG_CO_TRONG_GOI_Y",
      chiTiet: ["khac1"],
    });
  });
  it("[DXC-05] thêm mã đã được gợi ý ⇒ THEM_MA_DA_CO_TRONG_GOI_Y; thêm mã ngoài tập dùng được (sai cơ sở / hết hiệu lực) ⇒ THEM_MA_KHONG_DUNG_DUOC", () => {
    expect(kiemDeXuat({ goiY: goiY(), themVao: ["banga24"], boBot: [], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toMatchObject({ ok: false, ma: "THEM_MA_DA_CO_TRONG_GOI_Y" });
    expect(kiemDeXuat({ goiY: goiY(), themVao: ["la-hoac"], boBot: [], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toMatchObject({
      ok: false,
      ma: "THEM_MA_KHONG_DUNG_DUOC",
      chiTiet: ["la-hoac"],
    });
  });
  it("[DXC-06] mã lặp, hoặc vừa thêm vừa bỏ ⇒ từ chối", () => {
    expect(kiemDeXuat({ goiY: goiY(), themVao: ["khac1", "khac1"], boBot: [], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toMatchObject({ ma: "MA_LAP" });
    expect(kiemDeXuat({ goiY: goiY(), themVao: ["khac1"], boBot: ["khac1"], lyDo: LY_DO, choPhepThem: CHO_PHEP })).toMatchObject({ ma: "VUA_THEM_VUA_BO" });
  });
  it("[DXC-07] đề xuất hợp lệ: chuẩn hoá (sắp xếp, cắt khoảng trắng lý do)", () => {
    const r = kiemDeXuat({ goiY: goiY(), themVao: ["khac2", "khac1"], boBot: ["anhem2"], lyDo: `  ${LY_DO}  `, choPhepThem: CHO_PHEP });
    expect(r).toEqual({ ok: true, deXuat: { themVao: ["khac1", "khac2"], boBot: ["anhem2"], lyDo: LY_DO } });
  });
  it("[DXC-08] tập mã cuối cùng = (gợi ý − bỏ) ∪ thêm; không tính tiền", () => {
    expect(tapMaSauDuyet(goiY(), { themVao: ["khac1"], boBot: ["anhem2"] })).toEqual(["banga24", "khac1"]);
    expect(tapMaSauDuyet(goiY(), { themVao: [], boBot: ["banga24", "anhem2"] })).toEqual([]);
  });
});

describe("[DXC-10..13] từ tập Sale chọn ở dòng 'Giảm giá dòng này' suy ra đề xuất", () => {
  it("[DXC-10] chọn TRÙNG KHÍT gợi ý (thứ tự bất kỳ) ⇒ null: không cần duyệt", () => {
    expect(deXuatTuLuaChon(goiY(), ["anhem2", "banga24"], "", CHO_PHEP)).toBeNull();
  });
  it("[DXC-11] bỏ một mã ⇒ đề xuất bỏ; lý do ngắn ⇒ từ chối dù tập chọn khác gợi ý", () => {
    expect(deXuatTuLuaChon(goiY(), ["banga24"], LY_DO, CHO_PHEP)).toEqual({ ok: true, deXuat: { themVao: [], boBot: ["anhem2"], lyDo: LY_DO } });
    expect(deXuatTuLuaChon(goiY(), ["banga24"], "ngắn", CHO_PHEP)).toMatchObject({ ok: false, ma: "LY_DO_NGAN" });
  });
  it("[DXC-12] thêm một mã ngoài gợi ý ⇒ đề xuất thêm", () => {
    expect(deXuatTuLuaChon(goiY(), ["banga24", "anhem2", "khac1"], LY_DO, CHO_PHEP)).toEqual({ ok: true, deXuat: { themVao: ["khac1"], boBot: [], lyDo: LY_DO } });
  });
  it("[DXC-13] gửi LẶP một mã ⇒ MA_LAP (không để một mã bị trừ hai lần)", () => {
    expect(deXuatTuLuaChon(goiY(), ["banga24", "banga24", "anhem2"], LY_DO, CHO_PHEP)).toMatchObject({ ok: false, ma: "MA_LAP", chiTiet: ["banga24"] });
  });
});

describe("[DXC-20..24] dấu vân tay của gợi ý", () => {
  const dv = (u: readonly UngVienGiam[], ctx: NguCanhGoiY = CTX) => dauVanGoiY(goiYChuongTrinh(ctx, u, 25), ctx);
  it("[DXC-20] ổn định và không phụ thuộc thứ tự ứng viên", () => {
    expect(dv(UNG_VIEN)).toBe(dv([...UNG_VIEN].reverse()));
    expect(dv(UNG_VIEN)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("[DXC-21] đổi phiên bản văn bản, % hoặc thêm/bớt thành phần ⇒ đổi", () => {
    const goc = dv(UNG_VIEN);
    expect(dv([ct("banga24", "BASE", 5, { soBuoi: [24] }, "v2"), UNG_VIEN[1]!])).not.toBe(goc);
    expect(dv([ct("banga24", "BASE", 10, { soBuoi: [24] }), UNG_VIEN[1]!])).not.toBe(goc);
    expect(dv([UNG_VIEN[0]!])).not.toBe(goc);
  });
  it("[DXC-22] thứ hạng gia đình đổi (con thứ hai → thứ ba) hoặc niêm yết đổi ⇒ đổi", () => {
    const goc = dv(UNG_VIEN);
    expect(dv(UNG_VIEN, { ...CTX, thuTuCon: 3 })).not.toBe(goc);
    expect(dv(UNG_VIEN, { ...CTX, niemYet: 5_400_000 })).not.toBe(goc);
  });
  it("[DXC-22b] thứ hạng con đổi mà TẬP THÀNH PHẦN không đổi (chương trình không có điều kiện thứ tự) vẫn ⇒ đổi: người duyệt đã đọc căn cứ 'con thứ hai'", () => {
    const khongDieuKienThuTu = [ct("banga24", "BASE", 5, { soBuoi: [24] })];
    const a = dauVanGoiY(goiYChuongTrinh(CTX, khongDieuKienThuTu, 25), CTX);
    const ctx3 = { ...CTX, thuTuCon: 3 };
    expect(goiYChuongTrinh(ctx3, khongDieuKienThuTu, 25).thanhPhan.map((t) => t.id)).toEqual(["banga24"]);
    expect(dauVanGoiY(goiYChuongTrinh(ctx3, khongDieuKienThuTu, 25), ctx3)).not.toBe(a);
    const ctxSp = { ...CTX, soBuoi: 24, thuTuSanPham48: 2 };
    expect(dauVanGoiY(goiYChuongTrinh(ctxSp, khongDieuKienThuTu, 25), ctxSp)).not.toBe(a);
  });
});

describe("[DXC-30..37] quyết định trên một đề xuất", () => {
  const co = { trangThai: "PENDING", dauVanLuc: "a", dauVanHienTai: "a", nguoiDeXuat: "sale", nguoiQuyet: "qlcs", lyDo: null } as const;
  it("[DXC-30] duyệt khi dấu vân tay còn khớp ⇒ APPROVED, không tự duyệt", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "DUYET" })).toEqual({ ok: true, trangThaiMoi: "APPROVED", tuQuyet: false });
  });
  it("[DXC-31] duyệt khi gợi ý đã đổi ⇒ GOI_Y_DA_DOI (không ký bản diff cũ)", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "DUYET", dauVanHienTai: "b" })).toEqual({ ok: false, ma: "GOI_Y_DA_DOI" });
  });
  it("[DXC-32] từ chối cần lý do ≥ 10 ký tự", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "TU_CHOI", lyDo: "không" })).toEqual({ ok: false, ma: "LY_DO_NGAN" });
    expect(xetQuyetDinh({ ...co, hanhDong: "TU_CHOI", lyDo: null })).toEqual({ ok: false, ma: "LY_DO_NGAN" });
    expect(xetQuyetDinh({ ...co, hanhDong: "TU_CHOI", lyDo: "Không có giấy tờ chứng minh" })).toMatchObject({ ok: true, trangThaiMoi: "REJECTED" });
  });
  it("[DXC-33] từ chối được dù gợi ý đã đổi (gỡ đề xuất cũ khỏi hàng chờ)", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "TU_CHOI", dauVanHienTai: "b", lyDo: "Gợi ý đã đổi, đề xuất lại" })).toMatchObject({ ok: true });
  });
  it("[DXC-34] huỷ: chỉ người đề xuất", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "HUY" })).toEqual({ ok: false, ma: "CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC" });
    expect(xetQuyetDinh({ ...co, hanhDong: "HUY", nguoiQuyet: "sale" })).toEqual({ ok: true, trangThaiMoi: "CANCELLED", tuQuyet: true });
  });
  it("[DXC-35] người đề xuất tự duyệt: KHÔNG chặn (chưa có quy tắc) nhưng đánh dấu tuQuyet để nhật ký ghi", () => {
    expect(xetQuyetDinh({ ...co, hanhDong: "DUYET", nguoiQuyet: "sale" })).toEqual({ ok: true, trangThaiMoi: "APPROVED", tuQuyet: true });
  });
  it("[DXC-36] đã quyết rồi (mọi trạng thái ≠ PENDING) ⇒ KHONG_DOI, kể cả khi lần này lẽ ra bị từ chối vì vân tay/lý do", () => {
    for (const trangThai of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(xetQuyetDinh({ ...co, trangThai, hanhDong: "DUYET", dauVanHienTai: "khac" })).toEqual({ ok: "KHONG_DOI", trangThai });
      expect(xetQuyetDinh({ ...co, trangThai, hanhDong: "TU_CHOI", lyDo: null })).toEqual({ ok: "KHONG_DOI", trangThai });
    }
  });
});

describe("[DXC-PIN] chưa nối vào đường nào (cờ TẮT ⇒ đường cũ nguyên văn)", () => {
  const goc = process.cwd();
  const duyet = (dir: string, ra: string[]): string[] => {
    for (const t of readdirSync(dir)) {
      if (t === "node_modules" || t === ".next" || t.startsWith(".")) continue;
      const p = join(dir, t);
      if (statSync(p).isDirectory()) duyet(p, ra);
      else if (/\.(ts|tsx)$/.test(t) && !/de-xuat-doi-chuong-trinh(-db)?\.(test\.)?ts$/.test(t)) ra.push(p);
    }
    return ra;
  };
  it("không tệp nguồn nào ở app/ · lib/ · components/ import de-xuat-doi-chuong-trinh (nối vào là đổi hành vi — phải sửa lưới này CÓ CHỦ ĐÍCH)", () => {
    const tep = ["app", "lib", "components"].flatMap((x) => duyet(resolve(goc, x), []));
    expect(tep.length).toBeGreaterThan(100);
    const nhap = tep.filter((p) => /from\s+["'][^"']*de-xuat-doi-chuong-trinh(-db)?["']/.test(readFileSync(p, "utf8")));
    expect(nhap.map((p) => p.replace(goc, ""))).toEqual([]);
  }, 30_000);
});
