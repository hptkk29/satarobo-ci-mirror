// lib/ai-lead/dich-vu/tao-lead.test.ts — CẦU NỐI CRM, tầng logic (DB giả + ingest giả). Tầng DB thật: tests/ai-lead/tao-lead.spec.ts.
//
// Test KHÔNG đọc đồng hồ thật (luật 19): không có ngày tuyệt đối nào ở đây phụ thuộc `new Date()` ngoài những chỗ dịch vụ tự ghi `closedAt` (ta chỉ kiểm có/không).
// Mỗi ca dựng lại mọi thứ từ `beforeEach` ⇒ xanh khi chạy MỘT MÌNH (luật 18).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actorHoiSo, actorQlcs } from "./ho-tro-test-duyet";

const m = vi.hoisted(() => {
  const state = {
    draft: null as Record<string, unknown> | null,
    lead: null as { assignedToId: string | null } | null,
    leadTheoEvent: null as { id: string } | null,
    center: { isActive: true } as { isActive: boolean } | null,
    khongNhan: [] as string[],
    xuatBan: { acceptingLeads: true, publicVisible: true } as { acceptingLeads: boolean; publicVisible: boolean } | null,
    banMoi: null as { payload: unknown } | null,
    updateManyCount: [1] as number[],
    laiSauThua: null as Record<string, unknown> | null,
    tuDongBat: true as boolean | "nem",
    nguon: { san: true, groupCode: "MARKETING_HO" } as { san: true; groupCode: string } | { san: false; ma: string },
    /** Nguồn thật của lead SAU ingest: nhóm nào, hoặc null = không có dòng LeadAttribution. */
    nguonSauTao: { group: { code: "MARKETING_HO" } } as { group: { code: string } } | null,
  };
  const ingest = vi.fn();
  const audit = vi.fn(async (_a: unknown) => ({}));
  const updateMany = vi.fn(async (_a: unknown) => ({ count: state.updateManyCount.shift() ?? 1 }));
  const findUniqueDraft = vi.fn(async (args: { select?: unknown }) => (args.select ? state.laiSauThua : state.draft));
  const tx = { aiLeadDraft: { updateMany } };
  const baoNguon = vi.fn(async (_a: unknown) => undefined);
  return { state, ingest, audit, updateMany, findUniqueDraft, tx, baoNguon };
});

vi.mock("@/lib/db", () => ({
  db: {
    aiLeadDraft: { findUnique: m.findUniqueDraft, updateMany: m.updateMany },
    lead: { findUnique: vi.fn(async (a: { where: { eventId?: string } }) => (a.where.eventId ? m.state.leadTheoEvent : m.state.lead)) },

    center: { findUnique: vi.fn(async () => m.state.center) },
    aiLeadCampusPublication: { findUnique: vi.fn(async () => m.state.xuatBan) },
    aiLeadCatalogSnapshot: { findFirst: vi.fn(async () => m.state.banMoi) },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(m.tx)),
  },
}));
vi.mock("@/lib/nguon/doc-nhom-sau-tao", () => ({ docMaNhomNguonSauTao: vi.fn(async () => (m.state.nguonSauTao ? { coDong: true, maNhom: m.state.nguonSauTao.group.code } : { coDong: false })) }));
vi.mock("./san-sang-nguon", () => ({ docSanSangNguon: vi.fn(async () => m.state.nguon) }));
vi.mock("./thong-bao", () => ({ baoCauHinhNguonThieu: m.baoNguon }));
vi.mock("@/lib/enrollment-flow", () => ({ getNonEnrollableCenterIds: vi.fn(async () => m.state.khongNhan) }));
vi.mock("@/lib/lead/intake/ingest", () => ({ ingestIntakeLead: m.ingest }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: m.audit }));
vi.mock("@/lib/audit/log", () => ({ logRbacAudit: vi.fn() }));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (k: string) => {
    if (k !== "ai.autoCreateEnabled") throw new Error(`cài đặt không mong đợi: ${k}`);
    if (m.state.tuDongBat === "nem") throw new Error("không đọc được cài đặt");
    return m.state.tuDongBat;
  }),
}));

