/**
 * Slug khoá học: trang hỏi một kiểu, DB lưu một kiểu khác.
 *
 * Đo 22/09/2026 — cùng một khoá Sata1, hai môi trường lưu hai cách:
 *   · DB local  → "sata-1"
 *   · DB prod   → "sata1"   (ảnh chụp màn `/admin/courses` của chủ dự án)
 * Trang chi tiết hỏi `"sata1"`. Tra trượt KHÔNG ném lỗi, KHÔNG làm trang vỡ — nó lặng lẽ
 * rơi xuống bậc sau và in ra học phí cũ trong `courses-pricing.ts` (1.650.000đ thay vì
 * 2.400.000đ). Một con số sai chỉ hiện ở một môi trường là loại lỗi không ai đi tìm.
 *
 * `ungVienSlugKhoa` là hàm THUẦN nên test được không cần DB.
 */
import { describe, it, expect } from "vitest";
import { ungVienSlugKhoa } from "./courses-helpers";

describe("ứng viên slug khoá học", () => {
  it("[SLUG-01] slug không gạch vẫn tìm được bản CÓ gạch", () => {
    // Ca của DB local: trang hỏi "sata1", DB lưu "sata-1".
    expect(ungVienSlugKhoa("sata1")).toContain("sata-1");
  });

  it("[SLUG-02] slug có gạch vẫn tìm được bản KHÔNG gạch", () => {
    // Ca ngược lại, phòng khi một môi trường đổi quy ước.
    expect(ungVienSlugKhoa("sata-1")).toContain("sata1");
  });

  it("[SLUG-03] luôn giữ chính slug được hỏi, và để nó ĐỨNG ĐẦU", () => {
    // Bản khớp chính xác phải được xét trước bản suy ra.
    expect(ungVienSlugKhoa("sata1")[0]).toBe("sata1");
  });

  it("[SLUG-04] slug nhiều đoạn KHÔNG bị bóp méo thành dạng lạ", () => {
    // "combo-sata1-sata2" không có dạng <chữ><số> ở cuối nên không sinh biến thể gạch.
    const ds = ungVienSlugKhoa("combo-sata1-sata2");
    expect(ds).toContain("combo-sata1-sata2");
    expect(ds).toContain("combosata1sata2");
  });

  it("[SLUG-05] không trả ứng viên trùng nhau", () => {
    // Slug không có gạch và không có dạng <chữ><số> thì cả ba phép cho cùng kết quả.
    expect(ungVienSlugKhoa("laptrinhrobot")).toEqual(["laptrinhrobot"]);
  });

  it("[SLUG-06] chuẩn hoá hoa/thường và khoảng trắng thừa", () => {
    expect(ungVienSlugKhoa("  Sata3  ")).toContain("sata-3");
  });
});
