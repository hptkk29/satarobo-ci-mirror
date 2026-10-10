// Ca [LT-*] — GOM "LẦN THU" VÀ KIỂM ĐỦ TIỀN (docs/ke-toan-hoa-don/PLAN.md §3).
//
// Chủ dự án chốt (Q4, 25/09): hoá đơn theo LẦN THU; số tiền lệch với đợt thì kế toán gắn thêm
// giao dịch cho đủ, rồi mới tính là một lần thu.
//
// Ba cái bẫy mà phản biện v1 tìm ra, mỗi cái có ca riêng ở đây:
//   · WATERFALL làm tròn: PH chuyển 4.500.000 cho đợt 4.488.000, 12.000 tràn sang đợt sau. Gom
//     theo "đợt nào còn PARTIAL" thì bắc cầu cả đơn thành một lần thu ⇒ [LT-02].
//   · TIỀN MẶT không bao giờ vào sổ đợt (PaymentAllocation chỉ sinh từ giao dịch ngân hàng) ⇒ đo
//     "đủ" bằng TIỀN, không bằng trạng thái đợt ⇒ [LT-05].
//   · Phần đợt đã được giao dịch KHÁC trả (tràn, hoặc đã nằm trong hoá đơn khác) không được đòi
//     lại ⇒ [LT-02], [LT-17].
import { describe, it, expect } from "vitest";
import { gomLanThu, gopTuKhoa, khoaGop, lanThuCuaHoaDon, type DotVao, type GiaoDichVao, type KhoanVaoLanThu, type PhanBoVao } from "./lan-thu";

// ── fixture ──────────────────────────────────────────────────────────────────
const dot = (n: number, amountDue: number, status: DotVao["status"] = "PAID"): DotVao => ({
  id: `dot${n}`,
  installmentNo: n,
  amountDue,
  status,
});
const gd = (id: string, amount: number, luc = "2026-09-10T10:00:00Z"): GiaoDichVao => ({
  id,
  provider: "SEPAY",
  providerTxnId: `FT-${id}`,
  transferredAt: new Date(luc),
  amount,
});
const pb = (bt: string, dotId: string, amount: number, roundingWaived = 0): PhanBoVao => ({
  bankTransactionId: bt,
  paymentRequestId: dotId,
  amount,
  roundingWaived,
});
/** Khoản của webhook — marker ghi provider CHỮ THƯỜNG, cột BankTransaction lưu CHỮ HOA. */
const kWebhook = (id: string, bt: string, rong: number): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "WEBHOOK", provider: "sepay", providerTxnId: `FT-${bt}` },
  paidDate: new Date("2026-09-10T10:05:00Z"),
});
const kGanTay = (id: string, bt: string, rong: number): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "GAN_TAY", bankTransactionId: bt },
  paidDate: new Date("2026-09-11T02:00:00Z"),
});
const kTienMat = (id: string, rong: number, paidDate = "2026-09-12T03:00:00Z"): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "KHONG" },
  paidDate: new Date(paidDate),
});
const kLoiKhai = (id: string, rong: number): KhoanVaoLanThu => ({
  id,
  rong,
  nguon: { loai: "LOI_KHAI" },
  paidDate: new Date("2026-09-10T03:00:00Z"),
});

type Vao = Parameters<typeof gomLanThu>[0];
const vao = (o: Partial<Vao>): Vao => ({
  khoan: [],
  giaoDich: [],
  phanBo: [],
  dot: [],
  gop: [],
  giaoDichChuaKhop: [],
  donCoKhoanNganHang: false,
  ...o,
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[LT-01] một lần chuyển khoản trả đúng một đợt", () => {
  it("1 lần thu, DU, khoá theo đợt, số tiền = số ròng", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 3_000_000)],
        giaoDich: [gd("bt1", 3_000_000)],
        phanBo: [pb("bt1", "dot1", 3_000_000)],
        dot: [dot(1, 3_000_000)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      key: "dot:dot1",
      khoanIds: ["p1"],
      giaoDichIds: ["bt1"],
      soTien: 3_000_000,
      nguon: "CK",
      trangThai: "DU",
      thieu: 0,
      dotDich: [{ id: "dot1", installmentNo: 1 }],
    });
  });

  it("provider so KHÔNG phân biệt hoa thường (marker 'sepay' ↔ cột 'SEPAY')", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 3_000_000)],
        giaoDich: [gd("bt1", 3_000_000)],
        phanBo: [pb("bt1", "dot1", 3_000_000)],
        dot: [dot(1, 3_000_000)],
      }),
    );
    expect(r[0]!.giaoDichIds).toEqual(["bt1"]);
    expect(r[0]!.canhBao).toEqual([]);
  });
});

