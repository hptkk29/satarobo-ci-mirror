// lib/ai-lead/khai-bao-nen.test.ts — NỀN DỮ LIỆU AI Lead Gateway phải được KHAI ĐỦ mọi chỗ. Thuần, không DB.
//
// Hành vi thật của chỉ mục từng phần (một hồ sơ MỞ mỗi hội thoại × ý định) đo bằng psql trên DB tạm khi viết migration; lưới này chỉ
// bảo đảm khai báo không biến mất — và khẳng định các quyết định mà người sau dễ "dọn" nhầm:
//   · `AiLeadDraft` là bảng DUY NHẤT theo cơ sở (luật 3 CLAUDE.md: giữ CẢ HAI cột, khai ĐỦ BA nơi);
//   · các bảng AiLead* còn lại CỐ Ý không mang centerId/orgUnitId (cấu hình/telemetry toàn hệ) — thêm cột đó vào sẽ im lặng đổi
//     nghĩa của luật cách ly cơ sở;
//   · MỌI bảng mới bật RLS trong migration (khuôn 20260825120000_lead_status_history).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { SCOPED_MODELS, NULL_IS_GLOBAL_MODELS, getModelPrefixes } from "@/lib/db-scope";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";
import { TRANG_THAI_DONG } from "./dich-vu/tinh-ho-so";

// Các migration CHỈ-THÊM của gói (bảng gốc + bảng bộ quy tắc): luật ở dưới áp cho tất cả — thêm bảng AiLead* mới ở migration khác vẫn phải qua cùng các cổng.
const MIGRATIONS = [
  "prisma/migrations/20261108090000_ai_lead_gateway/migration.sql",
  "prisma/migrations/20261110090000_ai_lead_rule_set/migration.sql",
  "prisma/migrations/20261111090000_ai_lead_su_co_mo_lai/migration.sql",
  "prisma/migrations/20261111100000_ai_lead_reject_counter/migration.sql",
  "prisma/migrations/20261112090000_ai_lead_conversation_created_idx/migration.sql",
];
const sql = MIGRATIONS.map((m) => readFileSync(resolve(process.cwd(), m), "utf8")).join("\n");

const modelAiLead = () => Prisma.dmmf.datamodel.models.filter((m) => m.name.startsWith("AiLead"));
const field = (model: string, name: string) =>
  Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.find((f) => f.name === name);

describe("[AIL-SC] AiLeadDraft khai đủ BA chỗ của luật cách ly cơ sở (CLAUDE.md luật 3)", () => {
  it("[AIL-SC-01] ∈ SCOPED_MODELS, KHÔNG ∈ NULL_IS_GLOBAL_MODELS (dữ liệu cá nhân: NULL ≠ ai cũng thấy)", () => {
    expect(SCOPED_MODELS.has("AiLeadDraft")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("AiLeadDraft")).toBe(false);
  });
  it("[AIL-SC-02] có prefix riêng `ai-leads:` (thiếu ⇒ rơi về `isHoLevel ? ALL` — vai Hội sở bất kỳ đọc hồ sơ mọi cơ sở)", () => {
    expect(getModelPrefixes("AiLeadDraft")).toEqual(["ai-leads:"]);
  });
  it("[AIL-SC-03] BACKFILL_SPECS đúng MỘT mục, scoped=true, NULL = chưa khớp (KHÔNG phải toàn hệ thống), ghi kép orgUnitId tự chạy", () => {
    const spec = BACKFILL_SPECS.filter((s) => s.model === "AiLeadDraft");
    expect(spec).toHaveLength(1);
    expect(spec[0]!.scoped).toBe(true);
    expect(spec[0]!.nullMeaning).toBe("NULL_CHUA_KHOP");
    expect(DUAL_WRITE_MODELS.has("AiLeadDraft")).toBe(true);
  });
  it("[AIL-SC-04] có CẢ centerId lẫn orgUnitId, cả hai NULL được (chưa biết cơ sở là trạng thái hợp lệ)", () => {
    expect(field("AiLeadDraft", "centerId")?.isRequired).toBe(false);
    expect(field("AiLeadDraft", "orgUnitId")?.isRequired).toBe(false);
  });
});

