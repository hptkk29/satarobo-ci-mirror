// lib/ai-lead/hop-dong.test.ts — HẰNG của hợp đồng AI Lead phải KHỚP tệp YAML hợp đồng (bản sao ở tests/fixtures/ai-lead/). Thuần, không DB.
//
// Mã ca: [AIL-HD-01..09] · [AIL-KT-01] (enum Prisma) · [AIL-FX-00..03] (bản sao fixture/YAML).
// Hợp đồng là NGUỒN; tệp hop-dong.ts là bản chép bằng tay ⇒ hai bản trôi khỏi nhau là lỗi CÂM (Agent đã build theo YAML). Lưới này so từng hằng.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import {
  AN_TOAN_CUNG,
  CAPABILITIES,
  DANH_TINH_FIXTURE,
  DETAIL_CODES,
  DUONG_DAN,
  FB_NAME_SOURCES,
  HANDOFF_REASONS,
  HANH_DONG_HANDOFF,
  HANH_DONG_LEAD_INTAKE,
  INCIDENT_CATEGORIES,
  INTENTS,
  MAC_DINH_CAI_DAT,
  MA_LOI,
  MA_LOI_CO_RETRY_AFTER,
  MOI_TRUONG,
  NHOM_HAN_MUC,
  OWNER_MODE,
  RE,
  SEVERITIES,
  THU_TU_KIEM,
  TRANG_THAI_CONTRACT,
  TRANG_THAI_HANDOFF,
  TRANG_THAI_LEAD_INTAKE,
  TRANG_THAI_PAGE,
  dungLinkHoiThoai,
  kiemMauLinkHoiThoai,
  laDanhTinhFixture,
} from "./hop-dong";
import { SETTINGS } from "@/lib/settings/registry";
import {
  DUONG_FIXTURE_GOC_DOCS,
  DUONG_YAML_GOC_DOCS,
  coBanGocDocs,
  docYaml,
  enumDauTien,
  khoiYaml,
  nguonRegex,
  patternDauTien,
  tatCaFixture,
} from "./ho-tro-test";

const yaml = docYaml();
const sauKhoa = (van: string, khoa: string) => {
  const i = van.indexOf(`${khoa}:`);
  if (i < 0) throw new Error(`Không thấy khoá ${khoa}`);
  return van.slice(i);
};
const patternSauKhoa = (van: string, khoa: string) => patternDauTien(sauKhoa(van, khoa));
const enumSauKhoa = (van: string, khoa: string) => enumDauTien(sauKhoa(van, khoa));

describe("[AIL-FX] bản sao hợp đồng + fixture ở tests/fixtures/ai-lead", () => {
  it("[AIL-FX-00] trích được các khối YAML cần so (đỏ ngay nếu YAML đổi layout — thà đỏ còn hơn xanh nhầm)", () => {
    for (const k of ["PageId", "Psid", "MetaMessageId", "IdempotencyKey", "Receipt", "Conversation", "LeadIntakeRequest", "IncidentRequest", "HeartbeatRequest", "ErrorCode", "HandoffReason", "AgentId", "Ts", "Nonce", "Sig", "Meta", "CatalogCampus"]) {
      expect(khoiYaml(yaml, k).length, k).toBeGreaterThan(10);
    }
  });

  it("[AIL-FX-01] có đủ fixture: 41 tệp đánh số + hmac-vectors (không rỗng — các ca lặp theo fixture không được xanh vì rỗng)", () => {
    expect(tatCaFixture().length).toBe(41);
  });

  it("[AIL-FX-02] contractHash (LF-chuẩn hoá) của bản sao ghim ở giá trị đã bàn giao — đổi hợp đồng là phải đổi có chủ đích", () => {
    const h = createHash("sha256").update(yaml.replace(/\r/g, "")).digest("hex");
    expect(h).toMatch(RE.contractHash);
    expect(h).toBe("4ef577350f70ea54c9eaa19bc2d49c0ba0577595bbd517f83b0914aed3bccaa5");
  });

  it.skipIf(!coBanGocDocs())("[AIL-FX-03] bản sao KHỚP bản gốc trong docs/ (CI gương không có docs/ ⇒ tự bỏ qua)", () => {
    const chuan = (b: string) => b.replace(/\r/g, "");
    expect(chuan(yaml)).toBe(chuan(readFileSync(DUONG_YAML_GOC_DOCS, "utf8")));
    for (const f of tatCaFixture()) {
      expect(chuan(readFileSync(join(DUONG_FIXTURE_GOC_DOCS, f.tep), "utf8")), f.tep).toBe(chuan(readFileSync(join(process.cwd(), "tests/fixtures/ai-lead/request-response-fixtures", f.tep), "utf8")));
    }
    expect(chuan(readFileSync(join(DUONG_FIXTURE_GOC_DOCS, "hmac-vectors.json"), "utf8"))).toBe(
      chuan(readFileSync(join(process.cwd(), "tests/fixtures/ai-lead/request-response-fixtures/hmac-vectors.json"), "utf8")),
    );
  });
});

