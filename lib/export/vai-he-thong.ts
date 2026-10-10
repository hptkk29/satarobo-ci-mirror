// lib/export/vai-he-thong.ts — danh sách vai CÓ THẬT, kèm tên tiếng Việt.
//
// Nằm ở `lib/` chứ không inline trong action vì `app/(admin)/**` KHÔNG được import `@/lib/db`
// trần (ESLint error, luật #4 của CLAUDE.md). Và `RoleDef` không thuộc `SCOPED_MODELS` —
// danh mục vai là của cả công ty — nên `scopedDb` không phải chỗ của nó.
//
// ⚠️ KHÔNG dùng `layVaiNhanHoaHong()` cho việc này dù nó cũng đọc `RoleDef`: hàm đó cộng
// thêm `VAI_DAC_BIET` (những "vai" giả như người giới thiệu) vốn không phải vai đăng nhập
// được, nên tích chúng vào ma trận quyền xuất là tạo ra dòng không bao giờ khớp ai.
import { db } from "@/lib/db";

export type VaiHeThong = { ma: string; ten: string };

/** Mọi vai trong `RoleDef`, xếp theo tên. Lỗi đọc ⇒ mảng rỗng (màn tự nói ra là đang rỗng). */
export async function layVaiHeThong(): Promise<VaiHeThong[]> {
  try {
    const vai = await db.roleDef.findMany({
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    });
    return vai.map((v) => ({ ma: v.code, ten: v.name?.trim() || v.code }));
  } catch {
    return [];
  }
}

/** Tập mã vai có thật — để action từ chối mã gõ sai. */
export async function maVaiCoThat(): Promise<Set<string>> {
  return new Set((await layVaiHeThong()).map((v) => v.ma));
}
