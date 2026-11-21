// lib/ai-lead/schemas.test.ts — SCHEMA zod phải khớp hợp đồng: MỌI fixture (request lẫn response) cho ra đúng VALID/INVALID mà gói bàn giao ghi.
// Thuần, không DB. Mã ca: [AIL-SC-*] (đã dùng cho khai báo nền ⇒ ở đây dùng [AIL-SCH-*]).
//
// Cách lưới này chống "xanh vì rỗng": (1) đếm số lần thật sự kiểm request/response, đòi ≥ ngưỡng; (2) mỗi nhóm có ĐỐI CHỨNG DƯƠNG (VALID) lẫn ÂM (INVALID);
// (3) các ràng buộc chéo (evidence ↔ candidate, fbName ↔ fbNameSource) có ca riêng thay vì trông chờ vào fixture.
import { describe, it, expect } from "vitest";
import type { ZodError } from "zod";
import {
  SCHEMA_THEO_TEN,
  handoffRequestSchema,
  heartbeatRequestSchema,
  incidentRequestSchema,
  leadIntakeRequestSchema,
  moTaTruongLoi,
  occurredAtTrongHanMuc,
  testRunIdBiCam,
} from "./schemas";
import { docFixture, tatCaFixture } from "./ho-tro-test";

type Ten = keyof typeof SCHEMA_THEO_TEN;
const co = (t: string | undefined): t is Ten => !!t && t in SCHEMA_THEO_TEN;

describe("[AIL-SCH-01] mọi fixture: request và response ra đúng VALID/INVALID như gói bàn giao khai", () => {
  const fixtures = tatCaFixture();
  let daKiemReq = 0;
  let daKiemResp = 0;

  it.each(fixtures.map((f) => [f.tep, f] as const))("%s", (_tep, f) => {
    const { request: tenReq, requestExpect, response: tenResp, responseExpect } = f.validates;
    if (co(tenReq) && requestExpect && requestExpect !== "NA") {
      const r = SCHEMA_THEO_TEN[tenReq].safeParse(f.request.body);
      expect(r.success, `${f.tep}: request ${tenReq} kỳ vọng ${requestExpect}${r.success ? "" : ` — lỗi: ${moTaTruongLoi(r.error)}`}`).toBe(requestExpect === "VALID");
      daKiemReq++;
    }
    if (co(tenResp) && responseExpect && responseExpect !== "NA") {
      const r = SCHEMA_THEO_TEN[tenResp].safeParse(f.response.body);
      expect(r.success, `${f.tep}: response ${tenResp} kỳ vọng ${responseExpect}`).toBe(responseExpect === "VALID");
      daKiemResp++;
    }
  });

  it("[AIL-SCH-01b] chống rỗng: đã kiểm đủ nhiều request/response, có cả VALID lẫn INVALID", () => {
    const loai = (k: "request" | "response") =>
      fixtures.map((f) => (k === "request" ? f.validates.requestExpect : f.validates.responseExpect)).filter((x) => x === "VALID" || x === "INVALID");
    expect(loai("request").length).toBeGreaterThanOrEqual(38);
    expect(loai("response").length).toBeGreaterThanOrEqual(35);
    expect(new Set(loai("request"))).toEqual(new Set(["VALID", "INVALID"]));
    expect(new Set(loai("response"))).toEqual(new Set(["VALID", "INVALID"]));
    // Hai bộ đếm trong ca `it.each` ở trên phải chạy xong trước ca này (vitest chạy tuần tự trong một describe).
    expect(daKiemReq).toBeGreaterThanOrEqual(38);
    expect(daKiemResp).toBeGreaterThanOrEqual(35);
  });
});

type Than = { conversation: Record<string, unknown>; candidate: Record<string, unknown>; evidence?: Record<string, unknown>; [k: string]: unknown };
const hopLe = () => structuredClone(docFixture("10").request.body) as Than;
const loiTai = (body: unknown, schema: { safeParse: (x: unknown) => { success: boolean; error?: ZodError } } = leadIntakeRequestSchema) => {
  const r = schema.safeParse(body);
  return r.success ? "OK" : ((r.error ? moTaTruongLoi(r.error) : undefined) ?? "(không có field)");
};

