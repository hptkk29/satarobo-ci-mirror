/**
 * [MPOS-*] — Server Actions của tab "Máy POS" (`_may-pos-actions.ts`).
 *
 * Canh bốn luật: quyền `payments:import-pos` ở ĐẦU mọi action; `create` PHẢI mang `centerId`;
 * GHI tự `passesScope` trên cả nguồn lẫn đích (scopedDb không che write); trùng `maThietBi`
 * ra câu tiếng Việt chứ không ném lỗi Prisma thô.
 *
 * Mọi module chạm DB đều được giả lập — bộ này chạy trong `pnpm test:unit` (không Postgres).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DataTao = {
  maThietBi: string;
  maQuay: string | null;
  ten: string | null;
  centerId: string;
  active: boolean;
  createdById: string;
};

const h = vi.hoisted(() => {
  const tx = {
    posTerminal: {
      create: vi.fn(async (a: { data: DataTao }) => ({ id: "pos_moi", ...a.data })),
      update: vi.fn(async (_a: { where: { id: string }; data: Record<string, unknown> }) => ({})),
    },
  };
  return {
    tx,
    auth: vi.fn(async () => ({ user: { id: "u_kt", name: "Kế toán HO", email: "kt@x.vn" } })),
    checkPermission: vi.fn(async (_a: string) => true),
    resolveActor: vi.fn(async (_id: string) => ({ userId: "u_kt" })),
    /** Cơ sở mà actor giả "thấy" — thay cho `getModelVisibleCenterIds` thật. */
    thay: new Set<string>(["cs1"]),
    /** Tầm nhìn MỌI cơ sở (Kế toán HO) — cổng `nhapPosDuocMoiCoSo`, ca `[MPOS-06]`. */
    pv: { moiCoSo: true },
    centerFindFirst: vi.fn(
      async (_a: { where: { id: string; isActive: boolean } }) =>
        ({ id: "cs1" }) as { id: string } | null,
    ),
    posFindUnique: vi.fn(
      async (_a: { where: { id: string } }) =>
        ({
          id: "pos_1",
          maThietBi: "T001",
          maQuay: null,
          ten: null,
          centerId: "cs1",
          active: true,
        }) as {
          id: string;
          maThietBi: string;
          maQuay: string | null;
          ten: string | null;
          centerId: string;
          active: boolean;
        } | null,
    ),
    writeAudit: vi.fn(async (_p: { action: string; tx?: unknown; entityType: string }) => ({})),
    revalidatePath: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/db-scope", () => ({
  getModelVisibleCenterIds: () => (h.pv.moiCoSo ? "ALL" : [...h.thay]),
  passesScope: (_m: string, rec: { centerId?: string | null } | null) =>
    !!rec && !!rec.centerId && h.thay.has(rec.centerId),
  scopedDb: () => ({
    center: { findFirst: h.centerFindFirst },
    posTerminal: { findUnique: h.posFindUnique },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(h.tx),
  }),
}));

import { batTatMayPosAction, suaMayPosAction, taoMayPosAction } from "./_may-pos-actions";

const HOP_LE = { maThietBi: "  T001  ", maQuay: "Q1", ten: "", centerId: "cs1" };

// Luật 18 — mỗi ca XANH khi chạy một mình: đặt lại đủ mọi hoàn cảnh ở đây.
beforeEach(() => {
  vi.clearAllMocks();
  h.thay.clear();
  h.thay.add("cs1");
  h.pv.moiCoSo = true;
  h.auth.mockResolvedValue({ user: { id: "u_kt", name: "Kế toán HO", email: "kt@x.vn" } });
  h.checkPermission.mockResolvedValue(true);
  h.centerFindFirst.mockResolvedValue({ id: "cs1" });
  h.posFindUnique.mockResolvedValue({
    id: "pos_1",
    maThietBi: "T001",
    maQuay: null,
    ten: null,
    centerId: "cs1",
    active: true,
  });
  h.tx.posTerminal.create.mockImplementation(async (a: { data: DataTao }) => ({ id: "pos_moi", ...a.data }));
});

