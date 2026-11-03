// lib/validators/order-ke-hoach.test.ts — payload TẠO ĐƠN và `keHoachDot` SAU KHI KẾ HOẠCH THANH TOÁN BỊ BỎ [20/10/2026].
//
// Lịch sử: 15/09/2026 chủ dự án đưa kế hoạch đợt lên trang tạo đơn nên schema từng kiểm từng đợt (ngày yyyy-mm-dd, trần số
// đợt, số tiền không âm). 20/10/2026 chủ dự án bỏ hẳn: *"bỏ phần kế hoạch thanh toán luôn đi, bây giờ mỗi lần đóng là 1
// lần thanh toán độc lập"*. Các ca [VKH-01..05] cũ (ghim hình dạng đợt) đã bị thay.
//
// ⚠️ Ca [VKH-01] ghim một điều NGƯỢC trực giác: schema VẪN PHẢI GIỮ khoá `keHoachDot`. Nếu ai "dọn" nó đi vì không còn dùng,
// `z.object` sẽ GỠ khoá lạ trong im lặng — client cũ (tab mở từ trước deploy) gửi đợt lên, đơn vẫn tạo thành công và đợt
// biến mất không một lời. Đó là đúng điều chủ dự án không chấp nhận; câu từ chối nằm ở `createOrderManualAction`
// (`lyDoTuChoiKeHoachDot`), và cần khoá còn trong dữ liệu đã parse thì action mới thấy được.
import { describe, it, expect } from "vitest";
import { orderCreateManualSchema } from "./order";
import { LY_DO_DA_BO_KE_HOACH_DOT, lyDoTuChoiKeHoachDot } from "@/lib/orders/ke-hoach-da-bo";

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

/** Đợt đúng hình dạng form CŨ từng gửi. */
const dot = (amount: number, dueDate: string | null, daThu = false) => ({
  amount,
  daThu,
  dueDate,
});

describe("[VKH-01] schema GIỮ khoá keHoachDot — client cũ gửi đợt thì action PHẢI thấy được", () => {
  it("hình dạng đợt cũ đi qua parse NGUYÊN VẸN (không bị z.object gỡ im lặng)", () => {
    const dots = [dot(5_280_000, "2026-01-20"), { ...dot(5_280_000, "2026-02-19"), reminderDays: 7, laCoc: false }];
    const r = orderCreateManualSchema.safeParse(donCoBan(dots));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toEqual(dots);
    // Đối chứng nối với cổng: chính dữ liệu đã parse này làm `lyDoTuChoiKeHoachDot` trả câu từ chối.
    expect(lyDoTuChoiKeHoachDot(r.data.keHoachDot)).toBe(LY_DO_DA_BO_KE_HOACH_DOT);
  });

  it("đợt rác (ngày sai khuôn, số âm) CŨNG đi qua parse — schema không còn kiểm hình dạng đợt, cổng ở action từ chối cả mảng", () => {
    // Nếu schema vẫn từ chối đợt rác thì client cũ nhận "Dữ liệu không hợp lệ" chung chung thay vì câu giải thích.
    const r = orderCreateManualSchema.safeParse(donCoBan([dot(-1, "20/01/2026")]));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(lyDoTuChoiKeHoachDot(r.data.keHoachDot)).toBe(LY_DO_DA_BO_KE_HOACH_DOT);
  });
});

describe("[VKH-02] lyDoTuChoiKeHoachDot — chỉ mảng KHÔNG RỖNG mới bị từ chối", () => {
  it("thiếu / null / [] ⇒ null (đơn không có kế hoạch là đơn bình thường)", () => {
    expect(lyDoTuChoiKeHoachDot(undefined)).toBeNull();
    expect(lyDoTuChoiKeHoachDot(null)).toBeNull();
    expect(lyDoTuChoiKeHoachDot([])).toBeNull();
  });

  it("[đối chứng dương] một đợt duy nhất cũng bị từ chối — đợt 1 đã thu trọn đơn vẫn là 'kế hoạch'", () => {
    expect(lyDoTuChoiKeHoachDot([dot(10_560_000, null, true)])).toBe(LY_DO_DA_BO_KE_HOACH_DOT);
  });

  it("câu từ chối nói đúng điều đã đổi: mỗi lần đóng là một phiếu thu riêng", () => {
    expect(LY_DO_DA_BO_KE_HOACH_DOT).toContain("Đã bỏ kế hoạch thanh toán chia đợt");
    expect(LY_DO_DA_BO_KE_HOACH_DOT).toContain("mỗi lần đóng là một phiếu thu riêng");
  });
});

describe("[VKH-04] ĐƯỜNG MỚI KHÔNG VỠ — form mới không gửi kế hoạch vẫn tạo đơn được", () => {
  it("thiếu hẳn khoá keHoachDot", () => {
    const r = orderCreateManualSchema.safeParse(donCoBan());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toBeUndefined();
  });

  it("gửi null", () => {
    const r = orderCreateManualSchema.safeParse(donCoBan(null));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.keHoachDot).toBeNull();
  });

  it("gửi mảng rỗng", () => {
    expect(orderCreateManualSchema.safeParse(donCoBan([])).success).toBe(true);
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
