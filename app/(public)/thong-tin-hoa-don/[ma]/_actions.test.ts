// Ca [TCA-*] — SERVER ACTION công khai `guiThongTinNguoiMuaAction`. Chạy action THẬT + bộ điều phối THẬT; chỉ giả những thứ chạm ngoài: header, rate-limit, DB, cờ, dịch vụ ghi.
// Mọi ca "KHÔNG được" kèm đối chứng dương. Hành vi trên Postgres thật: tests/finance/hoa-don-trang-cong-khai-db.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ghepMaLienKet, sinhToken } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-token";

const h = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  rateLimit: vi.fn(),
  findUnique: vi.fn(),
  hubBat: vi.fn(),
  cauHinh: vi.fn(),
  gui: vi.fn(),
  mo: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => h.headers.get(k.toLowerCase()) ?? null }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/db", () => ({ db: { hoaDonYeuCauNguoiMua: { findUnique: h.findUnique } } }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHubNguoiMuaBatChoCoSo: h.hubBat, docCauHinhNguoiMua: h.cauHinh }));
vi.mock("@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db", () => ({ guiThongTinPhuHuynh: h.gui, moBangToken: h.mo }));

import { guiThongTinNguoiMuaAction } from "./_actions";
import { PHIEN_BAN_DIEU_KHOAN } from "./_hang-so";

const ID = "00000000-0000-4000-8000-000000000def";
const MA = ghepMaLienKet(ID, sinhToken(() => Buffer.alloc(32, 9)));
const FORM = { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "079000000001", email: "", maSoThue: "", dongY: true };
const CAU_HINH = { ttlPhut: 240, toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15, giuDuLieuNgay: 30, choXuLyToiDaNgay: 14 };

beforeEach(() => {
  h.headers.clear();
  h.headers.set("x-forwarded-for", "203.0.113.7");
  h.rateLimit.mockReset().mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
  h.findUnique.mockReset().mockResolvedValue({ centerId: "cs-1" });
  h.hubBat.mockReset().mockResolvedValue(true);
  h.cauHinh.mockReset().mockResolvedValue(CAU_HINH);
  h.gui.mockReset().mockResolvedValue({ ok: true, oDaDoi: ["ten"], oXungDot: [] });
  h.mo.mockReset();
});

describe("[TCA-01] cờ TẮT ⇒ dịch vụ KHÔNG được gọi; đối chứng: cờ BẬT ⇒ gọi", () => {
  it("cờ TẮT ⇒ «không còn hiệu lực» và `guiThongTinPhuHuynh` không bao giờ chạy", async () => {
    h.hubBat.mockResolvedValue(false);
    const r = await guiThongTinNguoiMuaAction(MA, FORM);
    expect(r).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC", thongDiep: expect.stringContaining("không còn hiệu lực") });
    expect(h.gui).not.toHaveBeenCalled();
    expect(h.cauHinh).not.toHaveBeenCalled();
    expect(h.hubBat).toHaveBeenCalledWith("cs-1");
  });
  it("cờ BẬT ⇒ gọi dịch vụ đúng MỘT lần với id/token từ mã, ô đã chuẩn hoá và phiên bản điều khoản của trang", async () => {
    expect(await guiThongTinNguoiMuaAction(MA, FORM)).toEqual({ ok: true });
    expect(h.gui).toHaveBeenCalledTimes(1);
    const arg = h.gui.mock.calls[0]![0];
    expect(arg).toMatchObject({ id: ID, du: { loai: "CA_NHAN", ten: "Nguyễn Thị Phụ Huynh", diaChi: "114 Hoàng Diệu, Đà Nẵng" }, donY: { phienBanDieuKhoan: PHIEN_BAN_DIEU_KHOAN } });
    expect(arg.now).toBeInstanceOf(Date);
  });
});

describe("[TCA-02] rate-limit chạy TRƯỚC khi chạm DB / dịch vụ", () => {
  it("vượt hạn mức ⇒ từ chối, KHÔNG đọc DB, KHÔNG đọc cờ, KHÔNG gọi dịch vụ; đối chứng: còn hạn ⇒ chạy", async () => {
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    const r = await guiThongTinNguoiMuaAction(MA, FORM);
    expect(r).toMatchObject({ ok: false, kieu: "QUA_NHANH" });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.hubBat).not.toHaveBeenCalled();
    expect(h.gui).not.toHaveBeenCalled();
    h.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
    expect(await guiThongTinNguoiMuaAction(MA, FORM)).toEqual({ ok: true });
  });
  it("khoá hạn mức theo IP lấy từ header (phần tử CUỐI của x-forwarded-for) và theo id yêu cầu", async () => {
    h.headers.set("x-forwarded-for", "198.51.100.1, 203.0.113.99");
    await guiThongTinNguoiMuaAction(MA, FORM);
    const khoa = h.rateLimit.mock.calls.map((c) => c[0].key as string);
    expect(khoa).toContain("hoa-don-nguoi-mua:gui:ip:203.0.113.99");
    expect(khoa).toContain(`hoa-don-nguoi-mua:yeu-cau:${ID}`);
    expect(khoa.join()).not.toContain("198.51.100.1");
  });
});

