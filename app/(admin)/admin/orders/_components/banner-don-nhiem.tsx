import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MA_NHIEM, type DonNhiem } from "@/lib/orders/don-nhiem";

/**
 * BANNER "ĐANG CHỜ SỬA DỮ LIỆU" — đầu trang chi tiết đơn [16/09/2026, bước A3].
 *
 * Chủ dự án: *"màn đơn hiện banner 'Đang chờ sửa dữ liệu'"*.
 *
 * ── Vì sao ĐẦU TRANG, không phải toast khi bấm ──
 * Người mở đơn phải biết TRƯỚC KHI thao tác. Để họ bấm "Xuất QR" rồi mới ăn một câu từ
 * chối là bắt họ trả giá bằng thời gian cho một sự thật hệ thống đã biết từ lúc tải trang.
 *
 * ── Hai mức, và chúng KHÔNG cùng hậu quả ──
 * · NẶNG (`CON_NHA_KHAC`) — đơn ghi tên con của gia đình khác. Hệ thống ĐÃ chặn phát QR và
 *   chặn nhắc nợ, vì nội dung chuyển khoản mang TÊN HỌC VIÊN: gửi ra ngoài là lộ thông tin
 *   một đứa trẻ cho nhà không liên quan. Banner phải GỌI TÊN các em sai — không gọi tên thì
 *   người sửa phải tự dò từng dòng.
 * · NHẸ (`TIEN_CHUA_GAN`) — tiền đã về mà chưa gắn ghi danh. Sai SỔ, không lộ gì, và KHÔNG
 *   chặn thao tác nào. Đo trên PROD 16/09: 18 đơn / 178.544.000đ ở đúng mức này — nếu mức
 *   nhẹ cũng chặn QR thì 18 phụ huynh đang muốn trả tiền bị chặn vì một lỗi nội bộ.
 *
 * Hai mức có thể cùng lúc: mức nặng làm câu chính, mức nhẹ thành một dòng phụ.
 *
 * ── Ràng buộc giao diện (DESIGN.md) ──
 * Admin = shadcn/ui, KHÔNG Magic UI / Framer Motion (ESLint chặn cứng). Màu đi qua token
 * ngữ nghĩa `state-*`, cấm hex rời. Không dùng viền trái dày làm điểm nhấn. Tiếng Việt dài
 * là mặc định: tên em có dấu và dài, tiền 9 chữ số — nên khối chữ phải `min-w-0` và cho
 * xuống dòng, không `truncate` (cắt mất tên em là làm hỏng chính việc banner sinh ra để làm).
 */
export function BannerDonNhiem({ d }: { d: DonNhiem }) {
  if (!d.nhiem) return null;

  const nang = d.lyDo.includes(MA_NHIEM.CON_NHA_KHAC);
  const coTienTreo = d.lyDo.includes(MA_NHIEM.TIEN_CHUA_GAN);
  const Icon = nang ? ShieldAlert : TriangleAlert;

  return (
    <Alert
      // Sắc thái theo mức NẶNG NHẤT đang có. `items-start` để biểu tượng neo theo dòng đầu
      // khi chữ xuống nhiều dòng ở màn hẹp.
      className={
        nang
          ? "mb-4 items-start border-state-danger-ink/25 bg-state-danger-soft text-state-danger-ink"
          : "mb-4 items-start border-state-warning-ink/25 bg-state-warning-soft text-state-warning-ink"
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <AlertTitle className="min-w-0 text-sm font-semibold">
        {nang
          ? "Đang chờ sửa dữ liệu — đơn ghi tên con của gia đình khác"
          : "Đang chờ sửa dữ liệu — tiền đã về nhưng chưa gắn học viên"}
      </AlertTitle>
      <AlertDescription className="min-w-0 text-current/90">
        <div className="space-y-1.5 text-sm leading-relaxed">
          {nang && (
            <p className="break-words">
              Dòng hàng đang ghi{" "}
              <b className="font-semibold">{d.conNhaKhac.join(", ")}</b> — các em này không
              phải con của số điện thoại trên đơn. Hệ thống đã tạm khoá{" "}
              <b className="font-semibold">phát mã QR</b> và{" "}
              <b className="font-semibold">nhắc nợ tự động</b>, vì nội dung chuyển khoản mang
              tên học viên: gửi đi là lộ thông tin một đứa trẻ cho gia đình không liên quan.
            </p>
          )}
          {nang && (
            <p className="break-words">
              <b className="font-semibold">Cách sửa:</b> chọn lại học viên ở từng dòng hàng
              cho đúng con của khách. Khoá tự mở khi không còn dòng nào sai — không cần ai
              gỡ cờ.
            </p>
          )}
          {coTienTreo && (
            <p className="break-words">
              {nang ? "Ngoài ra, " : ""}
              <b className="font-semibold tabular-nums">
                {d.soKhoanChuaGan} khoản ({d.tienChuaGan.toLocaleString("vi-VN")}đ)
              </b>{" "}
              đã ghi nhận trên đơn mà chưa gắn ghi danh nào, nên công nợ của từng con chưa
              giảm và kế toán chưa xuất được phiếu thu.{" "}
              {nang ? "" : "Việc này không chặn thao tác nào — "}
              gắn học viên cho khoản ở màn Thanh toán.
            </p>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
