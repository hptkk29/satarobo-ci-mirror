// lib/payments/dung-sai-lam-tron.test.ts — TEST ĐỎ ghim 3 lỗi ĐO ĐƯỢC 13/09/2026.
//
// Ba lỗi dưới đây KHÔNG nằm trong danh sách R-01/R-02/R-04/R-13 của kế hoạch PHA 1.
// Chúng lộ ra khi phản biện đối kháng các thiết kế vá, và cả ba đều nặng hơn — một
// cái đang làm MẤT TIỀN THẬT trên đường đang chạy.
//
// ⚠️ MỌI TEST Ở ĐÂY DÙNG `it.fails` CÓ CHỦ ĐÍCH — chúng mô tả hành vi ĐÚNG mà mã
// nguồn hôm nay KHÔNG có. `it.fails` xanh khi thân test NÉM, nên:
//   · hôm nay: xanh (bug còn đó) ⇒ CI không đỏ, không chặn merge của người khác
//   · sau khi vá: test này ĐỎ ⇒ người vá BUỘC phải đổi `it.fails` thành `it`
// Đó là cái chốt: bug được ghim thành mã, và không ai vá xong mà quên gỡ ghim.
// Repo đã dùng cơ chế này (`pnpm test:unit` báo "11 expected fail").
//
// THUẦN — không DB. Toàn bộ chỉ gọi `deriveStatus`, là hàm quyết định trạng thái
// phiếu thu, và so chuỗi marker.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { deriveStatus } from "./allocation";
// 13/09/2026 — [DS-03] ĐÃ VÁ: test nay gọi SỔ ĐĂNG KÝ THẬT thay vì bản sao cục bộ.
import {
  AUTO_ORDER_CONFIRM_MARKER,
  gatewayMarker,
  installmentMarker,
  isPlanOwnedNote,
  planOwnedNoteOr,
} from "@/lib/finance/payment-markers";

// ═══════════════════════════════════════════════════════════════════════════
// LỖI 1 — DUNG SAI LÀM TRÒN BỊ ĐÁNH MẤT KHI TÍNH LẠI ⇒ PAID tụt về PARTIAL
//
// Hai đường tính trạng thái phiếu truyền `waived` KHÁC NHAU cho cùng một phiếu:
//   · lib/payments/payos-ingest.ts:968-973 — cộng `_sum.roundingWaived` rồi truyền
//     vào `deriveStatus` ⇒ phiếu được tha đủ thành PAID.
//   · lib/payments/payment-request.ts:404 — `deriveStatus(r.amountDue, allocated, 0, ...)`
//     truyền THẲNG SỐ 0, và `allocatedByRequest` (:69-73) chỉ `_sum: { amount: true }`,
//     KHÔNG cộng `roundingWaived` ⇒ cùng phiếu đó bị tính lại thành PARTIAL.
//
// `recomputeRequestStatuses` tự khai ở `payment-request.ts:386,390` là "NƠI DUY NHẤT
// đặt PENDING/PARTIAL/PAID", và nó chạy ngay trong `materializeInstallmentRequests`
// (`:296`) — tức đúng cú bấm "Lưu kế hoạch" / "Duyệt kế hoạch" kế tiếp.
//
// ⚠️ Chú thích ở `payos-ingest.ts:947-952` nói việc lưu `roundingWaived` là để TRÁNH
// đúng chuyện này. Mã nguồn cho thấy nó VẪN CÒN. Luật A1: mã nguồn thắng chú thích.
// ═══════════════════════════════════════════════════════════════════════════

describe("[DS-01] dung sai làm tròn phải BỀN qua lần tính lại", () => {
  // Khách phải đóng 8.000.000đ, chuyển 7.996.000đ (thiếu 4.000đ, trong dung sai 5.000đ).
  const AMOUNT_DUE = 8_000_000;
  const ALLOCATED = 7_996_000;
  const WAIVED = 4_000;

  it("deriveStatus cho PAID khi phần thiếu nằm trong dung sai", () => {
    expect(deriveStatus(AMOUNT_DUE, ALLOCATED, WAIVED, "PENDING")).toBe("PAID");
  });

  it("Bỏ QUÊN waived thì PAID tụt về PARTIAL — đây là bản thân con bug", () => {
    // Giữ lại làm chứng: chỉ cần MỘT đường quên truyền waived là trạng thái đảo chiều.
    expect(deriveStatus(AMOUNT_DUE, ALLOCATED, 0, "PAID")).toBe("PARTIAL");
  });
});

