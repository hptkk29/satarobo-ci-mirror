/**
 * GIÁ GHI DANH LẤY TỪ DÒNG ĐƠN — một luật, mọi đường convert dùng chung [HTL-09 · 23/09/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỆP NÀY TỒN TẠI
 *
 * Hệ thống đang có **hai nguồn giá cho cùng một đứa trẻ**, và không nguồn nào biết nguồn kia:
 *
 *   · **Dòng đơn** (`/orders/new`) — nơi người bán khai hình thức lớp (`coachFormat`) và số
 *     buổi, rồi hệ thống nhân hệ số Coach theo SR.QD.219 Điều 5.
 *   · **Ghi danh** (đường convert) — tính lại từ `Course.price`, tức **GIÁ LỚP NHÓM**.
 *
 * Đo 23/09/2026: `grep -c coachFormat` trên `convert-lead-v2.ts` · `convert-lead.ts` ·
 * `bulk-convert.ts` · `leads/[id]/convert/actions.ts` ra **0 · 0 · 0 · 0**. Hình thức lớp
 * chưa bao giờ đi tới trục ghi danh.
 *
 * Hậu quả đã đo với Coach 1-1 Sata3 (đơn 10.400.000đ, ghi danh 5.200.000đ):
 *   · ZNS học phí gửi `order.totalAmount` ⇒ phụ huynh nhận tin **~10,4tr**;
 *   · `/portal/hoc-phi` in **5,2tr**;
 *   · `/cong-no` ra **−5.200.000đ** ("đóng thừa");
 *   · hoàn tiền học 6/12 buổi chi **dư ~2.600.002đ**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CHỐT CỦA CHỦ DỰ ÁN (23/09/2026)
 *
 * *"Giá ghi danh lấy từ DÒNG ĐƠN; không có dòng thì như cũ."*
 *
 * Hiện thực: thay **đầu vào `listPrice`** của `computeEnrollmentPrice`, KHÔNG thay công thức.
 * Nhờ vậy giảm giá/học bổng khai lúc convert **vẫn được áp bình thường** lên giá đơn — nếu
 * lấy thẳng `totalPrice` làm `finalPrice` thì một suất học bổng khai ở màn convert sẽ bị
 * nuốt im lặng, và đó là một lỗ tiền MỚI thay cho lỗ đang vá.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CẦU NỐI dòng đơn ↔ đứa trẻ: `leadChildId`
 *
 * `OrderItem.metadata.leadChildId` do `/orders/new` ghi (`veMetadataConLead`), còn
 * `Enrollment.leadChildId` do `convert-lead-v2` ghi lúc chốt. Đó là cây cầu CÓ SẴN, đúng
 * thứ `lib/orders/hoc-vien-dong-don.ts` dựng ra — đừng khớp theo tên hay theo thứ tự.
 *
 * ⚠️ **MƠ HỒ THÌ TRẢ `null`, KHÔNG ĐOÁN.** Hai dòng cùng `leadChildId` + `courseId` nghĩa là
 * đơn đang nói hai giá cho một suất học; chọn bừa một cái là ghi một con số tiền mà không ai
 * truy được vì sao. `null` ⇒ đường gọi rơi về `Course.price` như cũ — hành vi hôm nay, không
 * tệ hơn.
 *
 * THUẦN — không Prisma, không DB. Test không cần database.
 */

/** Đủ để trả lời "dòng này bán cho bé nào, khoá nào, bao nhiêu tiền". */
export type DongDonChoGhiDanh = {
  /** `OrderItem.metadata.leadChildId` — đọc bằng `docConLeadTuMetadata`. */
  leadChildId: string | null;
  /** `OrderItem.metadata.courseId`. */
  courseId: string | null;
  /** `OrderItem.totalPrice` — số tiền dòng này, đã gồm hệ số Coach nếu có. */
  totalPrice: number;
  /**
   * `OrderItem.metadata.soBuoi` — số buổi KHÁCH MUA, `null` = mua đủ khoá [28/09/2026].
   *
   * ⚠️ BẮT BUỘC, không `?` (luật 7). Đây là nguồn DUY NHẤT để suy "học viên vào học từ
   * buổi nào" (`phamViBuoiDangKy`); trường tuỳ chọn ở đây nghĩa là chỗ nào quên `select`
   * `metadata` sẽ nhận `undefined`, phạm vi buổi rơi về "đủ khoá", và học viên mua 24 buổi
   * lặng lẽ được điểm danh cả 48 — **không lỗi nào báo**. Đúng lớp lỗi câm mà chính cột
   * `soBuoi` đã mắc suốt nhiều tháng (0/519 dòng có dữ liệu).
   */
  soBuoi: number | null;
};

