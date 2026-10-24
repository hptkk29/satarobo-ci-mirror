import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHINH_SACH_PL02,
  GIA_48_PL02,
  LoiGiaTheoMoc,
  chonNgayApGia,
  tinhGiaTheoMoc,
} from "./tinh-gia-theo-moc";
import { ORACLE_GIA, ORACLE_LE_KHONG_NGUYEN, ORACLE_VD_LE } from "./tinh-gia-theo-moc.oracle";

function maLoi(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof LoiGiaTheoMoc ? e.ma : `KHAC:${String(e)}`;
  }
}

describe("[TGM] giá theo mốc — đối chiếu đáp án độc lập (Fraction)", () => {
  it("[TGM-01] đáp án oracle có đủ 100 dòng (5 giá × 20 tổ hợp) — không rỗng thì mới đo được gì", () => {
    expect(ORACLE_GIA.length).toBe(100);
  });

  it("[TGM-02] mọi dòng oracle khớp từng đồng: niêm yết, % áp dụng, cờ cắt trần, thành tiền", () => {
    for (const [gia48, soBuoi, thuTuCon, thuTuSp48, niemYet, ap, catTran, thanhTien] of ORACLE_GIA) {
      const r = tinhGiaTheoMoc({ gia48, soBuoi, thuTuCon, thuTuSanPham48: thuTuSp48 });
      const nhan = `${gia48}/${soBuoi}b/con${thuTuCon}/sp${thuTuSp48}`;
      expect({ nhan, niemYet: r.niemYet }).toEqual({ nhan, niemYet });
      expect({ nhan, ap: r.phanTramApDung }).toEqual({ nhan, ap });
      expect({ nhan, catTran: r.biCatTran }).toEqual({ nhan, catTran });
      expect({ nhan, tien: r.thanhTien }).toEqual({ nhan, tien: thanhTien });
      expect(r.giamGia).toBe(niemYet - thanhTien);
    }
  });

  it("[TGM-03] ba ví dụ văn bản SR.QD.233 (Ví dụ 1–3) + ví dụ trần 25%", () => {
    const g = GIA_48_PL02;
    expect(tinhGiaTheoMoc({ gia48: g.Sata3, soBuoi: 24, thuTuCon: 1 }).thanhTien).toBe(5_016_000);
    expect(tinhGiaTheoMoc({ gia48: g.Sata4, soBuoi: 36, thuTuCon: 2 }).thanhTien).toBe(6_912_000);
    expect(tinhGiaTheoMoc({ gia48: g.Sata5, soBuoi: 12, thuTuCon: 3 }).thanhTien).toBe(2_652_000);
    // Ví dụ 3: 5.016.000 + 6.912.000 + 2.652.000
    expect(5_016_000 + 6_912_000 + 2_652_000).toBe(14_580_000);
    const tran = tinhGiaTheoMoc({ gia48: g.Sata7, soBuoi: 48, thuTuCon: 3, thuTuSanPham48: 2 });
    expect(tran).toMatchObject({ phanTramNen: 25, phanTramCongThem: 15, phanTramApDung: 25, biCatTran: true });
    expect(tran.thanhTien).toBe(10_800_000);
  });

  it("[TGM-04] loại mua: 48 = FULL, 12/24/36 = MILESTONE, còn lại = CUSTOM", () => {
    const g = GIA_48_PL02.Sata4;
    expect(tinhGiaTheoMoc({ gia48: g, soBuoi: 48, thuTuCon: 1 }).loai).toBe("FULL");
    expect(tinhGiaTheoMoc({ gia48: g, soBuoi: 24, thuTuCon: 1 }).loai).toBe("MILESTONE");
    expect(tinhGiaTheoMoc({ gia48: g, soBuoi: 18, thuTuCon: 1, quyTacBuoiLe: "KHONG_GIAM" }).loai).toBe("CUSTOM");
  });

  it("[TGM-05] thứ tự sản phẩm chỉ ảnh hưởng gói trọn, không ảnh hưởng 12/24/36", () => {
    const g = GIA_48_PL02.Sata5;
    const a = tinhGiaTheoMoc({ gia48: g, soBuoi: 24, thuTuCon: 1, thuTuSanPham48: 1 });
    const b = tinhGiaTheoMoc({ gia48: g, soBuoi: 24, thuTuCon: 1, thuTuSanPham48: 5 });
    expect(a).toEqual(b);
    expect(tinhGiaTheoMoc({ gia48: g, soBuoi: 48, thuTuCon: 1, thuTuSanPham48: 1 }).phanTramNen).toBe(15);
    expect(tinhGiaTheoMoc({ gia48: g, soBuoi: 48, thuTuCon: 1, thuTuSanPham48: 2 }).phanTramNen).toBe(25);
  });
});

