// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/disc-gia-dinh.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * HẰNG SỐ CỦA SỔ GIA ĐÌNH — đơn vị dữ liệu đổi từ MỘT BÀI sang MỘT GIA ĐÌNH
 * (quyết định 27/08/2026, ADR-007 sẽ viết).
 *
 * Mọi con số quyết định hình dạng MÃ MỜI nằm ở đây, không hardcode trong code
 * (rule 4 của `.claude/rules/module-boundaries.md`).
 *
 * Thuộc TẦNG LÕI: không React, không DOM.
 *
 * 🔴 `config/` đi thẳng ra bundle công khai (ràng buộc R4) — cấm đặt họ tên, tên cơ sở,
 * số điện thoại vào file này.
 */

/* ── Vai trong nhà ───────────────────────────────────────────────────────── */

/**
 * Vai của một thành viên trong sổ. Thứ tự CỐ ĐỊNH VĨNH VIỄN — chỉ số của mảng này được
 * nhúng thẳng vào mã mời, nên chèn vào giữa là làm hỏng mọi mã đã phát ra ngoài.
 * Thêm vai mới thì THÊM VÀO CUỐI.
 *
 * Đúng 8 mục vì mã mời dành cho vai 3 bit. Cần mục thứ 9 thì phải nâng `PHIEN_BAN_MA`
 * và nới trường vai — xem `modules/core/gia-dinh/ma-moi.ts`.
 */
export const VAI_GIA_DINH = [
  "con",
  "me",
  "bo",
  "ba",
  "ong",
  "anh-chi-em",
  "nguoi-than",
  "khac",
] as const;

export type VaiGiaDinh = (typeof VAI_GIA_DINH)[number];

/**
 * VAI NÀO CÒN ĐANG ĐI HỌC ⇒ mới hỏi bậc học (V1.2).
 *
 * 🔴 Bố · mẹ · ông · bà · người thân · khác thì KHÔNG hỏi lớp. Trước V1.2 form hỏi lớp
 * cho mọi vai, nhãn ghi *"Lớp (nếu đang đi học)"* — và vì bố mẹ để trống, `ThanhVien.lop`
 * của họ là `undefined`, khiến `boDeCuaThanhVien()` trả `null` rồi đá họ về màn hỏi lại.
 * Nói cách khác: một ô thừa trên form đã chặn nguyên nhóm người lớn khỏi sản phẩm.
 *
 * `anh-chi-em` NẰM TRONG danh sách này: anh chị em trong nhà gần như luôn còn đi học, và
 * `laTreEm()` bên dưới vốn đã suy "là trẻ em" từ chính việc có lớp. Đoán sai thì lệch về
 * phía hỏi thừa một ô — rẻ hơn nhiều so với việc khoá một người khỏi bài của họ.
 */
const VAI_DANG_DI_HOC: readonly VaiGiaDinh[] = ["con", "anh-chi-em"];

/** Vai này có được hỏi bậc học không. */
export function coHoiLop(vai: VaiGiaDinh): boolean {
  return VAI_DANG_DI_HOC.includes(vai);
}

/** Chữ hiển thị cho từng vai. Chữ hiển thị gom về `config/`, không gõ thẳng vào component. */
export const CHU_VAI: Readonly<Record<VaiGiaDinh, string>> = {
  con: "Con",
  me: "Mẹ",
  bo: "Bố",
  ba: "Bà",
  ong: "Ông",
  "anh-chi-em": "Anh / chị / em",
  "nguoi-than": "Người thân",
  khac: "Khác",
};

/* ── Mã mời ──────────────────────────────────────────────────────────────── */

/**
 * Số ngày một mã mời còn dùng được, tính từ ngày phát.
 *
 * Vì sao có hạn: mã mời là một hồ sơ DISC đi ra khỏi máy. Không đặt hạn thì nó trôi nổi
 * mãi trong tin nhắn, ảnh chụp màn hình, nhóm Zalo — và sáu tháng sau vẫn dựng lại được
 * hồ sơ của một đứa trẻ. Hạn ngắn là hàng rào rẻ nhất cho việc đó.
 */
export const HAN_MA_MOI_NGAY = 7;

