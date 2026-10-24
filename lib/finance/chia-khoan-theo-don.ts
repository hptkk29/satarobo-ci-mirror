/**
 * TIỀN CỦA ĐƠN NÀO THÌ VỀ HỌC VIÊN CỦA ĐƠN ĐÓ.
 *
 * ── Con bug bản vá này đóng (đo 15/09/2026, chạy tay đầu-cuối) ──
 * `linkRecordedPaymentsToEnrollments` gom khoản bằng `where: { order: { leadId } }` — tức
 * MỌI ĐƠN CỦA LEAD — rồi chia mỗi khoản cho TẤT CẢ ghi danh theo `finalPrice`. Nó không hề
 * nhìn `orderId`, càng không nhìn `OrderItem.studentId`.
 *
 * Hai ca đo được:
 *   · Hai đơn, mỗi con một đơn. Tiền đơn của Trần Minh Khôi (2.880.000đ) bị chia:
 *       1.043.478đ → ghi danh Khôi        956.522đ → ghi danh Trần Bảo Ngọc  ✗
 *   · Lead 3 con, đơn chỉ bán cho 2 con. Cả 2.000.000đ lẫn 2.617.000đ đều chia cho CẢ BA,
 *     kể cả em KHÔNG có trên đơn.
 *
 * Tổng luôn khớp nên không cổng nào kêu. Nhưng mọi thứ đọc Ledger-A THEO GHI DANH đều nói
 * sai tên một đứa trẻ: công nợ từng học viên, cổng phụ huynh, hoàn tiền, và tờ phiếu thu
 * đưa tận tay phụ huynh (`lib/pdf/receipt.tsx` in lớp/khoá lấy từ enrollment).
 *
 * ── Vì sao phép chia theo tỉ lệ vẫn PHẢI giữ ──
 * Nó ĐÚNG cho ca MỘT ĐƠN NHIỀU DÒNG (hai con chung một đơn, một công nợ, một mã QR — đúng
 * thứ chủ dự án chốt 15/09). Khách chuyển một cục 5.000.000đ cho đơn hai con thì phải chia.
 * Cái sai không phải phép chia, mà là TẬP ĐƯỢC CHIA: phải là học viên TRÊN ĐƠN ĐÓ, cân theo
 * tiền TỪNG DÒNG của đơn đó — không phải toàn bộ ghi danh của lead cân theo giá lớp.
 */

import { allocateByWeight } from "@/lib/finance/allocate";

/** Một dòng của CHÍNH đơn đang xét. `thanhTien` = tiền dòng SAU giảm giá. */
export type DongDonCoHocVien = {
  studentId: string | null;
  /** `OrderItem.metadata.courseId` — khoá học của dòng. */
  courseId: string | null;
  thanhTien: number;
};

/** Một ghi danh vừa tạo lúc chuyển đổi lead. */
export type GhiDanhCuaLead = {
  enrollmentId: string;
  studentId: string;
  /** Khoá học của LỚP em được xếp vào (`Class.courseId`). */
  courseId: string | null;
  finalPrice: number;
};

export type PhanChia = { enrollmentId: string; amount: number };

export type KetQuaChia = {
  phan: PhanChia[];
  /**
   * `true` khi phải rơi về đường CŨ (chia cho mọi ghi danh theo `finalPrice`) vì đơn không
   * khai được học viên nào. Người gọi nên ghi lại — đó là ca duy nhất còn có thể gán tiền
   * sang em không nằm trên đơn, và ta muốn biết nó xảy ra bao nhiêu lần.
   */
  duongLui: boolean;
};

/**
 * Chia MỘT khoản của MỘT đơn về các ghi danh.
 *
 * @param soTien   Số tiền của khoản.
 * @param dongDon  Các dòng của ĐÚNG đơn sinh ra khoản này.
 * @param ghiDanh  Mọi ghi danh vừa tạo cho lead (thứ tự giữ nguyên để kết quả ổn định).
 *
 * Luật, theo thứ tự:
 *   1. Gom tiền theo HỌC VIÊN từ các dòng của đơn (một em có thể có nhiều dòng).
 *   2. Ghi danh ĐƯỢC CHIA = ghi danh có `studentId` xuất hiện ở bước 1. Em không có trên
 *      đơn thì không nhận một đồng nào — đây chính là điều bản cũ làm sai.
 *   3. Không có ghi danh nào khớp ⇒ ĐƯỜNG LUI: chia cho mọi ghi danh theo `finalPrice`
 *      (đơn cũ/đơn walk-in không khai học viên trên dòng). Có cờ `duongLui` để đếm.
 *   4. Đúng một ghi danh khớp ⇒ nguyên khoản, KHÔNG tách. Tách một khoản thành một mảnh
 *      là sinh thêm dòng sổ mà chẳng để làm gì.
 *   5. Nhiều ghi danh khớp ⇒ `allocateByWeight` theo tiền dòng (bất biến tổng).
 */
