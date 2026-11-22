// lib/permissions/scope-shadow-sink.ts — Nền Hệ thống P3 · US-12.
//
// Chỗ NHẬN tin của pha shadow. `can()` chỉ biết file này; nó KHÔNG biết có DB, có bảng
// `ScopeShadowDiff`, hay có cổng cutover nào cả.
//
// ── VÌ SAO PHẢI CHÈN MỘT LỚP TRUNG GIAN THAY VÌ GỌI THẲNG ──────────────────────────
// `can()` là hàm THUẦN + ĐỒNG BỘ, và được import ở khắp nơi kể cả đường chạy không có
// DB. Gọi thẳng `ghiScopeShadow` (async, import `@/lib/db`) từ đó sẽ:
//   ① kéo Prisma vào mọi bundle import `can()` — kể cả middleware/edge;
//   ② biến hàm thuần thành hàm có side-effect, nên mọi unit test của quyền bỗng đụng DB;
//   ③ tạo vòng import lib/db → … → lib/permissions/can → lib/db.
// Nên: mặc định là hàm RỖNG. Nơi có DB tự đăng ký (xem instrumentation.ts). Không đăng
// ký thì shadow đơn giản là không chạy — KHÔNG hỏng gì.
//
// ── AC3: KHÔNG BAO GIỜ ĐỔI QUYẾT ĐỊNH ──────────────────────────────────────────────
// `phatScopeShadow` trả `void` và NUỐT mọi lỗi. Kiểu trả `void` là cố ý: người gọi
// không có gì để đọc, nên không thể lỡ tay dùng kết quả shadow làm quyết định.
import type { Actor, Target } from "@/lib/auth/actor";

/**
 * Nhận MỘT lượt kiểm quyền — không phải một dòng grant.
 *
 * Mức đo này là có chủ đích: `can()` là ALLOW-wins trên nhiều dòng, nên lệch ở một dòng
 * mà kết quả cuối không đổi là nhiễu vô hại. Xem `soSanhQuyetDinh`.
 */
export type ScopeShadowSink = (actor: Actor, permissionKey: string, target?: Target) => void;

let sink: ScopeShadowSink | null = null;

/** Đăng ký nơi nhận (nơi có DB gọi lúc khởi động). Gọi lại là thay thế. */
export function datScopeShadowSink(fn: ScopeShadowSink): void {
  sink = fn;
}

/** Gỡ đăng ký — dùng trong test để trở về trạng thái "không có shadow". */
export function xoaScopeShadowSink(): void {
  sink = null;
}

export function coScopeShadowSink(): boolean {
  return sink != null;
}

/**
 * Báo một lượt kiểm quyền cho pha shadow. Không có sink → không làm gì.
 * Lỗi trong sink bị nuốt tại đây, KHÔNG để rò lên `can()`.
 */
export function phatScopeShadow(actor: Actor, permissionKey: string, target?: Target): void {
  if (sink == null) return;
  try {
    sink(actor, permissionKey, target);
  } catch {
    // Quan sát viên hỏng không được phép làm hỏng thứ nó quan sát (AC3).
  }
}
