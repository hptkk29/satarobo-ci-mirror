// tests/cham-cong/cong-day-giao-vien.spec.ts — màn "Công dạy giáo viên" (12/10/2026): phần CHẠM DB của
// ma trận GV-* — đường đọc THẬT `loadBuoiDay` trên Postgres, rồi qua đúng hàm thuần màn dùng.
// Phần thuần (nhóm, lọc, gom ngày, tổng = chi tiết) ở `lib/cham-cong/cong-day-chi-tiet.test.ts`.
//
// Danh mục công dạy đưa vào là MẢNG trong test (không đọc `TeachingCreditType` của DB): bảng đó dùng chung
// mọi bộ test, ghi vào là đụng nhau. Luật quy đổi đã có ca riêng; ở đây thứ cần đo là DB trả buổi nào,
// cho ai, mang thông tin gì.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import type { LoaiCongDay } from "../../lib/cham-cong/cong-day";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/cong-day-giao-vien] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-cdgv";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
/** Mốc thật của một buổi lúc `h:mi` GIỜ VN ngày y-m-dd (ClassSession.date mang giờ thật). */
const vn = (y: number, m: number, dd: number, h: number, mi = 0) => new Date(Date.UTC(y, m - 1, dd, h - 7, mi));

// Hệ số khác nhau từng loại — hệ số 1 khắp nơi thì nhầm loại vẫn ra đúng số.
const DM: LoaiCongDay[] = [
  { code: "LC", name: "Lớp chính", source: "CLASS", role: "MAIN", basis: "PER_SESSION", factor: 1, countsInPeriod: true, isActive: true, categoryCode: null },
  { code: "DT", name: "Dạy thay", source: "CLASS", role: "SUBSTITUTE", basis: "PER_SESSION", factor: 0.8, countsInPeriod: true, isActive: true, categoryCode: null },
  { code: "BU", name: "Học bù", source: "MAKEUP", role: "MAIN", basis: "PER_SESSION", factor: 0.5, countsInPeriod: true, isActive: true, categoryCode: null },
];

