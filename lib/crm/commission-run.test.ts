// lib/crm/commission-run.test.ts — dịch sổ `Payment` sang bút toán hoa hồng (THUẦN).
//
// Đây là chỗ dễ sai âm thầm nhất của cả đợt: nếu đọc nhầm cột ngày hay nhầm người
// hưởng thì con số vẫn "hợp lý" và không ai phát hiện. Nên nó được test riêng, tách
// khỏi phép nhân tỉ lệ.
import { describe, it, expect } from "vitest";
import { mapButToanHoaHong, thongKe, type HangThanhToanHoaHong } from "./commission-run";
import type { PhanCongCoSo } from "./commission-assignee";
import { DEFAULT_RATES } from "./commission";

const NGAY_GOC = new Date("2026-08-10T09:00:00+07:00");
const NGAY_HOAN = new Date("2026-09-05T09:00:00+07:00");
const CS1 = "cs-1";
const CS2 = "cs-2";

function hang(patch: Partial<HangThanhToanHoaHong> = {}): HangThanhToanHoaHong {
  return {
    id: "p1",
    amount: 5_000_000,
    accountantStatus: "CONFIRMED",
    adjustmentOfId: null,
    paidDate: NGAY_GOC,
    confirmedAt: NGAY_GOC,
    centerId: CS1,
    adjustmentOf: null,
    enrollment: { renewedFromEnrollmentId: null },
    order: {
      leadId: "lead-1",
      centerId: CS1,
      lead: { convertedById: "u-sale", adminId: "u-admin", centerId: CS1 },
    },
    ...patch,
  };
}

describe("mapButToanHoaHong — người hưởng", () => {
  it("tầng SALE = Lead.convertedById (NGƯỜI CHỐT CUỐI), không phải người chăm", () => {
    // C10.5/B5: đổi sale giữa chừng → người chốt cuối hưởng 100% tầng Sale.
    // `convertedById` được ghi đúng lúc convert nên nó CHÍNH LÀ người chốt cuối;
    // `assignedToId` là người đang chăm và có thể đã đổi sau đó.
    const [bt] = mapButToanHoaHong([hang()]);
    expect(bt!.recipients.SALE).toBe("u-sale");
  });

  it("tầng SALE_ADMIN = Lead.adminId", () => {
    const [bt] = mapButToanHoaHong([hang()]);
    expect(bt!.recipients.SALE_ADMIN).toBe("u-admin");
  });

  it("chưa khai phân công → tầng QC và QL_TT vẫn để trống (treo, KHÔNG gán bừa)", () => {
    // Hành vi này được GIỮ NGUYÊN sau 27/08: có bảng phân công không có nghĩa là
    // được đoán. Cơ sở chưa khai thì tiền treo và hiện lên màn chốt kỳ kèm tên cơ sở.
    const [bt] = mapButToanHoaHong([hang()], []);
    expect(bt!.recipients.QC).toBeUndefined();
    expect(bt!.recipients.QL_TT).toBeUndefined();
  });

  it("đơn không gắn lead (khách vãng lai) → không có người hưởng nào", () => {
    const [bt] = mapButToanHoaHong([hang({ order: { leadId: null, centerId: null, lead: null } })]);
    expect(bt!.recipients).toEqual({});
    expect(bt!.leadId).toBeNull();
  });

  it("lead chưa có convertedById → tầng SALE bỏ trống, KHÔNG rơi về người nhập phiếu", () => {
    const [bt] = mapButToanHoaHong([
      hang({ order: { leadId: "lead-1", centerId: CS1, lead: { convertedById: null, adminId: "u-admin", centerId: CS1 } } }),
    ]);
    expect(bt!.recipients.SALE).toBeUndefined();
    expect(bt!.recipients.SALE_ADMIN).toBe("u-admin");
  });
});

