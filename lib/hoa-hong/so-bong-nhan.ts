// lib/hoa-hong/so-bong-nhan.ts — NHÃN tiếng Việt cho mã của báo cáo so bóng (mã EXPECTED + mã chẩn đoán UNEXPECTED). THUẦN.
//
// `Record<MaExpected, string>`: thêm một mã vào tập đóng mà quên nhãn là LỖI BIÊN DỊCH (luật 7). Mã chẩn đoán UNEXPECTED không đóng (nó chỉ là gợi ý nơi tìm nguyên nhân) nên
// rơi về chính mã khi chưa có nhãn — người đọc vẫn thấy mã, không thấy chuỗi rỗng.
import type { MaExpected } from "./so-bong";

export const NHAN_MA_EXPECTED: Readonly<Record<MaExpected, string>> = {
  MARKETING_REMOVED_FOR_NON_AD_SOURCE: "Marketing không hưởng ở nguồn không quảng cáo",
  MARKETING_MOVED_TO_SOURCE_OWNER: "Đổi người nhận: từ Marketing sang chủ nguồn",
  MARKETING_REMOVED_UNKNOWN_SOURCE: "Nguồn không rõ: Marketing không hưởng",
  ACQUISITION_ADDED_BY_SOURCE_POLICY: "Vai thu hút nhận thêm theo chính sách nguồn",
  MATERIAL_OUT_OF_BASE: "Học cụ ra khỏi cơ sở tính hoa hồng",
  AFFILIATE_CAMPAIGN_POLICY: "Theo chính sách riêng của campaign Affiliate",
  EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE: "Hai engine gọi tên «học viên mới / tái tục» khác nhau (engine mới là chuẩn)",
};

const NHAN_CHAN_DOAN: Readonly<Record<string, string>> = {
  SO_TIEN_KHAC: "Cùng người, khác số tiền",
  SO_TIEN_KHAC_THEO_NGUON_KHONG_RO: "Khác số tiền (nguồn không rõ)",
  DONG_MOI_NGOAI_DANH_SACH: "Dòng mới ở engine mới, không có lý do thiết kế",
  PHAN_LOAI_TAI_TUC_KHAC: "Hai engine phân loại học viên mới / tái tục khác nhau",
  DOI_NGUOI_CUNG_VAI_KHI_PHAN_LOAI_KHAC: "Phân loại khác nhau và vai còn đổi người nhận",
  THANH_PHAN_KHAC_CHUA_CHOT: "Lệ phí thi / phí học bù ra khỏi cơ sở (chưa được xác nhận)",
  NGOAI_PHAM_VI_KHONG_RO: "Engine mới loại khoản ra ngoài, không rõ thành phần",
  LOAI_BO_THEO_LUAT_V2: "Bộ phân loại (luật v2) loại khoản ra ngoài trong khi engine cũ đã trả",
  CHU_NGUON_LECH_SO_TIEN_MARKETING_BI_LOAI: "Chủ nguồn nhận lệch so với Marketing bị loại",
  VUOT_TRAN: "Engine mới ghi 0 dòng: vượt trần tổng tỉ lệ",
  CHONG_LAN: "Engine mới ghi 0 dòng: hai quy tắc chồng lấn",
};

const TIEN_TO_MAT_DONG = "MAT_DONG_";

/** Nhãn của một mã bất kỳ trong báo cáo so bóng (EXPECTED hoặc chẩn đoán). */
export function nhanMaSoBong(ma: string): string {
  const e = (NHAN_MA_EXPECTED as Record<string, string>)[ma];
  if (e) return e;
  if (ma.startsWith(TIEN_TO_MAT_DONG)) return `Phía cũ trả, engine mới không trả (vai ở trạng thái ${ma.slice(TIEN_TO_MAT_DONG.length)})`;
  return NHAN_CHAN_DOAN[ma] ?? ma;
}