describe("[AIL-SCH-02] ràng buộc chéo evidence ↔ candidate (YAML allOf)", () => {
  it("candidate rỗng + không evidence ⇒ hợp lệ (khách chưa cho gì)", () => {
    const b = hopLe();
    b.candidate = {};
    delete b.evidence;
    expect(loiTai(b)).toBe("OK");
  });
  it("có phoneRaw mà thiếu cả evidence ⇒ lỗi ở `evidence`", () => {
    const b = hopLe();
    delete b.candidate.campusCode;
    delete b.evidence;
    expect(loiTai(b)).toBe("evidence");
  });
  it("có phoneRaw, evidence thiếu phoneMessageMid ⇒ lỗi ở `evidence.phoneMessageMid`", () => {
    const b = hopLe();
    delete b.candidate.campusCode;
    b.evidence = { campusMessageMid: "m_TEST_campus_0001" };
    expect(loiTai(b)).toBe("evidence.phoneMessageMid");
  });
  it("có campusCode mà thiếu campusMessageMid ⇒ lỗi ở `evidence.campusMessageMid`", () => {
    const b = hopLe();
    b.evidence = { phoneMessageMid: "m_TEST_phone_0001" };
    expect(loiTai(b)).toBe("evidence.campusMessageMid");
  });
  it("đối chứng dương: evidence thừa (không có candidate tương ứng) vẫn hợp lệ", () => {
    const b = hopLe();
    b.candidate = { phoneRaw: "0905123456" };
    b.evidence = { phoneMessageMid: "m_TEST_phone_0001", campusMessageMid: "m_TEST_campus_0001" };
    expect(loiTai(b)).toBe("OK");
  });
});

describe("[AIL-SCH-03] hội thoại: fbName ↔ fbNameSource, độ dài tính theo KÝ TỰ UNICODE", () => {
  const voiTen = (conv: Record<string, unknown>) => {
    const b = hopLe();
    b.conversation = { pageId: "104500000000001", psid: "7000000000000001", ...conv };
    return loiTai(b);
  };
  it("fbName là chuỗi mà thiếu fbNameSource ⇒ lỗi ở `conversation.fbNameSource`", () => {
    expect(voiTen({ fbName: "Phụ huynh Minh Anh" })).toBe("conversation.fbNameSource");
  });
  it("fbName null (hoặc vắng) KHÔNG đòi nguồn; null kèm nguồn cũng được", () => {
    expect(voiTen({ fbName: null })).toBe("OK");
    expect(voiTen({})).toBe("OK");
    expect(voiTen({ fbName: null, fbNameSource: "CUSTOMER_STATED" })).toBe("OK");
  });
  it("cấm ký tự điều khiển / độ rộng 0 (Cc, Cf) / dấu phân dòng (Zl, Zp) / toàn khoảng trắng", () => {
    for (const x of ["Nguyễn\u200BAnh", "Nguyễn\u200DAnh", "Anh\u0007", "Anh\u2028B", "Anh\u2029B", "   ", "\u00A0\u00A0", "\n"]) {
      expect(voiTen({ fbName: x, fbNameSource: "WEBHOOK_PAYLOAD" }), JSON.stringify(x)).toBe("conversation.fbName");
    }
  });
  it("chuỗi rỗng bị từ chối (phải gửi null)", () => {
    expect(voiTen({ fbName: "", fbNameSource: "WEBHOOK_PAYLOAD" })).toBe("conversation.fbName");
  });
  it("100 KÝ TỰ emoji (200 đơn vị UTF-16) hợp lệ; 101 ký tự thì không", () => {
    expect(voiTen({ fbName: "😀".repeat(100), fbNameSource: "WEBHOOK_PAYLOAD" })).toBe("OK");
    expect(voiTen({ fbName: "😀".repeat(101), fbNameSource: "WEBHOOK_PAYLOAD" })).toBe("conversation.fbName");
    expect(voiTen({ fbName: "a".repeat(100), fbNameSource: "WEBHOOK_PAYLOAD" })).toBe("OK");
  });
  it("tên có dấu tiếng Việt + khoảng trắng thường hợp lệ", () => {
    expect(voiTen({ fbName: "Trần Thị Mỹ Linh", fbNameSource: "META_PROFILE_API" })).toBe("OK");
  });
  it("inboxThreadId: chỉ [A-Za-z0-9_-] dài 4–128, cho phép null; ký tự / . : + = bị từ chối", () => {
    expect(voiTen({ inboxThreadId: "t_1015" })).toBe("OK");
    expect(voiTen({ inboxThreadId: null })).toBe("OK");
    for (const x of ["a/b/c/d", "a.b.c.d", "a:b:c:d", "a+b+c+d", "a=b=c=d", "abc", "x".repeat(129)]) {
      expect(voiTen({ inboxThreadId: x }), x).toBe("conversation.inboxThreadId");
    }
  });
});

