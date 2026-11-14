/**
 * [NHH-KY-UI-01..09] — LUẬT THUẦN của màn Kỳ hoa hồng: nút nào VẼ, nút nào KHÔNG VẼ (kèm lý do), câu nêu từng loại hàng chờ chặn,
 * tháng đang chọn. Không DB, không đồng hồ (luật 19: `now` luôn truyền vào).
 *
 * Luật 12 (affordance nói thật): một nút chỉ được vẽ khi cổng server SẼ cho qua. Nên ca `[NHH-KY-UI-08]` duyệt TOÀN BỘ tổ hợp
 * (trạng thái × hàng chờ × đầu vào trôi × lần Tính) và so với CHÍNH `kiemChuyenTrangThaiKy` — hàm cổng của backend, không bản chép.
 * Mỗi ca "KHÔNG vẽ X" đi kèm đối chứng dương "ca kia VẼ X" (luật 11: ca chỉ khẳng định SỰ VẮNG MẶT luôn đạt khi tính năng hỏng hoàn toàn).
 */
import { describe, expect, it } from "vitest";

import { kiemChuyenTrangThaiKy, TRANG_THAI_KY, type TrangThaiKy } from "./ky-hoa-hong";
import {
  cauChanKhoa,
  gomChan,
  hanhDongCuaKy,
  kyTrongPhamViTinh,
  ngayNganVN,
  nhanThangKy,
  soLieuKhop,
  thangKeTiep,
  thangMacDinhCuaMan,
  type DauVaoHanhDong,
  type HanhDongKy,
} from "./ky-man-hinh";
import { dinhDangDong } from "./vi-sao";

const T0 = new Date("2026-10-31T10:00:00.000Z");
const SAU = new Date("2026-10-31T11:00:00.000Z");
const TRUOC = new Date("2026-10-31T09:00:00.000Z");

function dauVao(p: Partial<DauVaoHanhDong> = {}): DauVaoHanhDong {
  return {
    trangThai: "OPEN",
    truocMoc: false,
    coQuyenQuanLy: true,
    soChan: 0,
    lastCalculatedAt: T0,
    dauVaoMoiNhat: TRUOC,
    cauChan: null,
    ngayTinhCuoi: "31/10/2026",
    xuatLuongBat: true,
    chuaXuat: { noiBo: 0, ngoai: 0 },
    soLoChoChi: 0,
    ...p,
  };
}

const co = (h: ReturnType<typeof hanhDongCuaKy>, a: HanhDongKy) => h.chinh === a || h.phu.includes(a);
const lyDoKhongVe = (h: ReturnType<typeof hanhDongCuaKy>, a: HanhDongKy | "TAT_CA") => h.khongVe.find((k) => k.hanhDong === a)?.lyDo;

describe("[NHH-KY-UI-01] vòng đời: chỉ nút của BƯỚC KẾ TIẾP là nút chính", () => {
  it("OPEN ⇒ Tính; chưa có gì để rà soát hay khoá (và nói vì sao)", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: "OPEN", lastCalculatedAt: null, dauVaoMoiNhat: null }));
    expect(h.chinh).toBe("TINH");
    expect(co(h, "CHUYEN_RA_SOAT")).toBe(false);
    expect(co(h, "KHOA")).toBe(false);
    expect(lyDoKhongVe(h, "CHUYEN_RA_SOAT")).toMatch(/Tính/);
  });

  it("kỳ CHƯA MỞ (null) ⇒ cũng Tính (lượt Tính đầu tạo kỳ — 04 §12.1)", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: null, lastCalculatedAt: null, dauVaoMoiNhat: null }));
    expect(h.chinh).toBe("TINH");
  });

  it("CALCULATED sạch ⇒ Chuyển rà soát là nút chính, Tính lại là nút phụ; Khoá CHƯA vẽ", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: "CALCULATED" }));
    expect(h.chinh).toBe("CHUYEN_RA_SOAT");
    expect(h.phu).toContain("TINH_LAI");
    expect(co(h, "KHOA")).toBe(false);
    expect(lyDoKhongVe(h, "KHOA")).toMatch(/rà soát/);
  });

  it("REVIEWING sạch (0 hàng chờ chặn, không trôi) ⇒ Khoá là nút chính, Trả lại là nút phụ", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING" }));
    expect(h.chinh).toBe("KHOA");
    expect(h.phu).toContain("TRA_LAI");
  });

  it("LOCKED ⇒ Xuất bảng chi; EXPORTED có lô chờ chi ⇒ Đánh dấu đã chi; PAID ⇒ hết việc", () => {
    expect(hanhDongCuaKy(dauVao({ trangThai: "LOCKED" })).chinh).toBe("XUAT_BANG_CHI");
    expect(hanhDongCuaKy(dauVao({ trangThai: "EXPORTED", soLoChoChi: 1 })).chinh).toBe("DANH_DAU_DA_CHI");
    const paid = hanhDongCuaKy(dauVao({ trangThai: "PAID" }));
    expect(paid.chinh).toBeNull();
    expect(paid.phu).toEqual([]);
  });
});

