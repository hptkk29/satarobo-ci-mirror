import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────
//
// Thứ cần khoá KHÔNG phải một giá trị trả về mà là HÌNH DẠNG của luồng: "những câu tra
// không cần nhau phải chạy CÙNG LÚC". Test hành vi không chứng minh được điều đó — một
// trang chạy 21 lượt đi-về nối đuôi nhau trả về đúng y hệt một trang chạy 9 lượt. Khác
// biệt duy nhất là người bán phải ngồi chờ, và **không có ca test nào biết đau**.
//
// Sự cố sinh ra lưới này (24/09/2026): chủ dự án báo *"đến trang chi tiết đơn hàng thì
// phải đợi một chút mới có nút xuất QR"*. Không phải nút hỏng — trang có `loading.tsx`
// nên khung chờ hiện ngay, còn nội dung thật thì đợi hết 21 lượt đi-về TUẦN TỰ.
describe("[DST-01] trang chi tiết đơn — độ sâu tuần tự", () => {
  const src = readFileSync(
    resolve(process.cwd(), "app/(admin)/admin/orders/[id]/page.tsx"),
    "utf8",
  );

  /**
   * Mã THẬT — đã bỏ chú thích.
   *
   * ⚠️ Bước này KHÔNG phải dọn dẹp, nó là điều kiện để lưới nói thật. Bản đầu đếm thẳng
   * trên `src` và ra **13 thay vì 11**, vì chính khối chú thích giải thích bản vá có câu
   * *"thêm một `await` mới thì gom vào một lô"*. Luật 11: chú thích của bản vá gần như
   * luôn chứa đúng chuỗi mà bộ so khớp đang tìm.
   */
  const ma = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");

  /**
   * TRẦN 11, và con số này CÓ Ý NGHĨA — đừng nâng nó để cho test xanh.
   *
   * 11 = 5 bước bắt buộc nối tiếp (`auth` → `checkPermission("orders:view")` → `params`
   * → `resolveActor` → `order`) + 4 lô `Promise.all` + `memoPhatHanh` + `qrSessions`.
   *
   * Thêm một câu tra mới thì **gom vào một lô có sẵn**. Chỉ nâng trần khi câu tra mới
   * THẬT SỰ cần kết quả của một lô trước nó — và khi đó ghi rõ nó cần cái gì ngay tại
   * đây, kẻo lần sau người ta lại nâng tiếp mà không ai biết vì sao.
   */
  const TRAN = 11;

  it("không có câu tra nào bị nối thêm vào chuỗi", () => {
    const soAwait = ma.match(/\bawait\b/g)?.length ?? 0;
    expect(
      soAwait,
      `Trang đang có ${soAwait} điểm \`await\` (trần ${TRAN}). Nếu bạn vừa thêm một câu ` +
        `tra: gom nó vào một \`Promise.all\` có sẵn thay vì nối vào chuỗi. Đọc khối ` +
        `"ĐỘ SÂU TUẦN TỰ" ở đầu \`OrderDetailPage\`.`,
    ).toBeLessThanOrEqual(TRAN);
  });

  it("bốn lô song song vẫn còn nguyên", () => {
    // Gỡ một lô là quay về hành vi cũ mà KHÔNG ca nào khác đỏ — trang vẫn trả đúng dữ
    // liệu, chỉ chậm lại. Đây là lưới duy nhất biết.
    expect(ma.match(/await Promise\.all\(\[/g)?.length ?? 0).toBe(4);
  });

  it("trang vẫn KHÔNG có Suspense — nên độ sâu tuần tự là thứ duy nhất quyết định", () => {
    // Nếu một ngày trang được chẻ bằng `Suspense` thì luận cứ của lưới này đổi: lúc đó
    // từng khối tự hiện ra và trần `await` không còn là thước đo đúng. Ca này đỏ để buộc
    // người làm việc ấy đọc lại cả khối chú thích, chứ không phải để cấm dùng Suspense.
    expect(ma).not.toContain("<Suspense");
  });
});
