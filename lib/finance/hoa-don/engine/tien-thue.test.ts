// Ca [ENG-TT-*] — số học dòng hoá đơn bằng số nguyên VND (engine S3, shadow).
//
// Luật cần khoá: (1) tổng dòng = tổng hoá đơn TUYỆT ĐỐI với mọi đầu vào (kể cả chiết khấu chia không hết); (2) một chỗ
// làm tròn, khớp `tinhDongHoaDon` đang sống trên ba hoá đơn THẬT và trên 10.000 số ngẫu nhiên có seed; (3) nhiều mức
// thuế/một hoá đơn, KCT ≠ 0%; (4) âm chỉ khi điều chỉnh; (5) đơn vị tính / cách thể hiện số buổi là THAM SỐ.
import { describe, expect, it } from "vitest";
import { tinhDongHoaDon, tongHoaDon } from "../tinh-hoa-don";
import {
  KIEU_GIA,
  kiemBatBien,
  lamTronChia,
  phanBoChietKhau,
  tinhHoaDon,
  trinhBaySoBuoi,
  type DauVaoDongHoaDon,
  type KetQuaTinh,
  type MucThue,
} from "./tien-thue";

// PRNG có seed — KHÔNG Math.random (luật 19: test không lấy gì từ môi trường).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dong = (o: Partial<DauVaoDongHoaDon> & { ma: string; soTien: number }): DauVaoDongHoaDon => ({
  ten: `Dòng ${o.ma}`,
  donViTinh: "Lần",
  soLuong: 1,
  mucThue: { kieu: "SUAT", phanTram: 8 },
  kieuGia: KIEU_GIA.DA_GOM_THUE,
  ...o,
});

const tinh = (d: DauVaoDongHoaDon[], ck = 0, laDieuChinh = false) => tinhHoaDon({ dong: d, tongChietKhau: ck, laDieuChinh });
const phaiOk = (k: KetQuaTinh) => {
  if (!k.ok) throw new Error(`Mong ok, được lỗi: ${JSON.stringify(k.loi)}`);
  return k;
};

describe("[ENG-TT-01] ba hoá đơn THẬT (đo 14/09/2026) — cùng số với tinhDongHoaDon", () => {
  it("1C26TSR-86: 2.000.000 đã gồm thuế 8% ⇒ 1.851.852 + 148.148", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 2_000_000 })]));
    expect(k.dong[0]).toMatchObject({ thanhTien: 1_851_852, tienThue: 148_148, congTien: 2_000_000 });
    expect(k.tong.bangChu).toBe("Hai triệu đồng.");
  });
  it("1C26TSR-127: 4.000.000 CHƯA gồm thuế 8% ⇒ thuế cộng thêm 320.000, cộng 4.320.000", () => {
    const k = phaiOk(tinh([dong({ ma: "b", soTien: 4_000_000, kieuGia: KIEU_GIA.CHUA_GOM_THUE })]));
    expect(k.dong[0]).toMatchObject({ thanhTien: 4_000_000, tienThue: 320_000, congTien: 4_320_000 });
    expect(k.tong.bangChu).toBe("Bốn triệu ba trăm hai mươi nghìn đồng.");
  });
  it("1C26MNV-13: 8.976.000 đã gồm thuế 8% ⇒ 8.311.111 + 664.889", () => {
    const k = phaiOk(tinh([dong({ ma: "c", soTien: 8_976_000 })]));
    expect(k.dong[0]).toMatchObject({ thanhTien: 8_311_111, tienThue: 664_889, congTien: 8_976_000 });
    expect(k.tong.bangChu).toBe("Tám triệu chín trăm bảy mươi sáu nghìn đồng.");
  });
});