describe("[TGM] không làm tròn (QĐ-34) và số buổi lẻ (MT-11)", () => {
  it("[TGM-10] với 5 giá PL02, mọi số buổi 1..48 không giảm đều ra số nguyên (0/240 lẻ — khớp oracle)", () => {
    let khongNguyen = 0;
    for (const gia48 of Object.values(GIA_48_PL02)) {
      for (let n = 1; n <= 48; n++) {
        if (n === 48 || n === 12 || n === 24 || n === 36) continue;
        const ma = maLoi(() => tinhGiaTheoMoc({ gia48, soBuoi: n, thuTuCon: 1, quyTacBuoiLe: "KHONG_GIAM" }));
        if (ma === "PRICE_NOT_INTEGER") khongNguyen += 1;
        else expect(ma).toBeNull();
      }
    }
    expect(khongNguyen).toBe(ORACLE_LE_KHONG_NGUYEN.khongNguyen);
    expect(ORACLE_LE_KHONG_NGUYEN.tong).toBe(240);
  });

  it("[TGM-11] giá không chia hết cho 48 ⇒ PRICE_NOT_INTEGER, không cắt cụt, không làm tròn", () => {
    expect(ORACLE_VD_LE.niemYetThapPhan).toBe(1516666.67);
    expect(
      maLoi(() =>
        tinhGiaTheoMoc({ gia48: ORACLE_VD_LE.gia48, soBuoi: ORACLE_VD_LE.soBuoi, thuTuCon: 1, quyTacBuoiLe: "KHONG_GIAM" }),
      ),
    ).toBe("PRICE_NOT_INTEGER");
  });

  it("[TGM-12] giá niêm yết nguyên nhưng thành tiền lẻ vẫn bị từ chối", () => {
    // 4.800.000 × 12 ÷ 48 = 1.200.000 nguyên; giảm 15% ⇒ 4.800.000 × 12 × 85 ÷ 4800 = 1.020.000 nguyên → dùng giá khác:
    // gia48 = 4.800.001 không chia hết cho 48 nên bị chặn ở niêm yết; chọn gia48 = 48 × 7 = 336, 12 buổi, giảm 15%:
    // niêm yết 84 (nguyên); thành tiền = 336 × 12 × 85 ÷ 4800 = 71,4 (lẻ).
    expect(maLoi(() => tinhGiaTheoMoc({ gia48: 336, soBuoi: 12, thuTuCon: 3 }))).toBe("PRICE_NOT_INTEGER");
  });

  it("[TGM-12b] niêm yết lẻ mà thành tiền nguyên vẫn bị từ chối (cột giamGia là Int, niêm yết phải nguyên)", () => {
    // gia48 = 64, 1 buổi, giảm nhập tay 25%: niêm yết 64 ÷ 48 = 1,333… (lẻ) nhưng thành tiền 64 × 75 ÷ 4800 = 1 (nguyên).
    expect(
      maLoi(() => tinhGiaTheoMoc({ gia48: 64, soBuoi: 1, thuTuCon: 1, quyTacBuoiLe: "NHAP_TAY", phanTramNhapTay: 25 })),
    ).toBe("PRICE_NOT_INTEGER");
  });

  it("[TGM-13] số buổi lẻ mặc định bị TỪ CHỐI (fail-closed) cho tới khi có quy tắc", () => {
    expect(maLoi(() => tinhGiaTheoMoc({ gia48: GIA_48_PL02.Sata3, soBuoi: 18, thuTuCon: 1 }))).toBe(
      "SO_BUOI_LE_CHUA_CO_QUY_TAC",
    );
  });

  it("[TGM-14] bốn quy tắc số buổi lẻ cho bốn kết quả khác nhau (18 buổi, Sata4, con 1)", () => {
    const g = GIA_48_PL02.Sata4; // niêm yết 18 buổi = 4.320.000
    const f = (quyTacBuoiLe: "KHONG_GIAM" | "MOC_THAP_HON" | "NHAP_TAY") =>
      tinhGiaTheoMoc({ gia48: g, soBuoi: 18, thuTuCon: 1, quyTacBuoiLe, phanTramNhapTay: 8 });
    expect(f("KHONG_GIAM").thanhTien).toBe(4_320_000); // 0%
    expect(f("MOC_THAP_HON").thanhTien).toBe(4_320_000); // mốc thấp hơn gần nhất = 12 buổi → 0%
    expect(f("NHAP_TAY").thanhTien).toBe(3_974_400); // 8%
    // 30 buổi: mốc thấp hơn = 24 (5%)
    expect(
      tinhGiaTheoMoc({ gia48: g, soBuoi: 30, thuTuCon: 1, quyTacBuoiLe: "MOC_THAP_HON" }).phanTramNen,
    ).toBe(5);
  });

  it("[TGM-15] NHAP_TAY thiếu hoặc sai phần trăm bị từ chối", () => {
    const g = GIA_48_PL02.Sata4;
    expect(maLoi(() => tinhGiaTheoMoc({ gia48: g, soBuoi: 18, thuTuCon: 1, quyTacBuoiLe: "NHAP_TAY" }))).toBe(
      "THIEU_PHAN_TRAM_NHAP_TAY",
    );
    for (const p of [-1, 101, 2.5]) {
      expect(
        maLoi(() => tinhGiaTheoMoc({ gia48: g, soBuoi: 18, thuTuCon: 1, quyTacBuoiLe: "NHAP_TAY", phanTramNhapTay: p })),
      ).toBe("PHAN_TRAM_KHONG_HOP_LE");
    }
  });

  it("[TGM-16] đầu vào rác bị chặn: số buổi 0/âm/lẻ thập phân/quá 48, thứ tự 0, giá âm", () => {
    const g = GIA_48_PL02.Sata3;
    for (const soBuoi of [0, -12, 12.5, 49, Number.NaN]) {
      expect(maLoi(() => tinhGiaTheoMoc({ gia48: g, soBuoi, thuTuCon: 1 }))).toBe("SO_BUOI_KHONG_HOP_LE");
    }
    expect(maLoi(() => tinhGiaTheoMoc({ gia48: g, soBuoi: 12, thuTuCon: 0 }))).toBe("THU_TU_KHONG_HOP_LE");
    expect(maLoi(() => tinhGiaTheoMoc({ gia48: g, soBuoi: 48, thuTuCon: 1, thuTuSanPham48: 0 }))).toBe(
      "THU_TU_KHONG_HOP_LE",
    );
    for (const gia of [0, -1, 1.5]) {
      expect(maLoi(() => tinhGiaTheoMoc({ gia48: gia, soBuoi: 12, thuTuCon: 1 }))).toBe("GIA_KHONG_HOP_LE");
    }
  });

  it("[TGM-17] chính sách truyền vào thật sự được dùng (không đọc hằng cứng)", () => {
    const cs = { ...CHINH_SACH_PL02, bangA: { 12: 20, 24: 30, 36: 40 }, tranTong: 50 };
    const r = tinhGiaTheoMoc({ gia48: GIA_48_PL02.Sata3, soBuoi: 24, thuTuCon: 2, chinhSach: cs });
    expect(r.phanTramApDung).toBe(40); // 30 + 10
    expect(r.thanhTien).toBe(10_560_000 / 2 * 0.6);
  });
});

