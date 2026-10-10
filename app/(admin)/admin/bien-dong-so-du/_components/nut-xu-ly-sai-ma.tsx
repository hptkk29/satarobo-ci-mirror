"use client";

// NÚT DUYỆT / TỪ CHỐI một yêu cầu "sale nhập sai mã trên máy" — chỉ `payments:manage` (Việc 3 · 09/10/2026).
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.9.
//
//   · DUYỆT = MỘT bấm, không hộp xác nhận (đặc tả). Yêu cầu kẹt ở "đang ghi" ≥ 2 phút thì chính nút này là "Thử lại ghi nhận".
//   · TỪ CHỐI = mở HỘP THOẠI nhập lý do (≥ 5 ký tự, cùng ngưỡng CHECK của DB). Bản đầu để ô lý do ngay trong ô bảng; smoke 375px
//     09/10/2026 đo được ô đó rộng 304px trong khung 293px nên bị cắt mép phải — hộp thoại không phụ thuộc bề rộng cột và có sẵn
//     bẫy tiêu điểm/Escape. Từ chối NHẢ giao dịch về hàng chờ — nó vẫn gắn tay được; phiếu thẻ về CHO_QUET và sale thấy lệnh
//     "ĐỪNG cho khách quẹt lại".
//   · Người xem CHÍNH là người gửi ⇒ hai nút vô hiệu + `title` "Cần người khác duyệt" (luật 12: nút chắc chắn bị từ chối thì không
//     hứa; máy chủ và CHECK của DB vẫn gác).
// Chữ trên nút nói đúng việc; KHÔNG chữ nào nhắc huỷ giao dịch trên máy (đặc tả điều 6).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { duyetSaiMaAction, tuChoiSaiMaAction } from "../_pos-sai-ma-actions";

/** Cùng ngưỡng với `tuChoiSaiMaSchema` và CHECK `PosSaiMaYeuCau_tu_choi_check`. */
const TOI_THIEU = 5;

/** Rớt kết nối giữa chừng (action reject): câu tiếng Việt nói thật là CHƯA RÕ kết quả, không chữ kỹ thuật. Ca `[HN3-RK14]`. */
const CAU_MAT_KET_NOI_DUYET = "Mất kết nối — chưa rõ đã duyệt chưa. Đã tải lại danh sách; kiểm tra rồi mới bấm lại.";
const CAU_MAT_KET_NOI_TU_CHOI = "Mất kết nối — chưa rõ đã từ chối chưa. Đã tải lại danh sách; kiểm tra rồi mới bấm lại.";

