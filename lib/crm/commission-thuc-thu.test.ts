// lib/crm/commission-thuc-thu.test.ts — hoa hồng tính trên TIỀN ĐÃ THU (chốt 27/08/2026).
//
// Tiền là chỗ sai đắt nhất trong kho này, nên bộ test phủ đúng 7 ca chủ dự án nêu:
// đóng một phần · nhiều đợt cùng kỳ · vắt qua hai tháng · hoàn toàn bộ · hoàn một
// phần · hoàn ở tháng SAU tháng đã trả hoa hồng · chạy lại kỳ hai lần.
import { describe, it, expect } from "vitest";
import {
  khoangKy,
  kyCuaButToan,
  tinhHoaHongTheoKy,
  type ButToanHoaHong,
} from "./commission-thuc-thu";
import { DEFAULT_RATES, type CommissionTier } from "./commission";
import { commissionPeriodVN } from "./trial-teacher-commission";

/** Rate cố định = bảng mặc định (QC 1 · SaleAdmin 1 · Sale 4 · QL TT 2 = 8%). */
const rateMacDinh = () => DEFAULT_RATES;

const NGUOI: Partial<Record<CommissionTier, string>> = {
  QC: "u-qc",
  SALE_ADMIN: "u-sadmin",
  SALE: "u-sale",
  QL_TT: "u-qltt",
};

/** Dựng 1 bút toán thu tiền. `ngay` là chuỗi ISO có offset +07 cho dễ đọc. */
function thu(id: string, amount: number, ngay: string, patch: Partial<ButToanHoaHong> = {}): ButToanHoaHong {
  const d = new Date(ngay);
  return {
    paymentId: id,
    amount,
    paidDate: d,
    rateDate: d,
    assigneeDate: d,
    refundOfPaymentId: null,
    leadId: "lead-1",
    centerId: "cs-1",
    isRenewal: false,
    recipients: NGUOI,
    ...patch,
  };
}

/**
 * Dựng 1 bút toán HOÀN (âm). `ngayHoan` quyết định KỲ; `ngayGoc` quyết định TỈ LỆ
 * — đúng như `refundPayment()` ghi sổ: bản ghi âm mang `paidDate = now`, trỏ
 * `adjustmentOfId` về khoản gốc.
 */
function hoan(
  id: string,
  soTien: number,
  ngayHoan: string,
  goc: { id: string; ngay: string },
  patch: Partial<ButToanHoaHong> = {},
): ButToanHoaHong {
  return {
    paymentId: id,
    amount: -Math.abs(soTien),
    paidDate: new Date(ngayHoan),
    rateDate: new Date(goc.ngay),
    // NGƯỜI HƯỞNG cũng đi theo khoản gốc (như tỉ lệ): thu hồi phải đòi đúng người đã nhận.
    assigneeDate: new Date(goc.ngay),
    refundOfPaymentId: goc.id,
    leadId: "lead-1",
    centerId: "cs-1",
    isRenewal: false,
    recipients: NGUOI,
    ...patch,
  };
}

const tienSale = (lines: { tier: string; amount: number }[]) =>
  lines.filter((l) => l.tier === "SALE").reduce((s, l) => s + l.amount, 0);

