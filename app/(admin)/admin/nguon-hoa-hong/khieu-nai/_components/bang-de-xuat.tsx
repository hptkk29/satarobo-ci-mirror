// Bảng ĐỀ XUẤT ĐIỀU CHỈNH đang mở (RSC) — hướng B+C. Mỗi dòng là MỘT đề xuất; cả dòng là vùng bấm mở Sheet (`?dx=<id>`), có chevron ⇒ bấm được (luật 12).
//
// Cột trả lời câu hỏi người duyệt hỏi theo thứ tự: LOẠI NÀO (mã + nguồn gốc) → TRÊN GIAO DỊCH NÀO → BAO NHIÊU TIỀN → ĐANG Ở ĐÂU TRONG QUY TRÌNH DUYỆT → TÔI LÀM ĐƯỢC GÌ.
// "Việc của bạn" lấy từ `d.viec` (cùng hàm với cổng của service), nên chữ "Duyệt cấp 2" không bao giờ hiện khi máy chủ sẽ từ chối. Đủ bảy dữ kiện (số tiền · giao dịch gốc · lý do · trạng thái ·
// người duyệt 1 · người duyệt 2 · kỳ ghi sổ) nằm trong Sheet; bảng chỉ giữ năm cột vừa khung ~976px. Dòng 44px, `whitespace-nowrap`, tiền căn phải. Dưới `md`: khối xếp dọc.
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { nhanSoTienDeXuat, nhanViecCuaBan } from "@/components/admin/nguon-hoa-hong/nhan-de-xuat";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { maDeXuat, NHAN_NGUON_GOC, nhanTrangThaiDeXuat, toneTrangThaiDeXuat } from "@/lib/hoa-hong/de-xuat-nhan";
import type { DeXuatHienThi } from "@/lib/hoa-hong/de-xuat-doc";
import { ngayDMYTuMoc } from "@/lib/hoa-hong/dinh-dang";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-2.5");
const TD = cn(adminTd, "px-2.5");

export function BangDeXuat({ dong, hrefMo }: { dong: DeXuatHienThi[]; hrefMo: (id: string) => string }) {
  return (
    <>
      <div className={cn(VO_BANG, "hidden md:block")}>
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Đề xuất
                </th>
                <th scope="col" className={TH}>
                  Giao dịch gốc
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Số tiền đề xuất
                </th>
                <th scope="col" className={TH}>
                  Trạng thái duyệt
                </th>
                <th scope="col" className={TH}>
                  Việc của bạn
                </th>
                <th scope="col" aria-label="Mở" className={cn(TH, "w-10")} />
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={TD}>
                    <Link href={hrefMo(d.id)} className="font-medium tabular-nums text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0" aria-label={`Mở đề xuất ${maDeXuat(d.id)}`}>
                      {maDeXuat(d.id)}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{NHAN_NGUON_GOC[d.nguonGoc]}</span>
                  </td>
                  <td className={cn(TD, "max-w-[11rem] truncate")} title={d.giaoDichGoc.maDon ? `Đơn ${d.giaoDichGoc.maDon}` : "Khoản thu"}>
                    {d.giaoDichGoc.maDon ? `Đơn ${d.giaoDichGoc.maDon}` : "Khoản thu"}
                    <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">thu {ngayDMYTuMoc(d.giaoDichGoc.ngayThu).slice(0, 5)}</span>
                  </td>
                  <td className={cn(TD, "text-right font-semibold tabular-nums", nhanSoTienDeXuat(d.soTien).ink)}>{nhanSoTienDeXuat(d.soTien).chinh}</td>
                  <td className={TD}>
                    <StatusPill tone={toneTrangThaiDeXuat(d.trangThai)}>{nhanTrangThaiDeXuat(d.trangThai, d.quanTri)}</StatusPill>
                    {d.capMot && (
                      <span className="ml-2 inline-block max-w-[8rem] truncate align-middle text-xs text-muted-foreground" title={`Cấp 1: ${d.capMot.nguoi.ten}`}>
                        Cấp 1: {d.capMot.nguoi.ten}
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, d.viec.duyet ? "font-medium text-primary-ink" : "text-muted-foreground")} title={d.viec.lyDoKhong ?? undefined}>
                    {nhanViecCuaBan(d)}
                  </td>
                  <td className={cn(TD, "w-10 text-muted-foreground")}>
                    <ChevronRight aria-hidden className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className={cn(VO_BANG, "divide-y divide-border md:hidden")}>
        {dong.map((d) => (
          <li key={d.id} className="relative px-4 py-3 pr-9 hover:bg-muted/40">
            <ChevronRight aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Link href={hrefMo(d.id)} className="font-medium tabular-nums text-foreground after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Mở đề xuất ${maDeXuat(d.id)}`}>
                {maDeXuat(d.id)}
              </Link>
              <StatusPill tone={toneTrangThaiDeXuat(d.trangThai)}>{nhanTrangThaiDeXuat(d.trangThai, d.quanTri)}</StatusPill>
            </div>
            <p className="mt-1 break-words text-sm text-foreground">
              {NHAN_NGUON_GOC[d.nguonGoc]} · {d.giaoDichGoc.maDon ? `đơn ${d.giaoDichGoc.maDon}` : "khoản thu"}
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <b className={cn("text-sm font-semibold tabular-nums", nhanSoTienDeXuat(d.soTien).ink)}>{nhanSoTienDeXuat(d.soTien).chinh}</b>
              <span title={d.coSoTen}>{d.coSoMa}</span>
              <span className={d.viec.duyet ? "font-medium text-primary-ink" : undefined}>{nhanViecCuaBan(d)}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