export function NutXuLySaiMa({
  orderId,
  yeuCauId,
  tomTat,
  laNguoiGui,
  thuLai,
}: {
  orderId: string;
  yeuCauId: string;
  /**
   * Một dòng nói ĐANG xử lý yêu cầu nào ("ORD-… · 3.168.000đ · thẻ …1234") — in trong hộp thoại từ chối: hộp phủ lên bảng nên người bấm
   * mất dòng của mình khỏi tầm mắt, mà từ chối nhầm dòng là trả nhầm giao dịch về hàng chờ. ⚠️ BẮT BUỘC, không `?` (luật 11).
   */
  tomTat: string;
  /** Người đang xem chính là người gửi yêu cầu này. */
  laNguoiGui: boolean;
  /** Yêu cầu KẸT ở "đang ghi" ≥ 2 phút — nút Duyệt thành "Thử lại ghi nhận", không có Từ chối (không từ chối được yêu cầu đang ghi tiền). */
  thuLai: boolean;
}) {
  const router = useRouter();
  const [moTuChoi, setMoTuChoi] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dangChay, batDau] = useTransition();
  const du = lyDo.trim().length >= TOI_THIEU;
  const khoa = dangChay || laNguoiGui;
  const tieuDeKhoa = laNguoiGui ? "Cần người khác duyệt" : undefined;
  const idLyDo = `ly-do-${yeuCauId}`;

  function duyet() {
    batDau(async () => {
      let res: Awaited<ReturnType<typeof duyetSaiMaAction>> | null;
      try {
        res = await duyetSaiMaAction({ orderId, yeuCauId });
      } catch {
        res = null; // rớt kết nối: CHƯA RÕ máy chủ đã duyệt chưa — không để lỗi chưa bắt văng cả trang
      }
      if (res === null) toast.error(CAU_MAT_KET_NOI_DUYET);
      else if (res.ok) toast.success(res.thongDiep);
      else toast.error(res.error);
      // Làm mới CẢ khi bị từ chối / rớt kết nối: trạng thái yêu cầu có thể đã đổi dưới chân người bấm (bên kia vừa quyết, hoặc yêu cầu
      // của mình đã tới nơi).
      router.refresh();
    });
  }

  function tuChoi() {
    batDau(async () => {
      let res: Awaited<ReturnType<typeof tuChoiSaiMaAction>> | null;
      try {
        res = await tuChoiSaiMaAction({ orderId, yeuCauId, lyDo });
      } catch {
        res = null;
      }
      if (res === null) {
        // Giữ nguyên hộp thoại + lý do đã gõ: người dùng bấm lại được mà không gõ lại.
        toast.error(CAU_MAT_KET_NOI_TU_CHOI);
      } else if (res.ok) {
        toast.success(res.thongDiep);
        setMoTuChoi(false);
        setLyDo("");
      } else {
        toast.error(res.error);
      }
      router.refresh();
    });
  }

  function dongHop() {
    setMoTuChoi(false);
    setLyDo("");
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={khoa}
          title={tieuDeKhoa}
          onClick={duyet}
          className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary-dark disabled:opacity-50"
        >
          {dangChay && !moTuChoi ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {thuLai ? "Thử lại ghi nhận" : "Duyệt"}
        </button>
        {!thuLai && (
          <button
            type="button"
            disabled={khoa}
            title={tieuDeKhoa}
            onClick={() => setMoTuChoi(true)}
            className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden />
            Từ chối
          </button>
        )}
      </div>
      {/* Luật 12: nút khoá thì NÓI vì sao bằng chữ nhìn thấy được — `title` không tới tay người dùng cảm ứng/bàn phím. */}
      {laNguoiGui && <p className="mt-1 text-xs text-muted-foreground">Cần người khác duyệt</p>}

      {!thuLai && (
        <Dialog
          open={moTuChoi}
          onOpenChange={(mo) => {
            // Đang gửi thì không đóng giữa chừng (tránh bỏ dở rồi bấm lại).
            if (dangChay) return;
            if (mo) setMoTuChoi(true);
            else dongHop();
          }}
        >
          <DialogContent className="admin-scope sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Từ chối giao dịch sale đã chọn</DialogTitle>
              <DialogDescription>
                Giao dịch trở về hàng chờ để gắn tay. Sale sẽ thấy lý do dưới đây và lệnh ĐỪNG cho khách quẹt lại.
              </DialogDescription>
              <p className="break-words rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium tabular-nums text-foreground">{tomTat}</p>
            </DialogHeader>
            <div className="space-y-1.5">
              <label htmlFor={idLyDo} className="block text-sm font-medium text-foreground">
                Lý do từ chối <span className="text-state-danger-ink">*</span>
              </label>
              <textarea
                id={idLyDo}
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                rows={3}
                maxLength={500}
                required
                autoFocus
                placeholder="vd: giao dịch này là của khách khác"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {!du && lyDo.length > 0 && <p className="text-xs text-muted-foreground">Ít nhất {TOI_THIEU} ký tự.</p>}
            </div>
            <DialogFooter>
              <button
                type="button"
                disabled={dangChay}
                onClick={dongHop}
                className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-50 sm:min-h-9"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={khoa || !du}
                onClick={tuChoi}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-state-danger-ink px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-state-danger-ink-hover disabled:opacity-50 sm:min-h-9"
              >
                {dangChay && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {dangChay ? "Đang từ chối…" : "Xác nhận từ chối"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
