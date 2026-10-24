// Ca [HN3-01..20] — VIỆC 3: sale nhập SAI MÃ trên máy POS, khách đã quẹt thành công. TẦNG THUẦN, không DB.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5. Hàm thuần `phanLoaiSaiMa` quyết "tự ghi nhận" hay "chờ kế toán";
// `locUngVien` quyết giao dịch nào được làm ứng viên; `nutNhapSaiMa` quyết nút có hiện không. Mỗi ca "KHÔNG được"
// đi kèm một ĐỐI CHỨNG DƯƠNG (luật 11): bỏ đúng vế đó thì cùng đầu vào phải ra kết quả ngược lại — nếu không thì ca
// xanh vì lý do khác (đầu vào hỏng, hàm luôn từ chối).
//
// Hạt giống: "ZDZ4A" là mã hợp lệ (qua checksum) của phiếu đang bấm; "ZDZ4X" là gõ SAI MỘT ký tự (không bao giờ qua
// checksum — vét cạn 73,9 triệu chuỗi ở docs §5.1 Đ17); "DDZ4X" là mã hợp lệ cách "ZDZ4X" đúng một ký tự (phiếu khác).
import { describe, expect, it } from "vitest";
import { BANG_CHU, DUNG_LUONG, maHopLe, sinhMa } from "@/lib/payments/ma-phieu";
import { laChuThuongGap, tachMaPos, tachTokenGhiChu } from "./tach-ma-pos";
import { dongPosSchema, type DongPos } from "./kieu";
import { phanLoaiDongPos, phanLoaiDongPosXacNhan } from "./phan-loai-pos";
import { TIEN_TO_CHUA_THAY, laCauChuaThay, thongDiepPos, type KetLuanPos } from "./thong-diep-pos";
import {
  CAU_CHO_KE_TOAN,
  CAU_DA_XU_LY_NGOAI,
  CAU_BI_BAC_KHONG_CON_UNG_VIEN,
  CAU_KHONG_UNG_VIEN,
  DANG_GHI_KET_SAU_MS,
  THU_TU_LY_DO,
  cauKhongUngVien,
  cauLyDo,
  cachXetHauKiem,
  cauTuChoi,
  chanTuDuyet,
  chuyenHopLe,
  demBiLoaiVeBac,
  khoangCachMa,
  lamSachGhiChuHienThi,
  lanCanMa,
  locUngVien,
  nhanLyDo,
  nutNhapSaiMa,
  phanLoaiSaiMa,
  trangThaiHieuLuc,
  type DauVaoPhanLoai,
  type DongUngVien,
  type LyDoChoKeToan,
} from "./sai-ma";

const MA_DUNG = "ZDZ4A";
const GAN = "ZDZ4X"; // gõ sai đúng 1 ký tự
const MA_KHAC = "FUQNA"; // mã HỢP LỆ của một phiếu khác (không phải từ thường gặp)

// ─────────────────────────────────────────────────────────────────────────────
// 01 · khoảng cách mã
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-01] khoangCachMa — 0 · thay một ký tự = 1 · đổi chỗ hai ký tự KỀ = 1 · còn lại = 2", () => {
  const bang: [string, string, string, 0 | 1 | 2][] = [
    ["giống hệt", MA_DUNG, MA_DUNG, 0],
    ["thay ký tự đầu", MA_DUNG, "XDZ4A", 1],
    ["thay ký tự giữa", MA_DUNG, "ZDX4A", 1],
    ["thay ký tự cuối", MA_DUNG, GAN.slice(0, 4) + "X", 1],
    ["đổi chỗ hai ký tự kề (0,1)", MA_DUNG, "DZZ4A", 1],
    ["đổi chỗ hai ký tự kề (2,3)", MA_DUNG, "ZD4ZA", 1],
    ["đổi chỗ hai ký tự kề (3,4)", MA_DUNG, "ZDZA4", 1],
    ["đổi chỗ hai ký tự KHÔNG kề (0,3) ⇒ 2", MA_DUNG, "4DZZA", 2],
    ["thay hai ký tự ⇒ 2", MA_DUNG, "ZXX4A", 2],
    ["thay hai ký tự kề mà không phải đổi chỗ ⇒ 2", MA_DUNG, "XY" + "Z4A", 2],
    ["khác độ dài (ngắn hơn) ⇒ 2", MA_DUNG, "ZDZ4", 2],
    ["khác độ dài (dài hơn) ⇒ 2", MA_DUNG, "ZDZ4AA", 2],
    ["rỗng ⇒ 2", MA_DUNG, "", 2],
  ];
  it.each(bang)("%s", (_ten, a, b, mong) => {
    expect(khoangCachMa(a, b)).toBe(mong);
    expect(khoangCachMa(b, a), "đối xứng").toBe(mong);
  });

  it("đổi chỗ hai ký tự GIỐNG nhau không phải thay đổi gì ⇒ 0 (không đếm thành 1)", () => {
    expect(khoangCachMa("ZZZ4A", "ZZZ4A")).toBe(0);
  });
});

