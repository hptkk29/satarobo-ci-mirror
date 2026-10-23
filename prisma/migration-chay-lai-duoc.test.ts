// Ca [MIG-*] — migration MỚI phải CHẠY LẠI ĐƯỢC. Thuần, đọc thư mục migration.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 SỰ CỐ SINH RA LUẬT NÀY [28/09/2026]
//
// Thư mục `20260925100000_order_duyet_so_buoi_hoc_phan` được đổi tên thành
// `20260927100000_…` cho đúng thứ tự so với `origin/test`. DB test đã chạy bản tên CŨ, nên
// bản tên MỚI chạy lại trên một DB đã có sẵn enum + 5 cột ⇒ `CREATE TYPE` chết.
//
// Cái giá KHÔNG dừng ở migration ấy: Prisma ghi một dòng FAILED vào `_prisma_migrations`,
// và từ đó **mọi** `migrate deploy` sau đó bị chặn bằng `P3009` — kể cả migration chẳng
// liên quan gì. Bộ R7 không khởi động được (global-setup gọi `migrate deploy`), và phải
// vào tay xoá dòng sổ mới chạy lại được.
//
// Ở DB test thì rẻ. Đúng kịch bản ấy trên PROD — nơi repo này bắt migration **chạy tay**
// (luật cứng #4), tức có người bấm, có thể ngắt giữa chừng, có thể bấm lại — thì nó khoá
// toàn bộ đường migrate cho tới khi có người vào gỡ.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ VÌ SAO CHỈ ÁP CHO MIGRATION MỚI, KHÔNG QUÉT CẢ KHO
//
// Đo 28/09/2026: **99/130** migration có `ADD COLUMN` trong repo KHÔNG dùng
// `IF NOT EXISTS`. Quét cả kho là đỏ 99 tệp ngay ngày đầu — và sửa chúng thì vi phạm luật
// "migration đã apply → NEVER edit".
//
// Tức idempotent chưa bao giờ là nếp của repo này. Ca này KHÔNG kết tội hồi tố; nó chỉ
// chốt "từ MỐC này trở đi". Mốc là một HẰNG SỐ, không phải đồng hồ (luật 19).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/** Migration có tên (timestamp) TỪ mốc này trở đi mới bị soi. */
const MOC = "20260928000000";

/**
 * MIỄN TRỪ — bốn migration viết SAU mốc nhưng TRƯỚC khi luật này tới được nhánh của
 * người viết [gộp `main`↔`test` ngày 01/10/2026].
 *
 * ── VÌ SAO MIỄN, VÀ VÌ SAO KHÔNG SỬA CHÚNG CHO ĐÚNG ──────────────────────────────────
 * Luật `[MIG-01]` ra đời 28/09 trên một nhánh tính năng và chỉ lên `test` ở lượt gộp
 * 01/10. Bốn migration dưới đây sinh ra trong quãng giữa, trên các nhánh song song chưa
 * hề có lưới này — người viết không bỏ qua luật, họ chưa nhìn thấy nó.
 *
 * Và chúng **KHÔNG SỬA ĐƯỢC NỮA**. Đo trên DB test của VPS ngày 01/10:
 *     20260928150000_role_def_an_menu                 → đã áp
 *     20260929100000_credit_balance_settled_reason    → đã áp
 *     20260929210000_omicall_trial                    → đã áp
 *     20260930100100_hoa_don_misa_cot                 → đã áp
 * Prisma lưu checksum của từng tệp; sửa một migration ĐÃ ÁP là làm lệch checksum và
 * **mọi `migrate deploy` sau đó chết**, ở cả test lẫn prod. Luật repo nói thẳng:
 * "migration đã apply → NEVER edit".
 *
 * ⚠️ RỦI RO CÒN LẠI, biết mà chấp nhận: bốn tệp này không chạy lại được. Nếu lượt migrate
 * trên PROD bị ngắt giữa chừng đúng ở một trong chúng, `_prisma_migrations` giữ một dòng
 * FAILED và chặn mọi lượt sau bằng `P3009` — phải vào gỡ tay. Xác suất thấp (prod migrate
 * chạy trong workflow, một lượt, không ai bấm ngắt) nhưng không phải không.
 *
 * ⚠️ DANH SÁCH NÀY KHÔNG ĐƯỢC DÀI THÊM. Thêm một tên vào đây là nói "luật không áp cho
 * tôi"; đúng cách là viết migration idempotent ngay từ đầu. Nếu bạn định thêm, hãy hỏi
 * trước: migration ấy đã áp ở đâu chưa? Chưa áp thì SỬA nó, đừng miễn.
 */
