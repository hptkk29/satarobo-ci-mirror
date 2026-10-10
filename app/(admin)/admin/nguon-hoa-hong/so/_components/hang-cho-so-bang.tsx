// app/(admin)/admin/nguon-hoa-hong/so/_components/hang-cho-so-bang.tsx — HÀNG CHỜ TRƯỚC SỔ (06 §2.2, §6): mỗi dòng là MỘT việc chưa đủ căn cứ để ghi sổ.
//
// Mỗi dòng trả lời hai câu: VÌ SAO chưa ghi sổ (lý do bằng chữ) và LÀM GÌ TIẾP (việc + link đúng chỗ — chỉ có link khi người xem mở được trang đích).
// Không phát minh trạng thái: pill là mã hàng chờ CÓ SẴN của engine; ca đơn không lead có nhãn riêng "Đơn chưa nối lead" và dẫn tới ĐƠN, không bịa nguồn.
//
// Ngoại lệ mật độ có chủ đích (DESIGN.md §2 "bảng mà mỗi dòng là một VĂN BẢN"): ô Lý do xếp tối đa 2 dòng chữ (`line-clamp-2`), ô Việc tiếp theo 1 dòng chữ + 1 dòng link,
// nên chiều cao dòng đều nhau theo SỐ DÒNG CHỮ cố định (`h-[3.75rem]`), không do trình duyệt tự xuống dòng. Chữ bị cắt có `title` ở chính ô đó (không có lớp phủ bấm nào
// ở bảng này — chỉ link "Việc tiếp theo" là phần tử tương tác, nên không có affordance nói dối).
//
// Ba mức bề rộng (chụp thật 1280/768/375: bản năm cột cố định đẩy "Việc tiếp theo" — nửa còn lại của câu hỏi "làm gì tiếp" — ra ngoài màn ở tablet và điện thoại):
//   · ≥ lg: năm cột; · < lg: hai cột Việc | Vì sao, "Việc tiếp theo" + Học viên · Cơ sở + Tiền treo xếp DƯỚI lý do (cùng nội dung, `lg:hidden`; `display:none` nên không nhân đôi trong cây a11y);
//   · < md: cột Việc hẹp lại, nhãn pill được phép xuống dòng.
import Link from "next/link";
import { CornerDownRight, ExternalLink } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { HangChoPill } from "@/components/admin/nguon-hoa-hong/commission-status-pill";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { DongHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { NutDoiKySau } from "./nut-doi-ky-sau";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3 py-2 align-middle");
/** Dòng "việc tiếp theo": MỘT component, hai chỗ vẽ (cột riêng ở ≥ lg, dưới lý do ở < lg) — hai bản chép tay sẽ lệch nhau. */
function ViecTiep({ d, coTheDoiKy, duoiLyDo = false }: { d: DongHangChoSo; coTheDoiKy: boolean; duoiLyDo?: boolean }) {
  return (
    <>
      {duoiLyDo ? (
        // Dưới lý do: tách khỏi lý do bằng mũi tên + đậm hơn (hai câu cùng cỡ chữ xếp liền nhau đọc như một đoạn), và cho xuống dòng thay vì cắt — đây là việc phải làm.
        <span className="flex items-start gap-1 whitespace-normal font-medium">
          <CornerDownRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {d.buoc}
        </span>
      ) : (
        <span className="block truncate" title={d.buoc}>
          {d.buoc}
        </span>
      )}
      {d.lienKet && (
        <Link href={d.lienKet.href} className="inline-flex items-center gap-1 text-xs font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {d.lienKet.nhan}
          <ExternalLink aria-hidden className="h-3 w-3" />
        </Link>
      )}
      {/* Nút chỉ khi hàng chờ DỜI ĐƯỢC (`d.doiDuoc`) VÀ người xem giữ đúng quyền mà action kiểm. Hai điều kiện, mỗi điều kiện một nguồn — không viết lại điều kiện mã ở đây. */}
      {coTheDoiKy && d.doiDuoc && (
        <span className="mt-1 block">
          <NutDoiKySau holdId={d.id} tenMa={d.tenMa} kyChan={d.kyChan} />
        </span>
      )}
    </>
  );
}

const TU_LG = "hidden lg:table-cell";
const CHU_2_DONG = "line-clamp-2 whitespace-normal break-words leading-5";

/** "2026-10" → "10/2026". */

export function HangChoSoBang({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  coTheDoiKy,
}: {
  dong: DongHangChoSo[];
  tong: number;
  trang: number;
  kichThuoc: number;
  hrefTrang: (trang: number) => string;
  /** Người xem giữ `commission_periods:manage` (đúng key của `doiHangChoSangKySauAction`). BẮT BUỘC, không mặc định: prop cờ mặc định `false` mà không ai truyền = nút biến mất câm (CLAUDE.md luật 11). */
  coTheDoiKy: boolean;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="relative overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left lg:min-w-[968px]">
            {/* Bề rộng cột CHỐT: bảng chữ không để trình duyệt tự chia (cột Lý do bị bóp còn ~150px, cắt cụt câu). */}
            <colgroup>
              <col className="w-[7.5rem] md:w-[12.5rem]" />
              <col className="lg:w-[16rem]" />
              <col className="hidden w-[9rem] lg:table-column" />
              <col className="hidden w-[6rem] lg:table-column" />
              <col className="hidden w-[17rem] lg:table-column" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Việc
                </th>
                <th scope="col" className={TH}>
                  Vì sao chưa ghi sổ
                </th>
                <th scope="col" className={cn(TH, TU_LG)}>
                  Học viên · Cơ sở
                </th>
                <th scope="col" className={cn(TH, TU_LG, "text-right")} title="Phần hoa hồng của vai chưa có người nhận">
                  Tiền treo
                </th>
                <th scope="col" className={cn(TH, TU_LG)}>
                  Việc tiếp theo
                </th>
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className={cn(adminTr, "h-[3.75rem]")}>
                  <td className={TD}>
                    <span className="flex flex-col items-start gap-0.5">
                      <HangChoPill ma={d.ma} laDonChuaNoiLead={d.khongCoLead} className="max-md:whitespace-normal max-md:text-left max-md:leading-tight" />
                      {/* Chỉ đánh dấu NGOẠI LỆ: "chặn khoá" là mặc định của hầu hết dòng, lặp ở mọi dòng chỉ là nhiễu (số tổng nằm ở dòng đếm phía trên bảng). */}
                      {d.nhom !== "CHAN_KHOA_KY" ? <span className="text-xs text-muted-foreground">Không chặn khoá</span> : d.kyChan ? <span className="text-xs text-muted-foreground">Chặn kỳ {kyHienThi(d.kyChan)}</span> : null}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className={CHU_2_DONG} title={d.lyDo}>
                      {d.lyDo}
                    </span>
                    {/* < lg: ba cột bên phải không còn chỗ ⇒ phần còn lại của câu trả lời nằm ngay dưới lý do. */}
                    <div className="mt-1 space-y-0.5 lg:hidden" data-viec-duoi-ly-do="">
                      <ViecTiep d={d} coTheDoiKy={coTheDoiKy} duoiLyDo />
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.tenHocVien ?? "Chưa có học viên"} · {d.coSo ? (d.coSo.code ?? d.coSo.ten) : "Chưa quy được cơ sở"}
                      </span>
                      {d.tienVai !== null && (
                        <span data-tien-treo="" className="block text-xs tabular-nums text-muted-foreground">
                          Tiền treo {dinhDangDong(d.tienVai)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(TD, TU_LG)}>
                    <span className="block truncate" title={d.tenHocVien ?? undefined}>
                      {d.tenHocVien ?? <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{d.coSo ? (d.coSo.code ?? d.coSo.ten) : "Chưa quy được cơ sở"}</span>
                  </td>
                  <td className={cn(TD, TU_LG, "text-right tabular-nums")}>{d.tienVai !== null ? dinhDangDong(d.tienVai) : <span className="text-muted-foreground">—</span>}</td>
                  <td className={cn(TD, TU_LG)}>
                    <ViecTiep d={d} coTheDoiKy={coTheDoiKy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Hiển thị{" "}
          <b className="tabular-nums text-foreground">
            {soVN(tu)}–{soVN(den)}
          </b>{" "}
          / {soVN(tong)} việc
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