export function chiaKhoanTheoDon(
  soTien: number,
  dongDon: readonly DongDonCoHocVien[],
  ghiDanh: readonly GhiDanhCuaLead[],
): KetQuaChia {
  const tien = Number.isFinite(soTien) ? Math.max(0, Math.round(soTien)) : 0;
  if (ghiDanh.length === 0 || tien <= 0) return { phan: [], duongLui: false };

  const tienCua = (d: DongDonCoHocVien) =>
    Number.isFinite(d.thanhTien) ? Math.max(0, Math.round(d.thanhTien)) : 0;

  // 1 — tiền theo HỌC VIÊN ghi thẳng trên dòng.
  const theoHocVien = new Map<string, number>();
  for (const d of dongDon) {
    const id = d.studentId?.trim();
    if (id) theoHocVien.set(id, (theoHocVien.get(id) ?? 0) + tienCua(d));
  }

  // 2 — tiền theo KHOÁ HỌC của dòng.
  //
  // ⚠️ NHÁNH NÀY LÀ NHÁNH CHẠY THẬT CỦA LUỒNG LEAD, không phải ca hiếm. Đo 15/09/2026:
  // đơn lập từ `/orders/new?leadId=…` có `OrderItem.studentId` = NULL ở MỌI dòng, vì lúc
  // tạo đơn học viên chưa tồn tại — `Student` chỉ ra đời ở bước Chuyển đổi, SAU đó.
  // Bản vá đầu của tôi chỉ khớp theo `studentId` nên rơi 100% vào đường lui và chia sai y
  // như cũ; phải chạy thật mới lộ ra.
  // Thứ CÓ trên dòng là `metadata.courseId`, và mỗi em được xếp vào lớp thuộc đúng khoá
  // em quan tâm — nên khoá học là cái móc nối đúng và sẵn có.
  const theoKhoa = new Map<string, number>();
  for (const d of dongDon) {
    const k = d.courseId?.trim();
    if (k) theoKhoa.set(k, (theoKhoa.get(k) ?? 0) + tienCua(d));
  }

  // 3 — ưu tiên khớp theo HỌC VIÊN (chắc chắn nhất), rồi mới tới KHOÁ HỌC.
  let duoc = ghiDanh.filter((g) => theoHocVien.has(g.studentId));
  let trongSoCua = (g: GhiDanhCuaLead) => theoHocVien.get(g.studentId) ?? 0;
  if (duoc.length === 0) {
    duoc = ghiDanh.filter((g) => g.courseId && theoKhoa.has(g.courseId));
    trongSoCua = (g) => (g.courseId ? (theoKhoa.get(g.courseId) ?? 0) : 0);
  }

  // 4 — đường lui: đơn không khai được học viên LẪN khoá học.
  if (duoc.length === 0) {
    const phan = allocateByWeight(tien, ghiDanh.map((g) => g.finalPrice)).map((amount, i) => ({
      enrollmentId: ghiDanh[i]!.enrollmentId,
      amount,
    }));
    return { phan: phan.filter((p) => p.amount > 0), duongLui: true };
  }

  // 4 — chia theo TIỀN DÒNG của chính đơn đó.
  //
  // ⚠️ Cân theo tiền dòng, KHÔNG theo `finalPrice` của ghi danh. Hai con số này khác nhau
  // khi đơn có giảm giá theo dòng: dòng bớt nửa giá thì phần tiền em đó đã đóng cũng phải
  // nhỏ đi tương ứng, còn `finalPrice` là giá ghi danh và không biết gì về khoản giảm ấy.
  // Đo ở [CHIA-03]: cùng một khoản 1.000.000đ ra 352.941đ theo tiền dòng và 521.739đ theo
  // finalPrice — lệch 168.798đ.
  //
  // ⚠️ KHÔNG viết thêm nhánh "một em thì trả nguyên khoản" và KHÔNG viết thêm nhánh "mọi
  // dòng 0đ thì chia đều". Tôi đã viết cả hai, và BƯỚC CẤY LỖI cho thấy cả hai là MÃ CHẾT:
  // `allocateByWeight` tự làm sẵn (`n === 1 → [t]`, `denom === 0 → chia đều`). Cấy bỏ từng
  // nhánh mà 14/14 ca vẫn xanh — dấu hiệu kinh điển của một cái gác không gác gì. Ai muốn
  // đổi hai luật đó thì sửa ở `lib/finance/allocate.ts`, chỗ DUY NHẤT giữ chúng.
  const trongSo = duoc.map((g) => trongSoCua(g));
  const phan = allocateByWeight(tien, trongSo).map((amount, i) => ({
    enrollmentId: duoc[i]!.enrollmentId,
    amount,
  }));
  return { phan: phan.filter((p) => p.amount > 0), duongLui: false };
}
