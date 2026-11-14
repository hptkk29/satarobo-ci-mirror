// app/(admin)/admin/nguon-hoa-hong/affiliate/_components/chuyen-xem.tsx — công tắc ba chế độ của tab Affiliate: Đối tác · Loại đối tác · Nhãn.
//
// Cùng MỘT route (`/nguon-hoa-hong/affiliate`), chế độ nằm trên URL `?xem=` — chia sẻ link, tải lại, nút Back đều đúng; mặc định (không tham số) là danh sách đối tác. Thêm route con là thêm một page
// phải qua lưới cổng quyền của module (`khung-wiring`), nên Loại · Nhãn là CHẾ ĐỘ của tab chứ không phải route riêng.
// Là các `<Link>` chứ không phải `<button>`: đổi chế độ là điều hướng, không cần JS. `soChoDuyet` null ⇒ không in số (không biết ≠ 0).
import Link from "next/link";
import { cn } from "@/lib/utils";
import { hrefVoi } from "@/lib/nguon-hoa-hong/url";

export const CHE_DO_XEM_AFFILIATE = ["doi-tac", "loai", "nhan"] as const;
export type CheDoXemAffiliate = (typeof CHE_DO_XEM_AFFILIATE)[number];

/** `?xem=` thô → chế độ hợp lệ; rác ⇒ danh sách đối tác (không ném, không đoán). */
export function docCheDoXemAffiliate(raw: string | null): CheDoXemAffiliate {
  return raw === "loai" || raw === "nhan" ? raw : "doi-tac";
}

const MUC =
  "inline-flex h-8 items-center whitespace-nowrap px-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:px-3";

const NHAN: Readonly<Record<CheDoXemAffiliate, string>> = { "doi-tac": "Đối tác", loai: "Loại đối tác", nhan: "Nhãn" };

export function ChuyenXem({ basePath, dangXem, soChoDuyet }: { basePath: string; dangXem: CheDoXemAffiliate; soChoDuyet: number | null }) {
  return (
    <nav aria-label="Chế độ xem" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-card">
      {CHE_DO_XEM_AFFILIATE.map((k, i) => (
        <Link
          key={k}
          href={hrefVoi(basePath, { xem: k === "doi-tac" ? null : k })}
          aria-current={dangXem === k ? "page" : undefined}
          className={cn(MUC, i > 0 && "border-l border-border", dangXem === k ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted")}
        >
          {NHAN[k]}
          {k === "doi-tac" && soChoDuyet !== null && soChoDuyet > 0 && <span className="ml-1.5 tabular-nums">({soChoDuyet} chờ duyệt)</span>}
        </Link>
      ))}
    </nav>
  );
}
