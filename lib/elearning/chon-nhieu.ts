// Chọn nhiều + "Chọn tất cả" cho danh sách của khu e-learning — luật THUẦN (không React), để test được từng cạnh.
//
// Hai chốt an toàn mà thành phần hiển thị KHÔNG được tự quyết:
//   1. Trần số dòng một lượt thao tác hàng loạt (`TRAN_THAO_TAC_HANG_LOAT`, khớp trần 500 người thêm tay của giao khoá).
//   2. `idGuiLenServer` chỉ trả những id VẪN còn trong danh sách đang hiển thị — sau khi lọc/chuyển trang, id cũ còn nằm
//      trong tập chọn không được lẳng lặng đi theo thao tác (người dùng không còn thấy dòng đó nữa).
// Đây chỉ là tiện lợi giao diện. Server action nhận danh sách id vẫn PHẢI kiểm `can()` + `scopedDb` trên TỪNG id — danh
// sách từ client không bao giờ là nguồn tin cậy.

export const TRAN_THAO_TAC_HANG_LOAT = 500;

export type TrangThaiChonTatCa = "khong" | "mot-phan" | "tat-ca";

/** Trạng thái ô "chọn tất cả" so với các dòng đang hiển thị (không tính id đã rời danh sách). */
export function trangThaiChonTatCa(dangHien: readonly string[], daChon: ReadonlySet<string>): TrangThaiChonTatCa {
  if (dangHien.length === 0) return "khong";
  let dem = 0;
  for (const id of dangHien) if (daChon.has(id)) dem++;
  if (dem === 0) return "khong";
  return dem === dangHien.length ? "tat-ca" : "mot-phan";
}

/** Bật/tắt một dòng. Bật quá trần ⇒ không thêm (trả nguyên tập), kèm cờ để giao diện nói lý do. */
export function doiMotDong(
  daChon: ReadonlySet<string>,
  id: string,
  tran: number = TRAN_THAO_TAC_HANG_LOAT,
): { tap: Set<string>; chamTran: boolean } {
  const tap = new Set(daChon);
  if (tap.has(id)) {
    tap.delete(id);
    return { tap, chamTran: false };
  }
  if (tap.size >= tran) return { tap, chamTran: true };
  tap.add(id);
  return { tap, chamTran: false };
}

/**
 * "Chọn tất cả" các dòng ĐANG HIỂN THỊ: đã chọn hết ⇒ bỏ chọn các dòng ấy (giữ id ngoài trang); chưa hết ⇒ thêm các dòng
 * còn thiếu cho tới trần. `biCat` = true khi trần làm sót dòng (giao diện phải nói "chỉ chọn được n").
 */
export function chonTatCaDangHien(
  dangHien: readonly string[],
  daChon: ReadonlySet<string>,
  tran: number = TRAN_THAO_TAC_HANG_LOAT,
): { tap: Set<string>; biCat: boolean } {
  const tap = new Set(daChon);
  if (trangThaiChonTatCa(dangHien, daChon) === "tat-ca") {
    for (const id of dangHien) tap.delete(id);
    return { tap, biCat: false };
  }
  let biCat = false;
  for (const id of dangHien) {
    if (tap.has(id)) continue;
    if (tap.size >= tran) {
      biCat = true;
      break;
    }
    tap.add(id);
  }
  return { tap, biCat };
}

/** Danh sách id gửi lên server: giao của tập chọn với các dòng đang hiển thị, giữ thứ tự hiển thị, không trùng. */
export function idGuiLenServer(dangHien: readonly string[], daChon: ReadonlySet<string>): string[] {
  const thay = new Set<string>();
  const ra: string[] = [];
  for (const id of dangHien) {
    if (daChon.has(id) && !thay.has(id)) {
      thay.add(id);
      ra.push(id);
    }
  }
  return ra;
}
