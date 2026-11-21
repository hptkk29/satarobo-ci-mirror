// app/(admin)/admin/cau-hinh-van-hanh/_components/the-chuyen-hoa-hong.tsx — lối vào từ tab «Hoa hồng» sang trang đặt mốc cutover (Server Component, không state).
//
// Vì sao là một LỐI VÀO chứ không phải ô sửa: `hoaHong.kyCutover` mang `ghiQuaActionRieng` — đường ghi chung từ chối nó (luật 12: không vẽ ô sửa cho khoá không sửa được ở đây).
// Việc đặt mốc cần xem trước tác động, kiểm điều kiện và xác nhận có lý do, nên nó có TRANG riêng. Thẻ này chỉ nói mốc đang là gì và dẫn sang đó.
// Chỉ vẽ cho người giữ ĐÚNG khoá mà trang đích gác (`PAGE_GATES["/cau-hinh-van-hanh/chuyen-hoa-hong"]`) — page.tsx kiểm trước khi dựng thẻ này.
import Link from "next/link";

import { nhanThangKy } from "@/lib/hoa-hong/ky-man-hinh";

export function TheChuyenHoaHong({ moc }: { moc: string | null }) {
  return (
    <section aria-label="Chuyển sang hoa hồng mới" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">Mốc chuyển sang hoa hồng mới</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {moc === null ? "Chưa đặt mốc — hoa hồng vẫn chốt ở sổ cũ." : `Từ kỳ ${nhanThangKy(moc)} hoa hồng tính theo sổ mới; các kỳ trước chỉ đọc.`} Mốc đặt ở trang riêng, có xem trước tác động và nhật ký.
        </p>
      </div>
      <Link href="/cau-hinh-van-hanh/chuyen-hoa-hong" className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        Mở trang chuyển hoa hồng
      </Link>
    </section>
  );
}
