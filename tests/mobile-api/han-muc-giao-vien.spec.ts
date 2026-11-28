import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { datHanMucGiaoVien, khoaHanMucGiaoVien } from "@/lib/satacoin/han-muc";
import { recordTransaction } from "@/lib/satacoin/service";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [HM-DB] Hạn mức SataCoin của GIÁO VIÊN trên POSTGRES THẬT (HS2-D4): đúng học viên phụ trách · trong hạn mức THÁNG · Admin/QLCS không bị giới hạn · đồng thời không vượt.
 *   [HM-DB-01] GV: học viên ngoài lớp mình ⇒ từ chối; chưa có hạn mức ⇒ từ chối; trong hạn mức ⇒ ghi; vượt ⇒ từ chối (không ghi gì)
 *   [HM-DB-02] RACE: 12 lượt cộng 3 coin ĐỒNG THỜI trên 12 học viên KHÁC nhau của cùng một GV với hạn mức 10 ⇒ ĐÚNG 3 lượt thắng (khoá theo GV, không theo học viên)
 *   [HM-DB-03] Admin / QLCS không bị hạn mức; vai khác (PARENT) bị từ chối; có `createdById` mà thiếu `roles` ⇒ từ chối
 *   [HM-DB-05] KHOÁ THẬT: khi MỘT transaction khác đang giữ khoá hạn mức của GV, lượt cộng của GV đó phải CHỜ (không chạy xuyên qua); thả khoá ⇒ chạy tiếp (race của HM-DB-02 quá ngắn để tự chứng minh khoá)
 *   [HM-DB-04] chỉ Admin đặt hạn mức: giá trị âm / lẻ bị từ chối; người không phải giáo viên bị từ chối
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hmtest-";
const ids: Record<string, string> = {};

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.teacherCoinQuota.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

const cong = (studentId: string, userId: string, roles: readonly string[] | undefined, amount = 5) =>
  recordTransaction({ studentId, amount, type: amount > 0 ? "EARN" : "ADJUST", reason: "Thưởng thủ công", createdById: userId, roles });
const tong = async (studentId: string) => (await db.sataCoinTransaction.aggregate({ where: { studentId }, _sum: { amount: true } }))._sum.amount ?? 0;

