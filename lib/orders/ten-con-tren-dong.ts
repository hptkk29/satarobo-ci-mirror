// lib/orders/ten-con-tren-dong.ts — "DÒNG NÀY LÀ CỦA BÉ NÀO". THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỆP NÀY TỒN TẠI [25/09/2026]
//
// Chủ dự án, nhìn ô "Giải trình giảm giá" trên thẻ duyệt đơn:
//   *"giải trình như thế này thì 2 con học cùng khoá thì sao biết là đang giảm đơn cho
//    con nào?"*
//
// Không biết được. Toàn bộ tính năng "công nợ theo con" gắn nhãn dòng bằng
// `OrderItem.itemName`, và trên đường tạo đơn chính (`/orders/new`) cột đó là **tên KHOÁ
// HỌC** (`order-create-form.tsx` gán `itemName: c?.name`). Hai con cùng khoá ⇒ hai dòng có
// nhãn GIỐNG HỆT NHAU, ở tất cả 96 điểm tiêu thụ / 26 tệp: bảng công nợ, bảng chia đợt,
// nhãn nút, 13 aria-label, câu lỗi của các cổng tiền, và sổ audit.
//
// ⚠️ **KHÔNG rơi về `itemName` khi không biết tên bé.** Cột ấy mang HAI nghĩa trái ngược
// tuỳ đường tạo dòng, đo được:
//   · `/orders/new`  → tên KHOÁ  (`order-create-form.tsx:430`)
//   · "Thêm con vào đơn" → tên BÉ (`them-con-dialog.tsx:131`, ô nhãn "Tên con *")
//   · `bulk-convert` → `"<khoá> — <tên bé>"`
//   · `doi-khoa-db`  → chép nguyên tên khoá CŨ
// Một cột, bốn khuôn, không cờ nào phân biệt. Rơi về nó là tái sinh đúng con bug đang vá —
// và tệ hơn, nó làm con bug TÀNG HÌNH, vì màn hình sẽ in ra một cái tên trông như tên bé.
// Không biết thì trả `null`, rồi màn hình NÓI THẲNG là chưa gắn bé (luật 12: nhãn phải nói
// thật). Một ô trống trung thực rẻ hơn một cái tên sai.

/** Danh tính con ĐỌC ĐƯỢC từ một dòng đơn. Người gọi nạp từ DB. */
export type DanhTinhCon = {
  /**
   * Tên học viên THẬT của dòng — `OrderItem.student.name`, hoặc
   * `OrderItem.enrollment.student.name` khi dòng đã có ghi danh.
   *
   * `null` là ca THƯỜNG, không phải ca biên: `convert-lead-v2` tự khai *"đơn lập từ
   * `/orders/new?leadId=…` có `OrderItem.studentId` = NULL ở mọi dòng"* và không đường nào
   * backfill lại.
   */
  tenHocVien: string | null;
  /**
   * `OrderItem.metadata.leadChildId` — con khai trên lead, CHƯA có hồ sơ `Student`.
   *
   * Đây là nhánh CHIẾM ĐA SỐ, không phải đường lùi: đo `satarobo_local` —
   * **121/125 lead (96,8%)** không có `Student` nào khớp SĐT, trong khi `LeadChild` có 130
   * dòng / 104 lead.
   */
  leadChildId: string | null;
};

export type NhanCon = {
  ten: string;
  /** `hoc-vien` = có hồ sơ `Student` · `con-lead` = mới khai trên lead, chưa chốt. */
  nguon: "hoc-vien" | "con-lead";
};

/**
 * Tên bé của một dòng đơn, hoặc `null` khi dòng chưa gắn bé nào.
 *
 * Thứ tự ưu tiên là thứ tự ĐỘ TIN CẬY, không phải thứ tự tiện tay:
 *   ① `tenHocVien` — hồ sơ `Student` thật, có khoá ngoại + index, màn chi tiết đơn đã in;
 *   ② `leadChildId` → `LeadChild.fullName` — cầu nối duy nhất cho đơn chưa chốt;
 *   ③ `null` — nói thẳng là chưa biết.
 *
 * `tenConLead` là bản đồ tra SẴN (`id → fullName`), cố ý truyền vào chứ không tra trong
 * hàm: tra từng dòng là N+1, và repo đã có mẫu gom lô ở `lib/reports/revenue-by-child.ts`.
 */
export function tenConTrenDong(
  dt: DanhTinhCon,
  tenConLead: ReadonlyMap<string, string>,
): NhanCon | null {
  const hv = dt.tenHocVien?.trim();
  if (hv) return { ten: hv, nguon: "hoc-vien" };

  const id = dt.leadChildId?.trim();
  if (id) {
    const ten = tenConLead.get(id)?.trim();
    if (ten) return { ten, nguon: "con-lead" };
  }
  return null;
}

/**
 * Một cụm chữ gọi tên dòng cho NHÃN NÚT / `aria-label` / tiêu đề hộp thoại / câu lỗi.
 *
 * Biết bé thì gọi tên bé. KHÔNG biết thì nói rõ đang nói về một DÒNG và trích tên dòng
 * trong ngoặc kép — người đọc thấy ngay đây là tên sản phẩm chứ không phải tên người.
 *
 * ⚠️ Đây là chỗ duy nhất được phép ghép hai thứ ấy lại. Viết `nhan?.ten ?? c.ten` tại chỗ
 * gọi là lặng lẽ rơi về `itemName` — đúng cái cấm ở đầu tệp.
 */
export function moTaDong(nhan: NhanCon | null, tenDong: string): string {
  return nhan ? nhan.ten : `dòng "${tenDong}"`;
}

/** Dựng bản đồ tra tên con lead từ danh sách `LeadChild` đã nạp theo lô. */
export function banDoTenConLead(
  con: readonly { id: string; fullName: string }[],
): Map<string, string> {
  return new Map(con.map((c) => [c.id, c.fullName]));
}