describe("[MPOS-01] không quyền `payments:import-pos` ⇒ từ chối, không ghi gì", () => {
  it("tạo", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await taoMayPosAction(HOP_LE);
    expect(kq.ok).toBe(false);
    expect(h.checkPermission).toHaveBeenCalledWith("payments:import-pos");
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("sửa + bật/tắt", async () => {
    h.checkPermission.mockResolvedValue(false);
    expect((await suaMayPosAction({ id: "pos_1", centerId: "cs1" })).ok).toBe(false);
    expect((await batTatMayPosAction({ id: "pos_1", active: false })).ok).toBe(false);
    expect(h.posFindUnique).not.toHaveBeenCalled();
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ từ chối trước cả khi hỏi quyền", async () => {
    h.auth.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof h.auth>>);
    expect((await taoMayPosAction(HOP_LE)).ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
  });

  it("đối chứng dương: CÓ quyền thì tạo được", async () => {
    // Không có vế này thì ba ca trên xanh cả khi action từ chối MỌI người.
    expect((await taoMayPosAction(HOP_LE)).ok).toBe(true);
  });
});

describe("[MPOS-02] trùng mã thiết bị ⇒ lỗi tiếng Việt, không ném lỗi Prisma thô", () => {
  it("P2002 từ DB ⇒ { ok:false } nêu đúng mã", async () => {
    h.tx.posTerminal.create.mockRejectedValue(Object.assign(new Error("Unique"), { code: "P2002" }));
    const kq = await taoMayPosAction(HOP_LE);
    expect(kq).toEqual({ ok: false, error: expect.stringContaining('"T001" đã được khai') });
  });

  it("lỗi KHÁC thì không nuốt — ném tiếp", async () => {
    h.tx.posTerminal.create.mockRejectedValue(Object.assign(new Error("boom"), { code: "P1001" }));
    await expect(taoMayPosAction(HOP_LE)).rejects.toThrow("boom");
  });
});

describe("[MPOS-03] tạo mang centerId (SCOPED_MODELS) + ghi audit trong cùng giao dịch", () => {
  it("create có centerId, mã đã trim, chuỗi rỗng ⇒ null, người tạo", async () => {
    const kq = await taoMayPosAction(HOP_LE);
    expect(kq).toEqual({ ok: true, id: "pos_moi" });
    const data = h.tx.posTerminal.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      maThietBi: "T001",
      maQuay: "Q1",
      ten: null,
      centerId: "cs1",
      active: true,
      createdById: "u_kt",
    });
    // Ghi kép orgUnitId là việc của `lib/org/dual-write.ts` — action không tự điền.
    expect(data).not.toHaveProperty("orgUnitId");
    expect(h.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", entityType: "PosTerminal", tx: h.tx }),
    );
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/cau-hinh-van-hanh");
  });

  it("mã có khoảng trắng ở giữa ⇒ từ chối (dán nhầm hai ô)", async () => {
    const kq = await taoMayPosAction({ ...HOP_LE, maThietBi: "T0 01" });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
  });

  it("thiếu cơ sở ⇒ từ chối", async () => {
    const kq = await taoMayPosAction({ ...HOP_LE, centerId: "" });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
  });
});