describe("[NHH-KY-UI-02] hàng chờ CHẶN ⇒ nút Khoá KHÔNG VẼ; câu nêu từng loại", () => {
  const cau = "3 khoản chờ duyệt tay · 2 khoản vượt trần · 1 khoản chưa nối học viên";
  it("còn hàng chờ chặn ⇒ Khoá không vẽ, lý do nêu ĐÚNG câu từng loại; đối chứng dương: hết hàng chờ ⇒ vẽ", () => {
    const chan = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING", soChan: 6, cauChan: cau }));
    expect(co(chan, "KHOA")).toBe(false);
    expect(lyDoKhongVe(chan, "KHOA")).toContain(cau);
    // vẫn còn đường lui: Trả lại
    expect(chan.phu).toContain("TRA_LAI");

    const sach = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING", soChan: 0, cauChan: null }));
    expect(co(sach, "KHOA")).toBe(true);
    expect(sach.khongVe.find((k) => k.hanhDong === "KHOA")).toBeUndefined();
  });

  it("KHÔNG có nút override nào: tập hành động KHÔNG chứa thứ gì ngoài vòng đời", () => {
    const moi = new Set<HanhDongKy>();
    for (const tt of TRANG_THAI_KY)
      for (const soChan of [0, 4]) {
        const h = hanhDongCuaKy(dauVao({ trangThai: tt, soChan, cauChan: soChan ? cau : null, soLoChoChi: 1, chuaXuat: { noiBo: 2, ngoai: 1 } }));
        for (const a of [h.chinh, ...h.phu]) if (a) moi.add(a);
      }
    expect([...moi].sort()).toEqual(
      ["CHUYEN_RA_SOAT", "DANH_DAU_DA_CHI", "KHOA", "TINH", "TINH_LAI", "TRA_LAI", "XUAT_BANG_CHI", "XUAT_QUYET_TOAN"].sort(),
    );
  });
});

describe("[NHH-KY-UI-03] đầu vào đổi SAU lần Tính ⇒ chặn cả Chuyển rà soát lẫn Khoá, chỉ đường Tính lại", () => {
  it("CALCULATED + đầu vào mới hơn lần Tính ⇒ Tính lại là nút chính, KHÔNG vẽ Chuyển rà soát, lý do nêu ngày Tính", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: "CALCULATED", dauVaoMoiNhat: SAU, ngayTinhCuoi: "31/10/2026" }));
    expect(h.chinh).toBe("TINH_LAI");
    expect(co(h, "CHUYEN_RA_SOAT")).toBe(false);
    expect(lyDoKhongVe(h, "CHUYEN_RA_SOAT")).toMatch(/31\/10\/2026/);
    expect(lyDoKhongVe(h, "CHUYEN_RA_SOAT")).toMatch(/Tính lại/);
  });

  it("REVIEWING + trôi ⇒ KHÔNG vẽ Khoá; đường đi là Trả lại rồi Tính lại; đối chứng: bằng mốc Tính (không trôi) ⇒ vẽ Khoá", () => {
    const troi = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING", dauVaoMoiNhat: SAU }));
    expect(co(troi, "KHOA")).toBe(false);
    expect(troi.chinh).toBe("TRA_LAI");
    expect(lyDoKhongVe(troi, "KHOA")).toMatch(/Trả lại/);

    const bang = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING", dauVaoMoiNhat: T0 }));
    expect(bang.chinh).toBe("KHOA");
  });

  it("vừa trôi vừa còn hàng chờ ⇒ lý do nêu CẢ HAI", () => {
    const h = hanhDongCuaKy(dauVao({ trangThai: "REVIEWING", dauVaoMoiNhat: SAU, soChan: 2, cauChan: "2 khoản vượt trần" }));
    const ly = lyDoKhongVe(h, "KHOA")!;
    expect(ly).toMatch(/Tính lại/);
    expect(ly).toContain("2 khoản vượt trần");
  });
});

