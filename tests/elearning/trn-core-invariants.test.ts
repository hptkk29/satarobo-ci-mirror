// @vitest-environment node
/**
 * EL-03 — BẤT BIẾN CỦA LÕI `Trn*`. Bốn nhóm, mỗi nhóm khoá một quyết định đã ký.
 *
 * Không nhóm nào ở đây kiểm "mã có chạy không". Chúng kiểm những thứ VẪN XANH khi
 * bị phá: một model rơi khỏi bảng phân loại, một cột đổi từ CREATE TABLE sang
 * ALTER, một cầu bị nới thêm nhánh. Đó là loại hỏng câm mà module này đã trả giá
 * hai lần (US-05 và 114 tài khoản PARENT).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SCOPED_MODELS,
  NULL_IS_GLOBAL_MODELS,
  SCOPE_EXEMPT,
} from "@/lib/db-scope";
import { SOFT_DELETE_MODELS } from "@/lib/soft-delete";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

const ROOT = process.cwd();
const MIGRATION = join(
  ROOT,
  "prisma/migrations/20260821120000_el_add_trn_core/migration.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
/** Bỏ dòng bình luận để không tự bắt chính lời giải thích của mình. */
const sqlCode = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const LOI = [
  "TrnProgram",
  "TrnCourse",
  "TrnCourseVersion",
  "TrnCourseVersionLesson",
  "TrnModule",
  "TrnLesson",
  "TrnRequirement",
  "TrnPolicyAcceptance",
  "TrnEvaluationResult",
];
const KHAI_RONG = ["TrnLessonCue", "TrnEvalLinkConfig", "TrnVideoSession"];

