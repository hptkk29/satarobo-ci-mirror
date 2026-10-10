// tests/hoc-bu/case-nhieu-bai.test.ts — T07: case nhiều bài (1–3) + điểm danh HAI TẦNG trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Fixture là kịch bản nghiệm thu của chủ dự án: bé A vắng bài 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cùng cơ sở.
// Luật pure (bảng chuyển mục, chốt case) đã có test riêng ở `lib/hoc-bu/case-nhieu-bai-thuan.test.ts`; ở đây là phần chỉ Postgres mới chứng minh được:
// giao dịch nguyên tử, khoá đua, sổ lượt thật, audit, checker T01 làm oracle.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  LoiTrungLich,
  diemDanhBu,
  ghiBeVaoCase,
  ghiDanhGiaMuc,
  goBeKhoiCase,
  goKhoiCase,
  huyCase,
  suaCase,
  suaDiemDanhBe,
  xepVaoCaseCoSan,
  type KetQuaMucNhapDay,
} from "@/lib/hoc-bu/case-db";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { apDungNangCapTatCa, docKeHoachNangCapTatCa, nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";
import { scopedDb } from "@/lib/db-scope";

import {
  id,
  CS,
  KHOA,
  GV,
  GV2,
  PHONG,
  LOP,
  LOP2,
  BAI,
  BAI_KHAC,
  HV,
  type Bai,
  buoiGoc,
  needId,
  VANG,
  luc,
  NOW,
  ADMIN,
  ngayDb,
  don,
  dung,
  tao,
  tatCa,
  taiKhoan,
  so,
  beCua,
  mucCua,
  need,
  dongAtt,
  lyDoLoi,
  diemDanh,
  kiem,
  sach,
} from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[CNBD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

describe.skipIf(!RUN_DB_TESTS)("[CNBD] case nhiều bài + điểm danh hai tầng — T07", () => {
  beforeEach(() => dung());
  afterAll(don);

  // ── Tạo case 1 / 2 / 3 bài ─────────────────────────────────────────────────────────────
  it("[CNBD-01] case 1 bài, 2 bài, 3 bài: bộ bài đúng thứ tự, bài chính = bài đầu, mỗi bé một participant, mỗi buổi vắng một mục, lượt được giữ", async () => {
    const c1 = await tao([needId("C", 7)]);
    expect((await db.makeupCaseLesson.findMany({ where: { caseId: c1 }, orderBy: { order: "asc" } })).map((l) => l.lessonId)).toEqual([BAI[7]]);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c1 } })).lessonId).toBe(BAI[7]);

    const c2 = await tao([needId("B", 6), needId("B", 7)], { teacherId: GV2, roomId: null });
    expect((await db.makeupCaseLesson.findMany({ where: { caseId: c2 }, orderBy: { order: "asc" } })).map((l) => [l.lessonId, l.order])).toEqual([[BAI[6], 1], [BAI[7], 2]]);

    const c3 = await tao(tatCa("A"), { ymd: "2026-10-16" });
    expect((await db.makeupCaseLesson.findMany({ where: { caseId: c3 }, orderBy: { order: "asc" } })).map((l) => l.lessonId)).toEqual([BAI[5], BAI[6], BAI[7]]);
    const be = await beCua(c3, "A");
    expect(be).toMatchObject({ attendanceStatus: "PENDING", centerId: CS, version: 0 });
    const muc = await db.makeupCaseStudent.findMany({ where: { caseId: c3 }, orderBy: { createdAt: "asc" } });
    expect(muc).toHaveLength(3);
    for (const m of muc) {
      expect(m).toMatchObject({ participantId: be.id, result: "PLANNED", status: "PLACED", dungLuot: true });
      expect(m.originalSessionId).toBe(buoiGoc([5, 6, 7].find((b) => needId("A", b as Bai) === m.makeupNeedId) as Bai));
      expect(m.originalAttendanceId).toBe(`${m.originalSessionId}-A`);
    }
    // Ba lượt của A bị giữ (HOLD ×3), còn 0; dòng cần bù SCHEDULED.
    expect(await so("A")).toEqual({ granted: 3, held: 3, consumed: 0, con: 0 });
    for (const b of VANG.A) expect((await need("A", b)).status).toBe("SCHEDULED");
    await sach();
  });

  it("[CNBD-01c] thứ tự bộ bài = thứ tự dòng được chọn, KHÔNG phụ thuộc thứ tự vật lý của Postgres (bài đầu là bài chính)", async () => {
    // Dòng của A được tạo theo thứ tự 5,6,7 ⇒ thứ tự vật lý ≈ 5,6,7. Chọn NGƯỢC (7,6,5): nếu mã đọc `id IN (…)` không sắp xếp thì ra 5,6,7.
    const caseId = await tao([needId("A", 7), needId("A", 6), needId("A", 5)]);
    expect((await db.makeupCaseLesson.findMany({ where: { caseId }, orderBy: { order: "asc" } })).map((l) => l.lessonId)).toEqual([BAI[7], BAI[6], BAI[5]]);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).lessonId).toBe(BAI[7]);
    await sach();
  });

  it("[CNBD-02] bộ bài quá 3 hoặc bài của khoá khác ⇒ từ chối, KHÔNG ghi gì", async () => {
    const boBon = await lyDoLoi(tao(tatCa("A"), { lessonIds: [BAI[5], BAI[6], BAI[7], BAI[8]] }));
    expect(boBon).toContain("tối đa 3 bài");
    const khacKhoa = await lyDoLoi(tao([needId("A", 5)], { lessonIds: [BAI[5], BAI_KHAC] }));
    expect(khacKhoa).toContain("không thuộc khoá");
    const thieu = await lyDoLoi(tao(tatCa("A"), { lessonIds: [BAI[5], BAI[6]] }));
    expect(thieu).toContain("phải gồm mọi bài");
    expect(await db.makeupCase.count({ where: { centerId: CS } })).toBe(0);
    expect(await db.makeupCaseStudent.count({ where: { centerId: CS } })).toBe(0);
    expect((await need("A", 5)).status).toBe("PENDING");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
  });

  it("[CNBD-03] kịch bản A/B/C/D: A(5,6,7)+B(6,7)+C(7) vào cùng case 5-6-7 hợp lệ; D(8) bị từ chối vì bài 8 ngoài bộ bài — và không để lại gì", async () => {
    const c = await tao([...tatCa("A"), needId("B", 6)]);
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("B", 7), needId("C", 7)] });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(3);
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, result: "PLANNED" } })).toBe(6);
    const d = await lyDoLoi(xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("D", 8)] }));
    expect(d).toContain("không nằm trong bộ bài");
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(3);
    expect((await need("D", 8)).status).toBe("PENDING");
    expect(await so("D")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    await sach();
  });

  // ── Điểm danh hai tầng ────────────────────────────────────────────────────────────────
  it("[CNBD-04] NGHIỆM THU: A vắng 5,6,7 → một case 5+6+7 → có mặt, xong 5 và 6, KHÔNG xong 7 ⇒ 5,6 COMPLETED (tiêu 2 lượt), 7 về PENDING (nhả 1 lượt); buổi gốc 5,6 vẫn vắng nhưng đã bù; 7 vẫn cần bù; rồi 7 xếp case khác và bù xong", async () => {
    const c = await tao(tatCa("A"));
    expect(await so("A")).toEqual({ granted: 3, held: 3, consumed: 0, con: 0 });
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "NOT_COMPLETED" });

    expect(await beCua(c, "A")).toMatchObject({ attendanceStatus: "PRESENT", generalComment: "Con học tốt", processedById: GV, version: 1 });
    expect(await mucCua(c, "A", 5)).toMatchObject({ result: "COMPLETED", status: "PRESENT", teacherEvaluation: "Đánh giá A5", evaluatedById: GV });
    expect(await mucCua(c, "A", 6)).toMatchObject({ result: "COMPLETED", teacherEvaluation: "Đánh giá A6" });
    expect(await mucCua(c, "A", 7)).toMatchObject({ result: "NOT_COMPLETED", status: "ABSENT", teacherEvaluation: "Đánh giá A7" });
    expect((await mucCua(c, "A", 5)).completedAt).not.toBeNull();
    expect((await mucCua(c, "A", 7)).completedAt).toBeNull();

    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 2, con: 1 });
    expect(await need("A", 5)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect(await need("A", 6)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect(await need("A", 7)).toMatchObject({ status: "PENDING", usedQuota: false });
    // Buổi gốc: trạng thái vắng + lý do giữ NGUYÊN; chỉ dấu "đã bù" đổi, và chỉ với bài đã xong.
    expect(await dongAtt("A", 5)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP", absenceReason: "Con ốm" });
    expect(await dongAtt("A", 6)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP" });
    expect(await dongAtt("A", 7)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    // Nhận xét của buổi gốc KHÔNG bị đụng.
    expect(await db.studentSessionFeedback.count({ where: { studentId: HV.A } })).toBe(0);
    expect(await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ status: "COMPLETED" });
    // Sổ lượt: HOLD ×3, CONSUME ×2, RELEASE ×1 — đúng bút toán, không xoá gì.
    const tk = await taiKhoan("A");
    const but = await db.makeupCreditEntry.findMany({ where: { accountId: tk.id }, orderBy: { createdAt: "asc" } });
    expect(but.filter((b) => b.type === "HOLD")).toHaveLength(3);
    expect(but.filter((b) => b.type === "CONSUME")).toHaveLength(2);
    expect(but.filter((b) => b.type === "RELEASE")).toHaveLength(1);
    await sach();

    // Bài 7 còn nợ ⇒ xếp sang case khác, bù xong ⇒ buổi gốc 7 cũng "đã bù", lượt tiêu thêm một.
    const c2 = await tao([needId("A", 7)], { ymd: "2026-10-16" });
    expect(await so("A")).toEqual({ granted: 3, held: 1, consumed: 2, con: 0 });
    await diemDanh(c2, "A", true, { 7: "COMPLETED" }, luc(16, 18, 30));
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 3, con: 0 });
    expect(await need("A", 7)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect(await dongAtt("A", 7)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP" });
    // Lịch sử các lần thử vẫn đủ: mục NOT_COMPLETED ở case đầu còn nguyên.
    expect(await mucCua(c, "A", 7)).toMatchObject({ result: "NOT_COMPLETED" });
    await sach(luc(16, 18, 45)); // đồng hồ của checker = giữa buổi dạy của case thứ hai
  });

  it("[CNBD-05] có mặt mà THIẾU kết quả một bài ⇒ từ chối cả lần điểm danh (không tự suy 'có mặt ⇒ xong'), không đổi gì", async () => {
    const c = await tao(tatCa("A"));
    const loi = await lyDoLoi(diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED" }));
    expect(loi).toContain("không tự suy");
    expect((await beCua(c, "A")).attendanceStatus).toBe("PENDING");
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, result: "PLANNED" } })).toBe(3);
    expect(await so("A")).toEqual({ granted: 3, held: 3, consumed: 0, con: 0 });
    expect((await need("A", 5)).status).toBe("SCHEDULED");
  });

  it("[CNBD-06] bé có mặt, xong HẾT ⇒ cả ba COMPLETED; case COMPLETED", async () => {
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" });
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 3, con: 0 });
    for (const b of VANG.A) expect(await need("A", b)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
    await sach();
  });

  it("[CNBD-07] bé VẮNG buổi bù ⇒ mọi mục RELEASED (status ABSENT), nhả đủ lượt, dòng về PENDING, không tiêu; mọi bé vắng ⇒ case NO_SHOW (không phải CANCELLED)", async () => {
    const c = await tao([...tatCa("A"), needId("B", 6)]);
    await diemDanh(c, "A", false);
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    for (const b of VANG.A) {
      expect(await mucCua(c, "A", b)).toMatchObject({ result: "RELEASED", status: "ABSENT" });
      expect(await need("A", b)).toMatchObject({ status: "PENDING", usedQuota: false });
      expect((await dongAtt("A", b)).makeupStatus).toBe("NEEDS_MAKEUP");
    }
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED"); // B còn chờ
    await diemDanh(c, "B", false);
    const cs = await db.makeupCase.findUniqueOrThrow({ where: { id: c } });
    expect(cs.status).toBe("NO_SHOW");
    expect(cs.completedAt).not.toBeNull();
    await sach();
  });

  it("[CNBD-08] hỗn hợp: A có mặt (xong 5, chưa xong 6,7) · B vắng · C có mặt xong ⇒ COMPLETED; sổ từng bé đúng", async () => {
    const c = await tao([...tatCa("A"), ...tatCa("B"), needId("C", 7)]);
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "NOT_COMPLETED", 7: "NOT_COMPLETED" });
    await diemDanh(c, "B", false);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED");
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
    expect(await so("B")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
    await sach();
  });

  it("[CNBD-09] mục trả phí / miễn phí ngoại lệ KHÔNG đụng sổ lượt khi xếp, khi xong, khi nhả — dù bé còn lượt", async () => {
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { freeApprovedAt: new Date("2026-10-02T00:00:00.000Z"), freeApprovedById: GV, freeReason: "Quản lý duyệt miễn phí" } });
    const c = await tao([needId("B", 6), needId("B", 7)]);
    const m6 = await mucCua(c, "B", 6);
    const m7 = await mucCua(c, "B", 7);
    expect([m6.dungLuot, m7.dungLuot]).toEqual([false, true]);
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 }); // chỉ B7 giữ lượt
    await diemDanh(c, "B", true, { 6: "COMPLETED", 7: "NOT_COMPLETED" });
    expect(await so("B")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 }); // B6 xong KHÔNG tiêu lượt; B7 chưa xong nhả
    expect(await need("B", 6)).toMatchObject({ status: "COMPLETED", usedQuota: false });
    const tk = await taiKhoan("B");
    expect((await db.makeupCreditEntry.findMany({ where: { accountId: tk.id, caseStudentId: m6.id } }))).toHaveLength(0);
  });

  // ── Sửa điểm danh (đảo) ───────────────────────────────────────────────────────────────
  it("[CNBD-10] SỬA điểm danh có mặt→vắng: mục xong được đảo — dòng COMPLETED→PENDING, lượt TRẢ LẠI bằng ADJUSTMENT (bút toán cũ còn), buổi gốc về NEEDS_MAKEUP, mục RELEASED, case chốt lại NO_SHOW, có audit", async () => {
    const c = await tao([...tatCa("A")]);
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "NOT_COMPLETED", 7: "NOT_COMPLETED" });
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
    const be = await beCua(c, "A");
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");

    // Lý do ngắn / phiên bản cũ bị từ chối.
    const sua = (o: { lyDo?: string; phienBan?: number } = {}) =>
      suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, phienBan: o.phienBan ?? be.version, lyDo: o.lyDo ?? "Giáo viên bấm nhầm, bé thực ra vắng", now: NOW, ten: "QL" });
    expect(await lyDoLoi(sua({ lyDo: "nhầm" }))).toContain("ít nhất 10 ký tự");
    expect(await lyDoLoi(sua({ phienBan: 99 }))).toContain("vừa được người khác sửa");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 }); // chưa đổi gì

    await sua();
    expect(await beCua(c, "A")).toMatchObject({ attendanceStatus: "ABSENT", version: 2 });
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await need("A", 5)).toMatchObject({ status: "PENDING", usedQuota: false, completedAt: null });
    expect(await dongAtt("A", 5)).toMatchObject({ status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" });
    for (const b of VANG.A) expect(await mucCua(c, "A", b)).toMatchObject({ result: "RELEASED", status: "ABSENT" });
    // Lịch sử đánh giá của mục đã xong KHÔNG bị xoá, nhưng mục không còn là "đã xong".
    expect((await mucCua(c, "A", 5)).teacherEvaluation).toBe("Đánh giá A5");
    expect((await mucCua(c, "A", 5)).completedAt).toBeNull();
    // Sổ chỉ-thêm: CONSUME cũ còn, thêm đúng MỘT ADJUSTMENT consumed −1 mang lý do.
    const tk = await taiKhoan("A");
    const but = await db.makeupCreditEntry.findMany({ where: { accountId: tk.id }, orderBy: { createdAt: "asc" } });
    expect(but.filter((b) => b.type === "CONSUME")).toHaveLength(1);
    const dao = but.filter((b) => b.type === "ADJUSTMENT");
    expect(dao).toHaveLength(1);
    expect(dao[0]).toMatchObject({ consumedDelta: -1, grantedDelta: 0, heldDelta: 0 });
    expect(dao[0]!.reason).toContain("bấm nhầm");
    // Case: mọi bé vắng ⇒ NO_SHOW (trước đó COMPLETED).
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("NO_SHOW");
    // Audit bắt buộc, cùng giao dịch: có giá trị cũ, mới và lý do.
    const au = await db.auditLog.findMany({ where: { entityId: be.id, action: "hoc-bu.sua-diem-danh-be" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.reason).toContain("bấm nhầm");
    expect(JSON.stringify(au[0]!.oldValues)).toContain("COMPLETED");
    await sach();
  });

  it("[CNBD-11] SỬA vắng→có mặt: bé bị đánh vắng nhầm được khôi phục — mục mới được dựng, lượt giữ lại rồi tiêu theo kết quả nhập; sửa 'chưa xong'→'xong' tiêu lại lượt", async () => {
    const c = await tao(tatCa("A"));
    await diemDanh(c, "A", false);
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    const be = await beCua(c, "A");
    const cu = await db.makeupCaseStudent.findMany({ where: { participantId: be.id } });
    expect(cu).toHaveLength(3);
    // Kết quả nhập khai theo id mục CŨ (đã nhả); hệ thống dựng mục mới và áp lên mục mới.
    const kq: KetQuaMucNhapDay = {};
    for (const m of cu) kq[m.id] = { ketQua: m.makeupNeedId === needId("A", 7) ? "NOT_COMPLETED" : "COMPLETED", danhGia: null };
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: true, ketQuaMuc: kq, nhanXetChung: null, phienBan: be.version, lyDo: "Bé có tới, giáo viên chọn nhầm", now: NOW, ten: "QL" });
    expect(await beCua(c, "A")).toMatchObject({ attendanceStatus: "PRESENT" });
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 2, con: 1 });
    expect(await need("A", 5)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    expect(await need("A", 7)).toMatchObject({ status: "PENDING" });
    expect(await db.makeupCaseStudent.count({ where: { participantId: be.id } })).toBe(6); // 3 mục cũ RELEASED + 3 mục mới
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");

    // Sửa tiếp: bài 7 thực ra đã xong ⇒ tiêu lại một lượt (cần còn lượt).
    const be2 = await beCua(c, "A");
    const song = await db.makeupCaseStudent.findMany({ where: { participantId: be.id, result: { not: "RELEASED" } } });
    const kq2: KetQuaMucNhapDay = {};
    for (const m of song) kq2[m.id] = { ketQua: "COMPLETED", danhGia: null };
    await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: true, ketQuaMuc: kq2, nhanXetChung: null, phienBan: be2.version, lyDo: "Bài 7 con đã làm xong", now: NOW, ten: "QL" });
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 3, con: 0 });
    expect(await need("A", 7)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    await sach();
  });

  it("[CNBD-12] sửa điểm danh theo CỬA SỔ GIỜ: giáo viên đến hết 23:59 ngày dạy; quản lý 3 ngày; quá thì cần ghi đè kèm lý do (audit ghi đè)", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    const be = await beCua(c, "C");
    const base = { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, lyDo: "Bé thực ra vắng buổi bù", ten: "QL" };
    // Giáo viên sau 23:59 ngày dạy ⇒ từ chối.
    expect(await lyDoLoi(suaDiemDanhBe(null, { ...base, phienBan: be.version, chiGiaoVien: GV, now: luc(16, 0, 5) }))).toContain("quá hạn");
    // Quản lý quá 3 ngày (hết 18/10) ⇒ đòi ghi đè.
    expect(await lyDoLoi(suaDiemDanhBe(ADMIN, { ...base, phienBan: be.version, now: luc(19, 9, 0) }))).toContain("ghi đè");
    expect((await beCua(c, "C")).attendanceStatus).toBe("PRESENT");
    // Có ghi đè + lý do ⇒ qua, audit ghi lý do ghi đè.
    await suaDiemDanhBe(ADMIN, { ...base, phienBan: be.version, now: luc(19, 9, 0), ghiDe: { lyDo: "Quản lý cơ sở xác nhận muộn", ten: "QL" } });
    expect((await beCua(c, "C")).attendanceStatus).toBe("ABSENT");
    const au = await db.auditLog.findMany({ where: { entityId: be.id, action: "hoc-bu.sua-diem-danh-be" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.reason).toContain("ghi đè quá hạn");
  });

  // ── Gỡ bé, huỷ case, case tự đóng ─────────────────────────────────────────────────────
  it("[CNBD-13] gỡ MỘT mục: mục RELEASED (giữ làm lịch sử), lượt nhả, dòng về PENDING; bé còn mục khác thì còn trong case; gỡ hết mục ⇒ bé REMOVED", async () => {
    const c = await tao([...tatCa("A"), needId("B", 6)]);
    const m5 = await mucCua(c, "A", 5);
    await goKhoiCase(ADMIN, m5.id);
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: m5.id } })).toMatchObject({ result: "RELEASED", status: "RELEASED" });
    expect(await so("A")).toEqual({ granted: 3, held: 2, consumed: 0, con: 1 });
    expect((await need("A", 5)).status).toBe("PENDING");
    expect((await beCua(c, "A")).attendanceStatus).toBe("PENDING");
    // Checker T01 không coi mục đã gỡ là "bé trong case".
    await sach();
    // Gỡ mục đã gỡ rồi ⇒ từ chối.
    expect(await lyDoLoi(goKhoiCase(ADMIN, m5.id))).toContain("không gỡ được");
    // Gỡ nốt hai mục còn lại ⇒ bé REMOVED.
    await goKhoiCase(ADMIN, (await mucCua(c, "A", 6)).id);
    await goKhoiCase(ADMIN, (await mucCua(c, "A", 7)).id);
    expect((await beCua(c, "A")).attendanceStatus).toBe("REMOVED");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED"); // B còn
    // Xếp lại ĐÚNG bé đã gỡ vào CHÍNH case đó ⇒ bé sống lại (PENDING), mục MỚI, lượt giữ lại.
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("A", 5)] });
    expect((await beCua(c, "A")).attendanceStatus).toBe("PENDING");
    expect(await so("A")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, makeupNeedId: needId("A", 5) } })).toBe(2);
    await sach();
  });

  it("[CNBD-14] gỡ bé CUỐI CÙNG khỏi case ⇒ case đóng NGAY (CANCELLED) — không còn case 'sắp dạy' mà không ai học (HB-07/HB-15)", async () => {
    const c = await tao([needId("C", 7)]);
    await goBeKhoiCase(ADMIN, (await beCua(c, "C")).id);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("CANCELLED");
    expect((await beCua(c, "C")).attendanceStatus).toBe("REMOVED");
    expect(await mucCua(c, "C", 7)).toMatchObject({ result: "RELEASED", status: "RELEASED" });
    expect((await need("C", 7)).status).toBe("PENDING");
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    await sach();
    // Case đã huỷ không nhận thêm bé.
    expect(await lyDoLoi(xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("C", 7)] }))).toContain("đã điểm danh hoặc đã huỷ");
  });

  it("[CNBD-15] gỡ bé chờ cuối cùng khi các bé còn lại đều VẮNG ⇒ case NO_SHOW (giáo viên vẫn dạy); khi có bé có mặt ⇒ COMPLETED", async () => {
    const c = await tao([needId("B", 6), needId("C", 7)]);
    await diemDanh(c, "B", false);
    await goBeKhoiCase(ADMIN, (await beCua(c, "C")).id);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("NO_SHOW");
  });

  it("[CNBD-16] huỷ case chưa điểm danh: mọi mục RELEASED, bé REMOVED, lượt nhả, dòng về PENDING, case CANCELLED; đã có bé điểm danh thì không huỷ được", async () => {
    const c = await tao([...tatCa("A"), needId("C", 7)]);
    await huyCase(ADMIN, c);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("CANCELLED");
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, result: "PLANNED" } })).toBe(0);
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, result: "RELEASED", status: "RELEASED" } })).toBe(4);
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, attendanceStatus: "REMOVED" } })).toBe(2);
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    for (const b of VANG.A) expect((await need("A", b)).status).toBe("PENDING");
    await sach();
    const c2 = await tao([needId("B", 6), needId("C", 7)]);
    await diemDanh(c2, "B", false);
    expect(await lyDoLoi(huyCase(ADMIN, c2))).toContain("không huỷ được");
  });

  // ── Sửa case ──────────────────────────────────────────────────────────────────────────
  it("[CNBD-17] sửa case: đổi giờ / phòng / ghi chú + mở rộng bộ bài; phiên bản tăng; có audit. Bộ bài mới cho phép D(8) vào", async () => {
    const c = await tao([needId("C", 7), needId("B", 6)]);
    const truoc = await db.makeupCase.findUniqueOrThrow({ where: { id: c } });
    await suaCase(ADMIN, { caseId: c, phienBan: truoc.version, startTime: "18:30", endTime: "20:00", note: "Dời nửa tiếng", lessonIds: [BAI[6], BAI[7], BAI[8]], ten: "QL", now: NOW });
    const sau = await db.makeupCase.findUniqueOrThrow({ where: { id: c } });
    expect(sau).toMatchObject({ startTime: "18:30", endTime: "20:00", note: "Dời nửa tiếng", version: truoc.version + 1, lessonId: BAI[6] });
    expect((await db.makeupCaseLesson.findMany({ where: { caseId: c }, orderBy: { order: "asc" } })).map((l) => l.lessonId)).toEqual([BAI[6], BAI[7], BAI[8]]);
    expect(await db.auditLog.count({ where: { entityId: c, action: "hoc-bu.sua-case" } })).toBe(1);
    await xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [needId("D", 8)] });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c } })).toBe(3);
    await sach();
  });

  it("[CNBD-18] sửa case: phiên bản cũ ⇒ từ chối; bỏ bài còn bé chờ học ⇒ từ chối; case đã có bé điểm danh ⇒ không sửa; quá khứ ⇒ từ chối", async () => {
    const c = await tao([...tatCa("A"), needId("B", 6)]);
    const v = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    expect(await lyDoLoi(suaCase(ADMIN, { caseId: c, phienBan: v + 5, note: "x", ten: "QL", now: NOW }))).toContain("vừa được người khác sửa");
    expect(await lyDoLoi(suaCase(ADMIN, { caseId: c, phienBan: v, lessonIds: [BAI[5], BAI[6]], ten: "QL", now: NOW }))).toContain("bỏ được bài");
    expect(await lyDoLoi(suaCase(ADMIN, { caseId: c, phienBan: v, ymd: "2026-10-10", ten: "QL", now: NOW }))).toContain("quá khứ");
    expect((await db.makeupCaseLesson.count({ where: { caseId: c } }))).toBe(3);
    await diemDanh(c, "B", false);
    expect(await lyDoLoi(suaCase(ADMIN, { caseId: c, phienBan: v, note: "y", ten: "QL", now: NOW }))).toContain("đã có bé được điểm danh");
  });

  it("[CNBD-19] sửa case chạy lại kiểm TRÙNG LỊCH (T09), loại chính case này: dời sang giờ GV đang có lớp khác ⇒ LoiTrungLich và KHÔNG đổi gì; giữ nguyên khung thì không tự trùng với mình", async () => {
    // GV có lớp LOP2 19:00–20:30 ngày 16/10.
    await db.classSession.create({ data: { id: id("lop2-16"), classId: LOP2, date: new Date("2026-10-16T12:00:00.000Z"), lessonId: BAI[5], status: "SCHEDULED", centerId: CS } });
    const c = await tao([needId("C", 7)]);
    const v = (await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).version;
    let loi: unknown;
    try {
      await suaCase(ADMIN, { caseId: c, phienBan: v, ymd: "2026-10-16", ten: "QL", now: NOW });
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(LoiTrungLich);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } }))).toMatchObject({ version: v, date: ngayDb(15) });
    // Đổi GV sang người rảnh thì được; đổi note với khung cũ không tự trùng.
    await suaCase(ADMIN, { caseId: c, phienBan: v, teacherId: GV2, ymd: "2026-10-16", ten: "QL", now: NOW });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } }))).toMatchObject({ teacherId: GV2, version: v + 1 });
  });

  // ── Chống đua, nguyên tử ──────────────────────────────────────────────────────────────
  it("[CNBD-20] HAI lượt đồng thời xếp CÙNG một dòng vào hai case ⇒ đúng MỘT thắng; không mục thừa, lượt giữ đúng một", async () => {
    const c1 = await tao([needId("C", 7)]);
    // Dòng của B7 bị hai người xếp cùng lúc vào c1 (nhận thêm) và c2 (giáo viên khác, không phòng ⇒ hai case cùng giờ mà không chồng nhau).
    const c2 = await tao([needId("A", 7)], { teacherId: GV2, roomId: null });
    const kq = await Promise.allSettled([
      xepVaoCaseCoSan(ADMIN, { caseId: c1, needIds: [needId("B", 7)] }),
      xepVaoCaseCoSan(ADMIN, { caseId: c2, needIds: [needId("B", 7)] }),
    ]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(await db.makeupCaseStudent.count({ where: { makeupNeedId: needId("B", 7), result: "PLANNED" } })).toBe(1);
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect((await need("B", 7)).status).toBe("SCHEDULED");
  });

  it("[CNBD-21] NGUYÊN TỬ theo lô: sổ cạn giữa chừng (đua) khi xếp 3 dòng của một bé ⇒ ném HET_LUOT và KHÔNG còn gì (dòng PENDING, không mục, không bé, không HOLD)", async () => {
    const c = await tao([needId("C", 7)]);
    const caseRow = await db.makeupCase.findUniqueOrThrow({ where: { id: c } });
    const dong = await docDongTheoId(scopedDb(ADMIN), tatCa("A"), null);
    expect(dong).toHaveLength(3);
    await db.makeupCaseLesson.createMany({ data: [{ caseId: c, lessonId: BAI[5], order: 2 }, { caseId: c, lessonId: BAI[6], order: 3 }], skipDuplicates: true });
    // Màn hình thấy 3 lượt; trước khi ghi, người khác tiêu mất 2 lượt.
    await db.makeupCreditAccount.update({ where: { studentId_courseId: { studentId: HV.A, courseId: KHOA } }, data: { granted: 1 } });
    const loi = await lyDoLoi(db.$transaction((tx) => ghiBeVaoCase(tx, caseRow, CS, dong, GV)));
    expect(loi).toContain("hết lượt");
    for (const b of VANG.A) expect((await need("A", b)).status).toBe("PENDING");
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, studentId: HV.A } })).toBe(0);
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, makeupNeed: { studentId: HV.A } } })).toBe(0);
    const tk = await taiKhoan("A");
    expect(await db.makeupCreditEntry.count({ where: { accountId: tk.id, type: "HOLD" } })).toBe(0);
    expect(await so("A")).toEqual({ granted: 1, held: 0, consumed: 0, con: 1 });
  });

  it("[CNBD-22] hai giáo viên điểm danh ĐỒNG THỜI hai bé khác nhau của một case ⇒ case chốt đúng MỘT lần, không kẹt SCHEDULED (khoá hàng case)", async () => {
    const c = await tao([needId("B", 6), needId("C", 7)]);
    const kq = await Promise.allSettled([diemDanh(c, "B", true, { 6: "COMPLETED" }), diemDanh(c, "C", false)]);
    expect(kq.map((k) => k.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("COMPLETED");
    await sach();
  });

  // ── Đánh giá, tương thích cũ ──────────────────────────────────────────────────────────
  it("[CNBD-23] đánh giá bài của bé lưu ở MỤC, không đụng phiếu của buổi gốc; chỉ giáo viên của case; chỉ bé đã có mặt", async () => {
    const c = await tao([needId("C", 7)]);
    const m = await mucCua(c, "C", 7);
    expect(await lyDoLoi(ghiDanhGiaMuc(ADMIN, { caseStudentId: m.id, danhGia: "x", ten: "QL" }))).toContain("điểm danh trước");
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    await ghiDanhGiaMuc(null, { caseStudentId: m.id, danhGia: "  Con làm rất tốt  ", chiGiaoVien: GV, ten: "GV", now: NOW });
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ teacherEvaluation: "Con làm rất tốt", evaluatedById: GV });
    expect(await db.studentSessionFeedback.count({ where: { studentId: HV.C } })).toBe(0);
    expect(await lyDoLoi(ghiDanhGiaMuc(null, { caseStudentId: m.id, danhGia: "ok", chiGiaoVien: GV2, ten: "GV2" }))).toContain("không phải giáo viên");
    expect(await lyDoLoi(ghiDanhGiaMuc(ADMIN, { caseStudentId: m.id, danhGia: "   ", ten: "QL" }))).toContain("Chưa nhập");
    expect(await db.auditLog.count({ where: { entityId: m.id, action: "hoc-bu.danh-gia-muc" } })).toBe(1); // chỉ lần ghi thành công
  });

  it("[CNBD-24] vỏ cũ `diemDanhBu(caseStudentId)`: bé một bài ⇒ có mặt = bài xong; bé nhiều bài ⇒ từ chối, bắt điểm danh theo bé", async () => {
    const c = await tao([...tatCa("A"), needId("C", 7)]);
    const mA = await mucCua(c, "A", 5);
    const mC = await mucCua(c, "C", 7);
    expect(await lyDoLoi(diemDanhBu(null, { caseStudentId: mA.id, coMat: true, chiGiaoVien: GV, now: NOW }))).toContain("nhiều bài");
    await diemDanhBu(null, { caseStudentId: mC.id, coMat: true, chiGiaoVien: GV, now: NOW });
    expect(await mucCua(c, "C", 7)).toMatchObject({ result: "COMPLETED", status: "PRESENT" });
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
  });

  // ── Nâng cấp case đời cũ ──────────────────────────────────────────────────────────────
  it("[CNBD-25] NÂNG case đời cũ: có bộ bài, bé tham gia, mục nối bé và `result` đúng; chạy lại không ghi gì; mục lệch bài được BÁO chứ không tự thêm bài", async () => {
    const CASE_CU = id("case-cu");
    await db.makeupCase.create({
      data: { id: CASE_CU, centerId: CS, courseId: KHOA, lessonId: BAI[6], date: ngayDb(15), startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, status: "SCHEDULED", createdById: GV },
    });
    await db.makeupNeed.updateMany({ where: { id: { in: [needId("B", 6), needId("B", 7), needId("C", 7)] } }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.createMany({
      data: [
        { id: id("sv-b6"), caseId: CASE_CU, makeupNeedId: needId("B", 6), status: "PLACED", dungLuot: true, centerId: CS, addedById: GV },
        { id: id("sv-b7"), caseId: CASE_CU, makeupNeedId: needId("B", 7), status: "PRESENT", dungLuot: true, centerId: CS, addedById: GV }, // bài 7 ngoài bộ bài {6}
        { id: id("sv-c7"), caseId: CASE_CU, makeupNeedId: needId("C", 7), status: "ABSENT", dungLuot: true, centerId: CS, addedById: GV },
      ],
    });
    const lan1 = await db.$transaction((tx) => nangCapCase(tx, CASE_CU));
    expect(lan1).toMatchObject({ daNangCap: true, lessonTao: 1, beTao: 2, mucNoi: 3 });
    // Bài 7 của B7 và C7 nằm NGOÀI bộ bài {6} của case ⇒ hai mục được BÁO (không tự thêm bài 7 vào bộ bài).
    expect(lan1.batThuong.map((x) => [x.loai, x.id]).sort()).toEqual([["LECH_BAI", id("sv-b7")], ["LECH_BAI", id("sv-c7")]]);
    expect((await db.makeupCaseLesson.findMany({ where: { caseId: CASE_CU } })).map((l) => l.lessonId)).toEqual([BAI[6]]);
    const b = await db.makeupCaseParticipant.findUniqueOrThrow({ where: { caseId_studentId: { caseId: CASE_CU, studentId: HV.B } } });
    expect(b.attendanceStatus).toBe("PENDING"); // còn mục PLACED
    const cB = await db.makeupCaseParticipant.findUniqueOrThrow({ where: { caseId_studentId: { caseId: CASE_CU, studentId: HV.C } } });
    expect(cB).toMatchObject({ attendanceStatus: "ABSENT", attendedAt: null, processedById: null }); // KHÔNG bịa ai điểm danh lúc nào
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: id("sv-b6") } })).toMatchObject({ result: "PLANNED", participantId: b.id, lessonId: BAI[6], originalSessionId: buoiGoc(6) });
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: id("sv-b7") } })).toMatchObject({ result: "COMPLETED", lessonId: BAI[7] });
    expect(await db.makeupCaseStudent.findUniqueOrThrow({ where: { id: id("sv-c7") } })).toMatchObject({ result: "RELEASED", status: "ABSENT" });
    const lan2 = await db.$transaction((tx) => nangCapCase(tx, CASE_CU));
    expect(lan2).toMatchObject({ daNangCap: false, lessonTao: 0, beTao: 0, mucNoi: 0 });
    expect(lan2.batThuong).toEqual([]);
    // Checker báo mục lệch bài (TV-14) vì dữ liệu CÓ lệch — nâng cấp không che nó.
    expect((await kiem()).some((f) => f.luat === "TV-14")).toBe(true);
  });

  it("[CNBD-27] SCRIPT backfill: dry-run (transaction READ ONLY) báo đúng thứ sẽ ghi và KHÔNG ghi; `--expect` lệch ⇒ ném, chưa ghi gì; áp dụng rồi chạy lại ⇒ không còn việc", async () => {
    const CASE_CU = id("case-cu2");
    await db.makeupCase.create({
      data: { id: CASE_CU, centerId: CS, courseId: KHOA, lessonId: BAI[7], date: ngayDb(15), startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, status: "SCHEDULED", createdById: GV },
    });
    await db.makeupNeed.updateMany({ where: { id: { in: [needId("B", 7), needId("C", 7)] } }, data: { status: "SCHEDULED" } });
    await db.makeupCaseStudent.createMany({
      data: [
        { id: id("sv2-b7"), caseId: CASE_CU, makeupNeedId: needId("B", 7), status: "PLACED", dungLuot: false, centerId: CS, addedById: GV },
        { id: id("sv2-c7"), caseId: CASE_CU, makeupNeedId: needId("C", 7), status: "PLACED", dungLuot: false, centerId: CS, addedById: GV },
      ],
    });
    const doc = () =>
      db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return docKeHoachNangCapTatCa(tx);
        },
        { timeout: 60_000 },
      );
    const truoc = (await doc()).filter((d) => d.caseId === CASE_CU);
    expect(truoc).toHaveLength(1);
    expect(truoc[0]!.kh).toMatchObject({ taoBoBai: true });
    expect(truoc[0]!.kh.beMoi.map((b) => b.studentId).sort()).toEqual([HV.B, HV.C].sort());
    expect(truoc[0]!.kh.mucNoi).toHaveLength(2);
    // Dry-run không ghi gì.
    expect(await db.makeupCaseLesson.count({ where: { caseId: CASE_CU } })).toBe(0);
    expect(await db.makeupCaseParticipant.count({ where: { caseId: CASE_CU } })).toBe(0);
    // `--expect` lệch ⇒ dừng, chưa ghi gì.
    const tong = (await doc()).length;
    await expect(db.$transaction((tx) => apDungNangCapTatCa(tx, { expect: tong + 1 }))).rejects.toThrow("không phải");
    expect(await db.makeupCaseLesson.count({ where: { caseId: CASE_CU } })).toBe(0);
    // Áp dụng đúng số ⇒ nâng; kết quả đúng như kế hoạch dry-run.
    const kq = await db.$transaction((tx) => apDungNangCapTatCa(tx, { expect: tong }));
    const cua = kq.daNangCap.find((d) => d.caseId === CASE_CU)!;
    expect(cua.ket).toMatchObject({ lessonTao: 1, beTao: 2, mucNoi: 2 });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: CASE_CU } })).toBe(2);
    expect((await doc()).filter((d) => d.caseId === CASE_CU)).toEqual([]);
  });

  /** Thêm cho bé A một buổi vắng thứ hai CÙNG bài 5 (hai lớp / hai buổi) — để thử trần 3 mục của một bé trong một case. */
  async function themBuoiVangThuHai() {
    const S = id("s5b");
    await db.classSession.create({ data: { id: S, classId: LOP, date: new Date("2026-09-25T11:00:00.000Z"), lessonId: BAI[5], status: "COMPLETED", centerId: CS } });
    await db.attendance.create({ data: { id: `${S}-A`, sessionId: S, studentId: HV.A, status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", centerId: CS } });
    await db.makeupNeed.create({
      data: {
        id: id("need-A-5b"), studentId: HV.A, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", originalAttendanceId: `${S}-A`,
        missedSessionId: S, missedLessonId: BAI[5], status: "PENDING", createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    return id("need-A-5b");
  }

  it("[CNBD-28] một bé tối đa 3 mục trong một case: mục thứ tư (cùng bài vắng hai buổi) bị từ chối và KHÔNG ghi gì; bé đã điểm danh trong case thì không nhận thêm mục", async () => {
    await dung({ A: 5, B: 3, C: 3, D: 3 });
    const them = await themBuoiVangThuHai();
    const c = await tao([...tatCa("A"), needId("C", 7)]);
    const loi = await lyDoLoi(xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [them] }));
    expect(loi).toContain("tối đa 3 bài");
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: them } })).status).toBe("PENDING");
    expect(await db.makeupCaseStudent.count({ where: { caseId: c, makeupNeed: { studentId: HV.A } } })).toBe(3);
    expect(await so("A")).toEqual({ granted: 5, held: 3, consumed: 0, con: 2 });
    // A điểm danh xong (C còn chờ ⇒ case vẫn SCHEDULED) ⇒ không thêm mục cho A nữa.
    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "COMPLETED", 7: "COMPLETED" });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: c } })).status).toBe("SCHEDULED");
    expect(await lyDoLoi(xepVaoCaseCoSan(ADMIN, { caseId: c, needIds: [them] }))).toContain("đã được điểm danh trong case này");
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: them } })).status).toBe("PENDING");
  });

  it("[CNBD-29] sửa điểm danh NHIỀU LẦN trên cùng một mục: xong → chưa xong → xong lại — mỗi lần là MỘT bút toán riêng (khoá theo lần sửa), lượt cuối cùng đã tiêu đúng một", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
    const m = await mucCua(c, "C", 7);
    const sua = async (kq: "COMPLETED" | "NOT_COMPLETED") => {
      const be = await beCua(c, "C");
      await suaDiemDanhBe(ADMIN, { participantId: be.id, coMat: true, ketQuaMuc: { [m.id]: { ketQua: kq, danhGia: null } }, nhanXetChung: null, phienBan: be.version, lyDo: "Chỉnh lại kết quả bài 7", now: NOW, ten: "QL" });
    };
    await sua("NOT_COMPLETED");
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await need("C", 7)).toMatchObject({ status: "PENDING", usedQuota: false });
    await sua("COMPLETED");
    expect(await so("C")).toEqual({ granted: 3, held: 0, consumed: 1, con: 2 });
    expect(await need("C", 7)).toMatchObject({ status: "COMPLETED", usedQuota: true });
    const tk = await taiKhoan("C");
    const but = await db.makeupCreditEntry.findMany({ where: { accountId: tk.id, caseStudentId: m.id } });
    expect(but.map((b) => b.type).sort()).toEqual(["ADJUSTMENT", "CONSUME", "CONSUME", "HOLD"]);
    expect(new Set(but.map((b) => b.idemKey)).size).toBe(4);
    await sach();
  });

  it("[CNBD-30] `ghiBeVaoCase` tự kiểm bài ∈ bộ bài (chốt cuối — không dựa vào lần kiểm của người gọi): bài ngoài bộ ⇒ ném, KHÔNG đổi dòng, không mục, không giữ lượt", async () => {
    const c = await tao([needId("C", 7)]);
    const caseRow = await db.makeupCase.findUniqueOrThrow({ where: { id: c } });
    const dong = await docDongTheoId(scopedDb(ADMIN), [needId("D", 8)], null);
    expect(dong).toHaveLength(1);
    const loi = await lyDoLoi(db.$transaction((tx) => ghiBeVaoCase(tx, caseRow, CS, dong, GV)));
    expect(loi).toContain("không nằm trong bộ bài");
    expect((await need("D", 8)).status).toBe("PENDING");
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, studentId: HV.D } })).toBe(0);
    expect(await so("D")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
  });

  it("[CNBD-26] checker nhận ra case CHƯA nâng cấp (TV-40) và nhận ra khi hai tầng lệch nhau (TV-41) hoặc trạng thái case sai (TV-43)", async () => {
    const c = await tao([needId("C", 7)]);
    await sach();
    // Cấy lỗi 1: bé PENDING mà mục đã COMPLETED (hai tầng lệch).
    await db.makeupCaseStudent.updateMany({ where: { caseId: c }, data: { result: "COMPLETED" } });
    expect((await kiem()).map((f) => f.luat)).toContain("TV-41");
    await db.makeupCaseStudent.updateMany({ where: { caseId: c }, data: { result: "PLANNED" } });
    await sach();
    // Cấy lỗi 2: case COMPLETED nhưng bé còn chờ.
    await db.makeupCase.update({ where: { id: c }, data: { status: "COMPLETED" } });
    expect((await kiem()).map((f) => f.luat)).toContain("TV-43");
    await db.makeupCase.update({ where: { id: c }, data: { status: "SCHEDULED" } });
    // Cấy lỗi 3: mục chưa nối bé (đời cũ).
    await db.makeupCaseStudent.updateMany({ where: { caseId: c }, data: { participantId: null } });
    expect((await kiem()).map((f) => f.luat)).toContain("TV-40");
  });
});
