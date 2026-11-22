// @vitest-environment node
/**
 * MỌI TỆP MIGRATION PHẢI LÀ SQL THUẦN.
 *
 * ⚠️ Guard này sinh ra từ một lỗi thật (EL-14a). Tệp migration được tạo bằng cách
 * chuyển hướng đầu ra của `pnpm exec prisma migrate diff ... > migration.sql`, và
 * lời chào của pnpm (`Already up to date` / `Done in 251ms using pnpm v11.1.1`)
 * lọt vào giữa tệp.
 *
 * Không gì bắt được ở máy: `prisma validate` chỉ đọc schema, `typecheck`/`lint`
 * không đọc `.sql`, và `pnpm build` cũng không. Nó chỉ nổ khi CI chạy
 * `prisma migrate deploy` — với thông báo `syntax error at or near "Already"`,
 * một câu không dẫn về nguyên nhân.
 *
 * ⚠️ Nếu lọt lên `main` thì `deploy.yml` chạy `migrate deploy` NGAY khi merge, và
 * migration hỏng ĐÓNG luôn cả hàng đợi: Prisma từ chối áp mọi migration sau nó cho
 * tới khi có người vào gỡ tay trên DB prod.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const GOC = join(process.cwd(), "prisma", "migrations");

/**
 * Từ mở đầu HỢP LỆ ở cột 0.
 *
 * ⚠️ Đây KHÔNG phải bộ phân tích SQL, và đừng làm nó thành một. Mục đích hẹp: bắt
 * CHỮ KHÔNG PHẢI SQL lọt vào tệp (đầu ra công cụ, thông báo lỗi, ghi chú dán nhầm).
 * Nên danh sách để RỘNG — nó gồm cả từ nối của câu lệnh nhiều dòng (`ADD COLUMN`
 * của Prisma nằm ở cột 0) và từ khoá PL/pgSQL (`EXCEPTION`, `END $$`).
 *
 * Chặt hơn thì guard báo động giả trên 197 dòng hợp lệ của các migration cũ, và
 * cách xử cẩu thả là xoá luôn guard.
 */
const TU_KHOA = [
  // 16/09/2026 (hợp nhất `main`) — bốn từ NỐI của câu SELECT nhiều dòng. Migration
  // `20260829090000_lead_chia_tu_dong` bên `main` xuống dòng ở `LEFT JOIN LATERAL (`,
  // và đó là SQL hợp lệ — danh sách này thiếu chứ không phải tệp sai.
  "LEFT",
  "RIGHT",
  "INNER",
  "JOIN",
  "CREATE",
  "ALTER",
  "DROP",
  "INSERT",
  "UPDATE",
  "DELETE",
  "SELECT",
  "WITH",
  "COMMENT",
  "SET",
  "DO",
  "BEGIN",
  "COMMIT",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "ANALYZE",
  "REFRESH",
  "VACUUM",
  "PREPARE",
  "EXECUTE",
  // Từ nối của câu lệnh nhiều dòng — Prisma sinh chúng ở cột 0.
  "ADD",
  "RENAME",
  "VALUES",
  "FROM",
  "WHERE",
  "USING",
  "ON",
  "AS",
  "CONSTRAINT",
  "COLUMN",
  "DEFAULT",
  "REFERENCES",
  // PL/pgSQL trong khối `DO $$ ... $$`.
  "DECLARE",
  "EXCEPTION",
  "END",
  "IF",
  "ELSE",
  "ELSIF",
  "LOOP",
  "RAISE",
  "RETURN",
  "PERFORM",
  "WHEN",
  "THEN",
  "LANGUAGE",
  "JOIN",
  "RETURNS",
  "STABLE",
  "IMMUTABLE",
  "VOLATILE",
  "SECURITY",
];

function dongLa(sql: string): string[] {
  const ra: string[] = [];
  let trongChuoi = false;
  for (const raw of sql.split("\n")) {
    // Đếm dấu nháy đơn để không bắt nhầm nội dung nằm trong chuỗi nhiều dòng.
    const soNhay = (raw.match(/'/g) ?? []).length;
    const dangTrongChuoi = trongChuoi;
    if (soNhay % 2 === 1) trongChuoi = !trongChuoi;
    if (dangTrongChuoi) continue;

    const l = raw.replace(/\r$/, "");
    if (l.trim() === "") continue;
    // Dòng thụt lề = phần tiếp của câu lệnh trên.
    if (/^\s/.test(l)) continue;
    if (l.startsWith("--")) continue;
    if (/^[)(;"'\]}]/.test(l)) continue;
    // Dấu mở/đóng khối `$$` hay `$mig$` của hàm PL/pgSQL.
    if (/^[$][A-Za-z_]*[$]/.test(l)) continue;

    const dau = l.split(/\s+/)[0]!.toUpperCase();
    if (!TU_KHOA.includes(dau)) ra.push(l);
  }
  return ra;
}

const THU_MUC = existsSync(GOC)
  ? readdirSync(GOC, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

describe("tệp migration là SQL thuần", () => {
  it("có migration để kiểm (guard không được tự vô hiệu)", () => {
    // Một guard duyệt qua mảng rỗng thì luôn xanh và không canh gì cả.
    expect(THU_MUC.length).toBeGreaterThan(50);
  });

  it("không tệp nào chứa dòng KHÔNG PHẢI SQL", () => {
    const hong: string[] = [];
    for (const ten of THU_MUC) {
      const f = join(GOC, ten, "migration.sql");
      if (!existsSync(f)) continue;
      for (const l of dongLa(readFileSync(f, "utf8"))) {
        hong.push(`${ten}: ${l.slice(0, 60)}`);
      }
    }
    expect(hong).toEqual([]);
  });
});

describe("hàm soi bắt được đúng thứ nó nói", () => {
  it("bắt lời chào của pnpm", () => {
    // Chính hai dòng đã lọt vào EL-14a.
    const l = dongLa("-- ok\nCREATE TABLE x ();\nAlready up to date\nDone in 251ms using pnpm v11.1.1\n");
    expect(l).toHaveLength(2);
  });

  it("KHÔNG bắt nhầm SQL bình thường", () => {
    // Vế "đừng chặn nhầm": chú thích tiếng Việt có dấu, dòng thụt lề, dấu đóng
    // ngoặc ở cột 0 — tất cả đều hợp lệ.
    const sql = [
      "-- Chú thích tiếng Việt có dấu, và có cả `dấu nháy đơn` ở đây",
      'CREATE TABLE "A" (',
      '    "id" TEXT NOT NULL,',
      "",
      ");",
      'ALTER TABLE "A" ADD CONSTRAINT "x" FOREIGN KEY ("id") REFERENCES "B"("id");',
      "CREATE INDEX \"i\" ON \"A\"(\"id\");",
    ].join("\n");
    expect(dongLa(sql)).toEqual([]);
  });

  it("KHÔNG bắt nhầm nội dung trong chuỗi nhiều dòng", () => {
    // `INSERT ... VALUES ('nhiều\ndòng')` là SQL hợp lệ, và dòng thứ hai của chuỗi
    // đó nằm ở cột 0 mà không phải từ khoá.
    const sql = "INSERT INTO \"A\" VALUES ('dòng một\nAlready trông như rác nhưng nằm trong chuỗi');";
    expect(dongLa(sql)).toEqual([]);
  });
});
