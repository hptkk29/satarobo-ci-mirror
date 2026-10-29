// @vitest-environment node
/**
 * [NHH-PER-04d] / [NHH-COM-21] — hai đường chỉ chạm được khi có thứ GIẢ LẬP "xảy ra giữa chừng":
 *   · [NHH-PER-04d] một khoản lỗi khi Tính kỳ ⇒ kỳ KHÔNG được đặt CALCULATED (kỳ thiếu khoản không được xem như đã tính);
 *   · [NHH-COM-21] khoản đổi GIỮA lúc nạp và lúc ghi ⇒ cổng `kiemKhoanVanNhuCu` chặn, nạp lại — không bao giờ ghi trên số đã cũ.
 *
 * Vì sao có tệp này — cấy lỗi 08/10: bỏ `if (tongKet.loi.length > 0)` ở `tinhKy`, và bỏ so `updatedAt` ở `kiemKhoanVanNhuCu` ⇒ 0 ca đỏ cho cả hai. Không fixture
 * nào tạo được "khoản ném lỗi" hay "khoản đổi giữa hai lệnh đọc/ghi" bằng dữ liệu thật; chỉ chèn được ở đường nối giữa hai hàm — nên mock ĐÚNG hai hàm ấy,
 * mặc định chuyển tiếp sang hàm thật (`vi.fn(m.xxx)`), chỉ ca nào cần mới dùng `mockImplementationOnce`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });
vi.mock("../../lib/hoa-hong/nap-khoan", async (goc) => {
  const m = await goc<typeof import("../../lib/hoa-hong/nap-khoan")>();
  return { ...m, docKhoan: vi.fn(m.docKhoan) };
});
vi.mock("../../lib/hoa-hong/quet-khoan", async (goc) => {
  const m = await goc<typeof import("../../lib/hoa-hong/quet-khoan")>();
  return { ...m, quetKhoan: vi.fn(m.quetKhoan) };
});

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { tinhKy } from "../../lib/hoa-hong/ky-service";
import { docKhoan } from "../../lib/hoa-hong/nap-khoan";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, hoanTien, nguoiKyHo, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-COM-21] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const cuaToi: KichBan[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-COM-21] giả lập sự cố giữa chừng", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-PER-04d] một khoản LỖI khi Tính kỳ ⇒ TINH_CO_LOI, kỳ KHÔNG thành CALCULATED; bỏ lỗi giả ⇒ Tính được (đối chứng dương)", async () => {
    const k = await kb("per04");
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id); // tạo kỳ 2026-10 của cơ sở bằng đường thật
    const ky = await db.commissionPeriod.findFirstOrThrow({ where: { period: "2026-10", centerId: k.centerId } });
    const nguoi = await nguoiKyHo();

    vi.mocked(quetKhoan).mockImplementationOnce(async () => {
      throw new HoaHongError("LOI_GIA_LAP", "khoản hỏng giả lập");
    });
    await expect(tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 0, actor: nguoi })).rejects.toMatchObject({ ma: "TINH_CO_LOI" });
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } })).status).toBe("OPEN");
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } })).lastCalculatedAt).toBeNull();

    await tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 0, actor: nguoi });
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } })).status).toBe("CALCULATED");
  });

  it("[NHH-PER-04c] kỳ bị KHOÁ trong lúc đang Tính ⇒ KY_DA_DONG, kỳ GIỮ NGUYÊN LOCKED — Tính không bao giờ kéo một kỳ đã khoá về CALCULATED", async () => {
    const k = await kb("per04c");
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    await quetKhoan(db, bc, id);
    const ky = await db.commissionPeriod.findFirstOrThrow({ where: { period: "2026-10", centerId: k.centerId } });
    const nguoi = await nguoiKyHo();
    const thuc = (await vi.importActual<typeof import("../../lib/hoa-hong/quet-khoan")>("../../lib/hoa-hong/quet-khoan")).quetKhoan;
    // người khác khoá kỳ ĐÚNG LÚC tinhKy đang quét khoản đầu tiên (cổng cuối của tinhKy đọc lại trạng thái SAU khoá hàng)
    vi.mocked(quetKhoan).mockImplementationOnce(async (c, b, pid, che) => {
      await db.commissionPeriod.update({ where: { id: ky.id }, data: { status: "LOCKED", lockedAt: new Date() } });
      return thuc(c, b, pid, che);
    });
    await expect(tinhKy(db, bc, { periodId: ky.id, soThangDoiSoat: 0, actor: nguoi })).rejects.toMatchObject({ ma: "KY_DA_DONG" });
    expect((await db.commissionPeriod.findUniqueOrThrow({ where: { id: ky.id } })).status).toBe("LOCKED");
  });

  it("[NHH-COM-21b] LEGACY_REVERSAL: khoản hoàn ĐỔI giữa lúc nạp và lúc ghi ⇒ cổng chặn, nạp lại (docKhoan gọi 2 lần), ghi đúng MỘT bộ dòng", async () => {
    const k = await kb("com21b");
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-09-10") }); // gốc TRƯỚC mốc ⇒ chủ cũ
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    const bc = await boiCanh(k, new Date());
    const thuc = (await vi.importActual<typeof import("../../lib/hoa-hong/nap-khoan")>("../../lib/hoa-hong/nap-khoan")).docKhoan;
    const doc = vi.mocked(docKhoan);
    doc.mockClear();
    doc.mockImplementationOnce(async (c, pid) => {
      const p = await thuc(c, pid);
      return p ? { ...p, updatedAt: new Date(p.updatedAt.getTime() - 60_000) } : p;
    });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO_LEGACY" });
    expect(doc).toHaveBeenCalledTimes(2);
    expect((await dongSoCuaKhoan(hoan)).every((d) => d.entryKind === "LEGACY_REVERSAL")).toBe(true);
  });

  it("[NHH-COM-21c] khoản HOÀN (đảo thường): đổi giữa lúc nạp và lúc ghi ⇒ cổng chặn, nạp lại (docKhoan gọi 2 lần), đảo đúng MỘT lần", async () => {
    const k = await kb("com21c");
    const bc = await boiCanh(k, new Date());
    const goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, goc);
    const hoan = await hoanTien(k, goc, { soTien: 4_000_000, ngay: D("2026-11-05") });
    const thuc = (await vi.importActual<typeof import("../../lib/hoa-hong/nap-khoan")>("../../lib/hoa-hong/nap-khoan")).docKhoan;
    const doc = vi.mocked(docKhoan);
    doc.mockClear();
    doc.mockImplementationOnce(async (c, pid) => {
      const p = await thuc(c, pid);
      return p ? { ...p, updatedAt: new Date(p.updatedAt.getTime() - 60_000) } : p;
    });
    expect(await quetKhoan(db, bc, hoan)).toMatchObject({ loai: "DA_DAO", tong: -120_000 });
    expect(doc).toHaveBeenCalledTimes(2);
    expect(await db.commissionTransaction.count({ where: { paymentId: hoan, entryKind: "REVERSAL" } })).toBe(1);
  });

  it("[NHH-COM-21] khoản ĐỔI giữa lúc nạp và lúc ghi ⇒ cổng chặn, nạp lại từ đầu (docKhoan gọi 2 lần), ghi đúng MỘT ô — không ghi trên số đã cũ", async () => {
    const k = await kb("com21");
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-05") });
    const bc = await boiCanh(k, new Date());
    const thuc = (await vi.importActual<typeof import("../../lib/hoa-hong/nap-khoan")>("../../lib/hoa-hong/nap-khoan")).docKhoan;
    const doc = vi.mocked(docKhoan);
    doc.mockClear();
    // lần nạp đầu trả bản chụp CŨ hơn bản trong DB 60 giây = "khoản vừa bị sửa sau khi nạp"
    doc.mockImplementationOnce(async (c, pid) => {
      const p = await thuc(c, pid);
      return p ? { ...p, updatedAt: new Date(p.updatedAt.getTime() - 60_000) } : p;
    });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI" });
    expect(doc).toHaveBeenCalledTimes(2);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(1);
    expect((await dongSoCuaKhoan(id)).length).toBeGreaterThan(0);
  });
});