describe("[LT-02] ba lần chuyển SỐ TRÒN cho ba đợt lẻ ⇒ BA lần thu DU, KHÔNG bắc cầu thành một", () => {
  // Đợt 4.488.000 × 3. PH chuyển 4.500.000 mỗi lần. Waterfall:
  //   bt1: đợt1 4.488.000 + đợt2 12.000
  //   bt2: đợt2 4.476.000 + đợt3 24.000
  //   bt3: đợt3 4.464.000 (36.000 dư vào ví — không có dòng phân bổ)
  const input = vao({
    khoan: [kWebhook("p1", "bt1", 4_500_000), kWebhook("p2", "bt2", 4_500_000), kWebhook("p3", "bt3", 4_500_000)],
    giaoDich: [gd("bt1", 4_500_000), gd("bt2", 4_500_000), gd("bt3", 4_500_000)],
    phanBo: [
      pb("bt1", "dot1", 4_488_000),
      pb("bt1", "dot2", 12_000),
      pb("bt2", "dot2", 4_476_000),
      pb("bt2", "dot3", 24_000),
      pb("bt3", "dot3", 4_464_000),
    ],
    dot: [dot(1, 4_488_000), dot(2, 4_488_000), dot(3, 4_488_000)],
  });

  it("ba lần thu, mỗi cái đúng một giao dịch, đều DU", () => {
    const r = gomLanThu(input);
    expect(r.map((l) => [l.key, l.giaoDichIds, l.trangThai])).toEqual([
      ["dot:dot1", ["bt1"], "DU"],
      ["dot:dot2", ["bt2"], "DU"],
      ["dot:dot3", ["bt3"], "DU"],
    ]);
  });

  it("phần tràn sang đợt sau HIỆN là 'trả trước', không chặn", () => {
    const r = gomLanThu(input);
    expect(r.map((l) => l.traTruoc)).toEqual([12_000, 24_000, 0]);
  });

  it("phần vào ví (không có dòng phân bổ) hiện riêng", () => {
    const r = gomLanThu(input);
    expect(r.map((l) => l.ngoaiDot)).toEqual([0, 0, 36_000]);
  });

  it("phải thu của đợt 2 đã TRỪ phần đợt 1 tràn sang (không đòi lại 12.000)", () => {
    const r = gomLanThu(input);
    expect(r[1]).toMatchObject({ phaiThu: 4_476_000, daVaoDot: 4_476_000 });
  });
});

describe("[LT-03/04] hai lần chuyển cho CÙNG một đợt ⇒ MỘT lần thu", () => {
  const dot1 = dot(1, 3_000_000);

  it("[LT-04] mới về lần đầu (2tr/3tr, đợt PARTIAL) ⇒ THIEU 1.000.000", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 2_000_000)],
        giaoDich: [gd("bt1", 2_000_000)],
        phanBo: [pb("bt1", "dot1", 2_000_000)],
        dot: [{ ...dot1, status: "PARTIAL" }],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:dot1", trangThai: "THIEU", thieu: 1_000_000 });
  });

  it("[LT-03] về đủ lần hai ⇒ GỘP thành một lần thu DU, khoá KHÔNG đổi", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 2_000_000), kGanTay("p2", "bt2", 1_000_000)],
        giaoDich: [gd("bt1", 2_000_000), gd("bt2", 1_000_000, "2026-09-15T08:00:00Z")],
        phanBo: [pb("bt1", "dot1", 2_000_000), pb("bt2", "dot1", 1_000_000)],
        dot: [dot1],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      key: "dot:dot1", // cùng khoá với lúc còn THIEU ⇒ màn giữ được dòng đang chọn
      khoanIds: ["p1", "p2"],
      giaoDichIds: ["bt1", "bt2"],
      soTien: 3_000_000,
      trangThai: "DU",
      ngayThu: "2026-09-15", // ngày của giao dịch làm ĐỦ
    });
  });
});

