// lib/integrations/zalocrm/kenh.ts — DANH MỤC KÊNH của hộp thư, một nguồn duy nhất.
//
// VÌ SAO GOM VỀ ĐÂY (trước đó nằm rải ở hai file):
// Thêm một giá trị vào `enum InboxChannel` có ĐÚNG MỘT chỗ được typecheck bắt hộ —
// `NHAN_KENH` là `Record<InboxChannel, string>` nên thiếu nhãn là build đỏ. Chỗ còn
// lại, `KENH_HOP_LE`, là một MẢNG: thiếu giá trị mới thì `?kenh=ZALO_CA_NHAN` rơi về
// `null`, Sale bấm lọc mà không lọc được và KHÔNG có lỗi nào hiện ra. Hai danh sách
// nằm ở hai file (`app/(sale)/sale/hop-thu/page.tsx` và
// `components/sale/hop-thu/hop-thu-workspace.tsx`) thì không có gì buộc chúng khớp.
// Gom về một file + một bộ test (`kenh.test.ts`, ca [ZC-DB-04]…[ZC-DB-06]) là lưới
// thay cho phần typecheck không với tới được.
//
// ⚠️ Đây là module THUẦN, được nạp cả ở client (`"use client"`). Không `server-only`,
// không `db`, không đọc `process.env`. `InboxChannel` nhập dạng KIỂU để không kéo
// runtime Prisma vào bó JS của trình duyệt.
import type { InboxChannel } from "@prisma/client";

/**
 * Nhãn tiếng Việt hiện cho người dùng. `Record` ĐẦY ĐỦ — đây là lưới typecheck duy
 * nhất của danh mục này, đừng đổi thành `Partial`.
 *
 * `ZALO_CA_NHAN` = nick Zalo CÁ NHÂN của Sale, đi qua ZaloCRM. Khác hẳn `ZALO_OA`
 * (tài khoản chính thức của công ty): khác ràng buộc nền tảng, khác hạn mức, khác
 * người chịu trách nhiệm — nên nó là một kênh riêng chứ không phải một biến thể.
 */
export const NHAN_KENH: Record<InboxChannel, string> = {
  ZALO_OA: "Zalo OA",
  ZALO_CA_NHAN: "Zalo cá nhân",
  MESSENGER: "Messenger",
  LIVECHAT: "Website",
  MANUAL: "Nhập tay",
};

/**
 * Whitelist cho tham số lọc `?kenh=` trên URL — KHÔNG nhét thẳng chuỗi từ URL vào
 * `where` của Prisma (chuỗi lạ làm truy vấn NÉM, không phải "lọc ra rỗng").
 *
 * Phải phủ đủ mọi giá trị `InboxChannel`; ca [ZC-DB-04] canh việc đó vì mảng không
 * được typecheck kiểm.
 */
export const KENH_HOP_LE: InboxChannel[] = [
  "ZALO_OA",
  "ZALO_CA_NHAN",
  "MESSENGER",
  "LIVECHAT",
  "MANUAL",
];
