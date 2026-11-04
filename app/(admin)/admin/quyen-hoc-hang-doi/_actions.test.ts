// @vitest-environment node
/**
 * [HD-ACT] Server Action của hàng đợi quyền học — HÀNH VI của cổng (không grep mã): chưa đăng nhập / dòng ngoài tầm nhìn / `checkPermission` từ chối / đầu vào hỏng
 * ⇒ DỊCH VỤ KHÔNG BAO GIỜ ĐƯỢC GỌI. Đối chứng dương: đủ cả ⇒ gọi đúng MỘT lần với đúng người, đúng dòng, đúng lý do.
 * Luật nghiệp vụ (khoá đơn, audit, idempotent…) canh ở `tests/finance/hang-doi-quyen-hoc.test.ts`; ở đây chỉ canh CỔNG của tầng action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActor: vi.fn(),
  checkPermission: vi.fn(),
  findUnique: vi.fn(),
  thuCapLai: vi.fn(),
  dongDong: vi.fn(),
  giuQuyen: vi.fn(),
  duyetThuHoi: vi.fn(),
  danhDau: vi.fn(),
  duyetHocVuot: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: () => ({ studyEntitlementXuLy: { findUnique: h.findUnique } }) }));
vi.mock("@/lib/entitlements/hang-doi/hanh-dong", () => ({
  thuCapLai: h.thuCapLai,
  dongDongHangDoi: h.dongDong,
  giuQuyenHoc: h.giuQuyen,
  duyetThuHoi: h.duyetThuHoi,
  danhDauCanDuyet: h.danhDau,
  duyetHocVuot: h.duyetHocVuot,
}));

import { danhDauCanDuyetAction, dongDongAction, duyetHocVuotAction, duyetThuHoiAction, giuQuyenAction, thuCapLaiAction } from "./_actions";

const LY_DO = "Lý do xử lý đủ dài để qua cổng";
const DONG = { id: "dong-1", centerId: "cs1", orgUnitId: "ou1" };
const CAC_ACTION = [
  { ten: "thuCapLai", chay: (i: unknown) => thuCapLaiAction(i), dichVu: h.thuCapLai, canLyDo: false },
  { ten: "dongDong", chay: (i: unknown) => dongDongAction(i), dichVu: h.dongDong, canLyDo: true },
  { ten: "giuQuyen", chay: (i: unknown) => giuQuyenAction(i), dichVu: h.giuQuyen, canLyDo: true },
  { ten: "duyetThuHoi", chay: (i: unknown) => duyetThuHoiAction(i), dichVu: h.duyetThuHoi, canLyDo: true },
  { ten: "danhDauCanDuyet", chay: (i: unknown) => danhDauCanDuyetAction(i), dichVu: h.danhDau, canLyDo: true },
] as const;
const dichVuNaoDaGoi = () => CAC_ACTION.filter((a) => a.dichVu.mock.calls.length > 0).map((a) => a.ten);

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Quản lý", email: "ql@x.vn" } });
  h.resolveActor.mockResolvedValue({ userId: "u1" });
  h.checkPermission.mockResolvedValue(true);
  h.findUnique.mockResolvedValue(DONG);
  for (const a of CAC_ACTION) a.dichVu.mockResolvedValue({ ok: true, daLam: true, thongBao: "xong" });
});

describe("[HD-ACT] cổng của Server Action", () => {
  for (const a of CAC_ACTION) {
    const vao = a.canLyDo ? { dongId: "dong-1", lyDo: LY_DO } : { dongId: "dong-1" };

    it(`[HD-ACT-01:${a.ten}] đối chứng dương: đủ đăng nhập + dòng trong tầm nhìn + checkPermission(entitlements:manage, cơ sở của dòng) ⇒ gọi dịch vụ ĐÚNG MỘT lần với đúng người/dòng/lý do`, async () => {
      const r = await a.chay(vao);
      expect(r).toMatchObject({ ok: true, daLam: true });
      expect(h.checkPermission).toHaveBeenCalledTimes(1);
      expect(h.checkPermission).toHaveBeenCalledWith("entitlements:manage", { centerId: "cs1", orgUnitId: "ou1" });
      expect(dichVuNaoDaGoi()).toEqual([a.ten]);
      expect(a.dichVu).toHaveBeenCalledTimes(1);
      expect(a.dichVu.mock.calls[0]![0]).toMatchObject({ dongId: "dong-1", nguoi: { id: "u1", name: "Quản lý" }, ...(a.canLyDo ? { lyDo: LY_DO } : {}) });
      expect(a.dichVu.mock.calls[0]![0].now).toBeInstanceOf(Date);
    });

    it(`[HD-ACT-02:${a.ten}] checkPermission TỪ CHỐI ⇒ dịch vụ KHÔNG được gọi, trả lỗi quyền`, async () => {
      h.checkPermission.mockResolvedValue(false);
      const r = await a.chay(vao);
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/không có quyền/i) });
      expect(dichVuNaoDaGoi()).toEqual([]);
    });

    it(`[HD-ACT-03:${a.ten}] chưa đăng nhập ⇒ không tra dòng, không hỏi quyền, không gọi dịch vụ`, async () => {
      h.auth.mockResolvedValue(null);
      expect(await a.chay(vao)).toEqual({ ok: false, error: expect.stringMatching(/đăng nhập/i) });
      expect(h.findUnique).not.toHaveBeenCalled();
      expect(h.checkPermission).not.toHaveBeenCalled();
      expect(dichVuNaoDaGoi()).toEqual([]);
    });

    it(`[HD-ACT-04:${a.ten}] dòng ngoài tầm nhìn cơ sở (scopedDb trả null) ⇒ "không tìm thấy", KHÔNG hỏi quyền, KHÔNG gọi dịch vụ`, async () => {
      h.findUnique.mockResolvedValue(null);
      expect(await a.chay(vao)).toEqual({ ok: false, error: expect.stringMatching(/không tìm thấy/i) });
      expect(h.checkPermission).not.toHaveBeenCalled();
      expect(dichVuNaoDaGoi()).toEqual([]);
    });

    it(`[HD-ACT-05:${a.ten}] đầu vào hỏng (thiếu dòng${a.canLyDo ? " / lý do ngắn" : ""}) ⇒ bị zod chặn TRƯỚC mọi thứ`, async () => {
      expect((await a.chay({})).ok).toBe(false);
      expect((await a.chay(null)).ok).toBe(false);
      if (a.canLyDo) expect((await a.chay({ dongId: "dong-1", lyDo: "ngắn" })).ok).toBe(false);
      expect(h.auth).not.toHaveBeenCalled();
      expect(dichVuNaoDaGoi()).toEqual([]);
    });
  }
});

describe("[HD-ACT] duyetHocVuotAction — cổng RIÊNG (approve-exception HOẶC manage; mức chính xác do dịch vụ quyết dưới khoá)", () => {
  const vao = { dongId: "dong-1", lyDo: LY_DO };
  const quyenTheoKhoa = (cap: Record<string, boolean>) => h.checkPermission.mockImplementation(async (khoa: string) => cap[khoa] === true);

  it("[HD-ACT-10] có approve-exception ⇒ gọi dịch vụ ĐÚNG MỘT lần với đúng người / dòng / lý do; chỉ hỏi quyền tại cơ sở của dòng", async () => {
    quyenTheoKhoa({ "entitlements:approve-exception": true });
    h.duyetHocVuot.mockResolvedValue({ ok: true, daLam: true, thongBao: "xong" });
    expect(await duyetHocVuotAction(vao)).toMatchObject({ ok: true, daLam: true });
    expect(h.checkPermission).toHaveBeenCalledWith("entitlements:approve-exception", { centerId: "cs1", orgUnitId: "ou1" });
    expect(h.duyetHocVuot).toHaveBeenCalledTimes(1);
    expect(h.duyetHocVuot.mock.calls[0]![0]).toMatchObject({ dongId: "dong-1", lyDo: LY_DO, nguoi: { id: "u1", name: "Quản lý" } });
  });

  it("[HD-ACT-11] chỉ có manage (QLCS) ⇒ VẪN vào được dịch vụ (dịch vụ mới là nơi từ chối phần vượt trần, và mã lỗi do nó trả); trả nguyên lỗi của dịch vụ", async () => {
    quyenTheoKhoa({ "entitlements:manage": true });
    h.duyetHocVuot.mockResolvedValue({ ok: false, ma: "KHONG_QUYEN", error: "Phần học vượt này vượt trần — cần quyền duyệt ngoại lệ." });
    expect(await duyetHocVuotAction(vao)).toEqual({ ok: false, error: expect.stringMatching(/vượt trần/) });
    expect(h.duyetHocVuot).toHaveBeenCalledTimes(1);
  });

  it("[HD-ACT-12] KHÔNG có quyền nào trong hai ⇒ dịch vụ KHÔNG được gọi", async () => {
    quyenTheoKhoa({});
    expect(await duyetHocVuotAction(vao)).toEqual({ ok: false, error: expect.stringMatching(/không có quyền/i) });
    expect(h.duyetHocVuot).not.toHaveBeenCalled();
    expect(h.checkPermission).toHaveBeenCalledTimes(2);
  });

  it("[HD-ACT-13] chưa đăng nhập / dòng ngoài tầm nhìn / đầu vào hỏng ⇒ không hỏi quyền, không gọi dịch vụ", async () => {
    quyenTheoKhoa({ "entitlements:approve-exception": true });
    h.auth.mockResolvedValue(null);
    expect(await duyetHocVuotAction(vao)).toEqual({ ok: false, error: expect.stringMatching(/đăng nhập/i) });
    h.auth.mockResolvedValue({ user: { id: "u1", name: "Quản lý", email: "ql@x.vn" } });
    h.findUnique.mockResolvedValue(null);
    expect(await duyetHocVuotAction(vao)).toEqual({ ok: false, error: expect.stringMatching(/không tìm thấy/i) });
    expect((await duyetHocVuotAction({ dongId: "dong-1", lyDo: "ngắn" })).ok).toBe(false);
    expect((await duyetHocVuotAction({})).ok).toBe(false);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.duyetHocVuot).not.toHaveBeenCalled();
  });
});
