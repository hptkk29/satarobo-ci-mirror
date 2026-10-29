// lib/finance/payment.ensure.test.ts — K3 (PAY-DEDUP): bất biến "1 khoản = 1 dòng ledger".
// ensureOrderPaymentRecorded idempotent theo (orderId, soDot) qua marker trong note;
// gọi lại KHÔNG tạo Payment trùng; ghi nhận tiền tự đẩy lead AWAITING_DECISION → REGISTERED.
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { ensureOrderPaymentRecorded, maybeAdvanceLeadToRegistered } from "./payment";

type PaymentRow = {
  id: string;
  orderId: string;
  note: string;
  amount: number;
  deletedAt: Date | null;
  centerId: string | null;
  /** 06/09 — khoản thu tự động PHẢI gắn ghi danh, kẻo công nợ phụ huynh không tụt. */
  enrollmentId: string | null;
};

type State = {
  payments: PaymentRow[];
  leadStatus: string;
  leadCenterId: string | null;
  /** GĐ1 — sổ trạng thái chép cột này của lead, không tra ngược từ centerId. */
  leadOrgUnitId: string | null;
  /** GĐ1 — các dòng LeadStatusHistory đã ghi. */
  statusHistory: unknown[];
  activities: unknown[];
  audits: unknown[];
  /** Học viên của đơn (null = đơn chưa gắn học viên). */
  orderStudentId: string | null;
  /**
   * 15/09/2026 — ĐỔI HÌNH DẠNG. Trước đây chỉ là `enrollmentIds: string[]`, khớp với bản
   * 06/09 vốn chỉ hỏi "học viên của đơn có đúng một ghi danh không".
   *
   * Bản đó chưa từng chạy trong luồng lead: đơn lập từ `/orders/new?leadId=…` để
   * `Order.studentId` NULL, nên nhánh ấy không bao giờ vào. Luật mới khớp theo DÒNG ĐƠN
   * (`studentId`, rồi `metadata.courseId`) nên fixture phải mang đủ những thứ đó — fixture
   * thiếu trường là fixture kiểm được ít hơn nó tỏ ra.
   */
  orderCustomerPhone: string | null;
  orderItems: { studentId: string | null; courseId: string | null; thanhTien: number }[];
  /** Học viên tra theo SĐT phụ huynh của đơn. */
  studentsCuaPhuHuynh: string[];
  ghiDanh: { id: string; studentId: string; courseId: string | null; finalPrice: number }[];
};

// Trạng thái phía sale dựng bằng hằng — lưới trục B (`ghi-nhan.test.ts`) quét cả tệp test.
const DA_GHI_NHAN = "RECORDED";