describe("[AIL-HD-01] danh sách ĐÓNG khớp YAML", () => {
  const cung = (a: readonly string[], b: readonly string[], ten: string) => expect([...a].sort(), ten).toEqual([...b].sort());
  it("intent · fbNameSource · handoff reason · category · severity · detailCode (16) · capabilities · môi trường · contractStatus · page state", () => {
    cung(INTENTS, enumDauTien(khoiYaml(yaml, "Intent")), "Intent");
    cung(FB_NAME_SOURCES, enumSauKhoa(khoiYaml(yaml, "Conversation"), "fbNameSource"), "fbNameSource");
    cung(HANDOFF_REASONS, enumDauTien(khoiYaml(yaml, "HandoffReason")), "HandoffReason");
    const inc = khoiYaml(yaml, "IncidentRequest");
    cung(INCIDENT_CATEGORIES, enumDauTien(sauKhoa(inc, "category")), "category");
    cung(SEVERITIES, enumSauKhoa(inc, "severity"), "severity");
    cung(DETAIL_CODES, enumDauTien(sauKhoa(inc, "detailCode")), "detailCode");
    expect(DETAIL_CODES).toHaveLength(16);
    cung(CAPABILITIES, enumSauKhoa(khoiYaml(yaml, "HeartbeatRequest"), "capabilities"), "capabilities");
    cung(MOI_TRUONG, enumDauTien(khoiYaml(yaml, "Environment")), "Environment");
    const hbResp = khoiYaml(yaml, "HeartbeatResponse");
    cung(TRANG_THAI_CONTRACT, enumSauKhoa(hbResp, "contractStatus"), "contractStatus");
    cung(TRANG_THAI_PAGE, enumSauKhoa(sauKhoa(hbResp, "pages"), "state"), "page state");
  });
  it("trạng thái + hành động của /lead-intakes và /handoffs", () => {
    cung(TRANG_THAI_LEAD_INTAKE, enumDauTien(khoiYaml(yaml, "LeadIntakeStatus")), "status");
    cung(HANH_DONG_LEAD_INTAKE, enumDauTien(khoiYaml(yaml, "LeadIntakeNextAction")), "nextAction");
    const hr = khoiYaml(yaml, "HandoffResponse");
    cung(TRANG_THAI_HANDOFF, enumSauKhoa(hr, "handoffStatus"), "handoffStatus");
    cung(OWNER_MODE, enumSauKhoa(hr, "ownerMode"), "ownerMode");
    cung(HANH_DONG_HANDOFF, enumSauKhoa(hr, "nextAction"), "handoff nextAction");
  });
  it("18 mã lỗi = ErrorCode của YAML", () => {
    expect(Object.keys(MA_LOI).sort()).toEqual(enumDauTien(khoiYaml(yaml, "ErrorCode")).sort());
    expect(Object.keys(MA_LOI)).toHaveLength(18);
  });
});

