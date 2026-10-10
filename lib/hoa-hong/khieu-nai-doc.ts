// lib/hoa-hong/khieu-nai-doc.ts — ĐỌC khiếu nại cho màn hình: danh sách · chi tiết · số đếm. MỘT nơi quyết "ai thấy khiếu nại nào".
//
// Nguồn: docs/source-commission/02 §11.1 ("Đọc của chính mình — KHÔNG qua scopedDb"), 05 §1.4, 06 §5.5.
//
// ── Phạm vi người xem: HỢP của hai tập (như `docSoHoaHong`) ────────────────────────────────────────────
//   · giữ `commission:view-self`            → khiếu nại do CHÍNH MÌNH gửi (`raisedByUserId`), ở mọi cơ sở — `db` KHÔNG scope: `centerId` của khiếu nại là
//                                             cơ sở của GIAO DỊCH, nên Sale neo CS1 khiếu nại dòng CS2 của mình vẫn phải thấy nó;
//   · giữ `commission_disputes:review`      → mọi khiếu nại trong TẦM NHÌN cơ sở của quyền ấy (`getModelVisibleCenterIds("CommissionDispute")`).
//   · cả hai                                → hợp hai tập.   · không cái nào → `PermissionError` (đóng cửa, fail-closed).
// KHÔNG mở cho người chỉ có `commission:view-center` (QLCS, Kế toán cơ sở): lý do + bằng chứng khiếu nại có thể chứa thông tin cá nhân, và 04 §15 chỉ giao việc
// xem xét cho HR. Muốn QLCS thấy khiếu nại của cơ sở mình là một quyết định phải hỏi (ghi ở docs/06).
//
// Hàm nằm ở `lib/hoa-hong/**` (ngoài `app/**`) nên cổng ESLint "cấm import db trần" không soi — đúng ý đặc tả. Lưới `[NHH-DSP-R*]` (Postgres thật, có đối chứng
// dương) là lưới DUY NHẤT canh phạm vi này.
import type { Prisma, PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";
import { getModelVisibleCenterIds } from "@/lib/db-scope";

import { demDongDoiNguonSauKhiGui } from "./khieu-nai-dich";
import { ENTITY_KHIEU_NAI, KEY_DUYET_KHIEU_NAI, KEY_TAO_KHIEU_NAI, MODULE_AUDIT_HOA_HONG } from "./khieu-nai-ma";
import { ketQuaKhieuNai, type CachGiaiKhieuNai, type KetQuaKhieuNai, type TrangThaiKhieuNai } from "./khieu-nai-trang-thai";
import { viecDuocLam, type ViecDuocLam } from "./khieu-nai-viec";
import { dungViSao, type ViSao } from "./vi-sao";

type Khach = PrismaClient | Prisma.TransactionClient;

export type PhamViKhieuNai = {
  rieng: boolean;
  duyet: boolean;
  /** Điều kiện `where` của phạm vi (đã gộp hai tập). */
  where: Prisma.CommissionDisputeWhereInput;
  /** Tầm nhìn cơ sở của quyền duyệt ("ALL" = không giới hạn); `null` khi không giữ quyền duyệt. */
  tamCoSo: "ALL" | readonly string[] | null;
};

/** MỘT chỗ duy nhất quyết phạm vi: danh sách, chi tiết, số đếm đều đi qua đây. */
export function phamViKhieuNai(actor: Actor): PhamViKhieuNai {
  const rieng = can(actor, KEY_TAO_KHIEU_NAI);
  const duyet = can(actor, KEY_DUYET_KHIEU_NAI);
  if (!rieng && !duyet) throw new PermissionError();
  const tamCoSo = duyet ? getModelVisibleCenterIds("CommissionDispute", actor) : null;
  if (tamCoSo === "ALL") return { rieng, duyet, where: {}, tamCoSo };
  const phan: Prisma.CommissionDisputeWhereInput[] = [];
  if (rieng) phan.push({ raisedByUserId: actor.userId });
  if (tamCoSo !== null) phan.push({ centerId: { in: [...tamCoSo] } });
  return { rieng, duyet, where: { OR: phan }, tamCoSo };
}

// ── Danh sách ──────────────────────────────────────────────────────────────────────────────────

export type LocTrangThai = "DANG_MO" | "DA_QUYET" | "TAT_CA";
export const LOC_TRANG_THAI: readonly LocTrangThai[] = ["DANG_MO", "DA_QUYET", "TAT_CA"];

export type BoLocKhieuNai = {
  trangThai?: LocTrangThai;
  centerId?: string;
  /** Chỉ khiếu nại tôi gửi (người giữ cả hai quyền muốn tách việc của mình khỏi việc duyệt). */
  chiCuaToi?: boolean;
  trang?: number;
  coTrang?: number;
};

export type DongKhieuNai = {
  id: string;
  trangThai: TrangThaiKhieuNai;
  ketQua: KetQuaKhieuNai;
  dich: { loai: "DONG"; vai: string; soTien: number; ky: string; nguoiHuong: string } | { loai: "KHOAN"; soTien: number; maDon: string | null; ngayThu: Date };
  nguoiKhieuNai: { id: string; ten: string };
  nguoiXuLy: { id: string; ten: string } | null;
  centerId: string;
  coSoTen: string;
  /** Mã ngắn của cơ sở ("CS1") — cột bảng hẹp; tên đầy đủ nằm ở `coSoTen`. */
  coSoMa: string;
  taoLuc: Date;
  nhanLuc: Date | null;
  quyetLuc: Date | null;
  /** Số ngày đã mở (làm tròn xuống), tính từ `taoLuc` tới `now`. Chỉ có nghĩa khi còn đang mở. */
  soNgayMo: number;
  laCuaToi: boolean;
};

export type KetQuaDanhSach = { dong: DongKhieuNai[]; tongSo: number; trang: number; coTrang: number; soDangMo: number };

const SELECT_DONG = {
  id: true,
  status: true,
  resolution: true,
  decidedAt: true,
  closedAt: true,
  createdAt: true,
  assignedAt: true,
  centerId: true,
  raisedByUserId: true,
  assignedToUserId: true,
  raisedBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  transaction: { select: { roleCode: true, amount: true, naturalPeriod: true, beneficiaryName: true } },
  payment: { select: { amount: true, paidDate: true, order: { select: { code: true } } } },
} satisfies Prisma.CommissionDisputeSelect;

type DongTho = Prisma.CommissionDisputeGetPayload<{ select: typeof SELECT_DONG }>;

const tenNguoi = (u: { id: string; name: string | null; email: string | null }) => u.name ?? u.email ?? u.id;
const MS_NGAY = 24 * 60 * 60 * 1000;

function anhXa(d: DongTho, coSo: ReadonlyMap<string, { ten: string; ma: string }>, now: Date, userId: string): DongKhieuNai {
  const dich: DongKhieuNai["dich"] = d.transaction
    ? { loai: "DONG", vai: d.transaction.roleCode, soTien: d.transaction.amount, ky: d.transaction.naturalPeriod, nguoiHuong: d.transaction.beneficiaryName }
    : { loai: "KHOAN", soTien: d.payment?.amount ?? 0, maDon: d.payment?.order?.code ?? null, ngayThu: d.payment?.paidDate ?? d.createdAt };
  return {
    id: d.id,
    trangThai: d.status,
    ketQua: ketQuaKhieuNai({ status: d.status, resolution: d.resolution, decidedAt: d.decidedAt }),
    dich,
    nguoiKhieuNai: { id: d.raisedBy.id, ten: tenNguoi(d.raisedBy) },
    nguoiXuLy: d.assignedTo ? { id: d.assignedTo.id, ten: tenNguoi(d.assignedTo) } : null,
    centerId: d.centerId,
    coSoTen: coSo.get(d.centerId)?.ten ?? d.centerId,
    coSoMa: coSo.get(d.centerId)?.ma ?? d.centerId,
    taoLuc: d.createdAt,
    nhanLuc: d.assignedAt,
    quyetLuc: d.decidedAt,
    soNgayMo: Math.max(0, Math.floor((now.getTime() - d.createdAt.getTime()) / MS_NGAY)),
    laCuaToi: d.raisedByUserId === userId,
  };
}

const COT_TRANG_THAI: Record<LocTrangThai, Prisma.CommissionDisputeWhereInput> = {
  DANG_MO: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
  // "Đã quyết" = đã có quyết định (APPROVED chờ đóng "sửa nguồn" cũng tính) — gồm cả bị từ chối rồi đóng.
  DA_QUYET: { status: { in: ["APPROVED", "REJECTED", "CLOSED"] } },
  TAT_CA: {},
};

export async function docDanhSachKhieuNai(client: Khach, actor: Actor, boLoc: BoLocKhieuNai, now: Date): Promise<KetQuaDanhSach> {
  const pv = phamViKhieuNai(actor);
  const dieuKien: Prisma.CommissionDisputeWhereInput[] = [pv.where, COT_TRANG_THAI[boLoc.trangThai ?? "DANG_MO"]];
  if (boLoc.centerId) dieuKien.push({ centerId: boLoc.centerId });
  if (boLoc.chiCuaToi) dieuKien.push({ raisedByUserId: actor.userId });
  const where: Prisma.CommissionDisputeWhereInput = { AND: dieuKien };

  const coTrang = Math.min(Math.max(boLoc.coTrang ?? 25, 1), 100);
  const trang = Math.max(boLoc.trang ?? 1, 1);
  const [rows, tongSo, soDangMo] = await Promise.all([
    client.commissionDispute.findMany({
      where,
      select: SELECT_DONG,
      // Đang mở: cũ nhất lên đầu (việc chờ lâu nhất phải thấy trước); đã quyết: mới nhất lên đầu.
      orderBy: boLoc.trangThai === "DA_QUYET" || boLoc.trangThai === "TAT_CA" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }],
      skip: (trang - 1) * coTrang,
      take: coTrang,
    }),
    client.commissionDispute.count({ where }),
    client.commissionDispute.count({ where: { AND: [pv.where, COT_TRANG_THAI.DANG_MO] } }),
  ]);
  const ids = [...new Set(rows.map((r) => r.centerId))];
  const cs = ids.length ? await client.center.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } }) : [];
  const coSo = new Map(cs.map((c) => [c.id, { ten: c.name, ma: c.code ?? c.name }]));
  return { dong: rows.map((r) => anhXa(r, coSo, now, actor.userId)), tongSo, trang, coTrang, soDangMo };
}