describe("[LT-05] tiền mặt + chuyển khoản cùng đợt — tiền mặt KHÔNG vào sổ đợt", () => {
  const input = vao({
    khoan: [kWebhook("p1", "bt1", 3_000_000), kTienMat("cash", 2_000_000)],
    giaoDich: [gd("bt1", 3_000_000)],
    phanBo: [pb("bt1", "dot1", 3_000_000)],
    dot: [dot(1, 5_000_000, "PARTIAL")], // PARTIAL mãi: tiền mặt không sinh PaymentAllocation
  });

  it("mặc định: phần CK THIEU 2tr, tiền mặt là một lần thu riêng", () => {
    const r = gomLanThu(input);
    expect(r.map((l) => [l.key, l.trangThai, l.thieu])).toEqual([
      ["dot:dot1", "THIEU", 2_000_000],
      ["k:cash", "KHONG_DOI_CHIEU", 0],
    ]);
  });

  it("kế toán GẮN tiền mặt vào ⇒ DU dù đợt vẫn PARTIAL trong sổ (đo bằng TIỀN)", () => {
    const r = gomLanThu({ ...input, gop: [["dot:dot1", "k:cash"]] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trangThai: "DU", soTien: 5_000_000, khoanIds: ["cash", "p1"] });
  });
});

describe("[LT-06] dung sai làm tròn được tha", () => {
  it("chuyển thiếu 3.000đ, đợt đã tha ⇒ DU, phần tha hiện riêng", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 2_997_000)],
        giaoDich: [gd("bt1", 2_997_000)],
        phanBo: [pb("bt1", "dot1", 2_997_000, 3_000)],
        dot: [dot(1, 3_000_000)],
      }),
    );
    expect(r[0]).toMatchObject({ trangThai: "DU", tienTha: 3_000, soTien: 2_997_000 });
  });
});

describe("[LT-07] khoản đã TÁCH cho hai bé — cùng một giao dịch ⇒ Σ = 1× tiền chuyển", () => {
  it("hai phần mang marker gốc gom về một lần thu", () => {
    // Dòng gốc đã đảo trọn (ròng 0) bị `phanLoaiKhoan` loại TRƯỚC khi vào đây.
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("phan-a", "bt1", 3_500_000), kWebhook("phan-b", "bt1", 2_500_000)],
        giaoDich: [gd("bt1", 6_000_000)],
        phanBo: [pb("bt1", "dot1", 6_000_000)],
        dot: [dot(1, 6_000_000)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ soTien: 6_000_000, trangThai: "DU" });
  });
});

describe("[LT-08] đợt bị VOID ⇒ DOT_HUY, không bao giờ THIEU", () => {
  it("phân bổ vào đợt VOID", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 2_000_000)],
        giaoDich: [gd("bt1", 2_000_000)],
        phanBo: [pb("bt1", "dot1", 2_000_000)],
        dot: [dot(1, 3_000_000, "VOID")],
      }),
    );
    expect(r[0]).toMatchObject({ trangThai: "DOT_HUY", thieu: 0 });
  });
});

describe("[LT-09] LỜI KHAI và NGHI TRÙNG (PLAN §3.3)", () => {
  it("lời khai một mình ⇒ LOI_KHAI", () => {
    const r = gomLanThu(vao({ khoan: [kLoiKhai("khai", 8_976_000)] }));
    expect(r[0]).toMatchObject({ key: "k:khai", nguon: "LOI_KHAI", trangThai: "LOI_KHAI" });
  });

  it("cùng đơn có khoản ngân hàng ⇒ NGHI_TRUNG (đúng hình dạng ORD-260910-000002 trên prod)", () => {
    const r = gomLanThu(
      vao({
        khoan: [kLoiKhai("khai", 8_976_000), kWebhook("p1", "bt1", 8_976_000)],
        giaoDich: [gd("bt1", 8_976_000)],
        phanBo: [pb("bt1", "dot0", 8_976_000)],
        dot: [dot(0, 8_976_000)],
      }),
    );
    const khai = r.find((l) => l.khoanIds.includes("khai"))!;
    expect(khai.trangThai).toBe("NGHI_TRUNG");
  });

  it("có giao dịch CHƯA KHỚP cùng số tiền ⇒ NGHI_TRUNG", () => {
    const r = gomLanThu(
      vao({ khoan: [kLoiKhai("khai", 2_000_000)], giaoDichChuaKhop: [{ amount: 2_000_000 }] }),
    );
    expect(r[0]!.trangThai).toBe("NGHI_TRUNG");
  });

  it("giao dịch chưa khớp KHÁC số ⇒ không nghi", () => {
    const r = gomLanThu(
      vao({ khoan: [kLoiKhai("khai", 2_000_000)], giaoDichChuaKhop: [{ amount: 1_999_000 }] }),
    );
    expect(r[0]!.trangThai).toBe("LOI_KHAI");
  });
});

