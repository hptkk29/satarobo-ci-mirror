// tests/cham-cong/requests.spec.ts — L5: đơn từ dùng chung + duyệt trong transaction (T-05/T-06/T-07).
// Phần thuần chạy mọi nơi; phần DB cần Postgres LOCAL (satarobo_test), tự SKIP nếu không có.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLeaveTypes, seedShiftTemplates } from "../../lib/cham-cong/seed-core";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/requests] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-req";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));

describe("requests — thuần", () => {
  /**
   * Nạp module MỘT LẦN ở hook, KHÔNG nạp trong thân từng ca.
   *
   * ── Vì sao (chẩn 15/09/2026) ──
   * Ba ca dưới đây là hàm THUẦN, nhưng `lib/cham-cong/requests` kéo theo `@/lib/db`
   * (Prisma singleton) + `getSetting` + 9 module khác. Trước bản này mỗi ca tự
   * `await import(...)`, nên CA ĐẦU TIÊN gánh toàn bộ chi phí nạp cây đó — và gánh nó
   * TRONG ngân sách 5s mặc định vốn dành cho PHÉP KHẲNG ĐỊNH.
   *
   * Đo thật: máy rảnh → ca đầu **388ms**, hai ca sau 0ms/1ms (module đã vào cache —
   * chính bằng chứng cho thấy ca đầu trả tiền hộ). Máy đang tải (dev server + vừa xong
   * cả bộ test) → **5016ms** ⇒ ĐỎ với "Test timed out", không phải với một khẳng định
   * nào sai. Phồng 13×, cùng hình dạng luật 19. Xoá sạch cache vite rồi đo lại vẫn
   * 388ms ⇒ KHÔNG phải chuyện cold-cache.
   *
   * ⚠️ ĐỪNG VÁ BẰNG CÁCH NỚI TRẦN CỦA CA. Trần của một ca là để đo phép khẳng định;
   * nới nó vì chi phí nạp module là bỏ luôn khả năng phát hiện một khẳng định THẬT SỰ
   * treo. Dời chi phí về `beforeAll` là đặt nó vào chỗ sở hữu nó — hook có ngân sách
   * riêng (`hookTimeout`), và ba ca kia quay về 0ms.
   *
   * Cách tốt hơn nhưng đắt hơn: tách ba hàm thuần này ra module không chạm `db`. Đó là
   * việc của module chấm công, không phải của một bản vá test — ghi lại đây để ai vào
   * sửa `requests.ts` biết có lý do chính đáng để tách.
   */
  let R: typeof import("../../lib/cham-cong/requests");
  beforeAll(async () => {
    R = await import("../../lib/cham-cong/requests");
  });

  it("isSubmittedLate: dưới N ngày báo trước = muộn, hồi tố = muộn, đủ ngày = không", () => {
    const now = new Date("2026-09-10T03:00:00Z"); // 10:00 VN 10/09
    expect(R.isSubmittedLate(utc(2026, 9, 11), now, 2)).toBe(true);
    expect(R.isSubmittedLate(utc(2026, 9, 12), now, 2)).toBe(false);
    expect(R.isSubmittedLate(utc(2026, 9, 9), now, 2)).toBe(true);
    expect(R.isSubmittedLate(utc(2026, 9, 10), now, 0)).toBe(false);
  });
  it("vnTimeOn: 'HH:mm' giờ VN trên ngày công → mốc UTC đúng; giờ sai → null", () => {
    expect(R.vnTimeOn(utc(2026, 9, 8), "07:45")?.toISOString()).toBe("2026-09-08T00:45:00.000Z");
    expect(R.vnTimeOn(utc(2026, 9, 8), "01:00")?.toISOString()).toBe("2026-09-07T18:00:00.000Z");
    expect(R.vnTimeOn(utc(2026, 9, 8), "25:00")).toBeNull();
    expect(R.vnTimeOn(utc(2026, 9, 8), "abc")).toBeNull();
  });
  it("periodKeysBetween gom đúng các tháng của khoảng ngày", () => {
    expect(R.periodKeysBetween(utc(2026, 9, 29), utc(2026, 10, 2))).toEqual(["2026-09", "2026-10"]);
    expect(R.periodKeysBetween(utc(2026, 9, 1), utc(2026, 9, 1))).toEqual(["2026-09"]);
  });
});

