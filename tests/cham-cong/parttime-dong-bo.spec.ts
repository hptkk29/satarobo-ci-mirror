// tests/cham-cong/parttime-dong-bo.spec.ts — Công Parttime SR.QD.238 · P3a: ĐỒNG BỘ phân công theo vòng đời buổi / lớp /
// học bù / trial trên Postgres THẬT. Ma trận PT3A-01..20 (task P3a §18) + "không sống lại" + "thử lại song song".
//
// Đường nghiệp vụ chỉ ĐÁNH DẤU (DomainEvent `parttime.staffing_dirty`) — ca dùng đường thật thì drain hàng đợi bằng chính
// handler outbox (`chayHangDoi`). Server action cần phiên đăng nhập (huỷ / xoá / sửa lớp, sửa buổi, đổi GV ở màn GV) thì ca
// dựng TRẠNG THÁI SAU của action rồi chạy bộ đồng bộ — dây nối "action có đánh dấu" được ghim riêng ở
// `lib/parttime/dong-bo-wiring.test.ts`.
//
// Bốn công tắc `shift.parttime*Enabled` giả lập trong file (mock `getSetting` đúng một khoá) — không ghi SystemSetting.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-dong-bo] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true }));
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

const TAG = "pt3adb";
const vn = (y: number, m: number, dd: number, h: number, mi = 0) => new Date(Date.UTC(y, m - 1, dd, h - 7, mi));
const SONG = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;

