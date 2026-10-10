// app/(admin)/admin/cham-cong/ky-cong/_components/period-table.tsx — bảng tổng hợp cả kỳ, một dòng một người.
//
// Vì sao file này tồn tại: đây là tờ giấy kế toán nhìn lần cuối trước khi chốt sổ, nên 13 con số
// của một người phải đọc được theo HÀNG. Bản cũ để 12 cột `px-3 py-2` không `whitespace-nowrap`
// và nhét tên + mã NV + chức danh thành 3 dòng trong một ô, nên dòng cao 60px+ và cao thấp so le
// — mắt không dò ngang được. Ở đây: ô chuẩn `adminTd` (44px, nowrap), cột Nhân sự đúng MỘT dòng,
// và 13 cột gom thành 4 nhóm có tiêu đề để biết cột nào thuộc chuyện gì.
//
// Dễ vỡ:
// - `PhanTrangBang` chỉ cắt trang khi thấy ĐÚNG MỘT `<tbody>` — `<tfoot>` Tổng phải nằm NGOÀI
//   tbody (đúng chuẩn HTML) chứ không được nhét thành một `<tr>` cuối cùng.
// - Cột Nhân sự `sticky left-0` phải tự tô `bg-card`, nếu không chữ các cột sau trượt xuyên qua.
// - Trạng thái RỖNG thuộc về page (`<EmptyState>`), không phải một `<td colSpan>` trong bảng:
//   13 cột tiêu đề trống rồi một dòng chữ là hình thức riêng của mỗi màn này trong cả module.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PILL } from "@/components/admin/cham-cong/classes";

/** Dữ liệu PHẲNG do RSC dựng sẵn — không truyền hàm/Date xuống đây. */
export type PeriodTableRow = {
  userId: string;
  name: string;
  employeeCode: string | null;
  units: number;
  expectedUnits: number;
  leaveUnits: number;
  holidayPaidUnits: number;
  hourCredit: number;
  workedMinutes: number;
  expectedMinutes: number;
  lateCount: number;
  earlyLeaveCount: number;
  missingTapDays: number;
  overrideDays: number;
  flaggedDays: number;
  teachingSessions: number;
  /** Ngày đầu tiên CÓ CỜ của người này (`?loc=co`) — đích ô Cờ. Không có ⇒ ô không bấm được. */
  drillHref: string | null;
  /** Ngày đầu tiên bị GHI ĐÈ của người này (`?loc=ghide`) — đích riêng của ô Ghi đè. */
  overrideHref: string | null;
};

export type PeriodTableTotals = {
  people: number;
  units: number;
  flaggedDays: number;
  teachingSessions: number;
};

