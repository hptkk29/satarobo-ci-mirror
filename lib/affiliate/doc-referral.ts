/**
 * lib/affiliate/doc-referral.ts — ĐỌC cho tab Referral (AFF-P1). Chỉ đọc, không ghi.
 *
 * ── Cách ly và PII (đọc kỹ trước khi sửa) ────────────────────────────────────────────────────────────────────
 *  · `AffiliateReferral` ∈ SCOPED_MODELS (prefix quyền `affiliate_referrals:`). MỌI lượt đọc đi qua `scopedDb(actor)` — danh sách, số trên chip, số hàng chờ, chi tiết. Người cấp cơ sở chỉ thấy
 *    dòng của cơ sở mình; dòng `centerId = NULL` (lead chưa quy được cơ sở) CHỈ cấp Hội sở thấy, nên màn nói điều đó bằng `phamVi` (luật 12: con số không được trông như tổng thật).
 *  · Chi tiết dùng `findUnique` đã scope: dòng của cơ sở khác trả null ⇒ trang 404, không lộ là có tồn tại (IDOR).
 *  · KHÔNG PII khách: mọi câu `select` liệt kê tường minh. KHÔNG chọn quan hệ `lead` (chỉ lấy `leadId`), KHÔNG chọn `evidence` (văn bản tự do), KHÔNG chọn SĐT/email của đối tác. `sourceSnapshot` đi qua
 *    `docSnapshotReferral` (chỉ giữ các khoá đã biết). Không rò thì không cần che: payload RSC mang cả thứ giao diện không vẽ.
 *  · `leadId` CHỈ xuống trình duyệt khi người xem MỞ ĐƯỢC phiếu: `coTheMoLead` (quyền xem lead — BẮT BUỘC, không mặc định, luật 7) ∧ phiếu nằm trong tầm nhìn cơ sở (`scopedDb.lead`).
 *    Còn lại chỉ có mã rút gọn. Không log `leadId`.
 */
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import {
  demRong,
  dichLyDoReferral,
  docSnapshotReferral,
  maRutGonPhieu,
  type ChiTietReferral,
  type DemTheoTrangThaiReferral,
  type DongReferral,
  type PhamViReferral,
  type PhieuKhachReferral,
  type TrangThaiReferral,
} from "./ghi-referral-dau-vao";

/** Số dòng mỗi trang (khuôn các tab khác của module: 25). */
export const KICH_THUOC_TRANG_REFERRAL = 25;

const SELECT_DONG = {
  id: true,
  createdAt: true,
  method: true,
  status: true,
  resolutionReason: true,
  leadId: true,
  sourceSnapshot: true,
  party: { select: { id: true, name: true, code: true } },
  campaign: { select: { id: true, name: true, code: true } },
  sourceGroup: { select: { name: true } },
} satisfies Prisma.AffiliateReferralSelect;

type HangDong = Prisma.AffiliateReferralGetPayload<{ select: typeof SELECT_DONG }>;

/** Trong `leadIds`, phiếu nào người xem THẤY được theo tầm nhìn cơ sở (và chưa xoá mềm). Rỗng khi không được mở phiếu. */
async function phieuTrongTamNhin(actor: Actor, leadIds: readonly string[], coTheMoLead: boolean): Promise<ReadonlySet<string>> {
  if (!coTheMoLead || leadIds.length === 0) return new Set();
  const r = await scopedDb(actor).lead.findMany({ where: { id: { in: [...leadIds] }, deletedAt: null }, select: { id: true } });
  return new Set(r.map((x) => x.id));
}

function phieuCua(leadId: string | null, mo: ReadonlySet<string>): PhieuKhachReferral {
  if (leadId === null) return { coPhieu: false, maRutGon: null, leadId: null };
  return { coPhieu: true, maRutGon: maRutGonPhieu(leadId), leadId: mo.has(leadId) ? leadId : null };
}

function dongTuHang(h: HangDong, mo: ReadonlySet<string>): DongReferral {
  const sn = docSnapshotReferral(h.sourceSnapshot);
  return {
    id: h.id,
    luc: h.createdAt.toISOString(),
    doiTac: { id: h.party.id, ten: h.party.name, ma: h.party.code },
    campaign: { id: h.campaign.id, ten: h.campaign.name, ma: h.campaign.code },
    cachDen: h.method,
    trangThai: h.status,
    // `sourceGroupId` là cột NOT NULL: khi lượt gửi không được quyết HỢP LỆ, hàng mang nhóm «Không xác định» làm chỗ giữ. Bậc quyết định (`tu`) chỉ có khi nguồn THẬT SỰ được giải.
    nguon: sn.tu !== null ? h.sourceGroup.name : null,
    lyDo: dichLyDoReferral(h.resolutionReason),
    phieu: phieuCua(h.leadId, mo),
  };
}

