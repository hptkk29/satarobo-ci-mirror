// @vitest-environment node
// [AIK-ACT] Server Action của Cấu hình AI Lead: cổng phiên + quyền ĐỨNG TRƯỚC dịch vụ; đầu vào sai bị chặn; khoá không lọt ra ngoài giá trị trả.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, auth, checkAnyPermission, resolveActor, revalidatePath, dv } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  auth: vi.fn(),
  checkAnyPermission: vi.fn(),
  resolveActor: vi.fn(),
  revalidatePath: vi.fn(),
  dv: {
    taoAgent: vi.fn(),
    taoLaiKhoa: vi.fn(),
    datHoatDongAgent: vi.fn(),
    datContractStatus: vi.fn(),
    themPageChoAgent: vi.fn(),
    goPageKhoiAgent: vi.fn(),
    datTrangThaiPage: vi.fn(),
    datCoSoNhanMacDinh: vi.fn(),
    luuCoSoXuatBan: vi.fn(),
    goCoSoXuatBan: vi.fn(),
    xuatBanCatalog: vi.fn(),
    xuatBanLai: vi.fn(),
    doiChinhSach: vi.fn(),
    datTuTaoLeadChoPage: vi.fn(),
    voHieuHoaAgentTestTrenProd: vi.fn(),
    luuSlaThongBao: vi.fn(),
    datRangBuocTuTao: vi.fn(),
    khoiPhucBoQuyTac: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Cổng dùng `requireLiveSession` THẬT (đọc User qua `db`): chỉ `db.user.findUnique` được giả lập để điều khiển «tài khoản còn sống?».
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: (...a: unknown[]) => checkAnyPermission(...a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: (...a: unknown[]) => resolveActor(...a) }));
vi.mock("@/lib/audit/log", () => ({
  getAuditActor: (s: { user: { id: string; name: string } }) => ({ actorId: s.user.id, actorName: s.user.name }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "admin.satarobo.vn", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/push/origin", () => ({ originTuHeaders: () => "https://admin.satarobo.vn" }));
vi.mock("@/lib/ai-lead/dich-vu/cau-hinh", () => dv);

import * as A from "./_actions";

const ID = "cm0abcdefghijklmnopqrstuv";
const LY_DO = "Lý do kiểm thử đủ dài";
const KHOA = "9f".repeat(32);

type Ca = { ten: keyof typeof A; dv: keyof typeof dv; input: unknown; quyen: string[]; /** Hành động chỉ ĐỌC/xem trước: không làm mới trang. */ khongLamMoi?: true };
const CA: Ca[] = [
  { ten: "taoAgentAction", dv: "taoAgent", input: { name: "AI Messenger", environment: "TEST" }, quyen: ["ai-integration:manage"] },
  { ten: "taoLaiKhoaAction", dv: "taoLaiKhoa", input: { agentId: ID, secretVersionDangThay: 1, lyDo: LY_DO }, quyen: ["ai-integration:manage"] },
  { ten: "datHoatDongAgentAction", dv: "datHoatDongAgent", input: { agentId: ID, active: false, lyDo: LY_DO }, quyen: ["ai-integration:manage"] },
  { ten: "datContractStatusAction", dv: "datContractStatus", input: { agentId: ID, contractStatus: "INCOMPATIBLE", lyDo: LY_DO }, quyen: ["ai-integration:manage"] },
  { ten: "themPageAction", dv: "themPageChoAgent", input: { agentId: ID, pageId: "104500000000777" }, quyen: ["ai-leads:configure", "ai-integration:manage"] },
  { ten: "goPageAction", dv: "goPageKhoiAgent", input: { agentId: ID, pageId: "104500000000777", lyDo: LY_DO }, quyen: ["ai-leads:configure", "ai-integration:manage"] },
  { ten: "datTrangThaiPageAction", dv: "datTrangThaiPage", input: { agentId: ID, pageId: "104500000000777", state: "PAUSED", lyDo: LY_DO }, quyen: ["ai-leads:configure", "ai-integration:manage"] },
  { ten: "datCoSoNhanAction", dv: "datCoSoNhanMacDinh", input: { agentId: ID, pageId: "104500000000777", routingCenterId: ID }, quyen: ["ai-leads:configure", "ai-integration:manage"] },
  { ten: "luuCoSoXuatBanAction", dv: "luuCoSoXuatBan", input: { pageId: "104500000000777", campusCenterId: ID, acceptingLeads: true, publicVisible: true, displayOrder: 1 }, quyen: ["ai-leads:configure"] },
  { ten: "goCoSoXuatBanAction", dv: "goCoSoXuatBan", input: { pageId: "104500000000777", campusCenterId: ID }, quyen: ["ai-leads:configure"] },
  { ten: "xuatBanCatalogAction", dv: "xuatBanCatalog", input: { lyDo: LY_DO }, quyen: ["ai-leads:configure"] },
  { ten: "xuatBanLaiAction", dv: "xuatBanLai", input: { version: 1, lyDo: LY_DO }, quyen: ["ai-leads:configure"] },
  { ten: "doiChinhSachAction", dv: "doiChinhSach", input: { key: "ai.prodEnabled", value: true, lyDo: LY_DO }, quyen: ["ai-leads:policy"] },
  // Rule Builder (bộ quy tắc có version): cổng `ai-leads:configure`.
  { ten: "luuSlaThongBaoAction", dv: "luuSlaThongBao", input: { baseVersion: 0, rules: [], lyDo: LY_DO }, quyen: ["ai-leads:configure"] },
  { ten: "datRangBuocTuTaoAction", dv: "datRangBuocTuTao", input: { baseVersion: 0, agentId: ID, pageId: "104500000000777", requireConsent: true, campusCenterIds: [ID], lyDo: LY_DO }, quyen: ["ai-leads:configure"] },
  { ten: "khoiPhucBoQuyTacAction", dv: "khoiPhucBoQuyTac", input: { version: 1, lyDo: LY_DO }, quyen: ["ai-leads:configure"] },
  { ten: "xemTruocKhoiPhucAction", dv: "khoiPhucBoQuyTac", input: { version: 1 }, quyen: ["ai-leads:configure"], khongLamMoi: true },
  { ten: "voHieuHoaAgentTestTrenProdAction", dv: "voHieuHoaAgentTestTrenProd", input: { lyDo: LY_DO }, quyen: ["ai-integration:manage"] },
  // E2: tự tạo lead theo Page = quyết định RỦI RO ⇒ CHỈ `ai-integration:manage` (không nhận `ai-leads:configure`).
  { ten: "datTuTaoLeadChoPageAction", dv: "datTuTaoLeadChoPage", input: { agentId: ID, pageId: "104500000000777", bat: true, lyDo: LY_DO }, quyen: ["ai-integration:manage"] },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1", name: "Quản trị", tokenVersion: 0 } });
  findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
  checkAnyPermission.mockResolvedValue(true);
  resolveActor.mockResolvedValue({ userId: "u1", isSuperAdmin: true });
  for (const f of Object.values(dv)) f.mockResolvedValue({ ok: true });
  dv.taoAgent.mockResolvedValue({ ok: true, agentId: ID, name: "AI Messenger", environment: "TEST", secretVersion: 1, agentSecret: KHOA });
  dv.taoLaiKhoa.mockResolvedValue({ ok: true, agentId: ID, name: "AI Messenger", environment: "TEST", secretVersion: 2, agentSecret: KHOA });
});

describe("[AIK-ACT] cổng phiên + quyền", () => {
  it("[AIK-ACT-00] danh sách ca phủ ĐỦ mọi action đã export (thêm action mới mà quên ca ⇒ đỏ)", () => {
    const xuat = Object.keys(A).sort();
    expect(CA.map((c) => c.ten).sort()).toEqual(xuat);
  });

  for (const ca of CA) {
    it(`[AIK-ACT-01] ${ca.ten}: chưa đăng nhập ⇒ từ chối, dịch vụ KHÔNG được gọi`, async () => {
      auth.mockResolvedValue(null);
      const r = await (A[ca.ten] as (i: unknown) => Promise<{ ok: boolean }>)(ca.input);
      expect(r.ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
      expect(checkAnyPermission).not.toHaveBeenCalled();
    });

    it(`[AIK-ACT-02] ${ca.ten}: thiếu quyền ⇒ từ chối, hỏi ĐÚNG quyền ${ca.quyen.join("|")}, dịch vụ KHÔNG được gọi`, async () => {
      checkAnyPermission.mockResolvedValue(false);
      const r = await (A[ca.ten] as (i: unknown) => Promise<{ ok: boolean; error?: string }>)(ca.input);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/quyền/i);
      expect(checkAnyPermission).toHaveBeenCalledWith(ca.quyen);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it(`[AIK-ACT-03] ${ca.ten}: đủ quyền + đầu vào đúng ⇒ gọi dịch vụ đúng MỘT lần với người thao tác thật, rồi làm mới trang`, async () => {
      const r = await (A[ca.ten] as (i: unknown) => Promise<{ ok: boolean }>)(ca.input);
      expect(r.ok).toBe(true);
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
      const doiSo = dv[ca.dv].mock.calls[0]!;
      const nguoi = ca.dv === "doiChinhSach" ? doiSo[1] : doiSo[0];
      expect(nguoi).toEqual({ userId: "u1", userName: "Quản trị" });
      if (!ca.khongLamMoi) expect(revalidatePath).toHaveBeenCalled();
      else expect(revalidatePath).not.toHaveBeenCalled(); // xem trước KHÔNG được làm mới/ghi gì
    });

    it(`[AIK-ACT-04] ${ca.ten}: đầu vào lạ (khoá thừa) hoặc rác ⇒ từ chối, dịch vụ KHÔNG được gọi`, async () => {
      const f = A[ca.ten] as (i: unknown) => Promise<{ ok: boolean }>;
      expect((await f("rác")).ok).toBe(false);
      expect((await f({ ...(ca.input as object), khoaLa: 1 })).ok).toBe(false);
      expect((await f(null)).ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });
  }

  it("[AIK-ACT-RB] xem trước khôi phục gọi dịch vụ với xemTruoc=true (không ghi); khôi phục thật KHÔNG mang cờ đó", async () => {
    await A.xemTruocKhoiPhucAction({ version: 1 });
    expect(dv.khoiPhucBoQuyTac.mock.calls[0]![1]).toMatchObject({ version: 1, xemTruoc: true });
    dv.khoiPhucBoQuyTac.mockClear();
    await A.khoiPhucBoQuyTacAction({ version: 1, lyDo: LY_DO });
    expect(dv.khoiPhucBoQuyTac.mock.calls[0]![1].xemTruoc).toBeUndefined();
  });

  it("[AIK-ACT-RB2] khôi phục báo cho dịch vụ có ai-integration:manage hay không — hỏi LẠI mỗi lần, không tin client; xem trước cũng vậy", async () => {
    checkAnyPermission.mockImplementation(async (q: readonly string[]) => q[0] === "ai-leads:configure");
    await A.khoiPhucBoQuyTacAction({ version: 1, lyDo: LY_DO });
    await A.xemTruocKhoiPhucAction({ version: 1 });
    expect(dv.khoiPhucBoQuyTac.mock.calls.map((c) => c[2])).toEqual([false, false]);
    dv.khoiPhucBoQuyTac.mockClear();
    checkAnyPermission.mockImplementation(async () => true);
    await A.khoiPhucBoQuyTacAction({ version: 1, lyDo: LY_DO });
    await A.xemTruocKhoiPhucAction({ version: 1 });
    expect(dv.khoiPhucBoQuyTac.mock.calls.map((c) => c[2])).toEqual([true, true]);
  });

  it("[AIK-ACT-05b] TẮT tự tạo lead cho Page mẫu của gói bàn giao vẫn tới dịch vụ; BẬT thì bị chặn trước dịch vụ (FIX-02)", async () => {
    const mau = { agentId: ID, pageId: "104500000000001", lyDo: LY_DO };
    expect((await A.datTuTaoLeadChoPageAction({ ...mau, bat: false })).ok).toBe(true);
    expect(dv.datTuTaoLeadChoPage).toHaveBeenCalledTimes(1);
    dv.datTuTaoLeadChoPage.mockClear();
    const bat = await A.datTuTaoLeadChoPageAction({ ...mau, bat: true });
    expect(bat.ok).toBe(false);
    expect(dv.datTuTaoLeadChoPage).not.toHaveBeenCalled();
  });

  it("[AIK-ACT-05] thao tác nguy hiểm đòi lý do ≥ 10 ký tự TRƯỚC khi gọi dịch vụ", async () => {
    for (const ten of ["taoLaiKhoaAction", "datHoatDongAgentAction", "datContractStatusAction", "goPageAction", "datTrangThaiPageAction", "xuatBanCatalogAction", "xuatBanLaiAction", "doiChinhSachAction", "datTuTaoLeadChoPageAction", "voHieuHoaAgentTestTrenProdAction", "luuSlaThongBaoAction", "datRangBuocTuTaoAction", "khoiPhucBoQuyTacAction"] as const) {
      const ca = CA.find((c) => c.ten === ten)!;
      const f = A[ten] as (i: unknown) => Promise<{ ok: boolean; error?: string }>;
      const thieu = await f({ ...(ca.input as object), lyDo: "ngắn" });
      expect(thieu.ok, ten).toBe(false);
      expect(thieu.error, ten).toMatch(/lý do/i);
      expect((await f({ ...(ca.input as object), lyDo: "          " })).ok, ten).toBe(false);
      expect(dv[ca.dv], ten).not.toHaveBeenCalled();
    }
  });

  it("[AIK-ACT-06] Page mẫu của gói bàn giao bị chặn ngay ở lớp action", async () => {
    const r = await A.themPageAction({ agentId: ID, pageId: "104500000000001" });
    expect(r.ok).toBe(false);
    expect(dv.themPageChoAgent).not.toHaveBeenCalled();
  });

  it("[AIK-ACT-07] chính sách: chỉ hai khoá cổng PROD qua được; khoá khác (vd nhịp) bị từ chối", async () => {
    expect((await A.doiChinhSachAction({ key: "ai.heartbeatSeconds", value: 15, lyDo: LY_DO })).ok).toBe(false);
    expect((await A.doiChinhSachAction({ key: "ai.consentPolicyStatus", value: "APPROVED", lyDo: LY_DO })).ok).toBe(true);
    expect(dv.doiChinhSach).toHaveBeenCalledTimes(1);
  });
});

describe("[AIK-ACT] khoá không rò", () => {
  it("[AIK-ACT-10] khoá CHỈ nằm ở giá trị trả; không vào revalidatePath / console / lời gọi hỏi quyền", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const r = await A.taoAgentAction({ name: "AI Messenger", environment: "TEST" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.agentSecret).toBe(KHOA);
      expect(r.baseUrl).toBe("https://admin.satarobo.vn/api/ai-lead-agent/v1");
    }
    const r2 = await A.taoLaiKhoaAction({ agentId: ID, secretVersionDangThay: 1, lyDo: LY_DO });
    expect(r2.ok).toBe(true);
    for (const duoi of [revalidatePath.mock.calls, checkAnyPermission.mock.calls, log.mock.calls, err.mock.calls, warn.mock.calls, resolveActor.mock.calls]) {
      expect(JSON.stringify(duoi)).not.toContain(KHOA);
    }
  });

  it("[AIK-ACT-11] lỗi từ dịch vụ (vd thiếu khoá gốc) được chuyển nguyên, không kèm khoá", async () => {
    dv.taoAgent.mockResolvedValue({ ok: false, error: "Máy chủ chưa đặt AI_LEAD_AGENT_MASTER_KEY" });
    const r = await A.taoAgentAction({ name: "AI Messenger", environment: "TEST" });
    expect(r).toEqual({ ok: false, error: "Máy chủ chưa đặt AI_LEAD_AGENT_MASTER_KEY" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[AIK-ACT-SRC] lưới ghim mã nguồn (đọc mã đã BỎ chú thích)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/ai-lead/cau-hinh/_actions.ts"), "utf8").split("\r\n").join("\n"); // checkout CRLF của Windows không được làm lưới đỏ
  const sach = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("[AIK-ACT-SRC-01] MỌI action export bắt đầu bằng `await vaoCong(` — gỡ cổng ở một action là đỏ", () => {
    const ten = [...sach.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
    expect(ten.length).toBe(CA.length);
    for (const t of ten) {
      const i = sach.indexOf(`export async function ${t}(`);
      const than = sach.slice(i, sach.indexOf("\n}\n", i));
      const dau = than.slice(than.indexOf("{\n") + 1).trimStart();
      expect(dau.startsWith("const c = await vaoCong("), t).toBe(true);
      expect(than, t).toMatch(/if \(!c\.ok\) return c;/);
    }
  });

  it("[AIK-ACT-SRC-02] đúng một hàm `vaoCong`, gọi checkAnyPermission; tệp 'use server' không export hằng", () => {
    expect([...sach.matchAll(/async function vaoCong\(/g)]).toHaveLength(1);
    expect([...sach.matchAll(/checkAnyPermission\(quyen\)/g)]).toHaveLength(1);
    expect(sach).not.toMatch(/export const /);
    expect(src.trimStart().startsWith('"use server"')).toBe(true);
  });
});

describe("[AIL-PS] phiên phải còn SỐNG so với DB (JWT sống 30 ngày; layout chỉ chặn lúc render, KHÔNG chặn Server Action)", () => {
  for (const ca of CA) {
    const f = A[ca.ten] as (i: unknown) => Promise<{ ok: boolean }>;
    const TRUONG_HOP: [string, { isActive: boolean; tokenVersion: number; deletedAt: Date | null } | null][] = [
      ["tài khoản đã bị vô hiệu hoá (isActive=false)", { isActive: false, tokenVersion: 0, deletedAt: null }],
      ["tokenVersion lệch (đã đổi mật khẩu / bị thu phiên)", { isActive: true, tokenVersion: 3, deletedAt: null }],
      ["tài khoản đã xoá mềm", { isActive: true, tokenVersion: 0, deletedAt: new Date("2026-10-01T00:00:00Z") }],
      ["không còn bản ghi người dùng", null],
    ];
    for (const [ten, dbUser] of TRUONG_HOP) {
      it(`[AIL-PS-01] ${ca.ten}: ${ten} ⇒ từ chối, quyền KHÔNG được hỏi, dịch vụ KHÔNG được gọi`, async () => {
        findUnique.mockResolvedValue(dbUser);
        expect((await f(ca.input)).ok).toBe(false);
        expect(checkAnyPermission).not.toHaveBeenCalled();
        expect(dv[ca.dv]).not.toHaveBeenCalled();
      });
    }
    it(`[AIL-PS-02] ${ca.ten}: ĐỐI CHỨNG DƯƠNG — tài khoản còn sống (isActive, tokenVersion khớp, chưa xoá) ⇒ đi tiếp tới quyền và dịch vụ`, async () => {
      findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
      expect((await f(ca.input)).ok).toBe(true);
      expect(checkAnyPermission).toHaveBeenCalled();
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
    });
  }
});