describe("[AIL-HD-02] biểu thức chính quy khớp từng chữ với YAML", () => {
  const khop = (re: RegExp, pattern: string, ten: string) => expect(nguonRegex(re), ten).toBe(pattern);
  it("header", () => {
    khop(RE.agentId, patternDauTien(khoiYaml(yaml, "AgentId")), "agentId");
    khop(RE.ts, patternDauTien(khoiYaml(yaml, "Ts")), "ts");
    khop(RE.nonce, patternDauTien(khoiYaml(yaml, "Nonce")), "nonce");
    khop(RE.sig, patternDauTien(khoiYaml(yaml, "Sig")), "sig");
  });
  it("định danh + khung", () => {
    khop(RE.pageId, patternDauTien(khoiYaml(yaml, "PageId")), "pageId");
    khop(RE.psid, patternDauTien(khoiYaml(yaml, "Psid")), "psid");
    khop(RE.mid, patternDauTien(khoiYaml(yaml, "MetaMessageId")), "mid");
    khop(RE.idempotencyKey, patternDauTien(khoiYaml(yaml, "IdempotencyKey")), "idempotencyKey");
    khop(RE.receipt, patternDauTien(khoiYaml(yaml, "Receipt")), "receipt");
    khop(RE.requestId, patternSauKhoa(khoiYaml(yaml, "Meta"), "requestId"), "requestId");
    khop(RE.campusCode, patternSauKhoa(khoiYaml(yaml, "CatalogCampus"), "campusCode"), "campusCode");
  });
  it("trường của hội thoại / hồ sơ", () => {
    const conv = khoiYaml(yaml, "Conversation");
    khop(RE.fbName, patternSauKhoa(conv, "fbName"), "fbName");
    khop(RE.inboxThreadId, patternSauKhoa(conv, "inboxThreadId"), "inboxThreadId");
    const li = khoiYaml(yaml, "LeadIntakeRequest");
    khop(RE.phoneRaw, patternSauKhoa(li, "phoneRaw"), "phoneRaw");
    khop(RE.testRunId, patternSauKhoa(li, "testRunId"), "testRunId");
  });
  it("heartbeat + incident", () => {
    const hb = khoiYaml(yaml, "HeartbeatRequest");
    khop(RE.agentVersion, patternSauKhoa(hb, "agentVersion"), "agentVersion");
    khop(RE.buildSha, patternSauKhoa(hb, "buildSha"), "buildSha");
    khop(RE.contractHash, patternSauKhoa(hb, "contractHash"), "contractHash");
    khop(RE.probeId, patternSauKhoa(hb, "probeId"), "probeId");
    khop(RE.correlationId, patternSauKhoa(khoiYaml(yaml, "IncidentRequest"), "correlationId"), "correlationId");
  });
});

