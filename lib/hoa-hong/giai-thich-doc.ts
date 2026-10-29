// lib/hoa-hong/giai-thich-doc.ts — ĐỌC giải thích «vì sao 0đ» (`CommissionExplainLine`) cho người xem (Hướng G). Phần ghi ở `giai-thich-db.ts`, chữ ở `giai-thich-khong-tien.ts`.
//
// ── MỘT cổng phạm vi, cùng nguồn với sổ ────────────────────────────────────────────────────────────────────
// `dieuKienGiaiThich` dựng điều kiện từ CHÍNH `phamViNguoiXem` (cùng `can()` cho `commission:view-self` / `commission:view-center`, cùng `tamCoSo`): chủ nguồn chỉ có `view-self` thấy
// dòng có `beneficiaryUserId` là mình (con số «lẽ ra» của chính họ); QLCS thấy cơ sở mình quản; Hội sở thấy tất cả. Hàm này CHỈ ĐỔI KIỂU `where` (sổ ↔ bảng giải thích), không
// thêm quyền, không thêm khoá quyền mới (⇒ không cần `seed-prod-roles`). Thiếu cả hai key ⇒ `PermissionError` (fail-closed). Dòng ngoài tầm nhìn ⇒ `null` — KHÔNG ném lỗi riêng,
// để không lộ «dòng này có tồn tại».
//
// ── Đọc dòng giải thích KHÔNG phải đọc tiền ─────────────────────────────────────────────────────────────────
// «Lẽ ra X đ» là số của CHÍNH người hưởng dự kiến (hoặc của người có tầm nhìn cơ sở ĐÚNG cơ sở ấy). Không dòng nào ở đây vào tổng / kỳ / bảng chi / đối soát.
// Cờ `daCoTien` (đã có dòng sổ thật cho vai này) chỉ là MỘT boolean suy từ tổng ròng của ô — không rò số tiền của sổ.
import type { Prisma, PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can, PermissionError } from "@/lib/auth/can";

import { KEY_XEM_RIENG, phamViNguoiXem } from "./doc-so";
import { MA_LY_DO_GIAI_THICH, type ChiTietCuaSo, type DongGiaiThichDoc } from "./giai-thich-khong-tien";

type Khach = PrismaClient | Prisma.TransactionClient;

export type BoLocGiaiThich = {
  /** Kỳ TỰ NHIÊN (hiệu lực) của khoản thu — bảng giải thích không có kỳ ghi sổ. */
  thang?: string;
  centerId?: string;
  /** Người hưởng dự kiến — CHỈ có hiệu lực khi actor có `view-center`; ngược lại bị ép về chính actor. */
  nguoiHuong?: string;
  roleCode?: string;
  /** `LeadSourceGroup.code` ghi trên dòng (ảnh chụp lúc ghi). */
  nhomNguon?: string;
  trang?: number;
  coTrang?: number;
};

export type DongGiaiThichTrang = DongGiaiThichDoc & {
  calcSlotId: string;
  paymentId: string;
  centerId: string;
  naturalPeriod: string;
  nguoiHuong: { kind: "USER" | "AFFILIATE"; id: string; ten: string } | null;
  tenHocVien: string | null;
  netBase: number;
  /** ISO. */
  taoLuc: string;
};

export type KetQuaGiaiThich = { dong: DongGiaiThichTrang[]; tongSo: number; tongLeRa: number; trang: number; coTrang: number };

/**
 * Điều kiện phạm vi người xem cho bảng giải thích — dựng từ `phamViNguoiXem` (ném `PermissionError` khi thiếu cả hai key). Tầm nhìn «ALL» (vai neo Hội sở) = KHÔNG giới hạn.
 */
export function dieuKienGiaiThich(actor: Actor): { xemCoSo: boolean; tamCoSo: "ALL" | readonly string[] | null; dieuKien: Prisma.CommissionExplainLineWhereInput[] } {
  const { xemCoSo, tamCoSo } = phamViNguoiXem(actor);
  if (tamCoSo === "ALL") return { xemCoSo, tamCoSo, dieuKien: [] };
  const phamVi: Prisma.CommissionExplainLineWhereInput[] = [];
  if (can(actor, KEY_XEM_RIENG)) phamVi.push({ beneficiaryUserId: actor.userId });
  if (tamCoSo !== null) phamVi.push({ centerId: { in: [...tamCoSo] } });
  return { xemCoSo, tamCoSo, dieuKien: [{ OR: phamVi }] };
}

