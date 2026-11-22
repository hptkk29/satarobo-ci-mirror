// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/muc-do.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * VỊ TRÍ VÀ CƯỜNG ĐỘ CỦA MỘT TRỤC trong hồ sơ — hàm THUẦN, thuộc TẦNG LÕI (ADR-004).
 *
 * Đây là chỗ vá lỗi gốc khiến bản báo cáo bị chê sơ sài: `layDienGiai` cũ chỉ nhận `kieu`,
 * nên hai hồ sơ D=92 và D=58 cho ra báo cáo giống nhau TỪNG BYTE. Nhưng vá bằng cách chia
 * thang cao/vừa/thấp thì lại rơi vào cái bẫy ngược — xem `NGUONG_NOI_RO` ở
 * `config/disc-nguong.ts` để biết vì sao phép đo không đỡ nổi nhiều nấc.
 *
 * 🔴 HAI LUẬT KHÔNG THƯƠNG LƯỢNG:
 *
 *  1. **Nội dung khoá theo VỊ TRÍ (thứ hạng), không theo điểm tuyệt đối.** Thứ hạng ổn
 *     định hơn hẳn: hai trục ở giữa hoán chỗ nhau thì cùng ra `"giua"` nên chữ KHÔNG đổi.
 *     Chỉ trục đầu và trục cuối mới đổi nghĩa, mà đó lại là hai trục cách xa nhau nhất.
 *
 *  2. **Cường độ (`noiRo`) chỉ được thêm/bớt ĐÚNG MỘT MỆNH ĐỀ.** Không bao giờ được dùng
 *     nó để rẽ sang một mạch văn khác. Ngưỡng đoán sai thì người dùng mất/thêm một câu —
 *     chứ không nhận một bản báo cáo khác nghĩa.
 */

import { NGUONG_NOI_RO, NGUONG_PHA } from "@/lib/disc/engine-goc/config/disc-nguong";

import type { MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

/**
 * Chỗ đứng của một trục trong hồ sơ của chính người đó.
 *
 * Cố ý chỉ có BA giá trị chứ không phải bốn: gộp hạng 2 và hạng 3 thành `"giua"` là thứ
 * làm cho kết quả ổn định trước nhiễu đo. Hai trục giữa thường chỉ cách nhau vài điểm,
 * tức là thừa sức hoán chỗ nhau chỉ vì một câu trả lời đổi một nấc.
 */
export type ViTriTruc = "noiNhat" | "giua" | "nheNhat";

/** Trục này đứng đâu trong hồ sơ. `xepHang` là mảng bốn trục đã sắp giảm dần. */
export function viTriTrongHoSo(xepHang: readonly MaTruc[], truc: MaTruc): ViTriTruc {
  const hang = xepHang.indexOf(truc);
  if (hang === 0) return "noiNhat";
  if (hang === xepHang.length - 1) return "nheNhat";
  return "giua";
}

/**
 * Trục nổi nhất có nổi ĐỦ RÕ để nói thêm một câu về cường độ không.
 *
 * Phải thoả CẢ HAI: điểm tuyệt đối đạt `NGUONG_NOI_RO`, VÀ cách trục kế ít nhất
 * `NGUONG_PHA`. Thiếu vế thứ hai thì một hồ sơ bốn trục cùng cao (người trả lời cái gì
 * cũng gật) sẽ được khen là "nhóm D nổi rất rõ" — trong khi thực chất chẳng trục nào nổi.
 */
export function noiRo(
  diem: Readonly<Record<MaTruc, number>>,
  xepHang: readonly MaTruc[],
): boolean {
  if (xepHang.length < 2) return false;
  const d1 = diem[xepHang[0]];
  const d2 = diem[xepHang[1]];
  return d1 >= NGUONG_NOI_RO && d1 - d2 >= NGUONG_PHA;
}
