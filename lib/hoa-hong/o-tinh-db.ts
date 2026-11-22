// lib/hoa-hong/o-tinh-db.ts — NẠP trạng thái của các Ô TÍNH (CHỈ ĐỌC). Hàm quyết định: `o-tinh.ts`, `dao-nguoc.ts`.
//
// Nguồn: docs/source-commission/04 §10.4 (bảng "trạng thái của một ô"), L14 (Σ ròng MỌI kind).
//
// ⚠️ Gọi TRONG transaction ghi, SAU khi đã khoá ô (`khoaO`) — L11: trạng thái ô tính ngoài khoá chỉ là bản nháp.
import type { CommissionEntryKind } from "@prisma/client";

import { khoaNguoi, type KhoaNguoi } from "./khoa-so";
import type { Khach } from "./nap-khoan";
import type { TrangThaiO } from "./o-tinh";

/** Kind mang ý nghĩa "dòng ĐẦU TIÊN của ô" — dòng gốc để dòng đảo tham chiếu. */
const KIND_GOC: ReadonlySet<CommissionEntryKind> = new Set<CommissionEntryKind>(["ORIGINAL", "LATE_ARRIVAL"]);

/**
 * Người CHỈ CÓ dòng điều chỉnh (vd `REFERRER_PARENT` vào ô nhờ `SOURCE_CORRECTION` sau khi đổi nguồn — không có ORIGINAL nào) vẫn phải có MẪU snapshot để đảo/điều chỉnh tiếp:
 * dòng điều chỉnh DƯƠNG đầu tiên của họ. Thiếu mẫu này thì một lần hoàn (hoặc đổi nguồn lần hai) sau đổi nguồn NÉM `không có dòng gốc để tham chiếu`.
 */
const KIND_MAU_DU_PHONG: ReadonlySet<CommissionEntryKind> = new Set<CommissionEntryKind>(["SOURCE_CORRECTION", "INPUT_CORRECTION"]);

/** `reasonCode` của dòng `INPUT_CORRECTION` trả lại số đã thu hồi cho một khoản HOÀN bị bác (`giai-hang-cho.ts`). Nó VÔ HIỆU HOÁ dòng REVERSAL mà nó trỏ tới (`refEntryId`). */
export const MA_KHOI_PHUC_HOAN = "KHOAN_HOAN_BI_RUT_KHOI_PHUC";

export type DongSoTomTat = {
  id: string;
  calcSlotId: string;
  entryKind: CommissionEntryKind;
  key: KhoaNguoi;
  amount: number;
  netBase: number;
  refEventId: string | null;
  periodId: string;
  createdAt: Date;
  refEntryId: string | null;
  reasonCode: string | null;
};

export type OCoDong = TrangThaiO & {
  paymentId: string;
  orderItemKey: string;
  centerId: string;
  orgUnitId: string;
  /** (vai × người) → id dòng gốc. */
  dongGoc: ReadonlyMap<KhoaNguoi, string>;
  dong: readonly DongSoTomTat[];
};

const nguoiCuaDong = (r: { roleCode: string; beneficiaryKind: "USER" | "AFFILIATE"; beneficiaryUserId: string | null; beneficiaryAffiliateId: string | null }): KhoaNguoi =>
  khoaNguoi(r.roleCode, r.beneficiaryKind, (r.beneficiaryKind === "USER" ? r.beneficiaryUserId : r.beneficiaryAffiliateId) ?? "-");

/** Hash đã được chấp nhận qua hàng chờ INPUT_DRIFT "giữ nguyên": `INPUT_DRIFT:<slot>:<hash>`. */
const hashTuKhoaDrift = (holdKey: string): string => holdKey.slice(holdKey.lastIndexOf(":") + 1);

