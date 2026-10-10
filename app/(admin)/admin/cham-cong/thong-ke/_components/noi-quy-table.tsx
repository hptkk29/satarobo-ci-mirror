"use client";

// Bảng thống kê nội quy tháng — mỗi dòng một người.
//
// Vì sao tách khỏi bảng Kỳ công: hai bảng trả lời hai câu khác nhau. Kỳ công trả lời "bao nhiêu
// công để trả lương" (đếm theo KẾ HOẠCH, luật T-01). Bảng này trả lời "kỷ luật quét thế nào"
// (đếm theo BẰNG CHỨNG CÓ MẶT). Gộp vào một bảng 13 cột đã 1100px là hỏng cả hai, và tệ hơn là
// mời người đọc so hai cột vốn không so được với nhau.
//
// Mọi ô đã định dạng sẵn ở server (số, phần trăm) — component client không tự format, vì
// `toLocaleString` chạy trên máy người dùng thì lệch locale.
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";

export type NoiQuyRow = {
  userId: string;
  name: string;
  employeeCode: string | null;
  /** "22 / 26" hoặc "—". */
  caLabel: string;
  /** 0–1, hoặc null khi chưa có ca nào. */
  tyLe: number | null;
  tyLeLabel: string;
  soLanTre: number;
  ngayKhongPhep: number;
  ngayChoKetLuan: number;
  /** "3,5%" — đã định dạng. */
  truLabel: string;
  truCoSo: boolean;
  /** Bảng công ngày lọc sẵn ngày vắng của CHÍNH người này, để đi kết luận. */
  choKetLuanHref: string | null;
};

const TD_NUM = "text-right tabular-nums";
const TH_NUM = "text-right";

/** Ngưỡng tô màu tỷ lệ đạt. Dưới 90% là đáng nhìn, dưới 75% là đáng hỏi. */
function toneTyLe(t: number | null): string {
  if (t === null) return "text-muted-foreground";
  if (t < 0.75) return "text-state-danger-ink font-semibold";
  if (t < 0.9) return "text-state-warning-ink font-semibold";
  return "text-foreground";
}

export function NoiQuyTable({ rows }: { rows: NoiQuyRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="thong-ke-noi-quy">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={cn(adminTh, "sticky left-0 z-10 bg-muted/40 px-3")}>
                Nhân sự
              </th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Ca thực tế / quy định</th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Tỷ lệ</th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Lần trễ</th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Nghỉ không phép</th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>Chờ kết luận</th>
              <th scope="col" className={cn(adminTh, "px-3", TH_NUM)}>% trừ nội quy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={cn(adminTr, "h-11")}>
                <td className={cn(adminTd, "sticky left-0 z-10 bg-card py-0")}>
                  <span className="inline-block max-w-[13rem] truncate align-middle font-medium" title={r.name}>
                    {r.name}
                  </span>
                  {r.employeeCode && (
                    <span className="ml-2 align-middle font-mono text-[11px] text-muted-foreground">
                      {r.employeeCode}
                    </span>
                  )}
                </td>
                <td className={cn(adminTd, TD_NUM, "py-0 font-semibold")}>{r.caLabel}</td>
                <td className={cn(adminTd, TD_NUM, "py-0", toneTyLe(r.tyLe))}>{r.tyLeLabel}</td>
                <td className={cn(adminTd, TD_NUM, "py-0")}>
                  {r.soLanTre ? r.soLanTre : <span className="text-muted-foreground">–</span>}
                </td>
                <td className={cn(adminTd, TD_NUM, "py-0")}>
                  {r.ngayKhongPhep ? (
                    <span className={cn(PILL, "bg-state-danger-soft text-state-danger-ink")}>
                      {r.ngayKhongPhep}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                {/* "Chờ kết luận" là VIỆC CÒN PHẢI LÀM, không phải tiền phạt — nên nó bấm được
                    để đi tới đúng ngày cần xem, và cố ý KHÔNG tô đỏ như cột bên trái. */}
                <td className={cn(adminTd, TD_NUM, "py-0")}>
                  {r.ngayChoKetLuan ? (
                    r.choKetLuanHref ? (
                      <Link
                        href={r.choKetLuanHref}
                        title={`Xem ngày vắng chưa kết luận của ${r.name}`}
                        className="font-semibold text-primary-ink hover:underline"
                      >
                        {r.ngayChoKetLuan}
                      </Link>
                    ) : (
                      <span className="font-semibold">{r.ngayChoKetLuan}</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={cn(adminTd, TD_NUM, "py-0 font-semibold")}>
                  {r.truCoSo ? (
                    <span className="text-state-danger-ink">{r.truLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
