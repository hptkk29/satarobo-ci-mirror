"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Inbox, Loader2, PencilLine, Search, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  doiSoatHocPhi,
  NHAN_TRANG_THAI_HOC_PHI,
  TRANG_THAI_HOC_PHI,
  type TrangThaiHocPhiDoiSoat,
} from "@/lib/finance/doi-soat-hoc-phi";

import { suaHocPhiGhiDanhAction } from "../_actions";
import type { DongDoiSoat } from "./types";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/** Thứ tự hiện — xếp theo VIỆC PHẢI LÀM, không theo bảng chữ cái. */
const THU_TU: TrangThaiHocPhiDoiSoat[] = [
  TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA,
  TRANG_THAI_HOC_PHI.CHO_XAC_NHAN,
  TRANG_THAI_HOC_PHI.THIEU,
  TRANG_THAI_HOC_PHI.CHUA_DONG,
  TRANG_THAI_HOC_PHI.THU_VUOT,
  TRANG_THAI_HOC_PHI.DU,
];

/**
 * Màu NGỮ NGHĨA, không mượn màu thương hiệu (DESIGN.md §1).
 *
 * Ba mức đọc được ngay: đỏ = sổ đang sai · vàng = còn tiền phải thu · xanh dương = việc
 * nội bộ (bấm xác nhận) · xanh lá = xong.
 */
const TONE: Record<TrangThaiHocPhiDoiSoat, string> = {
  CHUA_CHOT_GIA: "bg-state-danger-soft text-state-danger-ink",
  CHO_XAC_NHAN: "bg-state-info-soft text-state-info-ink",
  THIEU: "bg-state-warning-soft text-state-warning-ink",
  CHUA_DONG: "bg-state-warning-soft text-state-warning-ink",
  THU_VUOT: "bg-state-info-soft text-state-info-ink",
  DU: "bg-state-success-soft text-state-success-ink",
};

/** Câu trả lời cho "thấy rồi thì làm gì" — hiện ngay dưới thanh lọc khi đang lọc. */
const VIEC_PHAI_LAM: Record<TrangThaiHocPhiDoiSoat, string> = {
  CHUA_CHOT_GIA:
    "Hệ thống không biết các em này phải đóng bao nhiêu, nên cổng phụ huynh không hiện nợ dù nhà chưa đóng đủ. Sửa học phí để đưa các em về sổ.",
  CHO_XAC_NHAN:
    "Tiền đã nằm trong hệ thống. Phụ huynh vẫn thấy nợ cho tới khi kế toán xác nhận khoản ở màn Thanh toán — không phải đi đòi tiền.",
  THIEU: "Còn thiếu tiền thật. Đây là nhóm cần liên hệ phụ huynh hoặc ghi thêm khoản đã thu.",
  CHUA_DONG:
    "Chưa ghi nhận đồng nào. Kiểm xem có phải quên nhập khoản đã thu, trước khi gọi phụ huynh.",
  THU_VUOT: "Ghi nhận nhiều hơn học phí. Kiểm lại học phí hợp đồng hoặc khoản đã nhập trùng.",
  DU: "Đã đóng đủ và kế toán đã xác nhận. Không còn việc gì.",
};

type DongDaTinh = DongDoiSoat & { so: ReturnType<typeof doiSoatHocPhi> };