describe("[TCA-03] thông điệp lỗi KHÔNG lộ mã nội bộ", () => {
  it("mọi mã lỗi của dịch vụ ⇒ lời thường ngày, không chứa tên mã / chuỗi `error`", async () => {
    for (const ma of ["KHONG_HOP_LE", "HET_HAN", "DA_DONG", "KHOA", "VUOT_SO_LAN_MO", "KHONG_CO_QUYEN", "DON_DA_DOI", "HOA_DON_DANG_PHAT_HANH"]) {
      h.gui.mockResolvedValue({ ok: false, ma, error: `NOI_BO_${ma}` });
      const r = await guiThongTinNguoiMuaAction(MA, FORM);
      expect(JSON.stringify(r)).not.toMatch(/NOI_BO_|KHONG_HOP_LE|HET_HAN|DA_DONG|VUOT_SO_LAN_MO|KHONG_CO_QUYEN|DON_DA_DOI|HOA_DON_DANG_PHAT_HANH/);
      expect(r.ok).toBe(false);
    }
  });
  it("dịch vụ ném lỗi chứa dữ liệu ⇒ kết quả KHÔNG chứa dữ liệu; log chỉ có TÊN loại lỗi", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.gui.mockRejectedValue(new Error("insert failed for tokenHash=SECRET-VALUE ten=Nguyễn Thị Phụ Huynh"));
    const r = await guiThongTinNguoiMuaAction(MA, FORM);
    expect(r).toMatchObject({ ok: false, kieu: "LOI_TAM" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET-VALUE|Nguyễn|tokenHash/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET-VALUE|Nguyễn|tokenHash|insert failed/);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it("không có đường nào log token hay giá trị ô khi chạy bình thường (console im lặng)", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await guiThongTinNguoiMuaAction(MA, FORM);
    h.gui.mockResolvedValue({ ok: false, ma: "KHONG_HOP_LE", error: "x" });
    await guiThongTinNguoiMuaAction(MA, FORM);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe("[TCA-04] đầu vào không tin cậy", () => {
  it("khoá giấy tờ LẠ gửi lẻn vào (soCanCuoc, hộ chiếu…) ⇒ KHÔNG bao giờ tới dịch vụ; đối chứng: các ô khai (kể cả CCCD ba/mẹ — luật mới 02/11/2026) tới nơi", async () => {
    await guiThongTinNguoiMuaAction(MA, { ...FORM, soCanCuoc: "x", hoChieu: "B1234567" });
    const du = h.gui.mock.calls[0]![0].du;
    expect(Object.keys(du).sort()).toEqual(["cccd", "diaChi", "loai", "ten"]);
    expect(JSON.stringify(h.gui.mock.calls)).not.toMatch(/soCanCuoc|hoChieu|B1234567/);
  });
  it("thiếu đồng ý ⇒ dịch vụ không chạy (không có đường ghi dữ liệu mà không có bản ghi đồng ý)", async () => {
    const r = await guiThongTinNguoiMuaAction(MA, { ...FORM, dongY: false });
    expect(r).toMatchObject({ ok: false, kieu: "DU_LIEU", loi: { dongY: expect.any(String) } });
    expect(h.gui).not.toHaveBeenCalled();
  });
  it("mã liên kết sai hình dạng ⇒ «không còn hiệu lực», không chạm hạn mức hay DB", async () => {
    for (const ma of ["", "abc", "x.y", `${ID}.ngan`]) {
      expect(await guiThongTinNguoiMuaAction(ma, FORM)).toMatchObject({ ok: false, kieu: "KHONG_CON_HIEU_LUC" });
    }
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.findUnique).not.toHaveBeenCalled();
  });
  it("input không phải object ⇒ lỗi dữ liệu, không ném", async () => {
    for (const v of [null, undefined, "x", 3]) expect(await guiThongTinNguoiMuaAction(MA, v)).toMatchObject({ ok: false, kieu: "DU_LIEU" });
  });
});

describe("[TCA-05] phiên bản điều khoản", () => {
  it("hằng mang dấu `-nhap` (văn bản CHƯA được pháp chế duyệt — OD-11); bản 02/11 có hậu tố `-cccd` vì câu chữ đã đổi (form thu CCCD)", () => {
    expect(PHIEN_BAN_DIEU_KHOAN).toMatch(/-nhap(-[a-z]+)?$/);
    expect(PHIEN_BAN_DIEU_KHOAN).toBe("2026-11-02-nhap-cccd");
  });
});
