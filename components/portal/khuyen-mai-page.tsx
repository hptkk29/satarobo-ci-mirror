import Link from "next/link";
import { ChevronLeft, Tag } from "lucide-react";
import type { KhuyenMaiChoPhuHuynh } from "@/lib/portal/khuyen-mai-ph";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// «Khuyến mãi» — các chương trình đang áp dụng (board M-Khuyen-mai). Chỉ-xem: KHÔNG hiện mã giảm giá, KHÔNG có nút «áp mã» —
// ưu đãi được áp lúc trung tâm lập đơn, ba mẹ chỉ cần liên hệ. Dữ liệu đã lọc ở `lib/portal/khuyen-mai-ph.ts`.
export function KhuyenMaiPage({ ds, coHopQua }: { ds: readonly KhuyenMaiChoPhuHuynh[]; coHopQua: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <Link
        href={coHopQua ? "/portal/qua-tang" : "/portal"}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {coHopQua ? "Quà tặng" : "Trang chủ"}
      </Link>
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">
          {ds.length > 0 ? `${ds.length} chương trình đang áp dụng` : "Khuyến mãi"}
        </span>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px]">Khuyến mãi</h1>
        <p className="text-sm leading-[22px] text-[var(--sr-ink-muted)]">
          Ưu đãi hiện có của trung tâm. Ba mẹ liên hệ trung tâm để được áp dụng khi đăng ký hoặc đóng học phí.
        </p>
      </header>

      {ds.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-8 text-center">
          <div className="text-base font-bold">Hiện chưa có chương trình khuyến mãi nào</div>
          <div className="mt-1.5 text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">
            Khi có ưu đãi mới, chương trình sẽ hiện ở đây.
          </div>
        </div>
      ) : (
        ds.map((k) => (
          <article key={k.id} className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-11 flex-none items-center justify-center rounded-xl bg-[#fff1e4] text-[#c2570c]">
                <Tag className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 className="text-lg font-bold leading-6">{k.ten}</h2>
                <span className="text-[13px] font-semibold text-[var(--sr-orange-text)]">Áp dụng đến {k.hetHan}</span>
              </div>
            </div>
            <p className="whitespace-pre-line text-[15px] leading-6">{k.loiIch}</p>
            {k.dieuKien ? (
              <p className="whitespace-pre-line rounded-xl bg-[var(--sr-tint-purple)] px-3.5 py-2.5 text-[13px] leading-5">
                <b>Điều kiện:</b> {k.dieuKien}
              </p>
            ) : null}
          </article>
        ))
      )}

      <a
        href={`tel:${SATA_ROBO_PHONE.tho}`}
        className="flex h-12 items-center justify-center rounded-[14px] bg-[var(--sr-purple)] text-[15px] font-bold text-white"
      >
        Gọi trung tâm {SATA_ROBO_PHONE.hien}
      </a>
    </div>
  );
}
