// tests/hoc-bu/so-luot.test.ts — T06: SỔ LƯỢT học bù trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Mỗi ca là MỘT lỗ T06 bịt (audit 07/10/2026):
//   · HB-20  hai dòng cùng bé xếp cùng lúc đều thấy "còn 1 lượt" ⇒ vượt lượt, số âm bị che
//   · HB-19  quỹ theo (học viên, LỚP) ⇒ chuyển lớp đếm lại từ 0 — nay theo (học viên, KHOÁ)
//   · HB-18  đơn huỷ ⇒ rơi về Course.totalSessions ⇒ lượt TĂNG về đủ khoá
//   · dữ liệu trước T06 (đang giữ / đã tiêu) phải được NHẬP vào sổ chứ không biến mất
//   · DB tự chặn số âm / bút toán sai dạng / sửa bút toán — lỗi mã không che được
//
// Khoá công thức: khoá T06 có HAI bài thuộc hai học phần (M1, M2), mỗi học phần 1 lượt ⇒ công thức cấp 2 lượt.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu, diemDanhBu, ghiBeVaoCase, goKhoiCase, huyCase, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { docDongTheoId, type DongCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { LoiLuot, dieuChinhLuot, docSoLuot, giuLuot, khoaTaiKhoan, nhaLuot, tieuLuot } from "@/lib/hoc-bu/so-luot";
import { conLai, tongTuSo } from "@/lib/hoc-bu/so-luot-thuan";
import { apDungNhapSo, docCapCanNhap } from "@/lib/hoc-bu/so-luot-nhap-db";
import { docSnapshot } from "@/lib/hoc-bu/toan-ven-db";
import { chayToanVen, type Finding } from "@/lib/hoc-bu/toan-ven";
import { vnDateAt } from "@/lib/time/vn";