/** Tx giả in-memory — mô phỏng đúng phần ensureOrderPaymentRecorded chạm tới. */
function fakeTx(state: State): Prisma.TransactionClient {
  return {
    payment: {
      findFirst: async (args: { where: { orderId: string; note: { contains: string } } }) =>
        state.payments.find(
          (p) =>
            p.orderId === args.where.orderId &&
            p.deletedAt === null &&
            p.note.includes(args.where.note.contains),
        ) ?? null,
      create: async (args: {
        data: {
          orderId: string;
          note: string;
          amount: number;
          centerId: string | null;
          enrollmentId: string | null;
        };
      }) => {
        const row: PaymentRow = {
          id: `p${state.payments.length + 1}`,
          orderId: args.data.orderId,
          note: args.data.note,
          amount: args.data.amount,
          centerId: args.data.centerId,
          enrollmentId: args.data.enrollmentId ?? null,
          deletedAt: null,
        };
        state.payments.push(row);
        return { id: row.id };
      },
      // ── Đường GẮN GHI DANH SAU CONVERT (15/09/2026) ───────────────────────
      // GĐ 8b — `napGanGhiDanhCuaDon` đọc MỌI dòng còn sống của đơn (tính số RÒNG) rồi tự lọc khoản
      // chưa gắn ⇒ trả đủ cột mà dòng thật mang (dòng do `ensureOrderPaymentRecorded` tạo: RECORDED /
      // PENDING / PAYMENT, không trỏ `adjustmentOfId`).
      findMany: async (args: { where: { orderId: string } }) =>
        state.payments
          .filter((p) => p.orderId === args.where.orderId && p.deletedAt === null)
          .map((p) => ({
            ...p,
            paymentType: "PAYMENT",
            saleStatus: DA_GHI_NHAN,
            accountantStatus: "PENDING",
            adjustmentOfId: null,
            method: "BANK_TRANSFER",
            paidDate: new Date("2026-09-15T03:00:00Z"),
            evidenceUrl: null,
            recordedById: null,
          })),
      // GĐ 8b — phép gắn đầu tiên là `updateMany` CÓ ĐIỀU KIỆN; tx giả tôn trọng đúng điều kiện ấy.
      updateMany: async (args: {
        where: { id: string; enrollmentId: null; amount: number; deletedAt: null };
        data: { enrollmentId: string; amount: number };
      }) => {
        const row = state.payments.find(
          (p) => p.id === args.where.id && p.enrollmentId === null && p.amount === args.where.amount && p.deletedAt === null,
        );
        if (!row) return { count: 0 };
        row.enrollmentId = args.data.enrollmentId;
        row.amount = args.data.amount;
        return { count: 1 };
      },
    },
    order: {
      findUnique: async () => ({
        studentId: state.orderStudentId,
        customerPhone: state.orderCustomerPhone,
        items: state.orderItems.map((it) => ({
          studentId: it.studentId,
          totalPrice: it.thanhTien,
          discountAmount: 0,
          metadata: it.courseId ? { courseId: it.courseId } : null,
        })),
      }),
    },
    student: {
      findMany: async () => state.studentsCuaPhuHuynh.map((id) => ({ id })),
    },
    // Cổng hoá đơn (docs/ke-toan-hoa-don/PLAN.md §5): gắn ghi danh hỏi "khoản nào đang nằm trong
    // hoá đơn". Các ca ở đây chưa có hoá đơn nào ⇒ rỗng. Ca có hoá đơn: tests/finance/hoa-don-khoa.test.ts.
    hoaDonKhoan: {
      findMany: async () => [],
    },
    enrollment: {
      findMany: async () =>
        state.ghiDanh.map((g) => ({
          id: g.id,
          studentId: g.studentId,
          finalPrice: g.finalPrice,
          centerId: "c1",
          courseId: g.courseId,
          class: { courseId: g.courseId },
        })),
    },
    lead: {
      findUnique: async () => ({
        centerId: state.leadCenterId,
        // GĐ1 — `recordLeadStatusChange` đọc thêm orgUnitId để ghi kép.
        orgUnitId: state.leadOrgUnitId,
      }),
      updateMany: async (args: { where: { status: string } }) => {
        if (state.leadStatus !== args.where.status) return { count: 0 };
        state.leadStatus = "DA_DANG_KY";
        return { count: 1 };
      },
      // GĐ1 — dời mốc `statusChangedAt`; test chỉ cần nó không nổ.
      update: async (args: { data: unknown }) => args.data,
    },
    // GĐ1 — sổ đổi trạng thái lead.
    leadStatusHistory: {
      create: async (args: { data: unknown }) => {
        state.statusHistory.push(args.data);
        return args.data;
      },
    },
    leadActivity: {
      create: async (args: { data: unknown }) => {
        state.activities.push(args.data);
        return args.data;
      },
    },
    auditLog: {
      create: async (args: { data: unknown }) => {
        state.audits.push(args.data);
        return args.data;
      },
    },
  } as unknown as Prisma.TransactionClient;
}

const baseState = (): State => ({
  payments: [],
  leadStatus: "CHO_QUYET_DINH",
  leadCenterId: "center-lead",
  leadOrgUnitId: "ou-lead",
  statusHistory: [],
  activities: [],
  audits: [],
  orderStudentId: "hv1",
  orderCustomerPhone: "0905123456",
  orderItems: [{ studentId: "hv1", courseId: "khoa-1", thanhTien: 6_000_000 }],
  studentsCuaPhuHuynh: ["hv1"],
  ghiDanh: [{ id: "e1", studentId: "hv1", courseId: "khoa-1", finalPrice: 6_000_000 }],
});

