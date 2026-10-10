import "server-only";
import { db } from "@/lib/db";
import { daTungHieuLuc } from "./hieu-luc";
import type { MaApDung } from "./ap-vao-don";

// lib/khuyen-mai/chon-cho-don.ts — nạp danh sách mã khuyến mãi cho FORM TẠO ĐƠN.
//
// Tách khỏi `ap-vao-don.ts` (thuần) vì file này chạm DB. Ranh giới: ở đây CHỈ đọc và
// đổi id→mã; mọi QUYẾT ĐỊNH ("mã này dùng được cho dòng nào", "trừ bao nhiêu") nằm ở
// file thuần, để client và server cùng chạy đúng một bản.
//
// ⚠️ KHÔNG `scopedDb`: `PromotionPolicy`/`Voucher` KHÔNG có `centerId` và KHÔNG nằm
// trong `SCOPED_MODELS` — đi qua `scopedDb` chỉ là pass-through, và viết như thể nó
// đang lọc là gieo một hiểu nhầm cho người sau. Cách ly cơ sở của khuyến mãi đi bằng
// `PromotionPolicy.orgUnitIds`, và nó được áp ở `lyDoKhongDung` (hàm thuần).

/** Những gì form cần để dựng bộ chọn mã. */
export type DuLieuChonMa = {
  ma: MaApDung[];
  /** `Center.id` → MÃ OrgUnit, để client suy `phamViCoSo` từ cơ sở ĐANG CHỌN trên form. */
  maCoSoTheoCenter: Record<string, string>;
};

/**
 * Mã khuyến mãi còn đáng bày cho form tạo đơn.
 *
 * LỌC Ở ĐÂY chỉ là lọc THÔ (mã đang bật + văn bản đã từng hiệu lực): tập này nhỏ và
 * được tính MỘT LẦN ở RSC, trong khi điều kiện thật còn phụ thuộc cơ sở/khoá/tiền của
 * từng dòng — những thứ người dùng còn đang gõ. Lọc tinh nằm ở `locMaChoDong` chạy lại
 * trên mỗi phím gõ, cả ở client lẫn ở server lúc lưu.
 *
 * ⚠️ CỐ Ý GIỮ CẢ MÃ ĐÃ HẾT HẠN đã từng hiệu lực: bộ chọn cần biết chúng tồn tại để nói
 * "Ngoài thời gian hiệu lực" thay vì im lặng không bày gì. Mã CHƯA TỪNG hiệu lực (thu
 * hồi trước ngày bắt đầu) thì loại hẳn — nó không phải một ưu đãi, nó là một văn bản bị
 * rút trước khi chạy.
 */
export async function docMaChoDon(): Promise<DuLieuChonMa> {
  const [rows, donVi, coSo] = await Promise.all([
    db.voucher.findMany({
      where: { isActive: true, policyId: { not: null } },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        code: true,
        discountKind: true,
        discountPercent: true,
        discountAmount: true,
        maxDiscount: true,
        minOrderValue: true,
        quantity: true,
        usedCount: true,
        isActive: true,
        policy: {
          select: {
            documentCode: true,
            name: true,
            validFrom: true,
            validUntil: true,
            revokedAt: true,
            orgUnitIds: true,
            courseIds: true,
          },
        },
      },
    }),
    db.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
    db.center.findMany({ select: { id: true, code: true } }),
  ]);

  const maTheoOrgUnit = new Map(donVi.map((o) => [o.id, o.code]));

  const ma: MaApDung[] = [];
  for (const v of rows) {
    const p = v.policy;
    if (!p) continue;
    // Chưa từng hiệu lực (thu hồi trước ngày bắt đầu) ⇒ không phải ưu đãi, đừng bày.
    if (!daTungHieuLuc(p)) continue;

    // id → MÃ OrgUnit. FAIL CLOSED: có khai cơ sở mà không mã nào còn trên cây ⇒ LOẠI.
    // Coi nó là "toàn hệ thống" sẽ mở rộng phạm vi BLĐ không ban hành.
    const maCoSo = p.orgUnitIds
      .map((id) => maTheoOrgUnit.get(id))
      .filter((x): x is string => !!x);
    if (p.orgUnitIds.length > 0 && maCoSo.length === 0) continue;

    ma.push({
      voucherId: v.id,
      ma: v.code,
      maVanBan: p.documentCode,
      tenChuongTrinh: p.name,
      kieu: v.discountKind === "PERCENT" ? "PERCENT" : "FIXED",
      phanTram: v.discountPercent,
      soTien: v.discountAmount,
      giamToiDa: v.maxDiscount,
      donToiThieu: v.minOrderValue,
      khoaHoc: p.courseIds,
      coSo: maCoSo,
      hieuLuc: { validFrom: p.validFrom, validUntil: p.validUntil, revokedAt: p.revokedAt },
      dangBat: v.isActive,
      // Hết lượt tính LÚC ĐỌC, không có cột "đã hết" nào để lệch.
      conLuot: v.quantity == null || v.usedCount < v.quantity,
    });
  }

  return {
    maCoSoTheoCenter: Object.fromEntries(coSo.map((c) => [c.id, c.code ?? ""])),
    ma,
  };
}

/**
 * Tra MỘT mã theo id — dùng ở đường GHI (server action), nơi KHÔNG được tin con số
 * client gửi.
 *
 * Trả `null` khi mã không tồn tại / mất văn bản cha. Đường gọi phải coi `null` là TỪ
 * CHỐI, không phải "bỏ qua khuyến mãi rồi lưu tiếp" — lưu tiếp là đơn ra đúng số tiền
 * gốc trong khi sale vừa hứa khách một mức giảm.
 */
export async function docMaTheoId(ids: readonly string[]): Promise<Map<string, MaApDung>> {
  if (ids.length === 0) return new Map();
  const { ma } = await docMaChoDon();
  const theoId = new Map(ma.map((m) => [m.voucherId, m]));
  return new Map(
    ids.filter((id) => theoId.has(id)).map((id) => [id, theoId.get(id)!]),
  );
}
