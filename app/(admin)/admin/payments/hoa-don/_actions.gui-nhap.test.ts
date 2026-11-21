// @vitest-environment node
//
// Ca [GNV-A*] — CỔNG của action «Gửi NHÁP lên VIN» (08/11/2026). Phần lõi (dựng phiếu bằng đúng cổng phát hành thật, không ghi gì, gọi VIN) canh trên Postgres thật ở
// `tests/finance/hoa-don-gui-nhap-vin-db.test.ts`; ở đây đo thứ action TỰ gác lại: cờ màn, quyền/phạm vi, công tắc phát hành, nút phải SÁNG trên chính dòng loader dựng lại, nhà cung cấp phải là VIN,
// số tiền người bấm đã thấy, cổng VIN của đúng pháp nhân, giới hạn lượt. Mỗi ca từ chối có đối chứng dương cùng fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  misaBat: vi.fn(async () => true),
  congVin: vi.fn((): unknown => ({ ok: true, cong: { cheDo: "HSM", moiTruong: "production", kyUsb: {} }, mst: "0402341056" })),
  congPn: vi.fn((_pn: string) => undefined),
  auth: vi.fn(async () => ({ user: { id: "u-kt", name: "Kế toán" } }) as unknown),
  checkPermission: vi.fn(async () => true),
  resolveActor: vi.fn(),
  findUnique: vi.fn(async () => ({ id: "don-a", centerId: "cs1", orgUnitId: null, center: { code: "CS1" } }) as unknown),
  nap: vi.fn(),
  trang: vi.fn(async () => ({ ok: true, phapNhan: {}, trang: [], khoiDon: {}, phuongThuc: [] }) as unknown),
  guiNhap: vi.fn(async (_i: unknown) => ({ ok: true, refId: "nhap-1", maGiaoDich: "MGD1", tomTat: { kyHieu: "1C26MAI", mstNguoiBan: "0402341056", tongThanhToan: 3_000_000, soDong: 1, nguoiMuaTen: "PH", nguoiMuaMst: null } }) as unknown),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 14, resetAt: 0 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: <T,>(f: T) => f }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat, laMisaPhatHanhBat: h.misaBat }));
vi.mock("@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan", () => ({
  layCongHsmChoPhapNhan: async () => ({ ok: false, usb: false, lyDo: "không dùng ở ca này" }),
  layCongNhapVinChoPhapNhan: async (phapNhanMa: string) => {
    h.congPn(phapNhanMa);
    return h.congVin();
  },
}));
vi.mock("@/lib/finance/hoa-don/ket-noi/phap-nhan-phat-hanh", () => ({
  phapNhanMaPhatHanhChoCoSo: async () => "PN_PHAT_HANH",
  phapNhanMaCuaHoaDon: async () => "PN_CUA_HOA_DON",
}));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/finance/hoa-don/trang-phieu-cho", () => ({ napTrangPhieuCho: h.trang }));
vi.mock("@/lib/finance/hoa-don/gui-nhap-vin", () => ({ guiNhapLenVin: h.guiNhap }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ order: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));

import { guiNhapHoaDonVinAction } from "./_actions";

const perm = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const KT_CS1 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs1"])] };
const KT_CS2 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs2"])] };

const DONG_VIN = {
  key: "dot:a",
  orderId: "don-a",
  soTien: 3_000_000,
  khoan: [{ id: "p1", soTien: 3_000_000 }],
  phatHanhMisa: { hien: true, bat: true, cau: null, moiTruong: "production", nhaCungCap: "VIN_HOADON" },
  misa: null,
} as unknown as DongHangCho;
const DONG_MISA = { ...DONG_VIN, phatHanhMisa: { ...DONG_VIN.phatHanhMisa, nhaCungCap: "MISA_MEINVOICE" } } as unknown as DongHangCho;
const DONG_TAT = { ...DONG_VIN, phatHanhMisa: { hien: true, bat: false, cau: null, lyDo: "Còn thiếu thông tin người mua", moiTruong: "production", nhaCungCap: "VIN_HOADON" } } as unknown as DongHangCho;
const DONG_AN = { ...DONG_VIN, phatHanhMisa: { hien: false, bat: false, cau: "Lần thu đã có hoá đơn", moiTruong: null, nhaCungCap: "VIN_HOADON" } } as unknown as DongHangCho;

const IN = { orderId: "don-a", lanThuKey: "dot:a", soTienDaThay: 3_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveActor.mockResolvedValue(KT_CS1);
  h.nap.mockResolvedValue({ dong: [DONG_VIN], thieuCoSo: 0, khoOk: true });
});

