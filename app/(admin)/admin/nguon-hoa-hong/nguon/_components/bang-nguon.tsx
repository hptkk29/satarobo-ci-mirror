// app/(admin)/admin/nguon-hoa-hong/nguon/_components/bang-nguon.tsx — "TẤT CẢ NGUỒN" (06 §5.1): danh mục nguồn (9 nguồn mặc định + UNKNOWN + nguồn admin tự thêm), mỗi dòng mở trang chi tiết nguồn.
//
// Hôm nay danh mục chỉ có MỘT cấp (nhóm). Nguồn con (chiến dịch, tài sản, sự kiện) có từ PR7 — chưa có thì
// KHÔNG dựng cây giả: bảng này phẳng, và `soLead*` là số THẬT đếm qua Lead đã scope.
// Cả dòng là vùng bấm (luật 12): `<tr relative cursor-pointer>` + liên kết tên nguồn mang `after:inset-0`. Ô «Thao tác» nằm TRÊN lớp phủ (`relative z-10`) để nút
// bấm được mà không mở chi tiết.
//
// ── Cột ghi thật, nút ghi thật (luật 12) ───────────────────────────────────────────────────────────────────
//  · «Hoa hồng nguồn»: nguồn có tham gia hoa hồng THEO NGUỒN không (`commissionEnabled`) — «Không» không có nghĩa là không ai được hoa hồng: chính sách chung vẫn chạy.
//  · «Cửa sổ ghi công»: cửa sổ RIÊNG hay «Mặc định N ngày» (đọc từ setting) — nói cái nào, vì đổi mặc định chung kéo theo mọi nguồn «Mặc định».
//  · «Trạng thái»: dòng ACTIVE + chọn được mà NGOÀI khoảng hiệu lực hiện «Ngoài hiệu lực» thay cho «Đang dùng» — «Đang dùng» trần là nói dối khi lead mới không chọn được.
//  · Cột «Thao tác» chỉ có khi người xem ĐƯỢC GHI (`coTheGhi` = `sources:manage` ∧ module bật — cùng điều kiện mà Server Action kiểm); không phải nút xám.
//  · Không có nút xoá: danh mục chỉ lưu trữ.
// Bảng 7 cột (nhóm nguồn + yêu cầu nhập chung một ô, tổng lead + 30 ngày chung một ô, thao tác là hai nút BIỂU TƯỢNG) vừa khít khung ~976px ở 1280px (đo: scrollWidth = clientWidth = 974). Hẹp hơn thì ẩn dần cột phụ — «Nhóm nguồn» dưới `lg`, «Cửa sổ» + «Lead» dưới `xl` — chúng vẫn nằm ở trang chi tiết.
import Link from "next/link";
import { ChevronRight, Pencil } from "lucide-react";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { hrefSuaNguon } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/lien-ket-nguon";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { NutDoiTrangThai } from "@/components/admin/nguon-hoa-hong/doi-trang-thai-nguon";
import { NHAN_LOAI_NGUON, nhanCuaSo, nhanHoaHongNguon } from "@/components/admin/nguon-hoa-hong/nhan-danh-muc";
import { soVN, yeuCauNhap } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { NguonStatusPill } from "@/components/admin/nguon-hoa-hong/nguon-status-pill";
import type { DongDanhMucNguonMo } from "@/lib/nguon/doc-danh-muc";
import { cn } from "@/lib/utils";

/** Bảng 7 cột chen trong khung ~976px (sidebar 256px) ⇒ ô hẹp hơn mặc định (px-3, không px-5). */
const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
/** Cột phụ: «Nhóm nguồn» hiện từ `lg`, «Cửa sổ» + «Lead» từ `xl` (đo 09/10: đủ 7 cột + thao tác chỉ vừa khung 976px ở 1280px). Dưới đó vẫn đọc được ở trang chi tiết. */
const PHU_LG = "hidden lg:table-cell";
const PHU_XL = "hidden xl:table-cell";

/** Dòng phụ của cột «Nhóm nguồn»: người nhập phải chọn thêm gì ở ô nhập. «Không» trần đứng một mình đọc như «không có nhóm». */
function dongPhuYeuCau(g: DongDanhMucNguonMo): string {
  const yc = yeuCauNhap(g);
  return yc === "Không" ? "Không yêu cầu thêm" : yc;
}

