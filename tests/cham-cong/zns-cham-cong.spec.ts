// tests/cham-cong/zns-cham-cong.spec.ts — P2.6 bộ chuyển ZNS nhân sự + "mời xác nhận kỳ" trên Postgres thật.
// Nhà cung cấp là BẢN GIẢ (đếm lượt gọi) — không có lượt gọi Zalo thật nào. Đồng hồ đóng băng (luật 19).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import type { ZaloProvider } from "../../lib/zalo/provider";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/zns] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-zns26";
const KEY = "2026-06";
const NOW = new Date("2026-07-01T03:00:00Z");
const D2 = new Date(Date.UTC(2026, 5, 2));
const D3 = new Date(Date.UTC(2026, 5, 3));
const SDT = "84999260601";
const MAU = "616260";
const KHOA = ["shift.znsBat", "shift.znsMauKhieuNai", "shift.znsMauMoiXacNhan", "shift.xacNhanCongBat"] as const;

d("[ZNS-DB] ZNS nhân sự qua DomainEvent — nhà cung cấp giả", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let zns: typeof import("../../lib/cham-cong/zns-cham-cong");
  let xn: typeof import("../../lib/cham-cong/xac-nhan-cong");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  const caiCu = new Map<string, unknown>();
  let nv = "";
  let cs = "";
  let tplS = "";
  const seg = [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }];

  const dat = (key: string, v: unknown) =>
    db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v as never }, update: { valueJson: v as never } });

  /** Nhà cung cấp giả: đếm lượt gọi; `loi` = số lượt đầu trả lỗi. */
  function nhaCungCap(loi = 0) {
    const send = vi.fn(async () => (send.mock.calls.length <= loi ? { ok: false, error: "giả lập lỗi" } : { ok: true, providerMessageId: "gia-1" }));
    const p: ZaloProvider = { name: "gia", isConfigured: () => true, isLive: () => true, send };
    return { p, send };
  }
  const suKien = (over: Record<string, unknown> = {}) => ({
    id: "ev-gia",
    type: "cham-cong.zns",
    payload: { loai: "KHIEU_NAI_XU_LY", userId: nv, ky: KEY, ketQua: "Giải quyết", ...over },
  });

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.zaloMessageLog.deleteMany({ where: { toPhone: SDT } });
    await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `zns.${TAG}` } } });
    if (cs) await db.auditLog.deleteMany({ where: { entityId: `${cs}:${KEY}` } });
    await db.attendanceConfirmation.deleteMany({ where: { userId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    zns = await import("../../lib/cham-cong/zns-cham-cong");
    xn = await import("../../lib/cham-cong/xac-nhan-cong");
    recompute = await import("../../lib/cham-cong/recompute");
    for (const k of KHOA) caiCu.set(k, (await db.systemSetting.findUnique({ where: { key: k } }))?.valueJson);
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: TAG }, update: {}, create: { slug: TAG, name: "CS zns", address: "x", code: TAG }, select: { id: true } })).id;
    await cleanup();
    tplS = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } })).id;
    nv = (await db.user.create({ data: { email: `nv@${TAG}.test`, name: "NV zns", phone: SDT, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
  });

  beforeEach(async () => {
    await db.zaloMessageLog.deleteMany({ where: { toPhone: SDT } });
    await dat("shift.znsBat", true);
    await dat("shift.znsMauKhieuNai", MAU);
    await dat("shift.znsMauMoiXacNhan", MAU);
  });

  afterAll(async () => {
    for (const k of KHOA) {
      const v = caiCu.get(k);
      if (v === undefined) await db.systemSetting.deleteMany({ where: { key: k } });
      else await dat(k, v);
    }
    await cleanup();
    await db.$disconnect();
  });

  it("[ZNS-DB-01] công tắc TẮT ⇒ không ghi sự kiện, handler không gọi nhà cung cấp", async () => {
    await dat("shift.znsBat", false);
    await zns.phatZnsChamCong({ loai: "KHIEU_NAI_XU_LY", userId: nv, ky: KEY, ketQua: "x", dedupeKey: `${TAG}:tat` });
    expect(await db.domainEvent.count({ where: { dedupeKey: `zns.${TAG}:tat` } })).toBe(0);
    const { p, send } = nhaCungCap();
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: false, lyDo: "TAT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("[ZNS-DB-02] bật nhưng CHƯA CÓ MẪU ⇒ 0 lượt gọi, dù nhà cung cấp đang 'live'", async () => {
    await dat("shift.znsMauKhieuNai", "");
    const { p, send } = nhaCungCap();
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: false, lyDo: "CHUA_CO_MAU" });
    expect(send).not.toHaveBeenCalled();
    expect(await db.zaloMessageLog.count({ where: { toPhone: SDT } })).toBe(0);
  });

  it("[ZNS-DB-03] đủ điều kiện ⇒ MỘT lượt gọi đúng mẫu + đúng khuôn tham số; phát lại cùng sự kiện ⇒ không gửi đôi", async () => {
    const { p, send } = nhaCungCap();
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ toPhone: SDT, templateKey: MAU, params: { ten: "NV zns", ky: "06/2026", ket_qua: "Giải quyết" } });
    expect(await db.zaloMessageLog.count({ where: { toPhone: SDT, status: "SENT" } })).toBe(1);
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: false, lyDo: "DA_GUI" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("[ZNS-DB-04] gửi LỖI ⇒ handler NÉM (dispatcher thử lại); lượt sau thành công; lượt thứ ba không gửi lại", async () => {
    const { p, send } = nhaCungCap(1);
    await expect(zns.xuLyZnsChamCong(suKien(), p)).rejects.toThrow(/thử lại/);
    expect(await db.zaloMessageLog.count({ where: { toPhone: SDT, status: "FAILED" } })).toBe(1);
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: true });
    expect(await zns.xuLyZnsChamCong(suKien(), p)).toEqual({ gui: false, lyDo: "DA_GUI" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("[ZNS-DB-05] cùng khoá chống trùng xếp hai lần ⇒ MỘT sự kiện (bấm đúp không xếp hai tin)", async () => {
    for (let i = 0; i < 2; i++) await zns.phatZnsChamCong({ loai: "MOI_XAC_NHAN", userId: nv, ky: KEY, ketQua: null, dedupeKey: `${TAG}:dup` });
    const evs = await db.domainEvent.findMany({ where: { dedupeKey: `zns.${TAG}:dup` }, select: { type: true, payloadJson: true } });
    expect(evs).toHaveLength(1);
    expect(evs[0]!.type).toBe("cham-cong.zns");
    // Payload chỉ mang khoá — không tên, không SĐT nằm lại trong outbox.
    expect(JSON.stringify(evs[0]!.payloadJson)).not.toMatch(new RegExp(`${SDT}|NV zns`));
  });

  it("[ZNS-DB-06] không SĐT ⇒ không gửi, không ném (thử lại cũng vô ích)", async () => {
    const { p, send } = nhaCungCap();
    const khong = (await db.user.create({ data: { email: `ks@${TAG}.test`, name: "Không số", role: "TEACHER", roles: ["TEACHER"], password: "x" }, select: { id: true } })).id;
    expect(await zns.xuLyZnsChamCong(suKien({ userId: khong }), p)).toEqual({ gui: false, lyDo: "KHONG_SDT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("[MXN-DB-01] mời xác nhận: chỉ người CHƯA xác nhận; công tắc tắt / kỳ chưa hết ⇒ từ chối; con số trên nút = danh sách gửi", async () => {
    const actor = { id: nv, name: "QL" };
    const nguoi = async (n: number) => {
      const id = (await db.user.create({ data: { email: `m${n}@${TAG}.test`, name: `M${n}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
      await db.shiftAssignment.createMany({
        data: [D2, D3].map((workDate) => ({ userId: id, centerId: cs, workDate, templateId: tplS, templateCode: "S", segments: seg, source: "IMPORT" as const })),
      });
      await recompute.recomputeRange([id], D2, D3);
      return id;
    };
    const a = await nguoi(1);
    const b = await nguoi(2);
    await dat("shift.xacNhanCongBat", true);
    const bangB = (await xn.docBangCongCuaToi(b, KEY, NOW)).find((x) => x.centerId === cs)!;
    expect(await xn.xacNhanCong({ userId: b, userName: "M2", centerId: cs, periodKey: KEY, vanTayDaXem: bangB.vanTay, now: NOW })).toEqual({ ok: true });

    const r = await xn.nguoiCanMoiXacNhan({ centerId: cs, periodKey: KEY, actor, now: NOW });
    expect(r.ok && r.moi.map((m) => m.userId)).toEqual([a]);
    expect((await xn.baoCaoXacNhan(cs, KEY)).soCanMoi).toBe(1);
    expect(await db.auditLog.count({ where: { action: "INVITE_CONFIRM_ATTENDANCE", entityId: `${cs}:${KEY}` } })).toBe(1);

    expect(await xn.nguoiCanMoiXacNhan({ centerId: cs, periodKey: KEY, actor, now: new Date("2026-06-20T03:00:00Z") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/chưa kết thúc/),
    });
    await dat("shift.xacNhanCongBat", false);
    expect(await xn.nguoiCanMoiXacNhan({ centerId: cs, periodKey: KEY, actor, now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/đang tắt/) });
  });
});
