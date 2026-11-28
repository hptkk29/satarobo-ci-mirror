import { randomUUID } from "node:crypto";
import { z } from "zod";

import { db } from "@/lib/db";
import { assignmentWindow, formatVnShort } from "@/lib/lms/assignment-window";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { rateLimit } from "@/lib/rate-limit";
import { PORTAL_SUBMISSION_MAX_FILES } from "@/lib/validators/portal-submission";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * NỘP BÀI TẬP cho app (B-LMS2): `POST /students/:id/learning/assignments/:aid/submissions`. DÙNG LẠI luật của web (`submitAssignment`, `bai-tap/actions.ts`): cửa nộp qua `assignmentWindow`
 * (mở · nộp trễ · đóng), bài đã CHẤM không nộp lại, học viên phải đang ghi danh lớp của bài, bài yêu cầu video phải có video. KHÁC web ở các chỗ có chủ đích:
 *  · IDEMPOTENT theo `khoaGuiLai` + khử trùng theo (nội dung CHỮ + TẬP TỆP): chỉ khi CẢ HAI giống bản hiện hành mới coi là gửi trùng;
 *  · LỊCH SỬ PHIÊN BẢN (`AssignmentSubmissionVersion`): mỗi lần nộp/nộp lại ghi MỘT dòng bất biến — gồm cả ẢNH CHỤP TẬP TỆP (`filesJson`);
 *  · TỆP đi qua VÉ TẢI LÊN đã XÁC MINH (`tepIds` = id vé, xem tai-len.ts): đúng học viên + đúng bài + trạng thái UPLOADED; gắn xong ⇒ ATTACHED, tệp nằm KHO RIÊNG
 *    (`AssignmentSubmissionFile.storageKey`; `fileUrl` là đường dẫn có phân quyền, không phải URL kho).
 *  · QUY TẮC TẬP TỆP KHI NỘP LẠI (chốt ở đây, có test [NOP-DB-07/12]): CÓ `tepIds` ⇒ THAY toàn bộ tập tệp (như web); KHÔNG có `tepIds` ⇒ GIỮ NGUYÊN tập tệp hiện có (nộp lại chỉ sửa chữ).
 * KHÔNG BAO GIỜ cộng SataCoin / thưởng gì khi nộp bài. Điểm/trạng thái chấm do máy chủ; app không gửi. Trong giao dịch CHỈ dùng `tx`; mọi lượt của CÙNG (bài, học viên) xếp hàng bằng khoá tư vấn.
 */
export const nopBaiTapSchema = z.strictObject({
  khoaGuiLai: z.string().min(8, "Thiếu khoá gửi lại.").max(64),
  vanBan: z.string().max(20000, "Bài làm quá dài.").optional(),
  tepIds: z.array(z.string().min(1).max(64)).max(PORTAL_SUBMISSION_MAX_FILES).optional(),
});
export type NopBaiTapInput = z.infer<typeof nopBaiTapSchema>;

/** Trần gửi: 30 lượt / 10 phút theo phụ huynh (nộp + nộp lại; gồm cả gửi lại cùng khoá). */
export const GIOI_HAN_NOP_BAI = { max: 30, windowMs: 10 * 60_000 } as const;

export type KetQuaNopBaiDto = { trangThaiNop: "DA_NOP" | "NOP_TRE"; nopLuc: string; trungLap: boolean; phienBan: number };

const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
const TRANG_THAI = { SUBMITTED: "DA_NOP", LATE: "NOP_TRE" } as const;
const tepKhongHopLe = (m: string) => new LoiApiMobile("TEP_KHONG_HOP_LE", 422, m);
const laVideo = (mime: string | null | undefined) => (mime ?? "").toLowerCase().startsWith("video/");
const cungTap = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

type TepMoTa = { fileId: string; uploadId: string | null; tenTep: string; loaiMime: string | null; kichThuoc: number | null };

