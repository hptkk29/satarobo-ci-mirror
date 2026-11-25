// Ca [CHA-*] — cổng quyền của action cấu hình hoá đơn theo cơ sở (PR2).
// Thứ cần đo: người KHÔNG phải kế toán của cơ sở đích thì KHÔNG chạm được tầng ghi; kế toán đúng cơ sở thì chạm.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u1", name: "Kế toán A" } }) as unknown),
  checkPermission: vi.fn(async (_k: string) => true),
  resolveActor: vi.fn(),
  centerFind: vi.fn(),
  luu: vi.fn(async (_i: unknown) => ({ ok: true as const, id: "ch1" })),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ center: { findUnique: h.centerFind } }) }));
vi.mock("@/lib/finance/hoa-don/cau-hinh-co-so-db", () => ({ luuCauHinh: h.luu }));

import { luuCauHinhHoaDonAction } from "./_actions";

const ktCoSo = (...ids: string[]) =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: ids }],
  }) as unknown as Actor;
const ktTatCa = () =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "HO", centerScope: "ALL" }],
  }) as unknown as Actor;

const IN = {
  centerId: "cs2",
  phapNhanMa: "NEW_VISION",
  kyHieu: "1C26MNV",
  hieuLucTu: "2026-01-01",
  hieuLucDen: "2026-12-31",
  dangBat: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán A" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(ktCoSo("cs2"));
  h.centerFind.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, code: where.id.toUpperCase() }));
  h.luu.mockResolvedValue({ ok: true, id: "ch1" });
});

describe("[CHA-01] cổng của action cấu hình hoá đơn", () => {
  it("kế toán ĐÚNG cơ sở ⇒ gọi tầng ghi với người thao tác + dữ liệu, làm mới màn", async () => {
    expect(await luuCauHinhHoaDonAction({ ...IN, ghiChu: "ghi chú" })).toEqual({ ok: true, data: { id: "ch1" } });
    expect(h.luu).toHaveBeenCalledTimes(1);
    expect(h.luu.mock.calls[0]![0]).toMatchObject({
      nguoi: { id: "u1", name: "Kế toán A" },
      du: { centerId: "cs2", phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV", dangBat: true },
      ghiChu: "ghi chú",
    });
    expect(h.revalidatePath).toHaveBeenCalledWith("/payments/hoa-don");
    expect(h.revalidatePath).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh");
  });

  it("kế toán CS1 sửa cấu hình CS2 ⇒ 'Không tìm thấy cơ sở', KHÔNG chạm tầng ghi (không sửa chéo cơ sở)", async () => {
    h.resolveActor.mockResolvedValue(ktCoSo("cs1"));
    expect(await luuCauHinhHoaDonAction(IN)).toEqual({ ok: false, error: "Không tìm thấy cơ sở" });
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("kế toán HO (phạm vi ALL) sửa được cơ sở được giao", async () => {
    h.resolveActor.mockResolvedValue(ktTatCa());
    expect(await luuCauHinhHoaDonAction(IN)).toMatchObject({ ok: true });
  });

  it("không có kế toán ở đâu (phạm vi rỗng) ⇒ từ chối", async () => {
    h.resolveActor.mockResolvedValue(ktCoSo());
    expect(await luuCauHinhHoaDonAction(IN)).toMatchObject({ ok: false });
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("cơ sở không thấy được qua scopedDb (id lạ) ⇒ từ chối", async () => {
    h.centerFind.mockResolvedValue(null);
    expect(await luuCauHinhHoaDonAction(IN)).toEqual({ ok: false, error: "Không tìm thấy cơ sở" });
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("thiếu quyền payments:confirm / chưa đăng nhập / cờ tắt ⇒ từ chối TRƯỚC khi đọc cơ sở", async () => {
    h.checkPermission.mockResolvedValue(false);
    expect(await luuCauHinhHoaDonAction(IN)).toMatchObject({ ok: false, error: expect.stringMatching(/payments:confirm/) });
    h.checkPermission.mockResolvedValue(true);
    h.auth.mockResolvedValue(null);
    expect(await luuCauHinhHoaDonAction(IN)).toEqual({ ok: false, error: "Chưa đăng nhập" });
    h.auth.mockResolvedValue({ user: { id: "u1", name: "x" } });
    h.bat.mockResolvedValue(false);
    expect(await luuCauHinhHoaDonAction(IN)).toMatchObject({ ok: false });
    expect(h.centerFind).not.toHaveBeenCalled();
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("đầu vào hỏng (ngày sai dạng, thiếu ký hiệu) ⇒ từ chối ngay, không đọc quyền", async () => {
    expect(await luuCauHinhHoaDonAction({ ...IN, hieuLucTu: "01/01/2026" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(await luuCauHinhHoaDonAction({ ...IN, kyHieu: "" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(h.auth).not.toHaveBeenCalled();
  });

  it("tầng ghi từ chối (chồng ngày…) ⇒ trả đúng câu lỗi, KHÔNG làm mới màn", async () => {
    h.luu.mockResolvedValue({ ok: false as unknown as true, error: "Trùng khoảng ngày" } as never);
    expect(await luuCauHinhHoaDonAction(IN)).toEqual({ ok: false, error: "Trùng khoảng ngày" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
