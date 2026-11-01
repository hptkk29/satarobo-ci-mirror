// components/admin/cham-cong/bang-cong-thang-grid.tsx — lưới người × ngày, CHỈ ĐỌC.
//
// Server Component: không state, không handler, không `"use client"`. Lưới này chỉ để NHÌN —
// sửa ca ở `/cham-cong/phan-ca`, sửa công ở bảng công ngày. Tách hẳn hai mặt phẳng là có chủ
// đích: trộn màu kết quả vào một lưới mà ô là dropdown sửa ca thì người ta bấm nhầm.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÔNG MÃ HOÁ TRẠNG THÁI CHỈ BẰNG MÀU
//
// PRODUCT.md (Accessibility): "Trạng thái không được chỉ mã hoá bằng màu". Nên mỗi ô in MÃ CA
// làm chữ, trạng thái đi kèm ở `title` + một nhãn `sr-only`, và cột "Vi phạm" bên phải cho
// con số đọc được không cần nhìn màu. Người mù màu vẫn trả lời được câu
// "ai vi phạm nhiều" — bằng cột số, không bằng sắc độ.
//
// Thứ tự hàng do PAGE quyết định (xếp nặng → nhẹ). Component không tự sắp, để con số trên
// màn và con số trong file Excel không bao giờ lệch thứ tự.
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { MAU_O, type DauHieu, type DemMau, type MauO } from "@/lib/cham-cong/mau-o-cong";

/** "21,5" — dấu phẩy thập phân kiểu Việt, bỏ số 0 thừa. */
const soCong = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

const WD_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Cùng khuôn ô với lưới phân ca để hai màn đọc như một hệ. */
const O = "relative inline-flex h-8 w-12 items-center justify-center rounded text-xs font-semibold tabular-nums";

export type ONgayLuoi = {
  mau: MauO;
  dauHieu: DauHieu[];
  /** Mã ca in trong ô. `null` = không xếp ca. */
  code: string | null;
  /** Câu đầy đủ cho tooltip — PAGE dựng, component không suy diễn. */
  moTa: string;
};

export type HangLuoi = {
  userId: string;
  name: string;
  jobLabel: string | null;
  /** Theo số ngày trong tháng. */
  o: Record<number, ONgayLuoi | undefined>;
  dem: DemMau;
  tongCong: number;
  tongPhut: number;
  soDiMuon: number;
  soVeSom: number;
};

export type NgayLuoi = {
  day: number;
  /** 0 = CN … 6 = T7. */
  wd: number;
  /** "09/09" — cho nhãn trợ năng. */
  label: string;
  off: boolean;
  holiday: boolean;
  today: boolean;
};

/** Tô CỘT theo loại ngày — giống lưới phân ca, để hai màn không dạy hai thứ khác nhau. */
function dayTone(d: NgayLuoi): string {
  if (d.today) return "bg-primary-soft/40";
  if (d.holiday) return "bg-state-danger-soft/30";
  if (d.off) return "bg-muted/50";
  return "";
}

