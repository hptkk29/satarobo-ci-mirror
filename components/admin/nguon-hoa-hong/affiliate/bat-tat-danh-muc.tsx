"use client";

// components/admin/nguon-hoa-hong/affiliate/bat-tat-danh-muc.tsx — NÚT + HỘP THOẠI «Ngừng» / «Bật lại» cho một LOẠI đối tác hoặc một NHÃN.
//
// Ngừng ≠ xoá (không có nút xoá ở đâu cả): đối tác cũ GIỮ loại/nhãn, chỉ ô chọn của đối tác MỚI không còn liệt kê mục đã ngừng. Hộp thoại nói đúng điều đó — để người bấm biết mình KHÔNG làm gì
// với đối tác đang có. Ngừng đòi lý do ≥ 10 ký tự (cùng cổng với máy chủ: `kiemBatTatDanhMuc`); bật lại không đòi.
// Khoá lạc quan: gửi `capNhatLuc`; «vừa được người khác thay đổi» ⇒ banner + «Tải lại».
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { batTatLoaiAction, batTatNhanAction } from "@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KetQuaBatTatDanhMuc } from "@/lib/affiliate/ghi-loai-nhan";
import { LY_DO_TOI_THIEU_LOAI_NHAN, kiemBatTatDanhMuc } from "@/lib/affiliate/ghi-loai-nhan-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "../classes";

type Ghi = (i: { id: string; updatedAtDaThay: string; batLai: boolean; lyDo: string | null }) => Promise<KetQuaBatTatDanhMuc>;

export type MucBatTat = { id: string; ten: string; dangDung: boolean; capNhatLuc: string };

export function NutBatTatDanhMuc({
  loai,
  muc,
  ghi,
  bieuTuong = false,
  className,
}: {
  loai: "loai" | "nhan";
  muc: MucBatTat;
  /** Tiêm hàm gọi máy chủ (test). Mặc định: action của loại / nhãn. */
  ghi?: Ghi;
  bieuTuong?: boolean;
  className?: string;
}) {
  const [mo, setMo] = useState(false);
  const tenLoai = loai === "loai" ? "loại" : "nhãn";
  const nhan = muc.dangDung ? "Ngừng" : "Bật lại";
  const Bieu = muc.dangDung ? Pause : Play;
  return (
    <>
      <button
        type="button"
        onClick={() => setMo(true)}
        aria-label={`${nhan} ${tenLoai} ${muc.ten}`}
        title={`${nhan} ${tenLoai}`}
        className={cn(BTN_OUTLINE, bieuTuong ? "h-10 w-10 justify-center px-0 md:h-8 md:w-8" : NUT_NHO, className)}
      >
        <Bieu aria-hidden className="h-3.5 w-3.5" />
        {bieuTuong ? null : nhan}
      </button>
      {mo && <HopThoai loai={loai} muc={muc} ghi={ghi ?? (loai === "loai" ? (i) => batTatLoaiAction(i) : (i) => batTatNhanAction(i))} dong={() => setMo(false)} />}
    </>
  );
}

function HopThoai({ loai, muc, ghi, dong }: { loai: "loai" | "nhan"; muc: MucBatTat; ghi: Ghi; dong: () => void }) {
  const router = useRouter();
  const uid = useId();
  const batLai = !muc.dangDung;
  const tenLoai = loai === "loai" ? "loại đối tác" : "nhãn";
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ vuaDoi: boolean; text: string } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  async function xacNhan() {
    if (dangLuu) return;
    setBanner(null);
    const kq = kiemBatTatDanhMuc({ dangBat: muc.dangDung, batLai, lyDo });
    if (!kq.ok) {
      setLoiLyDo(kq.loi);
      return;
    }
    setLoiLyDo(null);
    setDangLuu(true);
    let r: KetQuaBatTatDanhMuc;
    try {
      r = await ghi({ id: muc.id, updatedAtDaThay: muc.capNhatLuc, batLai, lyDo: lyDo.trim() === "" ? null : lyDo.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây.", truong: "chung" };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.truong === "lyDo") setLoiLyDo(r.loi);
      else setBanner({ vuaDoi: r.truong === "vuaDoi", text: r.loi });
      return;
    }
    toast.success(`${batLai ? "Đã bật lại" : "Đã ngừng"} ${tenLoai} «${muc.ten}».`);
    dong();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {batLai ? "Bật lại" : "Ngừng"} {tenLoai} «{muc.ten}»
          </DialogTitle>
          <DialogDescription>
            {batLai
              ? `Đối tác MỚI chọn lại được ${tenLoai} này.`
              : `Đối tác MỚI sẽ không chọn được ${tenLoai} này nữa. Đối tác đang có giữ nguyên, không bị đổi hay xoá; bật lại được bất cứ lúc nào.`}
          </DialogDescription>
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
                  router.refresh();
                }}
                className={cn(BTN_OUTLINE, NUT_NHO)}
              >
                Tải lại
              </button>
            )}
          </div>
        )}

        {!batLai && (
          <div>
            <label htmlFor={`${uid}-ly-do`} className={NHAN_O}>
              Lý do (tối thiểu {LY_DO_TOI_THIEU_LOAI_NHAN} ký tự)
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
              aria-describedby={loiLyDo ? `${uid}-loi-ly-do` : undefined}
              className={TEXTAREA}
            />
            {loiLyDo && (
              <p id={`${uid}-loi-ly-do`} role="alert" className={LOI_O}>
                {loiLyDo}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Huỷ
          </button>
          <button type="button" onClick={() => void xacNhan()} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
            {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {batLai ? "Bật lại" : "Ngừng"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
