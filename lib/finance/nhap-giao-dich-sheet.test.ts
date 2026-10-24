// lib/finance/nhap-giao-dich-sheet.test.ts — NHẬP GIAO DỊCH CŨ từ sheet đăng ký.
//
// Nguồn: `Satarobo - Danh sách đăng ký.xlsx` (9 sheet). Mục tiêu của chủ dự án: học viên
// đã đóng tiền trước khi lên hệ thống không được hiện NỢ ở cổng phụ huynh.
//
// ⚠️ MỌI CA DƯỚI ĐÂY LÀ SỐ ĐO THẬT TỪ FILE, không phải ví dụ bịa. Fixture tròn trịa là
// fixture không kiểm được gì.
//
// Bốn cái bẫy đo được, mỗi cái là một đường mất tiền hoặc đếm đôi:
//
//  (1) 12 DÒNG TỔNG ôm 1.382.987.666đ — 62% tổng tiền của cả file. Chúng không có tên,
//      không mã, không tình trạng; chỉ có một ô tiền. `Tháng 52026!d16 = 30.322.000đ`
//      đúng bằng tổng 6 dòng phía trên nó. Nhập nhầm là thổi doanh thu gấp 2,7 lần.
//
//  (2) SHEET "Tháng 62026" CHỨA TRỌN "Tháng 52026" — 6/6 dòng có mã khớp cả mã lẫn tiền.
//      Nhập cả hai là cộng đôi 30.322.000đ tiền thật.
//
//  (3) MÃ HỌC VIÊN KHÔNG NHẤT QUÁN trong chính file: `CS1.HV.0031` và `CS1.HV0031`
//      (thiếu dấu chấm) là cùng một em. So chuỗi thô là tách một em thành hai.
//
//  (4) MỘT HỌC VIÊN CÓ NHIỀU ĐỢT — đo được 21 em đóng 2 đợt, 3 em đóng 3 đợt
//      (`CS1.HV.0043` đóng 3.320.000 tháng 8 rồi 4.320.000 tháng 9, ghi chú "Học phí đợt
//      1"/"đợt 2"). Gộp phải CỘNG DỒN; ghi đè là xoá mất tiền của đợt trước.
import { describe, it, expect } from "vitest";
import {
  chuanMaHV,
  chuanSdtSheet,
  chuanTenSoSanh,
  laDongTong,
  docDongGiaoDich,
  gopTheoHocVien,
  sheetChuaTronSheet,
} from "./nhap-giao-dich-sheet";

describe("[NGD-01] chuẩn hoá mã học viên", () => {
  it("mã thiếu dấu chấm và mã đủ chấm là MỘT (ca thật trong file)", () => {
    expect(chuanMaHV("CS1.HV0031")).toBe("CS1.HV.0031");
    expect(chuanMaHV("CS1.HV.0031")).toBe("CS1.HV.0031");
    expect(chuanMaHV("cs1.hv.31")).toBe("CS1.HV.0031");
  });

  it("đệm 0 cho đủ 4 chữ số — CS1.HV.31 và CS1.HV.0031 là một", () => {
    expect(chuanMaHV("CS1.HV.31")).toBe(chuanMaHV("CS1.HV.0031"));
  });

  it("ô trống / rác → null, KHÔNG bịa mã", () => {
    expect(chuanMaHV(null)).toBeNull();
    expect(chuanMaHV("   ")).toBeNull();
    // Ca thật: `Tháng 72026 CS1!d78` có chữ "NHẬP TAB THÁNG 8" nằm ở cột mã.
    expect(chuanMaHV("NHẬP TAB THÁNG 8")).toBeNull();
  });
});

