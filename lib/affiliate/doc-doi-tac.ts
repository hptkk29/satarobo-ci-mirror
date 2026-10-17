/**
 * lib/affiliate/doc-doi-tac.ts — ĐỌC cho tab Affiliate (đối tác · loại · nhãn). Chỉ đọc, không ghi.
 *
 * ── Cách ly và PII (đọc kỹ trước khi sửa) ────────────────────────────────────────────────────────────────────
 *  · `Affiliate` là DANH MỤC DÙNG CHUNG (không auto-scope — `lib/db-scope.ts`): ai có `affiliates:view` đều thấy mọi đối tác. Cách ly nằm ở CỔNG QUYỀN, không ở truy vấn.
 *  · Nhưng SỐ LEAD là dữ liệu của cơ sở: đếm đi qua `scopedDb(actor).lead` ⇒ người cấp cơ sở chỉ đếm lead cơ sở mình. `phamViLead` nói cho giao diện biết con số có bị cắt không
 *    (không nói thì «Lead: 3» đọc như tổng thật — luật 12).
 *  · MÃ BỊ KHOÁ (`maDaKhoa`) thì ngược lại: đếm KHÔNG scope. Mã của đối tác đã có lead ở BẤT KỲ cơ sở nào là mã đã in ra giấy; scoped sẽ cho người cơ sở A đổi mã mà toàn bộ lead nằm ở cơ sở B,
 *    làm chết link ngoài đời. Cùng hàm (`timDoiTacDaCoLead`) với cổng ghi — giao diện vẽ ô khoá bằng đúng thứ máy chủ sẽ kiểm.
 *  · SĐT/email/ghi chú của đối tác là PII: `coTheXemLienHe` BẮT BUỘC, không mặc định (luật 7). Che Ở ĐÂY, trước khi dữ liệu thành props RSC gửi xuống trình duyệt — che ở giao diện là che
 *    chưa kịp (payload vẫn mang bản thật). Tìm theo SĐT/email chỉ khi `coTheXemLienHe`: không thì gõ số vào ô tìm là cách dò «số này có phải đối tác không».
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { maskEmail, maskPhone } from "@/lib/lead/pii";
import { timDoiTacDaLamNguoiGioiThieu } from "@/lib/nguon/doc-nguoi-gioi-thieu-affiliate";
import { thoatLike } from "@/lib/nguon/tim-nguoi-gioi-thieu";
import { laCoSoVanHanh } from "@/lib/nguon-hoa-hong/scope";
import { TRANG_THAI_DOI_TAC, type KieuDoiTac, type TrangThaiDoiTac } from "./ghi-doi-tac-dau-vao";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Số dòng mỗi trang của mọi danh sách trong tab (khuôn các tab khác của module: 25). */
export const KICH_THUOC_TRANG_AFFILIATE = 25;
/** Trần số tổ chức đưa vào ô «Thuộc tổ chức» — danh sách chọn, không phải đường tải danh bạ. */
export const TOI_DA_TO_CHUC_CHON = 300;

// ── Mã bị khoá ────────────────────────────────────────────────────────────────────────────────────

/**
 * Trong `ids`, đối tác nào ĐÃ CÓ lead (`Lead.affiliateId`) hoặc đã được ghi nhận làm người giới thiệu (`LeadAttribution.referrerAffiliateId`). KHÔNG scope, tính cả lead đã xoá mềm.
 * Một nguồn cho cổng ghi (`suaDoiTac`) lẫn giao diện (`DongDoiTac.maDaKhoa`).
 */
export async function timDoiTacDaCoLead(client: Khach, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [lead, gan] = await Promise.all([
    client.lead.findMany({ where: { affiliateId: { in: [...ids] } }, select: { affiliateId: true }, distinct: ["affiliateId"] }),
    timDoiTacDaLamNguoiGioiThieu(client, ids), // LeadAttribution chỉ đọc được trong lib/nguon/** ([QN-W11])
  ]);
  const ra = new Set<string>(gan);
  for (const l of lead) if (l.affiliateId) ra.add(l.affiliateId);
  return ra;
}

// ── Đối tác ───────────────────────────────────────────────────────────────────────────────────────

