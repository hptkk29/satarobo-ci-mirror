import { z } from "zod";

import { db } from "@/lib/db";
import { assignmentWindow } from "@/lib/lms/assignment-window";
import { rateLimit } from "@/lib/rate-limit";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { detectCategory, UPLOAD_CONFIG, validateFile } from "@/lib/storage/upload-config";
import { PORTAL_SUBMISSION_MAX_FILES } from "@/lib/validators/portal-submission";

import { khoaDoiTuong, kiemNoiDung, layKhoTepRieng, type KhoTepRieng } from "../kho-tep-rieng";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { batNeuTat } from "./hoc-tap";

/**
 * VÉ TẢI LÊN (B-LMS2 · BR-UPLOAD-01) — `POST …/learning/uploads` + `POST …/learning/uploads/:id/complete`.
 *
 * Luồng: (1) app xin VÉ (máy chủ kiểm quyền + loại + cỡ, trả URL KÝ ngắn hạn vào kho RIÊNG) → (2) app PUT thẳng lên kho → (3) app báo `complete` → máy chủ XÁC MINH
 * đối tượng có thật (cỡ ĐÚNG khai báo, loại khớp, vài byte đầu đúng định dạng) rồi mới chuyển UPLOADED → (4) nộp bài / lưu câu mới được GẮN vé (ATTACHED).
 * Tệp sai ⇒ bị XOÁ khỏi kho + vé REJECTED. Không bao giờ URL công khai. Quét mã độc: CHƯA có hạ tầng ⇒ blocker B-UPLOAD-SCAN, không giả vờ.
 * IDEMPOTENT: khoá đối tượng xác định theo (phụ huynh, `khoaGuiLai`, mục đích, phạm vi) ⇒ xin lại cùng khoá trả đúng vé cũ (ký lại URL nếu còn ISSUED).
 */
export const TTL_VE_GIAY = 600;
export const GIOI_HAN_VE = { max: 60, windowMs: 10 * 60_000 } as const;
const TRAN_VIDEO_BYTE = 120 * 1024 * 1024; // như cổng web: trần 120MB cho video nộp bài
const LUI_XAC_MINH_MS = 10 * 60_000; // cho báo `complete` muộn tối đa 10 phút sau khi URL hết hạn

export const xinVeSchema = z.discriminatedUnion("mucDich", [
  z.strictObject({ mucDich: z.literal("bai_nop"), khoaGuiLai: z.string().min(8).max(64), baiTapId: z.string().min(1).max(64), tenTep: z.string().min(1).max(200), loaiMime: z.string().min(1).max(100), kichThuoc: z.number().int().min(1) }),
  z.strictObject({ mucDich: z.literal("bai_thi"), khoaGuiLai: z.string().min(8).max(64), luotId: z.string().min(1).max(64), cauHoiId: z.string().min(1).max(64), tenTep: z.string().min(1).max(200), loaiMime: z.string().min(1).max(100), kichThuoc: z.number().int().min(1) }),
]);
export type XinVe = z.infer<typeof xinVeSchema>;
export type VeDto = { tepId: string; trangThai: "CHO_TAI_LEN" | "DA_TAI_LEN" | "DA_GAN"; uploadUrl: string | null; phuongThuc: "PUT"; headers: Record<string, string>; hetHanLuc: string; kichThuoc: number };
export type XacMinhDto = { tepId: string; trangThai: "DA_TAI_LEN" | "DA_GAN"; kichThuoc: number };

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
const khongHopLe = (m: string) => new LoiApiMobile("TEP_KHONG_HOP_LE", 422, m);
const kho = (): KhoTepRieng => {
  const k = layKhoTepRieng();
  if (!k) throw new LoiApiMobile("SERVER", 503, "Kho tệp riêng chưa được cấu hình — chưa tải lên được.", 60);
  return k;
};
const TRANG_THAI = { ISSUED: "CHO_TAI_LEN", UPLOADED: "DA_TAI_LEN", ATTACHED: "DA_GAN" } as const;

