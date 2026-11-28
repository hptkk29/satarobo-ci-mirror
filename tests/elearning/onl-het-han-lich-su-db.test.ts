// @vitest-environment node
/**
 * [ONL-HH-*] D23 (Owner 25/11/2026, "HL-Onl-Khoa-lai") — KHOÁ HẾT HẠN: chỉ XEM lịch sử + kết quả; không làm bài mới / học tiếp / vào nội dung trả phí; cho mua lại / gia hạn; BẢO TOÀN lịch sử.
 * Postgres thật. Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG cùng bộ (trước hạn / sau mua lại thì được; THU HỒI thì vẫn chặn mọi nơi).
 * [ONL-HH-11..12] — F1 (review #1300): đề dùng chung / chuyển bài không được thành lối đọc lại chi tiết của lượt làm ở bài đã khoá.
 * [ONL-HH-07..10] — Owner 27/11/2026 (quyết định số 1): khoá "không cho xem lại bài đã qua" ⇒ VẪN xem được ĐIỂM + kết quả lịch sử, KHÔNG mở lại bài làm / đáp án / giải thích / đề / nội dung.
 * Owner chọn phương án A cho #1300 (27/11/2026): LUÔN cho xem điểm — cờ cũ `choXemDiemBaiKhoaXemLai` KHÔNG còn tác dụng (giữ trường để không đụng dữ liệu đã lưu).
 *
 * ⚠️ AN TOÀN DB: dọn bằng `donBangOnl` ở beforeAll VÀ afterAll; chỉ chạy trên DB thử.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { batDauLamBai, docKetQuaCacLuot, luuCauHoi, luuDeThi, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { docKhoaOnlineCuaHocVien, docMucLucKhoaCuaHocVien, ghiTienDoBai } from "../../lib/elearning-online/hoc-tap";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { docTrangThaiLuot, luuNhap } from "../../lib/elearning-online/luot-nhap-db";
import { docNoiDungBaiChoHocVien } from "../../lib/elearning-online/noi-dung-hoc-vien";
import { moBanNhap, themBai, themChuong, xoaBai } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { capVeMedia } from "../../lib/elearning-online/ve-media";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONL_HH_";
const T0 = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let n = 0;
const key = (t: string) => `${P}${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onl-hh-" } } });
}
const phuHuynh = (t: string) => db.user.create({ data: { name: `${P}${t}`, email: `ci-onl-hh-${t}-${Date.now()}-${++n}@example.test`, role: "PARENT" }, select: { id: true } });
const hocVien = (parentUserId: string, t: string) => db.student.create({ data: { name: `${P}${t}-${++n}`, parentUserId }, select: { id: true } });

type Khoa = { courseId: string; video: string; quiz: string; cauId: string; deId: string; quizB: string | null };
/** Chuỗi ĐÁNH DẤU của đề: ca "không lộ" tìm đúng các chuỗi này trong JSON trả về (đối chứng dương: khi KHÔNG khoá thì đáp án + giải thích CÓ trong JSON). */
const DE = { tenDe: "MARKER_TEN_DE", stem: "MARKER_THAN_CAU_HOI 1+1=?", dung: "lc_marker_dung", sai: "lc_marker_sai", chuDung: "MARKER_LUA_CHON_DUNG", chuSai: "MARKER_LUA_CHON_SAI", giaiThich: "MARKER_GIAI_THICH" };
/** Khoá HẠN 1 THÁNG: video + quiz (1 câu chọn một). MO_HET, không giới hạn lượt/thời gian. `haiBaiChungDe` ⇒ thêm bài quiz B gắn CÙNG đề. */
async function dungKhoa(tuyChon: { haiBaiChungDe?: boolean } = {}): Promise<Khoa> {
  const t = await taoKhoa(db, { code: `CI-ONL-HH-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: true }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await luuCauHoi(db, { courseId: t.courseId, type: "SINGLE_CHOICE", stem: DE.stem, options: [{ id: DE.dung, text: DE.chuDung }, { id: DE.sai, text: DE.chuSai }], correct: DE.dung, explanation: DE.giaiThich } as never, "u");
  if (!c.ok) throw new Error(c.thongBao);
  const de = await luuDeThi(db, { courseId: t.courseId, kind: "QUIZ", title: DE.tenDe, passPercent: 50, status: "ACTIVE", cau: [{ questionId: c.id }], maxAttempts: null, timeLimitMin: null } as never, "u");
  if (!de.ok) throw new Error(de.thongBao);
  const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
  if (!ch.ok) throw new Error("chuong");
  const v = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "VIDEO", title: "V", contentJson: { mediaRef: "online/video/ci/hh1.mp4" } });
  const q = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Q", contentJson: { assessmentId: de.id } });
  if (!v.ok || !q.ok) throw new Error("bai");
  let quizB: string | null = null;
  if (tuyChon.haiBaiChungDe) {
    const q2 = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "QUIZ", title: "Q-B", contentJson: { assessmentId: de.id } });
    if (!q2.ok) throw new Error("bai B");
    quizB = q2.stableId;
  }
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, T0);
  if (!ph.ok) throw new Error(ph.thongBao);
  await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, video: v.stableId, quiz: q.stableId, cauId: c.id, deId: de.id, quizB };
}
const capMienPhi = async (studentId: string, courseId: string, now = T0) => {
  const r = await capQuyenHoc(db, { studentId, courseId, loai: "CAP_MIEN_PHI", now, idempotencyKey: key("cap") });
  if (!r.ok) throw new Error(r.thongBao);
  return r;
};

/** Một con đã học: có quyền, đã NỘP một lượt quiz (đúng) trước hạn, và còn MỘT lượt đang làm dở. */
async function conDaHoc() {
  const ph = await phuHuynh("ph");
  const hv = await hocVien(ph.id, "hv");
  const k = await dungKhoa();
  const q = await capMienPhi(hv.id, k.courseId);
  const args = (lessonStableId: string, now: Date) => ({ parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId, now });
  const sauMotNgay = new Date(T0.getTime() + 86_400_000);
  const bd1 = await batDauLamBai(db, args(k.quiz, sauMotNgay));
  if (!bd1.ok) throw new Error("bd1");
  const nop = await nopBai(db, { ...args(k.quiz, sauMotNgay), attemptId: bd1.luot.attemptId, traLoi: { [k.cauId]: DE.dung } });
  if (!nop.ok) throw new Error("nop");
  const bd2 = await batDauLamBai(db, args(k.quiz, sauMotNgay));
  if (!bd2.ok) throw new Error("bd2");
  const hetHan = new Date(q.hetHan!.getTime() + 60_000); // 1 phút sau hạn
  return { ph, hv, k, q, args, daNop: bd1.luot.attemptId, dangLam: bd2.luot.attemptId, sauMotNgay, hetHan };
}

const banDangChay = async (courseId: string) => (await db.onlCourse.findUniqueOrThrow({ where: { id: courseId }, select: { publishedVersionId: true } })).publishedVersionId!;
/** Ghi đè cài đặt của BẢN ĐANG CHẠY (nền `caiDatKhoiDauChoBanNhap` + MO_HET). */
const datCaiDatBan = async (courseId: string, them: object) =>
  db.onlCourseVersion.update({ where: { id: await banDangChay(courseId) }, data: { settingsJson: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET", ...them } as object } });

describe.skipIf(!RUN_DB_TESTS)("[ONL-HH] D23 — khoá hết hạn: chỉ xem lịch sử + kết quả (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-HH-01] 🔴 MỤC LỤC khi hết hạn: ok + hetHan:true, giữ TIẾN ĐỘ từng bài, KHÔNG bài nào mở (mo:false), KHÔNG lộ nội dung; đối chứng dương: trước hạn hetHan:false và bài mở được", async () => {
    const c = await conDaHoc();
    const truoc = await docMucLucKhoaCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id, courseId: c.k.courseId, now: c.sauMotNgay });
    expect(truoc.ok).toBe(true);
    if (!truoc.ok) return;
    expect((truoc as { hetHan?: boolean }).hetHan).toBe(false);
    expect(truoc.bai.every((b) => b.mo.mo === true)).toBe(true);
    const sau = await docMucLucKhoaCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id, courseId: c.k.courseId, now: c.hetHan });
    expect(sau.ok, "hết hạn vẫn xem được mục lục (D23)").toBe(true);
    if (!sau.ok) return;
    expect((sau as { hetHan?: boolean }).hetHan).toBe(true);
    expect(sau.bai.length).toBe(truoc.bai.length);
    expect(sau.bai.every((b) => b.mo.mo === false), "không bài nào mở được khi hết hạn").toBe(true);
    // tiến độ từng bài được GIỮ (không bị xoá/đổi khi hết hạn)
    expect(sau.bai.map((b) => [b.stableId, b.trangThai, b.percent])).toEqual(truoc.bai.map((b) => [b.stableId, b.trangThai, b.percent]));
    expect(sau.tienDo).toEqual(truoc.tienDo);
    expect(JSON.stringify(sau)).not.toContain("mediaRef");
    expect(JSON.stringify(sau)).not.toContain("online/video/");
  });

  it("[ONL-HH-02] 🔴 KẾT QUẢ các lượt khi hết hạn: đọc được, GIỐNG HỆT trước hạn; đối chứng âm: người khác (phụ huynh lạ) vẫn bị chặn", async () => {
    const c = await conDaHoc();
    const truoc = await docKetQuaCacLuot(db, c.args(c.k.quiz, c.sauMotNgay));
    expect(truoc.ok).toBe(true);
    if (!truoc.ok) return;
    expect(truoc.luot.length).toBe(1);
    const sau = await docKetQuaCacLuot(db, c.args(c.k.quiz, c.hetHan));
    expect(sau.ok, "hết hạn vẫn xem được kết quả (D23)").toBe(true);
    if (!sau.ok) return;
    expect(sau.luot).toEqual(truoc.luot);
    const la = await phuHuynh("la");
    expect(await docKetQuaCacLuot(db, { ...c.args(c.k.quiz, c.hetHan), parentUserId: la.id })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
  });

  it("[ONL-HH-03] 🔴 hết hạn vẫn CHẶN mọi đường ghi/vào nội dung: nội dung bài, ghi tiến độ, bắt đầu/nộp/lưu nháp lượt, vé video; đối chứng dương: các đường đó chạy được TRƯỚC hạn", async () => {
    const c = await conDaHoc();
    // dương (trước hạn)
    expect((await docNoiDungBaiChoHocVien(db, c.args(c.k.video, c.sauMotNgay))).ok).toBe(true);
    expect((await capVeMedia(db, c.args(c.k.video, c.sauMotNgay))).ok).toBe(true);
    // âm (sau hạn)
    const chan = (kq: { ok: boolean; ma?: string }, ten: string) => {
      expect(kq.ok, `${ten} phải bị chặn khi hết hạn`).toBe(false);
      expect(kq.ma, ten).toBe("HET_HAN");
    };
    chan(await docNoiDungBaiChoHocVien(db, c.args(c.k.video, c.hetHan)), "nội dung bài");
    chan(await capVeMedia(db, c.args(c.k.video, c.hetHan)) as never, "vé video");
    chan(await ghiTienDoBai(db, { ...c.args(c.k.video, c.hetHan), percent: 50 } as never), "ghi tiến độ");
    chan(await batDauLamBai(db, c.args(c.k.quiz, c.hetHan)) as never, "bắt đầu làm bài");
    chan(await nopBai(db, { ...c.args(c.k.quiz, c.hetHan), attemptId: c.dangLam, traLoi: { [c.k.cauId]: DE.dung } }) as never, "nộp bài");
    const nhap = await luuNhap(db, { ...c.args(c.k.quiz, c.hetHan), attemptId: c.dangLam, yeuCau: { requestId: key("nhap"), items: [{ questionId: c.k.cauId, answer: DE.dung, baseRevision: 0 }] } });
    expect(nhap.ok, "lưu nháp phải bị chặn khi hết hạn").toBe(false);
  });

  it("[ONL-HH-04] 🔴 THU HỒI vẫn chặn MỌI nơi (mục lục, kết quả, nội dung) — D23 chỉ nới cho HẾT HẠN; đối chứng dương: cùng khoá, con hết hạn thì xem được", async () => {
    const c = await conDaHoc();
    const ph2 = await phuHuynh("ph2");
    const hv2 = await hocVien(ph2.id, "hv2");
    await capMienPhi(hv2.id, c.k.courseId);
    const th = await thuHoiQuyenHoc(db, { studentId: hv2.id, courseId: c.k.courseId, reason: "thu hồi thử nghiệm D23", idempotencyKey: key("th"), now: c.sauMotNgay });
    expect(th.ok).toBe(true);
    const a2 = (l: string) => ({ parentUserId: ph2.id, studentId: hv2.id, courseId: c.k.courseId, lessonStableId: l, now: c.sauMotNgay });
    expect(await docMucLucKhoaCuaHocVien(db, { ...a2(c.k.quiz), lessonStableId: undefined } as never)).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect(await docKetQuaCacLuot(db, a2(c.k.quiz))).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    expect(await docNoiDungBaiChoHocVien(db, a2(c.k.video))).toMatchObject({ ok: false, ma: "DA_THU_HOI" });
    // dương: con hết hạn (cùng khoá) xem được
    expect((await docMucLucKhoaCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id, courseId: c.k.courseId, now: c.hetHan })).ok).toBe(true);
  });

  it("[ONL-HH-05] 🔴 MUA LẠI sau hết hạn: CÙNG dòng quyền, BẢO TOÀN lịch sử (lượt đã nộp + tiến độ + lượt đang làm); mở lại được nội dung; mục lục hetHan:false; kết quả cũ còn nguyên", async () => {
    const c = await conDaHoc();
    const kqTruoc = await docKetQuaCacLuot(db, c.args(c.k.quiz, c.hetHan));
    expect(kqTruoc.ok).toBe(true);
    const soLuotTruoc = await db.onlAttempt.count({ where: { entitlementId: c.q.entitlementId } });
    const soTienDoTruoc = await db.onlLessonProgress.count({ where: { entitlementId: c.q.entitlementId } });
    expect((await docNoiDungBaiChoHocVien(db, c.args(c.k.video, c.hetHan))).ok).toBe(false);
    const lai = await capQuyenHoc(db, { studentId: c.hv.id, courseId: c.k.courseId, loai: "MUA", now: c.hetHan, idempotencyKey: key("lai"), orderId: "order-hh" });
    expect(lai.ok).toBe(true);
    if (!lai.ok) return;
    expect(lai.hanhDong).toBe("MO_LAI_SAU_HET_HAN");
    expect(lai.entitlementId, "cùng một dòng quyền").toBe(c.q.entitlementId);
    expect(await db.onlEntitlement.count({ where: { studentId: c.hv.id, courseId: c.k.courseId } })).toBe(1);
    expect(await db.onlAttempt.count({ where: { entitlementId: c.q.entitlementId } }), "lịch sử lượt được bảo toàn").toBe(soLuotTruoc);
    expect(await db.onlLessonProgress.count({ where: { entitlementId: c.q.entitlementId } }), "tiến độ được bảo toàn").toBe(soTienDoTruoc);
    const sau = new Date(c.hetHan.getTime() + 3_600_000);
    expect((await docNoiDungBaiChoHocVien(db, c.args(c.k.video, sau))).ok, "mua lại ⇒ học tiếp được").toBe(true);
    const ml = await docMucLucKhoaCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id, courseId: c.k.courseId, now: sau });
    expect(ml.ok).toBe(true);
    if (ml.ok) expect((ml as { hetHan?: boolean }).hetHan).toBe(false);
    const kqSau = await docKetQuaCacLuot(db, c.args(c.k.quiz, sau));
    expect(kqSau.ok && kqTruoc.ok ? kqSau.luot.slice(0, kqTruoc.luot.length) : null).toEqual(kqTruoc.ok ? kqTruoc.luot : null);
  });

  it("[ONL-HH-07] 🔴 D23 chỉ bỏ qua yếu tố HẠN: mọi cổng KHÁC trả CÙNG mã trước và sau hạn (thứ tự mở · bài ẩn · bài không tồn tại · khoá đã xoá), bài khoá xem lại trả CÙNG bản chỉ-điểm — người hết hạn không xem được nhiều hơn người còn hạn", async () => {
    const c = await conDaHoc();
    const banId = await banDangChay(c.k.courseId);
    const datCaiDat = (them: object) => datCaiDatBan(c.k.courseId, them);
    const cungMa = async (ma: string, bai = c.k.quiz) => {
      expect(await docKetQuaCacLuot(db, c.args(bai, c.sauMotNgay)), `còn hạn: ${ma}`).toMatchObject({ ok: false, ma });
      expect(await docKetQuaCacLuot(db, c.args(bai, c.hetHan)), `hết hạn: ${ma}`).toMatchObject({ ok: false, ma });
    };

    // quiz đã COMPLETED + khoá không cho xem lại bài đã qua: trước và sau hạn trả CÙNG bản chỉ-điểm
    await datCaiDat({ khongChoXemLaiBaiDaQua: true, choXemDiemBaiKhoaXemLai: false });
    const khoaTruocHan = await docKetQuaCacLuot(db, c.args(c.k.quiz, c.sauMotNgay));
    expect(khoaTruocHan).toMatchObject({ ok: true });
    expect(JSON.stringify(khoaTruocHan)).not.toContain("chiTiet");
    expect(await docKetQuaCacLuot(db, c.args(c.k.quiz, c.hetHan))).toStrictEqual(khoaTruocHan);

    // thứ tự mở bài: xoá tiến độ để quiz chưa mở (video đứng trước chưa xong)
    await datCaiDat({ moBaiTiepTheo: "KHI_BAI_TRUOC_XONG" });
    await db.onlLessonProgress.deleteMany({ where: { entitlementId: c.q.entitlementId } });
    await cungMa("BAI_CHUA_MO");

    // bài ẨN mà người học chưa từng bắt đầu
    await datCaiDat({});
    await db.onlLesson.update({ where: { versionId_stableId: { versionId: banId, stableId: c.k.quiz } }, data: { hidden: true } });
    await cungMa("BAI_DA_AN");
    await db.onlLesson.update({ where: { versionId_stableId: { versionId: banId, stableId: c.k.quiz } }, data: { hidden: false } });

    await cungMa("BAI_KHONG_TON_TAI", "khong-co-bai-nay");

    // đối chứng dương: bỏ hết cổng trên thì cả trước lẫn sau hạn đều xem được
    expect((await docKetQuaCacLuot(db, c.args(c.k.quiz, c.sauMotNgay))).ok).toBe(true);
    expect((await docKetQuaCacLuot(db, c.args(c.k.quiz, c.hetHan))).ok).toBe(true);

    await db.onlCourse.update({ where: { id: c.k.courseId }, data: { deletedAt: c.sauMotNgay } });
    await cungMa("KHOA_CHUA_PHAT_HANH");
  });

  /** Con đã học + nộp thêm lượt thứ HAI (sai) trước hạn ⇒ lịch sử có hai lượt: đạt 100 và không đạt 0. */
  async function conHaiLuot() {
    const c = await conDaHoc();
    const nop = await nopBai(db, { ...c.args(c.k.quiz, c.sauMotNgay), attemptId: c.dangLam, traLoi: { [c.k.cauId]: DE.sai } });
    if (!nop.ok) throw new Error("nop2");
    return c;
  }

  it("[ONL-HH-08] 🔴 Owner 27/11 — khoá KHÔNG CHO XEM LẠI: vẫn xem được ĐIỂM + đạt/không của MỌI lượt; KHÔNG bài làm / đúng-sai từng câu / đáp án / giải thích / đề — dưới MỌI cài đặt lộ đáp án, còn hạn lẫn hết hạn, cờ cũ `choXemDiemBaiKhoaXemLai` BẬT hay TẮT đều như nhau", async () => {
    const c = await conHaiLuot();
    const diemThoi = [
      { soLuot: 1, trangThai: "GRADED", nopLuc: c.sauMotNgay, ketQua: { scorePercent: 100, passed: true, daChamXong: true } },
      { soLuot: 2, trangThai: "GRADED", nopLuc: c.sauMotNgay, ketQua: { scorePercent: 0, passed: false, daChamXong: true } },
    ];
    const cam = [...Object.values(DE), c.k.cauId, "chiTiet", "dapAnDung", "giaiThich", "toiDa"];
    const cheDo: { ten: string; them: object; loDapAnKhiKhongKhoa: boolean }[] = [
      { ten: "hienDapAn=SAU_KHI_NOP", them: { hienDapAn: "SAU_KHI_NOP" }, loDapAnKhiKhongKhoa: true },
      { ten: "hienDapAn=SAU_KHI_DE_DONG (đã tới mốc)", them: { hienDapAn: "SAU_KHI_DE_DONG", dongDapAnLuc: T0.toISOString() }, loDapAnKhiKhongKhoa: true },
      { ten: "luật cũ CA_DAP_AN_SAU_HET_LUOT", them: { xemKetQua: "CA_DAP_AN_SAU_HET_LUOT" }, loDapAnKhiKhongKhoa: true },
      { ten: "DIEM_VA_DUNG_SAI", them: { xemKetQua: "DIEM_VA_DUNG_SAI" }, loDapAnKhiKhongKhoa: false },
    ];
    for (const cd of cheDo) {
      // đối chứng dương (còn hạn, KHÔNG khoá): cùng lượt, cùng cài đặt thì CÓ chi tiết (và đáp án + giải thích nếu chế độ cho) — ca âm bên dưới không xanh vì rỗng.
      // CỐ Ý không đối chứng ở mốc hết hạn: hết hạn + không khoá có được thấy đáp án không là việc Owner chưa chốt (review D23-5) — test không ghim bên nào.
      await datCaiDatBan(c.k.courseId, cd.them);
      const chuoi = JSON.stringify(await docKetQuaCacLuot(db, c.args(c.k.quiz, c.sauMotNgay)));
      expect(chuoi, `${cd.ten} · không khoá: có chi tiết`).toContain("chiTiet");
      expect([chuoi.includes("dapAnDung"), chuoi.includes(DE.dung), chuoi.includes(DE.giaiThich)], `${cd.ten} · không khoá: đáp án + giải thích`).toEqual(Array(3).fill(cd.loDapAnKhiKhongKhoa));
      for (const coCu of [true, false]) {
        await datCaiDatBan(c.k.courseId, { ...cd.them, khongChoXemLaiBaiDaQua: true, choXemDiemBaiKhoaXemLai: coCu });
        for (const [khi, now] of [["còn hạn", c.sauMotNgay], ["hết hạn", c.hetHan]] as const) {
          const ten = `${cd.ten} · ${khi} · khoá xem lại · cờ cũ=${coCu}`;
          const kq = await docKetQuaCacLuot(db, c.args(c.k.quiz, now));
          // PHÍA CÓ: đúng điểm lịch sử; PHÍA KHÔNG: toStrictEqual ghim TRỌN hình dạng (thêm bất kỳ trường nào là đỏ)
          expect(kq, ten).toStrictEqual({ ok: true, luot: diemThoi });
          for (const x of cam) expect(JSON.stringify(kq), `${ten}: không được lộ "${x}"`).not.toContain(x);
        }
      }
    }
  });

  it("[ONL-HH-09] 🔴 khoá KHÔNG CHO XEM LẠI không mở lại gì ngoài điểm: nội dung bài, đề (tiếp tục lượt), bài làm đang dở (đọc/lưu nháp), nộp lại lượt cũ (đường trả đáp án), video đã xong; đối chứng dương: tắt khoá thì chính các đường đó mở được và có đề/đáp án", async () => {
    const c = await conDaHoc();
    expect(await ghiTienDoBai(db, { ...c.args(c.k.video, c.sauMotNgay), percent: 100 } as never)).toMatchObject({ ok: true, trangThai: "COMPLETED" });
    const luot = (attemptId: string) => ({ ...c.args(c.k.quiz, c.sauMotNgay), attemptId });
    const luu = () => luuNhap(db, { ...luot(c.dangLam), yeuCau: { requestId: key("nhap"), items: [{ questionId: c.k.cauId, answer: DE.sai, baseRevision: 0 }] } });

    // dương (KHÔNG khoá)
    await datCaiDatBan(c.k.courseId, { hienDapAn: "SAU_KHI_NOP" });
    expect((await docNoiDungBaiChoHocVien(db, c.args(c.k.quiz, c.sauMotNgay))).ok).toBe(true);
    expect((await docNoiDungBaiChoHocVien(db, c.args(c.k.video, c.sauMotNgay))).ok).toBe(true);
    expect((await capVeMedia(db, c.args(c.k.video, c.sauMotNgay))).ok).toBe(true);
    expect(JSON.stringify(await batDauLamBai(db, c.args(c.k.quiz, c.sauMotNgay))), "tiếp tục lượt trả ĐỀ").toContain(DE.stem);
    expect(JSON.stringify(await docTrangThaiLuot(db, luot(c.dangLam))), "đọc lại lượt dở trả ĐỀ").toContain(DE.stem);
    expect((await luu()).ok).toBe(true);
    expect(JSON.stringify(await nopBai(db, { ...luot(c.daNop), traLoi: {} })), "nộp lại lượt cũ trả đáp án + giải thích").toContain(DE.giaiThich);

    // âm (khoá, cùng cài đặt lộ đáp án) — cờ cũ BẬT hay TẮT đều không mở gì ngoài điểm
    for (const coCu of [true, false]) {
      await datCaiDatBan(c.k.courseId, { hienDapAn: "SAU_KHI_NOP", khongChoXemLaiBaiDaQua: true, choXemDiemBaiKhoaXemLai: coCu });
      expect((await docKetQuaCacLuot(db, c.args(c.k.quiz, c.sauMotNgay))).ok, `điểm vẫn xem được (cờ cũ=${coCu})`).toBe(true);
      const chan = (kq: object, ten: string) => {
        expect(kq, `${ten} (cờ cũ=${coCu})`).toMatchObject({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
        for (const x of Object.values(DE)) expect(JSON.stringify(kq), `${ten}: không lộ "${x}"`).not.toContain(x);
      };
      chan(await docNoiDungBaiChoHocVien(db, c.args(c.k.quiz, c.sauMotNgay)), "nội dung bài kiểm tra");
      chan(await docNoiDungBaiChoHocVien(db, c.args(c.k.video, c.sauMotNgay)), "nội dung video");
      chan(await capVeMedia(db, c.args(c.k.video, c.sauMotNgay)), "vé video");
      chan(await batDauLamBai(db, c.args(c.k.quiz, c.sauMotNgay)), "bắt đầu / tiếp tục lượt");
      chan(await docTrangThaiLuot(db, luot(c.dangLam)), "đọc lại bài làm đang dở");
      chan(await luu(), "lưu nháp");
      chan(await nopBai(db, { ...luot(c.daNop), traLoi: {} }), "nộp lại lượt cũ");
    }
    // đường kết quả của bài KHÔNG phải đánh giá không trả gì của bài đã khoá
    expect(await docKetQuaCacLuot(db, c.args(c.k.video, c.sauMotNgay))).toMatchObject({ ok: false, ma: "BAI_KHONG_PHAI_DANH_GIA" });
  });

  it("[ONL-HH-10] 🔴 nới cho bài khoá xem lại KHÔNG đè cổng nào khác (người khác · cài đặt hỏng · khoá đã xoá · thu hồi vẫn chặn); phương án A: cờ cũ TẮT vẫn CÓ ĐIỂM và không lộ chi tiết, các cổng khác không đổi theo cờ", async () => {
    const c = await conDaHoc();
    const caHaiMoc = async (mongDoi: object, ten: string, parentUserId = c.ph.id) => {
      expect(await docKetQuaCacLuot(db, { ...c.args(c.k.quiz, c.sauMotNgay), parentUserId }), `còn hạn: ${ten}`).toMatchObject(mongDoi);
      expect(await docKetQuaCacLuot(db, { ...c.args(c.k.quiz, c.hetHan), parentUserId }), `hết hạn: ${ten}`).toMatchObject(mongDoi);
    };
    const khoaXemLai = (coCu: boolean) => datCaiDatBan(c.k.courseId, { khongChoXemLaiBaiDaQua: true, choXemDiemBaiKhoaXemLai: coCu });
    const la = await phuHuynh("la10");

    for (const coCu of [false, true]) {
      await khoaXemLai(coCu);
      // đối chứng dương cho các ca chặn bên dưới; `toStrictEqual` ghim trọn hình dạng chỉ-điểm
      for (const now of [c.sauMotNgay, c.hetHan]) {
        expect(await docKetQuaCacLuot(db, c.args(c.k.quiz, now)), `khoá + cờ cũ=${coCu}: có điểm, không chi tiết`).toStrictEqual({ ok: true, luot: [{ soLuot: 1, trangThai: "GRADED", nopLuc: c.sauMotNgay, ketQua: { scorePercent: 100, passed: true, daChamXong: true } }] });
      }

      await caHaiMoc({ ok: false, ma: "SAI_PHU_HUYNH" }, `phụ huynh khác (cờ cũ=${coCu})`, la.id);

      await db.onlCourseVersion.update({ where: { id: await banDangChay(c.k.courseId) }, data: { settingsJson: { khongChoXemLaiBaiDaQua: true, choXemDiemBaiKhoaXemLai: coCu } } });
      await caHaiMoc({ ok: false, ma: "CAI_DAT_KHONG_HOP_LE" }, `cài đặt hỏng (cờ cũ=${coCu})`);
      await khoaXemLai(coCu);

      await db.onlCourse.update({ where: { id: c.k.courseId }, data: { deletedAt: c.sauMotNgay } });
      await caHaiMoc({ ok: false, ma: "KHOA_CHUA_PHAT_HANH" }, `khoá đã xoá (cờ cũ=${coCu})`);
      await db.onlCourse.update({ where: { id: c.k.courseId }, data: { deletedAt: null } });
    }

    expect((await thuHoiQuyenHoc(db, { studentId: c.hv.id, courseId: c.k.courseId, reason: "thu hồi thử nghiệm HH-10", idempotencyKey: key("th10"), now: c.sauMotNgay })).ok).toBe(true);
    for (const coCu of [false, true]) {
      await khoaXemLai(coCu);
      await caHaiMoc({ ok: false, ma: "DA_THU_HOI" }, `thu hồi (cờ cũ=${coCu})`);
    }
  });

  /** Một con có quyền học + hàm làm trọn MỘT lượt (bắt đầu rồi nộp) ở một bài. */
  async function conMoi(tuyChon: { haiBaiChungDe?: boolean } = {}) {
    const ph = await phuHuynh("f1");
    const hv = await hocVien(ph.id, "f1");
    const k = await dungKhoa(tuyChon);
    const q = await capMienPhi(hv.id, k.courseId);
    const args = (lessonStableId: string, now: Date) => ({ parentUserId: ph.id, studentId: hv.id, courseId: k.courseId, lessonStableId, now });
    const lam = async (bai: string, now: Date, chon: string) => {
      const bd = await batDauLamBai(db, args(bai, now));
      if (!bd.ok) throw new Error(`bắt đầu: ${bd.ma}`);
      const r = await nopBai(db, { ...args(bai, now), attemptId: bd.luot.attemptId, traLoi: { [k.cauId]: chon } });
      if (!r.ok) throw new Error(`nộp: ${r.ma}`);
      return bd.luot.attemptId;
    };
    const lucA = new Date(T0.getTime() + 86_400_000);
    const lucSau = new Date(lucA.getTime() + 3_600_000);
    const hetHan = new Date(q.hetHan!.getTime() + 60_000);
    return { k, q, args, lam, lucA, lucSau, hetHan };
  }
  /** DANH TÍNH từng lượt trong kết quả: số lượt, giờ nộp, mẫu đúng/sai từng câu (null = không có chi tiết). Hai bài CHUNG đề nên chuỗi MARKER không phân biệt được lượt của bài nào. */
  const danhTinh = (r: Awaited<ReturnType<typeof docKetQuaCacLuot>>) => (r.ok ? r.luot.map((l) => ({ soLuot: l.soLuot, nopLuc: l.nopLuc, dung: l.ketQua?.chiTiet?.map((x) => x.dung) ?? null })) : r);

  it("[ONL-HH-11] 🔴 F1 — hai bài CHUNG MỘT đề: kết quả đọc qua bài CHƯA khoá không gồm lượt đã làm ở bài ĐÃ KHOÁ xem lại; mỗi bài chỉ trả lượt làm Ở BÀI ĐÓ (còn hạn lẫn hết hạn); đối chứng dương: lượt của cả hai bài vẫn đọc được qua đúng bài", async () => {
    const c = await conMoi({ haiBaiChungDe: true });
    const quizB = c.k.quizB!;
    const lucB = c.lucSau;
    const luotA = await c.lam(c.k.quiz, c.lucA, DE.dung); // ĐẠT ở A ⇒ A hoàn thành
    await c.lam(quizB, lucB, DE.sai); // SAI ở B ⇒ B chưa xong ⇒ B không bị khoá
    const sau = new Date(lucB.getTime() + 3_600_000);
    await datCaiDatBan(c.k.courseId, { hienDapAn: "SAU_KHI_NOP", khongChoXemLaiBaiDaQua: true });
    for (const [khi, now] of [["còn hạn", sau], ["hết hạn", c.hetHan]] as const) {
      expect(danhTinh(await docKetQuaCacLuot(db, c.args(quizB, now))), `${khi}: đọc qua B chỉ có lượt làm ở B`).toEqual([{ soLuot: 2, nopLuc: lucB, dung: [false] }]);
      expect(await docKetQuaCacLuot(db, c.args(c.k.quiz, now)), `${khi}: đọc qua A (đã khoá) — chỉ điểm, chỉ lượt của A`).toStrictEqual({ ok: true, luot: [{ soLuot: 1, trangThai: "GRADED", nopLuc: c.lucA, ketQua: { scorePercent: 100, passed: true, daChamXong: true } }] });
    }
    // vá không cắt quá tay: lượt của CHÍNH bài B (chưa khoá) vẫn theo cài đặt xem kết quả (mốc còn hạn — mốc hết hạn là việc D23-5 chưa chốt)
    expect(JSON.stringify(await docKetQuaCacLuot(db, c.args(quizB, sau)))).toContain("dapAnDung");
    // các đường đọc theo attemptId vốn đã đòi đúng bài — ghim cùng ca: đem id lượt của A sang B không đọc được gì
    expect(await nopBai(db, { ...c.args(quizB, sau), attemptId: luotA, traLoi: {} })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    expect(await docTrangThaiLuot(db, { ...c.args(quizB, sau), attemptId: luotA })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    // đối chứng dương: tắt khoá ⇒ lượt A còn nguyên và đọc đủ chi tiết qua A (ca âm ở trên không xanh vì mất dữ liệu)
    await datCaiDatBan(c.k.courseId, { hienDapAn: "SAU_KHI_NOP" });
    expect(danhTinh(await docKetQuaCacLuot(db, c.args(c.k.quiz, sau)))).toEqual([{ soLuot: 1, nopLuc: c.lucA, dung: [true] }]);
    expect(danhTinh(await docKetQuaCacLuot(db, c.args(quizB, sau)))).toEqual([{ soLuot: 2, nopLuc: lucB, dung: [false] }]);
  });

  it("[ONL-HH-12] 🔴 F1 — bản MỚI gỡ bài đã đạt và gắn đề đó cho bài khác (soạn + phát hành thật, KEEP_PROGRESS): bài mới KHÔNG trả lượt làm ở bài cũ; lượt và tiến độ cũ VẪN CÒN trong DB", async () => {
    const c = await conMoi();
    await c.lam(c.k.quiz, c.lucA, DE.dung);
    const nhap = await moBanNhap(db, c.k.courseId, null);
    if (!nhap.ok) throw new Error(nhap.thongBao);
    const baiCu = await db.onlLesson.findUniqueOrThrow({ where: { versionId_stableId: { versionId: nhap.versionId, stableId: c.k.quiz } }, select: { id: true, chapterId: true } });
    expect((await xoaBai(db, baiCu.id)).ok).toBe(true);
    const baiMoi = await themBai(db, { versionId: nhap.versionId, chapterId: baiCu.chapterId, kind: "QUIZ", title: "Q-C", contentJson: { assessmentId: c.k.deId } });
    if (!baiMoi.ok) throw new Error("bài mới");
    const chinhSach = { loai: "KEEP_PROGRESS" as const };
    const xt = await xemTruocPhatHanh(db, c.k.courseId, chinhSach);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db, { courseId: c.k.courseId, chinhSach, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, c.lucSau);
    if (!ph.ok) throw new Error(ph.thongBao);
    await datCaiDatBan(c.k.courseId, { hienDapAn: "SAU_KHI_NOP", khongChoXemLaiBaiDaQua: true });
    for (const [khi, now] of [["còn hạn", c.lucSau], ["hết hạn", c.hetHan]] as const) {
      expect(await docKetQuaCacLuot(db, c.args(baiMoi.stableId, now)), `${khi}: bài mới chưa làm lượt nào`).toStrictEqual({ ok: true, luot: [] });
    }
    // lịch sử KHÔNG bị xoá
    expect(await db.onlAttempt.count({ where: { entitlementId: c.q.entitlementId, lessonStableId: c.k.quiz, status: "GRADED" } })).toBe(1);
    expect(await db.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId: c.q.entitlementId, lessonStableId: c.k.quiz } }, select: { status: true } })).toEqual({ status: "COMPLETED" });
    // đối chứng dương: làm một lượt ở bài mới thì thấy đúng lượt đó (đường đọc của bài mới hoạt động)
    const lucC = new Date(c.lucSau.getTime() + 3_600_000);
    await c.lam(baiMoi.stableId, lucC, DE.sai);
    expect(danhTinh(await docKetQuaCacLuot(db, c.args(baiMoi.stableId, lucC)))).toEqual([{ soLuot: 2, nopLuc: lucC, dung: [false] }]);
  });

  it("[ONL-HH-06] danh sách khoá của con vẫn có khoá hết hạn (nhãn HET_HAN) để bấm 'Mua lại' — không đổi hành vi cũ", async () => {
    const c = await conDaHoc();
    const ds = await docKhoaOnlineCuaHocVien(db, { parentUserId: c.ph.id, studentId: c.hv.id, now: c.hetHan });
    expect(ds?.map((d) => [d.courseId, d.trangThai])).toEqual([[c.k.courseId, "HET_HAN"]]);
  });
});