export async function docTrangThaiO(client: Khach, slotIds: readonly string[]): Promise<Map<string, OCoDong>> {
  const ra = new Map<string, OCoDong>();
  if (slotIds.length === 0) return ra;
  const [slots, dong, drift] = await Promise.all([
    client.commissionCalcSlot.findMany({ where: { id: { in: [...slotIds] } } }),
    client.commissionTransaction.findMany({
      where: { calcSlotId: { in: [...slotIds] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        calcSlotId: true,
        entryKind: true,
        roleCode: true,
        beneficiaryKind: true,
        beneficiaryUserId: true,
        beneficiaryAffiliateId: true,
        amount: true,
        netBase: true,
        refEventId: true,
        periodId: true,
        createdAt: true,
        refEntryId: true,
        reasonCode: true,
      },
    }),
    client.commissionHold.findMany({
      where: { calcSlotId: { in: [...slotIds] }, code: "INPUT_DRIFT", status: "DISMISSED" },
      select: { calcSlotId: true, holdKey: true },
    }),
  ]);

  for (const s of slots) {
    const cua = dong.filter((d) => d.calcSlotId === s.id);
    const tomTat: DongSoTomTat[] = cua.map((d) => ({
      id: d.id,
      calcSlotId: s.id,
      entryKind: d.entryKind,
      key: nguoiCuaDong(d),
      amount: d.amount,
      netBase: d.netBase,
      refEventId: d.refEventId,
      periodId: d.periodId,
      createdAt: d.createdAt,
      refEntryId: d.refEntryId,
      reasonCode: d.reasonCode,
    }));

    const rong = new Map<KhoaNguoi, number>();
    const dongGoc = new Map<KhoaNguoi, string>();
    for (const d of tomTat) {
      rong.set(d.key, (rong.get(d.key) ?? 0) + d.amount);
      if (KIND_GOC.has(d.entryKind) && !dongGoc.has(d.key)) dongGoc.set(d.key, d.id);
    }
    // Người không có ORIGINAL/LATE_ARRIVAL: lấy dòng điều chỉnh DƯƠNG đầu tiên làm mẫu (tomTat đã sắp theo thời điểm ghi).
    for (const d of tomTat) {
      if (!dongGoc.has(d.key) && KIND_MAU_DU_PHONG.has(d.entryKind) && d.amount > 0) dongGoc.set(d.key, d.id);
    }

    // Cơ sở đã đảo: mỗi SỰ KIỆN hoàn (refEventId) tính MỘT lần — mọi dòng REVERSAL cùng sự kiện chụp cùng `netBase` (âm).
    // Sự kiện hoàn mà MỌI dòng REVERSAL của nó đã được "khôi phục" (khoản hoàn bị kế toán bác, người duyệt trả lại số đã thu hồi) thì KHÔNG còn tính là đã đảo cơ sở:
    // không loại thì cơ sở còn lại thấp hơn thật và lượt quét sau báo INPUT_DRIFT giả đòi lại đúng số vừa trả.
    const daKhoiPhuc = new Set(tomTat.filter((d) => d.entryKind === "INPUT_CORRECTION" && d.reasonCode === MA_KHOI_PHUC_HOAN && d.refEntryId !== null).map((d) => d.refEntryId!));
    const dongDaoTheoSuKien = new Map<string, DongSoTomTat[]>();
    for (const d of tomTat) if (d.entryKind === "REVERSAL" && d.refEventId !== null) dongDaoTheoSuKien.set(d.refEventId, [...(dongDaoTheoSuKien.get(d.refEventId) ?? []), d]);
    const daoTheoSuKien = new Map<string, number>();
    for (const [suKien, cacDong] of dongDaoTheoSuKien) {
      if (cacDong.every((d) => daKhoiPhuc.has(d.id))) continue;
      daoTheoSuKien.set(suKien, cacDong[0]!.netBase);
    }
    const coSoDaDao = [...daoTheoSuKien.values()].reduce((a, b) => a + b, 0); // âm
    const coSoConLai = Math.max(0, s.netBase + coSoDaDao);

    const chapNhan = new Set<string>([s.firstInputHash, s.lastMatchedHash]);
    for (const h of drift) if (h.calcSlotId === s.id) chapNhan.add(hashTuKhoaDrift(h.holdKey));

    ra.set(s.id, {
      calcSlotId: s.id,
      netBase: s.netBase,
      coSoConLai,
      rong,
      hashDaChapNhan: chapNhan,
      soLanDao: daoTheoSuKien.size,
      coKhieuNai: tomTat.some((d) => d.entryKind === "DISPUTE_ADJUSTMENT"),
      paymentId: s.paymentId,
      orderItemKey: s.orderItemKey,
      centerId: s.centerId,
      orgUnitId: s.orgUnitId,
      dongGoc,
      dong: tomTat,
    });
  }
  return ra;
}
