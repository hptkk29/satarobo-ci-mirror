// @vitest-environment node
/**
 * [CNM-DB-*] E-learning ONLINE — phôi chứng nhận (Postgres thật, Q2): tải phôi · phiên bản BẤT BIẾN · duyệt · cấp kèm bản chụp · CHỨNG NHẬN ĐÃ CẤP KHÔNG ĐỔI khi thay phôi · thu hồi.
 * Mỗi ca âm có đối chứng dương. Không dùng bảng Trn* / bộ dựng PDF Nội bộ hay Offline.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { capChungNhanTay, thuHoiChungNhan } from "../../lib/elearning-online/chung-nhan";
import { boCucMacDinh, sha256Hex } from "../../lib/elearning-online/cn-mau";
import { docCacBanMau, duyetMau, dungPdfTheoMa, taiPhoiLen, taoBanMoiTuBan } from "../../lib/elearning-online/cn-mau-db";
import { chuanHoaDeSoSanh } from "../../lib/elearning-online/cn-pdf";
import { khoBoNho } from "../../lib/elearning-online/cn-tai-san";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { NOW, don, dungKhoa, themHocVien } from "./_onl-13-fixture";
import { taoPng } from "./_png";

const PHOI_A = taoPng(2100, 1485, 120);
const PHOI_B = taoPng(2100, 1485, 60);

async function capCho(k: { courseId: string; lessonStableId: string }, ten: string) {
  const hv = await themHocVien(k, ten);
  const r = await capChungNhanTay(db, { courseId: k.courseId, studentId: hv.studentId, actorUserId: "u", reason: "cấp tay để thử nghiệm phôi", now: NOW });
  if (!r.ok) throw new Error(r.thongBao);
  return { code: r.code, hv };
}

describe.skipIf(!RUN_DB_TESTS)("[CNM-DB] phôi chứng nhận Online (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[CNM-DB-01] 🔴 tải phôi: tệp giả/quá nhỏ/sai tỉ lệ/bố cục chồng bị từ chối và KHÔNG ghi gì; phôi đúng ⇒ bản NHÁP số 1; ảnh vào kho đúng một lần theo mã băm", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    expect(await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: new TextEncoder().encode("<html>"), actorUserId: "u" })).toMatchObject({ ok: false, ma: "PHOI_KHONG_HOP_LE" });
    expect(await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: taoPng(900, 640), actorUserId: "u" })).toMatchObject({ ok: false, ma: "PHOI_KHONG_HOP_LE" });
    expect(await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: taoPng(2100, 2100), actorUserId: "u" })).toMatchObject({ ok: false, ma: "PHOI_KHONG_HOP_LE" });
    const b = boCucMacDinh();
    expect(await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, fields: { ...b, tenKhoa: { ...b.tenKhoa, y: 52 } }, actorUserId: "u" })).toMatchObject({ ok: false, ma: "BO_CUC_KHONG_HOP_LE" });
    expect(await taiPhoiLen(db, kho, { courseId: "khong-co", bytes: PHOI_A, actorUserId: "u" })).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
    expect(await db.onlCertificateTemplate.count({ where: { courseId: k.courseId } })).toBe(0);
    expect(kho.map.size).toBe(0);
    const ok = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" }); // đối chứng dương
    expect(ok).toMatchObject({ ok: true, version: 1 });
    const lai = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" }); // cùng ảnh, tải lại ⇒ bản 2, ảnh KHÔNG ghi lần hai
    expect(lai).toMatchObject({ ok: true, version: 2 });
    expect(kho.map.size).toBe(1);
    const dong = await db.onlCertificateTemplate.findFirstOrThrow({ where: { courseId: k.courseId, version: 1 } });
    expect(dong).toMatchObject({ status: "DRAFT", backgroundSha256: sha256Hex(PHOI_A), widthPx: 2100 });
    expect(dong.backgroundKey).toBe(`online/cn/${k.courseId}/${sha256Hex(PHOI_A)}.png`);
  });

  it("[CNM-DB-02] 🔴 nội dung mẫu BẤT BIẾN ở DB (trigger): sửa ảnh/mã băm/bố cục/phiên bản bị chặn; đổi trạng thái được; không xoá mẫu đã dùng", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    const t = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" });
    if (!t.ok) throw new Error(t.thongBao);
    await expect(db.onlCertificateTemplate.update({ where: { id: t.id }, data: { backgroundSha256: "a".repeat(64) } })).rejects.toThrow();
    await expect(db.onlCertificateTemplate.update({ where: { id: t.id }, data: { backgroundKey: "online/cn/x/y.png" } })).rejects.toThrow();
    await expect(db.onlCertificateTemplate.update({ where: { id: t.id }, data: { fieldsJson: { ...boCucMacDinh(), hoTen: { ...boCucMacDinh().hoTen, x: 30 } } } })).rejects.toThrow();
    await expect(db.onlCertificateTemplate.update({ where: { id: t.id }, data: { version: 9 } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE "OnlCertificateTemplate" SET "widthPx" = 1 WHERE "id" = '${t.id}'`)).rejects.toThrow(); // cả SQL thô
    expect(await db.onlCertificateTemplate.update({ where: { id: t.id }, data: { status: "SUPERSEDED" } })).toMatchObject({ status: "SUPERSEDED" }); // dương: đổi trạng thái được
    const dung = await db.onlCertificateTemplate.findUniqueOrThrow({ where: { id: t.id } });
    expect(dung.backgroundSha256).toBe(sha256Hex(PHOI_A)); // không có gì bị ghi nửa chừng
  });

  it("[CNM-DB-03] 🔴 duyệt: một khoá tối đa MỘT mẫu áp dụng; duyệt bản mới thay bản cũ cùng giao dịch; chỉ duyệt được bản nháp; mẫu tràn khung không được duyệt", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    const a = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" });
    const b = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_B, actorUserId: "u" });
    if (!a.ok || !b.ok) throw new Error("tải");
    expect(await duyetMau(db, { templateId: a.id, actorUserId: "u" })).toMatchObject({ ok: true, thayThe: null });
    expect(await duyetMau(db, { templateId: a.id, actorUserId: "u" })).toMatchObject({ ok: false, ma: "DA_DUYET" });
    expect(await duyetMau(db, { templateId: "khong-co", actorUserId: "u" })).toMatchObject({ ok: false, ma: "MAU_KHONG_TON_TAI" });
    expect(await duyetMau(db, { templateId: b.id, actorUserId: "u" })).toMatchObject({ ok: true, thayThe: a.id });
    const ds = await docCacBanMau(db, k.courseId);
    expect(ds.filter((m) => m.status === "APPROVED").map((m) => m.id)).toEqual([b.id]);
    expect(ds.find((m) => m.id === a.id)?.status).toBe("SUPERSEDED");
    expect(await duyetMau(db, { templateId: a.id, actorUserId: "u" })).toMatchObject({ ok: false, ma: "KHONG_DUYET_DUOC" }); // bản đã thay không duyệt lại (tạo bản mới)
    // chỉ mục từng phần: không thể có hai bản APPROVED dù ghi tay
    await expect(db.onlCertificateTemplate.update({ where: { id: a.id }, data: { status: "APPROVED" } })).rejects.toThrow();
    // mẫu tràn khung
    const bc = boCucMacDinh();
    const tran = await taoBanMoiTuBan(db, { templateId: b.id, fields: { ...bc, hoTen: { ...bc.hoTen, x: 40, w: 6, h: 3 } }, actorUserId: "u" });
    if (!tran.ok) throw new Error(tran.thongBao);
    expect(tran.canhBao.some((c) => c.muc === "LOI")).toBe(true);
    expect(await duyetMau(db, { templateId: tran.id, actorUserId: "u" })).toMatchObject({ ok: false, ma: "KHONG_DUYET_DUOC" });
    expect((await docCacBanMau(db, k.courseId)).find((m) => m.id === b.id)?.status).toBe("APPROVED"); // bản đang dùng không bị đụng
  });

  it("[CNM-DB-04] 🔴 CHỨNG NHẬN ĐÃ CẤP BẤT BIẾN: thay phôi + bố cục SAU khi cấp, tải lại bản cũ ⇒ cùng nội dung; bản cấp mới dùng phôi mới", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    const a = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" });
    if (!a.ok) throw new Error(a.thongBao);
    await duyetMau(db, { templateId: a.id, actorUserId: "u" });
    const cu = await capCho(k, "cu");
    const luu = await db.onlCertificate.findUniqueOrThrow({ where: { code: cu.code } });
    expect(luu.templateId).toBe(a.id);
    expect(luu.renderSnapshotJson).toMatchObject({ templateId: a.id, background: { sha256: sha256Hex(PHOI_A) } });
    const pdfTruoc = await dungPdfTheoMa(db, kho, cu.code);
    if (!pdfTruoc.ok) throw new Error(pdfTruoc.thongBao);
    // ĐỔI phôi (ảnh khác) + bố cục khác, duyệt, rồi cấp cho người mới
    const bc = boCucMacDinh();
    const b = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_B, fields: { ...bc, hoTen: { ...bc.hoTen, color: "#BF321D", fontPct: 4 } }, actorUserId: "u" });
    if (!b.ok) throw new Error(b.thongBao);
    expect(await duyetMau(db, { templateId: b.id, actorUserId: "u" })).toMatchObject({ ok: true, thayThe: a.id });
    const moi = await capCho(k, "moi");
    expect((await db.onlCertificate.findUniqueOrThrow({ where: { code: moi.code } })).templateId).toBe(b.id);
    // bản CŨ tải lại ⇒ CÙNG ĐẦU VÀO dựng (bản chụp + mã băm phôi), chính xác tuyệt đối
    const pdfSau = await dungPdfTheoMa(db, kho, cu.code);
    if (!pdfSau.ok) throw new Error(pdfSau.thongBao);
    expect(pdfSau.snapshot).toEqual(pdfTruoc.snapshot);
    expect(pdfSau.nenSha256).toBe(sha256Hex(PHOI_A));
    expect(pdfTruoc.nenSha256).toBe(sha256Hex(PHOI_A));
    // giấy cũ vẫn dựng bằng ĐÚNG phôi đã chụp (có ảnh nền nhúng), không rơi về khuôn mặc định không ảnh
    expect(chuanHoaDeSoSanh(pdfSau.pdf)).toContain("/Subtype /Image");
    // đối chứng dương: bản MỚI dùng phôi mới + bố cục mới
    const pdfMoi = await dungPdfTheoMa(db, kho, moi.code);
    if (!pdfMoi.ok) throw new Error(pdfMoi.thongBao);
    expect(pdfMoi.nenSha256).toBe(sha256Hex(PHOI_B));
    expect(pdfMoi.snapshot.templateId).toBe(b.id);
    expect(pdfMoi.snapshot.fields.hoTen.color).toBe("#BF321D");
    expect(pdfSau.snapshot.fields.hoTen.color).not.toBe("#BF321D");
    // C10: dựng PDF được bằng CẢ dạng lưu lẫn dạng in trên giấy; tên tệp tải về mang dạng in
    const dangIn = `SR-ON-${cu.code.slice(4)}`;
    expect(await dungPdfTheoMa(db, kho, dangIn)).toMatchObject({ ok: true, code: cu.code, tenTep: `chung-nhan-${dangIn}.pdf` });
    // mẫu đã dùng không xoá được
    await expect(db.onlCertificateTemplate.delete({ where: { id: a.id } })).rejects.toThrow();
    // bản chụp của giấy cũ không đổi
    expect((await db.onlCertificate.findUniqueOrThrow({ where: { code: cu.code } })).renderSnapshotJson).toEqual(luu.renderSnapshotJson);
  }, 90_000);

  it("[CNM-DB-05] 🔴 kho bị đổi/mất phôi ⇒ từ chối dựng (không vẽ nhầm phôi); đổi tên học viên sau cấp không đổi giấy; cấp trước V10.0 vẫn dựng được", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    const a = await taiPhoiLen(db, kho, { courseId: k.courseId, bytes: PHOI_A, actorUserId: "u" });
    if (!a.ok) throw new Error(a.thongBao);
    await duyetMau(db, { templateId: a.id, actorUserId: "u" });
    const cn = await capCho(k, "kho");
    const pdf0 = await dungPdfTheoMa(db, kho, cn.code);
    if (!pdf0.ok) throw new Error(pdf0.thongBao);
    const key = `online/cn/${k.courseId}/${sha256Hex(PHOI_A)}.png`;
    kho.map.set(key, PHOI_B); // kẻ xấu/lỗi vận hành ghi đè nội dung dưới cùng khoá
    expect(await dungPdfTheoMa(db, kho, cn.code)).toMatchObject({ ok: false, ma: "PHOI_KHONG_KHOP" });
    kho.map.delete(key);
    expect(await dungPdfTheoMa(db, kho, cn.code)).toMatchObject({ ok: false, ma: "PHOI_MAT" });
    kho.map.set(key, PHOI_A); // khôi phục ⇒ dựng lại được, giống hệt
    const pdf1 = await dungPdfTheoMa(db, kho, cn.code);
    if (!pdf1.ok) throw new Error(pdf1.thongBao);
    expect(pdf1.snapshot).toEqual(pdf0.snapshot);
    expect(pdf1.nenSha256).toBe(pdf0.nenSha256);
    // đổi tên học viên sau khi cấp ⇒ giấy không đổi
    await db.student.update({ where: { id: cn.hv.studentId }, data: { name: "TÊN ĐÃ ĐỔI SAU KHI CẤP" } });
    const pdf2 = await dungPdfTheoMa(db, kho, cn.code);
    if (!pdf2.ok) throw new Error(pdf2.thongBao);
    expect(pdf2.snapshot).toEqual(pdf0.snapshot);
    expect(pdf2.snapshot.texts.hoTen).not.toContain("TÊN ĐÃ ĐỔI");
    // chứng nhận cấp TRƯỚC V10.0 (không bản chụp): khuôn mặc định từ cột đã lưu
    await db.onlCertificate.update({ where: { code: cn.code }, data: { templateId: null, renderSnapshotJson: undefined } });
    await db.$executeRawUnsafe(`UPDATE "OnlCertificate" SET "renderSnapshotJson" = NULL WHERE "code" = '${cn.code}'`);
    const cu = await dungPdfTheoMa(db, kho, cn.code);
    expect(cu.ok).toBe(true);
    expect(await dungPdfTheoMa(db, kho, "KHONG-CO")).toMatchObject({ ok: false, ma: "KHONG_TON_TAI" });
  }, 90_000);

  it("[CNM-DB-06] 🔴 thu hồi: PDF mang dấu ĐÃ THU HỒI, bản chụp không đổi; chưa có mẫu ⇒ cấp vẫn chạy với khuôn mặc định", async () => {
    const k = await dungKhoa();
    const kho = khoBoNho();
    const cn = await capCho(k, "thuhoi"); // khoá CHƯA có mẫu nào
    const luu = await db.onlCertificate.findUniqueOrThrow({ where: { code: cn.code } });
    expect(luu.templateId).toBeNull();
    expect(luu.renderSnapshotJson).toMatchObject({ templateId: null, background: null });
    const truoc = await dungPdfTheoMa(db, kho, cn.code);
    if (!truoc.ok) throw new Error(truoc.thongBao);
    expect(truoc.daThuHoi).toBe(false);
    expect(await thuHoiChungNhan(db, { courseId: k.courseId, studentId: cn.hv.studentId, actorUserId: "u", reason: "Cấp nhầm học viên — thu hồi", now: NOW })).toMatchObject({ ok: true });
    const sau = await dungPdfTheoMa(db, kho, cn.code);
    if (!sau.ok) throw new Error(sau.thongBao);
    expect(sau.daThuHoi).toBe(true);
    expect(sau.snapshot).toEqual(truoc.snapshot);
    expect(chuanHoaDeSoSanh(sau.pdf)).not.toBe(chuanHoaDeSoSanh(truoc.pdf));
    expect((await db.onlCertificate.findUniqueOrThrow({ where: { code: cn.code } })).renderSnapshotJson).toEqual(luu.renderSnapshotJson);
  }, 90_000);
});