describe("[MPOS-04] cổng phạm vi cho GHI — scopedDb không che write", () => {
  it("tạo vào cơ sở ngoài phạm vi ⇒ từ chối", async () => {
    const kq = await taoMayPosAction({ ...HOP_LE, centerId: "cs2" });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
  });

  it("tạo vào cơ sở không tồn tại / đã ngừng ⇒ từ chối trước lỗi khoá ngoại", async () => {
    h.centerFindFirst.mockResolvedValue(null);
    const kq = await taoMayPosAction(HOP_LE);
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
  });

  it("sửa máy của cơ sở ngoài phạm vi (NGUỒN) ⇒ từ chối", async () => {
    h.posFindUnique.mockResolvedValue({
      id: "pos_9",
      maThietBi: "T009",
      maQuay: null,
      ten: null,
      centerId: "cs2",
      active: true,
    });
    const kq = await suaMayPosAction({ id: "pos_9", centerId: "cs2" });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
  });

  it("chuyển máy sang cơ sở ngoài phạm vi (ĐÍCH) ⇒ từ chối", async () => {
    const kq = await suaMayPosAction({ id: "pos_1", centerId: "cs2" });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
  });

  it("tắt máy ngoài phạm vi ⇒ từ chối", async () => {
    h.posFindUnique.mockResolvedValue({
      id: "pos_9",
      maThietBi: "T009",
      maQuay: null,
      ten: null,
      centerId: "cs2",
      active: true,
    });
    expect((await batTatMayPosAction({ id: "pos_9", active: false })).ok).toBe(false);
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
  });
});

