// @vitest-environment node
//
// Ca [PHM-A*] — CỔNG của bốn action "Phát hành qua MISA" (bước 1, 30/09/2026). Máy trạng thái chạm DB được
// giả ở đây (canh riêng ở `tests/finance/hoa-don-phat-hanh-misa.test.ts`); thứ đo là: action TỰ gác lại mọi
// thứ giao diện đã gác (cờ màn, quyền, phạm vi, công tắc MISA, cổng MISA, nút trên dòng loader dựng lại) và
// lấy cổng ĐÚNG qua `layCongHoaDon()`. Mỗi ca từ chối có đối chứng dương cùng fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

const CONG = { cheDo: "HSM", moiTruong: "sandbox" } as const;
const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  misaBat: vi.fn(async () => true),
  cong: vi.fn((): unknown => ({ cheDo: "HSM", moiTruong: "sandbox" })),
  auth: vi.fn(async () => ({ user: { id: "u-kt", name: "Kế toán" } }) as unknown),
  checkPermission: vi.fn(async () => true),
  resolveActor: vi.fn(),
  findUnique: vi.fn(async () => ({ id: "don-a", centerId: "cs1", orgUnitId: null, center: { code: "CS1" } }) as unknown),
  nap: vi.fn(),
  trang: vi.fn(async () => ({ ok: true, phapNhan: {}, trang: [], khoiDon: {}, phuongThuc: [] }) as unknown),
  batDau: vi.fn(async (_i: unknown) => ({ hoaDonId: "hd-moi", refId: "ref-1" })),
  gui: vi.fn(async (_i: unknown) => ({ trangThai: "DA_XAC_NHAN", ketQua: null }) as unknown),
  kiem: vi.fn(async (_i: unknown) => ({ trangThai: "DANG_PHAT_HANH", thongDiep: "chờ" }) as unknown),
  lai: vi.fn(async () => ({ refId: "ref-2" })),
  bo: vi.fn(async () => undefined),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 29, resetAt: 0 })),
  khoOk: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: <T,>(f: T) => f }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat, laMisaPhatHanhBat: h.misaBat }));
vi.mock("@/lib/finance/hoa-don/cong-phat-hanh", () => ({ layCongHoaDon: h.cong }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/finance/hoa-don/trang-phieu-cho", () => ({ napTrangPhieuCho: h.trang }));
vi.mock("@/lib/finance/hoa-don/phat-hanh-misa", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/phat-hanh-misa")>()),
  batDauPhatHanh: h.batDau,
  guiPhatHanh: h.gui,
  kiemTraMotBan: h.kiem,
  phatHanhLai: h.lai,
  boPhatHanhLamTay: h.bo,
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ order: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: h.khoOk,
}));

import {
  boPhatHanhLamTayAction,
  kiemTraLaiPhatHanhAction,
  phatHanhLaiAction,
  phatHanhQuaMisaAction,
} from "./_actions";
import { LoiPhatHanh } from "@/lib/finance/hoa-don/phat-hanh-misa";

const perm = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const KT_CS1 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs1"])] };
const KT_CS2 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs2"])] };

const DONG = {
  key: "dot:a",
  orderId: "don-a",
  soTien: 3_000_000,
  ngayThuLabel: "30/09/2026",
  khoan: [{ id: "p1", soTien: 3_000_000 }],
  phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "sandbox" },
  misa: null,
} as unknown as DongHangCho;
const DONG_LOI = {
  ...DONG,
  key: "dot:b",
  phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null },
  misa: {
    trangThai: "LOI_PHAT_HANH",
    hoaDonId: "hd1",
    phienBan: "2026-09-30T03:00:00.000Z",
    moiTruong: "sandbox",
    kiemTraLai: { bat: false },
    phatHanhLai: { bat: true },
    boLamTay: { bat: true },
  },
} as unknown as DongHangCho;
const DONG_DANG = {
  ...DONG_LOI,
  misa: { ...DONG_LOI.misa!, trangThai: "DANG_PHAT_HANH", kiemTraLai: { bat: true }, phatHanhLai: { bat: false }, boLamTay: { bat: false } },
} as unknown as DongHangCho;