export function BangNguon({
  dong,
  cuaSoMacDinhNgay,
  coTheGhi,
  coQuyenKichHoat,
  dichMacDinh,
  nowIso,
}: {
  dong: DongDanhMucNguonMo[];
  /** Cửa sổ ghi công MẶC ĐỊNH chung (setting) — nguồn không khai cửa sổ riêng dùng số này. */
  cuaSoMacDinhNgay: number;
  /** Người xem được GHI danh mục không (`sources:manage` ∧ module bật). Page tính, bảng không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  /** Người xem CÓ `commission_policies:activate` không — nút trạng thái cần để nói thật với nguồn đang dính tiền. Page đọc (`coQuyenKichHoatChinhSach`); bắt buộc (luật 7). */
  coQuyenKichHoat: boolean;
  /** Mã nguồn là đích mặc định của quy nguồn — không ngừng / lưu trữ được. */
  dichMacDinh: readonly string[];
  /** Mốc «bây giờ» lúc trang dựng. */
  nowIso: string;
}) {
  return (
    <div className={VO_BANG}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                Nguồn
              </th>
              <th scope="col" className={cn(TH, PHU_LG)}>
                Nhóm nguồn
              </th>
              <th scope="col" title="Cửa sổ ghi công" className={cn(TH, PHU_XL)}>
                Cửa sổ
              </th>
              <th scope="col" className={TH}>
                Hoa hồng nguồn
              </th>
              <th scope="col" className={TH}>
                Trạng thái
              </th>
              <th scope="col" className={cn(TH, PHU_XL, "text-right")}>
                Lead
              </th>
              {coTheGhi ? (
                <th scope="col" className={cn(TH, "text-right")}>
                  Thao tác
                </th>
              ) : (
                <th scope="col" aria-label="Mở" className={cn(TH, "w-10")} />
              )}
            </tr>
          </thead>
          <tbody>
            {dong.map((g) => {
              const cuaSo = nhanCuaSo(g.attributionWindowDays, cuaSoMacDinhNgay);
              // Đang dùng + chọn được ở ô nhập nhưng NGOÀI khoảng hiệu lực (chưa mở / đã hết hạn): lead mới không chọn được.
              // (Nguồn tắt «chọn được» có chủ đích — UNKNOWN, nguồn hệ thống gán — đã có chữ «Hệ thống gán» ở cột nhóm, không phải cảnh báo.)
              const ngoaiHieuLuc = g.status === "ACTIVE" && g.selectable && !g.chonDuoc;
              return (
                <tr key={g.id} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={cn(TD, "max-w-[12rem] xl:max-w-[15rem]")}>
                    <Link
                      href={`/nguon-hoa-hong/nguon/${g.code}`}
                      className="block truncate font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0"
                    >
                      {g.name}
                    </Link>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {g.documentNo !== null ? `${g.documentNo} · ` : ""}
                      {g.code}
                    </span>
                  </td>
                  <td className={cn(TD, PHU_LG, "max-w-[12rem]")}>
                    <span className="block truncate text-foreground">{NHAN_LOAI_NGUON[g.sourceType]}</span>
                    <span className="block truncate text-xs text-muted-foreground">{dongPhuYeuCau(g)}</span>
                  </td>
                  <td className={cn(TD, PHU_XL, "tabular-nums")}>
                    <span className={cn("block", cuaSo.rieng ? "text-foreground" : "text-muted-foreground")}>{cuaSo.so} ngày</span>
                    <span className="block text-xs text-muted-foreground">{cuaSo.rieng ? "Riêng" : "Mặc định"}</span>
                  </td>
                  <td className={TD}>
                    {g.commissionEnabled ? (
                      <StatusPill tone="success" className="text-state-success-ink">
                        {nhanHoaHongNguon(true)}
                      </StatusPill>
                    ) : (
                      <span className="text-muted-foreground">{nhanHoaHongNguon(false)}</span>
                    )}
                  </td>
                  <td className={TD}>
                    {ngoaiHieuLuc ? (
                      <span title="Nguồn đang dùng nhưng ngoài khoảng hiệu lực (chưa mở hoặc đã hết hạn) — lead mới chưa chọn được.">
                        <StatusPill tone="warning" className="text-state-warning-ink">
                          Ngoài hiệu lực
                        </StatusPill>
                      </span>
                    ) : (
                      <NguonStatusPill status={g.status} />
                    )}
                  </td>
                  <td className={cn(TD, PHU_XL, "text-right tabular-nums")}>
                    <span className="block">{soVN(g.soLeadTong)}</span>
                    <span className="block text-xs text-muted-foreground">{soVN(g.soLead30Ngay)} trong 30 ngày</span>
                  </td>
                  {/* Dưới `md` bảng cuộn ngang ⇒ ô Thao tác DÍNH mép phải (không bao giờ nằm ngoài tầm với); từ `md` trở lên nó nằm yên trong dòng. `z-10` để nằm TRÊN lớp phủ bấm-cả-dòng của liên kết tên. */}
                  {coTheGhi ? (
                    <td className={cn(TD, "sticky right-0 z-10 bg-card text-right md:relative md:bg-transparent")}>
                      <span className="inline-flex items-center justify-end gap-2">
                        <Link
                          href={hrefSuaNguon(g.code)}
                          aria-label={`Sửa nguồn ${g.name}`}
                          title="Sửa nguồn"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
                        >
                          <Pencil aria-hidden className="h-3.5 w-3.5" />
                        </Link>
                        <NutDoiTrangThai
                          nguon={{
                            id: g.id,
                            code: g.code,
                            name: g.name,
                            status: g.status,
                            isSystem: g.isSystem,
                            capNhatLuc: g.capNhatLuc,
                            ownerEmployeeId: g.ownerEmployeeId,
                            chinhSachRieng: g.chinhSachRieng,
                            ruleChuChay: g.ruleChuChay,
                          }}
                          dichMacDinh={dichMacDinh}
                          coQuyenKichHoat={coQuyenKichHoat}
                          nowIso={nowIso}
                          bieuTuong
                        />
                      </span>
                    </td>
                  ) : (
                    <td className={cn(TD, "w-10 text-muted-foreground")}>
                      <ChevronRight aria-hidden className="h-4 w-4" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
