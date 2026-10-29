// components/admin/nguon-hoa-hong/khoi-vuot-tran.tsx — KHỐI «VƯỢT TRẦN» (chủ dự án chốt 09/10/2026: nâng trần là thao tác của admin; hệ thống không tự nâng, không tự cắt).
//
// Trình bày thuần. Ba con số lấy từ `huongXuLy` do MÁY CHỦ dựng (tổng LỚN NHẤT trong lưới kiểm trần, trần đang áp, chênh) — không đọc lại `dl.tran` của client, không bóc con số
// từ câu `thongBao`. Lối ra do `quyetDinhLoiRaTran` quyết theo QUYỀN của người xem: liên kết tới Cấu hình vận hành CHỈ vẽ cho người có quyền sửa ô trần (`settings:edit`); người khác
// thấy câu nói ai nâng được. KHÔNG có nút «nâng trần» tại chỗ — sửa trần là một thao tác có lý do, có nhật ký ở màn Cấu hình vận hành, không phải một cú bấm trong trình soạn.
//
// Hình: nền danger-soft + chữ, KHÔNG viền / vạch bên (craft-floor cấm border-left > 1px ở callout; và nó nằm trong thanh điều kiện / bước Kích hoạt vốn đã có khung — không thẻ lồng thẻ).
import Link from "next/link";

import type { HuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";
import { quyetDinhLoiRaTran } from "@/lib/hoa-hong/loi-ra-vuot-tran";
import { cn } from "@/lib/utils";

/** Liên kết nâng trần — chỉ khi người xem có quyền. Dùng riêng ở Thử tính, nơi câu cảnh báo đã nói đủ nên chỉ cần liên kết. */
export function LienKetNangTran({ duongDan, coQuyenSuaTran, className }: { duongDan: HuongXuLyTran["duongDan"]; coQuyenSuaTran: boolean; className?: string }) {
  const lienKet = quyetDinhLoiRaTran({ duongDan, coQuyenSuaTran }).lienKet;
  if (!lienKet) return null;
  return (
    <Link href={lienKet.href} className={cn("font-semibold underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring", className)}>
      Mở {lienKet.nhan} để nâng trần
    </Link>
  );
}

export function KhoiVuotTran({ huongXuLy, coQuyenSuaTran, className }: { huongXuLy: HuongXuLyTran; coQuyenSuaTran: boolean; className?: string }) {
  const loiRa = quyetDinhLoiRaTran({ duongDan: huongXuLy.duongDan, coQuyenSuaTran });
  return (
    <div data-testid="khoi-vuot-tran" className={cn("rounded-lg bg-state-danger-soft px-3 py-2.5", className)}>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
        <dt className="text-foreground">Tổng tỉ lệ hiện tại</dt>
        <dd className="text-right font-semibold tabular-nums text-foreground">{huongXuLy.tongPhanTram}%</dd>
        <dt className="text-foreground">Trần hiện tại</dt>
        <dd className="text-right font-semibold tabular-nums text-foreground">{huongXuLy.tranPhanTram}%</dd>
        <dt className="text-foreground">Phần vượt</dt>
        <dd className="text-right font-semibold tabular-nums text-state-danger-ink">{huongXuLy.chenhLechPhanTram} điểm phần trăm</dd>
      </dl>
      <p className="mt-2 break-words text-xs text-foreground">{loiRa.cauChu}</p>
      {loiRa.lienKet && (
        <p className="mt-1.5 text-xs">
          <LienKetNangTran duongDan={huongXuLy.duongDan} coQuyenSuaTran={coQuyenSuaTran} className="inline-flex min-h-11 items-center text-foreground sm:min-h-0" />
        </p>
      )}
    </div>
  );
}
