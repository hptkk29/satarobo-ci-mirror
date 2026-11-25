// lib/hoa-hong/quy-thuc-thu.ts — QUY thực thu về từng dòng học phí để biết "lần mua này có thật không".
//
// THUẦN. Dùng cho bộ phân loại (04 §5.2 bước 5, "Σ thực thu > 0"): một lần mua trước chỉ tính là
// lần mua THẬT khi có tiền thật vào dòng đó. Hàm này chỉ trả lời "dòng đó nhận bao nhiêu" và
// "có tiền chưa biết thuộc dòng nào không" — nó KHÔNG phải bộ tách thành phần của sổ (04 §4.3,
// PR5) và không thay thế `tinhNoTheoCon`.
//
// Đầu vào là các bút toán ĐÃ lọc bằng `WHERE_THUC_THU` (CONFIRMED + REFUNDED âm, `deletedAt` null);
// hàm không lọc lại — nó cộng đúng những gì được đưa.
//
// Cách quy (dừng ở bước đầu cho đáp án):
//   1. `orderItemId` của bút toán là dòng học phí ⇒ dòng đó (hạt công nợ theo con, schema:6913).
//   2. `orderItemId` là dòng KHÔNG phải học phí (học cụ…) ⇒ bỏ.
//   3. không có `orderItemId`, `enrollmentId` khớp đúng một dòng học phí ⇒ dòng đó.
//   4. không gắn gì, đơn chỉ có ĐÚNG MỘT dòng (chính dòng học phí) ⇒ dòng đó.
//   5. không gắn gì, đơn nhiều dòng ⇒ "chưa gắn": KHÔNG đoán thuộc dòng nào. Dòng học phí nào của
//      đơn ấy mà quy được ≤ 0 thì đánh dấu `moHo` — người phân loại không được kết luận "chưa từng
//      mua" trên nền tiền chưa biết chủ.
//
// MỘT phép quy duy nhất (`phanBo`) cho cả hai đầu ra — tổng theo dòng (`quyThucThuTheoDong`) và danh sách khoản theo dòng
// (`quyKhoanTheoDong`, luật v2 cần NGÀY THU của từng khoản để so với τ). Viết phép quy thứ hai là mở đường cho hai con số
// lệch nhau, nên đừng.
export type DongCuaDon = {
  orderItemId: string;
  orderId: string;
  laHocPhi: boolean;
  enrollmentId: string | null;
};

export type ButToanQuy = {
  orderId: string;
  orderItemId: string | null;
  enrollmentId: string | null;
  /** Số tiền ĐÃ có dấu (hoàn = âm). */
  amount: number;
};

export type ThucThuDong = { thucThu: number; moHo: boolean };

type KetQuaQuy<B extends ButToanQuy> = {
  /** Mọi dòng học phí → các bút toán quy được cho nó (dòng không phải học phí không có mục). */
  khoan: Map<string, B[]>;
  /** Σ bút toán KHÔNG quy được, theo đơn. */
  chuaGan: Map<string, number>;
  theoDon: Map<string, DongCuaDon[]>;
};

function phanBo<B extends ButToanQuy>(dongCuaDon: readonly DongCuaDon[], butToan: readonly B[]): KetQuaQuy<B> {
  const theoDon = new Map<string, DongCuaDon[]>();
  for (const d of dongCuaDon) {
    const ds = theoDon.get(d.orderId);
    if (ds) ds.push(d);
    else theoDon.set(d.orderId, [d]);
  }

  const khoan = new Map<string, B[]>();
  for (const d of dongCuaDon) if (d.laHocPhi) khoan.set(d.orderItemId, []);

  const chuaGan = new Map<string, number>();
  for (const [orderId, dongs] of theoDon) {
    const hocPhi = dongs.filter((d) => d.laHocPhi);
    for (const b of butToan) {
      if (b.orderId !== orderId) continue;
      const gan = (id: string) => khoan.get(id)?.push(b);
      if (b.orderItemId !== null) {
        if (hocPhi.some((d) => d.orderItemId === b.orderItemId)) gan(b.orderItemId);
        continue; // dòng không phải học phí (hoặc không thuộc đơn này) ⇒ bỏ
      }
      const theoGhiDanh = b.enrollmentId === null ? [] : hocPhi.filter((d) => d.enrollmentId === b.enrollmentId);
      if (theoGhiDanh.length === 1) {
        gan(theoGhiDanh[0]!.orderItemId);
        continue;
      }
      if (dongs.length === 1 && hocPhi.length === 1) {
        gan(hocPhi[0]!.orderItemId);
        continue;
      }
      chuaGan.set(orderId, (chuaGan.get(orderId) ?? 0) + b.amount);
    }
  }
  return { khoan, chuaGan, theoDon };
}

export function quyThucThuTheoDong(
  dongCuaDon: readonly DongCuaDon[],
  butToan: readonly ButToanQuy[],
): Map<string, ThucThuDong> {
  const { khoan, chuaGan, theoDon } = phanBo(dongCuaDon, butToan);

  const ketQua = new Map<string, ThucThuDong>();
  for (const [id, ds] of khoan) ketQua.set(id, { thucThu: ds.reduce((s, b) => s + b.amount, 0), moHo: false });

  for (const [orderId, dongs] of theoDon) {
    if ((chuaGan.get(orderId) ?? 0) <= 0) continue;
    for (const d of dongs) {
      const r = d.laHocPhi ? ketQua.get(d.orderItemId) : undefined;
      if (r && r.thucThu <= 0) r.moHo = true;
    }
  }
  return ketQua;
}

/**
 * Các bút toán quy được cho từng dòng học phí — CHÍNH các đối tượng được đưa vào (giữ nguyên id, ngày thu…), để luật v2 so
 * từng khoản với τ. Tổng của mỗi dòng luôn bằng `quyThucThuTheoDong(...).thucThu`.
 */
export function quyKhoanTheoDong<B extends ButToanQuy>(
  dongCuaDon: readonly DongCuaDon[],
  butToan: readonly B[],
): Map<string, B[]> {
  return phanBo(dongCuaDon, butToan).khoan;
}