describe("[LT-10] phiếu 'thu toàn đơn' (installmentNo 0) ⇒ mỗi giao dịch một lần thu", () => {
  it("hai lần chuyển một phần cho đơn không có kế hoạch đợt", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 2_000_000), kWebhook("p2", "bt2", 3_000_000)],
        giaoDich: [gd("bt1", 2_000_000), gd("bt2", 3_000_000, "2026-09-20T01:00:00Z")],
        phanBo: [pb("bt1", "dot0", 2_000_000), pb("bt2", "dot0", 3_000_000)],
        dot: [dot(0, 8_000_000, "PARTIAL")],
      }),
    );
    expect(r.map((l) => [l.key, l.trangThai])).toEqual([
      ["gd:bt1", "KHONG_DOI_CHIEU"],
      ["gd:bt2", "KHONG_DOI_CHIEU"],
    ]);
  });
});

describe("[LT-11] ngày thu theo lịch VIỆT NAM", () => {
  it("giao dịch 23:30 ngày 30/09 (transferredAt là giờ VN mang nhãn UTC) ⇒ 30/09", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 1)],
        giaoDich: [gd("bt1", 1, "2026-09-30T23:30:00Z")],
        phanBo: [pb("bt1", "dot1", 1)],
        dot: [dot(1, 1)],
      }),
    );
    expect(r[0]!.ngayThu).toBe("2026-09-30");
  });

  it("tiền mặt ghi lúc 17:30 UTC 30/09 = 00:30 ngày 01/10 giờ VN ⇒ 01/10", () => {
    const r = gomLanThu(vao({ khoan: [kTienMat("c", 1, "2026-09-30T17:30:00Z")] }));
    expect(r[0]!.ngayThu).toBe("2026-10-01");
  });
});

describe("[LT-13] dòng phân bổ vào đợt của ĐƠN KHÁC bị bỏ qua", () => {
  it("chỉ đợt có trong `dot` mới được tính", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 3_000_000)],
        giaoDich: [gd("bt1", 3_000_000)],
        phanBo: [pb("bt1", "dot1", 3_000_000), pb("bt1", "dot-cua-don-khac", 999)],
        dot: [dot(1, 3_000_000)],
      }),
    );
    expect(r[0]).toMatchObject({ trangThai: "DU", traTruoc: 0 });
  });
});

describe("[LT-14] khoản mang marker ngân hàng mà KHÔNG thấy giao dịch", () => {
  it("thành lần thu riêng, có CẢNH BÁO, không bị đọc như tiền mặt câm", () => {
    const r = gomLanThu(vao({ khoan: [kWebhook("p1", "bt-mat", 1_000_000)] }));
    expect(r[0]).toMatchObject({ key: "k:p1", trangThai: "KHONG_DOI_CHIEU" });
    expect(r[0]!.canhBao.length).toBe(1);
  });
});

