// Ca [NLC-*] — CHUÔNG THẬT của ngoại lệ hoá đơn tức thời, KHÔNG giả `notifyStaff`: đo cái mà bộ giả không thấy được — hệ thông báo cập nhật nội dung của khoá đã có nhưng KHÔNG rung lại và giữ
// trạng thái "đã đọc". Nếu hai lỗi cùng cơ sở trong cùng ngày dùng chung khoá thì lỗi thứ hai bị nuốt im lặng; mỗi ngoại lệ một khoá ⇒ mỗi lỗi một dòng chưa đọc.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-ngoai-le-tuc-thoi-chuong-that-db.test.ts
// Fixture tự dựng + tự dọn theo tiền tố; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Đồng hồ ĐÓNG BĂNG.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { seedUser } from "../e2e/_helpers/seed";
import { baoNgoaiLeTucThoi } from "@/lib/finance/hoa-don/ngoai-le-tuc-thoi-db";

if (!RUN_DB_TESTS) console.warn(`[NLC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-nlc-";
const CS1 = `${T}cs1`;
const OU_HO = `${T}ou-ho`;
const OU1 = `${T}ou1`;
const DON1 = `${T}don1`;
const HD1 = `${T}hd1`;
const VAI = `${T}vai`;
const NOW = new Date("2026-11-02T03:00:00Z");

async function don() {
  const nguoi = await db.user.findMany({ where: { email: { endsWith: `@${T}test` } }, select: { id: true } });
  const ids = nguoi.map((u) => u.id);
  await db.staffNotification.deleteMany({ where: { userId: { in: ids } } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS1 } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.userOrgRole.deleteMany({ where: { OR: [{ userId: { in: ids } }, { roleId: VAI }] } });
  await db.rolePermission.deleteMany({ where: { roleId: VAI } });
  await db.roleDef.deleteMany({ where: { id: VAI } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.orgUnit.deleteMany({ where: { id: OU_HO } });
  await db.center.deleteMany({ where: { id: CS1 } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"] } } });
}

async function dungFixture() {
  await don();
  for (const key of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"]) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: true }, update: { valueJson: true } });
  await db.center.create({ data: { id: CS1, name: "CS1 NLC", slug: CS1, address: "x" } });
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO NLC", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "ĐV CS1 NLC", centerId: CS1, parentId: OU_HO, path: `/${T}ho/${T}ou1/`, depth: 1 } });
  await db.order.create({ data: { id: DON1, code: "ORD-269974-000001", type: "COURSE", status: "CONFIRMED", customerName: "PH NLC", customerPhone: "0328545399", totalAmount: 5_000_000, centerId: CS1 } });
  await db.hoaDonDienTu.create({ data: { id: HD1, orderId: DON1, centerId: CS1, trangThai: "LOI_PHAT_HANH", tongTien: 5_000_000, taoBoiId: `${T}kt` } });
  await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán NLC" } });
  await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
}

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[NLC-01] hệ thông báo THẬT: mỗi ngoại lệ tức thời là một dòng chưa đọc riêng", () => {
  it("lỗi thứ nhất bị người nhận ĐỌC rồi, lỗi thứ hai cùng ngày cùng cơ sở vẫn ra dòng MỚI chưa đọc (không bị cập nhật đè lên dòng đã đọc)", async () => {
    const u = await seedUser({ email: `kt@${T}test`, role: "TEACHER", name: "kt" });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: OU1, roleId: VAI, grantedById: u.id } });
    expect((await baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-1", now: NOW })).ket).toBe("TAO");
    const dau = await db.staffNotification.findMany({ where: { userId: u.id } });
    expect(dau).toHaveLength(1);
    expect(dau[0]!.dedupeKey.startsWith("hoa-don.ngoai-le:tuc-thoi:")).toBe(true);
    await db.staffNotification.update({ where: { id: dau[0]!.id }, data: { readAt: new Date("2026-11-02T03:00:30Z") } });
    expect((await baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-2", now: new Date("2026-11-02T03:05:00Z") })).ket).toBe("TAO");
    const sau = await db.staffNotification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" } });
    expect(sau).toHaveLength(2);
    expect(sau.filter((x) => x.readAt === null)).toHaveLength(1);
    expect(sau[0]!.readAt).not.toBeNull();
    expect(new Set(sau.map((x) => x.dedupeKey)).size).toBe(2);
    // Nội dung không PII.
    for (const x of sau) expect(`${x.title} ${x.body}`).not.toMatch(/PH NLC|0328545399|ORD-|\d{6,}/);
  });

  it("đối chứng: gọi lại CÙNG lần lỗi không đẻ dòng thứ hai", async () => {
    const u = await seedUser({ email: `kt@${T}test`, role: "TEACHER", name: "kt" });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: OU1, roleId: VAI, grantedById: u.id } });
    await baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-1", now: NOW });
    await baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-1", now: NOW });
    expect(await db.staffNotification.count({ where: { userId: u.id } })).toBe(1);
  });
});