describe("[TGM] mốc ngày áp giá (MT-02)", () => {
  const taoDon = new Date("2026-12-30T03:00:00Z");
  const tienVe = new Date("2027-01-02T03:00:00Z");

  it("[TGM-20] ORDER_CREATED luôn trả ngày tạo đơn; PAYMENT_RECEIVED trả ngày tiền về", () => {
    expect(chonNgayApGia("ORDER_CREATED", { taoDon, tienVe })).toBe(taoDon);
    expect(chonNgayApGia("PAYMENT_RECEIVED", { taoDon, tienVe })).toBe(tienVe);
  });

  it("[TGM-21] PAYMENT_RECEIVED mà tiền chưa về ⇒ null, KHÔNG rơi về ngày tạo đơn", () => {
    expect(chonNgayApGia("PAYMENT_RECEIVED", { taoDon })).toBeNull();
    expect(chonNgayApGia("PAYMENT_RECEIVED", { taoDon, tienVe: null })).toBeNull();
  });
});

describe("[TGM-PIN] lưới ghim mã nguồn", () => {
  const goc = resolve(process.cwd(), "lib/pricing");
  const tepNguon = readdirSync(goc)
    .filter((t) => /\.ts$/.test(t) && !/\.(test|oracle)\.ts$/.test(t))
    .map((t) => ({ t, ma: readFileSync(resolve(goc, t), "utf8") }));

  // Bỏ chú thích TRƯỚC khi quét: chính phần giải thích của file này nhắc tên `bang-gia-buoi`.
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("[TGM-PIN-01] có ít nhất một tệp nguồn để quét", () => {
    expect(tepNguon.length).toBeGreaterThan(0);
  });

  it("[TGM-PIN-02] không tệp nào dưới lib/pricing/ import bang-gia-buoi (làm tròn nghìn — trái QĐ-34)", () => {
    for (const { t, ma } of tepNguon) {
      expect({ t, nhap: /from\s+["'][^"']*bang-gia-buoi["']/.test(boChuThich(ma)) }).toEqual({ t, nhap: false });
    }
  });

  it("[TGM-PIN-03] không dùng Math.round/floor/ceil/trunc trong phép tính giá", () => {
    for (const { t, ma } of tepNguon) {
      expect({ t, lamTron: /Math\.(round|floor|ceil|trunc)\s*\(/.test(boChuThich(ma)) }).toEqual({ t, lamTron: false });
    }
  });
});
