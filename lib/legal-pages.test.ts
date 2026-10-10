/**
 * Bất biến của danh sách 10 chính sách nộp Bộ Công Thương.
 *
 * Vì sao khoá bằng test: hướng dẫn của đơn vị tư vấn BCT nói *"Ghi ĐÚNG TÊN chính sách
 * dưới đây"*. Tên hiển thị ở chân trang là thứ cán bộ tiếp nhận đối chiếu với bộ .docx —
 * nhưng lệch tên KHÔNG ném lỗi, KHÔNG làm build đỏ, console vẫn sạch. Chỉ người cầm hồ sơ
 * mới thấy, và lúc đó thì đã nộp rồi.
 *
 * Repo đã chứng minh tên trôi được: với chỉ 2–3 liên kết, cùng một trang đang mang ba cái
 * tên khác nhau ở ba chân trang ("Chính sách bảo mật" / "Bảo mật" / "Bảo Mật").
 *
 * Ca `[LEGAL-01]` cố ý dán NGUYÊN VĂN 10 tên vào test thay vì suy từ chính `LEGAL_PAGES` —
 * suy từ nguồn đang kiểm là tautology, sửa nguồn thì test tự đúng theo và không bắt được gì.
 */
import { describe, it, expect } from "vitest";
import {
  LEGAL_PAGES,
  LEGAL_PAGES_PHU,
  LEGAL_INDEX_SLUG,
  allLegalSlugs,
  legalHref,
} from "./legal-pages";

/**
 * Chép tay từ `0. HƯỚNG DẪN CHỈNH SỬA GIAO DIỆN WEB.docx` mục 1, đúng thứ tự, đúng từng chữ.
 * Đây là BẢN SAO ĐỘC LẬP — đừng thay bằng `LEGAL_PAGES.map(p => p.label)`.
 */
const TEN_BAT_BUOC = [
  "Chính sách bảo mật",
  "Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại",
  "Chính sách về giá",
  "Chính sách thanh toán",
  "Các điều kiện và hạn chế trong việc giao hàng và cung cấp dịch vụ",
  "Chính sách giao hàng",
  "Phương thức cung cấp dịch vụ",
  "Chính sách đổi trả hàng và hoàn tiền",
  "Chính sách chấm dứt dịch vụ và hoàn tiền",
  "Quyền và nghĩa vụ của các bên",
];

describe("10 chính sách bắt buộc của hồ sơ BCT", () => {
  it("[LEGAL-01] tên hiển thị khớp NGUYÊN VĂN danh sách bắt buộc, đúng thứ tự", () => {
    expect(LEGAL_PAGES.map((p) => p.label)).toEqual(TEN_BAT_BUOC);
  });

  it("[LEGAL-02] đúng 10 mục — không thừa, không thiếu", () => {
    expect(LEGAL_PAGES).toHaveLength(10);
  });

  it("[LEGAL-03] slug không trùng nhau", () => {
    const slugs = LEGAL_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("[LEGAL-04] slug hợp lệ để làm đường dẫn (kebab-case, không dấu, không '/')", () => {
    // Slug có dấu hoặc có '/' sẽ dựng ra một route không mở được, và trang chính sách
    // KHÔNG mở được thì coi như không có chính sách đó.
    for (const p of LEGAL_PAGES) {
      expect(p.slug, `slug của "${p.label}"`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("[LEGAL-05] mỗi mục khai được nguồn .docx để truy ngược nội dung", () => {
    for (const p of LEGAL_PAGES) {
      expect(p.nguon.trim(), `nguồn của "${p.label}"`).not.toBe("");
    }
  });

  it("[LEGAL-06] trang phụ KHÔNG giẫm slug của 10 trang bắt buộc", () => {
    // Giẫm slug = một trong hai trang bị trang kia che, im lặng.
    const batBuoc = new Set(LEGAL_PAGES.map((p) => p.slug));
    for (const p of LEGAL_PAGES_PHU) {
      expect(batBuoc.has(p.slug), `trang phụ "${p.slug}" giẫm slug bắt buộc`).toBe(false);
    }
  });

  it("[LEGAL-07] trang mục lục không giẫm slug nào", () => {
    expect(allLegalSlugs().filter((s) => s === LEGAL_INDEX_SLUG)).toHaveLength(1);
  });

  it("[LEGAL-08] allLegalSlugs() không trả slug trùng — sitemap sinh từ nó", () => {
    const all = allLegalSlugs();
    expect(new Set(all).size).toBe(all.length);
  });

  it("[LEGAL-09] legalHref sinh đường dẫn tuyệt đối một dấu '/'", () => {
    expect(legalHref("chinh-sach-gia")).toBe("/chinh-sach-gia");
  });
});
