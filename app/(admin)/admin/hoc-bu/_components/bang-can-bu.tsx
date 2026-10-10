"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, FileText, HelpCircle, MoreHorizontal, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { cn } from "@/lib/utils";
import { formatDateVN } from "@/lib/format/date";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { kiemNhom } from "@/lib/hoc-bu/xep-case";
import type { DongCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { goMienPhiBuAction, huyBuoiCanBuAction, layBienLaiLuotAction, mienPhiBuAction, taoPhiBuAction, type BienLaiLuotView } from "../_actions";
import { HopXepCase, taiHopXep, type MoHopXep } from "./hop-xep-case";

// Bảng CẦN BÙ. Tick nhiều bé CÙNG buổi (cùng cơ sở + khoá + bài) rồi xếp một lượt; nhóm lệch
// thì thanh chọn nói vế nào lệch thay vì bày một nút bấm vào mới báo lỗi (luật 12). Nút bị khoá
// KHÔNG có tooltip (Button `disabled` là `pointer-events-none`) ⇒ lý do luôn in thành chữ.

type HopLyDo = { loai: "HUY" | "MIEN_PHI" | "GO_MIEN_PHI"; dong: DongCanBu } | null;
type HopBienLai = { dong: DongCanBu; ket: BienLaiLuotView } | null;

export function BangCanBu({
  dong,
  coTheHuy,
  coTheXep,
  tenCoSo,
}: {
  dong: DongCanBu[];
  coTheHuy: boolean;
  coTheXep: boolean;
  /** Người xem thấy ≥2 cơ sở (Admin, QLCS nhiều cơ sở) ⇒ in cột Cơ sở. null = ẩn cột. */
  tenCoSo: Record<string, string> | null;
}) {
  const router = useRouter();
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [hopXep, setHopXep] = useState<MoHopXep | null>(null);
  const [dangMo, moHop] = useTransition();
  const [hopLyDo, setHopLyDo] = useState<HopLyDo>(null);
  const [hopBienLai, setHopBienLai] = useState<HopBienLai>(null);
  const [dangTaiBienLai, taiBienLai] = useTransition();
  const [pending, start] = useTransition();

  const dangChon = useMemo(() => dong.filter((d) => chon.has(d.id)), [dong, chon]);
  const nhom = useMemo(
    () => (dangChon.length ? kiemNhom(dangChon.map((d) => ({ ...d, hocVien: d.hocVien }))) : null),
    [dangChon],
  );
  const chanTien = dangChon.find((d) => !d.xep.ok);
  const lyDoKhoa = !nhom
    ? null
    : !nhom.ok
      ? nhom.lyDo
      : chanTien && !chanTien.xep.ok
        ? `${chanTien.hocVien}: ${chanTien.xep.lyDo}`
        : null;

  function bat(id: string) {
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  }

  function moXep(ids: string[]) {
    moHop(async () => setHopXep(await taiHopXep(ids)));
  }

  // Mở hộp "vì sao còn x/y lượt" từ HANDLER (không useEffect — luật repo): tải sổ lượt thật rồi mới mở.
  function moBienLai(d: DongCanBu) {
    taiBienLai(async () => {
      try {
        setHopBienLai({ dong: d, ket: await layBienLaiLuotAction(d.id) });
      } catch {
        toast.error("Không tải được sổ lượt lúc này — thử lại sau ít phút");
      }
    });
  }

  function taoPhi(d: DongCanBu) {
    start(async () => {
      const kq = await taoPhiBuAction(d.id);
      if (!kq.ok) {
        toast.error(kq.error);
        return;
      }
      toast.success("Đã tạo phí học bù — mở đơn để xuất QR thu tiền");
      router.refresh();
    });
  }

  const tatCaDaChon = dong.length > 0 && dong.every((d) => chon.has(d.id));

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                {coTheXep && (
                  <th className={cn(adminTh, "w-10 pr-0")}>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả học viên trên trang"
                      className="size-4 accent-primary"
                      checked={tatCaDaChon}
                      onChange={() => setChon(tatCaDaChon ? new Set() : new Set(dong.map((d) => d.id)))}
                    />
                  </th>
                )}
                <th className={adminTh}>Học viên</th>
                {tenCoSo && <th className={adminTh}>Cơ sở</th>}
                <th className={adminTh}>Buổi vắng</th>
                <th className={adminTh}>Lượt bù · tiền</th>
                <th className={adminTh}>Đơn PH</th>
                <th className={cn(adminTh, "text-right bg-muted/40 sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]")}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className={cn(adminTr, chon.has(d.id) && "bg-primary-soft/40 hover:bg-primary-soft/50")}>
                  {coTheXep && (
                    <td className={cn(adminTd, "w-10 pr-0")}>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${d.hocVien}`}
                        className="size-4 accent-primary"
                        checked={chon.has(d.id)}
                        onChange={() => bat(d.id)}
                      />
                    </td>
                  )}
                  <td className={cn(adminTd, "max-w-[200px]")}>
                    <p className="truncate font-medium">{d.hocVien}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.lop}</p>
                  </td>
                  {tenCoSo && (
                    <td className={adminTd}>{(d.centerId && tenCoSo[d.centerId]) || "—"}</td>
                  )}
                  <td className={cn(adminTd, "max-w-[220px]")}>
                    <p className="tabular-nums">{d.ngayVang ? formatDateVN(d.ngayVang) : "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.buoiVang ?? "Buổi chưa gắn bài"}</p>
                  </td>
                  <td className={adminTd}>
                    <p className="text-xs text-muted-foreground">
                      Còn{" "}
                      <span className={cn("text-sm font-semibold tabular-nums", d.luot.con === 0 ? "text-muted-foreground" : "text-foreground")}>
                        {d.luot.con}/{d.luot.tong}
                      </span>{" "}
                      lượt
                      <button
                        type="button"
                        aria-label={`Vì sao ${d.hocVien} còn ${d.luot.con}/${d.luot.tong} lượt`}
                        disabled={dangTaiBienLai}
                        onClick={() => moBienLai(d)}
                        className="relative ml-1 inline-flex size-6 items-center justify-center rounded-md align-middle text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <HelpCircle className="size-3.5" aria-hidden />
                      </button>
                    </p>
                    <div className="mt-1">
                      <NhanPhi d={d} />
                    </div>
                  </td>
                  <td className={adminTd}>
                    {d.donPhuHuynh ? (
                      <StatusPill tone="brand" className="gap-1">
                        <FileText className="size-3" aria-hidden />
                        {d.donPhuHuynh.dungBuoi ? "Xin bù buổi này" : "Có đơn xin bù"}
                        {d.donPhuHuynh.ngayMongMuon ? ` · ${formatDateVN(d.donPhuHuynh.ngayMongMuon)}` : ""}
                      </StatusPill>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(adminTd, "text-right sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]", chon.has(d.id) && "bg-primary-soft")}>
                    <div className="flex items-center justify-end gap-1.5">
                      {coTheXep && d.xep.ok && (
                        <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={dangMo} onClick={() => moXep([d.id])}>
                          <CalendarPlus aria-hidden /> Xếp case
                        </Button>
                      )}
                      {coTheXep && d.phi.loai === "CAN_THU" && (
                        <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={pending} onClick={() => taoPhi(d)}>
                          <Receipt aria-hidden /> Tạo phí bù
                        </Button>
                      )}
                      {d.phi.loai === "CHO_THU" && (
                        <Button size="sm" variant="outline" className="h-11 sm:h-8" asChild>
                          <Link href={`/orders/${d.phi.orderId}`}>
                            <Receipt aria-hidden /> Mở đơn thu
                          </Link>
                        </Button>
                      )}
                      {coTheHuy && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Thao tác khác cho ${d.hocVien}`}
                            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {(d.phi.loai === "CAN_THU" || d.phi.loai === "CHO_THU") && (
                              <DropdownMenuItem onClick={() => setHopLyDo({ loai: "MIEN_PHI", dong: d })}>
                                Duyệt học bù miễn phí…
                              </DropdownMenuItem>
                            )}
                            {d.phi.loai === "MIEN_PHI" && (
                              <DropdownMenuItem onClick={() => setHopLyDo({ loai: "GO_MIEN_PHI", dong: d })}>
                                Gỡ miễn phí ngoại lệ…
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setHopLyDo({ loai: "HUY", dong: d })}
                            >
                              Huỷ — không bù buổi này…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {coTheXep && dangChon.length > 0 && (
        <div className="sticky bottom-3 z-10 mt-3 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-md sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-medium">Đã chọn {dangChon.length} học viên</p>
            <p className={cn("truncate text-xs", lyDoKhoa ? "text-destructive" : "text-muted-foreground")}>
              {lyDoKhoa ?? "Cùng cơ sở, cùng khoá, cùng buổi bù — xếp chung một case được"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setChon(new Set())}>
              Bỏ chọn
            </Button>
            <Button size="sm" disabled={!!lyDoKhoa || dangMo} onClick={() => moXep(dangChon.map((d) => d.id))}>
              <CalendarPlus aria-hidden /> {dangMo ? "Đang mở…" : `Xếp ${dangChon.length} bé vào case`}
            </Button>
          </div>
        </div>
      )}

      {hopXep && (
        <HopXepCase
          mo={hopXep}
          onDong={(daXep) => {
            setHopXep(null);
            if (daXep) setChon(new Set());
          }}
        />
      )}
      <HopLyDo hop={hopLyDo} onDong={() => setHopLyDo(null)} />
      <HopGiaiThichLuot hop={hopBienLai} onDong={() => setHopBienLai(null)} />
    </>
  );
}

function NhanPhi({ d }: { d: DongCanBu }) {
  switch (d.phi.loai) {
    case "LUOT":
      return <StatusPill tone="success">Bù miễn phí</StatusPill>;
    case "MIEN_PHI":
      return <StatusPill tone="info">Miễn phí ngoại lệ</StatusPill>;
    case "DA_THU":
      return <StatusPill tone="success">Đã thu phí</StatusPill>;
    case "CHO_THU":
      return <StatusPill tone="warning">Chờ thu phí</StatusPill>;
    case "CAN_THU":
      return <StatusPill tone="danger">Cần thu phí</StatusPill>;
  }
}

function HopLyDo({ hop, onDong }: { hop: HopLyDo; onDong: () => void }) {
  const router = useRouter();
  const [lyDo, setLyDo] = useState("");
  const [pending, start] = useTransition();
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;
  const laHuy = hop?.loai === "HUY";
  const laGo = hop?.loai === "GO_MIEN_PHI";

  function xacNhan() {
    if (!hop || !du) return;
    start(async () => {
      const kq = laHuy
        ? await huyBuoiCanBuAction({ id: hop.dong.id, lyDo })
        : laGo
          ? await goMienPhiBuAction({ needId: hop.dong.id, lyDo })
          : await mienPhiBuAction({ needId: hop.dong.id, lyDo });
      if (!kq.ok) {
        toast.error(kq.error);
        return;
      }
      toast.success(laHuy ? "Đã huỷ — buổi này không bù nữa" : laGo ? "Đã gỡ miễn phí — buổi này tính phí như thường" : "Đã duyệt học bù miễn phí");
      // HB-22: huỷ KHÔNG tự hoàn tiền — đã thu phí thì nói rõ để người bấm báo kế toán.
      const nhac = laHuy ? (kq as { canhBao?: string }).canhBao : undefined;
      if (nhac) toast.warning(nhac, { duration: 15000 });
      setLyDo("");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open={hop !== null} onOpenChange={(mo) => !mo && onDong()}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{laHuy ? "Huỷ buổi cần bù" : laGo ? "Gỡ miễn phí ngoại lệ" : "Duyệt học bù miễn phí"}</DialogTitle>
          <DialogDescription>
            {hop ? `${hop.dong.hocVien} — vắng ${hop.dong.ngayVang ? formatDateVN(hop.dong.ngayVang) : ""}. ` : ""}
            {laHuy
              ? "Buổi này sẽ nghỉ luôn, không bù nữa, và không tự hiện lại khi sửa điểm danh."
              : laGo
                ? "Buổi này quay lại tính phí như thường. Chỉ gỡ được khi chưa xếp vào case; lý do được lưu để đối chiếu."
                : "Học viên đã hết lượt bù. Duyệt ngoại lệ thì xếp case được mà không thu phí."}
          </DialogDescription>
        </DialogHeader>
        <Textarea value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="Lý do (bắt buộc)" rows={3} />
        <p className="min-h-4 text-xs text-muted-foreground">
          {du ? "" : `Cần ít nhất ${LY_DO_TOI_THIEU} ký tự (đang có ${lyDo.trim().length}).`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onDong} disabled={pending}>
            Đóng
          </Button>
          <Button variant={laHuy ? "destructive" : "default"} onClick={xacNhan} disabled={!du || pending}>
            {pending ? "Đang lưu…" : laHuy ? "Huỷ buổi này" : laGo ? "Gỡ miễn phí" : "Duyệt miễn phí"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Vì sao còn x/y lượt?" — đọc từ SỔ LƯỢT thật (bút toán), không phải công thức suy ngược. Cuộn trong hộp, 375px không tràn ngang.
function HopGiaiThichLuot({ hop, onDong }: { hop: HopBienLai; onDong: () => void }) {
  return (
    <Dialog open={hop !== null} onOpenChange={(mo) => !mo && onDong()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vì sao còn lượt bù như vậy?</DialogTitle>
          <DialogDescription>{hop ? `${hop.dong.hocVien} · ${hop.dong.khoa}` : ""}</DialogDescription>
        </DialogHeader>
        {hop && !hop.ket.ok && <p className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">{hop.ket.error}</p>}
        {hop && hop.ket.ok && (
          <div className="space-y-3">
            <p className="text-sm text-foreground" data-tom-tat>
              {hop.ket.tomTat}
            </p>
            {hop.ket.dong.length > 0 && (
              <ol className="divide-y divide-border rounded-lg border border-border">
                {hop.ket.dong.map((e, i) => (
                  <li key={i} className="space-y-0.5 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{e.nhan}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{formatDateVN(e.ngay)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{e.thayDoi}</p>
                    {e.lyDo && <p className="text-xs text-muted-foreground">Ghi chú: {e.lyDo}</p>}
                  </li>
                ))}
              </ol>
            )}
            {hop.ket.biCat && <p className="text-xs text-muted-foreground">Sổ dài hơn danh sách này — chỉ hiện các bút toán mới nhất.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDong}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
