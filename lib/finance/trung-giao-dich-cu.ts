// lib/finance/trung-giao-dich-cu.ts — chống NHẬP TRÙNG khi em đã có tiền trong hệ thống.
//
// ─────────────────────────────────────────────────────────────────────────────
// "ĐÃ CÓ ĐƠN HÀNG" KHÔNG PHẢI THƯỚC ĐO ĐÚNG
//
// Nhóm học viên cần chữa NHẤT lại chính là nhóm ĐÃ CÓ ĐƠN mà CHƯA CÓ TIỀN: các em chốt
// hàng loạt qua nhánh `allowNoPayment` của `lib/crm/bulk-convert.ts` — có `Order`, có
// `Enrollment`, nhưng không `Payment` nào, nên cổng phụ huynh hiện nợ nguyên. Bỏ qua
// theo "có đơn" là bỏ sót đúng nhóm đang đi cứu.
//
// Thước đo đúng là TIỀN ĐÃ GHI NHẬN của em. Nó còn bắt được cả ca có khoản thu mà không
// đi qua đơn nào — thứ mà đếm đơn không thấy.
//
// ⚠️ KHÔNG TỰ NHẬP PHẦN CHÊNH khi hệ thống đã có một phần. Cám dỗ là "cứ nhập thêm cho
// đủ", nhưng chênh có thể do một đợt đã được ghi bằng đường khác với số khác — nhập bù
// là tạo ra khoản thu không có thật. Đưa số cho người, để họ quyết.
// ─────────────────────────────────────────────────────────────────────────────

export const MUC_TRUNG = {
  /** Chưa có đồng nào trong hệ thống — nhập được. */
  CHUA_CO: "CHUA_CO",
  /** Đã có ≥ số tiền trong file — chắc chắn trùng. */
  TRUNG_DU: "TRUNG_DU",
  /** Đã có một phần — người quyết. */
  TRUNG_MOT_PHAN: "TRUNG_MOT_PHAN",
} as const;

export type MucTrung = (typeof MUC_TRUNG)[keyof typeof MUC_TRUNG];

export type KetQuaTrung = {
  muc: MucTrung;
  /** Chỉ `true` ở mức CHUA_CO — ba mức còn lại đều phải có người bấm. */
  nenNhap: boolean;
  /** Phần file nhiều hơn hệ thống (chỉ có nghĩa ở TRUNG_MOT_PHAN). */
  chenh: number;
  daCoTien: number;
};

function tien(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function phanLoaiTrung(input: {
  /** Σ `Payment` đã ghi nhận của em trong hệ thống (trục B). */
  daCoTien: number;
  tienTrongFile: number;
  /** Số đơn hiện có — CHỈ để hiển thị, KHÔNG tham gia quyết định. Xem đầu file. */
  soDon: number;
}): KetQuaTrung {
  const daCo = tien(input.daCoTien);
  const file = tien(input.tienTrongFile);

  if (daCo === 0) {
    // File không có tiền thì cũng không có gì để nhập.
    return { muc: MUC_TRUNG.CHUA_CO, nenNhap: file > 0, chenh: file, daCoTien: 0 };
  }
  if (daCo >= file) {
    return { muc: MUC_TRUNG.TRUNG_DU, nenNhap: false, chenh: 0, daCoTien: daCo };
  }
  return {
    muc: MUC_TRUNG.TRUNG_MOT_PHAN,
    nenNhap: false,
    chenh: file - daCo,
    daCoTien: daCo,
  };
}

/** Nhãn tiếng Việt cho màn hình — một chỗ, để màn và báo cáo nói cùng một câu. */
export const NHAN_MUC_TRUNG: Record<MucTrung, string> = {
  CHUA_CO: "Chưa có khoản nào",
  TRUNG_DU: "Đã có đủ tiền — bỏ qua",
  TRUNG_MOT_PHAN: "Đã có một phần — cần xem",
};
