// components/admin/nguon-hoa-hong/vi-sao-thu-gon.tsx — ngăn "VÌ SAO CON SỐ NÀY" THU GỌN (06 §2.3) cho Sheet khiếu nại.
//
// Dữ liệu là `ViSao` dựng từ ẢNH CHỤP trên dòng sổ (`dungViSao`) — đọc lại không phụ thuộc chính sách live. Ở Sheet quyết định nó thu gọn: người duyệt mở khi cần đối chiếu,
// nhưng nhìn thấy ngay "có thể mở". `<details>` gốc: bàn phím + trình đọc màn hình có sẵn, không JS.
// Cột nhãn cố định 9rem, cột giá trị co giãn (06 §2.3); `canhBao` in thẳng, không thu gọn.
import { TriangleAlert } from "lucide-react";

import type { ViSao } from "@/lib/hoa-hong/vi-sao";

export function ViSaoThuGon({ viSao, moSan = false }: { viSao: ViSao; moSan?: boolean }) {
  return (
    <details className="group rounded-lg border border-border" open={moSan}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">Vì sao con số này</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground group-open:hidden">Mở ra</span>
        <span className="hidden shrink-0 text-xs font-normal text-muted-foreground group-open:inline">Thu lại</span>
      </summary>
      <div className="border-t border-border px-3 py-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{viSao.tieuDe}</p>
        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {viSao.buoc.map((b, i) => (
            <div key={`${b.nhan}-${i}`} className="contents">
              <dt className="text-muted-foreground">{b.nhan}</dt>
              <dd className="min-w-0 break-words text-foreground tabular-nums">
                {b.giaTri}
                {b.ghiChu && <span className="mt-0.5 block text-xs text-muted-foreground">{b.ghiChu}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {viSao.canhBao.length > 0 && (
          <ul className="mt-3 space-y-1">
            {viSao.canhBao.map((c) => (
              <li key={c} className="flex items-start gap-1.5 text-xs text-state-warning-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
