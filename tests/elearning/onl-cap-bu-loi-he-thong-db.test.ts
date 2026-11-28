// @vitest-environment node
/**
 * [ONL-EX01-*] Owner EX-01 — cấp bù lượt thi CHỈ khi lỗi hệ thống được xác minh hoặc có quyết định của quản trị có quyền; KHÔNG tự cấp khi học sinh tự thoát / hết giờ hợp lệ.
 * Owner EX-02 — không xoá bài, không chấm trượt, giữ câu trả lời/trạng thái; KHÔNG sửa kết quả lượt đã hoàn tất.
 * Postgres thật. Mỗi ca âm có đối chứng dương.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { capBuLoiHeThong, docLuotConLai } from "../../lib/elearning-online/gian-doan-db";
import { doiSoatLuotQuaHan, luuNhap } from "../../lib/elearning-online/luot-nhap-db";
import { thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { T0, donP0, dungKhoaP0, khoaYeuCau, sau, type KhoaP0 } from "./_onl-p0-fixture";

const batDau = async (k: KhoaP0, now: Date) => {
  const r = await batDauLamBai(db, k.args(now));
  if (!r.ok) throw new Error(r.thongBao);
  return r.luot;
};
const nopSai = (k: KhoaP0, att: string, now: Date) => nopBai(db, { ...k.args(now), attemptId: att, traLoi: { [k.q.chonMot!]: "b" } });
const LY = "Mất kết nối máy chủ đúng giờ thi, đã đối chiếu nhật ký";
const BC = "SU-CO-2211-01";
const cap = (att: string, over: Partial<{ lyDo: string; bangChung: string; actor: string }> = {}, now = sau(500)) =>
  capBuLoiHeThong(db, { attemptId: att, actorUserId: over.actor ?? "admin-1", lyDo: over.lyDo ?? LY, bangChung: over.bangChung ?? BC, now });

describe.skipIf(!RUN_DB_TESTS)("[ONL-EX01] cấp bù do lỗi hệ thống đã xác minh (Postgres thật)", () => {
  beforeAll(donP0, 120_000);
  beforeEach(donP0, 120_000);
  afterAll(donP0, 120_000);

  it("[ONL-EX01-01] 🔴 KHÔNG tự cấp bù: học sinh tự thoát (lượt bỏ dở, hết giờ) và lượt nộp bình thường đều KHÔNG sinh quyền bù — đối chứng: Admin cấp rõ ràng thì có", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: 2 });
    const l1 = await batDau(k, T0);
    // học sinh tự thoát: không nộp gì, hết giờ ⇒ máy chủ tự chốt (EXPIRED/GRADED tuỳ có nháp)
    await doiSoatLuotQuaHan(db, { now: sau(600) });
    expect(await db.onlAttemptCompensation.count({ where: { entitlementId: k.entitlementId } }), "tự thoát/hết giờ hợp lệ ⇒ KHÔNG bù").toBe(0);
    expect(await db.onlAttemptInterruption.count({ where: { entitlementId: k.entitlementId } })).toBe(0);
    expect((await docLuotConLai(db, { entitlementId: k.entitlementId, assessmentId: (await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId }, select: { assessmentId: true } })).assessmentId })).luotThayTheDangCho).toBe(0);
    // đối chứng dương: Admin xác minh lỗi hệ thống ⇒ có đúng MỘT quyền bù
    const r = await cap(l1.attemptId);
    expect(r).toMatchObject({ ok: true, daCoTruocDo: false });
    expect(await db.onlAttemptCompensation.count({ where: { entitlementId: k.entitlementId, status: "AVAILABLE" } })).toBe(1);
  });

  it("[ONL-EX01-02] 🔴 thiếu lý do (<10) / thiếu bằng chứng (<5) bị từ chối và KHÔNG ghi gì; đối chứng: đủ cả hai thì được", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: null });
    const l1 = await batDau(k, T0);
    await nopSai(k, l1.attemptId, sau(10));
    expect(await cap(l1.attemptId, { lyDo: "ngắn" })).toMatchObject({ ok: false, ma: "LY_DO_QUA_NGAN" });
    expect(await cap(l1.attemptId, { bangChung: "x" })).toMatchObject({ ok: false, ma: "THIEU_BANG_CHUNG" });
    expect(await db.onlAttemptInterruption.count({ where: { entitlementId: k.entitlementId } })).toBe(0);
    expect(await cap(l1.attemptId)).toMatchObject({ ok: true });
  });

  it("[ONL-EX01-03] 🔴 lượt ĐANG LÀM không được cấp bù (cứ tiếp tục); lượt không tồn tại ⇒ lỗi rõ; đối chứng: lượt đã nộp được", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: null });
    const dang = await batDau(k, T0);
    expect(await cap(dang.attemptId)).toMatchObject({ ok: false, ma: "LUOT_DANG_LAM" });
    expect(await cap("khong-co-luot")).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    await nopSai(k, dang.attemptId, sau(20));
    expect(await cap(dang.attemptId)).toMatchObject({ ok: true });
  });

  it("[ONL-EX01-04] 🔴 EX-02: cấp bù KHÔNG sửa lượt cũ (trạng thái, điểm, đáp án, thời điểm nộp giữ nguyên); lượt thay thế dùng ĐÚNG bản chụp đề của lượt cũ", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: null });
    const l1 = await batDau(k, T0);
    await nopSai(k, l1.attemptId, sau(10));
    const truoc = await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId } });
    await cap(l1.attemptId);
    const sauKhi = await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId } });
    expect({ status: sauKhi.status, passed: sauKhi.passed, scorePercent: sauKhi.scorePercent, earnedPoints: sauKhi.earnedPoints, answersJson: sauKhi.answersJson, submittedAt: sauKhi.submittedAt, snapshotJson: sauKhi.snapshotJson })
      .toEqual({ status: truoc.status, passed: truoc.passed, scorePercent: truoc.scorePercent, earnedPoints: truoc.earnedPoints, answersJson: truoc.answersJson, submittedAt: truoc.submittedAt, snapshotJson: truoc.snapshotJson });
    const moi = await batDau(k, sau(600));
    expect(moi.daTiepTuc).toBe(false);
    const lm = await db.onlAttempt.findUniqueOrThrow({ where: { id: moi.attemptId }, select: { snapshotJson: true, number: true } });
    expect(lm.snapshotJson).toEqual(truoc.snapshotJson); // bản chụp đề của lượt đã bù
    expect(lm.number).toBe(2);
    expect(await db.onlAttemptCompensation.findFirstOrThrow({ where: { entitlementId: k.entitlementId }, select: { status: true, usedAttemptId: true } })).toMatchObject({ status: "USED", usedAttemptId: moi.attemptId });
  });

  it("[ONL-EX01-05] 🔴 IDEMPOTENT + KHÔNG bù vô hạn: gọi lại và 5 lời gọi ĐỒNG THỜI cho cùng một lượt ⇒ đúng MỘT quyền bù; lượt khác vẫn bù được riêng", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: null });
    const l1 = await batDau(k, T0);
    await nopSai(k, l1.attemptId, sau(10));
    const kq = await Promise.all([1, 2, 3, 4, 5].map(() => cap(l1.attemptId)));
    expect(kq.every((r) => r.ok)).toBe(true);
    expect(kq.filter((r) => r.ok && !r.daCoTruocDo)).toHaveLength(1);
    expect(await db.onlAttemptCompensation.count({ where: { entitlementId: k.entitlementId } })).toBe(1);
    expect(await cap(l1.attemptId)).toMatchObject({ ok: true, daCoTruocDo: true });
    // lượt 2 (bù rồi nộp) là lượt khác ⇒ có thể bị bù riêng nếu có LỖI KHÁC được xác minh
    const l2 = await batDau(k, sau(700));
    await nopSai(k, l2.attemptId, sau(710));
    expect(await cap(l2.attemptId)).toMatchObject({ ok: true, daCoTruocDo: false });
    expect(await db.onlAttemptCompensation.count({ where: { entitlementId: k.entitlementId } })).toBe(2);
  });

  it("[ONL-EX01-06] 🔴 lượt đã bị gián đoạn do THU HỒI không đi đường này (tránh bù hai lần); có nhật ký người duyệt + lý do + bằng chứng", async () => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: null });
    const l1 = await batDau(k, T0);
    await nopSai(k, l1.attemptId, sau(10));
    await cap(l1.attemptId, { actor: "admin-xyz" });
    const g = await db.onlAttemptInterruption.findUniqueOrThrow({ where: { attemptId: l1.attemptId } });
    expect(g).toMatchObject({ reasonCode: "LOI_HE_THONG", status: "COMPENSATED", reviewedByUserId: "admin-xyz" });
    expect(g.reviewReason).toContain(LY);
    expect(g.reviewReason).toContain(BC);
    // đối chứng: một gián đoạn do thu hồi (reasonCode ADMIN) ⇒ từ chối đường này
    await db.onlAttemptInterruption.update({ where: { id: g.id }, data: { reasonCode: "ADMIN" } });
    expect(await cap(l1.attemptId)).toMatchObject({ ok: false, ma: "LUOT_DA_GIAN_DOAN_DO_THU_HOI" });
  });
  it.each(["ADMIN", "HOAN_TIEN", "BAO_MAT"] as const)("[ONL-EX02-01] 🔴 thu hồi quyền (%s) GIỮA lượt: KHÔNG xoá bài, KHÔNG chấm trượt, giữ câu đã lưu + trạng thái lượt; đối chứng: lượt không bị thu hồi vẫn chấm theo hạn", async (loai) => {
    const k = await dungKhoaP0({ maxAttempts: null, timeLimitMin: 2 });
    const l = await batDau(k, T0);
    const r = await luuNhap(db, { ...k.args(sau(10)), attemptId: l.attemptId, yeuCau: { requestId: khoaYeuCau("ex02"), items: [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }] } });
    expect(r.ok).toBe(true);
    const nhapTruoc = await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId }, orderBy: { questionId: "asc" } });
    expect(nhapTruoc.length).toBeGreaterThan(0);
    await thuHoiQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, reason: "Thu hồi giữa lượt thi (EX-02)", idempotencyKey: khoaYeuCau("ex02-th"), now: sau(20), actorUserId: "admin-1", loaiThuHoi: loai });
    await doiSoatLuotQuaHan(db, { now: sau(900) }); // máy chủ chạy đối soát rất lâu sau hạn
    const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } });
    // bài + nháp còn nguyên, không bị xoá
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId } })).toBe(nhapTruoc.length);
    if (loai === "ADMIN") {
      // gián đoạn: KHÔNG chấm, KHÔNG điểm, giữ để xử lý tiếp/cấp bù
      expect(a.status).toBe("INTERRUPTED");
      expect(a.passed).toBeNull();
      expect(a.scorePercent).toBeNull();
    } else {
      // không gián đoạn: lượt chốt theo hạn bằng câu ĐÃ LƯU (không bị ép 0 điểm vì thu hồi)
      expect(a.status).not.toBe("IN_PROGRESS");
      expect(a.finalizeReason).toBe("DEADLINE_AUTO");
      expect(Number(a.earnedPoints ?? 0)).toBeGreaterThan(0);
    }
  });
});
