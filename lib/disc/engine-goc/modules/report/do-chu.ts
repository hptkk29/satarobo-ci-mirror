// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/do-chu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * ĐO CHỮ CHO CANVAS — phần lõi thuần, không đụng DOM.
 *
 * 🔴 Vì sao file này tồn tại: Canvas 2D KHÔNG báo lỗi khi chữ tràn khung. Nó vẽ tiếp
 * ra ngoài mép, chữ cụt nửa câu, và ảnh vẫn xuất ra bình thường. Không có ngoại lệ,
 * không có cảnh báo, không có gì đỏ. Người dùng chỉ phát hiện khi mở file ảnh ra xem.
 *
 * Nên mọi chuỗi PHẢI đi qua đây trước khi được vẽ.
 *
 * File này nhận vào một hàm đo bề rộng (`doRong`) thay vì nhận `CanvasRenderingContext2D`,
 * để phần tính toán tách hẳn khỏi trình duyệt và test được bằng thước giả.
 */

/** Đo bề rộng một chuỗi, tính bằng pixel. Ngoài đời là `ctx.measureText(s).width`. */
export type DoRong = (chuoi: string) => number;

/** Chuỗi có vừa một khung rộng `rongToiDa` px không? */
export function chuVuaKhung(chuoi: string, rongToiDa: number, doRong: DoRong): boolean {
  if (rongToiDa <= 0) return false;
  return doRong(chuoi.normalize("NFC")) <= rongToiDa;
}

/**
 * Ngắt chuỗi thành nhiều dòng, mỗi dòng vừa `rongToiDa`.
 *
 * Không cắt giữa một từ — tiếng Việt có dấu, cắt giữa từ vừa sai nghĩa vừa xấu.
 * Từ đơn lẻ dài hơn cả khung (đường dẫn, chuỗi không dấu cách) thì đành để nguyên
 * trên một dòng riêng: thà tràn một dòng còn hơn cắt bừa — và `chuVuaKhung` sẽ bắt
 * được ca đó ở lớp gọi.
 */
export function ngatDong(chuoi: string, rongToiDa: number, doRong: DoRong): string[] {
  // NFC: "Cẩn" gõ kiểu tổ hợp (NFD) là 2 mã ký tự, gõ kiểu dựng sẵn (NFC) là 1.
  // Không chuẩn hoá thì cùng một câu tiếng Việt đo ra hai bề rộng khác nhau tuỳ
  // nguồn gõ — và lỗi chỉ lộ ra ở đúng vài chữ có dấu.
  const sach = chuoi.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (sach === "") return [];
  if (rongToiDa <= 0) return [sach];

  const dong: string[] = [];
  let hienTai = "";

  for (const tu of sach.split(" ")) {
    const thu = hienTai === "" ? tu : `${hienTai} ${tu}`;
    if (doRong(thu) <= rongToiDa) {
      hienTai = thu;
      continue;
    }
    if (hienTai !== "") dong.push(hienTai);
    hienTai = tu;
  }
  if (hienTai !== "") dong.push(hienTai);
  return dong;
}

/**
 * Ngắt dòng có giới hạn số dòng. Thừa thì cắt và thêm dấu lược ở CUỐI DÒNG CUỐI,
 * sao cho dòng cuối vẫn vừa khung.
 *
 * Trả về `{ dong, biCat }` — `biCat` để lớp gọi biết nội dung đã mất chữ, thay vì
 * âm thầm giao một tấm ảnh thiếu nghĩa.
 */
export function ngatDongCoHan(
  chuoi: string,
  rongToiDa: number,
  soDongToiDa: number,
  doRong: DoRong,
  dauLuoc = "…",
): { dong: string[]; biCat: boolean } {
  const tatCa = ngatDong(chuoi, rongToiDa, doRong);
  if (soDongToiDa <= 0) return { dong: [], biCat: tatCa.length > 0 };
  if (tatCa.length <= soDongToiDa) return { dong: tatCa, biCat: false };

  const giu = tatCa.slice(0, soDongToiDa);
  let cuoi = giu[giu.length - 1];

  while (cuoi.length > 0 && doRong(cuoi + dauLuoc) > rongToiDa) {
    cuoi = cuoi.slice(0, -1).trimEnd();
  }
  giu[giu.length - 1] = cuoi + dauLuoc;
  return { dong: giu, biCat: true };
}

/**
 * Thu cỡ chữ cho tới khi chuỗi vừa khung trên ĐÚNG MỘT dòng.
 *
 * Dùng cho tiêu đề và tên nhân vật — thứ không được phép xuống dòng. Trả về cỡ chữ
 * cuối cùng; chạm `coToiThieu` mà vẫn không vừa thì trả `coToiThieu` kèm `vua: false`
 * để lớp gọi tự quyết (thường là chuyển sang ngắt dòng).
 */
export function thuCoChuVuaMotDong(
  chuoi: string,
  rongToiDa: number,
  coBanDau: number,
  coToiThieu: number,
  doRongTheoCo: (chuoi: string, co: number) => number,
): { co: number; vua: boolean } {
  for (let co = Math.round(coBanDau); co >= coToiThieu; co -= 1) {
    if (doRongTheoCo(chuoi, co) <= rongToiDa) return { co, vua: true };
  }
  return { co: coToiThieu, vua: false };
}