// ─────────────────────────────────────────────────────────────────────────────
describe("khoangKy — biên kỳ theo THÁNG DƯƠNG LỊCH VIỆT NAM", () => {
  it("kỳ 2026-09 bắt đầu 00:00 ngày 1/9 giờ VN (= 17:00 ngày 31/8 UTC)", () => {
    const { start, end } = khoangKy("2026-09");
    expect(start.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("khớp NGƯỢC với commissionPeriodVN — không có khe hở, không chồng lấn", () => {
    const { start, end } = khoangKy("2026-09");
    expect(commissionPeriodVN(start)).toBe("2026-09");
    expect(commissionPeriodVN(new Date(end.getTime() - 1))).toBe("2026-09");
    // `end` là biên MỞ: nó đã thuộc kỳ sau.
    expect(commissionPeriodVN(end)).toBe("2026-10");
    // Ngay trước `start` là kỳ trước ⇒ hai kỳ liền nhau phủ kín trục thời gian.
    expect(commissionPeriodVN(new Date(start.getTime() - 1))).toBe("2026-08");
  });

  it("đơn đóng 23:30 ngày cuối tháng giờ VN KHÔNG rơi sang kỳ sau", () => {
    // Bẫy cũ: Vercel chạy UTC nên 23:30 ngày 31/8 giờ VN = 16:30 UTC ngày 31/8;
    // đọc tháng theo UTC vẫn ra tháng 8, nhưng 00:30 ngày 1/9 giờ VN (17:30 UTC
    // ngày 31/8) phải là kỳ 9. Đây là ca dễ mất/nhân đôi một đơn ở giao kỳ.
    expect(kyCuaButToan(new Date("2026-08-31T23:30:00+07:00"))).toBe("2026-08");
    expect(kyCuaButToan(new Date("2026-09-01T00:30:00+07:00"))).toBe("2026-09");
  });

  it("từ chối chuỗi kỳ sai định dạng — không đoán bừa một khoảng thời gian", () => {
    expect(() => khoangKy("2026-9")).toThrow();
    expect(() => khoangKy("2026-13")).toThrow();
    expect(() => khoangKy("thang-9")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[CA-1] đóng MỘT PHẦN — hoa hồng theo tiền đã thu, không theo giá hợp đồng", () => {
  it("hợp đồng 20 triệu, mới đóng 5 triệu → Sale ăn 4% của 5 triệu", () => {
    // Chính sách 27/08: KHÔNG tính trên 20 triệu. Đây là ca gốc của cả đợt sửa.
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 5_000_000, "2026-09-10T09:00:00+07:00")],
      ratesAt: rateMacDinh,
    });
    expect(tienSale(lines)).toBe(200_000); // 4% × 5tr — KHÔNG phải 4% × 20tr = 800k
    // Cả 4 tầng đều tính trên cùng số tiền đã thu; Σ = 8% × 5tr.
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(400_000);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => !l.isClawback)).toBe(true);
  });

  it("chưa thu đồng nào → KHÔNG sinh dòng nào (không phải dòng 0đ)", () => {
    expect(tinhHoaHongTheoKy({ period: "2026-09", butToan: [], ratesAt: rateMacDinh })).toEqual([]);
  });
});

describe("[CA-2] đóng NHIỀU ĐỢT trong CÙNG kỳ — gộp thành một dòng, đủ dấu vết", () => {
  it("3 đợt trong tháng 9 → Sale ăn 4% của tổng, một dòng duy nhất", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 5_000_000, "2026-09-03T09:00:00+07:00"),
        thu("p2", 3_000_000, "2026-09-14T09:00:00+07:00"),
        thu("p3", 2_000_000, "2026-09-28T09:00:00+07:00"),
      ],
      ratesAt: rateMacDinh,
    });
    const sale = lines.filter((l) => l.tier === "SALE");
    expect(sale).toHaveLength(1); // gộp, không phải 3 dòng vụn
    expect(sale[0]!.amount).toBe(400_000); // 4% × 10tr
    // Dấu vết: đọc dòng là truy được ra từng bút toán đã cộng vào nó.
    for (const id of ["p1", "p2", "p3"]) expect(sale[0]!.note).toContain(id);
  });

  it("hai lead khác nhau KHÔNG bị gộp chung dòng — kế toán phải soi được từng phễu", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 5_000_000, "2026-09-03T09:00:00+07:00", { leadId: "lead-1" }),
        thu("p2", 5_000_000, "2026-09-04T09:00:00+07:00", { leadId: "lead-2" }),
      ],
      ratesAt: rateMacDinh,
    });
    const sale = lines.filter((l) => l.tier === "SALE");
    expect(sale).toHaveLength(2);
    expect(sale.map((l) => l.leadId).sort()).toEqual(["lead-1", "lead-2"]);
  });
});

