// lib/ai-lead/trang-thai.test.ts — QUYẾT ĐỊNH phản hồi `/lead-intakes` (design §5). Thuần, không DB.
// Mã ca: [AIL-TT-01..11] · [AIL-TT-N1] (trung tính: đầu vào không có chỗ cho dữ liệu CRM).
//
// Cách tránh "oracle sao chép mã": bảng ưu tiên [AIL-TT-04] được GÕ TAY 16 dòng từ câu của hợp đồng ("INVALID_SELECTION > NEED_INFO > HUMAN_QUEUED > ACCEPTED"),
// không sinh từ chính thuật toán.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TRUONG_DAU_VAO,
  consentChoIngest,
  fbNameDaXacMinh,
  quyetDinhLeadIntake,
  type DauVaoQuyetDinh,
} from "./trang-thai";
import { docFixture } from "./ho-tro-test";

type CatalogFx = { pageId: string; campuses: { campusCode: string; acceptingLeads: boolean }[] };
const catalogCuaPage = (): DauVaoQuyetDinh["catalog"] => {
  const d = (docFixture("01").response.body as { data: { pages: CatalogFx[] } }).data;
  return d.pages[0]!.campuses;
};

/** Dựng đầu vào từ BODY của fixture — đúng thứ route sẽ làm từ request đã qua schema. */
function tuFixture(so: string, ownerState: DauVaoQuyetDinh["ownerState"] = "AI_ACTIVE"): DauVaoQuyetDinh {
  const b = docFixture(so).request.body as {
    conversation: { fbName?: string | null; fbNameSource?: DauVaoQuyetDinh["conversation"]["fbNameSource"] };
    candidate: { phoneRaw?: string; campusCode?: string };
  };
  return { candidate: { phoneRaw: b.candidate.phoneRaw, campusCode: b.candidate.campusCode }, conversation: { fbName: b.conversation.fbName, fbNameSource: b.conversation.fbNameSource }, catalog: catalogCuaPage(), ownerState };
}

const MONG_DOI = (so: string) => {
  const d = (docFixture(so).response.body as { data: Record<string, unknown> }).data;
  const { receiptId: _r, ...con } = d;
  return con;
};

describe("[AIL-TT-01] fixture 10–17: quyết định ra đúng status / nextAction / askFields / refreshCatalog", () => {
  it.each(["10", "11", "12", "13", "14", "15", "16", "17"])("fixture %s", (so) => {
    expect(quyetDinhLeadIntake(tuFixture(so))).toEqual(MONG_DOI(so));
  });
  it("chống rỗng: 4 status khác nhau đều xuất hiện trong 8 fixture", () => {
    const st = new Set(["10", "11", "12", "13", "14", "15", "16", "17"].map((s) => quyetDinhLeadIntake(tuFixture(s)).status));
    expect(st).toEqual(new Set(["ACCEPTED", "NEED_INFO", "INVALID_SELECTION", "HUMAN_QUEUED"]));
  });
});

