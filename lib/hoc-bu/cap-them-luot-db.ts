// lib/hoc-bu/cap-them-luot-db.ts — phần GHI của "QLCS điều chỉnh lượt học bù: cấp thêm / giảm" (22/10/2026). Luật thuần ở `cap-them-luot.ts`.
//
// Điểm vào là một DÒNG CẦN BÙ đọc qua `scopedDb` (như `layBienLaiLuotAction`): `MakeupCreditAccount` không mang `centerId` nên sổ tự nó KHÔNG được scope —
// phạm vi cơ sở của người điều chỉnh được kiểm ở câu đọc dòng cần bù, và dòng ngoài phạm vi hiện như không tồn tại. Từ dòng đó lấy (học viên, khoá, lớp) cho sổ.
//
// Phép ghi sổ đi qua `dieuChinhLuot` (NƠI DUY NHẤT ghi sổ lượt) trong giao dịch của hàm này; nhật ký ghi CÙNG giao dịch. Chạy lại cùng mã lần điều chỉnh thì
// KHÔNG ghi lần hai — bấm đúp không cấp / giảm hai lần. Hàm này CHỈ ĐỌC sổ để nhận ra lần chạy lại; mọi phép ghi nằm ở `so-luot.ts`.
import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { kiemCapThemLuot, lyDoCapThem, nguonCapThem } from "@/lib/hoc-bu/cap-them-luot";
import { dieuChinhLuot } from "@/lib/hoc-bu/so-luot";

export type KetQuaCapLuot = {
  /** `false` ⇒ mã lần này đã được xử lý trước đó (bấm đúp / gửi lại): sổ KHÔNG đổi. */
  daDoi: boolean;
  /** Mức ĐÃ áp thật (có dấu). Chiều giảm có thể ít hơn yêu cầu: lượt đang giữ chỗ / đã dùng không rút lại được. */
  apThucTe: number;
};

/**
 * Điều chỉnh lượt học bù của học viên ứng với dòng cần bù `needId`: `delta` > 0 cấp thêm, < 0 giảm. Người gọi PHẢI đã kiểm quyền `makeup:waive` (quyết định về quyền
 * lợi học viên của QLCS). Cộng dồn: mỗi lần là một bút toán riêng (mã lần khác nhau), không sửa tổng. Giảm mà không còn lượt trống nào để rút ⇒ từ chối bằng câu nói rõ.
 */
export async function capThemLuot(
  actor: NguoiHocBu,
  p: { needId: string; delta: number; lyDo: string; maLanCap: string; ten: string },
): Promise<KetQuaCapLuot> {
  const sai = kiemCapThemLuot({ delta: p.delta, lyDo: p.lyDo, maLanCap: p.maLanCap });
  if (sai) throw new LoiHocBu(sai);

  const [d] = await docDongTheoId(scopedDb(actor), [p.needId], actor.chiCuaSale);
  if (!d) throw new LoiHocBu("Không tìm thấy buổi cần bù — tải lại trang");

  const nguon = nguonCapThem(p.maLanCap);
  const daCoLanNay = (tx: Pick<typeof db, "makeupCreditEntry">) =>
    tx.makeupCreditEntry.findFirst({
      where: { idemKey: `ADJUSTMENT:${nguon}`, account: { studentId: d.studentId, courseId: d.courseId } },
      select: { id: true },
    });

  return db.$transaction(async (tx) => {
    if (await daCoLanNay(tx)) return { daDoi: false, apThucTe: 0 };
    const ap = await dieuChinhLuot(tx, {
      studentId: d.studentId,
      courseId: d.courseId,
      classId: d.classId,
      delta: p.delta,
      nguon,
      lyDo: lyDoCapThem(p.delta, p.lyDo),
      actorId: actor.userId,
      makeupNeedId: d.id,
    });
    if (ap === 0) {
      // Hai nguyên nhân: lần chạy lại thắng cuộc đua (bút toán vừa được người khác ghi) — không phải lỗi; hoặc chiều giảm không còn lượt trống để rút.
      if (await daCoLanNay(tx)) return { daDoi: false, apThucTe: 0 };
      throw new LoiHocBu("Học viên không còn lượt trống để giảm — lượt đang giữ chỗ trong case hoặc đã dùng thì không rút lại được");
    }
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupNeed",
      entityId: d.id,
      action: p.delta > 0 ? "hoc-bu.cap-them-luot" : "hoc-bu.giam-luot",
      newValues: { studentId: d.studentId, courseId: d.courseId, thayDoi: ap, yeuCau: p.delta },
      reason: p.lyDo.trim(),
    });
    return { daDoi: true, apThucTe: ap };
  });
}
