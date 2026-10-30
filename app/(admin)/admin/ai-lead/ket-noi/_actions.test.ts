// @vitest-environment node
// [AIK-ACT-KN] Server Action của Trung tâm kết nối AI: phiên + quyền đứng TRƯỚC dịch vụ; đầu vào sai bị chặn; đồng hồ do action truyền.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, auth, checkAnyPermission, revalidatePath, dv } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  auth: vi.fn(),
  checkAnyPermission: vi.fn(),
  revalidatePath: vi.fn(),
  dv: { phatHanhThamDo: vi.fn(), ghiLanChay: vi.fn(), chuyenTrangThaiSuCo: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Cổng dùng `requireLiveSession` THẬT (đọc User qua `db`): chỉ `db.user.findUnique` được giả lập để điều khiển «tài khoản còn sống?».
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: (...a: unknown[]) => checkAnyPermission(...a) }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: (s: { user: { id: string; name: string } }) => ({ actorId: s.user.id, actorName: s.user.name }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/ai-lead/dich-vu/ket-noi", () => dv);

import * as A from "./_actions";

const ID = "cm0abcdefghijklmnopqrstuv";
const LY_DO = "Lý do kiểm thử đủ dài";
const BANG_CHUNG = { environment: "TEST", pageIds: ["104500000000777"] };

type Ca = { ten: keyof typeof A; dv: keyof typeof dv; input: unknown; quyen: string[] };
const CA: Ca[] = [
  { ten: "phatHanhThamDoAction", dv: "phatHanhThamDo", input: { agentId: ID }, quyen: ["ai-integration:manage"] },
  {
    ten: "ghiLanChayAction",
    dv: "ghiLanChay",
    input: {
      agentId: ID,
      level: "L3",
      status: "PASS",
      contractHash: "a".repeat(64),
      buildSha: "abc1234",
      correlationId: "11111111-2222-3333-4444-555555555555",
      bangChung: BANG_CHUNG,
      lyDo: LY_DO,
    },
    quyen: ["ai-integration:manage"],
  },
  { ten: "xuLySuCoAction", dv: "chuyenTrangThaiSuCo", input: { id: "inc1", hanhDong: "DONG", lyDo: LY_DO }, quyen: ["ai-leads:configure", "ai-integration:manage"] },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1", name: "Quản trị", tokenVersion: 0 } });
  findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
  checkAnyPermission.mockResolvedValue(true);
  for (const f of Object.values(dv)) f.mockResolvedValue({ ok: true });
});

describe("[AIK-ACT-KN] cổng phiên + quyền", () => {
  it("[AIK-ACT-KN-00] danh sách ca phủ ĐỦ mọi action đã export", () => {
    expect(CA.map((c) => c.ten).sort()).toEqual(Object.keys(A).sort());
  });

  for (const ca of CA) {
    const f = A[ca.ten] as (i: unknown) => Promise<{ ok: boolean; error?: string }>;
    it(`[AIK-ACT-KN-01] ${ca.ten}: chưa đăng nhập ⇒ từ chối, dịch vụ KHÔNG được gọi`, async () => {
      auth.mockResolvedValue(null);
      expect((await f(ca.input)).ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });
    it(`[AIK-ACT-KN-02] ${ca.ten}: thiếu quyền ⇒ từ chối, hỏi ĐÚNG ${ca.quyen.join("|")}, dịch vụ KHÔNG được gọi`, async () => {
      checkAnyPermission.mockResolvedValue(false);
      const r = await f(ca.input);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/quyền/i);
      expect(checkAnyPermission).toHaveBeenCalledWith(ca.quyen);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });
    it(`[AIK-ACT-KN-03] ${ca.ten}: hợp lệ ⇒ gọi dịch vụ một lần với người thao tác thật và làm mới trang`, async () => {
      expect((await f(ca.input)).ok).toBe(true);
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
      expect(dv[ca.dv].mock.calls[0]![0]).toEqual({ userId: "u1", userName: "Quản trị" });
      expect(revalidatePath).toHaveBeenCalled();
    });
    it(`[AIK-ACT-KN-04] ${ca.ten}: đầu vào rác / khoá thừa ⇒ từ chối trước dịch vụ`, async () => {
      expect((await f("rác")).ok).toBe(false);
      expect((await f({ ...(ca.input as object), khoaLa: 1 })).ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });
  }

  it("[AIK-ACT-KN-05] đồng hồ do ACTION truyền (Date), không phải dịch vụ tự đọc; loại lần chạy suy từ tầng, KHÔNG tin client", async () => {
    await A.ghiLanChayAction(CA[1]!.input);
    const [, nhap, luc] = dv.ghiLanChay.mock.calls[0]!;
    expect(luc).toBeInstanceOf(Date);
    expect(nhap.kind).toBe("E2E");
    await A.phatHanhThamDoAction({ agentId: ID });
    expect(dv.phatHanhThamDo.mock.calls[0]![2]).toBeInstanceOf(Date);
  });

  it("[AIK-ACT-KN-06] ghi lần chạy: hash/sha/uuid sai định dạng bị chặn ở lớp action; không cho client tự đặt `kind`", async () => {
    const goc = CA[1]!.input as Record<string, unknown>;
    expect((await A.ghiLanChayAction({ ...goc, contractHash: "xyz" })).ok).toBe(false);
    expect((await A.ghiLanChayAction({ ...goc, buildSha: "ZZZ" })).ok).toBe(false);
    expect((await A.ghiLanChayAction({ ...goc, correlationId: "khong-phai-uuid" })).ok).toBe(false);
    expect((await A.ghiLanChayAction({ ...goc, kind: "PILOT" })).ok).toBe(false);
    expect(dv.ghiLanChay).not.toHaveBeenCalled();
  });

  it("[AIK-ACT-KN-07] xử lý sự cố: hành động lạ bị chặn", async () => {
    expect((await A.xuLySuCoAction({ id: "inc1", hanhDong: "XOA" })).ok).toBe(false);
    expect(dv.chuyenTrangThaiSuCo).not.toHaveBeenCalled();
  });
});

describe("[AIK-ACT-KN-SRC] lưới ghim mã nguồn", () => {
  const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/ai-lead/ket-noi/_actions.ts"), "utf8").split("\r\n").join("\n"); // checkout CRLF của Windows không được làm lưới đỏ
  const sach = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  it("[AIK-ACT-KN-SRC-01] mọi action export bắt đầu bằng `await vaoCong(`", () => {
    const ten = [...sach.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
    expect(ten.length).toBe(CA.length);
    for (const t of ten) {
      const i = sach.indexOf(`export async function ${t}(`);
      const than = sach.slice(i, sach.indexOf("\n}\n", i));
      expect(than.slice(than.indexOf("{\n") + 1).trimStart().startsWith("const c = await vaoCong("), t).toBe(true);
    }
    expect([...sach.matchAll(/checkAnyPermission\(quyen\)/g)]).toHaveLength(1);
    expect(sach).not.toMatch(/export const /);
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
