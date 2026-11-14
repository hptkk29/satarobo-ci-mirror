"use client";

// components/admin/nguon-hoa-hong/affiliate/doi-trang-thai-doi-tac.tsx — NÚT + HỘP THOẠI «Đổi trạng thái» của một đối tác (Gửi duyệt · Duyệt · Tạm dừng · Kích hoạt lại · Kết thúc).
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// Danh sách chuyển được LẤY TỪ `thaoTacDoiTac` (lib/affiliate/ghi-doi-tac-dau-vao.ts) — CÙNG bảng mà `kiemDoiTrangThaiDoiTac` (cổng của máy chủ) dùng, nên nút không thể hứa một bước mà cổng ghi
// từ chối. Đối tác ĐÃ KẾT THÚC không có thao tác nào ⇒ KHÔNG vẽ nút (không phải nút xám): kết thúc là cuối, không mở lại.
// Lý do ≥ 10 ký tự chỉ đòi khi cổng đòi (Tạm dừng · Kết thúc/Từ chối). Duyệt và Kích hoạt lại không đòi — lý do tuỳ chọn.
// Khoá lạc quan: gửi `capNhatLuc` của dòng; máy chủ báo «vừa được người khác thay đổi» ⇒ banner + «Tải lại».
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { doiTrangThaiDoiTacAction } from "@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KetQuaDoiTrangThaiDoiTac } from "@/lib/affiliate/ghi-doi-tac";
import { LY_DO_TOI_THIEU_DOI_TAC, kiemDoiTrangThaiDoiTac, thaoTacDoiTac, type TrangThaiDoiTac } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "../classes";
import { TrangThaiDoiTacPill } from "./trang-thai-doi-tac-pill";

type Doi = (i: { id: string; updatedAtDaThay: string; den: TrangThaiDoiTac; lyDo: string | null }) => Promise<KetQuaDoiTrangThaiDoiTac>;
const DOI_MAC_DINH: Doi = (i) => doiTrangThaiDoiTacAction(i);

/** Dòng tối thiểu mà nút cần. */
export type DoiTacDeDoiTrangThai = {
  id: string;
  ten: string;
  trangThai: TrangThaiDoiTac;
  /** `requiresApproval` của loại; null = đối tác chưa có loại (coi như CẦN duyệt). */
  loaiCanDuyet: boolean | null;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
};

export function NutDoiTrangThaiDoiTac({ doiTac, doi = DOI_MAC_DINH, bieuTuong = false, className }: { doiTac: DoiTacDeDoiTrangThai; doi?: Doi; bieuTuong?: boolean; className?: string }) {
  const [mo, setMo] = useState(false);
  const thaoTac = useMemo(() => thaoTacDoiTac(doiTac.trangThai, doiTac.loaiCanDuyet), [doiTac.trangThai, doiTac.loaiCanDuyet]);
  if (thaoTac.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setMo(true)}
        aria-label={`Đổi trạng thái: đối tác ${doiTac.ten}`}
        title="Đổi trạng thái"
        className={cn(BTN_OUTLINE, bieuTuong ? "h-10 w-10 justify-center px-0 md:h-8 md:w-8" : NUT_NHO, className)}
      >
        {bieuTuong ? <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" /> : "Đổi trạng thái"}
      </button>
      {mo && <HopThoai doiTac={doiTac} thaoTac={thaoTac} doi={doi} dong={() => setMo(false)} />}
    </>
  );
}

type Banner = { loai: "vuaDoi" | "khac"; text: string };

function HopThoai({ doiTac, thaoTac, doi, dong }: { doiTac: DoiTacDeDoiTrangThai; thaoTac: ReturnType<typeof thaoTacDoiTac>; doi: Doi; dong: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [chon, setChon] = useState<TrangThaiDoiTac | null>(thaoTac.length === 1 ? thaoTac[0]!.den : null);
  const [lyDo, setLyDo] = useState("");
  const [loiChon, setLoiChon] = useState<string | null>(null);
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const dangChon = thaoTac.find((t) => t.den === chon) ?? null;

  async function xacNhan() {
    if (dangLuu) return;
    setBanner(null);
    if (!dangChon) {
      setLoiChon("Chọn trạng thái muốn chuyển sang.");
      return;
    }
    setLoiChon(null);
    // Cùng cổng với máy chủ.
    const kq = kiemDoiTrangThaiDoiTac({ tu: doiTac.trangThai, den: dangChon.den, lyDo, loaiCanDuyet: doiTac.loaiCanDuyet });
    if (!kq.ok) {
      if (kq.truong === "lyDo") setLoiLyDo(kq.loi);
      else setBanner({ loai: "khac", text: kq.loi });
      return;
    }
    setLoiLyDo(null);
    setDangLuu(true);
    let r: KetQuaDoiTrangThaiDoiTac;
    try {
      r = await doi({ id: doiTac.id, updatedAtDaThay: doiTac.capNhatLuc, den: dangChon.den, lyDo: lyDo.trim() === "" ? null : lyDo.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây.", truong: "chung" };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.truong === "lyDo") setLoiLyDo(r.loi);
      else setBanner({ loai: r.truong === "vuaDoi" ? "vuaDoi" : "khac", text: r.loi });
      return;
    }
    toast.success(`${dangChon.nhan} đối tác «${doiTac.ten}»: xong.`);
    dong();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đổi trạng thái đối tác «{doiTac.ten}»</DialogTitle>
          <DialogDescription render={<div />} className="flex items-center gap-2">
            Hiện tại: <TrangThaiDoiTacPill trangThai={doiTac.trangThai} />
          </DialogDescription>
        </DialogHeader>

        {banner && (
          <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{banner.text}</p>
            {banner.loai === "vuaDoi" && (
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

        <fieldset className="min-w-0">
          <legend className={NHAN_O}>Chuyển sang</legend>
          <div className="space-y-1">
            {thaoTac.map((t) => (
              <label key={t.den} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                <input
                  type="radio"
                  name={`${uid}-den`}
                  value={t.den}
                  checked={chon === t.den}
                  onChange={() => {
                    setChon(t.den);
                    setLoiChon(null);
                    setLoiLyDo(null);
                  }}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.nhan}</span>
                  <span className="block text-sm text-muted-foreground">{t.moTa}</span>
                </span>
              </label>
            ))}
          </div>
          {loiChon && (
            <p role="alert" className={LOI_O}>
              {loiChon}
            </p>
          )}
        </fieldset>

        {dangChon && (
          <div>
            <label htmlFor={`${uid}-ly-do`} className={NHAN_O}>
              {dangChon.canLyDo ? `Lý do (tối thiểu ${LY_DO_TOI_THIEU_DOI_TAC} ký tự)` : "Lý do (tuỳ chọn)"}
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
            {dangChon ? dangChon.nhan : "Xác nhận"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
