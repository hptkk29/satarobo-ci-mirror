"use client";

// Lưới người × ngày của một khối trong một kỳ.
//
// Vì sao viết lại: bản cũ đặt ~620 thẻ `<select>` (19 người × 30 ngày) trong lưới — mỗi ô là một
// danh sách 20 mã không tên, không giờ, không đường xoá ca. Nay mỗi ô là NÚT mở menu
// (`ShiftCellPicker`), còn ô của khối khác chỉ là chip đọc.
//
// Điều dễ vỡ: ô chỉ đọc PHẢI đi đường `foreignUnit`, không được nhét chuỗi `→CS2` làm giá trị ô.
// `<select value="→CS2">` không khớp option nào nên trình duyệt vẽ ô TRỐNG — quản lý cơ sở nhìn
// thấy "chưa xếp" rồi xếp đè lên ca đã có ở cơ sở kia (bug P0 của bản cũ).
//
// Ngày nghỉ tuần / lễ / hôm nay do PAGE quyết định và truyền xuống dạng cờ boolean: luật nghiệp vụ
// (`shift.weeklyOffDays`) sống ở cấu hình, không sống trong `d.wd === 1` viết cứng ở đây.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { ShiftCellPicker, type ShiftCellCode } from "@/components/admin/cham-cong/shift-cell-picker";
import { ShiftCodeChip, type ShiftSource } from "@/components/cham-cong/ui/shift-code-chip";
import { motDongGioCa, type MaCaGio } from "@/lib/cham-cong/gio-ca";
import { tongCongNghi } from "@/lib/cham-cong/luoi-phan-ca";
import { setCellAction } from "../_actions";

export type GridCell = {
  code: string | null;
  source: ShiftSource;
  /** Khối chịu công khi KHÁC khối đang xem — có giá trị nghĩa là ô chỉ đọc. */
  foreignUnit?: string;
};

export type GridRow = {
  userId: string;
  name: string;
  jobLabel: string | null;
  /** Khối đang xem, dạng mã Sheet ("CS1" | "CS2" | "HO") — `setCellAction` cần để resolve nơi làm. */
  homeUnit: string;
  cells: Record<number, GridCell | null>;
};

export type GridDay = {
  day: number;
  /** 0 = CN … 6 = T7. */
  wd: number;
  ymd: string;
  /** "09/09" — dùng trong nhãn trợ năng của ô. */
  label: string;
  off: boolean;
  holiday: boolean;
  today: boolean;
};

const WD_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Cùng khuôn với nút của `ShiftCellPicker` để ô chỉ-đọc không làm so le hàng 44px. */
const CELL_BOX = "inline-flex h-8 w-12 items-center justify-center";

/** Cột Công/Nghỉ đếm ở MỘT chỗ (`lib/cham-cong/luoi-phan-ca.ts`) — tệp Excel đếm cùng hàm. */
const tongCua = (row: GridRow) => tongCongNghi(row.cells);

