// Tải MỘT tệp chứng từ ngân hàng lên kho riêng — client điều phối: ký URL PUT (server) → trình duyệt PUT thẳng R2 có tiến độ →
// server XÁC MINH BYTE rồi ghi vào hồ sơ (một action, nên không có trạng thái "tệp đã lên kho mà hồ sơ chưa biết" kéo dài).
import { ghiChungTuDaTaiAction, kyTaiLenChungTuAction } from "../_actions";
import { loaiTepTuTen, TRAN_CO_TEP_CHUNG_TU } from "@/lib/finance/hoa-don/chung-tu-ngan-hang";

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
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Tải tệp lên kho không thành công (mã ${xhr.status}) — thử lại`));
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải tệp lên — kiểm mạng rồi thử lại"));
    xhr.send(file);
  });
}

export async function taiChungTuLen(input: { paymentId: string; file: File; ghiChu: string; onPct: (pct: number) => void }): Promise<void> {
  const loai = loaiTepTuTen(input.file.name);
  if (!loai) throw new Error("Chỉ nhận tệp PDF, PNG hoặc JPG");
  if (input.file.size > TRAN_CO_TEP_CHUNG_TU) {
    throw new Error(`Tệp quá lớn — tối đa ${Math.round(TRAN_CO_TEP_CHUNG_TU / 1024 / 1024)} MB`);
  }
  const ky = await kyTaiLenChungTuAction({ paymentId: input.paymentId, loai });
  if (!ky.ok) throw new Error(ky.error);
  await putCoTienDo(ky.data.url, input.file, ky.data.contentType, input.onPct);
  const ghi = await ghiChungTuDaTaiAction({ paymentId: input.paymentId, loai, khoa: ky.data.khoa, ten: input.file.name, ghiChu: input.ghiChu });
  if (!ghi.ok) throw new Error(ghi.error);
}