export function BangCongThangGrid({
  rows,
  days,
  blockLabel,
}: {
  rows: HangLuoi[];
  days: NgayLuoi[];
  blockLabel: string;
}) {
  // Tổng vi phạm theo NGÀY — một cột đỏ dựng đứng thường là quầy hỏng hoặc mất mạng hôm đó,
  // không phải 19 người cùng đi muộn. Không có dòng này thì người rà đi trách từng người.
  const nangTheoNgay = days.map((d) =>
    rows.reduce((s, r) => {
      const o = r.o[d.day];
      return s + (o && MAU_O[o.mau].nang ? 1 : 0);
    }, 0),
  );

  return (
    <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="cham-cong-bang-thang">
      <table className="w-full min-w-[1200px] text-xs">
        <caption className="sr-only">
          Bảng công tháng theo người và ngày. Mỗi ô là mã ca, màu nền là kết quả chấm công của
          ngày đó. Ba cột cuối là số ngày đi làm, thiếu mốc quét và vi phạm.
        </caption>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            {/* MỘT cột bám trái, và số vi phạm nằm NGAY TRONG nó.
                Bản 25/09 thử hai cột bám trái với mốc `left-56` — hỏng: `w-56` trong bảng
                auto-layout chỉ là gợi ý, cột tên render hẹp hơn 224px nên cột thứ hai đè lên
                cột ngày 1. Gắn thẳng vào ô tên thì không còn mốc nào để lệch. */}
            <th scope="col" className={cn(adminTh, "sticky left-0 z-20 bg-muted px-3 py-2")}>
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
            {/* Con số kế toán đọc ĐẦU TIÊN ⇒ đứng trước mấy cột đếm. Cộng từ `dayCreditEarned`
                của từng ngày, KHÔNG nhân lại từ mã ca. */}
            <th
              scope="col"
              className={cn(adminTh, "px-2 py-2 text-right")}
              title="Tổng công thực nhận cả tháng — cộng từ công của từng ngày"
            >
              Tổng công
            </th>
            <th scope="col" className={cn(adminTh, "px-2 py-2 text-right")} title="Số ngày đi làm đúng giờ">
              Đi làm
            </th>
            <th scope="col" className={cn(adminTh, "px-2 py-2 text-right")} title="Số ngày thiếu mốc quét — nộp đơn chỉnh công là xong">
              Thiếu lượt
            </th>
            <th scope="col" className={cn(adminTh, "px-2 py-2 text-right")} title="Số ngày quét vào sau giờ vào ca quá dung sai">
              Đi muộn
            </th>
            <th scope="col" className={cn(adminTh, "px-2 py-2 text-right")} title="Số ngày quét ra trước giờ tan ca quá dung sai">
              Về sớm
            </th>
            <th
              scope="col"
              className={cn(adminTh, "px-2 py-2 text-right")}
              title="Tổng ngày tính vào nội quy: đi muộn + về sớm + nghỉ không phép đã xác nhận"
            >
              Vi phạm
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} className={adminTr}>
              <td
                className={cn(adminTd, "sticky left-0 z-10 bg-card px-3 py-1 font-medium")}
                title={row.jobLabel ? `${row.name} · ${row.jobLabel}` : row.name}
              >
                {/* `max-w` + `truncate` phải ở SPAN: bảng auto-layout bỏ qua max-width trên
                    `<td>`, còn `adminTd` có `whitespace-nowrap` ⇒ ô không cắt chữ mà nở ra,
                    đẩy cả cột sticky rộng thêm. Cùng bẫy với lưới phân ca. */}
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {row.name}
                    {row.jobLabel && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        · {row.jobLabel}
                      </span>
                    )}
                  </span>
                  {row.dem.nang > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-state-danger/30 px-1.5 py-0.5 text-xs font-bold tabular-nums whitespace-nowrap text-state-danger-ink ring-1 ring-inset ring-state-danger/40"
                      title={`${row.dem.nang} ngày tính vào nội quy — ${row.soDiMuon} đi muộn · ${row.soVeSom} về sớm · ${row.dem.NGHI_KHONG_PHEP} nghỉ không phép`}
                    >
                      {row.dem.nang}
                      <span className="sr-only"> ngày vi phạm</span>
                    </span>
                  )}
                </span>
              </td>

              {days.map((d) => {
                const o = row.o[d.day];
                const meta = o ? MAU_O[o.mau] : MAU_O.TRONG;
                return (
                  <td key={d.day} className={cn("px-0.5 py-1.5 text-center", dayTone(d))}>
                    <span className={cn(O, meta.lopO)} title={o?.moTa}>
                      {o?.code ?? ""}
                      {o && o.dauHieu.length > 0 && (
                        <span
                          aria-hidden
                          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-70"
                        />
                      )}
                      <span className="sr-only">
                        {row.name} {WD_LABEL[d.wd]} {d.label}: {meta.nhan}
                      </span>
                    </span>
                  </td>
                );
              })}

              <td
                className={cn(adminTd, "px-2 py-1 text-right font-bold tabular-nums text-foreground")}
                title={row.tongPhut > 0 ? `${Math.floor(row.tongPhut / 60)}h${String(row.tongPhut % 60).padStart(2, "0")} làm thật` : undefined}
              >
                {row.tongCong > 0 ? soCong(row.tongCong) : <span className="font-normal text-muted-foreground">—</span>}
              </td>
              <td className={cn(adminTd, "px-2 py-1 text-right tabular-nums text-muted-foreground")}>
                {row.dem.DU_CONG || "—"}
              </td>
              <td className={cn(adminTd, "px-2 py-1 text-right tabular-nums")}>
                {row.dem.THIEU_LUOT > 0 ? (
                  <span className="font-semibold text-state-warning-ink">{row.dem.THIEU_LUOT}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={cn(adminTd, "px-2 py-1 text-right tabular-nums")}>
                {row.soDiMuon > 0 ? (
                  <span className="font-semibold text-state-danger-ink">{row.soDiMuon}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={cn(adminTd, "px-2 py-1 text-right tabular-nums")}>
                {row.soVeSom > 0 ? (
                  <span className="font-semibold text-state-danger-ink">{row.soVeSom}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={cn(adminTd, "px-2 py-1 text-right tabular-nums")}>
                {row.dem.nang > 0 ? (
                  <span className="font-bold text-state-danger-ink">{row.dem.nang}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot className="border-t border-border bg-muted/40">
          <tr>
            <th scope="row" className={cn(adminTh, "sticky left-0 z-20 bg-muted px-3 py-2")}>
              Vi phạm / ngày
            </th>
            {days.map((d, i) => (
              <td
                key={d.day}
                className={cn(
                  "px-1 py-2 text-center text-xs font-semibold tabular-nums",
                  dayTone(d),
                  nangTheoNgay[i] > 0 ? "text-state-danger-ink" : "text-muted-foreground",
                )}
                title={
                  nangTheoNgay[i] > 0
                    ? `${nangTheoNgay[i]} người vi phạm ngày ${d.label} — cả cột đỏ thường là quầy hỏng hoặc mất mạng, không phải cả khối cùng đi muộn`
                    : undefined
                }
              >
                {nangTheoNgay[i] || "·"}
              </td>
            ))}
            <td className={cn(adminTd, "px-2 py-2 text-right text-xs text-muted-foreground")} colSpan={6}>
              {blockLabel}
            </td>
          </tr>
        </tfoot>
      </table>
    </PhanTrangBang>
  );
}
