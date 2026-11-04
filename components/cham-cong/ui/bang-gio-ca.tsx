// components/cham-cong/ui/bang-gio-ca.tsx — "Giờ các ca" đặt THẲNG trên màn nhiều dữ liệu.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO Ở ĐÂY CHỨ KHÔNG PHẢI Ở MÀN CẤU HÌNH
//
// Chốt 25/09/2026: *"ghi chú thẳng trên các trang nhiều dữ liệu để QLCS vào check là nắm
// luôn, không cần vào Cấu hình để check"*. Người đang đứng trước lưới 19 người × 30 ngày toàn
// `CG` `CS` `HC` phải mở tab khác để nhớ `CG` mấy giờ — quay lại thì mất chỗ đang xem.
//
// `<details>` đóng sẵn: một dòng khi không cần, bảng đầy đủ khi cần. Không tốn chiều cao của
// thứ người ta vào đây để xem, và KHÔNG cần một byte JavaScript nào (thẻ gốc, chạy trong RSC).
//
// Server Component, không state, không handler.
//
// ⚠️ Thư mục này site GV mount chung ⇒ CHỈ token `:root` (border, muted, card, foreground).
// Cấm `primary-soft` / `primary-ink` / `primary-dark`: site GV không có `.admin-scope`, và
// `--primary-ink` ở `:root` là màu CAM — không phải màu nhấn của admin.
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MaCaGio } from "@/lib/cham-cong/gio-ca";

export function BangGioCa({
  maCa,
  className,
  /** Mặc định đóng. Mở sẵn ở màn mà giờ ca LÀ nội dung chính (vd Khung ca tuần). */
  moSan = false,
}: {
  maCa: MaCaGio[];
  className?: string;
  moSan?: boolean;
}) {
  if (maCa.length === 0) return null;

  return (
    <details
      open={moSan}
      className={cn("rounded-xl border border-border bg-card px-4 py-3", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        Giờ các ca
        <span className="font-normal text-muted-foreground">
          — mã ca in trong ô nghĩa là gì, làm từ mấy giờ tới mấy giờ
        </span>
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="whitespace-nowrap py-1 pr-3 font-semibold">Mã</th>
              <th scope="col" className="whitespace-nowrap py-1 pr-3 font-semibold">Tên ca</th>
              <th scope="col" className="whitespace-nowrap py-1 pr-3 font-semibold">Giờ vào – ra</th>
              <th scope="col" className="whitespace-nowrap py-1 pr-3 text-right font-semibold">Công</th>
              <th scope="col" className="whitespace-nowrap py-1 text-right font-semibold">Lần chấm</th>
            </tr>
          </thead>
          <tbody>
            {maCa.map((m) => (
              <tr key={m.code} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap py-1 pr-3 font-mono font-semibold text-foreground">
                  {m.code}
                </td>
                <td className="py-1 pr-3 text-muted-foreground">{m.name}</td>
                <td className="whitespace-nowrap py-1 pr-3 tabular-nums text-foreground">
                  {m.gio || <span className="text-muted-foreground">— không có giờ cố định</span>}
                </td>
                <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums text-foreground">
                  {m.cong}
                </td>
                <td className="whitespace-nowrap py-1 text-right tabular-nums text-muted-foreground">
                  {m.soCapQuet === 0 ? "không kiểm" : `${m.soCapQuet} lần`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        &quot;Lần chấm&quot; là số cặp vào–ra ca đó đòi trong ngày. <b>2 lần</b> = phải quét ra
        nghỉ giữa giờ rồi quét vào lại. Rê chuột vào một ô mã ca bất kỳ cũng hiện đúng dòng này.
      </p>
    </details>
  );
}