// ⚠️ Hai test trên là THUẦN nên KHÔNG chứng minh được đường recompute có truyền waived
// hay không — đó là một lời gọi Prisma trong `recomputeRequestStatuses`. Test dưới đây
// ghim CHÍNH MÃ NGUỒN, theo đúng lối mà repo đã dùng cho các luật không test được bằng
// hàm thuần (`lib/eslint/*.test.ts`). Đây là lưới chặn tái phát, không phải test đẹp.

describe("[DS-01b] mã nguồn — đường tính lại phải thực sự đọc roundingWaived", () => {
  // Đọc theo gốc dự án: `import.meta.url` trong cấu hình vitest của repo này không
  // phải URL dạng file:// nên `fileURLToPath` ném.
  const nguon = readFileSync(resolve(process.cwd(), "lib/payments/payment-request.ts"), "utf8");

  it("allocatedByRequest SUM cả roundingWaived, không chỉ amount", () => {
    // Trước bản vá: `_sum: { amount: true }`.
    expect(nguon).toMatch(/_sum:\s*\{\s*amount:\s*true,\s*roundingWaived:\s*true\s*\}/);
  });

  it("KHÔNG còn lời gọi deriveStatus nào truyền hằng 0 cho waived", () => {
    // Trước bản vá: `deriveStatus(r.amountDue, allocated.get(r.id) ?? 0, 0, r.status)`.
    // Chính cái hằng `0` ở vị trí thứ ba là con bug.
    const goi = nguon.match(/deriveStatus\([^)]*\)/g) ?? [];
    expect(goi.length).toBeGreaterThan(0);
    for (const g of goi) {
      const thamSo = g.slice("deriveStatus(".length, -1).split(",").map((x) => x.trim());
      expect(thamSo[2], `lời gọi ${g} truyền hằng 0 cho waived`).not.toBe("0");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỖI 2 — "DUNG SAI LÀM TRÒN" CHO PHÉP TỚI 100.000đ, VÀ PHẦN THA KHÔNG VÀO SỔ TIỀN
//
// `lib/settings/registry.ts:210` — `schema: z.number().int().min(0).max(100_000)`,
// `default: 5_000`, `centerOverridable: true`. Nghĩa là một cơ sở đặt ngưỡng 100.000đ
// là hợp lệ, và khi đó `deriveStatus` coi phiếu ĐÃ ĐÓNG ĐỦ dù khách thiếu 100.000đ.
//
// Phần thiếu được tha KHÔNG BAO GIỜ vào Ledger-A: `payos-ingest.ts:1047` ghi
// `amount: allocated`, không cộng `waived` (tính riêng ở `:1024`, chỉ để ghi
// IntegrationLog ROUNDING_WAIVED). Công nợ HIỂN THỊ đọc `Payment` (lib/finance/debt.ts)
// ⇒ khoản chênh nằm mãi trong công nợ trong khi phiếu đã PAID và cron ngừng đòi.
//
// Đây KHÔNG phải "làm tròn": 100.000đ là tiền thật. Ghim lại để lần vá phải quyết
// nghiệp vụ (hạ trần? ghi phần tha vào sổ? hay cả hai).
// ═══════════════════════════════════════════════════════════════════════════

describe("[DS-02] ngưỡng dung sai — 100.000đ không còn là 'làm tròn'", () => {
  it.fails("thiếu 100.000đ KHÔNG được coi là đã đóng đủ", () => {
    // Ngưỡng tối đa mà registry cho phép cơ sở đặt.
    const TOI_DA_REGISTRY_CHO = 100_000;
    const trangThai = deriveStatus(8_000_000, 7_900_000, TOI_DA_REGISTRY_CHO, "PENDING");
    expect(trangThai).not.toBe("PAID");
  });

  it("dung sai mặc định 5.000đ thì cho qua — đây là hành vi CÓ CHỦ ĐÍCH, không phải bug", () => {
    // Test này là `it` thường và PHẢI xanh: nó ghim phần nghiệp vụ ĐÚNG, để lần vá
    // LỖI 2 không vô tình siết luôn ca hợp lệ (lệch vài nghìn do phí chuyển khoản).
    expect(deriveStatus(8_000_000, 7_996_000, 4_000, "PENDING")).toBe("PAID");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LỖI 3 — LƯU LẠI KẾ HOẠCH ĐỢT XOÁ MỀM TIỀN THẬT TỪ NGÂN HÀNG
//
// ĐÂY LÀ LỖI NẶNG NHẤT ĐO ĐƯỢC TRONG LƯỢT NÀY, và nó KHÔNG có trong danh sách
// R-01/R-02/R-04/R-13.
//
// `lib/orders/installments.ts:102` — `recordInstallmentPlan` xoá mềm khoản cũ bằng:
//     tx.payment.updateMany({ where: { orderId, deletedAt: null,
//                                      note: { contains: "[auto:" } },
//                             data: { deletedAt: now } })
// Ý định (chú thích `:94-101`) là dọn khoản TỰ SINH của chính kế hoạch
// (`[auto:order-confirm]`, `[auto:order-installment:dotN]`) để khỏi cộng đôi.
//
// Nhưng `lib/payments/payos-ingest.ts:1037-1052` ghi TIỀN THẬT TỪ NGÂN HÀNG với
// marker `[auto:<provider>:<txn>]` — tức `[auto:payos:TX123]` / `[auto:sepay:TX123]`.
// Chuỗi đó KHỚP `contains "[auto:"`.
//
// Hệ quả: đơn đã nhận tiền chuyển khoản, rồi ai đó bấm "Lưu kế hoạch" lần nữa
// (sửa số tiền đợt, hoặc lưu lại sau khi QLCS bác) ⇒ dòng `Payment` DUY NHẤT của
// khoản tiền thật đó bị `deletedAt`. Mọi phép đọc tiền đều lọc `deletedAt: null`
// (`lib/finance/debt.ts`, `scripts/shadow-compare-debt.ts:100`) ⇒ tiền rơi khỏi
// công nợ hiển thị. `PaymentAllocation` ở sổ mới vẫn còn ⇒ hai sổ lệch nhau đúng
// bằng số tiền khách đã chuyển.
// ═══════════════════════════════════════════════════════════════════════════

describe("[DS-03] điều kiện xoá mềm của kế hoạch KHÔNG được trúng tiền ngân hàng", () => {
  // ✅ ĐÃ VÁ 13/09/2026 — `lib/finance/payment-markers.ts` + thu hẹp điều kiện ở
  // `lib/orders/installments.ts`. Ghim `it.fails` đã gỡ; từ đây trở đi các test này
  // phải XANH, và đỏ trở lại nghĩa là ai đó nới điều kiện về tiền tố `[auto:`.

  it("điều kiện xoá mềm PHẢI trúng khoản tự sinh của kế hoạch — đây là việc của nó", () => {
    expect(isPlanOwnedNote(installmentMarker(1))).toBe(true);
    expect(isPlanOwnedNote(installmentMarker(2))).toBe(true);
    expect(isPlanOwnedNote(AUTO_ORDER_CONFIRM_MARKER)).toBe(true);
  });

  it("tiền thật từ SePay KHÔNG trúng điều kiện xoá mềm", () => {
    expect(isPlanOwnedNote(`Tiền về qua SEPAY TX123 ${gatewayMarker("SEPAY", "TX123")}`)).toBe(false);
  });

  it("tiền thật từ payOS KHÔNG trúng điều kiện xoá mềm", () => {
    expect(isPlanOwnedNote(`Tiền về qua PAYOS TX123 ${gatewayMarker("PAYOS", "TX123")}`)).toBe(false);
  });

  it("điều kiện Prisma thật KHÔNG chứa mảnh tiền tố `[auto:`", () => {
    // Đây là vế quyết định: chừng nào còn một mảnh `contains "[auto:"` thì tiền ngân
    // hàng vẫn bị quét, dù các hàm thuần ở trên có đúng đến đâu.
    const chuoi = planOwnedNoteOr([1, 2]).map((o) => o.note.contains);
    expect(chuoi).not.toContain("[auto:");
    for (const c of chuoi) {
      expect(isPlanOwnedNote(c), `mảnh ${c} phải là marker của kế hoạch`).toBe(true);
    }
  });
});
