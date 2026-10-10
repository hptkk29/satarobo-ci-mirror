// components/admin/nguon-hoa-hong/nhan-nguon.ts — nhãn tiếng Việt của danh mục nguồn. THUẦN (test không cần DOM).
//
// Một chỗ cho bảng "Tất cả nguồn" và trang chi tiết nguồn cùng nói MỘT câu về một nguồn.
import type { SourceReferrerRequirement } from "@prisma/client";
import type { LoaiNguoi } from "@/lib/nguon/chon-nguon";
import { dinhDangSo } from "@/lib/hoa-hong/vi-sao";
import { NHAN_YEU_CAU_NGUOI } from "./nhan-danh-muc";

/** Nhóm này bắt người nhập chọn thêm GÌ ở ô nhập (D5, 06 §5.1). Chữ ngắn lấy từ BẢNG GỐC của biểu mẫu (`NHAN_YEU_CAU_NGUOI`) — không bảng thứ hai. */
export const NHAN_NGUOI_GIOI_THIEU: Record<SourceReferrerRequirement, string> = {
  NONE: NHAN_YEU_CAU_NGUOI.NONE.ngan,
  PARENT: NHAN_YEU_CAU_NGUOI.PARENT.ngan,
  EMPLOYEE: NHAN_YEU_CAU_NGUOI.EMPLOYEE.ngan,
  AFFILIATE_ORG: NHAN_YEU_CAU_NGUOI.AFFILIATE_ORG.ngan,
  EVENT: NHAN_YEU_CAU_NGUOI.EVENT.ngan,
};

/** Loại người giới thiệu → chữ ngắn cạnh tên (khối "Nguồn" trên lead, Sheet). */
export const NHAN_NGUOI_LOAI_HIEN_THI: Record<LoaiNguoi, string> = {
  NHAN_SU: "Nhân sự",
  PHU_HUYNH: "Phụ huynh",
  DOI_TAC: "Đối tác",
};

export type YeuCauNhapTho = {
  referrerRequirement: SourceReferrerRequirement;
  requiresNote: boolean;
  selectable: boolean;
};

/** Một cụm chữ cho ô "Ô nhập yêu cầu": "Chọn nhân sự", "Chọn phụ huynh · Giải trình bắt buộc", "Hệ thống gán"… ; không yêu cầu ⇒ "Không". */
export function yeuCauNhap(g: YeuCauNhapTho): string {
  if (!g.selectable) return "Hệ thống gán";
  const phan: string[] = [];
  if (g.referrerRequirement !== "NONE") phan.push(`Chọn ${NHAN_NGUOI_GIOI_THIEU[g.referrerRequirement].toLowerCase()}`);
  if (g.requiresNote) phan.push("Giải trình bắt buộc");
  return phan.length > 0 ? phan.join(" · ") : "Không";
}

/** "Hôm nay" / "N ngày" — tuổi lead trong hàng chờ. */
export function nhanTuoi(ngay: number): string {
  return ngay <= 0 ? "Hôm nay" : `${ngay} ngày`;
}

/** Số nguyên kiểu Việt (dấu chấm ngăn nghìn): 12345 → "12.345". */
export function soVN(n: number): string {
  return dinhDangSo(Math.trunc(n));
}
