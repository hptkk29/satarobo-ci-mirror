// tests/cham-cong/day-khung.spec.ts — ĐẨY khung ca tuần xuống lưới + chỉ báo lệch, tầng DB THẬT. T04, 07/10/2026.
//
// Lịch cố định (luật 19): tháng 9/2026 có thứ Hai 7, 14, 21, 28; tháng 10/2026 có thứ Hai 5, 12, 19, 26.
// "Hôm nay" giả là 15/09/2026 (thứ Ba) ⇒ thứ Hai 7 và 14/09 là QUÁ KHỨ; còn lại 6 thứ Hai TƯƠNG LAI.
//
// Postgres LOCAL (satarobo_test); tự SKIP nếu không có. Mỗi ca XANH khi chạy MỘT MÌNH (luật 18): `beforeEach` dựng lại lưới.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import type { CenterMap } from "../../lib/cham-cong/place";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn("[cham-cong/day-khung] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test");

const TAG = "cc-daykhung";
const ngay = (day: number, month1 = 9) => new Date(Date.UTC(2026, month1 - 1, day));
const HOM_NAY = ngay(15);
const GOC = new Date(Date.UTC(2000, 0, 1));

d("dayKhung / lechKhung — DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dk: typeof import("../../lib/cham-cong/day-khung");
  let gen: typeof import("../../lib/cham-cong/generate-db");
  let cs1 = "";
  let cs2 = "";
  let hoc = "";
  let u1 = "";
  let u2 = "";
  let map: CenterMap;

  const donDep = async () => {
    const us = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = us.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftWeeklyPattern.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2, hoc].filter(Boolean) }, periodKey: { in: ["2026-09", "2026-10", "2026-11"] } } });
  };

  const datKhung = async (userId: string, weekday: number, code: string, centerId = cs1) => {
    const tpl = await db.shiftTemplate.findFirstOrThrow({ where: { code, centerId: null }, select: { id: true } });
    await db.shiftWeeklyPattern.upsert({
      where: { userId_centerId_weekday_effectiveFrom: { userId, centerId, weekday, effectiveFrom: GOC } },
      create: { userId, centerId, weekday, templateId: tpl.id, templateCode: code, sheetName: `DK ${userId}`, effectiveFrom: GOC },
      update: { templateId: tpl.id, templateCode: code, effectiveTo: null },
    });
  };

  /** Sinh lưới T9 + T10 từ khung "S" cả tuần, TỪ ĐẦU THÁNG 9 (homNay = 31/08) ⇒ mọi ngày đều có ô PATTERN. */
  const dungLuoi = async () => {
    for (const periodKey of ["2026-09", "2026-10"]) {
      await gen.generateMonthAssignments({
        db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb,
        periodKey,
        centerMap: map,
        canWriteCenter: () => true,
        actorUserId: u1,
        onlyUserIds: [u1, u2],
        homNay: new Date(Date.UTC(2026, 7, 31)),
        ghiThat: true,
        ghiDeNhapTay: false,
        boQuaKyDaChot: false,
      });
    }
  };

  const day = (over: Partial<Parameters<typeof dk.dayKhung>[0]> = {}) =>
    dk.dayKhung({
      db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb,
      userIds: [u1],
      centerId: cs1,
      weekdays: [1],
      phamVi: "MOI_NGAY_CHUA_KHOA",
      tuNgay: null,
      homNay: HOM_NAY,
      centerMap: map,
      canWriteCenter: () => true,
      actorUserId: u1,
      ghiDeNhapTay: false,
      ghiThat: true,
      ...over,
    });
  const ma = async (userId: string) =>
    Object.fromEntries((await db.shiftAssignment.findMany({ where: { userId, status: "ACTIVE" } })).map((a) => [a.workDate.toISOString().slice(0, 10), `${a.templateCode}/${a.source}`]));

  beforeAll(async () => {
    dk = await import("../../lib/cham-cong/day-khung");
    gen = await import("../../lib/cham-cong/generate-db");
    await seedShiftTemplates(db);
    const mk = async (slug: string, code: string) =>
      (await db.center.upsert({ where: { slug: `${TAG}-${slug}` }, update: {}, create: { slug: `${TAG}-${slug}`, name: `DK ${slug}`, address: "x", code }, select: { id: true } })).id;
    cs1 = await mk("cs1", "DK1");
    cs2 = await mk("cs2", "DK2");
    hoc = await mk("hoc", "DKH");
    await donDep();
    const mkU = async (i: number) =>
      (await db.user.create({ data: { email: `u${i}@${TAG}.test`, name: `DK ${i}`, role: "HR", roles: ["HR"], password: "x", centerId: cs1 }, select: { id: true } })).id;
    u1 = await mkU(1);
    u2 = await mkU(2);
    map = { byCode: { CS1: { centerId: cs1, orgUnitId: null }, CS2: { centerId: cs2, orgUnitId: null } }, hoCenterId: hoc };
  });

  beforeEach(async () => {
    await db.shiftAssignment.deleteMany({ where: { userId: { in: [u1, u2] } } });
    await db.shiftWeeklyPattern.deleteMany({ where: { userId: { in: [u1, u2] } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2, hoc] }, periodKey: { in: ["2026-09", "2026-10", "2026-11"] } } });
    for (const u of [u1, u2]) for (let wd = 0; wd < 7; wd += 1) await datKhung(u, wd, "S");
    await dungLuoi();
  });

  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  const THU_HAI_TUONG_LAI = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
  const THU_HAI_QUA_KHU = ["2026-09-07", "2026-09-14"];

  it("[DK-01] nền: lưới dựng xong thì mọi ngày T9 + T10 là S/PATTERN — đối chứng cho mọi ca dưới (thiếu nó 'không đổi' có thể chỉ vì lưới trống)", async () => {
    const o = await ma(u1);
    expect(Object.keys(o)).toHaveLength(30 + 31);
    expect(new Set(Object.values(o))).toEqual(new Set(["S/PATTERN"]));
  });

  it("[DK-02] MỌI NGÀY CHƯA KHOÁ: sửa thứ Hai S→CG rồi đẩy ⇒ CHỈ các thứ Hai TƯƠNG LAI đổi; quá khứ + hôm nay + thứ khác nguyên; tháng chưa sinh (T11) không bị chạm", async () => {
    await datKhung(u1, 1, "CG");
    const kq = await day();
    expect(kq.phamVi).toBe("MOI_NGAY_CHUA_KHOA");
    expect(kq.tuNgay).toBe("2026-09-16"); // ngày mai (hôm nay 15/09)
    expect(kq.cacThang).toEqual(["2026-09", "2026-10"]); // tháng xa nhất đã có ô là T10 ⇒ KHÔNG đẩy sang T11
    expect(kq.ketQua!.replaced).toBe(6);
    const o = await ma(u1);
    for (const n of THU_HAI_TUONG_LAI) expect(o[n], n).toBe("CG/PATTERN");
    for (const n of THU_HAI_QUA_KHU) expect(o[n], n).toBe("S/PATTERN");
    expect(o["2026-09-22"]).toBe("S/PATTERN"); // thứ Ba: không sửa
    expect(Object.keys(o).some((k) => k.startsWith("2026-11"))).toBe(false);
    // Người KHÁC không bị đụng.
    expect(new Set(Object.values(await ma(u2)))).toEqual(new Set(["S/PATTERN"]));
  });

  it("[DK-03] CHỈ KHUNG: lưu khung mà KHÔNG đẩy — lưới nguyên, không câu lệnh ghi nào; chỉ báo lệch đếm đúng số ô sẽ đổi khi bấm Sinh", async () => {
    await datKhung(u1, 1, "CG");
    const truoc = await ma(u1);
    const kq = await day({ phamVi: "CHI_KHUNG" });
    expect(kq).toMatchObject({ phamVi: "CHI_KHUNG", ketQua: null, cacThang: [] });
    expect(await ma(u1)).toEqual(truoc);
    const lech9 = await dk.lechKhung({ db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb, periodKey: "2026-09", centerIds: [cs1], centerMap: map, homNay: HOM_NAY, actorUserId: u1 });
    const lech10 = await dk.lechKhung({ db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb, periodKey: "2026-10", centerIds: [cs1], centerMap: map, homNay: HOM_NAY, actorUserId: u1 });
    expect(lech9.soOLech).toBe(2); // thứ Hai 21, 28 (7 và 14 là quá khứ — không tính)
    expect(lech10.soOLech).toBe(4);
    expect(lech9.theoNguoi).toEqual({ [u1]: 2 });
  });

  it("[DK-04] sau khi ĐẨY thì chỉ báo lệch về 0", async () => {
    await datKhung(u1, 1, "CG");
    await day();
    for (const periodKey of ["2026-09", "2026-10"]) {
      const l = await dk.lechKhung({ db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb, periodKey, centerIds: [cs1], centerMap: map, homNay: HOM_NAY, actorUserId: u1 });
      expect(l.soOLech, periodKey).toBe(0);
    }
  });

  it("[DK-05] TỪ NGÀY X: chỉ các thứ Hai ≥ X đổi; X ≤ hôm nay bị KẸP về ngày mai và được BÁO (quá khứ không đổi)", async () => {
    await datKhung(u1, 1, "CG");
    const kq = await day({ phamVi: "TU_NGAY", tuNgay: ngay(1, 10) });
    expect(kq).toMatchObject({ tuNgay: "2026-10-01", daKepVeMai: false });
    const o = await ma(u1);
    for (const n of ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]) expect(o[n], n).toBe("CG/PATTERN");
    for (const n of ["2026-09-21", "2026-09-28"]) expect(o[n], n).toBe("S/PATTERN"); // trước X: giữ

    const kep = await day({ phamVi: "TU_NGAY", tuNgay: ngay(10) }); // 10/09 ≤ hôm nay 15/09
    expect(kep).toMatchObject({ tuNgay: "2026-09-16", daKepVeMai: true });
    const sau = await ma(u1);
    for (const n of THU_HAI_QUA_KHU) expect(sau[n], n).toBe("S/PATTERN");
    for (const n of ["2026-09-21", "2026-09-28"]) expect(sau[n], n).toBe("CG/PATTERN");
  });

  it("[DK-06] ô NHẬP THỦ CÔNG: mặc định KHÔNG bị đè (được đếm là bảo vệ); bật 'ghi đè cả ô nhập thủ công' thì đè; ô LEAVE/SWAP thì KHÔNG BAO GIỜ", async () => {
    const s = await db.shiftTemplate.findFirstOrThrow({ where: { code: "P", centerId: null }, select: { id: true } });
    const cg = await db.shiftTemplate.findFirstOrThrow({ where: { code: "CG", centerId: null }, select: { id: true } });
    const doi = async (workDate: Date, source: "MANUAL" | "LEAVE" | "SWAP" | "IMPORT", templateCode: string, templateId: string) => {
      await db.shiftAssignment.updateMany({ where: { userId: u1, workDate, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      await db.shiftAssignment.create({
        data: { userId: u1, centerId: cs1, workDate, templateId, templateCode, segments: [], placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source },
      });
    };
    await doi(ngay(21), "MANUAL", "CG", cg.id);
    await doi(ngay(28), "IMPORT", "CG", cg.id);
    await doi(ngay(5, 10), "LEAVE", "P", s.id);
    await doi(ngay(12, 10), "SWAP", "CG", cg.id);
    await datKhung(u1, 1, "X");
    const mac = await day();
    expect(mac.ketQua!.skippedProtected).toBe(4);
    const o1 = await ma(u1);
    expect([o1["2026-09-21"], o1["2026-09-28"], o1["2026-10-05"], o1["2026-10-12"]]).toEqual(["CG/MANUAL", "CG/IMPORT", "P/LEAVE", "CG/SWAP"]);
    expect(o1["2026-10-19"]).toBe("X/PATTERN"); // ô PATTERN thường vẫn đổi
    const bat = await day({ ghiDeNhapTay: true });
    expect(bat.ketQua!.skippedProtected).toBe(2); // chỉ LEAVE + SWAP còn được bảo vệ
    const o2 = await ma(u1);
    expect([o2["2026-09-21"], o2["2026-09-28"], o2["2026-10-05"], o2["2026-10-12"]]).toEqual(["X/PATTERN", "X/PATTERN", "P/LEAVE", "CG/SWAP"]);
  });

  it("[DK-07] KỲ ĐÃ CHỐT: ô trong kỳ chốt không đổi và được ĐẾM; kỳ khác vẫn đẩy bình thường", async () => {
    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-10", status: "LOCKED" } });
    await datKhung(u1, 1, "CG");
    const kq = await day();
    expect(kq.ketQua!.skippedKyDaChot).toBe(4);
    expect(kq.ketQua!.replaced).toBe(2);
    const o = await ma(u1);
    expect(o["2026-09-21"]).toBe("CG/PATTERN");
    expect(o["2026-10-05"]).toBe("S/PATTERN");
  });

  it("[DK-08] GỠ KHỎI KHỐI (effectiveTo = hôm nay) rồi đẩy ⇒ dọn ô PATTERN TƯƠNG LAI của người đó; ô nhập tay giữ; quá khứ giữ; người khác không đụng", async () => {
    const cg = await db.shiftTemplate.findFirstOrThrow({ where: { code: "CG", centerId: null }, select: { id: true } });
    await db.shiftAssignment.updateMany({ where: { userId: u1, workDate: ngay(24), status: "ACTIVE" }, data: { status: "CANCELLED" } });
    await db.shiftAssignment.create({
      data: { userId: u1, centerId: cs1, workDate: ngay(24), templateId: cg.id, templateCode: "CG", segments: [], placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "MANUAL" },
    });
    await db.shiftWeeklyPattern.updateMany({ where: { userId: u1, centerId: cs1 }, data: { effectiveTo: HOM_NAY } });
    const kq = await day({ weekdays: null });
    expect(kq.ketQua!.cleared).toBeGreaterThan(40);
    const o = await ma(u1);
    expect(o["2026-09-24"]).toBe("CG/MANUAL");
    expect(o["2026-09-14"]).toBe("S/PATTERN");
    expect(o["2026-09-15"]).toBe("S/PATTERN"); // hôm nay không đổi
    expect(Object.keys(o).filter((k) => k > "2026-09-15" && k !== "2026-09-24")).toEqual([]);
    expect(Object.keys(await ma(u2))).toHaveLength(61);
  });

  it("[DK-09] NGƯỜI MỚI vào khối (chưa có ô nào): được xếp cho phần còn lại của tháng này VÀ các tháng đã sinh — không lấn tháng chưa sinh", async () => {
    const moi = await db.user.create({ data: { email: `moi@${TAG}.test`, name: "DK moi", role: "HR", roles: ["HR"], password: "x", centerId: cs1 }, select: { id: true } });
    try {
      for (let wd = 0; wd < 7; wd += 1) await datKhung(moi.id, wd, "CG");
      const kq = await day({ userIds: [moi.id], weekdays: null });
      expect(kq.cacThang).toEqual(["2026-09", "2026-10"]);
      expect(kq.ketQua!.created).toBe(15 + 31); // 16–30/09 + cả T10
      const o = Object.keys(await ma(moi.id));
      expect(o).toHaveLength(46);
      expect(o.every((k) => k >= "2026-09-16")).toBe(true);
    } finally {
      await db.shiftAssignment.deleteMany({ where: { userId: moi.id } });
      await db.shiftWeeklyPattern.deleteMany({ where: { userId: moi.id } });
      await db.user.delete({ where: { id: moi.id } });
    }
  });

  it("[DK-10] hai lượt ĐẨY chồng nhau + một lượt Sinh: không ném lỗi, mỗi ngày đúng MỘT ô ACTIVE", async () => {
    await datKhung(u1, 1, "CG");
    const kq = await Promise.allSettled([day(), day({ weekdays: null }), day({ phamVi: "TU_NGAY", tuNgay: ngay(1, 10) })]);
    expect(kq.map((k) => k.status), JSON.stringify(kq.filter((k) => k.status === "rejected"))).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const ac = await db.shiftAssignment.findMany({ where: { userId: u1, status: "ACTIVE" }, select: { workDate: true } });
    expect(new Set(ac.map((a) => a.workDate.toISOString())).size).toBe(ac.length);
  });

  it("[DK-12] CHỈ đẩy những THỨ vừa sửa: một thứ khác đang LỆCH khung (đã lưu CHI_KHUNG trước đó) KHÔNG bị lần đẩy này kéo theo", async () => {
    await datKhung(u1, 2, "CG"); // sửa thứ Ba, KHÔNG đẩy (CHI_KHUNG) — lưới còn S ở mọi thứ Ba
    await day({ phamVi: "CHI_KHUNG", weekdays: [2] });
    await datKhung(u1, 1, "X"); // sửa thứ Hai, đẩy
    await day({ weekdays: [1] });
    const o = await ma(u1);
    for (const n of THU_HAI_TUONG_LAI) expect(o[n], n).toBe("X/PATTERN");
    expect(o["2026-09-22"]).toBe("S/PATTERN"); // thứ Ba LỆCH khung nhưng không phải thứ lần này sửa ⇒ nguyên
    expect(o["2026-10-06"]).toBe("S/PATTERN");
    // Và chỉ báo lệch vẫn nhớ nó: lệch của thứ Ba còn đó (người dùng chọn CHI_KHUNG có chủ đích).
    const l = await dk.lechKhung({ db: db as unknown as import("../../lib/cham-cong/generate-db").GenerateDb, periodKey: "2026-09", centerIds: [cs1], centerMap: map, homNay: HOM_NAY, actorUserId: u1 });
    expect(l.soOLech).toBe(2); // thứ Ba 22, 29/09 (thứ Hai đã đẩy xong)
  });

  it("[DK-13] TỪ NGÀY X GIỮA THÁNG: thứ Hai trước X trong CÙNG tháng giữ nguyên, từ X trở đi đổi", async () => {
    await datKhung(u1, 1, "CG");
    await day({ phamVi: "TU_NGAY", tuNgay: ngay(12, 10) });
    const o = await ma(u1);
    expect(o["2026-10-05"]).toBe("S/PATTERN"); // trước X, cùng tháng 10
    for (const n of ["2026-10-12", "2026-10-19", "2026-10-26"]) expect(o[n], n).toBe("CG/PATTERN");
    for (const n of ["2026-09-21", "2026-09-28"]) expect(o[n], n).toBe("S/PATTERN"); // tháng trước X không bị mở
  });

  it("[DK-11] phạm vi TU_NGAY thiếu ngày bị từ chối (lỗi lập trình — không đoán một ngày)", async () => {
    await expect(day({ phamVi: "TU_NGAY", tuNgay: null })).rejects.toThrow(/tuNgay/);
  });
});