d("[CDGV] công dạy giáo viên — đường đọc thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let loadBuoiDay: typeof import("../../lib/cham-cong/cong-day-db").loadBuoiDay;
  let ct: typeof import("../../lib/cham-cong/cong-day-chi-tiet");
  let cs1 = "";
  let cs2 = "";
  let gvChinh = "";
  let gvThay = "";
  let nguoiTao = "";
  let lop1 = "";
  let lop2 = "";
  let khoa = "";
  let bai = "";
  let phong = "";

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2].filter(Boolean) } } });
    await db.room.deleteMany({ where: { code: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: TAG } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: TAG } } });
    await db.course.deleteMany({ where: { slug: TAG } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    ({ loadBuoiDay } = await import("../../lib/cham-cong/cong-day-db"));
    ct = await import("../../lib/cham-cong/cong-day-chi-tiet");
    const mkCs = (s: string) =>
      db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG}-${s}` }, select: { id: true } });
    cs1 = (await mkCs("cs1")).id;
    cs2 = (await mkCs("cs2")).id;
    await cleanup();
    const mk = (email: string, name: string) =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gvChinh = (await mk("gvchinh", "GV chính cdgv")).id;
    gvThay = (await mk("gvthay", "GV thay cdgv")).id;
    nguoiTao = (await mk("tao", "Người tạo cdgv")).id;
    khoa = (await db.course.create({ data: { name: "Khoá cdgv", slug: TAG }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT cdgv" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    phong = (await db.room.create({ data: { code: `${TAG}-p201`, name: "201", centerId: cs1 }, select: { id: true } })).id;
    lop1 = (
      await db.class.create({
        data: { name: `${TAG} ROBOTICS 01`, courseId: khoa, centerId: cs1, teacherId: gvChinh, roomId: phong, startTime: "17:30", endTime: "19:30" },
        select: { id: true },
      })
    ).id;
    lop2 = (
      await db.class.create({
        data: { name: `${TAG} LOP CS2`, courseId: khoa, centerId: cs2, teacherId: gvChinh, startTime: "08:00", endTime: "09:30" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  const buoi = (classId: string, centerId: string, date: Date, p: Record<string, unknown> = {}) =>
    db.classSession.create({ data: { classId, centerId, date, status: "COMPLETED", ...p }, select: { id: true } });
  const caseBu = (date: Date, status: "COMPLETED" | "NO_SHOW" | "CANCELLED" | "SCHEDULED") =>
    db.makeupCase.create({
      data: { centerId: cs1, courseId: khoa, lessonId: bai, date, startTime: "14:00", endTime: "15:30", teacherId: gvChinh, status, createdById: nguoiTao, roomId: phong },
      select: { id: true },
    });

  it("[GV-01][GV-02] buổi COMPLETED vào, buổi CANCELLED / chưa diễn ra KHÔNG vào", async () => {
    const a = await buoi(lop1, cs1, vn(2026, 10, 6, 17, 30));
    const b = await buoi(lop1, cs1, vn(2026, 10, 7, 17, 30));
    const huy = await buoi(lop1, cs1, vn(2026, 10, 8, 17, 30), { status: "CANCELLED" });
    const chua = await buoi(lop1, cs1, vn(2026, 10, 9, 17, 30), { status: "SCHEDULED" });
    const ds = (await loadBuoiDay([gvChinh], utc(2026, 10, 1), utc(2026, 10, 31))).filter((x) => x.source === "CLASS" && x.ymd <= "2026-10-09" && x.ymd >= "2026-10-06");
    expect(ds.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(ds.map((x) => x.id)).not.toContain(huy.id);
    expect(ds.map((x) => x.id)).not.toContain(chua.id);
    const t = ct.tongHopGiaoVien(gvChinh, ds, DM);
    expect(t.theoNhom.LOP_CHINH).toBe(2);
    expect(t.tongCong).toBe(2);
  });

  it("[GV-01] thông tin hiển thị đi theo buổi: giờ lớp, tên lớp, phòng, cơ sở", async () => {
    const s = await buoi(lop1, cs1, vn(2026, 10, 13, 17, 30));
    const [x] = (await loadBuoiDay([gvChinh], utc(2026, 10, 13), utc(2026, 10, 13))).filter((y) => y.id === s.id);
    expect(x.hienThi).toMatchObject({
      gioBatDau: "17:30",
      gioKetThuc: "19:30",
      gioThuc: false,
      tenLop: `${TAG} ROBOTICS 01`,
      phong: "201",
      centerId: cs1,
      gvChinhId: gvChinh,
    });
    expect(x.minutes).toBe(120);
  });

  it("giờ thực (actualStartAt/EndAt) có ⇒ cột Giờ in ĐÚNG hai mốc đã tính ra thời lượng", async () => {
    const s = await buoi(lop1, cs1, vn(2026, 10, 14, 17, 30), { actualStartAt: vn(2026, 10, 14, 17, 40), actualEndAt: vn(2026, 10, 14, 19, 10) });
    const [x] = (await loadBuoiDay([gvChinh], utc(2026, 10, 14), utc(2026, 10, 14))).filter((y) => y.id === s.id);
    expect(x.minutes).toBe(90);
    expect(x.hienThi).toMatchObject({ gioBatDau: "17:40", gioKetThuc: "19:10", gioThuc: true });
  });

  it("[GV-04] dạy thay: công về ĐÚNG người thay, GV chính không được cộng — không đếm hai lần", async () => {
    const s = await buoi(lop1, cs1, vn(2026, 10, 11, 9, 45), { substituteTeacherId: gvThay });
    const ds = (await loadBuoiDay([gvChinh, gvThay], utc(2026, 10, 11), utc(2026, 10, 11))).filter((y) => y.id === s.id);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ userId: gvThay, role: "SUBSTITUTE" });
    expect(ds[0].hienThi).toMatchObject({ gvChinhId: gvChinh, gvThayId: gvThay });
    expect(ct.tongHopGiaoVien(gvChinh, ds.filter((x) => x.userId === gvChinh), DM).tongBuoi).toBe(0);
    const thay = ct.tongHopGiaoVien(gvThay, ds.filter((x) => x.userId === gvThay), DM);
    expect(thay.theoNhom.DAY_THAY).toBe(1);
    expect(thay.tongCong).toBe(0.8);
    // Dạy thay về đúng người ⇒ không cờ "có người thay mà công về GV chính".
    expect(ct.chiTietGiaoVien(ds, DM, { loai: null, trangThai: null }, new Set([cs1])).ngays[0].dongs[0].canhBao).toEqual([]);
  });

  it("[GV-05][GV-06][GV-03] case bù: COMPLETED + NO_SHOW có công, CANCELLED / SCHEDULED không vào", async () => {
    const xong = await caseBu(utc(2026, 10, 15), "COMPLETED");
    const vang = await caseBu(utc(2026, 10, 16), "NO_SHOW");
    const huy = await caseBu(utc(2026, 10, 17), "CANCELLED");
    const chua = await caseBu(utc(2026, 10, 18), "SCHEDULED");
    const ds = (await loadBuoiDay([gvChinh], utc(2026, 10, 15), utc(2026, 10, 18))).filter((x) => x.source === "MAKEUP");
    expect(ds.map((x) => x.id).sort()).toEqual([xong.id, vang.id].sort());
    expect(ds.map((x) => x.id)).not.toContain(huy.id);
    expect(ds.map((x) => x.id)).not.toContain(chua.id);
    expect(ds.find((x) => x.id === vang.id)?.hienThi).toMatchObject({ trangThai: "NO_SHOW", tenLop: "Khoá cdgv", phong: "201", centerId: cs1 });
    const t = ct.tongHopGiaoVien(gvChinh, ds, DM);
    expect(t.theoNhom.HOC_BU).toBe(2);
    expect(t.tongCong).toBe(1);
  });

  it("[GV-09] ranh giới tháng: buổi 31/10 tối và 01/11 sáng không lẫn tháng", async () => {
    const cuoi = await buoi(lop1, cs1, vn(2026, 10, 31, 18));
    const dau = await buoi(lop1, cs1, vn(2026, 11, 1, 8));
    const t10 = (await loadBuoiDay([gvChinh], utc(2026, 10, 1), utc(2026, 10, 31))).map((x) => x.id);
    const t11 = (await loadBuoiDay([gvChinh], utc(2026, 11, 1), utc(2026, 11, 30))).map((x) => x.id);
    expect(t10).toContain(cuoi.id);
    expect(t10).not.toContain(dau.id);
    expect(t11).toContain(dau.id);
    expect(t11).not.toContain(cuoi.id);
  });

  it("[GV-08] buổi ở cơ sở ngoài phạm vi: vẫn có công cho giáo viên, nhưng dòng bị che", async () => {
    const s = await buoi(lop2, cs2, vn(2026, 10, 20, 8));
    const ds = (await loadBuoiDay([gvChinh], utc(2026, 10, 20), utc(2026, 10, 20))).filter((x) => x.id === s.id);
    expect(ds).toHaveLength(1);
    const chiCs1 = ct.chiTietGiaoVien(ds, DM, { loai: null, trangThai: null }, new Set([cs1]));
    const o = chiCs1.ngays[0].dongs[0];
    expect(o.biChe).toBe(true);
    expect([o.tenLop, o.phong, o.lopId]).toEqual([null, null, null]);
    expect(chiCs1.tong.cong).toBe(1);
    const caHai = ct.chiTietGiaoVien(ds, DM, { loai: null, trangThai: null }, new Set([cs1, cs2]));
    expect(caHai.ngays[0].dongs[0].tenLop).toBe(`${TAG} LOP CS2`);
  });

  it("[GV-10][GV-11] màn chỉ ĐỌC: kỳ LOCKED giữ nguyên bản chốt sau khi dựng màn, số trên màn là dữ liệu hiện tại", async () => {
    const snapshot = { totals: { teachingSessions: 7 }, ghiChu: "bản chốt" };
    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-10", status: "LOCKED", summaryJson: snapshot } });
    const truoc = await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: cs1, periodKey: "2026-10" } } });
    // Buổi hoàn tất SAU khi chốt vẫn hiện trên màn (dữ liệu hiện tại) …
    const sau = await buoi(lop1, cs1, vn(2026, 10, 22, 17, 30));
    const ds = await loadBuoiDay([gvChinh], utc(2026, 10, 1), utc(2026, 10, 31));
    ct.chiTietGiaoVien(ds, DM, { loai: null, trangThai: null }, new Set([cs1]));
    ct.tongHopGiaoVien(gvChinh, ds, DM);
    expect(ds.map((x) => x.id)).toContain(sau.id);
    // … còn bản chốt không đổi một byte.
    const sauKhi = await db.attendancePeriod.findUniqueOrThrow({ where: { centerId_periodKey: { centerId: cs1, periodKey: "2026-10" } } });
    expect(sauKhi.status).toBe("LOCKED");
    expect(sauKhi.summaryJson).toEqual(truoc.summaryJson);
    expect(sauKhi.updatedAt.getTime()).toBe(truoc.updatedAt.getTime());
  });
});
