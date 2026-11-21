// lib/hoc-bu/yeu-cau-them-be-thuan.ts — THÊM HỌC VIÊN VÀO CASE CÓ SẴN PHẢI QUA QUẢN LÝ CƠ SỞ DUYỆT (24/10/2026). THUẦN, không chạm DB.
//
// Chủ dự án chốt 24/10/2026: "mỗi lần thêm học viên khác vào case có sẵn cũng phải qua qlcs duyệt" — cùng tinh thần T17 (case do Sale tạo chờ duyệt).
//
// ── Vì sao KHÔNG đưa case về `PENDING_APPROVAL` ───────────────────────────────────────────────────────────
// Case đang được thêm bé là LỊCH THẬT: giáo viên đã thấy, phụ huynh các bé đã trong case đã được báo. Lật nó về "chờ duyệt" là làm lịch của những bé ĐÃ được duyệt
// biến mất khỏi mắt giáo viên. Nên việc duyệt đi theo YÊU CẦU (`MakeupCaseAddRequest`): case KHÔNG đổi một chữ cho tới khi quản lý cơ sở duyệt — lúc đó chạy đúng
// đường `xepVaoCaseCoSan` hiện có (kiểm lại lượt, trùng lịch, tối đa 3 bài ở thời điểm duyệt, không tin lần kiểm lúc xin).
//
// ── Phạm vi của luật ──────────────────────────────────────────────────────────────────────────────────────
// "Học viên KHÁC" = bé chưa là người tham gia ĐANG HỌC của case (chưa có, hoặc đã bị gỡ — gỡ rồi thêm lại cũng là thêm bé vào case). Thêm buổi vắng khác của bé ĐÃ trong
// case (nút "Thêm buổi" ở thẻ từng bé) KHÔNG phải thêm học viên khác nên đi thẳng như cũ. Một lần bấm có DÙ CHỈ MỘT bé mới ⇒ cả lần bấm chờ duyệt (không tách đôi:
// luật "tối đa 3 bài" là phép tính tổ hợp trên cả lô).
import type { MakeupParticipantAttendance } from "@prisma/client";

export type QuyetDinhThem = "NGAY" | "CHO_DUYET";

/** Bé còn là người tham gia ĐANG HỌC của case (khác `REMOVED`). Cùng định nghĩa với `beTrongCase` của danh sách ứng viên. */
export const laBeDangTrongCase = (attendanceStatus: MakeupParticipantAttendance): boolean => attendanceStatus !== "REMOVED";

/** Các bé trong lô CHƯA là người tham gia đang học của case — đã khử trùng, giữ thứ tự xuất hiện. */
export function beMoiTrongLo(
  studentIdsCuaLo: readonly string[],
  nguoiThamGia: readonly { studentId: string; attendanceStatus: MakeupParticipantAttendance }[],
): string[] {
  const dangHoc = new Set(nguoiThamGia.filter((b) => laBeDangTrongCase(b.attendanceStatus)).map((b) => b.studentId));
  return [...new Set(studentIdsCuaLo)].filter((s) => !dangHoc.has(s));
}

/**
 * MỘT chỗ quyết: thêm ngay hay phải chờ duyệt. `coQuyenDuyet` BẮT BUỘC khai ở chỗ gọi (quyền `makeup:waive`, đọc thật ở action) — mặc định sai là hoặc chặn
 * mọi lượt thêm của quản lý, hoặc cho Sale bỏ qua bước duyệt.
 */
export function quyetDinhThemVaoCase(p: { coQuyenDuyet: boolean; soBeMoi: number }): QuyetDinhThem {
  if (p.coQuyenDuyet) return "NGAY";
  return p.soBeMoi > 0 ? "CHO_DUYET" : "NGAY";
}

/** Câu hiện ở dòng cần bù đang có yêu cầu chờ duyệt — bảng Cần bù khoá dòng bằng đúng câu này (không hứa nút bấm được rồi mới từ chối). */
export const LY_DO_DANG_CHO_DUYET_THEM = "Đang chờ quản lý cơ sở duyệt thêm vào một case — chờ duyệt xong hoặc nhờ rút yêu cầu";

/** Chữ trên nút / toast cho người KHÔNG có quyền duyệt khi lô có bé mới (giao diện hứa đúng điều máy chủ sẽ làm). */
export const NHAN_GUI_DUYET = "Gửi quản lý cơ sở duyệt";

export type DongYeuCau = {
  id: string;
  batchId: string;
  caseId: string;
  makeupNeedId: string;
  studentId: string;
  moRongBai: boolean;
  proposedById: string;
};

export type LoYeuCau = {
  batchId: string;
  caseId: string;
  proposedById: string;
  moRongBai: boolean;
  needIds: string[];
  studentIds: string[];
};

/** Gom các dòng yêu cầu thành LÔ theo `batchId` (giữ thứ tự dòng đầu của mỗi lô). Lô không đồng nhất case / người gửi là dữ liệu hỏng — báo thay vì đoán. */
export function gomTheoLo(dong: readonly DongYeuCau[]): LoYeuCau[] {
  const theoLo = new Map<string, LoYeuCau>();
  for (const d of dong) {
    const lo = theoLo.get(d.batchId);
    if (!lo) {
      theoLo.set(d.batchId, {
        batchId: d.batchId,
        caseId: d.caseId,
        proposedById: d.proposedById,
        moRongBai: d.moRongBai,
        needIds: [d.makeupNeedId],
        studentIds: [d.studentId],
      });
      continue;
    }
    if (lo.caseId !== d.caseId || lo.proposedById !== d.proposedById) {
      throw new Error(`Lô ${d.batchId} không đồng nhất (case / người gửi) — dữ liệu hỏng`);
    }
    lo.needIds.push(d.makeupNeedId);
    if (!lo.studentIds.includes(d.studentId)) lo.studentIds.push(d.studentId);
    lo.moRongBai ||= d.moRongBai;
  }
  return [...theoLo.values()];
}
