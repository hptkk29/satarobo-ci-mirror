import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SnapshotDe } from "@/lib/elearning-online/cham-diem";
import { kiemTraTruyCapChoPhuHuynh } from "@/lib/elearning-online/hoc-tap";
import { MIME_THEO_LOAI, tienToKhoaSanPham, type CauHinhSanPham, type LoaiTep } from "@/lib/elearning-online/san-pham";
import { nopSanPham } from "@/lib/elearning-online/san-pham-db";
import { kiemNoiDung, layKhoTepRieng } from "../kho-tep-rieng";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";
import { batNeuTatOnline, loiTuMa, yeuCauHocSinhTuGhi } from "./online-hoc";

/**
 * V8.45 — NỘP SẢN PHẨM (câu PRODUCT) của bài thi Online trên app: VÉ TẢI LÊN + ĐĂNG KÝ BÀI NỘP. Lõi E (`nopSanPham`) chỉ nhận SIÊU DỮ LIỆU và lưu `fileKey` — nó KHÔNG ký,
 * KHÔNG HEAD, KHÔNG đọc đối tượng R2 — nên mọi kiểm tra «tệp có thật, đúng loại, đúng cỡ» là việc của lớp này (chốt với E 25/11):
 *   1. CHỈ phiên Student Mode của CHÍNH em (ghi). Phụ huynh phiên thường ⇒ 403 như mọi API ghi học tập.
 *   2. Khoá đối tượng BẮT BUỘC `online/sp/{courseId}/{studentId}/{attemptId}-{questionId}-{uuid}.{đuôi}` (đuôi do MÁY CHỦ suy từ MIME đã xác nhận, không tin tên tệp).
 *      Tên tệp client khai chỉ để HIỂN THỊ. Khoá gắn với (lượt, câu) ⇒ không đem tệp của lượt/câu khác nộp sang.
 *   3. Kho = KHO TỆP RIÊNG của A (`kho-tep-rieng.ts`: bucket riêng, không CDN, URL ký ngắn hạn). Không có kho ⇒ 503 `KHO_TEP_CHUA_CAU_HINH` (fail-closed, KHÔNG rơi về bucket công khai).
 *   4. Vé PUT ký kèm đúng Content-Type. R2 không ép được cỡ ở vé ⇒ ép LÚC ĐĂNG KÝ: HEAD đối tượng (cỡ + loại THẬT) + đọc vài byte đầu nhận dạng định dạng; quá cỡ/sai loại ⇒ XOÁ đối tượng + 422.
 *      `sizeBytes` client khai chỉ để từ chối sớm; số lưu vào E là cỡ THẬT. `durationSec` là lời khai của client (không đo được ở máy chủ) — chỉ đối chiếu trần `maxVideoSec`.
 *   5. Gửi lại cùng `key` ⇒ idempotent (trả bài nộp đang hiệu lực, không đẻ bản thứ hai).
 * Mã bài nộp (`submissionId`) là «câu trả lời» của câu PRODUCT: app đưa vào PUT draft; lõi E đối chiếu mã với bài nộp THẬT của đúng lượt + câu + học viên khi chốt.
 */

const TTL_VE_GIAY = 15 * 60;
const MB = 1024 * 1024;
const DAU_BYTE = 64;
const KHOA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DUOI_THEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const idSchema = z.string().trim().regex(KHOA_ID, "Mã không hợp lệ");
const coKyTuCam = (v: string): boolean => v.includes("/") || v.includes("\\") || [...v].some((c) => c.charCodeAt(0) < 32); // dấu gạch và ký tự điều khiển
const tenHienThi = z.string().trim().min(1, "Thiếu tên tệp").max(200).refine((v) => !coKyTuCam(v), "Tên tệp không hợp lệ");
const mimeSchema = z.string().trim().toLowerCase().max(100);
const thoiLuong = z.number().int().positive().max(24 * 3600).optional();

