/**
 * EL-06 — LỊCH NHẮC 7 MỐC (§12.2).
 *
 * Hàm thuần: từ một lượt ghi danh ra đúng các mốc phải nhắc.
 *
 * ⚠️ Bài toán thật ở đây KHÔNG phải "cộng trừ ngày" mà là **mốc đã trôi qua**.
 * Giao một khoá hạn 1 ngày thì T-5 ngày, T-2 ngày và T-1 ngày đều đã nằm trong
 * quá khứ ngay lúc lập lịch. Lưu chúng ở trạng thái `PENDING` nghĩa là ngay nhịp
 * cron kế tiếp người học nhận BA email cùng lúc, cho ba mốc chẳng còn ý nghĩa.
 * Nên chúng phải sinh ra đã ở trạng thái `SKIPPED`.
 */

export type Moc =
  | "T0"
  | "T_MINUS_5D"
  | "T_MINUS_2D"
  | "T_MINUS_1D"
  | "T_MINUS_2H"
  | "T_PLUS_0"
  | "T_PLUS_3D";

export type DongLich = {
  milestone: Moc;
  scheduledAt: Date;
  /** `SKIPPED` ngay từ lúc lập lịch = mốc đã trôi qua, không nhắc bù. */
  status: "PENDING" | "SKIPPED";
  reason?: string;
};

const GIO = 60 * 60 * 1000;
const NGAY = 24 * GIO;

/** Độ lệch so với HẠN. Dương = sau hạn. */
const LECH_SO_VOI_HAN: Record<Exclude<Moc, "T0">, number> = {
  T_MINUS_5D: -5 * NGAY,
  T_MINUS_2D: -2 * NGAY,
  T_MINUS_1D: -1 * NGAY,
  T_MINUS_2H: -2 * GIO,
  // T+0 nhắc NGAY SAU hạn, không đúng lúc hạn: đúng lúc hạn thì người đang nộp
  // ở phút chót nhận email "đã quá hạn" trong khi họ vẫn còn hạn.
  T_PLUS_0: 1 * 60 * 1000,
  T_PLUS_3D: 3 * NGAY,
};

export function lapLichNhac(input: {
  /** Mốc được giao — dùng cho T0. */
  assignedAt: Date;
  /** Hạn hiện hành. `null` = bài không hạn. */
  dueAt: Date | null;
  /** Thời điểm lập lịch, để biết mốc nào đã trôi qua. */
  now: Date;
}): DongLich[] {
  const ds: DongLich[] = [
    {
      milestone: "T0",
      scheduledAt: input.assignedAt,
      // T0 luôn PENDING kể cả khi `assignedAt` đã qua: đây là thông báo "bạn vừa
      // được giao", và nó vẫn đúng dù gửi muộn vài phút.
      status: "PENDING",
    },
  ];

  // ⚠️ Bài KHÔNG hạn thì CHỈ có T0. Sinh sáu mốc kia dựa trên một cái hạn không
  // tồn tại là bịa ra sáu ngày giờ, rồi nhắc theo chúng.
  if (!input.dueAt) return ds;

  for (const [m, lech] of Object.entries(LECH_SO_VOI_HAN) as [
    Exclude<Moc, "T0">,
    number,
  ][]) {
    const at = new Date(input.dueAt.getTime() + lech);
    const daTroiQua = at.getTime() < input.now.getTime();
    ds.push({
      milestone: m,
      scheduledAt: at,
      status: daTroiQua ? "SKIPPED" : "PENDING",
      reason: daTroiQua ? "mốc đã trôi qua khi lập lịch" : undefined,
    });
  }

  return ds;
}

/**
 * Mốc nào cần HUỶ khi lượt ghi danh đổi trạng thái.
 *
 * Thu hồi · hoàn thành · tạm dừng đồng hồ ⇒ huỷ MỌI mốc còn `PENDING`. Không huỷ
 * thì người vừa học xong vẫn nhận "còn 2 giờ để hoàn thành", và người vừa bị thu
 * hồi vẫn nhận "đã quá hạn" — hai tin sai theo hai kiểu, cùng một nguyên nhân.
 *
 * ⚠️ KHÔNG huỷ mốc đã `SENT`: nó là bản ghi việc đã xảy ra, không phải kế hoạch.
 */
export function lyDoHuy(
  trangThai: "COMPLETED" | "COMPLETED_LATE" | "REVOKED" | "PAUSED",
): string {
  switch (trangThai) {
    case "COMPLETED":
    case "COMPLETED_LATE":
      return "đã hoàn thành";
    case "REVOKED":
      return "đã thu hồi";
    case "PAUSED":
      return "tạm dừng đồng hồ";
  }
}

/**
 * Khi HẠN ĐỔI (gia hạn), các mốc `PENDING` phải tính lại theo hạn mới.
 *
 * Trả về danh sách mốc mới; người gọi huỷ mốc `PENDING` cũ rồi ghi mốc mới.
 * ⚠️ Mốc đã `SENT` giữ nguyên — không dựng lại quá khứ.
 */
export function lapLaiSauGiaHan(input: {
  assignedAt: Date;
  dueAtMoi: Date | null;
  now: Date;
  daGui: Set<Moc>;
}): DongLich[] {
  return lapLichNhac({
    assignedAt: input.assignedAt,
    dueAt: input.dueAtMoi,
    now: input.now,
  }).filter((d) => !input.daGui.has(d.milestone));
}
