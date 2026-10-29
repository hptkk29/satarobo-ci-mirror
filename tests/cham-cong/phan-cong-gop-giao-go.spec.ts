// tests/cham-cong/phan-cong-gop-giao-go.spec.ts — GĐ2 phân công gộp: giao / gỡ người và ca trực theo phạm vi, Postgres THẬT.
// Nguồn: docs/phan-cong-gop/KHAO-SAT.md chốt 1, 6 · QUYET-DINH-DEM G2-*. `homNay` truyền tay (luật 19 — không đồng hồ thật);
// `ClassSession.date` mang GIỜ THẬT (luật 4). Mỗi ca tự dựng lớp riêng ⇒ xanh khi chạy một mình (luật 18).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/phan-cong-gop-giao-go] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "pcg2gg";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const SONG = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;
// Thứ Tư liên tiếp + một thứ Năm (đối chứng "các tuần sau" chỉ chạm cùng thứ).
const T4 = ["2026-11-04", "2026-11-11", "2026-11-18"];
const T5 = "2026-11-05";
const HOM_NAY = "2026-11-01";

d("[PCG2-GG] giao / gỡ phân công + trực theo phạm vi — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let gg: typeof import("../../lib/phan-cong/giao-go-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let cs = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let ta2 = "";
  let khoa = "";
  const actor = { id: "", name: "QLCS pcg2" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  /** Dọn lớp / buổi / phân công / trực của bộ — chạy SAU MỖI CA để ca sau không mượn lịch của ca trước (luật 18). */
  async function donLich() {
    await db.domainEvent.deleteMany({ where: { type: { in: ["parttime.staffing_dirty", "class.session_changed"] } } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: pcs.map((p) => p.id) } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const tr = await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: tr.map((t) => t.id) } } });
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ses = await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: ses.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    if (cs) {
      await db.makeupCase.deleteMany({ where: { centerId: cs } });
      await db.trialClassV2.deleteMany({ where: { centerId: cs } });
    }
  }
  async function cleanup() {
    await donLich();
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    gg = await import("../../lib/phan-cong/giao-go-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS pcg2", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV pcg2", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await cleanup();
    const mk = (e: string, role: "TEACHER" | "CENTER_MANAGER" = "TEACHER") =>
      db.user.create({ data: { email: `${e}@${TAG}.test`, name: e, role, roles: [role], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv")).id;
    gv2 = (await mk("gv2")).id;
    ta = (await mk("ta")).id;
    ta2 = (await mk("ta2")).id;
    actor.id = (await mk("ql", "CENTER_MANAGER")).id;
    khoa = (await db.course.create({ data: { name: "Robotics pcg2", slug: `${TAG}-k` }, select: { id: true } })).id;
  });

  afterEach(() => donLich());

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  let soLop = 0;
  /** Lớp mới (GV gv, TA ta) + buổi ở các ngày cho trước, đã đồng bộ phân công mặc định. */
  async function lopVaBuoi(ngays: readonly string[]) {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs, teacherId: gv, assistantId: ta, startTime: "17:30", endTime: "19:00" }, select: { id: true } });
    const ss = [];
    for (const n of ngays) ss.push(await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(n, "17:30") }, select: { id: true } }));
    await dongBo.dongBoNgay(ss.map((s) => ({ sourceType: "CLASS_SESSION" as const, sourceId: s.id })), "TAO_BUOI", actor);
    return { lopId: lop.id, ids: ss.map((s) => s.id) };
  }
  const nguon = (id: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: id });
  const song = (sourceId: string, role?: "MAIN_TEACHER" | "TEACHING_ASSISTANT") =>
    db.sessionStaffAssignment.findMany({ where: { sourceId, status: { in: [...SONG] }, ...(role ? { role } : {}) }, select: { id: true, userId: true, role: true, nguonGiao: true, assignmentType: true } });
  const dat = (p: Partial<Parameters<typeof gg.datNguoiVaoBuoi>[1]> & { nguon: { sourceType: "CLASS_SESSION"; sourceId: string } }) =>
    db.$transaction((tx) =>
      gg.datNguoiVaoBuoi(tx, { role: "MAIN_TEACHER", userId: null, boUserId: null, phamVi: "CHI_BUOI_NAY", homNay: HOM_NAY, lyDo: "thử pcg2", nguonGiao: "TAY", actor, ...p }),
    );
  const dongLai = (ids: string[]) => dongBo.dongBoNgay(ids.map(nguon), "SUA_LOP", actor);

  // ── Chốt lượt 2 điểm 2 (27/10): đứng chính học bù / Trial ghi CẢ cột GV gốc, cùng giao dịch ──
  async function caseBu(ngay: string, teacherId = gv) {
    const c = await db.makeupCase.create({
      data: { centerId: cs, courseId: khoa, lessonId: `${TAG}-bai`, date: new Date(`${ngay}T00:00:00Z`), startTime: "17:30", endTime: "19:00", teacherId, status: "SCHEDULED", createdById: actor.id },
      select: { id: true },
    });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    return c.id;
  }
  async function buoiTrial(ngay: string, teacherId: string | null = gv) {
    soLop++;
    const l = await db.trialClassV2.create({ data: { code: `${TAG}-t${soLop}`, name: `${TAG} T${soLop}`, centerId: cs, sessionCount: 1 }, select: { id: true } });
    const t = await db.trialClassSession.create({ data: { trialClassId: l.id, seq: 1, date: new Date(`${ngay}T00:00:00Z`), startTime: "17:30", endTime: "19:00", teacherId }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "TRIAL_SESSION", sourceId: t.id }], "TAO_BUOI", actor);
    return t.id;
  }
  const datNguon = (n: { sourceType: "MAKEUP_CASE" | "TRIAL_SESSION"; sourceId: string }, p: { userId?: string | null; boUserId?: string | null }) =>
    db.$transaction((tx) =>
      gg.datNguoiVaoBuoi(tx, { nguon: n, role: "MAIN_TEACHER", userId: null, boUserId: null, phamVi: "CHI_BUOI_NAY", homNay: HOM_NAY, lyDo: "thử pcg2", nguonGiao: "TAY", actor, ...p }),
    );
  const gvCase = async (id: string) => (await db.makeupCase.findUniqueOrThrow({ where: { id } })).teacherId;
  const gvTrial = async (id: string) => (await db.trialClassSession.findUniqueOrThrow({ where: { id } })).teacherId;

  it("[PCG2-GG01] giao đứng chính buổi lớp ⇒ phân công TAY + GV dạy thay của buổi (hai nơi, một giao dịch); đồng bộ lại KHÔNG đè", async () => {
    const { ids } = await lopVaBuoi([T4[0]!]);
    const kq = await dat({ nguon: nguon(ids[0]!), userId: gv2 });
    expect(kq).toMatchObject({ soNgay: 1, boQua: [] });
    expect(await song(ids[0]!, "MAIN_TEACHER")).toEqual([expect.objectContaining({ userId: gv2, nguonGiao: "TAY", assignmentType: "MANUAL" })]);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: ids[0]! } })).substituteTeacherId).toBe(gv2);
    expect(await db.auditLog.count({ where: { action: "PT_ASSIGNMENT_CREATED", entityId: (await song(ids[0]!, "MAIN_TEACHER"))[0]!.id } })).toBe(1);
    await dongLai(ids);
    expect((await song(ids[0]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]);
  });

  it("[PCG2-GG02] “các tuần sau” ⇒ mọi buổi CÙNG THỨ tới hết THÁNG ĐANG XEM; buổi khác thứ + buổi cùng thứ tháng sau không đụng (đối chứng)", async () => {
    const { ids } = await lopVaBuoi([...T4, T5, "2026-12-02"]);
    const kq = await dat({ nguon: nguon(ids[0]!), userId: gv2, phamVi: "CAC_TUAN_SAU" });
    expect(kq.soNgay).toBe(3);
    for (const id of ids.slice(0, 3)) expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]);
    expect((await song(ids[3]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
    // Thứ Tư 02/12 cùng thứ nhưng sang tháng sau — chủ dự án 26/10: "tới hết THÁNG ĐANG XEM, không phải tháng sau".
    expect((await song(ids[4]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
  });

  it("[PCG2-GG03] ngày đã qua (so với homNay) ⇒ BỎ QUA và báo lại; các ngày sau vẫn giao", async () => {
    const { ids } = await lopVaBuoi(T4);
    const kq = await dat({ nguon: nguon(ids[0]!), userId: gv2, phamVi: "CAC_TUAN_SAU", homNay: T4[1]! });
    expect(kq.soNgay).toBe(2);
    expect(kq.boQua).toEqual([{ ngay: T4[0], lyDo: expect.stringMatching(/đã qua/) }]);
    expect((await song(ids[0]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
    expect((await song(ids[1]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]);
  });

  it("[PCG2-GG04] kỳ đã chốt ⇒ bỏ qua, không dòng nào đổi; đối chứng: kỳ mở thì giao được", async () => {
    const { ids } = await lopVaBuoi([T4[0]!]);
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-11", status: "LOCKED" } });
    try {
      const kq = await dat({ nguon: nguon(ids[0]!), userId: gv2 });
      expect(kq).toMatchObject({ soNgay: 0, boQua: [{ ngay: T4[0], lyDo: expect.stringMatching(/đã chốt/) }] });
      expect((await song(ids[0]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
    } finally {
      await db.attendancePeriod.deleteMany({ where: { centerId: cs, periodKey: "2026-11" } });
    }
    expect((await dat({ nguon: nguon(ids[0]!), userId: gv2 })).soNgay).toBe(1);
  });

  it("[PCG2-GG05] gỡ người dạy thay ⇒ GV của lớp đứng lại (dòng DONG_BO mới, dạy thay xoá); gỡ GV của lớp ⇒ CHẶN (buổi phải có người)", async () => {
    const { ids } = await lopVaBuoi([T4[0]!]);
    await dat({ nguon: nguon(ids[0]!), userId: gv2 });
    const kq = await dat({ nguon: nguon(ids[0]!), boUserId: gv2 });
    expect(kq.soNgay).toBe(1);
    expect(await song(ids[0]!, "MAIN_TEACHER")).toEqual([expect.objectContaining({ userId: gv, nguonGiao: "DONG_BO" })]);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: ids[0]! } })).substituteTeacherId).toBeNull();
    expect(await db.sessionStaffAssignment.findFirst({ where: { sourceId: ids[0]!, userId: gv2 } })).toMatchObject({ status: "CANCELLED", nguonGiao: "TAY" });
    await expect(dat({ nguon: nguon(ids[0]!), boUserId: gv })).rejects.toThrow(/phải có giáo viên đứng chính/);
    expect((await song(ids[0]!, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
  });

  it("[PCG2-GG06] gỡ trợ giảng MẶC ĐỊNH ⇒ đồng bộ lại KHÔNG dựng lại (gỡ trống, chốt 6); đối chứng: thay TA ⇒ người mới TAY, người cũ huỷ", async () => {
    const { ids } = await lopVaBuoi([T4[0]!, T4[1]!]);
    await dat({ nguon: nguon(ids[0]!), role: "TEACHING_ASSISTANT", boUserId: ta });
    await dongLai(ids);
    expect(await song(ids[0]!, "TEACHING_ASSISTANT")).toEqual([]);
    expect((await song(ids[1]!, "TEACHING_ASSISTANT")).map((p) => p.userId)).toEqual([ta]);
    await dat({ nguon: nguon(ids[1]!), role: "TEACHING_ASSISTANT", userId: ta2, boUserId: ta });
    await dongLai(ids);
    expect(await song(ids[1]!, "TEACHING_ASSISTANT")).toEqual([expect.objectContaining({ userId: ta2, nguonGiao: "TAY" })]);
  });

  it("[PCG2-GG07] lỗi giữa lô ⇒ CẢ LÔ quay lui (không buổi nào đổi)", async () => {
    const { ids } = await lopVaBuoi(T4);
    // Buổi thứ ba: gv2 đã giữ vai trợ giảng ⇒ phân đứng chính sẽ ném ⇒ hai buổi đầu cũng không được đổi.
    await dat({ nguon: nguon(ids[2]!), role: "TEACHING_ASSISTANT", userId: gv2, boUserId: ta });
    await expect(dat({ nguon: nguon(ids[0]!), userId: gv2, phamVi: "CAC_TUAN_SAU" })).rejects.toThrow();
    for (const id of ids.slice(0, 2)) {
      expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
      expect((await db.classSession.findUniqueOrThrow({ where: { id } })).substituteTeacherId).toBeNull();
    }
  });

  it("[PCG2-GG08] trực “các tuần sau” ⇒ mỗi tuần TỚI HẾT THÁNG một dòng ACCEPTED nguồn TAY; gỡ một buổi ⇒ đúng một dòng CANCELLED; giao lại trùng ⇒ bỏ qua", async () => {
    const tr = (p: Partial<Parameters<typeof gg.datTruc>[1]>) =>
      db.$transaction((tx) => gg.datTruc(tx, { centerId: cs, userId: gv, ngay: T4[0]!, shiftCode: "T", giao: true, phamVi: "CAC_TUAN_SAU", homNay: HOM_NAY, lyDo: "thử trực", actor, ...p }));
    const kq = await tr({});
    const dong = await db.operationsDutyAssignment.findMany({ where: { userId: gv, centerId: cs }, orderBy: { workDate: "asc" } });
    expect(kq.soNgay).toBe(dong.length);
    // Tới hết THÁNG CỦA BUỔI (chủ dự án 26/10/2026): 04, 11, 18, 25/11 — không sang thứ Tư tháng 12.
    expect(dong.map((x) => x.workDate.toISOString().slice(0, 10))).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect(dong.every((x) => x.status === "ACCEPTED" && x.nguonGiao === "TAY")).toBe(true);
    expect((await tr({ phamVi: "CHI_BUOI_NAY" })).boQua).toEqual([{ ngay: T4[0], lyDo: "Đã giao trực ca này rồi" }]);
    await tr({ giao: false, phamVi: "CHI_BUOI_NAY", ngay: T4[1]! });
    expect(await db.operationsDutyAssignment.count({ where: { userId: gv, centerId: cs, status: "CANCELLED" } })).toBe(1);
  });

  it("[PCG2-GG09] giao đứng chính HỌC BÙ ⇒ phân công TAY + `MakeupCase.teacherId` (hai nơi, một giao dịch); gỡ trống ⇒ CHẶN, không nơi nào đổi", async () => {
    const id = await caseBu(T4[0]!);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]); // đối chứng: đồng bộ dựng đúng người của case
    const kq = await datNguon({ sourceType: "MAKEUP_CASE", sourceId: id }, { userId: gv2 });
    expect(kq.soNgay).toBe(1);
    expect(await song(id, "MAIN_TEACHER")).toEqual([expect.objectContaining({ userId: gv2, nguonGiao: "TAY" })]);
    expect(await gvCase(id)).toBe(gv2);
    await expect(datNguon({ sourceType: "MAKEUP_CASE", sourceId: id }, { boUserId: gv2 })).rejects.toThrow(/phải có giáo viên/);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]);
    expect(await gvCase(id)).toBe(gv2);
  });

  it("[PCG2-GG10] người mới TRÙNG LỊCH dạy khác ⇒ chặn, phân công VÀ cột GV gốc đều giữ nguyên (quay lui cả hai)", async () => {
    const id = await caseBu(T4[0]!);
    const lop = await db.class.create({ data: { name: `${TAG} Lban`, courseId: khoa, centerId: cs, teacherId: gv2, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(T4[0]!, "18:00") } });
    await expect(datNguon({ sourceType: "MAKEUP_CASE", sourceId: id }, { userId: gv2 })).rejects.toThrow(/trùng khung/);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
    expect(await gvCase(id)).toBe(gv);
  });

  it("[PCG2-GG11] Trial: giao ⇒ `TrialClassSession.teacherId` theo; gỡ đúng người ⇒ cột về trống; gỡ người KHÁC cột ⇒ cột giữ", async () => {
    const id = await buoiTrial(T4[0]!);
    const n = { sourceType: "TRIAL_SESSION" as const, sourceId: id };
    await datNguon(n, { userId: gv2 });
    expect(await gvTrial(id)).toBe(gv2);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]);
    await datNguon(n, { boUserId: gv2 });
    expect(await gvTrial(id)).toBeNull();
    // Đối chứng vế "đúng người": cột trỏ gv, phân công đứng chính là gv2 (lệch cũ) ⇒ gỡ gv2 không xoá gv khỏi cột.
    const id2 = await buoiTrial(T4[1]!);
    await db.sessionStaffAssignment.updateMany({ where: { sourceId: id2, role: "MAIN_TEACHER" }, data: { userId: gv2 } });
    await datNguon({ sourceType: "TRIAL_SESSION", sourceId: id2 }, { boUserId: gv2 });
    expect(await gvTrial(id2)).toBe(gv);
  });

  // Chiều NGƯỢC (advisor lượt 2): module GỐC đổi GV sau khi màn Phân công giao tay ⇒ phải không lệch.
  let pcm: typeof import("../../lib/parttime/phan-cong-db");
  const moduleGocDoi = async (n: { sourceType: "MAKEUP_CASE" | "TRIAL_SESSION"; sourceId: string }, gvMoi: string, traQuyen: boolean) => {
    pcm ??= await import("../../lib/parttime/phan-cong-db");
    await db.$transaction(async (tx) => {
      if (n.sourceType === "MAKEUP_CASE") await tx.makeupCase.update({ where: { id: n.sourceId }, data: { teacherId: gvMoi } });
      else await tx.trialClassSession.update({ where: { id: n.sourceId }, data: { teacherId: gvMoi } });
      if (traQuyen) await pcm.dongBoDungChinhTuNguonGoc(tx, { nguon: n, gvMoiId: gvMoi, actor, lyDo: "module gốc đổi" });
    });
    await dongBo.dongBoNgay([n], "HOC_BU_SUA", actor);
  };

  it("[PCG2-GG12] màn Phân công giao gv2 (TAY) rồi module gốc đổi GV ⇒ thay đứng chính CÙNG giao dịch (hai nơi khớp); đối chứng: không gọi bước đó ⇒ lệch", async () => {
    const id = await caseBu(T4[0]!);
    const n = { sourceType: "MAKEUP_CASE" as const, sourceId: id };
    await datNguon(n, { userId: gv2 });
    await moduleGocDoi(n, ta, false);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv2]); // đây là lỗi lệch nếu thiếu bước đồng bộ ngược
    await moduleGocDoi(n, gv, true);
    expect(await gvCase(id)).toBe(gv);
    expect(await song(id, "MAIN_TEACHER")).toEqual([expect.objectContaining({ userId: gv, nguonGiao: "TAY" })]);
  });

  it("[PCG2-GG13] Trial: người bị GỠ TAY khỏi đứng chính được module gốc chọn lại ⇒ dấu gỡ tay được nhấc, đồng bộ dựng lại đúng người", async () => {
    const id = await buoiTrial(T4[0]!);
    const n = { sourceType: "TRIAL_SESSION" as const, sourceId: id };
    await datNguon(n, { boUserId: gv }); // gỡ tay ⇒ dấu CANCELLED TAY, cột về trống
    expect(await song(id, "MAIN_TEACHER")).toEqual([]);
    await moduleGocDoi(n, gv, true);
    expect((await song(id, "MAIN_TEACHER")).map((p) => p.userId)).toEqual([gv]);
  });
});