export const veTaiLenSchema = z.object({ questionId: idSchema, fileName: tenHienThi, mime: mimeSchema, sizeBytes: z.number().int().positive().max(500 * MB), durationSec: thoiLuong });
export const dangKyBaiNopSchema = z.object({ questionId: idSchema, key: z.string().trim().min(1).max(300), name: tenHienThi, mime: mimeSchema, durationSec: thoiLuong });
export type VeTaiLenBody = z.infer<typeof veTaiLenSchema>;
export type DangKyBaiNopBody = z.infer<typeof dangKyBaiNopSchema>;

const THONG_BAO: Record<string, string> = {
  TEP_KHONG_HOP_LE: "Tệp không hợp lệ (loại, dung lượng hoặc thời lượng vượt giới hạn của câu hỏi).",
  CAU_KHONG_PHAI_SAN_PHAM: "Câu này không nhận bài nộp sản phẩm.",
  DA_NOP: "Bài đã nộp — chưa được yêu cầu nộp lại.",
  LUOT_DA_DONG: "Lượt làm bài đã đóng hoặc hết giờ.",
};
const HTTP: Record<string, number> = { TEP_KHONG_HOP_LE: 422, CAU_KHONG_PHAI_SAN_PHAM: 422, DA_NOP: 409, LUOT_DA_DONG: 409 };

/** Mã lỗi của `nopSanPham` + cổng truy cập → lỗi HTTP. Bảng HTTP của E chưa có các mã nộp sản phẩm (E xác nhận 25/11) ⇒ ánh xạ ở đây; mã còn lại đi bảng của E. */
export function loiSanPham(ma: string): LoiApiMobile {
  const st = HTTP[ma];
  if (st) return new LoiApiMobile(ma as never, st, THONG_BAO[ma] ?? "Không nộp được sản phẩm.");
  return loiTuMa(ma);
}

type NguCanhNop = { cfg: CauHinhSanPham; tienTo: string; trangThaiLuot: string };

/** Quyền truy cập (đúng con + còn quyền học) + lượt + câu PRODUCT. KHÔNG ghi gì. */
async function napNguCanh(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, questionId: string, now: Date): Promise<NguCanhNop> {
  batNeuTatOnline();
  yeuCauHocSinhTuGhi(hs, nguoi);
  if (![courseId, lessonId, attemptId].every((x) => KHOA_ID.test(x))) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const cong = await kiemTraTruyCapChoPhuHuynh(db as never, { parentUserId: nguoi.userId, studentId: hs, courseId, lessonStableId: lessonId, now });
  if (!cong.ok) throw loiSanPham(cong.ma);
  const a = await db.onlAttempt.findUnique({ where: { id: attemptId }, select: { id: true, status: true, studentId: true, lessonStableId: true, dueAt: true, snapshotJson: true, entitlement: { select: { courseId: true } } } });
  if (!a || a.studentId !== hs || a.lessonStableId !== lessonId || a.entitlement.courseId !== courseId) throw loiSanPham("LUOT_KHONG_TON_TAI");
  const cau = (a.snapshotJson as unknown as SnapshotDe).cau.find((c) => c.id === questionId && c.type === "PRODUCT");
  if (!cau) throw loiSanPham("CAU_KHONG_PHAI_SAN_PHAM");
  // Còn nộp được không: đang làm & chưa quá giờ; hoặc đã nộp nhưng người chấm YÊU CẦU NỘP LẠI. (Quyết định cuối vẫn là của `nopSanPham`.)
  const dangLam = a.status === "IN_PROGRESS";
  if (dangLam && a.dueAt && now.getTime() > a.dueAt.getTime()) throw loiSanPham("LUOT_DA_DONG");
  if (!dangLam) {
    const yeuCauNopLai = a.status === "SUBMITTED" && !!(await db.onlSubmission.findFirst({ where: { attemptId, questionId, studentId: hs, status: "RESUBMIT_REQUESTED" }, select: { id: true } }));
    if (!yeuCauNopLai) throw loiSanPham(a.status === "SUBMITTED" ? "DA_NOP" : "LUOT_DA_DONG");
  }
  return { cfg: (cau.cauHinh ?? {}) as unknown as CauHinhSanPham, tienTo: tienToKhoaSanPham(courseId, hs), trangThaiLuot: a.status };
}

