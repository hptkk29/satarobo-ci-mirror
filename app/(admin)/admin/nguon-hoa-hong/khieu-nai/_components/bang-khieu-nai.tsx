// Bảng khiếu nại (RSC) — 06 §5.5. Mỗi dòng là MỘT khiếu nại; cả dòng là vùng bấm mở Sheet (`?mo=<id>`), bấm ở đâu trên dòng cũng được (luật 12: có chevron ⇒ bấm được).
//
// Cột "Người khiếu nại" CHỈ có với người DUYỆT: người chỉ gửi khiếu nại thì mọi dòng đều là của họ — một cột toàn tên mình là nhiễu. Dòng 44px, `whitespace-nowrap` cả `th` lẫn
// `td` (DESIGN.md §2); ô nào dài thì tự `truncate` kèm `title`. Tuổi chỉ in cho khiếu nại ĐANG MỞ — đã quyết thì "mở 12 ngày" là con số vô nghĩa.
//
// Bố cục (rà soát Impeccable 09/10): bảng chen trong khung ~976px (sidebar 256px) nên ô hẹp hơn mặc định (px-3) và tổng các trần `max-w` phải VỪA khung — bản đầu cột "Gửi lúc" và
// chevron bị cắt ở 1280px. Số tiền có CỘT RIÊNG (căn phải, không `truncate`): cột "Về" cắt đúng chỗ phân biệt hai khiếu nại. Cơ sở in MÃ ("CS1"), tên đầy đủ ở `title` và trong Sheet; tuổi khiếu nại đang mở đi liền ngày ("08/10 · 3 ngày", bỏ năm để vừa khung).
// "Người xử lý" chỉ hiện từ 2xl; dưới đó nó nằm trong Sheet. Dưới `md` không có bảng: mỗi khiếu nại là một khối xếp dọc — bảng cuộn ngang ở 375px giấu mất cột Kết quả, thứ người duyệt
// cần nhìn đầu tiên.
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { inkKetQuaHienThi, maKhieuNai, moTaDich, moTaDichNgan, nhanKetQuaHienThi, toneKetQuaHienThi, tuoiMo } from "@/components/admin/nguon-hoa-hong/nhan-khieu-nai";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { ngayDMYTuMoc } from "@/lib/hoa-hong/dinh-dang";
import type { DongKhieuNai } from "@/lib/hoa-hong/khieu-nai-doc";
import { laDangMo } from "@/lib/hoa-hong/khieu-nai-trang-thai";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-2.5");
const TD = cn(adminTd, "px-2.5");

export function BangKhieuNai({ dong, hrefMo, hienNguoiKhieuNai }: { dong: DongKhieuNai[]; hrefMo: (id: string) => string; hienNguoiKhieuNai: boolean }) {
  return (
    <>
      <div className={cn(VO_BANG, "hidden md:block")}>
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Mã
                </th>
                <th scope="col" className={TH}>
                  Kết quả
                </th>
                {hienNguoiKhieuNai && (
                  <th scope="col" className={TH}>
                    Người khiếu nại
                  </th>
                )}
                <th scope="col" className={TH}>
                  Về
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Số tiền
                </th>
                <th scope="col" className={TH}>
                  Cơ sở
                </th>
                <th scope="col" className={cn(TH, "hidden 2xl:table-cell")}>
                  Người xử lý
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Gửi lúc
                </th>
                <th scope="col" aria-label="Mở" className={cn(TH, "w-10")} />
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={cn(TD, "tabular-nums text-muted-foreground")}>
                    <Link href={hrefMo(d.id)} className="font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0" aria-label={`Mở khiếu nại ${maKhieuNai(d.id)}`}>
                      {maKhieuNai(d.id)}
                    </Link>
                  </td>
                  <td className={TD}>
                    <StatusPill tone={toneKetQuaHienThi(d.ketQua, d.trangThai)} className={inkKetQuaHienThi(d.ketQua, d.trangThai)}>
                      {nhanKetQuaHienThi(d.ketQua, d.trangThai)}
                    </StatusPill>
                  </td>
                  {hienNguoiKhieuNai && (
                    <td className={cn(TD, "max-w-[7rem] truncate")} title={d.nguoiKhieuNai.ten}>
                      {d.nguoiKhieuNai.ten}
                      {d.laCuaToi && <span className="ml-1.5 text-xs text-muted-foreground">(bạn)</span>}
                    </td>
                  )}
                  <td className={cn(TD, "max-w-[10rem] truncate")} title={moTaDich(d.dich)}>
                    {moTaDichNgan(d.dich)}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{dinhDangDong(d.dich.soTien)}</td>
                  <td className={cn(TD, "max-w-[5rem] truncate text-muted-foreground")} title={d.coSoTen}>
                    {d.coSoMa}
                  </td>
                  <td className={cn(TD, "hidden max-w-[9rem] truncate 2xl:table-cell")} title={d.nguoiXuLy?.ten}>
                    {d.nguoiXuLy ? d.nguoiXuLy.ten : <span className="text-muted-foreground">Chưa có</span>}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>
                    {/* Khiếu nại ĐANG MỞ: "dd/mm · N ngày" — tuổi là chỉ báo ưu tiên xử lý nên KHÔNG được mất khi bảng hẹp (năm bỏ đi, đã có ở `title`). Đã quyết: ngày đầy đủ. */}
                    {laDangMo(d.trangThai) ? (
                      <span title={ngayDMYTuMoc(d.taoLuc)}>
                        {ngayDMYTuMoc(d.taoLuc).slice(0, 5)} · {tuoiMo(d.soNgayMo)}
                      </span>
                    ) : (
                      ngayDMYTuMoc(d.taoLuc)
                    )}
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
              <Link href={hrefMo(d.id)} className="font-medium tabular-nums text-foreground after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Mở khiếu nại ${maKhieuNai(d.id)}`}>
                {maKhieuNai(d.id)}
              </Link>
              <StatusPill tone={toneKetQuaHienThi(d.ketQua, d.trangThai)} className={inkKetQuaHienThi(d.ketQua, d.trangThai)}>
                {nhanKetQuaHienThi(d.ketQua, d.trangThai)}
              </StatusPill>
            </div>
            <p className="mt-1 break-words text-sm text-foreground">
              {hienNguoiKhieuNai && (
                <>
                  {d.nguoiKhieuNai.ten}
                  {d.laCuaToi ? " (bạn)" : ""} ·{" "}
                </>
              )}
              {moTaDichNgan(d.dich)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <b className="text-sm font-semibold tabular-nums text-foreground">{dinhDangDong(d.dich.soTien)}</b>
              <span title={d.coSoTen}>{d.coSoMa}</span>
              <span className="tabular-nums">
                {ngayDMYTuMoc(d.taoLuc)}
                {laDangMo(d.trangThai) ? ` · ${tuoiMo(d.soNgayMo)}` : ""}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
