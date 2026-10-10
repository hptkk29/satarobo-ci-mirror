"use client";

// Hộp PHIẾU THU THẺ POS (GĐ1 · 06/10/2026) — docs/pos-gd1-thiet-ke.md §7.3.
//
// Cảnh dùng: sale đứng quầy, phụ huynh đứng chờ, máy SmartPOS trên tay. Hai thứ sale phải ĐỌC
// từ màn để GÕ vào máy — số tiền và mã 5 ký tự — nên chúng là chữ to nhất của hộp; mọi thứ khác
// lùi lại. Sau khi khách quẹt, việc duy nhất là bấm "Kiểm tra thanh toán" và đọc MỘT câu.
//
// Luật 12 (affordance nói thật):
//   · "Báo admin" chỉ hiện khi cổng máy chủ sẽ cho — hỏi CHÍNH `lyDoKhongBaoAdmin` mà
//     `baoAdminPhieuPos` hỏi lại, không chép điều kiện (`[POS1-UI-W4]`);
//   · "Tạo phiếu mới" chỉ khi phiếu HẾT HẠN. Phiếu thất bại vẫn MỞ — khách quẹt lại với CÙNG mã;
//     giao dịch còn ở hàng chờ kế toán (T21) thì không có nút nào mời quẹt lần hai;
//   · số GÕ VÀO MÁY là còn phải thu HIỆN TẠI của phiếu gộp, không phải số lúc tạo.
//
// `admin-scope` trên `DialogContent`: hộp portal ra ngoài khung admin, thiếu class là nút lấy
// `--primary` CAM của :root (tiền lệ `nhap-file-pos.tsx`).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  CreditCard,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { lyDoKhongBaoAdmin, type PhieuPosView } from "@/lib/payments/pos/phieu-pos-luat";
import { thongDiepTrangThai, type MucDoPos } from "@/lib/payments/pos/thong-diep-pos";
import { baoAdminPhieuPosAction, kiemTraPhieuPosAction, taoPhieuPosAction } from "../_actions";

/** Máy POS đang bật của cơ sở giữ đơn — nhãn là mã quầy (thứ in trên thân máy). */
export type MayPosView = { id: string; nhan: string };

const so = (n: number) => n.toLocaleString("vi-VN");
const gio = (iso: string) => iso.slice(11, 16);
const gioNgay = (iso: string) => `${iso.slice(11, 16)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Mở (hoặc nhận lại) phiếu thu thẻ cho MỘT đợt. Đặt ở đây để cả nút trên dòng đợt lẫn hộp (chọn
 * máy · tạo phiếu mới khi hết hạn) đi CÙNG một lời gọi — một chỗ dịch lỗi, một chỗ làm mới trang.
 */
export function useTaoPhieuPos(orderId: string) {
  const router = useRouter();
  const [dangTao, start] = useTransition();
  function tao(
    paymentRequestId: string,
    posTerminalId: string | undefined,
    xong: (phieu: PhieuPosView) => void,
  ) {
    start(async () => {
      const res = await taoPhieuPosAction({
        orderId,
        paymentRequestId,
        ...(posTerminalId ? { posTerminalId } : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      xong(res.phieu);
      router.refresh();
    });
  }
  return { tao, dangTao };
}

const TONE: Record<MucDoPos, { khung: string; chu: string; Icon: typeof Info }> = {
  thanh_cong: { khung: "border-state-success/30 bg-state-success-soft", chu: "text-state-success-ink", Icon: CircleCheck },
  canh_bao: { khung: "border-state-warning/40 bg-state-warning-soft", chu: "text-state-warning-ink", Icon: TriangleAlert },
  loi: { khung: "border-state-danger/30 bg-state-danger-soft", chu: "text-state-danger-ink", Icon: CircleX },
  thong_tin: { khung: "border-border bg-muted/60", chu: "text-foreground", Icon: Info },
};

function NutChep({ giaTri, nhan }: { giaTri: string; nhan: string }) {
  const [daChep, datDaChep] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`${nhan}: ${giaTri}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(giaTri);
          datDaChep(true);
          setTimeout(() => datDaChep(false), 1500);
        } catch {
          toast.error("Trình duyệt không cho chép — đọc và gõ tay");
        }
      }}
    >
      {daChep ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {daChep ? "Đã chép" : nhan}
    </Button>
  );
}

