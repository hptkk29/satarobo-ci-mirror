// lib/integrations/zalocrm/kenh.test.ts — LƯỚI THAY CHO TYPECHECK.
//
// VÌ SAO CẦN: thêm một giá trị vào `enum InboxChannel` có ĐÚNG MỘT chỗ được
// typecheck bắt hộ — `NHAN_KENH` là `Record<InboxChannel, string>` nên thiếu nhãn
// là build đỏ. Hai chỗ còn lại KHÔNG được kiểm gì:
//   • `KENH_HOP_LE` là MẢNG ⇒ thiếu giá trị mới thì bộ lọc `?kenh=…` rơi về `null`,
//     Sale bấm lọc mà không lọc được, và KHÔNG có lỗi nào hiện ra;
//   • `PROVIDERS` (`lib/integrations/registry.ts`) là `Partial<Record<…>>` ⇒ thiếu
//     adapter thì mọi lượt gửi rơi vào `khongCoAdapter()`.
// Bộ này canh vế thứ nhất. (Vế `PROVIDERS` thuộc lô adapter, không kiểm ở đây.)
//
// ⚠️ NGUỒN SỰ THẬT LÀ `prisma/schema.prisma`, KHÔNG phải enum runtime của
// `@prisma/client`. Lý do: Prisma Client là mã ĐÃ SINH — giữa lúc sửa schema và lúc
// ai đó chạy `prisma generate`, enum runtime còn là bản cũ, nên một bài kiểm dựa vào
// nó sẽ XANH GIẢ đúng vào lúc cần đỏ (và đỏ giả ngay sau khi thêm giá trị mới).
// Đọc thẳng schema thì lưới này đúng ngay từ commit sửa schema. Nếp đọc-schema đã có
// tiền lệ trong repo: `lib/inbox/cong-truy-cap.test.ts`.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KENH_HOP_LE, NHAN_KENH } from "@/lib/integrations/zalocrm/kenh";

/** Đọc danh sách giá trị của một enum trong schema.prisma (bỏ dòng chú thích `///`). */
function giaTriEnum(ten: string): string[] {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma/schema.prisma"),
    "utf8",
  );
  const i = schema.indexOf(`enum ${ten} {`);
  expect(i, `không thấy enum ${ten} trong schema.prisma`).toBeGreaterThan(-1);
  const than = schema.slice(i, schema.indexOf("\n}", i));
  return than
    .split("\n")
    .slice(1)
    .map((d) => d.trim())
    .filter((d) => /^[A-Z][A-Z0-9_]*$/.test(d));
}

const MOI_KENH = giaTriEnum("InboxChannel");
/** Nhãn tra theo chuỗi thô — `MOI_KENH` là `string[]` đọc từ file, không phải kiểu enum. */
const NHAN_THEO_MA = new Map<string, string>(Object.entries(NHAN_KENH));

describe("danh mục kênh hộp thư", () => {
  it("đọc được enum InboxChannel từ schema (bài kiểm dưới mới có nghĩa)", () => {
    // Regex hỏng thì mọi ca dưới so với mảng RỖNG và xanh hết — chốt lại ở đây.
    expect(MOI_KENH.length).toBeGreaterThanOrEqual(4);
    expect(MOI_KENH).toContain("ZALO_OA");
  });

  it("[ZC-DB-04] KENH_HOP_LE chứa đủ MỌI giá trị của enum InboxChannel", () => {
    const daKhai: readonly string[] = KENH_HOP_LE;
    const thieu = MOI_KENH.filter((c) => !daKhai.includes(c));
    expect(thieu, "thêm giá trị enum thì phải thêm vào KENH_HOP_LE").toEqual([]);
    expect(daKhai).toContain("ZALO_CA_NHAN");
  });

  it("[ZC-DB-04b] KENH_HOP_LE không chứa giá trị lạ, không trùng", () => {
    // Chuỗi lạ trong whitelist là chuỗi đi thẳng vào `where.channel` của Prisma —
    // truy vấn NÉM lúc chạy, không phải "lọc ra rỗng".
    const hopLe = new Set(MOI_KENH);
    const daKhai: readonly string[] = KENH_HOP_LE;
    expect(daKhai.filter((c) => !hopLe.has(c))).toEqual([]);
    expect(daKhai.length).toBe(new Set(daKhai).size);
  });

  it("[ZC-DB-05] NHAN_KENH có nhãn tiếng Việt cho ZALO_CA_NHAN", () => {
    expect(MOI_KENH, "enum chưa có ZALO_CA_NHAN").toContain("ZALO_CA_NHAN");
    expect(NHAN_KENH).toHaveProperty("ZALO_CA_NHAN");
    expect(NHAN_THEO_MA.get("ZALO_CA_NHAN")).toBe("Zalo cá nhân");
  });

  it("[ZC-DB-05b] mọi kênh đều có nhãn KHÔNG rỗng và KHÔNG phải mã enum thô", () => {
    // Nhãn rơi về mã enum ("ZALO_CA_NHAN") là thứ Sale nhìn thấy trên nút lọc.
    for (const c of MOI_KENH) {
      expect(NHAN_THEO_MA.get(c), `thiếu nhãn cho ${c}`).toBeTruthy();
      expect(NHAN_THEO_MA.get(c), `nhãn của ${c} vẫn là mã enum thô`).not.toBe(c);
    }
  });

  it("[ZC-DB-06] hai danh mục không trôi lệch nhau", () => {
    // `KENH_HOP_LE` (bộ lọc phía server) và `NHAN_KENH` (nút lọc phía client) là hai
    // đầu của CÙNG một danh sách. Lệch nhau nghĩa là có nút bấm được nhưng server
    // vứt giá trị đi — hỏng câm, đúng loại khó truy nhất.
    expect([...KENH_HOP_LE].sort()).toEqual(Object.keys(NHAN_KENH).sort());
  });
});
