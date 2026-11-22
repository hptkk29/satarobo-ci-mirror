import "server-only";
import { notifyStaff, thuHoiThongBao } from "@/lib/notifications/notify";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";
import { khoaTinChoDuyet, soanTinChoDuyet, type LyDoChoDuyet } from "@/lib/orders/tin-cho-duyet";
import { QUYEN_DUYET_DON } from "@/lib/orders/cho-duyet";

/**
 * GỬI / THU HỒI tin báo "đơn vượt mức đang chờ duyệt".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Chủ dự án 25/09/2026: *"khi có đơn cần được duyệt thì phải gửi thông báo về ngay cho
 * quản lý để duyệt gấp cho KH được thanh toán"*.
 *
 * ⚠️ HAI VẾ, VÀ VẾ THỨ HAI DỄ BỊ QUÊN. Gửi tin thì ai cũng nhớ; **thu hồi khi đã duyệt**
 * thì không — và quên nó là chuông đọng lại một việc đã xong. Người ta bấm vào, thấy màn
 * duyệt trống, vài lần như thế là họ thôi tin cái chuông. Một thông báo sai còn đắt hơn
 * không có thông báo, vì nó phá giá TẤT CẢ thông báo khác.
 *
 * Hai hàm ở cùng một tệp, dùng chung `khoaTinChoDuyet` và chung phép tra người nhận —
 * để không có đường nào gửi cho một tập người mà thu hồi ở một tập khác.
 */

/**
 * Quyền duyệt đơn. Ai giữ MỘT trong số đó là người cần biết.
 *
 * ⚠️ Danh sách DÙNG CHUNG, KHÔNG gõ lại [gom 25/09/2026]. Lệch với cổng của server action
 * thì người có quyền không nhận được tin — hoặc nhận tin rồi bấm vào bị từ chối — và hai
 * triệu chứng ấy không ai nối được với nhau.
 */
const QUYEN_DUYET = QUYEN_DUYET_DON;

/**
 * Báo cho người duyệt tại cơ sở của đơn.
 *
 * ⚠️ **KHÔNG BAO GIỜ NÉM.** Hàm này chạy SAU transaction tạo đơn: đơn đã nằm trong DB
 * rồi. Một ngoại lệ lọt ra là người bán nhận câu "tạo đơn thất bại" cho một đơn đã tồn
 * tại, rồi bấm lại — và có hai đơn thật cho một khách. Cùng lý lẽ đã ghi ở khối "kế hoạch
 * thanh toán lập ngay lúc tạo đơn" trong `_actions.ts`.
 *
 * Trả về số người đã được báo, để chỗ gọi ghi log nếu muốn. `0` là hợp lệ: đơn không gắn
 * cơ sở, hoặc cơ sở chưa ai giữ quyền duyệt.
 */
export async function baoDonChoDuyet(input: {
  orderId: string;
  code: string;
  centerId: string | null;
  tenKhach: string;
  tongTien: number;
  lyDo: LyDoChoDuyet;
  /** Người vừa tạo đơn — KHÔNG tự báo cho chính mình. */
  boQuaUserId?: string | null;
}): Promise<number> {
  try {
    if (!input.centerId) return 0;
    if (!input.lyDo.giamGia && !input.lyDo.traGop) return 0;

    const nguoi = (await nguoiGiuQuyenTaiCoSo(input.centerId, QUYEN_DUYET)).filter(
      (id) => id !== input.boQuaUserId,
    );
    if (nguoi.length === 0) return 0;

    const tin = soanTinChoDuyet(input);
    return await notifyStaff({
      userIds: nguoi,
      dedupeKey: tin.dedupeKey,
      title: tin.title,
      body: tin.body,
      href: tin.href,
      entityId: input.orderId,
      // ⚠️ `reopen: true` CÓ CHỦ ĐÍCH. Người bán sửa đơn rồi xin duyệt lại thì tin cũ đã
      // đọc phải quay về CHƯA ĐỌC — nội dung đổi (số tiền, lý do) nghĩa là thứ người
      // duyệt từng gật không còn là thứ đang chờ. `ghiThongBaoNhanSu` chỉ kéo về chưa đọc
      // khi nội dung THỰC SỰ đổi, nên cờ này không biến chuông thành nguồn nhiễu.
      reopen: true,
    });
  } catch (err) {
    // Nuốt CÓ GHI LOG — im lặng hoàn toàn là biến một lỗi hạ tầng thành "không ai được
    // báo" mà không để lại dấu vết nào để lần.
    console.error("[orders] khong gui duoc tin cho duyet:", err);
    return 0;
  }
}

/**
 * Thu hồi tin khi đơn đã được duyệt HOẶC bị từ chối.
 *
 * ⚠️ Gọi ở CẢ HAI đường, không chỉ đường duyệt. Đơn bị từ chối cũng thôi chờ — để tin lại
 * là người duyệt mở ra và không hiểu vì sao đơn không còn trong danh sách.
 *
 * ⚠️ Tra lại ĐÚNG tập người nhận, không đoán. `thuHoiThongBao` lọc theo `userId` + khoá,
 * nên một tập lệch là thu hồi hụt cho đúng những người đã nhận.
 */
export async function thuHoiBaoChoDuyet(input: {
  orderId: string;
  centerId: string | null;
}): Promise<number> {
  try {
    if (!input.centerId) return 0;
    const nguoi = await nguoiGiuQuyenTaiCoSo(input.centerId, QUYEN_DUYET);
    if (nguoi.length === 0) return 0;
    return await thuHoiThongBao({
      userIds: nguoi,
      dedupeKey: khoaTinChoDuyet(input.orderId),
    });
  } catch (err) {
    console.error("[orders] khong thu hoi duoc tin cho duyet:", err);
    return 0;
  }
}
