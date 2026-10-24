// lib/entitlements/hang-doi/loi.ts — LỖI CÓ MÃ của hàng đợi quyền học (đọc lẫn ghi). THUẦN.
export type MaLoiHangDoi = "KHONG_TIM_THAY" | "KHONG_QUYEN" | "KHONG_CHO_PHEP" | "DAU_VAO" | "LOI";

export class LoiHangDoi extends Error {
  constructor(
    public readonly ma: MaLoiHangDoi,
    message: string,
  ) {
    super(message);
    this.name = "LoiHangDoi";
  }
}
