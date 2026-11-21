// [OWN-*] — CHỦ NGUỒN THEO LỊCH SỬ (hàm THUẦN). Hướng B+C, 16/10/2026.
//
//   [OWN-01] khoảng phủ ngày: biên `effectiveFrom` bao gồm, `effectiveTo` loại trừ
//   [OWN-02] đổi A→B hiệu lực T: sự kiện trước T → A, từ T → B; các đợt của MỘT lần mua (cùng ngày sự kiện) KHÔNG chia hai người
//   [OWN-03] lead ghi nhận lúc nguồn chưa có chủ (bản chụp null): sự kiện sau mốc có chủ được trả; trước mốc vẫn không (hết "treo vĩnh viễn", không hồi tố)
//   [OWN-04] nguồn CHƯA CÓ lịch sử: đường cũ y nguyên (bản chụp HOP_LE · nguồn sống · bản chụp HONG fail-closed)
//   [OWN-05] có lịch sử, ngày TRƯỚC khoảng đầu, hàng chưa chụp (đọc sống): ĐÓNG BĂNG ở chủ khởi tạo — không bao giờ lấy nguồn sống của hôm nay
//   [OWN-06] như trên nhưng khoảng đầu là DOI_CHU (nguồn khi đó chưa có chủ): không có chủ
//   [OWN-07] có lịch sử, ngày trước khoảng đầu, bản chụp HOP_LE/HONG: theo bản chụp như cũ
//   [OWN-08] khoảng `ownerEmployeeId = null` (gỡ chủ): không có chủ từ mốc đó
//   [OWN-09] lỗ hổng sau khoảng cuối đã đóng: fail-closed, không chủ
//   [OWN-10] `kiemMocHieuLuc`: lùi ngày · không sau khoảng đang mở · đã có thay đổi hẹn giờ · hợp lệ
//   [OWN-11] `mocHieuLucTuNgayVN`: hôm nay ⇒ từ lúc lưu; ngày sau ⇒ 00:00 VN; ngày trước ⇒ giữ quá khứ để bị từ chối; sai dạng ⇒ null
//   [OWN-12] "đổi chủ HÔM NAY" áp từ LÚC LƯU, không từ 00:00: khoản thu dated 00:00 hôm nay (nhập tay) vẫn về chủ CŨ; chọn NGÀY MAI thì cắt gọn từ 00:00 VN (đối chứng dương)
//   [OWN-13] `chuTaiThoiDiem`: chủ ĐANG hiệu lực khác chủ ĐÃ HẸN (cột biểu mẫu nói B, tiền vẫn đi theo A đến ngày hiệu lực); không hẹn ⇒ không có thay đổi hẹn giờ
import { describe, expect, it } from "vitest";

import { CAU_LOI_MOC_HIEU_LUC, chonChuNguonTaiNgay, chuTaiThoiDiem, khoangPhuNgay, kiemMocHieuLuc, mocHieuLucTuNgayVN, type KhoangChu } from "./chu-nguon-lich-su";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const khoang = (id: string, owner: string | null, tu: string, den: string | null, kind: KhoangChu["kind"] = "DOI_CHU"): KhoangChu => ({
  id,
  ownerEmployeeId: owner,
  kind,
  effectiveFrom: d(tu),
  effectiveTo: den === null ? null : d(den),
});
const CHUA_CHUP = null; // signals không có khoá `nguon` ⇒ trạng thái CHUA_CO
const chup = (chuNhanVienId: string | null) => ({ nguon: { cuaSoNgay: 90, chuNhanVienId } });
const SONG = (chu: string | null) => ({ cuaSoRiengNgay: null, chuNhanVienId: chu });

