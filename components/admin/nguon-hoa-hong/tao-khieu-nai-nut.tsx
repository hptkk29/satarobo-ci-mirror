"use client";

// components/admin/nguon-hoa-hong/tao-khieu-nai-nut.tsx — NÚT + FORM GỬI KHIẾU NẠI từ một dòng sổ của mình (hoặc một khoản thu có quan hệ). 06 §5.5.
//
// ── Cách NỐI vào tab Sổ (việc của track Sổ, không phải của tệp này) ─────────────────────────────────────────────────
//   <TaoKhieuNaiNut dich={{ loai: "DONG", id: dong.id }} coQuyenGui={scope.has("commission:view-self")} />
// đặt TRONG ngăn "Vì sao" của dòng. `coQuyenGui` PHẢI là `scope.has(KEY_TAO_KHIEU_NAI)` — cùng key mà Server Action đòi (`khieu-nai-ma.ts`), nên nút vẽ ra ⇔ action
// chạy được (luật 12). Với dòng của NGƯỜI KHÁC (QLCS xem dòng người khác qua view-center) thì KHÔNG vẽ nút: truyền `coQuyenGui={false}` — khiếu nại chỉ cho dòng của mình.
//
// ── Vì sao form nằm TẠI CHỖ, không mở hộp thoại ────────────────────────────────────────────────────────────────────
// Nút sống trong một ngăn (Sheet) — mở thêm modal chồng lên modal là hai lớp giữ focus. Form 2 ô mở ngay dưới nút, bấm Huỷ là gập lại.
//
// ── Bằng chứng: ghi chú căn cứ, chưa có đính kèm tệp ────────────────────────────────────────────────────────────────
// Đường tải tệp cho người chỉ giữ `commission:view-self` cần mở `/api/admin/upload-url` (quyết định bảo mật của chủ dự án — docs/06). Cột `evidence` là JSON nên thêm
// tệp sau này không cần migration. Hàm gọi máy chủ được TIÊM (`gui`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, Loader2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import { taoKhieuNaiAction } from "@/app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions";
import { kiemDauVaoTao, LY_DO_KHIEU_NAI_TOI_DA, type LoiTruong } from "@/lib/hoa-hong/khieu-nai-dau-vao";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { cn } from "@/lib/utils";

import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, TEXTAREA } from "./classes";
import { maKhieuNai } from "./nhan-khieu-nai";

export type KetQuaGui = { ok: true; disputeId: string } | { ok: false; loi: readonly LoiTruong[]; chung: string | null };
type Gui = (dauVao: unknown) => Promise<KetQuaGui>;

const GUI_MAC_DINH: Gui = (dauVao) => taoKhieuNaiAction(dauVao) as Promise<KetQuaGui>;

type Truong = "lyDo" | "bangChung" | "dich";