const PH = { orderId: "don-a", lanThuKey: "dot:a", soTienDaThay: 3_000_000, moiTruongDaThay: "sandbox" };
const LOI = { orderId: "don-a", hoaDonId: "hd1", phienBan: "2026-09-30T03:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveActor.mockResolvedValue(KT_CS1);
  h.nap.mockResolvedValue({ dong: [DONG, DONG_LOI], thieuCoSo: 0, khoOk: true });
});

describe("[PHM-A1] phatHanhQuaMisaAction — cổng", () => {
  it("đối chứng dương: đủ mọi cổng ⇒ batDau với khoản của DÒNG LOADER + gửi bằng ĐÚNG cổng của layCongHoaDon", async () => {
    const cong = { ...CONG };
    h.cong.mockReturnValue(cong);
    const r = await phatHanhQuaMisaAction(PH);
    expect(r).toEqual({ ok: true, data: { hoaDonId: "hd-moi", trangThai: "DA_XAC_NHAN", thongDiep: null } });
    expect(h.batDau).toHaveBeenCalledTimes(1);
    expect(h.batDau.mock.calls[0]![0]).toMatchObject({ orderId: "don-a", centerId: "cs1", khoan: DONG.khoan, cheDo: "HSM" });
    expect(h.gui.mock.calls[0]![0]).toMatchObject({ hoaDonId: "hd-moi", cong });
  });

  it.each([
    ["màn hoá đơn tắt", () => h.bat.mockResolvedValueOnce(false), /chưa được bật/],
    ["chưa đăng nhập", () => h.auth.mockResolvedValueOnce(null), /Chưa đăng nhập/],
    ["thiếu payments:confirm", () => h.checkPermission.mockResolvedValueOnce(false), /payments:confirm/],
    ["kế toán cơ sở KHÁC", () => h.resolveActor.mockResolvedValueOnce(KT_CS2), /Không tìm thấy đơn/],
    ["công tắc MISA tắt", () => h.misaBat.mockResolvedValueOnce(false), /Phát hành qua MISA chưa được bật/],
    ["cổng MISA null", () => h.cong.mockReturnValueOnce(null), /Chưa cấu hình kết nối MISA/],
    ["kho chưa cấu hình", () => h.khoOk.mockReturnValueOnce(false), /Kho lưu hoá đơn/],
    [
      "nút trên dòng loader TẮT",
      () => h.nap.mockResolvedValueOnce({ dong: [{ ...DONG, phatHanhMisa: { hien: true, bat: false, lyDo: "LÝ DO TẮT", cau: null, moiTruong: "sandbox" } }] }),
      /LÝ DO TẮT/,
    ],
    [
      "nút trên dòng loader KHÔNG HIỆN (pháp nhân không MISA)",
      () => h.nap.mockResolvedValueOnce({ dong: [{ ...DONG, phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null } }] }),
      /không phát hành qua MISA được/,
    ],
    ["lần thu không còn trên màn", () => h.nap.mockResolvedValueOnce({ dong: [] }), /Lần thu vừa thay đổi/],
  ])("%s ⇒ từ chối, KHÔNG phát hành", async (_ten, cay, cau) => {
    cay();
    const r = await phatHanhQuaMisaAction(PH);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(cau);
    expect(h.batDau).not.toHaveBeenCalled();
    expect(h.gui).not.toHaveBeenCalled();
  });

  it("số tiền / môi trường đã thấy lệch ⇒ từ chối; lỗi nghiệp vụ của máy ⇒ câu người đọc được", async () => {
    expect((await phatHanhQuaMisaAction({ ...PH, soTienDaThay: 2_000_000 })).ok).toBe(false);
    expect((await phatHanhQuaMisaAction({ ...PH, moiTruongDaThay: "production" })).ok).toBe(false);
    expect(h.batDau).not.toHaveBeenCalled();
    h.batDau.mockRejectedValueOnce(new LoiPhatHanh("DA_CO_HOA_DON"));
    const r = await phatHanhQuaMisaAction(PH);
    expect(!r.ok && r.error).toMatch(/vừa được người khác phát hành/);
    expect(h.gui).not.toHaveBeenCalled();
  });
});