describe("[HN3-01b] MẪU vét cạn: mã gõ sai ≤ 1 KHÔNG BAO GIỜ là mã hợp lệ; token gõ sai có 1–5 mã hợp lệ ở khoảng cách 1", () => {
  // Bản đầy đủ (413.343 mã × 73.927.161 chuỗi ⇒ 0 chuỗi qua `maHopLe`) chạy tay ở docs §5.1 Đ17, không vào CI.
  // Ở đây là MẪU 2.000 mã rải đều kho: nếu ai đổi checksum (hệ số 5, bảng chữ) thì lưới đỏ và vế "gõ sai ≤ 1 không bao
  // giờ trùng mã khác" của `phanLoaiSaiMa` hết cơ sở.
  it("2.000 mã × mọi chuỗi cách ≤ 1 (thay một ký tự bảng chữ / đổi chỗ kề): không chuỗi nào qua maHopLe, tachMaPos rỗng", () => {
    const buoc = Math.floor(DUNG_LUONG / 2000);
    let soChuoi = 0;
    for (let n = 0; n < 2000; n++) {
      const ma = sinhMa(n * buoc + 1);
      expect(maHopLe(ma), `fixture ${ma}`).toBe(true);
      const lang: string[] = [];
      for (let p = 0; p < ma.length; p++) {
        for (const c of BANG_CHU) if (c !== ma[p]) lang.push(ma.slice(0, p) + c + ma.slice(p + 1));
      }
      for (let p = 0; p < ma.length - 1; p++) {
        if (ma[p] !== ma[p + 1]) lang.push(ma.slice(0, p) + ma[p + 1] + ma[p] + ma.slice(p + 2));
      }
      for (const s of lang) {
        soChuoi += 1;
        if (maHopLe(s)) throw new Error(`${s} cách ${ma} ≤ 1 mà vẫn qua checksum`);
        if (tachMaPos(s).length !== 0) throw new Error(`tachMaPos(${s}) không rỗng`);
      }
    }
    expect(soChuoi, "đã thật sự duyệt").toBeGreaterThan(250_000);
  });

  it("lanCanMa('ZDZ4X') = ĐÚNG 5 mã hợp lệ (số đo Đ17), gồm ZDZ4A; token hợp lệ chỉ lân cận chính nó", () => {
    expect(maHopLe(GAN)).toBe(false);
    const lan = lanCanMa(GAN);
    expect([...lan].sort()).toEqual(["DDZ4X", "ZDD4X", "ZDZ4A", "ZDZTX", "ZZZ4X"].sort());
    for (const m of lan) {
      expect(maHopLe(m), m).toBe(true);
      expect(khoangCachMa(GAN, m), m).toBe(1);
    }
    expect(lanCanMa("ABCDE")).toEqual(["AZCDE"]);
    expect(lanCanMa(MA_DUNG), "token hợp lệ ⇒ chỉ chính nó (hàng xóm cách 1 không bao giờ hợp lệ)").toEqual([MA_DUNG]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 02 · token hoá dùng CHUNG với tachMaPos
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-02] tachTokenGhiChu dùng CHUNG một phép với tachMaPos", () => {
  const MAU: (string | null)[] = [
    null,
    "",
    "   ",
    "...",
    "-",
    MA_DUNG,
    MA_DUNG.toLowerCase(),
    `(${MA_DUNG})`,
    `${MA_DUNG}.`,
    `'${MA_DUNG.toLowerCase()}'`,
    `"${MA_DUNG}",`,
    `Huynh ${MA_DUNG}`,
    `Huỳnh ${MA_DUNG}`.normalize("NFD"),
    `hoc phi be ${MA_DUNG} dot 1`,
    `${MA_DUNG}\t${MA_KHAC}`,
    `${MA_DUNG}\n${MA_KHAC}`,
    `${MA_DUNG}\u00a0${MA_KHAC}`,
    `${MA_DUNG}${MA_KHAC}`, // dính liền ⇒ một token 10 ký tự
    `X${MA_DUNG}`,
    `${MA_DUNG}X`,
    `${MA_DUNG} ${MA_DUNG}`,
    `KHANG ${MA_DUNG}`,
    "Nguyen Van A",
    "0905123456",
    "TT hoc phi",
    `ZDZ 4A`,
    `${GAN} ${MA_DUNG}`,
    `…${MA_DUNG}…`,
    `[${MA_DUNG}]`,
    `${MA_DUNG}-${MA_KHAC}`,
  ];

  it("30 chuỗi: tachMaPos(s) == lọc (dài 5 ∧ hợp lệ ∧ không từ thường gặp) trên tachTokenGhiChu(s), khử trùng", () => {
    expect(MAU).toHaveLength(30);
    for (const s of MAU) {
      const tuToken = [...new Set(tachTokenGhiChu(s).filter((t) => t.length === 5 && maHopLe(t) && !laChuThuongGap(t)))];
      expect(tachMaPos(s), JSON.stringify(s)).toEqual(tuToken);
    }
  });

  it("token: cắt dấu câu HAI ĐẦU, IN HOA, bỏ token rỗng, giữ thứ tự và trùng lặp", () => {
    expect(tachTokenGhiChu(`(${MA_DUNG.toLowerCase()}) ... Huynh, ${MA_DUNG}.`)).toEqual([MA_DUNG, "HUYNH", MA_DUNG]);
    expect(tachTokenGhiChu(null)).toEqual([]);
    expect(tachTokenGhiChu("... --- ()")).toEqual([]);
    expect(tachTokenGhiChu("ZDZ 4A")).toEqual(["ZDZ", "4A"]);
  });

  it("từ thường gặp hợp lệ (KHANG) bị laChuThuongGap nhận ra; mã thường thì không", () => {
    expect(maHopLe("KHANG")).toBe(true);
    expect(laChuThuongGap("KHANG")).toBe(true);
    expect(laChuThuongGap(MA_KHAC)).toBe(false);
    expect(laChuThuongGap(MA_DUNG)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 03..14 · phanLoaiSaiMa
// ─────────────────────────────────────────────────────────────────────────────
const SACH: DauVaoPhanLoai = {
  maDung: MA_DUNG,
  soUngVien: 1,
  ghiChu: "",
  phieuKhac: [],
  soPhieuTheCanhTranh: 0,
  duLieuThieu: false,
  soLanBiBac: 0,
};
const v = (p: Partial<DauVaoPhanLoai> = {}): DauVaoPhanLoai => ({ ...SACH, ...p });
const lyDoCuaKQ = (kq: ReturnType<typeof phanLoaiSaiMa>): readonly LyDoChoKeToan[] =>
  kq.quyet === "CHO_KE_TOAN" ? kq.lyDo : [];

describe("[HN3-03] KHÔNG ứng viên", () => {
  it("0 ứng viên ⇒ KHONG_UNG_VIEN, kể cả khi mọi cờ khác bật", () => {
    expect(phanLoaiSaiMa(v({ soUngVien: 0 }))).toEqual({ quyet: "KHONG_UNG_VIEN" });
    expect(phanLoaiSaiMa(v({ soUngVien: 0, duLieuThieu: true, soLanBiBac: 3, ghiChu: MA_KHAC }))).toEqual({
      quyet: "KHONG_UNG_VIEN",
    });
  });
  it("ĐỐI CHỨNG DƯƠNG: cùng đầu vào mà soUngVien = 1 ⇒ không còn KHONG_UNG_VIEN", () => {
    expect(phanLoaiSaiMa(v({ soUngVien: 1 })).quyet).not.toBe("KHONG_UNG_VIEN");
  });
});

describe("[HN3-04] ghi chú RỖNG hoặc toàn dấu câu ⇒ tự ghi nhận (đúng 1 ứng viên)", () => {
  it.each([null, "", "   ", "...", "-", "( )", "\n\t"])("ghi chú %j", (g) => {
    expect(phanLoaiSaiMa(v({ ghiChu: g }))).toEqual({ quyet: "TU_GHI_NHAN", ghiChu: "RONG" });
  });
  it("ĐỐI CHỨNG DƯƠNG: ghi chú có chữ không còn là RONG", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: "hoc phi" })).quyet).toBe("CHO_KE_TOAN");
  });
});

describe("[HN3-05] sai MỘT ký tự ⇒ tự ghi nhận (GAN_MA_DUNG)", () => {
  it.each([GAN, GAN.toLowerCase(), `${GAN}.`, `(${GAN})`, " " + GAN + " "])("ghi chú %j", (g) => {
    expect(phanLoaiSaiMa(v({ ghiChu: g }))).toEqual({ quyet: "TU_GHI_NHAN", ghiChu: "GAN_MA_DUNG" });
  });
  it("thay ký tự ở MỌI vị trí đều là 'gần'", () => {
    for (let p = 0; p < 5; p++) {
      const sai = MA_DUNG.slice(0, p) + (MA_DUNG[p] === "X" ? "Y" : "X") + MA_DUNG.slice(p + 1);
      expect(khoangCachMa(sai, MA_DUNG), sai).toBe(1);
      expect(phanLoaiSaiMa(v({ ghiChu: sai })).quyet, sai).toBe("TU_GHI_NHAN");
    }
  });
});

describe("[HN3-06] đổi chỗ hai ký tự KỀ ⇒ tự ghi nhận", () => {
  it.each(["DZZ4A", "ZD4ZA", "ZDZA4"])("ghi chú %s", (g) => {
    expect(phanLoaiSaiMa(v({ ghiChu: g }))).toEqual({ quyet: "TU_GHI_NHAN", ghiChu: "GAN_MA_DUNG" });
  });
});

describe("[HN3-07] lệch NHIỀU ⇒ chờ kế toán (GHI_CHU_LECH_NHIEU)", () => {
  it.each([
    ["sai 2 ký tự", "ZXX4A"],
    ["đổi chỗ không kề", "4DZZA"],
    ["token 4 ký tự", "ZDZ4"],
    ["token 6 ký tự", "ZDZ4AA"],
    ["mã bị tách đôi bằng dấu cách", "ZDZ 4A"],
    ["chỉ có chữ khác", "Hoc phi be Khang"],
    ["từ thường gặp một mình (KHANG hợp lệ nhưng không phải mã)", "KHANG"],
    ["số điện thoại", "0905123456"],
  ])("%s", (_ten, g) => {
    const kq = phanLoaiSaiMa(v({ ghiChu: g }));
    expect(kq).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["GHI_CHU_LECH_NHIEU"] });
  });
  it("ĐỐI CHỨNG DƯƠNG: cùng ghi chú mà thêm MỘT token gần đúng ⇒ không còn LECH_NHIEU", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: `Hoc phi be Khang ${GAN}` })).quyet).toBe("TU_GHI_NHAN");
  });
});

