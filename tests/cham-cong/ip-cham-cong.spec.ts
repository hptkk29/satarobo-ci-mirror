// tests/cham-cong/ip-cham-cong.spec.ts — P2.4 DANH SÁCH IP qua CHÍNH `recordTimeLog`, Postgres thật.
// Đồng hồ đóng băng (luật 19): mỗi ca một người + một mốc giờ riêng (luật 18 — không mượn lượt của ca trước).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/ip] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-ip24";
const NOW = new Date("2026-10-07T01:30:00Z"); // 08:30 giờ VN
const NGAY = new Date(Date.UTC(2026, 9, 7));
const TRONG = "203.0.113.45";
const NGOAI = "198.51.100.7";

d("[IPD] danh sách IP khi chấm công", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let tl: typeof import("../../lib/cham-cong/timelog");
  let cs = "";
  let wlCo = ""; // điểm ĐÃ khai danh sách
  let wlChua = ""; // điểm CHƯA khai
  let caiCu: unknown;

  const datCheDo = (v: string) =>
    db.systemSetting.upsert({ where: { key: "shift.ipCheDo" }, create: { key: "shift.ipCheDo", valueJson: v }, update: { valueJson: v } });

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  let so = 0;
  const nguoi = async (placeMode: "AT_UNITS" | "OFFSITE" | null = null) => {
    const id = (
      await db.user.create({ data: { email: `nv${++so}@${TAG}.test`, name: `NV ip ${so}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })
    ).id;
    if (placeMode) {
      const tpl = await db.shiftTemplate.findFirstOrThrow({ where: { code: "HC", centerId: null }, select: { id: true } });
      await db.shiftAssignment.create({
        data: { userId: id, centerId: cs, workDate: NGAY, templateId: tpl.id, templateCode: "HC", segments: [], source: "IMPORT", placeMode },
      });
    }
    return id;
  };
  const cham = (userId: string, wl: string, ipTinCay: string | null | undefined) =>
    tl.recordTimeLog({ userId, workLocationId: wl, direction: "CHECK_IN", ipTinCay, ip: ipTinCay ?? null, now: NOW });

  beforeAll(async () => {
    tl = await import("../../lib/cham-cong/timelog");
    const { seedShiftTemplates } = await import("../../lib/cham-cong/seed-core");
    await seedShiftTemplates(db);
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS ip", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await cleanup();
    wlCo = (
      await db.workLocation.upsert({
        where: { code: `${TAG}-A` },
        update: { ipAllowlist: ["203.0.113.0/24", "2001:db8::/32"], geofenceEnabled: false, isActive: true },
        create: { code: `${TAG}-A`, name: "Quầy A", centerId: cs, geofenceEnabled: false, ipAllowlist: ["203.0.113.0/24", "2001:db8::/32"] },
        select: { id: true },
      })
    ).id;
    wlChua = (
      await db.workLocation.upsert({
        where: { code: `${TAG}-B` },
        update: { ipAllowlist: [], geofenceEnabled: false, isActive: true },
        create: { code: `${TAG}-B`, name: "Quầy B", centerId: cs, geofenceEnabled: false },
        select: { id: true },
      })
    ).id;
    caiCu = (await db.systemSetting.findUnique({ where: { key: "shift.ipCheDo" } }))?.valueJson;
  });

  afterAll(async () => {
    if (caiCu === undefined) await db.systemSetting.deleteMany({ where: { key: "shift.ipCheDo" } });
    else await datCheDo(caiCu as string);
    await cleanup();
    await db.$disconnect();
  });

  it("[IPD-01] OFF (mặc định): không kiểm — ipRule NULL, lượt ghi bình thường", async () => {
    await datCheDo("OFF");
    const r = await cham(await nguoi(), wlCo, NGOAI);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: r.logId } })).ipRule).toBeNull();
  });

  it("[IPD-02] OBSERVE: ngoài danh sách VẪN ghi, không cờ, nhưng ipRule = NGOAI_DS (dữ liệu 'sẽ bị chặn')", async () => {
    await datCheDo("OBSERVE");
    const r = await cham(await nguoi(), wlCo, NGOAI);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.flags).not.toContain("IP_NGOAI_DANH_SACH");
    expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: r.logId } })).ipRule).toBe("NGOAI_DS");
  });

  it("[IPD-03] WARNING: ngoài danh sách ghi + cờ IP_NGOAI_DANH_SACH; trong dải IPv6 ghi đúng mục đã khớp", async () => {
    await datCheDo("WARNING");
    const r = await cham(await nguoi(), wlCo, NGOAI);
    expect(r.ok && r.flags).toContain("IP_NGOAI_DANH_SACH");
    const r6 = await cham(await nguoi(), wlCo, "2001:db8:1::9");
    expect(r6.ok).toBe(true);
    if (r6.ok) expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: r6.logId } })).ipRule).toBe("2001:db8::/32");
  });

  it("[IPD-04] ENFORCE: ngoài danh sách bị TỪ CHỐI (IP_NOT_ALLOWED, không ghi lượt ACCEPTED); trong danh sách qua", async () => {
    await datCheDo("ENFORCE");
    const nv = await nguoi();
    expect(await cham(nv, wlCo, NGOAI)).toMatchObject({ ok: false, rejectReason: "IP_NOT_ALLOWED" });
    expect(await db.staffTimeLog.count({ where: { userId: nv, result: "ACCEPTED" } })).toBe(0);
    const r = await cham(await nguoi(), wlCo, TRONG);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: r.logId } })).ipRule).toBe("203.0.113.0/24");
  });

  it("[IPD-05] ENFORCE nhưng KHÔNG chặn: điểm chưa khai danh sách · không đọc được IP tin cậy (gắn cờ)", async () => {
    await datCheDo("ENFORCE");
    const a = await cham(await nguoi(), wlChua, NGOAI);
    expect(a.ok).toBe(true);
    if (a.ok) expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: a.logId } })).ipRule).toBe("CHUA_KHAI");
    const b = await cham(await nguoi(), wlCo, null);
    expect(b.ok && b.flags).toContain("IP_KHONG_XAC_DINH");
    const c = await cham(await nguoi(), wlCo, undefined); // chỗ gọi không truyền ⇒ như không đọc được
    expect(c.ok).toBe(true);
  });

  it("[IPD-06] ENFORCE + ngữ cảnh miễn (ca công tác OFFSITE) ⇒ không chặn, ipRule = MIEN:<lý do>", async () => {
    await datCheDo("ENFORCE");
    const r = await cham(await nguoi("OFFSITE"), wlCo, NGOAI);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: r.logId } })).ipRule).toBe("MIEN:CA_CONG_TAC");
  });
});
