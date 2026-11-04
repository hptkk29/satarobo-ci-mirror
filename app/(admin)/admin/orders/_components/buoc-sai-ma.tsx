"use client";

// BƯỚC "CHỌN GIAO DỊCH CỦA KHÁCH" trong hộp phiếu thẻ POS (Việc 3 · 09/10/2026) — docs/pos-hai-nut-khai-may.md §5.3.9.
//
// Cảnh dùng: sale đứng quầy với phụ huynh, khách ĐÃ quẹt thành công nhưng sale gõ sai mã ở ô Ghi chú nên hệ thống nói "Chưa thấy
// giao dịch". Sale KHÔNG gõ tự do: máy chủ chỉ đưa ra giao dịch THÀNH CÔNG, ĐÚNG số tiền, ĐÚNG máy, từ lúc mở phiếu. Việc của sale
// là nhận ra giao dịch của khách bằng giờ quẹt · số tiền · 4 số cuối thẻ · ghi chú mình đã gõ — rồi bấm MỘT nút.
//
// Luật 12 (affordance nói thật):
//   · nhãn nút nói đúng điều SẮP xảy ra (`phanLoaiSaiMa` — cùng hàm máy chủ quyết): "Đúng giao dịch này — ghi nhận" khi sale xác
//     nhận là đủ; "Gửi kế toán xác nhận" kèm lý do khi cần kế toán. Máy chủ tính LẠI dưới khoá và có quyền đổi bậc;
//   · KHÔNG nút/câu nào nhắc huỷ giao dịch trên máy rồi quẹt lại (đặc tả điều 6: khách bị giữ tiền tạm, phát sinh VOID) — lưới
//     `[HN3-W10]` quét chữ "huỷ/hủy" trong tệp này;
//   · không có ứng viên ⇒ câu nguyên văn đặc tả + nút "Báo admin" SẴN CÓ (cùng cổng `choBaoAdmin` của hộp).
//
// Ghi chú là chữ NGƯỜI GÕ trên máy dùng chung: server đã `lamSachGhiChuHienThi` (điều khiển · zero-width · điều hướng hai chiều ·
// cắt 120); ở đây render bằng TEXT NODE — không HTML, không `dangerouslySetInnerHTML`.
import { useId } from "react";
import { ArrowLeft, BellRing, Info, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CAU_BI_BAC_KHONG_CON_UNG_VIEN,
  CAU_KHONG_UNG_VIEN,
  cauLyDo,
  lamSachGhiChuHienThi,
  type KetQuaTimSaiMa,
  type LyDoChoKeToan,
  type UngVienHienThi,
} from "@/lib/payments/pos/sai-ma";

