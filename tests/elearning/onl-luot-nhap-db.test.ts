// @vitest-environment node
/**
 * [ONL-LN-*] P0 Mobile — NHÁP đáp án phía máy chủ (autosave) + TỰ CHỐT lượt quá hạn (Postgres thật). Giờ do MÁY CHỦ quyết (tham số `now`), không do điện thoại.
 * Chỉ bảng `Onl*` — không Offline/Nội bộ. Mỗi ca âm có đối chứng dương.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai, luuCauHoi, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { TAN_SUAT_NHAP, chotLuotQuaHanTrongTx, docTrangThaiLuot, doiSoatLuotQuaHan, luuNhap } from "../../lib/elearning-online/luot-nhap-db";
import { thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { nopSanPham } from "../../lib/elearning-online/san-pham-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { T0, donP0, dungKhoaP0, khoaYeuCau, sau, type KhoaP0 } from "./_onl-p0-fixture";

type Item = { questionId: string; answer: unknown; baseRevision: number };
const luu = (k: Pick<KhoaP0, "args">, att: string, now: Date, items: Item[], requestId = khoaYeuCau("n"), extra: object = {}) => luuNhap(db, { ...k.args(now), attemptId: att, yeuCau: { requestId, items, ...extra } });
const bat = async (k: Pick<KhoaP0, "args">, now: Date) => {
  const r = await batDauLamBai(db, k.args(now));
  if (!r.ok) throw new Error(r.thongBao);
  return r.luot;
};
const doc = (k: Pick<KhoaP0, "args">, att: string, now: Date) => docTrangThaiLuot(db, { ...k.args(now), attemptId: att });
const NHAP_DUNG = (k: KhoaP0, base = 0): Item[] => [
  { questionId: k.q.chonMot!, answer: "a", baseRevision: base },
  { questionId: k.q.dungSai!, answer: true, baseRevision: base },
  { questionId: k.q.ngan!, answer: "Hà Nội", baseRevision: base },
  { questionId: k.q.nhapSo!, answer: "5", baseRevision: base },
];

describe.skipIf(!RUN_DB_TESTS)("[ONL-LN] nháp phía máy chủ (Postgres thật)", () => {
  beforeAll(donP0, 120_000);
  beforeEach(donP0, 120_000); // worker quét MỌI lượt quá hạn: mỗi ca bắt đầu từ DB sạch
  afterAll(donP0, 120_000);

  it("[ONL-LN-01/02] 🔴 lưu một câu rồi đọc lại; lưu theo lô; đáp án sai hình dạng bị từ chối cả yêu cầu (không ghi nửa chừng)", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    const r1 = await luu(k, l.attemptId, sau(5), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    expect(r1).toMatchObject({ ok: true, replayed: false, draftRevision: 1, items: [{ ketQua: "SAVED", revision: 1 }] });
    const d1 = await doc(k, l.attemptId, sau(6));
    expect(d1).toMatchObject({ ok: true });
    if (!d1.ok) return;
    expect(d1.luot.nhap).toEqual([{ questionId: k.q.chonMot, revision: 1, savedAt: sau(5).toISOString(), dapAn: "a" }]);
    expect(d1.luot.trangThai).toBe("IN_PROGRESS");
    const r2 = await luu(k, l.attemptId, sau(7), NHAP_DUNG(k, 0).slice(1)); // lô 3 câu còn lại
    expect(r2).toMatchObject({ ok: true, items: [{ ketQua: "SAVED", revision: 1 }, { ketQua: "SAVED", revision: 1 }, { ketQua: "SAVED", revision: 1 }] });
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId } })).toBe(4);
    // sai hình dạng: lựa chọn không thuộc câu ⇒ cả yêu cầu bị từ chối, câu hợp lệ đi kèm KHÔNG được ghi
    const truoc = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId }, select: { draftRevision: true } });
    const xau = await luu(k, l.attemptId, sau(8), [{ questionId: k.q.nhapSo!, answer: "6", baseRevision: 1 }, { questionId: k.q.chonMot!, answer: "zzz", baseRevision: 1 }]);
    expect(xau).toMatchObject({ ok: false, ma: "DAP_AN_KHONG_HOP_LE" });
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: l.attemptId, questionId: k.q.nhapSo! } })).answerJson).toBe("5");
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId }, select: { draftRevision: true } })).draftRevision).toBe(truoc.draftRevision);
  });

  it("[ONL-LN-03] 🔴 retry cùng requestId ⇒ KHÔNG nhân bản, trả đúng kết quả cũ, không tính vào tần suất; đối chứng: requestId mới + base cũ ⇒ xung đột", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    const rid = khoaYeuCau("lap");
    const a = await luu(k, l.attemptId, sau(5), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }], rid);
    const b = await luu(k, l.attemptId, sau(6), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }], rid);
    const c = await luu(k, l.attemptId, sau(7), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }], rid);
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: true, items: [{ ketQua: "SAVED", revision: 1 }] });
    expect(c).toMatchObject({ ok: true, replayed: true });
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId } })).toBe(1);
    expect(await db.onlAttemptDraftOp.count({ where: { attemptId: l.attemptId } })).toBe(1);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).draftRevision).toBe(1);
    expect(await luu(k, l.attemptId, sau(8), [{ questionId: k.q.chonMot!, answer: "b", baseRevision: 0 }])).toMatchObject({ ok: true, items: [{ ketQua: "CONFLICT", serverRevision: 1, serverAnswer: "a" }] });
  });

  it("[ONL-LN-04] 🔴 revision CŨ đến muộn KHÔNG ghi đè revision mới (A rev4 → B rev5, rev5 tới trước)", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    const q = k.q.ngan!;
    for (let i = 0; i < 3; i++) await luu(k, l.attemptId, sau(5 + i), [{ questionId: q, answer: "v" + (i + 1), baseRevision: i }]); // server rev 3
    const reqA = khoaYeuCau("A"), reqB = khoaYeuCau("B");
    // B (base 3 ⇒ rev 4) tới TRƯỚC; A (cũng base 3, gửi trước đó từ thiết bị chậm) tới SAU
    expect(await luu(k, l.attemptId, sau(10), [{ questionId: q, answer: "ĐÁP ÁN B", baseRevision: 3 }], reqB)).toMatchObject({ items: [{ ketQua: "SAVED", revision: 4 }] });
    const muon = await luu(k, l.attemptId, sau(11), [{ questionId: q, answer: "đáp án A", baseRevision: 3 }], reqA);
    expect(muon).toMatchObject({ ok: true, items: [{ ketQua: "CONFLICT", serverRevision: 4, serverAnswer: "ĐÁP ÁN B" }] });
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: l.attemptId, questionId: q } })).answerJson).toBe("ĐÁP ÁN B");
    // base TƯƠNG LAI (client nói đã thấy revision máy chủ chưa có) ⇒ AHEAD, không ghi
    expect(await luu(k, l.attemptId, sau(12), [{ questionId: q, answer: "x", baseRevision: 9 }])).toMatchObject({ items: [{ ketQua: "AHEAD", serverRevision: 4 }] });
  });

  it("[ONL-LN-05] 🔴 HAI THIẾT BỊ: thiết bị cũ không ghi đè thiết bị mới; có xung đột rõ + lấy lại bản máy chủ; không đẻ lượt mới; đồng thời thật sự ⇒ đúng một bên thắng", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    const q = k.q.chonMot!;
    await luu(k, l.attemptId, sau(5), [{ questionId: q, answer: "a", baseRevision: 0 }], khoaYeuCau("d0"), { deviceId: "may-A" });
    // cả hai thiết bị đã thấy rev 1
    const x = await luu(k, l.attemptId, sau(6), [{ questionId: q, answer: "b", baseRevision: 1 }], khoaYeuCau("dx"), { deviceId: "may-X" });
    const y = await luu(k, l.attemptId, sau(7), [{ questionId: q, answer: "a", baseRevision: 1 }], khoaYeuCau("dy"), { deviceId: "may-Y" });
    expect(x).toMatchObject({ items: [{ ketQua: "SAVED", revision: 2 }] });
    expect(y).toMatchObject({ items: [{ ketQua: "CONFLICT", serverRevision: 2, serverAnswer: "b" }] });
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: l.attemptId, questionId: q } })).deviceId).toBe("may-X"); // bản của thiết bị mới được giữ
    const lay = await doc(k, l.attemptId, sau(8)); // Y lấy lại dữ liệu đã ACK
    if (!lay.ok) throw new Error("doc");
    expect(lay.luot.nhap[0]).toMatchObject({ revision: 2, dapAn: "b" });
    expect(await luu(k, l.attemptId, sau(9), [{ questionId: q, answer: "a", baseRevision: 2 }])).toMatchObject({ items: [{ ketQua: "SAVED", revision: 3 }] }); // Y giải quyết xung đột
    expect(await db.onlAttempt.count({ where: { entitlementId: k.entitlementId } })).toBe(1);
    // song song thật sự: hai bên cùng base ⇒ một SAVED, một CONFLICT
    const qn = k.q.ngan!;
    const [p, r] = await Promise.all([
      luu(k, l.attemptId, sau(10), [{ questionId: qn, answer: "Hà Nội", baseRevision: 0 }], khoaYeuCau("pp")),
      luu(k, l.attemptId, sau(10), [{ questionId: qn, answer: "Huế", baseRevision: 0 }], khoaYeuCau("pq")),
    ]);
    const kq = [p, r].map((z) => (z.ok ? z.items[0]!.ketQua : "LOI")).sort();
    expect(kq).toEqual(["CONFLICT", "SAVED"]);
  });

  it("[ONL-LN-06/07/08] 🔴 không quyền / học viên khác / câu không thuộc lượt ⇒ từ chối và KHÔNG ghi", async () => {
    const k = await dungKhoaP0();
    const khac = await k.themHocVien("b");
    const l = await bat(k, T0);
    const c = await bat(khac, T0);
    const base = (it: Item[], rid = khoaYeuCau("t")) => ({ attemptId: l.attemptId, yeuCau: { requestId: rid, items: it } });
    // phụ huynh khác con
    expect(await luuNhap(db, { ...k.args(sau(5)), parentUserId: khac.parentUserId, ...base([{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]) })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
    // học viên B dùng lượt của A
    expect(await luuNhap(db, { ...khac.args(sau(5)), ...base([{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]) })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    // câu không thuộc lượt (câu của khoá khác) và câu mới tạo SAU khi bắt đầu lượt
    const moi = await luuCauHoi(db, { courseId: k.courseId, type: "TRUE_FALSE", stem: "Câu mới sau khi bắt đầu", correct: true } as never, "u");
    if (!moi.ok) throw new Error("moi");
    for (const qid of ["khong-co-trong-luot", moi.id]) {
      expect(await luu(k, l.attemptId, sau(6), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }, { questionId: qid, answer: true, baseRevision: 0 }]), qid).toMatchObject({ ok: false, ma: "CAU_KHONG_THUOC_LUOT" });
    }
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId } })).toBe(0); // câu hợp lệ đi kèm cũng KHÔNG được ghi
    // không còn quyền học (thu hồi loại KHAC) ⇒ cổng truy cập đóng
    await thuHoiQuyenHoc(db, { studentId: khac.studentId, courseId: k.courseId, reason: "Thu hồi để thử nghiệm quyền", idempotencyKey: khoaYeuCau("kq"), now: sau(7), loaiThuHoi: "KHAC" });
    expect(await luu(khac, c.attemptId, sau(8), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }])).toMatchObject({ ok: false });
    expect(await luu(k, l.attemptId, sau(9), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }])).toMatchObject({ ok: true }); // đối chứng dương
  });

  it("[ONL-LN-09] 🔴 đề/câu hỏi đổi SAU khi bắt đầu: nháp vẫn thuộc đúng lượt + bản chụp; phiên bản gắn vào nháp", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(5), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    await luuCauHoi(db, { courseId: k.courseId, id: k.q.chonMot, type: "SINGLE_CHOICE", stem: "ĐÃ ĐỔI", options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correct: "b" } as never, "u");
    await db.onlQuestion.update({ where: { id: k.q.dungSai }, data: { status: "ARCHIVED" } });
    // vẫn lưu được cho câu ĐÃ lưu trữ (nằm trong bản chụp của lượt) và đáp án vẫn kiểm theo lựa chọn của BẢN CHỤP
    expect(await luu(k, l.attemptId, sau(6), [{ questionId: k.q.dungSai!, answer: true, baseRevision: 0 }, { questionId: k.q.chonMot!, answer: "b", baseRevision: 1 }])).toMatchObject({ ok: true, items: [{ ketQua: "SAVED" }, { ketQua: "SAVED" }] });
    const d = await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId } });
    expect(d.every((x) => x.versionNumber === 1 && x.assessmentId === k.assessmentId && x.courseId === k.courseId && x.studentId === k.studentId)).toBe(true);
    const snap = JSON.stringify((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).snapshotJson);
    expect(snap).not.toContain("ĐÃ ĐỔI");
  });

  it("[ONL-LN-10] 🔴 nộp thành công ⇒ không ghi nháp thêm; nháp được đóng dấu; nộp lại trả kết quả cũ", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(5), NHAP_DUNG(k));
    const nop = await nopBai(db, { ...k.args(sau(20)), attemptId: l.attemptId, traLoi: { [k.q.chonMot!]: "a", [k.q.dungSai!]: true, [k.q.ngan!]: "Hà Nội", [k.q.nhapSo!]: "5" } });
    expect(nop).toMatchObject({ ok: true, trangThai: "GRADED" });
    expect(await luu(k, l.attemptId, sau(21), [{ questionId: k.q.ngan!, answer: "khác", baseRevision: 1 }])).toMatchObject({ ok: false, ma: "LUOT_DA_CHOT" });
    expect((await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId } })).every((x) => x.finalizedAt !== null)).toBe(true);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).finalizeReason).toBe("SUBMIT");
    expect(await nopBai(db, { ...k.args(sau(22)), attemptId: l.attemptId, traLoi: {} })).toMatchObject({ ok: true, daNopTruocDo: true });
  });

  it("[ONL-LN-11/25] 🔴 hết giờ ⇒ không nhận đáp án mới (biên: đúng dueAt còn nhận, +1 giây thì không); đồng hồ thiết bị sai không có tác dụng (yêu cầu mang giờ máy bị từ chối)", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0); // dueAt = T0+120s
    expect(await luu(k, l.attemptId, sau(120), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }])).toMatchObject({ ok: true }); // đúng hạn
    expect(await luu(k, l.attemptId, sau(121), [{ questionId: k.q.ngan!, answer: "x", baseRevision: 0 }])).toMatchObject({ ok: false, ma: "HET_GIO" });
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId, questionId: k.q.ngan! } })).toBe(0);
    // client khai giờ máy / hạn riêng ⇒ lược đồ chặt từ chối (không thể ảnh hưởng quyết định hạn)
    const k2 = await dungKhoaP0();
    const l2 = await bat(k2, T0);
    for (const them of [{ clientTime: sau(1).toISOString() }, { dueAt: sau(9999).toISOString() }, { serverNow: sau(1).toISOString() }]) {
      expect(await luu(k2, l2.attemptId, sau(5), [{ questionId: k2.q.chonMot!, answer: "a", baseRevision: 0 }], khoaYeuCau("clk"), them)).toMatchObject({ ok: false, ma: "YEU_CAU_KHONG_HOP_LE" });
    }
    expect(await luu(k2, l2.attemptId, sau(130), [{ questionId: k2.q.chonMot!, answer: "a", baseRevision: 0 }])).toMatchObject({ ok: false, ma: "HET_GIO" }); // máy chủ quyết, bất kể máy khách tin gì
    expect((await doc(k2, l2.attemptId, sau(5)) as { ok: true; luot: { hetGioLuc: string } }).luot.hetGioLuc).toBe(sau(120).toISOString());
  });

  it("[ONL-LN-12] 🔴 APP ĐÓNG trước hạn: máy chủ vẫn CHỐT và chấm từ nháp đã ACK; kết quả đúng; chỉ cho kết quả theo cài đặt", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(30), NHAP_DUNG(k)); // 4/4 đúng, rồi "app đóng": không bao giờ nộp
    expect((await doiSoatLuotQuaHan(db, { now: sau(150) })).daChot).toBe(0); // chưa tới hạn + dung sai (T0+180)
    const r = await doiSoatLuotQuaHan(db, { now: sau(181) });
    expect(r).toMatchObject({ daChot: 1, hetHanKhongNhap: 0, loi: [] });
    const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } });
    expect(a).toMatchObject({ status: "GRADED", scorePercent: 100, passed: true, earnedPoints: 4, totalPoints: 4, finalizeReason: "DEADLINE_AUTO" });
    expect(a.submittedAt!.toISOString()).toBe(sau(120).toISOString()); // thời điểm nộp = hạn, không phải lúc worker chạy
    expect((await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId } })).every((d) => d.finalizedAt !== null)).toBe(true);
    // đối chứng: lượt KHÔNG có nháp nào quá hạn ⇒ EXPIRED (hành vi cũ), không chấm
    const k2 = await dungKhoaP0();
    const l2 = await bat(k2, T0);
    await doiSoatLuotQuaHan(db, { now: sau(181) });
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } }))).toMatchObject({ status: "EXPIRED", finalizeReason: "NO_DRAFT_EXPIRED", scorePercent: null });
  });

  it("[ONL-LN-13] 🔴 worker chạy HAI LẦN và SONG SONG ⇒ chấm đúng MỘT lần (điểm, tiến độ, chứng nhận không nhân đôi)", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(30), NHAP_DUNG(k));
    const [a, b] = await Promise.all([doiSoatLuotQuaHan(db, { now: sau(200) }), doiSoatLuotQuaHan(db, { now: sau(200) })]);
    expect(a.daChot + b.daChot).toBe(1);
    expect((await doiSoatLuotQuaHan(db, { now: sau(300) })).daChot).toBe(0);
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } });
    expect(luot).toMatchObject({ status: "GRADED", earnedPoints: 4 });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: k.entitlementId, lessonStableId: k.lessonStableId } })).toBe(1);
    expect(await db.onlAttempt.count({ where: { entitlementId: k.entitlementId } })).toBe(1); // không đẻ lượt mới khi chốt
  });

  it("[ONL-LN-14] 🔴 worker BỊ NGẮT giữa chừng ⇒ giao dịch cuộn lại, lượt còn nguyên, chạy lại chốt đúng", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(30), NHAP_DUNG(k));
    await expect(
      db.$transaction(async (tx) => {
        const r = await chotLuotQuaHanTrongTx(tx, l.attemptId, sau(200));
        expect(r.ket).toBe("DA_CHOT_TU_NHAP");
        throw new Error("sập giữa chừng"); // mô phỏng tiến trình chết trước khi commit
      }),
    ).rejects.toThrow("sập giữa chừng");
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId }, select: { status: true, scorePercent: true, finalizedAt: true } })).toEqual({ status: "IN_PROGRESS", scorePercent: null, finalizedAt: null });
    expect((await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId } })).every((d) => d.finalizedAt === null)).toBe(true);
    expect((await doiSoatLuotQuaHan(db, { now: sau(201) })).daChot).toBe(1);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).status).toBe("GRADED");
  });

  it("[ONL-LN-15/16] 🔴 có câu TỰ LUẬN hoặc NỘP SẢN PHẨM ⇒ tự chốt nhưng CHỜ CHẤM TAY (không đạt/không rớt tự động)", async () => {
    const k = await dungKhoaP0({ tuLuan: true });
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(30), [...NHAP_DUNG(k), { questionId: k.q.tuLuan!, answer: "Robot của em đi theo vạch đen", baseRevision: 0 }]);
    await doiSoatLuotQuaHan(db, { now: sau(200) });
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).toMatchObject({ status: "SUBMITTED", passed: null, scorePercent: null, finalizeReason: "DEADLINE_AUTO" });
    const k2 = await dungKhoaP0({ sanPham: true });
    const l2 = await bat(k2, T0);
    const sp = await nopSanPham(db, { ...k2.args(sau(20)), attemptId: l2.attemptId, questionId: k2.q.sanPham!, file: { key: `online/sp/${k2.courseId}/${k2.studentId}/v.mp4`, name: "v.mp4", mime: "video/mp4", sizeBytes: 1_000_000, durationSec: 30 } });
    if (!sp.ok) throw new Error(sp.thongBao);
    await luu(k2, l2.attemptId, sau(30), [...NHAP_DUNG(k2), { questionId: k2.q.sanPham!, answer: sp.submissionId, baseRevision: 0 }]);
    await doiSoatLuotQuaHan(db, { now: sau(200) });
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).toMatchObject({ status: "SUBMITTED", passed: null });
    // mã bài nộp của NGƯỜI KHÁC trong nháp bị loại khi chốt (không lấy điểm của người khác)
    const k3 = await dungKhoaP0({ sanPham: true });
    const l3 = await bat(k3, T0);
    await luu(k3, l3.attemptId, sau(30), [{ questionId: k3.q.sanPham!, answer: sp.submissionId, baseRevision: 0 }]);
    await doiSoatLuotQuaHan(db, { now: sau(200) });
    expect(((await db.onlAttempt.findUniqueOrThrow({ where: { id: l3.attemptId } })).answersJson as Record<string, unknown>)[k3.q.sanPham!]).toBeUndefined();
  });

  it("[ONL-LN-17/18] 🔴 nháp đã ACK còn sau KHỞI ĐỘNG LẠI (kết nối mới); yêu cầu thất bại KHÔNG để lại nháp và không được báo là đã lưu", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    const ok = await luu(k, l.attemptId, sau(5), [{ questionId: k.q.ngan!, answer: "Hà Nội", baseRevision: 0 }]);
    expect(ok).toMatchObject({ ok: true, items: [{ ketQua: "SAVED" }] });
    const moi = new PrismaClient();
    try {
      const sau2 = await moi.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: l.attemptId, questionId: k.q.ngan! } });
      expect(sau2).toMatchObject({ answerJson: "Hà Nội", revision: 1 });
    } finally {
      await moi.$disconnect();
    }
    const hong = await luu(k, l.attemptId, sau(6), [{ questionId: k.q.chonMot!, answer: 12345, baseRevision: 0 }]);
    expect(hong.ok).toBe(false);
    expect(JSON.stringify(hong)).not.toContain("SAVED");
    expect(await db.onlAttemptDraft.count({ where: { attemptId: l.attemptId, questionId: k.q.chonMot! } })).toBe(0);
    expect(await db.onlAttemptDraftOp.count({ where: { attemptId: l.attemptId } })).toBe(1); // yêu cầu hỏng không vào sổ ⇒ gửi lại bản đúng vẫn ghi được
  });

  it("[ONL-LN-19/20/21] 🔴 thu hồi giữa lượt: nháp được bảo toàn, KHÔNG chấm rớt, đọc sau cấp lại không lộ đáp án; worker không động vào lượt gián đoạn", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    await luu(k, l.attemptId, sau(10), NHAP_DUNG(k).slice(0, 2));
    await thuHoiQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, reason: "Admin thu hồi giữa lượt", idempotencyKey: khoaYeuCau("tg"), now: sau(40), actorUserId: "ad", loaiThuHoi: "ADMIN" });
    const nhap = await db.onlAttemptDraft.findMany({ where: { attemptId: l.attemptId }, orderBy: { questionId: "asc" } });
    expect(nhap).toHaveLength(2);
    expect(nhap.every((d) => d.revision === 1 && d.finalizedAt === null)).toBe(true); // bảo toàn, chưa chốt
    expect(await doiSoatLuotQuaHan(db, { now: sau(100_000) })).toMatchObject({ daChot: 0, hetHanKhongNhap: 0 });
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).toMatchObject({ status: "INTERRUPTED", scorePercent: null, passed: null });
    await db.$executeRawUnsafe(`UPDATE "OnlEntitlement" SET "status" = 'ACTIVE', "revokedAt" = NULL, "revokedReason" = NULL, "revokedByUserId" = NULL WHERE "id" = '${k.entitlementId}'`); // mô phỏng cấp lại để đọc
    const d = await doc(k, l.attemptId, sau(100_000));
    if (!d.ok) throw new Error(d.thongBao);
    expect(d.luot).toMatchObject({ trangThai: "INTERRUPTED", de: null, gianDoan: { trangThai: "OPEN" } });
    const json = JSON.stringify(d);
    for (const cam of ["correct", "accepted", "GIAI-THICH", "answerKey", '"key"']) expect(json.includes(cam), cam).toBe(false);
    expect(d.luot.nhap).toHaveLength(2); // dương: đáp án CỦA HỌC VIÊN vẫn đọc được
    expect(await luu(k, l.attemptId, sau(100_001), [{ questionId: k.q.ngan!, answer: "x", baseRevision: 0 }])).toMatchObject({ ok: false, ma: "LUOT_BI_GIAN_DOAN" });
  });

  it("[ONL-LN-22] 🔴 tần suất: tối đa " + TAN_SUAT_NHAP.toiDaYeuCauMoiPhut + " yêu cầu/phút/lượt; quá ⇒ VUOT_TAN_SUAT + retryAfterSec; hết cửa sổ lại nhận; yêu cầu CŨ gửi lại không bị tính", async () => {
    const k = await dungKhoaP0({ timeLimitMin: 30 });
    const l = await bat(k, T0);
    const ridDau = khoaYeuCau("dau");
    for (let i = 0; i < TAN_SUAT_NHAP.toiDaYeuCauMoiPhut; i++) {
      const r = await luu(k, l.attemptId, sau(10), [{ questionId: k.q.ngan!, answer: "v" + i, baseRevision: i }], i === 0 ? ridDau : khoaYeuCau("t" + i));
      expect(r.ok, "yêu cầu " + i).toBe(true);
    }
    const qua = await luu(k, l.attemptId, sau(20), [{ questionId: k.q.ngan!, answer: "vượt", baseRevision: 90 }]);
    expect(qua).toMatchObject({ ok: false, ma: "VUOT_TAN_SUAT" });
    expect(qua.ok === false && qua.retryAfterSec).toBeGreaterThan(0);
    expect(qua.ok === false && qua.retryAfterSec).toBeLessThanOrEqual(TAN_SUAT_NHAP.cuaSoGiay);
    expect(await luu(k, l.attemptId, sau(21), [{ questionId: k.q.ngan!, answer: "v0", baseRevision: 0 }], ridDau)).toMatchObject({ ok: true, replayed: true }); // gửi lại yêu cầu đã ACK: không bị giới hạn
    expect(await luu(k, l.attemptId, sau(75), [{ questionId: k.q.ngan!, answer: "ok", baseRevision: 90 }])).toMatchObject({ ok: true }); // đã qua cửa sổ
    expect(await luu(k, l.attemptId, sau(76), Array.from({ length: TAN_SUAT_NHAP.toiDaCauMoiYeuCau + 1 }, (_, i) => ({ questionId: "q" + i, answer: 1, baseRevision: 0 })))).toMatchObject({ ok: false, ma: "YEU_CAU_KHONG_HOP_LE" });
  });

  it("[ONL-LN-23] 🔴 hợp đồng không lộ đáp án: kết quả lưu nháp, trạng thái lượt, bản đề gửi học viên — KHÔNG chứa đáp án đúng/giải thích/khoá chấm", async () => {
    const k = await dungKhoaP0();
    const l = await bat(k, T0);
    expect(JSON.stringify(l.de)).toContain("1+1=?"); // dương
    const r = await luu(k, l.attemptId, sau(5), NHAP_DUNG(k));
    const d = await doc(k, l.attemptId, sau(6));
    for (const goi of [JSON.stringify(r), JSON.stringify(d), JSON.stringify(l)]) for (const cam of ["correct", "accepted", "GIAI-THICH", "answerKey", '"key"', "tolerance"]) expect(goi.includes(cam), cam).toBe(false);
    // học viên không thể NHÉT trường chấm vào nháp: đáp án là đối tượng lạ bị từ chối
    expect(await luu(k, l.attemptId, sau(7), [{ questionId: k.q.chonMot!, answer: { value: "a", correct: "a", points: 999 }, baseRevision: 1 }])).toMatchObject({ ok: false, ma: "DAP_AN_KHONG_HOP_LE" });
    expect(await luu(k, l.attemptId, sau(8), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 1, correct: "a" } as unknown as Item])).toMatchObject({ ok: false, ma: "YEU_CAU_KHONG_HOP_LE" });
  });

  it("[ONL-LN-24] 🔴 không dùng bảng Offline/Nội bộ: mã nguồn P0 chỉ chạm Onl*", () => {
    const mn = (f: string) => readFileSync(resolve(process.cwd(), "lib/elearning-online", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const f of ["luot-nhap-db.ts", "gian-doan-db.ts", "nhap-dap-an.ts"]) {
      const s = mn(f);
      expect(s, f).not.toMatch(/\btrn[A-Z]\w*\b|\.assignmentSubmission\b|\.assignment\b|\.homework\w*\b|\.exam[A-Z]\w*\b/);
      expect(s, f).not.toMatch(/from\s+["']@\/lib\/elearning\//);
    }
    expect(mn("luot-nhap-db.ts")).toMatch(/onlAttemptDraft/); // đối chứng dương
    expect(mn("gian-doan-db.ts")).toMatch(/onlAttemptInterruption/);
  });
});
