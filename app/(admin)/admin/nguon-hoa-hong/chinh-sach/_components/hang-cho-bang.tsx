// HÀNG CHỜ CHÍNH SÁCH (06 §4.1, §5.2): mỗi dòng là một việc dang dở của chính sách. Server component thuần, dòng 44px.
//
// Cả dòng là vùng bấm CHỈ khi đích có thật và người xem vào được (`hrefViecHangCho`, luật 12): người chỉ-xem không bị dẫn vào
// trình soạn họ mở không được; việc "vai chưa có chính sách" với người chỉ-xem là một dòng không bấm được (họ cần THẤY nó).
// `title` nằm trên liên kết (lớp phủ `after:inset-0` che `title` ở <td> bên dưới).
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { hrefViecHangCho, NHAN_LOAI_HANG_CHO, type LoaiHangChoChinhSach, type ViecHangCho } from "@/lib/hoa-hong/hang-cho-chinh-sach";
import { ngayDMY } from "@/lib/hoa-hong/hang-rao-ui";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

const TONE: Record<LoaiHangChoChinhSach, PillTone> = {
  NHAP_THIEU_VAN_BAN: "warning",
  CHUA_DU_NGAY_LAM_VIEC: "warning",
  SAP_HIEU_LUC: "info",
  VAI_KHONG_CO_CHINH_SACH: "warning",
};
const INK: Record<PillTone, string> = { success: "text-state-success-ink", warning: "text-state-warning-ink", danger: "text-state-danger-ink", info: "text-state-info-ink", brand: "text-primary-ink", muted: "" };

export function HangChoChinhSachBang({ viec, coTheSoan }: { viec: ViecHangCho[]; coTheSoan: boolean }) {
  return (
    <div className={VO_BANG}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                Việc
              </th>
              <th scope="col" className={TH}>
                Chính sách
              </th>
              <th scope="col" className={TH}>
                Chi tiết
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Ngày
              </th>
              <th scope="col" aria-label="Mở" className={cn(TH, "w-8")} />
            </tr>
          </thead>
          <tbody>
            {viec.map((v) => {
              const href = hrefViecHangCho(v, coTheSoan);
              const ten = v.vai ? v.vai.name : (v.tenChinhSach ?? "");
              const tieuDe = `${ten}${v.policyCode ? ` · ${v.policyCode}` : ""} — ${v.lyDo}`;
              return (
                <tr key={`${v.loai}:${v.versionId ?? v.vai?.code}`} className={cn(adminTr, href && "relative cursor-pointer")}>
                  <td className={TD}>
                    <StatusPill tone={TONE[v.loai]} className={INK[TONE[v.loai]]}>
                      {NHAN_LOAI_HANG_CHO[v.loai]}
                    </StatusPill>
                  </td>
                  <td className={cn(TD, "max-w-[17rem] truncate")}>
                    {href ? (
                      <Link href={href} title={tieuDe} className="font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0">
                        {ten}
                      </Link>
                    ) : (
                      <span title={tieuDe} className="font-medium text-foreground">
                        {ten}
                      </span>
                    )}
                    {v.policyCode && <span className="ml-2 text-muted-foreground">{v.policyCode} · v{v.versionNo}</span>}
                  </td>
                  <td className={cn(TD, "max-w-[20rem] truncate text-muted-foreground")}>{v.lyDo}</td>
                  <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>
                    {v.ngay ? (v.loai === "SAP_HIEU_LUC" ? ngayDMY(v.ngay) : `từ ${ngayDMY(v.ngay)}`) : "—"}
                  </td>
                  <td className={cn(TD, "w-10 text-muted-foreground")}>{href && <ChevronRight aria-hidden className="h-4 w-4" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

