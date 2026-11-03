// Tải một tệp base64 do Server Action trả về (bảng chi xlsx). Chỉ chạy ở trình duyệt.
//
// Vì sao base64 mà không phải đường dẫn: lượt Xuất GHI sổ (tạo lô, đổi kỳ sang EXPORTED) và tệp chỉ tồn tại trong phản hồi của chính lượt đó —
// không có chỗ nào để tải lại. Nên màn giữ tệp trong bộ nhớ và cho tải lại từ đó cho tới khi đóng hộp thoại.
const KIEU_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type TepXuat = { tenTep: string; base64: string };

/** base64 → Blob. Tách riêng để test không cần DOM. */
export function blobTuBase64(base64: string): Blob {
  const nhiPhan = atob(base64);
  const bytes = new Uint8Array(nhiPhan.length);
  for (let i = 0; i < nhiPhan.length; i++) bytes[i] = nhiPhan.charCodeAt(i);
  return new Blob([bytes], { type: KIEU_XLSX });
}

export function taiTep(tep: TepXuat): void {
  const url = URL.createObjectURL(blobTuBase64(tep.base64));
  const a = document.createElement("a");
  a.href = url;
  a.download = tep.tenTep;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Thu hồi chậm: thu ngay có trình duyệt huỷ lượt tải đang bắt đầu.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
