// @vitest-environment node
/**
 * [NHH-FE-ACT-*] — HÀNH VI của các Server Action tab Chính sách, mọi phụ thuộc giả lập (không Postgres, không next-auth).
 *
 * Vì sao có (rà soát cấy lỗi 08/10): `chinh-sach-wiring.test.ts` [NHH-FE-WCS-01] ghim THỨ TỰ chữ trong mã (auth → assertPermission(key) →
 * resolveActor → nghiệp vụ), còn bộ DB gọi thẳng `lib/hoa-hong/chinh-sach-hanh-dong` — KHÔNG ai gọi chính các action. Hai phép cấy
 * `if (r.ok) lamMoi(...)` → xoá (action lưu/kích hoạt xong mà danh sách + chi tiết không làm mới: người dùng thấy "nháp" sau khi đã kích
 * hoạt) đều XANH 1198/1198. Ở đây chạy action thật và đo: quyền từ chối ⇒ điều phối KHÔNG được gọi; thành công ⇒ làm mới đúng đường dẫn;
 * thất bại ⇒ KHÔNG làm mới; người thao tác lấy đúng từ phiên.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(),
  assertPermission: vi.fn(),
  resolveActor: vi.fn(),
  revalidatePath: vi.fn(),
  luuNhap: vi.fn(),
  kiemHangRao: vi.fn(),
  kichHoatPhienBan: vi.fn(),
  huyBanNhap: vi.fn(),
  engineBat: vi.fn(),
  thuTinhPhienBan: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: M.revalidatePath }));
vi.mock("@/lib/hoa-hong/feature", () => ({ laEngineHoaHongBat: M.engineBat }));
vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: M.resolveActor }));
vi.mock("@/lib/auth/check-permission", () => ({ assertPermission: M.assertPermission }));
vi.mock("@/lib/hoa-hong/chinh-sach-hanh-dong", () => ({
  luuNhap: M.luuNhap,
  kiemHangRao: M.kiemHangRao,
  kichHoatPhienBan: M.kichHoatPhienBan,
  huyBanNhap: M.huyBanNhap,
}));

vi.mock("@/lib/hoa-hong/mo-phong-hanh-dong", () => ({ thuTinhPhienBan: M.thuTinhPhienBan }));

import { huyNhapAction, kichHoatAction, kiemHangRaoAction, luuNhapAction, thuTinhAction } from "./_actions";

const MOC = "2026-10-08T00:00:00.000Z";

const ACTOR = { userId: "u1", tag: "actor-da-resolve" };
const DAU_VAO_LUU = { form: { x: 1 }, policyId: "p1", versionId: "v1", updatedAtDaThay: "2026-10-08T03:00:00.000Z" };

/** Các action (bốn của PR8 + thuTinhAction của PR10), quyền đúng của từng cái, và lời gọi điều phối mà nó phải sinh ra. */
const CAC_ACTION = [
  { ten: "luuNhapAction", quyen: "commission_policies:manage", goi: () => luuNhapAction(DAU_VAO_LUU as never), dieuPhoi: M.luuNhap },
  { ten: "kiemHangRaoAction", quyen: "commission_policies:view", goi: () => kiemHangRaoAction("v1"), dieuPhoi: M.kiemHangRao },
  { ten: "kichHoatAction", quyen: "commission_policies:activate", goi: () => kichHoatAction({ versionId: "v1", xacNhanLyDo: "lý do dài đủ", updatedAtDaThay: MOC }), dieuPhoi: M.kichHoatPhienBan },
  { ten: "huyNhapAction", quyen: "commission_policies:manage", goi: () => huyNhapAction({ versionId: "v1", lyDo: "Huỷ khi đang soạn" }), dieuPhoi: M.huyBanNhap },
  { ten: "thuTinhAction", quyen: "commission_policies:manage", goi: () => thuTinhAction({ versionId: "v1", tuNgay: "2026-07-01", denNgay: "2026-09-30", orgUnitId: "ou1" }), dieuPhoi: M.thuTinhPhienBan },
] as const;