export type MucDanhMuc = { id: string; ma: string; ten: string; dangDung: boolean };

export type DongDoiTac = {
  id: string;
  /** Mã `?ref=`. */
  ma: string;
  ten: string;
  kieu: KieuDoiTac;
  trangThai: TrangThaiDoiTac;
  loai: (MucDanhMuc & { canDuyet: boolean }) | null;
  nhan: MucDanhMuc[];
  /** Số membership ĐANG HOẠT ĐỘNG (chương trình đối tác tham gia). */
  soChuongTrinh: number;
  /** Lead gắn qua `Lead.affiliateId` trong tầm nhìn của người xem (xem `phamViLead`). */
  soLead: number;
  /** Trong số đó: trạng thái DA_DANG_KY. */
  soLeadDaChot: number;
  /** Đã che nếu người xem không có `affiliates:manage`. */
  dienThoai: string | null;
  email: string | null;
  /** Null nếu người xem không có `affiliates:manage`. */
  ghiChu: string | null;
  tiLeThamChieu: number | null;
  coSoId: string | null;
  nhanVien: { id: string; ten: string; ma: string | null } | null;
  toChuc: { id: string; ten: string } | null;
  /** Số cá nhân thuộc tổ chức này (0 với cá nhân). */
  soThanhVien: number;
  /** Mã `?ref=` đã in ra ngoài đời — không đổi được. */
  maDaKhoa: boolean;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
};

export type PhamViLead = "TAT_CA" | "GIOI_HAN";

export type KetQuaDanhSachDoiTac = {
  dong: DongDoiTac[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Số đối tác theo từng trạng thái, trong bộ lọc LOẠI + TỪ KHOÁ hiện tại nhưng KHÔNG theo trạng thái (chip lọc cần con số này: bấm chip nào thì ra đúng chừng ấy dòng). */
  theoTrangThai: Record<TrangThaiDoiTac, number>;
  phamViLead: PhamViLead;
};

export type LocDoiTac = {
  trang: number;
  kichThuoc: number;
  trangThai: TrangThaiDoiTac | null;
  /** MÃ loại (`AffiliateType.code`). */
  loaiMa: string | null;
  tuKhoa: string | null;
  /** Người xem có `affiliates:manage` không. BẮT BUỘC (luật 7): quyết định SĐT/email/ghi chú có bị che và có được tìm theo SĐT không. */
  coTheXemLienHe: boolean;
};

/** Cột đọc cho MỘT dòng đối tác — dùng chung cho danh sách và trang chi tiết (L3a): hai nơi đọc cùng thứ thì ánh xạ cũng phải cùng một hàm (`thanhDong`). */
const CHON_DONG = {
  id: true,
  code: true,
  name: true,
  partyKind: true,
  status: true,
  phone: true,
  email: true,
  note: true,
  commissionPercent: true,
  centerId: true,
  updatedAt: true,
  type: { select: { id: true, code: true, name: true, isActive: true, requiresApproval: true } },
  tags: { select: { tag: { select: { id: true, code: true, name: true, isActive: true } } }, orderBy: { tag: { name: "asc" } } },
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  parentParty: { select: { id: true, name: true } },
  _count: { select: { members: true } },
} satisfies Prisma.AffiliateSelect;

type HangDoiTac = Prisma.AffiliateGetPayload<{ select: typeof CHON_DONG }>;

export async function docDanhSachDoiTac(actor: Actor, loc: LocDoiTac): Promise<KetQuaDanhSachDoiTac> {
  const like = loc.tuKhoa ? thoatLike(loc.tuKhoa) : null;
  // Bộ lọc KHÔNG gồm trạng thái: dùng cho cả danh sách lẫn số trên chip trạng thái. Chip mang bộ lọc loại + từ khoá sang địa chỉ của nó, nên con số trên chip phải đếm CÙNG bộ lọc ấy —
  // nếu không, «Chờ duyệt (2)» mở ra danh sách rỗng (luật 12: con số là lời hứa về thứ sẽ thấy).
  const whereChung: Prisma.AffiliateWhereInput = {
    ...(loc.loaiMa ? { type: { code: loc.loaiMa } } : {}),
    ...(like
      ? {
          OR: [
            { name: { contains: like, mode: "insensitive" } },
            { code: { contains: like, mode: "insensitive" } },
            ...(loc.coTheXemLienHe
              ? [{ phone: { contains: like, mode: "insensitive" as const } }, { email: { contains: like, mode: "insensitive" as const } }]
              : []),
          ],
        }
      : {}),
  };
  const where: Prisma.AffiliateWhereInput = { ...whereChung, ...(loc.trangThai ? { status: loc.trangThai } : {}) };
  const kichThuoc = Math.max(1, Math.trunc(loc.kichThuoc));
  const trang = Math.max(1, Math.trunc(loc.trang));

  const [tong, hang, theoTT] = await Promise.all([
    db.affiliate.count({ where }),
    db.affiliate.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (trang - 1) * kichThuoc,
      take: kichThuoc,
      select: CHON_DONG,
    }),
    db.affiliate.groupBy({ by: ["status"], where: whereChung, _count: { _all: true }, orderBy: { status: "asc" } }),
  ]);

  const so = await docSoLieuBoSung(actor, hang.map((h) => h.id));

  const theoTrangThai = Object.fromEntries(TRANG_THAI_DOI_TAC.map((t) => [t, 0])) as Record<TrangThaiDoiTac, number>;
  for (const g of theoTT) theoTrangThai[g.status] = g._count._all;

  const dong: DongDoiTac[] = hang.map((h) => thanhDong(h, so, loc.coTheXemLienHe));

  return {
    dong,
    tong,
    trang,
    kichThuoc,
    theoTrangThai,
    phamViLead: getModelVisibleCenterIds("Lead", actor) === "ALL" ? "TAT_CA" : "GIOI_HAN",
  };
}

