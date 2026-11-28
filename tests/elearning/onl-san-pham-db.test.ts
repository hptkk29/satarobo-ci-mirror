// @vitest-environment node
/**
 * [ONL-SP-*] E-learning ONLINE — nộp + chấm SẢN PHẨM theo khung chấm (Postgres thật, Q6).
 * Bảng `OnlSubmission`/`OnlRubric` (công ty). Mỗi ca âm có đối chứng dương. Không dùng `Trn*`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai, chamTay, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { chamSanPham, docSanPhamChoCham, docSanPhamCuaToi, luuKhungCham, nopSanPham, yeuCauNopLai } from "../../lib/elearning-online/san-pham-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { CAU, NOW, don, dungKhoa, themHocVien, tepHopLe } from "./_onl-13-fixture";

const bat = async (k: Awaited<ReturnType<typeof dungKhoa>>, args = k.args) => {
  const r = await batDauLamBai(db, args);
  if (!r.ok) throw new Error(r.thongBao);
  return r.luot.attemptId;
};
const traLoiToiThieu = (k: Awaited<ReturnType<typeof dungKhoa>>, spId: string | undefined) => (spId ? { [k.id.PRODUCT!]: spId } : {});

describe.skipIf(!RUN_DB_TESTS)("[ONL-SP] sản phẩm + khung chấm (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-SP-01] 🔴 nộp: từ chối khoá tệp của người khác/URL/`..`, sai MIME, vượt dung lượng/thời lượng, câu không phải sản phẩm, sai phụ huynh; tệp hợp lệ nhận được", async () => {
    const k = await dungKhoa({ khung: true });
    const khac = await themHocVien(k, "khac");
    const att = await bat(k);
    const nop = (file: object, over: object = {}) => nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: file as never, ...over });
    const hop = tepHopLe(k.courseId, k.args.studentId);
    const sai: [string, object, string][] = [
      ["khoá của học viên khác", { ...hop, key: `online/sp/${k.courseId}/${khac.studentId}/x.mp4` }, "TEP_KHONG_HOP_LE"],
      ["khoá của khoá khác", { ...hop, key: `online/sp/khoa-khac/${k.args.studentId}/x.mp4` }, "TEP_KHONG_HOP_LE"],
      ["URL công khai", { ...hop, key: "https://cdn.example.com/x.mp4" }, "TEP_KHONG_HOP_LE"],
      ["đi lên thư mục cha", { ...hop, key: `online/sp/${k.courseId}/${k.args.studentId}/../${khac.studentId}/x.mp4` }, "TEP_KHONG_HOP_LE"],
      ["MIME không cho phép (PDF khi chỉ video/ảnh)", { ...hop, mime: "application/pdf" }, "TEP_KHONG_HOP_LE"],
      ["đuôi .mp4 nhưng MIME lạ", { ...hop, mime: "application/x-msdownload" }, "TEP_KHONG_HOP_LE"],
      ["vượt dung lượng", { ...hop, sizeBytes: 101 * 1024 * 1024 }, "TEP_KHONG_HOP_LE"],
      ["video quá dài", { ...hop, durationSec: 61 }, "TEP_KHONG_HOP_LE"],
      ["thiếu thời lượng video", { ...hop, durationSec: null }, "TEP_KHONG_HOP_LE"],
    ];
    for (const [ten, file, ma] of sai) expect(await nop(file), ten).toMatchObject({ ok: false, ma });
    expect(await nop(hop, { questionId: k.id.NUMERIC! })).toMatchObject({ ok: false, ma: "CAU_KHONG_PHAI_SAN_PHAM" });
    expect(await nop(hop, { parentUserId: khac.parentUserId })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await nopSanPham(db, { ...khac, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, khac.studentId) })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" }); // lượt của người khác
    expect(await db.onlSubmission.count({ where: { attemptId: att } })).toBe(0); // không ghi nửa chừng
    // đối chứng dương: tệp ảnh và video hợp lệ đều nhận
    expect((await nop({ ...hop, key: hop.key.replace(".mp4", ".png"), mime: "image/png", durationSec: null })).ok).toBe(true);
    const ok = await nop(hop);
    expect(ok).toMatchObject({ ok: true });
    expect(await db.onlSubmission.count({ where: { attemptId: att, status: "SUBMITTED" } })).toBe(1); // bản ảnh đã bị thay (nộp lại trong lượt đang làm)
    expect(await db.onlSubmission.count({ where: { attemptId: att, status: "SUPERSEDED" } })).toBe(1);
  });

  it("[ONL-SP-02] 🔴 nộp bài với mã bài nộp của NGƯỜI KHÁC bị bỏ — không nộp hộ, không lấy điểm của người khác", async () => {
    const k = await dungKhoa({ khung: true });
    const khac = await themHocVien(k, "b");
    const attA = await bat(k);
    const attB = await bat(k, khac);
    const spB = await nopSanPham(db, { ...khac, attemptId: attB, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, khac.studentId) });
    if (!spB.ok) throw new Error(spB.thongBao);
    await nopBai(db, { ...k.args, attemptId: attA, traLoi: traLoiToiThieu(k, spB.submissionId) }); // A gửi mã bài nộp của B
    const luotA = await db.onlAttempt.findUniqueOrThrow({ where: { id: attA } });
    expect((luotA.answersJson as Record<string, unknown>)[k.id.PRODUCT!]).toBeUndefined();
    const sp = await db.onlSubmission.findUniqueOrThrow({ where: { id: spB.submissionId } });
    expect(sp.attemptId).toBe(attB); // bài của B vẫn thuộc lượt của B
    // A chưa nộp gì ⇒ sản phẩm 0 điểm; B nộp đúng ⇒ giữ mã
    expect(await chamTay(db, { attemptId: attA, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: true });
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: attA } })).manualJson).toMatchObject({ diem: { [k.id.PRODUCT!]: 0 } });
    await nopBai(db, { ...khac, attemptId: attB, traLoi: traLoiToiThieu(k, spB.submissionId) });
    expect(((await db.onlAttempt.findUniqueOrThrow({ where: { id: attB } })).answersJson as Record<string, unknown>)[k.id.PRODUCT!]).toBe(spB.submissionId); // đối chứng dương
  });

  it("[ONL-SP-03] 🔴 chấm theo khung: đủ/đúng tiêu chí, điểm làm tròn XUỐNG, không chấm hai lần; sửa khung SAU khi nộp không đổi cách chấm (bản chụp)", async () => {
    const k = await dungKhoa({ khung: true });
    const att = await bat(k);
    const sp = await nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    // người soạn đổi khung NGAY SAU khi học viên nộp (đổi tiêu chí + thang)
    const dsKhung = await db.onlRubric.findMany({ where: { courseId: k.courseId } });
    expect(await luuKhungCham(db, { id: k.rubricId!, courseId: k.courseId, code: "SA-BAN-02", title: "Đổi", criteria: [{ id: "khac", name: "Khác", max: 100 }] }, "u")).toMatchObject({ ok: true });
    expect(dsKhung).toHaveLength(1);
    await nopBai(db, { ...k.args, attemptId: att, traLoi: traLoiToiThieu(k, sp.submissionId) });
    const cham = (scores: Record<string, unknown>) => chamSanPham(db, { submissionId: sp.submissionId, graderUserId: "g", scores, now: NOW });
    expect(await cham({ dich: 6 })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" }); // thiếu tiêu chí
    expect(await cham({ dich: 6, gon: 4, thua: 1 })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" }); // thừa
    expect(await cham({ dich: 7, gon: 1 })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" }); // vượt tối đa
    expect(await cham({ khac: 100 })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" }); // tiêu chí của khung MỚI không áp cho bài đã nộp
    expect(await cham({ dich: 3.5, gon: 1 })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" }); // không nguyên
    // chưa chấm hợp lệ ⇒ chưa kết thúc được lượt
    expect(await chamTay(db, { attemptId: att, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: false, ma: "SAN_PHAM_CHUA_CHAM" });
    // 4/10 trên câu 4 điểm ⇒ floor(4*4/10) = floor(1.6) = 1 (làm tròn XUỐNG, không phải 2)
    expect(await cham({ dich: 3, gon: 1 })).toMatchObject({ ok: true, points: 1, toiDa: 4 });
    expect(await cham({ dich: 6, gon: 4 })).toMatchObject({ ok: false, ma: "DA_CHAM" });
    expect(await chamTay(db, { attemptId: att, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: true });
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: att } });
    expect(luot.earnedPoints).toBe(1); // ca này chỉ nộp câu sản phẩm: 7 câu tự động bỏ trống = 0, sản phẩm = 1
    const luu = await db.onlSubmission.findUniqueOrThrow({ where: { id: sp.submissionId } });
    expect(luu).toMatchObject({ status: "GRADED", points: 1, gradedByUserId: "g" });
  });

  it("[ONL-SP-04] 🔴 yêu cầu nộp lại: cần lý do, bản cũ bị thay, bản cũ không chấm được, chỉ nộp lại khi được yêu cầu; nộp xong chấm bản mới", async () => {
    const k = await dungKhoa();
    const att = await bat(k);
    const sp1 = await nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId, "lan-1.mp4") });
    if (!sp1.ok) throw new Error(sp1.thongBao);
    await nopBai(db, { ...k.args, attemptId: att, traLoi: traLoiToiThieu(k, sp1.submissionId) });
    // đã nộp, chưa bị yêu cầu ⇒ không nộp lại được
    expect(await nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId, "lan-2.mp4") })).toMatchObject({ ok: false, ma: "DA_NOP" });
    expect(await yeuCauNopLai(db, { submissionId: sp1.submissionId, graderUserId: "g", lyDo: "ngắn" })).toMatchObject({ ok: false });
    expect(await yeuCauNopLai(db, { submissionId: sp1.submissionId, graderUserId: "g", lyDo: "Video không thấy cả sa bàn, quay lại" })).toMatchObject({ ok: true });
    expect(await chamSanPham(db, { submissionId: sp1.submissionId, graderUserId: "g", diemTrucTiep: 4, now: NOW })).toMatchObject({ ok: false, ma: "SAN_PHAM_KHONG_CHAM_DUOC" });
    expect(await chamTay(db, { attemptId: att, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: false, ma: "SAN_PHAM_KHONG_CHAM_DUOC" }); // còn chờ nộp lại
    const sp2 = await nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId, "lan-2.mp4") });
    expect(sp2).toMatchObject({ ok: true, nopLai: true });
    if (!sp2.ok) return;
    expect((await db.onlSubmission.findUniqueOrThrow({ where: { id: sp1.submissionId } })).status).toBe("SUPERSEDED");
    expect((await db.onlSubmission.findUniqueOrThrow({ where: { id: sp2.submissionId } })).supersedesId).toBe(sp1.submissionId);
    expect(((await db.onlAttempt.findUniqueOrThrow({ where: { id: att } })).answersJson as Record<string, unknown>)[k.id.PRODUCT!]).toBe(sp2.submissionId);
    expect(await chamSanPham(db, { submissionId: sp1.submissionId, graderUserId: "g", diemTrucTiep: 4, now: NOW })).toMatchObject({ ok: false }); // bản cũ không chấm được
    expect(await chamSanPham(db, { submissionId: sp2.submissionId, graderUserId: "g", diemTrucTiep: 4, now: NOW })).toMatchObject({ ok: true, points: 4 });
    expect(await chamTay(db, { attemptId: att, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: true });
  });

  it("[ONL-SP-05] 🔴 đọc: người chấm thấy hàng chờ (không lộ khoá tệp ở danh sách); phụ huynh chỉ xem bài của CON MÌNH; khung chấm trùng mã bị từ chối", async () => {
    const k = await dungKhoa({ khung: true });
    const khac = await themHocVien(k, "doc");
    const att = await bat(k);
    const sp = await nopSanPham(db, { ...k.args, attemptId: att, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    await nopBai(db, { ...k.args, attemptId: att, traLoi: traLoiToiThieu(k, sp.submissionId) });
    const ds = await docSanPhamChoCham(db, k.courseId);
    expect(ds).toHaveLength(1);
    expect(JSON.stringify(ds)).not.toContain("online/sp/"); // danh sách không mang khoá tệp
    expect(ds[0]!.student.name).toContain("hv"); // dương: có tên học viên
    expect(await docSanPhamCuaToi(db, { parentUserId: k.args.parentUserId, submissionId: sp.submissionId })).toMatchObject({ id: sp.submissionId, status: "SUBMITTED" });
    expect(await docSanPhamCuaToi(db, { parentUserId: khac.parentUserId, submissionId: sp.submissionId })).toBeNull();
    expect(await docSanPhamCuaToi(db, { parentUserId: k.args.parentUserId, submissionId: "khong-co" })).toBeNull();
    expect(await luuKhungCham(db, { courseId: k.courseId, code: "SA-BAN-02", title: "Trùng", criteria: [{ id: "a", name: "A", max: 1 }] }, "u")).toMatchObject({ ok: false, ma: "KHUNG_TRUNG_MA" });
    expect(await luuKhungCham(db, { courseId: k.courseId, code: "ab", title: "Mã ngắn", criteria: [{ id: "a", name: "A", max: 1 }] }, "u")).toMatchObject({ ok: false, ma: "KHUNG_KHONG_HOP_LE" });
    expect(await luuKhungCham(db, { courseId: k.courseId, code: "OK-01", title: "Hợp lệ", criteria: [{ id: "a", name: "A", max: 1 }, { id: "a", name: "B", max: 1 }] }, "u")).toMatchObject({ ok: false, ma: "KHUNG_KHONG_HOP_LE" });
    expect((await luuKhungCham(db, { courseId: k.courseId, code: "OK-01", title: "Hợp lệ", criteria: [{ id: "a", name: "A", max: 1 }] }, "u")).ok).toBe(true);
    void CAU;
  });
});