/** Số khiếu nại ĐANG MỞ trong phạm vi người xem — pill của tab. Người xem chỉ giữ quyền gửi (không duyệt) thì KHÔNG đếm (đó không phải việc chờ họ xử lý). */
export async function demKhieuNaiCanXuLy(client: Khach, actor: Actor): Promise<number | null> {
  if (!can(actor, KEY_DUYET_KHIEU_NAI)) return null;
  const pv = phamViKhieuNai(actor);
  // Chỉ phần phạm vi DUYỆT (không tính khiếu nại do chính mình gửi: HR không xử lý được chúng).
  const phamViDuyet: Prisma.CommissionDisputeWhereInput = pv.tamCoSo === "ALL" || pv.tamCoSo === null ? {} : { centerId: { in: [...pv.tamCoSo] } };
  return client.commissionDispute.count({ where: { AND: [phamViDuyet, { raisedByUserId: { not: actor.userId } }, COT_TRANG_THAI.DANG_MO] } });
}

// ── Chi tiết ───────────────────────────────────────────────────────────────────────────────────

export type MucLichSu = { luc: Date; hanhDong: string; nguoi: string; lyDo: string | null };

export type DongCuaKhoan = { id: string; vai: string; nguoiHuong: string; soTien: number; loaiDong: string; ky: string; coO: boolean };

