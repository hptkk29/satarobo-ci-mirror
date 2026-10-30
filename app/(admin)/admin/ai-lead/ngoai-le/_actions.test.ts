// @vitest-environment node
// [NLA] Server Action của «Ngoại lệ»: cổng phiên + quyền ĐỨNG TRƯỚC dịch vụ; đầu vào lạ bị chặn; lưới ghim nguồn (chịu CRLF của checkout Windows).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, auth, checkPermission, resolveActor, revalidatePath, dv } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  revalidatePath: vi.fn(),
  dv: { thuLaiTaoLead: vi.fn(), danhDauDaXuLy: vi.fn(), giaoNguoi: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Cổng dùng `requireLiveSession` THẬT (đọc User qua `db`): chỉ `db.user.findUnique` được giả lập để điều khiển «tài khoản còn sống?».
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: (...a: unknown[]) => resolveActor(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/ai-lead/dich-vu/ngoai-le", () => dv);

import * as A from "./_actions";

const LY_DO = "Lý do kiểm thử đủ dài";
type Ca = { ten: keyof typeof A; dv: keyof typeof dv; input: unknown };
const CA: Ca[] = [
  { ten: "thuLaiTaoLeadAction", dv: "thuLaiTaoLead", input: { draftId: "d1", version: 3, lyDo: LY_DO } },
  { ten: "danhDauDaXuLyAction", dv: "danhDauDaXuLy", input: { draftId: "d1", version: 3, lyDo: LY_DO } },
  { ten: "giaoNguoiAction", dv: "giaoNguoi", input: { draftId: "d1", version: 3, nguoiNhanId: "u2" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1", name: "QL Một", tokenVersion: 0 } });
  findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
  checkPermission.mockResolvedValue(true);
  resolveActor.mockResolvedValue({ userId: "u1" });
  for (const f of Object.values(dv)) f.mockResolvedValue({ ok: true, data: { id: "d1" } });
});

describe("[NLA] cổng phiên + quyền", () => {
  it("[NLA-00] danh sách ca phủ ĐỦ mọi action đã export (thêm action mới mà quên ca ⇒ đỏ)", () => {
    expect(CA.map((c) => c.ten).sort()).toEqual(Object.keys(A).sort());
  });

  for (const ca of CA) {
    const f = A[ca.ten] as (i: unknown) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;

    it(`[NLA-01] ${ca.ten}: chưa đăng nhập ⇒ từ chối, quyền KHÔNG được hỏi, dịch vụ KHÔNG được gọi`, async () => {
      auth.mockResolvedValue(null);
      expect((await f(ca.input)).ok).toBe(false);
      expect(checkPermission).not.toHaveBeenCalled();
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });

    it(`[NLA-02] ${ca.ten}: thiếu ai-leads:review ⇒ từ chối, dịch vụ KHÔNG được gọi, không làm mới trang`, async () => {
      checkPermission.mockResolvedValue(false);
      const r = await f(ca.input);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("PERMISSION_DENIED");
      expect(checkPermission).toHaveBeenCalledWith("ai-leads:review");
      expect(dv[ca.dv]).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it(`[NLA-03] ${ca.ten}: đủ quyền ⇒ gọi dịch vụ đúng MỘT lần với người thao tác thật, rồi làm mới danh sách ngoại lệ`, async () => {
      expect((await f(ca.input)).ok).toBe(true);
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
      expect(dv[ca.dv].mock.calls[0]![0]).toEqual({ actor: { userId: "u1" }, ten: "QL Một" });
      const duong = revalidatePath.mock.calls.map((c) => c[0]);
      expect(duong).toEqual(expect.arrayContaining(["/ai-lead", "/ai-lead/ngoai-le", "/ai-lead/d1"]));
    });

    it(`[NLA-04] ${ca.ten}: khoá thừa / rác / thiếu ⇒ từ chối, dịch vụ KHÔNG được gọi`, async () => {
      expect((await f("rác")).ok).toBe(false);
      expect((await f(null)).ok).toBe(false);
      expect((await f({ ...(ca.input as object), khoaLa: 1 })).ok).toBe(false);
      expect((await f({ ...(ca.input as object), version: 0 })).ok).toBe(false);
      expect((await f({ ...(ca.input as object), draftId: "" })).ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });
  }

  it("[NLA-05] lỗi nghiệp vụ của dịch vụ đi nguyên mã + câu ra ngoài; thử lại thành công làm mới cả /leads", async () => {
    dv.thuLaiTaoLead.mockResolvedValueOnce({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN", message: "xung đột" } });
    expect(await A.thuLaiTaoLeadAction(CA[0]!.input)).toEqual({ ok: false, error: { code: "XUNG_DOT_PHIEN_BAN", message: "xung đột" } });
    expect(revalidatePath).not.toHaveBeenCalled();
    await A.thuLaiTaoLeadAction(CA[0]!.input);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toContain("/leads");
  });

  it("[NLA-06] lỗi HỆ THỐNG không bị nuốt thành «lỗi nghiệp vụ» (để Sentry bắt)", async () => {
    dv.danhDauDaXuLy.mockRejectedValueOnce(new Error("db sập"));
    await expect(A.danhDauDaXuLyAction(CA[1]!.input)).rejects.toThrow("db sập");
  });
});

describe("[NLA-W] lưới ghim nguồn", () => {
  const nguon = readFileSync(resolve(process.cwd(), "app/(admin)/admin/ai-lead/ngoai-le/_actions.ts"), "utf8").split("\r\n").join("\n");
  const code = nguon.replace(/\/\/[^\n]*/g, "");

  // Khối mã của từng action export (đến hết hàm — hàm kết thúc bằng "\n}\n").
  const thanAction = (ten: string): string => {
    const i = code.indexOf(`export async function ${ten}(`);
    expect(i, `không thấy ${ten}`).toBeGreaterThanOrEqual(0);
    return code.slice(i, code.indexOf("\n}\n", i));
  };
  const TEN = ["thuLaiTaoLeadAction", "danhDauDaXuLyAction", "giaoNguoiAction"];

  it("[NLA-W1] mọi action đã export có trong lưới, và file khai 'use server' ở dòng đầu", () => {
    const xuat = [...code.matchAll(/export async function (\w+)\(/g)].map((x) => x[1]);
    expect(xuat.sort()).toEqual([...TEN].sort());
    expect(nguon.startsWith('"use server";')).toBe(true);
  });

  it("[NLA-W2] MỖI action: cổng `canhGac()` đứng TRƯỚC `safeParse` và trước lời gọi dịch vụ (quyền hỏi trước khi đọc input)", () => {
    for (const ten of TEN) {
      const than = thanAction(ten);
      const iGac = than.indexOf("await canhGac()");
      const iParse = than.indexOf(".safeParse(");
      const iDv = than.search(/await (thuLaiTaoLead|danhDauDaXuLy|giaoNguoi)\(/);
      expect(iGac, `${ten}: thiếu canhGac`).toBeGreaterThan(-1);
      expect(iParse, `${ten}: thiếu safeParse`).toBeGreaterThan(iGac);
      expect(iDv, `${ten}: thiếu lời gọi dịch vụ`).toBeGreaterThan(iParse);
    }
  });

  it("[NLA-W3] `canhGac` hỏi phiên SỐNG (requireLiveSession) TRƯỚC, rồi MỘT lần `checkPermission(\"ai-leads:review\")` TRƯỚC khi dựng Actor", () => {
    const i = code.indexOf("async function canhGac(");
    const than = code.slice(i, code.indexOf("\n}\n", i));
    const a = than.indexOf("await requireLiveSession()");
    const q = than.indexOf('await checkPermission("ai-leads:review")');
    const r = than.indexOf("await resolveActor(");
    expect(a).toBeGreaterThan(-1);
    expect(q).toBeGreaterThan(a);
    expect(r).toBeGreaterThan(q);
    expect(than.match(/checkPermission\(/g)).toHaveLength(1);
  });

  it("[NLA-W4] zod strict cho mọi lệnh; file không chứa điều kiện quyền/cơ sở nào (vai · centerId) — dịch vụ là nơi duy nhất", () => {
    expect(code.match(/\.strict\(\)/g)).toHaveLength(2);
    expect(code).not.toMatch(/\.role\b|\.roles\b|centerId|passesScope/);
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
        expect(checkPermission).not.toHaveBeenCalled();
        expect(dv[ca.dv]).not.toHaveBeenCalled();
      });
    }
    it(`[AIL-PS-02] ${ca.ten}: ĐỐI CHỨNG DƯƠNG — tài khoản còn sống (isActive, tokenVersion khớp, chưa xoá) ⇒ đi tiếp tới quyền và dịch vụ`, async () => {
      findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
      expect((await f(ca.input)).ok).toBe(true);
      expect(checkPermission).toHaveBeenCalled();
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
    });
  }
});
