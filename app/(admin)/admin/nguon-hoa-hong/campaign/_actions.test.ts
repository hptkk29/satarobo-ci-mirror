// @vitest-environment node
/**
 * [AFC-ACT-*] — HÀNH VI của các Server Action tab Campaign Affiliate, mọi phụ thuộc giả lập (không Postgres, không next-auth).
 *
 * Vì sao có: lưới ghim mã (`campaign-day-noi.test.ts`) chỉ canh THỨ TỰ CHỮ trong mã; còn bộ DB gọi thẳng hàm ghi nên KHÔNG ai gọi chính các action. Ở đây chạy action thật và đo:
 *   [AFC-ACT-01] chưa đăng nhập ⇒ không hỏi quyền, không chạm hàm ghi
 *   [AFC-ACT-02] MỖI action hỏi ĐÚNG MỘT khoá của nó; khoá khác (kể cả khoá "gần giống") KHÔNG thay được — đặc biệt `manage` ≠ `activate`
 *   [AFC-ACT-03] cờ affiliate tắt (hoặc đọc cờ hỏng) ⇒ không ghi, SAU cổng quyền
 *   [AFC-ACT-04] thành công ⇒ người ghi lấy từ phiên, đồng hồ do action truyền, làm mới trang; thất bại ⇒ KHÔNG làm mới
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  docCoModule: vi.fn(),
  revalidatePath: vi.fn(),
  taoCampaign: vi.fn(),
  suaCampaign: vi.fn(),
  doiTrangThaiCampaign: vi.fn(),
  themQuyTac: vi.fn(),
  xoaQuyTac: vi.fn(),
  ganWebsite: vi.fn(),
  goWebsite: vi.fn(),
  themMembership: vi.fn(),
  doiTrangThaiMembership: vi.fn(),
  suaMembership: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: M.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: M.checkPermission }));
vi.mock("@/lib/nguon-hoa-hong/module-scope", () => ({ docCoModule: M.docCoModule }));
vi.mock("@/lib/affiliate/ghi-campaign", () => ({
  taoCampaign: M.taoCampaign,
  suaCampaign: M.suaCampaign,
  doiTrangThaiCampaign: M.doiTrangThaiCampaign,
  themQuyTac: M.themQuyTac,
  xoaQuyTac: M.xoaQuyTac,
  ganWebsite: M.ganWebsite,
  goWebsite: M.goWebsite,
}));
vi.mock("@/lib/affiliate/ghi-membership", () => ({
  themMembership: M.themMembership,
  doiTrangThaiMembership: M.doiTrangThaiMembership,
  suaMembership: M.suaMembership,
}));

import {
  doiTrangThaiCampaignAction,
  doiTrangThaiMembershipAction,
  ganWebsiteAction,
  goWebsiteAction,
  suaCampaignAction,
  suaMembershipAction,
  taoCampaignAction,
  themMembershipAction,
  themQuyTacAction,
  xoaQuyTacAction,
} from "./_actions";

const MOC = "2026-10-13T03:00:00.000Z";
const LY_DO = "Lý do đủ dài để qua cổng";

/** Mười action, khoá quyền đúng của từng cái, đầu vào hợp lệ và hàm ghi mà nó phải gọi. */
const CAC_ACTION = [
  { ten: "taoCampaignAction", khoa: "affiliate_campaigns:manage", goi: () => taoCampaignAction({ vao: { code: "X" } }), ghi: M.taoCampaign },
  { ten: "suaCampaignAction", khoa: "affiliate_campaigns:manage", goi: () => suaCampaignAction({ id: "c1", updatedAtDaThay: MOC, vao: { name: "Tên" }, lyDo: null }), ghi: M.suaCampaign },
  { ten: "doiTrangThaiCampaignAction", khoa: "affiliate_campaigns:activate", goi: () => doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: MOC, den: "PAUSED", lyDo: LY_DO }), ghi: M.doiTrangThaiCampaign },
  { ten: "themQuyTacAction", khoa: "affiliate_campaigns:manage", goi: () => themQuyTacAction({ campaignId: "c1", vao: { typeId: "t", tagId: null, sourceGroupId: "s" }, lyDo: null }), ghi: M.themQuyTac },
  { ten: "xoaQuyTacAction", khoa: "affiliate_campaigns:manage", goi: () => xoaQuyTacAction({ campaignId: "c1", ruleId: "r1", lyDo: null }), ghi: M.xoaQuyTac },
  { ten: "ganWebsiteAction", khoa: "affiliate_campaigns:manage", goi: () => ganWebsiteAction({ campaignId: "c1", siteId: "w1" }), ghi: M.ganWebsite },
  { ten: "goWebsiteAction", khoa: "affiliate_campaigns:manage", goi: () => goWebsiteAction({ campaignId: "c1", siteId: "w1", lyDo: null }), ghi: M.goWebsite },
  { ten: "themMembershipAction", khoa: "affiliate_memberships:manage", goi: () => themMembershipAction({ campaignId: "c1", vao: { partyId: "p1" } }), ghi: M.themMembership },
  { ten: "doiTrangThaiMembershipAction", khoa: "affiliate_memberships:manage", goi: () => doiTrangThaiMembershipAction({ id: "m1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null }), ghi: M.doiTrangThaiMembership },
  { ten: "suaMembershipAction", khoa: "affiliate_memberships:manage", goi: () => suaMembershipAction({ id: "m1", updatedAtDaThay: MOC, vao: { groupLabel: "A" }, lyDo: null }), ghi: M.suaMembership },
] as const;

/** Chỉ MỘT khoá được phép; mọi khoá khác trả false. */
const chiCoKhoa = (...khoa: string[]) => M.checkPermission.mockImplementation(async (k: string) => khoa.includes(k));

beforeEach(() => {
  for (const f of Object.values(M)) f.mockReset();
  M.auth.mockResolvedValue({ user: { id: "u1", name: "Hồ Đắc Phúc", email: "quan.tri@example.test" } });
  M.checkPermission.mockResolvedValue(true);
  M.docCoModule.mockResolvedValue({ nguon: true, engine: false, affiliate: true });
  M.taoCampaign.mockResolvedValue({ ok: true, id: "c1", code: "X", updatedAt: MOC });
  M.suaCampaign.mockResolvedValue({ ok: true, doi: true, truongDoi: ["name"], updatedAt: MOC });
  M.doiTrangThaiCampaign.mockResolvedValue({ ok: true, tu: "ACTIVE", den: "PAUSED", updatedAt: MOC });
  for (const f of [M.themQuyTac, M.xoaQuyTac, M.ganWebsite, M.goWebsite]) f.mockResolvedValue({ ok: true });
  M.themMembership.mockResolvedValue({ ok: true, id: "m1", viec: "TAO" });
  M.doiTrangThaiMembership.mockResolvedValue({ ok: true, tu: "PENDING", den: "ACTIVE", updatedAt: MOC });
  M.suaMembership.mockResolvedValue({ ok: true, doi: true, updatedAt: MOC });
});

describe("[AFC-ACT-01] chưa đăng nhập", () => {
  for (const a of CAC_ACTION) {
    it(`${a.ten}: không phiên ⇒ từ chối, KHÔNG hỏi quyền, KHÔNG đọc cờ, KHÔNG ghi, KHÔNG làm mới`, async () => {
      M.auth.mockResolvedValue(null);
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false, loi: "Chưa đăng nhập" });
      expect(M.checkPermission).not.toHaveBeenCalled();
      expect(M.docCoModule).not.toHaveBeenCalled();
      expect(a.ghi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("[AFC-ACT-02] khoá quyền", () => {
  for (const a of CAC_ACTION) {
    it(`${a.ten}: hỏi ĐÚNG MỘT khoá "${a.khoa}"; có khoá ⇒ ghi (đối chứng dương)`, async () => {
      chiCoKhoa(a.khoa);
      const r = await a.goi();
      expect(r.ok).toBe(true);
      expect(M.checkPermission).toHaveBeenCalledTimes(1);
      expect(M.checkPermission).toHaveBeenCalledWith(a.khoa);
      expect(a.ghi).toHaveBeenCalledTimes(1);
    });

    it(`${a.ten}: thiếu "${a.khoa}" ⇒ từ chối nêu đúng khoá, KHÔNG đọc cờ, KHÔNG ghi — dù có mọi khoá affiliate KHÁC`, async () => {
      const khac = ["affiliates:view", "affiliates:manage", "affiliate_campaigns:view", "affiliate_campaigns:manage", "affiliate_campaigns:activate", "affiliate_memberships:manage", "sources:manage"].filter((k) => k !== a.khoa);
      chiCoKhoa(...khac);
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false, truong: "quyen" });
      expect((r as { loi: string }).loi).toContain(a.khoa);
      expect(M.docCoModule).not.toHaveBeenCalled();
      expect(a.ghi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("`manage` KHÔNG kích hoạt được: có affiliate_campaigns:manage mà thiếu :activate ⇒ doiTrangThaiCampaignAction từ chối", async () => {
    chiCoKhoa("affiliate_campaigns:manage");
    const r = await doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null });
    expect(r).toMatchObject({ ok: false, truong: "quyen" });
    expect(M.doiTrangThaiCampaign).not.toHaveBeenCalled();
  });

  it("`activate` KHÔNG soạn được: chỉ có :activate ⇒ tạo / sửa / quy tắc / website đều bị từ chối", async () => {
    chiCoKhoa("affiliate_campaigns:activate");
    for (const a of CAC_ACTION.filter((x) => x.khoa === "affiliate_campaigns:manage")) {
      expect(await a.goi(), a.ten).toMatchObject({ ok: false, truong: "quyen" });
      expect(a.ghi, a.ten).not.toHaveBeenCalled();
    }
  });
});

describe("[AFC-ACT-03] cờ affiliate", () => {
  for (const a of CAC_ACTION) {
    it(`${a.ten}: cờ TẮT ⇒ không ghi, nói «chưa được bật»; đọc cờ HỎNG ⇒ cũng không ghi (fail-closed)`, async () => {
      M.docCoModule.mockResolvedValue({ nguon: true, engine: false, affiliate: false });
      expect(await a.goi()).toMatchObject({ ok: false, loi: "Affiliate chưa được bật." });
      expect(a.ghi).not.toHaveBeenCalled();
      M.docCoModule.mockRejectedValue(new Error("db sập"));
      expect(await a.goi()).toMatchObject({ ok: false, loi: "Affiliate chưa được bật." });
      expect(a.ghi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("[AFC-ACT-04] tham số chuyển cho hàm ghi & làm mới", () => {
  it("người ghi lấy từ PHIÊN (id + tên), không từ client; đồng hồ do action truyền", async () => {
    const truoc = Date.now();
    await taoCampaignAction({ vao: { code: "TET" }, nguoi: { userId: "ke-gian", ten: "Kẻ gian" } });
    const a = M.taoCampaign.mock.calls[0]![0] as { nguoi: unknown; vao: unknown; now: Date };
    expect(a.nguoi).toEqual({ userId: "u1", ten: "Hồ Đắc Phúc" });
    expect(a.vao).toEqual({ code: "TET" });
    expect(a.now).toBeInstanceOf(Date);
    expect(a.now.getTime()).toBeGreaterThanOrEqual(truoc);
  });

  it("tên người ghi rơi về email rồi mới 'Nhân viên' khi phiên không có tên", async () => {
    M.auth.mockResolvedValue({ user: { id: "u2", name: null, email: "a@example.test" } });
    await ganWebsiteAction({ campaignId: "c1", siteId: "w1" });
    expect((M.ganWebsite.mock.calls[0]![0] as { nguoi: unknown }).nguoi).toEqual({ userId: "u2", ten: "a@example.test" });
    M.auth.mockResolvedValue({ user: { id: "u3" } });
    await ganWebsiteAction({ campaignId: "c1", siteId: "w1" });
    expect((M.ganWebsite.mock.calls[1]![0] as { nguoi: unknown }).nguoi).toEqual({ userId: "u3", ten: "Nhân viên" });
  });

  it("mốc khoá lạc quan được đổi thành Date và chuyển nguyên cho hàm ghi; mốc rác bị từ chối TRƯỚC khi ghi", async () => {
    await doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: MOC, den: "PAUSED", lyDo: `  ${LY_DO}  ` });
    const a = M.doiTrangThaiCampaign.mock.calls[0]![0] as { updatedAtDaThay: Date; lyDo: string | null; den: string };
    expect(a.updatedAtDaThay.toISOString()).toBe(MOC);
    expect(a.lyDo).toBe(LY_DO);
    expect(a.den).toBe("PAUSED");
    M.doiTrangThaiCampaign.mockClear();
    const hong = await doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: "khong-phai-ngay", den: "PAUSED", lyDo: LY_DO });
    expect(hong.ok).toBe(false);
    expect(M.doiTrangThaiCampaign).not.toHaveBeenCalled();
  });

  it("trạng thái đích ngoài bảng (vd 'DRAFT' không có trong enum, 'HACK') bị zod chặn trước khi ghi", async () => {
    const r = await doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: MOC, den: "HACK", lyDo: LY_DO });
    expect(r.ok).toBe(false);
    expect(M.doiTrangThaiCampaign).not.toHaveBeenCalled();
    const m = await doiTrangThaiMembershipAction({ id: "m1", updatedAtDaThay: MOC, den: "HACK", lyDo: LY_DO });
    expect(m.ok).toBe(false);
    expect(M.doiTrangThaiMembership).not.toHaveBeenCalled();
  });

  it("thành công ⇒ làm mới cả cây /nguon-hoa-hong/campaign; thất bại ⇒ KHÔNG làm mới; sửa mà không đổi gì ⇒ không làm mới", async () => {
    for (const a of CAC_ACTION.filter((x) => x.ten !== "suaCampaignAction" && x.ten !== "suaMembershipAction")) {
      M.revalidatePath.mockClear();
      await a.goi();
      expect(M.revalidatePath, a.ten).toHaveBeenCalledWith("/nguon-hoa-hong/campaign", "layout");
    }
    for (const a of CAC_ACTION) {
      M.revalidatePath.mockClear();
      a.ghi.mockResolvedValue({ ok: false, loi: "Từ chối", truong: "x" });
      await a.goi();
      expect(M.revalidatePath, a.ten).not.toHaveBeenCalled();
    }
    M.revalidatePath.mockClear();
    M.suaCampaign.mockResolvedValue({ ok: true, doi: false, truongDoi: [], updatedAt: MOC });
    await suaCampaignAction({ id: "c1", updatedAtDaThay: MOC, vao: { name: "Tên" }, lyDo: null });
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });

  it("kết quả của hàm ghi (kể cả danh sách điều kiện chặn kích hoạt) được trả nguyên cho giao diện", async () => {
    M.doiTrangThaiCampaign.mockResolvedValue({ ok: false, loi: "Chưa kích hoạt được", truong: "kichHoat", lyDoChan: ["Chưa gắn website nào"] });
    const r = await doiTrangThaiCampaignAction({ id: "c1", updatedAtDaThay: MOC, den: "ACTIVE", lyDo: null });
    expect(r).toEqual({ ok: false, loi: "Chưa kích hoạt được", truong: "kichHoat", lyDoChan: ["Chưa gắn website nào"] });
  });
});
