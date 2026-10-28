/**
 * [POS4-Q-02] · [POS4-Q-03] · [POS4-Q-04] · [POS4-BM-01] (hành vi) — ba Server Action của màn Sức khoẻ POS Agent
 * (`_actions.ts`): tạo máy đồng bộ · tạo lại bí mật · bật/tắt. THUẦN — mọi module chạm DB / phiên được giả lập.
 *
 * Cổng là `settings:edit` (chỉ Quản trị tối cao — T24), HẸP hơn quyền XEM màn (`payments:import-pos`). Đầu vào
 * của ca từ chối cố ý HỢP LỆ về schema (đúng thứ một kẻ gọi thật gửi): gỡ cổng thì action chạy tiếp tới phép ghi
 * — chứ không dừng nhờ lỗi schema và che mất lỗ hổng.
 *
 * Bí mật (T2) là DẪN XUẤT từ `POS_AGENT_MASTER_KEY` — dùng `khoa.ts` THẬT với master key test của bộ vector:
 * bí mật trả về phải đúng `daoKhoaAgent(id, version)`, và KHÔNG lọt vào AuditLog.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

const V = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/pos/agent-hmac-vectors.json"), "utf8")) as {
  masterKey: string;
};

const AGENT_ID = "cm9posagentcs1test0000001";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u_admin", name: "Quản trị", email: "qt@x.vn" } })),
  checkPermission: vi.fn(async (_a: string) => true),
  resolveActor: vi.fn(async (_id: string) => ({ userId: "u_admin" })),
  passesScope: vi.fn((_m: string, _r: unknown, _a: unknown) => true),
  centerFind: vi.fn(async (_a: unknown): Promise<unknown> => ({ id: "cs1", code: "CS1", name: "Cơ sở 1" })),
  agentCreate: vi.fn(async (_a: unknown): Promise<unknown> => ({ id: "cm9posagentcs1test0000001", merchantCode: "NCCPH6KE" })),
  agentFind: vi.fn(async (_a: unknown): Promise<unknown> => ({
    id: "cm9posagentcs1test0000001",
    centerId: "cs1",
    merchantCode: "NCCPH6KE",
    secretVersion: 1,
    active: true,
    center: { code: "CS1", name: "Cơ sở 1" },
  })),
  agentUpdateMany: vi.fn(async (_a: unknown) => ({ count: 1 })),
  agentUpdate: vi.fn(async (_a: unknown) => ({})),
  writeAudit: vi.fn(async (_a: unknown) => ({})),
  revalidatePath: vi.fn((_p: string) => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "admin.satarobo.vn", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: () => ({ actorId: "u_admin", actorName: "Quản trị" }) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: () => ({
    center: { findFirst: h.centerFind },
    posAgent: { create: h.agentCreate, findFirst: h.agentFind, updateMany: h.agentUpdateMany, update: h.agentUpdate },
  }),
}));

import { doiTrangThaiAgentAction, taoLaiBiMatAgentAction, taoPosAgentAction } from "./_actions";

const khoa = (id: string, v: number) =>
  createHmac("sha256", Buffer.from(V.masterKey, "utf8")).update(`${id}:${v}`, "utf8").digest("hex");

const TAO = { centerId: "cs1", merchantCode: " nccph6ke " };
const TAO_LAI = { agentId: AGENT_ID, secretVersionDangThay: 1 };
const DOI = { agentId: AGENT_ID, active: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
  h.checkPermission.mockImplementation(async () => true);
  h.agentUpdateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

function chuaGhiGi() {
  expect(h.agentCreate).not.toHaveBeenCalled();
  expect(h.agentUpdateMany).not.toHaveBeenCalled();
  expect(h.agentUpdate).not.toHaveBeenCalled();
  expect(h.writeAudit).not.toHaveBeenCalled();
}

describe("[POS4-Q-02] thiếu `settings:edit` (Kế toán HO — có quyền XEM màn) ⇒ cả ba từ chối, KHÔNG ghi gì", () => {
  it("chỉ có payments:import-pos ⇒ 'Không có quyền'", async () => {
    h.checkPermission.mockImplementation(async (a: string) => a === "payments:import-pos");
    for (const kq of [await taoPosAgentAction(TAO), await taoLaiBiMatAgentAction(TAO_LAI), await doiTrangThaiAgentAction(DOI)]) {
      expect(kq.ok).toBe(false);
      expect(!kq.ok && kq.error).toMatch(/Quản trị tối cao/);
    }
    chuaGhiGi();
    // Hỏi ĐÚNG quyền hẹp — không phải quyền xem màn.
    expect(h.checkPermission.mock.calls.map((c) => c[0])).toEqual(["settings:edit", "settings:edit", "settings:edit"]);
  });

  it("chưa đăng nhập ⇒ từ chối, không hỏi quyền", async () => {
    h.auth.mockResolvedValueOnce(null as never);
    const kq = await taoPosAgentAction(TAO);
    expect(kq.ok).toBe(false);
    chuaGhiGi();
  });
});

describe("[POS4-Q-03] Quản trị tối cao ⇒ tạo được (bí mật 64 hex = khoá dẫn xuất), tạo lại ⇒ version + 1, merchant trùng ⇒ từ chối", () => {
  it("tạo: merchant chuẩn hoá IN HOA; trả đủ 5 ô cấu hình + bí mật = daoKhoaAgent(id, 1)", async () => {
    const kq = await taoPosAgentAction(TAO);
    expect(kq).toEqual({
      ok: true,
      agentId: AGENT_ID,
      merchantCode: "NCCPH6KE",
      centerCode: "CS1",
      satAroboBaseUrl: "https://admin.satarobo.vn",
      biMat: khoa(AGENT_ID, 1),
    });
    const arg = h.agentCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({ centerId: "cs1", merchantCode: "NCCPH6KE", createdById: "u_admin" });
    expect(Object.keys(arg.data)).not.toContain("secret");
  });

  it("tạo lại: updateMany CÓ ĐIỀU KIỆN theo version đang thấy ⇒ +1; bí mật = daoKhoaAgent(id, 2)", async () => {
    const kq = await taoLaiBiMatAgentAction(TAO_LAI);
    expect(kq).toMatchObject({ ok: true, agentId: AGENT_ID, secretVersion: 2, biMat: khoa(AGENT_ID, 2) });
    const arg = h.agentUpdateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: AGENT_ID, secretVersion: 1 });
    expect(arg.data).toMatchObject({ secretVersion: 2 });
    expect(arg.data.secretDoiLuc).toBeInstanceOf(Date);
  });

  it("tạo lại khi người khác VỪA đổi (đổi 0 dòng) ⇒ từ chối, không trả bí mật, không audit", async () => {
    h.agentUpdateMany.mockResolvedValueOnce({ count: 0 });
    const kq = await taoLaiBiMatAgentAction(TAO_LAI);
    expect(kq.ok).toBe(false);
    expect(JSON.stringify(kq)).not.toMatch(/[0-9a-f]{64}/);
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("merchant đã có agent (P2002) ⇒ từ chối, câu nói rõ", async () => {
    h.agentCreate.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const kq = await taoPosAgentAction(TAO);
    expect(kq).toEqual({ ok: false, error: expect.stringMatching(/NCCPH6KE.*đã có POS Agent/) });
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("merchant sai định dạng / cơ sở ngoài tầm nhìn ⇒ từ chối trước phép ghi", async () => {
    expect((await taoPosAgentAction({ centerId: "cs1", merchantCode: "NCC-PH6" })).ok).toBe(false);
    h.centerFind.mockResolvedValueOnce(null);
    expect((await taoPosAgentAction(TAO)).ok).toBe(false);
    expect(h.agentCreate).not.toHaveBeenCalled();
  });

  it("cơ sở CÓ THẬT nhưng ngoài phạm vi ⇒ tạo bị từ chối (Center ∈ SCOPE_EXEMPT — scopedDb không tự lọc)", async () => {
    // `sdb.center.findFirst` trả cơ sở (Center miễn scope); phép tạo PosAgent là phép GHI ⇒ tự hỏi
    // `passesScope("PosAgent", { centerId })` — thiếu cổng này là tạo được máy đồng bộ cho cơ sở người khác.
    h.passesScope.mockReturnValue(false);
    const kq = await taoPosAgentAction(TAO);
    expect(kq.ok).toBe(false);
    expect(h.passesScope).toHaveBeenCalledWith("PosAgent", { centerId: "cs1" }, expect.anything());
    chuaGhiGi();
    h.passesScope.mockReturnValue(true);
  });

  it("agent ngoài phạm vi (passesScope false) ⇒ tạo lại / bật-tắt bị từ chối", async () => {
    h.passesScope.mockReturnValue(false);
    expect((await taoLaiBiMatAgentAction(TAO_LAI)).ok).toBe(false);
    expect((await doiTrangThaiAgentAction(DOI)).ok).toBe(false);
    chuaGhiGi();
    h.passesScope.mockReturnValue(true);
  });

  it("bật/tắt: ghi active + audit POS_AGENT_TAT / POS_AGENT_BAT", async () => {
    expect(await doiTrangThaiAgentAction(DOI)).toEqual({ ok: true });
    expect(h.agentUpdate.mock.calls[0]![0]).toMatchObject({ where: { id: AGENT_ID }, data: { active: false } });
    expect((h.writeAudit.mock.calls[0]![0] as { action: string }).action).toBe("POS_AGENT_TAT");
    await doiTrangThaiAgentAction({ ...DOI, active: true });
    expect((h.writeAudit.mock.calls[1]![0] as { action: string }).action).toBe("POS_AGENT_BAT");
  });
});

describe("[POS4-Q-04] thiếu POS_AGENT_MASTER_KEY ⇒ ba action từ chối (không tạo / đổi được bí mật), KHÔNG ghi gì", () => {
  it.each(["", "x".repeat(31)])("master key = %j", async (gt) => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", gt);
    for (const kq of [await taoPosAgentAction(TAO), await taoLaiBiMatAgentAction(TAO_LAI), await doiTrangThaiAgentAction(DOI)]) {
      expect(kq.ok).toBe(false);
      expect(!kq.ok && kq.error).toMatch(/POS_AGENT_MASTER_KEY/);
    }
    chuaGhiGi();
  });
});

describe("[POS4-BM-01] (hành vi) bí mật KHÔNG vào AuditLog, chỉ secretVersion", () => {
  it("tạo + tạo lại: mọi đối số writeAudit KHÔNG chứa chuỗi bí mật; có secretVersion", async () => {
    const tao = await taoPosAgentAction(TAO);
    const taoLai = await taoLaiBiMatAgentAction(TAO_LAI);
    const bimat = [tao, taoLai].map((k) => (k.ok && "biMat" in k ? k.biMat : "")).filter(Boolean);
    expect(bimat).toHaveLength(2);
    const audit = JSON.stringify(h.writeAudit.mock.calls);
    for (const b of bimat) expect(audit).not.toContain(b);
    expect(audit).not.toMatch(/[0-9a-f]{64}/);
    expect((h.writeAudit.mock.calls[0]![0] as { action: string; newValues: Record<string, unknown> })).toMatchObject({
      action: "POS_AGENT_TAO",
      newValues: { merchantCode: "NCCPH6KE", secretVersion: 1 },
    });
    expect((h.writeAudit.mock.calls[1]![0] as { action: string; newValues: Record<string, unknown> })).toMatchObject({
      action: "POS_AGENT_TAO_LAI_BI_MAT",
      newValues: { secretVersion: 2 },
    });
  });
});
