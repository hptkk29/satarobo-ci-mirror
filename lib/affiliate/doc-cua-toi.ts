/**
 * lib/affiliate/doc-cua-toi.ts — ĐỌC cho trang `/portal/gioi-thieu` (AFF-P3 H3): đối tác Affiliate xem việc giới thiệu CỦA CHÍNH MÌNH. Chỉ đọc.
 *
 * ── CÁCH LY — nằm ở TRUY VẤN, không ở giao diện ────────────────────────────────────────────────────────────────
 * `portalDb` KHÔNG che được thứ này: không model nào ở đây có trong bản đồ sở hữu của nó (nó chỉ biết Student/Enrollment/…), nên nó cho đi thẳng. `scopedDb` còn tệ hơn — người dùng portal là PARENT,
 * không đứng ở cơ sở nào, nên `AffiliateReferral`/`CommissionTransaction` (∈ SCOPED_MODELS) sẽ bị ép `centerId IN []`. Vì vậy sự cô lập là CÁI `where` TƯỜNG MINH dưới đây, theo MỘT khoá:
 *
 *     ids = partyIdsVaoDuoc(<người đăng nhập>)      ← điểm vào DUY NHẤT (lib/affiliate/tai-khoan-truy-cap.ts), từ phiên, không từ tham số của client
 *     mọi truy vấn khác:  partyId IN ids   |   beneficiaryKind = AFFILIATE ∧ beneficiaryAffiliateId IN ids
 *
 * Quan hệ User ↔ đối tác là NHIỀU–NHIỀU (bảng nối `AffiliatePartyUser`, L3a; cột cũ `Affiliate.userId` chỉ còn là đường lùi cho dữ liệu chưa qua màn mới) — nên là `IN`, không `=`. Dòng truy cập bị
 * TẠM NGỪNG hay đã GỠ không nằm trong `ids` ⇒ trả `null` NGAY, không chạy truy vấn nào. Hàm này KHÔNG nhận `partyId` / `campaignId` từ bên ngoài: không có đường nào để hỏi dữ liệu của người khác.
 *
 * ── SỐ TIỀN hoa hồng: cấu hình, QUYẾT ĐỊNH TỪNG DÒNG rồi mới cộng (L3a) ──────────────────────────────────────────
 * Đối tác có thấy số tiền không do `partnerCanViewAmount` quyết (campaign > loại > mặc định ẨN — `quyen-xem-tien.ts`, MỘT chỗ). Mỗi dòng sổ có campaign riêng (có thể null) nên quyết ĐỊNH TỪNG CẶP
 * (đối tác × campaign) trước, truy vấn tiền CHỈ cho các cặp được phép — KHÔNG cộng tất cả rồi giấu ở giao diện (payload RSC vẫn mang con số). Không cặp nào được phép ⇒ `hoaHong = null`: kiểu trả về
 * không có chỗ nào để chứa số tiền. Có cặp bị ẩn lẫn cặp hiện ⇒ `hoaHongMotPhan = true` (nói rằng còn khoản khác không hiển thị, không nói bao nhiêu).
 *
 * ── PII ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Mọi `select` liệt kê tường minh. Không bao giờ chọn: lead (chỉ lấy `leadId` để cắt mã rút gọn của lượt HỢP LỆ), SĐT/email đối tác, `sourceSnapshot`, `evidence`, `resolutionReason`,
 * `reason`/`orderId`/`studentId`/`leadId` của dòng sổ. Kiểu trả về ở `cua-toi.ts` không có chỗ nào để chứa chúng.
 *
 * ── Cờ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * `affiliate.enabled` ∧ `nguon.enabled` (`hopCoAffiliate` — cùng phép giải với `docCoModule().affiliate` của khung admin). Đọc cờ hỏng ⇒ TẮT. Tắt ⇒ `null`, y như «chưa liên kết» — trang 404, menu không có mục.
 */
