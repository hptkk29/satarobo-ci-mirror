// Ca [LKB-*] — GIAO DIỆN BỘ KÝ (nhà ký) + bộ ký GIẢ cho test. KHÔNG ký thật, KHÔNG PIN/khoá. THUẦN, không đồng hồ.
import { describe, expect, it } from "vitest";
import {
  MA_LOI_KY,
  bamDuLieuCanKy,
  chuanHoaKetQuaKy,
  duocPhepKy,
  laHashHopLe,
  lyDoLoiKy,
  type BoKy,
} from "./lenh-ky-bo-ky";
import { taoBoKyGia } from "./lenh-ky-bo-ky-gia";

const HASH = bamDuLieuCanKy("du-lieu-can-ky-mau");

describe("[LKB-01] hash dữ liệu cần ký — hệ thống CHỈ lưu hash", () => {
  it("SHA-256 hex 64 ký tự, tất định, đổi một ký tự ⇒ hash khác", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(bamDuLieuCanKy("du-lieu-can-ky-mau")).toBe(HASH);
    expect(bamDuLieuCanKy("du-lieu-can-ky-mau.")).not.toBe(HASH);
  });
  it("laHashHopLe: chỉ nhận đúng SHA-256 hex thường; PIN, chuỗi dài, hoa, rỗng đều bị từ chối", () => {
    expect(laHashHopLe(HASH)).toBe(true);
    for (const x of ["", "123456", "PIN:1234", HASH.toUpperCase(), `${HASH}0`, HASH.slice(1), "g".repeat(64)]) expect(laHashHopLe(x)).toBe(false);
  });
});

describe("[LKB-02] năng lực bộ ký — TD-05: providerSupports ≠ adapterImplements, engine chỉ tin adapterImplements", () => {
  const bo = (providerSupports: "CO" | "KHONG" | "CHUA_XAC_MINH", adapterImplements: boolean): Pick<BoKy, "nangLuc"> => ({
    nangLuc: { providerSupports, adapterImplements, ghiChu: "[R] bộ ký thử nghiệm" },
  });
  it("chỉ (CO ∧ đã nối) mới được phép ký", () => {
    expect(duocPhepKy(bo("CO", true))).toBe(true);
  });
  it("nhà ký CÓ hỗ trợ nhưng adapter CHƯA nối ⇒ KHÔNG (không hứa suông); nhà ký không/chưa rõ ⇒ không", () => {
    expect(duocPhepKy(bo("CO", false))).toBe(false);
    expect(duocPhepKy(bo("CHUA_XAC_MINH", false))).toBe(false);
    expect(duocPhepKy(bo("KHONG", false))).toBe(false);
  });
  it("khai bậy `adapterImplements = true` mà nhà ký không có ⇒ vẫn KHÔNG (vô lý, fail-closed)", () => {
    expect(duocPhepKy(bo("KHONG", true))).toBe(false);
    expect(duocPhepKy(bo("CHUA_XAC_MINH", true))).toBe(false);
  });
});

