// @vitest-environment node
/**
 * EL-08 — bất biến của `TrnTrainingNeed`.
 *
 * Bảng này sinh ra để thi hành MỘT câu luật: §8.1 *"không được tạo chương trình
 * nếu không gắn phiếu nhu cầu đã duyệt"*. Nếu bảng tồn tại mà luật không được
 * thi hành thì nó chỉ là một cái form không ai bắt buộc điền — nên phần lớn case
 * ở đây canh chính mối nối đó.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS } from "@/lib/db-scope";
import { DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

const ROOT = process.cwd();
const THU_MUC = join(ROOT, "prisma", "migrations");
const TEN_MIG = "20260823160000_el_add_trn_training_need";
const SQL = readFileSync(join(THU_MUC, TEN_MIG, "migration.sql"), "utf8");
const chiSql = SQL.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const model = (ten: string) =>
  Prisma.dmmf.datamodel.models.find((m) => m.name === ten);
const field = (m: string, f: string) => model(m)?.fields.find((x) => x.name === f);

describe("migration CHỈ ADD", () => {
  it("không có câu DROP nào", () => {
    expect(chiSql).not.toMatch(/\bDROP\b/);
  });

  it("chỉ tạo đúng bảng `TrnTrainingNeed`", () => {
    const bang = [...chiSql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(bang).toEqual(["TrnTrainingNeed"]);
  });

  it("chỉ đụng `TrnProgram` để THÊM khoá ngoại, không đổi cột", () => {
    for (const m of chiSql.matchAll(/ALTER TABLE "TrnProgram"[\s\S]*?;/g)) {
      expect(m[0]).toContain("ADD CONSTRAINT");
      expect(m[0]).not.toMatch(/ALTER COLUMN|ADD COLUMN/);
    }
  });

  it("bảng sinh ở ĐÚNG một migration", () => {
    const khac = readdirSync(THU_MUC)
      .filter((n) => n !== TEN_MIG && n !== "migration_lock.toml")
      .filter((n) => {
        try {
          return /CREATE TABLE "TrnTrainingNeed"/.test(
            readFileSync(join(THU_MUC, n, "migration.sql"), "utf8"),
          );
        } catch {
          return false;
        }
      });
    expect(khac).toEqual([]);
  });
});

describe("xoá phiếu KHÔNG được kéo theo chương trình", () => {
  it("khoá ngoại dùng `ON DELETE SET NULL`, không `CASCADE`", () => {
    // Chương trình là thứ CÓ NGƯỜI ĐANG HỌC. Xoá một cái phiếu đề nghị mà kéo
    // theo cả chương trình là mất dữ liệu thật vì một thao tác dọn dẹp.
    const fk = /TrnProgram_needId_fkey[\s\S]{0,220}/.exec(chiSql)?.[0] ?? "";
    expect(fk).toContain("ON DELETE SET NULL");
    expect(fk).not.toContain("ON DELETE CASCADE");
  });
});

describe("đúng HAI trạng thái, không hơn", () => {
  it("enum chỉ có NEW và APPROVED", () => {
    // Thêm trạng thái thứ ba ("đang xem xét", "trả lại") nghe hợp lý nhưng mỗi
    // giá trị mới là một nhánh phải nhớ ở mọi câu truy vấn về sau, đổi lấy một
    // thông tin mà ô lý do đã nói được.
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === "TrnTrainingNeedStatus");
    expect(e?.values.map((v) => v.name)).toEqual(["NEW", "APPROVED"]);
  });
});

describe("các cột chịu lực", () => {
  it("`code` là duy nhất", () => {
    expect(chiSql).toMatch(/CREATE UNIQUE INDEX "TrnTrainingNeed_code_key"/);
  });

  it("người đề nghị BẮT BUỘC, người duyệt thì không", () => {
    // Phiếu luôn có người đề nghị; người duyệt chỉ có sau khi duyệt.
    expect(field("TrnTrainingNeed", "requesterUserId")?.isRequired).toBe(true);
    expect(field("TrnTrainingNeed", "approvedByUserId")?.isRequired).toBe(false);
    expect(field("TrnTrainingNeed", "approvedAt")?.isRequired).toBe(false);
  });

  it("`proposedQuarter` là chuỗi, KHÔNG phải ngày", () => {
    // Đây là dự kiến ở mức QUÝ. Ép thành ngày cụ thể là bịa ra một độ chính xác
    // không có thật, rồi mọi báo cáo sau đó tin vào nó.
    expect(field("TrnTrainingNeed", "proposedQuarter")?.type).toBe("String");
  });

  it("có index cho màn duyệt: `(status, createdAt)`", () => {
    expect(chiSql).toMatch(/CREATE INDEX "TrnTrainingNeed_status_createdAt_idx"/);
  });
});

describe("phân loại cách ly — khai ĐỦ BỐN chỗ, không chỗ nào lẻ", () => {
  it("vừa SCOPED vừa NULL_IS_GLOBAL, cùng ngữ nghĩa với TrnProgram", () => {
    // ⚠️ Hai danh sách này phải đi CÙNG NHAU. Khai SCOPED mà quên NULL_IS_GLOBAL
    // thì phiếu nhu cầu TOÀN CÔNG TY (centerId null) tàng hình với mọi người cấp
    // cơ sở — họ không thấy để gắn vào chương trình của mình.
    expect(SCOPED_MODELS.has("TrnTrainingNeed")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("TrnTrainingNeed")).toBe(true);
  });

  it("có khai trong BACKFILL_SPECS ⇒ vào DUAL_WRITE_MODELS", () => {
    // Bảng mang CẢ HAI cột đơn vị mà không khai ở đây thì cron đối soát đêm
    // không biết nó tồn tại, và lệch centerId/orgUnitId trôi im lặng.
    expect(DUAL_WRITE_MODELS.has("TrnTrainingNeed")).toBe(true);
  });

  it("có nhánh riêng trong getModelPrefixes", () => {
    // Thiếu nhánh thì hàm trả mảng rỗng và tầm nhìn rơi về fallback `isHoLevel`
    // DIỆN RỘNG — đúng lỗi #04 đã mắc với `Attendance`.
    const src = readFileSync(join(ROOT, "lib", "db-scope.ts"), "utf8");
    expect(src).toContain('case "TrnTrainingNeed":');
  });
});

describe("mối nối với luật §8.1 phải còn sống", () => {
  const SRC = readFileSync(
    join(ROOT, "lib", "elearning", "program-create.ts"),
    "utf8",
  );

  it("action tạo chương trình có gọi hàm kiểm phiếu nhu cầu", () => {
    // Bảng tồn tại mà không ai kiểm thì nó chỉ là một cái form không bắt buộc.
    expect(SRC).toContain("kiemGanPhieuNhuCau");
  });

  it("có tra trạng thái phiếu, không chỉ tra sự tồn tại", () => {
    expect(SRC).toContain("status: true");
    expect(SRC).toContain("needStatus");
  });
});
