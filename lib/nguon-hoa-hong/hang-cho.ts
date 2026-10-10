// lib/nguon-hoa-hong/hang-cho.ts — SỐ hàng chờ của từng tab, cho pill trên ModuleNav và cho route gốc.
//
// MỘT nguồn (luật 12b): pill tab, công tắc "Cần xử lý (N)", route gốc `/nguon-hoa-hong` và dòng của bảng cùng
// đi qua `lib/nguon/doc-hang-cho.ts` — không ai tự đếm lại bằng điều kiện riêng.
//
// Cả năm tab đều có hàng chờ thật (Nguồn · Chính sách · Sổ · Kỳ · Khiếu nại). Người xem KHÔNG thấy tab / không có việc để làm ở tab đó thì KHÔNG trả khoá —
// vắng khoá nghĩa là "chưa biết", không phải "0" (ModuleNav ẩn pill).
// Sổ: pill = `canXuLy` của `docHangChoSo` (MỌI việc đang mở, định nghĩa DUY NHẤT của hàng chờ sổ — `lib/hoa-hong/hang-cho-so-doc.ts`); tab Kỳ đếm riêng phần
// CHẶN khoá kỳ qua `demHangChoChanTheoTamNhin` (cùng phép đếm với cổng khoá). Hai con số khác nhau về NGHĨA, cùng đọc từ bảng mã→nhóm/loại của `hang-cho-so-nhom.ts`.
// Khiếu nại (PR11): hàng chờ = khiếu nại ĐANG MỞ trong phạm vi duyệt của người xem, trừ khiếu nại do chính họ gửi (họ không xử lý được).
import type { Actor } from "@/lib/auth/actor";
import { demHangChoChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { demHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import { demKhieuNaiChoTab } from "@/lib/hoa-hong/khieu-nai-man";
import { demHangChoChanTheoTamNhin } from "@/lib/hoa-hong/ky-doc";
import { demHangChoNguon } from "@/lib/nguon/doc-hang-cho";
import type { NguonHoaHongScope } from "./scope";
import type { TabKey } from "./tab";

export async function docSoHangChoTheoTab(
  actor: Actor,
  scope: NguonHoaHongScope,
): Promise<Partial<Record<TabKey, number>>> {
  const ra: Partial<Record<TabKey, number>> = {};
  // Chỉ đếm khi người xem THẤY tab đó — không tốn câu SQL cho tab họ không có (và không lộ số của tab đó).
  // Các tab đếm SONG SONG (không nối đuôi): trang nào của module cũng chạy hàm này.
  // `new Date()` ở ĐÂY là chủ đích: đây là điểm vào cho page; mọi phép phân loại bên dưới nhận `now` tường minh (luật 19).
  const now = new Date();
  const [nguon, chinhSach, so, ky, khieuNai] = await Promise.all([
    scope.tabMoDuoc("nguon") ? demHangChoNguon(actor, null) : Promise.resolve(null),
    scope.tabMoDuoc("chinh-sach") ? demHangChoChinhSach(actor, now) : Promise.resolve(null),
    // Hàng chờ sổ là bảng công việc của người rà soát: chỉ `view-center` (Sale chỉ xem dòng của mình ⇒ không có hàng chờ, không có pill).
    scope.tabMoDuoc("so") && scope.has("commission:view-center") ? demHangChoSo(actor, null) : Promise.resolve(null),
    // Tab Kỳ: hàng chờ CHẶN của các kỳ chưa khoá trong tầm nhìn (06 §4.1) — cùng phép đếm với cổng khoá kỳ.
    scope.tabMoDuoc("ky") ? demHangChoChanTheoTamNhin(actor) : Promise.resolve(null),
    // Khiếu nại: CHỈ người giữ quyền DUYỆT mới có "việc chờ" (người chỉ có view-self thấy tab nhưng không có hàng chờ ⇒ `null` ⇒ pill ẩn).
    scope.tabMoDuoc("khieu-nai") && scope.has("commission_disputes:review") ? demKhieuNaiChoTab(actor) : Promise.resolve(null),
  ]);
  if (nguon !== null) ra.nguon = nguon;
  if (chinhSach !== null) ra["chinh-sach"] = chinhSach;
  if (so !== null) ra.so = so.canXuLy;
  if (ky !== null) ra.ky = ky;
  if (khieuNai !== null) ra["khieu-nai"] = khieuNai;
  return ra;
}
