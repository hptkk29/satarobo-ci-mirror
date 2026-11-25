// @vitest-environment node
//
// Ca [BNV-A*] — CỔNG của action «BỎ KHỎI NHÁP» (11/11/2026): kế toán bấm nhầm «Gửi nháp» thì đưa dòng về «Chờ xuất». Action CHỈ ghi một vết (`BO_NHAP_VIN`) qua `boDanhDauNhapVin`; ở đây đo thứ nó
// TỰ gác: dữ liệu vào, quyền + đúng cơ sở, dòng do loader dựng lại phải đang là «đã gửi nháp», KHÔNG đòi công tắc phát hành (đường lui phải mở), không gọi VIN, lỗi ghi ⇒ báo lỗi.
// Mỗi ca từ chối có đối chứng dương cùng fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  misaBat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u-kt", name: "Kế toán" } }) as unknown),
  checkPermission: vi.fn(async () => true),
  resolveActor: vi.fn(),
  findUnique: vi.fn(async () => ({ id: "don-a", centerId: "cs1", orgUnitId: null, center: { code: "CS1" } }) as unknown),
  nap: vi.fn(),
  guiNhap: vi.fn(),
  bo: vi.fn(async (_i: unknown) => undefined),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate, revalidateTag: vi.fn(), unstable_cache: <T,>(f: T) => f }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat, laMisaPhatHanhBat: h.misaBat }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/finance/hoa-don/gui-nhap-vin", () => ({ guiNhapLenVin: h.guiNhap }));
vi.mock("@/lib/finance/hoa-don/bo-nhap-vin", () => ({ boDanhDauNhapVin: h.bo }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ order: { findUnique: h.findUnique } }) }));

import { boKhoiNhapHoaDonVinAction } from "./_actions";

const perm = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const KT_CS1 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs1"])] };
const KT_CS2 = { userId: "u-kt", isSuperAdmin: false, grantsAllow: new Set(), permissions: [perm(["cs2"])] };

const LUC = "2026-11-11T07:05:00.000Z";
const DONG_NHAP = { key: "dot:a", orderId: "don-a", soTien: 3_000_000, daGuiNhap: { luc: LUC }, misa: null } as unknown as DongHangCho;
const DONG_CHUA_GUI = { ...DONG_NHAP, daGuiNhap: null } as unknown as DongHangCho;

const IN = { orderId: "don-a", lanThuKey: "dot:a" };

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveActor.mockResolvedValue(KT_CS1);
  h.nap.mockResolvedValue({ dong: [DONG_NHAP], thieuCoSo: 0, khoOk: true });
});

describe("[BNV-A1] boKhoiNhapHoaDonVinAction — cổng", () => {
  it("đối chứng dương: dòng đã gửi nháp + kế toán đúng cơ sở ⇒ ghi MỘT vết với khoá của DÒNG LOADER, làm mới màn, KHÔNG gọi VIN", async () => {
    const r = await boKhoiNhapHoaDonVinAction(IN);
    expect(r).toEqual({ ok: true, data: { daBo: true } });
    expect(h.bo).toHaveBeenCalledTimes(1);
    expect(h.bo.mock.calls[0]![0]).toMatchObject({ orderId: "don-a", centerId: "cs1", lanThuKey: "dot:a", nhapGuiLuc: LUC, nguoiBam: { id: "u-kt" } });
    expect(h.guiNhap).not.toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalledWith("/payments/hoa-don");
  });

  it("dữ liệu vào sai ⇒ từ chối TRƯỚC mọi đọc", async () => {
    expect((await boKhoiNhapHoaDonVinAction({ orderId: "", lanThuKey: "x" })).ok).toBe(false);
    expect((await boKhoiNhapHoaDonVinAction({ orderId: "a" })).ok).toBe(false);
    expect((await boKhoiNhapHoaDonVinAction(null)).ok).toBe(false);
    expect(h.nap).not.toHaveBeenCalled();
    expect(h.bo).not.toHaveBeenCalled();
  });

  it("dòng KHÔNG ở trạng thái đã gửi nháp (đã bỏ rồi / chưa gửi) ⇒ từ chối, không ghi vết; đối chứng: dòng đã gửi thì qua", async () => {
    h.nap.mockResolvedValue({ dong: [DONG_CHUA_GUI], thieuCoSo: 0, khoOk: true });
    const r = await boKhoiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/không còn bản nháp nào để bỏ/);
    expect(h.bo).not.toHaveBeenCalled();
    h.nap.mockResolvedValue({ dong: [DONG_NHAP], thieuCoSo: 0, khoOk: true });
    expect((await boKhoiNhapHoaDonVinAction(IN)).ok).toBe(true);
  });

  it("khoá lần thu không còn trong loader (vừa gộp / tách) ⇒ 'vừa thay đổi', không ghi vết", async () => {
    h.nap.mockResolvedValue({ dong: [], thieuCoSo: 0, khoOk: true });
    const r = await boKhoiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/vừa thay đổi/);
    expect(h.bo).not.toHaveBeenCalled();
  });

  it("kế toán cơ sở KHÁC không bỏ được nháp của đơn cs1; đối chứng: kế toán cs1 bỏ được", async () => {
    h.resolveActor.mockResolvedValue(KT_CS2);
    expect((await boKhoiNhapHoaDonVinAction(IN)).ok).toBe(false);
    expect(h.bo).not.toHaveBeenCalled();
    h.resolveActor.mockResolvedValue(KT_CS1);
    expect((await boKhoiNhapHoaDonVinAction(IN)).ok).toBe(true);
  });

  it("thiếu quyền xác nhận khoản thu ⇒ từ chối, không ghi vết", async () => {
    h.checkPermission.mockResolvedValueOnce(false);
    const r = await boKhoiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(h.bo).not.toHaveBeenCalled();
  });

  it("công tắc phát hành TẮT vẫn bỏ được (đường lui không phụ thuộc phát hành); màn hoá đơn TẮT thì không", async () => {
    h.misaBat.mockResolvedValue(false);
    expect((await boKhoiNhapHoaDonVinAction(IN)).ok).toBe(true);
    h.misaBat.mockResolvedValue(true);
    h.bat.mockResolvedValueOnce(false);
    expect((await boKhoiNhapHoaDonVinAction(IN)).ok).toBe(false);
  });

  it("ghi vết hỏng ⇒ báo lỗi (vết CHÍNH LÀ tác dụng của thao tác — không được báo 'đã bỏ' khi chưa ghi), không làm mới màn", async () => {
    h.bo.mockRejectedValueOnce(new Error("db down"));
    const r = await boKhoiNhapHoaDonVinAction(IN);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/Chưa bỏ được/);
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
