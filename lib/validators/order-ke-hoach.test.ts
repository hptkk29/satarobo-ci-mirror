// lib/validators/order-ke-hoach.test.ts — payload TẠO ĐƠN nay mang theo KẾ HOẠCH ĐỢT.
//
// Chủ dự án 15/09/2026: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi"*.
//
// ⚠️ Ca [VKH-05] ghim một sự VẮNG MẶT CÓ CHỦ Ý — schema KHÔNG kiểm Σ các đợt. Ghim một
// thứ "không kiểm" nghe ngược đời, nhưng đúng chỗ này nó là luật tiền: cả Σ lẫn tổng đơn
// đều nằm trong payload CLIENT, nên so hai vế ở đây là để client cầm cả hai đầu cân. Cổng
// thật là `kiemKeHoachDot` bên trong `recordInstallmentPlan`, nơi vế phải đọc
// `Order.totalAmount` mà SERVER vừa tính từ các dòng. Không có ca này thì người sau "vá"
// bằng một `.refine` Σ ở đây và tưởng đã chặn được gì.
import { describe, it, expect } from "vitest";
import { orderCreateManualSchema } from "./order";
import { TRAN_SO_DOT } from "@/lib/payments/ke-hoach-dot";

/** Đơn tối thiểu hợp lệ — mọi ca chỉ đổi phần kế hoạch. */
function donCoBan(keHoachDot?: unknown) {
  return {
    type: "COURSE",
    customerName: "Nguyễn Văn A",
    customerPhone: "0905123456",
    paymentMethodId: "pm_1",
    items: [
      {
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3",
        quantity: 1,
        unitPrice: 10_560_000,
      },
    ],
    ...(keHoachDot === undefined ? {} : { keHoachDot }),
  };
}

const dot = (amount: number, dueDate: string | null, daThu = false) => ({
  amount,
  daThu,
  dueDate,
});

