// lib/payments/pos/ket-qua-lo.ts — KẾT QUẢ một lô nhập giao dịch thẻ POS + phép cộng các lô của một
// lượt. THUẦN (không DB) — màn import (`nhap-file-pos.tsx`) cộng kết quả từng lô bằng chính hàm này.
// Thiết kế: docs/pos-gd3-thiet-ke.md §5, §8.
//
// Nghĩa từng ô (V13) — giữ nguyên nghĩa của các lượt cũ trong lịch sử:
//   · `moi` / `capNhat` — dòng POS tạo mới / đã có. `moi + capNhat + loi.length` = số dòng DUY NHẤT.
//   · `tuKhop`          — khớp MỚI ở lượt này. Dòng đã khoá (đã ghi nhận) không đếm vào đây.
//   · `canXuLy` / `boQua` — kết luận của dòng ĐƯỢC XÉT LẠI ở lượt này (dòng chưa khoá). Nhập lại thì
//     đếm lại; dòng đã khoá và dòng hủy đã kết luận chỉ vào `capNhat`.
//   · `lech` (GĐ3)      — dòng ĐÃ KHOÁ mà file ghi số tiền / trạng thái khác: sổ KHÔNG đổi, chỉ báo.
import type { LechDong } from "./lech-da-ghi-nhan";

export type KetQuaLoPos = {
  moi: number;
  capNhat: number;
  tuKhop: number;
  canXuLy: number;
  boQua: number;
  loi: { maGiaoDich: string; loi: string }[];
  /** BẮT BUỘC (luật 7): mọi chỗ dựng kết quả lô phải nói rõ có lệch hay không. */
  lech: LechDong[];
};

/** Phần tử trung hoà của `congKetQua` — điểm xuất phát của một lượt trên màn. Không ai sửa nó tại chỗ. */
export const KET_QUA_RONG: KetQuaLoPos = { moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0, loi: [], lech: [] };

const khoaLech = (l: LechDong) => `${l.maGiaoDich}|${l.truong}`;

/** Cộng hai kết quả lô. `lech` khử trùng theo `maGiaoDich|truong`, giữ bản xuất hiện SAU. Không đổi đầu vào. */
export function congKetQua(a: KetQuaLoPos, b: KetQuaLoPos): KetQuaLoPos {
  const lech = new Map<string, LechDong>();
  for (const l of [...a.lech, ...b.lech]) {
    lech.delete(khoaLech(l));
    lech.set(khoaLech(l), l);
  }
  return {
    moi: a.moi + b.moi,
    capNhat: a.capNhat + b.capNhat,
    tuKhop: a.tuKhop + b.tuKhop,
    canXuLy: a.canXuLy + b.canXuLy,
    boQua: a.boQua + b.boQua,
    loi: [...a.loi, ...b.loi],
    lech: [...lech.values()],
  };
}

/**
 * Số đếm của LƯỢT (cột `PosImportBatch.so*`) đọc lại từ DB ngay sau câu đếm có điều kiện của một lô
 * [rà đối kháng GĐ3 · 06/10/2026]. Đây là con số bảng "10 lần import gần nhất" in ra.
 */
export type SoDemLuot = Pick<KetQuaLoPos, "moi" | "capNhat" | "tuKhop" | "canXuLy" | "boQua">;

/** Kết quả `nhapLoPos` trả cho màn: kết quả xử lý lô + số đếm của lượt sau lô đó. BẮT BUỘC (luật 7). */
export type KetQuaNhapLo = KetQuaLoPos & { soDemLuot: SoDemLuot };

/**
 * Tổng của lượt trên màn sau một lô: năm con số lấy từ SỐ ĐẾM CỦA LƯỢT trong DB, lỗi + lệch cộng dồn qua
 * `congKetQua`. Mã TRƯỚC bản vá: màn `tong = congKetQua(tong, r.ketQua)` ⇒ lô GỬI LẠI (lần đầu server đã
 * đếm, trả lời mất) cộng kết quả lần xử lý lại {moi 0, capNhat n, tuKhop 0} ⇒ panel + toast ra Mới / Tự
 * khớp THẤP hơn, Cập nhật CAO hơn lịch sử của chính lượt đó (luật 12). Không đổi đầu vào.
 */
export function tongLuotSauLo(tong: KetQuaLoPos, lo: KetQuaNhapLo): KetQuaLoPos {
  const { moi, capNhat, tuKhop, canXuLy, boQua } = lo.soDemLuot;
  const { loi, lech } = congKetQua(tong, lo);
  return { moi, capNhat, tuKhop, canXuLy, boQua, loi, lech };
}
