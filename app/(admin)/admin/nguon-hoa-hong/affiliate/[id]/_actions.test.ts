// @vitest-environment node
/**
 * [ATA-*] — Server Action của TRANG CHI TIẾT ĐỐI TÁC (tài khoản truy cập): cổng ĐĂNG NHẬP → QUYỀN → CỜ → ghi, đúng thứ tự, KHÔNG gọi hàm ghi khi bị chặn.
 *
 *   [ATA-01] chưa đăng nhập ⇒ `ok:false`, hàm ghi KHÔNG được gọi, chưa hỏi quyền (auth() đứng trước)
 *   [ATA-02] thiếu `affiliates:manage` ⇒ từ chối; quyền được hỏi bằng ĐÚNG khoá `affiliates:manage` (khoá mà giao diện dùng để vẽ nút); hàm ghi KHÔNG được gọi
 *   [ATA-03] cờ affiliate TẮT ⇒ từ chối dù có quyền (action là endpoint POST độc lập với trang 404)
 *   [ATA-04] đối chứng dương: đủ đăng nhập + quyền + cờ ⇒ hàm ghi được gọi ĐÚNG MỘT LẦN, đúng người (từ PHIÊN, không từ đầu vào), `vao` nguyên văn; thành công ⇒ revalidate, thất bại ⇒ không
 *   [ATA-05] ô tìm tài khoản: gác cùng khoá; đầu vào sai ⇒ từ chối trước khi tra; cờ tắt ⇒ không tra
 *
 * Hàm ghi và đọc được GIẢ — luật ghi có ca riêng trên Postgres thật (tests/hoa-hong/affiliate-tai-khoan.spec.ts); ở đây chỉ canh DÂY NỐI của action.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  docCoModule: vi.fn(),
  revalidatePath: vi.fn(),
  lienKetUser: vi.fn(),
  goLienKet: vi.fn(),
  tamNgungCong: vi.fn(),
  moLaiCong: vi.fn(),
  doiDaiDien: vi.fn(),
  timUserDeLienKet: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: M.checkPermission }));
vi.mock("@/lib/nguon-hoa-hong/module-scope", () => ({ docCoModule: M.docCoModule }));
vi.mock("next/cache", () => ({ revalidatePath: M.revalidatePath }));
vi.mock("@/lib/affiliate/tai-khoan-truy-cap-ghi", () => ({
  lienKetUser: M.lienKetUser,
  goLienKet: M.goLienKet,
  tamNgungCong: M.tamNgungCong,
  moLaiCong: M.moLaiCong,
  doiDaiDien: M.doiDaiDien,
}));
vi.mock("@/lib/affiliate/tai-khoan-truy-cap", () => ({ timUserDeLienKet: M.timUserDeLienKet }));

import * as A from "./_actions";

const NGUOI = { userId: "u-1", ten: "Marketing Hội sở" };

type Ca = { ten: string; chay: (input: unknown) => Promise<unknown>; ghi: ReturnType<typeof vi.fn> };
const CA: Ca[] = [
  { ten: "lienKetUserAction", chay: (i) => A.lienKetUserAction(i), ghi: M.lienKetUser },
  { ten: "goLienKetAction", chay: (i) => A.goLienKetAction(i), ghi: M.goLienKet },
  { ten: "tamNgungCongAction", chay: (i) => A.tamNgungCongAction(i), ghi: M.tamNgungCong },
  { ten: "moLaiCongAction", chay: (i) => A.moLaiCongAction(i), ghi: M.moLaiCong },
  { ten: "doiDaiDienAction", chay: (i) => A.doiDaiDienAction(i), ghi: M.doiDaiDien },
];
const VAO = { id: "tk-1", updatedAtDaThay: "2026-10-13T03:00:00.000Z", lyDo: "Lý do đủ dài để qua cổng" };

beforeEach(() => {
  vi.clearAllMocks();
  M.auth.mockResolvedValue({ user: { id: "u-1", name: "Marketing Hội sở", email: "mk@satarobo.vn" } });
  M.checkPermission.mockResolvedValue(true);
  M.docCoModule.mockResolvedValue({ nguon: true, engine: true, affiliate: true });
  for (const f of [M.lienKetUser, M.goLienKet, M.tamNgungCong, M.moLaiCong, M.doiDaiDien]) f.mockResolvedValue({ ok: true, id: "x", viec: "TAO", capNhatLuc: "2026-10-13T03:00:00.000Z" });
  M.timUserDeLienKet.mockResolvedValue([{ userId: "u-9", ten: "An" }]);
});

describe("[ATA-01..03] cổng đứng trước hàm ghi", () => {
  for (const c of CA) {
    it(`${c.ten}: chưa đăng nhập ⇒ chặn, chưa hỏi quyền, chưa ghi`, async () => {
      M.auth.mockResolvedValue(null);
      expect(await c.chay(VAO)).toMatchObject({ ok: false, truong: "quyen" });
      expect(M.checkPermission).not.toHaveBeenCalled();
      expect(c.ghi).not.toHaveBeenCalled();
      M.auth.mockResolvedValue({ user: {} }); // có phiên nhưng không có id
      expect(await c.chay(VAO)).toMatchObject({ ok: false });
      expect(c.ghi).not.toHaveBeenCalled();
    });

    it(`${c.ten}: thiếu quyền ⇒ từ chối nêu khoá; hỏi ĐÚNG khoá affiliates:manage; không ghi, không đọc cờ`, async () => {
      M.checkPermission.mockResolvedValue(false);
      const r = (await c.chay(VAO)) as { ok: boolean; loi: string };
      expect(r.ok).toBe(false);
      expect(r.loi).toContain("affiliates:manage");
      expect(M.checkPermission.mock.calls.map((x) => x[0])).toEqual(["affiliates:manage"]);
      expect(M.docCoModule).not.toHaveBeenCalled(); // người không có quyền không dò được cờ
      expect(c.ghi).not.toHaveBeenCalled();
    });

    it(`${c.ten}: cờ affiliate TẮT ⇒ từ chối dù có quyền`, async () => {
      M.docCoModule.mockResolvedValue({ nguon: true, engine: true, affiliate: false });
      expect(await c.chay(VAO)).toMatchObject({ ok: false, loi: expect.stringContaining("chưa được bật") });
      expect(c.ghi).not.toHaveBeenCalled();
    });
  }
});

describe("[ATA-04] đối chứng dương + người ghi từ phiên", () => {
  for (const c of CA) {
    it(`${c.ten}: đủ cổng ⇒ gọi ĐÚNG MỘT LẦN, người từ PHIÊN (đầu vào cố mạo danh bị bỏ qua), vao nguyên văn, có now; ok ⇒ revalidate`, async () => {
      const vao = { ...VAO, nguoi: { userId: "ke-gian", ten: "Kẻ gian" } };
      await c.chay(vao);
      expect(c.ghi).toHaveBeenCalledTimes(1);
      const a = c.ghi.mock.calls[0]![0] as { nguoi: unknown; vao: unknown; now: unknown };
      expect(a.nguoi).toEqual(NGUOI);
      expect(a.vao).toBe(vao); // chuyển nguyên văn: zod ở hàm ghi quyết định (đầu vào thừa sẽ bị `.strict()` từ chối ở đó)
      expect(a.now).toBeInstanceOf(Date);
      expect(M.revalidatePath).toHaveBeenCalledTimes(1);
    });
    it(`${c.ten}: hàm ghi báo thất bại ⇒ KHÔNG revalidate, kết quả chuyển nguyên`, async () => {
      c.ghi.mockResolvedValue({ ok: false, loi: "Liên kết vừa được người khác thay đổi", truong: "vuaDoi" });
      expect(await c.chay(VAO)).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });
  }
  it("tên người ghi rơi về email rồi «Nhân viên» khi phiên thiếu tên", async () => {
    M.auth.mockResolvedValue({ user: { id: "u-2", name: null, email: "a@b.vn" } });
    await A.goLienKetAction(VAO);
    expect((M.goLienKet.mock.calls[0]![0] as { nguoi: unknown }).nguoi).toEqual({ userId: "u-2", ten: "a@b.vn" });
    vi.clearAllMocks();
    M.auth.mockResolvedValue({ user: { id: "u-3", name: null, email: null } });
    M.checkPermission.mockResolvedValue(true);
    M.docCoModule.mockResolvedValue({ affiliate: true });
    M.goLienKet.mockResolvedValue({ ok: true, capNhatLuc: "x" });
    await A.goLienKetAction(VAO);
    expect((M.goLienKet.mock.calls[0]![0] as { nguoi: unknown }).nguoi).toEqual({ userId: "u-3", ten: "Nhân viên" });
  });
});

describe("[ATA-05] ô tìm tài khoản", () => {
  it("đủ cổng ⇒ trả kết quả, gọi hàm tra với {partyId, q} đã qua zod", async () => {
    const r = await A.timUserAction({ partyId: "p-1", q: "an" });
    expect(r).toMatchObject({ ok: true, ketQua: [{ userId: "u-9" }] });
    expect(M.timUserDeLienKet).toHaveBeenCalledWith({ partyId: "p-1", q: "an" });
  });
  it("chưa đăng nhập / thiếu quyền / cờ tắt / đầu vào sai ⇒ KHÔNG tra", async () => {
    M.auth.mockResolvedValueOnce(null);
    expect(await A.timUserAction({ partyId: "p-1", q: "an" })).toMatchObject({ ok: false });
    M.checkPermission.mockResolvedValueOnce(false);
    expect(await A.timUserAction({ partyId: "p-1", q: "an" })).toMatchObject({ ok: false, error: expect.stringContaining("affiliates:manage") });
    expect(await A.timUserAction({ partyId: "p-1", q: "x".repeat(500) })).toMatchObject({ ok: false });
    expect(await A.timUserAction({ q: "an" })).toMatchObject({ ok: false });
    M.docCoModule.mockResolvedValueOnce({ affiliate: false });
    expect(await A.timUserAction({ partyId: "p-1", q: "an" })).toMatchObject({ ok: false });
    expect(M.timUserDeLienKet).not.toHaveBeenCalled();
  });
});
