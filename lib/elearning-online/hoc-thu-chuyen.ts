import type { Prisma, PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";

/**
 * FREE MODE — chính sách học thử + CHUYỂN tiến độ khi nâng cấp (F3/F4). Tệp riêng, KHÔNG import `quyen-hoc-db.ts` (để `capQuyenHoc` gọi F4 mà không vòng phụ thuộc).
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type ChinhSachHocThu = { dangKyMienPhi: boolean; gioiHanSoBai: number | null; hanNgay: number | null; toiDaKhoaMienPhi: number | null };
const KHONG_GIOI_HAN: ChinhSachHocThu = { dangKyMienPhi: false, gioiHanSoBai: null, hanNgay: null, toiDaKhoaMienPhi: null };

/** Chính sách học thử của BẢN ĐANG CHẠY. Cài đặt hỏng ⇒ `null` (fail-closed ở mọi hàm gọi). Vắng `hocThu` ⇒ không đăng ký tự do, không giới hạn. */
export async function docChinhSachHocThu(db: Db | Tx, courseId: string): Promise<{ versionId: string; versionNumber: number; chinhSach: ChinhSachHocThu; tinhDaXemPhanTramVideo: number } | null> {
  const k = await db.onlCourse.findFirst({ where: { id: courseId, deletedAt: null, publishedVersionId: { not: null } }, select: { publishedVersionId: true } });
  if (!k?.publishedVersionId) return null;
  const ban = await db.onlCourseVersion.findUnique({ where: { id: k.publishedVersionId }, select: { id: true, number: true, settingsJson: true } });
  if (!ban) return null;
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) return null;
  return { versionId: ban.id, versionNumber: ban.number, chinhSach: cd.caiDat.hocThu ? { ...cd.caiDat.hocThu, toiDaKhoaMienPhi: cd.caiDat.hocThu.toiDaKhoaMienPhi ?? null } : KHONG_GIOI_HAN, tinhDaXemPhanTramVideo: cd.caiDat.tinhDaXemPhanTramVideo };
}

/**
 * F4 — CHUYỂN tiến độ học thử sang quyền học thật. Gọi TRONG giao dịch của `capQuyenHoc` (đã giữ khoá quyền), idempotent:
 *  · chỉ chuyển dòng CHƯA chuyển, và chỉ bài CÒN trong bản đang chạy;
 *  · đã có tiến độ có phí cho bài đó ⇒ giữ phần TỐT HƠN (không ghi trùng, không hạ), `COMPLETED` không lùi;
 *  · KHÔNG đụng lượt thi / điểm (`bestScore`) / chứng nhận: bài VIDEO/READ không có điểm.
 */
export async function chuyenTienDoHocThu(tx: Tx, input: { studentId: string; courseId: string; entitlementId: string; now: Date }): Promise<{ daChuyen: number; boQua: number }> {
  const dong = await tx.onlFreeLessonProgress.findMany({ where: { studentId: input.studentId, courseId: input.courseId, transferredEntitlementId: null } });
  if (dong.length === 0) return { daChuyen: 0, boQua: 0 };
  const cs = await docChinhSachHocThu(tx, input.courseId);
  const baiCon = cs ? new Set((await tx.onlLesson.findMany({ where: { versionId: cs.versionId }, select: { stableId: true } })).map((b) => b.stableId)) : new Set<string>();
  let daChuyen = 0, boQua = 0;
  for (const d of dong) {
    if (!cs || !baiCon.has(d.lessonStableId)) { boQua++; continue; }
    const co = await tx.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId: input.entitlementId, lessonStableId: d.lessonStableId } } });
    if (!co) {
      await tx.onlLessonProgress.create({
        data: { entitlementId: input.entitlementId, lessonStableId: d.lessonStableId, status: d.status, percent: d.percent, completedAt: d.completedAt, completedVersionNumber: d.status === "COMPLETED" ? cs.versionNumber : null },
      });
    } else {
      const xong = co.status === "COMPLETED" || d.status === "COMPLETED";
      await tx.onlLessonProgress.update({
        where: { id: co.id },
        data: { percent: Math.max(co.percent, d.percent), status: xong ? "COMPLETED" : co.status === "NOT_STARTED" ? d.status : co.status, completedAt: co.completedAt ?? (d.status === "COMPLETED" ? d.completedAt : null), completedVersionNumber: co.completedVersionNumber ?? (d.status === "COMPLETED" ? cs.versionNumber : null) },
      });
    }
    await tx.onlFreeLessonProgress.update({ where: { id: d.id }, data: { transferredEntitlementId: input.entitlementId, transferredAt: input.now } });
    daChuyen++;
  }
  return { daChuyen, boQua };
}