export type ChiTietKhieuNai = {
  id: string;
  trangThai: TrangThaiKhieuNai;
  ketQua: KetQuaKhieuNai;
  resolution: CachGiaiKhieuNai | null;
  lyDo: string;
  /** Mục ghi chú bằng chứng (chỉ dạng `{ ghiChu }` được nhận). */
  bangChung: string[];
  quyetDinh: { lyDo: string; nguoi: string | null; luc: Date } | null;
  dongDieuChinh: { soTien: number; ky: string } | null;
  dich:
    | { loai: "DONG"; dongId: string; vai: string; soTien: number; ky: string; nguoiHuong: string; viSao: ViSao | null }
    | {
        loai: "KHOAN";
        paymentId: string;
        soTien: number;
        ngayThu: Date;
        maDon: string | null;
        /** Chỉ người DUYỆT thấy các dòng của người khác. */
        dongCuaKhoan: DongCuaKhoan[] | null;
      };
  nguoiKhieuNai: { id: string; ten: string };
  nguoiXuLy: { id: string; ten: string } | null;
  centerId: string;
  coSoTen: string;
  taoLuc: Date;
  lichSu: MucLichSu[];
  viec: ViecDuocLam;
  /** Với 'sửa nguồn': đã có dòng điều chỉnh do đổi nguồn chưa — quyết định nút "Đóng" sáng hay chỉ nêu lý do. */
  daCoDongDoiNguon: boolean | null;
  /** Dữ liệu cho form quyết định (chỉ người duyệt). */
  choQuyet: { vai: { code: string; ten: string }[]; ungVienXuLy: { id: string; ten: string }[] } | null;
};

