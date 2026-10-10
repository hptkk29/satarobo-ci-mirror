/**
 * [NHH-FE-10b] — `loadNguonHoaHongScope`: NGUỒN QUYỀN DUY NHẤT của khung module (nạp session + actor + cờ + tầm nhìn).
 *
 * Lõi thuần (`scope.ts`) có ca riêng; còn phần NẠP — thứ quyết định quyền có thật hay không — chưa có ca nào, và đợt
 * cấy 08/10 bốn lần ra XANH ở đây:
 *   W12  bỏ đối chiếu `session.user.id === userId` ⇒ quyền của NGƯỜI KHÁC chảy sang (fail-open);
 *   W13  đọc cờ lỗi ⇒ BẬT thay vì TẮT (một lần hỏng DB là mở module cho cả hệ thống);
 *   W14  tầm nhìn Lead cứng "ALL" ⇒ QLCS CS1 thấy chip CS2.
 * Mọi mô-đun nặng (next-auth, Prisma, settings) bị giả lập: ca này canh CÁCH NỐI DÂY, không canh các mô-đun ấy.
 *
 * Fixture cố ý LỆCH: tầm nhìn ba model KHÁC nhau (Lead [cs1] · Kỳ [cs2] · Dòng sổ ALL) — cấy "đảo model" cho lại
 * đúng danh sách cũ nếu ba giá trị bằng nhau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: vi.fn() }));
vi.mock("@/lib/auth/permission-decision", () => ({ decidePermissionWithGrant: vi.fn() }));
vi.mock("@/lib/db-scope", () => ({ getModelVisibleCenterIds: vi.fn(), scopedDb: vi.fn() }));
vi.mock("@/lib/hoa-hong/feature", () => ({ laEngineHoaHongBat: vi.fn() }));
vi.mock("@/lib/nguon/feature", () => ({ laQuanLyNguonBat: vi.fn() }));

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { decidePermissionWithGrant } from "@/lib/auth/permission-decision";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { loadNguonHoaHongScope } from "./module-scope";
import { MODULE_KEYS } from "./scope";

const ACTOR = { userId: "u1", tag: "actor-that" };
const CO_SO = [
  { id: "cs1", code: "CS1", name: "Trụ sở chính" },
  { id: "cs2", code: "CS2", name: "114 Hoàng Diệu" },
];

const mAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mActor = vi.mocked(resolveActor) as unknown as ReturnType<typeof vi.fn>;
const mQuyen = vi.mocked(decidePermissionWithGrant);
const mTamNhin = vi.mocked(getModelVisibleCenterIds) as unknown as ReturnType<typeof vi.fn>;
const mScoped = vi.mocked(scopedDb) as unknown as ReturnType<typeof vi.fn>;
const mEngine = vi.mocked(laEngineHoaHongBat);
const mNguon = vi.mocked(laQuanLyNguonBat);

beforeEach(() => {
  vi.resetAllMocks();
  mAuth.mockResolvedValue({ user: { id: "u1", role: "SUPER_ADMIN" } });
  mActor.mockResolvedValue(ACTOR);
  mQuyen.mockReturnValue(true);
  mNguon.mockResolvedValue(true);
  mEngine.mockResolvedValue(true);
  mTamNhin.mockImplementation((model: string) => (model === "Lead" ? ["cs1"] : model === "CommissionPeriod" ? ["cs2"] : "ALL"));
  mScoped.mockReturnValue({ center: { findMany: vi.fn().mockResolvedValue(CO_SO) } });
});

describe("[NHH-FE-10b] loadNguonHoaHongScope — quyền: chỉ của ĐÚNG người, fail-closed", () => {
  it("session khớp userId ⇒ mọi key trong MODULE_KEYS được hỏi và has() trả theo quyết định (đối chứng dương)", async () => {
    const s = await loadNguonHoaHongScope("u1");
    expect(mQuyen).toHaveBeenCalledTimes(MODULE_KEYS.length);
    for (const k of MODULE_KEYS) expect(s.has(k), k).toBe(true);
    // Mỗi lời hỏi mang đúng actor + đúng action (không bỏ actor, không hỏi cùng một key nhiều lần)
    const daHoi = mQuyen.mock.calls.map((c) => (c[0] as { action: string }).action).sort();
    expect(daHoi).toEqual([...MODULE_KEYS].sort());
    expect((mQuyen.mock.calls[0]![0] as { actor: unknown }).actor).toBe(ACTOR);
  });

  it("quyết định của từng key được tôn trọng (chỉ key được phép mới có)", async () => {
    mQuyen.mockImplementation(({ action }) => action === "sources:view");
    const s = await loadNguonHoaHongScope("u1");
    expect(s.has("sources:view")).toBe(true);
    expect(s.has("commission:view-self")).toBe(false);
    expect(s.tabMoDuoc("nguon")).toBe(true);
    expect(s.tabMoDuoc("so")).toBe(false);
  });

  it("session của NGƯỜI KHÁC (id lệch userId) ⇒ KHÔNG quyền nào dù quyết định luôn 'được' — không mượn quyền người khác", async () => {
    mAuth.mockResolvedValue({ user: { id: "nguoi-khac", role: "SUPER_ADMIN" } });
    const s = await loadNguonHoaHongScope("u1");
    for (const k of MODULE_KEYS) expect(s.has(k), k).toBe(false);
    expect(mQuyen).not.toHaveBeenCalled();
    expect(s.tabUngVien()).toEqual([]);
  });

  it("chưa đăng nhập (session null / không có user) ⇒ KHÔNG quyền nào", async () => {
    mAuth.mockResolvedValue(null);
    const a = await loadNguonHoaHongScope("u1");
    expect(MODULE_KEYS.some((k) => a.has(k))).toBe(false);
    mAuth.mockResolvedValue({});
    const b = await loadNguonHoaHongScope("u1");
    expect(MODULE_KEYS.some((k) => b.has(k))).toBe(false);
  });
});

describe("[NHH-FE-10b] loadNguonHoaHongScope — cờ: đọc hỏng ⇒ TẮT", () => {
  it("cả hai cờ bật ⇒ co = {nguon:true, engine:true} (đối chứng dương)", async () => {
    const s = await loadNguonHoaHongScope("u1");
    expect(s.co).toEqual({ nguon: true, engine: true });
  });

  it("đọc cờ nguồn LỖI ⇒ nguon=false (engine vẫn đọc được thì giữ true — hai cờ độc lập)", async () => {
    mNguon.mockRejectedValue(new Error("db sập"));
    const s = await loadNguonHoaHongScope("u1");
    expect(s.co).toEqual({ nguon: false, engine: true });
    expect(s.tabMoDuoc("nguon")).toBe(false);
  });

  it("đọc cờ engine LỖI ⇒ engine=false, và tab hoa hồng ẩn dù quyền đủ", async () => {
    mEngine.mockRejectedValue(new Error("db sập"));
    const s = await loadNguonHoaHongScope("u1");
    expect(s.co).toEqual({ nguon: true, engine: false });
    expect(s.tabMoDuoc("so")).toBe(false);
    expect(s.tabMoDuoc("nguon")).toBe(true);
  });
});

describe("[NHH-FE-10b] loadNguonHoaHongScope — tầm nhìn cơ sở theo TỪNG model", () => {
  it("Lead [cs1] · Kỳ [cs2] · Dòng sổ ALL ⇒ chip mỗi model đúng tầm nhìn của model đó", async () => {
    const s = await loadNguonHoaHongScope("u1");
    expect(s.coSoCua("Lead").map((c) => c.code)).toEqual(["CS1"]);
    expect(s.coSoCua("CommissionPeriod").map((c) => c.code)).toEqual(["CS2"]);
    expect(s.coSoCua("CommissionTransaction").map((c) => c.code)).toEqual(["CS1", "CS2"]);
    // tầm nhìn tính từ ĐÚNG actor đã nạp
    expect(mTamNhin).toHaveBeenCalledWith("Lead", ACTOR);
    expect(mTamNhin).toHaveBeenCalledWith("CommissionPeriod", ACTOR);
    expect(mTamNhin).toHaveBeenCalledWith("CommissionTransaction", ACTOR);
    expect(mScoped).toHaveBeenCalledWith(ACTOR);
  });

  it("danh sách cơ sở đọc qua scopedDb(actor), chỉ cơ sở đang hoạt động có code", async () => {
    const findMany = vi.fn().mockResolvedValue(CO_SO);
    mScoped.mockReturnValue({ center: { findMany } });
    await loadNguonHoaHongScope("u1");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where).toEqual({ isActive: true, code: { not: null } });
  });
});