describe("[NGD-02] chuẩn hoá số điện thoại — RA DẠNG DB ĐANG LƯU", () => {
  // ⚠️ ĐO 14/09/2026: DB lưu `84905167198`, KHÔNG phải `0905167198`
  // (select "parentPhone" from "Student" → 84930000007…). Một hàm trả `0…` sẽ khớp
  // ĐÚNG 0 DÒNG và không báo lỗi gì — chỉ là "không tìm thấy học viên nào".
  it("số có dấu cách vẫn ra đúng (ca thật: '078 3264020')", () => {
    expect(chuanSdtSheet("078 3264020")).toBe("84783264020");
  });

  it("KHÔNG làm mất số 0 đầu — kể cả khi Excel trả về dạng SỐ", () => {
    expect(chuanSdtSheet("0905499860")).toBe("84905499860");
    // Ô định dạng NUMBER nuốt số 0 đầu: 905499860. Không đệm lại là sai cả dãy.
    expect(chuanSdtSheet(905499860)).toBe("84905499860");
    expect(chuanSdtSheet("905499860.0")).toBe("84905499860");
  });

  it("đã ở dạng 84… thì giữ nguyên", () => {
    expect(chuanSdtSheet("84905499860")).toBe("84905499860");
  });

  it("ô trống / rác → null", () => {
    expect(chuanSdtSheet(null)).toBeNull();
    expect(chuanSdtSheet("—")).toBeNull();
    expect(chuanSdtSheet("123")).toBeNull();
  });
});

describe("[NGD-02b] chuẩn hoá tên để SO SÁNH", () => {
  it("bỏ dấu + viết hoa + gọn khoảng trắng", () => {
    expect(chuanTenSoSanh("Nguyễn Công  Hoàng Khải")).toBe("NGUYEN CONG HOANG KHAI");
    expect(chuanTenSoSanh("NGUYỄN CÔNG HOÀNG KHẢI")).toBe("NGUYEN CONG HOANG KHAI");
  });

  it("đ/Đ ra d/D", () => {
    expect(chuanTenSoSanh("Đặng Hoàng Kim Trúc")).toBe("DANG HOANG KIM TRUC");
  });

  it("ô trống → chuỗi rỗng, không ném", () => {
    expect(chuanTenSoSanh(null)).toBe("");
  });
});

describe("[NGD-03] loại DÒNG TỔNG — 62% tiền của file nằm ở đây", () => {
  it("dòng chỉ có tiền, không tên/mã/tình trạng → là dòng tổng", () => {
    expect(
      laDongTong({ maHV: null, hoTen: null, tinhTrang: "", hocPhi: 30_322_000 }),
    ).toBe(true);
  });

  it("dòng giao dịch thật → KHÔNG phải dòng tổng", () => {
    expect(
      laDongTong({
        maHV: "CS2.HV.0001",
        hoTen: "LÊ NGUYỄN TUẤN KIỆT",
        tinhTrang: "Đã thanh toán",
        hocPhi: 3_986_000,
      }),
    ).toBe(false);
  });

  it("dòng có mã nhưng tiền 0 → cũng loại (ca thật: CS2.HV.0046/0047 ở Tháng 82026 CS2)", () => {
    expect(
      laDongTong({ maHV: "CS2.HV.0046", hoTen: null, tinhTrang: "", hocPhi: 0 }),
    ).toBe(true);
  });

  it("có tên mà thiếu tình trạng → VẪN loại, vì không biết đã thu hay chưa", () => {
    // Fail-closed: thà bỏ sót một dòng để người nhập thấy, còn hơn ghi một khoản
    // tiền mà không ai biết nó đã vào tài khoản chưa.
    expect(
      laDongTong({ maHV: "CS1.HV.0009", hoTen: "AI ĐÓ", tinhTrang: "", hocPhi: 1_000_000 }),
    ).toBe(true);
  });
});