describe("[NHH-KY-UI-04] không có quyền / kỳ thuộc sổ cũ ⇒ KHÔNG nút nào, nói vì sao", () => {
  it("thiếu commission_periods:manage ⇒ không vẽ gì, lý do gọi tên quyền; đối chứng dương: có quyền ⇒ vẽ", () => {
    const khong = hanhDongCuaKy(dauVao({ trangThai: "OPEN", coQuyenQuanLy: false }));
    expect(khong.chinh).toBeNull();
    expect(khong.phu).toEqual([]);
    expect(lyDoKhongVe(khong, "TAT_CA")).toContain("commission_periods:manage");
    expect(hanhDongCuaKy(dauVao({ trangThai: "OPEN", coQuyenQuanLy: true })).chinh).toBe("TINH");
  });

  it("kỳ trước mốc cutover ⇒ không vẽ gì, trỏ về /crm/commission; đối chứng dương: kỳ sau mốc ⇒ vẽ", () => {
    const cu = hanhDongCuaKy(dauVao({ trangThai: null, truocMoc: true }));
    expect(cu.chinh).toBeNull();
    expect(lyDoKhongVe(cu, "TAT_CA")).toContain("/crm/commission");
    expect(hanhDongCuaKy(dauVao({ trangThai: null, truocMoc: false })).chinh).toBe("TINH");
  });
});

describe("[NHH-KY-UI-05] xuất bảng chi: chỉ sau khoá, chỉ khi cờ hoaHong.xuatLuongBat BẬT", () => {
  it("cờ TẮT ⇒ không vẽ Xuất (và Đánh dấu đã chi), lý do nêu cờ; cờ BẬT ⇒ vẽ", () => {
    const tat = hanhDongCuaKy(dauVao({ trangThai: "LOCKED", xuatLuongBat: false }));
    expect(co(tat, "XUAT_BANG_CHI")).toBe(false);
    expect(lyDoKhongVe(tat, "XUAT_BANG_CHI")).toMatch(/Cho xuất bảng chi hoa hồng/);
    expect(co(hanhDongCuaKy(dauVao({ trangThai: "LOCKED", xuatLuongBat: true })), "XUAT_BANG_CHI")).toBe(true);

    const tatChi = hanhDongCuaKy(dauVao({ trangThai: "EXPORTED", xuatLuongBat: false, soLoChoChi: 1 }));
    expect(co(tatChi, "DANH_DAU_DA_CHI")).toBe(false);
  });

  it("kỳ CHƯA khoá (REVIEWING…) ⇒ không bao giờ vẽ Xuất, dù cờ bật", () => {
    for (const tt of ["OPEN", "CALCULATED", "REVIEWING"] as const) {
      const h = hanhDongCuaKy(dauVao({ trangThai: tt, xuatLuongBat: true, chuaXuat: { noiBo: 5, ngoai: 5 } }));
      expect(co(h, "XUAT_BANG_CHI"), tt).toBe(false);
      expect(co(h, "XUAT_QUYET_TOAN"), tt).toBe(false);
    }
  });

  it("lô quyết toán NGƯỜI NGOÀI là nút riêng: chỉ vẽ khi còn dòng ngoài chưa vào lô", () => {
    expect(co(hanhDongCuaKy(dauVao({ trangThai: "LOCKED", chuaXuat: { noiBo: 3, ngoai: 2 } })), "XUAT_QUYET_TOAN")).toBe(true);
    expect(co(hanhDongCuaKy(dauVao({ trangThai: "LOCKED", chuaXuat: { noiBo: 3, ngoai: 0 } })), "XUAT_QUYET_TOAN")).toBe(false);
  });

  it("EXPORTED: lô nội bộ còn dòng chưa xuất ⇒ vẫn vẽ Xuất; hết cả hai ⇒ không vẽ (xuất lần hai không có gì để xuất)", () => {
    const con = hanhDongCuaKy(dauVao({ trangThai: "EXPORTED", soLoChoChi: 1, chuaXuat: { noiBo: 2, ngoai: 0 } }));
    expect(co(con, "XUAT_BANG_CHI")).toBe(true);
    const het = hanhDongCuaKy(dauVao({ trangThai: "EXPORTED", soLoChoChi: 1, chuaXuat: { noiBo: 0, ngoai: 0 } }));
    expect(co(het, "XUAT_BANG_CHI")).toBe(false);
    expect(co(het, "XUAT_QUYET_TOAN")).toBe(false);
    expect(het.chinh).toBe("DANH_DAU_DA_CHI");
  });

  it("EXPORTED mà không có lô nào chờ chi ⇒ không vẽ Đánh dấu đã chi (nút không có gì để làm)", () => {
    expect(co(hanhDongCuaKy(dauVao({ trangThai: "EXPORTED", soLoChoChi: 0 })), "DANH_DAU_DA_CHI")).toBe(false);
  });
});