/** `luc` = "hh:mm" giờ VN, `null` khi không có. */
type KetQuaVuaKiem = { thongDiep: string; mucDo: MucDoPos; luc: string | null };

export function HopPhieuPos({
  orderId,
  mo,
  onDong,
  phieu,
  paymentRequestId,
  nhanDot,
  mayPos,
  tao,
  dangTao,
  onPhieu,
  onVeChonMay,
}: {
  orderId: string;
  mo: boolean;
  onDong: () => void;
  /** Phiếu đang xem — `null` khi chưa tạo (cơ sở nhiều máy: bước chọn máy). */
  phieu: PhieuPosView | null;
  /** Đợt bấm vào — nguồn của "Tạo phiếu" / "Tạo phiếu mới". */
  paymentRequestId: string;
  nhanDot: string;
  mayPos: MayPosView[];
  tao: ReturnType<typeof useTaoPhieuPos>["tao"];
  dangTao: boolean;
  onPhieu: (p: PhieuPosView) => void;
  /** Phiếu hết hạn trên máy đã tắt (cơ sở nhiều máy) ⇒ quay về bước chọn máy. */
  onVeChonMay: () => void;
}) {
  const router = useRouter();
  const [dangKiem, startKiem] = useTransition();
  const [dangBao, startBao] = useTransition();
  const [vuaKiem, datVuaKiem] = useState<KetQuaVuaKiem | null>(null);
  const [mayChon, datMayChon] = useState<string | null>(mayPos.length === 1 ? mayPos[0]!.id : null);
  // Đồng hồ cho nút "Báo admin" (mở sau 10 phút) — chỉ chạy khi hộp mở.
  const [bayGio, datBayGio] = useState(() => new Date());
  useEffect(() => {
    if (!mo) return;
    datBayGio(new Date());
    const t = setInterval(() => datBayGio(new Date()), 15_000);
    return () => clearInterval(t);
  }, [mo]);

  // Câu vừa kiểm thuộc về CHÍNH phiếu đang xem — đổi phiếu thì bỏ.
  const [vuaKiemCua, datVuaKiemCua] = useState<string | null>(null);
  const ketQuaHienThi =
    vuaKiem && phieu && vuaKiemCua === phieu.intentId
      ? vuaKiem
      : phieu?.thongDiep
        ? { thongDiep: phieu.thongDiep, mucDo: phieu.mucDo, luc: phieu.kiemLuc ? gio(phieu.kiemLuc) : null }
        : null;

  function kiemTra(p: PhieuPosView) {
    startKiem(async () => {
      const res = await kiemTraPhieuPosAction({ orderId, intentId: p.intentId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Giờ của lượt kiểm THẬT (lượt bấm dồn trả câu cũ ⇒ giờ cũ), không phải giờ bấm.
      datVuaKiem({ thongDiep: res.ketQua.thongDiep, mucDo: res.ketQua.mucDo, luc: gio(res.ketQua.kiemLuc) });
      datVuaKiemCua(p.intentId);
      router.refresh();
    });
  }

  function baoAdmin(p: PhieuPosView) {
    startBao(async () => {
      const res = await baoAdminPhieuPosAction({ orderId, intentId: p.intentId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã báo ${res.soNguoi} người (Kế toán HO / Quản trị)`);
    });
  }

  const dongDuoc = !dangTao && !dangKiem && !dangBao;

  return (
    <Dialog open={mo} onOpenChange={(o) => !o && dongDuoc && onDong()}>
      <DialogContent className="admin-scope flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {phieu === null ? (
          <BuocChonMay
            nhanDot={nhanDot}
            mayPos={mayPos}
            mayChon={mayChon}
            datMayChon={datMayChon}
            dangTao={dangTao}
            onTao={() => mayChon && tao(paymentRequestId, mayChon, onPhieu)}
          />
        ) : (
          <NoiDungPhieu
            phieu={phieu}
            nhanDot={nhanDot}
            ketQua={ketQuaHienThi}
            dangKiem={dangKiem}
            dangBao={dangBao}
            dangTao={dangTao}
            choBaoAdmin={
              lyDoKhongBaoAdmin(
                { status: phieu.trangThai, lastResultKind: phieu.ketQuaGanNhat, createdAt: new Date(phieu.taoLuc) },
                bayGio,
              ) === null
            }
            onKiem={() => kiemTra(phieu)}
            onBao={() => baoAdmin(phieu)}
            onTaoMoi={() => {
              // Máy cũ còn bật thì quẹt lại trên máy cũ; cơ sở nhiều máy mà máy cũ đã tắt ⇒ về bước chọn.
              const mayCu = phieu.may && mayPos.some((m) => m.id === phieu.may?.id) ? phieu.may.id : undefined;
              if (mayPos.length > 1 && !mayCu) {
                datMayChon(null);
                onVeChonMay();
                return;
              }
              tao(paymentRequestId, mayPos.length > 1 ? mayCu : undefined, onPhieu);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BuocChonMay({
  nhanDot,
  mayPos,
  mayChon,
  datMayChon,
  dangTao,
  onTao,
}: {
  nhanDot: string;
  mayPos: MayPosView[];
  mayChon: string | null;
  datMayChon: (id: string) => void;
  dangTao: boolean;
  onTao: () => void;
}) {
  return (
    <>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4 pr-12">
        <DialogTitle className="text-base font-semibold">Thu thẻ POS — {nhanDot}</DialogTitle>
        <DialogDescription className="text-xs">
          Cơ sở có {mayPos.length} máy. Chọn máy khách sẽ quẹt — phiếu chỉ khớp giao dịch của máy thuộc cơ sở này.
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label="Máy POS" className="grid gap-2 px-5 py-4 sm:grid-cols-2">
        {mayPos.map((m) => {
          const chon = m.id === mayChon;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={chon}
              onClick={() => datMayChon(m.id)}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                chon ? "border-primary bg-primary-soft font-semibold text-foreground" : "border-border hover:bg-muted",
              )}
            >
              <CreditCard className={cn("size-4 shrink-0", chon ? "text-primary" : "text-muted-foreground")} aria-hidden />
              <span className="min-w-0 truncate font-mono">{m.nhan}</span>
            </button>
          );
        })}
      </div>
      <DialogFooter className="mx-0 mb-0 px-5 py-3">
        <Button type="button" disabled={!mayChon || dangTao} onClick={onTao} className="gap-2">
          {dangTao ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
          Tạo phiếu thu thẻ
        </Button>
      </DialogFooter>
    </>
  );
}

function NoiDungPhieu({
  phieu,
  nhanDot,
  ketQua,
  dangKiem,
  dangBao,
  dangTao,
  choBaoAdmin,
  onKiem,
  onBao,
  onTaoMoi,
}: {
  phieu: PhieuPosView;
  nhanDot: string;
  ketQua: KetQuaVuaKiem | null;
  dangKiem: boolean;
  dangBao: boolean;
  dangTao: boolean;
  choBaoAdmin: boolean;
  onKiem: () => void;
  onBao: () => void;
  onTaoMoi: () => void;
}) {
  const h = phieu.hienThi;
  // Còn cần gõ vào máy? Chỉ khi phiếu còn chờ quẹt và phiếu gộp còn khoản phải thu.
  const choQuet = (h === "CHO_QUET" || h === "THAT_BAI") && phieu.soTienPhaiThu !== null;
  const soGo = phieu.soTienPhaiThu;
  const daDoiSo = soGo !== null && soGo !== phieu.soTienLucTao;
  const cauTrangThai = thongDiepTrangThai(phieu.trangThai);
  const hien = ketQua ?? (h === "CHO_QUET" ? null : { thongDiep: cauTrangThai.cau, mucDo: cauTrangThai.mucDo, luc: null });
  const tone = hien ? TONE[hien.mucDo] : null;

  return (
    <>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4 pr-12">
        <DialogTitle className="text-base font-semibold">Thu thẻ POS — {nhanDot}</DialogTitle>
        <DialogDescription className="text-xs">
          {phieu.may ? (
            <>
              Quẹt trên máy <span className="font-mono font-medium text-foreground">{phieu.may.nhan}</span> ·{" "}
            </>
          ) : null}
          Tạo {gio(phieu.taoLuc)} · hết hạn {gioNgay(phieu.hetHanLuc)}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* ── Hai thứ gõ vào máy: SỐ TIỀN rồi MÃ (đúng thứ tự trên máy SmartPOS). ── */}
        <div className={cn("grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2", !choQuet && "opacity-60")}>
          <div className="min-w-0 bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">1 · Số tiền</span>
              {soGo !== null && <NutChep giaTri={String(soGo)} nhan="Chép số" />}
            </div>
            {soGo !== null ? (
              <p className="mt-0.5 font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {so(soGo)}
                <span className="ml-1 text-lg font-semibold text-muted-foreground">đ</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Phiếu gộp không còn khoản phải thu</p>
            )}
          </div>
          <div className="bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">2 · Mã ghi chú</span>
              <NutChep giaTri={phieu.code5} nhan="Chép mã" />
            </div>
            <p className="mt-0.5 font-mono text-4xl font-bold tracking-[0.3em] text-primary">{phieu.code5}</p>
          </div>
        </div>

        {daDoiSo && choQuet && (
          <p className="rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
            Số phải thu đã đổi từ {so(phieu.soTienLucTao)}đ thành <b>{so(soGo)}đ</b> — nhập {so(soGo)}đ.
          </p>
        )}

        {phieu.dongDot.length > 1 && (
          <div className="rounded-lg border border-border">
            <p className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Mã này thu cả {phieu.dongDot.length} đợt
            </p>
            <ul className="divide-y divide-border text-sm">
              {phieu.dongDot.map((d, i) => (
                <li key={`${d.nhan}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{d.nhan}</span>
                  <span className="shrink-0 tabular-nums">{so(d.soTien)}đ</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {choQuet && (
          <div>
            <ol className="space-y-1.5 text-sm text-foreground">
              {[
                "Nhập số tiền vào máy.",
                "Gõ mã vào ô Ghi chú — một mình nó, hoa hay thường đều được.",
                "Cho khách chạm hoặc quẹt thẻ.",
                "Biên lai báo “Thành công” thì bấm Kiểm tra thanh toán.",
              ].map((b, i) => (
                <li key={b} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="pt-px">{b}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Chỉ gõ một mã. Gõ thêm mã khác hoặc dính liền vào chữ thì giao dịch phải xử lý tay.
            </p>
          </div>
        )}

        {h === "PHIEU_DA_DONG" && (
          <p className="text-sm text-muted-foreground">
            Phiếu gộp của mã này đã đóng — đừng nhập mã này vào máy nữa. Vẫn kiểm tra được giao dịch đã quẹt.
          </p>
        )}

        <div aria-live="polite" className="min-h-0">
          {/* GĐ4 — cơ sở có máy POS Agent thì một lượt kiểm có thể CHỜ máy đồng bộ đọc portal tới ~8 giây. Nói
              trước thời gian chờ để sale không bấm dồn / cho khách quẹt lại. Câu cố ý KHÔNG nhắc "máy đồng bộ":
              trình duyệt không biết cơ sở này đọc từ agent hay từ file (luật 12 — câu phải đúng ở cả hai chế độ). */}
          {dangKiem ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              Đang hỏi Techcombank (tối đa ~10 giây)…
            </p>
          ) : null}
          {!dangKiem && hien && tone && (
            <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", tone.khung, tone.chu)}>
              <tone.Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="leading-relaxed">{hien.thongDiep}</p>
                {hien.luc && <p className="mt-0.5 text-xs opacity-80">Kiểm lúc {hien.luc}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="mx-0 mb-0 shrink-0 px-5 py-3">
        {h === "HET_HAN" && !phieu.choKeToan && (
          <Button type="button" variant="outline" disabled={dangTao} onClick={onTaoMoi} className="gap-2">
            {dangTao && <Loader2 className="animate-spin" aria-hidden />}
            Tạo phiếu mới
          </Button>
        )}
        {choBaoAdmin && (
          <Button type="button" variant="outline" disabled={dangBao} onClick={onBao} className="gap-2">
            {dangBao ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
            Báo admin
          </Button>
        )}
        {phieu.duocKiemTra && (
          <Button
            type="button"
            variant={choQuet || h === "HET_HAN" || h === "PHIEU_DA_DONG" ? "default" : "outline"}
            disabled={dangKiem}
            onClick={onKiem}
            className="gap-2"
          >
            {dangKiem && <Loader2 className="animate-spin" aria-hidden />}
            {dangKiem ? "Đang kiểm tra…" : "Kiểm tra thanh toán"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
