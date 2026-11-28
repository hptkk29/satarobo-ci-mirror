// app/(admin)/admin/cham-cong/phan-ca/import/_components/result-diff-table.tsx — đối chiếu số ô
// từng mã ca: Sheet nói bao nhiêu, hệ thống có bao nhiêu sau khi áp.
//
// Vì sao file này tồn tại: đây là bằng chứng để người vận hành TIN rằng lượt import không nuốt mất
// ca nào — thứ duy nhất thay được việc đếm tay trên Sheet. Bản cũ in bảng NẰM NGANG (một hàng
// "Sheet", một hàng "Hệ thống", mỗi mã một cột) nên với 20 mã ca là phải cuộn ngang và so hai con
// số cách nhau một dòng. Chuyển vị lại: mỗi mã một dòng, hai số đứng cạnh nhau, cột LỆCH nói ngay
// chênh bao nhiêu.
//
// Điều dễ vỡ: KHÔNG phân trang (khai MIEN_TRU ở `components/ui/bang-coverage.test.ts`) — bảng
// nhiều nhất ~21 mã và phải thấy TRỌN mới kết luận được "khớp toàn bộ"; cắt trang là giấu đúng
// dòng lệch mà người ta mở bảng này để tìm.
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { cn } from "@/lib/utils";

export type DiffCounts = { periodKey: string; sheet: Record<string, number>; db: Record<string, number> };

/** Mã có mặt ở Sheet HOẶC ở hệ thống — mã chỉ có một bên chính là ca bị mất/thừa. */
export function maLech(c: DiffCounts): string[] {
  const codes = [...new Set([...Object.keys(c.sheet), ...Object.keys(c.db)])];
  return codes.filter((k) => (c.sheet[k] ?? 0) !== (c.db[k] ?? 0)).sort();
}

export function ResultDiffTable({ counts }: { counts: DiffCounts }) {
  const codes = [...new Set([...Object.keys(counts.sheet), ...Object.keys(counts.db)])].sort();
  const tongSheet = codes.reduce((a, k) => a + (counts.sheet[k] ?? 0), 0);
  const tongDb = codes.reduce((a, k) => a + (counts.db[k] ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Không phân trang, nhưng vẫn phải cuộn RIÊNG mình cái bảng — không để cả trang trượt ngang. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={adminTh}>
              Mã
            </th>
            <th scope="col" className={cn(adminTh, "text-right")}>
              Sheet
            </th>
            <th scope="col" className={cn(adminTh, "text-right")}>
              Hệ thống
            </th>
            <th scope="col" className={cn(adminTh, "text-right")}>
              Lệch
            </th>
          </tr>
        </thead>
        <tbody>
          {codes.map((k) => {
            const s = counts.sheet[k] ?? 0;
            const d = counts.db[k] ?? 0;
            const lech = d - s;
            return (
              <tr key={k} className={adminTr}>
                <td className={cn(adminTd, "font-mono font-semibold", lech !== 0 && "text-state-danger-ink")}>{k}</td>
                <td className={cn(adminTd, "text-right tabular-nums")}>{s}</td>
                <td className={cn(adminTd, "text-right tabular-nums")}>{d}</td>
                <td
                  className={cn(
                    adminTd,
                    "text-right font-semibold tabular-nums",
                    lech === 0 ? "text-muted-foreground" : "text-state-danger-ink",
                  )}
                >
                  {lech === 0 ? "—" : lech > 0 ? `+${lech}` : lech}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/40">
            <td className={cn(adminTd, "font-semibold")}>Tổng ô</td>
            <td className={cn(adminTd, "text-right font-semibold tabular-nums")}>{tongSheet}</td>
            <td className={cn(adminTd, "text-right font-semibold tabular-nums")}>{tongDb}</td>
            <td
              className={cn(
                adminTd,
                "text-right font-semibold tabular-nums",
                tongDb === tongSheet ? "text-muted-foreground" : "text-state-danger-ink",
              )}
            >
              {tongDb === tongSheet ? "—" : tongDb - tongSheet}
            </td>
          </tr>
        </tfoot>
        </table>
      </div>
    </div>
  );
}
