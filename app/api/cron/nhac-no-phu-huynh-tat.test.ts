// @vitest-environment node
/**
 * [NNPH-*] Nhắc nợ gửi phụ huynh bị TẮT (chủ dự án 04/11/2026): hai cron `debt-reminder` + `order-debt-reminder` vẫn có lịch
 * (lưới đăng ký cron + crontab VPS giữ nguyên) nhưng khi cờ `PARENT_DEBT_REMINDER_ENABLED` không phải đúng chữ "true" thì:
 *  - vẫn qua cổng xác thực (không xác thực ⇒ 401, không lộ trạng thái),
 *  - KHÔNG đọc/ghi DB, KHÔNG gửi email/ZNS, KHÔNG chạm hàm nhắc nợ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const dich = vi.hoisted(() => ({
  xacThuc: true,
  dbCham: vi.fn(),
  guiZalo: vi.fn(),
  nhacDot: vi.fn(),
  nhacDonLe: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/cron/auth", () => ({ verifyCronAuth: () => dich.xacThuc }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: () => { dich.dbCham(); return new Proxy({}, { get: () => () => { dich.dbCham(); return []; } }); } }),
}));
vi.mock("@/lib/zalo/service", () => ({ sendZaloNotification: dich.guiZalo }));
vi.mock("@/lib/settings/service", () => ({ getSetting: dich.getSetting }));
vi.mock("@/lib/bao-luu/dang-bao-luu-db", () => ({ locDonDangBaoLuu: async () => new Set() }));
vi.mock("@/lib/bao-luu/qua-han-tru-bao-luu-db", () => ({ docKhoangTheoDon: async () => new Map() }));
vi.mock("@/lib/finance/debt", () => ({
  effectiveReminderDays: () => 14,
  isReminderDue: () => false,
  remindOverdueInstallments: dich.nhacDot,
  remindOverdueSingleOrders: dich.nhacDonLe,
}));

import { GET as nhacDot } from "./debt-reminder/route";
import { GET as nhacDonLe } from "./order-debt-reminder/route";

const req = {} as NextRequest;

describe("[NNPH] cron nhắc nợ phụ huynh — công tắc PARENT_DEBT_REMINDER_ENABLED", () => {
  const truoc = process.env.PARENT_DEBT_REMINDER_ENABLED;
  beforeEach(() => {
    dich.xacThuc = true;
    Object.values(dich).forEach((v) => typeof v === "function" && "mockClear" in v && v.mockClear());
    dich.getSetting.mockResolvedValue(14);
    dich.nhacDot.mockResolvedValue({});
    dich.nhacDonLe.mockResolvedValue({});
    delete process.env.PARENT_DEBT_REMINDER_ENABLED;
  });
  afterEach(() => {
    if (truoc === undefined) delete process.env.PARENT_DEBT_REMINDER_ENABLED;
    else process.env.PARENT_DEBT_REMINDER_ENABLED = truoc;
  });

  it.each([
    ["debt-reminder", nhacDot],
    ["order-debt-reminder", nhacDonLe],
  ] as const)("[NNPH-01] %s: mặc định (không đặt cờ) ⇒ trả skipped, KHÔNG chạm DB / Zalo / hàm nhắc nợ", async (_ten, GET) => {
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "parent-debt-reminder-off" });
    expect(dich.dbCham).not.toHaveBeenCalled();
    expect(dich.guiZalo).not.toHaveBeenCalled();
    expect(dich.nhacDot).not.toHaveBeenCalled();
    expect(dich.nhacDonLe).not.toHaveBeenCalled();
    expect(dich.getSetting).not.toHaveBeenCalled();
  });

  it.each([
    ["debt-reminder", nhacDot],
    ["order-debt-reminder", nhacDonLe],
  ] as const)("[NNPH-02] %s: cờ \"TRUE\"/\"1\"/\"false\" KHÔNG bật (chỉ đúng chữ \"true\")", async (_ten, GET) => {
    for (const v of ["TRUE", "1", "false", ""]) {
      process.env.PARENT_DEBT_REMINDER_ENABLED = v;
      const res = await GET(req);
      expect(await res.json()).toEqual({ ok: true, skipped: "parent-debt-reminder-off" });
    }
    expect(dich.dbCham).not.toHaveBeenCalled();
  });

  it.each([
    ["debt-reminder", nhacDot],
    ["order-debt-reminder", nhacDonLe],
  ] as const)("[NNPH-03] %s: không xác thực ⇒ 401 dù cờ tắt (cổng xác thực vẫn đứng trước)", async (_ten, GET) => {
    dich.xacThuc = false;
    expect((await GET(req)).status).toBe(401);
  });

  it("[NNPH-04] ĐỐI CHỨNG DƯƠNG: cờ \"true\" ⇒ đơn lẻ gọi hàm nhắc nợ; đợt trả góp đọc DB và gọi hàm nhắc đợt", async () => {
    process.env.PARENT_DEBT_REMINDER_ENABLED = "true";
    const a = await nhacDonLe(req);
    expect(dich.nhacDonLe).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual({ ok: true, data: {} });
    const b = await nhacDot(req);
    expect(dich.dbCham).toHaveBeenCalled();
    expect(dich.nhacDot).toHaveBeenCalledTimes(1);
    expect((await b.json()).skipped).toBeUndefined();
  });
});
