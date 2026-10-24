import { z } from "zod";
import { canonicalPhone } from "@/lib/phone";

/**
 * AUTH-SĐT P1 — field SĐT dùng chung cho MỌI schema.
 *
 * Điểm mấu chốt: đây là `.transform()` chứ không phải `.regex()`. Trước đây 5 bản
 * sao regex `PHONE_VN` **từ chối** mọi chuỗi có khoảng trắng/dấu chấm — trong khi
 * người dùng thật gõ `"0905 123 456"` suốt. Client bắn lên, server trả 400, và
 * client **nuốt lỗi bằng `console.error`** ⇒ lead bốc hơi, không ai biết.
 * Chuẩn hoá thay vì từ chối làm lỗi đó biến mất tận gốc, đồng thời bảo đảm mọi
 * đường ghi đều cho ra cùng một dạng `84XXXXXXXXX`.
 *
 * Trả về canonical `84XXXXXXXXX`, KHÔNG phải chuỗi người dùng gõ.
 */
export const phoneVn = z
  .string()
  .transform((v, ctx) => {
    const c = canonicalPhone(v);
    if (!c) {
      ctx.addIssue({
        code: "custom",
        message: "SĐT không hợp lệ (VD: 0912345678)",
      });
      return z.NEVER;
    }
    return c;
  });

/** Bản optional: rỗng/undefined → null, có giá trị thì phải hợp lệ. */
export const phoneVnNullable = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    const raw = (v ?? "").trim();
    if (!raw) return null;
    const c = canonicalPhone(raw);
    if (!c) {
      ctx.addIssue({ code: "custom", message: "SĐT không hợp lệ (VD: 0912345678)" });
      return z.NEVER;
    }
    return c;
  });