beforeEach(() => {
  for (const f of Object.values(M)) f.mockReset();
  M.auth.mockResolvedValue({ user: { id: "u1", name: "Hồ Đắc Phúc", email: "quan.tri@example.test" } });
  M.assertPermission.mockResolvedValue(undefined);
  M.engineBat.mockResolvedValue(true);
  M.resolveActor.mockResolvedValue(ACTOR);
  M.luuNhap.mockResolvedValue({ ok: true, policyId: "p1", versionId: "v1", versionNo: 1, vanBanId: null, updatedAt: "x", hangRao: null });
  M.kiemHangRao.mockResolvedValue({ ok: true, hangRao: { loi: [], canhBao: [], somNhat: null }, updatedAt: "x" });
  M.kichHoatPhienBan.mockResolvedValue({ ok: true, canhBao: [] });
  M.huyBanNhap.mockResolvedValue({ ok: true });
  M.thuTinhPhienBan.mockResolvedValue({ ok: true, ketQua: { x: 1 }, phienBanCapNhatLuc: "2026-10-08T03:00:00.000Z", chayLuc: MOC });
});

describe("[NHH-FE-ACT-01] cổng vào: chưa đăng nhập / thiếu quyền ⇒ từ chối TRƯỚC khi chạm nghiệp vụ", () => {
  for (const a of CAC_ACTION) {
    it(`${a.ten}: chưa đăng nhập ⇒ ok:false, không hỏi quyền, không resolveActor, không điều phối, không làm mới`, async () => {
      M.auth.mockResolvedValue(null);
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false, chung: "Chưa đăng nhập." });
      expect(M.assertPermission).not.toHaveBeenCalled();
      expect(M.resolveActor).not.toHaveBeenCalled();
      expect(a.dieuPhoi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });

    it(`${a.ten}: hỏi ĐÚNG MỘT quyền "${a.quyen}"; bị từ chối ⇒ nêu đúng key, điều phối KHÔNG chạy`, async () => {
      M.assertPermission.mockRejectedValue(new Error("FORBIDDEN"));
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false, loi: [] });
      expect((r as { chung: string }).chung).toContain(a.quyen);
      expect(M.assertPermission).toHaveBeenCalledTimes(1);
      expect(M.assertPermission).toHaveBeenCalledWith(a.quyen);
      expect(M.resolveActor).not.toHaveBeenCalled();
      expect(a.dieuPhoi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });

    it(`${a.ten}: được quyền ⇒ resolveActor theo id phiên, điều phối đúng một lần`, async () => {
      await a.goi();
      expect(M.assertPermission).toHaveBeenCalledWith(a.quyen);
      expect(M.resolveActor).toHaveBeenCalledWith("u1");
      expect(a.dieuPhoi).toHaveBeenCalledTimes(1);
      expect(a.dieuPhoi.mock.calls[0]![0]).toMatchObject({ actor: ACTOR });
    });
  }
});