const COT = {
  id: true,
  calcSlotId: true,
  paymentId: true,
  roleCode: true,
  beneficiaryRoleId: true,
  beneficiaryKind: true,
  beneficiaryUserId: true,
  beneficiaryAffiliateId: true,
  beneficiaryName: true,
  reasonCode: true,
  sourceGroupId: true,
  policyId: true,
  versionNo: true,
  documentNumber: true,
  calcKind: true,
  rate: true,
  fixedAmount: true,
  wouldBeAmount: true,
  netBase: true,
  naturalPeriod: true,
  details: true,
  centerId: true,
  createdAt: true,
} satisfies Prisma.CommissionExplainLineSelect;

type Tho = Prisma.CommissionExplainLineGetPayload<{ select: typeof COT }>;

/** `details` là JSON do engine ghi — đọc phòng thủ; hỏng/thiếu ⇒ `null` (câu lý do rơi về dạng ngắn, không bịa số ngày). */
export function docChiTietCuaSo(v: unknown): ChiTietCuaSo | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.attributedAt !== "string" || typeof o.ngayThuDau !== "string" || typeof o.cuaSoNgay !== "number" || typeof o.hanGhiCong !== "string" || typeof o.soNgayTre !== "number") return null;
  return { attributedAt: o.attributedAt, ngayThuDau: o.ngayThuDau, cuaSoNgay: o.cuaSoNgay, hanGhiCong: o.hanGhiCong, soNgayTre: o.soNgayTre };
}

/** Làm giàu các dòng thô: TÊN (vai · nguồn · chính sách · học viên) và cờ `daCoTien`. Mọi tra cứu theo id đều là TẬP ĐÃ QUA cổng phạm vi — không mở thêm dòng nào. */
async function lamGiau(client: Khach, rows: readonly Tho[]): Promise<DongGiaiThichTrang[]> {
  if (rows.length === 0) return [];
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const slotIds = uniq(rows.map((r) => r.calcSlotId));
  const paymentIds = uniq(rows.map((r) => r.paymentId));
  const [vai, nhom, cs, tien, khoan] = await Promise.all([
    client.beneficiaryRole.findMany({ where: { id: { in: uniq(rows.map((r) => r.beneficiaryRoleId)) } }, select: { id: true, name: true } }),
    client.leadSourceGroup.findMany({ where: { id: { in: uniq(rows.map((r) => r.sourceGroupId)) } }, select: { id: true, name: true } }),
    client.commissionPolicy.findMany({ where: { id: { in: uniq(rows.map((r) => r.policyId)) } }, select: { id: true, name: true } }),
    // Tổng ròng theo (ô × vai × người) ở SỔ — chỉ để suy boolean `daCoTien`.
    client.commissionTransaction.groupBy({ by: ["calcSlotId", "roleCode", "beneficiaryUserId", "beneficiaryAffiliateId"], where: { calcSlotId: { in: slotIds } }, _sum: { amount: true } }),
    client.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, orderItem: { select: { student: { select: { name: true } }, enrollment: { select: { student: { select: { name: true } } } } } } } }),
  ]);
  const tenVai = new Map(vai.map((v) => [v.id, v.name]));
  const tenNhom = new Map(nhom.map((g) => [g.id, g.name]));
  const tenCs = new Map(cs.map((p) => [p.id, p.name]));
  const rong = new Map(tien.map((t) => [`${t.calcSlotId}|${t.roleCode}|${t.beneficiaryUserId ?? t.beneficiaryAffiliateId ?? "-"}`, t._sum.amount ?? 0]));
  const tenHv = new Map(khoan.map((p) => [p.id, p.orderItem?.student?.name ?? p.orderItem?.enrollment?.student?.name ?? null]));

  return rows.map((r) => {
    const idNguoi = r.beneficiaryUserId ?? r.beneficiaryAffiliateId;
    return {
      id: r.id,
      reasonCode: r.reasonCode,
      roleCode: r.roleCode,
      tenVai: tenVai.get(r.beneficiaryRoleId) ?? r.roleCode,
      tenNhom: tenNhom.get(r.sourceGroupId) ?? r.sourceGroupId,
      tenChinhSach: tenCs.get(r.policyId) ?? null,
      documentNumber: r.documentNumber,
      versionNo: r.versionNo,
      calcKind: r.calcKind,
      rate: r.rate === null ? null : Number(r.rate),
      fixedAmount: r.fixedAmount,
      wouldBeAmount: r.wouldBeAmount,
      chiTiet: docChiTietCuaSo(r.details),
      daCoTien: idNguoi !== null && (rong.get(`${r.calcSlotId}|${r.roleCode}|${idNguoi}`) ?? 0) > 0,
      calcSlotId: r.calcSlotId,
      paymentId: r.paymentId,
      centerId: r.centerId,
      naturalPeriod: r.naturalPeriod,
      nguoiHuong: r.beneficiaryKind && idNguoi ? { kind: r.beneficiaryKind, id: idNguoi, ten: r.beneficiaryName ?? idNguoi } : null,
      tenHocVien: tenHv.get(r.paymentId) ?? null,
      netBase: r.netBase,
      taoLuc: r.createdAt.toISOString(),
    };
  });
}