describe("[CA-3] đóng VẮT QUA HAI THÁNG — mỗi đồng nằm đúng kỳ nó vào sổ", () => {
  const butToan = [
    thu("p-t8", 6_000_000, "2026-08-20T09:00:00+07:00"),
    thu("p-t9", 4_000_000, "2026-09-02T09:00:00+07:00"),
  ];

  it("kỳ tháng 8 chỉ ăn phần đóng tháng 8", () => {
    expect(tienSale(tinhHoaHongTheoKy({ period: "2026-08", butToan, ratesAt: rateMacDinh }))).toBe(240_000);
  });

  it("kỳ tháng 9 chỉ ăn phần đóng tháng 9", () => {
    expect(tienSale(tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh }))).toBe(160_000);
  });

  it("cộng hai kỳ = đúng 4% tổng tiền đã thu — không mất, không nhân đôi", () => {
    const t8 = tienSale(tinhHoaHongTheoKy({ period: "2026-08", butToan, ratesAt: rateMacDinh }));
    const t9 = tienSale(tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh }));
    expect(t8 + t9).toBe(0.04 * 10_000_000);
  });
});

describe("[CA-4] hoàn TOÀN BỘ trong cùng kỳ — hoa hồng về đúng 0", () => {
  it("thu 10tr rồi hoàn 10tr trong tháng 9 → dòng dương + dòng âm, Σ = 0", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00"),
        hoan("r1", 10_000_000, "2026-09-20T09:00:00+07:00", { id: "p1", ngay: "2026-09-05T09:00:00+07:00" }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(tienSale(lines)).toBe(0);
    // KHÔNG bù trừ im lặng thành một dòng 0đ: phải thấy cả hai vế.
    const sale = lines.filter((l) => l.tier === "SALE");
    expect(sale).toHaveLength(2);
    expect(sale.find((l) => !l.isClawback)!.amount).toBe(400_000);
    expect(sale.find((l) => l.isClawback)!.amount).toBe(-400_000);
  });

  it("dòng thu hồi truy nguyên được về khoản hoàn VÀ khoản gốc", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00"),
        hoan("r1", 10_000_000, "2026-09-20T09:00:00+07:00", { id: "p1", ngay: "2026-09-05T09:00:00+07:00" }),
      ],
      ratesAt: rateMacDinh,
    });
    const claw = lines.find((l) => l.tier === "SALE" && l.isClawback)!;
    expect(claw.note).toContain("r1"); // bút toán hoàn
    expect(claw.note).toContain("p1"); // khoản gốc bị hoàn
    expect(claw.isClawback).toBe(true);
  });
});

describe("[CA-5] hoàn MỘT PHẦN — thu hồi đúng phần đã trả cho phần bị hoàn", () => {
  it("thu 10tr, hoàn 4tr → Sale còn 4% × 6tr", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00"),
        hoan("r1", 4_000_000, "2026-09-25T09:00:00+07:00", { id: "p1", ngay: "2026-09-05T09:00:00+07:00" }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(tienSale(lines)).toBe(240_000); // 400k − 160k
    expect(lines.filter((l) => l.tier === "SALE" && l.isClawback)[0]!.amount).toBe(-160_000);
  });
});

describe("[CA-6] hoàn ở THÁNG SAU tháng đã trả hoa hồng — kỳ cũ BẤT ĐỘNG", () => {
  const gocT8 = { id: "p1", ngay: "2026-08-10T09:00:00+07:00" };
  const butToan = [
    thu("p1", 10_000_000, gocT8.ngay),
    hoan("r1", 10_000_000, "2026-09-05T09:00:00+07:00", gocT8),
  ];

  it("kỳ tháng 8 GIỮ NGUYÊN +400k dù tháng 9 đã hoàn sạch", () => {
    // Đây là điểm chết người: nếu thu hồi thò ngược về kỳ cũ thì bảng kê tháng 8 —
    // đã duyệt, đã trả lương — đổi số sau lưng kế toán.
    expect(tienSale(tinhHoaHongTheoKy({ period: "2026-08", butToan, ratesAt: rateMacDinh }))).toBe(400_000);
  });

  it("kỳ tháng 9 sinh dòng ÂM −400k, và KHÔNG có dòng dương nào", () => {
    const lines = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh });
    expect(tienSale(lines)).toBe(-400_000);
    expect(lines.every((l) => l.isClawback)).toBe(true);
  });

  it("thu hồi áp TỈ LỆ CỦA KỲ GỐC, không phải tỉ lệ đang hiệu lực lúc hoàn", () => {
    // BGĐ hạ Sale 4% → 2% từ 1/9. Hoàn một khoản đã trả 4% mà chỉ thu lại 2% là
    // biếu không 2% — sai theo hướng mất tiền công ty, và không ai nhìn ra.
    const doiRate = (at: Date): Record<CommissionTier, number> =>
      at >= new Date("2026-09-01T00:00:00+07:00")
        ? { ...DEFAULT_RATES, SALE: 0.02 }
        : DEFAULT_RATES;
    const lines = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: doiRate });
    expect(tienSale(lines)).toBe(-400_000); // 4% của kỳ gốc, KHÔNG phải −200k
  });
});