describe("[NHH-FE-ACT-02] tham số điều phối: người thao tác từ phiên, đồng hồ do action truyền, dữ liệu client không bị đổi", () => {
  it("luuNhapAction: chuyển nguyên `vao`; nguoi = {userId, tên}; now là thời điểm gọi", async () => {
    const truoc = Date.now();
    await luuNhapAction(DAU_VAO_LUU as never);
    const a = M.luuNhap.mock.calls[0]![0] as { vao: unknown; nguoi: unknown; now: Date };
    expect(a.vao).toBe(DAU_VAO_LUU);
    expect(a.nguoi).toEqual({ userId: "u1", ten: "Hồ Đắc Phúc" });
    expect(a.now).toBeInstanceOf(Date);
    expect(a.now.getTime()).toBeGreaterThanOrEqual(truoc);
    expect(a.now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("kichHoatAction chuyển versionId + lý do xác nhận NGUYÊN VĂN (cắt khoảng trắng là việc của client/service, không phải action); null giữ null", async () => {
    await kichHoatAction({ versionId: "v7", xacNhanLyDo: "  giữ nguyên  ", updatedAtDaThay: MOC });
    expect(M.kichHoatPhienBan.mock.calls[0]![0]).toMatchObject({ versionId: "v7", xacNhanLyDo: "  giữ nguyên  ", updatedAtDaThay: MOC }); // mốc người duyệt đã thấy đi hết đường xuống điều phối
    await kichHoatAction({ versionId: "v8", xacNhanLyDo: null, updatedAtDaThay: MOC });
    expect(M.kichHoatPhienBan.mock.calls[1]![0]).toMatchObject({ versionId: "v8", xacNhanLyDo: null });
  });

  it("huyNhapAction chuyển versionId + lý do; kiemHangRaoAction chuyển versionId", async () => {
    await huyNhapAction({ versionId: "v9", lyDo: "thôi" });
    expect(M.huyBanNhap.mock.calls[0]![0]).toMatchObject({ versionId: "v9", lyDo: "thôi" });
    await kiemHangRaoAction("v10");
    expect(M.kiemHangRao.mock.calls[0]![0]).toMatchObject({ versionId: "v10" });
  });

  it("tên người thao tác: name → email → id (không để trống trong nhật ký)", async () => {
    M.auth.mockResolvedValue({ user: { id: "u2", name: null, email: "kt@satarobo.vn" } });
    await huyNhapAction({ versionId: "v1", lyDo: "x" });
    expect(M.huyBanNhap.mock.calls[0]![0]).toMatchObject({ nguoi: { userId: "u2", ten: "kt@satarobo.vn" } });
    M.auth.mockResolvedValue({ user: { id: "u3", name: null, email: null } });
    await huyNhapAction({ versionId: "v1", lyDo: "x" });
    expect(M.huyBanNhap.mock.calls[1]![0]).toMatchObject({ nguoi: { userId: "u3", ten: "u3" } });
  });
});

describe("[NHH-FE-ACT-03] làm mới trang: thành công ⇒ danh sách (+ chi tiết khi biết id) được làm mới; thất bại hoặc chỉ đọc ⇒ KHÔNG", () => {
  it("luuNhapAction ok ⇒ danh sách VÀ trang chi tiết của chính sách vừa lưu", async () => {
    M.luuNhap.mockResolvedValue({ ok: true, policyId: "pol-77", versionId: "v1", versionNo: 1, vanBanId: null, updatedAt: "x", hangRao: null });
    await luuNhapAction(DAU_VAO_LUU as never);
    expect(M.revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/nguon-hoa-hong/chinh-sach", "/nguon-hoa-hong/chinh-sach/pol-77"]);
  });

  it("kichHoatAction ok ⇒ làm mới danh sách (bảng và hàng chờ đổi trạng thái); huyNhapAction ok ⇒ cũng vậy", async () => {
    await kichHoatAction({ versionId: "v1", xacNhanLyDo: null, updatedAtDaThay: MOC });
    expect(M.revalidatePath).toHaveBeenCalledWith("/nguon-hoa-hong/chinh-sach");
    M.revalidatePath.mockClear();
    await huyNhapAction({ versionId: "v1", lyDo: "x" });
    expect(M.revalidatePath).toHaveBeenCalledWith("/nguon-hoa-hong/chinh-sach");
  });

  it("điều phối trả ok:false ⇒ KHÔNG làm mới (dữ liệu chưa đổi); kiemHangRaoAction chỉ đọc ⇒ không bao giờ làm mới", async () => {
    M.luuNhap.mockResolvedValue({ ok: false, loi: [], chung: "trùng mã" });
    M.kichHoatPhienBan.mockResolvedValue({ ok: false, loi: [], chung: "bị chặn" });
    M.huyBanNhap.mockResolvedValue({ ok: false, loi: [], chung: "không huỷ được" });
    await luuNhapAction(DAU_VAO_LUU as never);
    await kichHoatAction({ versionId: "v1", xacNhanLyDo: null, updatedAtDaThay: MOC });
    await huyNhapAction({ versionId: "v1", lyDo: "x" });
    await kiemHangRaoAction("v1");
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });

  it("kết quả điều phối đi qua NGUYÊN VẸN tới client (hàng rào, lỗi theo ô, id văn bản mồ côi không bị action nuốt)", async () => {
    const that = { ok: false, loi: [{ truong: "policyCode", thongBao: "trùng", buoc: "boi-canh" }], chung: null, vanBanIdDaTao: "vb1" };
    M.luuNhap.mockResolvedValue(that);
    expect(await luuNhapAction(DAU_VAO_LUU as never)).toBe(that);
    const chan = { ok: false, loi: [], chung: "x", hangRao: { loi: [{ ma: "VUOT_TRAN", thongBao: "t" }], canhBao: [], somNhat: null } };
    M.kichHoatPhienBan.mockResolvedValue(chan);
    expect(await kichHoatAction({ versionId: "v1", xacNhanLyDo: null, updatedAtDaThay: MOC })).toBe(chan);
  });
});

describe("[NHH-H-FLAG-01] cờ `hoaHong.engineBat` TẮT ⇒ màn Chính sách là 404 thì ĐƯỜNG GHI cũng phải đóng (action gọi thẳng không được lách màn)", () => {
  for (const a of CAC_ACTION) {
    it(`${a.ten}: cờ tắt ⇒ ok:false nêu "chưa được bật", điều phối KHÔNG chạy, không resolveActor, không làm mới`, async () => {
      M.engineBat.mockResolvedValue(false);
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false, loi: [] });
      expect((r as { chung: string }).chung).toMatch(/chưa được bật/);
      expect(M.resolveActor).not.toHaveBeenCalled();
      expect(a.dieuPhoi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });

    it(`${a.ten}: đọc cờ LỖI ⇒ coi là TẮT (fail-closed), không ném ra client`, async () => {
      M.engineBat.mockRejectedValue(new Error("db down"));
      const r = await a.goi();
      expect(r).toMatchObject({ ok: false });
      expect(a.dieuPhoi).not.toHaveBeenCalled();
    });

    it(`${a.ten}: thiếu QUYỀN thắng thiếu CỜ — người không có quyền không biết cờ đang bật hay tắt`, async () => {
      M.engineBat.mockResolvedValue(false);
      M.assertPermission.mockRejectedValue(new Error("FORBIDDEN"));
      const r = await a.goi();
      expect((r as { chung: string }).chung).toContain(a.quyen);
      expect((r as { chung: string }).chung).not.toMatch(/chưa được bật/);
      expect(M.engineBat).not.toHaveBeenCalled();
    });
  }
});

describe("[NHH-POL-10-ACT] thuTinhAction — cổng vào + CHỈ ĐỌC", () => {
  const VAO = { versionId: "v1", tuNgay: "2026-07-01", denNgay: "2026-09-30", orgUnitId: "ou1" };

  it("[NHH-POL-10-ACT-01] chưa đăng nhập ⇒ ok:false, không hỏi quyền, không resolveActor, không tính", async () => {
    M.auth.mockResolvedValue(null);
    expect(await thuTinhAction(VAO)).toMatchObject({ ok: false, chung: "Chưa đăng nhập." });
    expect(M.assertPermission).not.toHaveBeenCalled();
    expect(M.resolveActor).not.toHaveBeenCalled();
    expect(M.thuTinhPhienBan).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-ACT-02] hỏi ĐÚNG MỘT quyền commission_policies:manage; bị từ chối ⇒ nêu đúng key và KHÔNG resolveActor / tính", async () => {
    M.assertPermission.mockRejectedValue(new Error("FORBIDDEN"));
    const r = await thuTinhAction(VAO);
    expect(r).toMatchObject({ ok: false });
    expect((r as { chung: string }).chung).toContain("commission_policies:manage");
    expect(M.assertPermission).toHaveBeenCalledTimes(1);
    expect(M.assertPermission).toHaveBeenCalledWith("commission_policies:manage");
    expect(M.resolveActor).not.toHaveBeenCalled();
    expect(M.thuTinhPhienBan).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-ACT-03] được quyền ⇒ actor từ phiên, đồng hồ do action truyền, tham số chuyển NGUYÊN VĂN; kết quả đi nguyên vẹn; KHÔNG làm mới trang (chỉ đọc)", async () => {
    const truoc = Date.now();
    const r = await thuTinhAction(VAO);
    expect(M.resolveActor).toHaveBeenCalledWith("u1");
    expect(M.thuTinhPhienBan).toHaveBeenCalledTimes(1);
    const a = M.thuTinhPhienBan.mock.calls[0]![0] as { actor: unknown; now: Date } & typeof VAO;
    expect(a).toMatchObject({ actor: ACTOR, ...VAO });
    expect(a.now.getTime()).toBeGreaterThanOrEqual(truoc);
    expect(a.now.getTime()).toBeLessThanOrEqual(Date.now());
    expect(r).toBe(await M.thuTinhPhienBan.mock.results[0]!.value);
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });

  it("[NHH-POL-10-ACT-04] tham số null đi qua là null (mặc định 3 tháng do tầng dưới quyết, không phải action)", async () => {
    await thuTinhAction({ versionId: "v1", tuNgay: null, denNgay: null, orgUnitId: null });
    expect(M.thuTinhPhienBan.mock.calls[0]![0]).toMatchObject({ tuNgay: null, denNgay: null, orgUnitId: null });
  });

  it("[NHH-POL-10-ACT-05] dữ liệu client sai kiểu (số, object, versionId rỗng) ⇒ từ chối TRƯỚC resolveActor, không xuống tầng dưới", async () => {
    for (const vao of [
      { ...VAO, versionId: "" },
      { ...VAO, versionId: 5 },
      { ...VAO, tuNgay: 20260701 },
      { ...VAO, denNgay: {} },
      { ...VAO, orgUnitId: ["x"] },
    ]) {
      const r = await thuTinhAction(vao as never);
      expect(r).toMatchObject({ ok: false, chung: expect.stringMatching(/không đúng dạng/) });
    }
    expect(M.resolveActor).not.toHaveBeenCalled();
    expect(M.thuTinhPhienBan).not.toHaveBeenCalled();
  });
});
