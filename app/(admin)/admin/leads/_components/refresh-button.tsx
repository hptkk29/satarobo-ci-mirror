'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

/**
 * Nút "Làm mới" cho màn danh sách Lead — nạp lại dữ liệu NGAY TRÊN TRANG.
 *
 * VÌ SAO KHÔNG BẢO NGƯỜI DÙNG BẤM F5: F5 tải lại cả tài liệu — mất vị trí cuộn, đóng
 * mọi hộp thoại/bộ lọc đang mở, và với màn Kanban thì cuộn lại từ đầu. `router.refresh()`
 * chỉ nạp lại phần RSC: dữ liệu mới, còn state phía client giữ nguyên.
 *
 * Trang Lead luôn render động (đọc `searchParams` + `auth()` → cookie), nên lượt refresh
 * này chắc chắn chạm DB chứ không trả bản đã lưu đệm.
 *
 * ⚠️ `useTransition` là thứ cho biết lượt refresh ĐÃ XONG: `router.refresh()` trả về
 * `void` ngay lập tức (nó không phải Promise), nên `await` nó là vô nghĩa — không có nó
 * thì vòng xoay tắt trước khi dữ liệu về, người dùng tưởng đã xong trong khi chưa.
 *
 * ⚠️ Nút này nằm ở HAI chỗ khác nhau tuỳ khung nhìn, có chủ đích: chế độ Bảng đặt trong
 * hàng công cụ của bảng (cạnh "Cột hiển thị") theo chốt 31/08; chế độ Kanban không có
 * hàng công cụ đó nên đặt ở đầu trang. Mỗi khung nhìn hiện ĐÚNG MỘT nút.
 */
export function LeadsRefreshButton({ className }: { className?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      title="Nạp lại danh sách để thấy lead mới, không cần F5"
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50'
      }
    >
      <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
      {pending ? 'Đang tải…' : 'Làm mới'}
    </button>
  )
}
