"use client";

// components/admin/nguon-hoa-hong/website/hop-thoai-ly-do.tsx — HỘP THOẠI xác nhận một việc có LÝ DO (ngừng · bật lại · xoá website).
//
// MỘT khung cho cả ba việc: tiêu đề + mô tả hệ quả + ô lý do + hai nút. Luật (có cần lý do không, tối thiểu bao nhiêu ký tự) do NƠI GỌI truyền vào từ hằng của lõi
// (`LY_DO_TOI_THIEU_WEBSITE`) — hộp thoại không tự gõ «10». Kiểm lại ở máy chủ là cổng thật; kiểm ở đây chỉ để báo lỗi CẠNH ô trước khi gọi.
//  · Lỗi về lý do hiện cạnh ô lý do; lỗi khác là banner `role="alert"`; «vừa được người khác đổi» có nút «Tải lại» (đóng hộp thoại + tải lại trang).
//  · Hộp thoại không đóng được khi đang lưu.
//  · `hanhDong` nhận lý do đã trim (hoặc null khi để trống ở việc tuỳ chọn) và trả kết quả của Server Action.
import { useId, useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "../classes";

export type KetQuaViec = { ok: true } | { ok: false; loi: string; truong?: string };

export function HopThoaiLyDo({
  tieuDe,
  moTa,
  nhanXacNhan,
  lyDoToiThieu,
  hanhDong,
  thongBaoXong,
  dong,
  taiLai,
  nguyHiem = false,
}: {
  tieuDe: string;
  moTa: ReactNode;
  nhanXacNhan: string;
  /** 0 = lý do tuỳ chọn. BẮT BUỘC (luật 7): nơi gọi phải nói rõ. */
  lyDoToiThieu: number;
  hanhDong: (lyDo: string | null) => Promise<KetQuaViec>;
  /** Câu toast khi xong. */
  thongBaoXong: string;
  dong: () => void;
  /** Tải lại dữ liệu trang (router.refresh) — gọi sau khi xong và khi người dùng bấm «Tải lại». */
  taiLai: () => void;
  nguyHiem?: boolean;
}) {
  const id = useId();
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; vuaDoi: boolean } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  async function xacNhan() {
    if (dangLuu) return;
    setBanner(null);
    const ly = lyDo.trim();
    if (lyDoToiThieu > 0 && ly.length < lyDoToiThieu) {
      setLoiLyDo(`Ghi lý do (tối thiểu ${lyDoToiThieu} ký tự).`);
      return;
    }
    setLoiLyDo(null);
    setDangLuu(true);
    let r: KetQuaViec;
    try {
      r = await hanhDong(ly === "" ? null : ly);
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.truong === "lyDo") setLoiLyDo(r.loi);
      else setBanner({ text: r.loi, vuaDoi: r.truong === "vuaDoi" });
      return;
    }
    toast.success(thongBaoXong);
    dong();
    taiLai();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          <DialogDescription render={<div />}>{moTa}</DialogDescription>
        </DialogHeader>

        {banner && (
          <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{banner.text}</p>
            {banner.vuaDoi && (
              <button
                type="button"
                onClick={() => {
                  dong();
                  taiLai();
                }}
                className={cn(BTN_OUTLINE, NUT_NHO)}
              >
                Tải lại
              </button>
            )}
          </div>
        )}

        <div>
          <label htmlFor={`${id}-ly-do`} className={NHAN_O}>
            {lyDoToiThieu > 0 ? `Lý do (tối thiểu ${lyDoToiThieu} ký tự)` : "Lý do (tuỳ chọn)"}
          </label>
          <textarea
            id={`${id}-ly-do`}
            rows={2}
            maxLength={500}
            value={lyDo}
            disabled={dangLuu}
            onChange={(e) => {
              setLyDo(e.target.value);
              setLoiLyDo(null);
            }}
            aria-invalid={loiLyDo ? true : undefined}
            aria-describedby={loiLyDo ? `${id}-loi-ly-do` : undefined}
            className={TEXTAREA}
          />
          {loiLyDo && (
            <p id={`${id}-loi-ly-do`} role="alert" className={LOI_O}>
              {loiLyDo}
            </p>
          )}
        </div>

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Huỷ
          </button>
          <button type="button" onClick={() => void xacNhan()} disabled={dangLuu} className={cn(nguyHiem ? BTN_DANGER_OUTLINE : BTN_PRIMARY, NUT_CHAN)}>
            {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {nhanXacNhan}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