describe("[LT-16] kế toán GỘP hai lần thu của hai đợt vào một hoá đơn", () => {
  it("phải thu = tổng hai đợt; đủ cả hai ⇒ DU", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p1", "bt1", 3_000_000), kWebhook("p2", "bt2", 2_000_000)],
        giaoDich: [gd("bt1", 3_000_000), gd("bt2", 2_000_000)],
        phanBo: [pb("bt1", "dot1", 3_000_000), pb("bt2", "dot2", 2_000_000)],
        dot: [dot(1, 3_000_000), dot(2, 2_000_000)],
        gop: [["dot:dot1", "dot:dot2"]],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ phaiThu: 5_000_000, daVaoDot: 5_000_000, trangThai: "DU", soTien: 5_000_000 });
    expect(r[0]!.dotDich.map((d) => d.id)).toEqual(["dot1", "dot2"]);
  });

  it("khoá gộp KHÔNG phụ thuộc thứ tự người dùng chọn", () => {
    const base = vao({
      khoan: [kWebhook("p1", "bt1", 3_000_000), kTienMat("c", 1_000_000)],
      giaoDich: [gd("bt1", 3_000_000)],
      phanBo: [pb("bt1", "dot1", 3_000_000)],
      dot: [dot(1, 3_000_000)],
    });
    const a = gomLanThu({ ...base, gop: [["dot:dot1", "k:c"]] })[0]!.key;
    const b = gomLanThu({ ...base, gop: [["k:c", "dot:dot1"]] })[0]!.key;
    expect(a).toBe(b);
  });

  it("khoá gộp lạ (không có lần thu nào mang khoá đó) bị BỎ QUA, không ném lỗi giữa trang", () => {
    const r = gomLanThu(
      vao({
        khoan: [kTienMat("c", 1_000_000)],
        gop: [["k:c", "dot:khong-co"]],
      }),
    );
    expect(r.map((l) => l.key)).toEqual(["k:c"]);
  });
});

