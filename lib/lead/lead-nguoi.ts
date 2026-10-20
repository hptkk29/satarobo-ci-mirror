/**
 * LEAD NGUỘI — khách chưa chốt mà lâu rồi không ai đụng tới. Hàm THUẦN, không chạm DB.
 *
 * ── YÊU CẦU 15/09/2026 ───────────────────────────────────────────────────────────────────
 * Chủ dự án: "thêm cơ chế lọc các KH (chưa đăng ký, ghi danh) mà sale không tương tác trong
 * vòng 90 ngày không tiếp cận lại để khai thác và chăm sóc thì quản lý có thể lọc và phân bổ
 * cho các sale khác".
 *
 * ── ⚠️ ĐO "KHÔNG TƯƠNG TÁC" LÀ CHỖ DỄ NÓI DỐI NHẤT ──────────────────────────────────────
 * Một bộ lọc nói "lead này 120 ngày không ai đụng" mà sai thì hậu quả không phải là một con
 * số lệch: nó GIẬT lead khỏi tay một Sale đang chăm tốt, và Sale đó mất luôn hoa hồng. Nên
 * mốc phải lấy từ những cột chỉ đổi khi CON NGƯỜI làm gì đó.
 *
 * Cột được tính, và vì sao:
 *   · `lastActivityAt`   — đo 15/09: chỉ được ghi từ ĐÚNG 4 thao tác trong màn lead (đổi
 *                          trạng thái · thêm hoạt động · tạo việc · đóng việc). Đây là tín
 *                          hiệu sạch nhất.
 *   · `firstContactAt`   — lần Sale gọi đầu tiên.
 *   · `assignedAt`       — chưa làm gì thì đếm từ lúc lead về tay người đó.
 *   · `createdAt`        — lead chưa từng được chia thì đếm từ lúc sinh ra.
 *
 * Cột CỐ Ý BỊ LOẠI, và vì sao — quan trọng hơn danh sách trên:
 *   · `updatedAt`      — mọi lượt ghi của HỆ THỐNG đều chạm vào nó (cron, đồng bộ, ghi kép
 *                        `orgUnitId`…). Dùng nó là mọi lead đều "vừa được chăm hôm qua".
 *                        `lib/crm/sla.ts` đã vấp đúng lỗi này một lần và ghi lại trong chú
 *                        thích của chính nó — đừng vấp lần hai.
 *   · `lastInboundAt`  — đó là KHÁCH chủ động liên hệ, không phải Sale chăm. Tính nó vào là
 *                        đảo ngược ý nghĩa: khách nhắn tin mà Sale im 3 tháng thì lead ấy
 *                        CÀNG cần chuyển đi, chứ không phải càng an toàn.
 *   · `statusChangedAt` — nghe rất hợp lý (đẩy lead qua một bậc phễu đúng là một lần chăm),
 *                        và bản đầu của tệp này ĐÃ tính nó. Phép đo bác bỏ, 15/09/2026:
 *
 *                            lead cũ hơn 90 ngày, chưa chốt                     35
 *                            trong đó `statusChangedAt` cũng cũ hơn 90 ngày      0
 *                            số ngày KHÁC NHAU của cột đó trên cả bảng           2
 *
 *                        Hai giá trị ngày cho cả sổ lead nghĩa là cột này được ghi HÀNG LOẠT
 *                        chứ không theo từng lead — khớp với đợt rút phễu 13→10 bậc hồi
 *                        08/2026. Tính nó vào thì bộ lọc trả về ĐÚNG 0 dòng, mãi mãi, và
 *                        không ai biết vì sao. Đây chính là lỗi mà đoạn trên đã cảnh báo cho
 *                        `updatedAt`, chỉ ở dạng nhẹ hơn nên khó thấy hơn nhiều.
 *
 * ── ⚠️ GIỚI HẠN PHẢI NÓI RA, KHÔNG ĐƯỢC GIẤU ────────────────────────────────────────────
 * Sale nói chuyện với khách trên Messenger/Zalo mà KHÔNG ghi gì vào lead thì không cột nào ở
 * trên đổi, và lead đang chăm tốt vẫn bị chấm là nguội. Đây là giới hạn THẬT của dữ liệu
 * đang có, không phải lỗi của phép đếm — nên màn hình phải nói ra, và người bấm nút phân bổ
 * phải là QUẢN LÝ chứ không phải một cron tự động.
 */