const loaiMime = (cfg: CauHinhSanPham, mime: string): LoaiTep | null => (cfg.accept ?? []).find((l) => (MIME_THEO_LOAI[l] as readonly string[]).includes(mime)) ?? null;

/** Từ chối sớm những gì CHẮC CHẮN sai: loại tệp, cỡ khai, thời lượng khai. */
function kiemKhaiBao(cfg: CauHinhSanPham, mime: string, sizeBytes: number | null, durationSec: number | undefined): LoaiTep {
  const loai = loaiMime(cfg, mime);
  if (!loai || !DUOI_THEO_MIME[mime]) throw loiSanPham("TEP_KHONG_HOP_LE");
  if (sizeBytes !== null && sizeBytes > cfg.maxMb * MB) throw loiSanPham("TEP_KHONG_HOP_LE");
  if (durationSec !== undefined && (loai !== "VIDEO" || (cfg.maxVideoSec != null && durationSec > cfg.maxVideoSec))) throw loiSanPham("TEP_KHONG_HOP_LE");
  // Lõi E ĐÒI `durationSec` cho video khi câu có trần thời lượng (`kiemTepNop`: «Thiếu thời lượng video») — chặn sớm với câu rõ nghĩa để app biết phải gửi.
  if (loai === "VIDEO" && cfg.maxVideoSec && durationSec === undefined) throw new LoiApiMobile("TEP_KHONG_HOP_LE" as never, 422, `Cần khai thời lượng video (giây); tối đa ${cfg.maxVideoSec} giây.`);
  return loai;
}

const khoPhaiCo = () => {
  const kho = layKhoTepRieng();
  if (!kho) throw new LoiApiMobile("KHO_TEP_CHUA_CAU_HINH" as never, 503, "Kho tệp chưa sẵn sàng. Vui lòng thử lại sau.", 60);
  return kho;
};

/** `POST …/attempts/:attemptId/product/upload-ticket` — cấp VÉ PUT ngắn hạn. Chưa ghi gì vào E; tệp chưa thuộc bài nộp nào cho tới khi `dangKyBaiNopSanPham`. */
export async function capVeTaiLenSanPham(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, body: VeTaiLenBody, now = new Date()) {
  const nc = await napNguCanh(hs, nguoi, courseId, lessonId, attemptId, body.questionId, now);
  kiemKhaiBao(nc.cfg, body.mime, body.sizeBytes, body.durationSec);
  const key = `${nc.tienTo}${attemptId}-${body.questionId}-${randomUUID()}.${DUOI_THEO_MIME[body.mime]}`;
  const ve = await khoPhaiCo().kyPut(key, body.mime, TTL_VE_GIAY);
  return { uploadUrl: ve.url, method: "PUT" as const, headers: ve.headers, key, hetHanLuc: new Date(now.getTime() + TTL_VE_GIAY * 1000).toISOString(), toiDaByte: nc.cfg.maxMb * MB };
}

