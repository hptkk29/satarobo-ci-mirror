// @vitest-environment node
/**
 * EL-05 PR0 — BẤT BIẾN CỦA 5 BẢNG GIAO BÀI + GHI DANH.
 *
 * PR này CHỈ SCHEMA: 0 giao diện, 0 bộ giải luật, 0 Server Action. Nên mọi thứ
 * kiểm được ở đây đều là bất biến CẤU TRÚC — và đó chính là loại bất biến hay
 * trôi nhất, vì không màn hình nào vỡ khi nó sai.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCOPED_MODELS,
  NULL_IS_GLOBAL_MODELS,
  SCOPE_EXEMPT,
  getModelPrefixes,
} from "@/lib/db-scope";
import { BACKFILL_SPECS } from "@/lib/org/center-bridge";

const ROOT = process.cwd();
const SQL = readFileSync(
  join(ROOT, "prisma/migrations/20260822090000_el_add_trn_assignment/migration.sql"),
  "utf8",
)
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const BANG = [
  "TrnAssignment",
  "TrnAssignmentRule",
  "TrnAssignmentInclude",
  "TrnAssignmentExclude",
  "TrnEnrollment",
];
/** Hai bảng mang cột đơn vị; ba bảng còn lại là bảng con. */
const CO_DON_VI = ["TrnAssignment", "TrnEnrollment"];

