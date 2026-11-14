import { describe, expect, it } from "vitest";
import { chayBoTestHopDong, phieuMauHopDong, MST_NGUOI_BAN_MAU, type AdapterThu, type KichBan } from "./bo-test-hop-dong";
import { taoMockAdapter, type CheDoMock } from "./mock-adapter";

const CHE_DO_THEO_KICH_BAN: Record<KichBan, CheDoMock> = {
  THANH_CONG: "THANH_CONG",
  TIMEOUT_DA_GHI: "TIMEOUT_DA_GHI",
  TIMEOUT_CHUA_GHI: "TIMEOUT_CHUA_GHI",
  LOI_XAC_THUC: "LOI_XAC_THUC",
};

function taoMockThu(kichBan: KichBan): AdapterThu {
  const adapter = taoMockAdapter({ cheDo: CHE_DO_THEO_KICH_BAN[kichBan] });
  return { adapter, datKichBan: (kb) => adapter.datCheDo(CHE_DO_THEO_KICH_BAN[kb]) };
}

// ── Bộ test hợp đồng dùng chung, chạy trên MockAdapter ───────────────────────────────────────────────
chayBoTestHopDong("MockAdapter", taoMockThu, {
  nhaCungCap: "MOCK",
  // Mock nối thêm KIEM_TRA_KET_NOI: đối chứng DƯƠNG cho nhánh "có phương thức tuỳ chọn" mà MISA không đi qua.
  adapterImplements: ["PHAT_HANH", "TRA_CUU_THEO_KHOA", "TAI_PDF", "TAI_XML", "KIEM_TRA_KET_NOI"],
  biMat: ["mat-khau-bi-mat-9z"],
});

// ── Riêng Mock ───────────────────────────────────────────────────────────────────────────────────────
describe("[HDNCC-MK] MockAdapter — các chế độ lỗi", () => {
  it("[HDNCC-MK-01] chế độ TU_CHOI: phiếu HỢP LỆ vẫn bị TU_CHOI (mã MOCK_TU_CHOI), không ghi gì ⇒ traCuu CHUA_CO", async () => {
    const mock = taoMockAdapter({ cheDo: "TU_CHOI" });
    const kq = await mock.phatHanh(phieuMauHopDong("hdncc-mk-01"));
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "MOCK_TU_CHOI" });
    expect(mock.soLanCapSo()).toBe(0);
    expect(await mock.traCuu("hdncc-mk-01", MST_NGUOI_BAN_MAU)).toEqual({ loai: "CHUA_CO" });
  });

  it("[HDNCC-MK-02] cùng khoá phát hành hai lần chỉ CẤP SỐ MỘT LẦN (soLanCapSo=1); khoá khác ⇒ lần cấp thứ hai", async () => {
    const mock = taoMockAdapter({ cheDo: "THANH_CONG" });
    await mock.phatHanh(phieuMauHopDong("hdncc-mk-02"));
    await mock.phatHanh(phieuMauHopDong("hdncc-mk-02"));
    expect(mock.soLanCapSo()).toBe(1);
    await mock.phatHanh(phieuMauHopDong("hdncc-mk-02-khac"));
    expect(mock.soLanCapSo()).toBe(2);
  });

  it("[HDNCC-MK-03] khoá được so không phân biệt hoa/thường và khoảng trắng (như MISA): 'Ref ' và 'ref' là một hoá đơn", async () => {
    const mock = taoMockAdapter({ cheDo: "THANH_CONG" });
    const a = await mock.phatHanh(phieuMauHopDong("hdncc-mk-03"));
    const b = await mock.phatHanh(phieuMauHopDong(" HDNCC-MK-03 "));
    expect(mock.soLanCapSo()).toBe(1);
    expect(b.loai).toBe("DA_PHAT_HANH");
    if (a.loai === "DA_PHAT_HANH" && b.loai === "DA_PHAT_HANH") expect(b.soHoaDon).toBe(a.soHoaDon);
  });

  it("[HDNCC-MK-04] TIMEOUT_CHUA_GHI rồi datCheDo(THANH_CONG) và gửi lại ĐÚNG khoá cũ ⇒ DA_PHAT_HANH, mới cấp số một lần", async () => {
    const mock = taoMockAdapter({ cheDo: "TIMEOUT_CHUA_GHI" });
    expect((await mock.phatHanh(phieuMauHopDong("hdncc-mk-04"))).loai).toBe("KHONG_RO");
    expect(mock.soLanCapSo()).toBe(0);
    mock.datCheDo("THANH_CONG");
    const sau = await mock.phatHanh(phieuMauHopDong("hdncc-mk-04"));
    expect(sau.loai).toBe("DA_PHAT_HANH");
    expect(mock.soLanCapSo()).toBe(1);
  });

  it("[HDNCC-MK-05] TIMEOUT_DA_GHI: đã cấp số (soLanCapSo=1) dù trả KHONG_RO; gửi lại cùng khoá vẫn KHONG_RO nhưng KHÔNG cấp thêm", async () => {
    const mock = taoMockAdapter({ cheDo: "TIMEOUT_DA_GHI" });
    expect((await mock.phatHanh(phieuMauHopDong("hdncc-mk-05"))).loai).toBe("KHONG_RO");
    expect(mock.soLanCapSo()).toBe(1);
    expect((await mock.phatHanh(phieuMauHopDong("hdncc-mk-05"))).loai).toBe("KHONG_RO");
    expect(mock.soLanCapSo()).toBe(1);
  });

  it("[HDNCC-MK-06] hai Mock độc lập nhau (không dùng chung bộ nhớ tiến trình như cổng gia-lap)", async () => {
    const a = taoMockAdapter({ cheDo: "THANH_CONG" });
    const b = taoMockAdapter({ cheDo: "THANH_CONG" });
    await a.phatHanh(phieuMauHopDong("hdncc-mk-06"));
    expect(await b.traCuu("hdncc-mk-06", MST_NGUOI_BAN_MAU)).toEqual({ loai: "CHUA_CO" });
    expect(b.soLanCapSo()).toBe(0);
  });

  it("[HDNCC-MK-07] taiTep với mã tra cứu KHÔNG thuộc hoá đơn nào đã cấp ⇒ ném (không trả PDF cho mã lạ)", async () => {
    const mock = taoMockAdapter({ cheDo: "THANH_CONG" });
    await expect(mock.taiTep("MA-LA", "pdf", MST_NGUOI_BAN_MAU)).rejects.toThrow(/mã tra cứu/);
  });

  it("[HDNCC-MK-08] phiếu sai bị tự chặn TRƯỚC khi áp chế độ: kể cả ở TIMEOUT vẫn là TU_CHOI chắc chắn (như cổng thật)", async () => {
    const mock = taoMockAdapter({ cheDo: "TIMEOUT_DA_GHI" });
    const kq = await mock.phatHanh({ ...phieuMauHopDong("hdncc-mk-08"), kyHieu: "SAI" });
    expect(kq.loai).toBe("TU_CHOI");
    expect(mock.soLanCapSo()).toBe(0);
  });

  it("[HDNCC-MK-09] moiTruongVanHanh=GIA_LAP, nhaCungCap=MOCK, đóng băng", () => {
    const mock = taoMockAdapter({ cheDo: "THANH_CONG" });
    expect(mock.moiTruongVanHanh).toBe("GIA_LAP");
    expect(mock.nhaCungCap).toBe("MOCK");
    expect(Object.isFrozen(mock)).toBe(true);
  });
});