describe("[AIL-NO] các bảng AiLead* còn lại CỐ Ý không theo cơ sở", () => {
  const khac = () => modelAiLead().filter((m) => m.name !== "AiLeadDraft");

  it("[AIL-NO-01] có đủ 13 bảng AiLead* (thiếu một bảng = migration và schema lệch nhau)", () => {
    expect(modelAiLead().map((m) => m.name).sort()).toEqual(
      [
        "AiLeadAgent", "AiLeadAgentPage", "AiLeadCampusPublication", "AiLeadCatalogSnapshot", "AiLeadConversation",
        "AiLeadDraft", "AiLeadIncident", "AiLeadNonce", "AiLeadProbe", "AiLeadRejectCounter", "AiLeadRequest", "AiLeadRuleSet", "AiLeadVerificationRun",
      ].sort(),
    );
  });
  it("[AIL-NO-02] không bảng nào khác có cột centerId/orgUnitId — nếu có thì phải khai đủ ba nơi như AiLeadDraft", () => {
    for (const m of khac()) {
      const co = m.fields.filter((f) => f.name === "centerId" || f.name === "orgUnitId").map((f) => f.name);
      expect(co, `${m.name} mang cột cơ sở`).toEqual([]);
    }
  });
  it("[AIL-NO-03] không bảng nào khác lọt vào SCOPED_MODELS hay BACKFILL_SPECS", () => {
    for (const m of khac()) {
      expect(SCOPED_MODELS.has(m.name), `${m.name} ∈ SCOPED_MODELS`).toBe(false);
      expect(BACKFILL_SPECS.some((s) => s.model === m.name), `${m.name} ∈ BACKFILL_SPECS`).toBe(false);
    }
  });
  it("[AIL-NO-04] cột cơ sở xuất bản của catalog tên `campusCenterId` (KHÔNG `centerId`) — đổi tên là kích hoạt luật cách ly cho cấu hình do HO giữ", () => {
    expect(field("AiLeadCampusPublication", "campusCenterId")).toBeTruthy();
    expect(field("AiLeadCampusPublication", "centerId")).toBeUndefined();
  });
});

