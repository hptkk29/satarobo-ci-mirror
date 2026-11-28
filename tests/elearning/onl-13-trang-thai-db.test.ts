// @vitest-environment node
/**
 * [ONL-13S] 13/13 dạng × TOÀN BỘ TRẠNG THÁI LƯỢT (Owner: "đối chiếu 13 dạng với fixture, API và toàn bộ trạng thái") — Postgres thật.
 * MỘT đề gồm đủ 13 dạng: lưu nháp cả 13 trong một yêu cầu → resume khôi phục ĐÚNG từng đáp án → retry idempotent → xung đột theo câu không ghi đè →
 * học viên khác không đọc được lượt → hết hạn: máy chủ tự chốt, chấm đúng cả 13, KHÔNG double-grade, nháp còn nguyên. Mỗi ca âm có đối chứng dương.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { batDauLamBai, luuCauHoi, luuDeThi } from "../../lib/elearning-online/danh-gia-db";
import { LOAI_CAU_HOI } from "../../lib/elearning-online/cham-diem";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { doiSoatLuotQuaHan, docTrangThaiLuot, luuNhap } from "../../lib/elearning-online/luot-nhap-db";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { nopSanPham } from "../../lib/elearning-online/san-pham-db";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { CAU, SA_BAN, tepHopLe } from "./_onl-13-fixture";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONL13S_";
const T0 = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
const sau = (giay: number) => new Date(T0.getTime() + giay * 1000);
let n = 0;
let rq = 0;
const yc = (t = "r") => `ci-onl13s-${t}-${Date.now()}-${++rq}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onl13s-" } } });
}

async function hocVien(courseId: string, ten: string) {
  const ph = await db.user.create({ data: { name: `${P}ph-${ten}`, email: `ci-onl13s-${ten}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
  const hv = await db.student.create({ data: { name: `${P}hv-${ten}-${n}`, parentUserId: ph.id }, select: { id: true } });
  const c = await capQuyenHoc(db, { studentId: hv.id, courseId, loai: "MUA", now: T0, idempotencyKey: `ci-onl13s-mua-${ten}-${Date.now()}-${n}` });
  if (!c.ok) throw new Error(c.thongBao);
  return { parentUserId: ph.id, studentId: hv.id };
}

/** Khoá có MỘT bài QUIZ gồm ĐỦ 13 dạng (5 cơ bản + 8 mở rộng), giới hạn 2 phút. */
async function dung() {
  const t = await taoKhoa(db, { code: `CI-13S-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const id: Record<string, string> = {};
  const them = async (k: string, input: object) => {
    const r = await luuCauHoi(db, { courseId: t.courseId, ...input, explanation: "GIAI-THICH-" + k } as never, "u");
    if (!r.ok) throw new Error(k + ": " + r.thongBao);
    id[k] = r.id;
  };
  await them("SINGLE_CHOICE", { type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a" });
  await them("MULTIPLE_CHOICE", { type: "MULTIPLE_CHOICE", stem: "Số chẵn?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }, { id: "c", text: "4" }], correct: ["a", "c"] });
  await them("TRUE_FALSE", { type: "TRUE_FALSE", stem: "Robot có động cơ?", correct: true });
  await them("SHORT_TEXT", { type: "SHORT_TEXT", stem: "Thủ đô VN?", accepted: ["Hà Nội"] });
  await them("ESSAY", { type: "ESSAY", stem: "Mô tả robot", points: 4 });
  for (const [k, v] of Object.entries(CAU)) await them(k, k === "PRODUCT" ? { ...v } : { ...v });
  const de = await luuDeThi(db, { courseId: t.courseId, kind: "QUIZ", title: "Đề 13 dạng", passPercent: 50, status: "ACTIVE", maxAttempts: null, timeLimitMin: 2, cau: Object.values(id).map((questionId) => ({ questionId })) }, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Q", contentJson: { assessmentId: de.id } });
  if (!b.ok) throw new Error(b.thongBao);
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" as const } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, lessonStableId: b.stableId, id };
}

/** Đáp án ĐÚNG của 13 dạng, đọc từ BẢN CHỤP của lượt (mã lựa chọn là mã mờ riêng của lượt). */
async function traLoiDung13(attemptId: string, id: Record<string, string>, submissionId: string): Promise<Record<string, unknown>> {
  const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { snapshotJson: true } });
  const cau = (a.snapshotJson as unknown as { cau: { id: string; key: Record<string, unknown> }[] }).cau;
  const key = (q: string) => cau.find((c) => c.id === q)!.key;
  return {
    [id.SINGLE_CHOICE!]: key(id.SINGLE_CHOICE!).correct,
    [id.MULTIPLE_CHOICE!]: key(id.MULTIPLE_CHOICE!).correct,
    [id.TRUE_FALSE!]: true,
    [id.SHORT_TEXT!]: "hà nội",
    [id.ESSAY!]: "Robot gồm động cơ, pin và cảm biến.",
    [id.FILL_BLANK!]: ["ba", "dừng"],
    [id.MATCHING!]: key(id.MATCHING!).pairs,
    [id.ORDERING!]: key(id.ORDERING!).order,
    [id.CLASSIFY!]: key(id.CLASSIFY!).map,
    [id.IMAGE_HOTSPOT!]: { x: 120, y: 120 },
    [id.NUMERIC!]: "60,5",
    [id.PRODUCT!]: submissionId,
    [id.BLOCK_SEQUENCE!]: [{ b: "repeat", n: 3, body: [{ b: "fwd" }] }],
  };
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-13S] 13 dạng × trạng thái lượt (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-13S-01] 🔴 đề có ĐÚNG 13 dạng chính thức; học viên nhận đủ 13 câu không đáp án; lưu nháp CẢ 13 trong MỘT yêu cầu ⇒ mỗi câu được ACK", async () => {
    const k = await dung();
    expect(Object.keys(k.id).sort()).toEqual([...LOAI_CAU_HOI].sort());
    const hv = await hocVien(k.courseId, "a");
    const a = { ...hv, courseId: k.courseId, lessonStableId: k.lessonStableId, now: T0 };
    const bd = await batDauLamBai(db, a);
    if (!bd.ok) throw new Error(bd.thongBao);
    expect(bd.luot.de.cau.length).toBe(13);
    expect(JSON.stringify(bd.luot)).not.toContain("GIAI-THICH-"); // đối chứng âm: không lộ giải thích
    expect(JSON.stringify(bd.luot)).toContain("Robot có động cơ?"); // đối chứng dương
    const sp = await nopSanPham(db, { ...a, attemptId: bd.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, hv.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const dap = await traLoiDung13(bd.luot.attemptId, k.id, sp.submissionId);
    const r = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(10), yeuCau: { requestId: yc("all"), items: Object.entries(dap).map(([questionId, answer]) => ({ questionId, answer, baseRevision: 0 })) } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.items.length).toBe(13);
    expect(r.items.every((x) => x.ketQua === "SAVED")).toBe(true);
    expect(r.draftRevision).toBeGreaterThanOrEqual(1);
  });

  it("[ONL-13S-02] 🔴 RESUME: đọc lại lượt trả ĐÚNG từng đáp án của 13 dạng, không đổi số lượt; retry cùng requestId ⇒ replayed, revision không đổi; request CŨ không ghi đè (CONFLICT từng câu)", async () => {
    const k = await dung();
    const hv = await hocVien(k.courseId, "b");
    const a = { ...hv, courseId: k.courseId, lessonStableId: k.lessonStableId, now: T0 };
    const bd = await batDauLamBai(db, a);
    if (!bd.ok) throw new Error(bd.thongBao);
    const sp = await nopSanPham(db, { ...a, attemptId: bd.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, hv.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const dap = await traLoiDung13(bd.luot.attemptId, k.id, sp.submissionId);
    const requestId = yc("resume");
    const body = { requestId, items: Object.entries(dap).map(([questionId, answer]) => ({ questionId, answer, baseRevision: 0 })) };
    const r1 = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(10), yeuCau: body });
    if (!r1.ok) throw new Error("r1");
    const doc = await docTrangThaiLuot(db, { ...a, attemptId: bd.luot.attemptId, now: sau(20) });
    if (!doc.ok) throw new Error("doc");
    expect(doc.luot.trangThai).toBe("IN_PROGRESS");
    expect(doc.luot.nhap.length).toBe(13);
    for (const [questionId, answer] of Object.entries(dap)) expect(doc.luot.nhap.find((x) => x.questionId === questionId)?.dapAn, `câu ${questionId}`).toEqual(answer);
    expect(doc.luot.draftRevision).toBe(r1.draftRevision);
    // resume KHÔNG tăng số lượt
    const lai = await batDauLamBai(db, { ...a, now: sau(21) });
    expect(lai.ok && lai.luot.attemptId).toBe(bd.luot.attemptId);
    expect(await db.onlAttempt.count({ where: { studentId: hv.studentId } })).toBe(1);
    // retry cùng requestId ⇒ replay, không đổi
    const r2 = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(22), yeuCau: body });
    expect(r2).toMatchObject({ ok: true, replayed: true, draftRevision: r1.draftRevision });
    // request CŨ (baseRevision 0) với đáp án khác ⇒ CONFLICT, không ghi đè
    const cu = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(23), yeuCau: { requestId: yc("old"), items: [{ questionId: k.id.TRUE_FALSE!, answer: false, baseRevision: 0 }] } });
    if (!cu.ok) throw new Error("cu");
    expect(cu.items[0]?.ketQua).toBe("CONFLICT");
    const doc2 = await docTrangThaiLuot(db, { ...a, attemptId: bd.luot.attemptId, now: sau(24) });
    expect(doc2.ok && doc2.luot.nhap.find((x) => x.questionId === k.id.TRUE_FALSE)?.dapAn).toBe(true);
  });

  it("[ONL-13S-03] 🔴 học viên KHÁC không đọc/ghi được lượt của người này; đáp án sai kiểu của MỖI dạng ⇒ cả yêu cầu bị từ chối, không ghi nửa chừng", async () => {
    const k = await dung();
    const hv = await hocVien(k.courseId, "c");
    const kia = await hocVien(k.courseId, "d");
    const a = { ...hv, courseId: k.courseId, lessonStableId: k.lessonStableId, now: T0 };
    const bd = await batDauLamBai(db, a);
    if (!bd.ok) throw new Error(bd.thongBao);
    const ak = { ...kia, courseId: k.courseId, lessonStableId: k.lessonStableId, now: sau(5) };
    expect((await docTrangThaiLuot(db, { ...ak, attemptId: bd.luot.attemptId })).ok).toBe(false);
    expect((await luuNhap(db, { ...ak, attemptId: bd.luot.attemptId, yeuCau: { requestId: yc("x"), items: [{ questionId: k.id.TRUE_FALSE!, answer: false, baseRevision: 0 }] } })).ok).toBe(false);
    // đối chứng dương: chính chủ đọc được
    expect((await docTrangThaiLuot(db, { ...a, attemptId: bd.luot.attemptId, now: sau(5) })).ok).toBe(true);
    // hỏng theo từng dạng: KIỂM TẤT CẢ TRƯỚC KHI GHI — một câu sai ⇒ CẢ yêu cầu bị từ chối (DAP_AN_KHONG_HOP_LE), KHÔNG ghi nửa chừng, kể cả câu đúng đi kèm.
    const hong: [string, unknown][] = [
      ["SINGLE_CHOICE", "khong-co"], ["MULTIPLE_CHOICE", "a"], ["TRUE_FALSE", "true"], ["SHORT_TEXT", 5], ["ESSAY", 5], ["FILL_BLANK", ["chỉ-một-ô"]], ["MATCHING", { zz: "r1" }],
      ["ORDERING", ["zz"]], ["CLASSIFY", { zz: "g1" }], ["IMAGE_HOTSPOT", { x: 9999, y: 1 }], ["NUMERIC", { v: 1 }], ["PRODUCT", "../etc/passwd"], ["BLOCK_SEQUENCE", [{ b: "teleport" }]],
    ];
    expect(hong.map(([t]) => t).sort()).toEqual([...LOAI_CAU_HOI].sort()); // đủ 13 dạng, mỗi dạng một kiểu sai
    for (const [dang, sai] of hong) {
      const r = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(6), yeuCau: { requestId: yc("hong"), items: [dang === "ESSAY" ? { questionId: k.id.TRUE_FALSE!, answer: true, baseRevision: 0 } : { questionId: k.id.ESSAY!, answer: "bài viết hợp lệ", baseRevision: 0 }, { questionId: k.id[dang]!, answer: sai, baseRevision: 0 }] } });
      expect(r, dang).toMatchObject({ ok: false, ma: "DAP_AN_KHONG_HOP_LE" });
    }
    expect(await db.onlAttemptDraft.count({ where: { attemptId: bd.luot.attemptId } })).toBe(0); // không câu nào (kể cả câu đúng đi kèm) được ghi
    // đối chứng dương: chính câu TRUE_FALSE đúng, gửi riêng ⇒ lưu được
    const dung1 = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(7), yeuCau: { requestId: yc("ok"), items: [{ questionId: k.id.TRUE_FALSE!, answer: true, baseRevision: 0 }] } });
    expect(dung1.ok && dung1.items[0]?.ketQua).toBe("SAVED");
    // câu không thuộc lượt
    expect(await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(8), yeuCau: { requestId: yc("la"), items: [{ questionId: "cau-la", answer: true, baseRevision: 0 }] } })).toMatchObject({ ok: false, ma: "CAU_KHONG_THUOC_LUOT" });
  });

  it("[ONL-13S-04] 🔴 HẾT HẠN: máy chủ tự chốt (không cần app mở), chấm ĐÚNG cả 13 dạng từ nháp đã lưu, KHÔNG double-grade; nháp + lý do chốt còn nguyên; đối chứng: chưa tới hạn thì KHÔNG chốt", async () => {
    const k = await dung();
    const hv = await hocVien(k.courseId, "e");
    const a = { ...hv, courseId: k.courseId, lessonStableId: k.lessonStableId, now: T0 };
    const bd = await batDauLamBai(db, a);
    if (!bd.ok) throw new Error(bd.thongBao);
    const sp = await nopSanPham(db, { ...a, attemptId: bd.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, hv.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const dap = await traLoiDung13(bd.luot.attemptId, k.id, sp.submissionId);
    const r = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(30), yeuCau: { requestId: yc("dl"), items: Object.entries(dap).map(([questionId, answer]) => ({ questionId, answer, baseRevision: 0 })) } });
    expect(r.ok).toBe(true);
    // chưa quá hạn (2 phút) ⇒ không chốt
    expect((await doiSoatLuotQuaHan(db, { now: sau(60) })).daChot).toBe(0);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: bd.luot.attemptId } })).status).toBe("IN_PROGRESS");
    // quá hạn rất lâu, app đã đóng ⇒ chốt theo giờ máy chủ
    const c1 = await doiSoatLuotQuaHan(db, { now: sau(900) });
    expect(c1.daChot).toBeGreaterThanOrEqual(1);
    const sauChot = await db.onlAttempt.findUniqueOrThrow({ where: { id: bd.luot.attemptId } });
    expect(sauChot.finalizeReason).toBe("DEADLINE_AUTO");
    expect(sauChot.status).not.toBe("IN_PROGRESS");
    // 12 dạng tự chấm đúng hết; ESSAY + PRODUCT chờ chấm tay ⇒ chưa có kết luận đạt/trượt, không bị ép "trượt"
    const tong = await db.onlQuestion.findMany({ where: { id: { in: Object.values(k.id) } }, select: { id: true, type: true, points: true } });
    const diemTuDong = tong.filter((q) => q.type !== "ESSAY" && q.type !== "PRODUCT").reduce((s, q) => s + q.points, 0);
    expect(Number(sauChot.earnedPoints ?? 0)).toBe(diemTuDong);
    expect(sauChot.passed === null || sauChot.passed === true).toBe(true);
    // chạy lại ⇒ KHÔNG chốt/chấm lần hai
    const c2 = await doiSoatLuotQuaHan(db, { now: sau(1800) });
    expect(c2.daChot).toBe(0);
    const lai = await db.onlAttempt.findUniqueOrThrow({ where: { id: bd.luot.attemptId } });
    expect({ s: lai.status, e: String(lai.earnedPoints), f: lai.finalizeReason, t: lai.finalizedAt?.toISOString() }).toEqual({ s: sauChot.status, e: String(sauChot.earnedPoints), f: sauChot.finalizeReason, t: sauChot.finalizedAt?.toISOString() });
    // nháp + lý do chốt còn nguyên, và ghi nháp sau chốt bị từ chối
    const doc = await docTrangThaiLuot(db, { ...a, attemptId: bd.luot.attemptId, now: sau(1900) });
    if (!doc.ok) throw new Error("doc");
    expect(doc.luot.nhap.length).toBe(13);
    expect(doc.luot.de).toBeNull();
    expect(doc.luot.lyDoChot).toBe("DEADLINE_AUTO");
    const muon = await luuNhap(db, { ...a, attemptId: bd.luot.attemptId, now: sau(1901), yeuCau: { requestId: yc("muon"), items: [{ questionId: k.id.TRUE_FALSE!, answer: false, baseRevision: 5 }] } });
    expect(muon.ok).toBe(false);
  });
});

void SA_BAN;