import type { CommissionPayoutStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";

import { nhanLoaiDong, tomTatHoaHong, type DongHoaHongCuaToi, type DongReferralCuaToi, type GioiThieuCuaToi, type HoaHongCuaToi, type LinkCuaToi, type TrangThaiDoiTac, trangThaiHienChoDoiTac } from "./cua-toi";
import { docDanhSachLink, docTuyChonPhatLink } from "./doc-link";
import { hopCoAffiliate, laAffiliateBatTho } from "./feature";
import { gocCongKhai } from "./goc-cong-khai";
import { demRong, maRutGonPhieu } from "./ghi-referral-dau-vao";
import { quyenXemTien } from "./quyen-xem-tien";
import { partyIdsVaoDuoc } from "./tai-khoan-truy-cap";

export const SO_DONG_GAN_DAY = 20;
const TOI_DA_LINK_MOI_DOI_TAC = 100;

type DoiTacCuaToi = { id: string; ten: string; ma: string; trangThai: TrangThaiDoiTac };

/** Cờ Affiliate hiệu lực (đã AND với cờ nguồn). Đọc hỏng ⇒ tắt — một mục thiếu tốt hơn một trang sập. */
async function affiliateBat(): Promise<boolean> {
  const [nguon, affiliate] = await Promise.all([laQuanLyNguonBat().catch(() => false), laAffiliateBatTho().catch(() => false)]);
  return hopCoAffiliate({ nguon, affiliate });
}

/**
 * Tài khoản này có được thấy mục «Giới thiệu» (menu) và trang `/portal/gioi-thieu` không: cờ Affiliate BẬT ∧ vào được ít nhất một đối tác. MỘT định nghĩa cho cả menu lẫn trang
 * (menu hiện mà trang 404 là lời hứa suông — luật 12): cả hai cùng đi qua `partyIdsVaoDuoc`. Cờ kiểm TRƯỚC để cờ tắt không tốn câu DB nào.
 */
export async function coGioiThieuChoNguoiDung(userId: string): Promise<boolean> {
  if (!(await affiliateBat())) return false;
  return (await partyIdsVaoDuoc(userId)).length > 0;
}

type Cap = { partyId: string; campaignId: string | null };

/**
 * Quyết định TỪNG CẶP (đối tác × campaign) có được hiện số tiền không — chỉ đọc CẤU HÌNH và ĐẾM (không lấy số tiền). Kết quả:
 *  · `duocXem`   — các cặp có dòng sổ VÀ được phép: chỉ các cặp này mới bị truy vấn tiền.
 *  · `coCapAn`   — có dòng sổ thuộc cặp không được phép (nên khối tiền, nếu có, chỉ là một phần).
 *  · `macDinhHien` — chưa có dòng sổ nào bị ẩn mà ít nhất một chương trình của đối tác cho phép hiện (để khối tiền hiện số 0 thay vì biến mất khi chưa phát sinh khoản nào).
 */
async function quyetDinhXemTien(doiTac: readonly { id: string; loaiXemTien: boolean | null }[]): Promise<{ duocXem: Cap[]; coCapAn: boolean; macDinhHien: boolean }> {
  const ids = doiTac.map((d) => d.id);
  const loaiCua = new Map(doiTac.map((d) => [d.id, d.loaiXemTien]));
  const [cap, thanhVien] = await Promise.all([
    db.commissionTransaction.groupBy({
      by: ["beneficiaryAffiliateId", "affiliateCampaignId"],
      where: { beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: { in: ids } },
      _count: { _all: true },
      orderBy: [{ beneficiaryAffiliateId: "asc" }, { affiliateCampaignId: "asc" }],
    }),
    db.affiliateMembership.findMany({ where: { partyId: { in: ids } }, select: { partyId: true, campaignId: true } }),
  ]);
  const idCampaign = new Set<string>();
  for (const c of cap) if (c.affiliateCampaignId) idCampaign.add(c.affiliateCampaignId);
  for (const m of thanhVien) idCampaign.add(m.campaignId);
  const camp = idCampaign.size ? await db.affiliateCampaign.findMany({ where: { id: { in: [...idCampaign] } }, select: { id: true, partnerCanViewAmount: true } }) : [];
  const coCampaign = new Map(camp.map((c) => [c.id, c.partnerCanViewAmount]));
  const duocPhep = (partyId: string, campaignId: string | null): boolean =>
    quyenXemTien({ campaign: campaignId === null ? null : (coCampaign.get(campaignId) ?? null), loai: loaiCua.get(partyId) ?? null });

  const duocXem: Cap[] = [];
  let coCapAn = false;
  for (const c of cap) {
    if (c.beneficiaryAffiliateId === null) continue;
    const pair: Cap = { partyId: c.beneficiaryAffiliateId, campaignId: c.affiliateCampaignId };
    if (duocPhep(pair.partyId, pair.campaignId)) duocXem.push(pair);
    else coCapAn = true;
  }
  const macDinhHien = !coCapAn && thanhVien.some((m) => duocPhep(m.partyId, m.campaignId));
  return { duocXem, coCapAn, macDinhHien };
}

const hoaHongRong = (): HoaHongCuaToi => {
  const theoChi: Record<CommissionPayoutStatus, { soDong: number; tien: number }> = {
    ON_HOLD: { soDong: 0, tien: 0 },
    PENDING: { soDong: 0, tien: 0 },
    APPROVED: { soDong: 0, tien: 0 },
    EXPORTED: { soDong: 0, tien: 0 },
    PAID: { soDong: 0, tien: 0 },
  };
  return { theoTrangThai: theoChi, ...tomTatHoaHong(theoChi), gan: [] };
};

/** Số tiền hoa hồng — CHỈ cho các cặp (đối tác × campaign) đã được cho phép. Không cặp nào ⇒ không chạy truy vấn tiền nào. */
async function docHoaHong(duocXem: readonly Cap[]): Promise<HoaHongCuaToi> {
  if (duocXem.length === 0) return hoaHongRong();
  const where: Prisma.CommissionTransactionWhereInput = {
    beneficiaryKind: "AFFILIATE",
    OR: duocXem.map((c) => ({ beneficiaryAffiliateId: c.partyId, affiliateCampaignId: c.campaignId })),
  };
  const [tien, tienGan] = await Promise.all([
    db.commissionTransaction.groupBy({ by: ["payoutStatus"], where, _count: { _all: true }, _sum: { amount: true }, orderBy: { payoutStatus: "asc" } }),
    db.commissionTransaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: SO_DONG_GAN_DAY,
      select: { createdAt: true, entryKind: true, amount: true, payoutStatus: true, period: { select: { period: true } }, affiliateCampaign: { select: { name: true } } },
    }),
  ]);
  const theoChi = hoaHongRong().theoTrangThai;
  for (const x of tien) theoChi[x.payoutStatus] = { soDong: x._count._all, tien: x._sum.amount ?? 0 };
  const hoaHongGan: DongHoaHongCuaToi[] = tienGan.map((t) => ({
    luc: t.createdAt.toISOString(),
    ky: t.period.period,
    campaign: t.affiliateCampaign?.name ?? null,
    loai: nhanLoaiDong(t.entryKind),
    soTien: t.amount,
    trangThaiChi: t.payoutStatus,
  }));
  return { theoTrangThai: theoChi, ...tomTatHoaHong(theoChi), gan: hoaHongGan };
}

