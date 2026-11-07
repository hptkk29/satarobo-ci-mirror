import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { MucVaCham } from "@/lib/disc/so-gia-dinh/chi-so";
import type { MaTruc } from "@/lib/disc/so-gia-dinh/kieu";

/**
 * Thành phần dùng chung của khu DISC (theo board Disc.dc.html): thanh mục · tiêu đề · ô tròn viết tắt · chip mức va chạm.
 * Server Component thuần. Màu qua token `--disc-*` (disc-so.css) và `--sr-*` của portal — không hex.
 */

export const MUC_DISC = ["gia-dinh", "ca-nhan", "the-cap", "ke-hoach", "thanh-vien"] as const;
export type MucDisc = (typeof MUC_DISC)[number] | "lam-bai" | "da-nhan";

const NHAN_MUC_DISC: Readonly<Record<(typeof MUC_DISC)[number], string>> = {
  "gia-dinh": "Gia đình",
  "ca-nhan": "Cá nhân",
  "the-cap": "Thẻ cặp",
  "ke-hoach": "Kế hoạch",
  "thanh-vien": "Thành viên & quyền",
};

export function duongMuc(m: (typeof MUC_DISC)[number]): string {
  return m === "gia-dinh" ? "/portal/disc" : `/portal/disc?muc=${m}`;
}

/**
 * Thanh mục DISC (board Disc.dc.html / M-Disc.dc.html): ≥ 640px là thanh ngang nền tím nhạt, mục đang xem nền trắng, «Làm bài» là nút cam cuối hàng;
 * < 640px là lưới 3 cột (nhãn cuối rút gọn «Quyền») để mọi mục thấy ngay, không phải cuộn ngang.
 */
export function DiscNav({ dang }: { dang: MucDisc }) {
  const item = "flex min-h-10 items-center justify-center rounded-[10px] px-1.5 text-center text-sm no-underline sm:inline-flex sm:h-10 sm:flex-none sm:whitespace-nowrap sm:px-3.5";
  return (
    <nav aria-label="Mục DISC" className="disc-cuon-ngang grid grid-cols-3 gap-1.5 rounded-[14px] bg-[var(--sr-tint-purple)] p-1.5 sm:flex sm:overflow-x-auto sm:p-1">
      {MUC_DISC.map((m) => {
        const dangXem = m === dang;
        return (
          <Link
            key={m}
            href={duongMuc(m)}
            aria-current={dangXem ? "page" : undefined}
            className={cn(
              item,
              dangXem ? "bg-card font-bold text-foreground shadow-[0_1px_2px_var(--sr-shadow)]" : "font-semibold text-[var(--sr-ink-muted)] hover:text-foreground",
            )}
          >
            {m === "thanh-vien" ? (
              <>
                <span className="sm:hidden">Quyền</span>
                <span className="hidden sm:inline">Thành viên &amp; quyền</span>
              </>
            ) : (
              NHAN_MUC_DISC[m]
            )}
          </Link>
        );
      })}
      <Link
        href="/portal/disc/lam-bai"
        aria-current={dang === "lam-bai" ? "page" : undefined}
        className={cn(item, "bg-[var(--sr-orange)] font-bold text-[var(--sr-on-orange)] hover:opacity-90 sm:ml-auto")}
      >
        Làm bài
      </Link>
    </nav>
  );
}

export function TieuDeDisc({ kicker, tieuDe, phu, phai }: { kicker: string; tieuDe: string; phu?: ReactNode; phai?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3.5">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
        <div className="break-words text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">{kicker}</div>
        <h1 className="font-display text-[26px] font-extrabold leading-[32px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">{tieuDe}</h1>
        {phu ? <div className="max-w-[680px] text-[15px] leading-[22px] text-[var(--sr-ink-muted)]">{phu}</div> : null}
      </div>
      {phai}
    </header>
  );
}