describe("[ENG-TT-02] chiết khấu phân bổ theo tỷ lệ, phần lẻ dồn dòng cuối — tổng khớp tuyệt đối", () => {
  it("chia không hết: 3 dòng 3.333.333 / 2.222.222 / 1.111.111, chiết khấu 1.000.001", () => {
    const so = [3_333_333, 2_222_222, 1_111_111];
    const p = phanBoChietKhau(so, 1_000_001)!;
    expect(p.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(p).toEqual([500_000, 333_333, 166_668]); // floor 500000, 333333, 166666 → dư 2: dòng cuối nhận trọn (còn đủ sức chứa)
  });
  it("phần dư KHÔNG làm dòng cuối âm: [1;1;1] chiết khấu 2 ⇒ dòng cuối chỉ nhận ≤ 1, phần tràn lùi lên", () => {
    const p = phanBoChietKhau([1, 1, 1], 2)!;
    expect(p.reduce((a, b) => a + b, 0)).toBe(2);
    p.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual([1, 1, 1][i]!);
    });
  });
  it("[5;5;5;1] chiết khấu 15: bản 'dồn hết vào dòng cuối' cho dòng cuối nhận 3 > 1", () => {
    const p = phanBoChietKhau([5, 5, 5, 1], 15)!;
    expect(p.reduce((a, b) => a + b, 0)).toBe(15);
    p.forEach((x, i) => expect(x).toBeLessThanOrEqual([5, 5, 5, 1][i]!));
    expect(p).toEqual([4, 5, 5, 1]); // floor 4,4,4,0 → dư 3: dòng cuối nhận 1 (đầy), lùi lên dòng 3 nhận 1, dòng 2 nhận 1
  });
  it("chiết khấu = toàn bộ ⇒ mọi dòng về 0; chiết khấu 0 ⇒ không đổi", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 123_457 }), dong({ ma: "b", soTien: 7 })], 123_464));
    expect(k.dong.map((d) => d.soTienSauChietKhau)).toEqual([0, 0]);
    expect(k.tong.congTienThanhToan).toBe(0);
    expect(phaiOk(tinh([dong({ ma: "a", soTien: 123_457 })], 0)).dong[0]!.chietKhau).toBe(0);
  });
  it("tích tiền × tiền vượt 2^53 vẫn chia đúng (không rơi vào số thực): chiết khấu 9e9 trên dòng 9e9", () => {
    const p = phanBoChietKhau([9_000_000_000, 1], 9_000_000_000)!;
    expect(p.reduce((a, b) => a + b, 0)).toBe(9_000_000_000);
    expect(p[0]!).toBeLessThanOrEqual(9_000_000_000);
  });
  it("đầu vào sai ⇒ null (không ném, không đoán)", () => {
    expect(phanBoChietKhau([10, 20], 31)).toBeNull();
    expect(phanBoChietKhau([10, 20], -1)).toBeNull();
    expect(phanBoChietKhau([10, -20], 1)).toBeNull();
    expect(phanBoChietKhau([10.5, 20], 1)).toBeNull();
  });
});

describe("[ENG-TT-03] nhiều mức thuế trên một hoá đơn · KCT ≠ 0% ≠ KKKNT", () => {
  const kct: MucThue = { kieu: "KCT" };
  const kkknt: MucThue = { kieu: "KKKNT" };
  const duLieu = [
    dong({ ma: "hoc-phi", soTien: 8_976_000, mucThue: kct }),
    dong({ ma: "kit", soTien: 1_851_851, mucThue: { kieu: "SUAT", phanTram: 8 } }),
    dong({ ma: "thi", soTien: 333_333, mucThue: { kieu: "SUAT", phanTram: 0 } }),
    dong({ ma: "khac", soTien: 77_777, mucThue: kkknt }),
  ];
  it("bốn nhóm riêng: KCT, SUAT:0, SUAT:8, KKKNT — KCT không gộp với 0%", () => {
    const k = phaiOk(tinh(duLieu));
    expect(k.tong.theoNhomThue.map((n) => n.khoa)).toEqual(["KCT", "KKKNT", "SUAT:0", "SUAT:8"]);
    expect(k.dong[0]).toMatchObject({ tienThue: 0, congTien: 8_976_000, thueSuat: 0, nhomThue: "KCT" });
    expect(kiemBatBien(k, null)).toEqual([]);
  });
  it("chiết khấu chia đều xuống từng nhóm; tổng vẫn khớp", () => {
    const k = phaiOk(tinh(duLieu, 1_234_567));
    expect(k.dong.reduce((s, d) => s + d.chietKhau, 0)).toBe(1_234_567);
    expect(kiemBatBien(k, null)).toEqual([]);
  });
  it("khớp tongHoaDon cũ khi chỉ dùng thuế suất số (đối chứng — tongHoaDon không có KCT)", () => {
    const so = [
      dong({ ma: "a", soTien: 2_000_000 }),
      dong({ ma: "b", soTien: 4_000_000, kieuGia: KIEU_GIA.CHUA_GOM_THUE }),
      dong({ ma: "c", soTien: 8_976_000, mucThue: { kieu: "SUAT", phanTram: 10 } }),
    ];
    const moi = phaiOk(tinh(so)).tong;
    const cu = tongHoaDon(so.map((d) => tinhDongHoaDon({ ten: d.ten, donViTinh: d.donViTinh, soLuong: d.soLuong, soTien: d.soTien, thueSuat: (d.mucThue as { phanTram: number }).phanTram, kieuGia: d.kieuGia })));
    expect(moi.thanhTienTruocThue).toBe(cu.thanhTienTruocThue);
    expect(moi.tienThue).toBe(cu.tienThue);
    expect(moi.congTienThanhToan).toBe(cu.congTienThanhToan);
  });
});

