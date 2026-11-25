"use client";

// components/admin/nguon-hoa-hong/referral/xu-ly-referral-panel.tsx — NÚT XỬ LÝ TAY trên trang chi tiết referral (AFF-L3b): Duyệt · Từ chối · Đánh dấu tranh chấp · Xin / Bổ sung bằng chứng.
//
// ── Nút nói thật (luật 12) ───────────────────────────────────────────────────────────────────────────────────────
// Trang CHỈ dựng panel này khi `scope.has("affiliate_referrals:manage")` — đúng khoá mà `xuLyReferralAction` kiểm ở đầu hàm. Nút nào được vẽ do `cacHanhDongChoPhep(trangThai)` — CÙNG bảng với
// `chuyenTrangThai` mà máy chủ gọi. Lượt đã chốt (Hợp lệ · Từ chối · Trùng) KHÔNG vẽ nút nào và nói rõ vì sao (không để một khoảng trống khó hiểu).
// Form mở TẠI CHỖ (không modal chồng modal); bấm nút khác thì đổi form, bấm Huỷ thì gập lại. Hàm gọi máy chủ được TIÊM (`gui`) — mặc định là Server Action; test dựng bằng hàm giả.
//
// Bằng chứng: ghi chú căn cứ (mã phiếu / số biên nhận / người xác nhận), KHÔNG SĐT-email khách (máy chủ từ chối). Đính kèm tệp chưa có: đường tải tệp của admin chưa mở cho quyền này.
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { xuLyReferralAction } from "@/app/(admin)/admin/nguon-hoa-hong/referral/_actions";
import type { KetQuaXuLyReferral } from "@/lib/affiliate/ghi-referral-xu-ly";
import type { TrangThaiReferral } from "@/lib/affiliate/ghi-referral-dau-vao";
import {
  HANH_DONG_CAN_GHI_CHU,
  MO_TA_HANH_DONG,
  NHAN_HANH_DONG,
  cacHanhDongChoPhep,
  chuyenTrangThai,
  kiemGhiChuBangChung,
  kiemLyDo,
  type HanhDongXuLy,
} from "@/lib/affiliate/xu-ly-referral";
import { cn } from "@/lib/utils";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_NHO, TEXTAREA } from "../classes";

type Gui = (input: { id: string; hanhDong: HanhDongXuLy; updatedAtDaThay: string; lyDo: string; ghiChu: string | null }) => Promise<KetQuaXuLyReferral>;
const GUI_MAC_DINH: Gui = (i) => xuLyReferralAction(i);

type Loi = Partial<Record<"lyDo" | "ghiChu", string>>;

const GOI_Y_LY_DO: Readonly<Record<HanhDongXuLy, string>> = {
  DUYET: "Vì sao lượt này đúng là do đối tác giới thiệu.",
  TU_CHOI: "Vì sao lượt này không hợp lệ.",
  DANH_DAU_TRANH_CHAP: "Ai đang tranh chấp và về điều gì.",
  XIN_BANG_CHUNG: "Cần bằng chứng gì, từ ai, trước khi quyết.",
  BO_SUNG_BANG_CHUNG: "Bằng chứng này trả lời yêu cầu nào.",
};

const GOI_Y_GHI_CHU: Readonly<Record<HanhDongXuLy, string>> = {
  DUYET: "Căn cứ cụ thể: mã phiếu, số biên nhận, ai xác nhận, ngày nào…",
  TU_CHOI: "Căn cứ để từ chối: đã đối chiếu gì, thấy gì…",
  DANH_DAU_TRANH_CHAP: "Các bên tranh chấp và căn cứ mỗi bên nêu…",
  XIN_BANG_CHUNG: "Căn cứ của lời xin: đã đối chiếu gì, còn thiếu gì…",
  BO_SUNG_BANG_CHUNG: "Bằng chứng mới: mã biên nhận, ai xác nhận, ngày nào…",
};