describe("mapButToanHoaHong — ngày nào quyết định cái gì", () => {
  it("bút toán thu: KỲ và TỈ LỆ cùng lấy theo paidDate", () => {
    const [bt] = mapButToanHoaHong([hang()]);
    expect(bt!.paidDate).toEqual(NGAY_GOC);
    expect(bt!.rateDate).toEqual(NGAY_GOC);
    expect(bt!.refundOfPaymentId).toBeNull();
  });

  it("bút toán HOÀN: KỲ theo ngày hoàn, TỈ LỆ theo ngày khoản gốc", () => {
    // `refundPayment()` ghi bản âm với paidDate = now (ngày hoàn) và adjustmentOfId
    // trỏ về gốc. Lấy nhầm ngày ở đây là hoặc sửa sổ kỳ đã chốt, hoặc thu hồi sai %.
    const [bt] = mapButToanHoaHong([
      hang({
        id: "r1",
        amount: -5_000_000,
        accountantStatus: "REFUNDED",
        adjustmentOfId: "p1",
        paidDate: NGAY_HOAN,
        adjustmentOf: { paidDate: NGAY_GOC, confirmedAt: NGAY_GOC },
      }),
    ]);
    expect(bt!.paidDate).toEqual(NGAY_HOAN); // kỳ 2026-09
    expect(bt!.rateDate).toEqual(NGAY_GOC); // tỉ lệ tháng 8
    expect(bt!.refundOfPaymentId).toBe("p1");
    expect(bt!.amount).toBe(-5_000_000);
  });

  it("bút toán hoàn mất dấu khoản gốc → tỉ lệ lùi về ngày hoàn (không nổ)", () => {
    // `adjustmentOf` là quan hệ SetNull: xoá mềm khoản gốc là mất đường trỏ ngược.
    // Vẫn phải thu hồi được, chỉ là áp tỉ lệ của kỳ hoàn.
    const [bt] = mapButToanHoaHong([
      hang({ id: "r1", amount: -5_000_000, accountantStatus: "REFUNDED", adjustmentOfId: null, paidDate: NGAY_HOAN, adjustmentOf: null }),
    ]);
    expect(bt!.rateDate).toEqual(NGAY_HOAN);
    expect(bt!.refundOfPaymentId).toBeNull();
  });

  it("bút toán ĐIỀU CHỈNH giữ ngày của gốc ⇒ ở lại đúng kỳ gốc", () => {
    // 🔴 Mô hình DELTA (07/09/2026): dòng điều chỉnh mang trạng thái `CONFIRMED` và
    // PHẦN CHÊNH LỆCH, phân biệt bằng `paymentType`. `adjustPayment()` vẫn chép
    // `paidDate` của gốc nên điều chỉnh KHÔNG nhảy kỳ — phần đó không đổi.
    const [bt] = mapButToanHoaHong([
      hang({ id: "a1", amount: -1_000_000, accountantStatus: "CONFIRMED", adjustmentOfId: "p1", adjustmentOf: { paidDate: NGAY_GOC, confirmedAt: NGAY_GOC } }),
    ]);
    expect(bt!.paidDate).toEqual(NGAY_GOC);
    expect(bt!.rateDate).toEqual(NGAY_GOC);
    // Bản điều chỉnh KHÔNG phải khoản hoàn — không được đánh dấu thu hồi.
    expect(bt!.refundOfPaymentId).toBeNull();
    expect(bt!.amount).toBe(-1_000_000);
  });
});

describe("mapButToanHoaHong — tái tục", () => {
  it("ghi danh có renewedFromEnrollmentId → đánh dấu tái tục (C10.3: không hưởng)", () => {
    const [bt] = mapButToanHoaHong([hang({ enrollment: { renewedFromEnrollmentId: "enr-cu" } })]);
    expect(bt!.isRenewal).toBe(true);
  });

  it("khoản chưa gắn ghi danh → KHÔNG coi là tái tục (không có bằng chứng)", () => {
    const [bt] = mapButToanHoaHong([hang({ enrollment: null })]);
    expect(bt!.isRenewal).toBe(false);
  });
});