import { catalogGhiNgungNhan, eventIdCuaHoSo, taoLeadTuHoSo } from "./tao-lead";

const CS1 = "center-cs1";
const CS2 = "center-cs2";

function hoSo(over: Record<string, unknown> = {}) {
  return {
    id: "ck1234567890abcdef",
    conversationId: "conv-1",
    conversation: { pageId: "PAGE-1" },
    intent: "ENROLLMENT_REQUEST",
    state: "READY_FOR_REVIEW",
    fbName: "Nguyễn Thị Lan",
    fbNameSource: "META_PROFILE_API",
    phoneRaw: "0905 123 456",
    phoneCanonical: "84905123456",
    campusCode: "CS1",
    campusCenterId: CS1,
    consentAllowed: true,
    consentMid: "mid.consent",
    evidence: { phoneMessageMid: "mid.phone" },
    missingFields: [],
    version: 3,
    centerId: CS1,
    orgUnitId: "ou-cs1",
    claimedById: null,
    leadId: null,
    ...over,
  };
}

const NGUOI = actorQlcs("u-qlcs", [CS1]);

beforeEach(() => {
  m.ingest.mockReset().mockResolvedValue({ ok: true, leadId: "lead-1", duplicate: false });
  m.audit.mockClear();
  m.baoNguon.mockClear();
  m.state.nguon = { san: true, groupCode: "MARKETING_HO" };
  m.state.nguonSauTao = { group: { code: "MARKETING_HO" } };
  m.updateMany.mockClear();
  m.findUniqueDraft.mockClear();
  m.state.draft = hoSo();
  m.state.lead = { assignedToId: "sale-1" };
  m.state.leadTheoEvent = null;
  m.state.center = { isActive: true };
  m.state.khongNhan = [];
  m.state.xuatBan = { acceptingLeads: true, publicVisible: true };
  m.state.banMoi = null;
  m.state.updateManyCount = [1];
  m.state.laiSauThua = null;
  m.state.tuDongBat = true;
});

describe("[ATL-01] tham số truyền sang ingest", () => {
  it("[ATL-01a] ctx: kênh messenger-ai, eventId idempotent, không legacy, không người nhập, cờ ẩn danh false, cơ sở đã kiểm, chỉ pageId làm tín hiệu nguồn", async () => {
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF", tenNguoi: "QL" });
    expect(kq).toEqual({ ok: true, leadId: "lead-1", duplicate: false });
    expect(m.ingest).toHaveBeenCalledTimes(1);
    const [mapped, ctx] = m.ingest.mock.calls[0]!;
    expect(ctx.source).toBe("messenger-ai");
    expect(ctx.eventId).toBe(eventIdCuaHoSo("ck1234567890abcdef"));
    expect(ctx.eventId).toBe("ailead:ck1234567890abcdef");
    expect(ctx.actorName).toBe("Hệ thống (AI Messenger)");
    expect(ctx.centerId).toBe(CS1);
    expect(ctx.chiGhiDauVetKhiTrung).toBe(false); // STAFF: có người duyệt
    expect(ctx.legacyWebhook).toBeUndefined();
    expect(ctx.allowMissingPhone).toBeUndefined();
    // Người bấm duyệt KHÔNG được thành «người nhập/giới thiệu» (D12) — nếu có, hoa hồng giới thiệu chảy về QLCS.
    expect(ctx.createdByUserId).toBeUndefined();
    expect(ctx.tinHieuNguon.pageId).toBe("PAGE-1");
    expect(ctx.tinHieuNguon.quangCao.adId).toBeNull();
    expect(ctx.tinHieuNguon.ref).toBeNull();
    expect(ctx.tinHieuNguon.nhanSuGioiThieuEmployeeId).toBeNull();
    expect(ctx.tinHieuNguon.nguonChon).toBeNull();
    expect(mapped.parentName).toBe("Nguyễn Thị Lan");
    expect(mapped.phone).toBe("84905123456");
    expect(mapped.children).toEqual([]);
    expect(mapped.centerHint).toBeNull();
    expect(mapped.facebookUrl ?? null).toBeNull();
    expect(mapped.consentMarketing).toBe(true);
  });

  it("[ATL-01b] ghi chú lead KHÔNG chứa mid, psid, SĐT, nội dung — chỉ nguồn + mã hồ sơ + ý định", async () => {
    m.state.draft = hoSo({ conversation: { pageId: "PAGE-1", psid: "PSID-BI-MAT-123" } });
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    const mapped = m.ingest.mock.calls[0]![0];
    const note = mapped.noteLines.join("\n");
    expect(note).toContain("AI Messenger");
    expect(note).toContain("abcdef".slice(-6)); // mã hồ sơ rút gọn
    expect(note).not.toMatch(/mid\./);
    expect(note).not.toContain("PSID-BI-MAT");
    expect(note).not.toMatch(/\d{9,}/);
  });

  it("[ATL-01c] consentMarketing: true CHỈ khi consentAllowed VÀ có mid; thiếu một vế ⇒ false", async () => {
    for (const [allowed, mid, mong] of [
      [true, "mid.x", true],
      [true, null, false],
      [false, "mid.x", false],
      [false, null, false],
    ] as const) {
      m.ingest.mockClear();
      m.state.draft = hoSo({ consentAllowed: allowed, consentMid: mid });
      await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
      expect(m.ingest.mock.calls[0]![0].consentMarketing, `allowed=${allowed} mid=${mid}`).toBe(mong);
    }
  });
});