describe("[NGD-04] đọc một dòng", () => {
  const dong = {
    "MÃ HỌC VIÊN": "CS1.HV0043",
    "Họ và Tên học viên": "Nguyễn Công Hoàng Khải",
    "Số điện thoại": "0932014686",
    "Học phí": 3_320_000,
    "Tình trạng": "Đã thanh toán",
    "Ghi chú": "Học phí đợt 1",
    Ngày: new Date("2026-08-01T00:00:00.000Z"),
    "Khoá học đăng ký": "Sata 4",
    "Cơ sở": "CS1: N.Hữu Thọ",
  };

  it("lấy đủ trường và chuẩn hoá mã", () => {
    const g = docDongGiaoDich(dong, "Tháng 82026 CS1", 2);
    expect(g).not.toBeNull();
    expect(g!.maHV).toBe("CS1.HV.0043");
    expect(g!.hocPhi).toBe(3_320_000);
    expect(g!.sdt).toBe("84932014686"); // dạng DB lưu, KHÔNG phải dạng sheet gõ
    expect(g!.sheet).toBe("Tháng 82026 CS1");
    expect(g!.dong).toBe(2);
  });

  it("dòng tổng → null", () => {
    expect(docDongGiaoDich({ "Học phí": 104_760_000 }, "Tháng 82026 CS1", 25)).toBeNull();
  });

  it("cột 'Cơ sở' ở sheet Tháng 62026 mang nhãn 'minh' — vẫn đọc được", () => {
    // Đo thật: header sheet Tháng 62026 có ô bị gõ nhầm thành "minh" ở vị trí Cơ sở.
    const g = docDongGiaoDich(
      { ...dong, "Cơ sở": undefined, minh: "CS2: Hoàng Diệu" },
      "Tháng 62026",
      2,
    );
    expect(g!.coSo).toBe("CS2: Hoàng Diệu");
  });
});

describe("[NGD-05] phát hiện sheet chứa trọn sheet khác", () => {
  const d = (sdt: string, hoTen: string, hocPhi: number) => ({ sdt, hoTen, hocPhi });
  const t5 = [
    d("84905499860", "LÊ NGUYỄN TUẤN KIỆT", 3_986_000),
    d("84905063529", "PHẠM PHƯỚC TÂN", 8_640_000),
    d("84905000001", "THÁI THIÊN KHÁNH", 3_808_000),
  ];

  it("T6 chứa trọn T5 → báo trùng, kèm SỐ TIỀN sẽ cộng đôi (ca thật)", () => {
    const t6 = [...t5, d("84905000009", "AI ĐÓ", 5_000_000)];
    const r = sheetChuaTronSheet(t5, t6);
    expect(r.chuaTron).toBe(true);
    expect(r.soDongTrung).toBe(3);
    expect(r.tienCongDoi).toBe(16_434_000);
  });

  it("tên gõ khác dấu vẫn nhận ra là trùng", () => {
    const t6 = [d("84905499860", "le nguyen tuan kiet", 3_986_000)];
    expect(sheetChuaTronSheet([t5[0]!], t6).chuaTron).toBe(true);
  });

  it("chỉ trùng một phần → KHÔNG coi là chứa trọn (để người xem quyết)", () => {
    const r = sheetChuaTronSheet(t5, [t5[0]!]);
    expect(r.chuaTron).toBe(false);
    expect(r.soDongTrung).toBe(1);
  });

  it("cùng người nhưng KHÁC tiền → không phải trùng, là đợt đóng khác", () => {
    const a = [d("84932014686", "NGUYỄN CÔNG HOÀNG KHẢI", 3_320_000)];
    const b = [d("84932014686", "NGUYỄN CÔNG HOÀNG KHẢI", 4_320_000)];
    expect(sheetChuaTronSheet(a, b).soDongTrung).toBe(0);
  });
});

