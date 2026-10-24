// tests/finance/webhook-tra-don.test.ts — TẦNG ĐỐI KHỚP: đơn nào ĐƯỢC nhận tiền tự động.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chạy bộ này:  pnpm test:finance-db      (CI: job "Chat DB invariants", bước 6)
// `pnpm test:unit` trần sẽ SKIP — thiếu `ALLOW_DB_RESET=1`, xem tests/_helpers/db-gate.ts.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng và tự dọn theo tiền tố id, nên chạy được
// trên DB đang có dữ liệu làm việc.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI LÀ TEST CHẠM DB — không thay được bằng lưới ghim mã nguồn
//
// Luật cần khoá là *"đơn DRAFT/CANCELLED/REFUNDED/xoá-mềm KHÔNG phải đích rót tiền"*, và nó
// được diễn đạt bằng một mệnh đề `where` của Prisma. Lưới ghim mã nguồn ĐẾM được rằng chuỗi
// `locDonNhanTien()` có mặt ở ba nhánh, nhưng KHÔNG biết mệnh đề ấy có lọc thật hay không —
// y hệt bài học của PHIÊN A, nơi một dấu `&&` đổi thành `||` lọt qua toàn bộ lưới văn bản.
//
// Ở đây còn tệ hơn một bậc: `where` là DỮ LIỆU, không phải biểu thức. Viết nhầm tên cột
// (`state` thay `status`) thì Prisma ném lúc CHẠY, không phải lúc biên dịch — và không có
// một ca nào chạm DB thì chẳng bao giờ có "lúc chạy".
//
// ─────────────────────────────────────────────────────────────────────────────
// LỊCH SỬ: PHIÊN A vá nhánh (a) `matchKey` và (b) `QrSession`, BỎ SÓT (c) `orderCode` —
// nhánh của nội dung CK đời cũ `ORD…D<số>`, tức nhánh dữ liệu thật đi qua nhiều nhất. Bộ này
// viết ở PHIÊN B, cùng lúc với bản vá (c)/(d).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { resolvePaymentTargetDetailed } from "@/lib/payments/payos-ingest";