d("requests — DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let cs1 = "";
  let cs2 = "";
  let gv = ""; // nhà CS1
  let tv = ""; // nhà CS1, người nhận ca
  let ho = ""; // Hội sở
  let tplS = "";
  let tplD1 = "";
  let leaveId = "";
  let requests: typeof import("../../lib/cham-cong/requests");
  const d8 = utc(2026, 9, 8);
  const d9 = utc(2026, 9, 9);
  const d10 = utc(2026, 9, 10);
  const actor = { id: "", name: "QL test" };

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.auditLog.deleteMany({ where: { entityType: "WorkRequest", actorId: { in: ids } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: "attday:" }, payloadJson: { path: ["userId"], string_contains: "" } } }).catch(() => undefined);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: { in: [cs1, cs2].filter(Boolean) } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    await seedShiftTemplates(db);
    await seedLeaveTypes(db);
    const c1 = await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS1 req", address: "x", code: `${TAG}-CS1` }, select: { id: true } });
    const c2 = await db.center.upsert({ where: { slug: `${TAG}-cs2` }, update: {}, create: { slug: `${TAG}-cs2`, name: "CS2 req", address: "x", code: `${TAG}-CS2` }, select: { id: true } });
    cs1 = c1.id;
    cs2 = c2.id;
    await cleanup();
    const mk = (email: string, name: string, centerId: string | null) =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId }, select: { id: true } });
    gv = (await mk("gv", "GV req", cs1)).id;
    tv = (await mk("tv", "TV req", cs1)).id;
    ho = (await mk("ho", "HO req", null)).id;
    actor.id = (await mk("ql", "QL req", cs1)).id;
    tplS = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "S", centerId: null }, select: { id: true } })).id;
    tplD1 = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "CG", centerId: null }, select: { id: true } })).id;
    // Lấy ĐÍCH DANH `NGHI_PHEP`, KHÔNG `findFirst({ paidRatio: { gt: 0 } })`.
    //
    // Bản cũ dùng findFirst không `orderBy` ⇒ Postgres trả dòng theo thứ tự vật lý, và sau vài
    // lượt xoá/seed lại nó vớ phải `KET_HON` — loại đòi báo trước 7 ngày. Đơn trong test nộp cho
    // ngày 11/09 nên bị từ chối, và bộ test đỏ theo THỨ TỰ CHẠY chứ không theo mã nguồn.
    //
    // Chỉ lộ ra sau khi `LeaveType.noticeDays` ra đời (07/09) — trước đó không loại nào đòi báo
    // trước nên vớ nhầm dòng cũng không sao. Đây đúng kiểu bẫy mà `findFirst` không `orderBy` gài
    // sẵn: nó im lặng cho tới ngày có một cột làm các dòng khác nhau về hành vi.
    leaveId = (await db.leaveType.findFirstOrThrow({ where: { code: "NGHI_PHEP" }, select: { id: true } })).id;
    // GV có ca S ở CS2 ngày 08 (GV nhà CS1 xuống CS2 làm) — cơ sở nhận đơn phải là CS2.
    const seg = [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }];
    await db.shiftAssignment.createMany({
      data: [
        { userId: gv, centerId: cs2, workDate: d8, templateId: tplS, templateCode: "S", segments: seg, source: "IMPORT" },
        { userId: gv, centerId: cs1, workDate: d9, templateId: tplS, templateCode: "S", segments: seg, source: "IMPORT" },
        { userId: tv, centerId: cs1, workDate: d9, templateId: tplD1, templateCode: "CG", segments: seg, source: "IMPORT" },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  /**
   * Mốc thời gian CỐ ĐỊNH cho mọi lời gọi hàm nhạy-thời-gian trong file này —
   * 09/09/2026 10:00 giờ VN.
   *
   * ⚠️ Bắt buộc phải chốt, không được để hàm rơi về `new Date()`: các ca ở đây xin nghỉ /
   * sửa giờ cho ngày 08–12/09/2026, mà `submitAttendanceRequest` có cổng `isSubmittedLate`
   * so `fromDate` với HÔM NAY. Để giờ thật thì ca xanh vài ngày rồi ĐỎ MÃI MÃI — đã xảy
   * ra 13/09/2026 với ca LEAVE (xanh tới 10/09, rerun cùng commit ngày 13/09 thì đỏ).
   * Lint `thoigian/require-now-in-tests` nay chặn việc quên.
   */
  const NOW_TEST = new Date("2026-09-09T03:00:00Z");

  const base = {
    startTime: null, endTime: null, hours: null, className: null, classId: null, targetUserId: null,
    requesterNewTemplateId: null, targetNewTemplateId: null, leaveTypeId: null, requestedInAt: null, requestedOutAt: null,
    requestedIn2At: null, requestedOut2At: null, chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test",
  };

  it("cơ sở nhận đơn = cơ sở của ca ngày áp dụng (CS2), không phải cơ sở nhà (CS1)", async () => {
    const r = await requests.resolveRequestCenter(gv, d8);
    expect(r).toMatchObject({ centerId: cs2, via: "ASSIGNMENT" });
    const r2 = await requests.resolveRequestCenter(gv, d10);
    expect(r2).toMatchObject({ centerId: cs1, via: "HOME" });
  });

  it("người Hội sở không chọn cơ sở ⇒ từ chối; chọn CS1 ⇒ đơn vào CS1", async () => {
    const bad = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: ho, kind: "OT", fromDate: d10, toDate: null, startTime: "18:00", endTime: "20:00" });
    expect(bad.ok).toBe(false);
    const ok = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: ho, kind: "OT", fromDate: d10, toDate: null, startTime: "18:00", endTime: "20:00", chosenCenterId: cs1 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.centerId).toBe(cs1);
  });

  it("nộp trùng (cùng loại, cùng ngày, đang chờ) bị chặn; nộp muộn được cắm cờ", async () => {
    const now = new Date("2026-09-09T03:00:00Z");
    const a = await requests.submitAttendanceRequest({ ...base, requesterId: gv, kind: "LATE_EARLY", fromDate: d10, toDate: null, startTime: "08:30", now });
    expect(a.ok && a.submittedLate).toBe(true);
    const b = await requests.submitAttendanceRequest({ ...base, requesterId: gv, kind: "LATE_EARLY", fromDate: d10, toDate: null, startTime: "08:30", now });
    expect(b.ok).toBe(false);
    // Dọn đơn chờ của chính ca này (luật 18): từ đợt 12 bộ kiểm xung đột so với MỌI đơn đang chờ của
    // người nộp, nên đơn bỏ lại ở đây chặn đơn nghỉ ngày 10/09 của ca sau.
    if (a.ok) await requests.withdrawRequest({ requestId: a.id, requesterId: gv, requesterName: "GV", now });
  });

  it("hạn báo trước theo LOẠI: nộp sát ngày phải có người làm thay; loại đột xuất thì không đòi", async () => {
    // Yêu cầu chủ dự án 06/09: "phải xin nghỉ trước 1 ngày để quản lý bố trí nhân sự hỗ trợ".
    // Thực hiện bằng cách ĐÒI NGƯỜI LÀM THAY chứ không chặn cửa — chặn không làm mất buổi nghỉ,
    // chỉ làm mất dấu vết (quản lý sẽ sửa thẳng ô trên lưới và hệ thống thôi biết đó là ốm hay
    // tang chế).
    const phep = await db.leaveType.findUnique({ where: { code: "NGHI_PHEP" }, select: { id: true } });
    const maChay = await db.leaveType.findUnique({ where: { code: "MA_CHAY" }, select: { id: true } });
    await db.leaveType.update({ where: { code: "NGHI_PHEP" }, data: { noticeDays: 1 } });
    await db.leaveType.update({ where: { code: "MA_CHAY" }, data: { noticeDays: null } });

    // 09/09 lúc 10:00 VN, xin nghỉ phép cho CHÍNH HÔM NAY ⇒ không báo trước ngày nào.
    // (Nộp hôm nay cho NGÀY MAI là vừa đủ hạn 1 ngày — đó là đúng luật, không phải vi phạm.)
    const now = new Date("2026-09-09T03:00:00Z");
    const thieuNguoiThay = await requests.submitAttendanceRequest({
      ...base, requesterId: gv, kind: "LEAVE", fromDate: d9, toDate: d9, leaveTypeId: phep!.id, now,
    });
    expect(thieuNguoiThay.ok).toBe(false);
    if (!thieuNguoiThay.ok) expect(thieuNguoiThay.error).toContain("NGƯỜI LÀM THAY");

    // Cùng ngày đó nhưng CÓ người làm thay ⇒ nhận đơn.
    const coNguoiThay = await requests.submitAttendanceRequest({
      ...base, requesterId: gv, kind: "LEAVE", fromDate: d9, toDate: d9, leaveTypeId: phep!.id, targetUserId: tv, now,
    });
    expect(coNguoiThay.ok).toBe(true);

    // Nộp hôm nay cho NGÀY MAI: vừa đủ hạn 1 ngày ⇒ KHÔNG đòi người thay. Khoá luôn ranh giới
    // này lại, kẻo lần sau ai đó siết nhầm thành "phải trước 2 ngày".
    const dungHan = await requests.submitAttendanceRequest({
      ...base, requesterId: gv, kind: "LEAVE", fromDate: d10, toDate: d10, leaveTypeId: phep!.id, now,
    });
    expect(dungHan.ok).toBe(true);

    // Ma chay KHÔNG đặt hạn ⇒ nộp sát ngày vẫn nhận, không đòi người thay. Đây là lý do ngưỡng
    // phải đi theo LOẠI: một con số chung biến ba loại đột xuất thành "luôn vi phạm".
    const dotXuat = await requests.submitAttendanceRequest({
      ...base, requesterId: tv, kind: "LEAVE", fromDate: d9, toDate: d9, leaveTypeId: maChay!.id, now,
    });
    expect(dotXuat.ok).toBe(true);
    // Dọn đơn chờ của ca này (luật 18) — đơn nghỉ cả ngày còn chờ chặn đổi ca / chỉnh công cùng ngày
    // ở các ca sau (bộ kiểm xung đột đợt 12).
    for (const [r, ai] of [[coNguoiThay, gv], [dungHan, gv], [dotXuat, tv]] as const) {
      if (r.ok) await requests.withdrawRequest({ requestId: r.id, requesterId: ai, requesterName: "x", now });
    }
  });

  it("SHIFT_SWAP duyệt: đổi ca CẢ HAI người trên lưới trong một tx, nguồn SWAP, notify 2 người", async () => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "SHIFT_SWAP", fromDate: d9, toDate: null, requesterNewTemplateId: tplD1, targetUserId: tv, targetNewTemplateId: tplS });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notify.map((n) => n.userId).sort()).toEqual([gv, tv].sort());
    const a = await db.shiftAssignment.findFirstOrThrow({ where: { userId: gv, workDate: d9, status: "ACTIVE" } });
    expect(a).toMatchObject({ templateCode: "CG", source: "SWAP", sourceRequestId: s.id });
    const b = await db.shiftAssignment.findFirstOrThrow({ where: { userId: tv, workDate: d9, status: "ACTIVE" } });
    expect(b).toMatchObject({ templateCode: "S", source: "SWAP" });
    const req = await db.workRequest.findUniqueOrThrow({ where: { id: s.id } });
    expect(req.status).toBe("APPROVED");
    expect(req.appliedAt).not.toBeNull();
    // Duyệt lần hai ⇒ đã xử lý.
    const again = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
    expect(again.ok).toBe(false);
  });

  it("T-05: áp thất bại (không có quyền ở cơ sở của ca) ⇒ rollback trạng thái, đơn vẫn PENDING + applyError", async () => {
    // GV có ca ở CS2 ngày 08; người duyệt chỉ có quyền CS2 (cơ sở nhận đơn) nhưng KHÔNG có quyền CS1
    // — mã CG defaultPlace HOME ⇒ ca mới rơi về CS1 ⇒ setAssignmentCell từ chối ⇒ cả quyết định phải lùi.
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "SHIFT_SWAP", fromDate: d8, toDate: null, requesterNewTemplateId: tplD1 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.centerId).toBe(cs2);
    const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs2 });
    expect(r.ok).toBe(false);
    const req = await db.workRequest.findUniqueOrThrow({ where: { id: s.id } });
    expect(req.status).toBe("PENDING");
    expect(req.reviewedById).toBeNull();
    expect(req.applyError).toMatch(/quyền/);
    const a = await db.shiftAssignment.findFirstOrThrow({ where: { userId: gv, workDate: d8, status: "ACTIVE" } });
    expect(a.templateCode).toBe("S"); // ca cũ còn nguyên
  });

  it("LEAVE 2 ngày duyệt ⇒ ghi P cả 2 ngày (nguồn LEAVE); TIMESHEET_FIX ⇒ 2 mốc MANUAL_ADJUST + event tính lại", async () => {
    const d11 = utc(2026, 9, 11);
    const d12 = utc(2026, 9, 12);
    // ⚠️ PHẢI chốt `now`. Ca trước trong file này đặt `NGHI_PHEP.noticeDays = 1`, nên cổng
    // `isSubmittedLate` so `fromDate` với HÔM NAY THẬT nếu không truyền `now` — đơn xin nghỉ
    // cho 11/09 hoá "nộp muộn" kể từ 11/09/2026, và ca xanh suốt 4 ngày rồi đỏ mãi mãi.
    // Đã nổ thật: xanh mọi lượt tới 10/09, rerun CÙNG commit ngày 13/09 thì đỏ.
    // Chốt về 09/09 lúc 10:00 VN — trước `d11` đúng 2 ngày, thoả hạn báo trước 1 ngày.
    const now = new Date("2026-09-09T03:00:00Z");
    const l = await requests.submitAttendanceRequest({ ...base, now, requesterId: tv, kind: "LEAVE", fromDate: d11, toDate: d12, leaveTypeId: leaveId });
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    const rl = await requests.decideRequest({ now: NOW_TEST, requestId: l.id, decision: "APPROVED", note: "ok", actor, canWriteCenter: (c) => c === cs1 });
    expect(rl.ok).toBe(true);
    const cells = await db.shiftAssignment.findMany({ where: { userId: tv, workDate: { in: [d11, d12] }, status: "ACTIVE" } });
    expect(cells.map((c) => c.templateCode)).toEqual(["P", "P"]);
    expect(cells.every((c) => c.source === "LEAVE" && c.isLeave)).toBe(true);

    // TIMESHEET_FIX: ca CG của `tv` khai MỘT cặp quét (DEFAULT 1) và đơn khai đủ 2 mốc ⇒ từ
    // 06/10/2026 duyệt là GHI ĐÈ. Ngày chưa có lượt nào nên kết quả trùng bản "ghi thêm" cũ —
    // ca ghi đè thật (có lượt gốc bị thay) nằm ở khối "TIMESHEET_FIX 4 mốc" cuối file.
    // TIMESHEET_FIX không đi qua cổng báo-trước, nhưng chốt `now` cho cả vế sau để ca này
    // không còn chỗ nào đọc giờ thật.
    const f = await requests.submitAttendanceRequest({ ...base, now, requesterId: tv, kind: "TIMESHEET_FIX", fromDate: d9, toDate: null, requestedInAt: "07:40", requestedOutAt: "11:35" });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const rf = await requests.decideRequest({ now: NOW_TEST, requestId: f.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
    expect(rf.ok).toBe(true);
    const logs = await db.staffTimeLog.findMany({ where: { userId: tv, workDate: d9 }, orderBy: { loggedAt: "asc" } });
    expect(logs.map((x) => [x.direction, x.source, x.loggedAt.toISOString()])).toEqual([
      ["CHECK_IN", "MANUAL_ADJUST", "2026-09-09T00:40:00.000Z"],
      ["CHECK_OUT", "MANUAL_ADJUST", "2026-09-09T04:35:00.000Z"],
    ]);
    expect(logs.every((x) => x.adjustRequestId === f.id && x.reviewStatus === "CONFIRMED")).toBe(true);
    const ev = await db.domainEvent.findFirst({ where: { type: "hr.attendance_day_dirty", dedupeKey: { startsWith: `attday:${tv}:2026-09-09:` } } });
    expect(ev).not.toBeNull();
  });

  it("từ chối: chỉ đổi trạng thái, không chạm lưới; đơn vào kỳ đã KHOÁ bị từ chối nhận", async () => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "SHIFT_SWAP", fromDate: d10, toDate: null, requesterNewTemplateId: tplD1 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "REJECTED", note: "bận", actor, canWriteCenter: (c) => c === cs1 });
    expect(r.ok && r.applied).toBe(false);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("REJECTED");
    expect(await db.shiftAssignment.findFirst({ where: { userId: gv, workDate: d10, status: "ACTIVE" } })).toBeNull();

    await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-08", status: "LOCKED" } });
    const late = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: utc(2026, 8, 20), toDate: null, requestedInAt: "08:00" });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toMatch(/chốt sổ/);
  });

  // ── ĐI MUỘN ĐÃ DUYỆT ⇒ MIỄN TRỪ (đợt 2 đơn từ, chốt Q-5 08/10/2026) ───────────────────
  //
  // Đi trọn đường thật: nộp đơn → duyệt → tính lại ngày → đọc dòng bảng công. Ca thuần của engine
  // ([MSD-*]) dựng tay đầu vào nên không chứng minh được recompute có đọc đơn (luật 9).
  // Ngày riêng 14/09 + người riêng (tv) — không mượn trạng thái ca khác (luật 18).
  it("[MSD-DB-01] đơn đi muộn đến 08:30 được duyệt; quét 08:20 ⇒ bảng công mang DI_MUON_DA_DUYET, không DI_MUON", async () => {
    const d14 = utc(2026, 9, 14);
    await db.shiftAssignment.create({
      data: { userId: tv, centerId: cs1, workDate: d14, templateId: tplS, templateCode: "S", segments: [{ start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] }], source: "IMPORT" },
    });
    const luot = (h: number, mi: number, direction: "CHECK_IN" | "CHECK_OUT") =>
      db.staffTimeLog.create({
        data: { userId: tv, centerId: cs1, direction, workDate: d14, source: "TICKET", result: "ACCEPTED", loggedAt: new Date(Date.UTC(2026, 8, 14, h - 7, mi)) },
      });
    await luot(8, 20, "CHECK_IN");
    await luot(11, 30, "CHECK_OUT");
    const { recomputeAttendanceDay } = await import("../../lib/cham-cong/recompute");
    const SAU_NGAY = new Date("2026-09-15T03:00:00Z");

    // Trước khi có đơn: đi muộn 35′ ⇒ vi phạm.
    await recomputeAttendanceDay(tv, d14, { now: SAU_NGAY });
    const truoc = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: tv, workDate: d14 } } });
    expect(truoc.flags).toContain("DI_MUON");

    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: tv, kind: "LATE_EARLY", fromDate: d14, toDate: null, startTime: "08:30", detail: "Đi muộn" });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const d = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
    expect(d.ok).toBe(true);
    // Duyệt phải ĐÁNH DẤU ngày để tính lại (không thì phải đợi lượt quét kế tiếp mới đổi).
    expect(await db.domainEvent.count({ where: { dedupeKey: { startsWith: `attday:${tv}:2026-09-14:` }, payloadJson: { path: ["reason"], equals: "LATE_EARLY" } } })).toBe(1);

    await recomputeAttendanceDay(tv, d14, { now: SAU_NGAY });
    const sau = await db.staffAttendanceDay.findUniqueOrThrow({ where: { userId_workDate: { userId: tv, workDate: d14 } } });
    expect(sau.flags).toContain("DI_MUON_DA_DUYET");
    expect(sau.flags).not.toContain("DI_MUON");
    expect(sau.lateMinutes).toBe(35);
    expect(sau.lateApprovedMinutes).toBe(35);
  });

  // ── THU HỒI ĐƠN CHƯA DUYỆT (đợt 1 đơn từ, chốt Q-2 08/10/2026: CHỈ người nộp) ─────────
  //
  // Mỗi ca dùng NGÀY riêng (12, 16/09) và loại REMOTE — không mượn đơn ca khác để lại (luật 18).
  describe("[TH] thu hồi đơn chưa duyệt", () => {
    const d12 = utc(2026, 9, 12);

    it("[TH-01] người KHÁC không thu hồi được; người nộp thu hồi ⇒ WITHDRAWN + audit; QL duyệt đơn đó bị chặn", async () => {
      const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "REMOTE", fromDate: d12, toDate: d12 });
      expect(s.ok).toBe(true);
      if (!s.ok) return;

      // Người khác: CÙNG câu với đơn không tồn tại — không xác nhận id đơn của người khác có thật.
      const khac = await requests.withdrawRequest({ requestId: s.id, requesterId: tv, requesterName: "TV", now: NOW_TEST });
      expect(khac).toEqual({ ok: false, error: "Không tìm thấy đơn" });
      expect((await db.workRequest.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING");

      const r = await requests.withdrawRequest({ requestId: s.id, requesterId: gv, requesterName: "GV", now: NOW_TEST });
      expect(r.ok).toBe(true);
      const sau = await db.workRequest.findUniqueOrThrow({ where: { id: s.id }, select: { status: true, withdrawnAt: true } });
      expect(sau.status).toBe("WITHDRAWN");
      expect(sau.withdrawnAt?.toISOString()).toBe(NOW_TEST.toISOString());
      expect(await db.auditLog.count({ where: { entityType: "WorkRequest", entityId: s.id, action: "WITHDRAW_REQUEST" } })).toBe(1);

      const duyet = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
      expect(duyet).toEqual({ ok: false, error: "Người nộp đã thu hồi đơn này" });
      expect(await requests.withdrawRequest({ requestId: s.id, requesterId: gv, requesterName: "GV", now: NOW_TEST })).toEqual({
        ok: false,
        error: "Người nộp đã thu hồi đơn này",
      });

      // Thu hồi xong được nộp LẠI cùng loại cùng ngày — cổng "đơn trùng" chỉ tính đơn còn chờ.
      const lai = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "REMOTE", fromDate: d12, toDate: d12 });
      expect(lai.ok).toBe(true);
    });

    it("[TH-02] đơn ĐÃ DUYỆT không thu hồi được (đó là 'yêu cầu huỷ', đợt 8)", async () => {
      // Ngày 16/09: `tv` đã có đơn NGHỈ 11–12/09 đã duyệt ở ca trước — làm từ xa ngày 11 nay trùng (đợt 12).
      const d16 = utc(2026, 9, 16);
      const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: tv, kind: "REMOTE", fromDate: d16, toDate: d16 });
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      const d = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
      expect(d.ok).toBe(true);
      const r = await requests.withdrawRequest({ requestId: s.id, requesterId: tv, requesterName: "TV", now: NOW_TEST });
      expect(r).toEqual({ ok: false, error: "Đơn đã được duyệt" });
      expect((await db.workRequest.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("APPROVED");
    });
  });

  // ── ĐƠN CHỈNH CÔNG 4 MỐC + GHI ĐÈ / GHI THÊM (chủ dự án chốt 06/10/2026) ───────────────
  //
  // Trước 06/10 mọi đơn TIMESHEET_FIX được duyệt đều CHỈ GHI THÊM dòng. Nay: đơn khai ĐỦ BỘ
  // mốc của ca (2 mốc với ca một cặp quét, 4 mốc với ca hai cặp) ⇒ GHI ĐÈ — lượt quét cũ còn
  // trong DB nhưng `DISMISSED`, không còn tính công. Thiếu ⇒ GHI THÊM như cũ.
  describe("TIMESHEET_FIX 4 mốc — ghi đè khi đủ bộ, ghi thêm khi thiếu", () => {
    const segST = [
      { start: "07:45", end: "11:30", kind: "WORK", orgUnitIds: [] },
      { start: "17:15", end: "21:00", kind: "WORK", orgUnitIds: [] },
    ];
    async function caVaLuot(ngay: Date, soCap: 1 | 2) {
      await db.shiftAssignment.create({
        data: {
          userId: gv, centerId: cs1, workDate: ngay, templateId: tplS, templateCode: "S",
          segments: soCap === 2 ? segST : [segST[0]!], source: "IMPORT", soCapQuetKyVong: soCap,
        },
      });
      // Lượt quét GỐC: vào 07:50 (00:50 UTC).
      return (
        await db.staffTimeLog.create({
          data: {
            userId: gv, centerId: cs1, direction: "CHECK_IN", workDate: ngay, source: "TICKET", result: "ACCEPTED",
            loggedAt: new Date(Date.UTC(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate(), 0, 50)),
          },
        })
      ).id;
    }
    const conTinh = (ngay: Date) =>
      db.staffTimeLog.findMany({
        where: { userId: gv, workDate: ngay, result: "ACCEPTED", reviewStatus: { not: "DISMISSED" } },
        orderBy: { loggedAt: "asc" },
      });

    it("ca HAI cặp + đơn đủ 4 mốc ⇒ GHI ĐÈ: lượt gốc DISMISSED, còn tính đúng 4 mốc mới, thông báo đủ 4 mốc", async () => {
      const ngay = utc(2026, 9, 15);
      const goc = await caVaLuot(ngay, 2);
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: ngay, toDate: null,
        requestedInAt: "07:45", requestedOutAt: "11:30", requestedIn2At: "17:15", requestedOut2At: "21:00",
      });
      expect(s.ok, JSON.stringify(s)).toBe(true);
      if (!s.ok) return;
      const luu = await db.workRequest.findUniqueOrThrow({ where: { id: s.id } });
      expect([luu.requestedIn2At, luu.requestedOut2At]).toEqual(["17:15", "21:00"]);

      const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const g = await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } });
      expect(g.reviewStatus).toBe("DISMISSED");
      expect(g.reviewNote).toContain(`đơn chỉnh công ${s.id}`);
      const ct = await conTinh(ngay);
      expect(ct.map((x) => [x.direction, x.source, x.adjustRequestId])).toEqual([
        ["CHECK_IN", "MANUAL_ADJUST", s.id],
        ["CHECK_OUT", "MANUAL_ADJUST", s.id],
        ["CHECK_IN", "MANUAL_ADJUST", s.id],
        ["CHECK_OUT", "MANUAL_ADJUST", s.id],
      ]);
      expect(r.message).toContain("ghi đè");
      expect(r.notify[0]?.body).toContain("vào 1 07:45, ra 1 11:30, vào 2 17:15, ra 2 21:00");
    });

    it("ca MỘT cặp + đơn đủ 2 mốc ⇒ GHI ĐÈ (lượt gốc thôi tính)", async () => {
      const ngay = utc(2026, 9, 16);
      const goc = await caVaLuot(ngay, 1);
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: ngay, toDate: null,
        requestedInAt: "07:40", requestedOutAt: "11:35",
      });
      if (!s.ok) throw new Error(s.error);
      const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
      expect(r.ok).toBe(true);
      expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } })).reviewStatus).toBe("DISMISSED");
      expect((await conTinh(ngay)).map((x) => x.source)).toEqual(["MANUAL_ADJUST", "MANUAL_ADJUST"]);
    });

    it("đơn THIẾU bộ (chỉ giờ ra) ⇒ GHI THÊM: lượt vào thật của người nộp GIỮ NGUYÊN và còn tính", async () => {
      const ngay = utc(2026, 9, 17);
      const goc = await caVaLuot(ngay, 1);
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: ngay, toDate: null,
        requestedOutAt: "11:35",
      });
      if (!s.ok) throw new Error(s.error);
      const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
      expect(r.ok).toBe(true);
      expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } })).reviewStatus).toBe("PENDING");
      expect((await conTinh(ngay)).map((x) => [x.direction, x.source])).toEqual([
        ["CHECK_IN", "TICKET"],
        ["CHECK_OUT", "MANUAL_ADJUST"],
      ]);
    });

    it("ca HAI cặp mà đơn chỉ 2 mốc ⇒ GHI THÊM (chưa đủ bộ của ca)", async () => {
      const ngay = utc(2026, 9, 18);
      const goc = await caVaLuot(ngay, 2);
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: ngay, toDate: null,
        requestedInAt: "07:45", requestedOutAt: "11:30",
      });
      if (!s.ok) throw new Error(s.error);
      const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
      expect(r.ok).toBe(true);
      expect((await db.staffTimeLog.findUniqueOrThrow({ where: { id: goc } })).reviewStatus).toBe("PENDING");
      expect(await conTinh(ngay)).toHaveLength(3);
    });

    it("nộp đơn mốc SAI THỨ TỰ ⇒ từ chối ngay lúc nộp", async () => {
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: utc(2026, 9, 19), toDate: null,
        requestedInAt: "07:45", requestedOutAt: "11:30", requestedIn2At: "11:00", requestedOut2At: "21:00",
      });
      expect(s.ok).toBe(false);
      if (!s.ok) expect(s.error).toContain("Vào 2 (11:00) phải sau Ra 1 (11:30)");
    });

    it("DUYỆT vào kỳ đã chốt ⇒ từ chối, KHÔNG phép ghi nào: lượt gốc chưa bị đánh dấu, không thêm dòng", async () => {
      const ngay = utc(2026, 9, 20);
      const goc = await caVaLuot(ngay, 1);
      const s = await requests.submitAttendanceRequest({
        now: NOW_TEST, ...base, requesterId: gv, kind: "TIMESHEET_FIX", fromDate: ngay, toDate: null,
        requestedInAt: "07:40", requestedOutAt: "11:35",
      });
      if (!s.ok) throw new Error(s.error);
      // Chốt kỳ SAU khi nộp — đúng ca "nộp trước khi chốt, duyệt sau khi chốt".
      const ky = await db.attendancePeriod.create({ data: { centerId: cs1, periodKey: "2026-09", status: "LOCKED" } });
      try {
        const r = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: (c) => c === cs1 });
        expect(r.ok).toBe(false);
        const ds = await db.staffTimeLog.findMany({ where: { userId: gv, workDate: ngay } });
        expect(ds.map((x) => [x.id, x.reviewStatus])).toEqual([[goc, "PENDING"]]);
        expect((await db.workRequest.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING");
      } finally {
        await db.attendancePeriod.delete({ where: { id: ky.id } });
      }
    });
  });
});