/** Số kiểu Việt: 402,5 chứ không 402.5; 0 thì in gạch cho mắt bỏ qua nhanh. */
function so(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function soHoacGach(n: number): string {
  return n ? so(n) : "—";
}

function gio(minutes: number): string {
  if (!minutes) return "0h";
  return `${Math.round(minutes / 60)}h`;
}

const TH_NUM = "text-right";
// `py-0` + `h-11` trên `<tr>` = dòng đúng 44px (`adminTd` mặc định `py-3.5` cho ~48px). Cùng
// chuẩn với bảng công ngày, để hai bảng đọc cạnh nhau không lệch mật độ.
const TD_NUM = "px-3 py-0 text-right tabular-nums";

export function PeriodTable({
  rows,
  totals,
}: {
  /** Luôn ≥ 1 dòng — page dựng `<EmptyState>` thay cho bảng khi kỳ chưa có ai. */
  rows: PeriodTableRow[];
  totals: PeriodTableTotals;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="ky-cong" soDongMacDinh={50}>
      <table className="w-full min-w-[1100px] text-sm">
        <colgroup>
          <col className="w-[15rem]" />
          <col span={4} />
          <col span={2} />
          <col span={5} />
          <col />
        </colgroup>
        <thead className="border-b border-border bg-muted">
          <tr>
            <th
              rowSpan={2}
              scope="col"
              className={cn(adminTh, "sticky left-0 z-10 bg-muted align-bottom")}
            >
              Nhân sự
            </th>
            <th colSpan={4} scope="colgroup" className={cn(adminTh, "px-3 text-center text-[11px]")}>
              Công
            </th>
            <th colSpan={2} scope="colgroup" className={cn(adminTh, "px-3 text-center text-[11px]")}>
              Giờ
            </th>
            <th colSpan={5} scope="colgroup" className={cn(adminTh, "px-3 text-center text-[11px]")}>
              Hậu kiểm
            </th>
            {/* KHÔNG để tên trần "Dạy": màn Công dạy có một con số buổi dạy KHÁC, đếm theo NGƯỜI
                thay vì theo cơ sở của lớp. Hai số gần giống nhau mà không nhãn thì sẽ có người
                sửa cho khớp, và sửa nhầm cái đang đúng. */}
            <th
              rowSpan={2}
              scope="col"
              title="Buổi của những lớp THUỘC CƠ SỞ NÀY. Giáo viên cơ sở này đi dạy lớp cơ sở khác thì buổi đó không nằm ở đây — xem màn Công dạy."
              className={cn(adminTh, "px-3 align-bottom", TH_NUM)}
            >
              Buổi ở cơ sở
            </th>
          </tr>
          <tr>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Công</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>KH</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Nghỉ CL</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Lễ</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>HC</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Làm / KH</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Muộn</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Sớm</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Không lượt</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Ghi đè</th>
            <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Cờ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className={cn(adminTr, "h-11")}>
              <td className={cn(adminTd, "sticky left-0 z-10 bg-card py-0")}>
                <span className="inline-block max-w-[11rem] truncate align-middle font-medium" title={r.name}>
                  {r.name}
                </span>
                {r.employeeCode && (
                  <span className="ml-2 align-middle font-mono text-[11px] text-muted-foreground">
                    {r.employeeCode}
                  </span>
                )}
              </td>
              <td className={cn(adminTd, TD_NUM, "font-semibold")}>{so(r.units)}</td>
              <td className={cn(adminTd, TD_NUM, "text-muted-foreground")}>
                {r.expectedUnits === 0 ? (
                  <span className={cn(PILL, "bg-muted text-muted-foreground")}>Chưa có ca</span>
                ) : (
                  so(r.expectedUnits)
                )}
              </td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.leaveUnits)}</td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.holidayPaidUnits)}</td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.hourCredit)}</td>
              <td className={cn(adminTd, TD_NUM)}>
                {gio(r.workedMinutes)}
                <span className="text-xs text-muted-foreground"> / {gio(r.expectedMinutes)}</span>
              </td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.lateCount)}</td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.earlyLeaveCount)}</td>
              <td className={cn(adminTd, TD_NUM)}>{soHoacGach(r.missingTapDays)}</td>
              <td className={cn(adminTd, TD_NUM)}>
                {r.overrideDays && r.overrideHref ? (
                  <Link
                    href={r.overrideHref}
                    title={`Xem ngày bị ghi đè của ${r.name}`}
                    className="font-semibold text-primary-ink hover:underline"
                  >
                    {so(r.overrideDays)}
                  </Link>
                ) : (
                  soHoacGach(r.overrideDays)
                )}
              </td>
              <td className={cn(adminTd, TD_NUM)}>
                {r.flaggedDays ? (
                  r.drillHref ? (
                    <Link
                      href={r.drillHref}
                      title={`Xem ngày có cờ của ${r.name}`}
                      className={cn(PILL, "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft-hover")}
                    >
                      {so(r.flaggedDays)}
                      <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
                    </Link>
                  ) : (
                    <span className={cn(PILL, "bg-state-warning-soft text-state-warning-ink")}>{so(r.flaggedDays)}</span>
                  )
                ) : (
                  "—"
                )}
              </td>
              <td className={cn(adminTd, TD_NUM, "font-semibold")}>{soHoacGach(r.teachingSessions)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-border bg-muted font-semibold">
              <td className={cn(adminTd, "sticky left-0 z-10 bg-muted font-semibold")}>
                Tổng {so(totals.people)} người
              </td>
              <td className={cn(adminTd, TD_NUM, "font-semibold")}>{so(totals.units)}</td>
              <td colSpan={9} />
              <td className={cn(adminTd, TD_NUM, "font-semibold")}>{soHoacGach(totals.flaggedDays)}</td>
              <td className={cn(adminTd, TD_NUM, "font-semibold")}>{soHoacGach(totals.teachingSessions)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      </PhanTrangBang>
    </div>
  );
}
