// lib/hoa-hong/hang-cho-chan-ky.ts — LÁ THUẦN: mã hàng chờ nào CHẶN khoá kỳ. Không import runtime nào (chỉ kiểu Prisma — bị xoá lúc build).
//
// Tách khỏi `hang-cho.ts` vì `hang-cho.ts` import `writeAudit` → `lib/db`: màn «Kỳ hoa hồng» (`bang-ky.tsx`, `hanh-dong-ky.tsx`) và màn «Chuyển sang hoa hồng mới» (`chuyen-hoa-hong-man.tsx`) là
// client component và đọc `ky-man-hinh.ts` — kéo `hang-cho.ts` vào là kéo `lib/db` vào bundle trình duyệt, và trang vỡ bằng «PrismaClient is unable to run in this browser environment».
// Lưới `[CBS-*]` (`lib/hoa-hong/client-bundle-sach.test.ts`) canh: không `"use client"` nào của khu hoa hồng/cấu hình vận hành được với tới `lib/db`.
import type { Prisma } from "@prisma/client";

export type MaHold = Prisma.CommissionHoldCreateInput["code"];

/** Mã chặn khoá kỳ (cứng + mềm-chặn). Hai mã còn lại luôn `blockingPeriodId = NULL`. */
const MA_KHONG_CHAN: ReadonlySet<MaHold> = new Set<MaHold>(["UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE"]);
export const hangChoChanKy = (ma: MaHold): boolean => !MA_KHONG_CHAN.has(ma);