describe("[GNV-A1] guiNhapHoaDonVinAction — cổng", () => {
  it("đối chứng dương: đủ mọi cổng ⇒ gọi lõi với khoản của DÒNG LOADER (không từ client) + cổng VIN của ĐÚNG pháp nhân phát hành, trả kết quả lõi", async () => {
    const r = await guiNhapHoaDonVinAction(IN);
    expect(r).toMatchObject({ ok: true, data: { ok: true, refId: "nhap-1", maGiaoDich: "MGD1" } });
    expect(h.congPn).toHaveBeenCalledWith("PN_PHAT_HANH");
    expect(h.guiNhap).toHaveBeenCalledTimes(1);
    expect(h.guiNhap.mock.calls[0]![0]).toMatchObject({ orderId: "don-a", centerId: "cs1", khoan: DONG_VIN.khoan, lanThuKey: "dot:a", nguoiBam: { id: "u-kt" } });
  });

  it("dữ liệu vào sai ⇒ từ chối TRƯỚC mọi đọc", async () => {
    expect((await guiNhapHoaDonVinAction({ orderId: "", lanThuKey: "x", soTienDaThay: 1 })).ok).toBe(false);
    expect((await guiNhapHoaDonVinAction({ orderId: "a", lanThuKey: "x", soTienDaThay: -5 })).ok).toBe(false);
    expect((await guiNhapHoaDonVinAction(null)).ok).toBe(false);
    expect(h.nap).not.toHaveBeenCalled();
    expect(h.guiNhap).not.toHaveBeenCalled();
  });

  it("công tắc phát hành TẮT ⇒ từ chối, không chạm VIN (nút cũng không hiện — cùng một công tắc); đối chứng: bật thì qua", async () => {
    h.misaBat.mockResolvedValueOnce(false);
    const r = await guiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/chưa được bật/);
    expect(h.guiNhap).not.toHaveBeenCalled();
    expect((await guiNhapHoaDonVinAction(IN)).ok).toBe(true);
  });

  it("nhà cung cấp của dòng là MISA ⇒ từ chối (nháp chỉ cho VIN); đối chứng: dòng VIN thì qua", async () => {
    h.nap.mockResolvedValue({ dong: [DONG_MISA], thieuCoSo: 0, khoOk: true });
    const r = await guiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/chỉ dùng được với pháp nhân có nhà cung cấp hỗ trợ gửi nháp/);
    expect(h.guiNhap).not.toHaveBeenCalled();
    h.nap.mockResolvedValue({ dong: [DONG_VIN], thieuCoSo: 0, khoOk: true });
    expect((await guiNhapHoaDonVinAction(IN)).ok).toBe(true);
  });

  it("nút Phát hành TẮT trên dòng loader (thiếu thông tin người mua…) hoặc ẨN (đã có hoá đơn) ⇒ từ chối KÈM câu của nút; không chạm VIN", async () => {
    h.nap.mockResolvedValue({ dong: [DONG_TAT], thieuCoSo: 0, khoOk: true });
    expect(await guiNhapHoaDonVinAction(IN)).toEqual({ ok: false, error: "Còn thiếu thông tin người mua" });
    h.nap.mockResolvedValue({ dong: [DONG_AN], thieuCoSo: 0, khoOk: true });
    expect(await guiNhapHoaDonVinAction(IN)).toEqual({ ok: false, error: "Lần thu đã có hoá đơn" });
    expect(h.guiNhap).not.toHaveBeenCalled();
  });

  it("số tiền người bấm đã thấy lệch số loader dựng lại ⇒ từ chối (có tiền mới / điều chỉnh)", async () => {
    const r = await guiNhapHoaDonVinAction({ ...IN, soTienDaThay: 2_999_000 });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/vừa đổi số tiền/);
    expect(h.guiNhap).not.toHaveBeenCalled();
  });

  it("cổng VIN của pháp nhân KHÔNG dùng được (chưa khai / tạm dừng ký) ⇒ từ chối KÈM lý do của cổng; không chạm VIN", async () => {
    h.congVin.mockReturnValueOnce({ ok: false, lyDo: "Pháp nhân đang tạm dừng ký", tamDung: true });
    expect(await guiNhapHoaDonVinAction(IN)).toEqual({ ok: false, error: "Pháp nhân đang tạm dừng ký" });
    expect(h.guiNhap).not.toHaveBeenCalled();
  });

  it("kế toán ĐÚNG cơ sở: kế toán cơ sở KHÁC không gửi nháp cho đơn của cs1; đối chứng: kế toán cs1 gửi được", async () => {
    h.resolveActor.mockResolvedValue(KT_CS2);
    const r = await guiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(h.guiNhap).not.toHaveBeenCalled();
    h.resolveActor.mockResolvedValue(KT_CS1);
    expect((await guiNhapHoaDonVinAction(IN)).ok).toBe(true);
  });

  it("vượt giới hạn lượt ⇒ từ chối, không chạm VIN", async () => {
    h.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    const r = await guiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/quá nhiều lần/);
    expect(h.guiNhap).not.toHaveBeenCalled();
  });

  it("VIN từ chối bản nháp ⇒ vẫn `ok: true` ở tầng action (kết quả là DỮ LIỆU kế toán cần đọc), `data.ok = false` mang mã + câu của VIN", async () => {
    h.guiNhap.mockResolvedValueOnce({ ok: false, ma: "VIN_08", thongDiep: "Ký hiệu không hợp lệ", daGui: true, refId: "nhap-2", tomTat: null });
    expect(await guiNhapHoaDonVinAction(IN)).toEqual({ ok: true, data: { ok: false, ma: "VIN_08", thongDiep: "Ký hiệu không hợp lệ", daGui: true, refId: "nhap-2", tomTat: null } });
  });
});