describe("[MPOS-06] khai máy cần phạm vi MỌI cơ sở (Q-D: chỉ Kế toán HO) — máy quyết định cơ sở của giao dịch", () => {
  // Mã TRƯỚC bản vá: chỉ `checkPermission` + `passesScope` trên cơ sở ĐÍCH ⇒ vai cơ sở có
  // `payments:import-pos` khai máy CS2 (HO chưa khai) về CS1 ⇒ mọi giao dịch của máy đó mang
  // centerId CS1: kế toán CS2 mất hàng chờ, người CS1 đọc ghi chú khách CS2.
  beforeEach(() => {
    h.pv.moiCoSo = false;
  });

  it("tạo ⇒ từ chối, không ghi, không audit", async () => {
    const kq = await taoMayPosAction(HOP_LE);
    expect(kq).toEqual({ ok: false, error: expect.stringContaining("Kế toán Hội sở") });
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("sửa + bật/tắt ⇒ từ chối, không ghi", async () => {
    expect((await suaMayPosAction({ id: "pos_1", centerId: "cs1" })).ok).toBe(false);
    expect((await batTatMayPosAction({ id: "pos_1", active: false })).ok).toBe(false);
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("đối chứng dương: phạm vi mọi cơ sở ⇒ tạo được", async () => {
    h.pv.moiCoSo = true;
    expect((await taoMayPosAction(HOP_LE)).ok).toBe(true);
  });
});

describe("[MPOS-05] sửa + bật/tắt trong phạm vi", () => {
  it("sửa KHÔNG đụng maThietBi, có centerId (ghi kép tự đổi orgUnitId)", async () => {
    h.thay.add("cs2");
    const kq = await suaMayPosAction({ id: "pos_1", maQuay: " Q2 ", ten: "Lễ tân", centerId: "cs2" });
    expect(kq.ok).toBe(true);
    const arg = h.tx.posTerminal.update.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: "pos_1" });
    expect(arg.data).toEqual({ maQuay: "Q2", ten: "Lễ tân", centerId: "cs2" });
    expect(h.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", tx: h.tx }));
  });

  it("tắt máy ⇒ update active:false + audit DISABLE; không xoá cứng", async () => {
    const kq = await batTatMayPosAction({ id: "pos_1", active: false });
    expect(kq.ok).toBe(true);
    expect(h.tx.posTerminal.update).toHaveBeenCalledWith({ where: { id: "pos_1" }, data: { active: false } });
    expect(h.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DISABLE" }));
  });

  it("đặt đúng trạng thái đang có ⇒ không ghi, không audit", async () => {
    const kq = await batTatMayPosAction({ id: "pos_1", active: true });
    expect(kq.ok).toBe(true);
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });
});

describe("[POS2-MAY-01] ba mã TCB (cửa hàng · nhà cung cấp · TCB quầy): nhận, chuẩn hoá, ghi + vết audit", () => {
  it("tạo: trim, rỗng ⇒ null; create mang đủ ba ô; audit newValues mang ba ô", async () => {
    const kq = await taoMayPosAction({ ...HOP_LE, maCuaHang: "  CH9TSGU9 ", maNhaCungCap: "NCCPH6KE", maTcbQuay: "" });
    expect(kq.ok).toBe(true);
    const data = h.tx.posTerminal.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE", maTcbQuay: null });
    const audit = h.writeAudit.mock.calls[0]![0] as unknown as { newValues: Record<string, unknown> };
    expect(audit.newValues).toMatchObject({ maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE", maTcbQuay: null });
  });

  it("tạo không gửi ba ô (biểu mẫu cũ) ⇒ ba ô null", async () => {
    await taoMayPosAction(HOP_LE);
    const data = h.tx.posTerminal.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ maCuaHang: null, maNhaCungCap: null, maTcbQuay: null });
  });

  it("sửa: ghi ba ô; audit old/new mang ba ô (giá trị cũ đọc dưới phạm vi)", async () => {
    h.posFindUnique.mockResolvedValue({
      id: "pos_1",
      maThietBi: "T001",
      maQuay: null,
      ten: null,
      centerId: "cs1",
      active: true,
      maCuaHang: "CHCU0001",
      maNhaCungCap: null,
      maTcbQuay: null,
    } as unknown as Awaited<ReturnType<typeof h.posFindUnique>>);
    const kq = await suaMayPosAction({ id: "pos_1", centerId: "cs1", maCuaHang: "CH9TSGU9", maNhaCungCap: " NCCPH6KE ", maTcbQuay: "" });
    expect(kq.ok).toBe(true);
    const arg = h.tx.posTerminal.update.mock.calls[0]![0];
    expect(arg.data).toMatchObject({ maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE", maTcbQuay: null });
    const audit = h.writeAudit.mock.calls[0]![0] as unknown as {
      oldValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
    };
    expect(audit.oldValues).toMatchObject({ maCuaHang: "CHCU0001", maNhaCungCap: null, maTcbQuay: null });
    expect(audit.newValues).toMatchObject({ maCuaHang: "CH9TSGU9", maNhaCungCap: "NCCPH6KE", maTcbQuay: null });
  });

  it("sửa KHÔNG gửi ba ô ⇒ không đụng ba ô (không xoá trắng thứ người khác vừa khai)", async () => {
    await suaMayPosAction({ id: "pos_1", maQuay: "Q2", ten: "Lễ tân", centerId: "cs1" });
    const data = h.tx.posTerminal.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["centerId", "maQuay", "ten"]);
  });
});

describe("[POS2-MAY-02] mã có khoảng trắng giữa / quá 64 ký tự ⇒ từ chối, 0 lời ghi", () => {
  it.each([
    ["maCuaHang", "CH9 TSGU9"],
    ["maNhaCungCap", "NCC\tPH6KE"],
    ["maTcbQuay", "X".repeat(65)],
  ])("tạo: %s = %j", async (truong, giaTri) => {
    const kq = await taoMayPosAction({ ...HOP_LE, [truong]: giaTri });
    expect(kq.ok).toBe(false);
    expect(h.tx.posTerminal.create).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("sửa: mã TCB quầy có khoảng trắng ⇒ từ chối, không update", async () => {
    const kq = await suaMayPosAction({ id: "pos_1", centerId: "cs1", maTcbQuay: "TCB 01" });
    expect(kq).toEqual({ ok: false, error: expect.stringContaining("khoảng trắng") });
    expect(h.tx.posTerminal.update).not.toHaveBeenCalled();
  });

  it("đối chứng dương: đúng 64 ký tự, không khoảng trắng ⇒ nhận", async () => {
    expect((await taoMayPosAction({ ...HOP_LE, maTcbQuay: "X".repeat(64) })).ok).toBe(true);
  });
});