describe("[HN3-08] HAI ứng viên trở lên ⇒ chờ kế toán dù ghi chú sạch", () => {
  it.each([2, 3, 11])("%i ứng viên", (n) => {
    expect(phanLoaiSaiMa(v({ soUngVien: n, ghiChu: "" }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["NHIEU_UNG_VIEN"] });
    expect(phanLoaiSaiMa(v({ soUngVien: n, ghiChu: GAN })).quyet).toBe("CHO_KE_TOAN");
  });
});

describe("[HN3-09] ghi chú mang MÃ HỢP LỆ của phiếu khác ⇒ chờ kế toán (kể cả phiếu đó đã đóng)", () => {
  it("mã hợp lệ khác một mình", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: MA_KHAC }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["GHI_CHU_MANG_MA_KHAC", "GHI_CHU_LECH_NHIEU"] });
  });
  it("mã hợp lệ khác CẠNH một token gần mã đúng ⇒ vẫn chờ (có MANG_MA_KHAC)", () => {
    const kq = phanLoaiSaiMa(v({ ghiChu: `${GAN} ${MA_KHAC}` }));
    expect(lyDoCuaKQ(kq)).toEqual(["GHI_CHU_MANG_MA_KHAC"]);
  });
  it("viết thường / có dấu câu vẫn nhận ra", () => {
    expect(lyDoCuaKQ(phanLoaiSaiMa(v({ ghiChu: `(${MA_KHAC.toLowerCase()}), ${GAN}` })))).toEqual(["GHI_CHU_MANG_MA_KHAC"]);
  });
  it("ĐỐI CHỨNG: từ thường gặp (KHANG — hợp lệ nhưng là tên người) KHÔNG phải 'mã khác'; token KHÔNG qua checksum cũng không", () => {
    expect(lyDoCuaKQ(phanLoaiSaiMa(v({ ghiChu: `KHANG ${GAN}` })))).toEqual([]);
    expect(phanLoaiSaiMa(v({ ghiChu: `KHANG ${GAN}` })).quyet).toBe("TU_GHI_NHAN");
    expect(lyDoCuaKQ(phanLoaiSaiMa(v({ ghiChu: `ABCDE ${GAN}` })))).toEqual([]);
  });
});

describe("[HN3-10] token gần mã đúng CŨNG gần mã của MỘT PHIẾU KHÁC ĐANG MỞ ⇒ chờ kế toán", () => {
  const PHIEU_KHAC_GAN = "DDZ4X"; // hợp lệ, cách "ZDZ4X" đúng một ký tự
  it("phiếu khác đang MỞ ⇒ GAN_MA_PHIEU_KHAC", () => {
    expect(maHopLe(PHIEU_KHAC_GAN)).toBe(true);
    expect(khoangCachMa(GAN, PHIEU_KHAC_GAN)).toBe(1);
    expect(phanLoaiSaiMa(v({ ghiChu: GAN, phieuKhac: [{ ma: PHIEU_KHAC_GAN, dangMo: true }] }))).toEqual({
      quyet: "CHO_KE_TOAN",
      lyDo: ["GAN_MA_PHIEU_KHAC"],
    });
  });
  it("ĐỐI CHỨNG DƯƠNG: phiếu khác ĐÃ ĐÓNG ⇒ không còn mơ hồ ⇒ tự ghi nhận", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: GAN, phieuKhac: [{ ma: PHIEU_KHAC_GAN, dangMo: false }] })).quyet).toBe("TU_GHI_NHAN");
  });
  it("ĐỐI CHỨNG DƯƠNG: phiếu khác đang mở nhưng XA token (cách ≥ 2) ⇒ tự ghi nhận", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: GAN, phieuKhac: [{ ma: MA_KHAC, dangMo: true }] })).quyet).toBe("TU_GHI_NHAN");
  });
  it("ghi chú RỖNG thì không có token để mơ hồ ⇒ phieuKhac vô nghĩa, vẫn tự ghi nhận", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: "", phieuKhac: [{ ma: PHIEU_KHAC_GAN, dangMo: true }] })).quyet).toBe("TU_GHI_NHAN");
  });
});

describe("[HN3-11] từ phụ + token gần ⇒ tự ghi nhận; HAI token gần ⇒ chờ", () => {
  it.each([`Huynh ${GAN}`, `${GAN} học phí`, `Nguyen Van A - ${GAN} - dot 1`, `ABCDE ${GAN}`])("%s", (g) => {
    expect(phanLoaiSaiMa(v({ ghiChu: g }))).toEqual({ quyet: "TU_GHI_NHAN", ghiChu: "GAN_MA_DUNG" });
  });
  it("hai token gần KHÁC NHAU ⇒ GHI_CHU_NHIEU_MA_GAN", () => {
    const kq = phanLoaiSaiMa(v({ ghiChu: `${GAN} DZZ4A` }));
    expect(kq).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["GHI_CHU_NHIEU_MA_GAN"] });
  });
  it("ĐỐI CHỨNG DƯƠNG: cùng một token lặp lại hai lần chỉ tính MỘT", () => {
    expect(phanLoaiSaiMa(v({ ghiChu: `${GAN} ${GAN}` })).quyet).toBe("TU_GHI_NHAN");
  });
});

