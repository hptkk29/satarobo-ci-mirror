// lib/finance/debt-pure.ts — phép tính công nợ THUẦN, tách khỏi `debt.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH FILE — sự cố 14/09/2026, lỗi chỉ lộ LÚC CHẠY
//
// `computeDebt` vốn nằm trong `lib/finance/debt.ts`, mà file đó `import { db } from
// "@/lib/db"` ngay dòng 3. Nên bất kỳ component `"use client"` nào dùng lại một hàm thuần
// của nó đều kéo cả PrismaClient vào bundle trình duyệt:
//
//   bang-doi-soat.tsx  →  doi-soat-hoc-phi.ts  →  cong-no-don.ts  →  debt.ts  →  lib/db.ts
//
//   Error: PrismaClient is unable to run in this browser environment
//
// ⚠️ Bài học, vì nó sẽ lặp lại: **`pnpm typecheck`, `pnpm lint` và `pnpm depcruise` đều
// XANH.** Không có vòng import, không có kiểu sai, không có luật lint nào cấm. Thứ duy
// nhất bắt được là MỞ TRANG RA XEM. Cùng họ với luật 12 (affordance phải nói thật):
// một lời hứa không ném lỗi lúc biên dịch.
//
// LUẬT RÚT RA: hàm thuần mà tầng client có thể cần thì đặt ở file KHÔNG import `@/lib/db`.
// `debt.ts` re-export lại toàn bộ, nên ~30 chỗ gọi cũ không phải sửa một dòng nào.
// ─────────────────────────────────────────────────────────────────────────────

/** Công nợ = tổng hoá đơn − đã trả (không âm). THUẦN (C6.1). */
export function computeDebt(totalAmount: number, paidAmount: number): number {
  return Math.max(0, totalAmount - paidAmount);
}

const NGAY_MS = 86_400_000;

/** Bucket quá hạn theo dueDate vs now. THUẦN. dueDate null / chưa tới hạn → "none". */
export function overdueBucket(dueDate: Date | null, now: Date): "none" | "1-7" | "8-30" | ">30" {
  if (!dueDate) return "none";
  const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / NGAY_MS);
  if (overdueDays <= 0) return "none";
  if (overdueDays <= 7) return "1-7";
  if (overdueDays <= 30) return "8-30";
  return ">30";
}