export async function xinVe(hs: MaHocVienDaKiem, parentUserId: string, input: XinVe, now: Date = new Date()): Promise<VeDto> {
  batNeuTat();
  const k = kho();
  const rl = await rateLimit({ key: `lms-ve:${parentUserId}`, max: GIOI_HAN_VE.max, windowMs: GIOI_HAN_VE.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn xin tải lên quá nhanh. Vui lòng thử lại sau ít phút.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));

  // Loại + cỡ + đuôi (cùng luật tải lên của cổng web; CHỈ ảnh / tài liệu / video).
  const loaiMime = input.loaiMime.trim().toLowerCase();
  const nhom = detectCategory(loaiMime);
  if (!nhom || !(["image", "document", "video"] as const).includes(nhom as "image")) throw khongHopLe("Chỉ nộp được ảnh, tài liệu hoặc video.");
  if (input.mucDich === "bai_thi" && nhom !== "video") throw khongHopLe("Câu này chỉ nhận video.");
  const tran = nhom === "video" ? Math.min(UPLOAD_CONFIG.video.maxSize, TRAN_VIDEO_BYTE) : UPLOAD_CONFIG[nhom].maxSize;
  if (input.kichThuoc > tran) throw khongHopLe(`Tệp quá lớn. Tối đa ${Math.round(tran / 1024 / 1024)}MB.`);
  const loi = validateFile(nhom, input.tenTep, loaiMime, input.kichThuoc);
  if (loi) throw khongHopLe(loi);
  const duoi = input.tenTep.toLowerCase().match(/\.[a-z0-9]{1,5}$/)?.[0] ?? "";

  // Quyền + trạng thái theo mục đích.
  let assignmentId: string | null = null;
  let attemptId: string | null = null;
  let examQuestionId: string | null = null;
  let phamVi: string;
  if (input.mucDich === "bai_nop") {
    const dsLop = (await db.enrollment.findMany({ where: { studentId: hs, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null }, select: { classId: true } })).map((e) => e.classId);
    const a = await db.assignment.findFirst({ where: { id: input.baiTapId, classId: { in: dsLop }, status: { in: ["PUBLISHED", "CLOSED"] } }, select: { id: true, status: true, dueAt: true, lateUntil: true, allowFile: true } });
    if (!a) throw khongThay();
    if (!assignmentWindow(a, now).acceptsSubmission) throw new LoiApiMobile("DA_DONG", 422, "Bài tập đã đóng — không tải lên được.");
    if (!a.allowFile) throw khongHopLe("Bài này không nhận tệp đính kèm.");
    const cu = await db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: a.id, studentId: hs } }, select: { status: true } });
    if (cu?.status === "GRADED") throw new LoiApiMobile("DA_CHAM", 409, "Bài đã được chấm — không nộp thêm tệp.");
    assignmentId = a.id;
    phamVi = a.id;
  } else {
    const l = await db.examAttempt.findFirst({ where: { id: input.luotId, studentId: hs }, select: { id: true, status: true, deadlineAt: true, contentSnapshot: true } });
    if (!l || !l.contentSnapshot) throw khongThay();
    if (l.status !== "IN_PROGRESS") throw new LoiApiMobile("LUOT_DA_NOP", 409, "Lượt thi đã nộp.");
    if (!l.deadlineAt || now.getTime() > l.deadlineAt.getTime()) throw new LoiApiMobile("HET_GIO", 422, "Đã hết giờ làm bài.");
    const cau = ((l.contentSnapshot as { cau?: { id: string; type: string }[] }).cau ?? []).find((q) => q.id === input.cauHoiId);
    if (!cau || cau.type !== "VIDEO") throw khongHopLe("Câu hỏi không nhận tệp.");
    attemptId = l.id;
    examQuestionId = cau.id;
    phamVi = `${l.id}:${cau.id}`;
  }

  const key = khoaDoiTuong({ parentUserId, studentId: hs, khoaGuiLai: input.khoaGuiLai, mucDich: input.mucDich, phamVi, duoi });
  const hetHan = new Date(now.getTime() + TTL_VE_GIAY * 1000);
  let ve = await db.mobileUpload.findUnique({ where: { storageKey: key } });
  if (!ve) {
    // Trần số vé còn sống trên cùng phạm vi (chống nhồi kho).
    const dangSong = await db.mobileUpload.count({ where: { studentId: hs, status: { in: ["ISSUED", "UPLOADED"] }, ...(assignmentId ? { assignmentId } : { attemptId, examQuestionId }) } });
    if (dangSong >= (assignmentId ? PORTAL_SUBMISSION_MAX_FILES : 1)) throw khongHopLe(assignmentId ? `Tối đa ${PORTAL_SUBMISSION_MAX_FILES} tệp cho một bài.` : "Câu này chỉ nhận 1 tệp.");
    try {
      ve = await db.mobileUpload.create({
        data: { parentUserId, studentId: hs, purpose: assignmentId ? "ASSIGNMENT_SUBMISSION" : "EXAM_ANSWER", assignmentId, attemptId, examQuestionId, storageKey: key, fileName: input.tenTep, declaredMime: loaiMime, declaredSize: input.kichThuoc, expiresAt: hetHan },
      });
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== "P2002") throw e;
      ve = await db.mobileUpload.findUnique({ where: { storageKey: key } }); // đua cùng khoá ⇒ lấy vé của lượt thắng
    }
  }
  if (!ve || ve.studentId !== hs || ve.parentUserId !== parentUserId) throw khongThay();
  // Cùng khoá nhưng KHAI KHÁC (cỡ/loại): không cho tái dùng vé cho tệp khác.
  if (ve.declaredSize !== input.kichThuoc || ve.declaredMime !== loaiMime) throw khongHopLe("Khoá gửi lại này đã dùng cho một tệp khác.");
  if (ve.status === "REJECTED" || ve.status === "EXPIRED") throw khongHopLe("Vé này không còn dùng được — hãy xin vé mới bằng khoá gửi lại khác.");
  if (ve.status === "ISSUED") {
    // Còn chờ tải: cấp (lại) URL ký. Quá hạn vé ⇒ gia hạn tại chỗ (cùng khoá) — vẫn là đúng học viên/bài.
    const ky = await k.kyPut(ve.storageKey, ve.declaredMime, TTL_VE_GIAY);
    if (ve.expiresAt.getTime() < now.getTime()) await db.mobileUpload.update({ where: { id: ve.id }, data: { expiresAt: hetHan } });
    return { tepId: ve.id, trangThai: "CHO_TAI_LEN", uploadUrl: ky.url, phuongThuc: "PUT", headers: ky.headers, hetHanLuc: (ve.expiresAt.getTime() < now.getTime() ? hetHan : ve.expiresAt).toISOString(), kichThuoc: ve.declaredSize };
  }
  return { tepId: ve.id, trangThai: TRANG_THAI[ve.status as "UPLOADED" | "ATTACHED"], uploadUrl: null, phuongThuc: "PUT", headers: {}, hetHanLuc: ve.expiresAt.toISOString(), kichThuoc: ve.declaredSize };
}

