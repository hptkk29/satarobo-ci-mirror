"use server";

// app/(admin)/admin/nguon-hoa-hong/so/_actions.ts — Server Action MỎNG của tab Sổ: mở ngăn "Vì sao con số này" (06 §2.3).
//
// CHỈ ĐỌC. Gác quyền Ở ĐẦU HÀM bằng đúng hai khoá mà tab Sổ dùng để vẽ nút (`PAGE_GATES["/nguon-hoa-hong/so"]` =
// `commission:view-self` ∨ `commission:view-center`; luật 12 + lưới `[NHH-SO-W1]`), rồi để `docViSaoDayDu` lo phạm vi: dòng ngoài tầm nhìn trả `null`
// và action nói đúng một câu "không tìm thấy" — không lộ dòng đó có tồn tại.
//
// Cờ `hoaHong.engineBat` TẮT ⇒ màn không tồn tại (404 ở page), nên action cũng từ chối: một cửa đọc sổ còn mở khi cờ tắt là cửa không ai canh.
//
// ⚠️ File `"use server"` ⇒ CHỈ export hàm async. Kiểu ở `lib/hoa-hong/vi-sao-ket-qua.ts`.
import { z } from "zod";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { docViSaoDayDu } from "@/lib/hoa-hong/vi-sao-doc";
import type { KetQuaMoViSao } from "@/lib/hoa-hong/vi-sao-ket-qua";

const schema = z.object({ entryId: z.string().trim().min(1, "Thiếu mã dòng hoa hồng.").max(64, "Mã dòng hoa hồng không hợp lệ.") });

export async function moViSaoAction(input: unknown): Promise<KetQuaMoViSao> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  if (!(await checkAnyPermission(["commission:view-self", "commission:view-center"]))) {
    return { ok: false, error: "Bạn không có quyền xem hoa hồng." };
  }
  if (!(await laEngineHoaHongBat())) return { ok: false, error: "Sổ hoa hồng chưa được bật." };

  try {
    const actor = await resolveActor(session.user.id);
    const du = await docViSaoDayDu(actor, parsed.data.entryId);
    if (!du) return { ok: false, error: "Không tìm thấy dòng hoa hồng này." };
    return { ok: true, du };
  } catch (e) {
    if (e instanceof PermissionError) return { ok: false, error: "Bạn không có quyền xem hoa hồng." };
    throw e;
  }
}
