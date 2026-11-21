import type { NguoiTrongTap } from "@/lib/elearning/audience";

/**
 * EL-05 — DỰNG HÀNG `TrnEnrollment` từ tập người học.
 *
 * Hàm thuần: nhận người + cấu hình lượt giao, trả ra đúng các hàng sẽ ghi. Tách
 * khỏi action vì đây là chỗ quyết định HẠN CHÓT và ẢNH CHỤP TỔ CHỨC — hai thứ
 * sai thì sai vĩnh viễn, không sửa lại được bằng một lần chạy sau.
 *
 * ⚠️ `dueAtOriginal` BẤT BIẾN. Mọi chỉ số đúng-hạn đo trên cột này, còn `dueAt`
 * là hạn hiện hành và gia hạn được. Ghi đè `dueAtOriginal` lúc gia hạn nghĩa là
 * mọi người gia hạn xong đều "đúng hạn" — và tỉ lệ đúng hạn thành vô nghĩa.
 *
 * ⚠️ ẢNH CHỤP ghi MỘT LẦN, không bao giờ cập nhật. Join sống sang `Employee` thì
 * một lần chuyển cơ sở làm ĐỔI HỒI TỐ mọi báo cáo cũ.
 */

export type CauHinhHan = {
  /** Hạn tuyệt đối, nếu người giao chọn kiểu này. */
  dueAt: Date | null;
  /** Hạn tương đối: N ngày kể từ mốc. */
  dueRelativeDays: number | null;
  dueAnchor: "ASSIGNED_AT" | "JOINED_AT";
};

export type HangGhiDanh = {
  userId: string;
  courseId: string;
  assignmentId: string;
  cycle: number;
  source: "ASSIGNMENT";
  status: "NOT_STARTED";
  dueAt: Date | null;
  dueAtOriginal: Date | null;
  snapOrgUnitId: string | null;
  snapDepartmentId: string | null;
  snapPositionId: string | null;
  snapManagerUserId: string | null;
  snapJobTitle: string;
  snappedAt: Date;
  centerId: string;
};

export type KetQuaDungHang = {
  rows: HangGhiDanh[];
  /**
   * Người không tính được hạn: chọn mốc "từ ngày vào làm" mà `joinedAt` trống.
   * Cùng nguyên tắc với luật 6 — nêu tên, không im lặng bỏ qua.
   */
  khongTinhDuocHan: NguoiTrongTap[];
};

export function dungHangGhiDanh(input: {
  nguoi: NguoiTrongTap[];
  courseIds: string[];
  assignmentId: string;
  han: CauHinhHan;
  now: Date;
  /** `Employee.managerId` → `userId` của quản lý. Thiếu ⇒ ảnh chụp để `null`. */
  managerUserIdTheoEmployeeId?: Record<string, string>;
  /** `courseId` → chu kỳ kế tiếp, cho khoá tái chứng nhận. Mặc định 1. */
  cycleTheoCourseId?: Record<string, number>;
}): KetQuaDungHang {
  const rows: HangGhiDanh[] = [];
  const khongTinhDuocHan: NguoiTrongTap[] = [];

  for (const n of input.nguoi) {
    // Bất biến của tầng trên: `audience.ts` đã loại người thiếu `centerId`/`userId`.
    // Kiểm lại ở đây vì hàm này cũng chạy từ đường ĐỘNG mỗi đêm — nơi không ai
    // bấm nút và không ai đọc màn xem trước.
    if (!n.userId || !n.centerId) continue;

    const han = tinhHan(input.han, { assignedAt: input.now, joinedAt: n.joinedAt });
    if (han === "THIEU_NGAY_VAO_LAM") {
      khongTinhDuocHan.push(n);
      continue;
    }

    for (const courseId of input.courseIds) {
      rows.push({
        userId: n.userId,
        courseId,
        assignmentId: input.assignmentId,
        cycle: input.cycleTheoCourseId?.[courseId] ?? 1,
        source: "ASSIGNMENT",
        status: "NOT_STARTED",
        // Hai cột hạn ghi CÙNG giá trị lúc tạo; từ đây chúng rẽ đôi.
        dueAt: han,
        dueAtOriginal: han,
        snapOrgUnitId: n.orgUnitId,
        snapDepartmentId: n.departmentId,
        // Ảnh chụp 3/5 — `Position` rỗng trên prod nên cột này chưa có gì để
        // chụp. Vẫn khai để ngày Nhân sự điền vị trí thì không phải đổi hình.
        snapPositionId: null,
        snapManagerUserId: n.managerId
          ? (input.managerUserIdTheoEmployeeId?.[n.managerId] ?? null)
          : null,
        snapJobTitle: n.jobTitle,
        snappedAt: input.now,
        centerId: n.centerId,
      });
    }
  }

  return { rows, khongTinhDuocHan };
}

function tinhHan(
  cau: CauHinhHan,
  moc: { assignedAt: Date; joinedAt: Date | null },
): Date | null | "THIEU_NGAY_VAO_LAM" {
  // Hạn tuyệt đối thắng: người giao gõ thẳng ngày thì không suy diễn gì thêm.
  if (cau.dueAt) return cau.dueAt;
  if (cau.dueRelativeDays === null) return null;

  if (cau.dueAnchor === "JOINED_AT") {
    // Không có ngày vào làm thì hạn KHÔNG TÍNH ĐƯỢC. Lấy đại ngày giao thay thế
    // là âm thầm cho người này một hạn khác hẳn ý người giao — và không ai biết.
    if (!moc.joinedAt) return "THIEU_NGAY_VAO_LAM";
    return themNgay(moc.joinedAt, cau.dueRelativeDays);
  }
  return themNgay(moc.assignedAt, cau.dueRelativeDays);
}

const themNgay = (d: Date, songay: number) =>
  new Date(d.getTime() + songay * 24 * 60 * 60 * 1000);
