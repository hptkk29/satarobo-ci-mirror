"use client";

// components/admin/nguon-hoa-hong/hop-thoai-doi-nguon-page.tsx — HỘP THOẠI XÁC NHẬN khi ĐỔI NGUỒN của một Page (gán · dời · gỡ). W2, 10/10/2026 (res3 R3-M2).
//
// Vì sao có: nguồn của Page quyết định ai nhận hoa hồng của MỌI lead tương lai vào từ Page đó, nhưng trước đây bấm «Lưu» ở dòng bảng là xong — không lý do, không dấu vết vì sao.
// Nay mọi lượt đổi NGUỒN (không phải chỉ đổi mã chiến dịch) đi qua hộp thoại này: nói rõ hệ quả, đòi lý do ≥ 10 ký tự (CÙNG `loiLyDoGanPage` với máy chủ), và — khi nguồn cũ hoặc mới đang dính tiền —
// nói TRƯỚC rằng cần quyền kích hoạt chính sách thay vì để người dùng gõ lý do rồi mới bị từ chối (luật 12).
// Hộp thoại nằm ngoài bảng (portal) nên không thêm cột vào bảng 820px; panel mang `admin-scope` để nút xác nhận đúng màu tím admin.
import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CAU_THIEU_QUYEN_GAN_PAGE, LY_DO_TOI_THIEU_NGUON, loiLyDoGanPage } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, TEXTAREA } from "./classes";

export function HopThoaiDoiNguonPage({
  tenPage,
  tu,
  den,
  dinhTien,
  coQuyenKichHoat,
  dangLuu,
  loiMayChu,
  xacNhan,
  dong,
}: {
  tenPage: string;
  /** Tên nguồn đang gán; null = chưa gán. */
  tu: string | null;
  /** Tên nguồn sắp gán; null = gỡ nguồn. */
  den: string | null;
  /** Nguồn cũ HOẶC mới đang dính tiền theo rule (`dinhTienTheoMa`) — đổi cần `commission_policies:activate`. */
  dinhTien: boolean;
  coQuyenKichHoat: boolean;
  dangLuu: boolean;
  /** Máy chủ từ chối lượt lưu vừa rồi: hộp thoại GIỮ MỞ, lý do đã gõ còn nguyên, lỗi hiện cạnh ô (lỗi nhập tại chỗ `loi` được ưu tiên). */
  loiMayChu: string | null;
  /** Gọi với lý do đã trim. */
  xacNhan: (lyDo: string) => void;
  dong: () => void;
}) {
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const biChan = dinhTien && !coQuyenKichHoat;
  const goNguon = den === null;
  const loiHien = loi ?? loiMayChu;

  function nop() {
    if (dangLuu) return;
    const l = loiLyDoGanPage(lyDo);
    if (l) {
      setLoi(l);
      return;
    }
    setLoi(null);
    xacNhan(lyDo.trim());
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{goNguon ? `Gỡ nguồn của Page «${tenPage}»` : `Đổi nguồn của Page «${tenPage}»`}</DialogTitle>
          <DialogDescription render={<div />} className="text-sm text-foreground">
            <span className="text-muted-foreground">{tu ?? "Chưa gán nguồn"}</span>
            <span aria-hidden> → </span>
            <b className="font-medium">{den ?? "Chưa gán nguồn"}</b>
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Nguồn của Page quyết định ai nhận hoa hồng của <b className="font-medium text-foreground">mọi lead mới</b> vào từ Page này. Lead đã có không đổi.
        </p>

        {biChan ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0">{CAU_THIEU_QUYEN_GAN_PAGE}</p>
          </div>
        ) : (
          <div>
            <label htmlFor="doi-nguon-page-ly-do" className={NHAN_O}>
              Lý do (tối thiểu {LY_DO_TOI_THIEU_NGUON} ký tự)
            </label>
            <textarea
              id="doi-nguon-page-ly-do"
              rows={2}
              maxLength={500}
              value={lyDo}
              onChange={(e) => {
                setLyDo(e.target.value);
                setLoi(null);
              }}
              aria-invalid={loiHien ? true : undefined}
              aria-describedby={loiHien ? "doi-nguon-page-loi-ly-do" : undefined}
              className={TEXTAREA}
            />
            {loiHien && (
              <p id="doi-nguon-page-loi-ly-do" role="alert" className={LOI_O}>
                {loiHien}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {biChan ? "Đóng" : "Huỷ"}
          </button>
          {!biChan && (
            <button type="button" onClick={nop} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {goNguon ? "Gỡ nguồn" : "Lưu"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