export type KhoaTraGia = { leadChildId: string | null | undefined; courseId: string };

/**
 * Giá của MỘT suất học theo dòng đơn, hoặc `null` khi không tra được.
 *
 * Trả `null` trong ba ca, và cả ba đều cố ý:
 *  · bé không khai `leadChildId` (đơn walk-in, đơn cũ trước 15/09) — không có cầu nối;
 *  · không dòng nào khớp — đơn chưa có suất này;
 *  · **≥2 dòng khớp** — đơn nói hai giá cho một suất, xem khối chú thích đầu tệp.
 */
/**
 * Dòng đơn ứng với một ghi danh — PHÉP KHỚP DÙNG CHUNG.
 *
 * Tách ra 28/09/2026 khi `soBuoiChoGhiDanh` ra đời: hai đường đọc cùng một dòng đơn thì
 * phải khớp bằng CÙNG một luật, kẻo có ngày lấy giá của dòng này và số buổi của dòng kia.
 *
 * Cầu nối là `leadChildId` + `courseId`; mơ hồ (0 hoặc >1 dòng khớp) ⇒ `null`, KHÔNG đoán.
 */
function dongKhop(
  dong: readonly DongDonChoGhiDanh[],
  khoa: KhoaTraGia,
): DongDonChoGhiDanh | null {
  const conId = khoa.leadChildId?.trim();
  if (!conId) return null;
  const khop = dong.filter((d) => d.leadChildId === conId && d.courseId === khoa.courseId);
  return khop.length === 1 ? khop[0]! : null;
}

export function giaTuDongDon(
  dong: readonly DongDonChoGhiDanh[],
  khoa: KhoaTraGia,
): number | null {
  const d = dongKhop(dong, khoa);
  if (!d) return null;

  const gia = d.totalPrice;
  // Giá âm/không phải số là dữ liệu hỏng — rơi về đường cũ thay vì ghi một con số lạ.
  if (!Number.isFinite(gia) || gia < 0) return null;
  return Math.round(gia);
}

/**
 * `listPrice` đem vào `computeEnrollmentPrice`: ưu tiên dòng đơn, rơi về giá khoá.
 *
 * Tách riêng thay vì để mỗi đường gọi tự `?? giaKhoa`: bốn đường convert phải cho ra CÙNG
 * một con số, và một chỗ trong số đó viết `||` thay vì `??` là giá 0 (học bổng toàn phần)
 * lặng lẽ hoá thành giá niêm yết.
 */
/**
 * Số buổi KHÁCH MUA cho một ghi danh — cùng phép khớp với `giaTuDongDon` [28/09/2026].
 *
 * ⚠️ CỐ Ý DÙNG LẠI `giaTuDongDon`-style matching bằng cách lọc CHUNG một hàm, không viết
 * phép khớp thứ hai. Hai bản khớp là hai cách lệch: ngày ai đó sửa luật cầu nối
 * (`leadChildId` + `courseId`) ở một nơi, ghi danh sẽ lấy GIÁ của dòng này và SỐ BUỔI của
 * dòng kia — và cả hai con số đều hợp lệ nên không lỗi nào báo.
 *
 * `null` = mua đủ khoá, hoặc không khớp được dòng nào (mơ hồ ⇒ không đoán).
 */
export function soBuoiChoGhiDanh(
  dong: readonly DongDonChoGhiDanh[],
  khoa: KhoaTraGia,
): number | null {
  const d = dongKhop(dong, khoa);
  if (!d) return null;
  const n = d.soBuoi;
  if (n === null || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function listPriceChoGhiDanh(
  dong: readonly DongDonChoGhiDanh[],
  khoa: KhoaTraGia,
  giaKhoa: number,
): number {
  return giaTuDongDon(dong, khoa) ?? giaKhoa;
}