export function GhiChuDisc({ them }: { them?: string }) {
  return (
    <div role="note" className="rounded-[14px] bg-[var(--sr-tint-purple)] px-4 py-3 text-[13px] leading-5">
      DISC mô tả xu hướng hành vi, không phải đánh giá tâm lý hay tính cách cố định.{them ? ` ${them}` : ""}
    </div>
  );
}

/** Lớp màu của một nhóm: nền đặc + chữ tương phản, và nền nhạt. Chuỗi tĩnh để Tailwind quét được. */
export const MAU_TRUC: Readonly<Record<MaTruc, { dac: string; nhat: string; chu: string; vien: string }>> = {
  D: { dac: "bg-[var(--disc-d)] text-[var(--disc-d-chu)]", nhat: "bg-[var(--disc-d-nen)]", chu: "text-[var(--disc-d)]", vien: "border-[var(--disc-d)]" },
  I: { dac: "bg-[var(--disc-i)] text-[var(--disc-i-chu)]", nhat: "bg-[var(--disc-i-nen)]", chu: "text-[var(--disc-i)]", vien: "border-[var(--disc-i)]" },
  S: { dac: "bg-[var(--disc-s)] text-[var(--disc-s-chu)]", nhat: "bg-[var(--disc-s-nen)]", chu: "text-[var(--disc-s)]", vien: "border-[var(--disc-s)]" },
  C: { dac: "bg-[var(--disc-c)] text-[var(--disc-c-chu)]", nhat: "bg-[var(--disc-c-nen)]", chu: "text-[var(--disc-c)]", vien: "border-[var(--disc-c)]" },
};

/** Ô tròn viết tắt; màu theo nhóm chính (chưa có hồ sơ ⇒ xám); ước lượng ⇒ viền nét đứt. */
export function OTron({ chu, chinh, kich = 44, uocLuong = false, mo = false }: { chu: string; chinh: MaTruc | null; kich?: number; uocLuong?: boolean; mo?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: kich, height: kich }}
      className={cn(
        "flex flex-none items-center justify-center rounded-full text-[11px] font-extrabold",
        chinh && !mo ? MAU_TRUC[chinh].dac : "bg-[var(--sr-soft-off)] text-[var(--sr-soft-off-ink)]",
        uocLuong && "border-2 border-dashed border-[var(--sr-ink)]",
      )}
    >
      {chu}
    </span>
  );
}

export const LOP_MUC: Readonly<Record<MucVaCham, { chip: string; thanh: string; vien: string }>> = {
  cao: { chip: "bg-[var(--disc-cao-nen)] text-[var(--disc-cao-chu)]", thanh: "bg-[var(--disc-cao)]", vien: "border-[var(--disc-cao)]" },
  "trung-binh": { chip: "bg-[var(--disc-tb-nen)] text-[var(--disc-tb-chu)]", thanh: "bg-[var(--disc-tb)]", vien: "border-[var(--disc-tb)]" },
  thap: { chip: "bg-[var(--disc-thap-nen)] text-[var(--disc-thap-chu)]", thanh: "bg-[var(--disc-thap)]", vien: "border-[var(--disc-thap)]" },
};

export function ChipMuc({ muc, children }: { muc: MucVaCham; children: ReactNode }) {
  return <span className={cn("flex-none whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", LOP_MUC[muc].chip)}>{children}</span>;
}

export const KHUNG = "rounded-[18px] border border-border bg-card";
export const H2 = "m-0 text-xl font-bold";
export const NHAN_NHO = "text-xs font-bold uppercase tracking-[0.06em] text-[var(--sr-ink-muted)]";
export const NUT_CAM = "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-[var(--sr-orange)] px-3.5 text-[13px] font-bold text-[var(--sr-on-orange)] hover:opacity-90";
export const NUT_VIEN = "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-border px-3.5 text-[13px] font-bold text-foreground hover:bg-[var(--sr-soft-off)]";
export const NUT_TIM = "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-[var(--sr-purple)] px-3.5 text-[13px] font-bold text-white hover:opacity-90";
