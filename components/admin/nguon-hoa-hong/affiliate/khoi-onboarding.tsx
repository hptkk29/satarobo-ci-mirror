// components/admin/nguon-hoa-hong/affiliate/khoi-onboarding.tsx — CHECKLIST «ĐÃ ĐỦ ĐỂ PHÁT LINK CHƯA» của trang chi tiết đối tác (AFF-L3a). Chỉ VẼ kết quả của `cacBuocOnboarding` + `danhGiaPhatLink`
// (lib/affiliate/onboarding-doi-tac.ts) — lý do hiện ra là nhãn của CHÍNH cổng `kiemChuoiLink`, không có điều kiện thứ hai ở đây (luật 12b).
// Không hook, không `"use client"`: server component.
import { Check, CircleDashed, Lock, TriangleAlert } from "lucide-react";
import type { BuocOnboarding, KetQuaSanSangPhatLink, TrangThaiBuoc } from "@/lib/affiliate/onboarding-doi-tac";
import { cn } from "@/lib/utils";

const BIEU_TUONG: Record<TrangThaiBuoc, { Icon: typeof Check; lop: string; nhan: string }> = {
  XONG: { Icon: Check, lop: "text-state-success-ink", nhan: "Xong" },
  CHUA: { Icon: CircleDashed, lop: "text-state-warning-ink", nhan: "Chưa xong" },
  CHAN: { Icon: Lock, lop: "text-muted-foreground", nhan: "Đang bị chặn" },
  TUY_CHON: { Icon: CircleDashed, lop: "text-muted-foreground", nhan: "Tuỳ chọn" },
};

export function KhoiOnboarding({ buoc, sanSang }: { buoc: readonly BuocOnboarding[]; sanSang: KetQuaSanSangPhatLink }) {
  return (
    <div>
      <ol aria-label="Các bước chuẩn bị đối tác" className="space-y-2">
        {buoc.map((b, i) => {
          const { Icon, lop, nhan } = BIEU_TUONG[b.trangThai];
          return (
            <li key={b.ma} data-buoc={b.ma} data-trang-thai={b.trangThai} className="flex items-start gap-3">
              <span aria-hidden className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current", lop)}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {i + 1}. {b.ten} <span className={cn("ml-1 text-xs font-normal", lop)}>{nhan}</span>
                </p>
                <p className="text-sm text-muted-foreground">{b.ghiChu}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {sanSang.theoChuongTrinh.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-foreground">Từng campaign</p>
          <ul aria-label="Điều kiện phát link theo campaign" className="space-y-2">
            {sanSang.theoChuongTrinh.map((c) => (
              <li key={c.membershipId} data-san-sang={c.sanSang ? "co" : "chua"} className="rounded-lg border border-border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  {c.campaignTen} <span className="font-mono text-xs font-normal text-muted-foreground">{c.campaignMa}</span>
                  <span className={cn("text-xs font-semibold", c.sanSang ? "text-state-success-ink" : "text-state-warning-ink")}>{c.sanSang ? "Đủ điều kiện phát link" : "Chưa đủ điều kiện"}</span>
                </p>
                {c.sanSang ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Website dùng được: {c.websiteDungDuoc.join(", ")}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {c.lyDo.map((l) => (
                      <li key={l} className="flex items-start gap-1.5 text-sm text-state-warning-ink">
                        <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