d("[PT3A] đồng bộ phân công theo vòng đời — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let buoiGhi: typeof import("../../lib/classes/buoi-ghi");
  let trial: typeof import("../../lib/trial/service");

  let cs1 = "";
  let cs2 = "";
  let gv = "";
  let gv2 = "";
  let gv3 = "";
  let ta = "";
  let ta2 = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  const actor = { id: "", name: "QLCS pt3a" };

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
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const classIds = cls.map((c) => c.id);
    for (const id of classIds) {
      await db.domainEvent.deleteMany({ where: { type: "class.session_changed", payloadJson: { path: ["classId"], equals: id } } });
    }
    const sessions = await db.classSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    const tcs = await db.trialClassV2.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "TrialClassV2", entityId: { in: tcs.map((t) => t.id) } } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: { in: tcs.map((t) => t.id) } } });
    await db.trialClassV2.deleteMany({ where: { id: { in: tcs.map((t) => t.id) } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    svc = await import("../../lib/parttime/phan-cong-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    buoiGhi = await import("../../lib/classes/buoi-ghi");
    trial = await import("../../lib/trial/service");
    const mkCs = (s: string) =>
      db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG}-${s}` }, select: { id: true } });
    cs1 = (await mkCs("cs1")).id;
    cs2 = (await mkCs("cs2")).id;
    // Cơ sở thật luôn có OrgUnit ⇒ ghi kép tra một lần rồi nhớ. Cơ sở fixture THIẾU OrgUnit thì mỗi lần ghi là một
    // truy vấn `db` trần lồng trong giao dịch — hình dạng dữ liệu prod không có.
    for (const [s, id] of [["cs1", cs1], ["cs2", cs2]] as const) {
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: id } });
    }
    await cleanup();
    const mk = (email: string, name: string, centerId = cs1) =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId }, select: { id: true } });
    gv = (await mk("gv", "GV pt3a")).id;
    gv2 = (await mk("gv2", "GV2 pt3a")).id;
    gv3 = (await mk("gv3", "GV thay pt3a")).id;
    ta = (await mk("ta", "TA pt3a")).id;
    ta2 = (await mk("ta2", "TA2 pt3a")).id;
    ql = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL pt3a", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs1 }, select: { id: true } })).id;
    actor.id = ql;
    khoa = (await db.course.create({ data: { name: "Robotics pt3a", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT pt3a" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    // OrgUnit + cơ sở của fixture PHẢI gỡ: CI chạy các bộ DB nối tiếp trên CÙNG `ci_test`, và guardrail hoa hồng đếm mọi
    // OrgUnit CENTER trong phạm vi — cơ sở thừa không có người phụ trách làm `tests/hoa-hong/*` đỏ `THIEU_NGUOI_PHU_TRACH`
    // (đã xảy ra ở PR #725 lượt đầu).
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const lopMoi = async (p: { teacherId?: string | null; assistantId?: string | null; centerId?: string } = {}) => {
    soLop++;
    return (
      await db.class.create({
        data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: p.centerId ?? cs1, teacherId: p.teacherId === undefined ? gv : p.teacherId, assistantId: p.assistantId ?? null, startTime: "17:30", endTime: "19:30" },
        select: { id: true },
      })
    ).id;
  };
  let ngayKe = 0;
  const buoiMoi = async (classId: string, p: { date?: Date; centerId?: string; substituteTeacherId?: string | null } = {}) => {
    ngayKe++;
    return db.classSession.create({
      data: { classId, centerId: p.centerId ?? cs1, status: "SCHEDULED", date: p.date ?? vn(2026, 11, 1 + (ngayKe % 27), 17, 30), substituteTeacherId: p.substituteTeacherId ?? null },
      select: { id: true, date: true },
    });
  };
  const lop = (id: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: id });
  const dong = (ids: string[], goc: Parameters<typeof dongBo.dongBoNgay>[1] = "SUA_LOP") => dongBo.dongBoNgay(ids.map(lop), goc, actor);
  const pcCua = (sourceId: string) =>
    db.sessionStaffAssignment.findMany({ where: { sourceId }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, role: true, status: true, assignmentType: true, assignmentVersion: true, activityType: true } });
  const song = async (sourceId: string) => (await pcCua(sourceId)).filter((p) => (SONG as readonly string[]).includes(p.status));
  const quyet = (assignmentId: string, userId: string, quyetDinh: "ACCEPTED" | "DECLINED", lyDo?: string) =>
    db.$transaction(async (tx) => svc.quyetDinhNhanLop(tx, { assignmentId, nguoiBam: { id: userId, name: "x" }, quyetDinh, lyDo, phienBanDaXem: (await tx.sessionStaffAssignment.findUnique({ where: { id: assignmentId } }))?.assignmentVersion ?? 0 }));
  /** Lời mời cũ trước 20/10 (ĐẢO 20/10/2026: phân công tạo ra đã gán) — cho ca canh đường nhận / bằng chứng xác nhận cũ. */
  const moiCu = (id: string) => db.sessionStaffAssignment.update({ where: { id }, data: { status: "WAITING_ACCEPTANCE" } });
  const chayHangDoi = async () => {
    const ev = await db.domainEvent.findMany({ where: { type: "parttime.staffing_dirty", status: "PENDING" }, orderBy: { createdAt: "asc" } });
    for (const e of ev) {
      await dongBo.onStaffingDirty({ id: e.id, type: e.type, payload: e.payloadJson as Record<string, unknown> });
      await db.domainEvent.update({ where: { id: e.id }, data: { status: "DONE" } });
    }
    return ev.length;
  };

  it("[PT3A-01][PT3A-02] huỷ LỚP: phân công sống của buổi còn mở ⇒ CANCELLED (có audit nguồn HUY_LOP); bản ghi xác nhận còn nguyên; chạy lại không đổi gì", async () => {
    const L = await lopMoi({ assistantId: ta });
    const s1 = await buoiMoi(L);
    const s2 = await buoiMoi(L);
    await dong([s1.id, s2.id], "TAO_BUOI");
    const [main1] = (await song(s1.id)).filter((p) => p.role === "MAIN_TEACHER");
    // Bản ghi xác nhận chỉ còn sinh từ lời mời cũ ⇒ dựng đúng hình dạng đó để canh "huỷ không xoá bằng chứng".
    await moiCu(main1.id); // lời mời cũ trước 20/10
    expect((await quyet(main1.id, gv, "ACCEPTED")).ok).toBe(true);
    // Trạng thái SAU `cancelClassAction`: lớp CANCELLED + buổi tương lai CANCELLED.
    await db.class.update({ where: { id: L }, data: { status: "CANCELLED" } });
    await db.classSession.updateMany({ where: { classId: L }, data: { status: "CANCELLED" } });
    await dong([s1.id, s2.id], "HUY_LOP");
    for (const s of [s1, s2]) expect((await song(s.id)).length).toBe(0);
    expect((await pcCua(s1.id)).every((p) => p.status === "CANCELLED")).toBe(true);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: main1.id } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: main1.id, action: "PT_ASSIGNMENT_CANCELLED" } });
    expect((audit.newValues as { nguonKichHoat: string }).nguonKichHoat).toBe("HUY_LOP");
    const r = await dong([s1.id, s2.id], "HUY_LOP");
    expect(r.soBuoc).toBe(0);
  });

  it("[PT3A-03] đổi GV mặc định của LỚP ⇒ chỉ phân công SYSTEM của buổi MỞ được thay (người cũ REPLACED, người mới ĐÃ GÁN); buổi đã CHỐT không đụng", async () => {
    const L = await lopMoi();
    const mo = await buoiMoi(L);
    const chot = await buoiMoi(L);
    await dong([mo.id, chot.id], "TAO_BUOI");
    await db.classSession.update({ where: { id: chot.id }, data: { status: "COMPLETED" } });
    await db.class.update({ where: { id: L }, data: { teacherId: gv2 } });
    await dong([mo.id, chot.id]);
    expect((await pcCua(mo.id)).map((p) => [p.userId, p.status, p.assignmentType])).toEqual([
      [gv, "REPLACED", "SYSTEM"],
      [gv2, "ACCEPTED", "SYSTEM"],
    ]);
    expect((await pcCua(chot.id)).map((p) => [p.userId, p.status])).toEqual([[gv, "ACCEPTED"]]);
  });

  it("[PT3A-04] đổi GV mặc định của lớp KHÔNG ghi đè phân công DẠY THAY còn được buổi chống lưng", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, { substituteTeacherId: gv3 });
    await dong([s.id], "TAO_BUOI");
    expect((await song(s.id)).map((p) => [p.userId, p.assignmentType])).toEqual([[gv3, "SUBSTITUTE"]]);
    await db.class.update({ where: { id: L }, data: { teacherId: gv2 } });
    const r = await dong([s.id]);
    expect(r.soBuoc).toBe(0);
    expect((await song(s.id)).map((p) => [p.userId, p.assignmentType])).toEqual([[gv3, "SUBSTITUTE"]]);
  });

  it("[PT3A-05] đổi GV mặc định của lớp KHÔNG ghi đè phân công TAY (MANUAL) — báo ngoại lệ, không đoán", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    const r0 = await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: lop(s.id), userId: gv3, role: "MAIN_TEACHER", assignmentType: "MANUAL", actor }));
    expect(r0.ok).toBe(true);
    await db.class.update({ where: { id: L }, data: { teacherId: gv2 } });
    const r = await dong([s.id]);
    expect(r.ngoaiLe).toBe(1);
    expect((await song(s.id)).map((p) => [p.userId, p.assignmentType])).toEqual([[gv3, "MANUAL"]]);
  });

  it("[PT3A-06] đổi TRỢ GIẢNG mặc định của lớp ⇒ TA dẫn xuất được thay; gỡ TA ⇒ TA dẫn xuất huỷ; TA phân tay giữ nguyên", async () => {
    const L = await lopMoi({ assistantId: ta });
    const s = await buoiMoi(L);
    const tay = await buoiMoi(L);
    await dong([s.id, tay.id], "TAO_BUOI");
    // buổi `tay`: thay TA dẫn xuất bằng TA phân tay
    const taTay = (await song(tay.id)).find((p) => p.role === "TEACHING_ASSISTANT")!;
    await db.$transaction((tx) => svc.huyPhanCong(tx, { id: taTay.id, actor, lyDo: "QLCS đổi trợ giảng" }));
    await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: lop(tay.id), userId: gv3, role: "TEACHING_ASSISTANT", assignmentType: "MANUAL", actor }));
    await db.class.update({ where: { id: L }, data: { assistantId: ta2 } });
    await dong([s.id, tay.id]);
    expect((await song(s.id)).filter((p) => p.role === "TEACHING_ASSISTANT").map((p) => p.userId)).toEqual([ta2]);
    expect((await song(tay.id)).filter((p) => p.role === "TEACHING_ASSISTANT").map((p) => [p.userId, p.assignmentType])).toEqual([[gv3, "MANUAL"]]);
    await db.class.update({ where: { id: L }, data: { assistantId: null } });
    await dong([s.id]);
    expect((await song(s.id)).filter((p) => p.role === "TEACHING_ASSISTANT")).toEqual([]);
  });

  it("[PT3A-07] đổi lịch (đường THẬT dichNgayBuoi → dấu → hàng đợi) ⇒ phiên bản +1, GIỮ trạng thái đã gán, KHÔNG tạo phân công mới", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    await dong([s.id], "TAO_BUOI");
    const main = (await song(s.id))[0];
    expect(main.status).toBe("ACCEPTED");
    await db.$transaction((tx) => buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: s.id, oldDate: s.date, newDate: new Date(s.date.getTime() + 2 * 86_400_000) }], xoaSuaTay: false }));
    expect(await chayHangDoi()).toBeGreaterThanOrEqual(1);
    const ds = await pcCua(s.id);
    expect(ds.length).toBe(1);
    expect(ds[0]).toMatchObject({ id: main.id, assignmentVersion: 2, status: "ACCEPTED" });
    expect(await db.auditLog.count({ where: { entityId: main.id, action: "PT_ASSIGNMENT_CHANGED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: main.id, action: "PT_ACCEPTANCE_INVALIDATED" } })).toBe(0);
  });

  it("[PT3A-08] chuyển buổi sang LỚP KHÁC (khác cơ sở, khác GV) ⇒ không giữ phân công cũ như thể nghĩa vụ không đổi", async () => {
    const A = await lopMoi({ teacherId: gv });
    const B = await lopMoi({ teacherId: gv2, centerId: cs2 });
    const s = await buoiMoi(A);
    await dong([s.id], "TAO_BUOI");
    // Trạng thái SAU `updateSession` (chuyển lớp — P3a: cơ sở theo lớp đích).
    await db.classSession.update({ where: { id: s.id }, data: { classId: B, centerId: cs2 } });
    await dong([s.id], "SUA_BUOI");
    const sau = await song(s.id);
    expect(sau.map((p) => [p.userId, p.status])).toEqual([[gv2, "ACCEPTED"]]);
    expect((await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, userId: gv2 } })).centerId).toBe(cs2);
  });

  it("[PT3A-09] dời buổi từ ≥15/10 về <15/10 (đường thật) ⇒ phân công SR.QD.238 bị huỷ có audit; xác nhận giữ nguyên", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, { date: vn(2026, 10, 20, 17, 30) });
    await dong([s.id], "TAO_BUOI");
    const main = (await song(s.id))[0];
    await moiCu(main.id); // lời mời cũ trước 20/10 — để có bản ghi xác nhận mà canh "giữ nguyên"
    expect((await quyet(main.id, gv, "ACCEPTED")).ok).toBe(true);
    await db.$transaction((tx) => buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: s.id, oldDate: s.date, newDate: vn(2026, 10, 13, 17, 30) }], xoaSuaTay: false }));
    await chayHangDoi();
    expect((await pcCua(s.id)).map((p) => p.status)).toEqual(["CANCELLED"]);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: main.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: main.id, action: "PT_ASSIGNMENT_CANCELLED" } })).toBe(1);
  });

  it("[PT3A-10] dời buổi từ <15/10 sang ≥15/10 ⇒ công tắc BẬT thì dựng; TẮT thì không", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, { date: vn(2026, 10, 12, 17, 30) });
    expect((await dong([s.id], "TAO_BUOI")).soBuoc).toBe(0); // chính sách cũ ⇒ không dựng
    ctl.bat = false;
    try {
      await db.$transaction((tx) => buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: s.id, oldDate: s.date, newDate: vn(2026, 11, 28, 17, 30) }], xoaSuaTay: false }));
      expect(await chayHangDoi()).toBe(0); // tắt + chưa có phân công ⇒ không có dấu
      expect(await pcCua(s.id)).toEqual([]);
    } finally {
      ctl.bat = true;
    }
    await dong([s.id], "DOI_LICH_BUOI");
    expect((await song(s.id)).map((p) => [p.userId, p.role])).toEqual([[gv, "MAIN_TEACHER"]]);
  });

  it("[PT3A-11] buổi có người DẠY THAY ⇒ MAIN dựng về người thay (SUBSTITUTE), KHÔNG có MAIN thứ hai cho GV lớp", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, { substituteTeacherId: gv3 });
    await dong([s.id], "TAO_BUOI");
    const main = await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id, role: "MAIN_TEACHER" } });
    expect(main.map((p) => [p.userId, p.assignmentType, p.status])).toEqual([[gv3, "SUBSTITUTE", "ACCEPTED"]]);
    // gỡ người thay khỏi buổi ⇒ phân công dạy thay hết được chống lưng ⇒ về GV lớp (SYSTEM)
    await db.classSession.update({ where: { id: s.id }, data: { substituteTeacherId: null } });
    await dong([s.id], "DOI_GV_BUOI");
    expect((await song(s.id)).map((p) => [p.userId, p.assignmentType])).toEqual([[gv, "SYSTEM"]]);
  });

  it("[PT3A-12] chạy lại 10 lần + 5 lượt SONG SONG ⇒ đúng MỘT MAIN, một TA, không phân công / thông báo trùng", async () => {
    const L = await lopMoi({ assistantId: ta });
    const s = await buoiMoi(L);
    for (let i = 0; i < 10; i++) await dong([s.id], "TAO_BUOI");
    await Promise.all(Array.from({ length: 5 }, () => dong([s.id], "TAO_BUOI")));
    const ds = await pcCua(s.id);
    expect(ds.map((p) => p.role).sort()).toEqual(["MAIN_TEACHER", "TEACHING_ASSISTANT"]);
    expect(await db.auditLog.count({ where: { entityId: { in: ds.map((p) => p.id) }, action: "PT_ASSIGNMENT_CREATED" } })).toBe(2);
    // ĐẢO 20/10/2026: không còn lời mời ⇒ không dòng PT_ACCEPTANCE_REQUESTED nào.
    expect(await db.auditLog.count({ where: { entityId: { in: ds.map((p) => p.id) }, action: "PT_ACCEPTANCE_REQUESTED" } })).toBe(0);
  });

  // ── Học bù ──
  const caseMoi = (p: { date?: Date; teacherId?: string } = {}) =>
    db.makeupCase.create({
      data: { centerId: cs1, courseId: khoa, lessonId: bai, date: p.date ?? new Date(Date.UTC(2026, 10, 18)), startTime: "14:00", endTime: "15:30", teacherId: p.teacherId ?? gv, status: "SCHEDULED", createdById: ql },
      select: { id: true },
    });
  const bu = (id: string) => ({ sourceType: "MAKEUP_CASE" as const, sourceId: id });

  it("[PT3A-13] tạo case HỌC BÙ ⇒ GV của case được phân MAIN, hoạt động MAKEUP, đã gán", async () => {
    const c = await caseMoi();
    expect(await dongBo.danhDauCanDongBo(null, [bu(c.id)], "HOC_BU_TAO", actor)).toBe(true);
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_TAO", actor);
    expect((await song(c.id)).map((p) => [p.userId, p.role, p.activityType, p.status])).toEqual([[gv, "MAIN_TEACHER", "MAKEUP", "ACCEPTED"]]);
  });

  it("[PT3A-14] công tắc TẮT ⇒ tạo case học bù KHÔNG đánh dấu, KHÔNG phân công", async () => {
    const c = await caseMoi();
    ctl.bat = false;
    try {
      expect(await dongBo.danhDauCanDongBo(null, [bu(c.id)], "HOC_BU_TAO", actor)).toBe(false);
      await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_TAO", actor);
    } finally {
      ctl.bat = true;
    }
    expect(await pcCua(c.id)).toEqual([]);
  });

  it("[PT3A-15] đổi lịch case học bù ⇒ phiên bản +1, giữ đã gán; đổi GV ⇒ người cũ REPLACED, người mới SYSTEM đã gán", async () => {
    const c = await caseMoi();
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_TAO", actor);
    const main = (await song(c.id))[0];
    await db.makeupCase.update({ where: { id: c.id }, data: { startTime: "15:00", endTime: "16:30" } });
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_SUA", actor);
    expect((await song(c.id))[0]).toMatchObject({ id: main.id, assignmentVersion: 2, status: "ACCEPTED" });
    await db.makeupCase.update({ where: { id: c.id }, data: { teacherId: gv2 } });
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_SUA", actor);
    expect((await pcCua(c.id)).map((p) => [p.userId, p.status, p.assignmentType])).toEqual([
      [gv, "REPLACED", "SYSTEM"],
      [gv2, "ACCEPTED", "SYSTEM"],
    ]);
  });

  it("[PT3A-16] huỷ case học bù ⇒ phân công CANCELLED, không xoá bằng chứng", async () => {
    const c = await caseMoi();
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_TAO", actor);
    const main = (await song(c.id))[0];
    await moiCu(main.id); // lời mời cũ trước 20/10 — để có bằng chứng xác nhận mà canh
    expect((await quyet(main.id, gv, "ACCEPTED")).ok).toBe(true);
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([bu(c.id)], "HOC_BU_HUY", actor);
    expect((await pcCua(c.id)).map((p) => p.status)).toEqual(["CANCELLED"]);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: main.id } })).toBe(1);
  });

  // ── Trial ── (đường THẬT `addTrialSession` / `cancelTrialClass` — chúng tự đánh dấu + chạy ngay)
  let soTc = 0;
  const lopTrial = async () => {
    soTc++;
    return (await db.trialClassV2.create({ data: { code: `${TAG}-tc${soTc}`, name: `Trial pt3a ${soTc}`, centerId: cs1, sessionCount: 0 }, select: { id: true } })).id;
  };
  const tr = (id: string) => ({ sourceType: "TRIAL_SESSION" as const, sourceId: id });

  it("[PT3A-17][PT3A-18] tạo buổi TRIAL (đường thật) ⇒ phân công MAIN, hoạt động TRIAL (không thành buổi lớp chính)", async () => {
    const T = await lopTrial();
    const r = await trial.addTrialSession({ trialClassId: T, date: new Date(Date.UTC(2026, 10, 21)), startTime: "09:00", endTime: "10:30", teacherId: gv, actorId: ql });
    expect(r.ok).toBe(true);
    const ds = await song(r.sessionId!);
    expect(ds.map((p) => [p.userId, p.role, p.activityType])).toEqual([[gv, "MAIN_TEACHER", "TRIAL"]]);
  });

  it("[PT3A-19] đổi lịch buổi trial ⇒ phiên bản +1, giữ đã gán; chỉ buổi MỞ; buổi đã chốt không tăng phiên bản", async () => {
    const T = await lopTrial();
    const r = await trial.addTrialSession({ trialClassId: T, date: new Date(Date.UTC(2026, 10, 22)), startTime: "09:00", endTime: "10:30", teacherId: gv, actorId: ql });
    await db.trialClassSession.update({ where: { id: r.sessionId! }, data: { startTime: "10:00", endTime: "11:30" } });
    await dongBo.danhDauVaDongBo([tr(r.sessionId!)], "TRIAL_SUA", actor);
    expect((await song(r.sessionId!))[0]).toMatchObject({ assignmentVersion: 2, status: "ACCEPTED" });
    // Đã chốt ⇒ đổi lịch không đụng phân công.
    await db.trialClassSession.update({ where: { id: r.sessionId! }, data: { status: "COMPLETED", startTime: "13:00", endTime: "14:30" } });
    expect((await dongBo.dongBoNgay([tr(r.sessionId!)], "TRIAL_SUA", actor)).soBuoc).toBe(0);
    expect((await song(r.sessionId!))[0]).toMatchObject({ assignmentVersion: 2, status: "ACCEPTED" });
  });

  it("[PT3A-20] huỷ LỚP trial (đường thật cancelTrialClass) ⇒ phân công các buổi còn mở CANCELLED dù buổi vẫn SCHEDULED; GV không nhận được nữa", async () => {
    const T = await lopTrial();
    const r = await trial.addTrialSession({ trialClassId: T, date: new Date(Date.UTC(2026, 10, 23)), startTime: "09:00", endTime: "10:30", teacherId: gv, actorId: ql });
    const main = (await song(r.sessionId!))[0];
    expect((await trial.cancelTrialClass({ trialClassId: T, actorId: ql })).ok).toBe(true);
    expect((await db.trialClassSession.findUniqueOrThrow({ where: { id: r.sessionId! } })).status).toBe("SCHEDULED");
    expect((await pcCua(r.sessionId!)).map((p) => p.status)).toEqual(["CANCELLED"]);
    expect((await quyet(main.id, gv, "ACCEPTED")).ok).toBe(false);
  });

  it("[PT3A-21] phân công đã đóng KHÔNG sống lại: mở lại buổi ⇒ dòng MỚI phiên bản 1, dòng cũ vẫn CANCELLED", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    await dong([s.id], "TAO_BUOI");
    const cu = (await song(s.id))[0];
    await db.classSession.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
    await dong([s.id], "HUY_BUOI");
    await db.classSession.update({ where: { id: s.id }, data: { status: "SCHEDULED" } });
    await dong([s.id], "MO_LAI_BUOI");
    const ds = await pcCua(s.id);
    expect(ds.map((p) => [p.id === cu.id, p.status, p.assignmentVersion])).toEqual([
      [true, "CANCELLED", 1],
      [false, "ACCEPTED", 1],
    ]);
  });

  it("[PT3A-22] lớp XOÁ MỀM mà buổi vẫn SCHEDULED ⇒ phân công đóng; GV không nhận được", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    await dong([s.id], "TAO_BUOI");
    const main = (await song(s.id))[0];
    // Lời mời cũ trước 20/10: phân công mới đã gán thì cổng TRẠNG THÁI đã từ chối trước — ca này canh cổng "buổi đã đóng".
    await moiCu(main.id);
    await db.class.update({ where: { id: L }, data: { deletedAt: new Date() } });
    expect(await quyet(main.id, gv, "ACCEPTED")).toMatchObject({ ok: false, loi: expect.not.stringMatching(/trạng thái chờ xác nhận/) });
    await dong([s.id], "XOA_LOP");
    expect((await pcCua(s.id)).map((p) => p.status)).toEqual(["CANCELLED"]);
  });

  it("[PT3A-23] công tắc TẮT: ĐÓNG vẫn chạy (huỷ buổi ⇒ huỷ phân công) nhưng KHÔNG dựng / KHÔNG tăng phiên bản", async () => {
    const L = await lopMoi();
    const a = await buoiMoi(L);
    const b = await buoiMoi(L);
    await dong([a.id, b.id], "TAO_BUOI");
    ctl.bat = false;
    try {
      await db.classSession.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
      await db.classSession.update({ where: { id: b.id }, data: { date: new Date(b.date.getTime() + 3600_000) } });
      await dong([a.id, b.id], "HUY_BUOI");
    } finally {
      ctl.bat = true;
    }
    expect((await pcCua(a.id)).map((p) => p.status)).toEqual(["CANCELLED"]);
    expect((await song(b.id))[0].assignmentVersion).toBe(1);
  });

  it("[PT3A-25] QLCS 'Đổi GV chính' (đường thật thayGiaoVienChinh, không mã đơn) ⇒ MANUAL, SỐNG qua đổi GV lớp + dời lịch; đơn dạy thay ⇒ SUBSTITUTE", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    await dong([s.id], "TAO_BUOI");
    const r = await db.$transaction((tx) => svc.thayGiaoVienChinh(tx, { nguon: lop(s.id), gvMoiId: gv3, actor, sourceWorkRequestId: null, lyDo: "QLCS đổi người" }));
    expect(r.ok).toBe(true);
    await db.class.update({ where: { id: L }, data: { teacherId: gv2 } });
    const kq = await dong([s.id]);
    expect(kq.ngoaiLe).toBe(1);
    await db.$transaction((tx) => buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: s.id, oldDate: s.date, newDate: new Date(s.date.getTime() + 86_400_000) }], xoaSuaTay: false }));
    await chayHangDoi();
    expect((await song(s.id)).map((p) => [p.userId, p.assignmentType, p.assignmentVersion])).toEqual([[gv3, "MANUAL", 2]]);
  });

  it("[PT3A-26] công tắc TẮT + giao dịch có scope (đếm ra 0) ⇒ VẪN đánh dấu khi còn phân công sống — đóng không được bỏ sót", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    await dong([s.id], "TAO_BUOI");
    // Giả lập `scopedDb(...).$transaction` của người không có `hr_attendance:*`: mọi phép đọc phân công qua tx ra rỗng.
    const txScope = new Proxy(db, {
      get: (t, k) => (k === "sessionStaffAssignment" ? { count: async () => 0, findMany: async () => [] } : Reflect.get(t, k)),
    }) as unknown as Parameters<typeof dongBo.danhDauCanDongBo>[0];
    ctl.bat = false;
    try {
      expect(await dongBo.danhDauCanDongBo(txScope, [lop(s.id)], "HUY_LOP", actor)).toBe(true);
      await db.classSession.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
      await chayHangDoi();
    } finally {
      ctl.bat = true;
    }
    expect((await pcCua(s.id)).map((p) => p.status)).toEqual(["CANCELLED"]);
  });

  it("[PT3A-24] nguồn hỏng một buổi KHÔNG kéo buổi khác; lỗi ghi audit PARTTIME_STAFFING_SYNC_FAILED và handler NÉM để outbox thử lại", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L);
    const hong = { sourceType: "CLASS_SESSION" as const, sourceId: s.id };
    const spy = vi.spyOn(svc, "dongBoPhanCongTheoNguon");
    spy.mockRejectedValueOnce(new Error("hỏng cấy"));
    try {
      const r = await dongBo.dongBoNgay([hong], "TAO_BUOI", actor);
      expect(r.loi.length).toBe(1);
      expect(await db.auditLog.count({ where: { action: "PARTTIME_STAFFING_SYNC_FAILED", entityId: `CLASS_SESSION:${s.id}` } })).toBe(1);
      spy.mockRejectedValueOnce(new Error("hỏng cấy 2"));
      await expect(dongBo.onStaffingDirty({ id: "x", type: "parttime.staffing_dirty", payload: { nguon: [hong], goc: "TAO_BUOI" } })).rejects.toThrow(/Đồng bộ phân công lỗi/);
    } finally {
      spy.mockRestore();
      await db.auditLog.deleteMany({ where: { action: "PARTTIME_STAFFING_SYNC_FAILED", entityId: `CLASS_SESSION:${s.id}` } });
    }
  });
});