export function TaoKhieuNaiNut({
  dich,
  coQuyenGui,
  nhan,
  gui = GUI_MAC_DINH,
  className,
}: {
  dich: { loai: "DONG" | "KHOAN"; id: string };
  /** `scope.has("commission:view-self")` — không có ⇒ KHÔNG vẽ gì (không nút xám). */
  coQuyenGui: boolean;
  /** Chữ trên nút; mặc định theo loại đích. */
  nhan?: string;
  gui?: Gui;
  className?: string;
}) {
  const id = useId();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [bangChung, setBangChung] = useState("");
  const [loi, setLoi] = useState<Partial<Record<Truong, string>>>({});
  const [chung, setChung] = useState<string | null>(null);
  const [daGui, setDaGui] = useState<string | null>(null);
  const [dangGui, batDau] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  if (!coQuyenGui) return null;

  if (daGui) {
    return (
      <p role="status" className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-state-success-ink", className)}>
        <CircleCheck aria-hidden className="h-4 w-4 shrink-0" />
        <span>Đã gửi khiếu nại {maKhieuNai(daGui)}.</span>
        <Link href={`/nguon-hoa-hong/khieu-nai?tt=tat-ca&mo=${encodeURIComponent(daGui)}`} className="font-medium underline focus-visible:ring-2 focus-visible:ring-ring">
          Xem khiếu nại
        </Link>
      </p>
    );
  }

  const nhanNut = nhan ?? (dich.loai === "DONG" ? "Khiếu nại dòng này" : "Khiếu nại khoản thu này");

  if (!mo) {
    return (
      <button type="button" className={cn(BTN_OUTLINE, className)} onClick={() => setMo(true)} aria-expanded={false} aria-controls={`${id}-form`}>
        <MessageSquareWarning aria-hidden className="h-4 w-4" />
        {nhanNut}
      </button>
    );
  }

  function gan(loiMay: readonly LoiTruong[], chungMay: string | null) {
    const o: Partial<Record<Truong, string>> = {};
    for (const l of loiMay) if (l.truong === "lyDo" || l.truong === "bangChung" || l.truong === "dich") o[l.truong] = l.thongBao;
    setLoi(o);
    // Lỗi không thuộc ô nào (trùng khiếu nại đang mở, không tìm thấy đích) thì lên đầu form.
    setChung(chungMay ?? (o.dich ?? null));
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  function gui_() {
    const dauVao = { dich, lyDo, bangChung: [{ ghiChu: bangChung }] };
    // Cùng bộ kiểm với máy chủ: lỗi hiện CẠNH ô và focus nhảy tới ô lỗi đầu tiên.
    const kiem = kiemDauVaoTao(dauVao);
    if (!kiem.ok) {
      gan(kiem.loi, null);
      return;
    }
    setLoi({});
    setChung(null);
    batDau(async () => {
      let r: KetQuaGui;
      try {
        r = await gui(kiem.value);
      } catch {
        setChung("Không gửi được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (r.ok) {
        toast.success("Đã gửi khiếu nại — bạn sẽ nhận thông báo khi có kết quả.");
        setDaGui(r.disputeId);
        return;
      }
      gan(r.loi, r.chung);
    });
  }

  return (
    <form
      id={`${id}-form`}
      ref={formRef}
      noValidate
      className={cn("space-y-3 rounded-lg border border-border p-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        gui_();
      }}
    >
      <p className="text-sm font-semibold text-foreground">{nhanNut}</p>
      {chung && (
        <p role="alert" className="text-sm text-state-danger-ink">
          {chung}
        </p>
      )}
      <div>
        <label htmlFor={`${id}-ly-do`} className={NHAN_O}>
          Lý do khiếu nại
        </label>
        <textarea
          id={`${id}-ly-do`}
          className={TEXTAREA}
          rows={3}
          maxLength={LY_DO_KHIEU_NAI_TOI_DA}
          value={lyDo}
          onChange={(e) => {
            setLyDo(e.target.value);
            if (loi.lyDo) setLoi((o) => ({ ...o, lyDo: undefined }));
          }}
          aria-invalid={loi.lyDo ? true : undefined}
          aria-describedby={loi.lyDo ? `${id}-ly-do-loi` : `${id}-ly-do-goi-y`}
          placeholder="Nói rõ dòng này sai ở đâu so với thoả thuận hoặc quy định."
          disabled={dangGui}
        />
        {loi.lyDo ? (
          <p id={`${id}-ly-do-loi`} role="alert" className={LOI_O}>
            {loi.lyDo}
          </p>
        ) : (
          <p id={`${id}-ly-do-goi-y`} className="mt-1 text-xs text-muted-foreground">
            Ít nhất {LY_DO_TOI_THIEU} ký tự.
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-bang-chung`} className={NHAN_O}>
          Bằng chứng
        </label>
        <textarea
          id={`${id}-bang-chung`}
          className={TEXTAREA}
          rows={2}
          maxLength={LY_DO_KHIEU_NAI_TOI_DA}
          value={bangChung}
          onChange={(e) => {
            setBangChung(e.target.value);
            if (loi.bangChung) setLoi((o) => ({ ...o, bangChung: undefined }));
          }}
          aria-invalid={loi.bangChung ? true : undefined}
          aria-describedby={loi.bangChung ? `${id}-bang-chung-loi` : undefined}
          placeholder="Căn cứ cụ thể: tin nhắn nào, ngày nào, ai xác nhận, số văn bản…"
          disabled={dangGui}
        />
        {loi.bangChung && (
          <p id={`${id}-bang-chung-loi`} role="alert" className={LOI_O}>
            {loi.bangChung}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Nội dung đã gửi không sửa được. HR xem xét và báo kết quả cho bạn qua thông báo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={dangGui}>
          {dangGui && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {dangGui ? "Đang gửi…" : "Gửi khiếu nại"}
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={() => setMo(false)} disabled={dangGui}>
          Huỷ
        </button>
      </div>
    </form>
  );
}
