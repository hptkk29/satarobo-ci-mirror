// @vitest-environment node
//
// Ca [CTA-*] — SERVER ACTION chứng từ ngân hàng (P7-E): CỔNG của action (cờ → đăng nhập → quyền → phạm vi cơ sở → trạng thái) và việc nó
// KHÔNG tin client (khoá tệp, loại tệp). Luật trạng thái ở test thuần, ghi DB ở `tests/finance/chung-tu-ngan-hang.test.ts`; tầng DB ở đây giả lập.
//
// Ca kiêm nhiệm là ca đáng giá nhất: người vừa là kế toán CS2 vừa có quyền khác ở CS1 qua được `payments:confirm` trần và THẤY hồ sơ CS1
// (scopedDb là phép HỢP), nhưng KHÔNG được thao tác trên hồ sơ CS1.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(),
  checkPermission: vi.fn(async (_khoa?: string) => true),
  resolveActor: vi.fn(),
  hoSoFind: vi.fn(),
  centerFind: vi.fn(),
  rateLimit: vi.fn(async (_a: { key: string }) => ({ success: true, remaining: 59, resetAt: 0 })),
  khoOk: vi.fn(() => true),
  kyPut: vi.fn(async (khoa: string, loai: string, ttl: number) => `https://r2.test/${khoa}?loai=${loai}&ttl=${ttl}`),
  xacMinh: vi.fn(),
  xoaTep: vi.fn(async () => undefined),
  ghiTep: vi.fn(async (_a: unknown) => ({ id: "hs1", trangThai: "DA_TAI_LEN" })),
  danhDau: vi.fn(async () => ({ id: "hs1" })),
  kiemTra: vi.fn(async () => ({ id: "hs1" })),
  boSungLai: vi.fn(async () => ({ id: "hs1" })),
  huy: vi.fn(async () => ({ id: "hs1" })),
  tim: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ chungTuNganHang: { findUnique: h.hoSoFind }, center: { findUnique: h.centerFind } }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: h.khoOk, xoaTepHoaDon: h.xoaTep }));
vi.mock("@/lib/finance/hoa-don/kho-chung-tu", () => ({ kyUrlTaiLenChungTu: h.kyPut, xacMinhTepChungTu: h.xacMinh }));
vi.mock("@/lib/finance/hoa-don/chung-tu-ngan-hang-db", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/chung-tu-ngan-hang-db")>()),
  danhDauCanChungTu: h.danhDau,
  ghiTepChungTu: h.ghiTep,
  danhDauDaKiemTra: h.kiemTra,
  yeuCauBoSungLai: h.boSungLai,
  huyDanhDau: h.huy,
  timKhoanTheoMaDon: h.tim,
}));

import {
  danhDauCanChungTuAction,
  ghiChungTuDaTaiAction,
  huyDanhDauChungTuAction,
  kiemTraChungTuAction,
  kyTaiLenChungTuAction,
  timKhoanTheoMaDonAction,
  yeuCauBoSungLaiChungTuAction,
} from "./_actions";
import { LoiChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";
import { khoaChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang";

const perm = (action: string, centerScope: "ALL" | string[]) => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const KE_TOAN_CS1 = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs1"])] };
const KIEM_NHIEM = { isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm("payments:confirm", ["cs2"]), perm("payments:record", ["cs1"])] };

const HO_SO = { id: "hs1", centerId: "cs1", trangThai: "CHO_BO_SUNG", tepKhoa: null as string | null };
const PID = "cmpay0000000001";
const khoaDung = (loai: "pdf" | "png" | "jpg" = "pdf") => khoaChungTu({ centerCode: "CS1", paymentId: PID, loai, nam: 2026, uuid: "11111111-2222-3333-4444-555555555555" });

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(KE_TOAN_CS1);
  h.hoSoFind.mockResolvedValue({ ...HO_SO });
  h.centerFind.mockResolvedValue({ code: "CS1" });
  h.khoOk.mockReturnValue(true);
  h.rateLimit.mockResolvedValue({ success: true, remaining: 59, resetAt: 0 });
  h.xacMinh.mockResolvedValue({ ok: true, co: 2048, sha256: "a".repeat(64) });
});