describe("[HN3-12] token = mã đúng (khoảng 0) ⇒ chờ kế toán (lý do khác, sale không có quyền gỡ)", () => {
  it.each([MA_DUNG, MA_DUNG.toLowerCase(), `Huynh ${MA_DUNG}`])("ghi chú %s", (g) => {
    expect(phanLoaiSaiMa(v({ ghiChu: g }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["GHI_CHU_DA_CO_MA_DUNG"] });
  });
});

describe("[HN3-13] cạnh tranh · dữ liệu thiếu · bị bác trước", () => {
  it("phiếu thẻ khác cũng nhận được giao dịch này ⇒ CO_PHIEU_THE_CANH_TRANH", () => {
    expect(phanLoaiSaiMa(v({ soPhieuTheCanhTranh: 1 }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["CO_PHIEU_THE_CANH_TRANH"] });
    expect(phanLoaiSaiMa(v({ soPhieuTheCanhTranh: 0 })).quyet, "đối chứng: 0 phiếu cạnh tranh").toBe("TU_GHI_NHAN");
  });
  it("dữ liệu có thể thiếu ⇒ DU_LIEU_THIEU", () => {
    expect(phanLoaiSaiMa(v({ duLieuThieu: true }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["DU_LIEU_THIEU"] });
    expect(phanLoaiSaiMa(v({ duLieuThieu: false })).quyet, "đối chứng: dữ liệu đủ").toBe("TU_GHI_NHAN");
  });
  it("kế toán đã BÁC một giao dịch cho ĐƠN này ⇒ KHÔNG BAO GIỜ tự ghi nhận nữa (DA_BI_TU_CHOI_TRUOC)", () => {
    expect(phanLoaiSaiMa(v({ soLanBiBac: 1 }))).toEqual({ quyet: "CHO_KE_TOAN", lyDo: ["DA_BI_TU_CHOI_TRUOC"] });
    expect(phanLoaiSaiMa(v({ soLanBiBac: 4, ghiChu: GAN })).quyet).toBe("CHO_KE_TOAN");
    expect(phanLoaiSaiMa(v({ soLanBiBac: 0 })).quyet, "đối chứng: chưa từng bị bác").toBe("TU_GHI_NHAN");
  });
});

describe("[HN3-14] liệt kê ĐỦ lý do, thứ tự cố định; TU_GHI_NHAN ⇔ danh sách rỗng", () => {
  it("nhiều lý do cùng lúc ⇒ đủ, theo THU_TU_LY_DO", () => {
    const kq = phanLoaiSaiMa(
      v({
        soUngVien: 2,
        ghiChu: `${MA_KHAC} ${MA_DUNG} ${GAN} DZZ4A`,
        phieuKhac: [{ ma: "DDZ4X", dangMo: true }],
        soPhieuTheCanhTranh: 2,
        duLieuThieu: true,
        soLanBiBac: 1,
      }),
    );
    expect(lyDoCuaKQ(kq)).toEqual([
      "NHIEU_UNG_VIEN",
      "GHI_CHU_MANG_MA_KHAC",
      "GHI_CHU_DA_CO_MA_DUNG",
      "GHI_CHU_NHIEU_MA_GAN",
      "GAN_MA_PHIEU_KHAC",
      "CO_PHIEU_THE_CANH_TRANH",
      "DU_LIEU_THIEU",
      "DA_BI_TU_CHOI_TRUOC",
    ]);
    // Thứ tự khai trong THU_TU_LY_DO là nguồn duy nhất: kết quả luôn là dãy con theo thứ tự đó.
    const viTri = lyDoCuaKQ(kq).map((l) => THU_TU_LY_DO.indexOf(l));
    expect([...viTri].sort((a, b) => a - b)).toEqual(viTri);
  });

  it("BẤT BIẾN trên lưới tổ hợp: TU_GHI_NHAN ⇔ không lý do nào; KHONG_UNG_VIEN ⇔ 0 ứng viên", () => {
    const ghiChu = [null, "", "...", GAN, `Huynh ${GAN}`, MA_DUNG, MA_KHAC, `${GAN} DZZ4A`, "ZXX4A", "hoc phi", `${GAN} ${MA_KHAC}`];
    const phieuKhac = [[], [{ ma: "DDZ4X", dangMo: true }], [{ ma: "DDZ4X", dangMo: false }]];
    let soCa = 0;
    for (const g of ghiChu)
      for (const pk of phieuKhac)
        for (const n of [0, 1, 2])
          for (const canhTranh of [0, 1])
            for (const thieu of [false, true])
              for (const bac of [0, 1]) {
                const kq = phanLoaiSaiMa(
                  v({ ghiChu: g, phieuKhac: pk, soUngVien: n, soPhieuTheCanhTranh: canhTranh, duLieuThieu: thieu, soLanBiBac: bac }),
                );
                soCa += 1;
                if (n === 0) {
                  expect(kq.quyet).toBe("KHONG_UNG_VIEN");
                  continue;
                }
                const lyDo = lyDoCuaKQ(kq);
                if (kq.quyet === "TU_GHI_NHAN") {
                  expect(lyDo, `${JSON.stringify([g, pk, n, canhTranh, thieu, bac])}`).toEqual([]);
                  expect(n).toBe(1);
                  expect(canhTranh + bac).toBe(0);
                  expect(thieu).toBe(false);
                } else {
                  expect(kq.quyet).toBe("CHO_KE_TOAN");
                  expect(lyDo.length, `CHO_KE_TOAN phải có lý do: ${JSON.stringify([g, pk, n, canhTranh, thieu, bac])}`).toBeGreaterThan(0);
                  expect(new Set(lyDo).size, "không lặp lý do").toBe(lyDo.length);
                }
              }
    expect(soCa).toBe(11 * 3 * 3 * 2 * 2 * 2);
  });

  it("GHI_TU_DONG_KHONG_DUOC có trong danh sách nhưng KHÔNG do phanLoaiSaiMa sinh (chỉ thêm khi tự ghi nhận đã giữ mà tiền không ra DA_THU)", () => {
    expect(THU_TU_LY_DO).toContain("GHI_TU_DONG_KHONG_DUOC");
    const dauVao = [null, "", GAN, MA_KHAC, MA_DUNG, "ZXX4A"];
    for (const g of dauVao) {
      for (const n of [0, 1, 2]) {
        expect(lyDoCuaKQ(phanLoaiSaiMa(v({ ghiChu: g, soUngVien: n, soPhieuTheCanhTranh: 1, duLieuThieu: true, soLanBiBac: 1 })))).not.toContain(
          "GHI_TU_DONG_KHONG_DUOC",
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15 · locUngVien
// ─────────────────────────────────────────────────────────────────────────────
const SO_TIEN = 4_000_000;
const DONG_TOT: DongUngVien = {
  maGiaoDich: "FXHN300000001",
  loaiGiaoDich: "Thanh toán",
  trangThai: "Thành công",
  soTien: SO_TIEN,
  trangThaiHoanHuy: null,
  canhBaoHuy: false,
  daGoGan: false,
  coDongHuyTroVao: false,
  coDongKhacLoaiCungRrn: false,
  daBiBacChoDon: false,
};

describe("[HN3-15] locUngVien — mỗi vế loại một ứng viên, KÈM đối chứng dương (bỏ đúng vế ấy thì thành ứng viên)", () => {
  it("dòng tốt là ứng viên (đối chứng gốc)", () => {
    expect(locUngVien([DONG_TOT], SO_TIEN)).toEqual([DONG_TOT]);
  });

  const BANG: [string, Partial<DongUngVien>][] = [
    ["lệch +1 đồng", { soTien: SO_TIEN + 1 }],
    ["lệch −1 đồng", { soTien: SO_TIEN - 1 }],
    ["loại giao dịch ≠ Thanh toán (Hủy)", { loaiGiaoDich: "Hủy" }],
    ["loại giao dịch ≠ Thanh toán (Hoàn)", { loaiGiaoDich: "Hoàn" }],
    ["trạng thái ≠ Thành công (Thất bại)", { trangThai: "Thất bại" }],
    ["trạng thái ≠ Thành công (Đang xử lý)", { trangThai: "Đang xử lý" }],
    ["cột Hoàn/Hủy: toàn phần", { trangThaiHoanHuy: "Hủy toàn phần" }],
    ["cột Hoàn/Hủy: MỘT phần (Q-G)", { trangThaiHoanHuy: "Hoàn một phần" }],
    ["cột Hoàn/Hủy: giá trị lạ (Q-I fail-closed)", { trangThaiHoanHuy: "Chờ hủy" }],
    ["cảnh báo hủy sau ghi nhận", { canhBaoHuy: true }],
    ["kế toán đã GỠ GẮN (đã quyết)", { daGoGan: true }],
    ["có dòng hủy trỏ vào (maGiaoDichGoc)", { coDongHuyTroVao: true }],
    ["có dòng không-phải-thanh-toán cùng RRN", { coDongKhacLoaiCungRrn: true }],
    ["giao dịch đã bị kế toán bác cho ĐƠN này (Việc 5: qua bất kỳ phiếu thẻ/phiếu gộp nào của đơn)", { daBiBacChoDon: true }],
    ["số tiền không dương", { soTien: 0 }],
  ];
  it.each(BANG)("%s ⇒ KHÔNG là ứng viên", (_ten, doi) => {
    const conPhaiThu = doi.soTien === 0 ? 0 : SO_TIEN;
    expect(locUngVien([{ ...DONG_TOT, ...doi }], conPhaiThu)).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG cho vế số tiền: lệch ±1 đồng so với conPhaiThu cũ nhưng bằng conPhaiThu mới ⇒ lại là ứng viên", () => {
    expect(locUngVien([{ ...DONG_TOT, soTien: SO_TIEN + 1 }], SO_TIEN + 1)).toHaveLength(1);
    expect(locUngVien([{ ...DONG_TOT, soTien: SO_TIEN - 1 }], SO_TIEN - 1)).toHaveLength(1);
  });

  it.each(BANG.filter(([, d]) => d.soTien === undefined))(
    "ĐỐI CHỨNG DƯƠNG: %s — gỡ đúng vế ấy (khôi phục giá trị tốt) thì lại là ứng viên",
    (_ten, doi) => {
      const khoiPhuc = Object.fromEntries(Object.keys(doi).map((k) => [k, DONG_TOT[k as keyof DongUngVien]]));
      expect(locUngVien([{ ...DONG_TOT, ...doi, ...khoiPhuc }], SO_TIEN)).toHaveLength(1);
    },
  );

  it("chuẩn hoá chữ giống luật 1–2 của đường tiền: 'Thành công' / 'Thanh toán' dạng NFD, thừa khoảng trắng, hoa/thường", () => {
    const nfd: DongUngVien = {
      ...DONG_TOT,
      loaiGiaoDich: "  Thanh   toán ".normalize("NFD"),
      trangThai: "THÀNH CÔNG".normalize("NFD"),
    };
    expect(locUngVien([nfd], SO_TIEN)).toHaveLength(1);
  });

  it("giữ thứ tự và các trường mở rộng; lọc nhiều dòng một lượt", () => {
    const a = { ...DONG_TOT, maGiaoDich: "A", them: 1 };
    const b = { ...DONG_TOT, maGiaoDich: "B", soTien: SO_TIEN + 1, them: 2 };
    const c = { ...DONG_TOT, maGiaoDich: "C", them: 3 };
    expect(locUngVien([a, b, c], SO_TIEN).map((x) => x.them)).toEqual([1, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16 · câu chữ — không câu nào nhắc huỷ
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-16] cauLyDo phủ mọi mã; CAU_KHONG_UNG_VIEN nguyên văn đặc tả; KHÔNG chuỗi nào khớp /hủy|huỷ/", () => {
  it("mọi lý do có câu riêng, khác nhau, không rỗng", () => {
    const cau = THU_TU_LY_DO.map((l) => cauLyDo(l));
    for (const c of cau) expect(c.length).toBeGreaterThan(20);
    expect(new Set(cau).size).toBe(THU_TU_LY_DO.length);
  });

  it("[HN3-16b] nhãn NGẮN cho bảng kế toán: mỗi lý do có nhãn riêng, ngắn hơn câu đầy đủ, không hủy/huỷ, không lệnh quẹt lại", () => {
    const nhan = THU_TU_LY_DO.map((l) => nhanLyDo(l));
    expect(new Set(nhan).size, "nhãn khác nhau").toBe(THU_TU_LY_DO.length);
    for (const l of THU_TU_LY_DO) {
      const n = nhanLyDo(l);
      expect(n.length, `${l}: không rỗng`).toBeGreaterThan(10);
      expect(n.length, `${l}: ngắn hơn câu của sale`).toBeLessThan(cauLyDo(l).length);
      expect(n, n).not.toMatch(/hủy|huỷ/i);
      expect(n, n).not.toMatch(/quẹt lại/i);
      expect(n, `${l}: nhãn không phải câu mệnh lệnh của sale`).not.toMatch(/cần kế toán/i);
    }
  });

  it("CAU_KHONG_UNG_VIEN nguyên văn đặc tả của chủ dự án (09/10/2026)", () => {
    expect(CAU_KHONG_UNG_VIEN).toBe(
      "Không thấy giao dịch nào đúng số tiền trên máy này từ lúc mở phiếu. Kiểm tra biên lai: giao dịch có THÀNH CÔNG không, đúng máy không.",
    );
  });

  it("đặc tả điều 6: không hướng dẫn huỷ giao dịch trên máy rồi quẹt lại — không chuỗi người dùng nào chứa hủy/huỷ", () => {
    const tatCa = [
      CAU_KHONG_UNG_VIEN,
      CAU_CHO_KE_TOAN,
      CAU_DA_XU_LY_NGOAI,
      cauTuChoi("không đúng giao dịch của khách"),
      cauTuChoi(null),
      ...THU_TU_LY_DO.map((l) => cauLyDo(l)),
    ];
    for (const c of tatCa) expect(c, c).not.toMatch(/hủy|huỷ/i);
    // Và tuyệt đối không MỜI quẹt lại (chỉ được CẤM: "ĐỪNG cho khách quẹt lại").
    for (const c of tatCa) expect(c, c).not.toMatch(/(?<!ĐỪNG )cho (?:khách )?quẹt lại/i);
  });

  it("câu từ chối mang lý do của kế toán và lệnh cấm quẹt lại", () => {
    const c = cauTuChoi("khách quẹt ở máy khác");
    expect(c).toContain("khách quẹt ở máy khác");
    expect(c).toMatch(/ĐỪNG cho khách quẹt lại/);
  });

  it("câu 'Chờ kế toán xác nhận giao dịch nhập sai mã' nguyên văn đặc tả", () => {
    expect(CAU_CHO_KE_TOAN).toMatch(/^Chờ kế toán xác nhận giao dịch nhập sai mã/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17 · nút chỉ hiện đúng một câu
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-17] laCauChuaThay đúng ⇔ kết luận CHUA_THAY; nutNhapSaiMa theo hienThi × câu", () => {
  const code5 = MA_DUNG;
  const moc = new Date("2026-10-09T03:00:00Z");
  const BIEN_THE: KetLuanPos[] = [
    { loai: "DA_THU", soTien: 1, luc: moc, daGhiTruoc: false, giaoDichKhac: 0 },
    { loai: "DA_THU", soTien: 1, luc: moc, daGhiTruoc: true, giaoDichKhac: 2 },
    { loai: "LECH_TIEN", soTienMay: 1, soTienPhieu: 2 },
    { loai: "LECH_TIEN", soTienMay: 1, soTienPhieu: null },
    { loai: "CAN_XU_LY", soTienMay: 1, lyDo: "x" },
    { loai: "CAN_XU_LY", soTienMay: null, lyDo: "x" },
    { loai: "THAT_BAI", maLoi: null, nhom: "KHACH_HUY" },
    { loai: "THAT_BAI", maLoi: "05", nhom: "THE_TU_CHOI" },
    { loai: "THAT_BAI", maLoi: null, nhom: "DA_HUY_TREN_MAY" },
    { loai: "THAT_BAI", maLoi: "THAT_BAI", nhom: "THAT_BAI_RO" },
    { loai: "THAT_BAI", maLoi: "ABC", nhom: "KHAC" },
    { loai: "CHUA_THAY", code5, duLieuLuc: moc, gdMoiNhatLuc: moc, taoLuc: moc, baoAdminTuLuc: moc },
    { loai: "CHUA_THAY", code5, duLieuLuc: null, gdMoiNhatLuc: null, taoLuc: moc, baoAdminTuLuc: moc },
    { loai: "CHUA_THAY", code5, duLieuLuc: moc, gdMoiNhatLuc: null, taoLuc: moc, baoAdminTuLuc: moc, cheDo: "AGENT" },
    { loai: "HUY_SAU_THU", soTien: null },
    { loai: "DANG_CHO_NGAN_HANG", code5, maTrangThai: "DANG_XU_LY" },
    { loai: "DANG_CHO_NGAN_HANG", code5, maTrangThai: "DANG_XU_LY", cheDo: "AGENT" },
    { loai: "LOI_KET_NOI", maLoi: "TCB_FILE_DB" },
    { loai: "CHUA_XAC_DINH" },
    { loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "HET_PHIEN", maLoi: "AGENT_HET_PHIEN" },
    { loai: "TCB_TAM_MAT_KET_NOI", coSo: "CS1", lyDo: "KHAC", maLoi: "AGENT_MAT_KET_NOI" },
    { loai: "DANG_DONG_BO", code5 },
    { loai: "MAY_KHONG_DOC_DUOC", code5 },
  ];

  it("chạy thongDiepPos trên MỌI biến thể: đúng CHUA_THAY thì true, ba kết luận NOT_FOUND còn lại và mọi kết luận khác thì false", () => {
    expect(BIEN_THE.length).toBeGreaterThanOrEqual(23);
    for (const k of BIEN_THE) {
      const { cau } = thongDiepPos(k);
      expect(laCauChuaThay(cau), `${k.loai}: ${cau}`).toBe(k.loai === "CHUA_THAY");
    }
    // Bốn kết luận mà `lastResultKind = NOT_FOUND` bao: chỉ MỘT trong đó là "Chưa thấy" (Đ9).
    const notFound = BIEN_THE.filter((k) => ["CHUA_THAY", "DANG_CHO_NGAN_HANG", "DANG_DONG_BO", "MAY_KHONG_DOC_DUOC"].includes(k.loai));
    expect(notFound.filter((k) => laCauChuaThay(thongDiepPos(k).cau)).map((k) => k.loai)).toEqual(["CHUA_THAY", "CHUA_THAY", "CHUA_THAY"]);
  });

  it("tiền tố là HẰNG dùng chung với bộ dựng câu: câu CHUA_THAY bắt đầu bằng TIEN_TO_CHUA_THAY + mã", () => {
    const cau = thongDiepPos({ loai: "CHUA_THAY", code5, duLieuLuc: null, gdMoiNhatLuc: null, taoLuc: moc, baoAdminTuLuc: moc }).cau;
    expect(cau.startsWith(`${TIEN_TO_CHUA_THAY}${code5}. `)).toBe(true);
    expect(TIEN_TO_CHUA_THAY).toBe("Chưa thấy giao dịch mang mã ");
    expect(laCauChuaThay(null)).toBe(false);
    expect(laCauChuaThay("")).toBe(false);
  });

  it("nutNhapSaiMa: CHỈ khi hienThi = CHO_QUET ∧ câu 'Chưa thấy'", () => {
    const chuaThay = thongDiepPos(BIEN_THE[11]!).cau;
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: chuaThay })).toBe(true);
    for (const h of ["THAT_BAI", "DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "PHIEU_DA_DONG", "KE_TOAN_DA_GHI", "KE_TOAN_DA_GO", "HUY"] as const) {
      expect(nutNhapSaiMa({ hienThi: h, thongDiep: chuaThay }), `hienThi ${h} ⇒ không nút`).toBe(false);
    }
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: null })).toBe(false);
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: thongDiepPos(BIEN_THE[15]!).cau })).toBe(false); // đang chờ ngân hàng
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: thongDiepPos(BIEN_THE[21]!).cau })).toBe(false); // đang đồng bộ
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: thongDiepPos(BIEN_THE[22]!).cau })).toBe(false); // máy không đọc được
    expect(nutNhapSaiMa({ hienThi: "CHO_QUET", thongDiep: thongDiepPos(BIEN_THE[18]!).cau })).toBe(false); // chưa xác định (tiền có thể đã trừ)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18 · hiệu lực suy · ma trận chuyển trạng thái · tự duyệt
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-18] trangThaiHieuLuc · chuyenHopLe · chanTuDuyet", () => {
  const NOW = new Date("2026-10-09T05:00:00Z");
  const truoc = (ms: number) => new Date(NOW.getTime() - ms);
  const x = (p: Partial<Parameters<typeof trangThaiHieuLuc>[0]>) =>
    trangThaiHieuLuc({ trangThai: "CHO_DUYET", btStatus: "UNMATCHED", btDaGoGan: false, dangGhiLuc: null, now: NOW, ...p });

  it("DA_GHI_NHAN và TU_CHOI đứng nguyên bất kể giao dịch", () => {
    expect(x({ trangThai: "DA_GHI_NHAN", btStatus: "MATCHED" })).toBe("DA_GHI_NHAN");
    expect(x({ trangThai: "DA_GHI_NHAN", btStatus: "UNMATCHED", btDaGoGan: true })).toBe("DA_GHI_NHAN");
    expect(x({ trangThai: "TU_CHOI", btStatus: "UNMATCHED" })).toBe("TU_CHOI");
  });

  it("CHO_DUYET: giao dịch vẫn UNMATCHED, chưa gỡ gắn ⇒ CHO_DUYET; MATCHED / IGNORED / đã gỡ gắn ⇒ DA_XU_LY_NGOAI", () => {
    expect(x({})).toBe("CHO_DUYET");
    expect(x({ btStatus: "MATCHED" })).toBe("DA_XU_LY_NGOAI");
    expect(x({ btStatus: "IGNORED" })).toBe("DA_XU_LY_NGOAI");
    expect(x({ btDaGoGan: true })).toBe("DA_XU_LY_NGOAI");
  });

  it("DANG_GHI: dưới 2 phút ⇒ DANG_GHI; từ đúng 2 phút ⇒ KET; thiếu dangGhiLuc (dữ liệu hỏng) ⇒ KET", () => {
    expect(DANG_GHI_KET_SAU_MS).toBe(2 * 60_000);
    expect(x({ trangThai: "DANG_GHI", dangGhiLuc: truoc(1) })).toBe("DANG_GHI");
    expect(x({ trangThai: "DANG_GHI", dangGhiLuc: truoc(119_999) })).toBe("DANG_GHI");
    expect(x({ trangThai: "DANG_GHI", dangGhiLuc: truoc(120_000) })).toBe("KET");
    expect(x({ trangThai: "DANG_GHI", dangGhiLuc: truoc(10 * 60_000) })).toBe("KET");
    expect(x({ trangThai: "DANG_GHI", dangGhiLuc: null })).toBe("KET");
  });

  it("ma trận chuyển trạng thái: CHỈ các cạnh của vòng đời", () => {
    const hopLe = new Set(["CHO_DUYET>DANG_GHI", "CHO_DUYET>TU_CHOI", "DANG_GHI>DA_GHI_NHAN", "DANG_GHI>CHO_DUYET", "DANG_GHI>DANG_GHI"]);
    const tt = ["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN", "TU_CHOI"] as const;
    for (const tu of tt) for (const den of tt) expect(chuyenHopLe(tu, den), `${tu} → ${den}`).toBe(hopLe.has(`${tu}>${den}`));
    // Hai trạng thái cuối không có cạnh ra.
    for (const den of tt) {
      expect(chuyenHopLe("DA_GHI_NHAN", den)).toBe(false);
      expect(chuyenHopLe("TU_CHOI", den)).toBe(false);
    }
    // Không thể TỪ CHỐI một yêu cầu đang ghi tiền.
    expect(chuyenHopLe("DANG_GHI", "TU_CHOI")).toBe(false);
  });

  it("chanTuDuyet: cùng người ⇒ có câu từ chối; khác người ⇒ null (đối chứng dương)", () => {
    expect(chanTuDuyet("u-sale", "u-sale")).toMatch(/người khác/);
    expect(chanTuDuyet("u-sale", "u-ketoan")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19 · làm sạch ghi chú hiển thị
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-19] lamSachGhiChuHienThi — ghi chú là chữ NGƯỜI GÕ trên máy dùng chung", () => {
  it("bỏ ký tự điều khiển, zero-width, điều hướng hai chiều; gộp khoảng trắng; null ⇒ rỗng", () => {
    expect(lamSachGhiChuHienThi(null)).toBe("");
    expect(lamSachGhiChuHienThi(undefined)).toBe("");
    expect(lamSachGhiChuHienThi("  a \t\n b   c  ")).toBe("a b c");
    expect(lamSachGhiChuHienThi("ZD​Z4‍X⁠﻿")).toBe("ZDZ4X");
    expect(lamSachGhiChuHienThi("abc‮def‪‫‬‭⁦⁧⁨⁩g")).toBe("abcdefg");
    expect(lamSachGhiChuHienThi("a\u0000b\u0007c\u001Bd\u007Fe\u009Ff")).toBe("a b c d e f");
  });

  it("cắt ở 120 ký tự + '…'; đúng 120 thì giữ nguyên; không cắt đôi cặp thay thế (emoji)", () => {
    expect(lamSachGhiChuHienThi("x".repeat(120))).toBe("x".repeat(120));
    expect(lamSachGhiChuHienThi("x".repeat(121))).toBe("x".repeat(120) + "…");
    const dai = lamSachGhiChuHienThi("😀".repeat(500));
    expect(Array.from(dai)).toHaveLength(121);
    expect(dai.endsWith("…")).toBe(true);
    expect(dai).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Array.from(lamSachGhiChuHienThi("a".repeat(5000)))).toHaveLength(121);
  });

  it("KHÔNG đụng chữ thường: tiếng Việt, dấu câu, số giữ nguyên", () => {
    expect(lamSachGhiChuHienThi("Học phí bé Khang - đợt 1 (ZDZ4X)")).toBe("Học phí bé Khang - đợt 1 (ZDZ4X)");
  });

  it("thẻ HTML KHÔNG bị nuốt hay thoát ở tầng này (React render text node lo phần thoát)", () => {
    expect(lamSachGhiChuHienThi("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20 · phanLoaiDongPosXacNhan — chỉ luật (6) bị thay
// ─────────────────────────────────────────────────────────────────────────────
describe("[HN3-20] phanLoaiDongPosXacNhan — chỉ luật 'tách mã từ ghi chú' bị thay; luật (1)–(5) vẫn chạy nguyên", () => {
  const dong = (p: Partial<DongPos> = {}): DongPos =>
    dongPosSchema.parse({
      maGiaoDich: "FXHN3000000AA",
      loaiGiaoDich: "Thanh toán",
      hinhThuc: "Thẻ",
      trangThai: "Thành công",
      soTien: SO_TIEN,
      thoiGian: "2026-10-09T10:00:00+07:00",
      dienGiai: GAN,
      maChuanChi: null,
      maGiaoDichThe: "998877665544",
      maGiaoDichGoc: null,
      trangThaiHoanHuy: null,
      maDonHang: null,
      maQuay: "QTT45XWQT",
      maThietBi: "FXHN3MAY",
      soTheMasked: "411111******1111",
      loaiThe: "VISA",
      maHachToan: null,
      phiGiaoDich: null,
      ...p,
    });
  const ctx = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false };

  it("ghi chú KHÔNG có mã (luật 6) ⇒ CAN_XU_LY ở bản gốc, THU(ma) ở bản xác nhận", () => {
    const d = dong({ dienGiai: GAN });
    expect(phanLoaiDongPos(d, ctx)).toMatchObject({ loai: "CAN_XU_LY", taoGiaoDich: true });
    expect(phanLoaiDongPosXacNhan(d, ctx, MA_DUNG)).toEqual({ loai: "THU", ma: MA_DUNG });
  });

  it("ghi chú có ĐÚNG MỘT mã (của phiếu khác) ⇒ THU(ma xác nhận), không phải THU(mã trong ghi chú)", () => {
    const d = dong({ dienGiai: MA_KHAC });
    expect(phanLoaiDongPos(d, ctx)).toEqual({ loai: "THU", ma: MA_KHAC });
    expect(phanLoaiDongPosXacNhan(d, ctx, MA_DUNG)).toEqual({ loai: "THU", ma: MA_DUNG });
  });

  it("ghi chú có HAI mã ⇒ THU(ma xác nhận)", () => {
    const d = dong({ dienGiai: `${MA_KHAC} ${MA_DUNG}` });
    expect(phanLoaiDongPos(d, ctx)).toMatchObject({ loai: "CAN_XU_LY" });
    expect(phanLoaiDongPosXacNhan(d, ctx, MA_DUNG)).toEqual({ loai: "THU", ma: MA_DUNG });
  });

  const GIU_NGUYEN: [string, Partial<DongPos>, typeof ctx][] = [
    ["luật 1 — trạng thái ≠ Thành công ⇒ BO_QUA", { trangThai: "Thất bại" }, ctx],
    ["luật 2 — loại ≠ Thanh toán ⇒ HUY", { loaiGiaoDich: "Hủy", maGiaoDichGoc: "FXHN3000000ZZ" }, ctx],
    ["luật 3 — hủy toàn phần (cột) ⇒ BO_QUA", { trangThaiHoanHuy: "Hủy toàn phần" }, ctx],
    ["luật 3 — dòng hủy toàn phần trong lô ⇒ BO_QUA", {}, { ...ctx, biHuyTrongLo: true }],
    ["luật 4 — số tiền ≤ 0 ⇒ CAN_XU_LY, không tạo giao dịch", { soTien: 0 }, ctx],
    ["luật 4b — hoàn MỘT phần (cột) ⇒ CHAN_HOAN_MOT_PHAN", { trangThaiHoanHuy: "Hoàn một phần" }, ctx],
    ["luật 4b — có dòng hoàn một phần trỏ tới ⇒ CHAN_HOAN_MOT_PHAN", {}, { ...ctx, biHoanMotPhan: true }],
    ["luật 5 — thiết bị CHƯA gán cơ sở ⇒ CAN_XU_LY", {}, { ...ctx, thietBiDaGan: false }],
  ];
  it.each(GIU_NGUYEN)("%s — bản xác nhận trả Y HỆT bản gốc", (_ten, doi, c) => {
    const d = dong({ dienGiai: GAN, ...doi });
    const goc = phanLoaiDongPos(d, c);
    expect(phanLoaiDongPosXacNhan(d, c, MA_DUNG)).toEqual(goc);
    expect(goc.loai, "đây không phải THU — nếu là THU thì ca kiểm nhầm thứ").not.toBe("THU");
    if (goc.loai === "CAN_XU_LY") expect(phanLoaiDongPosXacNhan(d, c, MA_DUNG).loai).toBe("CAN_XU_LY");
  });
});

describe("[HN3-RV-08c] cachXetHauKiem — chip 'Sale tự xác nhận' và nhãn người làm KHÔNG mâu thuẫn (rà đối kháng)", () => {
  const x = (kieu: "TU_GHI_NHAN" | "CHO_KE_TOAN", hieuLuc: "DA_GHI_NHAN" | "TU_CHOI" | "DA_XU_LY_NGOAI", lyDo: LyDoChoKeToan[] = []) =>
    cachXetHauKiem({ kieu, hieuLuc, lyDo });
  it("[HN3-RV-08c] bảng: bậc lúc gửi × hiệu lực × lý do (rơi về chờ duyệt) ⇒ chip + nhãn", () => {
    // Tự ghi nhận trơn: có chip.
    expect(x("TU_GHI_NHAN", "DA_GHI_NHAN")).toEqual({ chipSaleTuXacNhan: true, nhanNguoiQuyet: "Thử lại ghi nhận bởi" });
    // Tự ghi nhận rồi rơi về chờ duyệt, kế toán duyệt: có người xem xét ⇒ KHÔNG chip, "Duyệt bởi".
    expect(x("TU_GHI_NHAN", "DA_GHI_NHAN", ["GHI_TU_DONG_KHONG_DUOC"])).toEqual({ chipSaleTuXacNhan: false, nhanNguoiQuyet: "Duyệt bởi" });
    // Gửi kế toán từ đầu: không chip, "Duyệt bởi".
    expect(x("CHO_KE_TOAN", "DA_GHI_NHAN", ["NHIEU_UNG_VIEN"])).toEqual({ chipSaleTuXacNhan: false, nhanNguoiQuyet: "Duyệt bởi" });
    // Bị từ chối: nhãn "Từ chối bởi", không chip (chip chỉ cho DA_GHI_NHAN).
    expect(x("CHO_KE_TOAN", "TU_CHOI")).toEqual({ chipSaleTuXacNhan: false, nhanNguoiQuyet: "Từ chối bởi" });
    // Xử lý ở nơi khác: không chip.
    expect(x("TU_GHI_NHAN", "DA_XU_LY_NGOAI").chipSaleTuXacNhan).toBe(false);
  });
});

describe("[HN5-C1] chữ của DA_BI_TU_CHOI_TRUOC nói ĐÚNG phạm vi: vết bác khoá theo ĐƠN nên chữ là 'đơn này', KHÔNG 'phiếu' (phiếu thẻ MỚI chưa từng bị bác)", () => {
  it("[HN5-C1] câu của sale và nhãn của kế toán đều nói 'đơn', không nói 'phiếu'", () => {
    // Mã TRƯỚC Việc 5: "…cho phiếu này…" / "Phiếu này từng bị từ chối một giao dịch" — đúng khi vết bác khoá theo phiếu thẻ, SAI khi nó hiện trên phiếu thẻ mới.
    for (const c of [cauLyDo("DA_BI_TU_CHOI_TRUOC"), nhanLyDo("DA_BI_TU_CHOI_TRUOC")]) {
      expect(c, c).toMatch(/[Đđ]ơn này/);
      expect(c, c).not.toMatch(/phiếu/i);
    }
  });
});

describe("[HN5-C2] câu khi danh sách ứng viên TRỐNG: giao dịch bị kế toán bác loại đi KHÔNG được nói thành 'không thấy giao dịch nào'", () => {
  it("[HN5-C2a] không giao dịch nào bị loại vì vết bác ⇒ câu đặc tả cũ; có ≥ 1 ⇒ câu riêng", () => {
    // Mã TRƯỚC (rà đối kháng Việc 5): `cau: hienThi.length === 0 ? CAU_KHONG_UNG_VIEN : null` — X bị loại im lặng rồi màn in "Không thấy giao dịch nào…",
    // nói sai sự thật và không cấm quẹt lại. Đối chứng dương: soBiLoaiVeBac = 0 ⇒ vẫn là câu cũ nguyên văn.
    expect(cauKhongUngVien(0)).toBe(CAU_KHONG_UNG_VIEN);
    expect(cauKhongUngVien(1)).toBe(CAU_BI_BAC_KHONG_CON_UNG_VIEN);
    expect(cauKhongUngVien(3)).toBe(CAU_BI_BAC_KHONG_CON_UNG_VIEN);
    expect(CAU_BI_BAC_KHONG_CON_UNG_VIEN).not.toBe(CAU_KHONG_UNG_VIEN);
  });

  it("[HN5-C2b] chữ: nói ĐÚNG sự thật (có giao dịch, kế toán đã từ chối cho ĐƠN), CẤM quẹt lại, chỉ lối ra (báo kế toán); không huỷ/hủy; không mời quẹt lại", () => {
    const c = CAU_BI_BAC_KHONG_CON_UNG_VIEN;
    expect(c).toMatch(/kế toán đã từ chối/);
    expect(c).toMatch(/đơn này/);
    expect(c).toMatch(/ĐỪNG cho khách quẹt lại/);
    expect(c).toMatch(/báo kế toán/);
    expect(c).not.toMatch(/hủy|huỷ/i);
    expect(c).not.toMatch(/(?<!ĐỪNG )cho (?:khách )?quẹt lại/i);
    expect(c, "không phải câu 'không thấy' — vì CÓ thấy").not.toMatch(/Không thấy/);
  });
});

describe("[HN5-C3] demBiLoaiVeBac — chỉ đếm dòng bị loại ĐÚNG vì vết bác (còn lại là ứng viên nếu gỡ vết)", () => {
  const BAC: DongUngVien = { ...DONG_TOT, daBiBacChoDon: true };
  it("dòng mang vết bác và hợp lệ ở mọi vế khác ⇒ 1; không vết bác ⇒ 0 (đối chứng dương)", () => {
    expect(demBiLoaiVeBac([BAC], SO_TIEN)).toBe(1);
    expect(demBiLoaiVeBac([DONG_TOT], SO_TIEN)).toBe(0);
    expect(demBiLoaiVeBac([BAC, { ...BAC, maGiaoDich: "B" }, DONG_TOT], SO_TIEN)).toBe(2);
    expect(demBiLoaiVeBac([], SO_TIEN)).toBe(0);
  });
  it("dòng mang vết bác NHƯNG còn bị loại vì lý do khác (hủy · sai số tiền · đã gỡ gắn…) ⇒ KHÔNG tính (câu \"kế toán đã từ chối\" sẽ nói sai)", () => {
    expect(demBiLoaiVeBac([{ ...BAC, coDongHuyTroVao: true }], SO_TIEN)).toBe(0);
    expect(demBiLoaiVeBac([{ ...BAC, daGoGan: true }], SO_TIEN)).toBe(0);
    expect(demBiLoaiVeBac([{ ...BAC, soTien: SO_TIEN + 1 }], SO_TIEN)).toBe(0);
    expect(demBiLoaiVeBac([{ ...BAC, trangThai: "Thất bại" }], SO_TIEN)).toBe(0);
  });
});
