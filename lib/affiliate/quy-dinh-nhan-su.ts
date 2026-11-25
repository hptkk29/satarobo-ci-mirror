/**
 * lib/affiliate/quy-dinh-nhan-su.ts — VĂN BẢN quy định + chính sách hoa hồng hiện cho nhân sự TRƯỚC khi bấm «Tôi đồng ý» ở màn «Link giới thiệu của tôi». THUẦN.
 *
 * ⚠️ BẢN NHÁP do phiên dựng 21/11/2026 — chủ dự án sửa chữ ở ĐÂY (một chỗ duy nhất). Cố ý KHÔNG gõ con số hoa hồng: số thật nằm ở chính sách hoa hồng đang hiệu lực (màn
 * «Chính sách» của Nguồn Lead & Hoa hồng), gõ lại ở đây là có ngày hai nơi nói hai số. Các con số của CHƯƠNG TRÌNH (cửa sổ nhớ khách, thời gian bảo vệ, tự giới thiệu) đọc
 * từ chính campaign (`QuyDinhChuongTrinh`), không gõ ở đây.
 *
 * Đổi nội dung có ý nghĩa ⇒ tăng `PHIEN_BAN_QUY_DINH_NHAN_SU` (phiên bản được chụp vào AuditLog lúc nhân sự đồng ý).
 */

export const PHIEN_BAN_QUY_DINH_NHAN_SU = "2026-11-21";

/** Thông số của chương trình (campaign nhân sự) — đọc từ dữ liệu. */
export type QuyDinhChuongTrinh = { campaignTen: string; nhoKhachNgay: number; baoVeNgay: number; choTuGioiThieu: boolean };

export type MucQuyDinh = { tieuDe: string; dong: string[] };

export function vanBanQuyDinhNhanSu(c: QuyDinhChuongTrinh): MucQuyDinh[] {
  return [
    {
      tieuDe: "Quy định chương trình giới thiệu của Sata Robo",
      dong: [
        "Link và mã QR giới thiệu là của riêng bạn. Khách bấm link rồi để lại thông tin trên trang của Sata Robo thì lead được ghi nhận người giới thiệu là bạn.",
        `Khách đã bấm link được hệ thống nhớ trong ${c.nhoKhachNgay} ngày; lead bạn mang về được bảo vệ ${c.baoVeNgay} ngày.`,
        "Ghi nhận cho người giới thiệu hợp lệ ĐẦU TIÊN. Khách đã có trong hệ thống (trùng số điện thoại) không tính là khách mới.",
        ...(c.choTuGioiThieu ? [] : ["Không dùng link của mình để tự đăng ký cho chính mình."]),
        "Không spam, không quảng cáo sai sự thật, không hứa ưu đãi ngoài chính sách của công ty.",
        "Vi phạm quy định: công ty có quyền tạm ngừng link và không ghi nhận hoa hồng cho lead liên quan.",
      ],
    },
    {
      tieuDe: "Chính sách hoa hồng",
      dong: [
        "Nhân sự giới thiệu: hưởng hoa hồng theo chính sách hoa hồng của nguồn «Nhân sự giới thiệu» đang áp dụng, tính trên học phí khách đóng.",
        "Phụ huynh giới thiệu: hưởng theo chính sách hoa hồng của nguồn «Phụ huynh giới thiệu» đang áp dụng.",
        "Mức cụ thể và kỳ chi trả theo chính sách công ty công bố tại từng thời điểm.",
      ],
    },
  ];
}

// ── Phụ huynh (cổng phụ huynh «Giới thiệu bạn bè») ─────────────────────────────────────────────────────────────────────────────
// Chủ dự án chốt 25/11/2026: phụ huynh cũng phải đọc + đồng ý quy định trước khi tự lấy link. Cùng phần quy định chương trình với nhân sự; phần hoa hồng chỉ nói về phụ huynh.
// Đổi nội dung có ý nghĩa ⇒ tăng phiên bản (được chụp vào AuditLog `AFFILIATE_PHU_HUYNH_DONG_Y_QUY_DINH`).

export const PHIEN_BAN_QUY_DINH_PHU_HUYNH = "2026-11-25";

export function vanBanQuyDinhPhuHuynh(c: QuyDinhChuongTrinh): MucQuyDinh[] {
  const [chuongTrinh] = vanBanQuyDinhNhanSu(c);
  return [
    chuongTrinh!,
    {
      tieuDe: "Chính sách hoa hồng",
      dong: [
        "Phụ huynh giới thiệu: hưởng hoa hồng theo chính sách hoa hồng của nguồn «Phụ huynh giới thiệu» đang áp dụng, tính trên học phí khách đóng.",
        "Mức cụ thể và kỳ chi trả theo chính sách công ty công bố tại từng thời điểm.",
      ],
    },
  ];
}