describe("[NHH-KY-UI-06] cauChanKhoa — nêu TỪNG LOẠI hàng chờ chặn", () => {
  it("gom hai mã cùng một nghĩa (CHUA_GAN_CON + CHO_HOC_VIEN), sắp theo số lượng giảm dần rồi theo thứ tự cố định", () => {
    const g = gomChan({ MANUAL_REVIEW_REQUIRED: 3, CAP_EXCEEDED: 2, CHUA_GAN_CON: 1, CHO_HOC_VIEN: 1 });
    expect(cauChanKhoa(g)).toBe("3 khoản chờ duyệt tay · 2 khoản chưa nối học viên · 2 khoản vượt trần");
  });

  it("mã KHÔNG chặn (UNRESOLVED_BENEFICIARY, NEGATIVE_BALANCE) bị loại — vai treo không bao giờ làm mất nút Khoá", () => {
    const g = gomChan({ UNRESOLVED_BENEFICIARY: 9, NEGATIVE_BALANCE: 4, CAP_EXCEEDED: 1 });
    expect(cauChanKhoa(g)).toBe("1 khoản vượt trần");
    expect(cauChanKhoa(gomChan({ UNRESOLVED_BENEFICIARY: 9 }))).toBe("");
  });

  it("số 0 và mã lạ không sinh ra mục", () => {
    expect(gomChan({ CAP_EXCEEDED: 0 })).toEqual([]);
  });
});

describe("[NHH-KY-UI-07] tháng của màn", () => {
  it("mặc định = tháng hiện tại giờ VN; trước mốc cutover ⇒ nhảy lên mốc; chưa có mốc ⇒ tháng hiện tại", () => {
    expect(thangMacDinhCuaMan({ now: new Date("2026-10-31T18:00:00.000Z"), kyCutover: "2026-10" })).toBe("2026-11"); // 01/11 giờ VN
    expect(thangMacDinhCuaMan({ now: new Date("2026-10-15T03:00:00.000Z"), kyCutover: "2026-11" })).toBe("2026-11");
    expect(thangMacDinhCuaMan({ now: new Date("2026-10-15T03:00:00.000Z"), kyCutover: null })).toBe("2026-10");
  });

  it("nhanThangKy: YYYY-MM → MM/YYYY; thangKeTiep qua năm", () => {
    expect(nhanThangKy("2026-10")).toBe("10/2026");
    expect(thangKeTiep("2026-12")).toBe("2027-01");
  });

  it("kyTrongPhamViTinh: < mốc ⇒ thuộc sổ cũ; = mốc ⇒ thuộc sổ mới; chưa có mốc ⇒ không kỳ nào thuộc sổ mới", () => {
    expect(kyTrongPhamViTinh("2026-09", "2026-10")).toBe(false);
    expect(kyTrongPhamViTinh("2026-10", "2026-10")).toBe(true);
    expect(kyTrongPhamViTinh("2026-10", null)).toBe(false);
  });
});

describe("[NHH-KY-UI-10] định dạng", () => {
  it("dinhDangDong (MỘT hàm tiền cho cả module; trước đây ky có bản `tienVN` riêng): dấu chấm hàng nghìn, đ liền số, số âm dùng dấu trừ thật (U+2212), 0 là 0đ", () => {
    expect(dinhDangDong(300_000)).toBe("300.000đ");
    expect(dinhDangDong(955_563_000)).toBe("955.563.000đ");
    expect(dinhDangDong(-120_000)).toBe("−120.000đ");
    expect(dinhDangDong(0)).toBe("0đ");
    expect(dinhDangDong(-0)).toBe("0đ");
    expect(dinhDangDong(-0.4)).toBe("0đ"); // dấu theo giá trị đã làm tròn, không "−0đ"
    expect(dinhDangDong(-120_000.6)).toBe("−120.001đ");
  });
  it("ngayNganVN: ngày VN (UTC+7) — 31/10 17:30Z đã là 01/11 giờ VN", () => {
    expect(ngayNganVN(new Date("2026-10-31T10:00:00.000Z"))).toBe("31/10");
    expect(ngayNganVN(new Date("2026-10-31T17:30:00.000Z"))).toBe("01/11");
  });
});

