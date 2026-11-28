import { db } from "@/lib/db";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTat, layDanhSachBaiHoc, lopCuaHocVien, type BaiHocDto, type KyUrl } from "./hoc-tap";

/**
 * `GET /students/:id/sessions/:sessionId/content` — NỘI DUNG MỘT BUỔI (màn HL-Buoi · BR-LMS-04): bài giảng + tài liệu + bài/đề về nhà GẮN VỚI BUỔI ĐÓ. CHỈ ĐỌC.
 *
 * Gộp từ nguồn SẴN CÓ (không nguồn thứ hai): bài học (`layDanhSachBaiHoc` — cùng luật «chỉ bài ĐÃ DẠY + tài liệu giáo viên đã giao cho lớp», URL ký fail-closed) ·
 * bài tập của lớp gắn `Assignment.classSessionId` (PUBLISHED/CLOSED) · đề về nhà `HomeworkAssignment` của CHÍNH học viên ở buổi này.
 * Buổi không thuộc lớp của học viên / không tồn tại / buổi bù của người khác ⇒ cùng 404. Chưa dạy ⇒ `baiGiang: null` (không lộ nội dung trước giờ). Không điểm, không đáp án.
 */
export type BaiVeNhaDto = { loai: "BAI_TAP" | "DE_THI"; id: string; tieuDe: string; hanNop: string | null; trangThai: string };
export type NoiDungBuoiDto = { buoiId: string; baiGiang: BaiHocDto | null; baiVeNha: BaiVeNhaDto[] };

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export async function layNoiDungBuoi(hs: MaHocVienDaKiem, sessionId: string, ky?: KyUrl): Promise<NoiDungBuoiDto> {
  batNeuTat(); // cờ LMS tắt ⇒ 404 (như mọi route học tập)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw khongThay();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) throw khongThay();
  const buoi = await db.classSession.findFirst({ where: { id: sessionId, classId: { in: lop } }, select: { id: true, lessonId: true, plan: { select: { lessonId: true } } } });
  if (!buoi) throw khongThay();
  const lessonId = buoi.lessonId ?? buoi.plan?.lessonId ?? null;
  const [bai, baiTap, deVeNha] = await Promise.all([
    lessonId ? layDanhSachBaiHoc(hs, ky).then((r) => r.muc.find((m) => m.id === lessonId) ?? null) : Promise.resolve(null),
    db.assignment.findMany({ where: { classSessionId: sessionId, classId: { in: lop }, status: { in: ["PUBLISHED", "CLOSED"] } }, select: { id: true, title: true, dueAt: true, status: true, submissions: { where: { studentId: hs }, select: { status: true }, take: 1 } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 }),
    db.homeworkAssignment.findMany({ where: { classSessionId: sessionId, studentId: hs }, select: { id: true, dueAt: true, status: true, examId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 }),
  ]);
  const de = deVeNha.length ? await db.exam.findMany({ where: { id: { in: deVeNha.map((d) => d.examId) }, status: "PUBLISHED" }, select: { id: true, title: true } }) : [];
  const tenDe = new Map(de.map((e) => [e.id, e.title]));
  return {
    buoiId: buoi.id,
    baiGiang: bai,
    baiVeNha: [
      ...baiTap.map((a) => ({ loai: "BAI_TAP" as const, id: a.id, tieuDe: a.title, hanNop: a.dueAt ? a.dueAt.toISOString() : null, trangThai: a.submissions[0]?.status ?? "NOT_SUBMITTED" })),
      // Đề về nhà: chỉ đề còn PUBLISHED (đề nháp/đã gỡ không lộ); không kèm điểm.
      ...deVeNha.filter((d) => tenDe.has(d.examId)).map((d) => ({ loai: "DE_THI" as const, id: d.examId, tieuDe: tenDe.get(d.examId) as string, hanNop: d.dueAt ? d.dueAt.toISOString() : null, trangThai: d.status })),
    ],
  };
}
