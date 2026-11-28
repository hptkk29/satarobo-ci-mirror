/**
 * GIÁ HIỂN THỊ CÔNG KHAI của khoá học — hồ sơ Bộ Công Thương mục 4.
 *
 * Yêu cầu gốc: *"Tạm thời ẩn các sản phẩm/dịch vụ không công khai giá VÀ không đặt hàng
 * được"*. Với hai khoá chủ lực, chủ dự án chốt **công khai giá** thay vì ẩn — phá vế thứ
 * nhất thì mục đó không còn áp dụng.
 *
 * Vì sao khoá bằng test: chuỗi giá là thứ cơ quan quản lý đọc, mà nó đi qua một chuỗi
 * fallback bốn tầng. Tầng cuối là `"Liên hệ"` — tức **đúng trạng thái hồ sơ đang bắt sửa**.
 * Một thay đổi vô ý ở tầng trên sẽ lặng lẽ tụt xuống tầng đó: không lỗi, không log, thẻ
 * vẫn hiện bình thường, chỉ là không còn giá.
 */
import { describe, it, expect } from "vitest";
import { giaHienThi, dinhDangTien, GIA_SAN_THEO_SLUG } from "./gia-cong-khai";

describe("giá hiển thị công khai của khoá học", () => {
  it("[GIA-01] `priceDisplay` người vận hành khai thì THẮNG tất cả", () => {
    expect(
      giaHienThi({ slug: "laptrinhrobot", price: 999, priceDisplay: "Chỉ từ 2.400.000đ" }),
    ).toBe("Chỉ từ 2.400.000đ");
  });

  it("[GIA-02] thiếu `priceDisplay` thì lấy `price` của DB", () => {
    expect(giaHienThi({ slug: "laptrinhrobot", price: 2_400_000, priceDisplay: null })).toBe(
      "Chỉ từ 2.400.000đ",
    );
  });

  it("[GIA-03] `price = 0` KHÔNG phải miễn phí — 0đ nghĩa là chưa khai", () => {
    // Đo prod 21/09/2026: hai khoá chủ lực đang mang `price = 0` trên DB. Nếu coi 0 là
    // giá thật thì thẻ in "Chỉ từ 0đ" — sai nặng hơn cả "Liên hệ".
    expect(giaHienThi({ slug: "laptrinhrobot", price: 0, priceDisplay: null })).toBe(
      "Chỉ từ 2.400.000đ",
    );
  });

  it('[GIA-04b] `priceDisplay` là chữ "Liên hệ tư vấn" thì KHÔNG được thắng', () => {
    // Đây là hiện trạng THẬT trên DB ngày 21/09/2026 cho cả hai khoá chủ lực. Bản vá đầu
    // của tôi cho `priceDisplay` ưu tiên cao nhất, nên thẻ vẫn in "Liên hệ tư vấn" — tức
    // bản vá vô tác dụng mà test vẫn xanh. Chỉ chạy với dữ liệu thật mới lộ ra.
    expect(
      giaHienThi({ slug: "laptrinhrobot", price: 4_400_000, priceDisplay: "Liên hệ tư vấn" }),
    ).toBe("Chỉ từ 4.400.000đ");
    // Và khi DB cũng chưa có giá thì rơi về giá sàn, KHÔNG rơi về chữ "Liên hệ tư vấn".
    expect(
      giaHienThi({ slug: "luyenthirobosim", price: 0, priceDisplay: "Liên hệ tư vấn" }),
    ).toBe("Chỉ từ 490.000đ");
  });

  it("[GIA-04] `priceDisplay` rỗng/toàn khoảng trắng bị bỏ qua", () => {
    expect(giaHienThi({ slug: "luyenthirobosim", price: null, priceDisplay: "   " })).toBe(
      "Chỉ từ 490.000đ",
    );
  });

  it("[GIA-05] hai khoá chủ lực LUÔN có số, kể cả khi DB trống trơn", () => {
    // Đây là bất biến của hồ sơ: trang công khai không được phụ thuộc vào việc ai đó đã
    // kịp gõ một ô chữ tự do trong admin hay chưa.
    for (const slug of ["laptrinhrobot", "luyenthirobosim"]) {
      const chuoi = giaHienThi({ slug });
      expect(chuoi, `${slug} rơi về "Liên hệ"`).not.toBe("Liên hệ");
      expect(chuoi, `${slug} không in ra con số nào`).toMatch(/\d/);
    }
  });

  it('[GIA-06] khoá lạ vẫn rơi về "Liên hệ" — và khoá như vậy thuộc diện phải ẩn', () => {
    expect(giaHienThi({ slug: "khoa-khong-ton-tai" })).toBe("Liên hệ");
  });

  it("[GIA-07] định dạng tiền dùng dấu chấm ngăn nghìn, đúng cách viết của site", () => {
    expect(dinhDangTien(2_400_000)).toBe("2.400.000đ");
    expect(dinhDangTien(490_000)).toBe("490.000đ");
  });

  it("[GIA-08] giá sàn khớp giá niêm yết đã đo trên /admin/courses", () => {
    // Chép tay từ ảnh chụp màn /admin/courses (21/09/2026): khoá rẻ nhất là
    // Sata1 — Robosim Master, 2.400.000đ. Ca này canh việc ai đó sửa con số mà không đo lại.
    expect(GIA_SAN_THEO_SLUG.laptrinhrobot).toBe(2_400_000);
    expect(GIA_SAN_THEO_SLUG.luyenthirobosim).toBe(490_000);
  });
});
