// @vitest-environment node
// [AIL-ACT] Server Action của màn «Hồ sơ chờ AI» (cổng chính, xử lý PII + tạo lead): phiên SỐNG + quyền ĐỨNG TRƯỚC dịch vụ; đầu vào lạ bị chặn.
// Trước đợt này cổng này KHÔNG có test đơn vị nào (chỉ được phủ gián tiếp qua dịch vụ ở tests/ai-lead/duyet.spec.ts, vốn không đi qua action).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, auth, checkPermission, resolveActor, revalidatePath, dv } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  revalidatePath: vi.fn(),
  dv: { nhanXuLy: vi.fn(), botSung: vi.fn(), duyet: vi.fn(), tuChoi: vi.fn(), chuyenNguoi: vi.fn(), traHoSo: vi.fn(), baoDaNhanTrongPageInbox: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
// Cổng dùng `requireLiveSession` THẬT (đọc User qua `db`): chỉ `db.user.findUnique` được giả lập để điều khiển «tài khoản còn sống?».
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: (...a: unknown[]) => resolveActor(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/ai-lead/dich-vu/duyet", () => dv);

import * as A from "./_actions";

const CO_BAN = { draftId: "d1", version: 3 };
type Ca = { ten: keyof typeof A; dv: keyof typeof dv; input: unknown };
const CA: Ca[] = [
  { ten: "nhanXuLyAction", dv: "nhanXuLy", input: CO_BAN },
  { ten: "boSungAction", dv: "botSung", input: { ...CO_BAN, phone: "0905123456" } },
  { ten: "duyetAction", dv: "duyet", input: CO_BAN },
  { ten: "tuChoiAction", dv: "tuChoi", input: { ...CO_BAN, lyDo: "Không đủ điều kiện" } },
  { ten: "chuyenNguoiAction", dv: "chuyenNguoi", input: { ...CO_BAN, nguoiNhanId: "u2" } },
  { ten: "traHoSoAction", dv: "traHoSo", input: CO_BAN },
  { ten: "baoDaNhanAction", dv: "baoDaNhanTrongPageInbox", input: CO_BAN },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "u1", name: "QL Một", tokenVersion: 0 } });
  findUnique.mockResolvedValue({ isActive: true, tokenVersion: 0, deletedAt: null });
  checkPermission.mockResolvedValue(true);
  resolveActor.mockResolvedValue({ userId: "u1" });
  for (const f of Object.values(dv)) f.mockResolvedValue({ ok: true, data: { id: "d1" } });
});

describe("[AIL-ACT] cổng phiên + quyền", () => {
  it("[AIL-ACT-00] danh sách ca phủ ĐỦ mọi action đã export (thêm action mới mà quên ca ⇒ đỏ)", () => {
    expect(CA.map((c) => c.ten).sort()).toEqual(Object.keys(A).sort());
  });

  for (const ca of CA) {
    const f = A[ca.ten] as (i: unknown) => Promise<{ ok: boolean; error?: { code: string } }>;

    it(`[AIL-ACT-01] ${ca.ten}: chưa đăng nhập ⇒ UNAUTHENTICATED, quyền KHÔNG được hỏi, dịch vụ KHÔNG được gọi`, async () => {
      auth.mockResolvedValue(null);
      const r = await f(ca.input);
      expect([r.ok, r.error?.code]).toEqual([false, "UNAUTHENTICATED"]);
      expect(checkPermission).not.toHaveBeenCalled();
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });

    it(`[AIL-ACT-02] ${ca.ten}: thiếu ai-leads:review ⇒ PERMISSION_DENIED, dịch vụ KHÔNG được gọi`, async () => {
      checkPermission.mockResolvedValue(false);
      const r = await f(ca.input);
      expect([r.ok, r.error?.code]).toEqual([false, "PERMISSION_DENIED"]);
      expect(checkPermission).toHaveBeenCalledWith("ai-leads:review");
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });

    it(`[AIL-ACT-03] ${ca.ten}: đủ phiên sống + quyền ⇒ gọi dịch vụ đúng MỘT lần với người thao tác thật`, async () => {
      expect((await f(ca.input)).ok).toBe(true);
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
      expect(dv[ca.dv].mock.calls[0]![0]).toEqual({ actor: { userId: "u1" }, ten: "QL Một" });
    });

    it(`[AIL-ACT-04] ${ca.ten}: đầu vào rác / khoá thừa ⇒ từ chối, dịch vụ KHÔNG được gọi`, async () => {
      expect((await f("rác")).ok).toBe(false);
      expect((await f(null)).ok).toBe(false);
      expect((await f({ ...(ca.input as object), khoaLa: 1 })).ok).toBe(false);
      expect(dv[ca.dv]).not.toHaveBeenCalled();
    });
  }
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
    it(`[AIL-PS-02] ${ca.ten}: ĐỐI CHỨNG DƯƠNG — tài khoản còn sống ⇒ đi tiếp tới quyền và dịch vụ`, async () => {
      expect((await f(ca.input)).ok).toBe(true);
      expect(checkPermission).toHaveBeenCalled();
      expect(dv[ca.dv]).toHaveBeenCalledTimes(1);
    });
  }
});
