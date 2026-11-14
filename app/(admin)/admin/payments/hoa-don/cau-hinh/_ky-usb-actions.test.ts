// Ca [KUA-*] — cổng của action khu «Ký USB token»: cờ → đăng nhập → quyền → phạm vi kế toán; lô tối đa 50; «Ký lô» luôn dùng chính sách NGHIÊM (người ký ≠ người yêu cầu).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u1", name: "Kế toán A" } }) as unknown),
  checkPermission: vi.fn(async (_k: string) => true),
  resolveActor: vi.fn(),
  taoLenh: vi.fn(async (i: { hoaDonId: string }): Promise<unknown> => ({ ok: true, id: `lenh-${i.hoaDonId}` })),
  duyet: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, id: "l", trangThai: "DANG_KY", nguoiKyId: "u1" })),
  huy: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, id: "l1", trangThai: "HUY" })),
  kiemTra: vi.fn(async (_i: unknown): Promise<unknown> => ({ trangThai: "DANG_PHAT_HANH", thongDiep: "chờ" })),
  taoMa: vi.fn(async (_i: unknown): Promise<unknown> => ({ ok: true, mayId: "m1", ma: "ABCDE-FGHJK", hetHan: new Date("2026-11-04T03:10:00.000Z") })),
  thuHoi: vi.fn(async (_i: unknown) => true),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laKyUsbBat: h.bat }));
vi.mock("@/lib/finance/hoa-don/lenh-ky-db", () => ({ duyetVaBatDauKy: h.duyet, huyLenhKy: h.huy }));
vi.mock("@/lib/finance/hoa-don/ky-usb/ky-usb-lenh", () => ({ taoLenhKyUsb: h.taoLenh, kiemTraLaiUsb: h.kiemTra }));
vi.mock("@/lib/finance/hoa-don/ky-usb/may-ky", () => ({ taoMaGhep: h.taoMa, thuHoiMay: h.thuHoi }));

import { huyLenhKyUsbAction, kiemTraLaiKyUsbAction, kyLoUsbAction, taoLenhKyUsbAction, taoMaGhepMayKyAction, thuHoiMayKyAction } from "./_ky-usb-actions";
import { CHINH_SACH_KY_NGHIEM_NHAT } from "@/lib/finance/hoa-don/lenh-ky-trang-thai";

const actor = (centerScope: "ALL" | string[]) =>
  ({ userId: "u1", isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }] }) as unknown as Actor;

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán A" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(actor(["cs1"]));
});

const TAT_CA = [
  ["taoLenhKyUsbAction", () => taoLenhKyUsbAction({ hoaDonIds: ["hd1"] })],
  ["kyLoUsbAction", () => kyLoUsbAction({ lenhIds: ["l1"] })],
  ["huyLenhKyUsbAction", () => huyLenhKyUsbAction({ lenhId: "l1", lyDo: "Khách đổi pháp nhân, tạo lệnh khác" })],
  ["kiemTraLaiKyUsbAction", () => kiemTraLaiKyUsbAction({ hoaDonId: "hd1" })],
  ["taoMaGhepMayKyAction", () => taoMaGhepMayKyAction({ tenMay: "Máy 1" })],
  ["thuHoiMayKyAction", () => thuHoiMayKyAction({ mayId: "m1" })],
] as const;
const luotGoi = () => h.taoLenh.mock.calls.length + h.duyet.mock.calls.length + h.huy.mock.calls.length + h.kiemTra.mock.calls.length + h.taoMa.mock.calls.length + h.thuHoi.mock.calls.length;