describe("ensureOrderPaymentRecorded (K3 — 1 khoản = 1 dòng ledger)", () => {
  it("[K3-DoD] gọi 2 lần cùng (orderId, đợt 1) → chỉ tạo 1 Payment, lần 2 created=false", async () => {
    const state = baseState();
    const tx = fakeTx(state);
    const params = { orderId: "o1", soDot: 1, amount: 6_000_000, leadId: "l1", centerId: "c1", actor: { id: "u1" } };

    const r1 = await ensureOrderPaymentRecorded(tx, params);
    const r2 = await ensureOrderPaymentRecorded(tx, params);

    expect(r1).toMatchObject({ ok: true, created: true });
    expect(r2).toMatchObject({ ok: true, created: false, paymentId: (r1 as { paymentId: string }).paymentId });
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]!.note).toContain("[auto:order-installment:dot1]");
  });

  it("[K3-DoD] marker khác nhau theo nguồn: confirm-full ≠ đợt 1 ≠ đợt 2 (không đè nhầm nhau)", async () => {
    const state = baseState();
    const tx = fakeTx(state);
    await ensureOrderPaymentRecorded(tx, { orderId: "o1", soDot: null, amount: 1, actor: { id: "u1" } });
    await ensureOrderPaymentRecorded(tx, { orderId: "o1", soDot: 1, amount: 1, actor: { id: "u1" } });
    await ensureOrderPaymentRecorded(tx, { orderId: "o1", soDot: 2, amount: 1, actor: { id: "u1" } });
    expect(state.payments.map((p) => /\[auto:[^\]]+\]/.exec(p.note)?.[0])).toEqual([
      "[auto:order-confirm]",
      "[auto:order-installment:dot1]",
      "[auto:order-installment:dot2]",
    ]);
  });

  it("[K3] sau điều chỉnh (khoản cũ soft-deleted) → gọi lại TẠO khoản mới, không hồi sinh khoản cũ", async () => {
    const state = baseState();
    const tx = fakeTx(state);
    await ensureOrderPaymentRecorded(tx, { orderId: "o1", soDot: 1, amount: 6_000_000, centerId: "c1", actor: { id: "u1" } });
    // recordInstallmentPlan lần 2 soft-delete mọi [auto:*] trước khi dựng lại:
    state.payments[0]!.deletedAt = new Date();
    const r = await ensureOrderPaymentRecorded(tx, { orderId: "o1", soDot: 1, amount: 5_000_000, centerId: "c1", actor: { id: "u1" } });
    expect(r).toMatchObject({ ok: true, created: true });
    const active = state.payments.filter((p) => p.deletedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.amount).toBe(5_000_000); // tổng active = 5tr, không phải 11tr
  });

  it("amount = 0 (đợt 2 rỗng) → no-op thành công, không tạo dòng", async () => {
    const state = baseState();
    const r = await ensureOrderPaymentRecorded(fakeTx(state), { orderId: "o1", soDot: 2, amount: 0, actor: { id: "u1" } });
    expect(r).toMatchObject({ ok: true, created: false, paymentId: null });
    expect(state.payments).toHaveLength(0);
  });

  it("suy centerId: thiếu order.centerId → lấy từ lead; thiếu cả hai → actor.centerId", async () => {
    const viaLead = baseState();
    await ensureOrderPaymentRecorded(fakeTx(viaLead), { orderId: "o1", soDot: 1, amount: 1, leadId: "l1", actor: { id: "u1", centerId: "center-actor" } });
    expect(viaLead.payments[0]!.centerId).toBe("center-lead");

    const viaActor = baseState();
    viaActor.leadCenterId = null;
    await ensureOrderPaymentRecorded(fakeTx(viaActor), { orderId: "o1", soDot: 1, amount: 1, leadId: "l1", actor: { id: "u1", centerId: "center-actor" } });
    expect(viaActor.payments[0]!.centerId).toBe("center-actor");
  });

  it("[PH-2] ghi nhận tiền → lead AWAITING_DECISION tự lên REGISTERED + có activity; status khác giữ nguyên", async () => {
    const state = baseState();
    await ensureOrderPaymentRecorded(fakeTx(state), { orderId: "o1", soDot: 1, amount: 1, leadId: "l1", actor: { id: "u1" } });
    expect(state.leadStatus).toBe("DA_DANG_KY");
    expect(state.activities).toHaveLength(1);

    const converted = baseState();
    converted.leadStatus = "CONVERTED";
    const moved = await maybeAdvanceLeadToRegistered(fakeTx(converted), { leadId: "l1", actor: { id: "u1" } });
    expect(moved).toBe(false);
    expect(converted.leadStatus).toBe("CONVERTED"); // không lùi/đụng status khác
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ensureOrderPaymentRecorded — gắn ghi danh cho khoản thu tự động", () => {
  it("học viên có ĐÚNG MỘT ghi danh → khoản thu gắn thẳng vào đó", async () => {
    // Vì sao quan trọng: cổng phụ huynh cộng tiền theo quan hệ `Enrollment.payments`.
    // `enrollmentId = null` thì dù kế toán đã xác nhận, công nợ vẫn không tụt — phụ
    // huynh đóng đợt 2 xong mở portal ra vẫn thấy nợ nguyên.
    const state = baseState();
    const r = await ensureOrderPaymentRecorded(fakeTx(state), {
      orderId: "o1",
      soDot: 2,
      amount: 3_000_000,
      leadId: "l1",
      centerId: "c1",
      actor: { id: "u1" },
    });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(state.payments[0]!.enrollmentId).toBe("e1");
  });

  it("PH NHIỀU CON, đơn chỉ bán cho MỘT con → gắn đúng con đó, KHÔNG rải sang con kia", async () => {
    // ⚠️ CA NÀY THAY CA CŨ "nhiều ghi danh → để trống, KHÔNG đoán bừa" [15/09/2026].
    //
    // Ca cũ ghim đúng bản 06/09: chỉ gắn khi học viên CỦA ĐƠN có đúng một ghi danh, còn
    // lại để trống. Nguyên tắc "thà trống hơn gắn sai" là đúng và được GIỮ — nhưng "để
    // trống" hoá ra không hề vô hại: `confirmPayment` cần `enrollmentId`, nên khoản trống
    // là khoản kế toán KHÔNG BAO GIỜ chốt được, màn hiện "Chờ convert" vĩnh viễn. Đo
    // 15/09 trên hai đơn thật: 13.920.000đ / 22.080.000đ (63%) kẹt như vậy.
    //
    // Nay có cách gắn KHÔNG PHẢI đoán: dòng đơn nói rõ học viên, hoặc nói khoá học mà em
    // đó đang học. Mơ hồ thật thì vẫn để trống (ca dưới).
    const state = {
      ...baseState(),
      orderStudentId: null, // đơn từ lead: cột này NULL
      orderItems: [{ studentId: null, courseId: "khoa-1", thanhTien: 6_000_000 }],
      studentsCuaPhuHuynh: ["hv1", "hv2"],
      ghiDanh: [
        { id: "e1", studentId: "hv1", courseId: "khoa-1", finalPrice: 6_000_000 },
        { id: "e2", studentId: "hv2", courseId: "khoa-2", finalPrice: 9_000_000 },
      ],
    };
    await ensureOrderPaymentRecorded(fakeTx(state), {
      orderId: "o1",
      soDot: 1,
      amount: 1_000_000,
      leadId: "l1",
      centerId: "c1",
      actor: { id: "u1" },
    });
    const conSong = state.payments.filter((p) => p.deletedAt === null);
    expect(conSong).toHaveLength(1);
    expect(conSong[0]!.enrollmentId).toBe("e1");
    expect(conSong[0]!.amount).toBe(1_000_000); // KHÔNG bị xé cho e2
  });

  it("MƠ HỒ THẬT (dòng đơn không nói học viên lẫn khoá) → để trống, KHÔNG đoán bừa", async () => {
    // Nguyên tắc cũ giữ nguyên ở đúng chỗ của nó: gắn bừa còn tệ hơn để trống. Hàm chia
    // có "đường lui" chia đều cho mọi ghi danh, nhưng đường đó CHỈ dùng lúc convert —
    // ngoài convert thì bỏ qua.
    const state = {
      ...baseState(),
      orderStudentId: null,
      orderItems: [{ studentId: null, courseId: null, thanhTien: 6_000_000 }],
      studentsCuaPhuHuynh: ["hv1", "hv2"],
      ghiDanh: [
        { id: "e1", studentId: "hv1", courseId: "khoa-1", finalPrice: 6_000_000 },
        { id: "e2", studentId: "hv2", courseId: "khoa-2", finalPrice: 9_000_000 },
      ],
    };
    await ensureOrderPaymentRecorded(fakeTx(state), {
      orderId: "o1",
      soDot: 1,
      amount: 1_000_000,
      leadId: "l1",
      centerId: "c1",
      actor: { id: "u1" },
    });
    expect(state.payments[0]!.enrollmentId).toBeNull();
  });

  it("chưa có ghi danh nào (lead chưa convert) → để trống, không nổ", async () => {
    const state = { ...baseState(), orderStudentId: null, studentsCuaPhuHuynh: [], ghiDanh: [] };
    const r = await ensureOrderPaymentRecorded(fakeTx(state), {
      orderId: "o1",
      soDot: 1,
      amount: 1_000_000,
      leadId: "l1",
      centerId: "c1",
      actor: { id: "u1" },
    });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(state.payments[0]!.enrollmentId).toBeNull();
  });
});
