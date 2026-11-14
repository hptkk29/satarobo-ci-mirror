// app/(admin)/admin/nguon-hoa-hong/so/_components/dai-so-cu.tsx — DẢI THÔNG TIN trước cutover (06 §6 "Trước cutover"): hoa hồng các kỳ TRƯỚC mốc vẫn chốt ở sổ cũ.
// Chỉ nói điều đúng: kỳ cuối của sổ cũ = tháng ngay trước mốc. Link sang sổ cũ CHỈ khi người xem mở được (`/crm/commission` gác `payments:manage`).
import Link from "next/link";
import { Info } from "lucide-react";

import { congThang } from "@/lib/hoa-hong/ky-hoa-hong";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";

export function DaiSoCu({ moc, coTheMoSoCu }: { moc: string | null; coTheMoSoCu: boolean }) {
  if (!moc || !/^\d{4}-\d{2}$/.test(moc)) return null;
  const cuoi = congThang(moc, -1);
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-lg bg-state-info-soft px-3 py-2.5 text-sm text-state-info-ink">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Hoa hồng đến hết <b className="tabular-nums">{kyHienThi(cuoi)}</b> vẫn chốt ở sổ cũ; sổ này chỉ có các kỳ từ{" "}
        <b className="tabular-nums">{kyHienThi(moc)}</b>.
        {coTheMoSoCu && (
          <>
            {" "}
            <Link href="/crm/commission" className="font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring">
              Xem sổ cũ
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