describe("[ENG-TT-04] âm chỉ khi hoá đơn điều chỉnh", () => {
  it("dòng âm ngoài điều chỉnh ⇒ lỗi SO_TIEN_AM (không tính 'cho có')", () => {
    const k = tinh([dong({ ma: "a", soTien: -500_000 })]);
    expect(k.ok).toBe(false);
    if (!k.ok) expect(k.loi.map((l) => l.ma)).toEqual(["SO_TIEN_AM"]);
  });
  it("điều chỉnh giảm: tính trên giá trị tuyệt đối, đặt lại dấu — đối xứng với +x", () => {
    const am = phaiOk(tinh([dong({ ma: "a", soTien: -1_234_567 })], 0, true)).dong[0]!;
    const duong = phaiOk(tinh([dong({ ma: "a", soTien: 1_234_567 })])).dong[0]!;
    expect(am.thanhTien).toBe(-duong.thanhTien);
    expect(am.tienThue).toBe(-duong.tienThue);
    expect(am.congTien).toBe(-1_234_567);
  });
  it("điều chỉnh + chiết khấu phân bổ ⇒ lỗi (ghi thẳng số điều chỉnh trên dòng)", () => {
    const k = tinh([dong({ ma: "a", soTien: -1000 })], 5, true);
    expect(k.ok).toBe(false);
    if (!k.ok) expect(k.loi.map((l) => l.ma)).toEqual(["CHIET_KHAU_VOI_DIEU_CHINH"]);
  });
});

describe("[ENG-TT-05] một quy tắc làm tròn — khớp tinhDongHoaDon trên 10.000 số có seed", () => {
  it("lamTronChia: nửa lên, số nguyên", () => {
    expect(lamTronChia(1, 2)).toBe(1);
    expect(lamTronChia(5, 10)).toBe(1);
    expect(lamTronChia(4, 10)).toBe(0);
    expect(lamTronChia(0, 7)).toBe(0);
    expect(lamTronChia(10, 3)).toBe(3);
    expect(lamTronChia(11, 3)).toBe(4);
  });
  it("mọi (số tiền × thuế suất nguyên × kiểu giá) cho CÙNG thanhTien/tienThue/congTien với tinhDongHoaDon", () => {
    const rnd = mulberry32(20261101);
    let soCa = 0;
    for (let i = 0; i < 10_000; i++) {
      const soTien = Math.floor(rnd() ** 3 * 5_000_000_000); // lệch về số nhỏ nhưng có cả cỡ tỷ
      const p = [5, 8, 10][Math.floor(rnd() * 3)]!;
      const kieuGia = rnd() < 0.5 ? KIEU_GIA.DA_GOM_THUE : KIEU_GIA.CHUA_GOM_THUE;
      const cu = tinhDongHoaDon({ ten: "x", donViTinh: "Lần", soLuong: 1, soTien, thueSuat: p, kieuGia });
      const moi = phaiOk(tinh([dong({ ma: "x", soTien, mucThue: { kieu: "SUAT", phanTram: p }, kieuGia })])).dong[0]!;
      expect([moi.thanhTien, moi.tienThue, moi.congTien]).toEqual([cu.thanhTien, cu.tienThue, cu.congTien]);
      soCa += 1;
    }
    expect(soCa).toBe(10_000);
  });
});

