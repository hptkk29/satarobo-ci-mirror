/**
 * TRẦN THỜI GIAN CỦA CÁC ROUTE NHẬP EXCEL.
 *
 * ── SỰ CỐ SINH RA BỘ NÀY (prod 16/09/2026) ───────────────────────────────────────────────
 * Chủ dự án nhập một file lead và nhận:
 *
 *   Lỗi ghi: Invalid `prisma.auditLog.create()` invocation: Transaction API error:
 *   Transaction not found. Transaction ID is invalid, refers to an old closed transaction
 *
 * Không phải lỗi dữ liệu. Prisma tự đóng giao dịch vì quá hạn **mặc định 5 giây**, rồi lệnh
 * ghi kế tiếp đập vào một giao dịch đã chết ⇒ ROLLBACK SẠCH: file đúng, không dòng nào vào.
 *
 * Đây là lần THỨ HAI cùng một bài trong repo. Lần đầu 05/08/2026 ở
 * `leads/registered/route.ts` ("60123 ms passed", 75 lead, rollback sạch) — vá xong nhưng
 * luật chỉ nằm trong chú thích của đúng tệp đó, nên `leads/route.ts` ra đời vẫn thiếu. Bộ
 * này biến bài học thành CỔNG.
 *
 * ── LUẬT ─────────────────────────────────────────────────────────────────────────────────
 * Route nhập nào mở `$transaction` bọc một VÒNG LẶP ghi thì phải khai CẢ HAI:
 *   · `timeout`     cho giao dịch — 5 giây mặc định là số dành cho MỘT lệnh ghi lẻ;
 *   · `maxDuration` cho hàm       — thiếu nó thì nới `timeout` chỉ đổi triệu chứng thành
 *                                   504, vì Vercel giết hàm trước khi giao dịch xong.
 *
 * ⚠️ Luật 11: đây là test QUÉT MÃ NGUỒN, loại mong manh nhất. Nên có ca TỰ KIỂM, gỡ chú
 * thích trước khi soi (chính khối chú thích bạn đang đọc có chứa chữ `timeout`), và mỗi
 * khẳng định neo hẹp.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GOC = path.join(process.cwd(), "app", "api", "admin", "import");

function goChuThich(s: string): string {
  return s.replace(/\/\*[^]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Mọi `route.ts` dưới `app/api/admin/import/**`. */
function timRoute(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
    const duong = path.join(thuMuc, m.name);
    if (m.isDirectory()) ra.push(...timRoute(duong));
    else if (m.name === "route.ts") ra.push(duong);
  }
  return ra;
}

interface HoSo {
  ten: string;
  moGiaoDich: boolean;
  coTimeout: boolean;
  coMaxDuration: boolean;
}