describe("[AIL-SCH-04] ứng viên: SĐT, cơ sở, đồng ý, ô tự do", () => {
  const voiCand = (c: Record<string, unknown>, ev: Record<string, unknown> = { phoneMessageMid: "m_TEST_phone_0001", campusMessageMid: "m_TEST_campus_0001" }) => {
    const b = hopLe();
    b.candidate = c;
    b.evidence = ev;
    return loiTai(b);
  };
  it("phoneRaw: chữ cái ⇒ lỗi, rỗng ⇒ lỗi, dài > 32 ⇒ lỗi, không có chữ số ⇒ lỗi; số có dấu cách/NBSP/+/() hợp lệ", () => {
    expect(voiCand({ phoneRaw: "09O5123456" })).toBe("candidate.phoneRaw");
    expect(voiCand({ phoneRaw: "" })).toBe("candidate.phoneRaw");
    expect(voiCand({ phoneRaw: "0".repeat(33) })).toBe("candidate.phoneRaw");
    expect(voiCand({ phoneRaw: "+()- " })).toBe("candidate.phoneRaw");
    for (const ok of ["0905 123 456", "+84 905 123 456", "(090) 512-3456", "0905\u00A0123\u00A0456", "0236 3123456"]) expect(voiCand({ phoneRaw: ok }), ok).toBe("OK");
  });
  it("campusCode: chữ hoa/số/_/- dài 2–16", () => {
    expect(voiCand({ campusCode: "cs1" })).toBe("candidate.campusCode");
    expect(voiCand({ campusCode: "C" })).toBe("candidate.campusCode");
    expect(voiCand({ campusCode: "CS1_HN-02" })).toBe("OK");
  });
  it("consent: chỉ chấp nhận contactAllowed=true kèm messageMid; false / thiếu mid / khoá lạ ⇒ lỗi", () => {
    const ev = { phoneMessageMid: "m_TEST_phone_0001" };
    expect(voiCand({ phoneRaw: "0905123456", consent: { contactAllowed: true, messageMid: "m_TEST_consent_01" } }, ev)).toBe("OK");
    expect(voiCand({ phoneRaw: "0905123456", consent: { contactAllowed: false, messageMid: "m_TEST_consent_01" } }, ev)).toBe("candidate.consent.contactAllowed");
    expect(voiCand({ phoneRaw: "0905123456", consent: { contactAllowed: true } }, ev)).toBe("candidate.consent.messageMid");
    expect(voiCand({ phoneRaw: "0905123456", consent: { contactAllowed: true, messageMid: "m_TEST_consent_01", note: "x" } }, ev)).toBe("candidate.consent.note");
  });
  it("khoá lạ ở mọi tầng ⇒ lỗi, `field` là đường dẫn tới khoá LẠ (fixture 93)", () => {
    expect(voiCand({ phoneRaw: "0905123456", sourceId: "x" }, { phoneMessageMid: "m_TEST_phone_0001" })).toBe("candidate.sourceId");
    const b = hopLe();
    b.note = "lời nhắn tự do";
    expect(loiTai(b)).toBe("note");
    const c = hopLe();
    c.conversation.leadId = "x";
    expect(loiTai(c)).toBe("conversation.leadId");
  });
  it("mid quá ngắn / sai ký tự ⇒ lỗi", () => {
    expect(voiCand({ phoneRaw: "0905123456" }, { phoneMessageMid: "short" })).toBe("evidence.phoneMessageMid");
    expect(voiCand({ phoneRaw: "0905123456" }, { phoneMessageMid: "m_có dấu cách" })).toBe("evidence.phoneMessageMid");
  });
  it("`error.field` KHÔNG BAO GIỜ chứa giá trị khách gửi (PII)", () => {
    const b = hopLe();
    b.candidate.phoneRaw = "0905 123 4X6";
    const r = leadIntakeRequestSchema.safeParse(b);
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = moTaTruongLoi(r.error) ?? "";
      expect(f).not.toContain("0905");
      expect(f).not.toContain("4X6");
    }
  });
});