describe("[ATL-02] revalidate lúc ghi — thiếu điều kiện thì KHÔNG gọi ingest", () => {
  it.each([
    ["tên FB do khách tự gõ", { fbNameSource: "CUSTOMER_STATED" }, "THIEU:fbName"],
    ["không có tên FB", { fbName: null, fbNameSource: null }, "THIEU:fbName"],
    ["SĐT không chuẩn hoá được", { phoneCanonical: null, phoneRaw: "12345" }, "THIEU:phone"],
    ["chưa chọn cơ sở", { campusCenterId: null, campusCode: null }, "THIEU:campus"],
  ])("[ATL-02a] %s", async (_t, over, chiTiet) => {
    m.state.draft = hoSo(over);
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "THIEU_DIEU_KIEN", chiTiet });
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("[ATL-02b] nhân viên đã xác minh ĐÚNG tên đang lưu ⇒ qua; tên bị Agent ghi đè sau đó ⇒ dấu cũ KHÔNG còn áp", async () => {
    const dau = { staff: { fbName: { v: "Nguyễn Thị Lan", by: "u-qlcs", at: "2026-11-07T00:00:00.000Z" } } };
    m.state.draft = hoSo({ fbNameSource: "CUSTOMER_STATED", evidence: dau });
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" })).ok).toBe(true);
    m.ingest.mockClear();
    m.state.draft = hoSo({ fbNameSource: "CUSTOMER_STATED", fbName: "Tên khác Agent ghi đè", evidence: dau });
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toMatchObject({ ok: false, lyDo: "THIEU_DIEU_KIEN" });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it.each([
    ["cơ sở ngừng hoạt động", () => { m.state.center = { isActive: false }; }, "CO_SO_NGUNG_HOAT_DONG"],
    ["cơ sở không nhận ghi danh (Hội sở)", () => { m.state.khongNhan = [CS1]; }, "CO_SO_KHONG_NHAN_GHI_DANH"],
    ["cơ sở chưa xuất bản cho Page", () => { m.state.xuatBan = null; }, "CO_SO_CHUA_XUAT_BAN_CHO_PAGE"],
    ["cơ sở bị ẩn khỏi catalog", () => { m.state.xuatBan = { acceptingLeads: true, publicVisible: false }; }, "CO_SO_CHUA_XUAT_BAN_CHO_PAGE"],
    ["cơ sở ngừng nhận khách", () => { m.state.xuatBan = { acceptingLeads: false, publicVisible: true }; }, "CO_SO_NGUNG_NHAN_KHACH"],
    [
      "bản catalog xuất bản ghi rõ ngừng nhận",
      () => { m.state.banMoi = { payload: { pages: [{ pageId: "PAGE-1", campuses: [{ campusCode: "CS1", acceptingLeads: false }] }] } }; },
      "CATALOG_NGUNG_NHAN_KHACH",
    ],
  ])("[ATL-02c] %s ⇒ CO_SO_KHONG_HOP_LE, không ingest", async (_t, dat, ma) => {
    dat();
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "CO_SO_KHONG_HOP_LE", chiTiet: ma });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it("[ATL-02d] catalog ghi cơ sở ĐANG nhận, hoặc không nhắc tới cơ sở ⇒ không chặn", async () => {
    m.state.banMoi = { payload: { pages: [{ pageId: "PAGE-1", campuses: [{ campusCode: "CS1", acceptingLeads: true }, { campusCode: "CS9", acceptingLeads: false }] }] } };
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" })).ok).toBe(true);
    m.state.banMoi = { payload: { pages: [{ pageId: "PAGE-1", campuses: [] }] } };
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" })).ok).toBe(true);
  });
});

describe("[ATL-03] kết quả ghi vào hồ sơ", () => {
  it("[ATL-03a] lead có chủ ⇒ COMPLETED, ghi điều kiện version, audit CÙNG transaction", async () => {
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF", tenNguoi: "Quản lý A" });
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    const arg = m.updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toMatchObject({ id: "ck1234567890abcdef", version: 3 });
    expect(arg.data).toMatchObject({ state: "COMPLETED", leadId: "lead-1" });
    expect(arg.data.closedAt).toBeInstanceOf(Date);
    expect(m.audit).toHaveBeenCalledTimes(1);
    const au = m.audit.mock.calls[0]![0] as Record<string, unknown>;
    expect(au.tx).toBe(m.tx); // CÙNG transaction — không ghi audit lẻ
    expect(au).toMatchObject({ module: "ai-lead", entityType: "AiLeadDraft", action: "CREATE_LEAD" });
    expect(au.actor).toEqual({ id: "u-qlcs", name: "Quản lý A" });
  });

  it("[ATL-03b] lead CHƯA có chủ ⇒ ASSIGNMENT_PENDING (hàng chờ nhân viên), chưa đóng hồ sơ", async () => {
    m.state.lead = { assignedToId: null };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-1", duplicate: false });
    const arg = m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ state: "ASSIGNMENT_PENDING", leadId: "lead-1", closedAt: null });
  });

  it("[ATL-03c] ingest báo trùng ⇒ vẫn COMPLETED, ghi dấu «gắn vào lead có sẵn»", async () => {
    m.ingest.mockResolvedValue({ ok: true, leadId: "lead-cu", duplicate: true });
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-cu", duplicate: true });
    const arg = m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ state: "COMPLETED", leadId: "lead-cu", resultNote: "GAN_VAO_LEAD_CO_SAN" });
  });

  it("[ATL-03d] đua eventId ở ingest (trả duplicate KHÔNG kèm leadId) ⇒ tra lại bằng eventId", async () => {
    m.ingest.mockResolvedValue({ ok: true, duplicate: true });
    m.state.leadTheoEvent = { id: "lead-do-luot-kia-tao" };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-do-luot-kia-tao", duplicate: true });
  });

  it("[ATL-03e] ingest ok mà không tìm ra lead ⇒ LOI_INGEST + SYSTEM_EXCEPTION (không nói dối «xong»)", async () => {
    m.ingest.mockResolvedValue({ ok: true, duplicate: true });
    m.state.leadTheoEvent = null;
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "LOI_INGEST", chiTiet: "INGEST_KHONG_CO_LEAD" });
    expect((m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data).toMatchObject({ state: "SYSTEM_EXCEPTION" });
  });
});

