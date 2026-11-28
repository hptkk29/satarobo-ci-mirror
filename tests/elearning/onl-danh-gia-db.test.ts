// @vitest-environment node
/**
 * [ONL-DG-*] E-learning ONLINE — đánh giá + chứng nhận (Postgres thật): soạn câu hỏi/đề · bắt đầu/nộp/chấm · snapshot · hết giờ · tự luận · điểm tốt nhất · chứng nhận.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { capChungNhanTay, docChungNhanCuaHocVien, thuHoiChungNhan, xacThucChungNhan } from "../../lib/elearning-online/chung-nhan";
import { batDauLamBai, chamLaiTay, chamTay, danhSachChoCham, danhSachDaCham, docLichSuChamLai, docLuotDeCham, docKetQuaCacLuot, luuCauHoi, luuDeThi, nopBai, type DeThiInput } from "../../lib/elearning-online/danh-gia-db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { moBanNhap, suaBai, themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLD_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
const sau = (phut: number) => new Date(NOW.getTime() + phut * 60_000);
let n = 0;
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onld-" } } });
}
const phuHuynh = (t: string) => db.user.create({ data: { name: `${P}${t}`, email: `ci-onld-${t}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
const hocVien = (parentUserId: string | null, t: string) => db.student.create({ data: { name: `${P}${t}-${++n}`, parentUserId }, select: { id: true } });

type Bo = {
  courseId: string;
  slug: string;
  quiz: string; // stableId bài QUIZ
  tl: string; // bài ASSIGNMENT (tự luận)
  thi: string; // bài FINAL_EXAM
  video: string;
  deQuiz: string;
  deTl: string;
  deThi: string;
  cau: { chonMot: string; chonNhieu: string; ngan: string; tuLuan: string; dungSai: string };
};

/** Khoá: video, quiz (4 câu tự động), bài tập tự luận (1 chọn một + 1 tự luận), thi cuối (2 câu). MO_HET; thi cuối BẬT. Đã phát hành + mở bán. */
async function dungBo(o: { maxLuot?: number | null; gioiHanPhut?: number | null; moBai?: "MO_HET" | "KHI_BAI_TRUOC_XONG"; xemKetQua?: "DIEM_VA_DUNG_SAI" | "CA_DAP_AN_SAU_HET_LUOT" | "CHI_DIEM"; hienDapAn?: "SAU_KHI_NOP" | "SAU_KHI_DE_DONG" | "KHONG_BAO_GIO"; dongDapAnLuc?: string | null } = {}): Promise<Bo> {
  const t = await taoKhoa(db, { code: `CI-ONLD-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const cid = t.courseId;
  const cau = async (input: Omit<Parameters<typeof luuCauHoi>[1], "courseId">) => {
    const r = await luuCauHoi(db, { courseId: cid, ...input }, "u");
    if (!r.ok) throw new Error(r.thongBao);
    return r.id;
  };
  const chonMot = await cau({ type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "a", explanation: "vì 1+1=2" });
  const chonNhieu = await cau({ type: "MULTIPLE_CHOICE", stem: "Số chẵn?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }, { id: "c", text: "4" }], correct: ["a", "c"] });
  const ngan = await cau({ type: "SHORT_TEXT", stem: "Thủ đô VN?", accepted: ["Hà Nội"] });
  const dungSai = await cau({ type: "TRUE_FALSE", stem: "Robot có động cơ?", correct: true });
  const tuLuan = await cau({ type: "ESSAY", stem: "Mô tả robot của em", points: 4 });
  const de = async (kind: DeThiInput["kind"], title: string, ds: string[], extra: Partial<DeThiInput> = {}) => {
    const r = await luuDeThi(db, { courseId: cid, kind, title, passPercent: 70, status: "ACTIVE", cau: ds.map((questionId) => ({ questionId })), ...extra }, "u");
    if (!r.ok) throw new Error(r.thongBao);
    return r.id;
  };
  const deQuiz = await de("QUIZ", "Kiểm tra chương 1", [chonMot, chonNhieu, ngan, dungSai], { maxAttempts: o.maxLuot ?? null, timeLimitMin: o.gioiHanPhut ?? null });
  const deTl = await de("ASSIGNMENT", "Bài tập tự luận", [chonMot, tuLuan], { passPercent: 50 });
  const deThi = await de("FINAL_EXAM", "Thi cuối khoá", [chonMot, dungSai], { passPercent: 100 });

  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("c");
  const bai = async (kind: "VIDEO" | "QUIZ" | "ASSIGNMENT" | "FINAL_EXAM", title: string, nd: object) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind, title, contentJson: nd });
    if (!r.ok) throw new Error(r.thongBao);
    return r.stableId;
  };
  const video = await bai("VIDEO", "V", { mediaRef: "online/video/ci/m1.mp4" });
  const quiz = await bai("QUIZ", "Q", { assessmentId: deQuiz });
  const tl = await bai("ASSIGNMENT", "TL", { assessmentId: deTl });
  const thi = await bai("FINAL_EXAM", "Thi", { assessmentId: deThi });
  const cd = { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: o.moBai ?? ("MO_HET" as const), thiCuoiKhoa: { bat: true, diemDat: 100, soLanThi: null, phut: null }, xemKetQua: o.xemKetQua ?? ("DIEM_VA_DUNG_SAI" as const), ...(o.hienDapAn ? { hienDapAn: o.hienDapAn, dongDapAnLuc: o.dongDapAnLuc ?? null } : {}) };
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: cd });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, cid, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: cid, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: cid, saleStatus: "ON_SALE" });
  return { courseId: cid, slug: t.slug, quiz, tl, thi, video, deQuiz, deTl, deThi, cau: { chonMot, chonNhieu, ngan, tuLuan, dungSai } };
}

async function conHoc(o: { thuHoi?: boolean } = {}) {
  const ph = await phuHuynh("ph");
  const hv = await hocVien(ph.id, "hv");
  return { ph, hv, args: (b: Bo, lessonStableId: string, now = NOW) => ({ parentUserId: ph.id, studentId: hv.id, courseId: b.courseId, lessonStableId, now }), thuHoi: o.thuHoi };
}
const cap = async (hvId: string, b: Bo) => {
  const r = await capQuyenHoc(db, { studentId: hvId, courseId: b.courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("m") });
  if (!r.ok) throw new Error(r.thongBao);
  return r.entitlementId;
};
const DUNG_QUIZ = (b: Bo) => ({ [b.cau.chonMot]: "a", [b.cau.chonNhieu]: ["a", "c"], [b.cau.ngan]: "  hà nội. ", [b.cau.dungSai]: true });

describe.skipIf(!RUN_DB_TESTS)("[ONL-DG] soạn câu hỏi + đề (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-DG-01] 🔴 câu hỏi sai bị từ chối ở máy chủ; đề chỉ dùng câu của CHÍNH khoá; câu trùng/đề rỗng đang dùng bị từ chối; đề nháp rỗng được", async () => {
    const a = await dungBo();
    const b = await dungBo();
    expect(await luuCauHoi(db, { courseId: a.courseId, type: "SINGLE_CHOICE", stem: "x", options: [{ id: "a", text: "1" }, { id: "b", text: "2" }], correct: "z" }, null)).toMatchObject({ ok: false, ma: "CAU_HOI_KHONG_HOP_LE" });
    expect(await luuCauHoi(db, { courseId: "khong-co", type: "ESSAY", stem: "x" }, null)).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
    const base = { courseId: a.courseId, kind: "QUIZ" as const, title: "T", passPercent: 70 };
    expect(await luuDeThi(db, { ...base, status: "ACTIVE", cau: [{ questionId: b.cau.chonMot }] }, null)).toMatchObject({ ok: false, ma: "CAU_HOI_KHAC_KHOA" });
    expect(await luuDeThi(db, { ...base, status: "ACTIVE", cau: [{ questionId: a.cau.chonMot }, { questionId: a.cau.chonMot }] }, null)).toMatchObject({ ok: false, ma: "CAU_HOI_TRUNG" });
    expect(await luuDeThi(db, { ...base, status: "ACTIVE", cau: [] }, null)).toMatchObject({ ok: false, ma: "DE_CAN_CAU_HOI" });
    expect(await luuDeThi(db, { ...base, status: "ACTIVE", cau: [{ questionId: "khong-co" }] }, null)).toMatchObject({ ok: false, ma: "CAU_HOI_KHONG_TON_TAI" });
    expect((await luuDeThi(db, { ...base, status: "DRAFT", cau: [] }, null)).ok).toBe(true); // đối chứng dương: nháp rỗng OK
    expect((await luuDeThi(db, { ...base, status: "ACTIVE", cau: [{ questionId: a.cau.chonMot }] }, null)).ok).toBe(true);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-DG] làm bài (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-DG-02] 🔴 bắt đầu: đề KHÔNG kèm đáp án/giải thích; bắt đầu lại ⇒ TIẾP TỤC cùng lượt; người lạ/không quyền/thu hồi/bài không phải đánh giá/chưa gắn đề bị chặn", async () => {
    const b = await dungBo();
    const c = await conHoc();
    await cap(c.hv.id, b);
    const r = await batDauLamBai(db, c.args(b, b.quiz));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.luot);
    for (const cam of ["correct", "accepted", "vì 1+1=2", "explanation", "answerKey"]) expect(json.includes(cam), cam).toBe(false);
    expect(json).toContain("1+1=?"); // đối chứng dương: đề có nội dung
    expect(r.luot).toMatchObject({ soLuot: 1, daTiepTuc: false });
    const lai = await batDauLamBai(db, c.args(b, b.quiz));
    expect(lai.ok && lai.luot).toMatchObject({ attemptId: r.luot.attemptId, daTiepTuc: true });
    expect(await db.onlAttempt.count({ where: { studentId: c.hv.id } })).toBe(1);

    const la = await phuHuynh("la");
    expect(await batDauLamBai(db, { ...c.args(b, b.quiz), parentUserId: la.id })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
    const c2 = await conHoc();
    expect(await batDauLamBai(db, c2.args(b, b.quiz))).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await batDauLamBai(db, c.args(b, b.video))).toMatchObject({ ok: false, ma: "BAI_KHONG_PHAI_DANH_GIA" });
    expect(await batDauLamBai(db, c.args(b, "khong-co"))).toMatchObject({ ok: false, ma: "BAI_KHONG_TON_TAI" });
    await thuHoiQuyenHoc(db, { studentId: c.hv.id, courseId: b.courseId, reason: "Hoàn tiền đơn hàng", idempotencyKey: khoaKey("th"), now: NOW });
    expect(await batDauLamBai(db, c.args(b, b.quiz))).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
  });

  it("[ONL-DG-03] 🔴 nộp bài ĐẠT: chấm đúng (chọn nhiều theo tập, câu ngắn bỏ hoa/dấu câu), tiến độ bài COMPLETED + bestScore, nộp lại cùng lượt ⇒ cùng kết quả (idempotent), lượt của người khác bị từ chối", async () => {
    const b = await dungBo();
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    const bd = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd.ok) throw new Error("bd");
    const nop = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi: DUNG_QUIZ(b) });
    expect(nop).toMatchObject({ ok: true, daNopTruocDo: false, trangThai: "GRADED", ketQua: { scorePercent: 100, passed: true, daChamXong: true } });
    expect(JSON.stringify(nop)).not.toContain("dapAnDung"); // DIEM_VA_DUNG_SAI: có đúng/sai, KHÔNG đáp án
    const td = await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: e, lessonStableId: b.quiz } } });
    expect(td).toMatchObject({ status: "COMPLETED", percent: 100, bestScore: 100, completedVersionNumber: 1 });
    const lai = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi: { [b.cau.chonMot]: "b" } }); // nộp lại với đáp án KHÁC
    expect(lai).toMatchObject({ ok: true, daNopTruocDo: true, ketQua: { scorePercent: 100, passed: true } }); // kết quả cũ, không chấm lại
    const luotNguoiKhac = await conHoc();
    await cap(luotNguoiKhac.hv.id, b);
    expect(await nopBai(db, { ...luotNguoiKhac.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi: {} })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: bd.luot.attemptId } })).toMatchObject({ status: "GRADED", scorePercent: 100, passed: true });
  });

  it("[ONL-DG-04] 🔴 không đạt ⇒ bài vẫn IN_PROGRESS, giữ điểm TỐT NHẤT; lượt sau đạt ⇒ COMPLETED; đã COMPLETED KHÔNG bị hạ bởi lượt điểm thấp; D2: thi lại KHÔNG giới hạn (không còn HET_LUOT)", async () => {
    const b = await dungBo({ maxLuot: 3 });
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    const lam = async (traLoi: Record<string, unknown>) => {
      const bd = await batDauLamBai(db, c.args(b, b.quiz));
      if (!bd.ok) throw new Error(bd.thongBao);
      return nopBai(db, { ...c.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi });
    };
    const td = () => db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: e, lessonStableId: b.quiz } } });
    expect(await lam({ [b.cau.chonMot]: "a", [b.cau.dungSai]: true })).toMatchObject({ ketQua: { scorePercent: 50, passed: false } }); // 2/4
    expect(await td()).toMatchObject({ status: "IN_PROGRESS", bestScore: 50, completedAt: null });
    expect(await lam({ [b.cau.chonMot]: "b" })).toMatchObject({ ketQua: { scorePercent: 0, passed: false } });
    expect(await td()).toMatchObject({ status: "IN_PROGRESS", bestScore: 50 }); // điểm tốt nhất KHÔNG bị lượt thấp hơn đè
    expect(await lam(DUNG_QUIZ(b))).toMatchObject({ ketQua: { scorePercent: 100, passed: true } });
    expect(await td()).toMatchObject({ status: "COMPLETED", bestScore: 100 });
    // D2 (Owner 21/11/2026): thi lại KHÔNG giới hạn — `maxAttempts` đã cấu hình 3 nhưng KHÔNG còn chặn
    for (let i = 4; i <= 6; i++) {
      const l = await batDauLamBai(db, c.args(b, b.quiz));
      expect(l.ok && l.luot.soLuot).toBe(i);
      if (l.ok) await nopBai(db, { ...c.args(b, b.quiz), attemptId: l.luot.attemptId, traLoi: {} });
    }
    expect(await db.onlAttempt.count({ where: { studentId: c.hv.id } })).toBe(6);
    expect(await td()).toMatchObject({ status: "COMPLETED", bestScore: 100 }); // lượt điểm thấp sau đó vẫn không hạ tiến độ
  });

  it("[ONL-DG-05] 🔴 SNAPSHOT: sửa đáp án đúng + lưu trữ câu hỏi SAU khi bắt đầu KHÔNG đổi cách chấm lượt đang làm; lượt MỚI dùng đề mới (bỏ câu đã lưu trữ)", async () => {
    const b = await dungBo();
    const c = await conHoc();
    await cap(c.hv.id, b);
    const bd = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd.ok) throw new Error("bd");
    // giáo viên đổi đáp án đúng của câu 1 thành "b" và lưu trữ câu đúng/sai
    expect((await luuCauHoi(db, { id: b.cau.chonMot, courseId: b.courseId, type: "SINGLE_CHOICE", stem: "1+1=?", options: [{ id: "a", text: "2" }, { id: "b", text: "3" }], correct: "b" }, "u")).ok).toBe(true);
    await db.onlQuestion.update({ where: { id: b.cau.dungSai }, data: { status: "ARCHIVED" } });
    const nop = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi: DUNG_QUIZ(b) });
    expect(nop).toMatchObject({ ok: true, ketQua: { scorePercent: 100, passed: true } }); // vẫn chấm theo đề + đáp án LÚC BẮT ĐẦU
    // lượt mới: đáp án "a" nay SAI (đáp án đúng là b) và chỉ còn 3 câu
    const bd2 = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd2.ok) throw new Error("bd2");
    expect(bd2.luot.de.cau).toHaveLength(3);
    const nop2 = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd2.luot.attemptId, traLoi: DUNG_QUIZ(b) });
    expect(nop2).toMatchObject({ ok: true, ketQua: { scorePercent: 66, passed: false } });
  });

  it("[ONL-DG-06] 🔴 giới hạn thời gian: nộp trong dung sai 60 giây ⇒ chấm; quá dung sai ⇒ HET_GIO, lượt EXPIRED tính là đã dùng, bắt đầu lại tạo lượt 2; bắt đầu khi lượt cũ quá hạn ⇒ lượt cũ EXPIRED", async () => {
    const b = await dungBo({ gioiHanPhut: 10, maxLuot: 3 });
    const c = await conHoc();
    await cap(c.hv.id, b);
    const l1 = await batDauLamBai(db, c.args(b, b.quiz));
    if (!l1.ok) throw new Error("l1");
    expect(l1.luot.hetGioLuc?.toISOString()).toBe(sau(10).toISOString());
    expect(await nopBai(db, { ...c.args(b, b.quiz, sau(10.5)), attemptId: l1.luot.attemptId, traLoi: DUNG_QUIZ(b) })).toMatchObject({ ok: true, ketQua: { passed: true } }); // 30 giây sau hạn: trong dung sai
    const l2 = await batDauLamBai(db, c.args(b, b.quiz, sau(20)));
    if (!l2.ok) throw new Error("l2");
    expect(l2.luot.soLuot).toBe(2);
    expect(await nopBai(db, { ...c.args(b, b.quiz, sau(32)), attemptId: l2.luot.attemptId, traLoi: DUNG_QUIZ(b) })).toMatchObject({ ok: false, ma: "HET_GIO" }); // 2 phút sau hạn
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.luot.attemptId } })).status).toBe("EXPIRED");
    const l3 = await batDauLamBai(db, c.args(b, b.quiz, sau(40)));
    expect(l3.ok && l3.luot.soLuot).toBe(3);
    // lượt 3 bỏ dở, 20 phút sau bắt đầu lại ⇒ lượt 3 bị đóng EXPIRED và (D2) bắt đầu được lượt 4 — không còn hết lượt
    expect(await batDauLamBai(db, c.args(b, b.quiz, sau(70)))).toMatchObject({ ok: true });
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l3.ok ? l3.luot.attemptId : "" } })).status).toBe("EXPIRED");
  });

  it("[ONL-DG-07] 🔴 NHIỀU thiết bị cùng bấm Bắt đầu SONG SONG (8 lượt) ⇒ đúng MỘT lượt; đúng một lời gọi tạo mới, các lời gọi còn lại tiếp tục lượt đó", async () => {
    const b = await dungBo();
    const c = await conHoc();
    await cap(c.hv.id, b);
    const kq = await Promise.all(Array.from({ length: 8 }, () => batDauLamBai(db, c.args(b, b.quiz))));
    expect(kq.every((r) => r.ok)).toBe(true);
    const ids = new Set(kq.map((r) => (r.ok ? r.luot.attemptId : "")));
    expect(ids.size).toBe(1);
    expect(kq.filter((r) => r.ok && !r.luot.daTiepTuc)).toHaveLength(1);
    expect(await db.onlAttempt.count({ where: { studentId: c.hv.id } })).toBe(1);
  });

  it("[ONL-DG-08] thứ tự mở bài áp cho cả bắt đầu làm bài: KHI_BAI_TRUOC_XONG ⇒ quiz chưa mở khi video chưa xong", async () => {
    const b = await dungBo({ moBai: "KHI_BAI_TRUOC_XONG" });
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    expect(await batDauLamBai(db, c.args(b, b.quiz))).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" });
    await db.onlLessonProgress.create({ data: { entitlementId: e, lessonStableId: b.video, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    expect((await batDauLamBai(db, c.args(b, b.quiz))).ok).toBe(true);
    expect(await batDauLamBai(db, c.args(b, b.thi))).toMatchObject({ ok: false, ma: "BAI_CHUA_MO" }); // thi cuối chưa đủ % bài bắt buộc
  });

  it("[ONL-DG-09] 🔴 'CA_DAP_AN_SAU_HET_LUOT': còn lượt + chưa đạt ⇒ KHÔNG lộ đáp án ở kết quả; xem lại các lượt đúng theo cài đặt", async () => {
    const b = await dungBo({ maxLuot: 2, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" });
    const c = await conHoc();
    await cap(c.hv.id, b);
    const bd = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd.ok) throw new Error("bd");
    const nop = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd.luot.attemptId, traLoi: { [b.cau.chonMot]: "b" } });
    expect(nop.ok && JSON.stringify(nop.ketQua)).not.toContain("dapAnDung"); // chưa đạt
    const bd2 = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd2.ok) throw new Error("bd2");
    const nop2 = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd2.luot.attemptId, traLoi: { [b.cau.chonMot]: "b" } });
    expect(nop2.ok && JSON.stringify(nop2.ketQua)).not.toContain("dapAnDung"); // D2: KHÔNG còn "hết lượt" để mở khoá đáp án (thời điểm xem do Đào tạo cấu hình — D6, việc kế tiếp)
    const bd3 = await batDauLamBai(db, c.args(b, b.quiz));
    if (!bd3.ok) throw new Error("bd3");
    const nop3 = await nopBai(db, { ...c.args(b, b.quiz), attemptId: bd3.luot.attemptId, traLoi: DUNG_QUIZ(b) });
    expect(nop3.ok && JSON.stringify(nop3.ketQua)).toContain("dapAnDung"); // đã ĐẠT ⇒ xem được
    const ds = await docKetQuaCacLuot(db, c.args(b, b.quiz));
    expect(ds.ok && ds.luot.map((l) => l.soLuot)).toEqual([1, 2, 3]);
    expect(ds.ok && JSON.stringify(ds.luot[0]!.ketQua)).not.toContain("dapAnDung"); // lượt chưa đạt vẫn không lộ (D6 sẽ cho Đào tạo chọn thời điểm)
    expect(ds.ok && JSON.stringify(ds.luot[2]!.ketQua)).toContain("dapAnDung"); // lượt đã đạt thì xem được
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-DG-D6] chính sách hiện đáp án do Đào tạo chọn (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  const lamSai = async (b: Bo, c: Awaited<ReturnType<typeof conHoc>>, now: Date) => {
    const bd = await batDauLamBai(db, c.args(b, b.quiz, now));
    if (!bd.ok) throw new Error(bd.thongBao);
    const r = await nopBai(db, { ...c.args(b, b.quiz, now), attemptId: bd.luot.attemptId, traLoi: { [b.cau.chonMot]: "b" } });
    if (!r.ok) throw new Error("nop");
    return JSON.stringify(r.ketQua).includes("dapAnDung");
  };

  it("[ONL-DG-D6-01] 🔴 SAU_KHI_NOP lộ ngay (kể cả lượt chưa đạt); KHONG_BAO_GIO không lộ kể cả lượt ĐẠT; đối chứng: hai chế độ cho kết quả KHÁC nhau trên cùng một bài", async () => {
    const sau = await dungBo({ hienDapAn: "SAU_KHI_NOP" });
    const cs = await conHoc();
    await cap(cs.hv.id, sau);
    expect(await lamSai(sau, cs, NOW)).toBe(true);
    const khong = await dungBo({ hienDapAn: "KHONG_BAO_GIO" });
    const ck = await conHoc();
    await cap(ck.hv.id, khong);
    expect(await lamSai(khong, ck, NOW)).toBe(false);
    const bd = await batDauLamBai(db, ck.args(khong, khong.quiz, NOW));
    if (!bd.ok) throw new Error("bd");
    const dat = await nopBai(db, { ...ck.args(khong, khong.quiz, NOW), attemptId: bd.luot.attemptId, traLoi: DUNG_QUIZ(khong) });
    expect(dat.ok && dat.ketQua.passed).toBe(true);
    expect(dat.ok && JSON.stringify(dat.ketQua)).not.toContain("dapAnDung"); // đã ĐẠT nhưng chính sách = không bao giờ
  });

  it("[ONL-DG-D6-02] 🔴 SAU_KHI_DE_DONG: trước mốc không lộ; từ mốc thì lộ — và lượt ĐÃ NỘP trước đó xem lại ở `docKetQuaCacLuot` cũng đổi theo mốc (đọc lúc xem, không đóng băng)", async () => {
    const mocLuc = new Date(NOW.getTime() + 3 * 3600_000);
    const b = await dungBo({ hienDapAn: "SAU_KHI_DE_DONG", dongDapAnLuc: mocLuc.toISOString() });
    const c = await conHoc();
    await cap(c.hv.id, b);
    expect(await lamSai(b, c, NOW)).toBe(false);
    const truoc = await docKetQuaCacLuot(db, c.args(b, b.quiz, new Date(mocLuc.getTime() - 1)));
    expect(truoc.ok && JSON.stringify(truoc.luot[0]!.ketQua)).not.toContain("dapAnDung");
    const sauMoc = await docKetQuaCacLuot(db, c.args(b, b.quiz, mocLuc));
    expect(sauMoc.ok && JSON.stringify(sauMoc.luot[0]!.ketQua)).toContain("dapAnDung");
    // mốc trống ⇒ đóng
    const bt = await dungBo({ hienDapAn: "SAU_KHI_DE_DONG", dongDapAnLuc: null });
    const ct = await conHoc();
    await cap(ct.hv.id, bt);
    expect(await lamSai(bt, ct, NOW)).toBe(false);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-DG] tự luận + chứng nhận (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-DG-10] 🔴 tự luận: nộp ⇒ SUBMITTED (chưa kết luận, bài CHƯA hoàn thành); vào hàng chờ chấm; điểm vượt tối đa bị từ chối; chấm đủ ⇒ GRADED + tiến độ; chấm lại bị từ chối", async () => {
    const b = await dungBo();
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    const bd = await batDauLamBai(db, c.args(b, b.tl));
    if (!bd.ok) throw new Error("bd");
    const nop = await nopBai(db, { ...c.args(b, b.tl), attemptId: bd.luot.attemptId, traLoi: { [b.cau.chonMot]: "a", [b.cau.tuLuan]: "Robot của em có bốn bánh." } });
    expect(nop).toMatchObject({ ok: true, trangThai: "SUBMITTED", ketQua: { passed: null, scorePercent: null, daChamXong: false } });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: e, lessonStableId: b.tl } })).toBe(0); // chưa chấm ⇒ chưa ghi tiến độ
    const hang = await danhSachChoCham(db, b.courseId);
    expect(hang.map((x) => x.id)).toContain(bd.luot.attemptId);
    expect(await chamTay(db, { attemptId: bd.luot.attemptId, diem: { [b.cau.tuLuan]: 99 }, graderUserId: "gv", now: sau(5) })).toMatchObject({ ok: false, ma: "DIEM_TU_LUAN_KHONG_HOP_LE" });
    expect(await chamTay(db, { attemptId: bd.luot.attemptId, diem: {}, graderUserId: "gv", now: sau(5) })).toMatchObject({ ok: false, ma: "DIEM_TU_LUAN_KHONG_HOP_LE" });
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: bd.luot.attemptId } })).toMatchObject({ status: "SUBMITTED" }); // từ chối ⇒ chưa đổi gì
    const ok = await chamTay(db, { attemptId: bd.luot.attemptId, diem: { [b.cau.tuLuan]: 3 }, feedback: "Làm tốt", graderUserId: "gv", now: sau(5) });
    expect(ok).toMatchObject({ ok: true, scorePercent: 80, passed: true }); // câu chọn một 1/1 + tự luận 3/4 ⇒ 4/5 = 80%
    expect(await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: e, lessonStableId: b.tl } } })).toMatchObject({ status: "COMPLETED" });
    expect(await chamTay(db, { attemptId: bd.luot.attemptId, diem: { [b.cau.tuLuan]: 4 }, graderUserId: "gv", now: sau(6) })).toMatchObject({ ok: false, ma: "DA_CHAM" });
  });

  it("[ONL-DG-D5-01] 🔴 CHẤM LẠI có kiểm soát: cần lý do; chỉ lượt ĐÃ chấm; lịch sử bất biến giữ nguyên văn lần TRƯỚC; điểm hiện hành = lần mới nhất; lên ĐẠT ⇒ hoàn thành; hai lần chấm lại ĐỒNG THỜI không mất mục nào", async () => {
    const b = await dungBo();
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    const bd = await batDauLamBai(db, c.args(b, b.tl));
    if (!bd.ok) throw new Error("bd");
    const id = bd.luot.attemptId;
    await nopBai(db, { ...c.args(b, b.tl), attemptId: id, traLoi: { [b.cau.chonMot]: "a", [b.cau.tuLuan]: "Robot của em có bốn bánh." } });
    const prog = () => db.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId: e, lessonStableId: b.tl } } });
    // Nguồn của nút "Chấm lại" trên màn: lượt CHƯA chấm không nằm trong danh sách đã chấm (đối chứng âm), và màn đọc lượt chưa chấm không mang điểm hiện hành
    expect((await danhSachDaCham(db, b.courseId)).map((x) => x.id)).not.toContain(id);
    expect(await docLuotDeCham(db, id)).toMatchObject({ daCham: false, diemHienTai: {}, lichSu: [] });
    // chưa chấm lần đầu ⇒ không chấm lại được (đối chứng: đường chấm thường vẫn dùng được)
    expect(await chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 4 }, lyDo: "Điểm đầu chưa hợp lý", graderUserId: "gv2", now: sau(4) })).toMatchObject({ ok: false, ma: "CHUA_CHAM" });
    expect(await chamTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 0 }, feedback: "Chưa đủ ý", graderUserId: "gv1", now: sau(5) })).toMatchObject({ ok: true, scorePercent: 20, passed: false }); // 1/5
    expect(await prog()).toMatchObject({ status: "IN_PROGRESS" });
    // lý do ngắn / điểm vượt tối đa ⇒ từ chối, không đổi gì, không ghi lịch sử
    expect(await chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 4 }, lyDo: "ngắn", graderUserId: "gv2", now: sau(6) })).toMatchObject({ ok: false, ma: "LY_DO_CHAM_LAI_QUA_NGAN" });
    expect(await chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 99 }, lyDo: "Học viên khiếu nại điểm", graderUserId: "gv2", now: sau(6) })).toMatchObject({ ok: false, ma: "DIEM_TU_LUAN_KHONG_HOP_LE" });
    expect(await docLichSuChamLai(db, id)).toEqual([]);
    const r1 = await chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 4 }, feedback: "Sau phúc khảo: đủ ý", lyDo: "Học viên khiếu nại điểm", graderUserId: "gv2", now: sau(7) });
    expect(r1).toMatchObject({ ok: true, lan: 1, scorePercent: 100, passed: true, canhBaoChungNhanDaCap: false });
    expect(await prog()).toMatchObject({ status: "COMPLETED" }); // chấm lại làm ĐẠT ⇒ hoàn thành
    const ls1 = await docLichSuChamLai(db, id);
    expect(ls1).toHaveLength(1);
    expect(ls1[0]).toMatchObject({ lan: 1, lyDo: "Học viên khiếu nại điểm", chamLaiBoi: "gv2", truoc: { scorePercent: 20, passed: false, feedback: "Chưa đủ ý", gradedByUserId: "gv1", diem: { [b.cau.tuLuan]: 0 } } });
    // hai lần chấm lại ĐỒNG THỜI ⇒ cả hai vào lịch sử (lan 1,2 theo thứ tự lấy được khoá), mục cũ KHÔNG đổi
    const [x, y] = await Promise.all([
      chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 2 }, lyDo: "Thống nhất lại thang điểm A", graderUserId: "gv3", now: sau(8) }),
      chamLaiTay(db, { attemptId: id, diem: { [b.cau.tuLuan]: 3 }, lyDo: "Thống nhất lại thang điểm B", graderUserId: "gv4", now: sau(8) }),
    ]);
    expect(x.ok && y.ok).toBe(true);
    const ls = await docLichSuChamLai(db, id);
    expect(ls.map((m) => m.lan)).toEqual([1, 2, 3]);
    expect(ls[0]).toEqual(ls1[0]); // bất biến
    expect(new Set([ls[1]!.chamLaiBoi, ls[2]!.chamLaiBoi])).toEqual(new Set(["gv3", "gv4"]));
    expect(ls[2]!.truoc.gradedByUserId).toBe(ls[1]!.chamLaiBoi); // chuỗi: "trước" của lần 3 = người chấm lần 2
    // màn chấm lại: lượt đã chấm vào danh sách; mở ra thấy điểm HIỆN HÀNH (lần mới nhất) + đủ lịch sử theo thứ tự lần
    const dsDa = await danhSachDaCham(db, b.courseId);
    expect(dsDa.find((x) => x.id === id)).toMatchObject({ number: 1, scorePercent: expect.any(Number) });
    const mo = await docLuotDeCham(db, id);
    expect(mo).toMatchObject({ daCham: true });
    expect(mo!.lichSu.map((m) => m.lan)).toEqual([1, 2, 3]);
    expect([2, 3]).toContain(mo!.diemHienTai[b.cau.tuLuan]); // lần chấm lại đồng thời cuối cùng thắng: điểm 2 hoặc 3, KHÔNG phải điểm cũ (0/4)
    // hạ xuống không đạt: tiến độ KHÔNG bị hạ (hoàn thành đã ghi); đây là bản ghi lượt, không phải thu hồi hoàn thành
    expect(await prog()).toMatchObject({ status: "COMPLETED" });
  });

  it("[ONL-DG-11] 🔴 CHỨNG NHẬN: cấp tự động ĐÚNG MỘT lần khi hoàn thành khoá (xong mọi bài bắt buộc + ĐẠT thi cuối); giữ nguyên qua thu hồi quyền / phát hành bản mới đặt lại tiến độ; snapshot tên", async () => {
    const b = await dungBo();
    const c = await conHoc();
    const e = await cap(c.hv.id, b);
    const lam = async (bai: string, traLoi: Record<string, unknown>) => {
      const bd = await batDauLamBai(db, c.args(b, bai));
      if (!bd.ok) throw new Error(`${bai}: ${bd.thongBao}`);
      return nopBai(db, { ...c.args(b, bai), attemptId: bd.luot.attemptId, traLoi });
    };
    await db.onlLessonProgress.create({ data: { entitlementId: e, lessonStableId: b.video, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    expect(await lam(b.quiz, DUNG_QUIZ(b))).toMatchObject({ ok: true, vuaCapChungNhan: false }); // còn bài tập tự luận + thi cuối
    expect(await db.onlCertificate.count({ where: { studentId: c.hv.id } })).toBe(0);
    // tự luận: nộp + chấm
    const tl = await batDauLamBai(db, c.args(b, b.tl));
    if (!tl.ok) throw new Error("tl");
    await nopBai(db, { ...c.args(b, b.tl), attemptId: tl.luot.attemptId, traLoi: { [b.cau.chonMot]: "a", [b.cau.tuLuan]: "bài viết" } });
    await chamTay(db, { attemptId: tl.luot.attemptId, diem: { [b.cau.tuLuan]: 4 }, graderUserId: "gv", now: sau(1) });
    expect(await db.onlCertificate.count({ where: { studentId: c.hv.id } })).toBe(0); // còn thi cuối
    // thi cuối: ngưỡng 100% — làm sai trước, rồi đúng
    expect(await lam(b.thi, { [b.cau.chonMot]: "b", [b.cau.dungSai]: true })).toMatchObject({ ok: true, ketQua: { passed: false }, vuaCapChungNhan: false });
    const cuoi = await lam(b.thi, { [b.cau.chonMot]: "a", [b.cau.dungSai]: true });
    expect(cuoi).toMatchObject({ ok: true, ketQua: { passed: true }, vuaCapChungNhan: true });
    expect(cuoi.ok && cuoi.chungNhan).toMatch(/^SRON[A-HJKMNP-Z2-9]{10}$/); // C10: cấp TỰ ĐỘNG dùng dạng mới
    const cn = await db.onlCertificate.findMany({ where: { studentId: c.hv.id } });
    expect(cn).toHaveLength(1);
    expect(cn[0]).toMatchObject({ status: "ISSUED", courseId: b.courseId, versionNumber: 1, finalScore: 100, issuedByUserId: null });
    expect(cn[0]!.studentName).toContain("CI_ONLD_hv"); // snapshot tên
    // đổi tên học viên ⇒ giấy đã cấp KHÔNG đổi
    await db.student.update({ where: { id: c.hv.id }, data: { name: `${P}Tên mới` } });
    expect((await db.onlCertificate.findUniqueOrThrow({ where: { id: cn[0]!.id } })).studentName).toContain("CI_ONLD_hv");
    // thi lại (đã đạt): không cấp thêm
    const lai = await lam(b.thi, { [b.cau.chonMot]: "a", [b.cau.dungSai]: true });
    expect(lai).toMatchObject({ ok: true, vuaCapChungNhan: false });
    expect(await db.onlCertificate.count({ where: { studentId: c.hv.id } })).toBe(1);

    // thu hồi quyền học: chứng nhận CÒN; học viên vẫn tra cứu được
    await thuHoiQuyenHoc(db, { studentId: c.hv.id, courseId: b.courseId, reason: "Hoàn tiền theo yêu cầu", idempotencyKey: khoaKey("th"), now: sau(10) });
    expect(await db.onlCertificate.count({ where: { studentId: c.hv.id, status: "ISSUED" } })).toBe(1);
    const ds = await docChungNhanCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id });
    expect(ds).toHaveLength(1);
    // C10: `code` là khoá (lưu SRON…), `maHienThi` là chuỗi cho người đọc; bản chụp trên giấy in dạng hiển thị
    expect(ds![0]!.maHienThi).toBe(`SR-ON-${ds![0]!.code.slice(4)}`);
    const giay = (await db.onlCertificate.findUniqueOrThrow({ where: { id: cn[0]!.id } })).renderSnapshotJson as { texts: { ngayMa: string } };
    expect(giay.texts.ngayMa).toContain(`Mã chứng nhận ${ds![0]!.maHienThi}`);

    // phát hành bản 2 với RESET theo chương: tiến độ đặt lại, lượt làm bài + điểm + chứng nhận GIỮ NGUYÊN
    const nhap = await moBanNhap(db, b.courseId, null);
    if (!nhap.ok) throw new Error("nhap");
    const chuong = await db.onlChapter.findFirstOrThrow({ where: { versionId: nhap.versionId } });
    const cs = { loai: "RESET_BY_SCOPE" as const, chuongStableIds: [chuong.stableId] };
    const xt = await xemTruocPhatHanh(db, b.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    expect(await phatHanh(db, { courseId: b.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, sau(20))).toMatchObject({ ok: true });
    expect(await db.onlCertificate.count({ where: { studentId: c.hv.id, status: "ISSUED" } })).toBe(1);
    expect(await db.onlAttempt.count({ where: { studentId: c.hv.id } })).toBeGreaterThanOrEqual(5);
    expect((await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: e, lessonStableId: b.thi } } })).bestScore).toBe(100); // điểm không bị đặt lại
  });

  it("[ONL-DG-12] 🔴 tra cứu công khai: che tên học viên, chứng nhận thu hồi vẫn tra được (trạng thái REVOKED); mã sai định dạng/không tồn tại ⇒ không hợp lệ; thu hồi cần lý do ≥ 10 ký tự; cấp tay cần quyền học + lý do, không cấp đôi", async () => {
    const b = await dungBo();
    const c = await conHoc();
    await cap(c.hv.id, b);
    expect(await capChungNhanTay(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "ngắn", now: NOW })).toMatchObject({ ok: false, ma: "LY_DO_QUA_NGAN" });
    const chuaCo = await conHoc();
    expect(await capChungNhanTay(db, { courseId: b.courseId, studentId: chuaCo.hv.id, actorUserId: "ad", reason: "Hoàn thành ngoài hệ thống", now: NOW })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    const tay = await capChungNhanTay(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "Hoàn thành ngoài hệ thống", now: NOW });
    expect(tay.ok).toBe(true);
    if (!tay.ok) return;
    expect(await capChungNhanTay(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "Cấp lần hai thử", now: NOW })).toMatchObject({ ok: false, ma: "DA_CO_CHUNG_NHAN" });
    // C10: cấp TAY cũng dạng mới; tra cứu nhận cả dạng lưu lẫn dạng in trên giấy
    expect(tay.code).toMatch(/^SRON[A-HJKMNP-Z2-9]{10}$/);
    const dangIn = `SR-ON-${tay.code.slice(4)}`;
    expect(await xacThucChungNhan(db, ` ${dangIn.toLowerCase()} `)).toMatchObject({ hopLe: true, trangThai: "ISSUED" });
    // C10: chứng nhận cấp TRƯỚC đó giữ nguyên mã (lưu + hiển thị) và vẫn tra được
    const cuHv = await conHoc();
    const cuQuyen = await cap(cuHv.hv.id, b);
    await db.onlCertificate.create({ data: { studentId: cuHv.hv.id, courseId: b.courseId, entitlementId: cuQuyen, code: "K7M2N9P4Q8", studentName: `${P}cu`, courseName: `${P}K`, courseCode: "K", versionNumber: 1, issuedAt: NOW } });
    expect(await xacThucChungNhan(db, "k7m2n9p4q8")).toMatchObject({ hopLe: true, trangThai: "ISSUED" });
    expect((await docChungNhanCuaHocVien(db, { parentUserId: cuHv.ph.id, studentId: cuHv.hv.id }))!.map((x) => [x.code, x.maHienThi])).toEqual([["K7M2N9P4Q8", "K7M2N9P4Q8"]]);
    expect(await xacThucChungNhan(db, "SR-ON-K7M2N9P4Q8")).toEqual({ hopLe: false }); // mã cũ không "đội" tiền tố mới
    const tc = await xacThucChungNhan(db, tay.code.toLowerCase());
    expect(tc).toMatchObject({ hopLe: true, trangThai: "ISSUED", khoa: expect.stringContaining(P), soBan: 1 });
    expect(tc.hopLe && tc.tenChe).toBe("C***"); // "CI_ONLD_hv-N" là MỘT từ ⇒ chỉ chữ cái đầu
    expect(JSON.stringify(tc)).not.toContain("CI_ONLD_hv");
    for (const sai of ["", "abc", "!!!!!!!!!!", "ZZZZZZZZZZ", "a".repeat(40)]) expect(await xacThucChungNhan(db, sai), sai).toEqual({ hopLe: false });
    expect(await thuHoiChungNhan(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "ngắn", now: NOW })).toMatchObject({ ok: false, ma: "LY_DO_QUA_NGAN" });
    expect((await thuHoiChungNhan(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "Cấp nhầm học viên khác", now: sau(1) })).ok).toBe(true);
    expect(await thuHoiChungNhan(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "Cấp nhầm học viên khác", now: sau(2) })).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect(await xacThucChungNhan(db, tay.code)).toMatchObject({ hopLe: true, trangThai: "REVOKED" });
    expect(await capChungNhanTay(db, { courseId: b.courseId, studentId: c.hv.id, actorUserId: "ad", reason: "Cấp lại sau thu hồi", now: sau(3) })).toMatchObject({ ok: false, ma: "DA_CO_CHUNG_NHAN" });
    void suaBai;
  });
});
