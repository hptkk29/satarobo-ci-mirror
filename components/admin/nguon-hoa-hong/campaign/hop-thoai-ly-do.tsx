"use client";

// components/admin/nguon-hoa-hong/campaign/hop-thoai-ly-do.tsx — HỘP THOẠI XÁC NHẬN CÓ LÝ DO, dùng chung cho mọi thao tác ghi ở tab Campaign: đổi trạng thái campaign, xoá quy tắc, gỡ website,
// đổi trạng thái thành viên. MỘT hộp thoại — để «lý do ≥ 10 ký tự», «vừa được người khác đổi → Tải lại» và «đang lưu» không có sáu bản lệch nhau.
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
//  · `canLyDo` do NƠI GỌI lấy từ bảng chuyển trạng thái của lib (cùng bảng mà hàm ghi kiểm); hộp thoại kiểm thêm độ dài ở phía trình duyệt để khỏi tốn một vòng máy chủ, nhưng MÁY CHỦ vẫn quyết.
//  · `chan` (các điều kiện chưa đạt) ⇒ hộp thoại chỉ ĐỌC: liệt kê TẤT CẢ điều kiện, mỗi cái có đường tới chỗ sửa (`gocChan` + `hrefMucSua`), và KHÔNG vẽ nút xác nhận — nút mà máy chủ chắc chắn từ chối là lời hứa suông.
//  · Lỗi máy chủ hiện CẠNH nơi nó nói tới (lý do) hoặc ở banner; `vuaDoi` có nút «Tải lại».
//  · Hàm gọi máy chủ được TIÊM (`xacNhan`) — test dựng bằng hàm giả.
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hrefMucSua, type ChanKichHoat } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, BTN_DANGER_OUTLINE, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "../classes";

export type KetQuaXacNhan = { ok: true } | { ok: false; loi: string; truong?: string; lyDoChan?: ChanKichHoat[] };

export type HopThoaiLyDoProps = {
  tieuDe: string;
  moTa?: ReactNode;
  nhanXacNhan: string;
  /** Nút xác nhận kiểu nguy hiểm (kết thúc · xoá · gỡ). */
  nguyHiem?: boolean;
  /** Bắt lý do ≥ `lyDoToiThieu` ký tự. */
  canLyDo: boolean;
  lyDoToiThieu: number;
  /** Điều kiện chưa đạt ⇒ hộp thoại chỉ đọc, không có nút xác nhận. */
  chan?: readonly ChanKichHoat[];
  /** Đường trang chi tiết campaign (`/nguon-hoa-hong/campaign/<mã>`) để dựng đường tới chỗ sửa từng điều kiện. Vắng ⇒ liệt kê không kèm đường. */
  gocChan?: string;
  /** Câu hiện khi thành công (toast). */
  thanhCong: string;
  xacNhan: (lyDo: string | null) => Promise<KetQuaXacNhan>;
  dong: () => void;
};

export function HopThoaiLyDo({ tieuDe, moTa, nhanXacNhan, nguyHiem = false, canLyDo, lyDoToiThieu, chan, gocChan, thanhCong, xacNhan, dong }: HopThoaiLyDoProps) {
  const router = useRouter();
  const uid = useId();
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ vuaDoi: boolean; text: string; chan: ChanKichHoat[] } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const chiDoc = (chan?.length ?? 0) > 0;

  async function nop() {
    if (dangLuu) return;
    setBanner(null);
    if (canLyDo && lyDo.trim().length < lyDoToiThieu) {
      setLoiLyDo(`Ghi lý do (tối thiểu ${lyDoToiThieu} ký tự).`);
      return;
    }
    setLoiLyDo(null);
    setDangLuu(true);
    let r: KetQuaXacNhan;
    try {
      r = await xacNhan(lyDo.trim() === "" ? null : lyDo.trim());
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.truong === "lyDo") setLoiLyDo(r.loi);
      else setBanner({ vuaDoi: r.truong === "vuaDoi", text: r.loi, chan: r.lyDoChan ?? [] });
      return;
    }
    toast.success(thanhCong);
    dong();
    router.refresh();
  }

  const idLoiLyDo = `${uid}-loi-ly-do`;
  // Đường tới chỗ sửa: đóng hộp thoại khi bấm (mục nằm ngay trên trang này — đường `#mục` không làm hộp thoại biến mất).
  const duongSua = (c: ChanKichHoat) =>
    gocChan ? (
      <>
        {" "}
        <Link href={hrefMucSua(gocChan, c.muc)} onClick={dong} className="whitespace-nowrap font-semibold text-primary-ink underline underline-offset-2 hover:no-underline">
          Sửa
        </Link>
      </>
    ) : null;
  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          {moTa && <DialogDescription render={<div />}>{moTa}</DialogDescription>}
        </DialogHeader>

        {chiDoc && (
          <div className="min-w-0">
            <p className="mb-1 text-sm font-semibold text-foreground">Chưa làm được — còn thiếu</p>
            <ul className="space-y-1.5">
              {chan!.map((c) => (
                <li key={c.ma + c.thongBao} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {c.thongBao}
                    {duongSua(c)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {banner && (
          <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              {banner.chan.length > 0 ? (
                <>
                  <p>Chưa làm được — còn thiếu:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {banner.chan.map((c) => (
                      <li key={c.ma + c.thongBao}>
                        {c.thongBao}
                        {duongSua(c)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{banner.text}</p>
              )}
            </div>
            {banner.vuaDoi && (
              <button
                type="button"
                onClick={() => {
                  dong();
                  router.refresh();
                }}
                className={cn(BTN_OUTLINE, NUT_NHO)}
              >
                Tải lại
              </button>
            )}
          </div>
        )}

        {!chiDoc && (
          <div>
            <label htmlFor={`${uid}-ly-do`} className={NHAN_O}>
              {canLyDo ? `Lý do (tối thiểu ${lyDoToiThieu} ký tự)` : "Lý do (tuỳ chọn)"}
            </label>
            <textarea
              id={`${uid}-ly-do`}
              rows={2}
              maxLength={500}
              value={lyDo}
              onChange={(e) => {
                setLyDo(e.target.value);
                setLoiLyDo(null);
              }}
              aria-invalid={loiLyDo ? true : undefined}
              aria-describedby={loiLyDo ? idLoiLyDo : undefined}
              className={TEXTAREA}
            />
            {loiLyDo && (
              <p id={idLoiLyDo} role="alert" className={LOI_O}>
                {loiLyDo}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {chiDoc ? "Đóng" : "Huỷ"}
          </button>
          {!chiDoc && (
            <button type="button" onClick={() => void nop()} disabled={dangLuu} className={cn(nguyHiem ? BTN_DANGER_OUTLINE : BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {nhanXacNhan}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
