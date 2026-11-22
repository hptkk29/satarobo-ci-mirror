import { describe, expect, it, vi } from "vitest";
import { bamMaNhan, TOI_DA_LAN_THU_MA, type MaNhanStore } from "./luu";
import { phoneKeyTuSdtChuan } from "./phone-key";
import { NOI_DUNG_BI_XOA, chayHetHan, daHetHanChuaNhan, xoaBangMa, type VongDoiStore } from "./vong-doi";

// Dữ liệu GIẢ. Mốc thời gian tuyệt đối, không đọc đồng hồ thật (luật 19).
const NOW = new Date("2026-11-01T03:00:00Z");
const KHOA = "k".repeat(32);
const QUA_KHU = new Date("2026-10-01T00:00:00Z");
const TUONG_LAI = new Date("2027-01-01T00:00:00Z");

describe("[DISC-VD-01] daHetHanChuaNhan (hàm thuần)", () => {
  it.each([
    ["PENDING quá hạn", { claimStatus: "PENDING_CLAIM", retainUntil: QUA_KHU, deletedAt: null }, true],
    ["đúng mốc hết hạn", { claimStatus: "PENDING_CLAIM", retainUntil: NOW, deletedAt: null }, true],
    ["PENDING còn hạn", { claimStatus: "PENDING_CLAIM", retainUntil: TUONG_LAI, deletedAt: null }, false],
    ["đã CLAIMED dù quá hạn (thuộc tài khoản chủ)", { claimStatus: "CLAIMED", retainUntil: QUA_KHU, deletedAt: null }, false],
    ["đã xoá", { claimStatus: "PENDING_CLAIM", retainUntil: QUA_KHU, deletedAt: QUA_KHU }, false],
  ])("%s ⇒ %s", (_t, b, kq) => {
    expect(daHetHanChuaNhan(b, NOW)).toBe(kq);
  });
});

describe("[DISC-VD-02] chayHetHan", () => {
  it("xử lý theo lô cho tới khi hết việc", async () => {
    const lo = [["a", "b"], ["c"], []];
    const store: VongDoiStore = {
      timHetHan: vi.fn(async () => lo.shift() ?? []),
      danhDauHetHan: vi.fn(async (ids) => ids.length),
    };
    expect(await chayHetHan({ store, now: NOW })).toEqual({ daXuLy: 3, soLo: 2 });
    expect(store.danhDauHetHan).toHaveBeenNthCalledWith(1, ["a", "b"], NOW);
  });
  it("store không tiến triển (đổi 0 dòng) ⇒ dừng, không quay vô hạn", async () => {
    const store: VongDoiStore = { timHetHan: vi.fn(async () => ["x"]), danhDauHetHan: vi.fn(async () => 0) };
    expect(await chayHetHan({ store, now: NOW })).toEqual({ daXuLy: 0, soLo: 1 });
    expect(store.timHetHan).toHaveBeenCalledTimes(1);
  });
  it("chạm trần số lô thì dừng", async () => {
    const store: VongDoiStore = { timHetHan: vi.fn(async () => ["x"]), danhDauHetHan: vi.fn(async () => 1) };
    expect(await chayHetHan({ store, now: NOW, toiDaSoLo: 3 })).toEqual({ daXuLy: 3, soLo: 3 });
  });
  it("không có gì hết hạn ⇒ không ghi", async () => {
    const store: VongDoiStore = { timHetHan: vi.fn(async () => []), danhDauHetHan: vi.fn(async () => 0) };
    expect(await chayHetHan({ store, now: NOW })).toEqual({ daXuLy: 0, soLo: 0 });
    expect(store.danhDauHetHan).not.toHaveBeenCalled();
  });
  it("truyền giới hạn lô cho store", async () => {
    const store: VongDoiStore = { timHetHan: vi.fn(async () => []), danhDauHetHan: vi.fn(async () => 0) };
    await chayHetHan({ store, now: NOW, gioiHanMoiLo: 7 });
    expect(store.timHetHan).toHaveBeenCalledWith(NOW, 7);
  });
});

describe("[DISC-VD-03] NOI_DUNG_BI_XOA", () => {
  it("xoá MỌI trường mang thông tin về trẻ/liên hệ/bí mật", () => {
    expect(NOI_DUNG_BI_XOA).toEqual({
      reportSnapshot: {},
      payloadHash: null,
      emailTo: null,
      emailVerifyTokenHash: null,
      downloadTokenHash: null,
      downloadTokenExpires: null,
      claimCodeHash: null,
    });
  });
});

describe("[DISC-VD-04] xoá theo yêu cầu cần OTP + mã nhận", () => {
  const mk = (tra: { submissionId: string } | null) => {
    const thu = vi.fn(async () => tra);
    return { store: { thuBangMa: thu } as MaNhanStore, thu };
  };
  it("thiếu phiên xác minh ⇒ KHONG_CO_PHIEN_XAC_MINH, không chạm store", async () => {
    const { store, thu } = mk({ submissionId: "s1" });
    expect(await xoaBangMa({ sdtDaXacMinh: null, maNhan: "ABCDEFGHJK", store, now: NOW, khoaBam: () => KHOA })).toEqual({ ok: false, loi: "KHONG_CO_PHIEN_XAC_MINH" });
    expect(thu).not.toHaveBeenCalled();
  });
  it("mã sai định dạng ⇒ MA_KHONG_KHOP, không chạm store", async () => {
    const { store, thu } = mk({ submissionId: "s1" });
    expect(await xoaBangMa({ sdtDaXacMinh: "84905123456", maNhan: "xx", store, now: NOW, khoaBam: () => KHOA })).toEqual({ ok: false, loi: "MA_KHONG_KHOP" });
    expect(thu).not.toHaveBeenCalled();
  });
  it("khớp ⇒ ok; hành động XOA, hash + ngưỡng thử như đường nhận", async () => {
    const { store, thu } = mk({ submissionId: "s1" });
    expect(await xoaBangMa({ sdtDaXacMinh: "84905123456", maNhan: "abcde-fghjk", store, now: NOW, khoaBam: () => KHOA })).toEqual({ ok: true, submissionId: "s1" });
    expect(thu).toHaveBeenCalledWith({ phoneKey: phoneKeyTuSdtChuan("84905123456", KHOA), maHash: bamMaNhan("ABCDEFGHJK", KHOA), now: NOW, toiDaLanThu: TOI_DA_LAN_THU_MA, hanhDong: { loai: "XOA" } });
  });
  it("store trả null (sai/khoá/số khác) ⇒ MA_KHONG_KHOP", async () => {
    const { store } = mk(null);
    expect(await xoaBangMa({ sdtDaXacMinh: "84905123456", maNhan: "ABCDEFGHJK", store, now: NOW, khoaBam: () => KHOA })).toEqual({ ok: false, loi: "MA_KHONG_KHOP" });
  });
});