/** Trang «Không đủ điều kiện» của Sổ. MỘT hàm đọc cho giao diện và báo cáo — không ai dựng câu truy vấn thứ hai (luật 12b). */
export async function docGiaiThichKhongTien(client: Khach, actor: Actor, boLoc: BoLocGiaiThich): Promise<KetQuaGiaiThich> {
  const { xemCoSo, dieuKien } = dieuKienGiaiThich(actor);
  // `nguoiHuong` của người khác: chỉ người có `view-center` mới được chọn; ngược lại ÉP về chính mình (không ném lỗi, không lộ).
  const nguoiHuong = xemCoSo ? boLoc.nguoiHuong : actor.userId;
  if (nguoiHuong) dieuKien.push({ beneficiaryUserId: nguoiHuong });
  if (boLoc.thang) dieuKien.push({ naturalPeriod: boLoc.thang });
  if (boLoc.centerId) dieuKien.push({ centerId: boLoc.centerId });
  if (boLoc.roleCode) dieuKien.push({ roleCode: boLoc.roleCode });
  if (boLoc.nhomNguon) dieuKien.push({ sourceGroupCode: boLoc.nhomNguon });
  const where: Prisma.CommissionExplainLineWhereInput = { AND: dieuKien };
  const coTrang = Math.min(Math.max(boLoc.coTrang ?? 50, 1), 200);
  const trang = Math.max(boLoc.trang ?? 1, 1);
  const [rows, tong] = await Promise.all([
    client.commissionExplainLine.findMany({ where, select: COT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (trang - 1) * coTrang, take: coTrang }),
    client.commissionExplainLine.aggregate({ where, _count: { _all: true }, _sum: { wouldBeAmount: true } }),
  ]);
  return { dong: await lamGiau(client, rows), tongSo: tong._count._all, tongLeRa: tong._sum.wouldBeAmount ?? 0, trang, coTrang };
}

/** Số dòng giải thích trong tầm nhìn của người xem (cho nhãn «Không đủ điều kiện (N)» của công tắc góc nhìn). `centerId` = chip cơ sở đang chọn. */
export async function demGiaiThich(client: Khach, actor: Actor, centerId: string | null): Promise<number> {
  const { dieuKien } = dieuKienGiaiThich(actor);
  return client.commissionExplainLine.count({ where: { AND: [...dieuKien, ...(centerId ? [{ centerId }] : [])] } });
}

export type LuaChonGiaiThich = {
  /** Kỳ tự nhiên có dòng trong tầm nhìn, mới nhất trước. */
  thang: string[];
  vai: { code: string; ten: string }[];
  /** RỖNG với người chỉ có `view-self` — họ chỉ có chính mình. */
  nguoiHuong: { id: string; ten: string }[];
  nhomNguon: { code: string; ten: string }[];
};