describe("[AIL-HD-03] bảng 18 mã lỗi: HTTP + thông điệp", () => {
  // Nguồn: error-codes.md §2 (cột HTTP). Gõ lại ở đây CHỦ ĐÍCH — đổi status của một mã phải sửa cả hai nơi.
  const HTTP: Record<string, number> = {
    BAD_REQUEST: 400, UNSUPPORTED_CONTRACT: 400, PAYLOAD_INVALID: 400, BODY_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
    BAD_SIGNATURE: 401, CLOCK_SKEW: 401, NONCE_REUSED: 401, AGENT_DISABLED: 401, PAGE_NOT_ALLOWED: 403, PAGE_PAUSED: 403,
    ENVIRONMENT_MISMATCH: 403, TEST_ONLY_FIELD: 400, IDEMPOTENCY_CONFLICT: 409, RATE_LIMITED: 429, NOT_CONFIGURED: 503,
    TEMP_UNAVAILABLE: 503, INTERNAL_ERROR: 500,
  };
  it("mỗi mã có HTTP đúng bảng", () => {
    for (const [ma, v] of Object.entries(MA_LOI)) expect(v.status, ma).toBe(HTTP[ma]);
  });
  it("thông điệp tiếng Việt, ≤ 300 ký tự, không rỗng", () => {
    for (const [ma, v] of Object.entries(MA_LOI)) {
      expect(v.message.length, ma).toBeGreaterThan(5);
      expect(v.message.length, ma).toBeLessThanOrEqual(300);
    }
  });
  it("chỉ RATE_LIMITED và TEMP_UNAVAILABLE có Retry-After", () => {
    expect([...MA_LOI_CO_RETRY_AFTER].sort()).toEqual(["RATE_LIMITED", "TEMP_UNAVAILABLE"]);
  });
  it("[AIL-HD-04] thông điệp KHỚP từng fixture lỗi 90–99 (và 80–89 cho PAYLOAD_INVALID)", () => {
    const loi = tatCaFixture().filter((f) => /^(8\d|9\d)-/.test(f.tep) && (f.response.body as { ok: boolean }).ok === false);
    expect(loi.length).toBeGreaterThanOrEqual(20);
    for (const f of loi) {
      const e = (f.response.body as { error: { code: keyof typeof MA_LOI; message: string } }).error;
      expect(f.response.status, f.tep).toBe(MA_LOI[e.code].status);
      expect(e.message, f.tep).toBe(MA_LOI[e.code].message);
    }
  });
});

describe("[AIL-HD-05] thứ tự server kiểm (error-codes.md §3)", () => {
  it("bước tăng dần, đúng 20 hàng, đúng dãy mã", () => {
    const buoc = THU_TU_KIEM.map((x) => x.buoc);
    expect([...buoc].sort((a, b) => a - b)).toEqual(buoc);
    expect(THU_TU_KIEM.map((x) => `${x.buoc}:${x.ma}`)).toEqual([
      "1:NOT_CONFIGURED", "2:UNSUPPORTED_CONTRACT", "3:BAD_REQUEST", "4:BODY_TOO_LARGE", "5:UNSUPPORTED_MEDIA_TYPE", "6:BAD_SIGNATURE",
      "7:CLOCK_SKEW", "8:AGENT_DISABLED", "9:RATE_LIMITED", "10:NONCE_REUSED", "11:PAYLOAD_INVALID", "12:ENVIRONMENT_MISMATCH",
      "13:TEST_ONLY_FIELD", "14:PAGE_NOT_ALLOWED", "14:PAGE_PAUSED", "15:UNSUPPORTED_CONTRACT", "16:RATE_LIMITED",
      "17:IDEMPOTENCY_CONFLICT", "18:TEMP_UNAVAILABLE", "18:INTERNAL_ERROR",
    ]);
  });
  it("mọi mã trong thứ tự là mã có thật", () => {
    for (const x of THU_TU_KIEM) expect(MA_LOI).toHaveProperty(x.ma);
  });
});

describe("[AIL-HD-06] đường dẫn + nhóm hạn mức (P8)", () => {
  it("đường dẫn khớp servers/paths của YAML", () => {
    for (const p of Object.values(DUONG_DAN)) expect(yaml, p).toContain(`  ${p.replace("/api/ai-lead-agent/v1", "")}:`);
  });
  it("catalog, intake và control là ba nhóm RIÊNG; handoffs + incidents + heartbeats chung một nhóm", () => {
    expect(NHOM_HAN_MUC.catalog).toBe("catalog");
    expect(NHOM_HAN_MUC.leadIntakes).toBe("intake");
    expect(new Set([NHOM_HAN_MUC.handoffs, NHOM_HAN_MUC.incidents, NHOM_HAN_MUC.heartbeats])).toEqual(new Set(["control"]));
    expect(new Set(Object.values(NHOM_HAN_MUC)).size).toBe(3);
  });
});