describe("[ATL-04] ingest từ chối / ném lỗi ⇒ SYSTEM_EXCEPTION, lý do KHÔNG chứa PII", () => {
  it("[ATL-04a] ok:false ⇒ mã cố định, không nguyên văn câu của ingest", async () => {
    m.ingest.mockResolvedValue({ ok: false, error: "Số điện thoại không hợp lệ: 84905123456 của Nguyễn Thị Lan" });
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "LOI_INGEST", chiTiet: "INGEST_SDT" });
    const note = (m.updateMany.mock.calls[0]![0] as { data: { resultNote: string } }).data.resultNote;
    expect(note).toBe("INGEST_SDT");
    expect(JSON.stringify([kq, note])).not.toMatch(/84905123456|Nguyễn/);
    // chuyển sang SYSTEM_EXCEPTION PHẢI có dấu trên dòng thời gian (audit CÙNG transaction, người ghi = hệ thống)
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0]![0]).toMatchObject({ tx: m.tx, action: "SYSTEM_EXCEPTION", entityId: "ck1234567890abcdef", actor: { id: null, name: "Hệ thống (AI Messenger)" } });
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/84905123456|Nguyễn/);
  });

  it("[ATL-04b] ingest ném ngoại lệ (kèm PII trong message) ⇒ chỉ mã, ngoại lệ không lọt ra ngoài", async () => {
    m.ingest.mockRejectedValue(new Error("Unique violation on phone=84905123456"));
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "LOI_INGEST", chiTiet: "INGEST_NEM_LOI" });
    expect(JSON.stringify([kq, m.updateMany.mock.calls])).not.toContain("84905123456");
  });
});

