// @vitest-environment node
/**
 * EL-04 PR1 — BẤT BIẾN CỦA `TrnLessonProgress` + `TrnDataSubjectRequest`.
 *
 * Bảng tiến độ là bảng NÓNG NHẤT module và là bảng DUY NHẤT cố ý nằm ngoài cả bốn
 * danh sách cách ly. "Cố ý" mà không có test thì lần sau sẽ có người thêm nó vào
 * "cho đủ bộ" — và cái giá là mỗi nhịp heartbeat cõng thêm một truy vấn ghi kép,
 * cộng với việc "xoá bitmap sau 90 ngày" biến thành đặt một cột `deletedAt` trong
 * khi dữ liệu thô vẫn nằm nguyên.
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
import { SOFT_DELETE_MODELS } from "@/lib/soft-delete";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

const ROOT = process.cwd();
const SQL = readFileSync(
  join(ROOT, "prisma/migrations/20260822110000_el_add_trn_progress/migration.sql"),
  "utf8",
)
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const khoi = (b: string) =>
  SQL.match(new RegExp(`CREATE TABLE "${b}" \\(([\\s\\S]*?)\\);`))?.[1] ?? "";

describe("Migration chỉ-ADD", () => {
  it("tạo đúng 2 bảng", () => {
    const t = [...SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(t.sort()).toEqual(["TrnDataSubjectRequest", "TrnLessonProgress"]);
  });

  it("0 DROP, mọi ALTER đều nhắm bảng Trn*", () => {
    expect(SQL).not.toMatch(/\bDROP\b/);
    const ngoai = [...SQL.matchAll(/ALTER TABLE "(\w+)"/g)]
      .map((m) => m[1])
      .filter((t) => !t.startsWith("Trn"));
    expect(ngoai).toEqual([]);
  });
});

describe("segmentBitmap PHẢI nullable — điều kiện để dọn 90 ngày chạy được", () => {
  it("cột khai NULL, không NOT NULL", () => {
    // Cả hai tệp đặc tả đều viết `Bytes` (NOT NULL) ở bảng cột, nhưng bảng phân
    // loại hai tầng lại bắt cron đêm dọn bằng `SET segmentBitmap = NULL`. Khai
    // NOT NULL là khoá chết chính bước dọn mà quyết định đòi — và nó chỉ lộ ra ở
    // lần cron chạy thật, tức 90 ngày sau khi mở.
    expect(khoi("TrnLessonProgress")).toMatch(/"segmentBitmap" BYTEA,/);
    expect(khoi("TrnLessonProgress")).not.toMatch(/"segmentBitmap" BYTEA NOT NULL/);
  });

  it("có bitmapPurgedAt để phân biệt 'chưa từng có' với 'đã dọn'", () => {
    expect(khoi("TrnLessonProgress")).toContain('"bitmapPurgedAt"');
  });
});

describe("TrnLessonProgress nằm NGOÀI cả bốn danh sách — ngoại lệ có tên", () => {
  it("không mang cột đơn vị nào trong SQL", () => {
    expect(khoi("TrnLessonProgress")).not.toContain('"centerId"');
    expect(khoi("TrnLessonProgress")).not.toContain('"orgUnitId"');
  });

  it("ngoài SCOPED_MODELS — không có cột đơn vị để inject", () => {
    expect(SCOPED_MODELS.has("TrnLessonProgress")).toBe(false);
  });

  it("ngoài NULL_IS_GLOBAL_MODELS và ngoài SCOPE_EXEMPT", () => {
    // SCOPE_EXEMPT dành cho model CÓ `centerId` mà cố ý không scope. Bảng này
    // không có cột đó, nên khai vào đấy là nói sai về nó.
    expect(NULL_IS_GLOBAL_MODELS.has("TrnLessonProgress")).toBe(false);
    expect(SCOPE_EXEMPT.has("TrnLessonProgress")).toBe(false);
  });

  it("ngoài BACKFILL_SPECS và DUAL_WRITE_MODELS — đường ghi NÓNG", () => {
    // Ghi kép tra DB ở mỗi lệnh ghi. Cõng nó vào mỗi nhịp heartbeat là trả ngược
    // đúng phần công đã cắt khi gom 9 truy vấn xuống 1.
    expect(BACKFILL_SPECS.map((s) => s.model)).not.toContain("TrnLessonProgress");
    expect(DUAL_WRITE_MODELS.has("TrnLessonProgress")).toBe(false);
  });

  it("ngoài SOFT_DELETE_MODELS — điều kiện để xoá CỨNG bitmap", () => {
    expect(SOFT_DELETE_MODELS.has("TrnLessonProgress")).toBe(false);
  });

  it("và KHÔNG có cột deletedAt trong SQL", () => {
    expect(khoi("TrnLessonProgress")).not.toContain('"deletedAt"');
  });
});

describe("Khoá duy nhất chỉ chặn được trùng nhờ enrollmentId NOT NULL", () => {
  it("enrollmentId là NOT NULL", () => {
    // Nới thành nullable thì Postgres coi hai NULL là KHÁC nhau và
    // `@@unique([enrollmentId, lessonId])` mất tác dụng IM LẶNG — một người đẻ
    // nhiều dòng tiến độ cho cùng một bài. Đây chính là lý do schema EL-05 phải
    // bóc lên chạy trước.
    expect(khoi("TrnLessonProgress")).toMatch(/"enrollmentId" TEXT NOT NULL/);
  });

  it("có khoá duy nhất (enrollmentId, lessonId)", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "TrnLessonProgress_enrollmentId_lessonId_key"/,
    );
  });
});

describe("TrnDataSubjectRequest — dữ liệu cá nhân, cách ly đủ ba điểm", () => {
  it("có centerId + orgUnitId", () => {
    expect(khoi("TrnDataSubjectRequest")).toContain('"centerId"');
    expect(khoi("TrnDataSubjectRequest")).toContain('"orgUnitId"');
  });

  it("vào SCOPED_MODELS + BACKFILL_SPECS + nhánh prefix", () => {
    expect(SCOPED_MODELS.has("TrnDataSubjectRequest")).toBe(true);
    expect(BACKFILL_SPECS.map((s) => s.model)).toContain("TrnDataSubjectRequest");
    expect(getModelPrefixes("TrnDataSubjectRequest")).toEqual(["elearning:"]);
  });

  it("KHÔNG vào NULL_IS_GLOBAL_MODELS — với dữ liệu cá nhân đó là rò rỉ", () => {
    // "Chưa biết cơ sở" biến thành "ai cũng thấy" là rò rỉ dữ liệu cá nhân của
    // người lao động, không phải một tiện lợi vận hành.
    expect(NULL_IS_GLOBAL_MODELS.has("TrnDataSubjectRequest")).toBe(false);
  });

  it("KHÔNG có deletedAt — bản ghi thực thi quyền không được xoá", () => {
    // Xoá được là mất bằng chứng đã tiếp nhận yêu cầu của chủ thể dữ liệu.
    expect(khoi("TrnDataSubjectRequest")).not.toContain('"deletedAt"');
    expect(SOFT_DELETE_MODELS.has("TrnDataSubjectRequest")).toBe(false);
  });
});