describe("[AIL-HD-07] mặc định tham số = số đề xuất của gói bàn giao (OD-04), và registry lấy ĐÚNG từ hằng", () => {
  it("giá trị mặc định", () => {
    expect(MAC_DINH_CAI_DAT).toEqual({
      heartbeatSeconds: 60, staleMultiplier: 3, rateCatalogPerMin: 30, rateIntakePerMin: 120, rateIntakePerPsidPerMin: 30,
      rateControlPerMin: 60, rateNewConversationsPerDayPerPage: 500, bodyMaxBytes: 8192, clockSkewMs: 300000, nonceTtlMinutes: 15,
      catalogMaxAgeSeconds: 300, probeTtlMinutes: 10, slaClaimMinutes: 30, slaResolveMinutes: 240,
      draftExpireHours: 72, queueMaxAgeHours: 24, verifyTtlHours: 168, disconnectHours: 24, requestRetentionDays: 7, rejectLogEnabled: false, rejectLogRetentionDays: 30, prodEnabled: false, consentPolicyStatus: "PENDING_LEGAL",
      takeoverNeedsAgentConfirmation: true, autoCreateEnabled: false, inboxLinkTemplate: "",
    });
  });
  it("mỗi hằng có đúng MỘT khoá ai.* trong registry mang cùng mặc định (26 khoá)", () => {
    const khoa = Object.keys(SETTINGS).filter((k) => k.startsWith("ai."));
    expect(khoa).toHaveLength(Object.keys(MAC_DINH_CAI_DAT).length);
    const giaTri = Object.values(MAC_DINH_CAI_DAT);
    for (const k of khoa) expect(giaTri, k).toContain((SETTINGS as Record<string, { default: unknown }>)[k]!.default);
  });
  it("trần thân cứng không thấp hơn mặc định và khoá gốc tối thiểu 32 ký tự", () => {
    expect(AN_TOAN_CUNG.tranThanTuyetDoiByte).toBeGreaterThan(MAC_DINH_CAI_DAT.bodyMaxBytes);
    expect(AN_TOAN_CUNG.khoaGocToiThieuKyTu).toBe(32);
    expect(AN_TOAN_CUNG.doDaiRequestId).toBe(24);
  });
});

describe("[AIL-HD-08] mẫu link mở hội thoại Facebook (OD-03)", () => {
  it("rỗng hợp lệ (không có nút); mẫu đúng hợp lệ", () => {
    expect(kiemMauLinkHoiThoai("")).toBeNull();
    expect(kiemMauLinkHoiThoai("https://business.facebook.com/latest/inbox/all?thread_id={threadId}")).toBeNull();
    expect(kiemMauLinkHoiThoai("https://facebook.com/messages/t/{threadId}")).toBeNull();
  });
  it.each([
    ["http thay vì https", "http://facebook.com/messages/t/{threadId}"],
    ["tên miền lạ", "https://evil.example/messages/t/{threadId}"],
    ["subdomain giả", "https://facebook.com.evil.example/m/{threadId}"],
    ["subdomain khác của facebook", "https://m.facebook.com/messages/t/{threadId}"],
    ["{threadId} nằm ở tên miền", "https://{threadId}.facebook.com/x"],
    ["thiếu {threadId}", "https://facebook.com/messages"],
    ["có tài khoản trước @", "https://facebook.com@evil.example/{threadId}"],
    ["chỉ định cổng", "https://facebook.com:8443/messages/t/{threadId}"],
    ["giao thức javascript", "javascript:alert({threadId})"],
    ["quá 300 ký tự", `https://facebook.com/${"a".repeat(300)}/{threadId}`],
  ])("TỪ CHỐI: %s", (_ten, mau) => {
    expect(kiemMauLinkHoiThoai(mau)).not.toBeNull();
  });
  it("dựng link: chèn threadId đã mã hoá; thread lạ hoặc mẫu hỏng ⇒ null (không có nút)", () => {
    const mau = "https://business.facebook.com/latest/inbox/all?thread_id={threadId}";
    expect(dungLinkHoiThoai(mau, "t_10152000000000001")).toBe("https://business.facebook.com/latest/inbox/all?thread_id=t_10152000000000001");
    expect(dungLinkHoiThoai(mau, "a/b")).toBeNull();
    expect(dungLinkHoiThoai(mau, "../../x")).toBeNull();
    expect(dungLinkHoiThoai(mau, null)).toBeNull();
    expect(dungLinkHoiThoai("", "t_1000")).toBeNull();
    expect(dungLinkHoiThoai("https://evil.example/{threadId}", "t_1000")).toBeNull();
  });
});