/** Số lead (trong tầm nhìn của người xem) · số chương trình đang hoạt động · mã bị khoá — cho một tập đối tác. MỘT hàm cho danh sách và trang chi tiết. */
async function docSoLieuBoSung(actor: Actor, ids: readonly string[]): Promise<SoLieuBoSung> {
  const sdb = scopedDb(actor);
  const [leadTong, leadChot, chuongTrinh, daKhoa] = await Promise.all([
    ids.length ? sdb.lead.groupBy({ by: ["affiliateId"], where: { affiliateId: { in: [...ids] }, deletedAt: null }, _count: { _all: true }, orderBy: { affiliateId: "asc" } }) : [],
    ids.length
      ? sdb.lead.groupBy({ by: ["affiliateId"], where: { affiliateId: { in: [...ids] }, deletedAt: null, status: "DA_DANG_KY" }, _count: { _all: true }, orderBy: { affiliateId: "asc" } })
      : [],
    ids.length ? db.affiliateMembership.groupBy({ by: ["partyId"], where: { partyId: { in: [...ids] }, status: "ACTIVE" }, _count: { _all: true }, orderBy: { partyId: "asc" } }) : [],
    timDoiTacDaCoLead(db, ids),
  ]);
  return {
    demLead: new Map(leadTong.map((g) => [g.affiliateId, g._count._all])),
    demChot: new Map(leadChot.map((g) => [g.affiliateId, g._count._all])),
    demCt: new Map(chuongTrinh.map((g) => [g.partyId, g._count._all])),
    daKhoa,
  };
}

type SoLieuBoSung = { demLead: Map<string | null, number>; demChot: Map<string | null, number>; demCt: Map<string, number>; daKhoa: Set<string> };