describe("mapButToanHoaHong — lớp chắn trạng thái kế toán", () => {
  it("GIỮ cả gốc lẫn delta — hoa hồng tính trên TỔNG sau điều chỉnh", () => {
    // 🔴 Đảo so với luật cũ. Trước 07/09/2026 bản `ADJUSTED` mang SỐ ĐÚNG và thay thế
    // bản gốc, nên phải loại gốc kẻo cộng đôi. Nay dòng điều chỉnh mang PHẦN CHÊNH
    // LỆCH, nên LOẠI gốc mới là đếm thiếu — hoa hồng sẽ tính trên 4tr thay vì 5tr−1tr.
    const rows = [
      hang({ id: "p1", amount: 5_000_000, accountantStatus: "CONFIRMED" }),
      hang({ id: "a1", amount: -1_000_000, accountantStatus: "CONFIRMED", adjustmentOfId: "p1", adjustmentOf: { paidDate: NGAY_GOC, confirmedAt: NGAY_GOC } }),
    ];
    const bts = mapButToanHoaHong(rows);
    expect(bts.map((b) => b.paymentId)).toEqual(["p1", "a1"]);
    expect(bts.reduce((t, b) => t + b.amount, 0)).toBe(4_000_000);
  });

  it("loại PENDING và REJECTED — chưa/không phải tiền thật", () => {
    const rows = [
      hang({ id: "p-pending", accountantStatus: "PENDING" }),
      hang({ id: "p-rejected", accountantStatus: "REJECTED" }),
      hang({ id: "p-ok", accountantStatus: "CONFIRMED" }),
    ];
    expect(mapButToanHoaHong(rows).map((b) => b.paymentId)).toEqual(["p-ok"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 27/08/2026 — QC 1% và QUẢN LÝ TT 2% ĐÃ CÓ NGƯỜI HƯỞNG.
// Hai tầng này gán theo CƠ SỞ của bút toán, hiệu lực tại MỐC KẾ TOÁN XÁC NHẬN.
// ═════════════════════════════════════════════════════════════════════════════

const T7 = new Date("2026-07-10T09:00:00+07:00");
const T8 = new Date("2026-08-01T00:00:00+07:00");

function pc(patch: Partial<PhanCongCoSo> = {}): PhanCongCoSo {
  return {
    centerId: CS1,
    role: "QC",
    userId: "u-qc",
    effectiveFrom: new Date("2026-01-01T00:00:00+07:00"),
    effectiveTo: null,
    ...patch,
  };
}

describe("mapButToanHoaHong — QC / QL_TT theo cơ sở", () => {
  it("gán đúng QC và Quản lý TT của cơ sở bút toán", () => {
    const [bt] = mapButToanHoaHong([hang()], [pc(), pc({ role: "QL_TT", userId: "u-ql" })]);
    expect(bt!.recipients.QC).toEqual(["u-qc"]);
    expect(bt!.recipients.QL_TT).toEqual(["u-ql"]);
  });

  it("KHÔNG lấy người của cơ sở khác", () => {
    const [bt] = mapButToanHoaHong([hang()], [pc({ centerId: CS2, userId: "u-qc-cs2" })]);
    expect(bt!.recipients.QC).toBeUndefined();
  });

  it("một cơ sở NHIỀU QC → trả cả danh sách (engine chia đều 1%)", () => {
    const [bt] = mapButToanHoaHong([hang()], [pc({ userId: "u-b" }), pc({ userId: "u-a" })]);
    expect(bt!.recipients.QC).toEqual(["u-a", "u-b"]);
  });
});

describe("mapButToanHoaHong — MỐC XÁC NHẬN quyết định ai hưởng", () => {
  it("dùng confirmedAt (lúc kế toán xác nhận), KHÔNG dùng paidDate", () => {
    // Khách chuyển tiền 10/7 nhưng kế toán mới xác nhận 10/8, giữa hai mốc đó công ty
    // đổi QC. Chủ dự án chốt: người hưởng là QC tại lúc XÁC NHẬN ⇒ u-moi.
    const rows = [hang({ paidDate: T7, confirmedAt: NGAY_GOC })];
    const phanCong = [pc({ userId: "u-cu", effectiveTo: T8 }), pc({ userId: "u-moi", effectiveFrom: T8 })];
    const [bt] = mapButToanHoaHong(rows, phanCong);
    expect(bt!.assigneeDate).toEqual(NGAY_GOC);
    expect(bt!.recipients.QC).toEqual(["u-moi"]);
  });

  it("dòng cũ chưa có confirmedAt → lùi về paidDate (không nổ, không bỏ trống)", () => {
    const rows = [hang({ paidDate: T7, confirmedAt: null })];
    const phanCong = [pc({ userId: "u-cu", effectiveTo: T8 }), pc({ userId: "u-moi", effectiveFrom: T8 })];
    const [bt] = mapButToanHoaHong(rows, phanCong);
    expect(bt!.assigneeDate).toEqual(T7);
    expect(bt!.recipients.QC).toEqual(["u-cu"]);
  });

  it("bản ĐIỀU CHỈNH soi mốc của khoản GỐC, KHÔNG phải lúc kế toán bấm nút sửa", () => {
    // `adjustPayment()` chép `paidDate` của gốc (⇒ ở lại KỲ gốc, ăn TỈ LỆ gốc) nhưng
    // đặt `confirmedAt = now`. Soi mốc "now" thì kế toán sửa số tháng 8 cho khoản thu
    // tháng 7 sẽ đẩy hoa hồng QC sang người mới — kỳ và tỉ lệ một đằng, người một nẻo.
    const rows = [
      hang({
        id: "a1",
        amount: 4_000_000,
        accountantStatus: "CONFIRMED",
        adjustmentOfId: "p1",
        paidDate: T7,
        confirmedAt: new Date("2026-08-20T09:00:00+07:00"), // lúc bấm nút sửa
        adjustmentOf: { paidDate: T7, confirmedAt: T7 },
      }),
    ];
    const phanCong = [pc({ userId: "u-cu", effectiveTo: T8 }), pc({ userId: "u-moi", effectiveFrom: T8 })];
    const [bt] = mapButToanHoaHong(rows, phanCong);
    expect(bt!.assigneeDate).toEqual(T7);
    expect(bt!.recipients.QC).toEqual(["u-cu"]);
  });

  it("bút toán HOÀN đòi lại từ người ĐÃ NHẬN, không phải người mới nhận việc", () => {
    // Cùng logic với `rateDate`: kỳ đi theo ngày hoàn, còn NGƯỜI đi theo khoản gốc.
    // Lấy nhầm ở đây là trừ lương một người chưa từng được trả đồng nào.
    const rows = [
      hang({
        id: "r1",
        amount: -5_000_000,
        accountantStatus: "REFUNDED",
        adjustmentOfId: "p1",
        paidDate: NGAY_HOAN,
        confirmedAt: NGAY_HOAN,
        adjustmentOf: { paidDate: T7, confirmedAt: T7 },
      }),
    ];
    const phanCong = [pc({ userId: "u-cu", effectiveTo: T8 }), pc({ userId: "u-moi", effectiveFrom: T8 })];
    const [bt] = mapButToanHoaHong(rows, phanCong);
    expect(bt!.assigneeDate).toEqual(T7);
    expect(bt!.recipients.QC).toEqual(["u-cu"]);
  });
});

describe("mapButToanHoaHong — suy CƠ SỞ của bút toán", () => {
  it("ưu tiên Payment.centerId", () => {
    const [bt] = mapButToanHoaHong([hang({ centerId: CS2 })], []);
    expect(bt!.centerId).toBe(CS2);
  });

  it("Payment.centerId null → lùi về Order.centerId", () => {
    const [bt] = mapButToanHoaHong([hang({ centerId: null })], []);
    expect(bt!.centerId).toBe(CS1);
  });

  it("cả hai null → lùi về Lead.centerId (dòng cũ vẫn chi được, không treo oan)", () => {
    const rows = [
      hang({
        centerId: null,
        order: {
          leadId: "lead-1",
          centerId: null,
          lead: { convertedById: "u-sale", adminId: null, centerId: CS2 },
        },
      }),
    ];
    const [bt] = mapButToanHoaHong(rows, [pc({ centerId: CS2, userId: "u-qc-cs2" })]);
    expect(bt!.centerId).toBe(CS2);
    expect(bt!.recipients.QC).toEqual(["u-qc-cs2"]);
  });

  it("không suy được cơ sở nào → KHÔNG gán ai (tiền treo dưới nhóm 'không rõ cơ sở')", () => {
    const rows = [hang({ centerId: null, order: { leadId: null, centerId: null, lead: null } })];
    const [bt] = mapButToanHoaHong(rows, [pc()]);
    expect(bt!.centerId).toBeNull();
    expect(bt!.recipients.QC).toBeUndefined();
  });
});

describe("thongKe — số tiền TREO phải nói ra cơ sở nào còn thiếu", () => {
  const rates = () => DEFAULT_RATES;

  it("chưa khai ai → treo đúng 3% (QC 1 + QL_TT 2), tách theo cơ sở", () => {
    const butToan = mapButToanHoaHong([hang({ amount: 10_000_000 })], []);
    const kq = thongKe("2026-08", butToan, [], rates);
    expect(kq.chuaCoNguoiHuong).toEqual({ QC: 100_000, QL_TT: 200_000 });
    expect(kq.treoTheoCoSo).toEqual([
      { centerId: CS1, tier: "QC", amount: 100_000 },
      { centerId: CS1, tier: "QL_TT", amount: 200_000 },
    ]);
  });

  it("KHAI ĐỦ hai vai → số treo về ĐÚNG 0 (điều kiện nghiệm thu của đợt này)", () => {
    const butToan = mapButToanHoaHong(
      [hang({ amount: 10_000_000 })],
      [pc(), pc({ role: "QL_TT", userId: "u-ql" })],
    );
    const kq = thongKe("2026-08", butToan, [], rates);
    expect(kq.chuaCoNguoiHuong).toEqual({});
    expect(kq.treoTheoCoSo).toEqual([]);
  });

  it("khai một cơ sở, cơ sở kia chưa khai → chỉ cơ sở chưa khai còn treo", () => {
    const rows = [
      hang({ id: "p1", amount: 10_000_000, centerId: CS1 }),
      hang({ id: "p2", amount: 10_000_000, centerId: CS2 }),
    ];
    const butToan = mapButToanHoaHong(rows, [
      pc({ centerId: CS1 }),
      pc({ centerId: CS1, role: "QL_TT", userId: "u-ql" }),
    ]);
    const kq = thongKe("2026-08", butToan, [], rates);
    expect(kq.treoTheoCoSo).toEqual([
      { centerId: CS2, tier: "QC", amount: 100_000 },
      { centerId: CS2, tier: "QL_TT", amount: 200_000 },
    ]);
  });

  it("mảng người hưởng RỖNG vẫn tính là chưa khai (mảng rỗng là truthy trong JS)", () => {
    // Bẫy thật: `if (bt.recipients[tier])` trần coi `[]` là "đã có người" ⇒ số treo
    // về 0 trong khi KHÔNG đồng nào được chi. Kế toán tưởng đã trả đủ 8%.
    const butToan = mapButToanHoaHong([hang({ amount: 10_000_000 })], []).map((b) => ({
      ...b,
      recipients: { ...b.recipients, QC: [] as string[], QL_TT: [] as string[] },
    }));
    const kq = thongKe("2026-08", butToan, [], rates);
    expect(kq.chuaCoNguoiHuong).toEqual({ QC: 100_000, QL_TT: 200_000 });
  });
});