describe("[ENG-TT-06] số buổi / đơn vị tính là THAM SỐ chính sách — 12/27/48 buổi", () => {
  const goc = { tenGoc: "Sata 4", donViTinhKhoa: "Khoá", donViTinhBuoi: "Buổi", mauMoTaSoBuoi: "({n} buổi)" } as const;
  it.each([12, 27, 48])("MOT_KHOA_MO_TA_SO_BUOI: %i buổi ⇒ 1 Khoá, tên mang số buổi", (n) => {
    const r = trinhBaySoBuoi({ ...goc, soBuoi: n, cach: "MOT_KHOA_MO_TA_SO_BUOI" });
    expect(r).toEqual({ ok: true, dong: { ten: `Sata 4 (${n} buổi)`, donViTinh: "Khoá", soLuong: 1, moTaSoBuoi: `(${n} buổi)` } });
  });
  it.each([12, 27, 48])("SO_BUOI_LA_SO_LUONG: %i buổi ⇒ %i Buổi", (n) => {
    const r = trinhBaySoBuoi({ ...goc, soBuoi: n, cach: "SO_BUOI_LA_SO_LUONG" });
    expect(r).toEqual({ ok: true, dong: { ten: "Sata 4", donViTinh: "Buổi", soLuong: n, moTaSoBuoi: null } });
  });
  it("không có số buổi ⇒ một dòng, đơn vị khoá, tên giữ nguyên; số buổi sai ⇒ lỗi", () => {
    expect(trinhBaySoBuoi({ ...goc, soBuoi: null, cach: "SO_BUOI_LA_SO_LUONG" })).toMatchObject({ ok: true, dong: { soLuong: 1, donViTinh: "Khoá", ten: "Sata 4" } });
    expect(trinhBaySoBuoi({ ...goc, soBuoi: -3, cach: "MOT_KHOA_MO_TA_SO_BUOI" })).toMatchObject({ ok: false, loi: { ma: "SO_BUOI_SAI" } });
    expect(trinhBaySoBuoi({ ...goc, soBuoi: 12.5, cach: "MOT_KHOA_MO_TA_SO_BUOI" })).toMatchObject({ ok: false, loi: { ma: "SO_BUOI_SAI" } });
  });
  it("48 buổi, 8.976.000 đã gồm thuế: đơn giá là PHÂN SỐ 8.311.111/48 — tiền vẫn là thanhTien, không nhân ngược lại", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 8_976_000, soLuong: 48, donViTinh: "Buổi" })]));
    const d = k.dong[0]!;
    expect(d.donGia).toEqual({ tu: 8_311_111, mau: 48 });
    expect(d.thanhTien).toBe(8_311_111); // 8.311.111 ≠ 48 × round(8.311.111/48): nhân ngược sẽ lệch
    expect(d.chup).toMatchObject({ soLuong: 48, donViTinh: "Buổi", kieuGia: KIEU_GIA.DA_GOM_THUE });
  });
});

describe("[ENG-TT-07] snapshot của dòng giữ nguyên thứ quyết định số tiền", () => {
  it("chụp mức thuế · kiểu giá · đơn vị · số lượng · mô tả số buổi · tham chiếu chính sách", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 5_555_555, soLuong: 27, donViTinh: "Buổi", moTaSoBuoi: "(27 buổi)", thamChieuChinhSach: "HIEN_HANH:COURSE@v1", mucThue: { kieu: "KCT" } })]));
    expect(k.dong[0]!.chup).toEqual({
      kieuGia: KIEU_GIA.DA_GOM_THUE,
      mucThue: { kieu: "KCT" },
      donViTinh: "Buổi",
      soLuong: 27,
      moTaSoBuoi: "(27 buổi)",
      thamChieuChinhSach: "HIEN_HANH:COURSE@v1",
    });
  });
});

