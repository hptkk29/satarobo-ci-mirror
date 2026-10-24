// lib/entitlements/dong-du-tien.ts — "DÒNG ĐƠN ĐÃ TRẢ ĐỦ CHƯA": vị từ THUẦN để cấp quyền học. Chỉ `cap-tu-don.ts` gọi (11/10/2026).
//
// Chỉ trả lời MỘT câu hỏi: với số tiền người gọi đưa vào, dòng này đủ tiền để cấp quyền học chưa. KHÔNG đọc DB,
// KHÔNG biết tiền đến từ đâu. Việc "số tiền nào được đưa vào" là của người gọi và là điểm chưa chốt:
//   · TIỀN MẶT / GHI TAY có tính "đã trả đủ" không (Q3) — mặc định đề xuất: không, chỉ tiền có phân bổ cho dòng.
//     Quyết định đó nằm ở chỗ ĐỌC (câu lệnh gom `daVe`/`daThu`), không ở đây. Đừng thêm cờ "cho tiền mặt" vào hàm này.
//   · Dòng đã DỪNG HỌC: người gọi truyền `phaiThu` là giá trị QUYẾT TOÁN (`OrderItem.usedValue`), không phải học phí gốc.
//
// BA điều chưa chốt là THAM SỐ BẮT BUỘC (luật 7 — không mặc định, để `tsc` liệt kê chỗ gọi):
//   · `truc`               — MM-07: cấp khi tiền VỀ đủ hay khi KẾ TOÁN XÁC NHẬN. Đọc từ `enrollment.entitlementTrigger`,
//                            KHÔNG viết cứng. Trục sai là cấp quyền học cho khoản tiền có thể bị từ chối sau đó.
//   · `dungSai`            — `payment.roundingToleranceVnd`: phiếu thu coi là PAID khi thiếu ≤ ngưỡng này. Dùng `≥` trần
//                            thì quyền học và phiếu thu bất đồng ở đúng ca thiếu vài nghìn. Chỉ tha khi ĐÃ CÓ tiền thật.
//   · `khiPhaiThuBangKhong` — dòng phải thu 0đ (học bổng 100%, hoặc dòng đã dừng học quyết toán 0đ) có coi là đủ không.
//
// Hai số đầu vào là HAI TẬP KHÁC NHAU, đừng nhầm (xem `lib/finance/no-theo-con.ts`):
//   · `daVe`  — đã về chấm hết, KỂ CẢ chưa xác nhận, TRỪ khoản bị từ chối   → trục `PAYMENT_PAID`;
//   · `daThu` — kế toán đã xác nhận (trục A)                                → trục `ACCOUNTANT_CONFIRMED`.
// Chúng lệch nhau đúng bằng "tiền đã về mà chưa đối soát" — một trạng thái có thật, không phải lỗi làm tròn.
import type { LoaiDongDon } from "@/lib/pricing/ke-hoach-dong-don";

/** Khớp các giá trị của khoá `enrollment.entitlementTrigger`. */
export type TrucDuTien = "PAYMENT_PAID" | "ACCOUNTANT_CONFIRMED";

export interface DongDuTienVao {
  readonly loai: LoaiDongDon;
  /** Học phí thực của dòng (đồng, nguyên); dòng đã dừng học thì giá trị quyết toán. */
  readonly phaiThu: number;
  /** Σ tiền đã về của riêng dòng, tập RỘNG (trừ khoản bị từ chối). */
  readonly daVe: number;
  /** Σ tiền kế toán đã xác nhận của riêng dòng (trục A). */
  readonly daThu: number;
}

export interface ThamSoDuTien {
  readonly truc: TrucDuTien;
  /** Số đồng thiếu được tha (≥ 0, nguyên). */
  readonly dungSai: number;
  readonly khiPhaiThuBangKhong: "DU" | "KHONG_DU";
}

export type LyDoDuTien =
  | "DU_TIEN"
  | "THIEU_TIEN"
  | "PHAI_THU_BANG_KHONG"
  | "DONG_KHONG_PHAI_KHOA_HOC"
  | "DU_LIEU_HONG"
  | "TRUC_LA";

export interface KetQuaDuTien {
  readonly du: boolean;
  readonly lyDo: LyDoDuTien;
  /** Số đã tính theo trục được chọn (để ghi audit). `0` khi chưa tính được. */
  readonly soDaTinh: number;
  /** `max(0, phaiThu − soDaTinh)`. */
  readonly conThieu: number;
}

const laTienNguyen = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

const KHONG_DU = (lyDo: LyDoDuTien, soDaTinh = 0, conThieu = 0): KetQuaDuTien => ({ du: false, lyDo, soDaTinh, conThieu });

export function dongDuTien(dong: DongDuTienVao, tham: ThamSoDuTien): KetQuaDuTien {
  if (dong.loai !== "COURSE_ENROLLMENT") return KHONG_DU("DONG_KHONG_PHAI_KHOA_HOC");

  if (!laTienNguyen(dong.phaiThu) || dong.phaiThu < 0 || !laTienNguyen(dong.daVe) || !laTienNguyen(dong.daThu)) {
    return KHONG_DU("DU_LIEU_HONG");
  }
  if (!laTienNguyen(tham.dungSai) || tham.dungSai < 0) return KHONG_DU("DU_LIEU_HONG");

  let soDaTinh: number;
  switch (tham.truc) {
    case "PAYMENT_PAID":
      soDaTinh = dong.daVe;
      break;
    case "ACCOUNTANT_CONFIRMED":
      soDaTinh = dong.daThu;
      break;
    default:
      return KHONG_DU("TRUC_LA");
  }

  const conThieu = Math.max(0, dong.phaiThu - soDaTinh);

  if (dong.phaiThu === 0) {
    return tham.khiPhaiThuBangKhong === "DU"
      ? { du: true, lyDo: "DU_TIEN", soDaTinh, conThieu }
      : KHONG_DU("PHAI_THU_BANG_KHONG", soDaTinh, conThieu);
  }

  // Dung sai chỉ tha phần THIẾU của một khoản đã có tiền thật; nó không được biến "chưa trả đồng nào" thành "đủ".
  if (soDaTinh > 0 && conThieu <= tham.dungSai) return { du: true, lyDo: "DU_TIEN", soDaTinh, conThieu };
  return KHONG_DU("THIEU_TIEN", soDaTinh, conThieu);
}
