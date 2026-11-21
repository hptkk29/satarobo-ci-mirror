// tests/cham-cong/parttime-bang-chung-cong.spec.ts — P4 · gắn chấm công vào phân công (SR.QD.238), Postgres THẬT.
// Đường đọc thật `docBangChungCong` (lượt quẹt qua `LUOT_CON_TINH`, buổi qua `macDinhCuaBuoi`, người dạy qua
// `giaoVienDuocQuyCong`). Mỗi ca dùng MỘT NGÀY riêng để lượt quẹt của ca này không lẫn sang ca khác.
// `db` được bọc extension ĐẾM câu tra — `[P4-DB-12]` đòi số câu không đổi khi phân công tăng 10 lần.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-bang-chung-cong] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true, dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? ctl.bat : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
// Cổng RBAC v2 của Parttime giả BẬT (prod/test chạy v2); `checkPermission` vẫn chạy theo cờ thật của môi trường test.
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          ctl.dem++;
          return query(args);
        },
      },
    },
  });
  return { ...goc, db: dem };
});

const TAG = "p4bcc";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[P4-DB] gắn chấm công vào phân công — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let bcc: typeof import("../../lib/parttime/bang-chung-cong-db");
  let cs1 = "";
  let cs2 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let khoa = "";
  let bai = "";
  const actor = { id: null as string | null, name: "QLCS p4" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ (trước SR.QD.238)", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    if (pcs.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcs.map((p) => p.id) } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
      await db.auditLog.deleteMany({ where: { entityType: "SessionStaffAssignment", entityId: { in: pcs.map((p) => p.id) } } });
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    const tcs = await db.trialClassV2.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: { in: tcs.map((t) => t.id) } } });
    await db.trialClassV2.deleteMany({ where: { id: { in: tcs.map((t) => t.id) } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    bcc = await import("../../lib/parttime/bang-chung-cong-db");
    const mkCs = (s: string) =>
      db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG}-${s}` }, select: { id: true } });
    cs1 = (await mkCs("cs1")).id;
    cs2 = (await mkCs("cs2")).id;
    for (const [s, id] of [["cs1", cs1], ["cs2", cs2]] as const) {
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: id } });
    }
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV p4")).id;
    gv2 = (await mk("gv2", "GV2 p4")).id;
    ta = (await mk("ta", "TA p4")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 p4", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT p4" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const lopMoi = async (p: { teacherId?: string; assistantId?: string | null } = {}) => {
    soLop++;
    return (
      await db.class.create({
        data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs1, teacherId: p.teacherId ?? gv, assistantId: p.assistantId ?? null, startTime: "18:00", endTime: "19:30" },
        select: { id: true },
      })
    ).id;
  };
  const buoiMoi = (classId: string, ymd: string, gio = "18:00", p: { substituteTeacherId?: string | null } = {}) =>
    db.classSession.create({ data: { classId, centerId: cs1, status: "SCHEDULED", date: vn(ymd, gio), substituteTeacherId: p.substituteTeacherId ?? null }, select: { id: true } });
  const nguon = (sourceType: "CLASS_SESSION" | "MAKEUP_CASE" | "TRIAL_SESSION", sourceId: string) => ({ sourceType, sourceId });
  const dong = (ds: { sourceType: "CLASS_SESSION" | "MAKEUP_CASE" | "TRIAL_SESSION"; sourceId: string }[]) => dongBo.dongBoNgay(ds, "TAO_BUOI", actor);
  // Phân công dựng bằng đồng bộ đã gán ngay (ĐẢO 20/10/2026) ⇒ không còn bước "GV nhận" trong dựng dữ liệu.
  const quet = (userId: string, ymd: string, direction: "CHECK_IN" | "CHECK_OUT", hhmm: string, p: { centerId?: string; result?: "ACCEPTED" | "REJECTED"; reviewStatus?: "PENDING" | "DISMISSED"; rejectReason?: string } = {}) =>
    db.staffTimeLog.create({
      data: { userId, centerId: p.centerId ?? cs1, direction, loggedAt: vn(ymd, hhmm), workDate: new Date(`${ymd}T00:00:00Z`), result: p.result ?? "ACCEPTED", reviewStatus: p.reviewStatus ?? "PENDING", rejectReason: p.rejectReason ?? null },
      select: { id: true },
    });
  const doc = (ymd: string, now = vn(ymd, "22:00")) => bcc.docBangChungCong({ centerId: cs1, tu: ymd, den: ymd, now });
  const cua = async (ymd: string, sourceId: string, userId: string) => (await doc(ymd)).phanCong.find((r) => r.sourceId === sourceId && r.userId === userId);

  it("[P4-DB-01] phân công + xác nhận + VÀO/RA ⇒ DU_BANG_CHUNG, dòng dõi trỏ đúng id lượt + phân công + phiên bản", async () => {
    const ngay = "2026-11-02";
    const s = await buoiMoi(await lopMoi(), ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    const v = await quet(gv, ngay, "CHECK_IN", "17:46");
    const r2 = await quet(gv, ngay, "CHECK_OUT", "19:35");
    const r = (await cua(ngay, s.id, gv))!;
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, userId: gv } });
    expect(r).toMatchObject({ trangThai: "DU_BANG_CHUNG", daNhan: true, assignmentId: pc.id, assignmentVersion: 1 });
    expect(r.dongDoi).toMatchObject({ attendanceInId: v.id, attendanceOutId: r2.id, chinhSach: "SR.QD.238" });
  });

  it("[P4-DB-02] MỘT khoảng có mặt là bằng chứng cho NHIỀU phân công (14:00 MAIN · 16:00 TA · 18:00 MAIN)", async () => {
    const ngay = "2026-11-03";
    const a = await buoiMoi(await lopMoi({ teacherId: gv }), ngay, "14:00");
    const b = await buoiMoi(await lopMoi({ teacherId: gv2, assistantId: gv }), ngay, "16:00");
    const c = await buoiMoi(await lopMoi({ teacherId: gv }), ngay, "18:00");
    await dong([a, b, c].map((s) => nguon("CLASS_SESSION", s.id)));
    await quet(gv, ngay, "CHECK_IN", "13:40");
    await quet(gv, ngay, "CHECK_OUT", "21:05");
    const ds = (await doc(ngay)).phanCong.filter((r) => r.userId === gv);
    expect(ds.map((r) => [r.role, r.trangThai]).sort()).toEqual([
      ["MAIN_TEACHER", "DU_BANG_CHUNG"],
      ["MAIN_TEACHER", "DU_BANG_CHUNG"],
      ["TEACHING_ASSISTANT", "DU_BANG_CHUNG"],
    ]);
    expect(new Set(ds.map((r) => r.dongDoi.attendanceInId)).size).toBe(1);
  });

  it("[P4-DB-03] lượt của NGƯỜI KHÁC không gắn được", async () => {
    const ngay = "2026-11-04";
    const s = await buoiMoi(await lopMoi(), ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    await quet(gv2, ngay, "CHECK_IN", "17:40");
    await quet(gv2, ngay, "CHECK_OUT", "19:40");
    expect((await cua(ngay, s.id, gv))!.trangThai).toBe("KHONG_BANG_CHUNG");
  });

  it("[P4-DB-04] lượt ở CƠ SỞ KHÁC không gắn; nêu PRESENT_AT_OTHER_CENTER", async () => {
    const ngay = "2026-11-05";
    const s = await buoiMoi(await lopMoi(), ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    await quet(gv, ngay, "CHECK_IN", "17:40", { centerId: cs2 });
    await quet(gv, ngay, "CHECK_OUT", "19:40", { centerId: cs2 });
    const r = (await cua(ngay, s.id, gv))!;
    expect(r.trangThai).toBe("KHONG_BANG_CHUNG");
    expect(r.ngoaiLe).toContain("PRESENT_AT_OTHER_CENTER");
  });

  it("[P4-DB-05][P4-DB-06] lượt BỊ TỪ CHỐI (ngoài vùng) và lượt ĐÃ BỊ THAY (DISMISSED) không bao giờ thành bằng chứng", async () => {
    const ngay = "2026-11-06";
    const s = await buoiMoi(await lopMoi(), ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    await quet(gv, ngay, "CHECK_IN", "17:40", { result: "REJECTED", rejectReason: "OUTSIDE_GEOFENCE" });
    await quet(gv, ngay, "CHECK_OUT", "19:40", { result: "REJECTED", rejectReason: "OUTSIDE_GEOFENCE" });
    await quet(gv, ngay, "CHECK_IN", "17:42", { reviewStatus: "DISMISSED" });
    await quet(gv, ngay, "CHECK_OUT", "19:41", { reviewStatus: "DISMISSED" });
    expect((await cua(ngay, s.id, gv))!.trangThai).toBe("KHONG_BANG_CHUNG");
    // Đối chứng dương: một cặp hợp lệ thì có bằng chứng.
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    expect((await cua(ngay, s.id, gv))!.trangThai).toBe("DU_BANG_CHUNG");
  });

  it("[P4-DB-07] DẠY THAY: lớp mặc định A, buổi có người thay B ⇒ MAIN là B (SUBSTITUTE), thực dạy B ⇒ KHOP; không gắn ứng viên công cho A", async () => {
    const ngay = "2026-11-07";
    const s = await buoiMoi(await lopMoi({ teacherId: gv }), ngay, "18:00", { substituteTeacherId: gv2 });
    await dong([nguon("CLASS_SESSION", s.id)]);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv2 } });
    await quet(gv2, ngay, "CHECK_IN", "17:45");
    await quet(gv2, ngay, "CHECK_OUT", "19:35");
    await quet(gv, ngay, "CHECK_IN", "17:30");
    await quet(gv, ngay, "CHECK_OUT", "20:00");
    const ds = (await doc(ngay)).phanCong.filter((r) => r.sourceId === s.id);
    expect(ds.map((r) => [r.userId === gv2 ? "B" : "A", r.role, r.khopNguoiDay, r.trangThai])).toEqual([["B", "MAIN_TEACHER", "KHOP", "DU_BANG_CHUNG"]]);
  });

  it("[P4-DB-08] kế hoạch ≠ thực tế: A được phân + nhận + có mặt, nhưng B đứng lớp ⇒ SAI_NGUOI_DUNG_LOP (không coi A đã dạy)", async () => {
    const ngay = "2026-11-08";
    const s = await buoiMoi(await lopMoi({ teacherId: gv }), ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: gv2 } });
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    const r = (await cua(ngay, s.id, gv))!;
    expect(r).toMatchObject({ trangThai: "SAI_NGUOI_DUNG_LOP", khopNguoiDay: "LECH" });
    expect(r.dongDoi).toMatchObject({ nguoiDayId: gv2, nguonNguoiDay: "actualTeacherId" });
  });

  it("[P4-DB-09] HỌC BÙ: cùng một đường bằng chứng, hoạt động giữ MAKEUP", async () => {
    const ngay = "2026-11-09";
    const c = await db.makeupCase.create({
      data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv },
      select: { id: true },
    });
    await dong([nguon("MAKEUP_CASE", c.id)]);
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    expect(await cua(ngay, c.id, gv)).toMatchObject({ activity: "MAKEUP", trangThai: "DU_BANG_CHUNG", sourceType: "MAKEUP_CASE" });
  });

  it("[P4-DB-10] TRIAL: bằng chứng như mọi buổi, hoạt động giữ TRIAL (không thành buổi dạy chính)", async () => {
    const ngay = "2026-11-10";
    const tc = await db.trialClassV2.create({ data: { code: `${TAG}-tc`, name: "Trial p4", centerId: cs1, sessionCount: 1 }, select: { id: true } });
    const t = await db.trialClassSession.create({ data: { trialClassId: tc.id, seq: 1, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv }, select: { id: true } });
    await dong([nguon("TRIAL_SESSION", t.id)]);
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    expect(await cua(ngay, t.id, gv)).toMatchObject({ activity: "TRIAL", trangThai: "DU_BANG_CHUNG", sourceType: "TRIAL_SESSION" });
  });

  it("[P4-DB-11] lịch đổi SAU khi đã chấm công: đánh giá theo phiên bản MỚI; phân công vẫn đã gán (đổi lịch không đưa về chờ nhận)", async () => {
    const ngay = "2026-11-11";
    const L = await lopMoi();
    const s = await buoiMoi(L, ngay);
    await dong([nguon("CLASS_SESSION", s.id)]);
    await quet(gv, ngay, "CHECK_IN", "17:45");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    expect((await cua(ngay, s.id, gv))!.daNhan).toBe(true);
    await db.classSession.update({ where: { id: s.id }, data: { date: vn(ngay, "19:00") } });
    await dong([nguon("CLASS_SESSION", s.id)]);
    const r = (await cua(ngay, s.id, gv))!;
    expect(r.assignmentVersion).toBe(2);
    // ĐẢO 20/10/2026: đổi lịch giữ trạng thái đã gán ⇒ không ngoại lệ "chưa nhận"; lệch giờ vẫn bị bắt bên dưới.
    expect(r.daNhan).toBe(true);
    expect(r.ngoaiLe).not.toContain("ASSIGNMENT_NOT_ACCEPTED");
    expect(r.requiredFrom?.toISOString()).toBe(vn(ngay, "18:50").toISOString());
    // Khoảng cũ 17:45–19:35 không phủ trọn buổi mới 19:00–20:30 ⇒ ra sớm — KHÔNG lặng lẽ diễn giải lại thành "đủ".
    expect(r.trangThai).toBe("RA_SOM");
    // Đối chứng: lời mời cũ trước 20/10 còn chờ nhận ⇒ VẪN là ngoại lệ "chưa nhận lớp".
    await db.sessionStaffAssignment.updateMany({ where: { sourceId: s.id, userId: gv }, data: { status: "WAITING_ACCEPTANCE" } });
    const cu = (await cua(ngay, s.id, gv))!;
    expect(cu.daNhan).toBe(false);
    expect(cu.ngoaiLe).toContain("ASSIGNMENT_NOT_ACCEPTED");
  });

  it("[P4-DB-12] số câu tra KHÔNG đổi khi phân công tăng 10 lần (3 vs 30)", async () => {
    const mot = "2026-11-12";
    const muoi = "2026-11-13";
    const L1 = await lopMoi({ assistantId: ta });
    const nho = await Promise.all([0, 1, 2].map((i) => buoiMoi(L1, mot, `${String(8 + i * 2).padStart(2, "0")}:00`)));
    const lon: { id: string }[] = [];
    for (let i = 0; i < 15; i++) lon.push(await buoiMoi(await lopMoi({ assistantId: ta }), muoi, `${String(7 + (i % 12)).padStart(2, "0")}:${i < 12 ? "00" : "30"}`));
    await dong([...nho, ...lon].map((s) => nguon("CLASS_SESSION", s.id)));
    for (const [u, ngay] of [[gv, mot], [gv, muoi], [ta, mot], [ta, muoi]] as const) {
      await quet(u, ngay, "CHECK_IN", "06:30");
      await quet(u, ngay, "CHECK_OUT", "21:00");
    }
    const dem = async (ngay: string) => {
      ctl.dem = 0;
      const r = await doc(ngay);
      return { so: r.phanCong.length, cau: ctl.dem };
    };
    const a = await dem(mot);
    const b = await dem(muoi);
    expect(a.so).toBe(6); // 3 buổi × (MAIN + TA)
    expect(b.so).toBe(30); // 15 buổi × (MAIN + TA)
    expect(a.cau).toBeGreaterThan(5);
    expect(b.cau).toBe(a.cau);
  });

  it("[P4B-DB-01] \"Công việc của tôi\" chỉ trả phân công CỦA MÌNH, chỉ gắn lượt CỦA MÌNH, và nói ĐÚNG như Control Tower (một định nghĩa)", async () => {
    const ngay = "2026-11-16";
    const cuaToi = await buoiMoi(await lopMoi({ teacherId: gv }), ngay, "18:00");
    const cuaNguoiKhac = await buoiMoi(await lopMoi({ teacherId: gv2 }), ngay, "18:00");
    await dong([cuaToi, cuaNguoiKhac].map((s) => nguon("CLASS_SESSION", s.id)));
    await quet(gv, ngay, "CHECK_IN", "17:56"); // muộn 6' so với 17:50
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    await quet(gv2, ngay, "CHECK_IN", "17:40");
    await quet(gv2, ngay, "CHECK_OUT", "19:40");
    const now = vn(ngay, "22:00");
    const toi = await bcc.docBangChungCuaToi({ userId: gv, tu: ngay, den: ngay, now });
    expect(toi.map((r) => [r.sourceId, r.userId])).toEqual([[cuaToi.id, gv]]);
    expect(toi[0]).toMatchObject({ trangThai: "DI_MUON", treVaoPhut: 6 });
    // Lượt của gv2 (vào sớm hơn, đủ khung) KHÔNG được mượn để làm đẹp bằng chứng của gv.
    expect(toi[0].dongDoi.attendanceInId).not.toBe(null);
    const cuaGv2 = await db.staffTimeLog.findMany({ where: { userId: gv2, workDate: new Date(`${ngay}T00:00:00Z`) }, select: { id: true } });
    expect(cuaGv2.map((x) => x.id)).not.toContain(toi[0].dongDoi.attendanceInId);
    const ql = (await doc(ngay, now)).phanCong.find((r) => r.assignmentId === toi[0].assignmentId)!;
    expect(toi[0]).toEqual(ql);
  });

  it("[P4B-DB-02] \"Có mặt ngoài phân công\" chỉ gồm nhóm DẠY HỌC của cơ sở (nhân sự toàn thời gian không lọt vào) và bỏ qua ngày LEGACY", async () => {
    const ngay = "2026-11-17";
    const cu = "2026-10-13"; // trước 15/10 ⇒ LEGACY
    const nv = (await db.user.create({ data: { email: `nv@${TAG}.test`, name: "Sale p4", role: "SALES_CSM", roles: ["SALES_CSM"], password: "x", centerId: cs1 }, select: { id: true } })).id;
    await lopMoi({ teacherId: gv2, assistantId: ta }); // ta là trợ giảng của một lớp ở cs1 — không có phân công ngày 17/11
    for (const [u, d] of [[nv, ngay], [ta, ngay], [ta, cu]] as const) {
      await quet(u, d, "CHECK_IN", "08:00");
      await quet(u, d, "CHECK_OUT", "11:00");
    }
    const ai = async (ymd: string) => (await doc(ymd)).luotKhongGan.map((x) => x.userId);
    // Đối chứng dương: trợ giảng của cơ sở có mặt ngoài phân công ⇒ CÓ hiện.
    expect(await ai(ngay)).toContain(ta);
    // Nhân sự sale quẹt ở cùng cơ sở, cùng giờ ⇒ KHÔNG hiện (không thuộc miền parttime).
    expect(await ai(ngay)).not.toContain(nv);
    // Ngày LEGACY: cùng người, cùng giờ ⇒ không hiện.
    expect(await ai(cu)).not.toContain(ta);
  });
});
