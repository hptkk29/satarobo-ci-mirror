/**
 * MỘT ĐỢT — MỘT CÂU TRẢ LỜI, suy từ CẢ HAI SỔ.
 *
 * ── Con bug đóng ở đây (đo 15/09/2026, chạy tay đơn ORD-260915-000007) ──
 * Hai đường thu tiền cập nhật HAI SỔ KHÁC NHAU, và mỗi sổ mù về đường kia:
 *
 *                        OrderInstallment.status   PaymentRequest.status
 *   sale đánh dấu tay          PAID                     PENDING
 *   khách quét QR, tiền về     PENDING                  PAID
 *
 * Hệ quả nhìn thấy trên màn, cùng một đơn, cùng lúc:
 *   · bảng Phiếu thu in "Đợt 1 · Chờ thu · còn thiếu 2.000.000đ" cho đợt sale ĐÃ thu;
 *   · khối Kế hoạch vẫn bày nút "Đánh dấu đã đóng" cho đợt tiền ĐÃ về;
 *   · thẻ trên trang lead mời "Đóng đợt 1 · 1.500.000đ" trong khi đợt 1 thu xong từ lâu;
 *   · nút "Xuất QR" vẫn mở ở hàng đợt đã thu tiền mặt — mời khách trả lần hai.
 *
 * ── Vì sao KHÔNG đồng bộ hai cột ──
 * `PaymentRequest.status` là số TÍNH RA, không phải số ghi tay: `recomputeRequestStatuses`
 * suy nó từ `PaymentAllocation` + phần tha làm tròn, và chú thích ở đầu
 * `lib/payments/payment-request.ts` ghi rõ "KHÔNG set tay ở đâu khác".
 * Muốn tiền mặt vào được sổ đó thì phải có `PaymentAllocation`, mà cột
 * `bankTransactionId` của nó là BẮT BUỘC — tức phải bịa một `BankTransaction` với
 * `provider` là PAYOS/SEPAY và `providerTxnId` không tồn tại. Đó là làm hỏng chính sổ dùng
 * để đối soát với cổng, và là "sổ tiền thứ tư" mà chủ dự án đã cấm.
 *
 * Nên đồng bộ theo chiều ĐỌC: hai cột giữ nguyên nghĩa của chúng, còn mọi nơi HIỂN THỊ và
 * mọi nơi QUYẾT ĐỊNH "đợt nào sắp thu" đều hỏi đúng hàm này.
 */

export type NguonMotDot = {
  soDot: number;
  /** `PaymentRequest.amountDue` — số phải thu của đợt. */
  amountDue: number;
  /** Σ `PaymentAllocation.amount` — tiền THẬT về qua cổng. */
  daRot: number;
  /** `OrderInstallment.status === "PAID"` — sale đã thu (thường là tiền mặt tại quầy). */
  keHoachDaThu: boolean;
};

export type MaTrangThaiDot = "CHUA_THU" | "MOT_PHAN" | "DA_THU";

export type KetQuaTrangThaiDot = {
  soDot: number;
  ma: MaTrangThaiDot;
  conThieu: number;
  /** Nhãn hiển thị — MỘT chuỗi cho mọi màn, để không còn hai giọng cho một đợt. */
  nhan: string;
  /** Tiền đã vào bằng đường nào — kế toán cần biết để đối soát. */
  nguon: "CONG" | "SALE_THU_TAY" | "CA_HAI" | "CHUA_CO";
};

/**
 * Trạng thái THẬT của một đợt.
 *
 * Thứ tự luật:
 *  1. Tiền về đủ qua cổng ⇒ ĐÃ THU. Đây là bằng chứng mạnh nhất.
 *  2. Kế hoạch ghi PAID ⇒ ĐÃ THU, dù sổ cổng chưa thấy gì. Sale thu tiền mặt thì cổng
 *     không bao giờ thấy, và bắt đợt đó "chờ thu" mãi là mời khách trả lần hai.
 *  3. Có tiền nhưng chưa đủ ⇒ MỘT PHẦN.
 *  4. Còn lại ⇒ CHƯA THU.
 *
 * ⚠️ `conThieu` = 0 ngay khi ĐÃ THU, kể cả ca sale thu tay mà cổng chưa thấy đồng nào. Nếu
 * để `amountDue − daRot` thì màn vẫn in "còn thiếu 2.000.000đ" trên một đợt đã thu xong —
 * đúng con số đã làm chủ dự án nói "ghi nhận sai số tiền".
 */
export function trangThaiDot(n: NguonMotDot): KetQuaTrangThaiDot {
  const phai = Number.isFinite(n.amountDue) ? Math.max(0, Math.round(n.amountDue)) : 0;
  const roi = Number.isFinite(n.daRot) ? Math.max(0, Math.round(n.daRot)) : 0;
  const duCong = phai > 0 && roi >= phai;

  if (duCong || n.keHoachDaThu) {
    return {
      soDot: n.soDot,
      ma: "DA_THU",
      conThieu: 0,
      nhan:
        duCong && n.keHoachDaThu
          ? "Đã thu (tiền về qua cổng)"
          : duCong
            ? "Đã thu (tiền về qua cổng)"
            : "Đã thu (sale thu tay — cổng chưa thấy)",
      nguon: duCong && n.keHoachDaThu ? "CA_HAI" : duCong ? "CONG" : "SALE_THU_TAY",
    };
  }
  if (roi > 0) {
    return {
      soDot: n.soDot,
      ma: "MOT_PHAN",
      conThieu: phai - roi,
      nhan: "Thu một phần",
      nguon: "CONG",
    };
  }
  return { soDot: n.soDot, ma: "CHUA_THU", conThieu: phai, nhan: "Chờ thu", nguon: "CHUA_CO" };
}

/**
 * Đợt SẮP THU — đợt đầu tiên chưa thu xong, theo `soDot` tăng dần.
 *
 * ⚠️ Đây là hàm thay cho phép "lấy `PaymentRequest` PENDING đầu tiên" đang dùng ở thẻ
 * thanh toán trên trang lead. Phép đó mù với tiền mặt: sale thu đợt 1 xong, thẻ vẫn mời
 * "Đóng đợt 1" — đo được trên đơn ORD-260915-000006.
 */
export function dotSapThu(dots: readonly NguonMotDot[]): KetQuaTrangThaiDot | null {
  const xong = [...dots]
    .sort((a, b) => a.soDot - b.soDot)
    .map(trangThaiDot)
    .find((d) => d.ma !== "DA_THU");
  return xong ?? null;
}

/** Đợt này còn mời khách quét QR nữa không. */
export function conXuatQr(n: NguonMotDot): boolean {
  return trangThaiDot(n).ma !== "DA_THU";
}
