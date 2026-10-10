// [AVD-*] — "mã khuyến mãi nào dùng được cho dòng này, và trừ bao nhiêu". THUẦN.
import { describe, it, expect } from "vitest";
import {
  apDungChoKhoa,
  khaiGiamTuMa,
  locMaChoDong,
  lyDoKhongDung,
  lyDoTuMa,
  maDungDuocChoDong,
  nhanMucUuDai,
  tienGiamCuaMa,
  type BoiCanhDong,
  type MaApDung,
} from "./ap-vao-don";
import { KIEU_GIAM, gopGiamGia } from "@/lib/orders/giam-gia-dong";

/** Ngày cột `@db.Date` — nửa đêm UTC, đúng hình dạng Prisma trả về. */
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function ma(p: Partial<MaApDung> = {}): MaApDung {
  return {
    voucherId: "v1",
    ma: "FULL4HP15",
    maVanBan: "SR.QD.240",
    tenChuongTrinh: "Ưu đãi đóng đủ 4 học phần",
    kieu: "PERCENT",
    phanTram: 15,
    soTien: null,
    giamToiDa: null,
    donToiThieu: 0,
    khoaHoc: [],
    coSo: [],
    hieuLuc: { validFrom: d("2026-09-01"), validUntil: d("2027-03-01"), revokedAt: null },
    dangBat: true,
    conLuot: true,
    ...p,
  };
}

function ctx(p: Partial<BoiCanhDong> = {}): BoiCanhDong {
  return { courseId: "c-sata3", phamViCoSo: ["CS1"], ngay: "2026-09-28", tamTinhDong: 10_560_000, ...p };
}

describe("[AVD-01] phạm vi khoá học", () => {
  it("rỗng = mọi khoá", () => {
    expect(apDungChoKhoa([], "c-sata3")).toBe(true);
    expect(apDungChoKhoa([], null)).toBe(true);
  });

  it("khai đích danh ⇒ chỉ khoá trong danh sách", () => {
    expect(apDungChoKhoa(["c-sata3", "c-sata4"], "c-sata3")).toBe(true);
    expect(apDungChoKhoa(["c-sata3", "c-sata4"], "c-sata1")).toBe(false);
  });

  it("🔴 dòng KHÔNG có khoá + chính sách khai đích danh ⇒ LOẠI, không đoán", () => {
    // Đoán ngược lại là phát ưu đãi cho thứ BLĐ không ban hành cho. Ca này canh
    // fail-closed, nên nó là ca dễ bị "sửa cho tiện" nhất.
    expect(apDungChoKhoa(["c-sata3"], null)).toBe(false);
  });
});