async function tuChoi(k: KhoTepRieng, id: string, key: string, trangThai: "REJECTED" | "EXPIRED", lyDo: string): Promise<never> {
  await db.mobileUpload.updateMany({ where: { id, status: "ISSUED" }, data: { status: trangThai } });
  await k.xoa(key).catch(() => undefined); // tệp sai/hết hạn bị gỡ khỏi kho
  throw khongHopLe(lyDo);
}

export async function xacMinhVe(hs: MaHocVienDaKiem, parentUserId: string, tepId: string, now: Date = new Date()): Promise<XacMinhDto> {
  batNeuTat();
  const k = kho();
  const ve = await db.mobileUpload.findFirst({ where: { id: tepId, studentId: hs, parentUserId } });
  if (!ve) throw khongThay();
  if (ve.status === "UPLOADED" || ve.status === "ATTACHED") return { tepId: ve.id, trangThai: TRANG_THAI[ve.status], kichThuoc: ve.actualSize ?? ve.declaredSize };
  if (ve.status !== "ISSUED") throw khongHopLe("Vé này không còn dùng được.");
  if (now.getTime() > ve.expiresAt.getTime() + LUI_XAC_MINH_MS) return tuChoi(k, ve.id, ve.storageKey, "EXPIRED", "Vé đã hết hạn — hãy tải lại.");

  const dau = await k.dau(ve.storageKey);
  if (!dau) throw khongHopLe("Chưa thấy tệp tải lên. Hãy tải lại rồi báo hoàn tất.");
  if (dau.size !== ve.declaredSize) return tuChoi(k, ve.id, ve.storageKey, "REJECTED", "Cỡ tệp không khớp khai báo.");
  if (dau.contentType && dau.contentType.split(";")[0]!.trim().toLowerCase() !== ve.declaredMime) return tuChoi(k, ve.id, ve.storageKey, "REJECTED", "Loại tệp không khớp khai báo.");
  const byte = await k.docByteDau(ve.storageKey, 32);
  if (!byte || !kiemNoiDung(ve.declaredMime, byte)) return tuChoi(k, ve.id, ve.storageKey, "REJECTED", "Nội dung tệp không đúng định dạng khai báo.");

  const nhan = await db.mobileUpload.updateMany({ where: { id: ve.id, status: "ISSUED" }, data: { status: "UPLOADED", actualSize: dau.size, verifiedAt: now } });
  void nhan; // đua hai lượt `complete`: bên thua thấy UPLOADED ở lần đọc kế — kết quả như nhau
  return { tepId: ve.id, trangThai: "DA_TAI_LEN", kichThuoc: dau.size };
}