describe("[ENG-TT-08] đầu vào sai ⇒ báo MỌI lỗi có mã, không số 'gần đúng'", () => {
  it("gom lỗi: dòng trùng mã, số lượng 0, thuế suất lẻ, số tiền lẻ, thiếu đơn vị", () => {
    const k = tinh([
      dong({ ma: "a", soTien: 100 }),
      dong({ ma: "a", soTien: 100.5 }),
      dong({ ma: "b", soTien: 100, soLuong: 0 }),
      dong({ ma: "c", soTien: 100, mucThue: { kieu: "SUAT", phanTram: 8.5 } }),
      dong({ ma: "d", soTien: 100, donViTinh: "  " }),
    ]);
    expect(k.ok).toBe(false);
    if (!k.ok) expect(new Set(k.loi.map((l) => l.ma))).toEqual(new Set(["TRUNG_MA_DONG", "SO_TIEN_KHONG_NGUYEN", "SO_LUONG_SAI", "THUE_SUAT_SAI", "THIEU_DON_VI_TINH"]));
  });
  it("không dòng nào / chiết khấu quá tổng / chiết khấu âm", () => {
    const ma = (k: KetQuaTinh) => (k.ok ? ["ok"] : k.loi.map((l) => l.ma));
    expect(ma(tinh([]))).toEqual(["KHONG_CO_DONG"]);
    expect(ma(tinh([dong({ ma: "a", soTien: 100 })], 101))).toEqual(["CHIET_KHAU_QUA_TONG"]);
    expect(ma(tinh([dong({ ma: "a", soTien: 100 })], -1))).toEqual(["CHIET_KHAU_SAI"]);
  });
});

describe("[ENG-TT-09] property: Σ dòng === tổng với đầu vào ngẫu nhiên có seed — mọi bất biến", () => {
  const MUC: MucThue[] = [{ kieu: "SUAT", phanTram: 0 }, { kieu: "SUAT", phanTram: 5 }, { kieu: "SUAT", phanTram: 8 }, { kieu: "SUAT", phanTram: 10 }, { kieu: "KCT" }, { kieu: "KKKNT" }];
  it("3.000 hoá đơn (1–9 dòng, chiết khấu 0 / 1 / tổng−1 / tổng / ngẫu nhiên) không vi phạm BB1–BB7, không dòng âm", () => {
    const rnd = mulberry32(8976000);
    for (let i = 0; i < 3_000; i++) {
      const n = 1 + Math.floor(rnd() * 9);
      const d: DauVaoDongHoaDon[] = [];
      for (let j = 0; j < n; j++) {
        const lon = rnd() < 0.15 ? 0 : 1 + Math.floor(rnd() ** 4 * 200_000_000); // cả dòng 0đ lẫn dòng tới 2 trăm triệu
        d.push(dong({ ma: `d${j}`, soTien: lon, mucThue: MUC[Math.floor(rnd() * MUC.length)]!, kieuGia: rnd() < 0.5 ? KIEU_GIA.DA_GOM_THUE : KIEU_GIA.CHUA_GOM_THUE, soLuong: 1 + Math.floor(rnd() * 48) }));
      }
      const tong = d.reduce((s, x) => s + x.soTien, 0);
      const chon = Math.floor(rnd() * 5);
      const ck = chon === 0 ? 0 : chon === 1 ? Math.min(1, tong) : chon === 2 ? Math.max(0, tong - 1) : chon === 3 ? tong : Math.floor(rnd() * (tong + 1));
      const k = phaiOk(tinh(d, ck));
      expect(kiemBatBien(k, null), `hoá đơn #${i} ck=${ck} dòng=${d.map((x) => x.soTien).join(",")}`).toEqual([]);
      expect(k.dong.every((x) => x.soTienSauChietKhau >= 0 && x.chietKhau >= 0 && x.chietKhau <= x.soTienGoc)).toBe(true);
      expect(k.dong.reduce((s, x) => s + x.chietKhau, 0)).toBe(ck);
    }
  });
  it("mọi dòng ĐÃ GỒM thuế: tổng thanh toán == tổng khách trả sau chiết khấu (BB7)", () => {
    const rnd = mulberry32(27121248);
    for (let i = 0; i < 500; i++) {
      const d = [1, 2, 3].map((j) => dong({ ma: `x${j}`, soTien: 1 + Math.floor(rnd() * 90_000_000), mucThue: MUC[Math.floor(rnd() * MUC.length)]! }));
      const tong = d.reduce((s, x) => s + x.soTien, 0);
      const ck = Math.floor(rnd() * (tong + 1));
      const k = phaiOk(tinh(d, ck));
      expect(kiemBatBien(k, tong - ck)).toEqual([]);
    }
  });
});

