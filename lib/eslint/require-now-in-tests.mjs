// Ép test chốt `now` khi gọi hàm nhạy-thời-gian.
//
// ══ Vì sao cần MÁY cưỡng chế, không phải một dòng tài liệu ══
//
// Sự cố 13/09/2026. `tests/cham-cong/requests.spec.ts > LEAVE 2 ngày duyệt` xin nghỉ cho
// 11–12/09/2026 nhưng KHÔNG truyền `now`, nên `submitAttendanceRequest` rơi về
// `input.now ?? new Date()`. Một ca TRƯỚC ĐÓ trong cùng file đặt `NGHI_PHEP.noticeDays = 1`,
// nên cổng `isSubmittedLate` so `fromDate` với HÔM NAY THẬT.
//
// Kết quả đo trên CÙNG một commit (`main` 507ff13b):
//
//     CI ngày 10/09  →  XANH
//     rerun 13/09    →  ĐỎ
//
// Ca xanh suốt 4 ngày rồi đỏ MÃI MÃI. Khác bug múi giờ ở một điểm quan trọng: bom ngày cứng
// nổ MỘT CHIỀU — không có cửa sổ giờ để đợi nó tự xanh lại.
//
// Và nó ăn mòn cổng: một bộ test đỏ vì lý do chẳng liên quan mã thì người ta học cách bỏ
// qua nó, rồi bỏ qua luôn lần nó đỏ THẬT.
//
// ══ Luật ══
//
// Trong `tests/**` và `**/*.test.ts`: gọi hàm trong `HAM_NHAY_THOI_GIAN` thì đối số object
// PHẢI có thuộc tính `now` khai TƯỜNG MINH — `now` (shorthand) hoặc `now: <gì đó>`.
//
// `...spread` KHÔNG tính là đã khai, dù object được spread có chứa `now`. Cố ý: mục đích của
// luật là người viết ca NHÌN THẤY mình đang chốt mốc thời gian nào. Một `now` ẩn trong
// `...base` ở đầu file cách đó 200 dòng thì không đạt mục đích đó.
//
// Hàm nhận `now?: Date` là THIẾT KẾ ĐÚNG — repo có ~30 hàm như vậy. Lỗi nằm ở test không
// dùng nó. Luật này không ép sửa hàm nào.

/**
 * Hàm sản phẩm có `now?: Date` mặc định `?? new Date()` VÀ có cổng so ngày với hiện tại.
 *
 * Thêm tên vào đây khi một hàm mới có hình dạng đó. Đừng thêm hàm chỉ vì nó nhận `now` —
 * điều kiện là nó ĐỐI CHIẾU `now` với dữ liệu ngày do caller truyền vào (hạn báo trước,
 * cửa sổ sửa, hết hiệu lực). Hàm chỉ dùng `now` để đóng dấu `createdAt` thì không cần.
 */
export const HAM_NHAY_THOI_GIAN = new Set([
  // lib/cham-cong/requests.ts — cổng `isSubmittedLate` so `fromDate` (do caller truyền)
  // với `now`. Đây là hình dạng đã nổ.
  "submitAttendanceRequest",
  "decideRequest",

  // lib/cham-cong/period.ts — `if (to.getTime() > now.getTime()) → "Kỳ chưa kết thúc"`.
  // `to` suy từ `periodKey` DO CALLER TRUYỀN ⇒ đúng tiêu chí ở trên: đối chiếu `now` với dữ
  // liệu ngày của caller, không phải đóng dấu. Đo 13/09/2026 khi vá `period.spec.ts`.
  //
  // ⚠️ CỐ Ý KHÔNG thêm hai hàm cùng file, dù chúng cũng nhận `now?: Date`:
  //   · `reopenPeriod`    — chỉ `reopenedAt: now`, thuần đóng dấu;
  //   · `setDayOverride`  — nhận `now?: Date` mà **KHÔNG DÙNG Ở ĐÂU CẢ** (tham số chết).
  // Thêm chúng vào là bắt người viết test chốt một mốc chẳng ảnh hưởng gì, và luật mất uy
  // tín đúng kiểu "cổng kêu ở chỗ không cần" — rồi người ta học cách tắt nó.
  "lockPeriod",
]);

// ══ Đã cân nhắc và CỐ Ý BỎ RA: `recordTimeLog` ══
//
// Nó cũng có `now ?? new Date()` và cũng đã nổ một lần (bug múi giờ, PR #235). Nhưng đo thì
// cả 5 lời gọi của nó trong `tests/cham-cong/timelog.spec.ts` **không truyền ngày nào cả** —
// chúng cố ý dựa vào "hôm nay" và khẳng định `CHAM_NGOAI_LICH` ("chưa xếp ca hôm nay").
// Không có ngày cứng thì không có gì hoá quá khứ được, nên bắt chúng là **5 dương tính giả**.
//
// Và rule ồn thì bị vô hiệu hoá — bằng `eslint-disable`, hoặc bằng việc người ta thôi đọc nó.
// Luật này hẹp có chủ đích: chỉ bắt hình dạng ĐÃ THẬT SỰ gây đỏ.
//
// Ca `recordTimeLog` nguy hiểm mang hình dạng KHÁC: test tự dựng `workDate` bằng
// `Date.UTC(...)` trong khi hàm chốt bằng `vnDateOnly(now)` — đó là lệch MÚI GIỜ, không phải
// thiếu `now`, và đã vá ở #235. Bắt họ đó cần rule khác (so cách dựng ngày), không phải rule này.

