// @vitest-environment node
// lib/ai-lead/dich-vu/thong-bao.test.ts — THÔNG BÁO của cổng AI Lead: khoá dedupe, người nhận, nội dung KHÔNG PII, lỗi không lan ra ngoài. Mã ca: [AIL-TB-01..]
import { beforeEach, describe, expect, it, vi } from "vitest";

const mk = vi.hoisted(() => ({
  notify: vi.fn(),
  quanLy: vi.fn(),
  orgUnit: vi.fn(),
  userOrgRole: vi.fn(),
  user: vi.fn(),
  ruleSet: vi.fn(),
}));
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: audit }));
vi.mock("@/lib/db", () => ({ db: { orgUnit: { findMany: mk.orgUnit }, userOrgRole: { findMany: mk.userOrgRole }, user: { findMany: mk.user }, aiLeadRuleSet: { findFirst: mk.ruleSet } } }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: mk.notify }));
vi.mock("./nguoi-duyet-co-so", () => ({ nguoiDuyetCoSo: mk.quanLy }));

import { classifyNotification } from "@/lib/notifications/catalog";
import { baoCauHinhNguonThieu, baoHoSoCanXuLy, baoQuaHan, baoSuCoAgent, datLaiGioiHanAuditLoi, GIAN_CACH_AUDIT_LOI_MS, HANH_DONG_THONG_BAO_LOI, nguoiCoQuyen } from "./thong-bao";

const NOW = new Date("2026-10-27T03:00:00.000Z");

beforeEach(() => {
  datLaiGioiHanAuditLoi();
  audit.mockReset().mockResolvedValue({});
  for (const f of Object.values(mk)) f.mockReset();
  mk.notify.mockResolvedValue(1);
  mk.ruleSet.mockResolvedValue(null); // chưa có bộ quy tắc ⇒ bậc mặc định (hành vi cũ)
  mk.quanLy.mockResolvedValue(["qlcs1"]);
  mk.orgUnit.mockResolvedValue([{ id: "ou_ho" }]);
  mk.userOrgRole.mockResolvedValue([{ userId: "u_ho" }, { userId: "u_ho" }, { userId: "u_2" }]);
  mk.user.mockImplementation(async (a: { where: { id: { in: string[] } } }) => a.where.id.in.map((id) => ({ id })));
});

describe("[AIL-TB-01] hồ sơ cần xử lý", () => {
  it("có cơ sở ⇒ báo Quản lý cơ sở của cơ sở đó; khoá dedupe `ai_lead.draft:<id>`; thuộc catalog đã khai", async () => {
    await baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW });
    expect(mk.quanLy).toHaveBeenCalledWith("cs1", expect.any(Date));
    expect(mk.notify).toHaveBeenCalledTimes(1);
    const p = mk.notify.mock.calls[0]![0] as { userIds: string[]; dedupeKey: string; title: string; body: string; href: string };
    expect(p.userIds).toEqual(["qlcs1"]);
    expect(p.dedupeKey).toBe("ai_lead.draft:d1");
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true, groupKey: "action_required", entityType: "ai_lead_draft" });
    expect(p.href).toBe("/ai-lead/d1");
  });
  it("chưa biết cơ sở (centerId null) ⇒ người có `ai-leads:review` neo Ở HỘI SỞ, KHÔNG phải Quản lý của cơ sở nào", async () => {
    await baoHoSoCanXuLy({ draftId: "d2", centerId: null, now: NOW });
    expect(mk.quanLy).not.toHaveBeenCalled();
    expect(mk.orgUnit).toHaveBeenCalledWith({ where: { centerId: null, deletedAt: null }, select: { id: true } });
    const w = (mk.userOrgRole.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(w).toMatchObject({ status: "ACTIVE", orgUnitId: { in: ["ou_ho"] }, role: { isActive: true, permissions: { some: { action: "ai-leads:review" } } } });
    expect((mk.notify.mock.calls[0]![0] as { userIds: string[] }).userIds.sort()).toEqual(["u_2", "u_ho"]);
  });
  it("không có người nhận ⇒ KHÔNG gọi notify (và không ném)", async () => {
    mk.quanLy.mockResolvedValue([]);
    await expect(baoHoSoCanXuLy({ draftId: "d3", centerId: "cs1", now: NOW })).resolves.toBeUndefined();
    expect(mk.notify).not.toHaveBeenCalled();
  });
  it("chưa có đơn vị Hội sở nào ⇒ rỗng, không ném", async () => {
    mk.orgUnit.mockResolvedValue([]);
    await baoHoSoCanXuLy({ draftId: "d4", centerId: null, now: NOW });
    expect(mk.notify).not.toHaveBeenCalled();
  });
});

