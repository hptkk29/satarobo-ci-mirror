/**
 * CỔNG ĐỒNG Ý CHÍNH SÁCH BẢO MẬT trên đường nhận lead công khai (`POST /api/leads`).
 *
 * Hồ sơ Bộ Công Thương, mục 3: *"Ở trang đăng ký, bổ sung nội dung cho người mua tích xác
 * nhận «Tôi đã đọc và đồng ý với Chính sách bảo mật của website»"*.
 *
 * Vì sao phải khoá ở TẦNG SCHEMA chứ không chỉ ở ô tích: ô tích trong trình duyệt là
 * AFFORDANCE — bất kỳ ai cũng `curl` thẳng `/api/leads` được. Cổng duy nhất không đi vòng
 * được là cổng server. Repo đã có tiền lệ đúng lớp lỗi này: cột `consentMarketing` tồn tại
 * từ lâu nhưng khai `z.boolean().default(false)`, và **5 đường gửi đóng cứng `true`** —
 * tức một cột "đồng ý" chưa bao giờ ghi lại sự đồng ý của ai.
 *
 * Ba ca dưới đây là ca HÀNH VI (chạy schema thật với payload thật), không phải grep mã.
 */
import { describe, it, expect } from "vitest";
import { leadCreateSchema, leadUpdateSchema } from "./lead";

/** Payload tối thiểu đủ qua mọi vế khác của schema — chỉ xoay quanh trường đồng ý. */
const payloadHopLe = {
  parentName: "Nguyễn Văn A",
  phone: "0912345678",
  source: "lien-he",
  eventId: "evt-12345678",
  dongYChinhSachBaoMat: true as const,
};

describe("cổng đồng ý Chính sách bảo mật (leadCreateSchema)", () => {
  it("[DY-01] payload có đồng ý = true thì QUA", () => {
    expect(leadCreateSchema.safeParse(payloadHopLe).success).toBe(true);
  });

  it("[DY-02] THIẾU trường đồng ý thì BỊ TỪ CHỐI", () => {
    // Đây là ca của kẻ gọi thẳng API mà không qua form.
    const { dongYChinhSachBaoMat: _bo, ...thieu } = payloadHopLe;
    expect(leadCreateSchema.safeParse(thieu).success).toBe(false);
  });

  it("[DY-03] gửi đồng ý = false thì BỊ TỪ CHỐI", () => {
    // Ca của người bỏ trống ô tích rồi vẫn bấm gửi.
    const res = leadCreateSchema.safeParse({ ...payloadHopLe, dongYChinhSachBaoMat: false });
    expect(res.success).toBe(false);
  });

  it("[DY-04] KHÔNG có mặc định đúng-sẵn — `.default(true)` biến cổng thành trang trí", () => {
    // Nếu ai đó thêm `.default(true)` thì [DY-02] sẽ tự xanh trở lại mà không ai hay.
    // Ca này canh riêng vế đó: parse payload thiếu trường, rồi hỏi kết quả có tự điền không.
    const { dongYChinhSachBaoMat: _bo, ...thieu } = payloadHopLe;
    const res = leadCreateSchema.safeParse(thieu);
    expect(res.success).toBe(false);
    if (!res.success) {
      const cac = res.error.issues.map((i) => i.path.join("."));
      expect(cac).toContain("dongYChinhSachBaoMat");
    }
  });

  it("[DY-05] câu lỗi nói được cho người dùng đọc, không phải chữ máy", () => {
    const res = leadCreateSchema.safeParse({ ...payloadHopLe, dongYChinhSachBaoMat: false });
    expect(res.success).toBe(false);
    if (!res.success) {
      const loi = res.error.issues.find((i) => i.path.join(".") === "dongYChinhSachBaoMat");
      expect(loi?.message).toContain("Chính sách bảo mật");
    }
  });

  it("[DY-06] leadUpdateSchema KHÔNG bị siết theo — sửa lead ở admin không phải đồng ý lại", () => {
    // `leadUpdateSchema = leadCreateSchema.partial()` nên trường này thành optional.
    // Đối chứng: thiếu ca này thì một bản "siết cho chặt" sẽ chặn luôn màn sửa lead của
    // nhân viên, và triệu chứng hiện ra ở chỗ chẳng liên quan gì tới hồ sơ BCT.
    expect(leadUpdateSchema.safeParse({ parentName: "Nguyễn Văn B" }).success).toBe(true);
  });
});
