// components/admin/nguon-hoa-hong/nhan-danh-muc.ts — nhãn tiếng Việt của DANH MỤC NGUỒN cho bảng "Tất cả nguồn" và biểu mẫu Tạo / Sửa nguồn. THUẦN (test không cần DOM).
//
// Danh sách LỰA CHỌN không gõ tay ở đây: nó lấy từ các mảng của `danh-muc-ghi-dau-vao.ts` (cùng thứ schema cổng ghi dùng). Bảng nhãn là `Record<…, string>` theo kiểu của mảng đó nên thêm
// một giá trị enum mà quên nhãn là LỖI BIÊN DỊCH (luật 7), không phải một ô hiện mã thô.
import type { LeadSourceType } from "@prisma/client";
import { LOAI_NGUON_CHON, YEU_CAU_NGUOI, type YeuCauNguoi } from "@/lib/nguon/danh-muc-ghi-dau-vao";

/**
 * Nhóm nguồn (`sourceType`) — nhóm cấp cao để lọc / báo cáo. KHÔNG quyết hoa hồng. Nhãn NGẮN (bảng 7 cột chen trong ~976px); lời giải thích dài ở `MO_TA_LOAI_NGUON`.
 */
export const NHAN_LOAI_NGUON: Readonly<Record<LeadSourceType, string>> = {
  REFERRAL: "Giới thiệu",
  MARKETING: "Quảng cáo",
  ORGANIC: "Tự nhiên",
  OFFLINE: "Tại trung tâm",
  EVENT: "Sự kiện",
  PARTNER: "Đối tác",
  OTHER: "Khác",
  SYSTEM: "Hệ thống",
};

/** Một dòng nói mỗi nhóm gồm những nguồn nào — hiện dưới ô «Nhóm nguồn» của biểu mẫu. */
export const MO_TA_LOAI_NGUON: Readonly<Record<LeadSourceType, string>> = {
  REFERRAL: "Phụ huynh hoặc nhân sự giới thiệu.",
  MARKETING: "Quảng cáo trả tiền, chiến dịch marketing.",
  ORGANIC: "Review, chia sẻ, seeding, nội dung của trung tâm.",
  OFFLINE: "Khách tự đến trung tâm, không qua kênh nào.",
  EVENT: "Sự kiện, hội thảo, ngày hội.",
  PARTNER: "Đối tác, cộng tác viên, tổ chức.",
  OTHER: "Không thuộc nhóm nào ở trên (nên kèm giải trình).",
  SYSTEM: "Do hệ thống gán khi không xác định được nguồn.",
};

/** Mọi nhóm, theo thứ tự hiển thị của bộ lọc: các nhóm admin chọn được (từ schema) rồi SYSTEM. */
export const LOAI_NGUON_BO_LOC: readonly LeadSourceType[] = [...LOAI_NGUON_CHON, "SYSTEM"];

/** Nhóm admin chọn được ở biểu mẫu Tạo — `SYSTEM` chỉ dành cho nguồn hệ thống nên KHÔNG có trong danh sách này. */
export const LOAI_NGUON_O_CHON: readonly { gia: string; nhan: string }[] = LOAI_NGUON_CHON.map((gia) => ({ gia, nhan: NHAN_LOAI_NGUON[gia] }));

/**
 * «Người nhập phải chọn gì» (`referrerRequirement`) — BẢNG GỐC DUY NHẤT: `ngan` cho bảng danh mục / trang chi tiết / nhật ký (qua `NHAN_NGUOI_GIOI_THIEU` ở nhan-nguon.ts), `nhan` + `moTa` cho
 * biểu mẫu. (Trước W4 có ba bảng: «Nhân viên» ở bảng, «Nhân sự» ở chi tiết, «Nhân sự giới thiệu» ở biểu mẫu. Tên cũ `NHAN_CACH_XAC_DINH` trùng với bảng cùng tên của
 * `identificationMethod` ở lib/nguon/nhan-hien-thi.ts — hai khái niệm khác nhau nên đổi tên.)
 */
export const NHAN_YEU_CAU_NGUOI: Readonly<Record<YeuCauNguoi, { ngan: string; nhan: string; moTa: string }>> = {
  NONE: { ngan: "Không", nhan: "Không cần chọn người", moTa: "Khách tự đến, quảng cáo, review… — nguồn tự đủ, không có người giới thiệu." },
  PARENT: { ngan: "Phụ huynh", nhan: "Phụ huynh giới thiệu", moTa: "Người nhập phải chọn phụ huynh đã giới thiệu." },
  EMPLOYEE: { ngan: "Nhân sự", nhan: "Nhân sự giới thiệu", moTa: "Người nhập phải chọn nhân sự đã giới thiệu." },
  AFFILIATE_ORG: { ngan: "Đối tác", nhan: "Đối tác giới thiệu", moTa: "Người nhập phải chọn đối tác (cộng tác viên, tổ chức)." },
  // NÓI THẬT: ô nhập chưa có danh sách sự kiện để chọn (schema ghi «master sự kiện chưa có»; `loaiNguoiCuaNhom` trả null cho EVENT như NONE) nên lựa chọn này CHƯA đổi gì ở ô nhập.
  EVENT: {
    ngan: "Sự kiện",
    nhan: "Theo sự kiện",
    moTa: "Dùng cho nguồn gắn với một sự kiện. Hiện chưa có danh sách sự kiện, nên ô nhập chưa hỏi thêm gì với lựa chọn này — nó chỉ ghi nhận loại nguồn.",
  },
};

export const THU_TU_YEU_CAU_NGUOI: readonly YeuCauNguoi[] = YEU_CAU_NGUOI;

/**
 * Cửa sổ ghi công của một nguồn: số ngày + nó là RIÊNG hay MẶC ĐỊNH chung (nguồn không khai ⇒ theo `nguon.cuaSoGhiCongNgay`).
 * Hiển thị luôn nói cái nào, vì «90 ngày» trần không cho biết đổi cấu hình chung có kéo theo nguồn này hay không.
 */
export function nhanCuaSo(riengNgay: number | null, macDinhNgay: number): { so: number; chu: string; rieng: boolean } {
  return riengNgay === null
    ? { so: macDinhNgay, chu: `Mặc định ${macDinhNgay} ngày`, rieng: false }
    : { so: riengNgay, chu: `${riengNgay} ngày (riêng)`, rieng: true };
}

/** Hoa hồng THEO NGUỒN: nguồn có tham gia không. Chính sách chung (Sale, QLCS, GV Trial…) vẫn chạy dù «Không». */
export const nhanHoaHongNguon = (commissionEnabled: boolean): string => (commissionEnabled ? "Có" : "Không");