describe("[AIL-MIG] migration 20261108090000_ai_lead_gateway", () => {
  it("[AIL-MIG-01] MỌI bảng AiLead* trong schema đều có CREATE TABLE IF NOT EXISTS và ENABLE ROW LEVEL SECURITY", () => {
    for (const m of modelAiLead()) {
      expect(sql, `thiếu CREATE TABLE ${m.name}`).toContain(`CREATE TABLE IF NOT EXISTS "${m.name}"`);
      expect(sql, `thiếu RLS ${m.name}`).toContain(`ALTER TABLE "${m.name}" ENABLE ROW LEVEL SECURITY;`);
    }
  });
  it("[AIL-MIG-02] không bảng nào FORCE RLS / ALTER bảng cũ / DROP — migration chỉ THÊM (luật cứng #4)", () => {
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i);
    const alter = [...sql.matchAll(/ALTER TABLE "([A-Za-z]+)"/g)].map((x) => x[1]!);
    for (const t of alter) expect(t.startsWith("AiLead"), `ALTER bảng ngoài module: ${t}`).toBe(true);
  });
  it("[AIL-MIG-03] mọi enum tạo trong DO-block có kiểm pg_type (chạy lại được — [MIG-01])", () => {
    const tao = [...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((x) => x[1]!);
    expect(tao.length).toBeGreaterThan(0);
    for (const t of tao) expect(sql).toContain(`typname = '${t}'`);
  });
  it("[AIL-MIG-04] chỉ mục TỪNG PHẦN gác 'một hồ sơ MỞ mỗi (hội thoại, ý định)' và loại ĐÚNG tập TRANG_THAI_DONG của mã (4 trạng thái)", () => {
    const m = sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS "AiLeadDraft_conversationId_intent_open_key"\s+ON "AiLeadDraft"\("conversationId", "intent"\)\s+WHERE "state" NOT IN \(([^)]*)\)/);
    expect(m, "mất chỉ mục từng phần").not.toBeNull();
    // Lệch giữa vế `NOT IN (…)` của SQL và hằng của mã = intake tìm "hồ sơ mở" khác với cái chỉ mục gác (nuốt yêu cầu hoặc vi phạm khoá duy nhất).
    expect(m![1]!.split(",").map((x) => x.trim().replace(/'/g, "")).sort()).toEqual([...TRANG_THAI_DONG].sort());
    expect(TRANG_THAI_DONG).toContain("ASSIGNMENT_PENDING");
  });
  it("[AIL-MIG-05] tên migration lớn hơn mọi migration đứng trước khi tạo (kiểm tay lúc viết; ca này chỉ ghim tên thư mục)", () => {
    expect(MIGRATIONS[0]).toMatch(/^prisma\/migrations\/\d{14}_ai_lead_gateway\/migration\.sql$/);
    expect(MIGRATIONS[1]).toMatch(/^prisma\/migrations\/\d{14}_ai_lead_rule_set\/migration\.sql$/);
    expect(MIGRATIONS[2]).toMatch(/^prisma\/migrations\/\d{14}_ai_lead_su_co_mo_lai\/migration\.sql$/);
    expect(MIGRATIONS[3]).toMatch(/^prisma\/migrations\/\d{14}_ai_lead_reject_counter\/migration\.sql$/);
    const ten = MIGRATIONS.map((m) => m.split("/")[2]!);
    expect([...ten].sort()).toEqual(ten); // thứ tự khai = thứ tự chạy (tên thư mục tăng dần)
  });
});

describe("[AIL-MIG-06] chỉ mục", () => {
  it("[AIL-MIG-06] migration chỉ mục đếm cuộc trò chuyện: IF NOT EXISTS, tên theo quy ước Prisma, khớp @@index của schema, không ALTER/DROP", () => {
    const m = readFileSync(resolve(process.cwd(), MIGRATIONS[4]!), "utf8");
    expect(m).toMatch(/CREATE INDEX IF NOT EXISTS "AiLeadConversation_agentId_createdAt_idx" ON "AiLeadConversation"\("agentId", "createdAt"\);/);
    expect(m).not.toMatch(/\b(DROP|ALTER)\b/i);
    // Cắt ĐÚNG khối `model AiLeadConversation { … }` (tới dấu `}` đầu dòng kế tiếp) rồi mới tìm chỉ mục — regex lười chạy qua ranh giới model có thể khớp @@index của model khác.
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
    const dau = schema.indexOf("model AiLeadConversation {");
    expect(dau, "không thấy model AiLeadConversation").toBeGreaterThan(-1);
    const khoi = schema.slice(dau, schema.indexOf("\n}\n", dau));
    expect(khoi).toMatch(/@@index\(\[agentId, createdAt\]\)/);
    expect(khoi, "cột createdAt có trong model").toMatch(/\n\s+createdAt\s+DateTime/);
  });
});

describe("[AIL-RC] AiLeadRejectCounter — bộ đếm từ chối RIÊNG TƯ theo thiết kế (không cột nào chứa được dữ liệu của kẻ gọi)", () => {
  it("[AIL-RC-01] đúng bảy cột {day, endpoint, code, agentId, count, firstAt, lastAt} — thêm cột (IP/header/thân/chữ ký…) phải sửa ca này và duyệt lại quyền riêng tư", () => {
    const m = modelAiLead().find((x) => x.name === "AiLeadRejectCounter")!;
    expect(m.fields.map((f) => f.name).sort()).toEqual(["agentId", "code", "count", "day", "endpoint", "firstAt", "lastAt"]);
    expect(m.fields.every((f) => f.kind === "scalar")).toBe(true); // không quan hệ (không FK tới Agent — agentId trống khi chưa xác thực)
  });
  it("[AIL-RC-02] khoá chính ghép (day, endpoint, code, agentId) ⇒ độ lớn bị chặn bởi tập giá trị, không bởi lưu lượng", () => {
    expect(sql).toMatch(/CONSTRAINT "AiLeadRejectCounter_pkey" PRIMARY KEY \("day", "endpoint", "code", "agentId"\)/);
  });
});
