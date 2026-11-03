"use client";

// Thanh liên kết «Trong trang này» của trang Cấu hình hoá đơn. Trước 02/11/2026 là `<a href="#…">` thuần.
//
// Vì sao đổi: liên kết nhảy (#neo) gọi `scrollIntoView` ngầm lên MỌI tổ tiên cuộn được, kể cả TÀI LIỆU (`<html>`). Khung admin là `h-screen overflow-hidden` với vùng nội dung
// `<main overflow-y-auto>`; khi vùng nội dung đã cuộn tới đáy mà đích vẫn chưa lên đỉnh, phần dư bị đẩy lên tổ tiên kế tiếp — nếu tài liệu có chút dư thừa chiều cao thì
// CẢ TRANG bị kéo lên, lộ một dải trắng ở đáy (chủ dự án chụp ngày 02/11/2026). Ở đây ta chỉ cuộn ĐÚNG vùng nội dung chứa đích; phần còn lại của khung đứng yên.
// `href` vẫn giữ (mở tab mới / không chạy JS vẫn nhảy được).
import type { MouseEvent } from "react";

export type MucNeo = { id: string; nhan: string };

/** Cuộn ĐÚNG khung cuộn gần nhất chứa phần tử `id` (không đụng tổ tiên khác). Trả `false` khi không tìm thấy đích — người gọi để trình duyệt tự xử lý. */
export function cuonTrongKhung(id: string, doc: Document = document): boolean {
  const dich = doc.getElementById(id);
  if (!dich) return false;
  const win = doc.defaultView;
  let khung: HTMLElement | null = dich.parentElement;
  while (khung && !(/(auto|scroll)/.test(win?.getComputedStyle(khung).overflowY ?? "") && khung.scrollHeight > khung.clientHeight)) khung = khung.parentElement;
  const giam = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!khung) {
    // Không có khung cuộn nào (trang ngắn, vừa khít): không có gì để cuộn — KHÔNG gọi scrollIntoView (nó mới là thủ phạm kéo cả tài liệu).
    return true;
  }
  const y = dich.getBoundingClientRect().top - khung.getBoundingClientRect().top + khung.scrollTop - 8;
  khung.scrollTo({ top: Math.max(0, y), behavior: giam ? "auto" : "smooth" });
  return true;
}

export function DieuHuongTrongTrang({ muc }: { muc: readonly MucNeo[] }) {
  const bam = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // mở tab mới: để trình duyệt làm
    if (cuonTrongKhung(id)) e.preventDefault();
  };
  return (
    <nav aria-label="Trong trang này" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center [&_a]:pointer-coarse:min-h-11">
      {muc.map((m) => (
        <a key={m.id} href={`#${m.id}`} onClick={bam(m.id)} className="font-medium text-primary underline underline-offset-2">
          {m.nhan}
        </a>
      ))}
    </nav>
  );
}