export function BangDoiSoat({
  dong,
  suaDuoc,
}: {
  dong: DongDoiSoat[];
  /** `enrollments:edit`. Không có quyền thì KHÔNG hiện nút — nút là lời hứa. */
  suaDuoc: boolean;
}) {
  const [tim, setTim] = useState("");
  const [loc, setLoc] = useState<TrangThaiHocPhiDoiSoat | "TAT_CA">("TAT_CA");
  const [dangSua, setDangSua] = useState<DongDaTinh | null>(null);
  const [hocPhiMoi, setHocPhiMoi] = useState<number>(0);
  const [lyDo, setLyDo] = useState("");
  const [dangChay, start] = useTransition();

  const tinh = useMemo<DongDaTinh[]>(
    () =>
      dong.map((d) => ({
        ...d,
        so: doiSoatHocPhi({
          hocPhi: d.chuaChotGia ? null : d.hocPhi,
          daGhiNhan: d.daGhiNhan,
          daXacNhan: d.daXacNhan,
        }),
      })),
    [dong],
  );

  const tomTat = useMemo(() => {
    const m = new Map<TrangThaiHocPhiDoiSoat, { soEm: number; tien: number }>();
    for (const t of THU_TU) m.set(t, { soEm: 0, tien: 0 });
    for (const r of tinh) {
      const o = m.get(r.so.trangThai)!;
      o.soEm += 1;
      // Mỗi nhóm hiện SỐ TIỀN ĐANG VƯỚNG của chính nó, không phải học phí. Nhóm "Đã đóng
      // đủ" mà in học phí thì nó to nhất bảng và kéo mắt người đọc sai chỗ.
      o.tien +=
        r.so.trangThai === TRANG_THAI_HOC_PHI.CHO_XAC_NHAN
          ? r.so.choXacNhan
          : r.so.trangThai === TRANG_THAI_HOC_PHI.THU_VUOT
            ? r.so.traVuot
            : r.so.trangThai === TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA
              ? r.so.daThu
              : r.so.trangThai === TRANG_THAI_HOC_PHI.DU
                ? 0
                : r.so.conThieuThucTe;
    }
    return m;
  }, [tinh]);

  const hien = useMemo(() => {
    const q = tim.trim().toLowerCase();
    return tinh.filter((r) => {
      if (loc !== "TAT_CA" && r.so.trangThai !== loc) return false;
      if (!q) return true;
      return (
        (r.hocVien ?? "").toLowerCase().includes(q) ||
        (r.khoa ?? "").toLowerCase().includes(q)
      );
    });
  }, [tinh, tim, loc]);

  const soChuaChotGia = tomTat.get(TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA)!.soEm;
  /**
   * Số dòng có TRỤC A > TRỤC B — hình dạng không thể có trên dữ liệu thật.
   *
   * Trên môi trường nghiệm thu nó gần như LUÔN bật (seed đặt `saleStatus =
   * COLLECT_CONFIRMED` cho mọi khoản, trong khi trục B lọc bằng "RECORDED"). Nói ra để
   * người nghiệm thu không kết luận nhầm là màn hỏng; trên prod nó là báo động thật.
   */
  const soLechTruc = useMemo(() => tinh.filter((r) => r.so.lechTrucBatThuong).length, [tinh]);

  function moSua(r: DongDaTinh) {
    setDangSua(r);
    setHocPhiMoi(r.chuaChotGia ? 0 : r.so.phaiDong);
    setLyDo("");
  }

  function luu() {
    if (!dangSua) return;
    const em = dangSua;
    start(async () => {
      const r = await suaHocPhiGhiDanhAction({
        enrollmentId: em.enrollmentId,
        hocPhi: hocPhiMoi,
        lyDo,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${em.hocVien ?? "Ghi danh"}: học phí ${
          r.hocPhiCu == null ? "chưa chốt" : vnd(r.hocPhiCu)
        } → ${vnd(r.hocPhiMoi)}`,
      );
      setDangSua(null);
      setLyDo("");
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">
          Đối soát học phí từng học viên
        </h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Dùng sau khi nhập giao dịch cũ, để biết em nào đã đóng đủ và em nào còn thiếu.{" "}
          <b className="font-semibold text-foreground">
            &quot;Phụ huynh đang thấy&quot; là con số thật sự hiện trên cổng phụ huynh lúc
            này
          </b>{" "}
          — nó chỉ giảm khi kế toán xác nhận khoản ở màn Thanh toán, không giảm lúc ghi nhận.
        </p>
      </header>

      {/* ── Thanh trạng thái: vừa là tóm tắt, vừa là bộ lọc ───────────────────
          Cố ý KHÔNG làm 6 thẻ số to: màn này là giao diện dữ liệu dày (DESIGN.md §2),
          sáu thẻ chiếm hết màn hình đầu và đẩy bảng — thứ người ta thật sự đến để đọc —
          xuống dưới nếp gấp. */}
      <div className="border-b border-border px-5 py-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setLoc("TAT_CA")}
            aria-pressed={loc === "TAT_CA"}
            className={`inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors duration-150 ${
              loc === "TAT_CA"
                ? "border-primary bg-primary text-white"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            Tất cả
            <span className="tabular-nums opacity-80">{tinh.length}</span>
          </button>
          {THU_TU.map((t) => {
            const o = tomTat.get(t)!;
            const dangLoc = loc === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setLoc(dangLoc ? "TAT_CA" : t)}
                aria-pressed={dangLoc}
                disabled={o.soEm === 0}
                className={`inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
                  dangLoc
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${TONE[t].split(" ")[0]}`}
                />
                {NHAN_TRANG_THAI_HOC_PHI[t]}
                <span className="tabular-nums opacity-80">{o.soEm}</span>
                {o.tien > 0 && (
                  <span
                    className={`tabular-nums ${dangLoc ? "opacity-90" : "text-muted-foreground"}`}
                  >
                    · {vnd(o.tien)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {loc !== "TAT_CA" && (
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {VIEC_PHAI_LAM[loc]}
          </p>
        )}
      </div>

      {soLechTruc > 0 && (
        <div className="border-b border-state-warning bg-state-warning-soft px-5 py-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-state-warning-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b className="font-semibold">
                {soLechTruc} dòng có &quot;Kế toán xác nhận&quot; lớn hơn &quot;Đã thu&quot;.
              </b>{" "}
              Kế toán chỉ xác nhận được khoản sale đã ghi nhận, nên hình dạng này không thể
              có trên dữ liệu thật.{" "}
              <b className="font-semibold">Trên môi trường nghiệm thu thì đây là bình thường</b>{" "}
              — dữ liệu mẫu đặt mọi khoản ở trạng thái &quot;Đã xác nhận thu&quot;, còn cột
              &quot;Đã thu&quot; chỉ cộng khoản ở trạng thái &quot;Đã ghi nhận&quot;. Nếu thấy
              dòng này trên hệ thống chạy thật thì báo kỹ thuật: nó nghĩa là một đường ghi
              tiền đang hỏng.
            </span>
          </p>
        </div>
      )}

      {soChuaChotGia > 0 && loc !== TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA && (
        <div className="border-b border-state-danger bg-state-danger-soft px-5 py-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-state-danger-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b className="font-semibold">{soChuaChotGia} em chưa chốt học phí.</b> Hệ thống
              không biết các em phải đóng bao nhiêu, nên cổng phụ huynh không hiện nợ dù nhà
              chưa đóng đủ — và trước hôm nay màn công nợ còn lọc bỏ hẳn nhóm này.{" "}
              <button
                type="button"
                onClick={() => setLoc(TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA)}
                className="font-semibold underline underline-offset-2 hover:text-state-danger-ink-hover"
              >
                Xem {soChuaChotGia} em
              </button>
            </span>
          </p>
        </div>
      )}

      {/* ── Tìm ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={tim}
            onChange={(e) => setTim(e.target.value)}
            placeholder="Tìm theo tên học viên hoặc khoá..."
            aria-label="Tìm học viên hoặc khoá"
            className="pl-9"
          />
        </div>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {hien.length}/{tinh.length} ghi danh
        </span>
      </div>

      {/* ── Bảng, hoặc một trong hai trạng thái RỖNG ─────────────────────────
          Hai ca rỗng khác nhau và việc phải làm cũng khác: "chưa có gì trong phạm vi"
          vs "bộ lọc đang che". Gộp thành một câu là bỏ rơi người dùng ở ca thứ hai. */}
      {tinh.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            Chưa có ghi danh nào trong phạm vi của bạn
          </p>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            Màn này đọc theo <b className="font-semibold">lớp thuộc cơ sở bạn quản lý</b>. Chốt
            lead thành học viên, hoặc nhập học phí cũ, rồi quay lại đây.
          </p>
          <Link
            href="/nhap-giao-dich-cu"
            className="mt-1 inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted"
          >
            Nhập giao dịch cũ
          </Link>
        </div>
      ) : hien.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">Không có ghi danh nào khớp</p>
          <p className="text-xs text-muted-foreground">
            {tinh.length} ghi danh đang bị bộ lọc che.
          </p>
          <button
            type="button"
            onClick={() => {
              setTim("");
              setLoc("TAT_CA");
            }}
            className="mt-1 inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted"
          >
            Bỏ bộ lọc
          </button>
        </div>
      ) : (
        <div className="overflow-hidden border-t border-border">
          <PhanTrangBang tenDonVi="ghi danh" khoaGhiNho="cong-no-doi-soat" cuonNgang>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                    Học viên
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Phải đóng
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Đã thu
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Kế toán xác nhận
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Thiếu — PH đang thấy
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold uppercase tracking-wide">
                    Thiếu thật
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                    Trạng thái
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                    Thao tác
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hien.map((r) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-sm">
                      <span className="font-medium text-foreground">{r.hocVien ?? "—"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.khoa ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm tabular-nums">
                      {r.chuaChotGia ? (
                        <span className="text-state-danger-ink">chưa chốt</span>
                      ) : (
                        vnd(r.so.phaiDong)
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm font-semibold tabular-nums">
                      {vnd(r.so.daThu)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm tabular-nums text-muted-foreground">
                      {vnd(r.so.daXacNhan)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm tabular-nums">
                      {r.so.conThieuPhuHuynhThay > 0 ? (
                        <b className="font-semibold text-state-warning-ink">
                          {vnd(r.so.conThieuPhuHuynhThay)}
                        </b>
                      ) : (
                        <span className="text-muted-foreground">0đ</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-right text-sm tabular-nums">
                      {r.so.conThieuThucTe > 0 ? (
                        <b className="font-semibold text-state-danger-ink">
                          {vnd(r.so.conThieuThucTe)}
                        </b>
                      ) : (
                        <span className="text-muted-foreground">0đ</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${TONE[r.so.trangThai]}`}
                      >
                        {NHAN_TRANG_THAI_HOC_PHI[r.so.trangThai]}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-5 py-3.5 text-sm">
                      <div className="flex flex-nowrap items-center gap-2">
                        {suaDuoc && (
                          <button
                            type="button"
                            onClick={() => moSua(r)}
                            className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors duration-150 hover:bg-muted"
                          >
                            <PencilLine className="h-3.5 w-3.5" aria-hidden />
                            Sửa học phí
                          </button>
                        )}
                        {r.so.choXacNhan > 0 && (
                          <Link
                            href="/payments"
                            className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md border border-state-info bg-state-info-soft px-2.5 text-xs font-medium text-state-info-ink transition-colors duration-150 hover:bg-state-info-soft-hover"
                          >
                            Xác nhận {vnd(r.so.choXacNhan)}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PhanTrangBang>
        </div>
      )}

      {/* ── Sửa học phí hợp đồng ──────────────────────────────────────────────
          Dialog chứ không phải sửa tại dòng: ba ô nhập nhồi vào ô Thao tác làm dòng
          bảng cao gấp ba (DESIGN.md §2 chốt 44px), và đây là thao tác ĐỔI SỐ PHỤ HUYNH
          ĐANG NHÌN THẤY — nó xứng đáng được ngắt mạch và bắt khai lý do. */}
      <Dialog open={dangSua != null} onOpenChange={(o) => !o && !dangChay && setDangSua(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa học phí hợp đồng</DialogTitle>
            <DialogDescription>
              {dangSua?.hocVien ?? "Ghi danh"}
              {dangSua?.khoa ? ` · ${dangSua.khoa}` : ""}
            </DialogDescription>
          </DialogHeader>

          {dangSua && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Học phí hiện tại</dt>
                  <dd className="mt-0.5 truncate font-semibold tabular-nums text-foreground">
                    {dangSua.chuaChotGia ? "chưa chốt" : vnd(dangSua.so.phaiDong)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Đã thu</dt>
                  <dd className="mt-0.5 truncate font-semibold tabular-nums text-foreground">
                    {vnd(dangSua.so.daThu)}
                  </dd>
                </div>
              </dl>

              <div className="space-y-1.5">
                <Label htmlFor="hoc-phi-moi">Học phí hợp đồng mới</Label>
                <MoneyInput
                  id="hoc-phi-moi"
                  name="hocPhiMoi"
                  value={hocPhiMoi}
                  min={0}
                  onValueChange={(v) => setHocPhiMoi(v ?? 0)}
                />
                {hocPhiMoi > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Sau khi lưu:{" "}
                    {hocPhiMoi > dangSua.so.daXacNhan ? (
                      <>
                        phụ huynh sẽ thấy còn thiếu{" "}
                        <b className="font-semibold text-state-warning-ink">
                          {vnd(hocPhiMoi - dangSua.so.daXacNhan)}
                        </b>
                      </>
                    ) : (
                      <b className="font-semibold text-state-success-ink">
                        phụ huynh sẽ thấy đã đóng đủ
                      </b>
                    )}
                    .
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ly-do-sua">Lý do sửa</Label>
                <Input
                  id="ly-do-sua"
                  value={lyDo}
                  onChange={(e) => setLyDo(e.target.value)}
                  placeholder="Ví dụ: chốt lại theo hợp đồng giấy ký 08/2026"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Bắt buộc — cột này là số phụ huynh nhìn thấy, nên mọi lần sửa đều vào nhật
                  ký kèm giá trị cũ và người sửa.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDangSua(null)}
              disabled={dangChay}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={luu}
              disabled={dangChay || lyDo.trim().length < 5 || hocPhiMoi <= 0}
            >
              {dangChay && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Lưu học phí
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