/** Ảnh chụp những cột cần để tính. Khai hẹp để `tsc` bắt được nơi quên `select`. */
export interface LeadDeDoNguoi {
  lastActivityAt: Date | null;
  firstContactAt: Date | null;
  assignedAt: Date | null;
  createdAt: Date;
}

/** Ngưỡng mặc định — chủ dự án chốt 90 ngày; màn hình vẫn cho sửa. */
export const NGUONG_NGUOI_MAC_DINH = 90;

/** Chặn trên để một ô nhập hỏng không quét sạch cả sổ lead. */
export const NGUONG_NGUOI_TOI_THIEU = 7;
export const NGUONG_NGUOI_TOI_DA = 730;

const MOT_NGAY = 24 * 60 * 60 * 1000;

/**
 * Lần CUỐI CÙNG có người đụng vào lead này.
 *
 * Lấy mốc MUỘN NHẤT trong các cột hợp lệ. Không bao giờ trả `null`: `createdAt` là cột bắt
 * buộc nên luôn có đáy — thiếu đáy thì lead chưa từng được chăm sẽ rơi khỏi bộ lọc, đúng
 * những lead cần lọc nhất.
 */
export function mocTuongTacCuoi(lead: LeadDeDoNguoi): Date {
  const moc = [
    lead.lastActivityAt,
    lead.firstContactAt,
    lead.assignedAt,
    lead.createdAt,
  ].filter((d): d is Date => d instanceof Date);
  return moc.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b), lead.createdAt);
}

/**
 * Bao nhiêu ngày TRÒN kể từ lần cuối có người đụng vào.
 *
 * Cắt xuống (`floor`): "89,9 ngày" phải đọc là 89, nếu không một lead chưa đủ ngưỡng lại
 * hiện ra trong danh sách 90 ngày và quản lý bấm phân bổ mà không biết mình vừa phá luật.
 * Mốc ở tương lai (lệch đồng hồ) trả 0 chứ không trả số âm.
 */
export function soNgayIm(lead: LeadDeDoNguoi, now: Date): number {
  const cach = now.getTime() - mocTuongTacCuoi(lead).getTime();
  return cach <= 0 ? 0 : Math.floor(cach / MOT_NGAY);
}

/** Đã đủ nguội để đem đi phân bổ lại chưa. */
export function daNguoi(lead: LeadDeDoNguoi, now: Date, nguongNgay: number): boolean {
  return soNgayIm(lead, now) >= nguongNgay;
}

/**
 * Ngưỡng người dùng gõ vào → ngưỡng dùng được.
 *
 * ⚠️ Ô nhập rỗng / chữ / số âm KHÔNG được rơi về 0 — ngưỡng 0 nghĩa là "mọi lead đều nguội",
 * và màn này có nút phân bổ hàng loạt. Một ô nhập hỏng không được phép biến thành một lượt
 * xáo trộn toàn bộ sổ lead.
 */
export function chuanNguong(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return NGUONG_NGUOI_MAC_DINH;
  return Math.min(NGUONG_NGUOI_TOI_DA, Math.max(NGUONG_NGUOI_TOI_THIEU, Math.trunc(n)));
}

/** Mốc thời gian để dựng câu `where`: lead nguội là lead có mọi cột mốc TRƯỚC thời điểm này. */
export function mocCatNguoi(now: Date, nguongNgay: number): Date {
  return new Date(now.getTime() - nguongNgay * MOT_NGAY);
}

/** Nhãn ngắn cho cột "im bao lâu" — người vận hành đọc số ngày trần thì khó ước lượng. */
export function nhanSoNgay(ngay: number): string {
  if (ngay < 60) return `${ngay} ngày`;
  const thang = Math.floor(ngay / 30);
  return `${ngay} ngày (~${thang} tháng)`;
}
