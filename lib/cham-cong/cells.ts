// lib/cham-cong/cells.ts — Sửa MỘT ô lưới tháng (MANUAL / SWAP / LEAVE): huỷ ca ACTIVE cũ, tạo ca
// mới đã resolve nơi làm, xếp hàng tính lại, trả before/after để thông báo (T-07).
// Không "use server" — action ở app/ gọi sau khi đã kiểm quyền theo cơ sở.
//
// T04 (07/10/2026): đây KHÔNG CÒN là nơi ghi. Mọi đường ghi ô đi qua `chayLenhO` (`ghi-o.ts`) — một khoá, một
// transaction, một bộ luật bảo vệ nguồn, một cổng kỳ chốt. File này chỉ giữ chữ ký cũ cho các nơi gọi một ô
// (duyệt đơn, sửa tay) và dịch kết quả sang `{ before, after, changed, error }` mà họ đang dùng.
import type { Prisma } from "@prisma/client";
import type { CenterMap } from "./place";
import { chayLenhO } from "./ghi-o";
import { CAU_LY_DO_BO_QUA, type LyDoBoQua } from "./ghi-o-luat";

export type SetCellResult = {
  before: { id: string; templateCode: string; centerId: string; source: string } | null;
  after: { id: string; templateCode: string; centerId: string } | null;
  changed: boolean;
  error?: string;
};

/** Câu lỗi cho người sửa tay / duyệt đơn — giữ nguyên chữ của các câu cũ ở những chỗ đã có người đọc. */
export function loiCuaLyDo(lyDo: LyDoBoQua, p: { code: string | null; homeUnit: string }): string {
  switch (lyDo) {
    case "KHONG_QUYEN_CO_SO_CU":
      return "Không có quyền sửa ca ở cơ sở này";
    case "KHONG_QUYEN_CO_SO_MOI":
      return "Không có quyền xếp ca ở cơ sở này";
    case "MA_KHONG_CO":
      return `Mã ca "${p.code}" không có trong danh mục`;
    case "CO_SO_LA":
      return `Khối "${p.homeUnit}" không ánh xạ được sang cơ sở nào — không xếp ca được`;
    case "KY_DA_CHOT":
      return "Ô nằm trong kỳ công đã CHỐT SỔ — không sửa trực tiếp. Cần sửa thật thì cấp Hội sở mở lại kỳ trước.";
    default:
      return `Không ghi được ô: ${CAU_LY_DO_BO_QUA[lyDo]}`;
  }
}

export async function setAssignmentCell(opts: {
  userId: string;
  workDate: Date;
  /** null = xoá ca (ô trống). */
  code: string | null;
  /** Khối chịu công khi mã không tự nói ("CS1"/"CS2"/"HO"). */
  homeUnit: string;
  centerMap: CenterMap;
  source: "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";
  sourceRequestId?: string | null;
  note?: string | null;
  actorUserId: string;
  /** Quyền theo cơ sở — kiểm CẢ ca cũ lẫn ca mới. */
  canWriteCenter: (centerId: string) => boolean;
  /**
   * Vượt cổng kỳ chốt. BẮT BUỘC khai (luật 7): sửa tay luôn `false`; duyệt đơn truyền đúng cờ mà action đã kiểm quyền
   * vượt cấp Hội sở.
   */
  boQuaKyDaChot: boolean;
  tx?: Prisma.TransactionClient;
}): Promise<SetCellResult> {
  const { ketQua } = await chayLenhO({
    ctx: {
      centerMap: opts.centerMap,
      canWriteCenter: opts.canWriteCenter,
      actorUserId: opts.actorUserId,
      homNay: null, // nguồn MANUAL/SWAP/LEAVE/HOLIDAY không có cổng quá khứ
      ghiDeNhapTay: false, // vô nghĩa với các nguồn này (chúng đè mọi nguồn)
      boQuaKyDaChot: opts.boQuaKyDaChot,
    },
    lenhs: [
      {
        userId: opts.userId,
        workDate: opts.workDate,
        code: opts.code,
        homeUnit: opts.homeUnit,
        source: opts.source,
        sourceRequestId: opts.sourceRequestId,
        note: opts.note,
      },
    ],
    ghiThat: true,
    tx: opts.tx,
  });
  const k = ketQua[0]!;
  // `id` (đợt 11 đơn từ): huỷ đơn đã duyệt khôi phục ĐÚNG ô này — không đoán theo mã ca.
  const before = k.truoc ? { id: k.truoc.id, templateCode: k.truoc.templateCode, centerId: k.truoc.centerId, source: k.truoc.source } : null;
  if (k.ket === "BO_QUA") return { before, after: null, changed: false, error: loiCuaLyDo(k.lyDo!, { code: opts.code, homeUnit: opts.homeUnit }) };
  if (k.ket === "GIU") return { before, after: k.sau, changed: false };
  return { before, after: k.sau, changed: true };
}