describe("[AIL-HD-09] danh tính của fixture bị CHẶN CỨNG (P4)", () => {
  it("agentId tiền tố cm9ailagenttest · secret của hmac-vectors · pageId của fixture", () => {
    expect(laDanhTinhFixture({ agentId: "cm9ailagenttest00000001" })).toBe(true);
    expect(laDanhTinhFixture({ agentId: "cm9ailagenttestxyz" })).toBe(true);
    expect(laDanhTinhFixture({ agentSecret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff" })).toBe(true);
    expect(laDanhTinhFixture({ pageId: "104500000000001" })).toBe(true);
    expect(laDanhTinhFixture({ pageId: "999999999999999" })).toBe(true);
  });
  it("đối chứng dương: danh tính thật không bị chặn", () => {
    expect(laDanhTinhFixture({ agentId: "clx9abcdefghij0123456789a", pageId: "123456789012345", agentSecret: "f".repeat(64) })).toBe(false);
    expect(laDanhTinhFixture({})).toBe(false);
  });
  it("hằng DANH_TINH_FIXTURE khớp những gì thật sự có trong fixture", () => {
    const v = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/ai-lead/request-response-fixtures/hmac-vectors.json"), "utf8")) as { agentId: string; agentSecret: string };
    expect(v.agentId.startsWith(DANH_TINH_FIXTURE.tienToAgentId)).toBe(true);
    expect(DANH_TINH_FIXTURE.agentSecrets).toContain(v.agentSecret);
    const pageIds = new Set<string>();
    for (const f of tatCaFixture()) for (const m of JSON.stringify(f).matchAll(/"pageId":\s*"([^"]+)"/g)) pageIds.add(m[1]!);
    for (const p of pageIds) expect(DANH_TINH_FIXTURE.pageIds, p).toContain(p);
  });
});

describe("[AIL-KT-01] enum hợp đồng ↔ enum Prisma (migration và mã không được lệch nhau)", () => {
  const prisma = (ten: string) => (Prisma.dmmf.datamodel.enums.find((e) => e.name === ten)?.values.map((v) => v.name) ?? []).sort();
  it("intent · nguồn tên Facebook · môi trường · contractStatus · page state", () => {
    expect(prisma("AiLeadIntent")).toEqual([...INTENTS].sort());
    expect(prisma("AiLeadFbNameSource")).toEqual([...FB_NAME_SOURCES].sort());
    expect(prisma("AiLeadEnvironment")).toEqual([...MOI_TRUONG].sort());
    expect(prisma("AiLeadContractStatus")).toEqual([...TRANG_THAI_CONTRACT].sort());
    expect(prisma("AiLeadPageState")).toEqual([...TRANG_THAI_PAGE].sort());
    expect(prisma("AiLeadSeverity")).toEqual([...SEVERITIES].sort());
  });
  it("trạng thái nội bộ của hội thoại có đủ giá trị mà ownerMode ngoài suy ra", () => {
    expect(prisma("AiLeadOwnerState")).toEqual(["AI_ACTIVE", "HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED", "TAKEOVER_PENDING"]);
  });
});
