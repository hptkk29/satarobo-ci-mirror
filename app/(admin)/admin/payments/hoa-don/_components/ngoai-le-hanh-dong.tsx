"use client";

// Hành động xử lý MỘT ngoại lệ hoá đơn (Invoice Hub S12). Nút chỉ được VẼ khi bấm được (`hanhDong` do server tính bằng CÙNG vị từ với action và dịch vụ — luật 12);
// ngoài phạm vi thì NÓI vì sao thay vì ẩn lặng lẽ. Không modal: «Đã xử lý» / «Bỏ qua» mở form lý do NGAY TẠI DÒNG (kế toán vẫn thấy ngoại lệ mình đang xử lý).
// Gốc `contents` để form lý do trải hết hàng lưới của dòng (col-span-full) còn cụm nút là một ô lưới bình thường.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { xuLyNgoaiLeAction } from "../canh-bao/_ngoai-le-actions";
import { TOI_DA_LY_DO_XU_LY, TOI_THIEU_LY_DO_XU_LY, type HanhDongChoPhep } from "@/lib/finance/hoa-don/ngoai-le-xu-ly";

type BuocForm = "DA_XU_LY" | "BO_QUA";

const NHAN_FORM: Record<BuocForm, { nhanLy: string; goiY: string; xacNhan: string; thanhCong: string }> = {
  DA_XU_LY: {
    nhanLy: "Đã xử lý bằng cách nào?",
    goiY: "Nếu nguyên nhân còn, hệ thống sẽ mở lại một ngoại lệ mới ở lần quét sau.",
    xacNhan: "Xác nhận đã xử lý",
    thanhCong: "Đã ghi nhận ngoại lệ là đã xử lý",
  },
  BO_QUA: {
    nhanLy: "Vì sao bỏ qua ngoại lệ này?",
    goiY: "Hệ thống sẽ KHÔNG báo lại đúng việc này nữa. Lý do được lưu để người khác đọc lại.",
    xacNhan: "Xác nhận bỏ qua",
    thanhCong: "Đã bỏ qua ngoại lệ",
  },
};

export function NgoaiLeHanhDong({ id, viec, hanhDong }: { id: string; /** Tên việc, để nút có nhãn đọc được riêng cho từng dòng. */ viec: string; hanhDong: HanhDongChoPhep }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [buoc, setBuoc] = useState<BuocForm | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const uid = useId();
  const idForm = `${uid}-form`;
  const idLyDo = `${uid}-ly-do`;
  const idGoiY = `${uid}-goi-y`;
  const idLoi = `${uid}-loi`;

  const coNut = hanhDong.nhan || hanhDong.daXuLy || hanhDong.boQua;
  const thieu = Math.max(0, TOI_THIEU_LY_DO_XU_LY - lyDo.trim().length);

  function gui(hd: "NHAN_XU_LY" | BuocForm, ly: string, thanhCong: string) {
    setLoi(null);
    batDau(async () => {
      const r = await xuLyNgoaiLeAction({ id, hanhDong: hd, lyDo: ly });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      toast.success(thanhCong);
      setBuoc(null);
      setLyDo("");
      router.refresh();
    });
  }

  function moForm(b: BuocForm) {
    setLoi(null);
    setBuoc((cu) => (cu === b ? null : b));
  }

  if (!coNut) {
    return hanhDong.lyDoKhong ? (
      <p className="max-w-[22ch] text-xs text-muted-foreground @4xl:max-w-[26ch]">{hanhDong.lyDoKhong}</p>
    ) : null;
  }

  return (
    <div className="contents">
      <div className="flex flex-wrap items-center gap-2">
        {hanhDong.nhan ? (
          <Button type="button" size="sm" variant="outline" disabled={dangChay} aria-label={`Nhận xử lý: ${viec}`} className="pointer-coarse:min-h-11" onClick={() => gui("NHAN_XU_LY", "", "Đã nhận xử lý ngoại lệ")}>
            Nhận xử lý
          </Button>
        ) : null}
        {hanhDong.daXuLy ? (
          <Button type="button" size="sm" variant={buoc === "DA_XU_LY" ? "secondary" : "outline"} aria-expanded={buoc === "DA_XU_LY"} aria-controls={idForm} aria-label={`Đã xử lý: ${viec}`} className="pointer-coarse:min-h-11" onClick={() => moForm("DA_XU_LY")}>
            Đã xử lý
          </Button>
        ) : null}
        {hanhDong.boQua ? (
          <Button type="button" size="sm" variant={buoc === "BO_QUA" ? "secondary" : "ghost"} aria-expanded={buoc === "BO_QUA"} aria-controls={idForm} aria-label={`Bỏ qua: ${viec}`} className="pointer-coarse:min-h-11" onClick={() => moForm("BO_QUA")}>
            Bỏ qua
          </Button>
        ) : null}
        {/* Lỗi của «Nhận xử lý» (không có form) hiện ngay cạnh nút; lỗi của form hiện trong form. */}
        {!buoc && loi ? (
          <p role="alert" className="basis-full text-xs text-state-danger-ink">
            {loi}
          </p>
        ) : null}
      </div>

      {buoc ? (
        <form
          id={idForm}
          className="col-span-full rounded-lg border border-border bg-muted/40 p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") setBuoc(null);
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (thieu === 0) gui(buoc, lyDo.trim(), NHAN_FORM[buoc].thanhCong);
          }}
        >
          <label htmlFor={idLyDo} className="text-sm font-medium text-foreground">
            {NHAN_FORM[buoc].nhanLy}
          </label>
          <Textarea
            id={idLyDo}
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            rows={2}
            maxLength={TOI_DA_LY_DO_XU_LY}
            autoFocus
            aria-invalid={loi ? true : undefined}
            aria-describedby={`${idGoiY}${loi ? ` ${idLoi}` : ""}`}
            className="mt-1.5"
          />
          <p id={idGoiY} className="mt-1.5 text-xs text-muted-foreground">
            {NHAN_FORM[buoc].goiY}
          </p>
          {loi ? (
            <p id={idLoi} role="alert" className="mt-1.5 text-xs text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={dangChay || thieu > 0} className="pointer-coarse:min-h-11">
              {dangChay ? "Đang ghi…" : NHAN_FORM[buoc].xacNhan}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={dangChay} className="pointer-coarse:min-h-11" onClick={() => setBuoc(null)}>
              Huỷ
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {thieu > 0 ? `Còn thiếu ${thieu} ký tự (tối thiểu ${TOI_THIEU_LY_DO_XU_LY}).` : "Đủ điều kiện để xác nhận."}
            </span>
          </div>
        </form>
      ) : null}
    </div>
  );
}