function thanhDong(h: HangDoiTac, so: SoLieuBoSung, coTheXemLienHe: boolean): DongDoiTac {
  return {
    id: h.id,
    ma: h.code,
    ten: h.name,
    kieu: h.partyKind,
    trangThai: h.status,
    loai: h.type ? { id: h.type.id, ma: h.type.code, ten: h.type.name, dangDung: h.type.isActive, canDuyet: h.type.requiresApproval } : null,
    nhan: h.tags.map((t) => ({ id: t.tag.id, ma: t.tag.code, ten: t.tag.name, dangDung: t.tag.isActive })),
    soChuongTrinh: so.demCt.get(h.id) ?? 0,
    soLead: so.demLead.get(h.id) ?? 0,
    soLeadDaChot: so.demChot.get(h.id) ?? 0,
    dienThoai: h.phone === null ? null : coTheXemLienHe ? h.phone : maskPhone(h.phone),
    email: h.email === null ? null : coTheXemLienHe ? h.email : maskEmail(h.email),
    ghiChu: coTheXemLienHe ? h.note : null,
    tiLeThamChieu: coTheXemLienHe ? h.commissionPercent : null,
    coSoId: h.centerId,
    nhanVien: h.employee ? { id: h.employee.id, ten: h.employee.fullName, ma: h.employee.employeeCode } : null,
    toChuc: h.parentParty ? { id: h.parentParty.id, ten: h.parentParty.name } : null,
    soThanhVien: h._count.members,
    maDaKhoa: so.daKhoa.has(h.id),
    capNhatLuc: h.updatedAt.toISOString(),
  };
}

/** MỘT đối tác theo id (trang chi tiết) — cùng ánh xạ, cùng che PII, cùng đếm lead qua `scopedDb` như danh sách. Không có ⇒ null. */
export async function docDoiTacTheoId(actor: Actor, id: string, coTheXemLienHe: boolean): Promise<{ dong: DongDoiTac; phamViLead: PhamViLead } | null> {
  const hang = await db.affiliate.findUnique({ where: { id }, select: CHON_DONG });
  if (!hang) return null;
  const so = await docSoLieuBoSung(actor, [id]);
  return { dong: thanhDong(hang, so, coTheXemLienHe), phamViLead: getModelVisibleCenterIds("Lead", actor) === "ALL" ? "TAT_CA" : "GIOI_HAN" };
}

/** Số đối tác đang CHỜ DUYỆT — cho pill của tab / chip «Chờ duyệt». Một nguồn cho mọi nơi hiện con số này. */
export async function demDoiTacChoDuyet(): Promise<number> {
  return db.affiliate.count({ where: { status: "PENDING" } });
}

// ── Tuỳ chọn cho biểu mẫu đối tác ─────────────────────────────────────────────────────────────────

export type TuyChonDoiTac = {
  loai: { id: string; ma: string; ten: string; dangDung: boolean; canDuyet: boolean }[];
  nhan: MucDanhMuc[];
  coSo: { id: string; nhan: string }[];
  toChuc: { id: string; ten: string }[];
};

/**
 * Mọi loại/nhãn (kể cả đã ngừng — biểu mẫu SỬA cần hiện loại/nhãn đối tác cũ đang giữ); ô chọn của đối tác MỚI chỉ liệt kê `dangDung`. Cơ sở: tầm nhìn của người ghi (`scopedDb`).
 * Tổ chức: mọi tổ chức chưa kết thúc.
 */
export async function docTuyChonDoiTac(actor: Actor): Promise<TuyChonDoiTac> {
  const [loai, nhan, coSo, toChuc] = await Promise.all([
    db.affiliateType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, isActive: true, requiresApproval: true } }),
    db.affiliateTag.findMany({ orderBy: [{ name: "asc" }], select: { id: true, code: true, name: true, isActive: true } }),
    scopedDb(actor).center.findMany({ where: { isActive: true, code: { not: null } }, orderBy: { displayOrder: "asc" }, select: { id: true, code: true, name: true } }),
    db.affiliate.findMany({
      where: { partyKind: "ORGANIZATION", status: { not: "ENDED" } },
      orderBy: { name: "asc" },
      take: TOI_DA_TO_CHUC_CHON,
      select: { id: true, name: true },
    }),
  ]);
  return {
    loai: loai.map((l) => ({ id: l.id, ma: l.code, ten: l.name, dangDung: l.isActive, canDuyet: l.requiresApproval })),
    nhan: nhan.map((n) => ({ id: n.id, ma: n.code, ten: n.name, dangDung: n.isActive })),
    coSo: coSo.filter(laCoSoVanHanh).map((c) => ({ id: c.id, nhan: c.code ? `${c.code} · ${c.name}` : c.name })),
    toChuc: toChuc.map((t) => ({ id: t.id, ten: t.name })),
  };
}

