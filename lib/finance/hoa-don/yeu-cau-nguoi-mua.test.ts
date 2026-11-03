// Ca [YCM-*] — luật THUẦN của yêu cầu thu thập thông tin người mua (Invoice Hub đợt 2, S11 phần độc lập). Không DB, không đồng hồ thật (mọi `now` là hằng tuyệt đối — luật 19).
// Hành vi trên Postgres thật (vòng đời, khoá sau N lần sai, chéo cơ sở, đua xác nhận…) đo ở `tests/finance/hoa-don-yeu-cau-nguoi-mua-db.test.ts`.
// Mọi ca "KHÔNG được" kèm ĐỐI CHỨNG DƯƠNG.
import { beforeEach, describe, expect, it, vi } from "vitest";

const spy = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (goc) => {
  const that = await goc<typeof import("node:crypto")>();
  // Bọc: ghi lại lời gọi rồi chạy hàm THẬT (vitest có thể reset impl của mock giữa các ca).
  return { ...that, timingSafeEqual: (x: NodeJS.ArrayBufferView, y: NodeJS.ArrayBufferView) => (spy.timingSafeEqual(x, y), that.timingSafeEqual(x, y)) };
});

import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import {
  O_CHI_CA_NHAN,
  O_NGUOI_MUA,
  O_NHAY_CAM,
  TTL_MAC_DINH_PHUT,
  TTL_TOI_DA_PHUT,
  chuanHoaO,
  daHetHan,
  docDuLieuLuu,
  duocXuLyYeuCau,
  dungDuLieuLuu,
  hopNhatTheoO,
  kiemBoDayDu,
  kiemGioiHan,
  kiemODon,
  nguoiMuaToiGianSchema,
  phamViXuLyYeuCau,
  quyetDinhMo,
  sauTokenSai,
  tinhHetHan,
  type BangO,
  type GioiHanChongDoan,
} from "./yeu-cau-nguoi-mua";
import { COT_GOC, bamToken, ghepMaLienKet, giaTriGocHash, laDinhDangToken, sinhToken, soKhopHash, tachMaLienKet } from "./yeu-cau-nguoi-mua-token";

const NOW = new Date("2026-11-02T03:00:00.000Z");
const phut = (n: number) => new Date(NOW.getTime() + n * 60_000);
const G: GioiHanChongDoan = { toiDaSaiToken: 5, toiDaLanMo: 10, khoaPhut: 30 };