describe("EL-03 · AC1. Migration chỉ-ADD", () => {
  it("tạo đúng 12 bảng: 9 lõi + 3 khai rỗng", () => {
    const tables = [...sqlCode.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([...LOI, ...KHAI_RONG].sort());
  });

  it("0 DROP, và mọi ALTER TABLE đều nhắm vào chính bảng Trn* (thêm FK)", () => {
    expect(sqlCode).not.toMatch(/\bDROP\b/);
    const alters = [...sqlCode.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    const ngoai = alters.filter((t) => !t.startsWith("Trn"));
    // Chạm bảng cũ trong migration này = vướng luật cứng #4. `migrate diff` trên DB
    // dev trả kèm 16 câu KHÔNG thuộc EL-03 (1 DROP COLUMN + 14 đổi kiểu thời gian) —
    // nợ có sẵn của repo. Gộp chúng vào đây là âm thầm đẩy DROP COLUMN của người
    // khác lên prod; case này là chỗ chặn.
    expect(ngoai).toEqual([]);
  });
});

describe("EL-03 · AC20(a)+(c). purgeAfter và ranh giới hai tầng", () => {
  it("(a) purgeAfter NOT NULL nằm NGAY TRONG câu CREATE TABLE của TrnVideoSession", () => {
    const m = sqlCode.match(/CREATE TABLE "TrnVideoSession" \(([\s\S]*?)\);/);
    expect(m, "không tìm thấy CREATE TABLE TrnVideoSession").toBeTruthy();
    expect(m![1]).toMatch(/"purgeAfter"\s+TIMESTAMPTZ\(6\)\s+NOT NULL/);
  });

  it("(a) KHÔNG migration el_* nào thêm purgeAfter bằng ALTER TABLE", () => {
    // Thêm sau = vướng luật cứng #4, và đây là chỗ phát hiện. Quét CẢ THƯ MỤC chứ
    // không riêng migration này: bản vá "quên rồi thêm bù" sẽ nằm ở tệp khác.
    const dir = join(ROOT, "prisma/migrations");
    const els = readdirSync(dir).filter((d) => d.includes("el_"));
    for (const d of els) {
      const s = readFileSync(join(dir, d, "migration.sql"), "utf8");
      expect(s, d).not.toMatch(
        /ALTER TABLE "TrnVideoSession"[\s\S]{0,80}ADD COLUMN "purgeAfter"/,
      );
    }
  });

  it("(c) TrnVideoSession NGOÀI SOFT_DELETE_MODELS — điều kiện để xoá CỨNG được", () => {
    // Bảng có xoá mềm thì "xoá sau 90 ngày" chỉ là đặt một cột deletedAt và dữ liệu
    // thô VẪN NẰM NGUYÊN trong DB — đúng thứ QĐ-CDA-14 không cho phép.
    expect(SOFT_DELETE_MODELS.has("TrnVideoSession")).toBe(false);
  });

  it("(c) TrnVideoSession NGOÀI DUAL_WRITE_MODELS — không mang cột đơn vị", () => {
    expect(DUAL_WRITE_MODELS.has("TrnVideoSession")).toBe(false);
  });

  it("TrnVideoSession thật sự không có cột đơn vị nào trong SQL", () => {
    const m = sqlCode.match(/CREATE TABLE "TrnVideoSession" \(([\s\S]*?)\);/);
    expect(m![1]).not.toContain('"centerId"');
    expect(m![1]).not.toContain('"orgUnitId"');
  });
});

describe("EL-03 · phân loại cách ly — 5 bảng có đủ hai cột đơn vị", () => {
  /** Suy từ chính SQL, không chép tay: chép tay là cách danh sách trôi. */
  const coDuHaiCot = [...sqlCode.matchAll(/CREATE TABLE "(Trn\w+)" \(([\s\S]*?)\);/g)]
    .filter((m) => m[2].includes('"centerId"') && m[2].includes('"orgUnitId"'))
    .map((m) => m[1]);

  it("đúng 5 bảng mang cả centerId và orgUnitId", () => {
    expect(coDuHaiCot.sort()).toEqual(
      [
        "TrnProgram",
        "TrnCourse",
        "TrnRequirement",
        "TrnEvalLinkConfig",
        "TrnEvaluationResult",
      ].sort(),
    );
  });

  it.each(
    [
      "TrnProgram",
      "TrnCourse",
      "TrnRequirement",
      "TrnEvalLinkConfig",
      "TrnEvaluationResult",
    ].map((m) => [m] as const),
  )("%s có mặt trong BACKFILL_SPECS", (model) => {
    // Bảng mới có cột đơn vị mà quên khai ⇒ đối soát đêm LẶNG LẼ bỏ qua bảng đó.
    // Test [US-07-IT-08b] cũng bắt, nhưng nó cần Postgres nên hay bị skip ở local.
    expect(BACKFILL_SPECS.map((s) => s.model)).toContain(model);
  });

  it("4 model vào SCOPED_MODELS; TrnEvalLinkConfig thì KHÔNG", () => {
    for (const m of ["TrnProgram", "TrnCourse", "TrnRequirement", "TrnEvaluationResult"]) {
      expect(SCOPED_MODELS.has(m), m).toBe(true);
    }
    // Bảng con theo chương trình — scope đi theo TrnProgram, không tự lọc.
    expect(SCOPED_MODELS.has("TrnEvalLinkConfig")).toBe(false);
    // ...NHƯNG phải có tên trong SCOPE_EXEMPT. Bất biến [A0-04-T12-01] đòi MỌI model
    // có centerId phải nằm ở một trong hai danh sách — để "không scope" luôn là một
    // quyết định CÓ LÝ DO được viết ra, chứ không phải một lần quên.
    expect(SCOPE_EXEMPT.has("TrnEvalLinkConfig")).toBe(true);
  });

  it("3 model 2c* vào NULL_IS_GLOBAL_MODELS; TrnEvaluationResult thì KHÔNG", () => {
    for (const m of ["TrnProgram", "TrnCourse", "TrnRequirement", "TrnEvalLinkConfig"]) {
      expect(NULL_IS_GLOBAL_MODELS.has(m), m).toBe(true);
    }
    // Với bảng này NULL = dữ liệu CHƯA backfill. Biến "chưa biết cơ sở" thành "ai
    // cũng thấy" là vỡ cách ly — QĐ-CDA-10 cấm đích danh việc né bằng cách này.
    expect(NULL_IS_GLOBAL_MODELS.has("TrnEvaluationResult")).toBe(false);
  });

  it("8 bảng còn lại KHÔNG mang cột đơn vị (bảng con / ngoại lệ nhịp ghi cao)", () => {
    const conLai = [...LOI, ...KHAI_RONG].filter((m) => !coDuHaiCot.includes(m));
    expect(conLai.sort()).toEqual(
      [
        "TrnCourseVersion",
        "TrnCourseVersionLesson",
        "TrnModule",
        "TrnLesson",
        "TrnPolicyAcceptance",
        "TrnLessonCue",
        "TrnVideoSession",
      ].sort(),
    );
  });
});

describe("EL-03 · AC16. Cầu đơn vị KHÔNG được nới thêm nhánh theo `code`", () => {
  const orgService = readFileSync(join(ROOT, "lib/org/org-service.ts"), "utf8");
  const bridge = readFileSync(join(ROOT, "lib/org/center-bridge.ts"), "utf8");

  it("orgUnitIdForCenter() chỉ tra khoá ngoại, KHÔNG khớp theo code", () => {
    const m = orgService.match(
      /export async function orgUnitIdForCenter\([\s\S]*?\n\}/,
    );
    expect(m, "không tìm thấy orgUnitIdForCenter").toBeTruthy();
    const body = m![0];
    expect(body).toContain("centerId");
    // Vì sao null ở đây là hành vi ĐÚNG: với Center("hoi-so") mồ côi, null ép màn
    // nhân sự ném OrgRoleSyncError và buộc admin CHỌN ĐƠN VỊ TAY, thay vì tự neo
    // người Hội sở vào HO ⇒ isHoLevel ⇒ thấy mọi cơ sở (đúng lỗi US-05).
    expect(body).not.toMatch(/\bcode\b/);
  });

  it("cầu theo `code` CHỈ sống trong ORG_UNIT_FOR_CENTER_SQL", () => {
    // Hai đường CỐ Ý khác nhau: đường SQL dùng cho migration backfill và script đối
    // soát (ánh xạ thuần tuý), đường hàm dùng cho neo vai (fail-closed).
    expect(bridge).toContain("ORG_UNIT_FOR_CENTER_SQL");
    const m = bridge.match(/ORG_UNIT_FOR_CENTER_SQL = `([\s\S]*?)`/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('ou2."code" = c."code"');
  });
});

describe("EL-03 · 5 cột chịu lực bổ sung — chỉ-ADD, toàn bộ nullable", () => {
  const SQL2 = readFileSync(
    join(
      ROOT,
      "prisma/migrations/20260821130000_el_trn_consent_and_eval_link_cols/migration.sql",
    ),
    "utf8",
  )
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("TrnEvalLinkConfig có đủ 3 cột đường pháp lý + updatedByUserId", () => {
    // `mode = LINKED` chỉ lưu được khi ĐỦ SÁU thứ, ba trong đó là các cột này.
    // Thiếu chúng thì luật ấy là chữ chết: bật liên kết đánh giá ↔ lương mà không
    // lưu được số hiệu quyết định lẫn người duyệt.
    for (const col of [
      "decisionDocCode",
      "decisionDocEffectiveAt",
      "hrApprovedByUserId",
      "updatedByUserId",
    ]) {
      expect(SQL2, col).toContain(`"${col}"`);
    }
  });

  it("TrnPolicyAcceptance có revokedAt — đường update DUY NHẤT được phép", () => {
    // Rút đồng ý là ĐÓNG dòng đang hiệu lực, không xoá nó: dòng cũ là bằng chứng
    // bất biến rằng người đó đã được thông báo phạm vi nào, vào ngày nào.
    expect(SQL2).toMatch(
      /ALTER TABLE "TrnPolicyAcceptance" ADD COLUMN\s+"revokedAt"/,
    );
  });

  it("mọi cột thêm đều NULLABLE — điều kiện để chỉ-ADD là an toàn", () => {
    // Một `ADD COLUMN ... NOT NULL` không kèm DEFAULT sẽ nổ trên bảng có dữ liệu.
    // Bảng hiện còn rỗng nên nó sẽ đi lọt ở dev và chỉ nổ trên prod.
    expect(SQL2).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
    expect(SQL2).not.toMatch(/\bDROP\b/);
  });
});
