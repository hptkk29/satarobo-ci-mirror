// tests/hoc-bu/sua-du-lieu.test.ts — T15: KẾ HOẠCH + SỬA DỮ LIỆU HỌC BÙ trên Postgres THẬT (dữ liệu hỏng dựng tay rồi để checker gọi tên).
//
// Đường chạy giống script: checker (READ ONLY) → `lapKeHoachSua` → `apDungSua(tx, kế hoạch, { luật, expect })`. Chứng minh:
//   · mỗi hàm sửa chữa ĐÚNG thứ checker nêu, để lại một dòng nhật ký `hoc-bu.sua-du-lieu`, và chạy lại không sửa lần hai;
//   · `--expect` lệch ⇒ dừng TRƯỚC khi ghi; dữ liệu đổi giữa kế hoạch và áp dụng ⇒ BỎ QUA dòng đó, không đè;
//   · KHÔNG BỊA trạng thái vắng: thiếu bằng chứng audit thì điểm danh gốc không bị đụng vào;
//   · dry-run (lập kế hoạch) không ghi một dòng nào.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docSnapshot } from "@/lib/hoc-bu/toan-ven-db";
import { chayToanVen } from "@/lib/hoc-bu/toan-ven";
import { dongTuDongCuaLuat, lapKeHoachSua, LoiExpect, type KeHoachSua } from "@/lib/hoc-bu/ke-hoach-sua";
import { apDungSua } from "@/lib/hoc-bu/sua-du-lieu-db";
import { taoPhiBu } from "@/lib/hoc-bu/case-db";
import { ADMIN, BAI, CS, HV, buoiGoc, diemDanh, don, dung, id, luc, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[SDL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t07-";
const thuocFixture = (f: { id: string; lienQuan?: Record<string, string> }) => f.id.includes(T) || Object.values(f.lienQuan ?? {}).some((v) => v.includes(T));

/** Chạy checker như script (READ ONLY, REPEATABLE READ) rồi lập kế hoạch — CHỈ phần thuộc fixture (DB test có thể còn dữ liệu của bộ khác). */
async function keHoach(now: Date = luc(15, 18, 45)): Promise<KeHoachSua> {
  const o = { now, tuNgayYmd: "2026-09-20" };
  const kq = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return chayToanVen(await docSnapshot(tx, o), o);
    },
    { timeout: 60_000, isolationLevel: "RepeatableRead" },
  );
  return lapKeHoachSua(kq.findings.filter(thuocFixture));
}
const ap = (kh: KeHoachSua, luat: Parameters<typeof dongTuDongCuaLuat>[1], expectN?: number) =>
  db.$transaction((tx) => apDungSua(tx, kh, { luat, expect: expectN ?? dongTuDongCuaLuat(kh, luat).length }));
const nhatKySua = (entityId: string) => db.auditLog.findMany({ where: { module: "hoc-bu", action: "hoc-bu.sua-du-lieu", entityId } });
const demNhatKySua = () => db.auditLog.count({ where: { module: "hoc-bu", action: "hoc-bu.sua-du-lieu" } });

