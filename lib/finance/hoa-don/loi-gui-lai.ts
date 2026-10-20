// lib/finance/hoa-don/loi-gui-lai.ts — lỗi của lõi "Gửi lại email" (`taoLuotGuiLai`, gui-email.ts) +
// câu dịch cho người dùng. THUẦN, tách riêng để action dịch lỗi mà không phải nạp cả module gửi email.

export type MaLoiGuiLai = "DA_DOI" | "DANG_GUI" | "EMAIL_DA_DOI" | "DA_CO_NGUOI_GUI";

export class LoiGuiLai extends Error {
  constructor(public readonly ma: MaLoiGuiLai) {
    super(ma);
    this.name = "LoiGuiLai";
  }
}

/** Câu cho người dùng — action dịch lỗi ở đây, lỗi lạ thì ném tiếp. */
export function thongDiepLoiGuiLai(e: unknown): string | null {
  if (!(e instanceof LoiGuiLai)) return null;
  switch (e.ma) {
    case "DA_DOI":
      return "Hoá đơn vừa được huỷ hoặc email nhận vừa đổi — tải lại màn";
    case "DANG_GUI":
      return "Lượt gửi trước còn đang chạy — đợi kết quả rồi hãy gửi lại";
    case "EMAIL_DA_DOI":
      return "Email trên đơn vừa đổi — tải lại màn rồi chọn lại địa chỉ";
    case "DA_CO_NGUOI_GUI":
      return "Vừa có người khác bấm gửi hoá đơn này — tải lại màn";
  }
}
