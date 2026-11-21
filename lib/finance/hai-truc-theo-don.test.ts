// Ca [HT-*] — gộp HAI TRỤC theo đơn. Thuần + một bản db giả cho lượt tra.
//
// Thứ đang canh là phép CỘNG TIỀN nuôi badge trạng thái đơn ở cả hai màn. Nó có ba cách
// sai im lặng: cộng nhầm trục, cộng sót dòng điều chỉnh (delta), và trộn tiền giữa các đơn.
import { describe, it, expect } from "vitest";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import {
  gopHaiTruc,
  haiTrucTheoDon,
  KHONG_CO_TIEN,
  type KhoanDeCong,
} from "./hai-truc-theo-don";

/** Khoản mẫu — mặc định là ca phổ biến nhất trên DB thật (336/416 dòng). */
/**
 * ⚠️ Lấy giá trị từ HẰNG CHUẨN, không gõ tay chuỗi.
 *
 * Hai lý do, và lý do thứ hai mới là lý do thật: (1) fixture bám định nghĩa nên đổi luật
 * ở `debt.ts`/`ghi-nhan.ts` là test đi theo; (2) repo có một lưới tiền —
 * `lib/finance/truc-a.test.ts` `[BUOC-6]` — CẤM mọi tệp ngoài `debt.ts` gõ tay chuỗi điều
 * kiện của trục A. Bản đầu của tệp này gõ tay và làm lưới đó ĐỎ. Cách vá đúng là bám hằng,
 * KHÔNG phải xin thêm một dòng ngoại lệ: nới một lưới tiền để mã của mình đi lọt là đổi
 * một cổng lấy một sự tiện.
 */
const k = (over: Partial<KhoanDeCong> = {}): KhoanDeCong => ({
  orderId: "don1",
  amount: 1_000_000,
  saleStatus: SALE_STATUS_DA_GHI_NHAN[1]!,
  accountantStatus: KHOAN_DA_XAC_NHAN.accountantStatus,
  deletedAt: null,
  ...over,
});

describe("[HT-01] hai trục tách nhau đúng", () => {
  it("khoản CHỜ kế toán ⇒ vào trục B, KHÔNG vào trục A", () => {
    const m = gopHaiTruc([k({ accountantStatus: "PENDING" })]);
    expect(m.get("don1")).toEqual({ daGhiNhan: 1_000_000, daXacNhan: 0 });
  });

  it("khoản ĐÃ xác nhận ⇒ vào CẢ HAI — trục A là tập con của trục B", () => {
    expect(gopHaiTruc([k()]).get("don1")).toEqual({
      daGhiNhan: 1_000_000,
      daXacNhan: 1_000_000,
    });
  });

  it("cả hai giá trị saleStatus đều là 'đã ghi nhận'", () => {
    // `PaymentSaleStatus` có ĐÚNG hai giá trị và cả hai đều tính — đo trên DB thật:
    // 379 dòng COLLECT_CONFIRMED + 37 dòng RECORDED.
    for (const ss of SALE_STATUS_DA_GHI_NHAN) {
      expect(gopHaiTruc([k({ saleStatus: ss })]).get("don1")?.daGhiNhan).toBe(1_000_000);
    }
  });

  it("khoản đã xoá mềm KHÔNG vào trục nào", () => {
    const m = gopHaiTruc([k({ deletedAt: new Date("2026-09-01T00:00:00Z") })]);
    expect(m.get("don1")).toEqual({ daGhiNhan: 0, daXacNhan: 0 });
  });
});

describe("[HT-02] BÚT TOÁN ĐIỀU CHỈNH — cộng HẾT, không loại dòng gốc", () => {
  it("gốc 4tr + delta −1tr ⇒ 3tr, KHÔNG phải −1tr và KHÔNG phải 4tr", () => {
    // Dòng ADJUSTMENT mang DELTA (`payment.ts:899-912`), kế thừa `saleStatus`, và mang
    // `accountantStatus: CONFIRMED`. Tôi đã tự viết một câu SQL loại dòng gốc trong phiên
    // này — nó giữ delta mà bỏ gốc ⇒ ra −1.000.000đ. Ca này ghim luật đúng.
    const m = gopHaiTruc([
      k({ amount: 4_000_000 }),
      k({ amount: -1_000_000 }), // dòng điều chỉnh
    ]);
    expect(m.get("don1")).toEqual({ daGhiNhan: 3_000_000, daXacNhan: 3_000_000 });
  });

  it("HOÀN TIỀN ghi số ÂM ⇒ tự trừ ra, không cần nhánh riêng", () => {
    // `refundPayment` tạo dòng `amount` âm (`payment.ts:1075`). Cộng nó vào là ĐÚNG.
    const m = gopHaiTruc([
      k({ amount: 5_000_000 }),
      k({ amount: -5_000_000, accountantStatus: "REFUNDED" }),
    ]);
    // Trục B: 5tr + (−5tr) = 0. Trục A: chỉ dòng CONFIRMED ⇒ 5tr (dòng REFUNDED không tính).
    expect(m.get("don1")?.daGhiNhan).toBe(0);
  });
});