describe("[ATL-05] idempotent & cổng trạng thái", () => {
  it.each(["COMPLETED", "ASSIGNMENT_PENDING"])("[ATL-05a] hồ sơ %s ⇒ trả lead cũ, KHÔNG gọi ingest, KHÔNG ghi", async (state) => {
    m.state.draft = hoSo({ state, leadId: "lead-da-co" });
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-da-co", duplicate: true });
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it.each(["REJECTED", "EXPIRED"])("[ATL-05b] hồ sơ %s ⇒ DA_XU_LY, không ingest", async (state) => {
    m.state.draft = hoSo({ state });
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "DA_XU_LY", chiTiet: state });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it("[ATL-05c] không có hồ sơ ⇒ KHONG_TIM_THAY", async () => {
    m.state.draft = null;
    expect(await taoLeadTuHoSo("khong-co", { actor: NGUOI, tu: "STAFF" })).toEqual({ ok: false, lyDo: "KHONG_TIM_THAY" });
  });
});

describe("[ATL-06] cách ly cơ sở — scopedDb KHÔNG che ghi nên cổng ở đây", () => {
  it("[ATL-06a] QLCS CS2 duyệt hồ sơ CS1 (gọi thẳng, bỏ qua UI) ⇒ NGOAI_PHAM_VI, không ingest", async () => {
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: actorQlcs("u-cs2", [CS2]), tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "NGOAI_PHAM_VI" });
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("[ATL-06b] STAFF mà không kèm actor ⇒ NGOAI_PHAM_VI (fail-closed)", async () => {
    expect(await taoLeadTuHoSo("ck1234567890abcdef", { tu: "STAFF" })).toEqual({ ok: false, lyDo: "NGOAI_PHAM_VI" });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it("[ATL-06c] vai Hội sở (ALL) và hồ sơ chưa biết cơ sở: Hội sở qua, QLCS không", async () => {
    m.state.draft = hoSo({ centerId: null });
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { actor: actorQlcs("u", [CS1]), tu: "STAFF" })).ok).toBe(false);
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { actor: actorHoiSo("u-ho"), tu: "STAFF" })).ok).toBe(true);
  });

  it("[ATL-06d] AUTO (cờ tự động BẬT) không cần actor, và gọi ingest với cờ ẨN DANH (chỉ ghi dấu vết khi trùng)", async () => {
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" })).ok).toBe(true);
    expect(m.ingest.mock.calls[0]![1].chiGhiDauVetKhiTrung).toBe(true);
    expect((m.audit.mock.calls[0]![0] as { actor: unknown }).actor).toEqual({ id: null, name: "Hệ thống (AI Messenger)" });
  });
});