describe("[AVD-02] lý do loại — thứ tự phải là NGUYÊN NHÂN GỐC", () => {
  it("dùng được ⇒ null", () => {
    expect(lyDoKhongDung(ma(), ctx())).toBeNull();
    expect(maDungDuocChoDong(ma(), ctx())).toBe(true);
  });

  it("mã tắt ⇒ 'tat' (thắng mọi lý do khác)", () => {
    // Mã tắt VÀ ngoài hiệu lực VÀ dưới sàn: vẫn phải báo 'tat'. Báo triệu chứng thay vì
    // nguyên nhân là sale đi sửa nhầm chỗ.
    const m = ma({ dangBat: false, donToiThieu: 99_000_000, hieuLuc: { validFrom: d("2020-01-01"), validUntil: d("2020-02-01"), revokedAt: null } });
    expect(lyDoKhongDung(m, ctx())).toBe("tat");
  });

  it("hết lượt ⇒ 'het_luot'", () => {
    expect(lyDoKhongDung(ma({ conLuot: false }), ctx())).toBe("het_luot");
  });

  it("ngoài hiệu lực ⇒ 'ngoai_hieu_luc'", () => {
    const m = ma({ hieuLuc: { validFrom: d("2026-06-01"), validUntil: d("2026-08-30"), revokedAt: null } });
    expect(lyDoKhongDung(m, ctx())).toBe("ngoai_hieu_luc");
  });

  it("đã THU HỒI trong ngày đang xét ⇒ ngoài hiệu lực (thu hồi ngày D ⇒ cuối là D−1)", () => {
    // Đây là luật của `hieu-luc.ts`, ghim lại ở đây để chắc file này KHÔNG tự viết lại
    // điều kiện — nếu ai đó chép một phép so ngày vào `lyDoKhongDung`, ca này đỏ.
    const m = ma({ hieuLuc: { validFrom: d("2026-09-01"), validUntil: d("2027-03-01"), revokedAt: d("2026-09-28") } });
    expect(lyDoKhongDung(m, ctx({ ngay: "2026-09-28" }))).toBe("ngoai_hieu_luc");
    expect(lyDoKhongDung(m, ctx({ ngay: "2026-09-27" }))).toBeNull();
  });

  it("ngoài cơ sở ⇒ 'ngoai_co_so'; rỗng = toàn hệ thống", () => {
    expect(lyDoKhongDung(ma({ coSo: ["CS2"] }), ctx({ phamViCoSo: ["CS1"] }))).toBe("ngoai_co_so");
    expect(lyDoKhongDung(ma({ coSo: [] }), ctx({ phamViCoSo: ["CS1"] }))).toBeNull();
    expect(lyDoKhongDung(ma({ coSo: ["CS1", "CS2"] }), ctx({ phamViCoSo: ["CS1"] }))).toBeNull();
  });

  it("ngoài khoá ⇒ 'ngoai_khoa'", () => {
    expect(lyDoKhongDung(ma({ khoaHoc: ["c-sata9"] }), ctx())).toBe("ngoai_khoa");
  });

  it("dưới sàn đơn ⇒ 'duoi_san_don'; ĐÚNG bằng sàn thì ĐƯỢC", () => {
    expect(lyDoKhongDung(ma({ donToiThieu: 3_000_000 }), ctx({ tamTinhDong: 2_999_999 }))).toBe("duoi_san_don");
    expect(lyDoKhongDung(ma({ donToiThieu: 3_000_000 }), ctx({ tamTinhDong: 3_000_000 }))).toBeNull();
  });
});

describe("[AVD-03] lọc cho bộ chọn của một dòng", () => {
  const ds = [
    ma({ voucherId: "v-full", ma: "FULL4HP15", khoaHoc: ["c-sata3", "c-sata4"] }),
    ma({ voucherId: "v-anhem", ma: "ANHEM500", kieu: "FIXED", phanTram: null, soTien: 500_000 }),
    ma({ voucherId: "v-som", ma: "SOM10", phanTram: 10, giamToiDa: 800_000, donToiThieu: 3_000_000 }),
    ma({ voucherId: "v-he", ma: "HE2026", hieuLuc: { validFrom: d("2026-06-01"), validUntil: d("2026-08-30"), revokedAt: null } }),
  ];

  it("dòng Sata3 giá 10,56tr ⇒ 3 mã, KHÔNG có mã hết hạn", () => {
    expect(locMaChoDong(ds, ctx()).map((m) => m.ma)).toEqual(["FULL4HP15", "ANHEM500", "SOM10"]);
  });

  it("dòng khoá KHÁC ⇒ mã giới hạn theo khoá rụng", () => {
    expect(locMaChoDong(ds, ctx({ courseId: "c-sata1" })).map((m) => m.ma)).toEqual(["ANHEM500", "SOM10"]);
  });

  it("dòng rẻ (2tr) ⇒ mã có sàn 3tr rụng", () => {
    expect(locMaChoDong(ds, ctx({ tamTinhDong: 2_000_000 })).map((m) => m.ma)).toEqual(["FULL4HP15", "ANHEM500"]);
  });

  it("giữ nguyên thứ tự đầu vào", () => {
    const daoNguoc = [...ds].reverse();
    expect(locMaChoDong(daoNguoc, ctx()).map((m) => m.ma)).toEqual(["SOM10", "ANHEM500", "FULL4HP15"]);
  });
});