/** Mọi loại (mã + tên) cho ô lọc theo loại — người chỉ XEM cũng cần, nên tách khỏi `docTuyChonDoiTac` (nặng hơn: cơ sở, tổ chức). Kể cả loại đã ngừng: đối tác cũ vẫn mang loại ấy. */
export async function docCacLoaiChoLoc(): Promise<{ ma: string; ten: string }[]> {
  const r = await db.affiliateType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } });
  return r.map((l) => ({ ma: l.code, ten: l.name }));
}

// ── Loại · Nhãn ───────────────────────────────────────────────────────────────────────────────────

export type DongLoai = {
  id: string;
  ma: string;
  ten: string;
  moTa: string | null;
  canDuyet: boolean;
  /** L3a — null = ẨN (mặc định). */
  xemTien: boolean | null;
  dangDung: boolean;
  thuTu: number;
  nguonMacDinh: { id: string; ten: string } | null;
  soDoiTac: number;
  /** Số quy tắc campaign trỏ vào loại này. */
  soQuyTac: number;
  capNhatLuc: string;
};

export type DongNhan = {
  id: string;
  ma: string;
  ten: string;
  moTa: string | null;
  dangDung: boolean;
  soDoiTac: number;
  soQuyTac: number;
  capNhatLuc: string;
};

export type TrangDanhMuc<T> = { dong: T[]; tong: number; trang: number; kichThuoc: number };

export async function docDanhSachLoai(p: { trang: number; kichThuoc: number }): Promise<TrangDanhMuc<DongLoai>> {
  const kichThuoc = Math.max(1, Math.trunc(p.kichThuoc));
  const trang = Math.max(1, Math.trunc(p.trang));
  const [tong, hang] = await Promise.all([
    db.affiliateType.count(),
    db.affiliateType.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: (trang - 1) * kichThuoc,
      take: kichThuoc,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        requiresApproval: true,
        partnerCanViewAmount: true,
        isActive: true,
        sortOrder: true,
        updatedAt: true,
        defaultSourceGroup: { select: { id: true, name: true } },
        _count: { select: { parties: true, rules: true } },
      },
    }),
  ]);
  return {
    tong,
    trang,
    kichThuoc,
    dong: hang.map((h) => ({
      id: h.id,
      ma: h.code,
      ten: h.name,
      moTa: h.description,
      canDuyet: h.requiresApproval,
      xemTien: h.partnerCanViewAmount,
      dangDung: h.isActive,
      thuTu: h.sortOrder,
      nguonMacDinh: h.defaultSourceGroup ? { id: h.defaultSourceGroup.id, ten: h.defaultSourceGroup.name } : null,
      soDoiTac: h._count.parties,
      soQuyTac: h._count.rules,
      capNhatLuc: h.updatedAt.toISOString(),
    })),
  };
}

export async function docDanhSachNhan(p: { trang: number; kichThuoc: number }): Promise<TrangDanhMuc<DongNhan>> {
  const kichThuoc = Math.max(1, Math.trunc(p.kichThuoc));
  const trang = Math.max(1, Math.trunc(p.trang));
  const [tong, hang] = await Promise.all([
    db.affiliateTag.count(),
    db.affiliateTag.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (trang - 1) * kichThuoc,
      take: kichThuoc,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { parties: true, rules: true } },
      },
    }),
  ]);
  return {
    tong,
    trang,
    kichThuoc,
    dong: hang.map((h) => ({
      id: h.id,
      ma: h.code,
      ten: h.name,
      moTa: h.description,
      dangDung: h.isActive,
      soDoiTac: h._count.parties,
      soQuyTac: h._count.rules,
      capNhatLuc: h.updatedAt.toISOString(),
    })),
  };
}

/** Nguồn chọn được làm «nguồn mặc định» của loại: ACTIVE ∧ selectable. KHÔNG so mã nguồn — chỉ thuộc tính (luật «nguồn là master data động»). */
export async function docNguonChoLoai(): Promise<{ id: string; ten: string }[]> {
  const r = await db.leadSourceGroup.findMany({
    where: { status: "ACTIVE", selectable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return r.map((n) => ({ id: n.id, ten: n.name }));
}