if (!RUN_DB_TESTS) console.warn(`[SLD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t06-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const BAI2 = id("bai2");
const GV = id("gv");
const LOP = id("lop");
const LOP2 = id("lop2"); // cùng khoá — thử chuyển lớp (HB-19)
const HV0 = id("hv0");
const HV1 = id("hv1");
const BUOI = [id("b0"), id("b1"), id("b2"), id("b3")] as const;
const CASE_A = id("case-a");
const CASE_B = id("case-b");

const ADMIN = {
  userId: GV,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null, // T10: phạm vi Sale — null = thấy hết trong tầm nhìn cơ sở
} as unknown as NguoiHocBu;

const luc = (d: number, h: number, mi: number) => vnDateAt(2026, 9, d, h, mi);
const needId = (hv: string, i: number) => id(`n-${hv}-${i}`);

async function don() {
  const needs = await db.makeupNeed.findMany({ where: { studentId: { in: [HV0, HV1] } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: needs.map((n) => `makeup.requested:${n.id}`) } } });
  const items = await db.orderItem.findMany({ where: { studentId: { in: [HV0, HV1] } }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.makeupCase.deleteMany({ where: { id: { in: [CASE_A, CASE_B] } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [HV0, HV1] } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { in: [HV0, HV1] } } });
  await db.attendance.deleteMany({ where: { studentId: { in: [HV0, HV1] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.enrollment.deleteMany({ where: { studentId: { in: [HV0, HV1] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.lesson.deleteMany({ where: { id: { in: [BAI1, BAI2] } } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV0, HV1] } } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

/**
 * Khoá KHOA: hai học phần ⇒ công thức cấp 2 lượt (không có đơn nào khai số buổi ⇒ mặc định `totalSessions`).
 * HV0 có BỐN buổi vắng (b0..b3, cùng bài 1) ⇒ BỐN dòng PENDING; HV1 một dòng.
 */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T06", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: GV, name: "GV T06", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T06", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "Giáo trình T06" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.lesson.create({ data: { id: BAI2, curriculumId: CUR, order: 2, title: "Bài 2", moduleCode: "M2" } });
  for (const l of [LOP, LOP2]) {
    await db.class.create({ data: { id: l, name: l, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  }
  for (const [hv, ten] of [[HV0, "Bé T06 A"], [HV1, "Bé T06 B"]] as const) {
    await db.student.create({ data: { id: hv, name: ten, centerId: CS } });
    await db.enrollment.create({ data: { id: id(`gd-${hv}`), studentId: hv, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  }
  for (const [i, b] of BUOI.entries()) {
    await db.classSession.create({ data: { id: b, classId: LOP, date: new Date(`2026-10-0${i + 1}T11:00:00.000Z`), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
  }
  const need = (hv: string, i: number, status: "PENDING" | "SCHEDULED" | "COMPLETED" = "PENDING", usedQuota = false) => ({
    id: needId(hv, i), studentId: hv, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE" as const,
    missedSessionId: BUOI[i]!, missedLessonId: BAI1, status, usedQuota,
  });
  await db.makeupNeed.createMany({ data: [need(HV0, 0), need(HV0, 1), need(HV0, 2), need(HV0, 3), need(HV1, 0)] });
  for (const c of [CASE_A, CASE_B]) {
    await db.makeupCase.create({
      data: { id: c, centerId: CS, courseId: KHOA, lessonId: BAI1, date: new Date("2026-10-15T00:00:00.000Z"), startTime: "18:00", endTime: "19:30", teacherId: GV, status: "SCHEDULED", createdById: GV },
    });
  }
}

const dinhDanh = (hv: string, lop = LOP) => ({ studentId: hv, courseId: KHOA, classId: lop });
const tx = <T>(f: (t: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(f, { timeout: 30_000 });
const taiKhoan = (hv: string) => db.makeupCreditAccount.findUnique({ where: { studentId_courseId: { studentId: hv, courseId: KHOA } } });
const butToan = async (hv: string) => {
  const a = await taiKhoan(hv);
  return a ? db.makeupCreditEntry.findMany({ where: { accountId: a.id }, orderBy: { createdAt: "asc" } }) : [];
};
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
/** Lấy `DongCanBu` THẬT (qua đúng đường màn hình dùng) — có `luot` và `xep` tính từ công thức/sổ. */
const dongThat = async (...ids: string[]): Promise<DongCanBu[]> => docDongTheoId(scopedDb(ADMIN), ids, null);
const xepVao = async (caseId: string, ...ids: string[]) => {
  const dong = await dongThat(...ids);
  expect(dong).toHaveLength(ids.length);
  await tx((t) => ghiBeVaoCase(t, { id: caseId, orgUnitId: null }, CS, dong, GV));
};
/** Số của tài khoản PHẢI bằng tổng bút toán — bất biến cốt lõi của sổ. */
const kiemKhop = async (hv: string) => {
  const a = (await taiKhoan(hv))!;
  const but = await butToan(hv);
  expect({ granted: a.granted, held: a.held, consumed: a.consumed }).toEqual(tongTuSo(but));
  expect(conLai(a)).toBeGreaterThanOrEqual(0);
};

describe.skipIf(!RUN_DB_TESTS)("[SLD] sổ lượt học bù — T06", () => {
  beforeEach(dung);
  afterAll(don);

  // ── DB tự gác ─────────────────────────────────────────────────────────────────────────
  it("[SLD-00] DB tự chặn: số âm/vượt, bút toán sai dạng, sửa bút toán — lỗi mã không che được", async () => {
    const a = await db.makeupCreditAccount.create({ data: { studentId: HV0, courseId: KHOA, granted: 1 } });
    expect(await bat(db.makeupCreditAccount.update({ where: { id: a.id }, data: { held: 2 } }))).toBeTruthy(); // held > granted
    expect(await bat(db.makeupCreditAccount.update({ where: { id: a.id }, data: { consumed: -1 } }))).toBeTruthy();
    // HOLD mà held +2 ≠ dạng hợp lệ; GRANT mà đổi held; ADJUSTMENT không lý do.
    const e = (data: Record<string, unknown>) => db.makeupCreditEntry.create({ data: { accountId: a.id, ...data } as never });
    expect(await bat(e({ type: "HOLD", heldDelta: 2 }))).toBeTruthy();
    expect(await bat(e({ type: "GRANT", grantedDelta: 1, heldDelta: 1 }))).toBeTruthy();
    expect(await bat(e({ type: "ADJUSTMENT", grantedDelta: 1 }))).toBeTruthy();
    // Đối chứng: dạng đúng thì được — thiếu vế này thì ba vế trên xanh vì bảng từ chối MỌI thứ.
    const ok = await e({ type: "GRANT", grantedDelta: 1 });
    // Bút toán chỉ-thêm: UPDATE bị trigger chặn.
    expect(await bat(db.makeupCreditEntry.update({ where: { id: ok.id }, data: { reason: "sửa lén" } }))).toBeTruthy();
    // Khoá chống lặp: cùng (tài khoản, idemKey) không ghi hai lần.
    await e({ type: "HOLD", heldDelta: 1, idemKey: "k" });
    expect(await bat(e({ type: "HOLD", heldDelta: 1, idemKey: "k" }))).toBeTruthy();
  });

  // ── khởi tạo ──────────────────────────────────────────────────────────────────────────
  it("[SLD-01] lần đầu một bé dùng sổ: tạo tài khoản, cấp 2 lượt theo công thức, MỘT bút toán GRANT; gọi lại không ghi thêm", async () => {
    const tk = await tx((t) => khoaTaiKhoan(t, dinhDanh(HV0), GV));
    expect(tk).toMatchObject({ granted: 2, held: 0, consumed: 0 });
    await tx((t) => khoaTaiKhoan(t, dinhDanh(HV0), GV));
    const but = await butToan(HV0);
    expect(but.map((b) => b.type)).toEqual(["GRANT"]);
    expect(but[0]).toMatchObject({ grantedDelta: 2, idemKey: "GRANT:khoi-tao" });
    await kiemKhop(HV0);
  });

  it("[SLD-02] ba lượt khởi tạo ĐỒNG THỜI ⇒ đúng MỘT tài khoản, đúng MỘT GRANT", async () => {
    await Promise.all([1, 2, 3].map(() => tx((t) => khoaTaiKhoan(t, dinhDanh(HV0), GV))));
    expect(await db.makeupCreditAccount.count({ where: { studentId: HV0 } })).toBe(1);
    expect((await butToan(HV0)).map((b) => b.type)).toEqual(["GRANT"]);
    await kiemKhop(HV0);
  });

  it("[SLD-03] dữ liệu TRƯỚC T06 được NHẬP vào sổ: đang giữ ⇒ HOLD, đã tiêu ⇒ CONSUME (held 0) — không biến mất", async () => {
    await db.makeupNeed.update({ where: { id: needId(HV0, 0) }, data: { status: "COMPLETED", usedQuota: true } });
    await db.makeupNeed.update({ where: { id: needId(HV0, 1) }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.create({ data: { id: id("sv1"), caseId: CASE_A, makeupNeedId: needId(HV0, 1), status: "PLACED", dungLuot: true, centerId: CS, addedById: GV } });
    // Một mục xếp bằng PHÍ (dungLuot false) KHÔNG phải lượt đang giữ.
    await db.makeupNeed.update({ where: { id: needId(HV0, 2) }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.create({ data: { id: id("sv2"), caseId: CASE_A, makeupNeedId: needId(HV0, 2), status: "PLACED", dungLuot: false, centerId: CS, addedById: GV } });
    const tk = await tx((t) => khoaTaiKhoan(t, dinhDanh(HV0), GV));
    expect(tk).toMatchObject({ granted: 2, held: 1, consumed: 1 });
    expect((await butToan(HV0)).map((b) => b.type).sort()).toEqual(["CONSUME", "GRANT", "HOLD"]);
    expect((await butToan(HV0)).find((b) => b.type === "CONSUME")).toMatchObject({ heldDelta: 0, consumedDelta: 1 });
    await kiemKhop(HV0);
  });

  it("[SLD-04] HB-20: dữ liệu cũ ĐÃ dùng vượt công thức ⇒ ADJUSTMENT dương CÓ LÝ DO, sổ không âm, số vượt nằm trong sổ", async () => {
    for (const i of [0, 1, 2]) await db.makeupNeed.update({ where: { id: needId(HV0, i) }, data: { status: "COMPLETED", usedQuota: true } });
    const tk = await tx((t) => khoaTaiKhoan(t, dinhDanh(HV0), GV));
    expect(tk).toMatchObject({ granted: 3, held: 0, consumed: 3 });
    const adj = (await butToan(HV0)).filter((b) => b.type === "ADJUSTMENT");
    expect(adj).toHaveLength(1);
    expect(adj[0]!.reason).toMatch(/vượt/);
    expect(conLai(tk)).toBe(0);
    await kiemKhop(HV0);
  });

  // ── xếp case ──────────────────────────────────────────────────────────────────────────
  it("[SLD-05] xếp bằng lượt ⇒ GIỮ lượt ngay trong giao dịch xếp; hai dòng của một bé hết lượt; dòng thứ ba bị TỪ CHỐI và không để lại gì", async () => {
    await xepVao(CASE_A, needId(HV0, 0), needId(HV0, 1));
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 2, consumed: 0 });
    const sv = await db.makeupCaseStudent.findMany({ where: { caseId: CASE_A }, select: { id: true } });
    expect((await butToan(HV0)).filter((b) => b.type === "HOLD").map((b) => b.caseStudentId).sort()).toEqual(sv.map((s) => s.id).sort());

    // Dòng thứ ba: màn hình nay đọc SỔ nên thấy "hết lượt" — nút xếp bị khoá thay vì mở rồi mới bị từ chối.
    const [d3] = await dongThat(needId(HV0, 2));
    expect(d3!.luot.con).toBe(0);
    expect(d3!.xep.ok).toBe(false);
  });

  it("[SLD-06] HB-20: màn hình nói 'còn lượt' nhưng sổ đã hết (đua) ⇒ `giuLuot` ném HET_LUOT, cả case rollback", async () => {
    await xepVao(CASE_A, needId(HV0, 0), needId(HV0, 1));
    const [d] = await dongThat(needId(HV0, 2));
    // `luot.con` đọc từ SỔ nên đã 0 — dựng lại "bản chụp cũ" của màn hình trước khi hai lượt kia commit.
    expect(d!.luot.con).toBe(0);
    const cu: DongCanBu = { ...d!, luot: { tong: 2, daDung: 0, con: 2 }, xep: { ok: true, dungLuot: true } };
    const truocSv = await db.makeupCaseStudent.count({ where: { makeupNeed: { studentId: HV0 } } });
    const loi = await bat(tx((t) => ghiBeVaoCase(t, { id: CASE_B, orgUnitId: null }, CS, [cu], GV)));
    expect(loi).toBeInstanceOf(LoiLuot);
    expect((loi as LoiLuot).ma).toBe("HET_LUOT");
    // Rollback trọn: không mục case, dòng còn PENDING, sổ nguyên.
    expect(await db.makeupCaseStudent.count({ where: { makeupNeed: { studentId: HV0 } } })).toBe(truocSv);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId(HV0, 2) } })).status).toBe("PENDING");
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 2, consumed: 0 });
    await kiemKhop(HV0);
  });

  it("[SLD-07] HB-20: hai lượt xếp ĐỒNG THỜI hai dòng khác nhau của một bé khi chỉ còn MỘT lượt ⇒ đúng MỘT thắng, lượt âm không xảy ra", async () => {
    await xepVao(CASE_A, needId(HV0, 0)); // còn 1
    const [d1, d2] = await dongThat(needId(HV0, 1), needId(HV0, 2));
    const cuA: DongCanBu = { ...d1!, xep: { ok: true, dungLuot: true } };
    const cuB: DongCanBu = { ...d2!, xep: { ok: true, dungLuot: true } };
    const kq = await Promise.all([
      bat(tx((t) => ghiBeVaoCase(t, { id: CASE_A, orgUnitId: null }, CS, [cuA], GV))),
      bat(tx((t) => ghiBeVaoCase(t, { id: CASE_B, orgUnitId: null }, CS, [cuB], GV))),
    ]);
    expect(kq.filter((x) => x === null)).toHaveLength(1);
    expect(kq.filter((x) => x instanceof LoiLuot)).toHaveLength(1);
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 2 });
    await kiemKhop(HV0);
  });

  it("[SLD-08] sổ KHỞI TẠO trước khi tạo mục case: công thức cấp 0 ⇒ xếp bị từ chối, KHÔNG có ADJUSTMENT tự bù cho chính mục vừa tạo", async () => {
    // Khoá không cho bù ⇒ công thức 0. Màn hình bản chụp cũ vẫn thấy LUOT (dòng giả).
    await db.course.update({ where: { id: KHOA }, data: { choPhepHocBu: false } });
    const [d] = await dongThat(needId(HV1, 0));
    const dong: DongCanBu = { ...d!, xep: { ok: true, dungLuot: true } };
    const loi = await bat(tx((t) => ghiBeVaoCase(t, { id: CASE_A, orgUnitId: null }, CS, [dong], GV)));
    expect(loi).toBeInstanceOf(LoiLuot);
    expect(await db.makeupCreditEntry.count({ where: { type: "ADJUSTMENT", account: { studentId: HV1 } } })).toBe(0);
    await db.course.update({ where: { id: KHOA }, data: { choPhepHocBu: true } });
  });

  it("[SLD-09] xếp bằng PHÍ/miễn phí (dungLuot=false) KHÔNG đụng sổ", async () => {
    const [d] = await dongThat(needId(HV1, 0));
    const phi: DongCanBu = { ...d!, xep: { ok: true, dungLuot: false } };
    await tx((t) => ghiBeVaoCase(t, { id: CASE_A, orgUnitId: null }, CS, [phi], GV));
    expect(await taiKhoan(HV1)).toBeNull();
  });

  // ── vòng đời ──────────────────────────────────────────────────────────────────────────
  it("[SLD-10] bé CÓ MẶT ở buổi bù ⇒ lượt đang giữ thành ĐÃ TIÊU (held→consumed); điểm danh lại không tiêu hai lần", async () => {
    await xepVao(CASE_A, needId(HV0, 0));
    const sv = await db.makeupCaseStudent.findFirstOrThrow({ where: { caseId: CASE_A } });
    await diemDanhBu(null, { caseStudentId: sv.id, coMat: true, chiGiaoVien: GV, now: luc(15, 18, 30) });
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 0, consumed: 1 });
    expect((await butToan(HV0)).map((b) => b.type)).toEqual(["GRANT", "HOLD", "CONSUME"]);
    expect(await bat(diemDanhBu(null, { caseStudentId: sv.id, coMat: true, chiGiaoVien: GV, now: luc(15, 18, 31) }))).toBeInstanceOf(LoiHocBu);
    expect(await taiKhoan(HV0)).toMatchObject({ held: 0, consumed: 1 });
    await kiemKhop(HV0);
  });

  it("[SLD-11] bé VẮNG buổi bù ⇒ nhả lượt, KHÔNG tiêu; xếp lại được", async () => {
    await xepVao(CASE_A, needId(HV0, 0));
    const sv = await db.makeupCaseStudent.findFirstOrThrow({ where: { caseId: CASE_A } });
    await diemDanhBu(null, { caseStudentId: sv.id, coMat: false, chiGiaoVien: GV, now: luc(15, 18, 30) });
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 0, consumed: 0 });
    await xepVao(CASE_B, needId(HV0, 0));
    expect(await taiKhoan(HV0)).toMatchObject({ held: 1, consumed: 0 });
    await kiemKhop(HV0);
  });

  it("[SLD-12] gỡ bé khỏi case ⇒ nhả; huỷ cả case ⇒ nhả MỖI bé xếp bằng lượt", async () => {
    await xepVao(CASE_A, needId(HV0, 0), needId(HV0, 1));
    const svs = await db.makeupCaseStudent.findMany({ where: { caseId: CASE_A }, orderBy: { id: "asc" } });
    await goKhoiCase(ADMIN, svs[0]!.id);
    expect(await taiKhoan(HV0)).toMatchObject({ held: 1 });
    await huyCase(ADMIN, CASE_A);
    expect(await taiKhoan(HV0)).toMatchObject({ held: 0, consumed: 0 });
    expect((await butToan(HV0)).filter((b) => b.type === "RELEASE")).toHaveLength(2);
    await kiemKhop(HV0);
  });

  it("[SLD-13] mục case xếp TRƯỚC T06 (chưa có tài khoản): điểm danh có mặt ⇒ sổ tự dựng lại lượt đang giữ rồi tiêu — held về 0, không âm", async () => {
    await db.makeupNeed.update({ where: { id: needId(HV0, 0) }, data: { status: "SCHEDULED" } });
    const sv = await db.makeupCaseStudent.create({ data: { id: id("sv-cu"), caseId: CASE_A, makeupNeedId: needId(HV0, 0), status: "PLACED", dungLuot: true, centerId: CS, addedById: GV } });
    expect(await taiKhoan(HV0)).toBeNull();
    await diemDanhBu(null, { caseStudentId: sv.id, coMat: true, chiGiaoVien: GV, now: luc(15, 18, 30) });
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 0, consumed: 1 });
    await kiemKhop(HV0);
  });

  // ── HB-19 ─────────────────────────────────────────────────────────────────────────────
  it("[SLD-14] HB-19: chuyển lớp cùng khoá KHÔNG nhân đôi lượt — sổ theo (học viên, KHOÁ), lớp mới dùng chung tài khoản", async () => {
    await xepVao(CASE_A, needId(HV0, 0), needId(HV0, 1)); // dùng hết 2 lượt ở LOP
    await db.enrollment.updateMany({ where: { studentId: HV0 }, data: { classId: LOP2 } });
    await db.classSession.create({ data: { id: id("b-l2"), classId: LOP2, date: new Date("2026-10-05T11:00:00.000Z"), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
    await db.makeupNeed.create({ data: { id: id("n-lop2"), studentId: HV0, classId: LOP2, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: id("b-l2"), missedLessonId: BAI1, status: "PENDING" } });
    const [d] = await dongThat(id("n-lop2"));
    expect(d!.luot).toMatchObject({ tong: 2, con: 0 }); // trước T06: lớp mới đếm lại từ 0 ⇒ con = 2
    expect(d!.xep.ok).toBe(false);
  });

  // ── điều chỉnh ────────────────────────────────────────────────────────────────────────
  it("[SLD-15] ADJUSTMENT: tăng cộng vào granted; giảm bị chặn ở số còn và lý do GHI phần không rút được; lặp cùng nguồn không ghi hai lần", async () => {
    await xepVao(CASE_A, needId(HV0, 0)); // granted 2, held 1, còn 1
    const dd = dinhDanh(HV0);
    expect(await tx((t) => dieuChinhLuot(t, { ...dd, delta: -5, nguon: "don-huy", lyDo: "Đơn huỷ", actorId: GV }))).toBe(-1);
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 1, held: 1, consumed: 0 });
    const adj = (await butToan(HV0)).filter((b) => b.type === "ADJUSTMENT");
    expect(adj).toHaveLength(1);
    expect(adj[0]!.reason).toMatch(/chỉ áp được -1: 4 lượt không rút được/);
    expect(await tx((t) => dieuChinhLuot(t, { ...dd, delta: -5, nguon: "don-huy", lyDo: "Đơn huỷ", actorId: GV }))).toBe(0); // idem
    expect(await tx((t) => dieuChinhLuot(t, { ...dd, delta: 2, nguon: "don-moi", lyDo: "Mua thêm", actorId: GV }))).toBe(2);
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 3 });
    await kiemKhop(HV0);
  });

  it("[SLD-16] `giuLuot`/`nhaLuot`/`tieuLuot` chạy lại một bước ⇒ KHÔNG ghi hai lần (khoá chống lặp)", async () => {
    const dd = { ...dinhDanh(HV0), makeupNeedId: needId(HV0, 0), caseStudentId: id("sv-x"), actorId: GV };
    await tx((t) => giuLuot(t, dd));
    await tx((t) => giuLuot(t, dd));
    expect(await taiKhoan(HV0)).toMatchObject({ held: 1 });
    await tx((t) => tieuLuot(t, { ...dd, daGiu: true }));
    await tx((t) => tieuLuot(t, { ...dd, daGiu: true }));
    expect(await taiKhoan(HV0)).toMatchObject({ held: 0, consumed: 1 });
    // Nhả một mục chưa từng giữ ⇒ sổ hỏng, ném chứ không đưa held xuống −1.
    const loi = await bat(tx((t) => nhaLuot(t, { ...dd, caseStudentId: id("sv-y"), lyDo: "x" })));
    expect(loi).toBeInstanceOf(LoiLuot);
    expect((loi as LoiLuot).ma).toBe("SO_AM");
    await kiemKhop(HV0);
  });

  // ── HB-18 ─────────────────────────────────────────────────────────────────────────────
  it("[SLD-17] HB-18: chỉ còn đơn ĐÃ HUỶ của khoá này ⇒ công thức cấp 0 (trước: rơi về cả khoá); đơn SỐNG khai số buổi thì giữ nguyên", async () => {
    const taoDon = (status: "CANCELLED" | "CONFIRMED", soBuoi: number | null, ma: string) =>
      db.order.create({
        data: {
          code: `${T}${ma}`, type: "COURSE", status, customerName: "PH", customerPhone: "0900000000", studentId: HV0, centerId: CS,
          createdById: GV, subtotal: 1, totalAmount: 1,
          items: { create: [{ type: "COURSE_ENROLLMENT", itemName: "Khoá", quantity: 1, unitPrice: 1, totalPrice: 1, studentId: HV0, metadata: { courseId: KHOA, ...(soBuoi ? { soBuoi } : {}) } }] },
        },
      });
    await taoDon("CANCELLED", 12, "huy");
    // Chỉ còn đơn huỷ: trước T06 rơi về totalSessions (12) ⇒ cấp 2 lượt. Nay: 0.
    const [d0] = await dongThat(needId(HV0, 0));
    expect(d0!.luot).toMatchObject({ tong: 0, con: 0 });
    // Đơn sống khai 12 buổi ⇒ cả khoá (2 lượt).
    await taoDon("CONFIRMED", 12, "song");
    const [d1] = await dongThat(needId(HV0, 0));
    expect(d1!.luot).toMatchObject({ tong: 2, con: 2 });
    // Đối chứng: bé KHÔNG có đơn nào (ghi danh tay) vẫn rơi về mặc định như cũ.
    const [d2] = await dongThat(needId(HV1, 0));
    expect(d2!.luot).toMatchObject({ tong: 2, con: 2 });
  });

  // ── đọc ───────────────────────────────────────────────────────────────────────────────
  it("[SLD-18] màn hình đọc SỔ khi có tài khoản, và KHÔNG tạo tài khoản khi chỉ xem", async () => {
    const [truoc] = await dongThat(needId(HV0, 0));
    expect(truoc!.luot).toEqual({ tong: 2, daDung: 0, con: 2 });
    expect(await taiKhoan(HV0)).toBeNull(); // chỉ xem ⇒ không ghi
    await xepVao(CASE_A, needId(HV0, 0));
    const [sau] = await dongThat(needId(HV0, 1));
    expect(sau!.luot).toEqual({ tong: 2, daDung: 1, con: 1 });
    const m = await docSoLuot(db, [{ studentId: HV0, courseId: KHOA }]);
    expect(m.get(`${HV0}|${KHOA}`)).toMatchObject({ granted: 2, held: 1, consumed: 0, con: 1 });
  });

  it("[SLD-21] HB-20: chọn NHIỀU dòng của một bé trong một lượt xếp — vượt số lượt còn ⇒ từ chối với câu NÓI ĐÚNG, không giữ lượt nào", async () => {
    await xepVao(CASE_A, needId(HV0, 0)); // còn 1
    // T09: hai case CÙNG GIỜ không xếp chung một bé được nữa — dời CASE_B sang ngày khác để ca này chỉ đo lượt.
    await db.makeupCase.update({ where: { id: CASE_B }, data: { date: new Date("2026-10-16T00:00:00.000Z") } });
    const loi = await bat(xepVaoCaseCoSan(ADMIN, { caseId: CASE_B, needIds: [needId(HV0, 1), needId(HV0, 2)] }));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as LoiHocBu).message).toMatch(/chọn 2 buổi bằng lượt nhưng chỉ còn 1 lượt/);
    expect(await taiKhoan(HV0)).toMatchObject({ held: 1 });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId(HV0, 1) } })).status).toBe("PENDING");
    // Đối chứng: chọn đúng MỘT dòng thì xếp được và giữ lượt cuối cùng.
    await xepVaoCaseCoSan(ADMIN, { caseId: CASE_B, needIds: [needId(HV0, 1)] });
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 2 });
    await kiemKhop(HV0);
  });

  // ── nhập dữ liệu cũ + checker ─────────────────────────────────────────────────────────
  it("[SLD-19] script nhập: tìm đúng cặp có lượt giữ/tiêu mà chưa có tài khoản; --expect lệch ⇒ DỪNG chưa ghi; nhập xong thì hết và chạy lại không đổi gì", async () => {
    await db.makeupNeed.update({ where: { id: needId(HV0, 0) }, data: { status: "COMPLETED", usedQuota: true } });
    await db.makeupNeed.update({ where: { id: needId(HV0, 1) }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.create({ data: { id: id("sv1"), caseId: CASE_A, makeupNeedId: needId(HV0, 1), status: "PLACED", dungLuot: true, centerId: CS, addedById: GV } });
    const ds = await tx((t) => docCapCanNhap(t));
    const cua = ds.filter((c) => c.studentId === HV0);
    expect(cua).toHaveLength(1);
    expect(cua[0]).toMatchObject({ courseId: KHOA, dangGiu: 1, daTieu: 1, tongCongThuc: 2, soVuot: 0 });
    expect(ds.some((c) => c.studentId === HV1)).toBe(false); // không đụng học bù ⇒ không cần tài khoản
    const loi = await bat(tx((t) => apDungNhapSo(t, { expect: ds.length + 1 })));
    expect(loi).toBeInstanceOf(Error);
    expect(await taiKhoan(HV0)).toBeNull();
    await tx((t) => apDungNhapSo(t, { expect: ds.length }));
    expect(await taiKhoan(HV0)).toMatchObject({ granted: 2, held: 1, consumed: 1 });
    expect((await tx((t) => docCapCanNhap(t))).filter((c) => c.studentId === HV0)).toEqual([]);
    await kiemKhop(HV0);
  });

  it("[SLD-20] checker đọc sổ THẬT: sạch ⇒ TV-32..35 ra 0; sửa thẳng tài khoản ⇒ TV-32; chưa nhập ⇒ TV-35", async () => {
    const kiem = async (): Promise<Finding[]> => {
      const o = { now: luc(15, 18, 45), tuNgayYmd: "2026-09-20" };
      const r = await db.$transaction(
        async (t) => {
          await t.$executeRaw`SET TRANSACTION READ ONLY`;
          return chayToanVen(await docSnapshot(t, o), o);
        },
        { timeout: 60_000, isolationLevel: "RepeatableRead" },
      );
      return r.findings.filter((f) => ["TV-32", "TV-33", "TV-34", "TV-35"].includes(f.luat) && (f.id.includes(T) || Object.values(f.lienQuan ?? {}).some((v) => v.includes(T))));
    };
    expect(await kiem()).toEqual([]);
    await xepVao(CASE_A, needId(HV0, 0));
    expect(await kiem()).toEqual([]);
    await db.makeupCreditAccount.update({ where: { studentId_courseId: { studentId: HV0, courseId: KHOA } }, data: { granted: 3 } });
    expect((await kiem()).map((f) => f.luat)).toEqual(["TV-32"]);
    await db.makeupCreditAccount.deleteMany({ where: { studentId: HV0 } });
    expect((await kiem()).map((f) => f.luat)).toEqual(["TV-35"]);
  });
});
