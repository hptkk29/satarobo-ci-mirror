// tests/hoc-bu/them-hoc-vien-vao-case.test.ts — [THV] 20/10/2026: SAU KHI TẠO case vẫn thêm được học viên khác — và nếu bé vắng bài case chưa dạy thì bài đó vào bộ bài, TRONG MỘT giao dịch.
//
// Chủ dự án: "sau khi tạo case vẫn có thể sửa thêm các buổi khác, hoặc thêm học viên khác cùng lớp vào chung case".
// Một bài không có bé nào vắng thì dạy không ai ⇒ không có đường "thêm bài trần": bài mới chỉ vào bộ bài KÈM các dòng cần bù của nó (`xepVaoCaseCoSan` · `moRongBai`).
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
// Fixture: A vắng 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cùng cơ sở (`_case-nhieu-bai-fixture.ts`).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { LoiTrungLich, goBeKhoiCase, goKhoiCase, suaCase, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { ADMIN, BAI, CS, GV2, HV, KHOA, LOP2, beCua, don, dung, diemDanh, id, lyDoLoi, mucCua, need, needId, PHONG2, sach, so, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[THV] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const baiCua = async (caseId: string) => (await db.makeupCaseLesson.findMany({ where: { caseId }, orderBy: { order: "asc" } })).map((l) => [l.lessonId, l.order]);
const phienBan = async (caseId: string) => (await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).version;
const soBe = (caseId: string) => db.makeupCaseParticipant.count({ where: { caseId } });