describe("[CTA-01] cổng chung: cờ → đăng nhập → quyền → phạm vi; mọi nhánh từ chối KHÔNG chạm tầng ghi", () => {
  const goi: [string, () => Promise<{ ok: boolean }>][] = [
    ["danh dấu", () => danhDauCanChungTuAction({ paymentId: PID, lyDo: "Cần sao kê MB ngày 04/10" })],
    ["huỷ đánh dấu", () => huyDanhDauChungTuAction({ paymentId: PID, lyDo: "Đánh dấu nhầm khoản" })],
    ["kiểm tra", () => kiemTraChungTuAction({ paymentId: PID })],
    ["bổ sung lại", () => yeuCauBoSungLaiChungTuAction({ paymentId: PID, lyDo: "Ảnh bị cắt mất số tài khoản" })],
    ["ký tải lên", () => kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" })],
    ["ghi tệp", () => ghiChungTuDaTaiAction({ paymentId: PID, loai: "pdf", khoa: khoaDung(), ten: "a.pdf" })],
    ["tìm khoản", () => timKhoanTheoMaDonAction({ coSoId: "cs1", maDon: "ORD-261004-000007" })],
  ];
  const chamGhi = () => [h.danhDau, h.kiemTra, h.boSungLai, h.huy, h.ghiTep, h.kyPut, h.tim].reduce((n, f) => n + f.mock.calls.length, 0);

  it("đối chứng DƯƠNG: kế toán đúng cơ sở, cờ bật ⇒ cả bảy action qua cổng", async () => {
    for (const [ten, f] of goi) expect((await f()).ok, ten).toBe(true);
    expect(chamGhi()).toBeGreaterThanOrEqual(7);
  });

  it("cờ màn hoá đơn TẮT ⇒ từ chối, không chạm gì", async () => {
    h.bat.mockResolvedValue(false);
    for (const [ten, f] of goi) expect((await f()).ok, ten).toBe(false);
    expect(chamGhi()).toBe(0);
    expect(h.auth).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ từ chối", async () => {
    h.auth.mockResolvedValue(null);
    for (const [ten, f] of goi) expect((await f()).ok, ten).toBe(false);
    expect(chamGhi()).toBe(0);
  });

  it("thiếu `payments:confirm` ⇒ từ chối, và đã hỏi ĐÚNG quyền đó", async () => {
    h.checkPermission.mockResolvedValue(false);
    for (const [ten, f] of goi) expect((await f()).ok, ten).toBe(false);
    expect(chamGhi()).toBe(0);
    expect(h.checkPermission.mock.calls.every((c) => c[0] === "payments:confirm")).toBe(true);
  });

  it("KIÊM NHIỆM: kế toán CS2 + quyền khác ở CS1 THẤY hồ sơ CS1 nhưng KHÔNG ký được URL tải lên cho nó (phạm vi theo quyền `payments:confirm`)", async () => {
    h.resolveActor.mockResolvedValue(KIEM_NHIEM);
    const kq = await kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" });
    expect(kq).toEqual({ ok: false, error: "Không tìm thấy hồ sơ chứng từ" });
    expect(h.kyPut).not.toHaveBeenCalled();
    const ghi = await ghiChungTuDaTaiAction({ paymentId: PID, loai: "pdf", khoa: khoaDung(), ten: "a.pdf" });
    expect(ghi.ok).toBe(false);
    expect(h.xacMinh).not.toHaveBeenCalled();
    expect(h.ghiTep).not.toHaveBeenCalled();
  });

  it("hồ sơ không tồn tại / ngoài tầm nhìn ⇒ cùng một câu «không tìm thấy», không phân biệt", async () => {
    h.hoSoFind.mockResolvedValue(null);
    expect(await kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" })).toEqual({ ok: false, error: "Không tìm thấy hồ sơ chứng từ" });
  });

  it("đầu vào sai hình dạng ⇒ «Yêu cầu không hợp lệ», không chạm quyền", async () => {
    expect(await danhDauCanChungTuAction({ paymentId: "", lyDo: "x" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(await kyTaiLenChungTuAction({ paymentId: PID, loai: "xml" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(await kyTaiLenChungTuAction({ paymentId: PID, loai: "exe" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(h.checkPermission).not.toHaveBeenCalled();
  });
});

describe("[CTA-02] ký URL tải lên: nút không được hứa suông — trạng thái không cho tải thì KHÔNG ký", () => {
  it("CHO_BO_SUNG / DA_TAI_LEN / CAN_BO_SUNG_LAI ⇒ ký, khoá nằm dưới ĐÚNG mã cơ sở + khoản, đuôi khớp loại, mime khớp", async () => {
    for (const t of ["CHO_BO_SUNG", "DA_TAI_LEN", "CAN_BO_SUNG_LAI"]) {
      h.hoSoFind.mockResolvedValue({ ...HO_SO, trangThai: t });
      const kq = await kyTaiLenChungTuAction({ paymentId: PID, loai: "png" });
      expect(kq.ok, t).toBe(true);
      if (kq.ok) {
        expect(kq.data.khoa).toMatch(new RegExp(`^chung-tu-ngan-hang/CS1/\\d{4}/${PID}/[0-9a-f-]{36}\\.png$`));
        expect(kq.data.contentType).toBe("image/png");
        expect(kq.data.tranCo).toBe(10 * 1024 * 1024);
      }
    }
  });

  it("DA_KIEM_TRA ⇒ từ chối SỚM với câu nói rõ cách đi tiếp; không ký", async () => {
    h.hoSoFind.mockResolvedValue({ ...HO_SO, trangThai: "DA_KIEM_TRA", tepKhoa: khoaDung() });
    const kq = await kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" });
    expect(kq).toEqual({ ok: false, error: expect.stringMatching(/yêu cầu bổ sung lại/) });
    expect(h.kyPut).not.toHaveBeenCalled();
  });

  it("kho chưa cấu hình ⇒ từ chối, không ký; rate limit ⇒ từ chối", async () => {
    h.khoOk.mockReturnValue(false);
    expect((await kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" })).ok).toBe(false);
    h.khoOk.mockReturnValue(true);
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    expect((await kyTaiLenChungTuAction({ paymentId: PID, loai: "pdf" })).ok).toBe(false);
    expect(h.kyPut).not.toHaveBeenCalled();
  });
});

describe("[CTA-03] ghi tệp đã tải: KHÔNG tin khoá từ client", () => {
  const ghi = (khoa: string, loai: "pdf" | "png" | "jpg" = "pdf", ten = "sao-ke.pdf") => ghiChungTuDaTaiAction({ paymentId: PID, loai, khoa, ten });

  it("đối chứng DƯƠNG: khoá đúng khoản/cơ sở/đuôi, byte hợp lệ ⇒ xác minh rồi ghi, truyền tệp ĐÃ XÁC MINH (cỡ + sha256 do server đo)", async () => {
    const kq = await ghi(khoaDung());
    expect(kq.ok).toBe(true);
    expect(h.ghiTep).toHaveBeenCalledTimes(1);
    const arg = h.ghiTep.mock.calls[0]![0] as { tep: { khoa: string; co: number; sha256: string; loai: string; ten: string }; paymentId: string };
    expect(arg.tep).toMatchObject({ khoa: khoaDung(), co: 2048, sha256: "a".repeat(64), loai: "pdf", ten: "sao-ke.pdf" });
    expect(arg.paymentId).toBe(PID);
  });

  it("khoá của khoản KHÁC / cơ sở KHÁC / luồng hoá đơn / thoát thư mục / sai đuôi ⇒ từ chối, KHÔNG xác minh, KHÔNG ghi", async () => {
    const khoanKhac = khoaChungTu({ centerCode: "CS1", paymentId: "cmpay0000000002", loai: "pdf", nam: 2026, uuid: "u1" });
    const coSoKhac = khoaChungTu({ centerCode: "CS2", paymentId: PID, loai: "pdf", nam: 2026, uuid: "u2" });
    for (const k of [khoanKhac, coSoKhac, `hoa-don/CS1/2026/${PID}/u.pdf`, `chung-tu-ngan-hang/CS1/2026/${PID}/../x.pdf`, khoaDung("png")]) {
      expect((await ghi(k)).ok, k).toBe(false);
    }
    expect(h.xacMinh).not.toHaveBeenCalled();
    expect(h.ghiTep).not.toHaveBeenCalled();
  });

  it("không «tải» lại chính tệp hồ sơ đang giữ như tệp mới (khoá trùng khoá hiện tại)", async () => {
    h.hoSoFind.mockResolvedValue({ ...HO_SO, trangThai: "DA_TAI_LEN", tepKhoa: khoaDung() });
    expect((await ghi(khoaDung())).ok).toBe(false);
    expect(h.ghiTep).not.toHaveBeenCalled();
  });

  it("byte sai (xác minh từ chối) ⇒ từ chối, KHÔNG ghi hồ sơ", async () => {
    h.xacMinh.mockResolvedValue({ ok: false, ma: "SAI_LOAI", thongDiep: "Tệp không phải PDF hợp lệ" });
    expect(await ghi(khoaDung())).toEqual({ ok: false, error: "Tệp không phải PDF hợp lệ" });
    expect(h.ghiTep).not.toHaveBeenCalled();
  });

  it("trạng thái không cho tải (đã kiểm tra) ⇒ từ chối VÀ dọn đúng khoá vừa tải, không đụng tệp khác", async () => {
    h.hoSoFind.mockResolvedValue({ ...HO_SO, trangThai: "DA_KIEM_TRA", tepKhoa: "chung-tu-ngan-hang/CS1/2026/x/cu.pdf" });
    expect((await ghi(khoaDung())).ok).toBe(false);
    expect(h.xoaTep).toHaveBeenCalledWith(khoaDung());
    expect(h.ghiTep).not.toHaveBeenCalled();
  });

  it("ghi DB ném lỗi nghiệp vụ (hồ sơ vừa đổi) ⇒ trả câu cho người dùng VÀ dọn khoá vừa tải; lỗi lạ ném tiếp", async () => {
    h.ghiTep.mockRejectedValueOnce(new LoiChungTu("DA_DOI", "Hồ sơ vừa được người khác thay đổi — tải lại trang rồi thao tác lại"));
    expect(await ghi(khoaDung())).toEqual({ ok: false, error: expect.stringMatching(/vừa được người khác thay đổi/) });
    expect(h.xoaTep).toHaveBeenCalledWith(khoaDung());
    h.ghiTep.mockRejectedValueOnce(new Error("kết nối DB đứt"));
    await expect(ghi(khoaDung())).rejects.toThrow("kết nối DB đứt");
  });

  it("tên tệp khai từ client được làm sạch trước khi lưu", async () => {
    await ghi(khoaDung(), "pdf", "C:\\fakepath\\Sao kê MB.pdf");
    const arg = h.ghiTep.mock.calls[0]![0] as { tep: { ten: string } };
    expect(arg.tep.ten).toBe("Sao kê MB.pdf");
  });
});

describe("[CTA-04] thao tác khác chuyển đúng tham số cho tầng ghi; lỗi nghiệp vụ thành câu, thành công thì làm mới màn", () => {
  it("đánh dấu: truyền paymentId + lý do + người làm; làm mới màn chứng từ", async () => {
    expect((await danhDauCanChungTuAction({ paymentId: PID, lyDo: "Cần sao kê MB ngày 04/10" })).ok).toBe(true);
    expect(h.danhDau).toHaveBeenCalledWith(expect.objectContaining({ paymentId: PID, lyDo: "Cần sao kê MB ngày 04/10", nguoi: { id: "u1", ten: "Kế toán" } }));
    expect(h.revalidatePath).toHaveBeenCalledWith("/payments/hoa-don/chung-tu-ngan-hang");
  });

  it("lỗi nghiệp vụ ⇒ {ok:false, error}, KHÔNG làm mới; lỗi lạ ném tiếp", async () => {
    h.kiemTra.mockRejectedValueOnce(new LoiChungTu("SAI_TRANG_THAI", "Chưa có tệp chứng từ để kiểm tra"));
    expect(await kiemTraChungTuAction({ paymentId: PID })).toEqual({ ok: false, error: "Chưa có tệp chứng từ để kiểm tra" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
    h.boSungLai.mockRejectedValueOnce(new Error("boom"));
    await expect(yeuCauBoSungLaiChungTuAction({ paymentId: PID, lyDo: "Ảnh bị cắt mất số tài khoản" })).rejects.toThrow("boom");
  });

  it("lý do quá dài (> 300) bị chặn ở lớp kiểm đầu vào", async () => {
    expect((await huyDanhDauChungTuAction({ paymentId: PID, lyDo: "x".repeat(301) })).ok).toBe(false);
    expect(h.huy).not.toHaveBeenCalled();
  });
});