function mucBangChung(ev: Prisma.JsonValue): string[] {
  if (!Array.isArray(ev)) return [];
  return ev.flatMap((m) => (m && typeof m === "object" && !Array.isArray(m) && typeof (m as Record<string, unknown>).ghiChu === "string" ? [(m as { ghiChu: string }).ghiChu] : []));
}

const HANH_DONG_NHAN: Record<string, string> = {
  CREATE: "Gửi khiếu nại",
  ASSIGN: "Nhận xử lý",
  REASSIGN: "Giao lại",
  DECIDE: "Quyết định",
  CLOSE: "Đóng khiếu nại",
};

export async function docChiTietKhieuNai(
  client: Khach,
  actor: Actor,
  id: string,
  ungVienXuLy: (centerId: string) => Promise<{ id: string; ten: string }[]>,
): Promise<ChiTietKhieuNai | null> {
  const pv = phamViKhieuNai(actor);
  const d = await client.commissionDispute.findFirst({
    where: { AND: [{ id }, pv.where] },
    select: {
      ...SELECT_DONG,
      reason: true,
      evidence: true,
      decisionReason: true,
      decidedById: true,
      transactionId: true,
      paymentId: true,
      resolutionEntryId: true,
      orgUnitId: true,
      transaction: { select: { id: true, roleCode: true, amount: true, naturalPeriod: true, beneficiaryName: true } },
    },
  });
  if (!d) return null;

  const hienTongTiLe = pv.tamCoSo === "ALL" || (pv.tamCoSo !== null && pv.tamCoSo.includes(d.centerId));

  const [dong, cs, nhatKy, quyetNguoi, dieuChinh] = await Promise.all([
    d.transactionId ? docDongDeGiaiThich(client, d.transactionId, hienTongTiLe) : Promise.resolve(null),
    client.center.findUnique({ where: { id: d.centerId }, select: { name: true, code: true } }),
    client.auditLog.findMany({
      where: { entityType: ENTITY_KHIEU_NAI, entityId: d.id, module: MODULE_AUDIT_HOA_HONG },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true, action: true, actorName: true, reason: true },
    }),
    d.decidedById ? client.user.findUnique({ where: { id: d.decidedById }, select: { id: true, name: true, email: true } }) : Promise.resolve(null),
    d.resolutionEntryId ? client.commissionTransaction.findUnique({ where: { id: d.resolutionEntryId }, select: { amount: true, period: { select: { period: true } } } }) : Promise.resolve(null),
  ]);

  const viec = viecDuocLam(
    { userId: actor.userId, coQuyenDuyet: pv.duyet },
    { status: d.status, raisedByUserId: d.raisedByUserId, assignedToUserId: d.assignedToUserId, resolution: d.resolution },
  );

  const dich: ChiTietKhieuNai["dich"] = d.transactionId
    ? {
        loai: "DONG",
        dongId: d.transactionId,
        vai: d.transaction?.roleCode ?? "",
        soTien: d.transaction?.amount ?? 0,
        ky: d.transaction?.naturalPeriod ?? "",
        nguoiHuong: d.transaction?.beneficiaryName ?? "",
        viSao: dong,
      }
    : {
        loai: "KHOAN",
        paymentId: d.paymentId!,
        soTien: d.payment?.amount ?? 0,
        ngayThu: d.payment?.paidDate ?? d.createdAt,
        maDon: d.payment?.order?.code ?? null,
        dongCuaKhoan: pv.duyet ? await docDongCuaKhoan(client, d.paymentId!) : null,
      };

  let daCoDongDoiNguon: boolean | null = null;
  if (d.status === "APPROVED" && d.resolution === "SOURCE_CORRECTION") {
    daCoDongDoiNguon = (await demDongDoiNguonSauKhiGui(client, d)).soDong > 0;
  }

  const choQuyet =
    pv.duyet && (viec.quyet || viec.nhan || viec.nhanLai || viec.giao)
      ? {
          vai: (await client.beneficiaryRole.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { code: true, name: true } })).map((v) => ({ code: v.code, ten: v.name })),
          ungVienXuLy: (await ungVienXuLy(d.centerId)).filter((u) => u.id !== d.raisedByUserId),
        }
      : null;

  const coSo = new Map([[d.centerId, { ten: cs?.name ?? d.centerId, ma: cs?.code ?? cs?.name ?? d.centerId }]]);
  const dongTom = anhXa(d, coSo, new Date(0), actor.userId);
  return {
    id: d.id,
    trangThai: d.status,
    ketQua: dongTom.ketQua,
    resolution: d.resolution,
    lyDo: d.reason,
    bangChung: mucBangChung(d.evidence),
    quyetDinh: d.decidedAt && d.decisionReason ? { lyDo: d.decisionReason, nguoi: quyetNguoi ? tenNguoi(quyetNguoi) : null, luc: d.decidedAt } : null,
    dongDieuChinh: dieuChinh ? { soTien: dieuChinh.amount, ky: dieuChinh.period.period } : null,
    dich,
    nguoiKhieuNai: dongTom.nguoiKhieuNai,
    nguoiXuLy: dongTom.nguoiXuLy,
    centerId: d.centerId,
    coSoTen: dongTom.coSoTen,
    taoLuc: d.createdAt,
    lichSu: nhatKy.map((n) => ({ luc: n.createdAt, hanhDong: HANH_DONG_NHAN[n.action] ?? n.action, nguoi: n.actorName, lyDo: n.reason })),
    viec,
    daCoDongDoiNguon,
    choQuyet,
  };
}

