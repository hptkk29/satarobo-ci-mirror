// @vitest-environment node
/**
 * Bài VIDEO dùng link YouTube — tách mã video từ link người soạn dán.
 *
 * Đây là cổng DUY NHẤT giữa "chuỗi người dùng gõ" và "mã đưa vào iframe", nên ca đắt
 * nhất là nhóm TỪ CHỐI: host giả danh YouTube và giao thức lạ.
 */
import { describe, it, expect } from "vitest";
import { tachMaYoutube, linkXemYoutube } from "@/lib/elearning/youtube-link";

const MA = "aBcDeFg_H-1"; // 11 ký tự, có cả `_` và `-` — hai ký tự dễ bị regex lỡ tay loại

describe("[YTL-01] nhận các dạng link một video", () => {
  const CAC_DANG: Array<[string, string]> = [
    ["watch", `https://www.youtube.com/watch?v=${MA}`],
    ["watch có tham số khác đứng trước", `https://www.youtube.com/watch?feature=share&v=${MA}`],
    ["watch kèm mốc thời gian", `https://www.youtube.com/watch?v=${MA}&t=95s`],
    ["không www", `https://youtube.com/watch?v=${MA}`],
    ["mobile", `https://m.youtube.com/watch?v=${MA}`],
    ["rút gọn", `https://youtu.be/${MA}`],
    ["rút gọn kèm ?si=", `https://youtu.be/${MA}?si=AbCdEf123`],
    ["embed", `https://www.youtube.com/embed/${MA}`],
    ["nocookie embed", `https://www.youtube-nocookie.com/embed/${MA}`],
    ["shorts", `https://www.youtube.com/shorts/${MA}`],
    ["live", `https://www.youtube.com/live/${MA}`],
    ["dán thiếu giao thức", `youtu.be/${MA}`],
    ["dán thiếu giao thức + www", `www.youtube.com/watch?v=${MA}`],
    ["có khoảng trắng hai đầu", `  https://youtu.be/${MA}  `],
    ["http thường", `http://youtu.be/${MA}`],
    ["chữ hoa ở host", `https://WWW.YouTube.com/watch?v=${MA}`],
  ];
  for (const [ten, link] of CAC_DANG) {
    it(ten, () => expect(tachMaYoutube(link)).toBe(MA));
  }
});

describe("[YTL-02] TỪ CHỐI host giả danh và giao thức lạ", () => {
  const CAC_CA: Array<[string, string]> = [
    ["host có hậu tố giả", `https://youtube.com.evil.com/watch?v=${MA}`],
    ["host chứa chữ youtube", `https://notyoutube.com/watch?v=${MA}`],
    ["tên miền con lạ", `https://evil.youtube.com.vn/watch?v=${MA}`],
    ["giấu host sau user:pass@", `https://youtube.com@evil.com/watch?v=${MA}`],
    // Ca mà cổng user:pass@ thật sự có việc: host THẬT là youtube.com, phần đứng trước @ là đồ lạ.
    // Link kiểu này người soạn không bao giờ gõ tay — chỉ gặp khi bị dán từ nguồn không tin cậy.
    ["user:pass@ đứng trước host YouTube", `https://evil.com@www.youtube.com/watch?v=${MA}`],
    ["giấu host sau user:pass@ (youtu.be)", `https://youtu.be:pw@evil.com/${MA}`],
    ["javascript:", `javascript:alert('${MA}')`],
    ["data:", `data:text/html,${MA}`],
    ["ftp", `ftp://youtu.be/${MA}`],
    ["host khác hẳn", `https://vimeo.com/watch?v=${MA}`],
  ];
  for (const [ten, link] of CAC_CA) {
    it(ten, () => expect(tachMaYoutube(link), link).toBeNull());
  }
});

describe("[YTL-03] TỪ CHỐI link không phải MỘT video", () => {
  const CAC_CA: Array<[string, string]> = [
    ["chỉ có danh sách phát", "https://www.youtube.com/playlist?list=PLabcdefghijk"],
    ["watch không có v", "https://www.youtube.com/watch"],
    ["trang kênh", "https://www.youtube.com/@satarobo"],
    ["trang chủ", "https://www.youtube.com/"],
    ["mã quá ngắn", "https://youtu.be/abc"],
    ["mã quá dài", `https://youtu.be/${MA}X`],
    ["mã có ký tự lạ", "https://youtu.be/abc!defghij"],
    ["chuỗi 11 ký tự trần", MA],
    ["rỗng", ""],
    ["toàn khoảng trắng", "    "],
    ["không phải link", "xem video ở kênh"],
  ];
  for (const [ten, link] of CAC_CA) {
    it(ten, () => expect(tachMaYoutube(link), link).toBeNull());
  }

  it("chuỗi quá dài ⇒ từ chối, không phân tích", () => {
    expect(tachMaYoutube(`https://youtu.be/${MA}?${"a=1&".repeat(200)}`)).toBeNull();
  });
});

describe("[YTL-04] link xem chuẩn", () => {
  it("dựng lại từ mã, và tách ngược ra đúng mã đó", () => {
    expect(tachMaYoutube(linkXemYoutube(MA))).toBe(MA);
  });
});
