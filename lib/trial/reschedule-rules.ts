// lib/trial/reschedule-rules.ts — GĐ3.
//
// Phần QUYẾT ĐỊNH của việc dời lịch, tách thành hàm THUẦN.
//
// Vì sao tách: năm điều kiện chặn dưới đây là chỗ dễ sai nhất của cả tính năng, mà
// nếu để lẫn trong hàm chạm DB thì chỉ test được bằng Postgres thật. Tách ra thì
// vitest phủ đủ nhánh, không cần dựng DB.
import type { TrialEnrollmentStatusV2, TrialSessionStatusV2 } from "./reschedule-types";

export type DoiLichInput = {
  /** Trạng thái của ca đang muốn dời. */
  caStatus: TrialEnrollmentStatusV2;
  /** Lớp của ca. */
  caTrialClassId: string;
  /** Buổi ca đang được xếp vào. null = chưa xếp buổi nào. */
  caSessionId: string | null;
  /** Buổi muốn dời sang — null nghĩa là không tìm thấy buổi đó. */
  buoiMoi: {
    id: string;
    trialClassId: string;
    status: TrialSessionStatusV2;
  } | null;
};

export type DoiLichKetQua = { ok: true } | { ok: false; error: string };

/**
 * Có được dời ca sang buổi này không.
 *
 * Thứ tự kiểm là có chủ đích: báo lỗi CỤ THỂ nhất trước. Người dùng bấm nhầm buổi của
 * lớp khác mà nhận thông báo "ca đã kết thúc" thì không sửa được gì.
 */
export function danhGiaDoiLich(input: DoiLichInput): DoiLichKetQua {
  if (input.caStatus !== "ACTIVE") {
    return { ok: false, error: "Ca này đã kết thúc hoặc đã gỡ — không dời lịch được" };
  }
  if (!input.buoiMoi || input.buoiMoi.trialClassId !== input.caTrialClassId) {
    // Gộp "không tồn tại" và "thuộc lớp khác" làm một thông điệp có chủ đích: hai ca
    // này chỉ khác nhau ở chỗ id có thật hay không, mà nói ra thì thành kênh dò id.
    return { ok: false, error: "Buổi học không thuộc lớp của ca này" };
  }
  if (input.buoiMoi.status !== "SCHEDULED") {
    return { ok: false, error: "Chỉ dời được sang buổi chưa diễn ra" };
  }
  if (input.caSessionId === input.buoiMoi.id) {
    return { ok: false, error: "Ca này đã ở đúng buổi đó rồi" };
  }
  return { ok: true };
}

/**
 * Sale có được sửa ĐỀ XUẤT giáo viên của ca không.
 *
 * Chốt của chủ dự án (câu 1): sau khi Đào tạo phân công thì Sale không sửa được nữa;
 * muốn đổi phải qua Đào tạo. Dời lịch sẽ xoá phân công, lúc đó Sale đề xuất lại được.
 */
export function saleDuocDeXuat(ca: {
  status: TrialEnrollmentStatusV2;
  gvPhanCongId: string | null;
}): DoiLichKetQua {
  if (ca.status !== "ACTIVE") return { ok: false, error: "Ca này đã kết thúc" };
  if (ca.gvPhanCongId) {
    return {
      ok: false,
      error: "Đào tạo đã phân công giáo viên cho ca này — muốn đổi phải qua Đào tạo",
    };
  }
  return { ok: true };
}