describe("[AIL-TB-02] nội dung KHÔNG chứa SĐT / tên Facebook / psid / id nội bộ ngoài khoá dedupe", () => {
  it("ba loại thông báo", async () => {
    await baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW });
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    mk.userOrgRole.mockResolvedValue([{ userId: "u_ho" }]);
    await baoSuCoAgent({ incidentId: "i1", severity: "HIGH", now: NOW });
    expect(mk.notify).toHaveBeenCalledTimes(3);
    for (const [p] of mk.notify.mock.calls as [{ title: string; body: string; href: string }][]) {
      const chu = `${p.title} ${p.body}`;
      expect(chu).not.toMatch(/\d{6,}/);
      expect(chu).not.toMatch(/psid|fbName|phone|@/i);
      expect(chu).not.toContain("d1");
      // Liên kết là chỗ DUY NHẤT được mang id hồ sơ (để mở thẳng đúng hồ sơ), và không mang gì khác.
      expect(p.href).toMatch(/^\/ai-lead(\/d1)?$|^\/ai-lead\/ket-noi/);
    }
  });
});

describe("[AIL-TB-03] quá hạn nhận: nội dung TẤT ĐỊNH (không ghi số phút) để cron chạy lặp không rung lại", () => {
  it("hai lượt cách nhau ⇒ title/body/dedupeKey y hệt", async () => {
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: new Date(NOW.getTime() + 3_600_000) });
    const [a, b] = mk.notify.mock.calls.map((c) => c[0]) as { title: string; body: string; dedupeKey: string }[];
    expect(b).toEqual(a);
    expect(a!.dedupeKey).toBe("ai_lead.sla:d1");
    expect(classifyNotification("ai_lead.sla:d1")).toMatchObject({ known: true, groupKey: "due_date", priority: 1 });
  });
});

describe("[AIL-TB-04] sự cố Agent", () => {
  it("báo người có `ai-integration:view`, khoá `ai_lead.su_co:<id>`, tiêu đề phân biệt CRITICAL", async () => {
    await baoSuCoAgent({ incidentId: "i9", severity: "CRITICAL", now: NOW });
    const p = mk.notify.mock.calls[0]![0] as { dedupeKey: string; title: string; href: string };
    expect(p.dedupeKey).toBe("ai_lead.su_co:i9");
    expect(p.title).toMatch(/NGHIÊM TRỌNG/);
    expect(p.href).toBe("/ai-lead/ket-noi");
    expect((mk.userOrgRole.mock.calls[0]![0] as { where: { role: { permissions: { some: { action: string } } } } }).where.role.permissions.some.action).toBe("ai-integration:view");
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true });
  });
});