describe("[AVD-04] số tiền của một mã", () => {
  it("PERCENT không trần: 15% của 10.560.000 = 1.584.000", () => {
    expect(tienGiamCuaMa(ma({ phanTram: 15 }), 10_560_000)).toBe(1_584_000);
  });

  it("🔴 PERCENT CÓ trần: 10% của 10.560.000 = 1.056.000 nhưng trần 800.000 ⇒ 800.000", () => {
    // Bỏ vế trần là bớt cho khách thêm 256.000đ mỗi đơn, im lặng.
    expect(tienGiamCuaMa(ma({ phanTram: 10, giamToiDa: 800_000 }), 10_560_000)).toBe(800_000);
  });

  it("trần CAO hơn số tính ra ⇒ không cắn", () => {
    expect(tienGiamCuaMa(ma({ phanTram: 10, giamToiDa: 9_000_000 }), 10_560_000)).toBe(1_056_000);
  });

  it("FIXED: đúng số tiền, nhưng KẸP trong tạm tính dòng", () => {
    const m = ma({ kieu: "FIXED", phanTram: null, soTien: 500_000 });
    expect(tienGiamCuaMa(m, 10_560_000)).toBe(500_000);
    expect(tienGiamCuaMa(m, 300_000)).toBe(300_000);
  });

  it("tạm tính 0 hoặc âm ⇒ 0, không ném", () => {
    expect(tienGiamCuaMa(ma(), 0)).toBe(0);
    expect(tienGiamCuaMa(ma(), -5)).toBe(0);
  });
});

describe("[AVD-05] mã → khoản giảm", () => {
  it("🔴 PERCENT giữ nguyên kiểu PHAN_TRAM, trần đi bằng `tranTien`", () => {
    // Quy về SO_TIEN thì cờ `vuotTran` không bao giờ bật ⇒ chương trình khai 60% đi vòng
    // qua `orders.maxDiscountPercent`. Đây là lý do trường `tranTien` tồn tại.
    const k = khaiGiamTuMa(ma({ phanTram: 10, giamToiDa: 800_000 }));
    expect(k.kieu).toBe(KIEU_GIAM.PHAN_TRAM);
    expect(k.giaTri).toBe(10);
    expect(k.tranTien).toBe(800_000);
  });

  it("FIXED ⇒ SO_TIEN, KHÔNG mang trần (giaTri đã là số cuối)", () => {
    const k = khaiGiamTuMa(ma({ kieu: "FIXED", phanTram: null, soTien: 500_000, giamToiDa: 900_000 }));
    expect(k.kieu).toBe(KIEU_GIAM.SO_TIEN);
    expect(k.giaTri).toBe(500_000);
    expect(k.tranTien).toBeNull();
  });

  it("mang theo voucherId + giải trình tự sinh từ MÃ VĂN BẢN", () => {
    const k = khaiGiamTuMa(ma());
    expect(k.voucherId).toBe("v1");
    expect(k.lyDo).toBe("SR.QD.240 · FULL4HP15 — Ưu đãi đóng đủ 4 học phần");
    expect(lyDoTuMa(ma())).toContain("SR.QD.240");
  });

  it("🔴 nối vào `gopGiamGia` ra ĐÚNG số mà `tienGiamCuaMa` hứa", () => {
    // Hai hàm ở hai file; lệch nhau là màn hình nói một đằng, sổ ghi một nẻo. Ca này là
    // cầu nối — nó đỏ khi một trong hai bên đổi luật mà bên kia không đổi theo.
    for (const m of [
      ma({ phanTram: 15 }),
      ma({ phanTram: 10, giamToiDa: 800_000 }),
      ma({ kieu: "FIXED", phanTram: null, soTien: 500_000 }),
    ]) {
      const tamTinh = 10_560_000;
      const [khoan] = gopGiamGia(tamTinh, [khaiGiamTuMa(m)], 50);
      expect(khoan!.giam, `mã ${m.ma}`).toBe(tienGiamCuaMa(m, tamTinh));
    }
  });
});

describe("[AVD-06] nhãn hiển thị", () => {
  it("phần trăm · phần trăm có trần · số tiền", () => {
    expect(nhanMucUuDai(ma({ phanTram: 15 }))).toBe("giảm 15%");
    expect(nhanMucUuDai(ma({ phanTram: 10, giamToiDa: 800_000 }))).toBe("giảm 10% (tối đa 800.000đ)");
    expect(nhanMucUuDai(ma({ kieu: "FIXED", phanTram: null, soTien: 500_000 }))).toBe("giảm 500.000đ");
  });
});
