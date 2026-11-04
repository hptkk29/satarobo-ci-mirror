// [UAT-KB-*] — bất biến của bộ kịch bản UAT (THUẦN). Con số THẬT do engine tính được đo ở tests/hoa-hong/uat-vi-du-so.spec.ts ([UAT-SO-*]);
// ca này giữ cho DỮ LIỆU kịch bản không tự mâu thuẫn: tổng không vượt trần, ngày rơi đúng kỳ và đúng phía của cửa sổ ghi công.
import { describe, expect, it } from "vitest";

import {
  EMAIL_UAT,
  KICH_BAN_UAT,
  NGUOI_NHAN_THEO_VAI,
  VAI_HUONG,
  dinhDangVnd,
  hieuLucChuNguonUat,
  kyCuaNgay,
  mocGhiNhanUat,
  ngayThuCuaUat,
  thangCutoverSomNhat,
  tongTheoKy,
  tongTien,
  type KichBanUat,
} from "./kich-ban-hoa-hong";

const T = "2026-11";
const tongThu = (k: KichBanUat) => k.thanhToan.reduce((s, t) => s + t.soTien, 0);
const hoan = (k: KichBanUat) => k.hoanTienSan?.soTien ?? 0;
const DAY = 86_400_000;

describe("[UAT-KB] kịch bản UAT", () => {
  it("[UAT-KB-01] mã kịch bản duy nhất; mọi vai trong kyVong thuộc danh sách vai và có người nhận khai trong EMAIL_UAT", () => {
    const ma = KICH_BAN_UAT.map((k) => k.ma);
    expect(new Set(ma).size).toBe(ma.length);
    for (const k of KICH_BAN_UAT) {
      for (const so of [k.kyVong.truoc, k.kyVong.sau]) {
        for (const vai of Object.keys(so)) {
          expect(VAI_HUONG as readonly string[], `${k.ma}: vai ${vai}`).toContain(vai);
          expect(Object.keys(EMAIL_UAT), `${k.ma}: người nhận vai ${vai}`).toContain(NGUOI_NHAN_THEO_VAI[vai as keyof typeof NGUOI_NHAN_THEO_VAI]);
        }
      }
    }
  });

  it("[UAT-KB-02] cột 'trước' = đúng 9% × tiền ròng của lần mua (bộ chung đủ năm vai); S08 chưa có chính sách RENEWAL ⇒ 0", () => {
    for (const k of KICH_BAN_UAT) {
      const rong = tongThu(k) - hoan(k);
      const kyVong = tongTien(k.kyVong.truoc);
      if (k.lanMuaThuHai) expect(kyVong, k.ma).toBe(0);
      else expect(kyVong, k.ma).toBe((rong * 9) / 100);
    }
  });

  it("[UAT-KB-03] cột 'sau' không vượt trần 10% (trần admin nâng lên 0,10); đúng ba kịch bản cần nâng trần (S02 · S03 · S04) chạm 10%", () => {
    const chamTran: string[] = [];
    for (const k of KICH_BAN_UAT) {
      const rong = tongThu(k) - hoan(k);
      const sau = tongTien(k.kyVong.sau);
      if (!k.lanMuaThuHai) expect(sau, k.ma).toBeLessThanOrEqual((rong * 10) / 100);
      if (!k.lanMuaThuHai && rong > 0 && sau === (rong * 10) / 100) chamTran.push(k.ma);
    }
    expect(chamTran).toEqual(["S02", "S03", "S04"]);
  });

  it("[UAT-KB-04] mọi kịch bản kích hoạt chính sách ở 'sau' đều là kịch bản CÓ thay đổi (hoặc đối chứng có chủ ý); S05 tổng KHÔNG đổi nhưng người nhận đổi", () => {
    const s05 = KICH_BAN_UAT.find((k) => k.ma === "S05")!;
    expect(tongTien(s05.kyVong.truoc)).toBe(tongTien(s05.kyVong.sau));
    expect(s05.kyVong.truoc.MARKETING).toBe(100_000);
    expect(s05.kyVong.sau.MARKETING).toBeUndefined();
    expect(s05.kyVong.sau.SOURCE_OWNER).toBe(100_000);
    const s05b = KICH_BAN_UAT.find((k) => k.ma === "S05B")!;
    expect(s05b.kyVong.holdSau).toBe("NGUON_CHUA_CO_NGUOI_PHU_TRACH");
    expect(s05b.kyVong.sau.SOURCE_OWNER).toBeUndefined();
  });

  it("[UAT-KB-05] ngày thu: kỳ T cho mọi kịch bản trừ S06 (ngày thứ 101 ⇒ kỳ T+2); khoản trong cửa sổ cách mốc ghi nhận ≤ 60 ngày (kể cả cửa sổ riêng 60 ngày của nguồn mẫu)", () => {
    const moc = mocGhiNhanUat(T);
    expect(moc.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    for (const k of KICH_BAN_UAT) {
      for (const t of k.thanhToan) {
        const ngay = ngayThuCuaUat(T, t.ngay);
        const soNgay = Math.round((ngay.getTime() - moc.getTime()) / DAY);
        if (k.ma === "S06") {
          expect(soNgay).toBe(101);
          expect(kyCuaNgay(ngay)).toBe("2027-01");
        } else {
          expect(kyCuaNgay(ngay), k.ma).toBe(T);
          expect(soNgay, `${k.ma}: ngày thứ ${soNgay} kể từ mốc ghi nhận`).toBeLessThanOrEqual(60);
          expect(soNgay).toBeGreaterThan(0);
        }
      }
    }
  });

  it("[UAT-KB-06] S09 chia 4tr + 3tr + 3tr (tổng bằng một lần thu 10tr); S10 hoàn 4tr nằm sau khoản thu và vẫn trong kỳ T", () => {
    const s09 = KICH_BAN_UAT.find((k) => k.ma === "S09")!;
    expect(s09.thanhToan.map((t) => t.soTien)).toEqual([4_000_000, 3_000_000, 3_000_000]);
    expect(tongThu(s09)).toBe(10_000_000);
    const s10 = KICH_BAN_UAT.find((k) => k.ma === "S10")!;
    expect(s10.hoanTienSan).not.toBeNull();
    expect(ngayThuCuaUat(T, s10.hoanTienSan!.ngay).getTime()).toBeGreaterThan(ngayThuCuaUat(T, s10.thanhToan[0]!.ngay).getTime());
    expect(kyCuaNgay(ngayThuCuaUat(T, s10.hoanTienSan!.ngay))).toBe(T);
    expect(tongTien(s10.kyVong.truoc)).toBe(((tongThu(s10) - 4_000_000) * 9) / 100);
  });

  it("[UAT-KB-08] hoa hồng từng khoản cộng lại đúng kyVong; tổng cả bộ theo kỳ: T = 6.840.000 → 6.980.000, T+2 (chỉ S06) = 900.000 → 800.000", () => {
    for (const k of KICH_BAN_UAT.filter((x) => x.tungKhoan)) {
      expect(k.tungKhoan!.reduce((s, x) => s + x.truoc, 0), `${k.ma} trước`).toBe(tongTien(k.kyVong.truoc));
      expect(k.tungKhoan!.reduce((s, x) => s + x.sau, 0), `${k.ma} sau`).toBe(tongTien(k.kyVong.sau));
    }
    expect(tongTheoKy(T, "truoc")).toEqual({ "2026-11": 6_840_000, "2027-01": 900_000 });
    expect(tongTheoKy(T, "sau")).toEqual({ "2026-11": 6_980_000, "2027-01": 800_000 });
  });

  it("[UAT-KB-09] ngày hiệu lực chủ nguồn PAID_ADS nằm GIỮA S05B và S05: thu của S05B (đối chứng ÂM) rơi TRƯỚC ⇒ chưa có chủ; thu của S05 (đối chứng DƯƠNG) rơi SAU ⇒ chủ nhận 1%; và luôn SAU hôm nay (đổi chủ không lùi ngày)", () => {
    // Luật chủ nguồn theo LỊCH SỬ (08 §16.4): chủ chỉ áp cho giao dịch có NGÀY THU ĐẦU từ ngày hiệu lực. Đặt ngày hiệu lực ở đâu thì đối chứng ÂM là ở đó — đặt nhầm (vd «từ hôm nay»)
    // thì S05B cũng được trả 1% và «đối chứng ÂM» biến mất mà không test nào báo.
    for (const ky of ["2026-11", "2027-01", "2028-03"]) {
      const hieuLuc = hieuLucChuNguonUat(ky).getTime();
      const s05b = ngayThuCuaUat(ky, KICH_BAN_UAT.find((k) => k.ma === "S05B")!.thanhToan[0]!.ngay).getTime();
      const s05 = ngayThuCuaUat(ky, KICH_BAN_UAT.find((k) => k.ma === "S05")!.thanhToan[0]!.ngay).getTime();
      expect(s05b, `${ky}: S05B phải thu TRƯỚC ngày hiệu lực`).toBeLessThan(hieuLuc);
      // S05 thu từ ngày hiệu lực ⇒ đi đường LỊCH SỬ (đường mới). Thu trước ngày đó nó vẫn ra 900.000 nhưng bằng bản chụp lúc ghi nhận (đường cũ) — đối chứng DƯƠNG sẽ không đo gì về lịch sử. (Chính S05B mới là ca phân biệt hai đường: [UAT-SO-05].)
      expect(s05, `${ky}: S05 phải thu TỪ ngày hiệu lực`).toBeGreaterThanOrEqual(hieuLuc);
      // «hôm nay» muộn nhất mà tháng T còn là tháng cutover sớm nhất = cuối tháng liền trước T ⇒ ngày hiệu lực vẫn ở sau
      const [y, m] = ky.split("-").map(Number) as [number, number];
      const cuoiThangTruoc = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0) - 7 * 3_600_000 - 1); // 23:59:59.999 giờ VN ngày cuối tháng T-1
      expect(hieuLuc, `${ky}: không được lùi quá hôm nay`).toBeGreaterThan(cuoiThangTruoc.getTime());
      expect(thangCutoverSomNhat(cuoiThangTruoc)).toBe(ky);
    }
    expect(hieuLucChuNguonUat(T).toISOString()).toBe("2026-11-17T17:00:00.000Z"); // 00:00 giờ VN ngày 18/11
  });

  it("[UAT-KB-07] lịch: tháng cutover sớm nhất theo giờ VN (qua ranh tháng, qua ranh năm); định dạng tiền", () => {
    expect(thangCutoverSomNhat(new Date("2026-10-10T03:00:00.000Z"))).toBe("2026-11");
    expect(thangCutoverSomNhat(new Date("2026-10-31T16:59:59.000Z"))).toBe("2026-11"); // 23:59:59 VN ngày 31/10
    expect(thangCutoverSomNhat(new Date("2026-10-31T17:00:00.000Z"))).toBe("2026-12"); // 00:00 VN ngày 01/11 ⇒ tháng hiện tại là 11
    expect(thangCutoverSomNhat(new Date("2026-12-15T03:00:00.000Z"))).toBe("2027-01");
    expect(mocGhiNhanUat("2027-01").toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(dinhDangVnd(1_000_000)).toBe("1.000.000");
    expect(dinhDangVnd(-120_000)).toBe("−120.000");
    expect(dinhDangVnd(0)).toBe("0");
  });
});