describe("[YCM-01] token: 32 byte ngẫu nhiên base64url; DB chỉ giữ hash; so khớp THỜI GIAN HẰNG", () => {
  beforeEach(() => spy.timingSafeEqual.mockClear());

  it("token = 43 ký tự base64url; hai lần sinh khác nhau; nguồn tiêm tất định cho ra token tất định", () => {
    const a = sinhToken();
    const b = sinhToken();
    expect(a).toHaveLength(43);
    expect(laDinhDangToken(a)).toBe(true);
    expect(a).not.toBe(b);
    const nguon = (n: number) => Buffer.alloc(n, 7);
    expect(sinhToken(nguon)).toBe(sinhToken(nguon));
    expect(sinhToken(nguon)).toBe(Buffer.alloc(32, 7).toString("base64url"));
  });
  it("nguồn trả sai độ dài ⇒ ném (không sinh token ngắn)", () => {
    expect(() => sinhToken((n) => Buffer.alloc(n - 1))).toThrow(RangeError);
    expect(() => sinhToken((n) => Buffer.alloc(n))).not.toThrow(); // đối chứng
  });
  it("`bamToken`: sha256 hex 64 ký tự, tất định, KHÔNG chứa token thô; token khác ⇒ hash khác", () => {
    const t = sinhToken();
    const h = bamToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(bamToken(t)).toBe(h);
    expect(h).not.toContain(t);
    expect(bamToken(sinhToken())).not.toBe(h);
  });
  it("`soKhopHash`: đúng ⇒ true; sai / sai định dạng / rỗng / hash lưu hỏng ⇒ false", () => {
    const t = sinhToken();
    const h = bamToken(t);
    expect(soKhopHash(h, t)).toBe(true); // đối chứng dương
    expect(soKhopHash(h, sinhToken())).toBe(false);
    expect(soKhopHash(h, `${t.slice(0, 42)}${t.endsWith("A") ? "B" : "A"}`)).toBe(false); // lệch đúng 1 ký tự cuối
    expect(soKhopHash(h, "")).toBe(false);
    expect(soKhopHash(h, "abc")).toBe(false);
    expect(soKhopHash(h, undefined)).toBe(false);
    expect(soKhopHash(h, 12345)).toBe(false);
    expect(soKhopHash("", t)).toBe(false);
    expect(soKhopHash("zz", t)).toBe(false);
    expect(soKhopHash(h.slice(0, 40), t)).toBe(false);
  });
  it("so khớp đi qua `timingSafeEqual` (thời gian hằng) — kể cả khi token sai định dạng (một lượt so giả, thời gian không lộ 'sai định dạng')", () => {
    const t = sinhToken();
    const h = bamToken(t);
    soKhopHash(h, t);
    expect(spy.timingSafeEqual).toHaveBeenCalledTimes(1);
    spy.timingSafeEqual.mockClear();
    soKhopHash(h, "khong-phai-token");
    expect(spy.timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(spy.timingSafeEqual.mock.calls[0]![0]).toHaveLength(32);
    expect(spy.timingSafeEqual.mock.calls[0]![1]).toHaveLength(32);
  });
  it("mã liên kết `<id>.<token>`: ghép rồi tách ra đúng; sai hình dạng ⇒ null", () => {
    const t = sinhToken();
    expect(tachMaLienKet(ghepMaLienKet("0b1c2d3e-aaaa-bbbb-cccc-1234567890ab", t))).toEqual({ id: "0b1c2d3e-aaaa-bbbb-cccc-1234567890ab", token: t });
    expect(tachMaLienKet(t)).toBeNull();
    expect(tachMaLienKet(`.${t}`)).toBeNull();
    expect(tachMaLienKet("abcdefghij.ngan")).toBeNull();
    expect(tachMaLienKet(null)).toBeNull();
    expect(tachMaLienKet(`ab.${t}`)).toBeNull(); // id quá ngắn
  });
});

describe("[YCM-02] hạn dùng: TTL là THAM SỐ BẮT BUỘC; mặc định 4 giờ chỉ là một hằng export", () => {
  it("`TTL_MAC_DINH_PHUT` = 240 và tính ra đúng +4 giờ; TTL khác ⇒ hạn khác", () => {
    expect(TTL_MAC_DINH_PHUT).toBe(240);
    expect(tinhHetHan(NOW, TTL_MAC_DINH_PHUT).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(tinhHetHan(NOW, 1).toISOString()).toBe("2026-11-02T03:01:00.000Z");
    expect(tinhHetHan(NOW, TTL_TOI_DA_PHUT).getTime() - NOW.getTime()).toBe(TTL_TOI_DA_PHUT * 60_000);
  });
  it("TTL không nguyên dương / quá trần ⇒ ném (nhập nhầm đơn vị không tạo ra liên kết sống hàng năm); biên hợp lệ không ném", () => {
    for (const x of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, TTL_TOI_DA_PHUT + 1, 3_600_000]) expect(() => tinhHetHan(NOW, x)).toThrow(RangeError);
    expect(() => tinhHetHan(NOW, 1)).not.toThrow();
    expect(() => tinhHetHan(NOW, TTL_TOI_DA_PHUT)).not.toThrow();
  });
  it("`daHetHan`: 1 ms trước hạn ⇒ còn; ĐÚNG hạn ⇒ hết; sau hạn ⇒ hết", () => {
    const han = phut(240);
    expect(daHetHan(han, new Date(han.getTime() - 1))).toBe(false);
    expect(daHetHan(han, han)).toBe(true);
    expect(daHetHan(han, new Date(han.getTime() + 1))).toBe(true);
  });
});

describe("[YCM-03] dữ liệu người mua: cá nhân BẮT BUỘC tên + CCCD ba/mẹ + địa chỉ; doanh nghiệp BẮT BUỘC tên + MST + email + địa chỉ; khối học viên + SĐT tuỳ chọn (chốt 02/11/2026)", () => {
  const caNhan = (o: Partial<Record<(typeof O_NGUOI_MUA)[number], string>> = {}): BangO =>
    Object.fromEntries(
      Object.entries({ loai: "CA_NHAN", ten: "Nguyễn Thị An", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "048123456789", ...o }).map(([k, v]) => [k, { giaTri: v, nguon: "PHU_HUYNH", luc: NOW.toISOString() }]),
    ) as BangO;
  const doanhNghiep = (o: Partial<Record<(typeof O_NGUOI_MUA)[number], string>> = {}): BangO => {
    const b = caNhan({ loai: "DOANH_NGHIEP", ten: "Công ty TNHH Thử Nghiệm", maSoThue: "0401234567", email: "ketoan@thunghiem.example.com", ...o });
    delete b.cccd; // doanh nghiệp không có CCCD ba/mẹ
    return b;
  };
  const NGUOI_MUA_RONG = { email: null, maSoThue: null, sdt: null, tenHocVien: null, ngaySinhHocVien: null, cccdHocVien: null };

  it("cá nhân đủ ô BẮT BUỘC ⇒ ok; ô tuỳ chọn trống ⇒ null; đúng các khoá, không thừa khoá nào", () => {
    const r = kiemBoDayDu(caNhan());
    expect(r).toEqual({ ok: true, nguoiMua: { loai: "CA_NHAN", ten: "Nguyễn Thị An", diaChi: "114 Hoàng Diệu, Đà Nẵng", cccd: "048123456789", ...NGUOI_MUA_RONG } });
    if (r.ok) expect(Object.keys(r.nguoiMua).sort()).toEqual(["cccd", "cccdHocVien", "diaChi", "email", "loai", "maSoThue", "ngaySinhHocVien", "sdt", "ten", "tenHocVien"]);
    expect(O_NGUOI_MUA).toEqual(["loai", "ten", "diaChi", "email", "maSoThue", "cccd", "sdt", "tenHocVien", "ngaySinhHocVien", "cccdHocVien"]);
  });
  it("cá nhân: THIẾU CCCD ⇒ `thieu: ['cccd']` (đối chứng ÂM của luật bắt buộc mới); CCCD sai định dạng ⇒ `sai` (không phải `thieu`)", () => {
    const b = caNhan();
    delete b.cccd;
    expect(kiemBoDayDu(b)).toEqual({ ok: false, thieu: ["cccd"], sai: [] });
    for (const x of ["12345", "04812345678", "0481234567890", "04812345678A"]) expect(kiemBoDayDu(caNhan({ cccd: x })), x).toEqual({ ok: false, thieu: [], sai: ["cccd"] });
    // chuẩn hoá: khoảng trắng / chấm / gạch bị bỏ; 9 chữ số (chứng minh thư cũ) vẫn được
    const ok = kiemBoDayDu(caNhan({ cccd: " 048 123.456-789 " }));
    expect(ok.ok && ok.nguoiMua.cccd).toBe("048123456789");
    expect(kiemBoDayDu(caNhan({ cccd: "123456789" })).ok).toBe(true);
  });
  it("khối học viên + SĐT: tuỳ chọn, có thì phải ĐÚNG định dạng; ngày sinh phải có thật trên lịch", () => {
    const r = kiemBoDayDu(caNhan({ sdt: "0905 123 456", tenHocVien: "Nguyễn Văn Bé", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" }));
    expect(r.ok && r.nguoiMua).toMatchObject({ sdt: "0905123456", tenHocVien: "Nguyễn Văn Bé", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" });
    expect(kiemBoDayDu(caNhan({ sdt: "12345" }))).toEqual({ ok: false, thieu: [], sai: ["sdt"] });
    expect(kiemBoDayDu(caNhan({ ngaySinhHocVien: "2016-02-30" }))).toEqual({ ok: false, thieu: [], sai: ["ngaySinhHocVien"] });
    expect(kiemBoDayDu(caNhan({ ngaySinhHocVien: "03/08/2016" }))).toEqual({ ok: false, thieu: [], sai: ["ngaySinhHocVien"] });
    expect(kiemBoDayDu(caNhan({ cccdHocVien: "abc" }))).toEqual({ ok: false, thieu: [], sai: ["cccdHocVien"] });
  });
  it("email hợp lệ được chuẩn hoá chữ thường; email sai ⇒ `sai` (không phải `thieu`)", () => {
    const ok = kiemBoDayDu(caNhan({ email: " An@Example.COM " }));
    expect(ok.ok && ok.nguoiMua.email).toBe("an@example.com");
    expect(kiemBoDayDu(caNhan({ email: "khong-phai-email" }))).toEqual({ ok: false, thieu: [], sai: ["email"] });
  });
  it("thiếu tên / địa chỉ ⇒ `thieu` đúng ô, theo thứ tự ô; ô quá ngắn ⇒ `sai`", () => {
    const b = caNhan();
    delete b.ten;
    delete b.diaChi;
    expect(kiemBoDayDu(b)).toEqual({ ok: false, thieu: ["ten", "diaChi"], sai: [] });
    expect(kiemBoDayDu(caNhan({ ten: "A" }))).toEqual({ ok: false, thieu: [], sai: ["ten"] });
  });
  it("thiếu loại ⇒ thieu ['loai']; loại lạ ⇒ sai ['loai']", () => {
    const b = caNhan();
    delete b.loai;
    expect(kiemBoDayDu(b)).toEqual({ ok: false, thieu: ["loai"], sai: [] });
    expect(kiemBoDayDu(caNhan({ loai: "TO_CHUC" }))).toEqual({ ok: false, thieu: [], sai: ["loai"] });
  });
  it("doanh nghiệp: MST + EMAIL BẮT BUỘC; MST 10 hoặc 13 chữ số (có gạch nối chuẩn hoá bỏ); 9/11/12/14 chữ số hoặc có chữ ⇒ sai", () => {
    expect(kiemBoDayDu(doanhNghiep()).ok).toBe(true); // đối chứng dương
    const khongMst = doanhNghiep();
    delete khongMst.maSoThue;
    expect(kiemBoDayDu(khongMst)).toEqual({ ok: false, thieu: ["maSoThue"], sai: [] });
    const khongEmail = doanhNghiep();
    delete khongEmail.email;
    expect(kiemBoDayDu(khongEmail)).toEqual({ ok: false, thieu: ["email"], sai: [] }); // đối chứng ÂM: trước 02/11 email doanh nghiệp là tuỳ chọn
    const m13 = kiemBoDayDu(doanhNghiep({ maSoThue: "0401234567-001" }));
    expect(m13.ok && m13.nguoiMua.maSoThue).toBe("0401234567001");
    for (const x of ["040123456", "04012345678", "040123456789", "04012345678901", "04012345A7"]) {
      expect(kiemBoDayDu(doanhNghiep({ maSoThue: x }))).toEqual({ ok: false, thieu: [], sai: ["maSoThue"] });
    }
  });
  it("loại quyết định ô nào có nghĩa: cá nhân mà có MST ⇒ bỏ MST; doanh nghiệp mà có CCCD / SĐT / học viên ⇒ BỎ (không lưu); schema trần thì STRICT", () => {
    const r = kiemBoDayDu(caNhan({ maSoThue: "0401234567" }));
    expect(r.ok && r.nguoiMua.maSoThue).toBeNull();
    const dn = kiemBoDayDu(doanhNghiep({ cccd: "048123456789", sdt: "0905123456", tenHocVien: "Bé", cccdHocVien: "048987654321" }));
    expect(dn.ok && dn.nguoiMua).toMatchObject({ cccd: null, sdt: null, tenHocVien: null, ngaySinhHocVien: null, cccdHocVien: null });
    const co = { loai: "CA_NHAN", ten: "Nguyễn Thị An", diaChi: "114 Hoàng Diệu", cccd: "048123456789" };
    expect(nguoiMuaToiGianSchema.safeParse({ ...co, maSoThue: "0401234567" }).success).toBe(false);
    expect(nguoiMuaToiGianSchema.safeParse({ loai: "DOANH_NGHIEP", ten: "Công ty ABC", diaChi: "114 Hoàng Diệu", maSoThue: "0401234567", email: "a@b.example.com" }).success).toBe(true);
    expect(nguoiMuaToiGianSchema.safeParse({ loai: "DOANH_NGHIEP", ten: "Công ty ABC", diaChi: "114 Hoàng Diệu", maSoThue: "0401234567", email: "a@b.example.com", cccd: "048123456789" }).success).toBe(false);
  });
  it("schema STRICT: khoá lạ bị từ chối — CHỈ CCCD (+ SĐT, học viên) có chỗ lưu; mọi tên giấy tờ KHÁC vẫn không", () => {
    const co = { loai: "CA_NHAN", ten: "Nguyễn Thị An", diaChi: "114 Hoàng Diệu", cccd: "048123456789" };
    expect(nguoiMuaToiGianSchema.safeParse(co).success).toBe(true); // đối chứng dương
    for (const k of ["soCccd", "canCuoc", "giayTo", "soGiayTo", "passport", "hoChieu"]) expect(nguoiMuaToiGianSchema.safeParse({ ...co, [k]: "012345678901" }).success, k).toBe(false);
  });
  it("[YCM-03b] ô nhạy cảm: đúng bốn ô, đều là ô CỦA CÁ NHÂN; doanh nghiệp không có ô nhạy cảm nào", () => {
    expect([...O_NHAY_CAM].sort()).toEqual(["cccd", "cccdHocVien", "ngaySinhHocVien", "sdt"]);
    for (const o of O_NHAY_CAM) expect(O_CHI_CA_NHAN, o).toContain(o);
  });
  it("`kiemODon`: chuẩn hoá khoảng trắng + NFC; ký tự điều khiển ⇒ sai; kiểu không phải chuỗi ⇒ sai", () => {
    expect(kiemODon("ten", "  Nguyễn   Thị  An ")).toEqual({ ok: true, giaTri: "Nguyễn Thị An" });
    expect(kiemODon("ten", "An\u0000Nguyen").ok).toBe(false);
    expect(kiemODon("diaChi", 12345).ok).toBe(false);
    expect(chuanHoaO("maSoThue", " 0401 234 567 ")).toBe("0401234567");
  });
});

describe("[YCM-04] hợp nhất Sale ↔ phụ huynh THEO Ô — tất định", () => {
  const T0 = new Date("2026-11-02T03:00:00.000Z");
  const T1 = new Date("2026-11-02T03:10:00.000Z");
  const T2 = new Date("2026-11-02T03:20:00.000Z");
  const ban = (): BangO => ({});

  it("Sale nhập TRƯỚC, PH gửi SAU ⇒ PH ghi đè ô PH điền; ô khác giá trị ghi nhận xung đột (PH thắng); ô Sale nhập mà PH không đụng thì giữ", () => {
    const s = hopNhatTheoO(ban(), { loai: "CA_NHAN", ten: "Nguyen An (sale)", diaChi: "Địa chỉ do sale nhập" }, "SALE_NHAP_THAY", T0);
    const p = hopNhatTheoO(s.ketQua, { ten: "Nguyễn Thị An", email: "an@example.com" }, "PHU_HUYNH", T1);
    expect(p.ketQua.ten).toEqual({ giaTri: "Nguyễn Thị An", nguon: "PHU_HUYNH", luc: T1.toISOString() });
    expect(p.ketQua.email).toEqual({ giaTri: "an@example.com", nguon: "PHU_HUYNH", luc: T1.toISOString() });
    expect(p.ketQua.diaChi).toEqual({ giaTri: "Địa chỉ do sale nhập", nguon: "SALE_NHAP_THAY", luc: T0.toISOString() });
    expect(p.ketQua.loai?.nguon).toBe("SALE_NHAP_THAY");
    expect(p.oXungDot).toEqual([{ o: "ten", thang: "PHU_HUYNH", thua: "SALE_NHAP_THAY" }]);
    expect(p.oDaDoi).toEqual(["ten", "email"]);
  });
  it("PH gửi TRƯỚC, Sale nhập thay SAU ⇒ Sale CHỈ ghi ô PH để trống; ô PH đã điền được GIỮ (kể cả khi Sale nhập khác — ghi nhận xung đột)", () => {
    const p = hopNhatTheoO(ban(), { loai: "CA_NHAN", ten: "Nguyễn Thị An" }, "PHU_HUYNH", T0);
    const s = hopNhatTheoO(p.ketQua, { ten: "Tên do sale gõ", diaChi: "114 Hoàng Diệu, Đà Nẵng", loai: "DOANH_NGHIEP" }, "SALE_NHAP_THAY", T1);
    expect(s.ketQua.ten).toEqual({ giaTri: "Nguyễn Thị An", nguon: "PHU_HUYNH", luc: T0.toISOString() }); // PH được giữ nguyên cả `luc`
    expect(s.ketQua.loai).toEqual({ giaTri: "CA_NHAN", nguon: "PHU_HUYNH", luc: T0.toISOString() });
    expect(s.ketQua.diaChi).toEqual({ giaTri: "114 Hoàng Diệu, Đà Nẵng", nguon: "SALE_NHAP_THAY", luc: T1.toISOString() }); // đối chứng dương: ô PH để trống thì Sale ghi được
    expect(s.oDaDoi).toEqual(["diaChi"]);
    expect(s.oXungDot).toEqual([
      { o: "loai", thang: "PHU_HUYNH", thua: "SALE_NHAP_THAY" },
      { o: "ten", thang: "PHU_HUYNH", thua: "SALE_NHAP_THAY" },
    ]);
  });
  it("Sale nhập giá trị TRÙNG ô PH đã điền ⇒ không đổi gì, không xung đột", () => {
    const p = hopNhatTheoO(ban(), { ten: "Nguyễn Thị An" }, "PHU_HUYNH", T0);
    const s = hopNhatTheoO(p.ketQua, { ten: "  Nguyễn  Thị An " }, "SALE_NHAP_THAY", T1);
    expect(s.oXungDot).toEqual([]);
    expect(s.oDaDoi).toEqual([]);
    expect(s.ketQua).toEqual(p.ketQua);
  });
  it("Sale ghi đè ô do CHÍNH Sale nhập trước đó ⇒ được (không phải xung đột)", () => {
    const a = hopNhatTheoO(ban(), { ten: "Tên gõ nhầm" }, "SALE_NHAP_THAY", T0);
    const b = hopNhatTheoO(a.ketQua, { ten: "Tên đã sửa" }, "SALE_NHAP_THAY", T1);
    expect(b.ketQua.ten).toEqual({ giaTri: "Tên đã sửa", nguon: "SALE_NHAP_THAY", luc: T1.toISOString() });
    expect(b.oXungDot).toEqual([]);
  });
  it("PH gửi đúng giá trị Sale đã nhập ⇒ ô chuyển sang nguồn PH (đã xác nhận ⇒ Sale không ghi đè được nữa); không phải xung đột", () => {
    const a = hopNhatTheoO(ban(), { ten: "Nguyễn Thị An" }, "SALE_NHAP_THAY", T0);
    const p = hopNhatTheoO(a.ketQua, { ten: "Nguyễn Thị An" }, "PHU_HUYNH", T1);
    expect(p.ketQua.ten?.nguon).toBe("PHU_HUYNH");
    expect(p.oXungDot).toEqual([]);
    expect(p.oDaDoi).toEqual(["ten"]);
    const s = hopNhatTheoO(p.ketQua, { ten: "Khác" }, "SALE_NHAP_THAY", T2);
    expect(s.ketQua.ten?.giaTri).toBe("Nguyễn Thị An");
  });
  it("ô RỖNG trong đầu vào = 'không cung cấp': không xoá, không ghi, không xung đột (đối chứng: ô có giá trị thì ghi)", () => {
    const a = hopNhatTheoO(ban(), { ten: "Nguyễn Thị An", diaChi: "114 Hoàng Diệu" }, "SALE_NHAP_THAY", T0);
    const p = hopNhatTheoO(a.ketQua, { ten: "   ", diaChi: "", email: null, maSoThue: undefined }, "PHU_HUYNH", T1);
    expect(p.ketQua).toEqual(a.ketQua);
    expect(p.oDaDoi).toEqual([]);
    expect(hopNhatTheoO(a.ketQua, { ten: "Tên mới" }, "PHU_HUYNH", T1).ketQua.ten?.giaTri).toBe("Tên mới");
  });
  it("cùng nguồn gửi lại giá trị cũ ⇒ không đổi, `luc` giữ nguyên", () => {
    const a = hopNhatTheoO(ban(), { ten: "Nguyễn Thị An" }, "PHU_HUYNH", T0);
    const b = hopNhatTheoO(a.ketQua, { ten: "Nguyễn Thị An" }, "PHU_HUYNH", T1);
    expect(b.ketQua.ten?.luc).toBe(T0.toISOString());
    expect(b.oDaDoi).toEqual([]);
  });
  it("HAI THỨ TỰ cho ra kết quả khớp quy tắc: ô tranh chấp PH luôn thắng ở cả hai thứ tự; ô rời nhau thì hợp lại đủ ở cả hai", () => {
    const sale = { ten: "Sale gõ", diaChi: "Sale gõ địa chỉ" };
    const ph = { ten: "PH điền", email: "ph@example.com" };
    const thuTu1 = hopNhatTheoO(hopNhatTheoO(ban(), sale, "SALE_NHAP_THAY", T0).ketQua, ph, "PHU_HUYNH", T1).ketQua;
    const thuTu2 = hopNhatTheoO(hopNhatTheoO(ban(), ph, "PHU_HUYNH", T0).ketQua, sale, "SALE_NHAP_THAY", T1).ketQua;
    for (const k of [thuTu1, thuTu2]) {
      expect(k.ten?.giaTri).toBe("PH điền");
      expect(k.ten?.nguon).toBe("PHU_HUYNH");
      expect(k.diaChi?.giaTri).toBe("Sale gõ địa chỉ");
      expect(k.email?.giaTri).toBe("ph@example.com");
    }
  });
  it("tất định + không đột biến đầu vào: cùng đầu vào ⇒ cùng kết quả; `hienTai` đóng băng sâu vẫn chạy được; thứ tự `oXungDot` theo thứ tự ô", () => {
    const goc = Object.freeze({ ten: Object.freeze({ giaTri: "A An", nguon: "SALE_NHAP_THAY" as const, luc: T0.toISOString() }), diaChi: Object.freeze({ giaTri: "Địa chỉ cũ", nguon: "SALE_NHAP_THAY" as const, luc: T0.toISOString() }) }) as BangO;
    const moi = { diaChi: "Địa chỉ mới của PH", ten: "Tên mới của PH" };
    const r1 = hopNhatTheoO(goc, moi, "PHU_HUYNH", T1);
    const r2 = hopNhatTheoO(goc, moi, "PHU_HUYNH", T1);
    expect(r1).toEqual(r2);
    expect(r1.oXungDot.map((x) => x.o)).toEqual(["ten", "diaChi"]);
    expect(goc.ten?.giaTri).toBe("A An");
  });
  it("dạng lưu: dựng rồi đọc lại khớp; JSON hỏng / null / lạ ⇒ bảng rỗng, không ném", () => {
    const b = hopNhatTheoO(ban(), { ten: "Nguyễn Thị An" }, "PHU_HUYNH", T0).ketQua;
    expect(docDuLieuLuu(JSON.parse(JSON.stringify(dungDuLieuLuu(b))))).toEqual(b);
    for (const x of [null, undefined, "x", 3, [], { phienBan: 2, o: {} }, { phienBan: 1, o: { ten: { giaTri: 1 } } }, { phienBan: 1, o: { hoChieu: { giaTri: "x", nguon: "PHU_HUYNH", luc: "t" } } }]) {
      expect(docDuLieuLuu(x)).toEqual({});
    }
  });
});

describe("[YCM-05] chống đoán: khoá cứng sau N lần sai; số lần mở; không kéo dài khoá", () => {
  it("dưới ngưỡng: đếm +1, KHÔNG khoá (đối chứng); đúng ngưỡng: khoá tới now + khoaPhut", () => {
    expect(sauTokenSai({ soLanSai: 0, khoaDen: null }, NOW, G)).toEqual({ tang: true, soLanSaiMoi: 1, khoaDenMoi: null });
    expect(sauTokenSai({ soLanSai: 3, khoaDen: null }, NOW, G)).toEqual({ tang: true, soLanSaiMoi: 4, khoaDenMoi: null }); // lần thứ 4 < 5
    const dung = sauTokenSai({ soLanSai: 4, khoaDen: null }, NOW, G); // lần thứ 5 = ngưỡng
    expect(dung.soLanSaiMoi).toBe(5);
    expect(dung.khoaDenMoi?.toISOString()).toBe(phut(30).toISOString());
  });
  it("đang khoá: KHÔNG đếm thêm và KHÔNG gia hạn khoá; khoá hết hạn đúng giây `khoaDen` ⇒ đếm lại (và vì bộ đếm còn ≥ ngưỡng nên khoá lại ngay)", () => {
    const dangKhoa = sauTokenSai({ soLanSai: 5, khoaDen: phut(10) }, NOW, G);
    expect(dangKhoa).toEqual({ tang: false, soLanSaiMoi: 5, khoaDenMoi: phut(10) });
    const hetKhoa = sauTokenSai({ soLanSai: 5, khoaDen: NOW }, NOW, G);
    expect(hetKhoa.tang).toBe(true);
    expect(hetKhoa.khoaDenMoi?.toISOString()).toBe(phut(30).toISOString());
  });
  it("`quyetDinhMo`: thứ tự đóng → hết hạn → khoá → vượt số lần mở; còn lại CHO_MO", () => {
    const mo = { trangThai: "DANG_MO", hetHanLuc: phut(240), khoaDen: null as Date | null, soLanMo: 0 };
    expect(quyetDinhMo(mo, NOW, G, "MO")).toBe("CHO_MO"); // đối chứng dương
    expect(quyetDinhMo({ ...mo, trangThai: "DA_AP_DUNG" }, NOW, G, "MO")).toBe("DA_DONG");
    expect(quyetDinhMo({ ...mo, trangThai: "THU_HOI" }, NOW, G, "GUI")).toBe("DA_DONG");
    expect(quyetDinhMo({ ...mo, hetHanLuc: NOW }, NOW, G, "MO")).toBe("HET_HAN");
    expect(quyetDinhMo({ ...mo, hetHanLuc: new Date(NOW.getTime() + 1) }, NOW, G, "MO")).toBe("CHO_MO");
    expect(quyetDinhMo({ ...mo, khoaDen: phut(1) }, NOW, G, "MO")).toBe("KHOA");
    expect(quyetDinhMo({ ...mo, khoaDen: NOW }, NOW, G, "MO")).toBe("CHO_MO"); // khoá hết đúng giây
    expect(quyetDinhMo({ ...mo, trangThai: "HET_HAN", hetHanLuc: NOW, khoaDen: phut(1) }, NOW, G, "MO")).toBe("DA_DONG"); // đã đóng thắng mọi cổng khác
    expect(quyetDinhMo({ ...mo, hetHanLuc: NOW, khoaDen: phut(1) }, NOW, G, "MO")).toBe("HET_HAN"); // hết hạn thắng khoá
  });
  it("số lần mở: M-1 vẫn mở được, đúng M thì chặn; GỬI không tính vào số lần mở", () => {
    const mo = { trangThai: "DANG_MO", hetHanLuc: phut(240), khoaDen: null as Date | null, soLanMo: 9 };
    expect(quyetDinhMo(mo, NOW, G, "MO")).toBe("CHO_MO");
    expect(quyetDinhMo({ ...mo, soLanMo: 10 }, NOW, G, "MO")).toBe("VUOT_SO_LAN_MO");
    expect(quyetDinhMo({ ...mo, soLanMo: 10 }, NOW, G, "GUI")).toBe("CHO_MO");
  });
  it("giới hạn cấu hình hỏng (0, âm, lẻ, NaN) ⇒ ném, không trở thành 'không bao giờ khoá'", () => {
    for (const k of ["toiDaSaiToken", "toiDaLanMo", "khoaPhut"] as const) {
      for (const x of [0, -1, 2.5, Number.NaN]) {
        expect(() => kiemGioiHan({ ...G, [k]: x })).toThrow(RangeError);
        expect(() => sauTokenSai({ soLanSai: 0, khoaDen: null }, NOW, { ...G, [k]: x })).toThrow(RangeError);
      }
    }
    expect(() => kiemGioiHan(G)).not.toThrow();
  });
});

describe("[YCM-06] quyền xử lý yêu cầu: kế toán (payments:confirm) HOẶC sale (payments:record ∧ orders:view-pii) TẠI cơ sở — không so vai", () => {
  const actor = (perms: { action: string; centerScope: "ALL" | string[] }[], o: Partial<ActionScopeActor> = {}): ActionScopeActor =>
    ({ isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: perms.map((p) => ({ ...p, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X" })), ...o }) as unknown as ActionScopeActor;

  it("kế toán CS1: CS1 được, CS2 không", () => {
    const a = actor([{ action: "payments:confirm", centerScope: ["cs1"] }]);
    expect(duocXuLyYeuCau(a, "cs1")).toBe(true);
    expect(duocXuLyYeuCau(a, "cs2")).toBe(false);
    expect(phamViXuLyYeuCau(a)).toEqual(["cs1"]);
  });
  it("sale CS1 cần CẢ HAI quyền: đủ hai ⇒ được; chỉ một trong hai ⇒ không", () => {
    const du = actor([{ action: "payments:record", centerScope: ["cs1"] }, { action: "orders:view-pii", centerScope: ["cs1"] }]);
    expect(duocXuLyYeuCau(du, "cs1")).toBe(true);
    expect(duocXuLyYeuCau(du, "cs2")).toBe(false);
    expect(duocXuLyYeuCau(actor([{ action: "payments:record", centerScope: ["cs1"] }]), "cs1")).toBe(false);
    expect(duocXuLyYeuCau(actor([{ action: "orders:view-pii", centerScope: ["cs1"] }]), "cs1")).toBe(false);
  });
  it("hai quyền của sale phủ HAI cơ sở khác nhau ⇒ giao rỗng ⇒ không được ở đâu", () => {
    const a = actor([{ action: "payments:record", centerScope: ["cs1"] }, { action: "orders:view-pii", centerScope: ["cs2"] }]);
    expect(phamViXuLyYeuCau(a)).toEqual([]);
    expect(duocXuLyYeuCau(a, "cs1")).toBe(false);
    expect(duocXuLyYeuCau(a, "cs2")).toBe(false);
  });
  it("HO (ALL) mọi cơ sở; super admin ALL; giữ nguyên fail-closed: không quyền ⇒ [], centerId null ⇒ false", () => {
    expect(duocXuLyYeuCau(actor([{ action: "payments:confirm", centerScope: "ALL" }]), "cs9")).toBe(true);
    expect(duocXuLyYeuCau(actor([{ action: "payments:record", centerScope: "ALL" }, { action: "orders:view-pii", centerScope: ["cs1"] }]), "cs1")).toBe(true);
    expect(duocXuLyYeuCau(actor([{ action: "payments:record", centerScope: "ALL" }, { action: "orders:view-pii", centerScope: ["cs1"] }]), "cs2")).toBe(false);
    expect(duocXuLyYeuCau(actor([], { isSuperAdmin: true }), "cs1")).toBe(true);
    expect(phamViXuLyYeuCau(actor([]))).toEqual([]);
    expect(duocXuLyYeuCau(actor([{ action: "payments:confirm", centerScope: "ALL" }]), null)).toBe(false);
    expect(duocXuLyYeuCau(actor([{ action: "classes:view", centerScope: "ALL" }]), "cs1")).toBe(false); // quyền không liên quan
  });
});

describe("[YCM-07] dấu vân tay giá trị gốc: băm từng cột, muối theo id yêu cầu; trống ⇒ null; không chứa giá trị thô", () => {
  const don = { invoiceBuyerName: "Nguyễn Thị An", invoiceCompanyName: null, invoiceTaxCode: "0401234567", invoiceEmail: "An@Example.com", customerCccd: "048123456789", invoiceParentPhone: null, invoiceStudentName: null, invoiceStudentCccd: null };
  it("[YCM-07b] NỘI DUNG COT_GOC được ghim: đúng tám cột — gỡ một cột là áp dụng ghi đè im lặng giá trị kế toán đã khai (ca trên so COT_GOC với CHÍNH NÓ nên không canh được việc này)", () => {
    expect([...COT_GOC]).toEqual(["invoiceBuyerName", "invoiceCompanyName", "invoiceTaxCode", "invoiceEmail", "customerCccd", "invoiceParentPhone", "invoiceStudentName", "invoiceStudentCccd"]);
  });
  it("khoá đúng MỌI cột gốc (COT_GOC — gồm CCCD · SĐT · học viên từ 02/11/2026); cột trống/không có ⇒ null; cột có ⇒ hex 64", () => {
    const h = giaTriGocHash("req-1", don);
    expect(Object.keys(h).sort()).toEqual([...COT_GOC].sort());
    expect(h.invoiceCompanyName).toBeNull();
    expect(h.invoiceTaxCode).toMatch(/^[0-9a-f]{64}$/);
    expect(giaTriGocHash("req-1", { ...don, invoiceBuyerName: "   " }).invoiceBuyerName).toBeNull();
    expect(giaTriGocHash("req-1", { ...don, invoiceBuyerName: undefined }).invoiceBuyerName).toBeNull();
  });
  it("tất định; hoa/thường + khoảng trắng không đổi dấu; id yêu cầu khác ⇒ dấu khác (muối); giá trị khác ⇒ dấu khác", () => {
    const h = giaTriGocHash("req-1", don);
    expect(giaTriGocHash("req-1", { ...don, invoiceEmail: " an@example.COM " }).invoiceEmail).toBe(h.invoiceEmail);
    expect(giaTriGocHash("req-2", don).invoiceEmail).not.toBe(h.invoiceEmail);
    expect(giaTriGocHash("req-1", { ...don, invoiceTaxCode: "0401234568" }).invoiceTaxCode).not.toBe(h.invoiceTaxCode);
  });
  it("kết quả không chứa giá trị thô của đơn", () => {
    const s = JSON.stringify(giaTriGocHash("req-1", don)).toLowerCase();
    for (const v of ["nguyễn", "0401234567", "example.com", "048123456789"]) expect(s).not.toContain(v.toLowerCase());
  });
});
