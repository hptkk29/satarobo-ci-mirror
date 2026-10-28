// tests/cham-cong/xac-nhan-cong.spec.ts — P2.2 XÁC NHẬN CÔNG + KHIẾU NẠI CÔNG trên Postgres thật.
// Đồng hồ đóng băng (luật 19): kỳ 2026-06 đã qua so với NOW. Khoá kỳ là theo (cơ sở × kỳ) nên mỗi nhóm ca
// dùng một cơ sở riêng — một ca khoá kỳ không làm hỏng ca khác (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/xac-nhan-cong] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-xnc22";
const KEY = "2026-06";
const NOW = new Date("2026-07-01T03:00:00Z");
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const D2 = utc(2026, 6, 2);
const D3 = utc(2026, 6, 3);

d("[XN-DB] xác nhận công + khiếu nại công", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let xn: typeof import("../../lib/cham-cong/xac-nhan-cong");
  let period: typeof import("../../lib/cham-cong/period");
  let recompute: typeof import("../../lib/cham-cong/recompute");
  const cs: Record<string, string> = {};
  let tplS = "";
  let caiCu: unknown;
  const ql = { id: "", name: "QL xnc" };
  const ql2 = { id: "", name: "QL2 xnc" };
  const seg = [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }];

  const datBat = (v: boolean) =>
    db.systemSetting.upsert({ where: { key: "shift.xacNhanCongBat" }, create: { key: "shift.xacNhanCongBat", valueJson: v }, update: { valueJson: v } });

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const centerIds = Object.values(cs);
    const kns = await db.attendanceDispute.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const xns = await db.attendanceConfirmation.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...kns.map((k) => k.id), ...xns.map((x) => x.id), ...centerIds.map((c) => `${c}:${KEY}`)] } } });
    await db.attendanceDispute.deleteMany({ where: { userId: { in: ids } } });
    await db.attendanceConfirmation.deleteMany({ where: { userId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    if (centerIds.length) await db.attendancePeriod.deleteMany({ where: { centerId: { in: centerIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  let soNguoi = 0;
  /** Người mới có ca S ngày 02 + 03/06 ở cơ sở `c`, đã tính công. */
  async function nguoiCoCong(c: string): Promise<string> {
    const id = (
      await db.user.create({
        data: { email: `nv${++soNguoi}@${TAG}.test`, name: `NV xnc ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs[c] },
        select: { id: true },
      })
    ).id;
    await db.shiftAssignment.createMany({
      data: [D2, D3].map((workDate) => ({ userId: id, centerId: cs[c]!, workDate, templateId: tplS, templateCode: "S", segments: seg, source: "IMPORT" as const })),
    });
    await recompute.recomputeRange([id], D2, D3);
    return id;
  }
  const cuaToi = async (uid: string, c: string) => (await xn.docBangCongCuaToi(uid, KEY, NOW)).find((b) => b.centerId === cs[c])!;
  const xacNhan = (uid: string, c: string, vanTay: string) =>
    xn.xacNhanCong({ userId: uid, userName: "NV", centerId: cs[c]!, periodKey: KEY, vanTayDaXem: vanTay, now: NOW });
  const moKN = (uid: string, c: string, category: "MISSING_CHECKIN" | "OTHER" = "MISSING_CHECKIN") =>
    xn.moKhieuNai({ userId: uid, userName: "NV", centerId: cs[c]!, periodKey: KEY, workDate: D2, category, moTa: "Ngày 02 tôi có quét vào nhưng không thấy", now: NOW });
  const chuyen = (id: string, hanhDong: Parameters<typeof xn.chuyenTrangThaiKhieuNai>[0]["hanhDong"], vai: "NV" | "QL", actor: { id: string; name: string }, ghiChu = "đã kiểm tra và xử lý") =>
    xn.chuyenTrangThaiKhieuNai({ disputeId: id, hanhDong, vai, ghiChu, linkedRequestId: null, actor, now: NOW });
  const khoa = (c: string, boQuaKhieuNai = false) =>
    period.lockPeriod({ centerId: cs[c]!, periodKey: KEY, actorId: ql.id, reason: "test chốt", boQuaKhieuNai, now: NOW });

  beforeAll(async () => {
    xn = await import("../../lib/cham-cong/xac-nhan-cong");
    period = await import("../../lib/cham-cong/period");
    recompute = await import("../../lib/cham-cong/recompute");
    await seedShiftTemplates(db);
    for (const c of ["A", "B", "C", "D"]) {
      cs[c] = (await db.center.upsert({ where: { slug: `${TAG}-${c.toLowerCase()}` }, update: {}, create: { slug: `${TAG}-${c.toLowerCase()}`, name: `CS ${c} xnc`, address: "x", code: `${TAG}-${c}` }, select: { id: true } })).id;
    }
    await cleanup();
    ql.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: ql.name, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs.A }, select: { id: true } })).id;
    ql2.id = (await db.user.create({ data: { email: `ql2@${TAG}.test`, name: ql2.name, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs.A }, select: { id: true } })).id;
    tplS = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } })).id;
    caiCu = (await db.systemSetting.findUnique({ where: { key: "shift.xacNhanCongBat" } }))?.valueJson;
    await datBat(true);
  });

  afterAll(async () => {
    if (caiCu === undefined) await db.systemSetting.deleteMany({ where: { key: "shift.xacNhanCongBat" } });
    else await datBat(caiCu as boolean);
    await cleanup();
    await db.$disconnect();
  });

  it("[XN-01] xác nhận đúng bản đã xem ⇒ DA_XAC_NHAN + audit; HR đổi số sau đó ⇒ CAN_XAC_NHAN_LAI; bấm lại bằng bản cũ bị từ chối", async () => {
    const nv = await nguoiCoCong("A");
    const a = await cuaToi(nv, "A");
    expect(a.trangThai).toBe("CHUA_XAC_NHAN");
    expect(a.anhChup.tong.cong).toBe(2);
    expect(await xacNhan(nv, "A", a.vanTay)).toEqual({ ok: true });
    expect((await cuaToi(nv, "A")).trangThai).toBe("DA_XAC_NHAN");
    expect(await db.auditLog.count({ where: { action: "CONFIRM_ATTENDANCE", actorId: nv } })).toBe(1);

    // HR ghi đè ngày 02 thành nửa công — dữ liệu NV đã xác nhận không còn là dữ liệu hiện tại.
    expect((await period.setDayOverride({ now: NOW, userId: nv, workDate: D2, units: 0.5, note: "về sớm có phép", actorId: ql.id })).ok).toBe(true);
    const b = await cuaToi(nv, "A");
    expect(b.trangThai).toBe("CAN_XAC_NHAN_LAI");
    expect(b.anhChupDaXacNhan?.tong.cong).toBe(2);
    expect(b.anhChup.tong.cong).toBe(1.5);
    // NV đang nhìn tab cũ (bản A) bấm xác nhận ⇒ từ chối, không ghi.
    expect(await xacNhan(nv, "A", a.vanTay)).toMatchObject({ ok: false, doiMoi: true });
    expect((await cuaToi(nv, "A")).trangThai).toBe("CAN_XAC_NHAN_LAI");
    expect(await xacNhan(nv, "A", b.vanTay)).toEqual({ ok: true });
    expect((await cuaToi(nv, "A")).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[XN-02] vân tay ỔN ĐỊNH qua lượt tính lại + khoá của lockPeriod — xác nhận trước khi chốt vẫn còn hiệu lực sau chốt", async () => {
    const nv = await nguoiCoCong("C");
    expect(await xacNhan(nv, "C", (await cuaToi(nv, "C")).vanTay)).toEqual({ ok: true });
    const r = await khoa("C");
    expect(r.ok).toBe(true);
    expect((await cuaToi(nv, "C")).trangThai).toBe("DA_XAC_NHAN");
    // Kỳ đã chốt ⇒ không mở khiếu nại mới.
    expect(await moKN(nv, "C")).toMatchObject({ ok: false, error: expect.stringMatching(/đã chốt/) });
  });

  it("[XN-03] khiếu nại NGHIÊM TRỌNG đang mở chặn chốt kỳ (kể cả ở trạng thái CHỜ NV); kết luận xong thì chốt được; 'Khác' không chặn", async () => {
    const nv = await nguoiCoCong("B");
    const nv2 = await nguoiCoCong("B");
    const k = await moKN(nv, "B");
    expect(k.ok).toBe(true);
    if (!k.ok) return;
    expect((await moKN(nv2, "B", "OTHER")).ok).toBe(true);
    expect(await khoa("B")).toMatchObject({ ok: false, error: expect.stringMatching(/còn 1 khiếu nại/) });
    expect((await chuyen(k.id, "HOI_LAI", "QL", ql)).ok).toBe(true); // → WAITING_EMPLOYEE: vẫn chặn
    expect(await khoa("B")).toMatchObject({ ok: false });
    // NV còn khiếu nại mở ⇒ chưa xác nhận được.
    expect(await xacNhan(nv, "B", (await cuaToi(nv, "B")).vanTay)).toMatchObject({ ok: false, error: expect.stringMatching(/khiếu nại/) });
    expect((await chuyen(k.id, "TRA_LOI", "NV", { id: nv, name: "NV" }, "ảnh chụp màn hình quét lúc 7:40")).ok).toBe(true);
    expect((await chuyen(k.id, "GIAI_QUYET", "QL", ql, "đã duyệt đơn chỉnh công bù lượt vào")).ok).toBe(true);
    expect(await xacNhan(nv, "B", (await cuaToi(nv, "B")).vanTay)).toEqual({ ok: true });
    expect((await khoa("B")).ok).toBe(true);
    const hs = await db.attendanceDisputeMessage.findMany({ where: { disputeId: k.id }, orderBy: { createdAt: "asc" }, select: { statusTo: true } });
    expect(hs.map((h) => h.statusTo)).toEqual(["OPEN", "WAITING_EMPLOYEE", "IN_REVIEW", "RESOLVED"]);
  });

  it("[XN-04] đường vượt: boQuaKhieuNai = true thì chốt được dù còn khiếu nại mở", async () => {
    const nv = await nguoiCoCong("D");
    expect((await moKN(nv, "D")).ok).toBe(true);
    expect((await khoa("D")).ok).toBe(false);
    expect((await khoa("D", true)).ok).toBe(true);
  });

  it("[XN-05] HAI quản lý cùng kết luận một khiếu nại ⇒ đúng MỘT thành công", async () => {
    const nv = await nguoiCoCong("A");
    const k = await moKN(nv, "A");
    if (!k.ok) throw new Error(k.error);
    const kq = await Promise.all([chuyen(k.id, "GIAI_QUYET", "QL", ql), chuyen(k.id, "TU_CHOI", "QL", ql2, "không đủ căn cứ")]);
    expect(kq.filter((x) => x.ok)).toHaveLength(1);
    expect(await db.attendanceDisputeMessage.count({ where: { disputeId: k.id } })).toBe(2);
  });

  it("[XN-06] vai + chủ sở hữu: NV không tự kết luận, NV khác không đụng khiếu nại của người này", async () => {
    const nv = await nguoiCoCong("A");
    const khac = await nguoiCoCong("A");
    const k = await moKN(nv, "A");
    if (!k.ok) throw new Error(k.error);
    expect(await chuyen(k.id, "GIAI_QUYET", "NV", { id: nv, name: "NV" })).toMatchObject({ ok: false });
    expect(await chuyen(k.id, "RUT", "NV", { id: khac, name: "khác" })).toMatchObject({ ok: false, error: expect.stringMatching(/không phải khiếu nại của bạn/) });
    expect((await chuyen(k.id, "RUT", "NV", { id: nv, name: "NV" }, "")).ok).toBe(true);
    expect((await db.attendanceDispute.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("CLOSED");
  });

  it("[XN-07] báo cáo quản lý: đúng tập người của kỳ, trạng thái từng người, số khiếu nại mở", async () => {
    const r = await xn.baoCaoXacNhan(cs.A!, KEY);
    const nguoi = await db.shiftAssignment.findMany({ where: { centerId: cs.A }, select: { userId: true }, distinct: ["userId"] });
    expect(r.dong.map((x) => x.userId).sort()).toEqual(nguoi.map((x) => x.userId).sort());
    expect(r.dong.filter((x) => x.trangThai === "DA_XAC_NHAN")).toHaveLength(1); // người của XN-01
    expect(r.dong.some((x) => x.soKhieuNaiMo === 0)).toBe(true);
  });

  it("[XN-08] công tắc TẮT ⇒ không xác nhận, không khiếu nại, và cổng khoá kỳ không chạy", async () => {
    await datBat(false);
    try {
      const nv = await nguoiCoCong("A");
      expect(await xacNhan(nv, "A", (await cuaToi(nv, "A")).vanTay)).toMatchObject({ ok: false, error: expect.stringMatching(/đang tắt/) });
      expect(await moKN(nv, "A")).toMatchObject({ ok: false, error: expect.stringMatching(/đang tắt/) });
      // Khiếu nại cũ còn mở (từ lúc bật) không chặn chốt khi đã tắt.
      await db.attendanceDispute.create({ data: { userId: nv, centerId: cs.A!, periodKey: KEY, category: "WRONG_SHIFT", critical: true, status: "OPEN", description: "cũ" } });
      expect((await khoa("A")).ok).toBe(true);
    } finally {
      await datBat(true);
    }
  });
});