describe("[AIL-SCH-05] idempotencyKey, schemaVersion, catalogVersion, testRunId", () => {
  const sua = (k: string, v: unknown) => {
    const b = hopLe();
    b[k] = v;
    return loiTai(b);
  };
  it("idempotencyKey: dạng cũ `<mid>:<intent>:v1`, hex hoa, thiếu v, v0 ⇒ lỗi; dạng mới hợp lệ", () => {
    expect(sua("idempotencyKey", "m_TEST_0001:CONSULTATION_REQUEST:v1")).toBe("idempotencyKey");
    expect(sua("idempotencyKey", `CONSULTATION_REQUEST:${"A".repeat(40)}:v1`)).toBe("idempotencyKey");
    expect(sua("idempotencyKey", `CONSULTATION_REQUEST:${"a".repeat(40)}`)).toBe("idempotencyKey");
    expect(sua("idempotencyKey", `CONSULTATION_REQUEST:${"a".repeat(40)}:v0`)).toBe("idempotencyKey");
    expect(sua("idempotencyKey", `CONSULTATION_REQUEST:${"a".repeat(40)}:v999`)).toBe("OK");
    expect(sua("idempotencyKey", `CONSULTATION_REQUEST:${"a".repeat(40)}:v1000`)).toBe("idempotencyKey");
  });
  it("[AIL-SCH-05c] KIND của idempotencyKey ĐÚNG endpoint: /lead-intakes ⇒ KIND = intent; /handoffs ⇒ HANDOFF; /incidents ⇒ INCIDENT (hợp đồng yaml IdempotencyKey; trước đây chỉ kiểm regex)", () => {
    const khoa = (kind: string) => `${kind}:${"b".repeat(40)}:v1`;
    // /lead-intakes: intent CONSULTATION_REQUEST (fixture 10)
    expect(sua("idempotencyKey", khoa("CONSULTATION_REQUEST"))).toBe("OK"); // đối chứng dương
    expect(sua("idempotencyKey", khoa("ENROLLMENT_REQUEST"))).toBe("idempotencyKey"); // KIND ≠ intent
    expect(sua("idempotencyKey", khoa("HANDOFF"))).toBe("idempotencyKey"); // key của endpoint khác
    expect(sua("idempotencyKey", khoa("INCIDENT"))).toBe("idempotencyKey");
    const khac = hopLe();
    khac.intent = "ENROLLMENT_REQUEST";
    khac.idempotencyKey = khoa("ENROLLMENT_REQUEST");
    expect(loiTai(khac)).toBe("OK"); // KIND đi theo intent, không cứng một giá trị
    // /handoffs
    const hd = (kind: string) => ({ ...(docFixture("20").request.body as Record<string, unknown>), idempotencyKey: khoa(kind) });
    expect(loiTai(hd("HANDOFF"), handoffRequestSchema)).toBe("OK");
    expect(loiTai(hd("CONSULTATION_REQUEST"), handoffRequestSchema)).toBe("idempotencyKey");
    expect(loiTai(hd("INCIDENT"), handoffRequestSchema)).toBe("idempotencyKey");
    // /incidents
    const sc = (kind: string) => ({ ...(docFixture("30").request.body as Record<string, unknown>), idempotencyKey: khoa(kind) });
    expect(loiTai(sc("INCIDENT"), incidentRequestSchema)).toBe("OK");
    expect(loiTai(sc("HANDOFF"), incidentRequestSchema)).toBe("idempotencyKey");
    expect(loiTai(sc("ENROLLMENT_REQUEST"), incidentRequestSchema)).toBe("idempotencyKey");
  });
  it("schemaVersion chỉ nhận '1.0'", () => {
    expect(sua("schemaVersion", "1.1")).toBe("schemaVersion");
    expect(sua("schemaVersion", 1)).toBe("schemaVersion");
  });
  it("intent ngoài danh sách ⇒ lỗi", () => {
    expect(sua("intent", "GREETING")).toBe("intent");
  });
  it("catalogVersion tuỳ chọn, số nguyên ≥ 1", () => {
    expect(sua("catalogVersion", 0)).toBe("catalogVersion");
    expect(sua("catalogVersion", 1.5)).toBe("catalogVersion");
    expect(sua("catalogVersion", 7)).toBe("OK");
  });
  it("testRunId: [A-Za-z0-9_-] dài 8–64; và cổng PROD chặn khi có (bước 13)", () => {
    expect(sua("testRunId", "short")).toBe("testRunId");
    expect(sua("testRunId", "synthetic-0001")).toBe("OK");
    expect(testRunIdBiCam({ testRunId: "synthetic-0001" }, "PROD")).toBe(true);
    expect(testRunIdBiCam({ testRunId: "synthetic-0001" }, "TEST")).toBe(false);
    expect(testRunIdBiCam({}, "PROD")).toBe(false);
  });
});