describe("[NGD-06] gộp theo học viên — khoá là SĐT PHỤ HUYNH + HỌ TÊN", () => {
  // ⚠️ CHỦ DỰ ÁN CHỐT 14/09/2026: "mã học viên ở sheet KHÁC HOÀN TOÀN mã trên hệ thống,
  // nên nếu lấy đúng thì lấy ở SĐT của phụ huynh, và họ tên."
  // Mã trong file vẫn đọc và giữ lại để soi ngược về dòng gốc, nhưng KHÔNG dùng để khớp.
  //
  // Đo trên file thật: 102 SĐT riêng biệt, trong đó 9 SĐT dùng cho 2 em (anh chị em thật:
  // HOANG VINH KHANG + HOANG BAO THANH cùng 0905167198). ⇒ SĐT MỘT MÌNH KHÔNG ĐỦ.
  // Và 0 ca tên trùng nhau mà khác SĐT ⇒ cặp (SĐT, tên) đủ phân biệt: ra đúng 115 em.
  const gd = (
    sdt: string | null,
    hoTen: string,
    hocPhi: number,
    ghiChu = "",
    sale: string | null = null,
  ) => ({
    sheet: "x",
    dong: 1,
    maHV: "CS9.HV.9999", // mã của sheet — cố ý KHÁC hệ thống, không được dùng làm khoá
    hoTen,
    sdt,
    hocPhi,
    ngay: null,
    khoa: null,
    coSo: null,
    tinhTrang: "Đã thanh toán",
    ghiChu,
    sale,
  });

  it("ba đợt của MỘT em cộng lại, giữ nguyên từng đợt để soi lại", () => {
    const r = gopTheoHocVien([
      gd("84932014686", "Nguyễn Công Hoàng Khải", 3_320_000, "Học phí đợt 1"),
      gd("84932014686", "NGUYỄN CÔNG HOÀNG KHẢI", 4_320_000, "Học phí đợt 2"),
      gd("84932014686", "nguyen cong hoang khai", 1_000_000, "bù"),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.tongTien).toBe(8_640_000);
    expect(r[0]!.soDot).toBe(3);
    expect(r[0]!.giaoDich).toHaveLength(3);
  });

  it("HAI ANH EM cùng SĐT phụ huynh KHÔNG được gộp (ca thật: 0905167198)", () => {
    // Gộp nhầm là dồn học phí hai em vào một, em kia vẫn hiện nợ nguyên.
    const r = gopTheoHocVien([
      gd("84905167198", "HOÀNG VĨNH KHANG", 4_788_000),
      gd("84905167198", "HOÀNG BẢO THẠNH", 4_788_000),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.tongTien)).toEqual([4_788_000, 4_788_000]);
  });

  it("cùng tên mà khác SĐT → hai em khác nhau", () => {
    const r = gopTheoHocVien([
      gd("84905000001", "TRẦN GIA BẢO", 1_000),
      gd("84905000002", "TRẦN GIA BẢO", 2_000),
    ]);
    expect(r).toHaveLength(2);
  });

  it("em THIẾU SĐT vẫn giữ lại, gộp theo tên, và đánh dấu cần người xem", () => {
    // Đo thật: 4/136 giao dịch không có SĐT. Bỏ chúng đi là bỏ tiền của một em.
    const r = gopTheoHocVien([gd(null, "AI ĐÓ", 5_000_000), gd(null, "ai đó", 1_000_000)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.sdt).toBeNull();
    expect(r[0]!.canNguoiXem).toBe(true);
    expect(r[0]!.tongTien).toBe(6_000_000);
  });

  it("em có ĐỦ SĐT + tên thì KHÔNG cần người xem", () => {
    expect(gopTheoHocVien([gd("84905000001", "A B", 1_000)])[0]!.canNguoiXem).toBe(false);
  });

  it("SALE của em lấy ở ĐỢT ĐẦU — đơn là một thì người phụ trách cũng là một", () => {
    const r = gopTheoHocVien([
      gd("84905000001", "A B", 1_000, "", "Diệu"),
      gd("84905000001", "A B", 2_000, "", "Diệu"),
    ]);
    expect(r[0]!.sale).toBe("Diệu");
    expect(r[0]!.saleKhac).toBe(false);
  });

  it("hai đợt GHI HAI SALE KHÁC NHAU → nêu ra, không im lặng lấy dòng đầu", () => {
    // Im lặng chọn dòng đầu là cướp công của người kia mà không ai thấy: đơn vẫn tạo
    // thành công, chỉ có `createdById` sai.
    const r = gopTheoHocVien([
      gd("84905000001", "A B", 1_000, "", "Diệu"),
      gd("84905000001", "A B", 2_000, "", "Liên"),
    ]);
    expect(r[0]!.sale).toBe("Diệu");
    expect(r[0]!.saleKhac).toBe(true);
  });

  it("đợt đầu bỏ trống Sales thì lấy đợt sau, KHÔNG coi là lệch", () => {
    const r = gopTheoHocVien([
      gd("84905000001", "A B", 1_000, "", null),
      gd("84905000001", "A B", 2_000, "", "Liên"),
    ]);
    expect(r[0]!.sale).toBe("Liên");
    expect(r[0]!.saleKhac).toBe(false);
  });

  it("thứ tự đầu vào không đổi kết quả (ổn định)", () => {
    const a = gopTheoHocVien([gd("84905000002", "B", 2), gd("84905000001", "A", 1)]);
    const b = gopTheoHocVien([gd("84905000001", "A", 1), gd("84905000002", "B", 2)]);
    expect(a.map((x) => x.hoTen)).toEqual(b.map((x) => x.hoTen));
  });
});

describe("[NGS-10] NGÀY trong sheet — 54/136 ô là CHUỖI, không phải Date", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // ĐO 14/09/2026 trên file thật, 136 dòng dùng được:
  //   · 59 ô là Date thật (Excel date-formatted)
  //   · 54 ô là CHUỖI — 49 dạng "13/06/2026", 5 dạng "29/08" (không có năm)
  //   · 23 ô trống thật
  //
  // Bản đầu của `docDongGiaoDich` làm `new Date(String(v))` cho mọi thứ không phải Date.
  // Với "13/06/2026" JS trả **Invalid Date** ⇒ 54 ngày THẬT bị vứt lặng, và màn nhập
  // báo "77 dòng thiếu ngày" trong khi file chỉ trống 23.
  //
  // ⚠️ VÀ NÓ CÒN NGUY HƠN VẺ NGOÀI: lần này 49/49 chuỗi có NGÀY > 12 nên JS ném Invalid
  // — tức là rơi một cách THẤY ĐƯỢC. File tháng sau có "01/07/2026" thì `new Date` đọc
  // trôi chảy thành **7 tháng 1**, không lỗi, không cảnh báo: học phí tháng 7 nhảy sang
  // tháng 1. Đó là lý do phải TỰ TÁCH dd/mm/yyyy chứ không được để `new Date` đoán.
  // ─────────────────────────────────────────────────────────────────────────
  const o = (ngay: unknown) => ({
    "Mã học viên": "CS1.HV.0001",
    "Họ và Tên học viên": "Nguyễn Văn A",
    "Số điện thoại": "0905000111",
    "Học phí": 4_400_000,
    "Tình trạng": "Đã thanh toán",
    Ngày: ngay,
  });

  it('chuỗi "13/06/2026" → 13 tháng 6 (KHÔNG phải Invalid)', () => {
    const g = docDongGiaoDich(o("13/06/2026"), "Tháng 62026", 5)!;
    expect(g.ngay).toBeInstanceOf(Date);
    expect(g.ngay!.getDate()).toBe(13);
    expect(g.ngay!.getMonth()).toBe(5);
    expect(g.ngay!.getFullYear()).toBe(2026);
  });

  it('"01/07/2026" là 1 THÁNG 7 — không được đọc thành 7 tháng 1', () => {
    // Ca này chính là con bug ẩn: `new Date("01/07/2026")` trả 7 tháng 1 mà không kêu.
    const g = docDongGiaoDich(o("01/07/2026"), "Tháng 72026 CS1", 9)!;
    expect(g.ngay!.getDate()).toBe(1);
    expect(g.ngay!.getMonth()).toBe(6);
  });

  it('"29/08" (thiếu năm) lấy năm từ TÊN SHEET', () => {
    // 5 dòng thật trong file. Năm là dữ liệu CÓ THẬT ở tên sheet, không phải đoán.
    const g = docDongGiaoDich(o("29/08"), "Tháng 82026 CS1", 12)!;
    expect(g.ngay!.getDate()).toBe(29);
    expect(g.ngay!.getMonth()).toBe(7);
    expect(g.ngay!.getFullYear()).toBe(2026);
  });

  it('"13/09" trong sheet tháng 9 — ngày và tháng KHÔNG bị đảo', () => {
    const g = docDongGiaoDich(o("13/09"), "Tháng 92026 CS1", 3)!;
    expect(g.ngay!.getDate()).toBe(13);
    expect(g.ngay!.getMonth()).toBe(8);
  });

  it("thiếu năm mà tên sheet cũng không có năm → null, KHÔNG lấy năm hiện tại", () => {
    // Luật 19: hàm rơi về đồng hồ thật là ca hẹn giờ nổ — sang năm cùng file ra kết quả khác.
    expect(docDongGiaoDich(o("29/08"), "Linh tinh", 1)!.ngay).toBeNull();
  });

  it("Date thật đi thẳng qua", () => {
    const d = new Date(2026, 4, 20);
    expect(docDongGiaoDich(o(d), "Tháng 52026", 2)!.ngay!.getTime()).toBe(d.getTime());
  });

  it("số sê-ri Excel → đúng ngày (phòng khi cellDates không bắt được ô)", () => {
    // 45778 = 01/05/2025 theo hệ sê-ri của Excel (mốc 30/12/1899). Số này ĐO bằng
    // `(date(2025,5,1) - date(1899,12,30)).days`, không phải gõ ước chừng — lần đầu tôi
    // gõ 45810 và nó là 02/06/2025.
    const g = docDongGiaoDich(o(45778), "Tháng 52026", 2)!;
    expect(g.ngay!.getFullYear()).toBe(2025);
    expect(g.ngay!.getMonth()).toBe(4);
    expect(g.ngay!.getDate()).toBe(1);
  });

  it("ISO yyyy-mm-dd vẫn đọc được", () => {
    const g = docDongGiaoDich(o("2026-06-13"), "Tháng 62026", 5)!;
    expect(g.ngay!.getDate()).toBe(13);
    expect(g.ngay!.getMonth()).toBe(5);
  });

  it("ngày/tháng ngoài khoảng → null, không cuộn vòng sang tháng sau", () => {
    // `new Date(2026, 12, 32)` KHÔNG ném — nó trả 01/01/2027. Im lặng và sai.
    expect(docDongGiaoDich(o("32/06/2026"), "Tháng 62026", 5)!.ngay).toBeNull();
    expect(docDongGiaoDich(o("13/13/2026"), "Tháng 62026", 5)!.ngay).toBeNull();
    expect(docDongGiaoDich(o("00/06/2026"), "Tháng 62026", 5)!.ngay).toBeNull();
  });

  it("rác → null, không ném", () => {
    for (const v of ["", "   ", "NHẬP TAB THÁNG 8", "abc", null, undefined, {}]) {
      expect(docDongGiaoDich(o(v), "Tháng 62026", 5)!.ngay).toBeNull();
    }
  });

  it("dấu phân cách - và . cũng chấp nhận", () => {
    expect(docDongGiaoDich(o("13-06-2026"), "Tháng 62026", 5)!.ngay!.getDate()).toBe(13);
    expect(docDongGiaoDich(o("13.06.2026"), "Tháng 62026", 5)!.ngay!.getMonth()).toBe(5);
  });
});
