/**
 * ẨN CÂU HƯỚNG DẪN THAO TÁC MÀ APP CHƯA LÀM ĐƯỢC (B4.5, chủ dự án chốt 17/11/2026): "Ẩn mọi câu hướng dẫn yêu cầu thao tác chưa thực hiện được, bao gồm «Ba mẹ gửi đơn học bù…» khi chưa có API gửi yêu cầu".
 *
 * Nguồn của web (`lib/portal/chuyen-can-thuan.ts` `ketLuan`, `chuyen-can.ts` ghi chú ô buổi, `nhan-xet.ts` `vangGhi`) ghép CẢ sự kiện ("còn 1 buổi vắng chưa có đơn bù") LẪN lời bảo làm gì ("Ba mẹ gửi đơn học bù…", "Chọn giờ học bù",
 * nút "Xin học bù"). Trên web có nút dẫn tới `/portal/yeu-cau`; app chưa có luồng gửi yêu cầu nên câu bảo làm là LỜI HỨA SUÔNG. Hàm ở đây tách phần sự kiện khỏi phần hướng dẫn, ở LỚP DTO của API di động —
 * KHÔNG sửa hàm của web (web vẫn nguyên văn). Khi app có luồng yêu cầu (đợt sau, sau khi chốt nghiệp vụ học bù) thì gỡ lớp này cho đúng chỗ đó, không phải dò chữ trong màn hình.
 *
 * Cách làm: (1) `viec` KHÔNG đi vào DTO; (2) câu có dấu hiệu bảo-làm-gì bị loại theo TỪNG CÂU; (3) vài cụm trạng thái có "chọn giờ" đổi thành cụm trung tính. Lưới `bo-huong-dan.test.ts` chạy hàm THẬT của web trên lưới
 * đầu vào và đỏ nếu một câu bảo-làm-gì lọt qua — kể cả khi web đổi chữ trong phạm vi các dấu hiệu dưới đây. Chữ mới ngoài dấu hiệu = phải thêm dấu hiệu (lưới liệt kê dấu hiệu tổng quát "gửi/chọn/xin/đăng ký/bấm").
 */
const DAU_HIEU_HUONG_DAN = /(gửi đơn|gửi yêu cầu|xin học bù|chọn giờ|chọn khung giờ|đặt lịch|đăng ký|bấm|nhấn|vào mục|liên hệ)/i;

/** Tách câu theo dấu chấm / hỏi / than cuối câu; giữ nguyên dấu để ghép lại. */
function tachCau(s: string): string[] {
  return s.split(/(?<=[.!?])\s+/).filter((c) => c.trim() !== "");
}

/** Bỏ các CÂU bảo làm gì; giữ nguyên câu sự kiện. Không còn câu nào ⇒ chuỗi rỗng. */
export function boCauHuongDan(giaiThich: string): string {
  return tachCau(giaiThich)
    .filter((c) => !DAU_HIEU_HUONG_DAN.test(c))
    .join(" ")
    .trim();
}

/**
 * Ghi chú trạng thái ngắn (ô buổi, buổi vắng): chỉ đổi cụm "đang chờ chọn giờ học bù" (đang ở bước chờ CHỌN GIỜ — một thao tác của phụ huynh trên web) thành "đang chờ học bù" (trạng thái). Không cắt cả câu vì
 * phần trước ("Vắng có phép — …") là sự kiện cần giữ.
 */
export function ghiTrangThaiKhongHuongDan(ghi: string): string {
  // "chờ chọn giờ học bù" / "chờ chọn giờ bù" (nhận xét, ô buổi, tóm tắt "Vắng N buổi — chờ chọn giờ bù") ⇒ "chờ học bù".
  return ghi.replace(/chờ chọn giờ (học )?bù/gi, "chờ học bù");
}

/**
 * Nội dung THÔNG BÁO học bù do hệ thống tạo: một câu ghép SỰ KIỆN + MỆNH ĐỀ bảo làm gì ("<bài> — vắng buổi này, phụ huynh đặt lịch học bù giúp con."). Bỏ MỆNH ĐỀ có dấu hiệu, giữ mệnh đề sự kiện; hết mệnh đề ⇒ rỗng.
 * Chỉ gọi cho danh mục `HOC_BU` (thông báo của trung tâm ở danh mục khác là chữ do người viết — không được cắt).
 */
export function boMenhDeHuongDan(noiDung: string): string {
  return tachCau(noiDung)
    .map((cau) => {
      if (!DAU_HIEU_HUONG_DAN.test(cau)) return cau;
      const dauCham = /[.!?]$/.test(cau) ? cau.slice(-1) : "";
      const giu = cau.replace(/[.!?]$/, "").split(/,\s+/).filter((m) => !DAU_HIEU_HUONG_DAN.test(m));
      return giu.length ? giu.join(", ") + (dauCham || ".") : "";
    })
    .filter((c) => c !== "")
    .join(" ")
    .trim();
}

export type KetLuanWeb = { tieuDe: string; giaiThich: string; viec: string; sac: "tot" | "canh-bao" };
export type KetLuanDiDong = { tieuDe: string; giaiThich: string; sac: "tot" | "canh-bao" };

/** Kết luận chuyên cần cho app: tiêu đề (sự kiện) + giải thích đã bỏ câu hướng dẫn; KHÔNG có `viec` và không có nút. */
export function ketLuanDiDong(k: KetLuanWeb): KetLuanDiDong {
  return { tieuDe: k.tieuDe, giaiThich: boCauHuongDan(k.giaiThich), sac: k.sac };
}