describe("[AIL-SCH-06] handoff, incident, heartbeat", () => {
  const h = () => structuredClone(docFixture("20").request.body) as Record<string, unknown>;
  const i = () => structuredClone(docFixture("30").request.body) as Record<string, unknown>;
  const hb = () => structuredClone(docFixture("40").request.body) as { pages: Record<string, unknown>[]; [k: string]: unknown };

  it("handoff: reasonCode ngoài 8 mã ⇒ lỗi; đủ 8 mã đều hợp lệ", () => {
    const b = h();
    b.reasonCode = "BORED";
    expect(loiTai(b, handoffRequestSchema)).toBe("reasonCode");
    for (const m of ["CUSTOMER_REQUESTED_HUMAN", "OUT_OF_SCOPE", "COMPLAINT_OR_SENSITIVE", "PRICE_OR_PAYMENT", "AI_UNCERTAIN", "REPEATED_FAILURE", "SYSTEM_UNAVAILABLE", "INTAKE_PAUSED"]) {
      expect(loiTai({ ...h(), reasonCode: m }, handoffRequestSchema), m).toBe("OK");
    }
  });
  it("incident: detailCode đóng 16 mã (mã lạ ⇒ lỗi), correlationId phải là UUID CHỮ THƯỜNG", () => {
    expect(loiTai({ ...i(), detailCode: "WHATEVER" }, incidentRequestSchema)).toBe("detailCode");
    expect(loiTai({ ...i(), correlationId: "3F2B8C1E-5D4A-4E7B-9A10-0123456789AB" }, incidentRequestSchema)).toBe("correlationId");
    expect(loiTai({ ...i(), correlationId: "3f2b8c1e-5d4a-4e7b-9a10-0123456789ab" }, incidentRequestSchema)).toBe("OK");
    expect(loiTai({ ...i(), correlationId: undefined, pageId: undefined }, incidentRequestSchema)).toBe("OK");
  });
  it("incident: occurredAt phải là date-time CÓ offset; không offset ⇒ lỗi", () => {
    expect(loiTai({ ...i(), occurredAt: "2026-10-26T14:33:00" }, incidentRequestSchema)).toBe("occurredAt");
    expect(loiTai({ ...i(), occurredAt: "hôm qua" }, incidentRequestSchema)).toBe("occurredAt");
    expect(loiTai({ ...i(), occurredAt: "2026-10-26T07:33:00Z" }, incidentRequestSchema)).toBe("OK");
  });
  it("P9: occurredAt lệch ĐÚNG 24 giờ vẫn qua, 24 giờ + 1 ms thì không", () => {
    const now = Date.parse("2026-10-26T14:33:00+07:00");
    expect(occurredAtTrongHanMuc("2026-10-25T14:33:00+07:00", now)).toBe(true);
    expect(occurredAtTrongHanMuc("2026-10-25T14:32:59.999+07:00", now)).toBe(false);
    expect(occurredAtTrongHanMuc("2026-10-27T14:33:00+07:00", now)).toBe(true);
    expect(occurredAtTrongHanMuc("2026-10-27T14:33:00.001+07:00", now)).toBe(false);
    expect(occurredAtTrongHanMuc("không phải ngày", now)).toBe(false);
  });
  it("heartbeat: capabilities trùng ⇒ lỗi; pages > 50 ⇒ lỗi; contractHash sai độ dài ⇒ lỗi; probeAck null / vắng đều được", () => {
    expect(loiTai({ ...hb(), capabilities: ["HANDOFF", "HANDOFF"] }, heartbeatRequestSchema)).toBe("capabilities");
    const nhieu = Array.from({ length: 51 }, (_, k) => ({ pageId: `1045000000${String(k).padStart(5, "0")}`, lastWebhookEventAt: null }));
    expect(loiTai({ ...hb(), pages: nhieu }, heartbeatRequestSchema)).toBe("pages");
    expect(loiTai({ ...hb(), pages: nhieu.slice(0, 50) }, heartbeatRequestSchema)).toBe("OK");
    expect(loiTai({ ...hb(), contractHash: "abc" }, heartbeatRequestSchema)).toBe("contractHash");
    expect(loiTai({ ...hb(), probeAck: undefined }, heartbeatRequestSchema)).toBe("OK");
    expect(loiTai({ ...hb(), probeAck: null }, heartbeatRequestSchema)).toBe("OK");
  });
  it("heartbeat: lastWebhookEventAt bắt buộc có mặt (được là null); khoá lạ trong page ⇒ lỗi trỏ đúng chỗ", () => {
    const b = hb();
    delete b.pages[0].lastWebhookEventAt;
    expect(loiTai(b, heartbeatRequestSchema)).toBe("pages[0].lastWebhookEventAt");
    const c = hb();
    c.pages[0].state = "PAUSED";
    expect(loiTai(c, heartbeatRequestSchema)).toBe("pages[0].state");
  });
  it("heartbeat: environment ngoài TEST/PROD ⇒ lỗi", () => {
    expect(loiTai({ ...hb(), environment: "STAGING" }, heartbeatRequestSchema)).toBe("environment");
  });
});