describe("Migration chỉ-ADD", () => {
  it("tạo đúng 5 bảng", () => {
    const t = [...SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(t.sort()).toEqual([...BANG].sort());
  });

  it("0 DROP, mọi ALTER đều nhắm bảng Trn* (thêm FK)", () => {
    expect(SQL).not.toMatch(/\bDROP\b/);
    const ngoai = [...SQL.matchAll(/ALTER TABLE "(\w+)"/g)]
      .map((m) => m[1])
      .filter((t) => !t.startsWith("Trn"));
    expect(ngoai).toEqual([]);
  });

  it("KHÔNG tạo lại hai enum đã có từ EL-03", () => {
    // `CREATE TYPE` lần hai là lỗi `type already exists` — migration đỏ giữa chừng
    // trên prod, và nửa đầu đã chạy rồi.
    expect(SQL).not.toContain('CREATE TYPE "TrnEnrollSource"');
    expect(SQL).not.toContain('CREATE TYPE "TrnEnrollmentStatus"');
    // ...nhưng VẪN dùng chúng — neo dương, để test không xanh vì bảng không tồn tại.
    expect(SQL).toContain('"TrnEnrollSource"');
    expect(SQL).toContain('"TrnEnrollmentStatus"');
  });
});

describe("Cách ly cơ sở — hai bảng mang cột đơn vị", () => {
  it.each(CO_DON_VI)("%s có centerId + orgUnitId trong SQL", (b) => {
    const m = SQL.match(new RegExp(`CREATE TABLE "${b}" \\(([\\s\\S]*?)\\);`));
    expect(m).toBeTruthy();
    expect(m![1]).toContain('"centerId"');
    expect(m![1]).toContain('"orgUnitId"');
  });

  it("TrnEnrollment: centerId và orgUnitId là NOT NULL", () => {
    // Đây là HÀNG RÀO, không phải kiểu dữ liệu cho đẹp: prod 20/08 chỉ 4/15 nhân
    // sự có `centerId`. Cho nullable là mở đường cho một bảng đầy bản ghi VÔ HÌNH
    // với chính cơ sở của người học, vì model này ∈ SCOPED_MODELS.
    const m = SQL.match(/CREATE TABLE "TrnEnrollment" \(([\s\S]*?)\);/);
    expect(m![1]).toMatch(/"centerId" TEXT NOT NULL/);
    expect(m![1]).toMatch(/"orgUnitId" TEXT NOT NULL/);
  });

  it.each(CO_DON_VI)("%s vào SCOPED_MODELS + BACKFILL_SPECS + prefix", (b) => {
    expect(SCOPED_MODELS.has(b)).toBe(true);
    expect(BACKFILL_SPECS.map((s) => s.model)).toContain(b);
    // Thiếu nhánh prefix ⇒ tầm nhìn rơi về `isHoLevel` DIỆN RỘNG: bất kỳ ai có
    // một vai neo tại Hội sở, kể cả vai chẳng liên quan đào tạo, đọc được lượt
    // giao và lượt ghi danh của MỌI cơ sở. Đúng lỗi #04 đã mắc với `Attendance`.
    expect(getModelPrefixes(b)).toEqual(["elearning:"]);
  });

  it.each(CO_DON_VI)("%s KHÔNG vào NULL_IS_GLOBAL_MODELS", (b) => {
    // NULL ở đây = chưa backfill, KHÔNG phải "toàn công ty". Biến nó thành "ai
    // cũng thấy" là vỡ cách ly — QĐ-CDA-10 cấm đích danh cách né này.
    expect(NULL_IS_GLOBAL_MODELS.has(b)).toBe(false);
    expect(SCOPE_EXEMPT.has(b)).toBe(false);
  });

  it("ba bảng con KHÔNG mang cột đơn vị và KHÔNG vào danh sách nào", () => {
    for (const b of ["TrnAssignmentRule", "TrnAssignmentInclude", "TrnAssignmentExclude"]) {
      const m = SQL.match(new RegExp(`CREATE TABLE "${b}" \\(([\\s\\S]*?)\\);`));
      expect(m![1], b).not.toContain('"centerId"');
      expect(m![1], b).not.toContain('"orgUnitId"');
      expect(SCOPED_MODELS.has(b), b).toBe(false);
      expect(BACKFILL_SPECS.map((s) => s.model), b).not.toContain(b);
    }
  });
});

describe("Hai quyết định nghiệp vụ đóng băng trong schema", () => {
  it("allowLate mặc định FALSE — hạn chót cứng có hiệu lực", () => {
    // Mặc định `true` sẽ làm hạn chót thành trang trí, và không ai nhận ra cho tới
    // đợt trễ đầu tiên mà chẳng có gì xảy ra.
    const m = SQL.match(/CREATE TABLE "TrnAssignment" \(([\s\S]*?)\);/);
    expect(m![1]).toMatch(/"allowLate" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("blockSeek mặc định TRUE — chống tua bật sẵn", () => {
    const m = SQL.match(/CREATE TABLE "TrnAssignment" \(([\s\S]*?)\);/);
    expect(m![1]).toMatch(/"blockSeek" BOOLEAN NOT NULL DEFAULT true/);
  });

  it("một người · một khoá · một chu kỳ = đúng một lượt ghi danh", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "TrnEnrollment_courseId_userId_cycle_key"/,
    );
  });

  it("danh sách loại trừ là BẢNG, và `reason` NOT NULL", () => {
    // Loại trừ KHÔNG được hiện thực bằng grant DENY: `can()` v2 là ALLOW-wins
    // thuần, DENY bị bỏ qua IM LẶNG — không chặn được ai, không báo lỗi.
    const m = SQL.match(/CREATE TABLE "TrnAssignmentExclude" \(([\s\S]*?)\);/);
    expect(m![1]).toMatch(/"reason" TEXT NOT NULL/);
  });

  it("dueAtOriginal và dueAt là HAI cột riêng", () => {
    // Gộp một cột là mất mốc bất biến để tính đúng-hạn: gia hạn một người sẽ âm
    // thầm làm họ thành "đúng hạn" trong mọi báo cáo đã chốt.
    const m = SQL.match(/CREATE TABLE "TrnEnrollment" \(([\s\S]*?)\);/);
    expect(m![1]).toContain('"dueAtOriginal"');
    expect(m![1]).toContain('"dueAt"');
  });
});

// ĐÃ GỠ một case ở đây: "PR này không mang giao diện hay action nào", chạy
// `git diff origin/test...HEAD`. Nó xanh ở máy và đỏ ở CI, vì CI checkout không có ref
// `origin/test`. Nhưng lỗi thật sâu hơn một chuyện môi trường: nó kiểm tính chất của
// MỘT PR, không phải tính chất của MÃ. "PR này gồm những file nào" là việc của người
// review, không phải của bộ test — và một test biết về lịch sử git sẽ hỏng mỗi lần
// đổi cách checkout, rebase, hay squash.