describe("[KUA] cổng chung của cả sáu action", () => {
  it.each(TAT_CA)("[KUA-01] %s: đối chứng dương — đủ cờ/đăng nhập/quyền/phạm vi ⇒ chạm tầng dưới", async (_ten, goi) => {
    const r = await goi();
    expect(r.ok).toBe(true);
    expect(luotGoi()).toBeGreaterThan(0);
  });

  it.each(TAT_CA)("[KUA-02] %s: cờ TẮT · chưa đăng nhập · thiếu quyền · không là kế toán ở đâu ⇒ từ chối, KHÔNG chạm tầng dưới", async (_ten, goi) => {
    const chuanBi: [string, () => void, RegExp][] = [
      ["cờ tắt", () => h.bat.mockResolvedValueOnce(false), /chưa được bật/],
      ["chưa đăng nhập", () => h.auth.mockResolvedValueOnce(null), /Chưa đăng nhập/],
      ["thiếu quyền", () => h.checkPermission.mockResolvedValueOnce(false), /payments:confirm/],
      ["không là kế toán ở đâu", () => h.resolveActor.mockResolvedValueOnce(actor([])), /kế toán ở cơ sở nào/],
    ];
    for (const [ten, cb, kyVong] of chuanBi) {
      vi.clearAllMocks();
      h.bat.mockResolvedValue(true);
      h.auth.mockResolvedValue({ user: { id: "u1", name: "A" } });
      h.checkPermission.mockResolvedValue(true);
      h.resolveActor.mockResolvedValue(actor(["cs1"]));
      cb();
      const r = await goi();
      expect(r.ok, ten).toBe(false);
      expect(r.ok ? "" : r.error, ten).toMatch(kyVong);
      expect(luotGoi(), ten).toBe(0);
    }
  });
});

describe("[KUA] lô", () => {
  it("[KUA-03] lô rỗng hoặc quá 50 mục ⇒ từ chối trước mọi cổng; đúng 50 thì được", async () => {
    expect(await taoLenhKyUsbAction({ hoaDonIds: [] })).toMatchObject({ ok: false });
    expect(await kyLoUsbAction({ lenhIds: Array.from({ length: 51 }, (_, i) => `l${i}`) })).toMatchObject({ ok: false });
    expect(h.auth).not.toHaveBeenCalled();
    const r = await kyLoUsbAction({ lenhIds: Array.from({ length: 50 }, (_, i) => `l${i}`) });
    expect(r).toEqual({ ok: true, data: { thanhCong: 50, loi: [] } });
  });

  it("[KUA-04] «Ký lô» dùng CHÍNH SÁCH NGHIÊM của S9 (không tự nới), người nhận ký = người bấm; lỗi một lệnh không chặn lệnh khác và được báo kèm lý do", async () => {
    h.duyet.mockImplementation(async (i: unknown) => ((i as { lenhId: string }).lenhId === "l2" ? { ok: false, ma: "TACH_NHIEM_VU", error: "Người ký phải khác người yêu cầu." } : { ok: true, id: "x", trangThai: "DANG_KY", nguoiKyId: "u1" }));
    const r = await kyLoUsbAction({ lenhIds: ["l1", "l2", "l3"] });
    expect(r).toEqual({ ok: true, data: { thanhCong: 2, loi: [{ id: "l2", ok: false, error: "Người ký phải khác người yêu cầu." }] } });
    for (const c of h.duyet.mock.calls) expect(c[0]).toMatchObject({ chinhSach: CHINH_SACH_KY_NGHIEM_NHAT });
    expect((h.duyet.mock.calls[0]![0] as { actor: Actor }).actor.userId).toBe("u1");
  });

  it("[KUA-05] tạo lệnh: người yêu cầu là CHÍNH người bấm (actor thật), không phải hệ thống; mỗi hoá đơn một lần gọi", async () => {
    await taoLenhKyUsbAction({ hoaDonIds: ["a", "b"] });
    expect(h.taoLenh).toHaveBeenCalledTimes(2);
    for (const c of h.taoLenh.mock.calls) expect((c[0] as unknown as { actor: Actor }).actor.userId).toBe("u1");
  });

  it("[KUA-06] huỷ lệnh: lý do < 10 ký tự bị chặn ngay; kết quả mã ghép chỉ có ở phản hồi tạo mã (không nơi nào khác)", async () => {
    expect(await huyLenhKyUsbAction({ lenhId: "l1", lyDo: "ngắn" })).toMatchObject({ ok: false });
    expect(h.huy).not.toHaveBeenCalled();
    const ma = await taoMaGhepMayKyAction({ tenMay: "Máy 1" });
    expect(ma).toEqual({ ok: true, data: { ma: "ABCDE-FGHJK", hetHan: "2026-11-04T03:10:00.000Z" } });
    const hoi = await thuHoiMayKyAction({ mayId: "m1" });
    expect(JSON.stringify(hoi)).not.toContain("ABCDE");
  });
});
