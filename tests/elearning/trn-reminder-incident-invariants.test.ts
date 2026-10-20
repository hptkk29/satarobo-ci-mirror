// @vitest-environment node
/**
 * EL-06 — bất biến của `TrnReminder` + `TrnIncident`.
 *
 * Hai bảng này dễ bị "tối ưu" đi mất theo hai kiểu khác nhau, nên mỗi kiểu có
 * case riêng canh:
 *
 * - `TrnReminder` trông như trùng `EmailQueue` ⇒ ai đó sẽ đề nghị bỏ nó. Nó tồn
 *   tại vì `EmailQueue` KHÔNG có trạng thái "đã huỷ", mà huỷ là vòng đời bắt
 *   buộc ở đây.
 * - `TrnIncident.confirmedByUserId` trông như nên nullable ("chưa biết ai xác
 *   nhận") ⇒ ai đó sẽ nới. Nới là biến vai người trực thành "phòng Đào tạo", tức
 *   một vai không ai nhận.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS } from "@/lib/db-scope";
import { DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

const ROOT = process.cwd();
const THU_MUC = join(ROOT, "prisma", "migrations");
const TEN_MIG = "20260823120000_el_add_trn_reminder_incident";
const SQL = readFileSync(join(THU_MUC, TEN_MIG, "migration.sql"), "utf8");

/** Bỏ dòng chú thích SQL trước khi quét — chú thích cố ý nhắc tên thứ bị cấm. */
const chiSql = SQL.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const truong = (model: string) =>
  new Set(
    (Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? []).map(
      (f) => f.name,
    ),
  );
const field = (model: string, ten: string) =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === model)
    ?.fields.find((f) => f.name === ten);

describe("AC — migration CHỈ ADD", () => {
  it("không có câu DROP nào", () => {
    expect(chiSql).not.toMatch(/\bDROP\b/);
  });

  it("chỉ tạo đúng hai bảng `TrnReminder` và `TrnIncident`", () => {
    const bang = [...chiSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort();
    expect(bang).toEqual(["TrnIncident", "TrnReminder"]);
  });

  it("mọi ALTER TABLE đều nhắm vào chính hai bảng đó", () => {
    for (const m of chiSql.matchAll(/ALTER TABLE "(\w+)"/g)) {
      expect(["TrnReminder", "TrnIncident"], m[1]).toContain(m[1]);
    }
  });

  it("tên migration mang tiền tố `el_` (quy ước 6)", () => {
    expect(TEN_MIG).toMatch(/_el_/);
  });

  it("không migration nào khác cùng đụng hai bảng này", () => {
    // Hai bảng sinh ở ĐÚNG một chỗ. Rải ra nhiều migration thì khi cần đọc lại
    // "bảng này hình thù ra sao" phải ghép từ nhiều mảnh.
    const khac = readdirSync(THU_MUC)
      .filter((n) => n !== TEN_MIG && n !== "migration_lock.toml")
      .filter((n) => {
        try {
          const s = readFileSync(join(THU_MUC, n, "migration.sql"), "utf8");
          return /CREATE TABLE "Trn(Reminder|Incident)"/.test(s);
        } catch {
          return false;
        }
      });
    expect(khac).toEqual([]);
  });
});

describe("`TrnReminder` — vì sao nó không phải bản sao của `EmailQueue`", () => {
  it("có trạng thái CANCELLED, thứ `EmailQueue` không có", () => {
    const st = Prisma.dmmf.datamodel.enums.find((e) => e.name === "TrnReminderStatus");
    expect(st?.values.map((v) => v.name).sort()).toEqual([
      "CANCELLED",
      "PENDING",
      "SENT",
      "SKIPPED",
    ]);
  });

  it("đủ BẢY mốc của §12.2, không thiếu mốc T-2 giờ", () => {
    // Mốc T-2 giờ là mốc mà nhịp NGÀY không phục vụ được — bỏ nó đi thì lịch
    // nhắc còn 6 mốc và không ai nhận ra, vì 6 mốc kia vẫn chạy đúng.
    const ms = Prisma.dmmf.datamodel.enums.find((e) => e.name === "TrnReminderMilestone");
    expect(ms?.values.map((v) => v.name)).toEqual([
      "T0",
      "T_MINUS_5D",
      "T_MINUS_2D",
      "T_MINUS_1D",
      "T_MINUS_2H",
      "T_PLUS_0",
      "T_PLUS_3D",
    ]);
  });

  it("khoá duy nhất (lượt ghi danh × mốc) — chống nhắc trùng", () => {
    expect(chiSql).toMatch(
      /CREATE UNIQUE INDEX "TrnReminder_enrollmentId_milestone_key"/,
    );
  });

  it("có index cho đường cron quét: `(status, scheduledAt)`", () => {
    // Cron chạy mỗi 15 phút. Thiếu index này là quét toàn bảng 96 lần một ngày.
    expect(chiSql).toMatch(/CREATE INDEX "TrnReminder_status_scheduledAt_idx"/);
  });
});

describe("`TrnIncident` — người trực phải CÓ TÊN", () => {
  it("`confirmedByUserId` NOT NULL, không mặc định", () => {
    // Nới thành nullable là biến vai người trực thành "phòng Đào tạo" — một vai
    // không ai nhận. Không có tên người thì không có bản ghi sự cố (QĐ-CDA-15).
    const f = field("TrnIncident", "confirmedByUserId");
    expect(f?.isRequired).toBe(true);
    expect(f?.hasDefaultValue).toBe(false);
  });

  it("`appliedAt` nullable — ghi nhận sự cố KHÁC đã thi hành gia hạn", () => {
    // Gộp hai việc vào một cột là mất khả năng trả lời "đã ghi nhận nhưng chưa
    // xử" — đúng trạng thái mà người trực cần thấy.
    expect(field("TrnIncident", "appliedAt")?.isRequired).toBe(false);
  });

  it("có `appliedCount` để đối chiếu sau, không phải đếm lại", () => {
    expect(truong("TrnIncident").has("appliedCount")).toBe(true);
  });
});

describe("phân loại cách ly — hai bảng CON, không mang cột đơn vị", () => {
  it("không bảng nào có `centerId`/`orgUnitId`", () => {
    // `TrnReminder` scope theo `TrnEnrollment` (bảng cha đã scope). `TrnIncident`
    // là sổ vận hành cấp hệ thống. Thêm cột đơn vị vào đây là dựng đường cách ly
    // thứ hai, lệch với đường thứ nhất lúc nào không biết.
    for (const m of ["TrnReminder", "TrnIncident"]) {
      expect(truong(m).has("centerId"), m).toBe(false);
      expect(truong(m).has("orgUnitId"), m).toBe(false);
    }
  });

  it("không lọt vào ba danh sách cách ly", () => {
    for (const m of ["TrnReminder", "TrnIncident"]) {
      expect(SCOPED_MODELS.has(m), m).toBe(false);
      expect(NULL_IS_GLOBAL_MODELS.has(m), m).toBe(false);
      expect(DUAL_WRITE_MODELS.has(m), m).toBe(false);
    }
  });

  it("`TrnReminder` xoá theo bảng cha (`onDelete: Cascade`)", () => {
    // Lượt ghi danh bị xoá mà lịch nhắc còn lại là nhắc cho một thứ không tồn
    // tại — người học nhận email về khoá họ không có.
    expect(chiSql).toMatch(/TrnReminder_enrollmentId_fkey[\s\S]{0,200}ON DELETE CASCADE/);
  });
});
