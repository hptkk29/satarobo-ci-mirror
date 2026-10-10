// CHI TIẾT MỘT PHIÊN BẢN chính sách (06 §5.2): trạng thái, hiệu lực, phạm vi, văn bản, lý do, và bảng rule vai × loại giao dịch.
// Server component thuần, CHỈ ĐỌC. Danh sách định nghĩa dọc (cột nhãn 9rem) — cùng khuôn ngăn "Vì sao" của sổ (06 §2.3); không thẻ lồng
// thẻ, không biểu đồ. Phiên bản đã dùng/đã kích hoạt không có đường sửa ở đây: nút sửa/tạo mới do trang cha quyết theo quyền.
import { FileText } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { PolicyVersionBadge, TrangThaiPhienBanPill } from "@/components/admin/nguon-hoa-hong/policy-version-badge";
import { adminTh } from "@/components/admin/ui/table";
import type { PhienBanChiTiet } from "@/lib/hoa-hong/chinh-sach-doc";
import { NHAN_LOAI_GD, type LoaiGdSoan } from "@/lib/hoa-hong/chinh-sach-form";
import { khoangHieuLuc, ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { ngayDMY } from "@/lib/hoa-hong/hang-rao-ui";
import { tachNhomVai } from "@/lib/hoa-hong/nhom-hoa-hong";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { MO_TA_NHOM_HOA_HONG } from "@/lib/nguon/nhan-hien-thi";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");

function oRule(r: PhienBanChiTiet["rules"][number] | undefined): React.ReactNode {
  if (!r) return <span className="text-muted-foreground">—</span>;
  switch (r.calcKind) {
    case "PERCENT":
      return <span className="font-medium tabular-nums">{dinhDangPhanTram(r.rate ?? "0")}%</span>;
    case "EXCLUDE":
      return <span className="text-muted-foreground">Không trả</span>;
    case "FIXED_PER_PURCHASE":
      return <span className="font-medium tabular-nums">{dinhDangDong(r.fixedAmount ?? 0)} / lần mua</span>;
    default:
      return <span className="text-muted-foreground">Thưởng theo bậc</span>;
  }
}

export function PhienBanChiTietView({ pb, now }: { pb: PhienBanChiTiet; now: Date }) {
  const loaiCo = Array.from(new Set(pb.rules.map((r) => r.transactionTypeCode)));
  const vai = Array.from(new Map(pb.rules.map((r) => [r.roleCode, { code: r.roleCode, name: r.roleName, isAcquisition: r.isAcquisition }])).values());
  // Bảng vai × loại giao dịch tách hai nhóm (nguồn · giao dịch khác); hàng «Tổng» vẫn MỘT hàng cho cả bảng — trần đếm cả hai.
  const nhomVai = tachNhomVai(vai);
  return (
    <section aria-label={`Phiên bản ${pb.versionNo}`} className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PolicyVersionBadge versionNo={pb.versionNo} />
        <TrangThaiPhienBanPill status={pb.status} effectiveFrom={pb.effectiveFrom} effectiveTo={pb.effectiveTo} now={now} />
        {pb.daDung && <span className="text-xs text-muted-foreground">Đã sinh dòng sổ hoa hồng — khoá, chỉ tạo phiên bản mới.</span>}
      </div>

      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Hiệu lực</dt>
        <dd className="tabular-nums text-foreground">{khoangHieuLuc(pb.effectiveFrom, pb.effectiveTo)}</dd>
        <dt className="text-muted-foreground">Áp dụng cho</dt>
        <dd className="text-foreground">{pb.phamVi.nhanDai}</dd>
        <dt className="text-muted-foreground">Văn bản</dt>
        <dd className="min-w-0 text-foreground">
          {pb.vanBan ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words font-medium">
                {pb.vanBan.documentCode} — {pb.vanBan.title}
              </span>
              <span className="tabular-nums text-muted-foreground">công bố {ngayDMY(pb.vanBan.publishedOn)}</span>
              {pb.vanBan.fileUrl ? (
                <a href={pb.vanBan.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  <FileText aria-hidden className="h-4 w-4" />
                  {pb.vanBan.fileName ?? "Mở tệp"}
                </a>
              ) : (
                <span className="font-medium text-state-warning-ink">Chưa có tệp đính kèm</span>
              )}
              {pb.vanBan.daThuHoi && <span className="font-medium text-state-danger-ink">Đã thu hồi</span>}
            </span>
          ) : (
            <span className="font-medium text-state-warning-ink">Chưa gắn văn bản</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Lý do / căn cứ</dt>
        <dd className="min-w-0 whitespace-pre-line break-words text-foreground">{pb.reason}</dd>
        <dt className="text-muted-foreground">Soạn</dt>
        <dd className="text-foreground">
          <span className="tabular-nums">{ngayGioVN(pb.tao.luc)}</span>
          {pb.tao.ten && <span className="text-muted-foreground"> · {pb.tao.ten}</span>}
        </dd>
        {pb.kichHoatLuc && (
          <>
            <dt className="text-muted-foreground">Kích hoạt</dt>
            <dd className="tabular-nums text-foreground">{ngayGioVN(pb.kichHoatLuc)}</dd>
          </>
        )}
      </dl>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-foreground">Tỉ lệ theo vai</h3>
      {pb.rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Phiên bản này chưa có rule nào — chưa kích hoạt được.</p>
      ) : (
        <div className={VO_BANG}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={TH}>
                    Vai
                  </th>
                  {loaiCo.map((l) => (
                    <th key={l} scope="col" className={TH}>
                      {NHAN_LOAI_GD[l as LoaiGdSoan] ?? l}
                    </th>
                  ))}
                </tr>
              </thead>
              {nhomVai.map((n) => (
                <tbody key={n.khoa} data-nhom-hoa-hong={n.khoa}>
                  <tr className="border-b border-border/60 bg-muted/20">
                    <th scope="rowgroup" colSpan={loaiCo.length + 1} className="px-3 py-2 text-left">
                      <span className="text-sm font-semibold text-foreground">{n.nhan}</span>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{MO_TA_NHOM_HOA_HONG[n.khoa]}</span>
                    </th>
                  </tr>
                  {n.vai.map((v) => (
                    <tr key={v.code} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="whitespace-nowrap px-3 py-3 text-left text-sm font-normal text-foreground">
                        {v.name}
                      </th>
                      {loaiCo.map((l) => (
                        <td key={l} className="whitespace-nowrap px-3 py-3 text-sm text-foreground">
                          {oRule(pb.rules.find((r) => r.roleCode === v.code && r.transactionTypeCode === l))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="border-t border-border bg-muted/40">
                  <th scope="row" className="whitespace-nowrap px-3 py-3 text-left text-sm font-semibold text-foreground">
                    Tổng
                  </th>
                  {loaiCo.map((l) => {
                    const t = pb.tiLe.find((x) => x.loai === l);
                    return (
                      <td key={l} className="whitespace-nowrap px-3 py-3 text-sm font-semibold tabular-nums text-foreground">
                        {t ? `${t.tongPhanTram}%${t.khongTinDuoc ? "+" : ""}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
