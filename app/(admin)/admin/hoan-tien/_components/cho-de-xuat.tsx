"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { ChuThich } from "@/components/admin/ui/chu-thich";
import type { DongChoDeXuat } from "@/lib/finance/cho-de-xuat-hoan-tien";
import { taoDeXuatHoanTienAction } from "../_actions";

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}

const SO_BUOI_BADGE: Record<DongChoDeXuat["muc"], string> = {
  TIN_DUOC:
    "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft",
  THIEU_MOT_SO_BUOI:
    "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft",
  KHONG_TIN_DUOC:
    "bg-state-danger-soft text-state-danger-ink hover:bg-state-danger-soft",
};

function nhanSoBuoi(d: DongChoDeXuat): string {
  if (d.muc === "TIN_DUOC") return "Sổ đã chốt";
  if (d.muc === "THIEU_MOT_SO_BUOI") return `Thiếu ${d.soBuoiChuaChot} buổi`;
  return `Chưa chốt ${d.soBuoiChuaChot} buổi`;
}

/**
 * "Đã nghỉ học, đã đóng tiền, CHƯA có đề xuất hoàn" — việc còn tồn, không phải báo cáo.
 *
 * Mỗi dòng luôn có ĐÚNG MỘT việc bấm được (luật 12 — affordance phải nói thật):
 *   · sổ buổi chốt rồi  → "Tạo đề xuất" (2 nhịp xác nhận, y hệt nút Duyệt bên bảng chính)
 *   · sổ buổi chưa chốt → "Chốt sổ buổi" dẫn thẳng tới danh sách buổi của ĐÚNG lớp đó
 * Không có dòng nào chỉ để nhìn.
 */
export function ChoDeXuat({
  dong,
  tongSo,
  daCat,
  khongPhaiHoan,
  canTao,
}: {
  dong: DongChoDeXuat[];
  tongSo: number;
  daCat: number;
  khongPhaiHoan: number;
  canTao: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (tongSo === 0) return null;

  // Cộng số ĐỀ XUẤT, không cộng số ĐÃ THU: "đã thu" là tiền học phí hợp lệ, phần lớn
  // trong đó là tiền của những buổi em đã học thật. Gộp nó thành một con số to ở đầu màn
  // là hứa với kế toán một khoản phải chi lớn hơn hẳn thực tế.
  const tongDeXuat = dong.reduce((s, d) => s + d.deXuatDuKien, 0);
  const soBiChan = dong.filter((d) => !d.choDeXuat).length;

  function onTao(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    startTransition(async () => {
      const res = await taoDeXuatHoanTienAction(id);
      if (res.ok) toast.success("Đã tạo đề xuất hoàn tiền — chờ duyệt");
      else toast.error(res.error);
      setConfirmId(null);
    });
  }

  return (
    <section className="mb-6 rounded-xl border border-state-warning-soft bg-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-state-warning-soft">
          <HandCoins
            className="h-4.5 w-4.5 text-state-warning-ink"
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Chờ đề xuất hoàn tiền
            <ChuThich
              nhan="Vì sao có mục này"
              noiDung={
                "Khi cho học viên nghỉ học, hệ thống tự đề xuất hoàn tiền trong cùng lượt gỡ. " +
                "Lượt nào không đề xuất được (lớp chưa chốt sổ buổi, hoặc trong giai đoạn tính " +
                "năng bị tắt 08/09–14/09) thì ghi danh đó treo lại — không có tiến trình nào " +
                "quét lại giúp. Đây là danh sách những ca đó; xử lý xong là biến mất khỏi đây. " +
                "Ghi danh đã học hết khoá (hoàn ra 0đ, hoặc chỉ còn vài đồng dư làm tròn) KHÔNG " +
                "hiện ở đây — không có gì để hoàn thì không phải là việc."
              }
            />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tongSo} ghi danh · ước tính phải hoàn {vnd(tongDeXuat)}
            {soBiChan > 0 ? ` · ${soBiChan} ca chưa tính được` : ""}
            {daCat > 0 ? ` · đang hiện ${dong.length}, còn ${daCat} chưa hiện` : ""}
            {khongPhaiHoan > 0
              ? ` · ${khongPhaiHoan} ca khác đã học hết khoá, không phải hoàn`
              : ""}
          </p>
        </div>
      </div>

      <PhanTrangBang cuonNgang>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Học viên / Lớp</TableHead>
              <TableHead className="text-right">Đã thu</TableHead>
              <TableHead className="text-right">Buổi (học/tổng)</TableHead>
              <TableHead>Sổ buổi</TableHead>
              <TableHead className="text-right">Đề xuất dự kiến</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dong.map((d) => (
              <TableRow key={d.enrollmentId}>
                <TableCell>
                  <div className="font-medium text-foreground">
                    {d.studentName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.className}
                  </div>
                </TableCell>
                <TableCell className="text-right">{vnd(d.daThu)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.sessionsLearned}/{d.sessionsTotal}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <Badge className={SO_BUOI_BADGE[d.muc]}>
                      {nhanSoBuoi(d)}
                    </Badge>
                    <ChuThich
                      nhan={`Giải thích sổ buổi: ${d.className}`}
                      noiDung={d.lyDo}
                    />
                  </span>
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {d.choDeXuat ? (
                    vnd(d.deXuatDuKien)
                  ) : (
                    // KHÔNG in một con số ở đây: dòng này bị chặn đúng vì con số đó
                    // không tin được. In ra là hứa một điều hệ thống vừa từ chối.
                    <span className="text-xs font-normal text-muted-foreground">
                      chưa tính được
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {d.choDeXuat ? (
                      canTao ? (
                        <Button
                          size="sm"
                          variant={
                            confirmId === d.enrollmentId ? "default" : "outline"
                          }
                          disabled={isPending}
                          onClick={() => onTao(d.enrollmentId)}
                        >
                          {confirmId === d.enrollmentId
                            ? "Xác nhận tạo"
                            : "Tạo đề xuất"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Cần quyền duyệt thu chi
                        </span>
                      )
                    ) : (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/sessions?classId=${d.classId}`}>
                          <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                          Chốt sổ buổi
                        </Link>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PhanTrangBang>
    </section>
  );
}