const HO_SO: HoSo[] = timRoute(GOC)
  .map((duong) => {
    const tho = fs.readFileSync(duong, "utf8");
    const sach = goChuThich(tho);
    return {
      ten: path.relative(GOC, duong).replace(/\\/g, "/"),
      moGiaoDich: /\$transaction\(/.test(sach),
      coTimeout: /timeout:\s*[0-9_]+/.test(sach),
      // Neo hẹp vào ĐÚNG dạng khai của Next, không phải chữ "maxDuration" ở đâu đó.
      coMaxDuration: /export const maxDuration\s*=\s*\d+/.test(sach),
    };
  })
  .sort((a, b) => a.ten.localeCompare(b.ten));

/** Route ĐÃ được vá — cổng cứng, sai là CI đỏ. */
const DA_VA = ["leads/route.ts", "leads/registered/route.ts"];

describe("[TRAN-T10] phép quét tự kiểm", () => {
  it("tìm được các route nhập và bộ gỡ chú thích hoạt động", () => {
    // Regex hỏng hoặc đường dẫn đổi thì mọi ca dưới xanh giả.
    expect(HO_SO.length).toBeGreaterThanOrEqual(10);
    expect(HO_SO.filter((h) => h.moGiaoDich).length).toBeGreaterThanOrEqual(8);
    const thu = ["a /* timeout: 1 */ b // maxDuration = 1", "c"].join(String.fromCharCode(10));
    expect(goChuThich(thu)).toBe(["a   b  ", "c"].join(String.fromCharCode(10)));
  });

  it("⚠️ chú thích KHÔNG được tính là đã khai", () => {
    // Chính tệp `leads/route.ts` có một khối chú thích dài nói về `timeout` và
    // `maxDuration`. Bộ so khớp mà đọc cả chú thích thì nó xanh cho một route chưa vá gì.
    const gia = goChuThich("/* timeout: 180_000 */\n// export const maxDuration = 300\nx");
    expect(/timeout:\s*[0-9_]+/.test(gia)).toBe(false);
    expect(/export const maxDuration\s*=\s*\d+/.test(gia)).toBe(false);
  });
});

describe("[TRAN-T11] ⚠️ hai đường nhập LEAD phải khai đủ cả hai trần", () => {
  for (const ten of DA_VA) {
    it(`${ten} — có \`timeout\` cho giao dịch`, () => {
      const h = HO_SO.find((x) => x.ten === ten);
      expect(h, `${ten} không còn ở chỗ cũ`).toBeDefined();
      expect(h!.moGiaoDich, `${ten} không còn mở $transaction`).toBe(true);
      expect(h!.coTimeout).toBe(true);
    });

    it(`${ten} — có \`maxDuration\` cho hàm`, () => {
      // Nới một cái mà quên cái kia là lỗi ĐỔI CHỖ chứ không hết: giao dịch sống lâu hơn
      // nhưng Vercel giết hàm, người dùng nhận 504 thay vì "Transaction not found".
      expect(HO_SO.find((x) => x.ten === ten)!.coMaxDuration).toBe(true);
    });
  }
});

describe("[TRAN-T12] nợ đã ĐO, chưa tới lượt vá", () => {
  /**
   * ⚠️ GHIM BẰNG `it.fails`, KHÔNG PHẢI `it.skip`.
   *
   * Đo 16/09/2026: còn 7 route nhập mở `$transaction` bọc vòng lặp mà chưa khai trần nào —
   * cùng quả bom vừa nổ ở màn lead, chỉ chưa ai nhập file đủ lớn. Chúng CHƯA được vá trong
   * đợt này vì đợt này nhắm đúng lỗi người dùng báo, và mỗi route cần đo riêng xem file
   * thật của nó lớn cỡ nào.
   *
   * `skip` là QUÊN, `it.fails` là HẸN: hôm nay thân ca ném nên CI không đỏ; ngày ai đó vá
   * xong, ca này chuyển sang XANH và Playwright/Vitest báo "expected to fail", buộc người
   * vá gỡ ghim và dọn luôn danh sách dưới đây.
   */
  it.fails("MỌI route nhập mở giao dịch đều khai đủ `timeout` + `maxDuration`", () => {
    const thieu = HO_SO.filter((h) => h.moGiaoDich && !(h.coTimeout && h.coMaxDuration)).map(
      (h) => `${h.ten} (timeout=${h.coTimeout}, maxDuration=${h.coMaxDuration})`,
    );
    expect(thieu, `còn ${thieu.length} route chưa khai đủ`).toEqual([]);
  });

  it("danh sách nợ KHÔNG được dài thêm", () => {
    // Ghim con số để một route MỚI ra đời thiếu trần thì cổng đỏ NGAY, thay vì lặng lẽ
    // nhập vào đám nợ cũ rồi ba tháng sau nổ trên prod.
    const thieu = HO_SO.filter((h) => h.moGiaoDich && !(h.coTimeout && h.coMaxDuration));
    expect(thieu.length).toBeLessThanOrEqual(8);
  });
});
