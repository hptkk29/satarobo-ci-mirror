/**
 * AUTH-SĐT P6-D — dịch lỗi gửi OTP thành câu người dùng hiểu + ĐƯỜNG THOÁT.
 *
 * Tầng dưới trả chuỗi kỹ thuật dạng `ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:...` — hữu
 * ích cho `/admin/otp-logs` (giữ nguyên ở đó, người trực cần mã số) nhưng vô
 * nghĩa với phụ huynh, và với nhân viên thì "không gửi được" chung chung không
 * cho biết nên làm gì tiếp.
 *
 * Ba nhóm lỗi này KHÔNG tự hết theo thời gian nên "thử lại sau" là lời khuyên
 * sai — chúng cần hành động khác hẳn:
 *   · `-118` số chưa có Zalo        → dùng email, hoặc xin mã tại quầy;
 *   · `-139/-141` tắt nhận tin OA   → phụ huynh phải tự bật lại, CSKH không bật hộ được;
 *   · `-147` chạm giới hạn nhận tin → chờ, hoặc cấp mã tại quầy.
 */

export type OtpErrorAdvice = {
  /** Câu hiển thị cho người dùng cuối / nhân viên. */
  message: string;
  /** true = lỗi KHÔNG tự hết, bảo "thử lại sau" là sai. */
  permanent: boolean;
};

const ADVICE: Record<string, OtpErrorAdvice> = {
  ZNS_NO_ZALO_ACCOUNT: {
    message:
      "Số này chưa có tài khoản Zalo nên không nhận được mã. Dùng email (nếu có) hoặc liên hệ trung tâm để nhận mã trực tiếp.",
    permanent: true,
  },
  ZNS_USER_REFUSED: {
    message:
      "Số này đang tắt nhận tin từ Zalo OA Sata Robo. Quý phụ huynh cần tự bật lại trong Zalo (trung tâm không bật hộ được), hoặc liên hệ trung tâm để nhận mã trực tiếp.",
    permanent: true,
  },
  ZNS_USER_UNREACHABLE: {
    message:
      "Tài khoản Zalo của số này hiện không nhận được tin. Liên hệ trung tâm để nhận mã trực tiếp.",
    permanent: true,
  },
  ZNS_USER_LIMIT: {
    message:
      "Số này đã nhận quá nhiều tin trong ngày. Vui lòng thử lại vào ngày mai hoặc liên hệ trung tâm để nhận mã trực tiếp.",
    permanent: false,
  },
  ZNS_QUIET_HOURS: {
    message: "Zalo tạm không nhận gửi vào khung giờ này. Vui lòng thử lại sau.",
    permanent: false,
  },
  ZNS_NO_TEMPLATE: {
    message: "Kênh Zalo chưa được cấu hình mẫu tin. Vui lòng liên hệ trung tâm.",
    permanent: true,
  },
  ZALO_NOT_CONFIGURED: {
    message: "Kênh Zalo đang không khả dụng. Vui lòng liên hệ trung tâm.",
    permanent: true,
  },
};

/**
 * Nhận chuỗi lỗi thô của tầng gửi, trả câu tiếng Việt + có phải lỗi vĩnh viễn.
 * Không khớp khoá nào → câu chung, `permanent: false`.
 */
export function describeOtpSendError(raw: string | undefined | null): OtpErrorAdvice {
  const s = raw ?? "";
  for (const key of Object.keys(ADVICE)) {
    if (s.includes(key)) return ADVICE[key]!;
  }
  return { message: "Không gửi được mã. Vui lòng thử lại sau ít phút.", permanent: false };
}