describe("[VKH-01] kế hoạch đi kèm payload tạo đơn", () => {
  it("2 đợt hợp lệ — giữ nguyên số tiền, cờ đã thu và ngày hẹn", () => {
    const r = orderCreateManualSchema.safeParse(
      donCoBan([dot(5_280_000, "2026-01-20"), dot(5_280_000, "2026-02-19")]),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toEqual([
      { amount: 5_280_000, daThu: false, dueDate: "2026-01-20" },
      { amount: 5_280_000, daThu: false, dueDate: "2026-02-19" },
    ]);
  });

  it("đợt ĐÃ THU gửi dueDate null — hợp lệ", () => {
    const r = orderCreateManualSchema.safeParse(
      donCoBan([dot(10_560_000, null, true)]),
    );
    expect(r.success).toBe(true);
  });

  it("nhận reminderDays theo từng đợt", () => {
    const r = orderCreateManualSchema.safeParse(
      donCoBan([{ ...dot(10_560_000, "2026-01-20"), reminderDays: 7 }]),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot?.[0]?.reminderDays).toBe(7);
  });
});

describe("[VKH-02] ngày hẹn phải đúng khuôn yyyy-mm-dd", () => {
  it("chuỗi rác bị TỪ CHỐI, không lặng lẽ thành Invalid Date", () => {
    for (const xau of ["20/01/2026", "2026-1-2", "hôm nay", ""]) {
      const r = orderCreateManualSchema.safeParse(donCoBan([dot(10_560_000, xau)]));
      expect(r.success, `dueDate=${JSON.stringify(xau)} phải bị từ chối`).toBe(false);
    }
  });
});

describe("[VKH-03] trần số đợt = trần của luật chia đợt, không phải con số rời", () => {
  it(`${TRAN_SO_DOT} đợt: qua — ${TRAN_SO_DOT + 1} đợt: chặn`, () => {
    const day = (n: number) =>
      Array.from({ length: n }, () => dot(1_000_000, "2026-01-20"));
    expect(orderCreateManualSchema.safeParse(donCoBan(day(TRAN_SO_DOT))).success).toBe(true);
    expect(orderCreateManualSchema.safeParse(donCoBan(day(TRAN_SO_DOT + 1))).success).toBe(
      false,
    );
  });

  it("số tiền âm bị chặn — phiếu thu âm không tồn tại trong nghiệp vụ", () => {
    expect(
      orderCreateManualSchema.safeParse(donCoBan([dot(-1, "2026-01-20")])).success,
    ).toBe(false);
  });
});

describe("[VKH-04] ĐƯỜNG CŨ KHÔNG VỠ — không gửi kế hoạch vẫn tạo đơn được", () => {
  it("thiếu hẳn khoá keHoachDot", () => {
    const r = orderCreateManualSchema.safeParse(donCoBan());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toBeUndefined();
  });

  it("gửi null (khối kế hoạch đang khoá vì chưa chọn khoá học)", () => {
    const r = orderCreateManualSchema.safeParse(donCoBan(null));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toBeNull();
  });

  it("gửi mảng rỗng", () => {
    expect(orderCreateManualSchema.safeParse(donCoBan([])).success).toBe(true);
  });
});

describe("[VKH-05] Σ các đợt CỐ Ý không kiểm ở đây — xem chú thích đầu tệp", () => {
  it("kế hoạch 1đ cho đơn 10.560.000đ vẫn PARSE (cổng Σ nằm ở recordInstallmentPlan)", () => {
    const r = orderCreateManualSchema.safeParse(donCoBan([dot(1, "2026-01-20")]));
    expect(r.success).toBe(true);
  });
});

// ═══ [VCL] MỘT DÒNG — MỘT ĐỨA TRẺ [16/09/2026] ════════════════════════════════
//
// Ô chọn học viên nay bày CHUNG hai nhóm: em đã có hồ sơ (`studentId`) và con khai trong
// lead chưa chốt (`leadChildId`). Chủ dự án: *"lead này đa số là lead chưa chốt nên chưa
// phải là học viên nên sẽ lấy thông tin con của PH lead đó chứ"*.
//
// Ca dưới canh luật LOẠI TRỪ. Vì sao nó đáng một ca riêng: khai cả hai khoá KHÔNG ném lỗi
// ở đâu — nó chỉ để ngỏ hai câu trả lời khác nhau cho "khoản này của ai", và cái sai lộ ra
// muộn nhất có thể (lúc hoàn tiền, hoặc lúc phụ huynh hỏi). Đã cấy lại (`.refine(() => true)`)
// để thấy ca này ĐỎ.
describe("[VCL-01] studentId × leadChildId loại trừ nhau", () => {
  const donVoi = (them: Record<string, unknown>) => ({
    type: "COURSE",
    customerName: "Nguyễn Văn A",
    customerPhone: "0905123456",
    paymentMethodId: "pm_1",
    items: [
      { type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 10_560_000, ...them },
    ],
  });

  it("khai CẢ HAI ⇒ TỪ CHỐI, và nói rõ ở đúng trường", () => {
    const r = orderCreateManualSchema.safeParse(
      donVoi({ studentId: "hv-1", leadChildId: "lc-1" }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("leadChildId"))).toBe(true);
      expect(r.error.issues.map((i) => i.message).join(" ")).toContain("MỘT học viên");
    }
  });

  it("khai MỘT trong hai ⇒ nhận", () => {
    expect(orderCreateManualSchema.safeParse(donVoi({ studentId: "hv-1" })).success).toBe(true);
    expect(orderCreateManualSchema.safeParse(donVoi({ leadChildId: "lc-1" })).success).toBe(true);
  });

  it("KHÔNG khai gì ⇒ vẫn nhận (khách vãng lai, con chưa có hồ sơ ở đâu cả)", () => {
    expect(orderCreateManualSchema.safeParse(donVoi({})).success).toBe(true);
    expect(
      orderCreateManualSchema.safeParse(donVoi({ studentId: null, leadChildId: null })).success,
    ).toBe(true);
  });

  it("khoảng trắng KHÔNG phải một lựa chọn — không được lách luật loại trừ bằng ' '", () => {
    // `z.string().min(1)` cho `" "` qua, nên nếu refine so bằng truthy thuần thì
    // `{ studentId: "hv-1", leadChildId: " " }` lọt. `.trim()` trong refine chặn đúng đó.
    expect(
      orderCreateManualSchema.safeParse(donVoi({ studentId: "hv-1", leadChildId: " " })).success,
    ).toBe(true);
  });
});