describe("[LT-17] phần đợt đã được trả bởi giao dịch ĐÃ NẰM TRONG HOÁ ĐƠN KHÁC không bị đòi lại", () => {
  it("bt1 (1tr, đã khoá — không truyền vào) + bt2 (2tr) cho đợt 3tr ⇒ bt2 DU", () => {
    const r = gomLanThu(
      vao({
        khoan: [kWebhook("p2", "bt2", 2_000_000)],
        giaoDich: [gd("bt1", 1_000_000), gd("bt2", 2_000_000)],
        phanBo: [pb("bt1", "dot1", 1_000_000), pb("bt2", "dot1", 2_000_000)],
        dot: [dot(1, 3_000_000)],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "dot:dot1", giaoDichIds: ["bt2"], phaiThu: 2_000_000, trangThai: "DU" });
  });
});

describe("[LT-18] thứ tự ra TẤT ĐỊNH", () => {
  it("xếp theo ngày thu rồi theo khoá, không theo thứ tự đầu vào", () => {
    const input = vao({
      khoan: [kTienMat("z", 1, "2026-09-20T03:00:00Z"), kTienMat("a", 1, "2026-09-20T03:00:00Z"), kTienMat("m", 1, "2026-09-01T03:00:00Z")],
    });
    const xuoi = gomLanThu(input).map((l) => l.key);
    const nguoc = gomLanThu({ ...input, khoan: [...input.khoan].reverse() }).map((l) => l.key);
    expect(xuoi).toEqual(["k:m", "k:a", "k:z"]);
    expect(nguoc).toEqual(xuoi);
  });
});

describe("[LT-19/20] nghi trùng theo CẢ ĐƠN + lý do (GĐ 8)", () => {
  it("[LT-19] lời khai ĐỨNG MỘT MÌNH nhưng đơn có khoản chuyển khoản ⇒ NGHI_TRUNG ['DON_CO_CHUYEN_KHOAN']", () => {
    // Đúng hình dạng lỗ đo 27/09: khoản chuyển khoản đã khoá vào hoá đơn khác nên KHÔNG có trong tập khoản.
    const r = gomLanThu(vao({ khoan: [kLoiKhai("k1", 3_000_000)], donCoKhoanNganHang: true }));
    expect(r[0]).toMatchObject({ trangThai: "NGHI_TRUNG", nghiTrungVi: ["DON_CO_CHUYEN_KHOAN"] });
    // Đối chứng: đơn KHÔNG có khoản chuyển khoản ⇒ chỉ là lời khai.
    expect(gomLanThu(vao({ khoan: [kLoiKhai("k1", 3_000_000)], donCoKhoanNganHang: false }))[0]).toMatchObject({
      trangThai: "LOI_KHAI",
      nghiTrungVi: [],
    });
  });

  it("[LT-20] giao dịch chưa khớp cùng số ⇒ ['CHUA_KHOP_CUNG_SO']; cả hai ⇒ cả hai; khoản thường ⇒ []", () => {
    expect(
      gomLanThu(vao({ khoan: [kLoiKhai("k1", 3_000_000)], giaoDichChuaKhop: [{ amount: 3_000_000 }] }))[0]!.nghiTrungVi,
    ).toEqual(["CHUA_KHOP_CUNG_SO"]);
    expect(
      gomLanThu(vao({ khoan: [kLoiKhai("k1", 3_000_000)], giaoDichChuaKhop: [{ amount: 3_000_000 }], donCoKhoanNganHang: true }))[0]!
        .nghiTrungVi,
    ).toEqual(["DON_CO_CHUYEN_KHOAN", "CHUA_KHOP_CUNG_SO"]);
    expect(gomLanThu(vao({ khoan: [kTienMat("m1", 3_000_000)], donCoKhoanNganHang: true }))[0]!.nghiTrungVi).toEqual([]);
  });
});

describe("[LT-21] lanThuCuaHoaDon — lần thu của MỘT hoá đơn (màn và bước chốt cùng gọi)", () => {
  const { gop: _boGop, ...khong } = vao({});
  it("khoản rơi vào HAI nhóm ⇒ gộp về MỘT, khoá = khoá gộp của gomLanThu; một nhóm ⇒ giữ khoá gốc", () => {
    const hai = lanThuCuaHoaDon({ ...khong, khoan: [kTienMat("m1", 1_000_000), kTienMat("m2", 2_000_000)] })!;
    expect(hai).toMatchObject({ key: "gop:k:m1+k:m2", khoanIds: ["m1", "m2"], soTien: 3_000_000 });
    expect(lanThuCuaHoaDon({ ...khong, khoan: [kTienMat("m1", 1_000_000)] })!.key).toBe("k:m1");
  });

  it("gộp xong vẫn đo ĐỦ trên cả nhóm: CK 2tr + tiền mặt 1tr cho đợt 3tr ⇒ DU; không còn khoản ⇒ null", () => {
    const lt = lanThuCuaHoaDon({
      ...khong,
      khoan: [kWebhook("p1", "bt1", 2_000_000), kTienMat("m1", 1_000_000)],
      giaoDich: [gd("bt1", 2_000_000)],
      phanBo: [pb("bt1", "dot1", 2_000_000)],
      dot: [dot(1, 3_000_000, "PARTIAL")],
    })!;
    expect(lt).toMatchObject({ trangThai: "DU", phaiThu: 3_000_000, daVaoDot: 3_000_000, soTien: 3_000_000 });
    expect(lanThuCuaHoaDon({ ...khong, khoan: [] })).toBeNull();
  });
});

describe("[LT-22] (Q2 — gộp lần thu của cùng đơn) khoá gộp CHỞ đủ tập thành phần — `khoaGop` ⇄ `gopTuKhoa`", () => {
  it("khoá gộp sắp xếp + bỏ trùng; gopTuKhoa đọc ngược đúng tập (bỏ cả đuôi `~` của khoaDuyNhat)", () => {
    expect(khoaGop(["k:cash", "dot:dot1", "k:cash"])).toBe("gop:dot:dot1+k:cash");
    expect(gopTuKhoa("gop:dot:dot1+k:cash")).toEqual(["dot:dot1", "k:cash"]);
    expect(gopTuKhoa("gop:dot:dot1+k:cash~hd9")).toEqual(["dot:dot1", "k:cash"]);
  });

  it("khoá KHÔNG phải khoá gộp ⇒ tập rỗng (không gộp gì); khoá gộp dị dạng / một thành phần ⇒ rỗng", () => {
    expect(gopTuKhoa("dot:dot1")).toEqual([]);
    expect(gopTuKhoa("k:p1~hd1")).toEqual([]);
    expect(gopTuKhoa("gop:")).toEqual([]);
    expect(gopTuKhoa("gop:dot:dot1")).toEqual([]);
  });

  it("khoá gomLanThu đặt cho nhóm gộp = khoaGop của thành phần — khoá client dựng ra khớp khoá server dựng lại", () => {
    const input = vao({
      khoan: [kWebhook("p1", "bt1", 3_000_000), kTienMat("cash", 2_000_000)],
      giaoDich: [gd("bt1", 3_000_000)],
      phanBo: [pb("bt1", "dot1", 3_000_000)],
      dot: [dot(1, 5_000_000, "PARTIAL")],
    });
    const khoa = khoaGop(["k:cash", "dot:dot1"]);
    const r = gomLanThu({ ...input, gop: [gopTuKhoa(khoa)] });
    expect(r.map((l) => [l.key, l.trangThai, l.soTien])).toEqual([[khoa, "DU", 5_000_000]]);
  });
});
