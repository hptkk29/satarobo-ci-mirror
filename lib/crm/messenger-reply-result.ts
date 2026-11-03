/**
 * S-2b — HÌNH DẠNG KẾT QUẢ của `replyAction`, dùng chung server ↔ client.
 *
 * Ở riêng một tệp THUẦN vì hai lẽ:
 *  1. `actions.ts` mang `'use server'` — tệp đó chỉ được export hàm async, khai kiểu
 *     trong đó là vỡ Server Actions lúc chạy (E352) mà `pnpm build` vẫn xanh.
 *  2. Ô trả lời là client component; `import type` bị xoá lúc biên dịch nên nó không
 *     kéo theo `server-only` nào.
 *
 * ⚠️ BA nhánh, không phải hai. `ok: true` KHÔNG có nghĩa là khách đã nhận được tin —
 * `daGuiThat` mới là điều đó. Đúng chỗ này từng nói dối suốt mấy tháng: giao diện suy
 * "đã gửi" từ `ok` rồi bắn toast "Đã gửi", trong khi không có lời gọi nào ra Meta.
 * Union phân biệt (`daGuiThat: true | false`) để TypeScript BẮT người viết sau phải
 * xử lý nhánh mô phỏng, thay vì trông vào kỷ luật.
 */
export type KetQuaTraLoiUI =
  /** Tin đã tới Meta thật, có `mid` xác nhận. */
  | { ok: true; daGuiThat: true }
  /** Đã ghi sổ nhưng KHÔNG gọi Meta — khách KHÔNG nhận gì. Phải hiện `canhBao`. */
  | { ok: true; daGuiThat: false; canhBao: string }
  /** Không gửi được. `error` là câu tiếng Việt hiện thẳng cho người dùng. */
  | { ok: false; error: string };
