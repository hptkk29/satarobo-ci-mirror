import { rateLimit } from "@/lib/rate-limit";

/**
 * EL-16 — GIỚI HẠN TẦN SUẤT của trang xác minh chứng nhận công khai (ADR-0002 §2/§6).
 *
 * Trang `/xac-thuc/{token}` không đăng nhập, nên thứ duy nhất chặn kẻ dò token hàng loạt là token ngẫu nhiên
 * 32 ký tự. Giới hạn theo IP là lớp thứ hai: nó không làm việc dò khả thi hơn, mà làm việc dò TỐN THỜI GIAN
 * đủ để lượt dò trở nên vô nghĩa, và bảo vệ DB khỏi bị gõ cửa liên tục từ một nguồn.
 *
 * ⚠️ ĐẾM MỌI LƯỢT, kể cả lượt trượt: kẻ dò thì gần như toàn lượt trượt. Đếm riêng lượt trúng là để lọt đúng
 * thứ cần chặn. Việc kiểm đứng TRƯỚC mọi truy vấn — lượt vượt ngưỡng không chạm DB.
 *
 * Ngưỡng 30 lượt / phút / IP là đề xuất của ADR-0002 §6; owner chưa ký con số, nên nó là HẰNG CÓ TÊN ở một chỗ
 * (đổi một dòng), không phải khoá cấu hình. Người cầm tờ chứng nhận quét QR một lần — 30/phút dư xa cho một
 * văn phòng dùng chung IP vừa kiểm tra một xấp chứng nhận.
 *
 * Lỗi hạ tầng (rate limiter ném) ⇒ CHO QUA: trang này là bằng chứng cho người ngoài, không đáng để một lỗi
 * Redis làm nó sập; `rateLimit()` vốn đã tự lùi về bộ nhớ khi Upstash hỏng, nên nhánh catch gần như không chạm.
 */
export const GIOI_HAN_XAC_THUC = { max: 30, windowMs: 60_000 } as const;

export async function choPhepTraChungNhan(ip: string): Promise<boolean> {
  try {
    const r = await rateLimit({
      key: `el-xac-thuc:${ip}`,
      max: GIOI_HAN_XAC_THUC.max,
      windowMs: GIOI_HAN_XAC_THUC.windowMs,
    });
    return r.success;
  } catch {
    return true;
  }
}