/** "Vì sao" của dòng bị khiếu nại — dựng từ ẢNH CHỤP trên chính dòng (không đọc chính sách live), cùng hàm `dungViSao` với ngăn của tab Sổ. */
async function docDongDeGiaiThich(client: Khach, transactionId: string, hienTongTiLe: boolean): Promise<ViSao | null> {
  const d = await client.commissionTransaction.findUnique({
    where: { id: transactionId },
    select: {
      entryKind: true,
      amount: true,
      grossAmount: true,
      vatRate: true,
      netBase: true,
      rate: true,
      fixedAmount: true,
      capRate: true,
      equivalentRate: true,
      sourceGroupCode: true,
      transactionTypeCode: true,
      roleCode: true,
      splitMethod: true,
      documentNumber: true,
      versionNo: true,
      calcKind: true,
      reason: true,
      reasonCode: true,
      naturalPeriod: true,
      period: { select: { period: true } },
      lateArrival: true,
      refEntryId: true,
      refEventType: true,
      refEventId: true,
      resolverBasis: true,
      paymentId: true,
    },
  });
  if (!d) return null;
  return dungViSao(
    {
      entryKind: d.entryKind,
      amount: d.amount,
      grossAmount: d.grossAmount,
      vatRate: Number(d.vatRate),
      netBase: d.netBase,
      rate: d.rate === null ? null : Number(d.rate),
      fixedAmount: d.fixedAmount,
      capRate: Number(d.capRate),
      equivalentRate: Number(d.equivalentRate),
      sourceGroupCode: d.sourceGroupCode,
      transactionTypeCode: d.transactionTypeCode,
      roleCode: d.roleCode,
      splitMethod: d.splitMethod,
      documentNumber: d.documentNumber,
      versionNo: d.versionNo,
      calcKind: d.calcKind,
      reason: d.reason,
      reasonCode: d.reasonCode,
      naturalPeriod: d.naturalPeriod,
      kyGhi: d.period.period,
      lateArrival: d.lateArrival,
      refEntryId: d.refEntryId,
      refEventType: d.refEventType,
      refEventId: d.refEventId,
      resolverBasis: d.resolverBasis,
      paymentId: d.paymentId,
    },
    hienTongTiLe,
  );
}

/** Các dòng sổ của một khoản thu — CHỈ cho người DUYỆT (chọn dòng mẫu); người khiếu nại chỉ có quan hệ nên không được thấy tiền của người khác. */
async function docDongCuaKhoan(client: Khach, paymentId: string): Promise<DongCuaKhoan[]> {
  const rows = await client.commissionTransaction.findMany({
    where: { OR: [{ paymentId }, { calcSlot: { paymentId } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 60,
    select: { id: true, roleCode: true, beneficiaryName: true, amount: true, entryKind: true, naturalPeriod: true, calcSlotId: true },
  });
  return rows.map((r) => ({ id: r.id, vai: r.roleCode, nguoiHuong: r.beneficiaryName, soTien: r.amount, loaiDong: r.entryKind, ky: r.naturalPeriod, coO: r.calcSlotId !== null }));
}