if (!RUN_DB_TESTS) console.warn(`[WTD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const TIEN_TO = "fx-wtd-";

/**
 * Mã đơn PHẢI đúng khuôn `ORD-YYMMDD-NNNNNN` — `extractOrderCode` bóc theo `/ORD(\d{12})/`.
 * Phần ngày `269901` là năm 2699: không đụng dữ liệu thật, và nhìn là biết của fixture.
 */
const ma = (n: number) => `ORD-269901-${String(n).padStart(6, "0")}`;
const maTrongMemo = (n: number) => `ORD269901${String(n).padStart(6, "0")}`;

type Ca = {
  n: number;
  ten: string;
  status: OrderStatus;
  xoaMem: boolean;
  /** Có được nhận tiền tự động không. */
  nhan: boolean;
};

const CA: Ca[] = [
  { n: 1, ten: "PENDING_PAYMENT (ĐỐI CHỨNG — phải RA đích)", status: "PENDING_PAYMENT", xoaMem: false, nhan: true },
  { n: 2, ten: "DRAFT — sale đang soạn dở", status: "DRAFT", xoaMem: false, nhan: false },
  { n: 3, ten: "CANCELLED — đơn đã huỷ", status: "CANCELLED", xoaMem: false, nhan: false },
  { n: 4, ten: "REFUNDED — đơn đã hoàn tiền", status: "REFUNDED", xoaMem: false, nhan: false },
  // ⚠️ Ca 5 XANH NHỜ TẦNG BASE, không nhờ `locDonNhanTien()`: `Order` ∈ `SOFT_DELETE_MODELS`
  // nên `lib/db.ts` tự chèn `deletedAt: null` vào mọi câu đọc cấp cao nhất (đã đo bằng cấy lỗi:
  // bỏ vế `deletedAt` khỏi nhánh (c) thì KHÔNG ca nào đỏ). Giữ ca lại vì nó khoá HÀNH VI —
  // "tiền không rơi vào đơn đã xoá" — chứ không khoá một cơ chế cụ thể; ngày ai đó gỡ `Order`
  // khỏi `SOFT_DELETE_MODELS` thì nó đỏ ở đây, đúng lúc cần.
  { n: 5, ten: "xoá mềm (status vẫn PENDING_PAYMENT)", status: "PENDING_PAYMENT", xoaMem: true, nhan: false },
];

const idDon = (n: number) => `${TIEN_TO}don-${n}`;
const idPhieu = (n: number) => `${TIEN_TO}phieu-${n}`;
/** `matchKey` là @unique — nhánh (a) tra bằng SO BẰNG trên chính chuỗi này. */
const khoaKhop = (n: number) => `WTDKEY${String(n).padStart(3, "0")}`;

async function don() {
  await db.paymentRequest.deleteMany({ where: { id: { startsWith: TIEN_TO } } });
  await db.order.deleteMany({ where: { id: { startsWith: TIEN_TO } } });
}

describe.skipIf(!RUN_DB_TESTS)("[WTD] đơn nào được nhận tiền tự động — DB thật", () => {
  beforeAll(async () => {
    await don();
    for (const c of CA) {
      await db.order.create({
        data: {
          id: idDon(c.n),
          code: ma(c.n),
          type: "COURSE",
          status: c.status,
          // ⚠️ SĐT cố ý KHÔNG suy ra được từ nội dung CK bên dưới: nếu nhánh (c) bị bịt mà ca
          // vẫn xanh nhờ nhánh (d) tra theo SĐT thì ca này đo nhầm thứ khác.
          customerName: `Fixture WTD ${c.n}`,
          customerPhone: `09990000${String(c.n).padStart(2, "0")}`,
          totalAmount: 1_000_000,
          deletedAt: c.xoaMem ? new Date("2699-01-01T00:00:00Z") : null,
        },
      });
      await db.paymentRequest.create({
        data: {
          id: idPhieu(c.n),
          orderId: idDon(c.n),
          installmentNo: 1,
          amountDue: 1_000_000,
          matchKey: khoaKhop(c.n),
          status: "PENDING",
          sortOrder: 1,
        },
      });
    }
  });
  afterAll(don);

  // ── Nhánh (a) `matchKey` — phiếu tra thẳng bằng khoá bền ───────────────────
  describe("[WTD-01] nhánh (a) matchKey", () => {
    for (const c of CA) {
      it(`${c.ten} → ${c.nhan ? "RA đích" : "KHÔNG ra đích"}`, async () => {
        const r = await resolvePaymentTargetDetailed({
          description: `${khoaKhop(c.n)} NOP HOC PHI`,
          amount: 1_000_000,
        });
        expect(r.target?.orderId ?? null).toBe(c.nhan ? idDon(c.n) : null);
      });
    }
  });

  // ── Nhánh (c) `orderCode` — nội dung CK đời cũ, nhánh PHIÊN A bỏ sót ───────
  describe("[WTD-02] nhánh (c) mã đơn trong nội dung CK", () => {
    for (const c of CA) {
      it(`${c.ten} → ${c.nhan ? "RA đích" : "KHÔNG ra đích"}`, async () => {
        const r = await resolvePaymentTargetDetailed({
          description: `${maTrongMemo(c.n)} NOP HOC PHI`,
          amount: 1_000_000,
        });
        expect(r.target?.orderId ?? null).toBe(c.nhan ? idDon(c.n) : null);
      });
    }
  });

  // ── Phiếu VOID: đơn TỐT, nhưng đợt đã huỷ thì không còn là đích ────────────
  it("[WTD-03] đơn tốt + phiếu VOID → KHÔNG ra đích (huỷ đợt xong QR cũ hết ăn)", async () => {
    await db.paymentRequest.update({ where: { id: idPhieu(1) }, data: { status: "VOID" } });
    try {
      const a = await resolvePaymentTargetDetailed({
        description: `${khoaKhop(1)} NOP HOC PHI`,
        amount: 1_000_000,
      });
      expect(a.target).toBeNull();
      // Nhánh (c) lọc phiếu theo `status in (PENDING, PARTIAL)` nên cũng phải trượt.
      const c = await resolvePaymentTargetDetailed({
        description: `${maTrongMemo(1)} NOP HOC PHI`,
        amount: 1_000_000,
      });
      expect(c.target).toBeNull();
    } finally {
      await db.paymentRequest.update({ where: { id: idPhieu(1) }, data: { status: "PENDING" } });
    }
  });
});
