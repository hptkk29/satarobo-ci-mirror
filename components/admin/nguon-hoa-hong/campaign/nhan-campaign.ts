// components/admin/nguon-hoa-hong/campaign/nhan-campaign.ts — CHỮ người đọc cho màn Campaign Affiliate. THUẦN (không DB, không đồng hồ — `now` truyền vào).
//
// Hiệu lực hiển thị ở MỘT hàm: danh sách và trang chi tiết nói cùng một câu. Ngày theo giờ VN (cùng phép với biểu mẫu sửa nguồn).
import { ngayVNTuISO } from "@/lib/nguon/form-nguon";

/** `2026-10-13` → `13/10/2026`. null / sai dạng ⇒ "". */
export function ngayHienThi(iso: string | null): string {
  const n = ngayVNTuISO(iso);
  if (!n) return "";
  const [y, m, d] = n.split("-");
  return `${d}/${m}/${y}`;
}

export type NhanHieuLuc = { chu: string; /** Điều đáng chú ý của khoảng hiệu lực so với `now`; null = bình thường. */ luuY: "HET_HAN" | "CHUA_BAT_DAU" | null };

/** Khoảng hiệu lực của campaign. Hết hạn dùng biên MỞ (đúng `nguonChonDuoc`): đến đúng mốc `effectiveTo` là đã hết. */
export function nhanHieuLuc(tu: string | null, den: string | null, now: Date): NhanHieuLuc {
  const chuTu = ngayHienThi(tu);
  const chuDen = ngayHienThi(den);
  const chu = tu && den ? `${chuTu} – ${chuDen}` : tu ? `Từ ${chuTu}` : den ? `Đến ${chuDen}` : "Không giới hạn";
  if (den && now.getTime() >= new Date(den).getTime()) return { chu, luuY: "HET_HAN" };
  if (tu && now.getTime() < new Date(tu).getTime()) return { chu, luuY: "CHUA_BAT_DAU" };
  return { chu, luuY: null };
}

export const NHAN_LUU_Y_HIEU_LUC = { HET_HAN: "Đã hết hạn", CHUA_BAT_DAU: "Chưa bắt đầu" } as const;

/** Số lượng có đơn vị: `soVN(1234)` → "1.234" — dùng chung của module (lưới `[NHH-DD-GOM-01]` cấm bộ định dạng số cục bộ). */
export { soVN } from "../nhan-nguon";

export const NHAN_LOAI_DOI_TAC = { PERSON: "Cá nhân", ORGANIZATION: "Tổ chức" } as const;