/**
 * Mốc đếm ngày của mã mời (UTC). Ngày phát được nhúng dưới dạng "số ngày kể từ mốc này",
 * gói trong 12 bit ⇒ đủ 4.096 ngày, tức là tới khoảng năm 2037.
 *
 * 🔴 Đổi mốc này là làm hỏng mọi mã đã phát. Hết dư địa thì nâng `PHIEN_BAN_MA`.
 */
export const MOC_NGAY_MA = "2026-01-01";

/**
 * Bảng chữ Crockford Base32 — CỐ Ý bỏ `I`, `L`, `O`, `U`.
 *
 * `I`/`L` lẫn với `1`, `O` lẫn với `0`, còn `U` bị bỏ để mã không vô tình tạo ra từ tục.
 * Mã mời được người ta ĐỌC CHO NHAU QUA ĐIỆN THOẠI, nên bỏ ký tự dễ nhầm đáng giá hơn
 * là nhét thêm bit.
 */
export const BANG_CHU_MA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Cỡ nhóm khi hiện mã cho người đọc: `XXXXX-XXXXX-XXXX`. Chỉ để nhìn, không vào phép tính. */
export const CO_NHOM_MA = 5;

/* ── Hạn mức lưu trữ ─────────────────────────────────────────────────────── */

/**
 * Mỗi thành viên giữ tối đa bấy nhiêu bài.
 *
 * Vì sao là 2: đủ để so *"Bin hồi tháng 3 ↔ Bin bây giờ"* — đúng thứ `13.2` dựng ra — và
 * đủ ít để thẻ thành viên không biến thành một danh sách dài. Ba bài trở lên thì cái so
 * sánh mất ý nghĩa: hai mốc thì là một thay đổi, năm mốc thì là một biểu đồ, và biểu đồ
 * đòi một loại nội dung khác hẳn mà sản phẩm này chưa có.
 */
export const GIOI_HAN_BAI_MOI_NGUOI = 2;

/** Số thư mục phân tích cả nhà giữ lại trên máy. */
export const GIOI_HAN_THU_MUC = 5;

/* ── Phân tích cả nhà (14.2) ─────────────────────────────────────────────── */

/**
 * Số thành viên tối đa đưa vào một lần phân tích.
 *
 * Không phải giới hạn kỹ thuật — là giới hạn ĐỌC ĐƯỢC. 6 người là 30 lát cắt có hướng;
 * hơn nữa thì bản tổng hợp dài tới mức không ai đọc hết, và một bản không ai đọc thì không
 * khác gì không có.
 */
export const SO_THANH_VIEN_TOI_DA = 6;

/**
 * Số trục lệch được nói tới trong MỖI lát cắt, theo số người trong nhà.
 *
 * 🔴 Con số này giảm khi nhà đông lên, và đó là chủ ý. Nhà 5 người với 2 trục mỗi cặp là
 * 120 đoạn văn — dài hơn cả một chương sách. Nói ít mà trúng vẫn là luật, và luật đó càng
 * quan trọng khi có nhiều thứ để nói.
 */
export function soTrucTheoN(soNguoi: number): number {
  return soNguoi >= 4 ? 1 : 2;
}

/**
 * Người này có phải TRẺ EM không — quyết định THẾ QUYỀN của mỗi lát cắt (14.2).
 *
 * 🔴 Suy từ hai dấu hiệu ĐÃ CÓ, không hỏi thêm một câu nào: vai là "con", hoặc người này
 * đang học phổ thông (có lớp). Hỏi thêm "cháu bao nhiêu tuổi" chỉ để phân thế quyền là
 * thu thêm dữ liệu cá nhân của trẻ cho một việc đã có cách trả lời.
 *
 * Đoán sai thì lệch về phía nào? Về phía coi là NGƯỜI LỚN — và đó là chủ ý: nhầm một đứa
 * trẻ thành người lớn thì nó đọc phải câu hơi già; nhầm một người lớn thành trẻ con thì
 * họ đọc phải câu dạy dỗ. Cái sau khó chịu hơn nhiều.
 */
export function laTreEm(vaiTro: string, lop?: string): boolean {
  return vaiTro === "con" || Boolean(lop);
}