export async function docGioiThieuCuaToi(userId: string, now: Date): Promise<GioiThieuCuaToi | null> {
  if (!(await affiliateBat())) return null;
  const ids = await partyIdsVaoDuoc(userId);
  if (ids.length === 0) return null;
  const dsDoiTac = await db.affiliate.findMany({
    where: { id: { in: ids } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, code: true, status: true, type: { select: { partnerCanViewAmount: true } } },
  });
  const doiTac: DoiTacCuaToi[] = dsDoiTac.map((d) => ({ id: d.id, ten: d.name, ma: d.code, trangThai: d.status }));
  // Gốc link ngắn do CẤU HÌNH quyết (mỗi môi trường một gốc); null ⇒ không dựng link ngắn, giao diện nói thẳng.
  const gocLinkNgan = gocCongKhai(process.env);

  const [linkTheoDoiTac, tuyChon, bam, rf, dk, rfGan, xemTien] = await Promise.all([
    Promise.all(
      doiTac.map((d) =>
        docDanhSachLink({ trang: 1, kichThuoc: TOI_DA_LINK_MOI_DOI_TAC, trangThai: null, campaignMa: null, doiTacMa: d.ma, coTheXemDayDu: true, gocLinkNgan, now }),
      ),
    ),
    // Ô chọn «Tạo link»: chỉ các đối tác tài khoản này VÀO ĐƯỢC (`partyIdsVaoDuoc`), chỉ trang đích «đúng» (không `*`).
    docTuyChonPhatLink(now, { partyIds: ids, chiTrangChinhXac: true }),
    db.referralClick.groupBy({ by: ["outcome"], where: { partyId: { in: ids } }, _count: { _all: true }, orderBy: { outcome: "asc" } }),
    db.affiliateReferral.groupBy({ by: ["status"], where: { partyId: { in: ids } }, _count: { _all: true }, orderBy: { status: "asc" } }),
    db.affiliateReferral.count({ where: { partyId: { in: ids }, status: "VALID", lead: { is: { convertedAt: { not: null }, deletedAt: null } } } }),
    db.affiliateReferral.findMany({
      where: { partyId: { in: ids } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: SO_DONG_GAN_DAY,
      select: { createdAt: true, status: true, leadId: true, campaign: { select: { name: true } } },
    }),
    quyetDinhXemTien(dsDoiTac.map((d) => ({ id: d.id, loaiXemTien: d.type?.partnerCanViewAmount ?? null }))),
  ]);

  const link: LinkCuaToi[] = linkTheoDoiTac.flatMap((r) =>
    r.dong.map((l) => ({
      id: l.id,
      campaign: l.campaign.ten,
      website: l.website.host,
      trangDich: l.landingPath,
      loai: l.loai,
      nhan: l.nhan,
      hoatDong: l.trangThai === "ACTIVE",
      lyDoKhongDung: l.lyDoKhongDung,
      soLuotBam: l.soLuotBam,
      soLuotBamLoi: l.soLuotBamLoi,
      soReferral: l.soReferral,
      lienKetNgan: l.lienKetNgan,
      lienKetTrucTiep: l.lienKetTrucTiep,
      urlCuoi: l.urlCuoi,
    })),
  );

  const theoTrangThai = demRong();
  for (const x of rf) theoTrangThai[trangThaiHienChoDoiTac(x.status)] += x._count._all;
  const gan: DongReferralCuaToi[] = rfGan.map((r) => ({
    luc: r.createdAt.toISOString(),
    campaign: r.campaign.name,
    trangThai: trangThaiHienChoDoiTac(r.status),
    // Mã phiếu CHỈ cho lượt HỢP LỆ. REJECTED_DUPLICATE trỏ về phiếu của NGƯỜI GHI NHẬN TRƯỚC — mã đó không phải của đối tác này.
    maPhieu: r.status === "VALID" && r.leadId ? maRutGonPhieu(r.leadId) : null,
  }));

  // Tiền: quyết định theo cấu hình TRƯỚC, truy vấn tiền SAU và chỉ cho cặp được phép.
  const hienKhoiTien = xemTien.duocXem.length > 0 || xemTien.macDinhHien;
  const hoaHong = hienKhoiTien ? await docHoaHong(xemTien.duocXem) : null;

  let hopLe = 0;
  let khongDung = 0;
  for (const x of bam) {
    if (x.outcome === "OK") hopLe += x._count._all;
    else khongDung += x._count._all;
  }

  return {
    doiTac: doiTac.map((d) => ({ ten: d.ten, ma: d.ma, trangThai: d.trangThai })),
    link,
    taoLink: { chuongTrinh: tuyChon.doiTac.flatMap((d) => d.chuongTrinh), coGocLinkNgan: gocLinkNgan !== null },
    luotBam: { hopLe, khongDung },
    referral: { theoTrangThai, tong: Object.values(theoTrangThai).reduce((n, v) => n + v, 0), daDangKy: dk, gan },
    hoaHong,
    hoaHongMotPhan: hoaHong !== null && xemTien.coCapAn,
  };
}