/** `POST …/attempts/:attemptId/product/submit` — kiểm đối tượng THẬT rồi gọi `nopSanPham`; trả `submissionId` (= câu trả lời của câu PRODUCT). */
export async function dangKyBaiNopSanPham(hs: MaHocVienDaKiem, nguoi: NguoiGoi, courseId: string, lessonId: string, attemptId: string, body: DangKyBaiNopBody, now = new Date()) {
  const nc = await napNguCanh(hs, nguoi, courseId, lessonId, attemptId, body.questionId, now);
  const loai = kiemKhaiBao(nc.cfg, body.mime, null, body.durationSec);
  // Khoá phải của ĐÚNG học viên + ĐÚNG lượt + ĐÚNG câu (E chỉ kiểm tiền tố học viên; ta siết thêm để không đem tệp của lượt/câu khác nộp sang).
  const dau = `${nc.tienTo}${attemptId}-${body.questionId}-`;
  if (!body.key.startsWith(dau) || !/^[A-Za-z0-9._-]+$/.test(body.key.slice(nc.tienTo.length))) throw loiSanPham("TEP_KHONG_HOP_LE");

  // Idempotent: đã đăng ký ĐÚNG khoá này cho lượt+câu này ⇒ trả lại, không đẻ bản thứ hai.
  const daCo = await db.onlSubmission.findFirst({ where: { attemptId, questionId: body.questionId, studentId: hs, fileKey: body.key, status: { in: ["SUBMITTED", "GRADED", "RESUBMIT_REQUESTED"] } }, select: { id: true } });
  if (daCo) return { submissionId: daCo.id, nopLai: false, daDangKyTruocDo: true };

  const kho = khoPhaiCo();
  const dauTep = await kho.dau(body.key);
  if (!dauTep) throw new LoiApiMobile("TEP_KHONG_HOP_LE" as never, 422, "Tệp chưa được tải lên. Hãy tải tệp lên bằng vé rồi nộp lại.");
  const mimeThat = (dauTep.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  const huy = async (): Promise<never> => {
    await kho.xoa(body.key).catch(() => {}); // tệp vi phạm KHÔNG được nằm lại kho
    throw loiSanPham("TEP_KHONG_HOP_LE");
  };
  if (mimeThat !== body.mime || loaiMime(nc.cfg, mimeThat) !== loai) return huy();
  if (dauTep.size <= 0 || dauTep.size > nc.cfg.maxMb * MB) return huy();
  const byteDau = await kho.docByteDau(body.key, DAU_BYTE);
  if (!byteDau || !kiemNoiDung(mimeThat, byteDau)) return huy();

  const r = await nopSanPham(db as never, {
    parentUserId: nguoi.userId,
    studentId: hs,
    courseId,
    lessonStableId: lessonId,
    attemptId,
    questionId: body.questionId,
    file: { key: body.key, name: body.name, mime: mimeThat, sizeBytes: dauTep.size, ...(body.durationSec !== undefined ? { durationSec: body.durationSec } : {}) },
    now,
  });
  if (!r.ok) {
    if (r.ma === "TEP_KHONG_HOP_LE") await kho.xoa(body.key).catch(() => {});
    throw loiSanPham(r.ma);
  }
  return { submissionId: r.submissionId, nopLai: r.nopLai, daDangKyTruocDo: false };
}

/** Người chấm tải bài nộp: URL KÝ ngắn hạn (5 phút), KHÔNG log URL, không CDN công khai. Quyền do route kiểm trước. `null` = không có bài nộp / kho chưa sẵn sàng. */
export async function layUrlBaiNopChoNguoiCham(submissionId: string, now = new Date()): Promise<{ ok: true; url: string; hetHanLuc: string; tenTep: string; mime: string } | { ok: false; ma: 404 | 503 }> {
  if (!KHOA_ID.test(submissionId)) return { ok: false, ma: 404 };
  const s = await db.onlSubmission.findUnique({ where: { id: submissionId }, select: { fileKey: true, fileName: true, mimeType: true, courseId: true, studentId: true } });
  // Chỉ tệp nằm đúng vùng sản phẩm của chính học viên/khoá ghi trên bài nộp — chặn dữ liệu lạc khoá bị dùng để ký URL ra ngoài vùng.
  if (!s || !s.fileKey.startsWith(tienToKhoaSanPham(s.courseId, s.studentId))) return { ok: false, ma: 404 };
  const kho = layKhoTepRieng();
  if (!kho) return { ok: false, ma: 503 };
  const TTL = 300;
  const url = await kho.kyGet(s.fileKey, TTL, s.fileName);
  if (!url) return { ok: false, ma: 404 };
  return { ok: true, url, hetHanLuc: new Date(now.getTime() + TTL * 1000).toISOString(), tenTep: s.fileName, mime: s.mimeType };
}