describe("[ENG-TT-10] kiemBatBien CẮN: sửa tay một kết quả đúng ⇒ bắt đúng bất biến", () => {
  const dung = () => phaiOk(tinh([dong({ ma: "a", soTien: 8_976_000 }), dong({ ma: "b", soTien: 2_000_001, mucThue: { kieu: "KCT" } })], 1_001));
  const sua = (f: (k: Extract<KetQuaTinh, { ok: true }>) => void) => {
    const k = dung();
    f(k);
    return kiemBatBien(k, null).map((v) => v.ma);
  };
  it("kết quả nguyên vẹn ⇒ rỗng", () => expect(kiemBatBien(dung(), null)).toEqual([]));
  it("lệch tổng ⇒ BB1", () => expect(sua((k) => (k.tong.tienThue += 1))).toContain("BB1"));
  it("dòng lệch thành tiền+thuế ≠ cộng tiền ⇒ BB2", () => expect(sua((k) => (k.dong[0]!.tienThue += 1))).toContain("BB2"));
  it("chiết khấu dòng lệch tổng ⇒ BB3", () => expect(sua((k) => (k.dong[1]!.chietKhau += 1))).toContain("BB3"));
  it("gốc − chiết khấu ≠ sau chiết khấu ⇒ BB4", () => expect(sua((k) => (k.dong[0]!.soTienSauChietKhau += 1))).toContain("BB4"));
  it("dòng âm ngoài điều chỉnh ⇒ BB5", () => expect(sua((k) => (k.dong[1]!.congTien = -1))).toContain("BB5"));
  it("nhóm thuế lệch tổng ⇒ BB6", () => expect(sua((k) => (k.tong.theoNhomThue[0]!.tienThue += 1))).toContain("BB6"));
  it("khách trả khác tổng ⇒ BB7", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 8_976_000 })]));
    expect(kiemBatBien(k, 8_976_001).map((v) => v.ma)).toContain("BB7");
  });
});

describe("[ENG-TT-11] biên của thuế suất: 0 và 100 hợp lệ; −1 và 101 bị từ chối; số buổi 0 = không có số buổi", () => {
  const loiThue = (phanTram: number) => {
    const k = tinh([dong({ ma: "a", soTien: 1_000_003, mucThue: { kieu: "SUAT", phanTram } })]);
    return k.ok ? [] : k.loi.map((l) => l.ma);
  };
  it.each([[0], [100]])("thuế suất %i (hai đầu của khoảng) ⇒ hợp lệ", (p) => {
    expect(loiThue(p)).toEqual([]);
  });
  it.each([[101], [-1], [100.5]])("thuế suất %s (sát ngoài khoảng / lẻ) ⇒ THUE_SUAT_SAI, không tính", (p) => {
    expect(loiThue(p)).toEqual(["THUE_SUAT_SAI"]);
  });
  it("thuế suất 100 tính thật: đã gồm thuế ⇒ thành tiền = nửa số tiền (làm tròn nửa lên), thuế = phần dư", () => {
    const k = phaiOk(tinh([dong({ ma: "a", soTien: 1_000_003, mucThue: { kieu: "SUAT", phanTram: 100 } })]));
    expect(k.dong[0]).toMatchObject({ thanhTien: 500_002, tienThue: 500_001, congTien: 1_000_003 });
  });

  const goc = { tenGoc: "Sata 4", donViTinhKhoa: "Khoá", donViTinhBuoi: "Buổi", mauMoTaSoBuoi: "({n} buổi)" } as const;
  it.each([["MOT_KHOA_MO_TA_SO_BUOI"], ["SO_BUOI_LA_SO_LUONG"]] as const)("soBuoi = 0 (%s) ⇒ một dòng, đơn vị khoá, số lượng 1, KHÔNG mô tả '(0 buổi)'", (cach) => {
    expect(trinhBaySoBuoi({ ...goc, soBuoi: 0, cach })).toEqual({ ok: true, dong: { ten: "Sata 4", donViTinh: "Khoá", soLuong: 1, moTaSoBuoi: null } });
  });
  it("soBuoi = 1 là số buổi THẬT (không bị coi như 0)", () => {
    expect(trinhBaySoBuoi({ ...goc, soBuoi: 1, cach: "SO_BUOI_LA_SO_LUONG" })).toEqual({ ok: true, dong: { ten: "Sata 4", donViTinh: "Buổi", soLuong: 1, moTaSoBuoi: null } });
    expect(trinhBaySoBuoi({ ...goc, soBuoi: 1, cach: "MOT_KHOA_MO_TA_SO_BUOI" })).toMatchObject({ ok: true, dong: { ten: "Sata 4 (1 buổi)", moTaSoBuoi: "(1 buổi)" } });
  });
});