describe("[OWN] chủ nguồn theo lịch sử", () => {
  it("[OWN-01] biên: effectiveFrom bao gồm, effectiveTo loại trừ", () => {
    const ls = [khoang("k1", "A", "2026-10-01", "2026-11-01"), khoang("k2", "B", "2026-11-01", null)];
    expect(khoangPhuNgay(ls, d("2026-10-01"))?.id).toBe("k1");
    expect(khoangPhuNgay(ls, d("2026-10-31"))?.id).toBe("k1");
    expect(khoangPhuNgay(ls, d("2026-11-01"))?.id).toBe("k2");
    expect(khoangPhuNgay(ls, d("2026-09-30"))).toBeNull();
  });

  it("[OWN-02] A→B hiệu lực 01/11: trước → A, từ 01/11 → B; các đợt của một lần mua dùng cùng ngày sự kiện nên về cùng một người", () => {
    const lichSu = [khoang("k1", "A", "2026-10-01", "2026-11-01", "KHOI_TAO"), khoang("k2", "B", "2026-11-01", null)];
    const chu = (ngay: string) => chonChuNguonTaiNgay({ lichSu, ngaySuKien: d(ngay), signals: chup("A"), song: SONG("B") });
    expect(chu("2026-10-15")).toMatchObject({ chuNhanVienId: "A", goc: "LICH_SU", khoangId: "k1" });
    expect(chu("2026-11-01")).toMatchObject({ chuNhanVienId: "B", goc: "LICH_SU", khoangId: "k2" });
    // một lần mua có ngày thu đầu 15/10, trả góp tới 15/12: ngày SỰ KIỆN là 15/10 cho mọi đợt ⇒ cùng A (không chia A/B)
    const cacDot = ["2026-10-15", "2026-10-15", "2026-10-15"].map(chu);
    expect(new Set(cacDot.map((x) => x.chuNhanVienId))).toEqual(new Set(["A"]));
    // lần mua MỚI có ngày thu đầu 15/11 ⇒ B
    expect(chu("2026-11-15").chuNhanVienId).toBe("B");
  });

  it("[OWN-03] lead ghi nhận lúc nguồn chưa có chủ (chụp null): sự kiện sau mốc có chủ được trả, trước mốc thì không", () => {
    const lichSu = [khoang("k1", "B", "2026-11-01", null)];
    const chu = (ngay: string) => chonChuNguonTaiNgay({ lichSu, ngaySuKien: d(ngay), signals: chup(null), song: SONG("B") });
    expect(chu("2026-11-02")).toMatchObject({ chuNhanVienId: "B", goc: "LICH_SU" });
    expect(chu("2026-10-20").chuNhanVienId).toBeNull(); // không hồi tố
  });

  it("[OWN-04] CHƯA có lịch sử: đường cũ y nguyên", () => {
    const g = (signals: unknown, song: ReturnType<typeof SONG>) => chonChuNguonTaiNgay({ lichSu: [], ngaySuKien: d("2026-10-15"), signals, song });
    expect(g(chup("A"), SONG("B"))).toMatchObject({ chuNhanVienId: "A", goc: "BAN_CHUP" });
    expect(g(CHUA_CHUP, SONG("B"))).toMatchObject({ chuNhanVienId: "B", goc: "NGUON_SONG" });
    expect(g({ nguon: { sai: "hình dạng" } }, SONG("B"))).toMatchObject({ chuNhanVienId: null, goc: "BAN_CHUP_HONG" });
  });

  it("[OWN-05] có lịch sử + ngày trước khoảng đầu + hàng chưa chụp: ĐÓNG BĂNG ở chủ khởi tạo, không lấy nguồn sống của hôm nay", () => {
    const lichSu = [khoang("k0", "A", "2026-10-10", "2026-11-01", "KHOI_TAO"), khoang("k1", "B", "2026-11-01", null)];
    // nguồn sống hôm nay đã là B; sự kiện cũ (trước mốc khởi tạo) phải ra A
    const r = chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-09-01"), signals: CHUA_CHUP, song: SONG("B") });
    expect(r).toMatchObject({ chuNhanVienId: "A", goc: "LICH_SU_KHOI_TAO", khoangId: "k0" });
  });

  it("[OWN-06] như [OWN-05] nhưng khoảng đầu là DOI_CHU (nguồn khi đó chưa có chủ): không chủ", () => {
    const lichSu = [khoang("k1", "B", "2026-11-01", null, "DOI_CHU")];
    const r = chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-09-01"), signals: CHUA_CHUP, song: SONG("B") });
    expect(r).toMatchObject({ chuNhanVienId: null, goc: "LICH_SU_KHOI_TAO", khoangId: null });
  });

  it("[OWN-07] có lịch sử + ngày trước khoảng đầu + bản chụp: theo bản chụp (HOP_LE) hoặc fail-closed (HONG)", () => {
    const lichSu = [khoang("k1", "B", "2026-11-01", null)];
    expect(chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-09-01"), signals: chup("A"), song: SONG("B") })).toMatchObject({ chuNhanVienId: "A", goc: "BAN_CHUP" });
    expect(chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-09-01"), signals: chup(null), song: SONG("B") })).toMatchObject({ chuNhanVienId: null, goc: "BAN_CHUP" });
    expect(chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-09-01"), signals: { nguon: 5 }, song: SONG("B") })).toMatchObject({ chuNhanVienId: null, goc: "BAN_CHUP_HONG" });
  });

  it("[OWN-08] khoảng gỡ chủ (owner null) ⇒ từ mốc đó không có chủ", () => {
    const lichSu = [khoang("k1", "A", "2026-10-01", "2026-11-01"), khoang("k2", null, "2026-11-01", null)];
    expect(chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-11-05"), signals: chup("A"), song: SONG(null) })).toMatchObject({ chuNhanVienId: null, goc: "LICH_SU", khoangId: "k2" });
  });

  it("[OWN-09] lỗ hổng sau khoảng cuối đã đóng ⇒ fail-closed", () => {
    const lichSu = [khoang("k1", "A", "2026-10-01", "2026-11-01")];
    expect(chonChuNguonTaiNgay({ lichSu, ngaySuKien: d("2026-12-01"), signals: chup("A"), song: SONG("A") })).toMatchObject({ chuNhanVienId: null, goc: "LICH_SU_LO_HONG" });
  });

  it("[OWN-10] kiemMocHieuLuc: lùi ngày · không sau khoảng đang mở · đã có thay đổi hẹn giờ · hợp lệ", () => {
    const now = d("2026-10-20");
    const mo = khoang("k1", "A", "2026-10-01", null);
    expect(kiemMocHieuLuc({ lichSu: [mo], hieuLucTu: d("2026-10-19"), now })).toBe("LUI_NGAY");
    // khoảng đang mở bắt đầu ĐÚNG lúc ghi và hẹn đúng mốc đó: không "sau" khoảng trước (hai lần đổi chủ cùng một khoảnh khắc)
    expect(kiemMocHieuLuc({ lichSu: [khoang("k2", "A", "2026-10-20", null)], hieuLucTu: d("2026-10-20"), now })).toBe("KHONG_SAU_KHOANG_TRUOC");
    expect(kiemMocHieuLuc({ lichSu: [khoang("k0", "A", "2026-10-01", "2026-11-05"), khoang("k1", "B", "2026-11-05", null)], hieuLucTu: d("2026-11-10"), now })).toBe("DA_CO_THAY_DOI_HEN_GIO");
    expect(kiemMocHieuLuc({ lichSu: [mo], hieuLucTu: d("2026-10-20"), now })).toBeNull(); // đúng lúc ghi: hợp lệ
    expect(kiemMocHieuLuc({ lichSu: [], hieuLucTu: d("2026-12-01"), now })).toBeNull();
    for (const c of Object.values(CAU_LOI_MOC_HIEU_LUC)) expect(c.length).toBeGreaterThan(20);
  });

  it("[OWN-11] ngày hiệu lực của biểu mẫu: hôm nay ⇒ từ LÚC LƯU; ngày sau ⇒ 00:00 VN; ngày trước ⇒ giữ quá khứ (để bị từ chối); sai dạng ⇒ null", () => {
    const now = new Date("2026-10-20T09:30:00+07:00");
    expect(mocHieuLucTuNgayVN("2026-10-20", now)).toEqual(now);
    expect(mocHieuLucTuNgayVN("2026-10-21", now)).toEqual(new Date("2026-10-21T00:00:00+07:00"));
    const qua = mocHieuLucTuNgayVN("2026-10-19", now);
    expect(qua).toEqual(new Date("2026-10-19T00:00:00+07:00"));
    expect(kiemMocHieuLuc({ lichSu: [], hieuLucTu: qua!, now })).toBe("LUI_NGAY");
    for (const sai of ["", "20/10/2026", "2026-13-40", "hôm nay"]) expect(mocHieuLucTuNgayVN(sai, now), sai).toBeNull();
    // sát nửa đêm giờ VN nhưng còn ở UTC hôm trước: vẫn là NGÀY VN hôm nay
    expect(mocHieuLucTuNgayVN("2026-10-21", new Date("2026-10-20T18:30:00Z"))).toEqual(new Date("2026-10-20T18:30:00Z"));
  });

  it("[OWN-12] đổi chủ 'hôm nay' áp từ LÚC LƯU, không từ 00:00: khoản dated 00:00 hôm nay vẫn về chủ CŨ; chọn NGÀY MAI thì cắt gọn từ 00:00 VN", () => {
    // Đây là hành vi ĐÃ CHỐT (không hồi tố — tiền hôm nay đã quét có thể đã ghi cho A; kéo mốc về 00:00 là viết lại chúng). Ca này chống HIỂU LẦM, không đổi luật.
    const luu = new Date("2026-10-20T09:30:00+07:00"); // bấm Lưu 09:30 sáng giờ VN
    const hom = mocHieuLucTuNgayVN("2026-10-20", luu)!;
    const lichSu: KhoangChu[] = [{ ...khoang("k1", "A", "2026-10-01", null, "KHOI_TAO"), effectiveTo: hom }, { id: "k2", ownerEmployeeId: "B", kind: "DOI_CHU", effectiveFrom: hom, effectiveTo: null }];
    const chu = (ngaySuKien: Date) => chonChuNguonTaiNgay({ lichSu, ngaySuKien, signals: chup("A"), song: SONG("B") }).chuNhanVienId;
    expect(chu(new Date("2026-10-20T00:00:00+07:00"))).toBe("A"); // khoản nhập tay 00:00 hôm nay — TRƯỚC giờ lưu — vẫn là A
    expect(chu(new Date("2026-10-20T09:29:59+07:00"))).toBe("A");
    expect(chu(new Date("2026-10-20T09:30:00+07:00"))).toBe("B"); // từ đúng lúc lưu
    expect(chu(new Date("2026-10-20T15:00:00+07:00"))).toBe("B");
    // đối chứng dương: muốn cắt gọn theo ngày thì chọn NGÀY MAI — mọi khoản dated từ 00:00 VN ngày mai về B, hết trong ngày hôm nay về A
    const mai = mocHieuLucTuNgayVN("2026-10-21", luu)!;
    expect(mai).toEqual(new Date("2026-10-21T00:00:00+07:00"));
    const ls2: KhoangChu[] = [{ ...khoang("k1", "A", "2026-10-01", null, "KHOI_TAO"), effectiveTo: mai }, { id: "k2", ownerEmployeeId: "B", kind: "DOI_CHU", effectiveFrom: mai, effectiveTo: null }];
    const chu2 = (ngaySuKien: Date) => chonChuNguonTaiNgay({ lichSu: ls2, ngaySuKien, signals: chup("A"), song: SONG("B") }).chuNhanVienId;
    expect(chu2(new Date("2026-10-20T23:59:59+07:00"))).toBe("A");
    expect(chu2(new Date("2026-10-21T00:00:00+07:00"))).toBe("B");
  });

  it("[OWN-13] chuTaiThoiDiem: chủ ĐANG hiệu lực khác chủ ĐÃ HẸN; không hẹn ⇒ không có thay đổi hẹn giờ; gỡ chủ đã hẹn cũng là một thay đổi hẹn giờ", () => {
    const now = d("2026-10-20");
    const henB = [khoang("k1", "A", "2026-10-01", "2026-10-25"), khoang("k2", "B", "2026-10-25", null)];
    expect(chuTaiThoiDiem(henB, now)).toMatchObject({ dangHieuLuc: { ownerEmployeeId: "A" }, henGio: { ownerEmployeeId: "B" } });
    expect(chuTaiThoiDiem(henB, d("2026-10-25"))).toMatchObject({ dangHieuLuc: { ownerEmployeeId: "B" }, henGio: null }); // tới ngày hiệu lực: hết "hẹn"
    expect(chuTaiThoiDiem([khoang("k1", "A", "2026-10-01", null)], now)).toMatchObject({ dangHieuLuc: { ownerEmployeeId: "A" }, henGio: null });
    expect(chuTaiThoiDiem([khoang("k1", "A", "2026-10-01", "2026-10-25"), khoang("k2", null, "2026-10-25", null)], now).henGio?.ownerEmployeeId).toBeNull();
    expect(chuTaiThoiDiem([], now)).toEqual({ dangHieuLuc: null, henGio: null });
  });
});