/** Các lựa chọn của bộ lọc góc nhìn «Không đủ điều kiện»: kỳ và người lấy từ CHÍNH tập dòng người xem được thấy (không lộ «có kỳ/người nào ngoài tầm nhìn»); vai · nguồn là danh mục. */
export async function docLuaChonGiaiThich(client: Khach, actor: Actor): Promise<LuaChonGiaiThich> {
  const { xemCoSo, dieuKien } = dieuKienGiaiThich(actor);
  const where: Prisma.CommissionExplainLineWhereInput = { AND: dieuKien };
  const [ky, nguoi, vai, nhom] = await Promise.all([
    client.commissionExplainLine.findMany({ where, distinct: ["naturalPeriod"], select: { naturalPeriod: true }, orderBy: { naturalPeriod: "desc" }, take: 400 }),
    xemCoSo
      ? client.commissionExplainLine.groupBy({ by: ["beneficiaryUserId", "beneficiaryName"], where: { AND: [...dieuKien, { beneficiaryUserId: { not: null } }] }, orderBy: { beneficiaryName: "asc" }, take: 300 })
      : Promise.resolve([]),
    client.beneficiaryRole.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    client.leadSourceGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } }),
  ]);
  return {
    thang: ky.map((x) => x.naturalPeriod),
    // Tên trên dòng là ảnh chụp: cùng một người có thể mang hai tên ⇒ gộp theo id.
    nguoiHuong: [...new Map(nguoi.flatMap((n) => (n.beneficiaryUserId ? [[n.beneficiaryUserId, n.beneficiaryName ?? n.beneficiaryUserId] as const] : []))).entries()].map(([id, ten]) => ({ id, ten })),
    vai: vai.map((v) => ({ code: v.code, ten: v.name })),
    nhomNguon: nhom.map((g) => ({ code: g.code, ten: g.name })),
  };
}

/** MỘT dòng theo id. Ngoài tầm nhìn ⇒ `null` (không lộ tồn tại). */
export async function docGiaiThichTheoId(client: Khach, actor: Actor, id: string): Promise<DongGiaiThichTrang | null> {
  const { dieuKien } = dieuKienGiaiThich(actor);
  const r = await client.commissionExplainLine.findFirst({ where: { AND: [{ id }, ...dieuKien] }, select: COT });
  return r ? ((await lamGiau(client, [r]))[0] ?? null) : null;
}

/** Các dòng giải thích của MỘT ô tính mà người xem được thấy — cho mục «Vai không phát sinh tiền ở khoản này» của ngăn «Vì sao». */
export async function docGiaiThichCuaO(client: Khach, actor: Actor, calcSlotId: string): Promise<DongGiaiThichTrang[]> {
  const { dieuKien } = dieuKienGiaiThich(actor);
  const rows = await client.commissionExplainLine.findMany({ where: { AND: [{ calcSlotId }, ...dieuKien] }, select: COT, orderBy: [{ roleCode: "asc" }, { beneficiaryKey: "asc" }, { id: "asc" }] });
  return lamGiau(client, rows);
}

/**
 * Tóm tắt cho trang chi tiết nguồn: có bao nhiêu khoản NGOÀI cửa sổ và «lẽ ra» tổng bao nhiêu — CHỈ trong tầm nhìn của người xem. Người không có cả hai key hoa hồng ⇒ `null`
 * (trang không vẽ dòng này: không có quyền xem tiền thì không có chuyện «lẽ ra bao nhiêu»).
 */
export async function tomTatNgoaiCuaSoCuaNguon(client: Khach, actor: Actor, sourceGroupId: string): Promise<{ soKhoan: number; leRa: number } | null> {
  let dieuKien: Prisma.CommissionExplainLineWhereInput[];
  try {
    dieuKien = dieuKienGiaiThich(actor).dieuKien;
  } catch (e) {
    if (e instanceof PermissionError) return null;
    throw e;
  }
  const where: Prisma.CommissionExplainLineWhereInput = { AND: [{ sourceGroupId }, { reasonCode: { in: [...MA_LY_DO_GIAI_THICH] } }, ...dieuKien] };
  const [khoan, tong] = await Promise.all([
    client.commissionExplainLine.groupBy({ by: ["paymentId"], where }),
    client.commissionExplainLine.aggregate({ where, _sum: { wouldBeAmount: true } }),
  ]);
  return { soKhoan: khoan.length, leRa: tong._sum.wouldBeAmount ?? 0 };
}