const MIEN = new Set([
  "20260928150000_role_def_an_menu",
  "20260929100000_credit_balance_settled_reason",
  "20260929210000_omicall_trial",
  "20260930100100_hoa_don_misa_cot",
]);

const GOC = resolve(process.cwd(), "prisma/migrations");

const MOI = existsSync(GOC)
  ? readdirSync(GOC)
      .filter((d) => /^\d{14}_/.test(d) && d.slice(0, 14) >= MOC && !MIEN.has(d))
      .sort()
  : [];

function sql(ten: string): string {
  return readFileSync(join(GOC, ten, "migration.sql"), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*--/.test(d))
    .join("\n");
}

describe("[MIG-01] migration MỚI phải chạy lại được", () => {
  it("bộ lọc theo mốc tìm được ÍT NHẤT một thư mục — lưới không được quét rỗng", () => {
    // ⚠️ Vế cứu cả bộ ca: regex hay đường dẫn hỏng thì `MOI` rỗng, và mọi `it.each` bên
    // dưới BIẾN MẤT (vitest coi mảng rỗng là không có ca) — bộ xanh vì không kiểm gì.
    // Đây đúng bẫy "[DHP-06]/[NTU-W1]" đã ghi: lưới quét rỗng trông y hệt lưới đang làm việc.
    expect(MOI.length).toBeGreaterThanOrEqual(1);
  });

  it.each(MOI)("%s — `ADD COLUMN` nào cũng có `IF NOT EXISTS`", (ten) => {
    const thieu = sql(ten)
      .split(/\r?\n/)
      .filter((d) => /ADD COLUMN/i.test(d) && !/IF NOT EXISTS/i.test(d));
    expect(thieu, `dòng thiếu IF NOT EXISTS trong ${ten}`).toEqual([]);
  });

  it.each(MOI)("%s — `CREATE TYPE` phải bọc `DO $$ … pg_type … $$`", (ten) => {
    // Postgres KHÔNG có `CREATE TYPE IF NOT EXISTS`, nên cách duy nhất là tự hỏi `pg_type`.
    const ma = sql(ten);
    if (!/CREATE TYPE/i.test(ma)) return;
    expect(ma, `${ten} tạo TYPE mà không kiểm pg_type`).toMatch(/pg_type/i);
  });

  it.each(MOI)("%s — `CREATE TABLE`/`CREATE INDEX` cũng có `IF NOT EXISTS`", (ten) => {
    const thieu = sql(ten)
      .split(/\r?\n/)
      .filter(
        (d) => /CREATE (TABLE|UNIQUE INDEX|INDEX)/i.test(d) && !/IF NOT EXISTS/i.test(d),
      );
    expect(thieu, `dòng thiếu IF NOT EXISTS trong ${ten}`).toEqual([]);
  });
});

describe("[MIG-02] danh sách MIỄN TRỪ không được âm thầm phình ra", () => {
  it("đúng BỐN tên, và cả bốn phải tồn tại thật", () => {
    // 🔴 Miễn trừ là cửa duy nhất đi vòng qua `[MIG-01]`. Không khoá nó lại thì lần sau
    // ai viết migration không idempotent chỉ cần thêm một dòng vào `MIEN` là xong — và
    // lưới chết dần mà vẫn xanh, đúng lớp lỗi luật 14 ghi.
    //
    // Khoá SỐ LƯỢNG: thêm tên thứ năm là ca này đỏ, buộc người thêm dừng lại trả lời
    // "migration ấy đã áp ở đâu chưa?". Chưa áp thì SỬA, đừng miễn.
    expect(MIEN.size).toBe(4);
    for (const ten of MIEN) {
      expect(existsSync(join(GOC, ten, "migration.sql")), `${ten} không tồn tại`).toBe(true);
    }
  });

  it("mọi tên trong MIỄN TRỪ đều nằm SAU mốc — miễn một tệp vốn không bị soi là vô nghĩa", () => {
    for (const ten of MIEN) {
      expect(ten.slice(0, 14) >= MOC, `${ten} vốn đã ngoài phạm vi, không cần miễn`).toBe(true);
    }
  });
});