describe("[AIL-TT-N1] TRUNG TÍNH: khách mới (10) và khách đã có trong CRM (15) ra CÙNG quyết định — và đầu vào KHÔNG có chỗ cho dữ liệu CRM", () => {
  it("fixture 10 ≡ 15 ≡ 16 (phát lại) về quyết định", () => {
    const a = quyetDinhLeadIntake(tuFixture("10"));
    expect(quyetDinhLeadIntake(tuFixture("15"))).toEqual(a);
    expect(quyetDinhLeadIntake(tuFixture("16"))).toEqual(a);
  });
  it("hàm chỉ nhận MỘT tham số và tập khoá đầu vào được GHIM (thêm khoá nhìn như CRM là phải sửa test này)", () => {
    expect(quyetDinhLeadIntake.length).toBe(1);
    expect([...TRUONG_DAU_VAO]).toEqual(["candidate", "conversation", "catalog", "ownerState"]);
  });
  it("mức KIỂU: nhét `existingLead` / `duplicate` / `saleId` vào đầu vào là LỖI BIÊN DỊCH (excess property)", () => {
    const co = tuFixture("10");
    // @ts-expect-error N1: DauVaoQuyetDinh không có chỗ cho dữ liệu CRM
    const ra = quyetDinhLeadIntake({ ...co, existingLead: true, duplicate: true, saleId: "s1" });
    // Runtime: dù lọt qua (JS không kiểm kiểu) thì khoá thừa cũng KHÔNG ảnh hưởng quyết định.
    expect(ra).toEqual(quyetDinhLeadIntake(co));
  });
  it("tệp nguồn không import DB / lib/lead / lib/crm / prisma — chỉ `@/lib/phone` và kiểu nội bộ", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai-lead/trang-thai.ts"), "utf8");
    const imports = [...src.matchAll(/^import\s+(?:type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./kieu", "@/lib/phone"].sort());
  });
});

describe("[AIL-TT-02] NEED_INFO: askFields ⊆ {phone, campus}, thứ tự CỐ ĐỊNH phone trước campus", () => {
  const goc = (): DauVaoQuyetDinh => tuFixture("10");
  it("thiếu cả hai ⇒ [phone, campus] (không phải [campus, phone])", () => {
    const x = goc();
    x.candidate = {};
    expect(quyetDinhLeadIntake(x)).toEqual({ status: "NEED_INFO", nextAction: "ASK_FIELDS", askFields: ["phone", "campus"] });
  });
  it("chỉ thiếu SĐT ⇒ [phone]; chỉ thiếu cơ sở ⇒ [campus]", () => {
    const a = goc();
    a.candidate = { campusCode: "CS1" };
    expect(quyetDinhLeadIntake(a)).toMatchObject({ askFields: ["phone"] });
    const b = goc();
    b.candidate = { phoneRaw: "0905123456" };
    expect(quyetDinhLeadIntake(b)).toMatchObject({ askFields: ["campus"] });
  });
  it("SĐT KHÔNG chuẩn hoá được (số bàn, quá ngắn, đầu số lạ) cho CÙNG kết quả với SĐT thiếu", () => {
    const thieu = { ...goc(), candidate: { campusCode: "CS1" } };
    for (const p of ["0236 3123456", "123", "0123456789", "84000000000", "+1 202 555 0100"]) {
      const x = { ...goc(), candidate: { phoneRaw: p, campusCode: "CS1" } };
      expect(quyetDinhLeadIntake(x), p).toEqual(quyetDinhLeadIntake(thieu));
    }
  });
  it("mọi dạng SĐT di động VN hợp lệ đều qua (NEED_INFO không đòi lại)", () => {
    for (const p of ["0905123456", "0905 123 456", "+84905123456", "84905123456", "0084905123456", "(090) 512-3456", "905123456", "0905\u00A0123\u00A0456"]) {
      const x = { ...goc(), candidate: { phoneRaw: p, campusCode: "CS1" } };
      expect(quyetDinhLeadIntake(x).status, p).toBe("ACCEPTED");
    }
  });
  it("askFields không bao giờ có ở status khác NEED_INFO và refreshCatalog không bao giờ có ngoài INVALID_SELECTION", () => {
    for (const so of ["10", "11", "12", "13", "14", "17"]) {
      const r = quyetDinhLeadIntake(tuFixture(so));
      expect("askFields" in r, so).toBe(r.status === "NEED_INFO");
      expect("refreshCatalog" in r, so).toBe(r.status === "INVALID_SELECTION");
    }
  });
});

describe("[AIL-TT-03] INVALID_SELECTION", () => {
  it("mã không có trong catalog ⇒ INVALID_SELECTION + refreshCatalog", () => {
    const x = { ...tuFixture("10"), candidate: { phoneRaw: "0905123456", campusCode: "ZZ9" } };
    expect(quyetDinhLeadIntake(x)).toEqual({ status: "INVALID_SELECTION", nextAction: "RE_ASK_CAMPUS", refreshCatalog: true });
  });
  it("cơ sở có trong catalog nhưng acceptingLeads=false (CS3 của fixture 01) ⇒ INVALID_SELECTION", () => {
    expect(catalogCuaPage().find((c) => c.campusCode === "CS3")?.acceptingLeads).toBe(false);
    expect(quyetDinhLeadIntake(tuFixture("13")).status).toBe("INVALID_SELECTION");
  });
  it("catalog RỖNG (Page chưa xuất bản cơ sở nào) + khách chọn một mã ⇒ INVALID_SELECTION; không chọn ⇒ NEED_INFO [campus]", () => {
    const co = { ...tuFixture("10"), catalog: [] };
    expect(quyetDinhLeadIntake(co).status).toBe("INVALID_SELECTION");
    expect(quyetDinhLeadIntake({ ...co, candidate: { phoneRaw: "0905123456" } })).toMatchObject({ status: "NEED_INFO", askFields: ["campus"] });
  });
  it("so khớp mã PHÂN BIỆT HOA THƯỜNG và khớp nguyên chuỗi (cs1 ≠ CS1, CS ≠ CS1)", () => {
    for (const m of ["cs1", "CS", "CS11", " CS1"]) {
      const x = { ...tuFixture("10"), candidate: { phoneRaw: "0905123456", campusCode: m } };
      expect(quyetDinhLeadIntake(x).status, m).toBe("INVALID_SELECTION");
    }
  });
});

describe("[AIL-TT-04] thứ tự ưu tiên: (0) không do AI giữ ⇒ HUMAN_QUEUED; rồi INVALID_SELECTION > NEED_INFO > HUMAN_QUEUED > ACCEPTED (bảng 16 dòng GÕ TAY)", () => {
  // [cơ sở không hợp lệ?, thiếu SĐT?, tên chưa xác minh?, hội thoại không do AI giữ?] → status theo câu của hợp đồng.
  const BANG: [boolean, boolean, boolean, boolean, string][] = [
    [false, false, false, false, "ACCEPTED"],
    [false, false, false, true, "HUMAN_QUEUED"],
    [false, false, true, false, "HUMAN_QUEUED"],
    [false, false, true, true, "HUMAN_QUEUED"],
    [false, true, false, false, "NEED_INFO"],
    [false, true, false, true, "HUMAN_QUEUED"],
    [false, true, true, false, "NEED_INFO"],
    [false, true, true, true, "HUMAN_QUEUED"],
    [true, false, false, false, "INVALID_SELECTION"],
    [true, false, false, true, "HUMAN_QUEUED"],
    [true, false, true, false, "INVALID_SELECTION"],
    [true, false, true, true, "HUMAN_QUEUED"],
    [true, true, false, false, "INVALID_SELECTION"],
    [true, true, false, true, "HUMAN_QUEUED"],
    [true, true, true, false, "INVALID_SELECTION"],
    [true, true, true, true, "HUMAN_QUEUED"],
  ];
  it.each(BANG)("campusSai=%s thiếuSĐT=%s tênChưaXM=%s khôngDoAI=%s ⇒ %s", (campusSai, thieuSdt, tenChuaXm, khongDoAi, mong) => {
    const x: DauVaoQuyetDinh = {
      candidate: { campusCode: campusSai ? "CS3" : "CS1", ...(thieuSdt ? {} : { phoneRaw: "0905123456" }) },
      conversation: tenChuaXm ? { fbName: null } : { fbName: "Phụ huynh Minh Anh", fbNameSource: "META_PROFILE_API" },
      catalog: catalogCuaPage(),
      ownerState: khongDoAi ? "HUMAN_ACTIVE" : "AI_ACTIVE",
    };
    expect(quyetDinhLeadIntake(x).status).toBe(mong);
  });
});

describe("[AIL-TT-05] HUMAN_QUEUED: tên Facebook chưa xác minh / khách tự gõ", () => {
  const dayDu = () => tuFixture("10");
  it("fbName null ⇒ HUMAN_QUEUED (fixture 14)", () => {
    expect(quyetDinhLeadIntake(tuFixture("14"))).toMatchObject({ status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" });
  });
  it("fbName có nhưng nguồn CUSTOMER_STATED ⇒ HUMAN_QUEUED; WEBHOOK_PAYLOAD và META_PROFILE_API ⇒ ACCEPTED", () => {
    const x = (nguon: "CUSTOMER_STATED" | "WEBHOOK_PAYLOAD" | "META_PROFILE_API") => ({ ...dayDu(), conversation: { fbName: "Minh Anh", fbNameSource: nguon } });
    expect(quyetDinhLeadIntake(x("CUSTOMER_STATED")).status).toBe("HUMAN_QUEUED");
    expect(quyetDinhLeadIntake(x("WEBHOOK_PAYLOAD")).status).toBe("ACCEPTED");
    expect(quyetDinhLeadIntake(x("META_PROFILE_API")).status).toBe("ACCEPTED");
  });
  it("phòng thủ: fbName có mà THIẾU nguồn (schema đã chặn, nhưng chốt cuối tự kiểm) ⇒ HUMAN_QUEUED; tên toàn khoảng trắng ⇒ HUMAN_QUEUED", () => {
    expect(quyetDinhLeadIntake({ ...dayDu(), conversation: { fbName: "Minh Anh" } }).status).toBe("HUMAN_QUEUED");
    expect(quyetDinhLeadIntake({ ...dayDu(), conversation: { fbName: "   ", fbNameSource: "META_PROFILE_API" } }).status).toBe("HUMAN_QUEUED");
  });
  it("fbNameDaXacMinh", () => {
    expect(fbNameDaXacMinh({ fbName: "A", fbNameSource: "META_PROFILE_API" })).toBe(true);
    expect(fbNameDaXacMinh({ fbName: "A", fbNameSource: "CUSTOMER_STATED" })).toBe(false);
    expect(fbNameDaXacMinh({ fbName: null, fbNameSource: "META_PROFILE_API" })).toBe(false);
    expect(fbNameDaXacMinh({})).toBe(false);
  });
});

describe("[AIL-TT-06] ownerState ≠ AI_ACTIVE ⇒ HUMAN_QUEUED (cả bốn trạng thái), kể cả khi dữ liệu đầy đủ", () => {
  it.each(["HANDOFF_REQUESTED", "TAKEOVER_PENDING", "HUMAN_ACTIVE", "PAUSED"] as const)("%s", (st) => {
    expect(quyetDinhLeadIntake(tuFixture("10", st))).toEqual({ status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" });
  });
  it("đối chứng dương: AI_ACTIVE + cùng dữ liệu ⇒ ACCEPTED", () => {
    expect(quyetDinhLeadIntake(tuFixture("10", "AI_ACTIVE")).status).toBe("ACCEPTED");
  });
});

describe("[AIL-TT-09] ownerState ≠ AI_ACTIVE khoá cả NEED_INFO và INVALID_SELECTION (OD-02): Agent không được hỏi tiếp khi hội thoại đã giao cho người", () => {
  it.each(["HANDOFF_REQUESTED", "TAKEOVER_PENDING", "HUMAN_ACTIVE", "PAUSED"] as const)("%s + thiếu SĐT ⇒ HUMAN_QUEUED (không có askFields)", (st) => {
    const x = { ...tuFixture("10", st), candidate: { campusCode: "CS1" } };
    const kq = quyetDinhLeadIntake(x);
    expect(kq).toEqual({ status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" });
    expect(kq).not.toHaveProperty("askFields");
  });
  it("HUMAN_ACTIVE + cơ sở không hợp lệ ⇒ HUMAN_QUEUED (không phải INVALID_SELECTION)", () => {
    const x = { ...tuFixture("10", "HUMAN_ACTIVE"), candidate: { phoneRaw: "0905123456", campusCode: "CS3" } };
    expect(quyetDinhLeadIntake(x).status).toBe("HUMAN_QUEUED");
  });
  it("đối chứng dương: AI_ACTIVE + cùng đầu vào thiếu SĐT ⇒ NEED_INFO [phone]", () => {
    const x = { ...tuFixture("10", "AI_ACTIVE"), candidate: { campusCode: "CS1" } };
    expect(quyetDinhLeadIntake(x)).toMatchObject({ status: "NEED_INFO", askFields: ["phone"] });
  });
});

describe("[AIL-TT-07] consentChoIngest: true CHỈ khi contactAllowed=true kèm messageMid", () => {
  it("true khi đủ (fixture 17)", () => {
    const c = (docFixture("17").request.body as { candidate: { consent: { contactAllowed: true; messageMid: string } } }).candidate;
    expect(consentChoIngest(c)).toBe(true);
  });
  it("false: vắng consent · thiếu mid · mid rỗng · contactAllowed không phải true", () => {
    expect(consentChoIngest({})).toBe(false);
    expect(consentChoIngest({ consent: { contactAllowed: true } })).toBe(false);
    expect(consentChoIngest({ consent: { contactAllowed: true, messageMid: "" } })).toBe(false);
    expect(consentChoIngest({ consent: { contactAllowed: false, messageMid: "m_TEST_consent_01" } })).toBe(false);
    expect(consentChoIngest({ consent: { contactAllowed: "true", messageMid: "m_TEST_consent_01" } })).toBe(false);
    expect(consentChoIngest({ consent: { contactAllowed: 1, messageMid: "m_TEST_consent_01" } })).toBe(false);
  });
  it("suy diễn từ 'khách chủ động nhắn tin' KHÔNG phải đồng ý: fixture 10 (không consent) ⇒ false", () => {
    const c = (docFixture("10").request.body as { candidate: Parameters<typeof consentChoIngest>[0] }).candidate;
    expect(consentChoIngest(c)).toBe(false);
  });
  it("consent KHÔNG làm đổi status (OD-08: chỉ ảnh hưởng consentMarketing truyền vào ingest)", () => {
    expect(quyetDinhLeadIntake(tuFixture("17")).status).toBe("ACCEPTED");
  });
});

describe("[AIL-TT-08] quyết định là hàm tất định, không đổi đầu vào", () => {
  it("cùng đầu vào ⇒ cùng kết quả; đầu vào không bị sửa", () => {
    const x = tuFixture("11");
    const sao = structuredClone(x);
    expect(quyetDinhLeadIntake(x)).toEqual(quyetDinhLeadIntake(x));
    expect(x).toEqual(sao);
  });
});
