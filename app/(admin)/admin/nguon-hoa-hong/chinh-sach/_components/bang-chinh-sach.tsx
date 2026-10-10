// BẢNG CHÍNH SÁCH ĐẦY ĐỦ (06 §5.2): Mã · Vai hưởng · Loại GD · Phạm vi · Tỉ lệ · Phiên bản · Văn bản · Hiệu lực · Trạng thái.
// Server component thuần; mỗi chính sách MỘT dòng, đại diện bằng phiên bản "hiện hành" (`chonPhienBanHienHanh`). Dòng 44px:
// `whitespace-nowrap` + ô nào có chữ dài thì `max-w … truncate` kèm `title` trên liên kết.
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { PolicyVersionBadge, TrangThaiPhienBanPill } from "@/components/admin/nguon-hoa-hong/policy-version-badge";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import type { DongChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { khoangHieuLucNgan } from "@/lib/hoa-hong/dinh-dang";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

/** Tên NGẮN của loại giao dịch trong ô Tỉ lệ ("Mới 9% · Tái tục 3%"): cột "Loại GD" của brief gộp vào đây để bảng vừa khung 976px. */
const NGAN_LOAI: Record<string, string> = { NEW: "Mới", RENEWAL: "Tái tục" };

function vaiNgan(vai: { name: string }[]): string {
  if (vai.length === 0) return "—";
  if (vai.length <= 2) return vai.map((v) => v.name).join(", ");
  return `${vai[0]!.name}, ${vai[1]!.name} +${vai.length - 2}`;
}

export function BangChinhSach({ dong, now }: { dong: DongChinhSach[]; now: Date }) {
  return (
    <div className={VO_BANG}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>Mã · Phiên bản</th>
              <th scope="col" className={TH}>Vai hưởng</th>
              <th scope="col" className={TH}>Phạm vi</th>
              <th scope="col" className={cn(TH, "text-right")}>Tỉ lệ</th>
              <th scope="col" className={TH}>Văn bản</th>
              <th scope="col" className={TH}>Hiệu lực</th>
              <th scope="col" className={TH}>Trạng thái</th>
              <th scope="col" aria-label="Mở" className={cn(TH, "w-8")} />
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => {
              const tieuDe = `${d.name} · ${d.policyCode} · sở hữu: ${d.chuSoHuu}`;
              return (
                <tr key={d.policyId} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <Link href={`/nguon-hoa-hong/chinh-sach/${d.policyId}`} title={tieuDe} className="max-w-[13rem] truncate font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0">
                        {d.policyCode}
                      </Link>
                      <PolicyVersionBadge versionNo={d.versionNo} />
                      {d.coBanNhap && <span className="text-xs text-muted-foreground">+ nháp v{d.coBanNhap.versionNo}</span>}
                    </span>
                  </td>
                  <td className={cn(TD, "max-w-[11rem] truncate")}>
                    <span title={d.vai.map((v) => v.name).join(", ")}>{vaiNgan(d.vai)}</span>
                  </td>
                  <td className={cn(TD, "max-w-[9rem] truncate")} title={d.phamVi.nhanDai}>
                    {d.phamVi.nhan}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {d.tiLe.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      d.tiLe.map((t) => `${NGAN_LOAI[t.loai] ?? t.loai} ${t.tongPhanTram}%${t.khongTinDuoc ? "+" : ""}`).join(" · ")
                    )}
                  </td>
                  <td className={cn(TD, "max-w-[9rem] truncate")}>{d.vanBan ?? <span className="text-state-warning-ink">Chưa gắn</span>}</td>
                  <td className={cn(TD, "tabular-nums text-muted-foreground")}>{khoangHieuLucNgan(d.effectiveFrom, d.effectiveTo)}</td>
                  <td className={TD}>
                    <TrangThaiPhienBanPill status={d.status} effectiveFrom={d.effectiveFrom} effectiveTo={d.effectiveTo} now={now} />
                  </td>
                  <td className={cn(TD, "w-10 text-muted-foreground")}>
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
