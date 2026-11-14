// Phần TẢI của hộp xếp case — KHÔNG phải component, KHÔNG "use client": trang server (/hoc-bu?xep=…) gọi nó để dựng SẴN hộp đã mở (13/11/2026, Sale bấm "Xếp học bù" từ
// màn Yêu cầu phụ huynh), còn nút "Xếp case" ở trình duyệt vẫn gọi đúng hàm này. Chỉ đi qua các Server Action (kiểm quyền + phạm vi nằm ở đó).
import type { GvTrongCa } from "@/lib/hoc-bu/case-db";
import type { TrucTrung } from "./hoi-truc";
import { layGvChoCaseAction, layTrucTrungAction, layLuaChonCaseAction, type LuaChonCase } from "../_actions";

export const GIO_MAC_DINH = { batDau: "18:00", ketThuc: "19:30" };

export type MoHopXep = {
  needIds: string[];
  luaChon: LuaChonCase;
  gvBanDau: KetQuaGv;
};

/** `goiY` (GĐ5 tự xếp, công tắc theo cơ sở): null = tắt; `userId` null = không ai trực ⇒ chọn tay (QLCS được báo). */
export type KetQuaGv =
  | { ds: GvTrongCa[]; lyDoRong: string | null; goiY: { userId: string | null; cau: string | null } | null; trucGoiY?: { truc: TrucTrung | null; coTheQuyet: boolean } }
  | { loi: string };

/**
 * Tải MỌI THỨ hộp cần — gọi từ HANDLER của nút "Xếp case" (không `useEffect`, luật repo): lựa
 * chọn case + danh sách GV trong ca cho ngày/giờ mặc định. Lỗi mạng ⇒ trả kết quả lỗi, không ném.
 */
export async function taiHopXep(needIds: string[]): Promise<MoHopXep> {
  try {
    const luaChon = await layLuaChonCaseAction(needIds);
    if (!luaChon.ok) return { needIds, luaChon, gvBanDau: { loi: luaChon.error } };
    const gv = await layGvChoCaseAction({
      needIds,
      ymd: luaChon.homNay,
      startTime: GIO_MAC_DINH.batDau,
      endTime: GIO_MAC_DINH.ketThuc,
    });
    if (!gv.ok) return { needIds, luaChon, gvBanDau: { loi: gv.error } };
    // Người tự xếp được chọn sẵn ⇒ hỏi "trực trùng" NGAY lúc mở hộp (như khi bấm chọn tay) — không dùng effect.
    const tc = gv.goiY?.userId
      ? await layTrucTrungAction({ needIds, teacherId: gv.goiY.userId, ymd: luaChon.homNay, startTime: GIO_MAC_DINH.batDau, endTime: GIO_MAC_DINH.ketThuc })
      : null;
    return { needIds, luaChon, gvBanDau: { ds: gv.ds, lyDoRong: gv.lyDoRong, goiY: gv.goiY, trucGoiY: tc?.ok ? { truc: tc.truc, coTheQuyet: tc.coTheQuyet } : undefined } };
  } catch {
    const loi = "Không tải được lựa chọn case lúc này — thử lại sau ít phút.";
    return { needIds, luaChon: { ok: false, error: loi }, gvBanDau: { loi } };
  }
}