describe("[AIL-SCH-07] phản hồi SAI của nhà cung cấp bị từ chối (fixture 77–79) và hình dạng N1", () => {
  it("askFields sai thứ tự / ACCEPTED kèm refreshCatalog / QUEUED đi với STAY_SILENT ⇒ INVALID", () => {
    expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(docFixture("77").response.body).success).toBe(false);
    expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(docFixture("78").response.body).success).toBe(false);
    expect(SCHEMA_THEO_TEN.HandoffResponse.safeParse(docFixture("79").response.body).success).toBe(false);
  });
  it("phản hồi lộ khoá nội bộ (leadId/duplicate/saleId) ⇒ INVALID — schema phản hồi là strict", () => {
    const base = structuredClone(docFixture("10").response.body) as { data: Record<string, unknown> };
    for (const k of ["leadId", "duplicate", "existing", "saleId", "sourceId"]) {
      const x = structuredClone(base);
      x.data[k] = "x";
      expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(x).success, k).toBe(false);
    }
  });
  it("askFields chỉ nhận ba tổ hợp [phone] [campus] [phone,campus]", () => {
    const mau = (a: unknown) => ({ ok: true, data: { receiptId: "rct_a1b2c3d4e5f6a1", status: "NEED_INFO", nextAction: "ASK_FIELDS", askFields: a }, meta: { requestId: "req_aaaaaaaaaaaa", serverTime: 1 } });
    for (const a of [["phone"], ["campus"], ["phone", "campus"]]) expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(mau(a)).success, JSON.stringify(a)).toBe(true);
    for (const a of [[], ["campus", "phone"], ["phone", "phone"], ["name"], ["phone", "campus", "x"]]) expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(mau(a)).success, JSON.stringify(a)).toBe(false);
  });
});