describe("[NHH-KY-UI-09] soLieuKhop — xác nhận khoá là xác nhận ĐÚNG số đã đọc", () => {
  const a = { coSoTinh: 100_000_000, hoaHong: 3_000_000, dieuChinh: -120_000, soNguoi: 4, lastCalculatedAt: "2026-10-31T10:00:00.000Z" };
  it("khớp khi giống hệt; lệch MỘT trường bất kỳ ⇒ không khớp", () => {
    expect(soLieuKhop(a, { ...a })).toBe(true);
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      const b = { ...a, [k]: typeof a[k] === "number" ? (a[k] as number) + 1 : "2026-10-31T10:00:01.000Z" };
      expect(soLieuKhop(a, b), String(k)).toBe(false);
    }
  });
  it("lastCalculatedAt null cả hai ⇒ khớp; null một bên ⇒ không", () => {
    expect(soLieuKhop({ ...a, lastCalculatedAt: null }, { ...a, lastCalculatedAt: null })).toBe(true);
    expect(soLieuKhop({ ...a, lastCalculatedAt: null }, a)).toBe(false);
  });
});

/**
 * [NHH-KY-UI-08] LƯỚI NHẤT QUÁN VỚI CỔNG SERVER — duyệt toàn bộ tổ hợp, so với `kiemChuyenTrangThaiKy`.
 *
 * Bản chép tay điều kiện ở UI là chỗ trôi: cổng đổi mà nút không đổi theo ⇒ nút vẽ ra rồi bị từ chối (lời hứa suông) hoặc
 * cổng cho qua mà không có nút (không ai khoá được kỳ). Ở đây hai bên bị buộc phải đồng ý trên MỌI tổ hợp.
 */
describe("[NHH-KY-UI-08] nút ⇔ cổng server (kiemChuyenTrangThaiKy), mọi tổ hợp", () => {
  const MOC = { khong: null as Date | null, truoc: TRUOC, bang: T0, sau: SAU };
  const dauVaoMoiNhat: (keyof typeof MOC)[] = ["khong", "truoc", "bang", "sau"];
  const lanTinh: (Date | null)[] = [null, T0];

  for (const tt of TRANG_THAI_KY) {
    for (const lan of lanTinh) {
      for (const dv of dauVaoMoiNhat) {
        for (const soChan of [0, 3]) {
          it(`${tt} · lastCalc=${lan ? "có" : "null"} · đầu vào=${dv} · chặn=${soChan}`, () => {
            const h = hanhDongCuaKy(
              dauVao({ trangThai: tt as TrangThaiKy, lastCalculatedAt: lan, dauVaoMoiNhat: MOC[dv], soChan, cauChan: soChan ? "3 khoản vượt trần" : null, soLoChoChi: 1, chuaXuat: { noiBo: 1, ngoai: 0 } }),
            );
            const cong = (den: TrangThaiKy, chan = soChan) =>
              kiemChuyenTrangThaiKy({ tu: tt, den, soHangChoChan: chan, lastCalculatedAt: lan, dauVaoMoiNhat: MOC[dv] }) === null;

            // Khoá ⇔ cổng REVIEWING → LOCKED qua (chỉ xét ở REVIEWING; trạng thái khác cổng đã từ chối vì sai bước).
            expect(co(h, "KHOA"), "KHOA").toBe(tt === "REVIEWING" && cong("LOCKED"));
            // Chuyển rà soát ⇔ cổng CALCULATED → REVIEWING qua.
            expect(co(h, "CHUYEN_RA_SOAT"), "CHUYEN_RA_SOAT").toBe(tt === "CALCULATED" && cong("REVIEWING"));
            // Trả lại ⇔ cổng REVIEWING → CALCULATED qua.
            expect(co(h, "TRA_LAI"), "TRA_LAI").toBe(tt === "REVIEWING" && cong("CALCULATED"));
            // Tính / Tính lại ⇔ cổng (OPEN | CALCULATED) → CALCULATED qua.
            expect(co(h, "TINH") || co(h, "TINH_LAI"), "TINH").toBe((tt === "OPEN" || tt === "CALCULATED") && cong("CALCULATED"));
            // Đánh dấu đã chi ⇔ cổng EXPORTED → PAID qua (có lô chờ chi: fixture đặt 1).
            expect(co(h, "DANH_DAU_DA_CHI"), "DANH_DAU_DA_CHI").toBe(tt === "EXPORTED" && cong("PAID"));
            // Xuất: LOCKED qua cổng LOCKED → EXPORTED; EXPORTED còn dòng chưa xuất (fixture: nội bộ 1) vẫn xuất được.
            expect(co(h, "XUAT_BANG_CHI"), "XUAT_BANG_CHI").toBe((tt === "LOCKED" && cong("EXPORTED")) || tt === "EXPORTED");
          });
        }
      }
    }
  }
});
