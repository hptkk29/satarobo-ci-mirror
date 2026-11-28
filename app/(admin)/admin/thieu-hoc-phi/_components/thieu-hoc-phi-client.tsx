"use client";

import { useMemo, useState } from "react";
import { CircleCheck, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NHAN_TRANG_THAI, type TrangThaiHocPhi } from "@/lib/finance/thieu-hoc-phi";

import { GhiHocPhiDialog } from "./ghi-hoc-phi-dialog";
import type { DongThieu } from "./types";
import { formatPhoneVN } from "@/lib/phone";


const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

function Pill({ t }: { t: TrangThaiHocPhi }) {
  const mau =
    t === "CHUA_CO_DON"
      ? "bg-state-danger-soft text-state-danger-ink"
      : t === "CO_DON_CHUA_THU"
        ? "bg-state-warning-soft text-state-warning-ink"
        : "bg-state-info-soft text-state-info-ink";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${mau}`}
    >
      {NHAN_TRANG_THAI[t]}
    </span>
  );
}

export function ThieuHocPhiClient({
  rows,
  ghiDuoc,
}: {
  rows: DongThieu[];
  ghiDuoc: boolean;
}) {
  const [dangMo, setDangMo] = useState<DongThieu | null>(null);
  const [xong, setXong] = useState<Set<string>>(new Set());

  const conLai = useMemo(() => rows.filter((r) => !xong.has(r.leadId)), [rows, xong]);

  if (conLai.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 px-6 py-12 text-center">
        <CircleCheck className="mx-auto h-8 w-8 text-state-success-ink" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-foreground">
          Không có học viên nào thiếu học phí
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          Mọi lead đã chốt đều có đơn hàng và đã thu đủ. Nhóm &quot;chưa có đơn&quot; chỉ xuất
          hiện sau các lượt chốt hàng loạt không nhập số tiền.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        {/* SÁU cột, không tám. Bản trước có Phải thu / Đã thu / Còn thiếu tách riêng nên
            bảng phải cuộn ngang và cột Phụ huynh bị cắt mất chữ đầu. Gộp ba số tiền vào
            MỘT cột: nhóm "chưa có đơn" không có số nào để hiện, còn nhóm có đơn thì ba
            số đọc liền nhau dễ hơn là rải ba cột. */}
        <PhanTrangBang tenDonVi="phụ huynh" khoaGhiNho="thieu-hoc-phi" cuonNgang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                  Phụ huynh · Học viên
                </TableHead>
                <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                  Cơ sở
                </TableHead>
                <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                  Trạng thái
                </TableHead>
                <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                  Học phí
                </TableHead>
                {ghiDuoc && (
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Thao tác
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {conLai.map((r) => (
                <TableRow key={r.leadId}>
                  <TableCell className="px-5 py-3.5 text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="whitespace-nowrap font-medium text-foreground">
                        {r.parentName}
                        <span className="ml-2 font-normal tabular-nums text-xs text-muted-foreground">
                          {formatPhoneVN(r.phone)}
                        </span>
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {r.studentNames.length > 0 ? r.studentNames.join(", ") : "chưa có tên con"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-5 py-3.5 text-sm text-muted-foreground">
                    {r.centerName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-5 py-3.5">
                    <Pill t={r.trangThai} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm">
                    {r.soDon === 0 ? (
                      <span className="text-xs text-muted-foreground">chưa có số liệu</span>
                    ) : (
                      <div className="flex flex-col gap-0.5 tabular-nums">
                        <span className="font-semibold text-state-warning-ink">
                          thiếu {vnd(r.conThieu)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {vnd(r.tongDaThu)} / {vnd(r.tongPhaiThu)}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  {ghiDuoc && (
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right">
                      {/* Thiếu thì phải GHI TIẾP — bản trước hiện chữ "Đã có khoản
                          nhập liệu" và khoá luôn, nên một em thiếu 7.000.000đ không có
                          đường nào đóng thêm. Nút vẫn mở, chỉ đổi nhãn + nói trần. */}
                      <Button
                        size="sm"
                        variant={r.ghiThem ? "outline" : "default"}
                        onClick={() => setDangMo(r)}
                        className="min-h-9 transition-colors duration-150"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {r.ghiThem
                          ? `Ghi thêm · tối đa ${r.ghiThem.toiDa.toLocaleString("vi-VN")}đ`
                          : "Ghi học phí"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>

      <GhiHocPhiDialog
        dong={dangMo}
        onClose={() => setDangMo(null)}
        onXong={(leadId) => setXong((s) => new Set(s).add(leadId))}
      />
    </>
  );
}
