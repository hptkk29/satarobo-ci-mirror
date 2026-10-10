// app/(admin)/admin/cham-cong/ky-cong/_components/unfinished-list.tsx — "còn gì phải làm trước khi chốt".
//
// Vì sao file này tồn tại: chốt kỳ đóng băng số công và chỉ Hội sở mở lại được, nên câu hỏi thật
// của kế toán không phải "bảng có đẹp không" mà "còn ngày nào chưa sạch không". Trước đây câu đó
// chỉ trả lời được bằng cách tự nhớ mở màn khác mà soi. Ở đây mỗi việc còn dang dở là MỘT LINK
// bấm thẳng tới chỗ xử lý nó — không phải một câu cảnh báo rồi để người ta tự tìm đường.
//
// Dễ vỡ: mọi `href` phải mang đủ `coSo` (+ `date`/`ky`/`loc`) — bỏ sót là màn đích rơi về khối
// đầu tiên có quyền và người ta soi nhầm cơ sở. Href dựng ở page bằng `hrefWith`, đây chỉ in ra.
import Link from "next/link";
import { ChevronRight, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PILL } from "@/components/admin/cham-cong/classes";

export type UnfinishedItem = {
  key: string;
  /** Con số đứng trước câu — "7 ngày còn cờ" đọc nhanh hơn "còn cờ: 7". */
  count: number;
  unit: string;
  label: string;
  href: string;
  /** `danger` cho thứ làm SAI số công nếu chốt luôn; `warn` cho thứ chỉ nên xem lại. */
  tone?: "danger" | "warn";
};

export function UnfinishedList({ items }: { items: UnfinishedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-state-success-ink">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
        Không còn việc dang dở — có thể chốt kỳ.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.key}>
          <Link
            href={it.href}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
          >
            <span
              className={cn(
                PILL,
                "tabular-nums",
                it.tone === "danger"
                  ? "bg-state-danger-soft text-state-danger-ink"
                  : "bg-state-warning-soft text-state-warning-ink",
              )}
            >
              {it.count.toLocaleString("vi-VN")} {it.unit}
            </span>
            <span className="min-w-0 flex-1 text-foreground">{it.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
