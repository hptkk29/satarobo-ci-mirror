// Ca [NKTD-*] — NGƯỜI CHẠY chuông nhắc kế toán (`nhac-ke-toan-db.ts`): cổng cờ, nạp bằng loader của màn,
// cơ sở tra MỘT câu, người nhận theo phạm vi `payments:confirm` của actor THẬT, khoá theo ngày của lượt.
// Luật đếm/chia canh ở `nhac-ke-toan.test.ts` (`[NKT-*]`). Mọi tầng DB/actor/notify giả lập.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  nap: vi.fn(),
  rolePermission: vi.fn(),
  userOrgRole: vi.fn(),
  user: vi.fn(),
  order: vi.fn(),
  actor: vi.fn(),
  notify: vi.fn(async (p: { userIds: readonly string[]; dedupeKey: string; body: string }) => p.userIds.length),
}));
vi.mock("./feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("./hang-cho", () => ({ napHangChoHoaDon: h.nap }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/auth/actor", () => ({ resolveActorUncached: h.actor }));
vi.mock("@/lib/db", () => ({
  db: {
    rolePermission: { findMany: h.rolePermission },
    userOrgRole: { findMany: h.userOrgRole },
    user: { findMany: h.user },
    order: { findMany: h.order },
  },
}));

import { nhacKeToanHoaDon } from "./nhac-ke-toan-db";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { TIEN_TO_NHAC } from "./nhac-ke-toan";

const NOW = new Date("2026-09-28T01:00:00.000Z");
const NGAY = "2026-09-28";
const QUYEN = "payments:confirm";

const dong = (orderId: string, ngan: string, ten: string) => ({ orderId, ngan, coSo: { ma: null, ten } });

const actorVoi = (userId: string, centerScope: "ALL" | string[]): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: QUYEN, scopeType: "GLOBAL", centerScope }],
  }) as unknown as Actor;

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.nap.mockResolvedValue({
    dong: [
      dong("o1", "cho", "Cơ sở 1"),
      dong("o2", "cho", "Cơ sở 1"),
      dong("o3", "cho", "Cơ sở 2"),
      dong("o4", "lech", "Cơ sở 2"),
    ],
    thieuCoSo: 0,
    khoOk: true,
  });
  h.order.mockResolvedValue([
    { id: "o1", centerId: "cs1" },
    { id: "o2", centerId: "cs1" },
    { id: "o3", centerId: "cs2" },
  ]);
  h.rolePermission.mockResolvedValue([{ roleId: "r-kt" }]);
  h.userOrgRole.mockResolvedValue([{ userId: "kt1" }, { userId: "ktho" }, { userId: "nghi" }, { userId: "kt1" }]);
  h.user.mockResolvedValue([{ id: "kt1" }, { id: "ktho" }]);
  h.actor.mockImplementation(async (id: string) => actorVoi(id, id === "ktho" ? "ALL" : ["cs1"]));
});

describe("[NKTD-01] cổng cờ billing.hoaDonEnabled", () => {
  it("cờ TẮT ⇒ không tra hàng chờ, không tra DB, không chuông", async () => {
    h.bat.mockResolvedValue(false);
    const kq = await nhacKeToanHoaDon(NOW);
    expect(kq.boQua).toBe("CO_TAT");
    expect(h.nap).not.toHaveBeenCalled();
    expect(h.order).not.toHaveBeenCalled();
    expect(h.rolePermission).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("đối chứng: cờ BẬT ⇒ có chuông", async () => {
    const kq = await nhacKeToanHoaDon(NOW);
    expect(kq.boQua).toBeNull();
    expect(h.notify).toHaveBeenCalled();
  });
});

describe("[NKTD-02] nạp bằng loader của màn — mọi cơ sở, không PII", () => {
  it("gọi napHangChoHoaDon với SYSTEM_ACTOR + canViewPii false, đúng một lần", async () => {
    await nhacKeToanHoaDon(NOW);
    expect(h.nap).toHaveBeenCalledTimes(1);
    expect(h.nap).toHaveBeenCalledWith(SYSTEM_ACTOR, { canViewPii: false });
  });

  it("cơ sở của đơn tra MỘT câu, chỉ các đơn ở ngăn chờ", async () => {
    await nhacKeToanHoaDon(NOW);
    expect(h.order).toHaveBeenCalledTimes(1);
    const arg = h.order.mock.calls[0]![0] as { where: { id: { in: string[] } } };
    expect(arg.where.id.in.sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("không có dòng chờ ⇒ không tra cơ sở / người nhận, không chuông", async () => {
    h.nap.mockResolvedValue({ dong: [dong("o4", "lech", "Cơ sở 2")], thieuCoSo: 0, khoOk: true });
    const kq = await nhacKeToanHoaDon(NOW);
    expect(kq.choXuat).toBe(0);
    expect(h.order).not.toHaveBeenCalled();
    expect(h.rolePermission).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("[NKTD-03] người nhận = phạm vi payments:confirm của actor thật, còn hoạt động", () => {
  it("vai tra theo đúng quyền payments:confirm", async () => {
    await nhacKeToanHoaDon(NOW);
    expect(h.rolePermission).toHaveBeenCalledWith(expect.objectContaining({ where: { action: QUYEN } }));
  });

  it("người đã nghỉ bị loại trước khi dựng actor; mỗi người dựng một lần", async () => {
    await nhacKeToanHoaDon(NOW);
    expect(h.actor.mock.calls.map((c) => c[0]).sort()).toEqual(["kt1", "ktho"]);
  });

  it("kế toán CS1 nhận bản CS1 (2 lần thu); Hội sở nhận bản tổng (3); không ai nhận bản CS2 riêng", async () => {
    const kq = await nhacKeToanHoaDon(NOW);
    const goi = h.notify.mock.calls.map((c) => c[0] as { userIds: string[]; dedupeKey: string; body: string });
    const theoKhoa = new Map(goi.map((g) => [g.dedupeKey, g]));
    expect([...theoKhoa.keys()].sort()).toEqual([`${TIEN_TO_NHAC}cs1:${NGAY}`, `${TIEN_TO_NHAC}tong:${NGAY}`]);
    expect(theoKhoa.get(`${TIEN_TO_NHAC}cs1:${NGAY}`)!.userIds).toEqual(["kt1"]);
    expect(theoKhoa.get(`${TIEN_TO_NHAC}cs1:${NGAY}`)!.body).toContain("2 lần thu");
    expect(theoKhoa.get(`${TIEN_TO_NHAC}tong:${NGAY}`)!.userIds).toEqual(["ktho"]);
    expect(theoKhoa.get(`${TIEN_TO_NHAC}tong:${NGAY}`)!.body).toContain("3 lần thu");
    expect(kq).toMatchObject({ choXuat: 3, coSo: 2, thongBao: 2, notified: 2 });
  });

  it("không vai nào có payments:confirm ⇒ không chuông (không rơi về gửi cho ai đó)", async () => {
    h.rolePermission.mockResolvedValue([]);
    await nhacKeToanHoaDon(NOW);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("[NKTD-04] khoá chống trùng theo NGÀY của lượt chạy (không đọc đồng hồ thật)", () => {
  it("ngày trong khoá lấy từ mốc truyền vào", async () => {
    await nhacKeToanHoaDon(new Date("2027-01-02T03:00:00.000Z"));
    for (const c of h.notify.mock.calls) {
      expect((c[0] as { dedupeKey: string }).dedupeKey.endsWith(":2027-01-02")).toBe(true);
    }
    expect(h.notify).toHaveBeenCalled();
  });
});
