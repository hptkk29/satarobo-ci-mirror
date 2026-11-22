// app/(admin)/admin/cham-cong/phan-ca/import/_components/import-log.tsx — 5 lượt import gần nhất.
//
// Vì sao file này tồn tại: câu hỏi đầu tiên của người mở màn này luôn là "tháng này đã import
// chưa, ai làm, lúc nào" — bản cũ không trả lời được, nên người ta import lại cho chắc. Import là
// idempotent nên chạy lại không hỏng gì, nhưng nó cũng HUỶ những ca mà người khác vừa sửa tay theo
// một phiên bản Sheet cũ hơn. Sổ này đứng ngay cạnh nút "Đọc file" để chặn tình huống đó.
//
// Điều dễ vỡ: dữ liệu đọc từ `AuditLog` — nhật ký ghi khi ÁP xong, nên không có dòng nào KHÔNG có
// nghĩa là "chưa từng import" mà chỉ là "chưa từng áp thành công qua màn này". Khối ẩn hẳn khi
// rỗng thay vì in một câu khẳng định sai.
import { History } from "lucide-react";
import { SectionCard } from "@/components/admin/cham-cong/section-card";

export type ImportLogRow = {
  id: string;
  /** "HH:mm dd/MM/yyyy" — format ở server (Vercel chạy UTC, đừng format ở client). */
  at: string;
  actorName: string;
  /** Kỳ đã áp, hoặc "Khung ca tuần" khi lượt đó chỉ áp mẫu tuần. */
  scopeLabel: string;
  /** Một dòng số: ô mới · huỷ · giữ tay · ô khung ca. */
  countLabel: string;
  /** Số hàng bị bỏ vì không có quyền ở khối đó — 0 thì không in. */
  skippedNoPermission: number;
};

export function ImportLog({ rows }: { rows: ImportLogRow[] }) {
  if (rows.length === 0) return null;

  return (
    <SectionCard title="Lần import gần đây" icon={History}>
      <ul className="divide-y divide-border/60 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
            <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">{r.at}</span>
            <span className="max-w-[12rem] truncate text-muted-foreground" title={r.actorName}>
              {r.actorName}
            </span>
            <span className="whitespace-nowrap font-medium text-foreground">{r.scopeLabel}</span>
            <span className="text-muted-foreground tabular-nums">{r.countLabel}</span>
            {r.skippedNoPermission > 0 && (
              <span className="tabular-nums text-state-warning-ink">
                {r.skippedNoPermission} hàng bỏ qua — không quyền
              </span>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