describe("[AIL-TB-04b] nguồn lead chưa cấu hình", () => {
  it("báo HỢP của sources:manage và ai-leads:configure (bỏ trùng); khoá theo (Page, mã, ngày VN); thân tin không PII; thuộc catalog", async () => {
    mk.userOrgRole.mockImplementation(async (a: { where: { role: { permissions: { some: { action: string } } } } }) =>
      a.where.role.permissions.some.action === "sources:manage" ? [{ userId: "u_a" }, { userId: "u_b" }] : [{ userId: "u_b" }, { userId: "u_c" }],
    );
    await baoCauHinhNguonThieu({ pageId: "104500000000777", ma: "PAGE_CHUA_GAN_NGUON", now: NOW });
    const p = mk.notify.mock.calls[0]![0] as { userIds: string[]; dedupeKey: string; title: string; body: string; href: string };
    expect([...p.userIds].sort()).toEqual(["u_a", "u_b", "u_c"]);
    expect(p.dedupeKey).toBe("ai_lead.nguon:104500000000777:PAGE_CHUA_GAN_NGUON:2026-10-27");
    expect(`${p.title} ${p.body}`).not.toMatch(/\d{9,}/);
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true, groupKey: "action_required" });
    // ngày VN, không phải UTC: 20:00 UTC ngày 27 đã là 03:00 ngày 28 ở Việt Nam ⇒ khoá sang ngày mới
    await baoCauHinhNguonThieu({ pageId: "104500000000777", ma: "PAGE_CHUA_GAN_NGUON", now: new Date("2026-10-27T20:00:00.000Z") });
    expect((mk.notify.mock.calls[1]![0] as { dedupeKey: string }).dedupeKey).toBe("ai_lead.nguon:104500000000777:PAGE_CHUA_GAN_NGUON:2026-10-28");
  });
  it("không có người nhận ⇒ không gửi, không ném", async () => {
    mk.userOrgRole.mockResolvedValue([]);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(baoCauHinhNguonThieu({ pageId: "104500000000777", ma: "NGUON_TAT_HOAC_LOI", now: NOW })).resolves.toBeUndefined();
    expect(mk.notify).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

const BO = (rules: unknown[]) => ({ version: 3, publishedAt: new Date("2026-11-09T00:00:00.000Z"), publishedById: "u", reason: "r", savedFromVersion: null, payload: { rules } });

describe("[AIL-TB-06] người nhận theo BỘ QUY TẮC + leo thang", () => {
  it("quy tắc DRAFT_NEEDS_STAFF bậc 0 gửi tới nhóm khác mặc định; chỉ bậc 0 gửi lúc tạo (bậc > 0 để cron)", async () => {
    mk.ruleSet.mockResolvedValue(
      BO([
        { kind: "NOTIFY", event: "DRAFT_NEEDS_STAFF", centerId: null, afterMinutes: 0, to: ["HO_REVIEWERS"] },
        { kind: "NOTIFY", event: "DRAFT_NEEDS_STAFF", centerId: null, afterMinutes: 90, to: ["HO_CONFIGURERS"] },
      ]),
    );
    await baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW });
    expect(mk.quanLy).not.toHaveBeenCalled(); // QLCS không còn trong quy tắc ⇒ không gọi
    expect(mk.notify).toHaveBeenCalledTimes(1);
    expect((mk.userOrgRole.mock.calls[0]![0] as { where: { role: { permissions: { some: { action: string } } } } }).where.role.permissions.some.action).toBe("ai-leads:review");
  });
  it("bộ quy tắc HỎNG / lỗi đọc ⇒ vẫn báo như cũ (quản lý cơ sở) — thông báo không im lặng vì quy tắc hỏng", async () => {
    mk.ruleSet.mockResolvedValue({ ...BO([]), payload: { rules: [{ kind: "LA" }] } });
    await baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW });
    expect(mk.quanLy).toHaveBeenCalledWith("cs1", expect.any(Date));
    mk.notify.mockClear();
    mk.quanLy.mockClear();
    mk.ruleSet.mockRejectedValue(new Error("db sập 0905123456"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await baoHoSoCanXuLy({ draftId: "d2", centerId: "cs1", now: NOW });
    expect(mk.quanLy).toHaveBeenCalledWith("cs1", expect.any(Date));
    expect(spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).not.toContain("0905123456");
    spy.mockRestore();
  });
  it("quá hạn: bậc leo thang có khoá RIÊNG theo (hồ sơ, sự kiện, afterMinutes), tiêu đề 'LEO THANG', người nhận theo nhóm của bậc; bậc 0 NHẬN giữ khoá cũ", async () => {
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 60, to: ["HO_REVIEWERS"] }, now: NOW });
    await baoQuaHan({ draftId: "d1", centerId: "cs1", event: "SLA_RESOLVE_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    const ps = mk.notify.mock.calls.map((c) => c[0]) as { dedupeKey: string; title: string }[];
    expect(ps.map((p) => p.dedupeKey)).toEqual(["ai_lead.sla:d1", "ai_lead.sla:d1:SLA_CLAIM_OVERDUE:60", "ai_lead.sla:d1:SLA_RESOLVE_OVERDUE:0"]);
    expect(ps[0]!.title).not.toMatch(/LEO THANG/);
    expect(ps[1]!.title).toMatch(/^LEO THANG — .*quá hạn nhận/);
    expect(ps[2]!.title).toMatch(/quá hạn xử lý/);
    for (const p of ps) expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true, groupKey: "due_date" });
  });
  it("sự cố: bậc leo thang khoá `ai_lead.su_co:<id>:m<phút>`, thuộc catalog; Admin chỉ thêm bậc leo thang thì bậc 0 MẶC ĐỊNH vẫn báo lúc nhận sự cố", async () => {
    await baoSuCoAgent({ incidentId: "i1", severity: "HIGH", now: NOW, bac: { afterMinutes: 45, to: ["HO_CONFIGURERS"] } });
    const p = mk.notify.mock.calls[0]![0] as { dedupeKey: string; title: string };
    expect(p.dedupeKey).toBe("ai_lead.su_co:i1:m45");
    expect(p.title).toMatch(/^LEO THANG — /);
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true });
    mk.notify.mockClear();
    mk.ruleSet.mockResolvedValue(BO([{ kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 30, to: ["HO_CONFIGURERS"] }]));
    await baoSuCoAgent({ incidentId: "i2", severity: "CRITICAL", now: NOW });
    // review độc lập 28/10: trước đây dòng +30 phút làm MẤT bậc 0 ⇒ sự cố nghiêm trọng không ai được báo lúc nhận. Nay bậc 0 mặc định được giữ.
    expect(mk.notify).toHaveBeenCalledTimes(1);
    expect((mk.notify.mock.calls[0]![0] as { dedupeKey: string }).dedupeKey).toBe("ai_lead.su_co:i2");
  });
  it("sự cố MỞ LẠI sau khi đã đóng: khoá riêng theo lần, tiêu đề «MỞ LẠI», thuộc catalog; không trùng khoá bậc 0 của lần trước", async () => {
    await baoSuCoAgent({ incidentId: "i7", severity: "HIGH", now: NOW, lanMoLai: 3 });
    const p = mk.notify.mock.calls[0]![0] as { dedupeKey: string; title: string };
    expect(p.dedupeKey).toBe("ai_lead.su_co:i7:r3");
    expect(p.dedupeKey).not.toBe("ai_lead.su_co:i7");
    expect(p.title).toMatch(/^MỞ LẠI — /);
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true });
  });
  it("hồ sơ cần người: bậc leo thang khoá `ai_lead.draft:<id>:m<phút>` + tiêu đề LEO THANG, thuộc catalog; bậc 0 giữ khoá cũ", async () => {
    await baoHoSoCanXuLy({ draftId: "d9", centerId: "cs1", now: NOW, bac: { afterMinutes: 45, to: ["HO_CONFIGURERS"] } });
    const p = mk.notify.mock.calls[0]![0] as { dedupeKey: string; title: string };
    expect(p.dedupeKey).toBe("ai_lead.draft:d9:m45");
    expect(p.title).toMatch(/^LEO THANG — /);
    expect(classifyNotification(p.dedupeKey)).toMatchObject({ known: true });
    mk.notify.mockClear();
    await baoHoSoCanXuLy({ draftId: "d10", centerId: "cs1", now: NOW });
    expect((mk.notify.mock.calls[0]![0] as { dedupeKey: string }).dedupeKey).toBe("ai_lead.draft:d10");
  });
});