const so = (n: number) => n.toLocaleString("vi-VN");
/** Giờ quẹt CÓ GIÂY ("13:28:35 09/10"): hai lần quẹt cùng phút, cùng thẻ, cùng ghi chú trống chỉ phân biệt được bằng giây. */
const gioNgay = (iso: string) => `${iso.slice(11, 19)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const NHAN_TU_GHI_NHAN = "Đúng giao dịch này — ghi nhận";
export const NHAN_GUI_KE_TOAN = "Gửi kế toán xác nhận";

export type BuocSaiMaProps = {
  /**
   * Mã ĐÚNG của phiếu (5 ký tự) — in ngay đầu bước để sale SO với ghi chú đã gõ trên từng thẻ ngay trước mắt, không phải nhớ từ màn trước
   * (giá trị của bước này chính là nhìn ra "H6WR9" ≠ "H6WR4"). ⚠️ BẮT BUỘC, không `?` (luật 11): thiếu thì bước vẫn chạy nhưng sale mất mốc so.
   */
  maDung: string;
  /** Đang hỏi máy chủ tìm ứng viên. */
  dangTim: boolean;
  /** `null` ⇒ chưa có kết quả (đang tìm, hoặc chưa tìm). */
  ketQua: KetQuaTimSaiMa | null;
  /** Đang gửi MỘT lựa chọn. */
  dangGui: boolean;
  /** Giao dịch đang gửi — chỉ nút của nó quay; các nút khác khoá. */
  dangGuiGiaoDich: string | null;
  /** CÙNG cổng với nút "Báo admin" của hộp (`lyDoKhongBaoAdmin`). */
  choBaoAdmin: boolean;
  dangBao: boolean;
  onChon: (bankTransactionId: string) => void;
  onBao: () => void;
  onQuayLai: () => void;
};

export function BuocSaiMa(p: BuocSaiMaProps) {
  const ok = p.ketQua?.ok === true ? p.ketQua : null;
  const loi = p.ketQua?.ok === false ? p.ketQua.error : null;
  // LỚP HIỂN THỊ TỰ BẢO VỆ (luật 12): chỉ thẻ ĐÚNG số tiền mà chính mô tả của bước này đang in ("đúng 800.000đ"). Máy chủ đã lọc
  // (`docUngVienSaiMa`); lọc lần nữa ở đây để một lần máy chủ lẫn giao dịch lệch tiền không bao giờ thành nút "Đúng giao dịch này".
  // Trống SAU lọc là trống thật ⇒ câu không-ứng-viên (nguyên văn đặc tả), không bao giờ để bước trắng.
  const ungVien = ok ? ok.ungVien.filter((u) => u.soTien === ok.soTien) : [];
  const khongCo = ok !== null && ungVien.length === 0;
  // Lý do CHUNG của mọi thẻ ("Có nhiều hơn một giao dịch cùng số tiền…" áp lên CẢ danh sách) in MỘT lần trên đầu danh sách; mỗi thẻ chỉ in
  // lý do RIÊNG của nó. Đo ở trình duyệt thật 375px: ba thẻ mang ba đoạn cam GIỐNG HỆT, mỗi thẻ cao ~210px. Chỉ gộp khi ≥ 2 thẻ (một thẻ
  // thì lý do nằm ngay trong thẻ). Một thẻ tự ghi nhận (không lý do) đứng cạnh ⇒ không có gì chung ⇒ không gộp.
  const lyDoChung: readonly LyDoChoKeToan[] =
    ungVien.length >= 2 ? ungVien.map((u) => u.xemTruoc.lyDo).reduce((a, b) => a.filter((l) => b.includes(l))) : [];

  return (
    <>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4 pr-12">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 mb-1 h-11 w-fit gap-1 px-2 text-xs text-muted-foreground hover:text-foreground sm:h-9"
          disabled={p.dangGui}
          onClick={p.onQuayLai}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Quay lại phiếu
        </Button>
        <DialogTitle className="text-base font-semibold">Chọn giao dịch của khách</DialogTitle>
        <DialogDescription className="text-xs">
          {ok
            ? `Chỉ hiện giao dịch THÀNH CÔNG, đúng ${so(ok.soTien)}đ, trên máy ${ok.may}, từ ${ok.tuLuc.slice(11, 16)}.`
            : "Chỉ hiện giao dịch THÀNH CÔNG, đúng số tiền của phiếu, trên máy của phiếu, từ lúc mở phiếu."}
        </DialogDescription>
        <p className="text-xs text-muted-foreground">
          Mã đúng của phiếu: <span className="ml-1 font-mono text-sm font-bold tracking-[0.2em] text-primary">{p.maDung}</span>
        </p>
      </DialogHeader>

      <div aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {p.dangTim && (
          <div role="status" aria-label="Đang tìm giao dịch" className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              Đang tìm giao dịch trên máy…
            </p>
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        )}

        {!p.dangTim && loi !== null && (
          <HopThongBao tone="canh_bao" cau={loi} baoAdmin={p.choBaoAdmin} dangBao={p.dangBao} onBao={p.onBao} />
        )}

        {!p.dangTim && khongCo && (
          <HopThongBao tone={ok.cau === CAU_BI_BAC_KHONG_CON_UNG_VIEN ? "canh_bao" : "thong_tin"} cau={ok.cau ?? CAU_KHONG_UNG_VIEN} baoAdmin={p.choBaoAdmin} dangBao={p.dangBao} onBao={p.onBao} />
        )}

        {!p.dangTim && ok !== null && ungVien.length > 0 && (
          <>
            {lyDoChung.length > 0 && (
              <div className="space-y-1 rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
                {lyDoChung.map((ly) => (
                  <p key={ly}>{cauLyDo(ly)}</p>
                ))}
              </div>
            )}
            <ul className="space-y-3">
              {ungVien.map((u) => (
                <UngVienThe
                  key={u.bankTransactionId}
                  u={u}
                  lyDoChung={lyDoChung}
                  dangGui={p.dangGui}
                  dangChon={p.dangGuiGiaoDich === u.bankTransactionId}
                  onChon={() => p.onChon(u.bankTransactionId)}
                />
              ))}
            </ul>
            {ok.conNua && (
              <p className="text-xs text-muted-foreground">
                Còn giao dịch khác cùng số tiền chưa hiện hết — khi có nhiều giao dịch, mọi lựa chọn đều cần kế toán xác nhận.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Hộp thông báo trong bước: lỗi tìm / không có ứng viên. Kèm "Báo admin" SẴN CÓ khi cổng cho phép. */
function HopThongBao({
  tone,
  cau,
  baoAdmin,
  dangBao,
  onBao,
}: {
  tone: "canh_bao" | "thong_tin";
  cau: string;
  baoAdmin: boolean;
  dangBao: boolean;
  onBao: () => void;
}) {
  const canhBao = tone === "canh_bao";
  const Icon = canhBao ? TriangleAlert : Info;
  return (
    <div className="space-y-3">
      <div
        className={
          canhBao
            ? "flex gap-2.5 rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink"
            : "flex gap-2.5 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-sm text-foreground"
        }
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 leading-relaxed">{cau}</p>
      </div>
      {baoAdmin && (
        <Button type="button" variant="outline" disabled={dangBao} onClick={onBao} className="min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto">
          {dangBao ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
          Báo admin
        </Button>
      )}
    </div>
  );
}

/**
 * MỘT ứng viên = MỘT thẻ xếp chồng (không bảng: 375px không tràn). Hàng đầu: giờ quẹt · số tiền; hàng hai: số thẻ; ghi chú trong
 * ngoặc kép hoặc "(để trống)"; lý do cần kế toán (tối đa 2); nút toàn chiều ngang ≥ 44px.
 */
function UngVienThe({
  u,
  lyDoChung,
  dangGui,
  dangChon,
  onChon,
}: {
  u: UngVienHienThi;
  /** Lý do đã in MỘT lần ở đầu danh sách — thẻ không in lại. */
  lyDoChung: readonly LyDoChoKeToan[];
  dangGui: boolean;
  dangChon: boolean;
  onChon: () => void;
}) {
  const tuGhiNhan = u.xemTruoc.quyet === "TU_GHI_NHAN";
  const lyDoRieng = u.xemTruoc.lyDo.filter((l) => !lyDoChung.includes(l));
  // Ghi chú là chữ NGƯỜI GÕ trên máy dùng chung: máy chủ đã làm sạch, ở đây làm sạch LẠI (idempotent) để lớp trên có quên cũng không
  // lọt ký tự điều hướng hai chiều hay chuỗi dài vô hạn vào màn của sale. Chữ và `title` dùng CÙNG một chuỗi.
  const ghiChu = lamSachGhiChuHienThi(u.ghiChu);
  // Mọi nút chọn đều mang CÙNG tên ("Đúng giao dịch này — ghi nhận" ×N): người đọc bằng trình đọc màn hình chỉ phân biệt được qua
  // phần MÔ TẢ (giờ + số tiền của chính thẻ chứa nút). Dùng `aria-describedby`, KHÔNG đổi tên nút (tên là thứ chủ dự án chốt).
  const idTieuDe = useId();
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div id={idTieuDe} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold tabular-nums text-foreground">{gioNgay(u.gioQuet)}</span>
        <span className="font-mono text-lg font-bold tabular-nums tracking-tight text-foreground">
          {so(u.soTien)}
          <span className="ml-0.5 text-sm font-semibold text-muted-foreground">đ</span>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {u.soTheCuoi ? (
          <>
            Thẻ <span className="font-mono tabular-nums">…{u.soTheCuoi}</span>
          </>
        ) : (
          "Không rõ số thẻ"
        )}
      </p>
      <p className="mt-2 line-clamp-2 break-words text-sm text-foreground" title={ghiChu || undefined}>
        <span className="text-xs text-muted-foreground">Ghi chú đã nhập: </span>
        {ghiChu ? <span className="font-mono">{`“${ghiChu}”`}</span> : <span className="text-muted-foreground">(để trống)</span>}
      </p>
      {!tuGhiNhan && lyDoRieng.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-state-warning-ink">
          {lyDoRieng.slice(0, 2).map((ly) => (
            <li key={ly}>{cauLyDo(ly)}</li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant={tuGhiNhan ? "default" : "outline"}
        disabled={dangGui}
        onClick={onChon}
        aria-describedby={idTieuDe}
        className="mt-3 min-h-11 w-full gap-2"
      >
        {dangChon && <Loader2 className="animate-spin" aria-hidden />}
        {tuGhiNhan ? NHAN_TU_GHI_NHAN : NHAN_GUI_KE_TOAN}
      </Button>
    </li>
  );
}