describe("[PHM-A2] kiểm tra lại · phát hành lại · bỏ làm tay", () => {
  it("kiểm tra lại: đối chứng dương gọi máy với ĐÚNG cổng; nút tắt trên dòng ⇒ từ chối; cổng null ⇒ từ chối", async () => {
    h.nap.mockResolvedValue({ dong: [DONG_DANG] });
    expect((await kiemTraLaiPhatHanhAction({ orderId: "don-a", hoaDonId: "hd1" })).ok).toBe(true);
    expect(h.kiem.mock.calls[0]![0]).toMatchObject({ hoaDonId: "hd1", cong: h.cong.mock.results[0]!.value });
    h.cong.mockReturnValueOnce(null);
    expect((await kiemTraLaiPhatHanhAction({ orderId: "don-a", hoaDonId: "hd1" })).ok).toBe(false);
    h.nap.mockResolvedValue({ dong: [DONG_LOI] });
    expect((await kiemTraLaiPhatHanhAction({ orderId: "don-a", hoaDonId: "hd1" })).ok).toBe(false);
    expect(h.kiem).toHaveBeenCalledTimes(1);
  });

  it("phát hành lại: đối chứng dương ⇒ phatHanhLai + gửi; phiên bản cũ / công tắc tắt / thiếu quyền ⇒ từ chối", async () => {
    expect((await phatHanhLaiAction({ ...LOI, moiTruongDaThay: "sandbox" })).ok).toBe(true);
    expect(h.lai).toHaveBeenCalledTimes(1);
    expect(h.gui).toHaveBeenCalledTimes(1);
    expect((await phatHanhLaiAction({ ...LOI, phienBan: "2026-09-30T02:00:00.000Z", moiTruongDaThay: "sandbox" })).ok).toBe(false);
    h.misaBat.mockResolvedValueOnce(false);
    expect((await phatHanhLaiAction({ ...LOI, moiTruongDaThay: "sandbox" })).ok).toBe(false);
    h.checkPermission.mockResolvedValueOnce(false);
    expect((await phatHanhLaiAction({ ...LOI, moiTruongDaThay: "sandbox" })).ok).toBe(false);
    expect(h.lai).toHaveBeenCalledTimes(1);
  });

  it("bỏ làm tay: KHÔNG cần công tắc / cổng MISA (nhả được khoản khi MISA tắt) — nhưng VẪN cần màn bật + quyền", async () => {
    h.misaBat.mockResolvedValue(false);
    h.cong.mockReturnValue(null);
    expect(await boPhatHanhLamTayAction(LOI)).toEqual({ ok: true, data: { hoaDonId: "hd1" } });
    expect(h.bo).toHaveBeenCalledTimes(1);
    h.bat.mockResolvedValueOnce(false);
    expect((await boPhatHanhLamTayAction(LOI)).ok).toBe(false);
    h.checkPermission.mockResolvedValueOnce(false);
    expect((await boPhatHanhLamTayAction(LOI)).ok).toBe(false);
    h.resolveActor.mockResolvedValueOnce(KT_CS2);
    expect((await boPhatHanhLamTayAction(LOI)).ok).toBe(false);
    expect(h.bo).toHaveBeenCalledTimes(1);
    h.misaBat.mockResolvedValue(true);
    h.cong.mockReturnValue({ ...CONG });
  });
});