describe("[AIL-TB-05] lỗi gửi thông báo KHÔNG lan ra ngoài và KHÔNG lộ nội dung lỗi vào log", () => {
  it("notify ném lỗi chứa PII ⇒ nuốt, log chỉ mã", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.notify.mockRejectedValue(new Error("lỗi kèm 0905123456 và Phụ huynh Minh Anh"));
    await expect(baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW })).resolves.toBeUndefined();
    const log = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(log).toMatch(/\[ai-lead:draft\]/);
    expect(log).not.toContain("0905123456");
    expect(log).not.toContain("Minh Anh");
    spy.mockRestore();
  });
  it("gửi lỗi ⇒ để lại MỘT dòng audit bền (kênh + mã, không PII) để Trung tâm kết nối đếm; audit cũng lỗi ⇒ vẫn nuốt, không ném", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.notify.mockRejectedValue(new Error("lỗi kèm 0905123456 và Phụ huynh Minh Anh"));
    await baoHoSoCanXuLy({ draftId: "d1", centerId: "cs1", now: NOW });
    expect(audit).toHaveBeenCalledTimes(1);
    const a = audit.mock.calls[0]![0] as { module: string; action: string; entityType: string; entityId: string; newValues: Record<string, unknown>; actor: { id: string | null } };
    expect(a).toMatchObject({ module: "ai-lead", action: HANH_DONG_THONG_BAO_LOI, entityType: "AiLeadThongBao", entityId: "draft", actor: { id: null } });
    expect(JSON.stringify(a)).not.toMatch(/0905123456|Minh Anh/);
    expect(Object.keys(a.newValues).sort()).toEqual(["kenh", "ma"]);
    audit.mockRejectedValue(new Error("db chết"));
    await expect(baoHoSoCanXuLy({ draftId: "d2", centerId: "cs1", now: new Date(NOW.getTime() + GIAN_CACH_AUDIT_LOI_MS) })).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it("lỗi kéo dài KHÔNG đẻ audit mỗi lần thử: cùng (kênh, mã) trong khoảng cách ⇒ MỘT dòng; qua khoảng cách ⇒ dòng mới; kênh khác ⇒ dòng riêng", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.notify.mockRejectedValue(new Error("x"));
    for (let i = 0; i < 5; i++) await baoHoSoCanXuLy({ draftId: `d${i}`, centerId: "cs1", now: new Date(NOW.getTime() + i * 60_000) });
    expect(audit).toHaveBeenCalledTimes(1);
    await baoHoSoCanXuLy({ draftId: "dx", centerId: "cs1", now: new Date(NOW.getTime() + GIAN_CACH_AUDIT_LOI_MS) });
    expect(audit).toHaveBeenCalledTimes(2);
    await baoSuCoAgent({ incidentId: "i1", severity: "HIGH", now: NOW });
    expect(audit).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
  it("gửi THÀNH CÔNG ⇒ không ghi dòng lỗi nào", async () => {
    await baoHoSoCanXuLy({ draftId: "d3", centerId: "cs1", now: NOW });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("[AIL-TB-06] nguoiCoQuyen: loại tài khoản khoá, bỏ trùng, chỉ vai còn hiệu lực", () => {
  it("lọc user active; truy vấn vai ACTIVE trong hiệu lực", async () => {
    mk.user.mockImplementation(async () => [{ id: "u_ho" }]);
    expect(await nguoiCoQuyen("ai-integration:view", NOW)).toEqual(["u_ho"]);
    const w = (mk.userOrgRole.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(w).toMatchObject({ status: "ACTIVE", effectiveFrom: { lte: NOW } });
    expect((mk.user.mock.calls[0]![0] as { where: Record<string, unknown> }).where).toMatchObject({ isActive: true, deletedAt: null });
  });
});
