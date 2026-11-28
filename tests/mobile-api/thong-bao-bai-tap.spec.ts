import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/settings/service", async (goc) => ({ ...(await goc<typeof import("@/lib/settings/service")>()), getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as thongBaoRoute } from "@/app/api/mobile/v1/notifications/route";
import { GET as tinHocSinhRoute } from "@/app/api/mobile/v1/students/[studentId]/notifications/route";
import { onAssignmentAssignedNotif, onAssignmentGradedNotif } from "@/lib/_handlers/assignment-notif";
import { onClassSessionChanged } from "@/lib/_handlers/r7-notifications";
import { onParentRequestHandledNotif } from "@/lib/_handlers/yeu-cau-xu-ly-notif";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [TBBT-DB] V8.1 — thông báo khi GIÁO VIÊN GIAO BÀI / CHẤM BÀI (Assignment lớp offline), Postgres thật.
 *   [TBBT-DB-01] giao bài ⇒ «Bài tập mới» cho từng học viên ĐANG HỌC (không cho học viên đã nghỉ / lớp khác); phát lại ⇒ KHÔNG trùng (dedupeKey)
 *   [TBBT-DB-02] bài NHÁP ⇒ không báo
 *   [TBBT-DB-03] chấm bài ⇒ «đã chấm» cho đúng học viên CÓ bài chấm; nội dung KHÔNG chứa điểm; chấm lại (mốc mới) ⇒ thông báo mới; cùng mốc ⇒ không trùng
 *   [TBBT-DB-04] payload nêu học viên CHƯA được chấm ⇒ không tạo thông báo (không tin payload)
 *   [TBBT-DB-05] WEB ≡ MOBILE: `GET /notifications` của phụ huynh thấy thông báo của CON MÌNH, KHÔNG thấy của con nhà khác
 *   [TBBT-DB-07] V8.2 lọc/phân trang `GET /notifications` (danhMuc · chuaDoc · trang · soLuong; tham số lạ ⇒ 400; unreadTotal không đổi theo bộ lọc)
 *   [TBBT-DB-08] V8.2 `GET /students/:id/notifications` (tin của HỌC SINH): chỉ STUDENT của chính nó + LỚP đang học; không tin của anh/chị/em, ba mẹ, cơ sở, nhắc nợ, chưa đăng; con trỏ phân trang; con nhà khác ⇒ 404
 *   [TBBT-DB-09] V8.2 yêu cầu được xử lý ⇒ phụ huynh thấy (không lộ phản hồi nhân viên; PENDING/CANCELLED không báo); đổi lịch lớp ⇒ phụ huynh + học sinh thấy; tin STUDENT dành cho ba mẹ (thanh toán/yêu cầu) KHÔNG tới học sinh
 *   [TBBT-DB-06] sự kiện đi qua `publishEvent` (outbox) rollback cùng transaction nghiệp vụ: rollback ⇒ không có sự kiện
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "tbbt-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.99.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const A = (k: string) => `${NS}${k}`;
const ev = (payload: Record<string, unknown>) => ({ id: A("ev"), type: "x", payload });

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: "assignment." } }, { classId: { startsWith: NS } }, { id: { startsWith: NS } }, { studentId: { startsWith: NS } }] } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `assignment.assigned:${NS}` } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `assignment.graded:${NS}` } } });
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignmentSubmission.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.assignment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[TBBT-DB] thông báo giao/chấm bài — Postgres thật", () => {
  const ids: Record<string, string> = {};
  const S1 = A("s1"); // lớp 1, đang học, PH A
  const S2 = A("s2"); // lớp 1, đang học, PH A
  const S3 = A("s3"); // lớp 1, ĐÃ NGHỈ (CANCELLED), PH B
  const S4 = A("s4"); // lớp 2, PH B
  let tA = "";
  let tB = "";
  const dem2 = (where: Record<string, unknown>) => db.notification.count({ where: where as never });

  beforeAll(async () => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true"; // V8.24: handler chỉ báo khi tính năng đang mở
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    for (const [k, sdt] of [["A", "84966900001"], ["B", "84966900002"]] as const) ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `PH ${k}`, phone: sdt, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } })).id;
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở TBBT", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá TBBT", slug: A("kh"), totalSessions: 12 } });
    for (const l of ["l1", "l2"]) await db.class.create({ data: { id: A(l), name: `Lớp ${l}`, classCode: A(l), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: "Bình", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S3, name: "Cường", parentUserId: ids.B, centerId: A("cs") } as never });
    await db.student.create({ data: { id: S4, name: "Dũng", parentUserId: ids.B, centerId: A("cs") } as never });
    const dk = (id: string, sv: string, lop: string, status: string) => db.enrollment.create({ data: { id: A(id), studentId: sv, classId: A(lop), courseId: A("kh"), status, centerId: A("cs") } as never });
    await dk("dk1", S1, "l1", "ACTIVE");
    await dk("dk2", S2, "l1", "ACTIVE");
    await dk("dk3", S3, "l1", "CANCELLED");
    await dk("dk4", S4, "l2", "ACTIVE");
    for (const [id, st] of [["bt1", "PUBLISHED"], ["bt2", "DRAFT"]] as const) await db.assignment.create({ data: { id: A(id), title: `Bài ${id}`, description: "d", classId: A("l1"), totalPoints: 10, status: st, allowText: true, dueAt: new Date(Date.now() + 86400000) } as never });
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-f000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966900001", 1);
    tB = await dn("0966900002", 2);
    for (const t of [tA, tB]) await quyDinhDongY(req("/x", {}, `Bearer ${t}`));
  }, 120_000);
  afterAll(async () => {
    await don();
    delete process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED;
  });

  it("[TBBT-DB-01] giao bài ⇒ «Bài tập mới» cho học viên đang học; phát lại không trùng", async () => {
    await onAssignmentAssignedNotif(ev({ assignmentId: A("bt1") }));
    const ds = await db.notification.findMany({ where: { dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } }, select: { studentId: true, audience: true, title: true, classId: true } });
    expect(ds.map((d) => d.studentId).sort()).toEqual([S1, S2]); // S3 đã nghỉ, S4 lớp khác
    expect(ds.every((d) => d.audience === "STUDENT" && d.title === "Bài tập mới" && d.classId === A("l1"))).toBe(true);
    await onAssignmentAssignedNotif(ev({ assignmentId: A("bt1") })); // retry của dispatcher
    expect(await dem2({ dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } })).toBe(2);
  });

  it("[TBBT-DB-02] bài NHÁP / không tồn tại ⇒ không báo", async () => {
    await onAssignmentAssignedNotif(ev({ assignmentId: A("bt2") }));
    await onAssignmentAssignedNotif(ev({ assignmentId: A("khong-co") }));
    await onAssignmentAssignedNotif(ev({}));
    expect(await dem2({ dedupeKey: { startsWith: `assignment.assigned:${A("bt2")}` } })).toBe(0);
  });

  it("[TBBT-DB-03/04] chấm bài ⇒ «đã chấm» cho đúng học viên CÓ bài chấm, không có điểm; chấm lại ⇒ mới; không tin payload", async () => {
    await db.assignmentSubmission.create({ data: { assignmentId: A("bt1"), studentId: S1, status: "GRADED", score: 9.5, gradedAt: new Date() } as never });
    await db.assignmentSubmission.create({ data: { assignmentId: A("bt1"), studentId: S2, status: "SUBMITTED" } as never }); // CHƯA chấm
    const moc = 1_700_000_000_000;
    await onAssignmentGradedNotif(ev({ assignmentId: A("bt1"), studentIds: [S1, S2, S4], gradedAtMs: moc }));
    const ds = await db.notification.findMany({ where: { dedupeKey: { startsWith: `assignment.graded:${A("bt1")}:` } }, select: { studentId: true, title: true, body: true } });
    expect(ds.map((d) => d.studentId)).toEqual([S1]); // S2 chưa chấm, S4 không có bài
    expect(ds[0]?.title).toBe("Bài tập đã được chấm");
    expect(`${ds[0]?.title} ${ds[0]?.body}`).not.toMatch(/9[.,]?5|điểm/i); // KHÔNG lộ điểm
    await onAssignmentGradedNotif(ev({ assignmentId: A("bt1"), studentIds: [S1], gradedAtMs: moc })); // cùng mốc ⇒ không trùng
    expect(await dem2({ dedupeKey: { startsWith: `assignment.graded:${A("bt1")}:` } })).toBe(1);
    await onAssignmentGradedNotif(ev({ assignmentId: A("bt1"), studentIds: [S1], gradedAtMs: moc + 1000 })); // chấm lại ⇒ thông báo mới
    expect(await dem2({ dedupeKey: { startsWith: `assignment.graded:${A("bt1")}:` } })).toBe(2);
    for (const x of [{ assignmentId: A("bt1"), studentIds: [], gradedAtMs: moc }, { assignmentId: A("bt1"), studentIds: [S1], gradedAtMs: "x" }, { studentIds: [S1], gradedAtMs: moc }]) await onAssignmentGradedNotif(ev(x));
    expect(await dem2({ dedupeKey: { startsWith: `assignment.graded:${A("bt1")}:` } })).toBe(2);
  });

  it("[TBBT-DB-05] WEB ≡ MOBILE: phụ huynh thấy thông báo của CON MÌNH, không thấy của con nhà khác", async () => {
    const lay = async (tok: string) => (await json(await thongBaoRoute(req("/api/mobile/v1/notifications", undefined, `Bearer ${tok}`)))).data.items as Array<{ title: string; body: string; childName: string | null }>;
    const a = await lay(tA);
    expect(a.filter((i) => i.title === "Bài tập mới").length).toBe(2); // S1 + S2 đều của PH A
    expect(a.filter((i) => i.title === "Bài tập đã được chấm").length).toBeGreaterThanOrEqual(1);
    expect(a.every((i) => !/9[.,]?5/.test(i.body))).toBe(true);
    const b = await lay(tB);
    expect(b.filter((i) => i.title === "Bài tập mới").length).toBe(0); // S3 đã nghỉ, S4 lớp khác
    expect(b.filter((i) => i.title === "Bài tập đã được chấm").length).toBe(0);
  });

  it("[TBBT-DB-07] lọc/phân trang feed phụ huynh", async () => {
    const lay = async (q: string) => thongBaoRoute(req("/api/mobile/v1/notifications" + q, undefined, `Bearer ${tA}`));
    const tat = (await json(await lay(""))).data;
    expect(tat.items.length).toBeGreaterThanOrEqual(3);
    expect(tat.tong).toBe(tat.items.length);
    const loc = (await json(await lay("?danhMuc=THONG_BAO"))).data;
    expect(loc.items.every((i: { category: string }) => i.category === "THONG_BAO")).toBe(true);
    const khac = (await json(await lay("?danhMuc=NHAN_XET"))).data;
    expect(khac.items.every((i: { category: string }) => i.category === "NHAN_XET")).toBe(true);
    expect(khac.unreadTotal).toBe(tat.unreadTotal); // tổng chưa đọc không phụ thuộc bộ lọc
    // BR-NOTIF-01: loại có cấu trúc (thông báo giao/chấm bài là thông báo trung tâm ⇒ he-thong) + lọc theo loại
    expect(tat.items.every((i: { loai: string }) => ["lich", "hoc-phi", "yeu-cau", "nhan-xet", "he-thong", "coin"].includes(i.loai))).toBe(true);
    const heThong = (await json(await lay("?loai=he-thong"))).data;
    expect(heThong.items.length).toBeGreaterThanOrEqual(3);
    expect(heThong.items.every((i: { loai: string }) => i.loai === "he-thong")).toBe(true);
    expect((await json(await lay("?loai=coin"))).data.items).toEqual([]); // chưa có nguồn coin — không bịa
    expect((await lay("?loai=la")).status).toBe(400);
    const t1 = (await json(await lay("?soLuong=1&trang=1"))).data;
    const t2 = (await json(await lay("?soLuong=1&trang=2"))).data;
    expect([t1.items.length, t1.coTrangSau, t1.trang, t2.trang]).toEqual([1, true, 1, 2]);
    expect(t1.items[0].id).not.toBe(t2.items[0].id);
    expect(t1.tong).toBe(tat.tong);
    const cuoi = (await json(await lay(`?soLuong=1&trang=${tat.tong}`))).data;
    expect([cuoi.items.length, cuoi.coTrangSau]).toEqual([1, false]);
    const xa = (await json(await lay(`?soLuong=1&trang=${Math.min(tat.tong + 1, 100)}`))).data;
    expect(xa.items).toEqual([]);
    for (const q of ["?danhMuc=LA", "?trang=0", "?soLuong=101", "?khac=1", "?chuaDoc=co"]) {
      const r = await lay(q);
      expect([r.status, (await json(r)).error?.code], q).toEqual([400, "VALIDATION"]);
    }
  });

  it("[TBBT-DB-08] tin của HỌC SINH: đúng học sinh, không lẫn anh/chị/em/ba mẹ/nhắc nợ/chưa đăng", async () => {
    const lop1 = A("l1");
    const moi = (o: Record<string, unknown>) => db.notification.create({ data: { title: "t", body: "b", isPublished: true, ...o } as never });
    await moi({ id: A("n-lop"), title: "Thông báo lớp", audience: "CLASS", classId: lop1, dedupeKey: `tbbt-lop-${NS}` });
    await moi({ id: A("n-lop2"), title: "Lớp khác", audience: "CLASS", classId: A("l2"), dedupeKey: `tbbt-lop2-${NS}` });
    await moi({ id: A("n-ph"), title: "Chỉ ba mẹ", audience: "ALL_PARENTS", dedupeKey: `tbbt-ph-${NS}` });
    await moi({ id: A("n-no"), title: "Nhắc nợ", audience: "STUDENT", studentId: S1, dedupeKey: `debt.overdue:${NS}x` });
    await moi({ id: A("n-nhap"), title: "Chưa đăng", audience: "STUDENT", studentId: S1, isPublished: false, dedupeKey: `tbbt-nhap-${NS}` });
    await moi({ id: A("n-tuong-lai"), title: "Hẹn giờ", audience: "STUDENT", studentId: S1, publishedAt: new Date(Date.now() + 3600_000), dedupeKey: `tbbt-hen-${NS}` });
    const lay = async (sv: string, q = "", tok = tA) => tinHocSinhRoute(req(`/api/mobile/v1/students/${sv}/notifications${q}`, undefined, `Bearer ${tok}`), { params: Promise.resolve({ studentId: sv }) as never });
    const d = (await json(await lay(S1))).data as { items: Array<{ id: string; title: string; loai: string }>; coTrangSau: boolean };
    const tieuDe = d.items.map((i) => i.title);
    expect(tieuDe).toContain("Bài tập mới");
    expect(tieuDe).toContain("Bài tập đã được chấm");
    expect(tieuDe).toContain("Thông báo lớp");
    expect(d.items.find((i) => i.title === "Thông báo lớp")?.loai).toBe("LOP");
    for (const x of ["Lớp khác", "Chỉ ba mẹ", "Nhắc nợ", "Chưa đăng", "Hẹn giờ"]) expect(tieuDe, x).not.toContain(x);
    const s2 = (await json(await lay(S2))).data as { items: Array<{ title: string }> };
    expect(s2.items.some((i) => i.title === "Bài tập đã được chấm")).toBe(false); // chỉ S1 được chấm
    expect(s2.items.filter((i) => i.title === "Bài tập mới").length).toBe(1); // tin riêng của S2, không lẫn của S1
    const p1 = (await json(await lay(S1, "?soLuong=1"))).data;
    expect([p1.items.length, p1.coTrangSau, typeof p1.conTro]).toEqual([1, true, "string"]);
    const p2 = (await json(await lay(S1, `?soLuong=1&truocLuc=${encodeURIComponent(p1.conTro)}`))).data;
    expect(p2.items.length).toBeLessThanOrEqual(1);
    if (p2.items[0]) expect(p2.items[0].id).not.toBe(p1.items[0].id);
    expect((await lay(S3)).status).toBe(404); // con nhà khác
    for (const q of ["?soLuong=0", "?soLuong=51", "?khac=1", "?truocLuc=hom-qua"]) expect((await lay(S1, q)).status, q).toBe(400);
    const khongToken = await tinHocSinhRoute(req(`/api/mobile/v1/students/${S1}/notifications`), { params: Promise.resolve({ studentId: S1 }) as never });
    expect(khongToken.status).toBe(401);
  });

  it("[TBBT-DB-09] V8.2: yêu cầu được XỬ LÝ ⇒ phụ huynh thấy (web ≡ mobile); đổi lịch lớp ⇒ phụ huynh + học sinh thấy; tin dành cho ba mẹ KHÔNG tới học sinh", async () => {
    const yc = await db.parentRequest.create({ data: { id: A("yc1"), studentId: S1, parentUserId: ids.A, type: "MAKEUP", status: "PENDING", content: "Xin học bù" } as never });
    // chưa xử lý / PENDING ⇒ không báo
    await onParentRequestHandledNotif(ev({ requestId: yc.id }));
    expect(await dem2({ dedupeKey: { startsWith: `parent_request.handled:${yc.id}:` } })).toBe(0);
    const luc = new Date();
    await db.parentRequest.update({ where: { id: yc.id }, data: { status: "APPROVED", response: "Bí mật nội bộ của nhân viên", handledAt: luc } });
    await onParentRequestHandledNotif(ev({ requestId: yc.id }));
    await onParentRequestHandledNotif(ev({ requestId: yc.id })); // retry
    expect(await dem2({ dedupeKey: { startsWith: `parent_request.handled:${yc.id}:` } })).toBe(1);
    await onParentRequestHandledNotif(ev({ requestId: "khong-co" }));
    await onParentRequestHandledNotif(ev({}));
    const lay = async (tok: string) => (await json(await thongBaoRoute(req("/api/mobile/v1/notifications", undefined, `Bearer ${tok}`)))).data.items as Array<{ title: string; body: string }>;
    const a = (await lay(tA)).filter((i) => i.title === "Yêu cầu đã được xử lý");
    expect(a.length).toBe(1);
    expect(a[0]!.body).toMatch(/học bù.*đã được duyệt/);
    expect(a[0]!.body).not.toContain("Bí mật nội bộ"); // không lộ phản hồi nhân viên
    expect((await lay(tB)).some((i) => i.title === "Yêu cầu đã được xử lý")).toBe(false); // nhà khác không thấy
    await db.parentRequest.update({ where: { id: yc.id }, data: { status: "CANCELLED" } });
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: `parent_request.handled:${yc.id}:` } } });
    await onParentRequestHandledNotif(ev({ requestId: yc.id })); // CANCELLED ⇒ không báo
    expect(await dem2({ dedupeKey: { startsWith: `parent_request.handled:${yc.id}:` } })).toBe(0);
    await db.parentRequest.delete({ where: { id: yc.id } });

    // Đổi lịch: handler SẴN CÓ của web (class.session_changed) ⇒ Notification CLASS ⇒ phụ huynh (feed) + học sinh (tin lớp) thấy
    await onClassSessionChanged({ id: A("ev-lich"), type: "class.session_changed", payload: { classId: A("l1"), change: "ADJUSTED" } });
    expect((await lay(tA)).some((i) => i.title === "Thay đổi lịch học")).toBe(true);
    const sv = async (sid: string) => (await json(await tinHocSinhRoute(req(`/api/mobile/v1/students/${sid}/notifications`, undefined, `Bearer ${tA}`), { params: Promise.resolve({ studentId: sid }) as never }))).data.items as Array<{ title: string }>;
    expect((await sv(S1)).some((i) => i.title === "Thay đổi lịch học")).toBe(true);
    // Tin STUDENT dành cho ba mẹ (xác nhận thanh toán, kết quả yêu cầu) KHÔNG tới học sinh
    await db.notification.create({ data: { id: A("n-tt"), title: "Đã xác nhận thanh toán", body: "5.000.000đ", audience: "STUDENT", studentId: S1, isPublished: true, dedupeKey: `payment.confirmed:${NS}x` } as never });
    await db.notification.create({ data: { id: A("n-yc"), title: "Yêu cầu đã được xử lý", body: "x", audience: "STUDENT", studentId: S1, isPublished: true, dedupeKey: `parent_request.handled:${NS}x:1` } as never });
    const tin = (await sv(S1)).map((i) => i.title);
    expect(tin).not.toContain("Đã xác nhận thanh toán");
    expect(tin).not.toContain("Yêu cầu đã được xử lý");
    expect(tin).toContain("Bài tập mới"); // tin giao/chấm bài vẫn tới học sinh
    expect((await lay(tA)).some((i) => i.title === "Đã xác nhận thanh toán")).toBe(true); // phụ huynh vẫn thấy
  });

  it("[TBBT-DB-06] sự kiện cùng transaction: rollback nghiệp vụ ⇒ không có sự kiện; commit ⇒ có, dedupeKey chặn phát trùng", async () => {
    const khoa = `assignment.assigned:${A("bt-tx")}`;
    await db.$transaction(async (tx) => {
      await publishEvent("assignment.assigned", { assignmentId: A("bt-tx") }, { tx, dedupeKey: khoa });
      throw new Error("rollback-co-chu-dich");
    }).catch(() => undefined);
    expect(await db.domainEvent.count({ where: { dedupeKey: khoa } })).toBe(0);
    await db.$transaction(async (tx) => {
      await publishEvent("assignment.assigned", { assignmentId: A("bt-tx") }, { tx, dedupeKey: khoa });
      await publishEvent("assignment.assigned", { assignmentId: A("bt-tx") }, { tx, dedupeKey: khoa });
    });
    expect(await db.domainEvent.count({ where: { dedupeKey: khoa } })).toBe(1);
  });
  it("[TBBT-DB-10] V8.24: cờ PORTAL_BAI_TAP_BAI_THI_ENABLED tắt ⇒ KHÔNG báo giao bài / chấm bài (tính năng đang ẩn); bật lại ⇒ báo", async () => {
    const truoc = await db.notification.count({ where: { dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } } });
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } } });
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    try {
      await onAssignmentAssignedNotif(ev({ assignmentId: A("bt1") }));
      await onAssignmentGradedNotif(ev({ assignmentId: A("bt1"), studentIds: [S1], gradedAtMs: 1_800_000_000_000 }));
      expect(await db.notification.count({ where: { dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } } })).toBe(0);
      expect(await db.notification.count({ where: { dedupeKey: `assignment.graded:${A("bt1")}:${S1}:1800000000000` } })).toBe(0);
    } finally {
      process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    }
    await onAssignmentAssignedNotif(ev({ assignmentId: A("bt1") }));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `assignment.assigned:${A("bt1")}:` } } })).toBe(truoc);
  });
});