describe("[LKB-03] chuẩn hoá kết quả bộ ký: không tin nguyên văn, không lưu thông điệp lạ", () => {
  it("thành công hợp lệ giữ nguyên mã giao dịch và hạn chứng thư", () => {
    expect(chuanHoaKetQuaKy({ ok: true, maGiaoDich: "GD-001.A", chungThuHetHan: "2027-11-02" })).toEqual({
      ok: true,
      maGiaoDich: "GD-001.A",
      chungThuHetHan: "2027-11-02",
    });
  });
  it("thành công nhưng thiếu/sai mã giao dịch hoặc ngày ⇒ coi là PHẢN HỒI KHÔNG HỢP LỆ (không lưu nửa vời)", () => {
    for (const bay of [
      { ok: true, maGiaoDich: "", chungThuHetHan: "2027-11-02" },
      { ok: true, maGiaoDich: "x".repeat(101), chungThuHetHan: "2027-11-02" },
      { ok: true, maGiaoDich: "co khoang trang", chungThuHetHan: "2027-11-02" },
      { ok: true, maGiaoDich: "GD-1", chungThuHetHan: "02/11/2027" },
      { ok: true, maGiaoDich: "GD-1", chungThuHetHan: "2027-13-45" },
      { ok: true, maGiaoDich: "GD-1" },
      "ok",
      null,
      undefined,
      42,
    ]) {
      expect(chuanHoaKetQuaKy(bay)).toEqual({ ok: false, ma: "PHAN_HOI_KHONG_HOP_LE" });
    }
  });
  it("thất bại: mã trong danh sách được giữ; mã LẠ (có thể mang dữ liệu riêng) rơi về KHONG_RO; thông điệp của nhà ký KHÔNG đi theo", () => {
    const r = chuanHoaKetQuaKy({ ok: false, ma: "CHUNG_THU_HET_HAN", thongDiepNgan: "PIN=1234 cua nguyen van a" });
    expect(r).toEqual({ ok: false, ma: "CHUNG_THU_HET_HAN" });
    expect(JSON.stringify(r)).not.toContain("1234");
    expect(chuanHoaKetQuaKy({ ok: false, ma: "pin=1234", thongDiepNgan: "x" })).toEqual({ ok: false, ma: "KHONG_RO" });
    expect(chuanHoaKetQuaKy({ ok: false, ma: 7 })).toEqual({ ok: false, ma: "KHONG_RO" });
  });
  it("mỗi mã lỗi có lý do cố định tiếng Việt, không rỗng, và không chứa dữ liệu động", () => {
    for (const ma of MA_LOI_KY) {
      const t = lyDoLoiKy(ma);
      expect(t.startsWith(`${ma} — `)).toBe(true);
      expect(t.length).toBeGreaterThan(ma.length + 5);
      expect(t.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("[LKB-04] bộ ký GIẢ: ba kịch bản, đếm số lần gọi, không đồng hồ", () => {
  it("THANH_CONG: trả mã giao dịch + hạn chứng thư cố định; ghi nhận hash đã nhận", async () => {
    const b = taoBoKyGia("THANH_CONG");
    expect(duocPhepKy(b)).toBe(true);
    const kq = await b.ky(HASH);
    expect(kq).toMatchObject({ ok: true });
    expect(chuanHoaKetQuaKy(kq)).toMatchObject({ ok: true });
    expect(b.cacHashDaNhan).toEqual([HASH]);
  });
  it("TU_CHOI: trả ok=false với mã nằm trong danh sách", async () => {
    const kq = await taoBoKyGia("TU_CHOI").ky(HASH);
    expect(kq.ok).toBe(false);
    expect(chuanHoaKetQuaKy(kq)).toEqual({ ok: false, ma: "TU_CHOI" });
  });
  it("NEM: ném lỗi mang dấu nhận dạng để test kiểm nó KHÔNG lọt ra ngoài", async () => {
    // Dấu nhận dạng viết thường, có dấu cách: gitleaks (rule generic-api-key) bắt nhầm chuỗi
    // in hoa nối gạch kiểu «DAU-HIEU-BI-MAT-123» làm chặn mọi PR vào `test` ở bước gương.
    const dau = "dau hieu rieng cua loi nem";
    const b = taoBoKyGia("NEM", { dauThongDiepNem: dau });
    await expect(b.ky(HASH)).rejects.toThrow(dau);
    expect(b.soLanGoi).toBe(1);
  });
  it("bộ ký giả KHÔNG nhận dữ liệu không phải hash (giống bộ ký thật phải làm): ném ngay, đối chứng: hash đúng thì chạy", async () => {
    const b = taoBoKyGia("THANH_CONG");
    await expect(b.ky("PIN:1234")).rejects.toThrow();
    await expect(b.ky(HASH)).resolves.toMatchObject({ ok: true });
  });
});
