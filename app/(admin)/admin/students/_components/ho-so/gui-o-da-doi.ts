// Form hồ sơ ở chế độ SỬA chỉ gửi những ô NGƯỜI DÙNG ĐÃ ĐỔI (25/09/2026). THUẦN.
//
// Vì sao — lượt rà đối kháng: form là ô KHÔNG kiểm soát. Người dùng gõ dở vài ô rồi bấm
// "Gắn lead" (điền ô trống từ lead) hoặc "Bảo lưu" (đổi trạng thái): server đổi giá trị, trang
// nạp lại. Nếu gửi CẢ tờ như trước, lượt "Lưu thay đổi" sau đó ghi ngược giá trị CŨ đang nằm
// trong ô (trạng thái về "Đang học", ô vừa điền về trống) — vì hợp đồng `docFormHocVien` là
// "khoá CÓ MẶT ⇒ ghi". Gửi riêng phần đã đổi thì ô người dùng không chạm KHÔNG có mặt ⇒
// server không đụng — form cũ không còn ghi đè được thứ nó không sửa.
//
// Ba khoá LUÔN gửi: bắt buộc ở validator; `docFormHocVien` điền "" khi vắng ⇒ báo lỗi bắt
// buộc. Gửi lại đúng giá trị đang hiện là vô hại (SĐT bị che thì action tự bỏ khoá đó).

export const KHOA_LUON_GUI: ReadonlySet<string> = new Set(["name", "parentName", "parentPhone"]);

/** Ảnh chụp giá trị các ô của form (chỉ ô chữ — form này không có ô tệp). */
export function anhChupForm(fd: FormData): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") m.set(k, v);
  }
  return m;
}

/**
 * Bỏ khỏi `fd` (tại chỗ) mọi ô có giá trị BẰNG ảnh chụp lúc mở form, trừ `KHOA_LUON_GUI`.
 * Ô mới xuất hiện sau lúc chụp (không có trong ảnh chụp) coi là đã đổi ⇒ giữ. Trả lại `fd`.
 */
export function chiGiuODaDoi(fd: FormData, banDau: ReadonlyMap<string, string>): FormData {
  for (const k of [...new Set(fd.keys())]) {
    if (KHOA_LUON_GUI.has(k)) continue;
    const v = fd.get(k);
    if (typeof v === "string" && banDau.has(k) && banDau.get(k) === v) fd.delete(k);
  }
  return fd;
}
