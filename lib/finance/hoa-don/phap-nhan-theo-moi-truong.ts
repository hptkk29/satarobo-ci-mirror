// lib/finance/hoa-don/phap-nhan-theo-moi-truong.ts — danh sách pháp nhân PHÁT HÀNH THEO MÔI TRƯỜNG. THUẦN (chỉ đọc `env` truyền vào).
//
// MỘT cửa duy nhất để lấy cấu hình hoá đơn cho mọi nơi dùng danh sách pháp nhân phát hành (màn Cấu hình ký hiệu, lưu hoá đơn, gợi ý số, hàng chờ,
// phiếu thu, màn pháp nhân). Quy tắc:
//
//   · PRODUCTION (và mọi nơi không chắc chắn là TEST): trả CHÍNH `CAU_HINH_HOA_DON_MAC_DINH` — cùng một đối tượng, ba pháp nhân thật, không gì thêm.
//   · TEST: ba pháp nhân thật + `PHAP_NHAN_UAT` ở CUỐI. Không đổi `macDinhTheoCoSo`, `phapNhanMacDinh`, thuế: UAT không bao giờ là mặc định của
//     cơ sở nào (`phapNhanChoDon` chỉ rơi về phần tử bật ĐẦU TIÊN, mà ba pháp nhân thật đứng trước).
//   · "Là TEST" = host ứng dụng bắt đầu bằng `test.` **VÀ** không phải production thật — HAI khoá phải cùng đúng (chặn email chỉ cần MỘT khoá
//     nói "không phải prod" vì chặn nhầm thì rẻ; ở đây cho phép nhầm thì đắt, nên đòi cả hai). Máy dev / CI cũng KHÔNG thấy pháp nhân UAT.
//   · KHÔNG nới `kiemCauHinhCoSo` / `kiemCauHinhHoaDon`: chúng vẫn kiểm theo danh sách được truyền vào. Trên PROD mã `UAT_THU` bị từ chối y như mọi
//     mã lạ vì danh sách PROD không có nó.
//
// Dùng `CAU_HINH_HOA_DON_MAC_DINH` thẳng ở nơi khác là sai chỗ — lưới `[PNT-W1]` đỏ: nơi đó sẽ không thấy pháp nhân UAT trên TEST, và (tệ hơn)
// là dấu hiệu có người đang đi vòng qua cửa này.

import { hostUngDungLaTest } from "@/lib/email/chan-gui-hoa-don";
import { laProductionThat, type BienMoiTruong } from "@/lib/security/client-ip";
import { CAU_HINH_HOA_DON_MAC_DINH, PHAP_NHAN_UAT, type CauHinhHoaDon } from "./phap-nhan";

/** Môi trường này có được thấy pháp nhân UAT không. Chỉ TEST. */
export function choPhepPhapNhanThu(env: BienMoiTruong = process.env): boolean {
  return hostUngDungLaTest(env) && !laProductionThat(env);
}

/** Cấu hình hoá đơn cho môi trường hiện tại — xem đầu tệp. */
export function cauHinhHoaDonChoMoiTruong(env: BienMoiTruong = process.env): CauHinhHoaDon {
  if (!choPhepPhapNhanThu(env)) return CAU_HINH_HOA_DON_MAC_DINH;
  return { ...CAU_HINH_HOA_DON_MAC_DINH, phapNhan: [...CAU_HINH_HOA_DON_MAC_DINH.phapNhan, PHAP_NHAN_UAT] };
}
