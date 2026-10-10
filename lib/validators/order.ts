import { z } from "zod";
import { OrderType, OrderStatus, OrderItemType } from "@prisma/client";
import { phoneVn } from "@/lib/validators/phone";
import { TRAN_KHOAN_GIAM_MOI_DONG, MA_LOAI_GIAM } from "@/lib/orders/giam-gia-dong";
import { TRAN_SO_DOT } from "@/lib/payments/ke-hoach-dot";

// AUTH-SĐT P1 — regex riêng đã gỡ; nguồn duy nhất ở `lib/phone.ts`.
export { PHONE_VN_RE as PHONE_VN } from "@/lib/phone";



const orderItemSchema = z.object({
  type: z.nativeEnum(OrderItemType),
  itemName: z.string().min(1).max(300),
  itemDescription: z.string().max(1000).optional().nullable(),
  quantity: z.number().int().min(1).max(99),
  unitPrice: z.number().int().min(0),
  // Polymorphic refs (one will be set depending on type)
  packageId: z.string().min(1).optional().nullable(),
  examAttemptId: z.string().min(1).optional().nullable(),
  productId: z.string().min(1).optional().nullable(),
  /**
   * Dòng hàng này mua cho CON NÀO — đơn nhiều con (15/09/2026).
   *
   * ⚠️ Chỉ là Ý ĐỊNH của client cho tới khi `createOrderManualAction` tra lại qua
   * `scopedDb` và gác `passesScope`. Một `studentId` lọt vào đây là một quan hệ TIỀN
   * (“khoản này của con nào”), nên không bao giờ được tin thẳng — cùng lý do với
   * `centerId`, xem chú thích ở đó.
   */
  studentId: z.string().min(1).optional().nullable(),
  /**
   * Dòng hàng này mua cho con nào KHI CON ĐÓ CHƯA CÓ HỒ SƠ `Student` [16/09/2026].
   *
   * Chủ dự án: *"lead này đa số là lead chưa chốt nên chưa phải là học viên nên sẽ lấy
   * thông tin con của PH lead đó chứ"*. Đo: 121/125 lead không có `Student` nào khớp SĐT,
   * còn `LeadChild` có 130 dòng / 104 lead.
   *
   * ⚠️ CŨNG chỉ là Ý ĐỊNH của client, y như `studentId`: action phải tra lại con này có
   * thật thuộc lead của đơn không. Đây là quan hệ TIỀN ("khoản này của con nào") nên
   * không bao giờ tin thẳng.
   *
   * ⚠️ LOẠI TRỪ NHAU với `studentId` — refine ở cuối schema chặn ca khai cả hai. Một dòng
   * trỏ về MỘT đứa trẻ; giữ hai khoá cùng lúc là mở đường cho hai câu trả lời khác nhau
   * cho cùng một câu hỏi, và câu trả lời sai không ném lỗi ở đâu cả.
   */
  leadChildId: z.string().min(1).optional().nullable(),
  /**
   * CÁC KHOẢN GIẢM CỦA RIÊNG DÒNG NÀY (15/09/2026 — "làm flex, 1 đơn áp nhiều giảm giá").
   *
   * Mảng, theo thứ tự người bán gõ. Mỗi khoản là MỘT ưu đãi có tên riêng (anh chị em
   * học cùng · đóng sớm cả khoá · học bổng), vì gộp ba thứ vào một ô là mất tên của
   * từng khoản — thứ kế toán sẽ hỏi sáu tháng sau.
   *
   * Server TÍNH LẠI toàn bộ bằng `lib/orders/giam-gia-dong.ts` và KHÔNG tin số client
   * gửi: đây là phép trừ mà CẢ HAI VẾ đều do client khai (`unitPrice` và phần giảm).
   *
   * ⚠️ Giảm giá KHÔNG được biểu diễn bằng cách hạ `unitPrice`. `lib/orders/price-guard.ts`
   * so `unitPrice` với giá niêm yết để phát hiện đơn bán lệch; hạ đơn giá là làm mù
   * cổng đó (xem mục (c) ở đầu tệp ấy).
   */
  discounts: z
    .array(
      z.object({
        kieu: z.enum(["SO_TIEN", "PHAN_TRAM"]),
        // Trần 100 CHỈ áp cho %; số tiền để `tienDong` kẹp theo tạm tính của dòng —
        // chặn ở đây bằng một con số cứng là đoán hộ giá bán.
        giaTri: z.number().int().min(1),
        lyDo: z.string().max(1000).optional().nullable(),
        /**
         * LOẠI ưu đãi — nhãn có cấu trúc [PHIÊN E, 21/09/2026]. Xem `LOAI_GIAM`.
         *
         * ⚠️ `optional().nullable()` là CHỦ ĐÍCH, không phải quên: chủ dự án chốt chỉ áp
         * cho ưu đãi tạo mới, không đoán ngược dữ liệu cũ, và không chặn sale lưu đơn vì
         * một nhãn thống kê. Đổi lại nhãn này KHÔNG đủ tin để đếm.
         *
         * ⚠️ Danh sách lấy từ `MA_LOAI_GIAM`, KHÔNG gõ lại chuỗi ở đây — gõ lại là hai
         * danh sách sẵn sàng lệch nhau, và cái lệch sẽ im lặng (zod từ chối một mã mà
         * form vừa cho chọn).
         */
        loai: z.enum(MA_LOAI_GIAM as unknown as [string, ...string[]]).optional().nullable(),
        /**
         * `Voucher.id` khi khoản này đến TỪ MỘT CHƯƠNG TRÌNH khuyến mãi [28/09/2026].
         *
         * 🔴 ĐÂY LÀ THỨ DUY NHẤT CỦA KHUYẾN MÃI MÀ SERVER NHẬN TỪ CLIENT. Số tiền, phần
         * trăm, trần tiền và câu giải trình đều được server TÍNH LẠI từ DB
         * (`docMaTheoId` → `khaiGiamTuMa`); `kieu`/`giaTri` client gửi kèm bị GHI ĐÈ.
         *
         * Vì sao không nhận số: nhận cả mã lẫn số là để client cầm cả hai vế — gửi
         * `voucherId` của chương trình 10% kèm `giaTri: 90` thì đơn ra 10% giá gốc mà
         * không cổng nào thấy gì bất thường. Cùng cái bẫy đã ghi ở
         * `lib/orders/hinh-thuc-lop.ts` cho `soBuoi`.
         *
         * ⚠️ KHÔNG có trường `tranTien` ở đây, và đó là chủ đích: trần tiền là thuộc
         * tính của CHƯƠNG TRÌNH, client không được quyền khai. Thêm nó vào schema là mở
         * đúng cái lỗ vừa bịt.
         *
         * Chuỗi RỖNG = "đang ở chế độ chương trình nhưng chưa chọn mã" ⇒ TỪ CHỐI ở
         * action (không phải ở đây: thông báo phải nói được DÒNG nào, KHOẢN nào).
         */
        voucherId: z.string().max(64).optional().nullable(),
      }).refine((k) => k.kieu !== "PHAN_TRAM" || k.giaTri <= 100, {
        message: "Giảm theo % phải trong khoảng 1–100",
        path: ["giaTri"],
      }),
    )
    // Trần khai ở `giam-gia-dong.ts` — cùng một con số cho cả form lẫn server.
    .max(TRAN_KHOAN_GIAM_MOI_DONG, `Mỗi dòng tối đa ${TRAN_KHOAN_GIAM_MOI_DONG} khoản giảm`)
    .optional()
    .default([]),

  // ── CÁCH KHAI CŨ (một khoản/dòng): ĐÃ ĐÓNG [15/09/2026 chiều] ────────────────
  //
  // Giữ trong schema để TỪ CHỐI CHO RA TIẾNG. Bỏ hẳn thì Zod lặng lẽ vứt khoá lạ, và
  // một người gọi viết theo bản sáng nay sẽ thấy đơn tạo THÀNH CÔNG với giá nguyên —
  // mất tiền mà không lỗi nào báo. Cột DB `OrderItem.discountAmount` vẫn còn và vẫn là
  // TỔNG của dòng; chỉ đường NHẬP là đổi.
  discountAmount: z.number().int().min(0).default(0),
  discountPercent: z.number().int().min(1).max(100).optional().nullable(),
  discountReason: z.string().max(1000).optional().nullable(),
  // Metadata cho COURSE_ENROLLMENT (chứa courseId vì Enrollment chưa tồn tại)
  /**
   * Json tự do — nhưng HAI khoá dưới đây có nghĩa và phải đúng khuôn:
   * `coachFormat` (hình thức lớp, SR.QD.219 Điều 5) và `soBuoi`.
   *
   * ⚠️ Siết KIỂU ở đây KHÔNG làm GIÁ TRỊ đáng tin — `coachFormat` vẫn là thứ client tự
   * khai, và không có gì trên server suy ngược ra được (model `Class` không có cột hình
   * thức lớp). Đó chính là lý do hình thức lớp KHÔNG được đi vào `giaNiemYet` của cổng
   * soát giá; xem đầu `lib/orders/hinh-thuc-lop.ts`.
   *
   * ⚠️ Và nó CHỈ phủ đường `createOrderManualAction`. Ba đường tạo OrderItem còn lại
   * (`lib/crm/backfill-order.ts`, `lib/finance/ghi-giao-dich-cu.ts`, convert) ghi thẳng
   * bằng Prisma, không qua schema này.
   */
  metadata: z
    .record(z.string(), z.unknown())
    .refine(
      (m) =>
        m.coachFormat === undefined ||
        (typeof m.coachFormat === "string" &&
          ["GROUP", "ONE_ON_ONE", "ONE_ON_TWO", "ONE_ON_FOUR"].includes(m.coachFormat)),
      { message: "Hình thức lớp không hợp lệ" },
    )
    .refine(
      (m) =>
        m.soBuoi === undefined ||
        (typeof m.soBuoi === "number" && Number.isInteger(m.soBuoi) && m.soBuoi > 0 && m.soBuoi <= 500),
      { message: "Số buổi phải là số nguyên từ 1 đến 500" },
    )
    .optional()
    .nullable(),
})
  // Cơ chế DUYỆT giảm giá đã gỡ 14/09/2026 — GIẢI TRÌNH thì GIỮ, và nay nó theo TỪNG
  // KHOẢN. Ba ưu đãi chung một ô giải trình là mất đúng thứ vừa cất công tách ra.
  .refine((it) => (it.discounts ?? []).every((k) => !!k.lyDo?.trim()), {
    message: "Mỗi khoản giảm giá phải có giải trình riêng",
    path: ["discounts"],
  })
  // Cách khai CŨ bị từ chối cho ra tiếng — xem chú thích ở ba trường đó.
  .refine(
    (it) => !((it.discountPercent ?? 0) > 0 || it.discountAmount > 0),
    {
      message:
        "Giảm giá nay khai thành DANH SÁCH ở items[].discounts — không dùng discountAmount/discountPercent của dòng nữa",
      path: ["discounts"],
    },
  )
  // MỘT DÒNG — MỘT ĐỨA TRẺ [16/09/2026]. `studentId` (đã có hồ sơ) và `leadChildId` (con
  // lead chưa chốt) loại trừ nhau. Cho khai cả hai là để ngỏ hai câu trả lời khác nhau cho
  // "khoản này của ai", và cái sai sẽ không ném lỗi ở đâu — nó chỉ làm hoàn tiền, ZNS học
  // phí và cổng phụ huynh nói sai tên một đứa trẻ.
  .refine((it) => !(it.studentId?.trim() && it.leadChildId?.trim()), {
    message:
      "Một dòng chỉ trỏ về MỘT học viên: khai studentId (đã có hồ sơ) HOẶC leadChildId (con lead chưa chốt), không cả hai",
    path: ["leadChildId"],
  });

