// =============================================================================
// Trần chi phí — CÂU LỆNH SQL. Đây là cái cổng thật, không phải `chinh-sach.ts`.
//
// Vì sao phải là SQL chứ không phải `if` trong TypeScript:
// yêu cầu "hai lời gọi cùng lúc lúc sát trần không được cùng lọt" không thể đạt bằng
// đọc-rồi-so. Trên Vercel có nhiều tiến trình, hai tiến trình cùng đọc "đã tiêu
// 1.999.600đ", cả hai cùng kết luận còn chỗ, cả hai cùng gửi ⇒ vượt trần. Kho này
// đang có sẵn một ví dụ của lỗi đó ở `lib/otp/service.ts:138` (`count()` rồi `if`) —
// chỗ này cố ý KHÔNG chép lại nó.
//
// Cách đúng: MỘT câu `UPDATE ... WHERE "spentVnd" + chi_phí <= trần`. Postgres khoá
// dòng, và sau khi giành được khoá nó ĐÁNH GIÁ LẠI mệnh đề WHERE trên bản đã commit
// của người thắng trước ⇒ người thứ hai tự trượt, không cần transaction tường minh,
// không cần advisory lock. Số dòng bị tác động (0 hay 1) chính là câu trả lời.
//
// Tách ra file riêng để test được mà KHÔNG cần Postgres: câu lệnh là dữ liệu thuần.
// `$queryRawUnsafe` bị CLAUDE.md cấm — ở đây dùng `Prisma.sql` tagged template, mọi
// giá trị đi qua tham số ($1,$2…), tên bảng/cột là hằng số viết thẳng trong template.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { TrucChiPhi } from "./chinh-sach";

/** Tên bảng sổ chi. Hằng số của module — không nhận từ nơi gọi (không có đường tiêm). */
export const BANG_SO_CHI = "OutboundSpendCounter" as const;

/**
 * Tạo dòng kỳ×trục nếu chưa có. `ON CONFLICT DO NOTHING` để hai lời gọi đầu kỳ chạy
 * cùng lúc không lời nào vỡ vì trùng khoá chính.
 */
export function sqlTaoDongKy(args: { kyThang: string; truc: TrucChiPhi }): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "OutboundSpendCounter" ("period", "axis")
    VALUES (${args.kyThang}, ${args.truc})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * ĐẶT CHỖ ngân sách cho một lượt gọi ra.
 *
 * Bất đẳng thức `"spentVnd" + chi_phí <= trần` phải khớp `quyetDinhNganSach()` trong
 * `chinh-sach.ts` — `cau-lenh.test.ts` pin lại chuyện đó. Đổi một bên mà quên bên kia
 * là tiêu tiền âm thầm hoặc chặn oan.
 *
 * Trả về 0 dòng ⇒ hết ngân sách. Trả về 1 dòng ⇒ đã trừ, kèm số đã tiêu MỚI (đọc lại
 * bằng câu SELECT riêng là sai: giữa hai câu, lượt khác đã kịp trừ tiếp).
 */
export function sqlDatCho(args: {
  kyThang: string;
  truc: TrucChiPhi;
  chiPhiVnd: number;
  tranVnd: number;
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE "OutboundSpendCounter"
    SET "spentVnd" = "spentVnd" + ${args.chiPhiVnd},
        "chargeCount" = "chargeCount" + 1,
        "updatedAt" = now()
    WHERE "period" = ${args.kyThang}
      AND "axis" = ${args.truc}
      AND "spentVnd" + ${args.chiPhiVnd} <= ${args.tranVnd}
    RETURNING "spentVnd"
  `;
}

/**
 * HOÀN LẠI phần đã đặt chỗ khi lượt gọi KHÔNG thật sự phát sinh phí.
 *
 * Có đường này vì nhà cung cấp không tính phí tin gửi hỏng (văn bản ZBS 31/07 cho
 * Zalo). Không hoàn thì một đợt lỗi xác thực hàng loạt sẽ ăn sạch trần tháng dù chưa
 * gửi được tin nào — trần biến thành cầu chì tự nổ.
 *
 * `GREATEST(0, …)` để một lời hoàn lặp (retry) không kéo sổ xuống âm.
 */
export function sqlHoanLai(args: {
  kyThang: string;
  truc: TrucChiPhi;
  chiPhiVnd: number;
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE "OutboundSpendCounter"
    SET "spentVnd" = GREATEST(0, "spentVnd" - ${args.chiPhiVnd}),
        "chargeCount" = GREATEST(0, "chargeCount" - 1),
        "updatedAt" = now()
    WHERE "period" = ${args.kyThang}
      AND "axis" = ${args.truc}
  `;
}

/**
 * Đóng dấu "đã cảnh báo mốc %" — MỘT lần cho mỗi kỳ×trục.
 *
 * `"warnedAt" IS NULL` làm việc chốt chặn: mọi lượt sau mốc đều chạy câu này, nhưng
 * chỉ lượt ĐẦU TIÊN nhận về dòng ⇒ chỉ nó phát cảnh báo. Cảnh báo kêu ở mỗi tin nhắn
 * sau mốc 80% là cảnh báo sẽ bị người ta tắt.
 */
export function sqlDanhDauCanhBao(args: {
  kyThang: string;
  truc: TrucChiPhi;
  mocVnd: number;
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE "OutboundSpendCounter"
    SET "warnedAt" = now(), "updatedAt" = now()
    WHERE "period" = ${args.kyThang}
      AND "axis" = ${args.truc}
      AND "warnedAt" IS NULL
      AND "spentVnd" >= ${args.mocVnd}
    RETURNING "spentVnd"
  `;
}

/**
 * Ghi nhận một lượt BỊ CHẶN. `blockedCount` trả lời câu "trần đang cắt mất bao nhiêu
 * việc" — không có nó thì tháng sau không ai biết nên nâng trần hay giữ nguyên.
 */
export function sqlDanhDauBiChan(args: { kyThang: string; truc: TrucChiPhi }): Prisma.Sql {
  return Prisma.sql`
    UPDATE "OutboundSpendCounter"
    SET "blockedCount" = "blockedCount" + 1,
        "blockedAt" = COALESCE("blockedAt", now()),
        "updatedAt" = now()
    WHERE "period" = ${args.kyThang}
      AND "axis" = ${args.truc}
  `;
}