describe.skipIf(!RUN_DB_TESTS)("[THV] thêm học viên / buổi vắng vào case đã tạo", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[THV-01] case dạy bài 5, thêm B (vắng bài 6) với `moRongBai` ⇒ bài 6 vào bộ bài (thứ tự 2), B vào case, dòng B6 hết chờ bù, lượt được giữ, version tăng, nhật ký ghi bài thêm", async () => {
    const c = await tao([needId("A", 5)]);
    const v0 = await phienBan(c);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)], moRongBai: true });
    expect(await baiCua(c)).toEqual([[BAI[5], 1], [BAI[6], 2]]);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).lessonId).toBe(BAI[5]); // bài chính không đổi
    expect(await soBe(c)).toBe(2);
    expect((await need("B", 6)).status).toBe("SCHEDULED");
    expect((await mucCua(c, "B", 6)).dungLuot).toBe(true);
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await phienBan(c)).toBe(v0 + 1);
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: c, action: "hoc-bu.xep-vao-case" } });
    expect((nk.newValues as { baiThem?: string[] }).baiThem).toEqual([BAI[6]]);
    await sach();
  });

  it("[THV-02] thêm hai bé vắng hai bài mới cùng lúc (B6 + C7) ⇒ bộ bài 5-6-7 ĐÚNG 3 bài; thêm D (bài 8) là bài thứ 4 ⇒ từ chối và KHÔNG ghi gì (bài, bé, dòng, lượt, version)", async () => {
    const c = await tao([needId("A", 5)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6), needId("C", 7)], moRongBai: true });
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6], BAI[7]]);
    const v = await phienBan(c);
    const loi = await lyDoLoi(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("D", 8)], moRongBai: true }));
    expect(loi).toContain("tối đa 3 bài");
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6], BAI[7]]);
    expect(await soBe(c)).toBe(3);
    expect((await need("D", 8)).status).toBe("PENDING");
    expect(await so("D")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await phienBan(c)).toBe(v);
    await sach();
  });

  it("[THV-03] KHÔNG bật `moRongBai` ⇒ luật cũ giữ nguyên: bé vắng bài ngoài bộ bài bị từ chối, bộ bài không đổi", async () => {
    const c = await tao([needId("A", 5)]);
    const v = await phienBan(c);
    expect(await lyDoLoi(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)] }))).toContain("không nằm trong bộ bài");
    expect(await baiCua(c)).toEqual([[BAI[5], 1]]);
    expect(await soBe(c)).toBe(1);
    expect(await phienBan(c)).toBe(v);
  });

  it("[THV-04] MỘT giao dịch: bài mới đã chèn mà xếp bé thất bại (bé trùng lịch với case khác) ⇒ ROLLBACK cả hai — bộ bài về như cũ, version không tăng, dòng vẫn chờ bù", async () => {
    // B đang ở case khác cùng khung giờ (GV khác, không phòng) ⇒ thêm B6 vào case A5 là trùng lịch HỌC VIÊN, báo SAU khi bộ bài đã được nới trong giao dịch.
    await tao([needId("B", 7)], { teacherId: GV2, roomId: PHONG2 });
    const c = await tao([needId("A", 5)]);
    const v = await phienBan(c);
    await expect(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)], moRongBai: true })).rejects.toBeInstanceOf(LoiTrungLich);
    expect(await baiCua(c)).toEqual([[BAI[5], 1]]);
    expect(await phienBan(c)).toBe(v);
    expect(await soBe(c)).toBe(1);
    expect((await need("B", 6)).status).toBe("PENDING");
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 }); // chỉ lượt của B7 ở case kia
  });

  it("[THV-05] đã có bé điểm danh: thêm bé vắng bài case ĐANG dạy vẫn được; thêm bài MỚI bị chặn (case đã chạy) và không ghi gì", async () => {
    const c = await tao([needId("B", 6), needId("B", 7), needId("C", 7)]); // bộ bài 6-7, hai bé
    await diemDanh(c, "B", true, { 6: "COMPLETED", 7: "COMPLETED" });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED"); // C chưa điểm danh nên case còn mở
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("A", 6)], moRongBai: true });
    expect(await soBe(c)).toBe(3);
    const v = await phienBan(c);
    const loi = await lyDoLoi(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("D", 8)], moRongBai: true }));
    expect(loi).toContain("đã có bé được điểm danh");
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[6], BAI[7]]);
    expect(await phienBan(c)).toBe(v); // bài 6 đã có sẵn ⇒ lượt thêm A6 không nới bộ bài ⇒ không tăng version
    expect((await need("D", 8)).status).toBe("PENDING");
  });

  it("[THV-06] hộp 'Sửa case' mở TRƯỚC lượt thêm bài bị từ chối vì phiên bản đã cũ (không ghi đè bộ bài mới bằng bộ bài cũ)", async () => {
    const c = await tao([needId("A", 5)]);
    const v0 = await phienBan(c);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)], moRongBai: true });
    const loi = await lyDoLoi(suaCase(ADMIN, { caseId: c, phienBan: v0, note: "sửa muộn", ten: "Test" }));
    expect(loi).toContain("vừa được người khác sửa");
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6]]);
  });

  it("[THV-07] bé ĐÃ trong case vắng thêm một bài khác ⇒ mục thứ hai của chính bé đó vào case (không tạo participant thứ hai), bộ bài nới theo", async () => {
    const c = await tao([needId("A", 5)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("A", 6)], moRongBai: true });
    expect(await soBe(c)).toBe(1);
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, participant: { studentId: HV.A }, result: { not: "RELEASED" } } })).toBe(2);
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6]]);
    expect(await so("A")).toEqual({ granted: 3, held: 2, consumed: 0, con: 1 });
    await sach();
  });
  it("[THV-08] học viên LỚP KHÁC cùng khoá vào chung case (và kéo bài của lớp đó vào bộ bài); KHÁC KHOÁ thì không có đường nào vào — ứng viên đọc theo cơ sở + khoá của case", async () => {
    // C còn vắng bài 6 ở LỚP KHÁC (LOP2, cùng khoá KHOA): buổi gốc, điểm danh vắng và dòng cần bù riêng.
    const buoi = id("s6-lop2");
    await db.classSession.create({ data: { id: buoi, classId: LOP2, date: new Date("2026-09-25T11:00:00.000Z"), lessonId: BAI[6], status: "COMPLETED", centerId: CS } });
    await db.enrollment.create({ data: { id: id("gd-C-lop2"), studentId: HV.C, classId: LOP2, courseId: KHOA, status: "ACTIVE" } });
    await db.attendance.create({ data: { id: `${buoi}-C`, sessionId: buoi, studentId: HV.C, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: CS } });
    const needKhac = id("need-C-lop2-6");
    await db.makeupNeed.create({
      data: { id: needKhac, studentId: HV.C, classId: LOP2, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", originalAttendanceId: `${buoi}-C`, missedSessionId: buoi, missedLessonId: BAI[6], status: "PENDING", createdAt: new Date("2026-10-01T00:00:00.000Z") },
    });
    const c = await tao([needId("A", 5)]); // case của lớp LOP
    const kq = await lyDoLoi(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needKhac], moRongBai: true }));
    expect(kq).toBeNull();
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6]]);
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, studentId: HV.C } })).toBe(1);
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: needKhac } })).status).toBe("SCHEDULED");
  });
  // ── Mỗi bé một buổi riêng: gỡ buổi / gỡ bé thì bộ bài tự gọn lại ─────────────────────────────────────────
  const chinh = async (caseId: string) => (await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).lessonId;

  it("[THV-09] gỡ CẢ BÉ vắng bài riêng ⇒ bài đó hết người học nên BỎ khỏi bộ bài; bài chính không đổi; version tăng; dòng về cần bù; checker sạch", async () => {
    const c = await tao([needId("A", 5)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)], moRongBai: true });
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6]]);
    const v = await phienBan(c);
    await goBeKhoiCase(ADMIN, (await db.makeupCaseParticipant.findUniqueOrThrow({ where: { caseId_studentId: { caseId: c, studentId: HV.B } } })).id);
    expect(await baiCua(c)).toEqual([[BAI[5], 1]]);
    expect(await chinh(c)).toBe(BAI[5]);
    expect(await phienBan(c)).toBe(v + 1);
    expect((await need("B", 6)).status).toBe("PENDING");
    expect(await so("B")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    await sach();
  });

  it("[THV-10] gỡ MỘT buổi của bé còn buổi khác ⇒ bài bị gỡ ra khỏi bộ bài, bài còn lại thành bài đầu = bài chính (thứ tự 1); bé vẫn trong case", async () => {
    const c = await tao([needId("A", 5)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("A", 6)], moRongBai: true });
    await goKhoiCase(ADMIN, (await mucCua(c, "A", 5)).id);
    expect(await baiCua(c)).toEqual([[BAI[6], 1]]);
    expect(await chinh(c)).toBe(BAI[6]);
    expect((await beCua(c, "A")).attendanceStatus).toBe("PENDING");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED");
    expect((await need("A", 5)).status).toBe("PENDING");
    await sach();
  });

  it("[THV-11] chỗ được TRẢ LẠI: case 3 bài, gỡ bé của bài thứ ba ⇒ còn 2 bài và thêm được bé vắng bài khác (không bị kẹt trần 3 vì bài chết)", async () => {
    const c = await tao([needId("A", 5)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6), needId("C", 7)], moRongBai: true });
    expect(await lyDoLoi(xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("D", 8)], moRongBai: true }))).toContain("tối đa 3 bài");
    await goKhoiCase(ADMIN, (await mucCua(c, "C", 7)).id);
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6]]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("D", 8)], moRongBai: true });
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[5], BAI[6], BAI[8]]);
    await sach();
  });

  it("[THV-12] đã có bé điểm danh ⇒ KHÔNG dọn bộ bài (bộ bài là bằng chứng của buổi đã dạy); gỡ buổi vẫn được", async () => {
    const c = await tao([needId("B", 6)]);
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("C", 7)], moRongBai: true });
    await xepVaoCaseCoSan(ADMIN, { coQuyenDuyet: true, caseId: c, needIds: [needId("A", 5)], moRongBai: true });
    await diemDanh(c, "B", true, { 6: "COMPLETED" });
    const v = await phienBan(c);
    await goKhoiCase(ADMIN, (await mucCua(c, "C", 7)).id);
    expect((await baiCua(c)).map((x) => x[0])).toEqual([BAI[6], BAI[7], BAI[5]]);
    expect(await phienBan(c)).toBe(v);
    expect((await need("C", 7)).status).toBe("PENDING");
  });
});
