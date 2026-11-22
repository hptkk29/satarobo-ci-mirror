/**
 * EL-06 — CÁC QUYẾT ĐỊNH THUẦN của cron đêm `elearning-dem`.
 *
 * Tách khỏi bộ chạy vì đây là chỗ dễ sai nhất và khó thấy nhất: cron chạy lúc
 * 00:47, không ai ngồi xem. Một luật sai ở đây đổi trạng thái hàng loạt bản ghi
 * mỗi đêm, và triệu chứng chỉ hiện ra ở báo cáo cuối tháng.
 */

export type DongQuaHan = {
  id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "COMPLETED_LATE" | "OVERDUE" | "REVOKED";
  dueAt: Date | null;
  /** `ON_LEAVE` ⇒ đồng hồ dừng (C4). Không sinh nhắc, không tính quá hạn. */
  pausedAt: Date | null;
};

/**
 * Việc (1) — ai chuyển sang `OVERDUE` đêm nay.
 *
 * ⚠️ Người đang TẠM DỪNG ĐỒNG HỒ không bao giờ quá hạn. Bỏ sót điều kiện này là
 * đánh quá hạn cho người đang nghỉ thai sản hoặc nghỉ ốm dài — họ vào báo cáo
 * tuân thủ như người trốn học, và không ai đối chiếu lại.
 *
 * ⚠️ `allowLate` KHÔNG xét ở đây. `OVERDUE` là NHÃN trạng thái, còn việc có khoá
 * đường ghi tiến độ hay không là chuyện của `due-lock.ts`. Trộn hai thứ làm nhãn
 * này nói dối: người được phép nộp trễ vẫn đang quá hạn thật.
 */
export function chonQuaHan(ds: DongQuaHan[], now: Date): string[] {
  return ds
    .filter((d) => d.status === "NOT_STARTED" || d.status === "IN_PROGRESS")
    .filter((d) => d.dueAt !== null && d.dueAt.getTime() < now.getTime())
    .filter((d) => d.pausedAt === null)
    .map((d) => d.id);
}

/**
 * Việc (5) — ai trong hàng đợi "chờ dữ liệu Nhân sự" nay đã đủ điều kiện.
 *
 * ⚠️ Điều kiện `existedAt <= assignmentCreatedAt` là một TÁI DỰNG có chủ đích,
 * không phải bộ lọc thừa. Lượt giao TĨNH đã chốt danh sách lúc tạo; chạy lại
 * luật thô mỗi đêm sẽ kéo cả người mới vào làm SAU đó vào một lượt giao đáng lẽ
 * đã đóng — tức biến TĨNH thành ĐỘNG mà không ai bấm nút.
 *
 * Người được thêm ĐÍCH DANH (`TrnAssignmentInclude`) thì không cần điều kiện
 * này: họ được chọn tay nên ý định đã rõ.
 */
export function chonThuLaiChoDuLieu<
  T extends { userId: string | null; centerId: string | null; existedAt: Date | null },
>(input: {
  ungVien: T[];
  daCoGhiDanh: Set<string>;
  themDichDanh: Set<string>;
  assignmentCreatedAt: Date;
  isStatic: boolean;
}): { taoMoi: T[]; vanKet: T[] } {
  const taoMoi: T[] = [];
  const vanKet: T[] = [];

  for (const u of input.ungVien) {
    if (u.userId && input.daCoGhiDanh.has(u.userId)) continue;

    const dichDanh = Boolean(u.userId && input.themDichDanh.has(u.userId));
    if (input.isStatic && !dichDanh) {
      const co = u.existedAt;
      if (!co || co.getTime() > input.assignmentCreatedAt.getTime()) continue;
    }

    // Vẫn thiếu dữ liệu ⇒ ĐẾM ĐƯỢC, không im lặng bỏ qua đêm này sang đêm khác.
    if (!u.userId || !u.centerId) {
      vanKet.push(u);
      continue;
    }
    taoMoi.push(u);
  }

  return { taoMoi, vanKet };
}

export type MocDon = {
  /** Xoá CỨNG dòng nhịp xem đã quá hạn lưu. */
  videoSessionTruoc: Date;
  /** Xoá bản đồ đoạn xem của bài đã DONE và im ắng quá 90 ngày. */
  bitmapLastActivityTruoc: Date;
};

/**
 * Việc (4) — mốc thời gian cho việc dọn dữ liệu tầng 2 (QĐ-CDA-14).
 *
 * Trả về MỐC chứ không trả về câu truy vấn: mốc thì test được bằng một phép so
 * sánh, còn câu truy vấn thì phải dựng cả cơ sở dữ liệu mới biết đúng sai.
 */
export function mocDonTang2(now: Date, soNgayGiuBitmap = 90): MocDon {
  return {
    videoSessionTruoc: now,
    bitmapLastActivityTruoc: new Date(
      now.getTime() - soNgayGiuBitmap * 24 * 60 * 60 * 1000,
    ),
  };
}


/**
 * EL-10 việc (6) — MỐC DỌN LƯỢT TẢI DỞ.
 *
 * Một lượt tải nhiều phần bị bỏ giữa chừng (đóng tab, mất mạng) để lại các phần
 * đã tải trên R2 VĨNH VIỄN. R2 tính tiền chúng, và chúng không hiện ra ở bất kỳ
 * danh sách đối tượng nào — `ListObjectsV2` không thấy phần dở, chỉ
 * `ListMultipartUploads` mới thấy. Nên đây là loại rác không ai phát hiện bằng
 * mắt, chỉ thấy trên hoá đơn.
 *
 * ⚠️ Ngưỡng 24 giờ, không ngắn hơn: người soạn tải tệp 200MB qua mạng chậm có
 * thể mất cả buổi, và huỷ một lượt đang chạy là bắt họ làm lại từ đầu.
 *
 * ⚠️ Việc này GỘP vào cron đêm `elearning-dem`, không xin khe cron thứ ba —
 * ngân sách của module là ĐÚNG HAI khe (QĐ-CDA-14 điểm 2).
 */
export function mocDonTaiDo(now: Date, soGioGiu = 24): Date {
  return new Date(now.getTime() - soGioGiu * 60 * 60 * 1000);
}

/** Lượt tải dở nào đã quá hạn giữ. */
export function chonTaiDoDeHuy<T extends { key: string; initiated: Date | null }>(
  ds: T[],
  moc: Date,
): { huy: T[]; giu: T[] } {
  const huy: T[] = [];
  const giu: T[] = [];
  for (const u of ds) {
    // Không rõ mốc bắt đầu ⇒ GIỮ. Huỷ một lượt có thể đang chạy là làm mất công
    // của người soạn; giữ thêm một hôm chỉ tốn vài xu lưu trữ.
    if (!u.initiated) {
      giu.push(u);
      continue;
    }
    // Chỉ đụng tệp trong phạm vi module — bucket có thể còn tiền tố khác.
    if (!u.key.startsWith("elearning/")) {
      giu.push(u);
      continue;
    }
    (u.initiated.getTime() < moc.getTime() ? huy : giu).push(u);
  }
  return { huy, giu };
}
