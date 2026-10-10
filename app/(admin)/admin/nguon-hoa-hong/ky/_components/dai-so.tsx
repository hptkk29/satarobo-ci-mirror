// app/(admin)/admin/nguon-hoa-hong/ky/_components/dai-so.tsx — dải 4 ô số của kỳ đang chọn (06 §5.4, khuôn `KpiStrip` của chấm công, `text-xl`).
//
// Hoa hồng và Điều chỉnh là HAI số cộng lại ra số phải chi (hoa hồng ghi mới + điều chỉnh âm/dương). Ô "Tổng hoa hồng" nói thẳng số phải chi ròng ở dòng phụ
// để không ai đọc nhầm hai ô thành một số đã trừ sẵn. Mọi số lấy từ DÒNG SỔ đã ghi (`tongHopTheoKy`) — kỳ chưa Tính thì có thể chưa đủ, và màn nói điều đó.
import { StatCard } from "@/components/admin/ui/stat-card";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";

export function DaiSo({
  coSoTinh,
  hoaHong,
  dieuChinh,
  soNguoi,
  chuaTinh,
}: {
  coSoTinh: number;
  hoaHong: number;
  dieuChinh: number;
  soNguoi: number;
  /** Kỳ còn OPEN (chưa Tính): số là phần đã ghi vào sổ, có thể chưa đủ. */
  chuaTinh: boolean;
}) {
  return (
    <section aria-label="Số liệu của kỳ" className="mb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard value={dinhDangDong(coSoTinh)} label="Tổng cơ sở tính" hint="Thu mới trong kỳ, sau VAT" wrapLabel />
        <StatCard value={dinhDangDong(hoaHong)} label="Tổng hoa hồng" hint={`Phải chi ròng ${dinhDangDong(hoaHong + dieuChinh)}`} wrapLabel />
        <StatCard
          value={dinhDangDong(dieuChinh)}
          label="Điều chỉnh"
          tone={dieuChinh < 0 ? "danger" : "brand"}
          hint="Hoàn tiền, đổi nguồn, khiếu nại"
          wrapLabel
        />
        <StatCard value={String(soNguoi)} label="Số người hưởng" hint="Có dòng trong kỳ" wrapLabel />
      </div>
      {chuaTinh && <p className="mt-2 text-xs text-muted-foreground">Kỳ chưa được Tính: các số trên chỉ là phần đã ghi vào sổ, có thể chưa đủ.</p>}
    </section>
  );
}