export const orderCreateManualSchema = z.object({
  type: z.nativeEnum(OrderType),
  status: z.nativeEnum(OrderStatus).default("PENDING_PAYMENT"),

  // Customer snapshot
  customerName: z.string().min(2).max(200),
  customerPhone: phoneVn,
  // O2 — email dùng gửi xác nhận/biên nhận.
  // AUTH-SĐT P5: KHÔNG còn bắt buộc. Xác nhận/nhắc nợ nay đi Zalo ZNS theo
  // `customerPhone` (đằng nào cũng bắt buộc), email chỉ là kênh dự phòng — giữ
  // bắt buộc thì mọi khách không có email lại không lên được đơn.
  customerEmail: z
    .string()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal(""))
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null)),
  // O2 — CCCD/CMND người mua (snapshot trên đơn): 9 hoặc 12 chữ số, optional.
  customerCccd: z
    .string()
    .regex(/^\d{9}$|^\d{12}$/, "CCCD phải gồm 9 hoặc 12 chữ số")
    .optional()
    .or(z.literal(""))
    .nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
  customerWard: z.string().max(100).optional().nullable(),
  customerCity: z.string().max(100).optional().nullable(),

  // Optional links
  studentId: z.string().min(1).optional().nullable(),
  leadId: z.string().min(1).optional().nullable(),
  // N-2 · quyết định B4 (24/08/2026) — MỘT ĐƠN – MỘT CON. Con nào của phiếu `leadId` sinh
  // ra đơn này. Bỏ trống được: phiếu đúng 1 con thì server tự suy, phiếu nhiều con mà
  // không chọn thì đơn nằm ở nhóm "chưa quy được về con" (KHÔNG đoán — xem
  // `lib/orders/lead-child-link.ts`). Quyền sở hữu con do server kiểm, không tin client.
  leadChildId: z.string().min(1).optional().nullable(),
  centerId: z.string().min(1).optional().nullable(),
  paymentMethodId: z.string().min(1),

  // Items (v1 = 1 item required, schema allows up to 20)
  items: z.array(orderItemSchema).min(1, "Phải có ít nhất 1 sản phẩm").max(20),

  // ── GIẢM GIÁ CẤP ĐƠN: ĐÃ ĐÓNG [15/09/2026] ─────────────────────────────────
  //
  // Chủ dự án chốt giảm giá khai theo TỪNG DÒNG. Ba trường dưới GIỮ LẠI trong schema
  // cố ý, nhưng chỉ để **TỪ CHỐI cho ra tiếng** (refine ở cuối): bỏ hẳn khỏi schema
  // thì Zod lặng lẽ bỏ qua khoá lạ, và một người gọi cũ gửi `discountAmount: 500000`
  // sẽ thấy đơn tạo thành công với giá NGUYÊN — mất 500.000đ mà không lỗi nào báo.
  // Cột `Order.discountAmount` vẫn còn và vẫn là TỔNG, nhưng nay chỉ có một nguồn
  // sinh ra nó: Σ các dòng (`lib/orders/giam-gia-dong.ts`).
  discountAmount: z.number().int().min(0).default(0),
  discountPercent: z.number().int().min(1).max(100).optional().nullable(),
  discountReason: z.string().max(1000).optional().nullable(),
  shippingFee: z.number().int().min(0).default(0),

  /**
   * KẾ HOẠCH THANH TOÁN LẬP NGAY LÚC TẠO ĐƠN [15/09/2026].
   *
   * Chủ dự án: *"đưa phần kế hoạch thanh toán ra trang tạo đơn hàng luôn đi, đặt ở dưới
   * session khoá học và lấy số tiền cần thanh toán ở phần khoá học sau khi hoàn thành các
   * tuỳ chọn của đơn hàng khoá học luôn"*.
   *
   * Rỗng/thiếu ⇒ đơn ra đời KHÔNG có kế hoạch, đúng hành vi cũ: một phiếu "thu toàn đơn"
   * (`ensureFullOrderRequest`) và người bán lập kế hoạch sau ở trang chi tiết. Các đường
   * tạo đơn khác (convert-lead, backfill) không gửi khoá này nên không đổi gì.
   *
   * ⚠️ CỐ Ý KHÔNG kiểm Σ ở đây. Tổng phải khớp `Order.totalAmount` — con số mà SERVER tính
   * từ các dòng (`tienDon`), không phải con số nào trong payload này. Kiểm ở đây là so hai
   * vế đều do client khai: gửi kế hoạch Σ = 1đ cho một đơn 10.000.000đ vẫn "hợp lệ". Cổng
   * thật là `kiemKeHoachDot` bên trong `recordInstallmentPlan`, nơi vế phải đọc từ DB.
   */
  keHoachDot: z
    .array(
      z.object({
        amount: z.number().int().min(0),
        daThu: z.boolean(),
        /** `yyyy-mm-dd` của `<input type="date">`; đợt đã thu gửi null. */
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày hẹn đóng phải dạng yyyy-mm-dd")
          .optional()
          .nullable(),
        reminderDays: z.number().int().min(0).max(365).optional().nullable(),
        /**
         * Dòng này là phiếu CỌC, không phải một đợt học phí.
         *
         * ⚠️ CHỈ DÙNG ĐỂ ĐẾM, chưa lưu xuống DB — `OrderInstallment` không có cột cho nó
         * (hạn chế đã biết, ghi ở `order-payment-section.tsx`). Nhưng ngưỡng duyệt cần
         * phân biệt: chủ dự án chốt 22/09 là "4 đợt + cọc", tức cọc nằm NGOÀI trần. Không
         * có cờ này thì kế hoạch hợp lệ "cọc + 4 đợt" bị đếm thành 5 và rơi vào hàng chờ
         * duyệt — một cổng chặn đúng thứ nó được dựng ra để cho qua.
         *
         * `.optional()` vì đường gọi cũ (backfill, convert) không gửi; thiếu ⇒ coi như
         * không phải cọc, tức đếm như một đợt — phía AN TOÀN (thà bắt duyệt nhầm còn hơn
         * cho qua nhầm).
         */
        laCoc: z.boolean().optional(),
      }),
    )
    .max(TRAN_SO_DOT, `Kế hoạch tối đa ${TRAN_SO_DOT} đợt`)
    .optional()
    .nullable(),

  // Notes
  customerNote: z.string().max(2000).optional().nullable(),
  internalNote: z.string().max(2000).optional().nullable(),
})
  // Giảm giá CẤP ĐƠN bị từ chối cho ra tiếng — xem chú thích ở ba trường trên.
  .refine((d) => !((d.discountPercent ?? 0) > 0 || d.discountAmount > 0), {
    message:
      "Giảm giá nay khai theo TỪNG DÒNG, không khai ở cấp đơn — đặt vào items[].discountAmount / discountPercent",
    path: ["discountAmount"],
  });

export const orderStatusChangeSchema = z.object({
  toStatus: z.nativeEnum(OrderStatus),
  reason: z.string().max(500).optional().nullable(),
});

export type OrderCreateManualInput = z.infer<typeof orderCreateManualSchema>;