describe.skipIf(!RUN)("[HM-DB] hạn mức giáo viên — Postgres thật", () => {
  beforeAll(async () => {
    await don();
    for (const k of ["gv", "gv2", "admin", "qlcs", "ph"]) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, password: "x", role: k === "gv" || k === "gv2" ? "TEACHER" : k === "admin" ? "SUPER_ADMIN" : k === "qlcs" ? "CENTER_MANAGER" : "PARENT", roles: [k === "gv" || k === "gv2" ? "TEACHER" : k === "admin" ? "SUPER_ADMIN" : k === "qlcs" ? "CENTER_MANAGER" : "PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở HM-1", slug: `${NS}cs1`, address: "Địa chỉ" } });
    await db.course.create({ data: { id: `${NS}kh`, name: "Khoá HM", slug: `${NS}kh`, totalSessions: 12 } });
    await db.class.create({ data: { id: `${NS}l1`, name: "Lớp HM 1", classCode: "HM.L1", courseId: `${NS}kh`, centerId: `${NS}cs1`, status: "ACTIVE", isActive: true, startTime: "18:00", endTime: "19:00", teacherId: ids.gv } });
    await db.class.create({ data: { id: `${NS}l2`, name: "Lớp HM 2", classCode: "HM.L2", courseId: `${NS}kh`, centerId: `${NS}cs1`, status: "ACTIVE", isActive: true, startTime: "18:00", endTime: "19:00", teacherId: ids.gv2 } });
    // 12 học viên của GV 1 (lớp 1) + 1 học viên của GV 2 (lớp 2).
    for (let i = 0; i < 12; i++) {
      await db.student.create({ data: { id: `${NS}hs-${i}`, name: `${NS}hs${i}`, centerId: `${NS}cs1` } as never });
      await db.enrollment.create({ data: { id: `${NS}dk-${i}`, studentId: `${NS}hs-${i}`, classId: `${NS}l1`, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs1` } });
    }
    await db.student.create({ data: { id: `${NS}hs-gv2`, name: `${NS}hsgv2`, centerId: `${NS}cs1` } as never });
    await db.enrollment.create({ data: { id: `${NS}dk-gv2`, studentId: `${NS}hs-gv2`, classId: `${NS}l2`, courseId: `${NS}kh`, status: "ACTIVE", centerId: `${NS}cs1` } });
  }, 60_000);
  afterAll(don);

  it("[HM-DB-01] GV: ngoài lớp ⇒ từ chối; chưa có hạn mức ⇒ từ chối; trong hạn mức ⇒ ghi; vượt ⇒ từ chối", async () => {
    const gv = ids.gv!;
    const T = ["TEACHER"];
    expect(await cong(`${NS}hs-gv2`, gv, T)).toMatchObject({ ok: false, error: expect.stringContaining("phụ trách") }); // học viên lớp GV khác
    expect(await cong(`${NS}hs-0`, gv, T)).toMatchObject({ ok: false, error: expect.stringContaining("hạn mức") }); // đúng lớp nhưng Admin chưa đặt hạn mức
    expect(await tong(`${NS}hs-0`)).toBe(0);
    expect((await datHanMucGiaoVien({ adminId: ids.admin!, teacherUserId: gv, capPerMonth: 20 })).ok).toBe(true);
    expect((await cong(`${NS}hs-0`, gv, T, 15)).ok).toBe(true);
    expect(await cong(`${NS}hs-1`, gv, T, 6)).toMatchObject({ ok: false, error: expect.stringContaining("Vượt hạn mức") }); // còn 5, cần 6
    expect(await tong(`${NS}hs-1`)).toBe(0);
    expect((await cong(`${NS}hs-1`, gv, T, 5)).ok).toBe(true); // biên: đúng bằng số còn lại
    expect(await cong(`${NS}hs-1`, gv, T, 1)).toMatchObject({ ok: false }); // đã hết
    // TRỪ coin cũng ăn hạn mức theo trị tuyệt đối (hạn mức hết rồi ⇒ không trừ được dù số dư đủ).
    expect(await cong(`${NS}hs-0`, gv, T, -1)).toMatchObject({ ok: false, error: expect.stringContaining("Vượt hạn mức") });
  });

  it("[HM-DB-02] RACE: 12 lượt 3 coin đồng thời, 12 học viên khác nhau, hạn mức 10 ⇒ ĐÚNG 3 lượt thắng", async () => {
    const gv2 = ids.gv2!;
    // gv2 chỉ có 1 học viên ⇒ dùng GV 1 với hạn mức mới: xoá phần đã dùng bằng cách đặt hạn mức = đã dùng + 10.
    const gv = ids.gv!;
    const daDung = 20; // HM-DB-01: 15 + 5
    expect((await datHanMucGiaoVien({ adminId: ids.admin!, teacherUserId: gv, capPerMonth: daDung + 10 })).ok).toBe(true);
    const kq = await Promise.all(Array.from({ length: 12 }, (_, i) => cong(`${NS}hs-${i}`, gv, ["TEACHER"], 3)));
    expect(kq.filter((r) => r.ok)).toHaveLength(3); // 3 × 3 = 9 ≤ 10; lượt thứ tư (12) > 10
    void gv2;
  }, 60_000);

  it("[HM-DB-03] Admin / QLCS không bị hạn mức; PARENT bị từ chối; có người cấp mà thiếu roles ⇒ từ chối", async () => {
    expect((await cong(`${NS}hs-gv2`, ids.admin!, ["SUPER_ADMIN"], 500)).ok).toBe(true);
    expect((await cong(`${NS}hs-gv2`, ids.qlcs!, ["CENTER_MANAGER"], 500)).ok).toBe(true);
    expect((await cong(`${NS}hs-gv2`, ids.qlcs!, ["TEACHER", "CENTER_MANAGER"], 500)).ok).toBe(true); // kiêm nhiệm ⇒ vai cao nhất
    expect(await cong(`${NS}hs-gv2`, ids.ph!, ["PARENT"], 5)).toMatchObject({ ok: false });
    expect(await cong(`${NS}hs-gv2`, ids.admin!, undefined, 5)).toMatchObject({ ok: false, error: expect.stringContaining("Thiếu vai") });
    expect(await cong(`${NS}hs-gv2`, ids.admin!, [], 5)).toMatchObject({ ok: false }); // mảng vai rỗng ⇒ KHAC
  });

  it("[HM-DB-05] khoá theo giáo viên có THẬT trên đường ghi: người khác đang giữ khoá ⇒ lượt cộng phải chờ; thả khoá ⇒ chạy tiếp", async () => {
    const gv = ids.gv!;
    expect((await datHanMucGiaoVien({ adminId: ids.admin!, teacherUserId: gv, capPerMonth: 100000 })).ok).toBe(true);
    let xong = false;
    let cho: Promise<{ ok: boolean }> | null = null;
    await db.$transaction(async (tx) => {
      await khoaHanMucGiaoVien(tx, gv); // giữ khoá của GV trong lúc kiểm tra
      cho = cong(`${NS}hs-5`, gv, ["TEACHER"], 1).then((r) => {
        xong = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 600));
      expect(xong, "lượt cộng đã chạy xuyên qua khoá của giáo viên").toBe(false);
    });
    const kq = await cho!;
    expect(kq.ok).toBe(true);
    expect(xong).toBe(true);
  }, 30_000);

  it("[HM-DB-04] đặt hạn mức: âm / lẻ / người không phải giáo viên ⇒ từ chối", async () => {
    for (const cap of [-1, 1.5, 2_000_000]) expect((await datHanMucGiaoVien({ adminId: ids.admin!, teacherUserId: ids.gv!, capPerMonth: cap })).ok).toBe(false);
    expect((await datHanMucGiaoVien({ adminId: ids.admin!, teacherUserId: ids.ph!, capPerMonth: 10 })).ok).toBe(false);
  });
});
