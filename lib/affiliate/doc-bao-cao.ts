/**
 * lib/affiliate/doc-bao-cao.ts — ĐỌC khối «Hiệu quả» của MỘT campaign (AFF-P3 H1). Chỉ đọc. Lõi thuần (nhãn, khoảng ngày, gộp đối tác) ở `bao-cao.ts`.
 *
 * ── Phạm vi — BA tầng khác nhau, và khối phải nói thế (luật 12) ───────────────────────────────────────────────
 *  · Lượt bấm (`ReferralClick`): toàn hệ, ẩn danh, không cơ sở ⇒ `db` trần (như `doc-link`). Không IP / UA / session / host — chỉ (đối tác × kết cục) đếm bằng MỘT câu GROUP BY.
 *  · Referral + chuyển đổi (`AffiliateReferral` ∈ SCOPED_MODELS): MỌI lượt đọc qua `scopedDb(actor)`. Người cấp cơ sở chỉ thấy phần cơ sở mình; dòng `centerId = NULL` chỉ Hội sở thấy ⇒ `phamVi`
 *    cho màn in dòng «chỉ phần cơ sở của bạn». «Đã đăng ký» đọc bằng bộ lọc QUAN HỆ `lead.convertedAt` trên chính câu referral đã scope — không kéo danh sách id ra rồi tra lại.
 *  · Hoa hồng: đi qua `docSoHoaHong`'s `dungWhereSo` (CÙNG `where` với màn Sổ) ⇒ «số ở khối ≡ số ở màn Sổ cho cùng bộ lọc campaign» theo cấu tạo. KHÔNG theo khoảng ngày (xem `bao-cao.ts`).
 *
 * `quyen` BẮT BUỘC (luật 7): từng khối chỉ được TRUY VẤN khi người xem có đúng khoá của nó — dữ liệu không bao giờ rời hàm rồi mới bị giao diện giấu.
 * Không PII khách: không chọn lead, SĐT, email, tên khách; chỉ ĐẾM. Tên đối tác = tên + mã (không SĐT/email đối tác).
 */
import type { CommissionPayoutStatus } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { gomSoTheoDoiTacHuong, gomSoTheoTrangThaiChi, phamViNguoiXem } from "@/lib/hoa-hong/doc-so";

import { gopTheoDoiTac, tomTatLuotBam, type DongDoiTac, type KhoangNgay, type QuyenBaoCao, type TomTatLuotBam } from "./bao-cao";
import { demRong, tongCacTrangThai, type DemTheoTrangThaiReferral, type PhamViReferral } from "./ghi-referral-dau-vao";

export type KhoiReferral = {
  /** Theo trạng thái, trong khoảng ngày, trong tầm nhìn cơ sở. */
  theoTrangThai: DemTheoTrangThaiReferral;
  tong: number;
  /** VALID ∧ phiếu đã chốt (`Lead.convertedAt`, chưa xoá mềm). */
  daDangKy: number;
  phamVi: PhamViReferral;
};

export type KhoiHoaHong = {
  theoTrangThai: Record<CommissionPayoutStatus, { soDong: number; tien: number }>;
  tong: { soDong: number; tien: number };
  /** Người xem thấy MỌI cơ sở (`TAT_CA`) hay chỉ phần trong tầm nhìn của mình. */
  phamVi: PhamViReferral;
};

export type BaoCaoHieuQua = {
  khoang: KhoangNgay;
  /** null = người xem không có khoá xem lượt bấm. */
  luotBam: TomTatLuotBam | null;
  referral: KhoiReferral | null;
  hoaHong: KhoiHoaHong | null;
  doiTac: { dong: DongDoiTac[]; biCat: number };
};

const KHONG_CO_TIEN: KhoiHoaHong["theoTrangThai"] = {
  ON_HOLD: { soDong: 0, tien: 0 },
  PENDING: { soDong: 0, tien: 0 },
  APPROVED: { soDong: 0, tien: 0 },
  EXPORTED: { soDong: 0, tien: 0 },
  PAID: { soDong: 0, tien: 0 },
};