export type KetQuaDanhSachReferral = {
  dong: DongReferral[];
  /** Tổng số dòng theo bộ lọc trạng thái hiện tại. */
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Số theo từng trạng thái trong tầm nhìn của người xem. «Tất cả» = tổng các số này. */
  theoTrangThai: DemTheoTrangThaiReferral;
  phamVi: PhamViReferral;
};

export type LocReferral = {
  trang: number;
  kichThuoc: number;
  trangThai: TrangThaiReferral | null;
  /** Người xem mở được phiếu khách không (quyền xem lead). BẮT BUỘC (luật 7): quyết định `leadId` có xuống trình duyệt không. */
  coTheMoLead: boolean;
};

/** Số theo trạng thái trong tầm nhìn của `actor` — MỘT nguồn cho chip lọc lẫn «Tất cả». */
async function demTheoTrangThai(actor: Actor): Promise<DemTheoTrangThaiReferral> {
  const g = await scopedDb(actor).affiliateReferral.groupBy({ by: ["status"], _count: { _all: true }, orderBy: { status: "asc" } });
  const ra = demRong();
  for (const x of g) ra[x.status] = x._count._all;
  return ra;
}

export async function docDanhSachReferral(actor: Actor, loc: LocReferral): Promise<KetQuaDanhSachReferral> {
  const sdb = scopedDb(actor);
  const kichThuoc = Math.max(1, Math.trunc(loc.kichThuoc));
  const trang = Math.max(1, Math.trunc(loc.trang));
  const where: Prisma.AffiliateReferralWhereInput = loc.trangThai ? { status: loc.trangThai } : {};

  const [tong, hang, theoTrangThai] = await Promise.all([
    sdb.affiliateReferral.count({ where }),
    sdb.affiliateReferral.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (trang - 1) * kichThuoc,
      take: kichThuoc,
      select: SELECT_DONG,
    }),
    demTheoTrangThai(actor),
  ]);

  const mo = await phieuTrongTamNhin(
    actor,
    hang.map((h) => h.leadId).filter((x): x is string => x !== null),
    loc.coTheMoLead,
  );
  return {
    dong: hang.map((h) => dongTuHang(h, mo)),
    tong,
    trang,
    kichThuoc,
    theoTrangThai,
    phamVi: getModelVisibleCenterIds("AffiliateReferral", actor) === "ALL" ? "TAT_CA" : "GIOI_HAN",
  };
}

/** Số referral CẦN XEM TAY trong tầm nhìn của `actor` — pill của tab và chip «Cần xem tay» cùng đọc một định nghĩa (luật 12b). */
export async function demReferralCanXemTay(actor: Actor): Promise<number> {
  return scopedDb(actor).affiliateReferral.count({ where: { status: "MANUAL_REVIEW" } });
}

/** Chi tiết một lượt. `null` khi không có HOẶC ngoài tầm nhìn cơ sở của người xem (không phân biệt — chống dò id). */
export async function docChiTietReferral(actor: Actor, id: string, opts: { coTheMoLead: boolean }): Promise<ChiTietReferral | null> {
  const h = await scopedDb(actor).affiliateReferral.findUnique({
    where: { id },
    select: {
      ...SELECT_DONG,
      protectedUntil: true,
      qualifiedAt: true,
      rejectedAt: true,
      updatedAt: true,
    },
  });
  if (!h) return null;

  const sn = docSnapshotReferral(h.sourceSnapshot);
  // Loại/nhãn chụp bằng MÃ lúc ghi; tra tên hiện hành để người đọc nhận ra (danh mục toàn hệ — không scope). Mã không còn thì in lại chính mã.
  const [loai, nhan, mo] = await Promise.all([
    sn.maLoai ? db.affiliateType.findUnique({ where: { code: sn.maLoai }, select: { name: true } }) : Promise.resolve(null),
    sn.maNhan.length ? db.affiliateTag.findMany({ where: { code: { in: sn.maNhan } }, select: { code: true, name: true } }) : Promise.resolve([]),
    phieuTrongTamNhin(actor, h.leadId ? [h.leadId] : [], opts.coTheMoLead),
  ]);
  const tenNhan = new Map(nhan.map((n) => [n.code, n.name]));

  return {
    ...dongTuHang(h, mo),
    snapshot: sn,
    tenLoai: sn.maLoai ? (loai?.name ?? sn.maLoai) : null,
    tenNhan: sn.maNhan.map((ma) => ({ ma, ten: tenNhan.get(ma) ?? ma })),
    baoVeDen: h.protectedUntil?.toISOString() ?? null,
    datDieuKienLuc: h.qualifiedAt?.toISOString() ?? null,
    tuChoiLuc: h.rejectedAt?.toISOString() ?? null,
    capNhatLuc: h.updatedAt.toISOString(),
  };
}
