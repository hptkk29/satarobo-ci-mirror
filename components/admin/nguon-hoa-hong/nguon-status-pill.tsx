// components/admin/nguon-hoa-hong/nguon-status-pill.tsx — ÁNH XẠ trạng thái/lý do → tông màu ở MỘT chỗ (06 §7).
//
// Bọc `StatusPill` (06 §0: không viết pill thứ ba). Tông theo thang NGỮ NGHĨA, không mượn màu thương hiệu
// (DESIGN.md §1): đang dùng = success; chờ/thiếu = warning; gian lận/lỗi = danger; nháp/ngừng = muted.
// `StatusPill` tô bằng màu SÁNG (trượt AA trên nền trắng) nên luôn đè `text-state-*-ink` như chính ghi chú của
// `status-pill.tsx` dặn — cùng cách `PeriodStatusPill` của chấm công làm.
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { NHAN_LY_DO, nhanCanhBao, type LyDoHangCho, type MaNvSaiHienThi } from "@/lib/nguon/doc-hang-cho";
import { nhanMaNvDaGo, nhanXemTay } from "@/lib/nguon/nhan-hien-thi";
import { INK_THEO_TONE as INK } from "./trang-thai-nguon-pill";

// Pill TRẠNG THÁI nguồn nằm ở `trang-thai-nguon-pill.tsx` (client-safe: tệp này kéo `doc-hang-cho` → db-scope → `next/headers`). Xuất lại để nơi gọi cũ không đổi.
export { NguonStatusPill } from "./trang-thai-nguon-pill";

/** Lý do vào hàng chờ → tông. Cảnh báo gian lận là danger; thiếu dữ liệu là warning. */
export const TONE_VAN_DE: Record<LyDoHangCho, PillTone> = {
  UNKNOWN: "warning",
  THIEU_NGUOI: "warning",
  THIEU_GIAI_TRINH: "warning",
  CANH_BAO: "danger",
  XEM_TAY: "warning",
};

/**
 * Một pill cho MỘT lý do. Lý do CẢNH BÁO thì in đúng từng mã ("SĐT trùng nhân viên"), không gộp thành "Có cảnh
 * báo" — người duyệt cần biết cảnh báo nào để quyết.
 */
export function VanDePill({
  lyDo,
  canhBao,
  xemTay,
  maNvSai,
}: {
  lyDo: LyDoHangCho;
  canhBao?: string[];
  /** Lý do xem tay trong danh sách hẹp của dòng (`HangChoNguonDong.xemTay`) — chỉ dùng cho pill «Cần xem tay». */
  xemTay?: string[];
  /** Mã NV người nhập gõ mà không dùng được (`HangChoNguonDong.maNvSai`) — pill «Cần xem tay» nói THẲNG «Mã NV sai: <mã>» thay vì chung chung. */
  maNvSai?: MaNvSaiHienThi | null;
}) {
  const tone = TONE_VAN_DE[lyDo];
  if (lyDo === "XEM_TAY") {
    // «Cần xem tay» trống nghĩa là người duyệt phải mở từng lead để biết xem cái gì. Nói luôn cái gì: mã sai thì kèm chính mã đó, lý do khác thì câu của lý do.
    // KHAC_MA = nhiều dòng cùng SĐT ghi mã khác nhau ⇒ chuỗi là các ỨNG VIÊN xung đột, không phải một mã. Chuỗi gốc chỉ có khi server đã xác nhận người xem có quyền PII.
    const chu = maNvSai ? `${maNvSai.loai === "KHAC_MA" ? "Mã NV xung đột" : "Mã NV sai"}: ${nhanMaNvDaGo(maNvSai)}` : xemTay && xemTay.length > 0 ? nhanXemTay(xemTay[0]!) : NHAN_LY_DO.XEM_TAY;
    return (
      <StatusPill tone={tone} className={INK[tone]}>
        <span className="max-w-[16rem] truncate" title={chu}>
          {chu}
        </span>
      </StatusPill>
    );
  }
  if (lyDo === "CANH_BAO" && canhBao && canhBao.length > 0) {
    return (
      <>
        {canhBao.map((ma) => (
          <StatusPill key={ma} tone={tone} className={INK[tone]}>
            {nhanCanhBao(ma)}
          </StatusPill>
        ))}
      </>
    );
  }
  return (
    <StatusPill tone={tone} className={INK[tone]}>
      {NHAN_LY_DO[lyDo]}
    </StatusPill>
  );
}