export async function nopBaiTap(hs: MaHocVienDaKiem, assignmentId: string, parentUserId: string, input: NopBaiTapInput, now: Date = new Date()): Promise<KetQuaNopBaiDto> {
  if (!mucBaiTapBaiThiDangHien()) throw khongThay();
  const rl = await rateLimit({ key: `lms-nop:${parentUserId}`, max: GIOI_HAN_NOP_BAI.max, windowMs: GIOI_HAN_NOP_BAI.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn nộp bài quá nhanh. Vui lòng thử lại sau ít phút.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lms-nop:${assignmentId}:${hs}`}, 0))`;

    // 1) Quyền: bài có thật, người học thấy được (không nháp/lưu trữ), học viên đang ghi danh đúng lớp của bài. Mọi lý do «không thấy» ⇒ cùng một 404.
    const a = await tx.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, classId: true, status: true, dueAt: true, lateUntil: true, allowText: true, allowFile: true, requireVideo: true },
    });
    if (!a || (a.status !== "PUBLISHED" && a.status !== "CLOSED")) throw khongThay();
    const ghiDanh = await tx.enrollment.findFirst({ where: { studentId: hs, classId: a.classId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null }, select: { id: true } });
    if (!ghiDanh) throw khongThay();

    const cu = await tx.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: hs } },
      select: { id: true, status: true, textAnswer: true, submittedAt: true, files: { select: { id: true, uploadId: true, fileName: true, mimeType: true, fileSize: true }, orderBy: { createdAt: "asc" } } },
    });

    // 2) GỬI LẠI CÙNG KHOÁ ⇒ đúng kết quả cũ (kể cả khi cửa nộp đã đóng sau lượt đầu).
    if (cu) {
      const lanTruoc = await tx.assignmentSubmissionVersion.findUnique({ where: { submissionId_idempotencyKey: { submissionId: cu.id, idempotencyKey: input.khoaGuiLai } }, select: { versionNo: true, status: true, submittedAt: true } });
      if (lanTruoc) return { trangThaiNop: TRANG_THAI[lanTruoc.status as "SUBMITTED" | "LATE"] ?? "DA_NOP", nopLuc: lanTruoc.submittedAt.toISOString(), trungLap: true, phienBan: lanTruoc.versionNo };
    }

    // 3) Luật nghiệp vụ của web.
    const cua = assignmentWindow(a, now);
    if (!cua.acceptsSubmission) {
      throw new LoiApiMobile("DA_DONG", 422, cua.until ? `Bài tập đã đóng — hết hạn nộp lúc ${formatVnShort(cua.until)}. Liên hệ giáo viên nếu cần nộp bù.` : "Bài tập đã đóng — liên hệ giáo viên nếu cần nộp bù.");
    }
    if (cu?.status === "GRADED") throw new LoiApiMobile("DA_CHAM", 409, "Bài đã được chấm — không thể nộp lại.");

    const tepIdsMoi = [...new Set(input.tepIds ?? [])];
    const coTepMoi = tepIdsMoi.length > 0;
    if (coTepMoi && !a.allowFile) throw tepKhongHopLe("Bài này không nhận tệp đính kèm.");
    const tepHienCo: TepMoTa[] = (cu?.files ?? []).map((f) => ({ fileId: f.id, uploadId: f.uploadId, tenTep: f.fileName, loaiMime: f.mimeType, kichThuoc: f.fileSize }));

    // Vé tệp: đúng học viên + đúng bài + ĐÃ XÁC MINH (UPLOADED), hoặc đã gắn đúng bài nộp này (nộp lại giữ tệp).
    let tapSauCung: TepMoTa[] = tepHienCo;
    let veMoi: { id: string; storageKey: string; fileName: string; declaredMime: string; actualSize: number | null; declaredSize: number }[] = [];
    if (coTepMoi) {
      const ve = await tx.mobileUpload.findMany({ where: { id: { in: tepIdsMoi }, studentId: hs, purpose: "ASSIGNMENT_SUBMISSION", assignmentId, status: { in: ["UPLOADED", "ATTACHED"] } } });
      if (ve.length !== tepIdsMoi.length) throw tepKhongHopLe("Có tệp chưa tải lên/chưa xác minh hoặc không thuộc bài này.");
      const dangGan = new Set(tepHienCo.map((f) => f.uploadId).filter((x): x is string => !!x));
      if (ve.some((v) => v.status === "ATTACHED" && !dangGan.has(v.id))) throw tepKhongHopLe("Có tệp đã được dùng cho bài khác.");
      veMoi = ve.filter((v) => v.status === "UPLOADED");
      tapSauCung = tepIdsMoi.map((id) => {
        const v = ve.find((x) => x.id === id)!;
        const giu = tepHienCo.find((f) => f.uploadId === id);
        return { fileId: giu?.fileId ?? randomUUID(), uploadId: id, tenTep: v.fileName, loaiMime: v.declaredMime, kichThuoc: v.actualSize ?? v.declaredSize };
      });
    }
    if (tapSauCung.length > PORTAL_SUBMISSION_MAX_FILES) throw tepKhongHopLe(`Tối đa ${PORTAL_SUBMISSION_MAX_FILES} tệp.`);
    const vanBan = a.allowText ? (input.vanBan ?? "").trim() : "";
    if (a.requireVideo && !tapSauCung.some((f) => laVideo(f.loaiMime))) throw new LoiApiMobile("TEP_CHUA_HO_TRO", 422, "Bài này yêu cầu nộp video — hãy tải video lên trước khi nộp.");
    if (!a.allowText && tapSauCung.length === 0) throw new LoiApiMobile("TEP_CHUA_HO_TRO", 422, "Bài này chỉ nhận tệp đính kèm — hãy tải tệp lên trước khi nộp.");
    if (vanBan.length === 0 && tapSauCung.length === 0) throw new LoiApiMobile("VALIDATION", 400, "Vui lòng nhập nội dung bài làm hoặc đính kèm tệp.");

    // 4) Cùng CHỮ và cùng TẬP TỆP với bản hiện hành (khoá khác) ⇒ không thêm phiên bản (trùng lặp lành tính).
    const tapCu = new Set(tepHienCo.map((f) => f.uploadId ?? f.fileId));
    const tapMoi = new Set(tapSauCung.map((f) => f.uploadId ?? f.fileId));
    if (cu && (cu.textAnswer ?? "") === vanBan && (cu.status === "SUBMITTED" || cu.status === "LATE") && cu.submittedAt && cungTap(tapCu, tapMoi)) {
      const ver = await tx.assignmentSubmissionVersion.aggregate({ where: { submissionId: cu.id }, _max: { versionNo: true } });
      return { trangThaiNop: TRANG_THAI[cu.status], nopLuc: cu.submittedAt.toISOString(), trungLap: true, phienBan: ver._max.versionNo ?? 0 };
    }

    // 5) Ghi: bản hiện hành (cột cũ) + tập tệp + MỘT dòng lịch sử. Nộp trong cửa gia hạn vẫn là LATE (đối chiếu hạn gốc).
    const trangThai = cua.countsAsLate ? ("LATE" as const) : ("SUBMITTED" as const);
    const dau = tapSauCung[0];
    const duongTai = (fileId: string) => `/api/lms/submission-file/${fileId}`;
    const chung = { textAnswer: vanBan || null, submittedAt: now, status: trangThai };
    const sub = await tx.assignmentSubmission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: hs } },
      create: { assignmentId, studentId: hs, ...chung, ...(dau ? { fileUrl: duongTai(dau.fileId), fileName: dau.tenTep, mimeType: dau.loaiMime } : {}) },
      update: { ...chung, ...(coTepMoi ? (dau ? { fileUrl: duongTai(dau.fileId), fileName: dau.tenTep, mimeType: dau.loaiMime } : {}) : {}) },
      select: { id: true },
    });
    if (coTepMoi) {
      // THAY tập tệp: gỡ các dòng cũ rồi tạo lại (giữ nguyên id cho tệp được giữ lại) — đối tượng trong kho KHÔNG bị xoá (lịch sử + lưu giữ).
      await tx.assignmentSubmissionFile.deleteMany({ where: { submissionId: sub.id } });
      const kho = await tx.mobileUpload.findMany({ where: { id: { in: tepIdsMoi } }, select: { id: true, storageKey: true } });
      await tx.assignmentSubmissionFile.createMany({
        data: tapSauCung.map((f) => ({ id: f.fileId, submissionId: sub.id, fileUrl: duongTai(f.fileId), fileName: f.tenTep, fileSize: f.kichThuoc, mimeType: f.loaiMime, storageKey: kho.find((k) => k.id === f.uploadId)?.storageKey ?? null, uploadId: f.uploadId })),
      });
      if (veMoi.length > 0) await tx.mobileUpload.updateMany({ where: { id: { in: veMoi.map((v) => v.id) }, status: "UPLOADED" }, data: { status: "ATTACHED", attachedAt: now } });
    }
    const max = await tx.assignmentSubmissionVersion.aggregate({ where: { submissionId: sub.id }, _max: { versionNo: true } });
    const versionNo = (max._max.versionNo ?? 0) + 1;
    await tx.assignmentSubmissionVersion.create({
      data: { submissionId: sub.id, versionNo, textAnswer: vanBan || null, status: trangThai, submittedAt: now, idempotencyKey: input.khoaGuiLai, source: "MOBILE", filesJson: tapSauCung.map((f) => ({ fileId: f.fileId, tenTep: f.tenTep, loaiMime: f.loaiMime, kichThuoc: f.kichThuoc })) },
    });
    return { trangThaiNop: TRANG_THAI[trangThai], nopLuc: now.toISOString(), trungLap: false, phienBan: versionNo };
  });
}