describe("[ATL-09] tạo lead TỰ ĐỘNG chỉ khi ai.autoCreateEnabled bật — cổng nằm ở ĐƯỜNG DUY NHẤT tạo lead", () => {
  it("[ATL-09a] cờ TẮT ⇒ AUTO bị từ chối TRƯỚC mọi đọc/ghi: không tải hồ sơ, không ingest, không audit", async () => {
    m.state.tuDongBat = false;
    expect(await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" })).toEqual({ ok: false, lyDo: "TU_DONG_TAT" });
    expect(m.findUniqueDraft).not.toHaveBeenCalled();
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("[ATL-09b] không đọc được cài đặt ⇒ coi như TẮT (fail-closed), kể cả khi giá trị lạ", async () => {
    m.state.tuDongBat = "nem";
    expect(await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" })).toEqual({ ok: false, lyDo: "TU_DONG_TAT" });
    expect(m.ingest).not.toHaveBeenCalled();
    m.state.tuDongBat = "true" as unknown as boolean; // chuỗi «true» KHÔNG phải boolean true
    expect(await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" })).toEqual({ ok: false, lyDo: "TU_DONG_TAT" });
    expect(m.ingest).not.toHaveBeenCalled();
  });
  it("[ATL-09c] cờ BẬT ⇒ AUTO tạo lead; người bấm Duyệt (STAFF) KHÔNG phụ thuộc cờ — cờ tắt vẫn duyệt tay được", async () => {
    expect((await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" })).ok).toBe(true);
    expect(m.ingest).toHaveBeenCalledTimes(1);
    m.ingest.mockClear();
    m.state.draft = hoSo({ id: "ck-khac" });
    m.state.tuDongBat = false;
    expect((await taoLeadTuHoSo("ck-khac", { actor: NGUOI, tu: "STAFF" })).ok).toBe(true);
    expect(m.ingest).toHaveBeenCalledTimes(1);
  });
});

describe("[ATL-07] thua đua khi ghi kết quả", () => {
  it("[ATL-07a] lượt khác đã ghi xong ⇒ trả CÙNG lead, không báo lỗi", async () => {
    m.state.updateManyCount = [0];
    m.state.laiSauThua = { state: "COMPLETED", leadId: "lead-1", version: 4 };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-1", duplicate: true });
  });

  it("[ATL-07b] chỉ lệch version (người vừa bổ sung) mà lead đã tạo ⇒ ghi lại với version mới", async () => {
    m.state.updateManyCount = [0, 1];
    m.state.laiSauThua = { state: "IN_PROGRESS", leadId: null, version: 4 };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: true, leadId: "lead-1", duplicate: false });
    expect(m.updateMany).toHaveBeenCalledTimes(2);
    expect((m.updateMany.mock.calls[1]![0] as { where: { version: number } }).where.version).toBe(4);
  });

  it("[ATL-07c] hồ sơ bị từ chối GIỮA CHỪNG khi lead đã tạo ⇒ XUNG_DOT_PHIEN_BAN kèm id lead để đối chiếu (không nuốt)", async () => {
    m.state.updateManyCount = [0];
    m.state.laiSauThua = { state: "REJECTED", leadId: null, version: 4 };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "XUNG_DOT_PHIEN_BAN", chiTiet: "LEAD_DA_TAO:lead-1" });
  });
});

describe("[ATL-08] catalogGhiNgungNhan (thuần)", () => {
  const payload = { pages: [{ pageId: "P", campuses: [{ campusCode: "CS1", acceptingLeads: false }, { campusCode: "CS2", acceptingLeads: true }] }] };
  it("chỉ true khi đúng Page + đúng mã + acceptingLeads === false", () => {
    expect(catalogGhiNgungNhan(payload, "P", "CS1")).toBe(true);
    expect(catalogGhiNgungNhan(payload, "P", "CS2")).toBe(false);
    expect(catalogGhiNgungNhan(payload, "P", "CS3")).toBe(false);
    expect(catalogGhiNgungNhan(payload, "KHAC", "CS1")).toBe(false);
  });
  it("hình dạng lạ ⇒ false (không chặn nhầm)", () => {
    for (const x of [null, undefined, 5, "x", {}, { pages: "x" }, { pages: [null, 3] }]) expect(catalogGhiNgungNhan(x, "P", "CS1")).toBe(false);
  });
});

// ─── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Bỏ chú thích TRƯỚC khi soi (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm — luật 11). Chú thích dòng bỏ trước, chú thích khối bỏ sau. */
function maNguon(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("[ATL-NG] cổng nguồn: chưa cấu hình ⇒ KHÔNG tạo lead, hồ sơ vào Ngoại lệ, có báo người cấu hình được", () => {
  it("[ATL-NG-01] nguồn chưa sẵn sàng ⇒ ingest KHÔNG được gọi; hồ sơ → SYSTEM_EXCEPTION/NGUON_CHUA_CAU_HINH có audit; kết quả mang mã; báo MỘT lần theo (Page, mã)", async () => {
    m.state.nguon = { san: false, ma: "PAGE_CHUA_GAN_NGUON" };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { actor: actorQlcs("u1", [CS1]), tu: "STAFF" });
    expect(kq).toEqual({ ok: false, lyDo: "NGUON_CHUA_CAU_HINH", chiTiet: "NGUON_CHUA_CAU_HINH:PAGE_CHUA_GAN_NGUON" });
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.updateMany.mock.calls[0]![0]).toMatchObject({ data: { state: "SYSTEM_EXCEPTION", resultNote: "NGUON_CHUA_CAU_HINH" } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "SYSTEM_EXCEPTION", newValues: { state: "SYSTEM_EXCEPTION", ma: "NGUON_CHUA_CAU_HINH" } }));
    expect(m.baoNguon).toHaveBeenCalledWith(expect.objectContaining({ pageId: "PAGE-1", ma: "PAGE_CHUA_GAN_NGUON" }));
    expect(JSON.stringify(m.baoNguon.mock.calls)).not.toMatch(/0905|Nguyễn|84905/); // không PII
  });
  it("[ATL-NG-02] đường AUTO cũng bị chặn như STAFF (cùng một cổng)", async () => {
    m.state.nguon = { san: false, ma: "NGUON_TAT_HOAC_LOI" };
    const kq = await taoLeadTuHoSo("ck1234567890abcdef", { tu: "AUTO" });
    expect(kq).toMatchObject({ ok: false, lyDo: "NGUON_CHUA_CAU_HINH" });
    expect(m.ingest).not.toHaveBeenCalled();
  });
  it("[ATL-NG-04] NGUỒN SAU KHI TẠO: lead MỚI mà nguồn thật ra UNKNOWN / không có dòng nguồn ⇒ hồ sơ mang dấu cần xem lại + audit; nguồn đúng ⇒ không dấu; lead trùng ⇒ không phán xét", async () => {
    m.state.nguonSauTao = { group: { code: "UNKNOWN" } };
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect((m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data.resultNote).toBe("NGUON_UNKNOWN_SAU_TAO");
    expect((m.audit.mock.calls[0]![0] as { newValues: Record<string, unknown> }).newValues.canXemNguon).toBe("NGUON_UNKNOWN_SAU_TAO");
    m.updateMany.mockClear();
    m.audit.mockClear();
    m.state.nguonSauTao = null;
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect((m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data.resultNote).toBe("NGUON_KHONG_GHI_SAU_TAO");
    m.updateMany.mockClear();
    m.audit.mockClear();
    m.state.nguonSauTao = { group: { code: "MARKETING_HO" } };
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect((m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data.resultNote).toBeNull();
    expect((m.audit.mock.calls[0]![0] as { newValues: Record<string, unknown> }).newValues).not.toHaveProperty("canXemNguon");
    m.updateMany.mockClear();
    m.state.nguonSauTao = { group: { code: "UNKNOWN" } };
    m.ingest.mockResolvedValue({ ok: true, leadId: "lead-cu", duplicate: true });
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: NGUOI, tu: "STAFF" });
    expect((m.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data.resultNote).toBe("GAN_VAO_LEAD_CO_SAN");
  });

  it("[ATL-NG-03] đối chứng dương: nguồn sẵn sàng ⇒ ingest được gọi đúng một lần", async () => {
    m.state.nguon = { san: true, groupCode: "MARKETING_HO" };
    m.ingest.mockResolvedValue({ ok: true, leadId: "lead-1", duplicate: false });
    m.state.lead = { assignedToId: "u-sale" };
    await taoLeadTuHoSo("ck1234567890abcdef", { actor: actorQlcs("u1", [CS1]), tu: "STAFF" });
    expect(m.ingest).toHaveBeenCalledTimes(1);
  });
});

describe("[ATL-W1] lưới dây nối của tao-lead.ts (đọc mã nguồn)", () => {
  const ma = maNguon("lib/ai-lead/dich-vu/tao-lead.ts");
  it("[ATL-W1a] KHÔNG ghi thẳng bảng Lead — chỉ qua ingestIntakeLead", () => {
    expect(ma).not.toMatch(/\blead\s*\.\s*(create|createMany|upsert)\s*\(/);
    expect(ma).toMatch(/await ingestIntakeLead\(/);
    expect((ma.match(/\bingestIntakeLead\(/g) ?? []).length).toBe(1);
  });
  it("[ATL-W1b] đúng MỘT khai chiGhiDauVetKhiTrung và nó phụ thuộc `ctx.tu === \"AUTO\"` (AUTO = true, STAFF = false)", () => {
    expect(ma.match(/chiGhiDauVetKhiTrung\s*:\s*[^,\n]+/g)).toEqual(['chiGhiDauVetKhiTrung: ctx.tu === "AUTO"']);
  });
  it("[ATL-W1c] KHÔNG legacyWebhook / createdByUserId / allowMissingPhone / explicitOwnerId / entryPoint trong lời gọi", () => {
    for (const t of ["legacyWebhook", "createdByUserId", "allowMissingPhone", "explicitOwnerId", "entryPoint"]) {
      expect(ma, t).not.toMatch(new RegExp(`\\b${t}\\s*:`));
    }
  });
  it("[ATL-W1d] không dựng URL Facebook từ psid và không đưa psid/mid vào ghi chú", () => {
    expect(ma).not.toMatch(/facebook\.com/);
    expect(ma).not.toMatch(/\.psid/);
    const mang = ma.match(/noteLines\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(mang.length).toBeGreaterThan(20); // anti-vacuity: bắt được MẢNG ghi chú thật
    expect(mang).not.toMatch(/consentMid|psid|evidence|phone/i);
  });
  it("[ATL-W1f] cổng ai.autoCreateEnabled đứng TRƯỚC mọi truy cập DB trong taoLeadTuHoSo", () => {
    const hamTao = ma.slice(ma.indexOf("export async function taoLeadTuHoSo"));
    const iCong = hamTao.indexOf('getSetting("ai.autoCreateEnabled")');
    const iDb = hamTao.search(/(?<![A-Za-z.])db\./);
    expect(iCong).toBeGreaterThan(-1);
    expect(iDb).toBeGreaterThan(-1);
    expect(iCong).toBeLessThan(iDb);
    expect(hamTao.slice(0, iDb)).toMatch(/ctx\.tu === "AUTO"/);
  });
  it("[ATL-W1g] cổng nguồn: lời gọi docSanSangNguon đứng SAU revalidate và TRƯỚC ingestIntakeLead (neo theo LỜI GỌI, không theo import)", () => {
    const ham = ma.slice(ma.indexOf("export async function taoLeadTuHoSo"));
    const iNguon = ham.indexOf("await docSanSangNguon(");
    const iIngest = ham.indexOf("await ingestIntakeLead(");
    const iCoSo = ham.indexOf("await kiemCoSo(");
    expect(iNguon).toBeGreaterThan(-1);
    expect(iCoSo).toBeLessThan(iNguon);
    expect(iNguon).toBeLessThan(iIngest);
    expect((ham.match(/await docSanSangNguon\(/g) ?? []).length).toBe(1);
  });
  it("[ATL-W1e] không console.* nào (lỗi Prisma có thể kèm PII)", () => {
    expect(ma).not.toMatch(/console\s*\./);
  });
});