describe("[HT-03] KHÔNG trộn tiền giữa các đơn", () => {
  it("mỗi đơn một ô riêng", () => {
    const m = gopHaiTruc([
      k({ orderId: "don1", amount: 1_000_000 }),
      k({ orderId: "don2", amount: 7_000_000 }),
      k({ orderId: "don1", amount: 2_000_000 }),
    ]);
    expect(m.get("don1")?.daGhiNhan).toBe(3_000_000);
    expect(m.get("don2")?.daGhiNhan).toBe(7_000_000);
  });

  it("khoản KHÔNG có orderId bị BỎ QUA, không ném, không gán bừa", () => {
    // Tiền về qua cổng thanh toán có thể chưa gắn đơn — trạng thái hợp lệ.
    const m = gopHaiTruc([k({ orderId: null, amount: 9_000_000 }), k()]);
    expect(m.size).toBe(1);
    expect(m.get("don1")?.daGhiNhan).toBe(1_000_000);
  });

  it("đơn không có khoản nào ⇒ người gọi dùng KHONG_CO_TIEN, không undefined", () => {
    expect(gopHaiTruc([]).get("donX")).toBeUndefined();
    expect(KHONG_CO_TIEN).toEqual({ daGhiNhan: 0, daXacNhan: 0 });
  });
});

describe("[HT-04] lượt tra — một lần, khử trùng, rỗng thì KHÔNG đi DB", () => {
  function dbGia(tra: KhoanDeCong[]) {
    const goi: unknown[] = [];
    return {
      goi,
      db: {
        payment: {
          findMany: async (args: unknown) => {
            goi.push(args);
            return tra;
          },
        },
      } as Parameters<typeof haiTrucTheoDon>[0],
    };
  }

  it("tập rỗng ⇒ 0 lượt tra (Prisma `in: []` vẫn là một vòng đi–về)", async () => {
    const { goi, db } = dbGia([]);
    expect((await haiTrucTheoDon(db, [])).size).toBe(0);
    expect(goi.length).toBe(0);
  });

  it("id trùng ⇒ chỉ gửi MỘT lần, và đúng MỘT lượt tra cho cả trang", async () => {
    const { goi, db } = dbGia([k()]);
    await haiTrucTheoDon(db, ["don1", "don1", "don2", "don1"]);
    expect(goi.length).toBe(1);
    expect((goi[0] as { where: { orderId: { in: string[] } } }).where.orderId.in).toEqual([
      "don1",
      "don2",
    ]);
  });

  it("câu tra LUÔN kẹp `deletedAt: null` — khoản xoá mềm không được nạp lên", async () => {
    const { goi, db } = dbGia([]);
    await haiTrucTheoDon(db, ["don1"]);
    expect((goi[0] as { where: { deletedAt: null } }).where.deletedAt).toBeNull();
  });
});

// ═══ [HT-05] GHIM NỢ: TRỤC B ĐẾM CẢ KHOẢN KẾ TOÁN ĐÃ TỪ CHỐI ══════════════════
//
// ĐO 16/09/2026:
//   · `PaymentSaleStatus` có ĐÚNG HAI giá trị (`RECORDED`, `COLLECT_CONFIRMED`) —
//     `prisma/schema.prisma`;
//   · `SALE_STATUS_DA_GHI_NHAN` (`lib/finance/ghi-nhan.ts`) liệt kê CẢ HAI ⇒ vế
//     `saleStatus` của trục B là phép so LUÔN ĐÚNG (khớp 416/416 dòng trên satarobo_local);
//   · `rejectPayment` (`lib/finance/payment.ts:719`) chỉ đổi `accountantStatus` thành
//     `REJECTED`, KHÔNG đụng `saleStatus`.
// ⇒ Khoản kế toán đã TỪ CHỐI vẫn được đếm là "đã thu", và badge mới sẽ nói "Đã đóng đủ".
//
// Hôm nay 0 dòng REJECTED trên satarobo_local nên chưa thiệt hại — nhưng đường ghi còn
// sống, và theo luật đọc số thì 0 dòng KHÔNG hạ được mức nghiêm trọng.
//
// CHƯA VÁ, CÓ CHỦ ĐÍCH: trục B nuôi BỐN đường tiền khác (số in trên mã QR · ngưỡng đối
// khớp SePay · tin ZNS học phí · cổng chốt lead thành ghi danh — xem đầu `ghi-nhan.ts`).
// Siết nó là đổi cả bốn ⇒ phải là đợt riêng có chủ dự án duyệt. `it.fails` theo nếp repo:
// hôm nay thân ca ném nên CI không đỏ; vá xong ca chuyển XANH và vitest báo "expected to
// fail" ⇒ buộc gỡ ghim.
describe("[HT-05] ĐÃ VÁ 24/09/2026 — khoản bị TỪ CHỐI không còn là 'đã thu'", () => {
  it("khoản accountantStatus=REJECTED KHÔNG được tính là 'đã thu'", () => {
    const m = gopHaiTruc([k({ accountantStatus: "REJECTED" })]);
    expect(m.get("don1")).toEqual({ daGhiNhan: 0, daXacNhan: 0 });
  });

  it("CHỜ kế toán thì VẪN là 'đã thu' — đối chứng dương", () => {
    // Không có ca này thì siết nhầm thành "chỉ CONFIRMED" vẫn xanh, và mọi khoản chưa ai
    // duyệt biến mất khỏi công nợ — lỗ lớn hơn lỗ vừa vá.
    const m = gopHaiTruc([k({ accountantStatus: "PENDING" })]);
    expect(m.get("don1")).toEqual({ daGhiNhan: 1_000_000, daXacNhan: 0 });
  });

  it("HOÀN TIỀN vẫn cộng — dòng âm tự trừ ra", () => {
    // `refundPayment` ghi `amount` ÂM. Loại `REFUNDED` là trừ hai lần.
    // Dùng PENDING chứ không gõ trạng thái "đã duyệt": ca này đo TRỤC B, và gõ điều kiện
    // trục A ra đây là vi phạm lưới `truc-a.test.ts` mà không thêm gì cho phép đo.
    const m = gopHaiTruc([
      k({ accountantStatus: "PENDING" }),
      k({ accountantStatus: "REFUNDED", amount: -400_000 }),
    ]);
    expect(m.get("don1")?.daGhiNhan).toBe(600_000);
  });
});
