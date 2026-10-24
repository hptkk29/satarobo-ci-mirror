"use client";

// Nút quyết của màn Công parttime tháng. MỘT thành phần cho mọi quyết định (xác nhận dạy / trực, từ chối, cần bổ sung, quyết khoản
// trừ, xác nhận hàng loạt, dựng đề xuất). Quyết định cần lý do ⇒ bấm lần đầu mở ô lý do NGAY DƯỚI nút (không modal), bấm lần hai
// mới gửi. Máy chủ luôn tính lại và có quyền từ chối — nút chỉ là lời hứa đã được trang kiểm trước (luật 12).
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { xacNhanHangLoatAction, xacNhanThucHienAction } from "../../_actions";
import { xacNhanTrucAction } from "../../_actions-truc";
import { danhDauCuAction, dongBoDeXuatAction, quyetDieuChinhAction } from "../../_actions-dieu-chinh";

export type LenhQuyet =
  | { loai: "day"; assignmentId: string; phienBanDaXem: number; dauVanDaXem: string; quyetDinh: "CONFIRMED" | "REJECTED" | "NEEDS_INFO" }
  | { loai: "truc"; dutyId: string; phienBanDaXem: number; dauVanDaXem: string; quyetDinh: "CONFIRMED" | "REJECTED" | "NEEDS_INFO" }
  | { loai: "dieuChinh"; id: string; quyet: "CONFIRMED" | "REJECTED" | "CANCELLED" }
  | { loai: "hangLoat"; muc: { assignmentId: string; phienBanDaXem: number; dauVanDaXem: string }[] }
  | { loai: "dongBo"; centerId: string; tu: string; den: string }
  | { loai: "danhDauCu"; centerId: string; tu: string; den: string };

type KetQua = { ok: true; message?: string } | { ok: false; error: string };

function gui(l: LenhQuyet, lyDo: string): Promise<KetQua> {
  const ld = lyDo.trim() || undefined;
  switch (l.loai) {
    case "day":
      return xacNhanThucHienAction({ assignmentId: l.assignmentId, phienBanDaXem: l.phienBanDaXem, dauVanDaXem: l.dauVanDaXem, quyetDinh: l.quyetDinh, lyDo: ld });
    case "truc":
      return xacNhanTrucAction({ dutyId: l.dutyId, phienBanDaXem: l.phienBanDaXem, dauVanDaXem: l.dauVanDaXem, quyetDinh: l.quyetDinh, lyDo: ld });
    case "dieuChinh":
      return quyetDieuChinhAction({ id: l.id, quyet: l.quyet, lyDo: ld });
    case "hangLoat":
      return xacNhanHangLoatAction({ muc: l.muc });
    case "dongBo":
      return dongBoDeXuatAction({ centerId: l.centerId, tu: l.tu, den: l.den });
    case "danhDauCu":
      return danhDauCuAction({ centerId: l.centerId, tu: l.tu, den: l.den });
  }
}

export function NutQuyet({ lenh, nhan, canLyDo = false, bien = "outline" }: { lenh: LenhQuyet; nhan: string; canLyDo?: boolean; bien?: "default" | "outline" | "destructive" }) {
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const id = useId();
  const bam = () => {
    if (canLyDo && !mo) return setMo(true);
    if (canLyDo && lyDo.trim().length < 5) return toast.error("Ghi lý do (tối thiểu 5 ký tự).");
    batDau(async () => {
      const r = await gui(lenh, lyDo);
      if (r.ok) {
        toast.success(r.message ?? "Đã ghi.");
        setMo(false);
        setLyDo("");
      } else toast.error(r.error);
    });
  };
  return (
    <span className="inline-flex flex-col gap-1.5">
      {mo && (
        <span className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs text-muted-foreground">
            Lý do (bắt buộc)
          </label>
          <input
            id={id}
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            maxLength={500}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm sm:w-64"
          />
        </span>
      )}
      <Button type="button" size="sm" variant={bien} disabled={dang} onClick={bam} className="whitespace-nowrap">
        {dang ? "Đang ghi…" : mo ? `${nhan} — gửi` : nhan}
      </Button>
    </span>
  );
}
