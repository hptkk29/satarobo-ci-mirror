// lib/ai-lead/dich-vu/quy-tac-page-schema.ts — schema đầu vào của action "bật/tắt tự tạo lead theo Page" (E2).
// Tách khỏi `cau-hinh-thuan.ts` (lát K sở hữu). `id` và `lyDoNguyHiem` chép đúng câu chữ của tệp đó vì chúng chưa được export — xem requestsToCoordinator:
// khi `cau-hinh-thuan.ts` export chúng thì thay bản chép bằng import (lưới `[QTP-SCH-01]` đòi hai bản vẫn khớp từng ký tự cho tới lúc đó).
import { z } from "zod";
import { RE, laDanhTinhFixture } from "../hop-dong";

const id = z.string().regex(/^[a-z0-9]{20,40}$/, "Mã không hợp lệ");
const lyDoNguyHiem = z.string().trim().min(10, "Nhập lý do (ít nhất 10 ký tự) — lý do được ghi vào nhật ký.").max(500, "Lý do tối đa 500 ký tự.");

/** FIX-03: dọn mọi Agent TEST đang bật trên máy chủ PROD — chỉ cần lý do (nhật ký), không chọn Agent nào (tập hợp do máy chủ tính). */
export const voHieuHoaTestTrenProdSchema = z.strictObject({ lyDo: lyDoNguyHiem });

/**
 * Tự tạo lead là quyết định RỦI RO (tạo lead + chia sale không qua duyệt) ⇒ lý do bắt buộc cả khi BẬT lẫn khi TẮT.
 *
 * TẮT LUÔN KHẢ DỤNG: bộ lọc «Page mẫu của gói bàn giao» chỉ áp cho BẬT. Một Page mẫu lỡ có cờ bật (dữ liệu cũ, import) mà không tắt được thì công tắc rủi ro thành
 * công tắc một chiều — người quản trị chỉ còn cách sửa DB. TẮT chỉ cần pageId đúng DẠNG; Page có thật hay không do dịch vụ tra (`Agent không có Page đó`).
 */
export const datTuTaoLeadSchema = z
  .strictObject({
    agentId: id,
    pageId: z.string().trim().regex(RE.pageId, "pageId gồm chữ, số, _ hoặc -, dài 5–64 ký tự"),
    bat: z.boolean(),
    lyDo: lyDoNguyHiem,
  })
  .superRefine((v, ctx) => {
    if (v.bat && laDanhTinhFixture({ pageId: v.pageId })) {
      ctx.addIssue({ code: "custom", path: ["pageId"], message: "pageId này là Page mẫu của gói bàn giao — không dùng được ở hệ thống thật" });
    }
  });
