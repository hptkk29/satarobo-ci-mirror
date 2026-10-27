// EL-07 (C23) — cấm `NextResponse.json(...)` TRẦN trong route API của module đào tạo
// nội bộ. Mọi route phải đi qua envelope chuẩn ở `lib/api/response.ts`.
//
// Vì sao cần một plugin thay vì một dòng trong tài liệu: `lib/api/response.ts` đã tồn
// tại (1.428 byte) với ĐÚNG 0 consumer trên toàn repo, trong khi 69 route đang chạy ba
// hình dạng lỗi khác nhau. Một chuẩn không có máy cưỡng chế thì chết trong hai sprint —
// đó chính là điều đã xảy ra với file đó. Repo giữ luật bằng ESLint/test/workflow, nên
// luật này cũng phải nằm ở đó.
//
// PHẠM VI HẸP CÓ CHỦ ĐÍCH: chỉ `app/api/elearning/**` và `app/api/cron/elearning-*/**`.
// KHÔNG áp cho 69 route cũ — sửa chúng là việc riêng, không phải việc của PR nền, và
// bắt cả repo tuân một chuẩn chưa ai dùng sẽ khiến PR này không merge được.
//
// Heuristic AST: bắt CallExpression có callee là MemberExpression `NextResponse.json`
// (kể cả computed literal `NextResponse["json"]`). KHÔNG bắt `new NextResponse(...)`,
// `NextResponse.redirect`, `NextResponse.next` — ba cái đó hợp lệ và envelope không áp.

/** @type {import('eslint').Rule.RuleModule} */
const noBareNextResponse = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Route API e-learning phải trả envelope chuẩn qua lib/api/response.ts, không dùng NextResponse.json trần",
    },
    schema: [],
    messages: {
      bare:
        "❌ EL-07/C23: KHÔNG dùng `NextResponse.json()` trần trong route e-learning. " +
        "Dùng `ok(data, meta?)` / `fail(code, message, opts?)` từ `@/lib/api/response` — " +
        "envelope chuẩn `{ok, data, meta}` / `{ok:false, error:{code, message, field?, requestId}}`. " +
        "Lý do: người dùng báo lỗi mà không có `requestId` thì không nối được với log server.",
    },
  },

  create(context) {
    /** `NextResponse.json` hoặc `NextResponse["json"]` */
    function laNextResponseJson(callee) {
      if (!callee || callee.type !== "MemberExpression") return false;
      const obj = callee.object;
      if (!obj || obj.type !== "Identifier" || obj.name !== "NextResponse") return false;
      const prop = callee.property;
      if (!callee.computed) return prop.type === "Identifier" && prop.name === "json";
      return prop.type === "Literal" && prop.value === "json";
    }

    return {
      CallExpression(node) {
        if (laNextResponseJson(node.callee)) {
          context.report({ node: node.callee, messageId: "bare" });
        }
      },
    };
  },
};

export default {
  rules: { "no-bare-next-response": noBareNextResponse },
};