// ══ Đã soát kỹ và CỐ Ý BỎ RA: `buildActor` (lib/auth/actor.ts:217) ══
//
// Nó ĐẠT tiêu chí trên giấy — cổng lọc vai còn hiệu lực đối chiếu `now` với ngày do caller
// truyền:
//
//     r.effectiveFrom <= now && (r.effectiveTo == null || r.effectiveTo >= now)
//
// với `effectiveFrom`/`effectiveTo` nằm trên `input.rows`. Soát bằng 8 tác nhân + phản biện
// 2 góc soi: 1 hàm sống sót, 0 bị bác.
//
// Nhưng ĐO trước khi thêm (13/09/2026) thì thấy nó sinh **14 vi phạm, 0 bom thật**: ba file
// `lib/**` chiếm 12/14 đều dựng hàng vai là `effectiveFrom: new Date("2000-01-01")` +
// `effectiveTo: null` — cổng KHÔNG BAO GIỜ đổi câu trả lời, an toàn vĩnh viễn.
//
// ══ Điều kiện THỨ BA mà tiêu chí hai vế ở trên còn thiếu ══
//
//     Ngày rủi ro phải NHÌN THẤY ĐƯỢC ngay tại lời gọi.
//
//   · `submitAttendanceRequest({ fromDate: d11, … })` — ngày nằm NGAY ĐÓ. Rule tĩnh đọc được
//     hình dạng, nên thiếu `now` là dấu hiệu thật.
//   · `buildActor({ rows, … })` — ngày nằm TRONG `rows`, dựng ở chỗ khác. Rule nhìn tại lời
//     gọi không có thông tin để phân biệt an toàn với nguy hiểm ⇒ 14/14 là dương tính giả.
//
// Con số ngày cũng không tự tố cáo: đo toàn repo có 11 chỗ `effectiveTo` mang ngày cứng,
// nhưng ngày QUÁ KHỨ ở đó dùng để kiểm "đã hết hiệu lực" (an toàn mãi), còn
// `effectiveFrom: 2099-01-01` dùng để kiểm "chưa tới hiệu lực" (an toàn tới 2099). Thứ phân
// biệt là KỲ VỌNG của ca — rule tĩnh không đọc được kỳ vọng.
//
// `buildActor` thuộc phần việc của lưới #2 (`.github/workflows/bom-hen-gio.yml`): chạy thật
// với đồng hồ đẩy tới tương lai thì đọc được kỳ vọng. Lưới đó đã phủ nó — 564 ca gồm `lib/**`
// xanh ở +90 ngày.

/** @type {import('eslint').Rule.RuleModule} */
const requireNow = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Test gọi hàm nhạy-thời-gian phải chốt `now` tường minh, kẻo ngày cứng hoá quá khứ và ca đỏ vĩnh viễn",
    },
    schema: [],
    messages: {
      thieuNow:
        "❌ `{{ten}}()` trong test phải chốt `now` TƯỜNG MINH. " +
        "Hàm này rơi về `new Date()` thật khi thiếu, nên ngày cứng trong ca sẽ hoá quá khứ " +
        "và ca đỏ MÃI MÃI kể từ ngày đó (sự cố 13/09/2026: xanh tới 10/09, rerun cùng commit " +
        "ngày 13/09 thì đỏ). Thêm `now: new Date(\"2026-09-09T03:00:00Z\")` — mốc nào cũng được, " +
        "miễn là CỐ ĐỊNH và hợp lý so với ngày trong ca.",
      spreadKhongTinh:
        "❌ `{{ten}}()`: `...spread` KHÔNG tính là đã chốt `now`, kể cả khi object được " +
        "spread có chứa nó. Khai `now` ngay tại lời gọi để người đọc ca thấy mốc thời gian " +
        "đang dùng, đừng để nó ẩn cách đó mấy trăm dòng.",
    },
  },

  create(context) {
    function tenHam(callee) {
      if (!callee) return null;
      if (callee.type === "Identifier") return callee.name;
      // `requests.submitAttendanceRequest(...)` · `mod.recordTimeLog(...)`
      if (callee.type === "MemberExpression" && !callee.computed && callee.property?.type === "Identifier") {
        return callee.property.name;
      }
      return null;
    }

    return {
      CallExpression(node) {
        const ten = tenHam(node.callee);
        if (!ten || !HAM_NHAY_THOI_GIAN.has(ten)) return;

        const arg = node.arguments[0];
        if (!arg || arg.type !== "ObjectExpression") return; // không phải hình dạng ta soi

        let coNow = false;
        let coSpread = false;
        for (const p of arg.properties) {
          if (p.type === "SpreadElement") {
            coSpread = true;
            continue;
          }
          if (p.type !== "Property" || p.computed) continue;
          const k = p.key;
          const ten2 = k.type === "Identifier" ? k.name : k.type === "Literal" ? k.value : null;
          if (ten2 === "now") coNow = true;
        }

        if (coNow) return;
        context.report({
          node: arg,
          messageId: coSpread ? "spreadKhongTinh" : "thieuNow",
          data: { ten },
        });
      },
    };
  },
};

export default { rules: { "require-now-in-tests": requireNow } };