export function XuLyReferralPanel({
  id,
  trangThai,
  capNhatLuc,
  coQuyen,
  dangChoBangChung,
  gui = GUI_MAC_DINH,
  className,
}: {
  id: string;
  trangThai: TrangThaiReferral;
  /** `updatedAt` (ISO) của lượt LÚC TRANG ĐƯỢC DỰNG — gửi lại để máy chủ phát hiện có người xử lý xen giữa. */
  capNhatLuc: string;
  /** `scope.has("affiliate_referrals:manage")` — không có ⇒ KHÔNG vẽ gì (không nút xám). */
  coQuyen: boolean;
  dangChoBangChung: boolean;
  gui?: Gui;
  className?: string;
}) {
  const uid = useId();
  const router = useRouter();
  const [chon, setChon] = useState<HanhDongXuLy | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<Loi>({});
  const [chung, setChung] = useState<string | null>(null);
  const [dangGui, batDau] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (!coQuyen) return null;

  const duoc = cacHanhDongChoPhep(trangThai);
  if (duoc.length === 0) {
    const ly = chuyenTrangThai(trangThai, "DUYET");
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-testid="referral-da-chot">
        {ly.ok ? "" : ly.loi}
      </p>
    );
  }

  function dong() {
    setChon(null);
    setLyDo("");
    setGhiChu("");
    setLoi({});
    setChung(null);
  }

  function nopBai() {
    if (!chon) return;
    // Cùng bộ kiểm với máy chủ: lỗi hiện CẠNH ô và focus nhảy tới ô lỗi đầu tiên.
    const o: Loi = {};
    const ly = kiemLyDo(lyDo);
    if (!ly.ok) o.lyDo = ly.loi;
    const canGhiChu = HANH_DONG_CAN_GHI_CHU[chon];
    const gc = canGhiChu || ghiChu.trim() !== "" ? kiemGhiChuBangChung(ghiChu) : null;
    if (gc && !gc.ok) o.ghiChu = gc.loi;
    if (o.lyDo || o.ghiChu) {
      setLoi(o);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setLoi({});
    setChung(null);
    const dauVao = { id, hanhDong: chon, updatedAtDaThay: capNhatLuc, lyDo: lyDo.trim(), ghiChu: ghiChu.trim() === "" ? null : ghiChu.trim() };
    batDau(async () => {
      let r: KetQuaXuLyReferral;
      try {
        r = await gui(dauVao);
      } catch {
        setChung("Không gửi được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (r.ok) {
        toast.success(chon === "DUYET" ? "Đã duyệt — người giới thiệu đã được ghi vào hồ sơ khách." : `Đã ghi: ${NHAN_HANH_DONG[chon].toLowerCase()}.`);
        dong();
        router.refresh();
        return;
      }
      if (r.truong === "lyDo" || r.truong === "ghiChu") setLoi({ [r.truong]: r.loi });
      else setChung(r.loi);
    });
  }

  return (
    <div className={cn("space-y-3", className)}>
      {dangChoBangChung && (
        <p role="status" className="text-sm font-medium text-state-warning-ink">
          Đang chờ bằng chứng bổ sung.
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Xử lý lượt giới thiệu">
        {duoc.map((h) => (
          <button
            key={h}
            type="button"
            className={cn(h === "DUYET" ? BTN_PRIMARY : h === "TU_CHOI" ? BTN_DANGER_OUTLINE : BTN_OUTLINE, NUT_NHO)}
            aria-pressed={chon === h}
            aria-controls={`${uid}-form`}
            onClick={() => {
              setChon(h);
              setLoi({});
              setChung(null);
            }}
            disabled={dangGui}
          >
            {NHAN_HANH_DONG[h]}
          </button>
        ))}
      </div>

      {chon && (
        <form
          id={`${uid}-form`}
          ref={formRef}
          noValidate
          className="space-y-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            nopBai();
          }}
        >
          <p className="text-sm font-semibold text-foreground">{NHAN_HANH_DONG[chon]}</p>
          <p className="text-xs text-muted-foreground">{MO_TA_HANH_DONG[chon]}</p>
          {chung && (
            <p role="alert" className="text-sm text-state-danger-ink">
              {chung}
            </p>
          )}
          <div>
            <label htmlFor={`${uid}-ly-do`} className={NHAN_O}>
              Lý do
            </label>
            <textarea
              id={`${uid}-ly-do`}
              className={TEXTAREA}
              rows={3}
              maxLength={500}
              value={lyDo}
              onChange={(e) => {
                setLyDo(e.target.value);
                if (loi.lyDo) setLoi((o) => ({ ...o, lyDo: undefined }));
              }}
              aria-invalid={loi.lyDo ? true : undefined}
              aria-describedby={loi.lyDo ? `${uid}-ly-do-loi` : `${uid}-ly-do-goi-y`}
              placeholder={GOI_Y_LY_DO[chon]}
              disabled={dangGui}
            />
            {loi.lyDo ? (
              <p id={`${uid}-ly-do-loi`} role="alert" className={LOI_O}>
                {loi.lyDo}
              </p>
            ) : (
              <p id={`${uid}-ly-do-goi-y`} className="mt-1 text-xs text-muted-foreground">
                Ít nhất 10 ký tự. Không ghi SĐT hay email của khách.
              </p>
            )}
          </div>
          {(HANH_DONG_CAN_GHI_CHU[chon] || ghiChu !== "") && (
            <div>
              <label htmlFor={`${uid}-ghi-chu`} className={NHAN_O}>
                Ghi chú bằng chứng
              </label>
              <textarea
                id={`${uid}-ghi-chu`}
                className={TEXTAREA}
                rows={2}
                maxLength={2000}
                value={ghiChu}
                onChange={(e) => {
                  setGhiChu(e.target.value);
                  if (loi.ghiChu) setLoi((o) => ({ ...o, ghiChu: undefined }));
                }}
                aria-invalid={loi.ghiChu ? true : undefined}
                aria-describedby={loi.ghiChu ? `${uid}-ghi-chu-loi` : undefined}
                placeholder={GOI_Y_GHI_CHU[chon]}
                disabled={dangGui}
              />
              {loi.ghiChu && (
                <p id={`${uid}-ghi-chu-loi`} role="alert" className={LOI_O}>
                  {loi.ghiChu}
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Nội dung đã ghi không sửa được; nó nằm trong «Lịch sử xử lý» của lượt này.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={cn(chon === "TU_CHOI" ? BTN_DANGER_OUTLINE : BTN_PRIMARY, "min-w-28")} disabled={dangGui}>
              {dangGui && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangGui ? "Đang ghi…" : `Xác nhận: ${NHAN_HANH_DONG[chon].toLowerCase()}`}
            </button>
            <button type="button" className={BTN_OUTLINE} onClick={dong} disabled={dangGui}>
              Huỷ
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
