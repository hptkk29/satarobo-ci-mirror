import type { Moc } from "@/lib/elearning/reminder-schedule";

/**
 * EL-06 — CÂU CHỮ của từng mốc nhắc, thuần.
 *
 * ⚠️ Tệp này tồn tại vì một lỗi đã sống suốt từ EL-06: `ghiNhanDaGui` trong
 * `cron-reminders.ts` chỉ `update` dòng nhắc thành `status: "SENT"` với
 * `sentChannels: ["IN_APP","EMAIL"]` rồi return — **không gửi gì cả**. Chú thích
 * ngay trên chỗ gọi viết "Gửi thật đi qua hàng sự kiện", nhưng không có sự kiện nào
 * được phát và không handler nào lắng nghe.
 *
 * Cách hỏng của nó là im lặng và KHÔNG TỰ SỬA: sổ đã ghi `SENT` nên lần quét sau bỏ
 * qua dòng đó. Người học không nhận một lời nhắc nào cho cả bảy mốc, còn báo cáo
 * vận hành thì thấy "đã gửi" đủ. Đây là đúng loại lỗi mà một bộ nhắc sinh ra để
 * chống — nó chỉ hỏng khi có người thật sự cần được nhắc.
 */

export type NoiDungNhac = {
  title: string;
  body: string;
  /**
   * `true` = mốc NẶNG, kéo thông báo đã đọc về chưa-đọc.
   *
   * Chỉ hai mốc: sát giờ (còn 2 tiếng) và đã quá hạn. Bật cho cả bảy mốc là biến
   * chuông thành nguồn nhiễu — đúng thứ PRD dựng trần 30 mục/ngày để chặn.
   */
  keoVeChuaDoc: boolean;
};

/**
 * Câu chữ theo mốc.
 *
 * ⚠️ Mỗi mốc một câu KHÁC nhau. Dùng chung một câu "bạn có khoá cần hoàn thành" cho
 * cả bảy mốc thì người nhận không phân biệt được "còn 5 ngày" với "đã quá hạn", và
 * họ sẽ học cách bỏ qua tất cả.
 */
export function noiDungTheoMoc(input: {
  moc: Moc;
  tenKhoa: string;
  han: Date | null;
}): NoiDungNhac {
  const han = input.han
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(input.han)
    : null;
  const duoi = han ? ` Hạn: ${han}.` : "";

  switch (input.moc) {
    case "T0":
      return {
        title: `Bạn được giao khoá "${input.tenKhoa}"`,
        body: `Mở khu học tập nội bộ để bắt đầu.${duoi}`,
        keoVeChuaDoc: false,
      };
    case "T_MINUS_5D":
      return {
        title: `Còn 5 ngày: "${input.tenKhoa}"`,
        body: `Bạn còn 5 ngày để hoàn thành.${duoi}`,
        keoVeChuaDoc: false,
      };
    case "T_MINUS_2D":
      return {
        title: `Còn 2 ngày: "${input.tenKhoa}"`,
        body: `Bạn còn 2 ngày để hoàn thành.${duoi}`,
        keoVeChuaDoc: false,
      };
    case "T_MINUS_1D":
      return {
        title: `Còn 1 ngày: "${input.tenKhoa}"`,
        body: `Hạn chót là ngày mai.${duoi}`,
        keoVeChuaDoc: false,
      };
    case "T_MINUS_2H":
      return {
        title: `Còn 2 giờ: "${input.tenKhoa}"`,
        body: "Hạn chót còn 2 giờ. Vào học ngay hoặc liên hệ Đào tạo nếu cần gia hạn.",
        // Mốc sát giờ: kéo về chưa-đọc là đúng, vì hành động phải xảy ra HÔM NAY.
        keoVeChuaDoc: true,
      };
    case "T_PLUS_0":
      return {
        title: `Đã tới hạn: "${input.tenKhoa}"`,
        body: "Khoá đã tới hạn. Liên hệ phòng Đào tạo nếu cần gia hạn.",
        keoVeChuaDoc: true,
      };
    case "T_PLUS_3D":
      return {
        title: `Quá hạn 3 ngày: "${input.tenKhoa}"`,
        body: "Khoá đã quá hạn 3 ngày. Liên hệ phòng Đào tạo để được gia hạn.",
        keoVeChuaDoc: true,
      };
  }
}

/**
 * Khoá chống trùng cho một mốc.
 *
 * ⚠️ Mang CẢ `enrollmentId` lẫn tên mốc: dùng chung một khoá cho mọi mốc thì mốc
 * thứ hai bị coi là trùng và không ai nhận — đúng lỗi mà `notify.ts` đã phải tách
 * khoá theo nhóm người nhận để tránh.
 */
export function khoaChongTrung(enrollmentId: string, moc: Moc): string {
  return `el.nhac:${enrollmentId}:${moc}`;
}