describe("[CA-7] chạy lại kỳ — kết quả TRÙNG KHÍT, không cộng dồn", () => {
  const butToan = [
    thu("p1", 5_000_000, "2026-09-03T09:00:00+07:00"),
    thu("p2", 3_000_000, "2026-09-14T09:00:00+07:00"),
    hoan("r1", 2_000_000, "2026-09-25T09:00:00+07:00", { id: "p1", ngay: "2026-09-03T09:00:00+07:00" }),
  ];

  it("chạy 2 lần cho ra mảng dòng GIỐNG HỆT (kể cả thứ tự và note)", () => {
    const lan1 = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh });
    const lan2 = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh });
    expect(lan2).toEqual(lan1);
    // Thứ tự ổn định ⇒ so sánh trước/sau khi chốt kỳ là so được, không nhiễu.
    expect(JSON.stringify(lan2)).toBe(JSON.stringify(lan1));
  });

  it("chạy lại KHÔNG nhân đôi số tiền", () => {
    const lan1 = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh });
    const lan2 = tinhHoaHongTheoKy({ period: "2026-09", butToan, ratesAt: rateMacDinh });
    expect(tienSale(lan2)).toBe(tienSale(lan1));
    expect(tienSale(lan1)).toBe(240_000); // 4% × (5tr + 3tr − 2tr)
  });

  it("bút toán lặp cùng paymentId chỉ được tính MỘT lần", () => {
    // Query trả trùng (join lỗi, gộp hai nguồn) là tai nạn có thật; chốt kỳ không
    // được biến nó thành tiền thật.
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 5_000_000, "2026-09-03T09:00:00+07:00"), thu("p1", 5_000_000, "2026-09-03T09:00:00+07:00")],
      ratesAt: rateMacDinh,
    });
    expect(tienSale(lines)).toBe(200_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("luật nghiệp vụ giữ nguyên từ engine cũ", () => {
  it("tái tục KHÔNG hưởng 4 tầng (C10.3) — kể cả khi tiền đã về", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00", { isRenewal: true })],
      ratesAt: rateMacDinh,
    });
    expect(lines).toEqual([]);
  });

  it("hoàn tiền của ghi danh TÁI TỤC cũng không sinh dòng âm", () => {
    // Chưa từng trả đồng nào thì không có gì để thu hồi — thu hồi khống là nợ ảo.
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        hoan("r1", 10_000_000, "2026-09-05T09:00:00+07:00", { id: "p1", ngay: "2026-08-01T09:00:00+07:00" }, { isRenewal: true }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(lines).toEqual([]);
  });

  it("tầng KHÔNG có người nhận → không sinh dòng tầng đó (không trả cho 'null')", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00", { recipients: { SALE: "u-sale" } })],
      ratesAt: rateMacDinh,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tier).toBe("SALE");
  });

  it("bút toán ngoài kỳ bị loại — lớp chắn, dù caller đã lọc bằng SQL", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p-t8", 5_000_000, "2026-08-20T09:00:00+07:00")],
      ratesAt: rateMacDinh,
    });
    expect(lines).toEqual([]);
  });

  it("Σ 4 tầng đúng 8% — trần không bị phá bởi đường mới", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 100_000_000, "2026-09-05T09:00:00+07:00")],
      ratesAt: rateMacDinh,
    });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(8_000_000);
  });

  // 27/08/2026 — trần mặc định nới 8% → 9%, nên ca thử phải vượt QUA 9% mới ném.
  // Σ = 10% (SALE 4% → 6%).
  it("tỉ lệ vượt trần → NÉM, không âm thầm trả quá", () => {
    const quaTran = () => ({ ...DEFAULT_RATES, SALE: 0.06 }); // Σ = 10% > trần 9%
    expect(() =>
      tinhHoaHongTheoKy({
        period: "2026-09",
        butToan: [thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00")],
        ratesAt: quaTran,
      }),
    ).toThrow(/vượt trần/);
  });

  // Ca biên đáng giữ: Σ = 9% ĐÚNG BẰNG trần mới ⇒ KHÔNG được ném. Trước 27/08 ca này ném.
  it("Σ đúng bằng trần 9% → vẫn tính bình thường", () => {
    const vuaKhit = () => ({ ...DEFAULT_RATES, SALE: 0.05 }); // Σ = 9%
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 100_000_000, "2026-09-05T09:00:00+07:00")],
      ratesAt: vuaKhit,
    });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(9_000_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [CA-8] 27/08/2026 — MỘT CƠ SỞ NHIỀU QC. Quy tắc đã chốt: CHIA ĐỀU, tổng tầng
// không đổi. Đây là chỗ dễ vỡ trần 8% trong TIỀN THẬT nhất, vì `validateRates`
// chỉ canh CẤU HÌNH tỉ lệ chứ không đếm số dòng đã chi.
describe("[CA-8] nhiều QC phụ trách một cơ sở — chia đều, TỔNG tầng không đổi", () => {
  const NHIEU_QC = { ...NGUOI, QC: ["u-qc-a", "u-qc-b"] };

  it("hai QC → hai dòng, mỗi dòng nửa của 1%", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00", { recipients: NHIEU_QC })],
      ratesAt: rateMacDinh,
    });
    const qc = lines.filter((l) => l.tier === "QC");
    expect(qc.map((l) => [l.recipientId, l.amount])).toEqual([
      ["u-qc-a", 50_000],
      ["u-qc-b", 50_000],
    ]);
  });

  it("Σ CẢ KỲ vẫn ĐÚNG 8% dù tầng QC bị chia cho 3 người", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 100_000_000, "2026-09-05T09:00:00+07:00", {
          recipients: { ...NGUOI, QC: ["a", "b", "c"] },
        }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(8_000_000);
  });

  it("hoàn sạch → từng phần đã chia bị thu hồi đúng bằng phần đã trả, Σ về 0", () => {
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 10_000_001, "2026-09-05T09:00:00+07:00", { recipients: NHIEU_QC }),
        hoan("r1", 10_000_001, "2026-09-20T09:00:00+07:00", { id: "p1", ngay: "2026-09-05T09:00:00+07:00" }, {
          recipients: NHIEU_QC,
        }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  });

  it("đổi QC giữa kỳ → mỗi bút toán về đúng người phụ trách lúc xác nhận", () => {
    // Không phải "người đang phụ trách cuối kỳ ăn cả tháng": mốc gán nằm trên TỪNG
    // bút toán (`assigneeDate`), nên hai lần thu trong cùng tháng có thể về hai người.
    const lines = tinhHoaHongTheoKy({
      period: "2026-09",
      butToan: [
        thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00", { recipients: { QC: "u-cu" } }),
        thu("p2", 10_000_000, "2026-09-25T09:00:00+07:00", { recipients: { QC: "u-moi" } }),
      ],
      ratesAt: rateMacDinh,
    });
    expect(lines.map((l) => [l.recipientId, l.amount])).toEqual([
      ["u-cu", 100_000],
      ["u-moi", 100_000],
    ]);
  });

  it("chạy lại kỳ với nhiều người hưởng vẫn TRÙNG KHÍT (thứ tự tất định)", () => {
    const chay = (r: string[]) =>
      tinhHoaHongTheoKy({
        period: "2026-09",
        butToan: [thu("p1", 10_000_000, "2026-09-05T09:00:00+07:00", { recipients: { QC: r } })],
        ratesAt: rateMacDinh,
      });
    expect(chay(["u-b", "u-a"])).toEqual(chay(["u-a", "u-b"]));
  });
});