export async function docBaoCaoHieuQua(
  actor: Actor,
  p: { campaignId: string; campaignMa: string; khoang: KhoangNgay; quyen: QuyenBaoCao },
): Promise<BaoCaoHieuQua> {
  const { campaignId, campaignMa, khoang, quyen } = p;
  const sdb = scopedDb(actor);
  const khungGio = { gte: khoang.tuLuc, lt: khoang.denLuc };

  // Người xem sổ: `phamViNguoiXem` ném khi không có cả hai khoá hoa hồng ⇒ coi là «không xem được», KHÔNG phải 0 đồng.
  let phamViSo: PhamViReferral | null = null;
  if (quyen.hoaHong) {
    try {
      phamViSo = phamViNguoiXem(actor).tamCoSo === "ALL" ? "TAT_CA" : "GIOI_HAN";
    } catch (e) {
      if (!(e instanceof PermissionError)) throw e;
    }
  }

  // MỘT lượt song song cho mọi câu GROUP BY (luật 24/09: độ sâu tuần tự), rồi MỘT lượt tra tên.
  const [bam, rf, dk, tienTT, tienDT] = await Promise.all([
    quyen.luotBam
      ? db.referralClick.groupBy({ by: ["partyId", "outcome"], where: { campaignId, occurredAt: khungGio }, _count: { _all: true }, orderBy: [{ partyId: "asc" }, { outcome: "asc" }] })
      : Promise.resolve([]),
    quyen.referral
      ? sdb.affiliateReferral.groupBy({ by: ["partyId", "status"], where: { campaignId, createdAt: khungGio }, _count: { _all: true }, orderBy: [{ partyId: "asc" }, { status: "asc" }] })
      : Promise.resolve([]),
    quyen.referral
      ? sdb.affiliateReferral.groupBy({
          by: ["partyId"],
          where: { campaignId, status: "VALID", createdAt: khungGio, lead: { is: { convertedAt: { not: null }, deletedAt: null } } },
          _count: { _all: true },
          orderBy: { partyId: "asc" },
        })
      : Promise.resolve([]),
    phamViSo !== null ? gomSoTheoTrangThaiChi(db, actor, { campaignMa }) : Promise.resolve(null),
    phamViSo !== null ? gomSoTheoDoiTacHuong(db, actor, { campaignMa }) : Promise.resolve(null),
  ]);

  const ids = new Set<string>([...bam.map((x) => x.partyId), ...rf.map((x) => x.partyId), ...dk.map((x) => x.partyId), ...(tienDT ?? []).map((x) => x.partyId)]);
  const ten = ids.size > 0 ? await db.affiliate.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, code: true } }) : [];

  const doiTac = gopTheoDoiTac({
    luotBam: bam.map((x) => ({ partyId: x.partyId, outcome: x.outcome, n: x._count._all })),
    referral: rf.map((x) => ({ partyId: x.partyId, status: x.status, n: x._count._all })),
    daDangKy: dk.map((x) => ({ partyId: x.partyId, n: x._count._all })),
    tien: tienDT,
    danhTinh: new Map(ten.map((t) => [t.id, { ten: t.name, ma: t.code }])),
  });

  let referral: KhoiReferral | null = null;
  if (quyen.referral) {
    const theoTrangThai = demRong();
    for (const x of rf) theoTrangThai[x.status] += x._count._all;
    referral = {
      theoTrangThai,
      tong: tongCacTrangThai(theoTrangThai),
      daDangKy: dk.reduce((s, x) => s + x._count._all, 0),
      phamVi: getModelVisibleCenterIds("AffiliateReferral", actor) === "ALL" ? "TAT_CA" : "GIOI_HAN",
    };
  }

  let hoaHong: KhoiHoaHong | null = null;
  if (tienTT !== null && phamViSo !== null) {
    const theoTrangThai = { ...KHONG_CO_TIEN, ...tienTT };
    hoaHong = {
      theoTrangThai,
      tong: Object.values(theoTrangThai).reduce((s, x) => ({ soDong: s.soDong + x.soDong, tien: s.tien + x.tien }), { soDong: 0, tien: 0 }),
      phamVi: phamViSo,
    };
  }

  return { khoang, luotBam: quyen.luotBam ? tomTatLuotBam(gomTheoKetCuc(bam)) : null, referral, hoaHong, doiTac };
}

/** (đối tác × kết cục) → (kết cục): tổng lượt bấm của cả campaign không cần câu truy vấn thứ hai. */
function gomTheoKetCuc(bam: readonly { outcome: string; _count: { _all: number } }[]): { outcome: string; n: number }[] {
  const m = new Map<string, number>();
  for (const x of bam) m.set(x.outcome, (m.get(x.outcome) ?? 0) + x._count._all);
  return [...m.entries()].map(([outcome, n]) => ({ outcome, n }));
}
