// Tải MỘT tệp hoá đơn lên kho riêng — ba bước, client điều phối (PLAN §6):
//   ký URL PUT (server) → trình duyệt PUT thẳng R2, có tiến độ → server xác minh byte.
// Trả khoá + tên tệp để action lưu nháp XÁC MINH LẠI (server không tin kết quả lượt này).
import { kyTaiLenHoaDonAction, xacMinhTepHoaDonAction } from "../_actions";

export type LoaiTepHoaDon = "pdf" | "xml";

function putCoTienDo(url: string, file: File, contentType: string, onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Header PHẢI trùng mime đã ký — URL chỉ ký ContentType, gửi mime khác là R2 trả 403.
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Tải tệp lên kho không thành công (mã ${xhr.status}) — thử lại`));
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải tệp lên — kiểm mạng rồi thử lại"));
    xhr.send(file);
  });
}

export async function taiTepHoaDon(input: {
  orderId: string;
  loai: LoaiTepHoaDon;
  file: File;
  onPct: (pct: number) => void;
  /** GĐ 8 — bản nháp đang sửa (tải lại đúng tờ của nó không bị coi là trùng); `null` khi tạo mới. */
  hoaDonId: string | null;
}): Promise<{ khoa: string; ten: string }> {
  const ky = await kyTaiLenHoaDonAction({ orderId: input.orderId, loai: input.loai });
  if (!ky.ok) throw new Error(ky.error);
  if (input.file.size > ky.data.tranCo) {
    throw new Error(`Tệp ${input.loai.toUpperCase()} quá lớn — tối đa ${Math.round(ky.data.tranCo / 1024 / 1024)} MB`);
  }
  await putCoTienDo(ky.data.url, input.file, ky.data.contentType, input.onPct);
  const xm = await xacMinhTepHoaDonAction({ orderId: input.orderId, loai: input.loai, khoa: ky.data.khoa, hoaDonId: input.hoaDonId });
  if (!xm.ok) throw new Error(xm.error);
  return { khoa: xm.data.khoa, ten: input.file.name };
}
