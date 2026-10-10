// today-taps.tsx — "Lượt chấm hôm nay" ở CHẾ ĐỘ ĐIỀU KHIỂN của màn QR.
//
// Vì sao có: người trực quầy cần biết mã đang chạy có ăn không, mà không phải rời màn sang bảng
// công ngày. 10 lượt gần nhất là đủ để trả lời "vừa quét có vào không".
//
// ĐIỀU DỄ VỠ: bảng này CHỈ được render ở chế độ điều khiển — nó có TÊN NGƯỜI, mà chế độ trình
// chiếu hướng ra chỗ khách ngồi. Dữ liệu đọc qua `scopedDb` ở page (StaffTimeLog là SCOPED_MODEL).
import { cn } from "@/lib/utils";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import { PILL } from "@/components/admin/cham-cong/classes";
import { NHAN_DA_BI_THAY } from "@/lib/cham-cong/sua-gio-quet";

export type TapRow = {
  id: string;
  name: string;
  /** "14:03" theo giờ VN — định dạng ở page (RSC), component không tính giờ. */
  time: string;
  direction: "IN" | "OUT";
  flags: string[];
  /**
   * Lượt đã được THAY bằng chỉnh tay (06/10/2026). Vẫn hiện — quét thật đã xảy ra và bảng này
   * trả lời "mã có ăn không" — nhưng gạch ngang để không ai đọc nó thành giờ đang tính công.
   */
  daBiThay: boolean;
};

export function TodayTaps({ rows }: { rows: TapRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
        Chưa có lượt chấm nào hôm nay ở cơ sở này. Lượt quét mã QR sẽ hiện ngay tại đây.
      </p>
    );
  }

  return (
    <PhanTrangBang cuonNgang tenDonVi="lượt" khoaGhiNho="cham-cong-kiosk-taps">
      <table className="w-full">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={adminTh}>
              Nhân sự
            </th>
            <th scope="col" className={adminTh}>
              Giờ
            </th>
            <th scope="col" className={adminTh}>
              Vào/Ra
            </th>
            <th scope="col" className={adminTh}>
              Cờ
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={adminTr}>
              <td className={cn(adminTd, "max-w-[14rem] truncate font-medium")} title={r.name}>
                {r.name}
              </td>
              <td className={cn(adminTd, "tabular-nums")}>
                <span className={cn(r.daBiThay && "line-through opacity-60")}>{r.time}</span>
                {r.daBiThay && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{NHAN_DA_BI_THAY}</span>
                )}
              </td>
              <td className={adminTd}>
                <span
                  className={cn(
                    PILL,
                    r.direction === "IN"
                      ? "bg-state-success-soft text-state-success-ink"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.direction === "IN" ? "Vào" : "Ra"}
                </span>
              </td>
              <td className={cn(adminTd, "whitespace-normal")}>
                {r.flags.length > 0 ? (
                  <FlagList codes={r.flags} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}