describe.skipIf(!RUN_DB_TESTS)("[SDL] sửa dữ liệu học bù — T15", () => {
  beforeEach(() => dung());
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { module: "hoc-bu", action: "hoc-bu.sua-du-lieu" } });
    await db.auditLog.deleteMany({ where: { entityId: buoiGoc(7), action: "attendance.edited" } });
    await don();
  });

  it("[SDL-01] TV-03: dòng thiếu bài mà buổi gốc có bài ⇒ điền bài (chỗ trống); nhật ký; chạy lại ⇒ 0; giá trị đã có KHÔNG bị đè", async () => {
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-03").map((d) => d.id)).toEqual([needId("A", 5)]);
    const kq = await ap(kh, "TV-03");
    expect(kq).toMatchObject({ duDieuKien: 1, daSua: 1, boQua: [] });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).missedLessonId).toBe(BAI[5]);
    const vet = await nhatKySua(needId("A", 5));
    expect(vet).toHaveLength(1);
    expect(vet[0]!.newValues).toMatchObject({ luatGoc: "TV-03", missedLessonId: BAI[5] });
    expect(vet[0]!.reason).toContain("TV-03");
    const sau = await keHoach();
    expect(dongTuDongCuaLuat(sau, "TV-03")).toEqual([]);
    expect(await ap(sau, "TV-03", 0)).toMatchObject({ duDieuKien: 0, daSua: 0 });
  });

  it("[SDL-02] TV-31: dòng nguồn ABSENCE mất liên kết điểm danh gốc ⇒ nối lại đúng bản ghi của (học viên, buổi gốc); nhật ký cũ→mới", async () => {
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { originalAttendanceId: null } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-31").map((d) => d.id)).toEqual([needId("B", 6)]);
    const kq = await ap(kh, "TV-31");
    expect(kq.daSua).toBe(1);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("B", 6) } })).originalAttendanceId).toBe(`${buoiGoc(6)}-B`);
    expect((await nhatKySua(needId("B", 6)))[0]!.oldValues).toMatchObject({ originalAttendanceId: null });
  });

  it("[SDL-03] TV-10: case SCHEDULED mà hết bé ⇒ chốt lại thành CANCELLED (có nhật ký đổi trạng thái); case CÒN bé thì không bị đụng", async () => {
    const rong = await tao([needId("C", 7)]);
    const con = await tao([needId("B", 6)], { ymd: "2026-10-16" });
    await db.makeupCaseParticipant.updateMany({ where: { caseId: rong }, data: { attendanceStatus: "REMOVED" } });
    await db.makeupCaseStudent.updateMany({ where: { caseId: rong }, data: { result: "RELEASED", status: "RELEASED" } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-10").map((d) => d.id)).toEqual([rong]);
    const kq = await ap(kh, "TV-10");
    expect(kq.daSua).toBe(1);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: rong } })).status).toBe("CANCELLED");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: con } })).status).toBe("SCHEDULED");
    const au = (await db.auditLog.findMany({ where: { entityId: rong, module: "hoc-bu" } })).map((r) => r.action).sort();
    expect(au).toEqual(["hoc-bu.doi-trang-thai-case", "hoc-bu.sua-du-lieu", "hoc-bu.tao-case"]);
  });

  it("[SDL-04] TV-11: mọi bé đã điểm danh mà case vẫn SCHEDULED (kẹt) ⇒ chốt lại theo điểm danh; vẫn còn bé chờ ⇒ KHÔNG chốt", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    await db.makeupCase.update({ where: { id: c }, data: { status: "SCHEDULED", completedAt: null } }); // giả lập kẹt
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-11").map((d) => d.id)).toEqual([c]);
    expect((await ap(kh, "TV-11")).daSua).toBe(1);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
    expect(await ap(await keHoach(), "TV-11", 0)).toMatchObject({ daSua: 0 });
  });

  const nhatKyAudit = (luc_: string, cu: string, moi: string) => ({
    actorName: "QA",
    module: "attendance",
    entityType: "ClassSession",
    entityId: buoiGoc(7),
    action: "attendance.edited",
    oldValues: { records: [{ studentId: HV.C, status: cu }] },
    newValues: { records: [{ studentId: HV.C, status: moi }] },
    createdAt: new Date(luc_),
  });
  /** Bé C bù xong bài 7 rồi buổi gốc bị ghi đè PRESENT (đúng lỗi điểm danh bù đời cũ). */
  async function dungGhiDe() {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    await db.attendance.updateMany({ where: { sessionId: buoiGoc(7), studentId: HV.C }, data: { status: "PRESENT" } });
    return c;
  }

  it("[SDL-05] TV-20 CÓ BẰNG CHỨNG (nhật ký chỉ một trạng thái vắng trước lúc bù xong) ⇒ khôi phục ĐÚNG trạng thái đó; makeupStatus giữ nguyên; nhật ký ghi bằng chứng", async () => {
    await dungGhiDe();
    await db.auditLog.create({ data: nhatKyAudit("2026-10-01T00:00:00Z", "ABSENT_UNEXCUSED", "ABSENT_UNEXCUSED") });
    const truoc = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoiGoc(7), studentId: HV.C } } });
    const kh = await keHoach();
    const d = dongTuDongCuaLuat(kh, "TV-20");
    expect(d).toHaveLength(1);
    expect(d[0]!.finding.lienQuan).toMatchObject({ trangThaiGoc: "ABSENT_UNEXCUSED" });
    expect((await ap(kh, "TV-20")).daSua).toBe(1);
    const sau = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoiGoc(7), studentId: HV.C } } });
    expect(sau.status).toBe("ABSENT_UNEXCUSED");
    expect(sau.makeupStatus).toBe(truoc.makeupStatus);
    const vet = (await db.auditLog.findMany({ where: { module: "hoc-bu", action: "hoc-bu.sua-du-lieu" } }))[0]!;
    expect(vet.oldValues).toMatchObject({ attendanceStatus: "PRESENT" });
    expect(vet.newValues).toMatchObject({ attendanceStatus: "ABSENT_UNEXCUSED", luatGoc: "TV-20" });
    expect(vet.reason).toContain("TV-20");
    expect((await keHoach()).dong.filter((x) => x.luat === "TV-20")).toEqual([]);
  });

  it("[SDL-06] KHÔNG BỊA TRẠNG THÁI VẮNG: thiếu nhật ký ⇒ NEEDS_MANUAL_REVIEW, không tự động; hai trạng thái vắng khác nhau ⇒ cũng không; ép --expect cũng không đụng điểm danh", async () => {
    await dungGhiDe();
    let kh = await keHoach();
    let d20 = kh.dong.filter((x) => x.luat === "TV-20");
    expect(d20.map((x) => [x.phanLoai, x.tuDongDuoc, x.cachSua])).toEqual([["NEEDS_MANUAL_REVIEW", false, "CHI_NEU"]]);
    await db.auditLog.create({ data: nhatKyAudit("2026-10-01T00:00:00Z", "ABSENT_UNEXCUSED", "ABSENT_EXCUSED") });
    kh = await keHoach();
    d20 = kh.dong.filter((x) => x.luat === "TV-20");
    expect(d20.map((x) => x.tuDongDuoc)).toEqual([false]);
    // Dù người chạy cố ép --expect=1: kế hoạch chỉ có 0 dòng đủ điều kiện ⇒ LoiExpect, và điểm danh KHÔNG bị đổi.
    await expect(ap(kh, "TV-20", 1)).rejects.toBeInstanceOf(LoiExpect);
    expect((await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoiGoc(7), studentId: HV.C } } })).status).toBe("PRESENT");
    expect(await demNhatKySua()).toBe(0);
  });

  it("[SDL-07] TV-50: phí thu thiếu mà dòng SCHEDULED (hoàn không qua sự kiện) ⇒ script gỡ bé khỏi case qua đúng hàm xét lại; chạy lại ⇒ 0", async () => {
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    const { orderId } = await taoPhiBu(ADMIN, needId("A", 5));
    const tong = (await db.order.findUniqueOrThrow({ where: { id: orderId } })).totalAmount;
    const thu = await db.payment.create({ data: { orderId, amount: tong, method: "BANK_TRANSFER", accountantStatus: "CONFIRMED", paidDate: new Date("2026-10-07T03:00:00.000Z"), centerId: CS } });
    const c = await tao([needId("A", 5), needId("B", 6)], { lessonIds: [BAI[5], BAI[6]] });
    await db.payment.create({ data: { orderId, amount: -Math.round(tong / 3), method: "BANK_TRANSFER", accountantStatus: "REFUNDED", adjustmentOfId: thu.id, paidDate: new Date(), centerId: CS } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-50").map((d) => d.id)).toEqual([needId("A", 5)]);
    expect((await ap(kh, "TV-50")).daSua).toBe(1);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).status).toBe("PENDING");
    expect((await db.makeupCaseParticipant.findFirstOrThrow({ where: { caseId: c, studentId: HV.A } })).attendanceStatus).toBe("REMOVED");
    expect((await keHoach()).dong.filter((x) => x.luat === "TV-50")).toEqual([]);
  });

  it("[SDL-08] DRY-RUN KHÔNG GHI: lập kế hoạch (checker READ ONLY + kế hoạch thuần) không đổi dòng nào — kể cả nhật ký, kể cả updatedAt", async () => {
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    const truoc = {
      nhatKy: await db.auditLog.count(),
      dong: (await db.makeupNeed.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, missedLessonId: true } })).map((n) => `${n.id}|${n.updatedAt.toISOString()}|${n.missedLessonId}`),
    };
    const kh = await keHoach();
    expect(kh.dong.length).toBeGreaterThan(0);
    const sau = {
      nhatKy: await db.auditLog.count(),
      dong: (await db.makeupNeed.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true, missedLessonId: true } })).map((n) => `${n.id}|${n.updatedAt.toISOString()}|${n.missedLessonId}`),
    };
    expect(sau).toEqual(truoc);
  });

  it("[SDL-09] --expect LỆCH ⇒ ném TRƯỚC khi ghi: không dòng nào đổi, không nhật ký; luật không có đường tự động (hoặc CHI_NEU) cũng bị từ chối", async () => {
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    const kh = await keHoach();
    await expect(ap(kh, "TV-03", 0)).rejects.toBeInstanceOf(LoiExpect);
    await expect(ap(kh, "TV-03", 2)).rejects.toThrow(/đã đổi kể từ dry-run/);
    await expect(ap(kh, "TV-30", 0)).rejects.toThrow(/không có đường sửa tự động/);
    await expect(ap(kh, "TV-08", 0)).rejects.toBeInstanceOf(LoiExpect);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).missedLessonId).toBeNull();
    expect(await demNhatKySua()).toBe(0);
  });

  it("[SDL-10] DỮ LIỆU ĐỔI GIỮA KẾ HOẠCH VÀ ÁP DỤNG ⇒ dòng đó BỊ BỎ QUA kèm lý do, giá trị mới của người khác KHÔNG bị đè; dòng còn lại vẫn được sửa", async () => {
    await db.makeupNeed.updateMany({ where: { id: { in: [needId("A", 5), needId("A", 6)] } }, data: { missedLessonId: null } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-03")).toHaveLength(2);
    // Trong lúc đó có người điền bài khác vào dòng A5.
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: BAI[8] } });
    const kq = await ap(kh, "TV-03", 2);
    expect(kq.daSua).toBe(1);
    expect(kq.boQua).toEqual([{ id: needId("A", 5), lyDo: "dòng đã có bài hoặc đã huỷ kể từ lúc kiểm" }]);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 5) } })).missedLessonId).toBe(BAI[8]);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("A", 6) } })).missedLessonId).toBe(BAI[6]);
  });

  it("[SDL-11] PHÂN LOẠI không bị bẻ: phát hiện NEEDS_MANUAL_REVIEW / INVALID của luật có hàm sửa vẫn KHÔNG tự động; luật SCRIPT_RIENG chỉ đường tới script", async () => {
    // TV-03 dạng 'cả dòng lẫn buổi gốc đều thiếu bài' ⇒ NEEDS_MANUAL_REVIEW.
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { missedLessonId: null } });
    await db.classSession.update({ where: { id: buoiGoc(5) }, data: { lessonId: null } });
    // TV-08: buổi vắng chưa có dòng ⇒ script riêng.
    await db.attendance.create({ data: { id: id("diem-danh-vang-moi"), sessionId: buoiGoc(8), studentId: HV.A, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", centerId: CS } });
    const kh = await keHoach();
    const tv03 = kh.dong.filter((d) => d.luat === "TV-03");
    expect(tv03.map((d) => [d.phanLoai, d.tuDongDuoc, d.cachSua])).toEqual([["NEEDS_MANUAL_REVIEW", false, "CHI_NEU"]]);
    const tv08 = kh.dong.filter((d) => d.luat === "TV-08");
    expect(tv08).toHaveLength(1);
    expect(tv08[0]).toMatchObject({ cachSua: "SCRIPT_RIENG", tuDongDuoc: false });
    expect(tv08[0]!.script).toContain("scripts/bu-vang-tu-ngay.ts");
  });

  it("[SDL-12] TV-11 trên case ĐỜI CŨ (chưa có bé tham gia): script NÂNG case lên trước khi chốt — không có bước này thì 'không có bé nào' bị đọc thành HUỶ và case đã dạy xong bị huỷ nhầm", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    // Giả lập đời cũ: không bé tham gia, mục mồ côi bé; case kẹt SCHEDULED.
    await db.makeupCaseParticipant.deleteMany({ where: { caseId: c } });
    await db.makeupCase.update({ where: { id: c }, data: { status: "SCHEDULED", completedAt: null } });
    const kh = await keHoach();
    const d = dongTuDongCuaLuat(kh, "TV-11");
    expect(d.map((x) => x.id)).toEqual([c]);
    const kq = await ap(kh, "TV-11");
    expect(kq).toMatchObject({ daSua: 1, boQua: [] });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(1); // đã nâng: bé tham gia được dựng từ mục
  });

  it("[SDL-13] TV-20: điểm danh gốc đổi sang trạng thái KHÁC giữa kế hoạch và áp dụng (người ta đã sửa tay) ⇒ BỎ QUA, không đè", async () => {
    await dungGhiDe();
    await db.auditLog.create({ data: nhatKyAudit("2026-10-01T00:00:00Z", "ABSENT_UNEXCUSED", "ABSENT_UNEXCUSED") });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-20")).toHaveLength(1);
    await db.attendance.updateMany({ where: { sessionId: buoiGoc(7), studentId: HV.C }, data: { status: "EXCUSED" } });
    const kq = await ap(kh, "TV-20", 1);
    expect(kq.daSua).toBe(0);
    expect(kq.boQua[0]!.lyDo).toContain("đã đổi sang EXCUSED");
    expect((await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoiGoc(7), studentId: HV.C } } })).status).toBe("EXCUSED");
    expect(await demNhatKySua()).toBe(0);
  });

  it("[SDL-14] TV-31: bản ghi điểm danh trong kế hoạch bị đổi chủ giữa kế hoạch và áp dụng (không còn là của (học viên, buổi gốc) của dòng) ⇒ BỎ QUA, không nối nhầm", async () => {
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { originalAttendanceId: null } });
    const kh = await keHoach();
    expect(dongTuDongCuaLuat(kh, "TV-31").map((d) => d.id)).toEqual([needId("B", 6)]);
    await db.attendance.update({ where: { id: `${buoiGoc(6)}-B` }, data: { studentId: HV.D } });
    const kq = await ap(kh, "TV-31", 1);
    expect(kq.daSua).toBe(0);
    expect(kq.boQua[0]!.lyDo).toContain("không còn đúng");
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needId("B", 6) } })).originalAttendanceId).toBeNull();
  });
});