export function MonthGrid({
  rows,
  days,
  codes,
  canEdit,
  blockLabel,
  gioCa,
}: {
  rows: GridRow[];
  days: GridDay[];
  codes: ShiftCellCode[];
  canEdit: boolean;
  blockLabel: string;
  /** Giờ vào/ra từng mã — để rê chuột một ô là biết, không phải mở màn Cấu hình. */
  gioCa?: MaCaGio[];
}) {
  const gioTheoMa = new Map<string, string | null>(
    (gioCa ?? []).map((m) => [m.code, motDongGioCa(m)] as const),
  );
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function doiO(row: GridRow, d: GridDay, code: string | null, note?: string) {
    const key = `${row.userId}:${d.ymd}`;
    setBusy(key);
    start(async () => {
      const r = await setCellAction({
        userId: row.userId,
        workDate: d.ymd,
        code,
        homeUnit: row.homeUnit,
        ...(note ? { note } : {}),
      });
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(code ? `Đã đổi ca ${d.label} của ${row.name} sang ${code}` : `Đã xoá ca ${d.label} của ${row.name}`);
      router.refresh();
    });
  }

  // Hàng cuối: mỗi ngày có bao nhiêu người được xếp ca — chỗ thủng của lịch lộ ra ngay.
  const coCaTheoNgay = days.map((d) => rows.reduce((n, r) => n + (r.cells[d.day]?.code ? 1 : 0), 0));

  const dayTone = (d: GridDay) =>
    cn(d.off && "bg-muted", d.holiday && "text-state-danger-ink", d.today && "border-x border-primary");

  return (
    // Vỏ thẻ giống period-table/request-queue-table — và giống `GridSkeleton`, nếu không thì
    // khung bo góc của lúc chờ hiện ra rồi BIẾN MẤT khi dữ liệu về.
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="phan-ca" soDongMacDinh={50}>
        {/* `w-full` KHÔNG thừa bên cạnh `min-w`: <table> co theo nội dung, nên khi thẻ rộng
            hơn 1200px bảng dừng ở 1200 và chừa một dải `bg-card` trống bên phải — dải nền
            header và đường kẻ hàng không chạm viền, đúng cảm giác "mất một góc bên phải".
            Mọi bảng khác của module đều có cặp `w-full min-w-[…]`; đây là bảng duy nhất thiếu. */}
        <table className="w-full min-w-[1200px] text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={cn(adminTh, "sticky left-0 z-10 bg-muted px-3 py-2")}>
                Nhân sự
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  scope="col"
                  className={cn(adminTh, "px-1 py-2 text-center tabular-nums", dayTone(d))}
                  title={d.holiday ? "Ngày lễ" : d.off ? "Ngày nghỉ tuần" : undefined}
                >
                  <div className="text-sm font-bold text-foreground">{d.day}</div>
                  <div className="font-normal normal-case">{WD_LABEL[d.wd]}</div>
                </th>
              ))}
              <th scope="col" className={cn(adminTh, "px-3 py-2 text-right")}>
                Công
              </th>
              <th scope="col" className={cn(adminTh, "px-3 py-2 text-right")}>
                Nghỉ
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const { cong, nghi } = tongCua(row);
              return (
                <tr key={row.userId} className={adminTr}>
                  <td
                    className={cn(adminTd, "sticky left-0 z-10 bg-card px-3 py-1 font-medium")}
                    title={row.jobLabel ? `${row.name} · ${row.jobLabel}` : row.name}
                  >
                    {/* `max-w` + `truncate` phải ở SPAN: bảng auto-layout bỏ qua max-width trên
                        `<td>`, còn `adminTd` có sẵn `whitespace-nowrap` ⇒ ô không cắt chữ mà nở
                        ra, đẩy cả cột sticky rộng thêm. */}
                    <span className="block max-w-[13rem] truncate">
                      {row.name}
                      {row.jobLabel && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">· {row.jobLabel}</span>
                      )}
                    </span>
                  </td>

                  {days.map((d) => {
                    const c = row.cells[d.day] ?? null;
                    const key = `${row.userId}:${d.ymd}`;
                    const nhan = `${row.name} · ${WD_LABEL[d.wd]} ${d.label}`;
                    return (
                      <td key={d.day} className={cn("px-0.5 py-1.5 text-center", dayTone(d))}>
                        {c?.foreignUnit ? (
                          <span
                            className={CELL_BOX}
                            title={`${nhan}: ca chịu công tại ${c.foreignUnit} — đổi khối để sửa`}
                          >
                            <ShiftCodeChip
                              code={c.code}
                              foreignUnit={c.foreignUnit}
                              size="sm"
                              gio={c.code ? gioTheoMa.get(c.code) : null}
                            />
                          </span>
                        ) : canEdit ? (
                          <ShiftCellPicker
                            value={c?.code ?? null}
                            source={c?.source}
                            codes={codes}
                            busy={pending && busy === key}
                            triggerLabel={`Chọn ca cho ${nhan}`}
                            menuTitle={nhan}
                            onPick={(code, note) => doiO(row, d, code, note)}
                          />
                        ) : (
                          <span className={CELL_BOX} title={`${nhan}: chỉ xem`}>
                            <ShiftCodeChip
                              code={c?.code ?? null}
                              source={c?.source}
                              size="sm"
                              gio={c?.code ? gioTheoMa.get(c.code) : null}
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className={cn(adminTd, "px-3 py-1 text-right font-semibold tabular-nums")}>{cong}</td>
                  <td className={cn(adminTd, "px-3 py-1 text-right tabular-nums text-muted-foreground")}>{nghi}</td>
                </tr>
              );
            })}
          </tbody>

          <tfoot className="border-t border-border bg-muted/40">
            <tr>
              <th scope="row" className={cn(adminTh, "sticky left-0 z-10 bg-muted px-3 py-2")}>
                Có ca
              </th>
              {days.map((d, i) => (
                <td
                  key={d.day}
                  className={cn("px-1 py-2 text-center text-xs font-semibold tabular-nums", dayTone(d))}
                >
                  {coCaTheoNgay[i]}
                </td>
              ))}
              <td className={cn(adminTd, "px-3 py-2 text-right text-xs text-muted-foreground")}>
                {blockLabel}
              </td>
              <td className={cn(adminTd, "px-3 py-2")} />
            </tr>
          </tfoot>
        </table>
      </PhanTrangBang>
    </div>
  );
}
