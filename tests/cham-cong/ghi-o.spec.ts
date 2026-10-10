// tests/cham-cong/ghi-o.spec.ts — service ghi ô lưới ca (`chayLenhO`), tầng DB THẬT. T04, 07/10/2026.
//
// Thứ chỉ tầng này trả lời được: HAI LƯỢT GHI CHỒNG NHAU. Trước T04 ba đường ghi ô đọc-huỷ-tạo không khoá; hai lượt
// chồng nhau đụng chỉ mục "một ô ACTIVE mỗi người mỗi ngày" (P2002 — CI đã đỏ vì đúng chuyện này ngày 10/09), và đường
// sửa tay (không transaction) có thể để ngày đó KHÔNG CÒN ô ACTIVE nào. Các ca dưới đây chạy `Promise.all` thật.
//
// Postgres LOCAL (satarobo_test); tự SKIP nếu không có. Mỗi ca XANH khi chạy MỘT MÌNH (luật 18).
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import type { CenterMap } from "../../lib/cham-cong/place";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn("[cham-cong/ghi-o] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test");

const TAG = "cc-ghio";
const ngay = (day: number, month1 = 9) => new Date(Date.UTC(2026, month1 - 1, day));
const HOM_NAY = ngay(15);

d("chayLenhO — service ghi ô, DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/cham-cong/ghi-o");
  let cs1 = "";
  let cs2 = "";
  let hoc = "";
  let u1 = "";
  let u2 = "";
  let map: CenterMap;

  const ctx = (over: Partial<import("../../lib/cham-cong/ghi-o").NguCanhGhiO> = {}): import("../../lib/cham-cong/ghi-o").NguCanhGhiO => ({
    centerMap: map,
    canWriteCenter: () => true,
    actorUserId: u1,
    homNay: HOM_NAY,
    ghiDeNhapTay: false,
    boQuaKyDaChot: false,
    ...over,
  });
  const lenh = (userId: string, day: number, code: string | null, source: import("../../lib/cham-cong/ghi-o-luat").NguonO = "MANUAL", homeUnit = "CS1") => ({
    userId,
    workDate: ngay(day),
    code,
    homeUnit,
    source,
  });
  const chay = (lenhs: ReturnType<typeof lenh>[], c = ctx(), ghiThat = true) => svc.chayLenhO({ ctx: c, lenhs, ghiThat });
  const conActive = (userId: string, day?: number) =>
    db.shiftAssignment.findMany({ where: { userId, status: "ACTIVE", ...(day ? { workDate: ngay(day) } : {}) }, orderBy: { workDate: "asc" } });

  const donDep = async () => {
    const us = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = us.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: "attday:" }, OR: ids.map((id) => ({ dedupeKey: { contains: id } })) } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2, hoc].filter(Boolean) }, periodKey: { in: ["2026-09", "2026-10"] } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: "ZZ" } } });
    await db.shiftTemplate.deleteMany({ where: { code: "S", centerId: { not: null } } });
  };

  beforeAll(async () => {
    svc = await import("../../lib/cham-cong/ghi-o");
    await seedShiftTemplates(db);
    const mk = async (slug: string, code: string) =>
      (await db.center.upsert({ where: { slug: `${TAG}-${slug}` }, update: {}, create: { slug: `${TAG}-${slug}`, name: `GHIO ${slug}`, address: "x", code }, select: { id: true } })).id;
    cs1 = await mk("cs1", "GO1");
    cs2 = await mk("cs2", "GO2");
    hoc = await mk("hoc", "GOH");
    await donDep();
    const mkU = async (i: number) =>
      (await db.user.create({ data: { email: `u${i}@${TAG}.test`, name: `GHIO ${i}`, role: "HR", roles: ["HR"], password: "x", centerId: cs1 }, select: { id: true } })).id;
    u1 = await mkU(1);
    u2 = await mkU(2);
    map = { byCode: { CS1: { centerId: cs1, orgUnitId: null }, CS2: { centerId: cs2, orgUnitId: null } }, hoCenterId: hoc };
  });

  beforeEach(async () => {
    await db.shiftAssignment.deleteMany({ where: { userId: { in: [u1, u2] } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2, hoc] }, periodKey: { in: ["2026-09", "2026-10"] } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: "ZZ" } } });
    await db.shiftTemplate.deleteMany({ where: { code: "S", centerId: { not: null } } });
    await db.domainEvent.deleteMany({ where: { OR: [u1, u2].map((id) => ({ dedupeKey: { contains: id } })) } });
  });

  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  it("[GOS-01] TẠO → ghi lại y hệt = GIỮ (không xoay vòng ô) → đổi mã = THAY → xoá = XOA; luôn đúng MỘT ô ACTIVE hoặc không ô nào", async () => {
    expect((await chay([lenh(u1, 20, "S")])).ketQua[0]).toMatchObject({ ket: "TAO" });
    expect((await conActive(u1, 20))).toHaveLength(1);
    const idDau = (await conActive(u1, 20))[0]!.id;
    expect((await chay([lenh(u1, 20, "S")])).ketQua[0]).toMatchObject({ ket: "GIU" });
    expect((await conActive(u1, 20))[0]!.id).toBe(idDau); // GIỮ = không đụng dòng nào
    expect((await chay([lenh(u1, 20, "CG")])).ketQua[0]).toMatchObject({ ket: "THAY" });
    const sau = await conActive(u1, 20);
    expect(sau).toHaveLength(1);
    expect(sau[0]!.templateCode).toBe("CG");
    expect((await chay([lenh(u1, 20, null)])).ketQua[0]).toMatchObject({ ket: "XOA" });
    expect(await conActive(u1, 20)).toHaveLength(0);
    // Lịch sử còn nguyên: các ô cũ là CANCELLED, không bị xoá cứng.
    expect(await db.shiftAssignment.count({ where: { userId: u1, workDate: ngay(20), status: "CANCELLED" } })).toBe(2);
  });

  it("[GOS-02] HAI LƯỢT SỬA TAY CÙNG MỘT Ô chạy ĐỒNG THỜI: không P2002, không ngày trống — đúng MỘT ô ACTIVE, là mã của một trong hai lượt", async () => {
    const kq = await Promise.allSettled([chay([lenh(u1, 21, "S")]), chay([lenh(u1, 21, "CG")])]);
    expect(kq.map((k) => k.status)).toEqual(["fulfilled", "fulfilled"]);
    const ac = await conActive(u1, 21);
    expect(ac).toHaveLength(1);
    expect(["S", "CG"]).toContain(ac[0]!.templateCode);
  });

  it("[GOS-03] hai lượt ĐẨY KHUNG cả tháng cho cùng hai người, chồng nhau: không ném lỗi, mỗi ngày đúng một ô ACTIVE", async () => {
    const ca = (code: string) => {
      const l: ReturnType<typeof lenh>[] = [];
      for (const u of [u1, u2]) for (let day = 16; day <= 30; day += 1) l.push(lenh(u, day, code, "PATTERN"));
      return l;
    };
    const kq = await Promise.allSettled([chay(ca("S")), chay(ca("CG"))]);
    expect(kq.map((k) => k.status), JSON.stringify(kq.filter((k) => k.status === "rejected"))).toEqual(["fulfilled", "fulfilled"]);
    for (const u of [u1, u2]) {
      const ac = await conActive(u);
      expect(ac, u).toHaveLength(15);
      expect(new Set(ac.map((a) => a.workDate.toISOString())).size).toBe(15); // mỗi ngày MỘT ô
    }
  });

  it("[GOS-04] ô ACTIVE ở cơ sở KHÁC (người thao tác không có quyền) vẫn được THẤY — báo thiếu quyền, không tạo ô thứ hai", async () => {
    await chay([lenh(u1, 22, "S", "MANUAL", "CS2")]); // ô ở CS2
    const chiCs1 = ctx({ canWriteCenter: (c) => c === cs1 });
    const kq = await chay([lenh(u1, 22, "CG", "MANUAL", "CS1")], chiCs1);
    expect(kq.ketQua[0]).toMatchObject({ ket: "BO_QUA", lyDo: "KHONG_QUYEN_CO_SO_CU" });
    const ac = await conActive(u1, 22);
    expect(ac).toHaveLength(1);
    expect(ac[0]).toMatchObject({ templateCode: "S", centerId: cs2 });
  });

  it("[GOS-05] kỳ ĐÃ CHỐT: ô cũ hoặc ô mới nằm trong kỳ chốt ⇒ bỏ qua, KHÔNG ghi gì; có cờ vượt thì qua; kỳ của cơ sở KHÁC không liên quan", async () => {
    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-09", status: "LOCKED" } });
    const r = await chay([lenh(u1, 23, "S", "MANUAL", "CS1")]);
    expect(r.ketQua[0]).toMatchObject({ ket: "BO_QUA", lyDo: "KY_DA_CHOT" });
    expect(await conActive(u1)).toHaveLength(0);
    // Cùng ngày nhưng khối CS2 (kỳ CS2 không chốt) ⇒ được ghi.
    expect((await chay([lenh(u2, 23, "S", "MANUAL", "CS2")])).ketQua[0]).toMatchObject({ ket: "TAO" });
    // Vượt (đã kiểm quyền Hội sở ở tầng action) ⇒ ghi được.
    expect((await chay([lenh(u1, 23, "S", "MANUAL", "CS1")], ctx({ boQuaKyDaChot: true }))).ketQua[0]).toMatchObject({ ket: "TAO" });
    // Tháng KHÁC không bị ảnh hưởng.
    expect((await chay([lenh(u1, 5, "S", "MANUAL", "CS1")].map((x) => ({ ...x, workDate: ngay(5, 10) })))).ketQua[0]).toMatchObject({ ket: "TAO" });
  });

  it("[GOS-06] ma trận bảo vệ nguồn thật: PATTERN không đè LEAVE/SWAP (kể cả bật ghi đè), không đè MANUAL/IMPORT mặc định, ĐÈ được khi bật", async () => {
    await chay([lenh(u1, 24, "P", "LEAVE"), lenh(u1, 25, "CG", "SWAP"), lenh(u1, 26, "CG", "MANUAL"), lenh(u1, 27, "CG", "IMPORT")]);
    const dayKhung = (c = ctx()) => chay([24, 25, 26, 27].map((day) => lenh(u1, day, "S", "PATTERN")), c);
    const mac = await dayKhung();
    expect(mac.ketQua.map((k) => `${k.ket}:${k.lyDo ?? ""}`)).toEqual(Array(4).fill("BO_QUA:O_DUOC_BAO_VE"));
    const bat = await dayKhung(ctx({ ghiDeNhapTay: true }));
    expect(bat.ketQua.map((k) => `${k.ket}:${k.lyDo ?? ""}`)).toEqual(["BO_QUA:O_DUOC_BAO_VE", "BO_QUA:O_DUOC_BAO_VE", "THAY:", "THAY:"]);
    const ac = Object.fromEntries((await conActive(u1)).map((a) => [a.workDate.getUTCDate(), `${a.templateCode}/${a.source}`]));
    expect(ac).toEqual({ 24: "P/LEAVE", 25: "CG/SWAP", 26: "S/PATTERN", 27: "S/PATTERN" });
  });

  it("[GOS-07] cổng quá khứ chỉ với nguồn PATTERN: ngày ≤ hôm nay bị chừa; sửa tay cùng ngày đó vẫn được", async () => {
    const r = await chay([lenh(u1, 14, "S", "PATTERN"), lenh(u1, 15, "S", "PATTERN"), lenh(u1, 16, "S", "PATTERN")]);
    expect(r.ketQua.map((k) => `${k.ket}:${k.lyDo ?? ""}`)).toEqual(["BO_QUA:QUA_KHU", "BO_QUA:QUA_KHU", "TAO:"]);
    expect((await chay([lenh(u1, 14, "S", "MANUAL")])).ketQua[0]).toMatchObject({ ket: "TAO" });
  });

  it("[GOS-08] mã ca THEO CƠ SỞ: mã riêng của cơ sở chỉ thấy ở khối của nó; mã riêng thắng mã chung cùng tên", async () => {
    await db.shiftTemplate.create({
      data: { code: "ZZ1", name: "Riêng CS1", segments: [{ start: "08:00", end: "12:00", kind: "WORK" }], defaultPlace: "HOME", centerId: cs1, dayCredit: 1, nominalMinutes: 240 },
    });
    await db.shiftTemplate.create({
      data: { code: "S", name: "S riêng CS1", segments: [{ start: "08:00", end: "12:00", kind: "WORK" }], defaultPlace: "HOME", centerId: cs1, dayCredit: 0.25, nominalMinutes: 240, effectiveFrom: new Date(Date.UTC(2000, 0, 2)) },
    });
    expect((await chay([lenh(u1, 17, "ZZ1", "MANUAL", "CS1")])).ketQua[0]).toMatchObject({ ket: "TAO" });
    expect((await chay([lenh(u2, 17, "ZZ1", "MANUAL", "CS2")])).ketQua[0]).toMatchObject({ ket: "BO_QUA", lyDo: "MA_KHONG_CO" });
    expect((await conActive(u2))).toHaveLength(0);
    // Mã "S": khối CS1 dùng bản riêng (0,25 công), khối CS2 dùng bản chung (số công của danh mục chung).
    const chung = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { dayCredit: true } })).dayCredit;
    expect(chung).not.toBe(0.25);
    await chay([lenh(u1, 18, "S", "MANUAL", "CS1"), lenh(u2, 18, "S", "MANUAL", "CS2")]);
    expect((await conActive(u1, 18))[0]!.dayCredit).toBe(0.25);
    expect((await conActive(u2, 18))[0]!.dayCredit).toBe(chung);
  });

  it("[GOS-09] khối KHÔNG ánh xạ được ⇒ bỏ qua CO_SO_LA, KHÔNG gán thầm cho Hội sở; lệnh xoá không bị ảnh hưởng", async () => {
    const r = await chay([lenh(u1, 19, "S", "MANUAL", "ZZ_KHONG_CO")]);
    expect(r.ketQua[0]).toMatchObject({ ket: "BO_QUA", lyDo: "CO_SO_LA" });
    expect(await conActive(u1)).toHaveLength(0);
    expect((await chay([lenh(u1, 19, "S", "MANUAL", "CS1")])).ketQua[0]).toMatchObject({ ket: "TAO" });
    expect((await chay([lenh(u1, 19, null, "MANUAL", "ZZ_KHONG_CO")])).ketQua[0]).toMatchObject({ ket: "XOA" });
  });

  it("[GOS-10] XEM TRƯỚC (ghiThat:false) đi CÙNG đường quyết định: cùng kết cục + lý do từng ô với lượt ghi thật, và KHÔNG ghi / KHÔNG xếp hàng tính lại", async () => {
    // Có sẵn: ô LEAVE (được bảo vệ), ô PATTERN S ở ngày 27 (sẽ bị XOÁ), ô PATTERN CG ở ngày 28 (sẽ bị THAY) — đủ MỌI nhánh ghi.
    await chay([lenh(u1, 24, "P", "LEAVE"), lenh(u1, 27, "S", "PATTERN"), lenh(u1, 28, "CG", "PATTERN")]);
    const lenhs = [lenh(u1, 24, "S", "PATTERN"), lenh(u1, 25, "S", "PATTERN"), lenh(u1, 14, "S", "PATTERN"), lenh(u1, 26, "KHONGCO", "PATTERN"), lenh(u1, 27, null, "PATTERN"), lenh(u1, 28, "S", "PATTERN")];
    await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: u1 } } });
    const truoc = await db.shiftAssignment.count({ where: { userId: u1 } });
    const xem = await chay(lenhs, ctx(), false);
    expect(await db.shiftAssignment.count({ where: { userId: u1 } })).toBe(truoc);
    expect(await db.domainEvent.count({ where: { dedupeKey: { contains: u1 } } })).toBe(0);
    const that = await chay(lenhs, ctx(), true);
    const tom = (k: { ketQua: { ket: string; lyDo?: string }[] }) => k.ketQua.map((x) => `${x.ket}:${x.lyDo ?? ""}`);
    expect(tom(xem)).toEqual(tom(that));
    // Thứ tự kết quả = (người ↑, ngày ↑): 14, 24, 25, 26, 27, 28.
    expect(tom(that)).toEqual(["BO_QUA:QUA_KHU", "BO_QUA:O_DUOC_BAO_VE", "TAO:", "BO_QUA:MA_KHONG_CO", "XOA:", "THAY:"]);
  });

  it("[GOS-11] chạy LẠI cùng một loạt = idempotent: lần hai toàn GIU, không dòng nào đổi", async () => {
    const lenhs = [16, 17, 18, 19].map((day) => lenh(u1, day, "S", "PATTERN"));
    expect((await chay(lenhs)).thongKe.TAO).toBe(4);
    const truoc = (await conActive(u1)).map((a) => a.id);
    const lan2 = await chay(lenhs);
    expect(lan2.thongKe).toMatchObject({ GIU: 4, TAO: 0, THAY: 0 });
    expect((await conActive(u1)).map((a) => a.id)).toEqual(truoc);
  });

  it("[GOS-12] ghi thật xếp hàng tính lại ĐÚNG những ô đã đổi (không ô GIU / BO_QUA)", async () => {
    await chay([lenh(u1, 16, "S", "PATTERN"), lenh(u1, 17, "S", "PATTERN")]);
    await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: u1 } } });
    await chay([lenh(u1, 16, "S", "PATTERN"), lenh(u1, 17, "CG", "PATTERN"), lenh(u1, 14, "S", "PATTERN")]);
    const ev = await db.domainEvent.findMany({ where: { dedupeKey: { contains: u1 } }, select: { payloadJson: true } });
    expect(ev.map((e) => (e.payloadJson as { workDate: string }).workDate)).toEqual(["2026-09-17"]);
  });

  it("[GOS-13] lệnh PATTERN thiếu `homNay` bị TỪ CHỐI (luật 19: hàm không tự đọc đồng hồ); trùng (người, ngày) trong một loạt: lệnh SAU thắng và được ĐẾM", async () => {
    await expect(chay([lenh(u1, 16, "S", "PATTERN")], ctx({ homNay: null }))).rejects.toThrow(/homNay/);
    const r = await chay([lenh(u1, 16, "S", "MANUAL"), lenh(u1, 16, "CG", "MANUAL")]);
    expect(r.thongKe.lenhTrung).toBe(1);
    expect((await conActive(u1, 16))[0]!.templateCode).toBe("CG");
  });
});
