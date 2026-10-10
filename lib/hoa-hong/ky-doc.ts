// lib/hoa-hong/ky-doc.ts — ĐỌC cho màn "Kỳ hoa hồng" (06 §5.4): danh sách kỳ, kỳ đang chọn (số liệu · hàng chờ chặn · đầu vào trôi · phạm vi xuất ·
// lô chờ chi). Server Component và Server Action cùng gọi các hàm này — không ai dựng câu truy vấn thứ hai (luật 12b).
//
// ── Phạm vi ────────────────────────────────────────────────────────────────────────────────────────────
// Kỳ đi qua `scopedDb(actor)` (tầm nhìn cơ sở của người xem). Các số cộng (SQL thô, `groupBy` ngoài scope) chỉ chạy trên id kỳ ĐÃ qua `scopedDb` —
// QLCS CS1 không bao giờ nhận số của kỳ CS2 dù gõ đúng id.
// Hàng chờ CHẶN đếm theo `blockingPeriodId` KHÔNG qua scope: đó là phép đếm của CHÍNH cổng khoá (`demHangChoChan`), và con số hiện trên màn mà khác con số
// cổng dùng thì nút Khoá "nói dối" (luật 12). Kỳ đã nằm trong tầm nhìn nên hàng chờ chặn nó cũng là việc của người xem.
//
// ⚠️ Tiền là số nguyên VND. `SUM(int)` của Postgres là bigint ⇒ `::bigint` rồi `Number()` (cơ sở tính một tháng của một cơ sở có thể vượt 2^31).
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";

import { docMocCutover } from "./cutover";
import { dauVaoMoiNhat as docDauVaoMoiNhat, demHangChoChanTheoMa, tongHangChoChan, type HangChoChanTheoMa } from "./ky-service";
import { LOAI_DONG_DIEU_CHINH, LOAI_DONG_GHI_MOI, type SoLieuKy } from "./ky-man-hinh";
import { docHangChoSo } from "./hang-cho-so-doc";
import { KEY_XEM_CO_SO } from "./doc-so";
import { docKyTomTat } from "./ky-db";
import { kyGhiSo, type TrangThaiKy } from "./ky-hoa-hong";

export const CO_TRANG_KY = 25;

export type LoaiLo = "PAYROLL" | "EXTERNAL_SETTLEMENT";

/** Mốc cutover (`hoaHong.kyCutover`) — đọc THẲNG DB như engine (không qua cache 300 giây của `getSetting`). */
export async function docKyCutover(): Promise<string | null> {
  return docMocCutover(db);
}

// ── Số liệu của một hay nhiều kỳ ─────────────────────────────────────────────────────────────────────

export type TongHopKy = { coSoTinh: number; hoaHong: number; dieuChinh: number; soNguoi: number; soChan: number; chanTheoMa: HangChoChanTheoMa };
const TRONG: TongHopKy = { coSoTinh: 0, hoaHong: 0, dieuChinh: 0, soNguoi: 0, soChan: 0, chanTheoMa: {} };

/**
 * Tổng hợp theo kỳ (`ids` đã qua cổng phạm vi).
 *   · Cơ sở tính  = Σ `netBase` của các Ô TÍNH (mỗi ô một lần) có dòng ORIGINAL/LATE_ARRIVAL trong kỳ — cơ sở của các khoản MỚI ghi trong kỳ.
 *     Cố ý KHÔNG cộng `netBase` của từng dòng: một ô có nhiều dòng (nhiều vai × nhiều người) sẽ bị đếm nhiều lần.
 *   · Hoa hồng    = Σ `amount` các dòng ghi mới (ORIGINAL · LATE_ARRIVAL · PERIOD_BONUS).
 *   · Điều chỉnh  = Σ `amount` các dòng còn lại (hoàn tiền, đổi nguồn, đầu vào, khiếu nại) — thường âm. Hoa hồng + Điều chỉnh = số phải chi ròng.
 *   · Số người    = số người nhận khác nhau (nhân viên hoặc đối tác) có ≥ 1 dòng trong kỳ.
 *   · Chặn        = hàng chờ ĐANG MỞ mà kỳ này phải chờ — lấy từ `demHangChoChanTheoMa` của `ky-service`, CHÍNH hàm mà cổng khoá gọi (không có phép đếm thứ hai ở đây).
 */
export async function tongHopTheoKy(ids: readonly string[]): Promise<Map<string, TongHopKy>> {
  const ra = new Map<string, TongHopKy>();
  if (ids.length === 0) return ra;
  const dsId = Prisma.join([...ids]);
  const [tien, nen, chan] = await Promise.all([
    db.$queryRaw<{ periodId: string; hoaHong: bigint; dieuChinh: bigint; soNguoi: bigint }[]>`
      SELECT t."periodId",
        COALESCE(SUM(t."amount") FILTER (WHERE t."entryKind"::text IN (${Prisma.join([...LOAI_DONG_GHI_MOI])})), 0)::bigint AS "hoaHong",
        COALESCE(SUM(t."amount") FILTER (WHERE t."entryKind"::text IN (${Prisma.join([...LOAI_DONG_DIEU_CHINH])})), 0)::bigint AS "dieuChinh",
        COUNT(DISTINCT COALESCE(t."beneficiaryUserId", t."beneficiaryAffiliateId"))::bigint AS "soNguoi"
      FROM "CommissionTransaction" t
      WHERE t."periodId" IN (${dsId})
      GROUP BY t."periodId"`,
    db.$queryRaw<{ periodId: string; coSoTinh: bigint }[]>`
      SELECT x."periodId", COALESCE(SUM(s."netBase"), 0)::bigint AS "coSoTinh"
      FROM (
        SELECT DISTINCT "periodId", "calcSlotId" FROM "CommissionTransaction"
        WHERE "periodId" IN (${dsId}) AND "entryKind"::text IN ('ORIGINAL', 'LATE_ARRIVAL') AND "calcSlotId" IS NOT NULL
      ) x
      JOIN "CommissionCalcSlot" s ON s."id" = x."calcSlotId"
      GROUP BY x."periodId"`,
    demHangChoChanTheoMa(db, ids),
  ]);
  for (const id of ids) ra.set(id, { ...TRONG, chanTheoMa: {} });
  for (const r of tien) Object.assign(ra.get(r.periodId)!, { hoaHong: Number(r.hoaHong), dieuChinh: Number(r.dieuChinh), soNguoi: Number(r.soNguoi) });
  for (const r of nen) ra.get(r.periodId)!.coSoTinh = Number(r.coSoTinh);
  for (const [id, theoMa] of chan) Object.assign(ra.get(id)!, { chanTheoMa: theoMa, soChan: tongHangChoChan(theoMa) });
  return ra;
}

/** Bản chụp số liệu của MỘT kỳ — thứ hộp thoại khoá đã hiện và server so lại trước khi khoá. */
export async function chupSoLieuKy(periodId: string): Promise<SoLieuKy | null> {
  const k = await db.commissionPeriod.findUnique({ where: { id: periodId }, select: { lastCalculatedAt: true } });
  if (!k) return null;
  const t = (await tongHopTheoKy([periodId])).get(periodId) ?? TRONG;
  return { coSoTinh: t.coSoTinh, hoaHong: t.hoaHong, dieuChinh: t.dieuChinh, soNguoi: t.soNguoi, lastCalculatedAt: k.lastCalculatedAt?.toISOString() ?? null };
}

// ── Danh sách kỳ (phân trang Ở TẦNG TRUY VẤN) ────────────────────────────────────────────────────────

export type DongKy = {
  id: string;
  period: string;
  centerId: string;
  coSo: string;
  status: TrangThaiKy;
  coSoTinh: number;
  hoaHong: number;
  dieuChinh: number;
  soNguoi: number;
  soChan: number;
  lastCalculatedAt: Date | null;
  lockedAt: Date | null;
  /**
   * Tên người đã khoá kỳ (ghi lúc khoá: `lockedById`). `null` = KHÔNG BIẾT — kỳ khoá trước khi cột có giá trị, hoặc tài khoản ấy không còn; KHÔNG phải "chưa khoá"
   * (chưa khoá thì `lockedAt` cũng null). Chỉ có tên: không email, không id (màn kỳ là màn đọc rộng hơn màn nhân sự).
   */
  khoaBoi: string | null;
  exportedAt: Date | null;
  paidAt: Date | null;
};

export type DanhSachKy = { dong: DongKy[]; tong: number; trang: number; soTrang: number; coTrang: number };

export async function docDanhSachKy(actor: Actor, p: { trangThai: TrangThaiKy | null; trang: number }): Promise<DanhSachKy> {
  const sdb = scopedDb(actor);
  const where: Prisma.CommissionPeriodWhereInput = p.trangThai ? { status: p.trangThai } : {};
  const tong = await sdb.commissionPeriod.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / CO_TRANG_KY));
  const trang = Math.min(Math.max(1, Math.trunc(p.trang) || 1), soTrang);
  const rows = await sdb.commissionPeriod.findMany({
    where,
    orderBy: [{ period: "desc" }, { center: { code: "asc" } }, { id: "asc" }],
    skip: (trang - 1) * CO_TRANG_KY,
    take: CO_TRANG_KY,
    select: {
      id: true,
      period: true,
      centerId: true,
      status: true,
      lastCalculatedAt: true,
      lockedAt: true,
      lockedById: true,
      exportedAt: true,
      paidAt: true,
      center: { select: { code: true, name: true } },
    },
  });
  // Tên người khoá: MỘT lượt cho cả trang (≤ CO_TRANG_KY id, gộp trùng) — không findUnique trong vòng lặp. `User` miễn scope (SCOPE_EXEMPT: danh tính, đọc toàn cục): HO khoá kỳ CS1
  // vẫn hiện tên với QLCS CS1. Chỉ `name`.
  const idNguoiKhoa = [...new Set(rows.flatMap((r) => (r.lockedById ? [r.lockedById] : [])))];
  const [tongHop, nguoiKhoa] = await Promise.all([
    tongHopTheoKy(rows.map((r) => r.id)),
    idNguoiKhoa.length > 0 ? sdb.user.findMany({ where: { id: { in: idNguoiKhoa } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const tenNguoi = new Map(nguoiKhoa.map((u) => [u.id, u.name?.trim() || null] as const));
  const dong = rows.map((r): DongKy => {
    const t = tongHop.get(r.id) ?? TRONG;
    return {
      id: r.id,
      period: r.period,
      centerId: r.centerId,
      coSo: r.center.code ?? r.center.name,
      status: r.status,
      coSoTinh: t.coSoTinh,
      hoaHong: t.hoaHong,
      dieuChinh: t.dieuChinh,
      soNguoi: t.soNguoi,
      soChan: t.soChan,
      lastCalculatedAt: r.lastCalculatedAt,
      lockedAt: r.lockedAt,
      khoaBoi: r.lockedById ? (tenNguoi.get(r.lockedById) ?? null) : null,
      exportedAt: r.exportedAt,
      paidAt: r.paidAt,
    };
  });
  return { dong, tong, trang, soTrang, coTrang: CO_TRANG_KY };
}

// ── Kỳ đang chọn ──────────────────────────────────────────────────────────────────────────────────────

export type LoChi = { id: string; kind: LoaiLo; soDong: number; tongTien: number; taoLuc: Date };
export type PhamViXuat = { centerId: string; coSo: string; status: TrangThaiKy; soDongNoiBo: number; tienNoiBo: number; soDongNgoai: number; tienNgoai: number };

export type KyDangChon = {
  id: string;
  period: string;
  centerId: string;
  orgUnitId: string;
  status: TrangThaiKy;
  lastCalculatedAt: Date | null;
  reviewStartedAt: Date | null;
  lockedAt: Date | null;
  exportedAt: Date | null;
  paidAt: Date | null;
};

export type ManHinhKy = {
  ky: KyDangChon | null;
  soLieu: TongHopKy;
  chanTheoMa: HangChoChanTheoMa;
  /** Mốc MỚI NHẤT của đầu vào (chỉ tính khi kỳ ở CALCULATED/REVIEWING — chỗ cổng dùng nó). */
  dauVaoMoiNhat: Date | null;
  /**
   * Hàng chờ mềm KHÔNG chặn: nhóm «Chưa phân giải người hưởng» của cơ sở này — lấy từ `docHangChoSo` (định nghĩa chung với tab Sổ, không đếm lại).
   * `null` = người xem không có quyền đọc hàng chờ (cần `commission:view-center`): "không biết", KHÔNG phải "0".
   */
  treo: number | null;
  chuaXuat: { noiBo: number; ngoai: number };
  loChoChi: LoChi[];
  /** Các kỳ khoá/đã xuất CỦA THÁNG trong tầm nhìn của người xem — chính là tập mà lượt Xuất sẽ gom. */
  phamViXuat: PhamViXuat[];
  /** Số kỳ của tháng trong tầm nhìn nhưng CHƯA khoá (không vào lô). */
  soKyChuaKhoa: number;
  /** Kỳ mà dòng sinh ra SAU khi kỳ này khoá sẽ rơi vào (H22: kỳ OPEN kế tiếp, kỳ cũ không mở lại). Chỉ tính khi kỳ đang rà soát. */
  kyGhiTiep: string | null;
};

const DK_NOI_BO: Prisma.CommissionTransactionWhereInput = { beneficiaryKind: "USER", beneficiaryEmployeeId: { not: null } };

export async function docManHinhKy(actor: Actor, p: { thang: string; centerId: string; kyCutover: string }): Promise<ManHinhKy> {
  const sdb = scopedDb(actor);
  const k = await sdb.commissionPeriod.findFirst({
    where: { period: p.thang, centerId: p.centerId },
    select: {
      id: true,
      period: true,
      centerId: true,
      orgUnitId: true,
      status: true,
      lastCalculatedAt: true,
      reviewStartedAt: true,
      lockedAt: true,
      exportedAt: true,
      paidAt: true,
    },
  });
  const treo = can(actor, KEY_XEM_CO_SO)
    ? (await docHangChoSo(db, actor, { nhom: "CHUA_PHAN_GIAI_NGUOI_HUONG", centerId: p.centerId, trang: 1, coTrang: 1 })).dem.CHUA_PHAN_GIAI_NGUOI_HUONG
    : null;
  const rong: ManHinhKy = { ky: null, soLieu: { ...TRONG }, chanTheoMa: {}, dauVaoMoiNhat: null, treo, chuaXuat: { noiBo: 0, ngoai: 0 }, loChoChi: [], phamViXuat: [], soKyChuaKhoa: 0, kyGhiTiep: null };
  if (!k) return rong;

  const [tongHop, moiNhat] = await Promise.all([
    tongHopTheoKy([k.id]),
    k.status === "CALCULATED" || k.status === "REVIEWING" ? docDauVaoMoiNhat(db, k) : Promise.resolve(null),
  ]);
  const soLieu = tongHop.get(k.id) ?? { ...TRONG };

  const kyGhiTiep =
    k.status === "REVIEWING"
      ? kyGhiSo({ kyTuNhien: p.thang, orgUnitId: k.orgUnitId, kyCutover: p.kyCutover, ky: await docKyTomTat(db, k.orgUnitId, p.thang) })
      : null;
  const ra: ManHinhKy = { ...rong, ky: k, soLieu, chanTheoMa: soLieu.chanTheoMa, dauVaoMoiNhat: moiNhat, kyGhiTiep };
  if (k.status !== "LOCKED" && k.status !== "EXPORTED" && k.status !== "PAID") return ra;

  // Phần chi trả: tập kỳ của THÁNG trong tầm nhìn (lượt Xuất gom theo THÁNG, không theo một kỳ).
  const kyThang = await sdb.commissionPeriod.findMany({
    where: { period: p.thang },
    select: { id: true, status: true, centerId: true, center: { select: { code: true, name: true } } },
  });
  const kyKhoa = kyThang.filter((x) => x.status === "LOCKED" || x.status === "EXPORTED");
  const idKhoa = kyKhoa.map((x) => x.id);
  const idMoi = kyThang.map((x) => x.id);
  const chuaVaoLo = { periodId: { in: idKhoa }, payoutBatchId: null, payoutStatus: "APPROVED" as const };
  const [noiBo, ngoai, lo] = await Promise.all([
    db.commissionTransaction.groupBy({ by: ["periodId"], where: { ...chuaVaoLo, ...DK_NOI_BO }, _count: { _all: true }, _sum: { amount: true } }),
    db.commissionTransaction.groupBy({ by: ["periodId"], where: { ...chuaVaoLo, NOT: DK_NOI_BO }, _count: { _all: true }, _sum: { amount: true } }),
    // Lô mà MỌI dòng nằm trong kỳ thuộc tầm nhìn (đánh dấu đã chi sẽ từ chối lô có kỳ ngoài phạm vi) và có dòng ở kỳ đang chọn.
    db.commissionPayoutBatch.findMany({
      where: { month: p.thang, status: "EXPORTED", entries: { some: { periodId: k.id }, none: { periodId: { notIn: idMoi } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, lineCount: true, totalAmount: true, createdAt: true },
    }),
  ]);
  const theoKy = (xs: typeof noiBo) => new Map(xs.map((x) => [x.periodId, { n: x._count._all, tien: x._sum.amount ?? 0 }]));
  const nb = theoKy(noiBo);
  const ng = theoKy(ngoai);
  ra.phamViXuat = kyKhoa
    .map((x): PhamViXuat => ({
      centerId: x.centerId,
      coSo: x.center.code ?? x.center.name,
      status: x.status,
      soDongNoiBo: nb.get(x.id)?.n ?? 0,
      tienNoiBo: nb.get(x.id)?.tien ?? 0,
      soDongNgoai: ng.get(x.id)?.n ?? 0,
      tienNgoai: ng.get(x.id)?.tien ?? 0,
    }))
    .sort((a, b) => (a.coSo < b.coSo ? -1 : 1));
  // "Chưa khoá" = còn đang tính/rà soát. Kỳ ĐÃ CHI (PAID) là kỳ đã xong, không phải kỳ chưa khoá — đếm nó là cảnh báo sai cho kế toán.
  ra.soKyChuaKhoa = kyThang.filter((x) => x.status === "OPEN" || x.status === "CALCULATED" || x.status === "REVIEWING").length;
  ra.chuaXuat = { noiBo: [...nb.values()].reduce((s, x) => s + x.n, 0), ngoai: [...ng.values()].reduce((s, x) => s + x.n, 0) };
  ra.loChoChi = lo.map((l) => ({ id: l.id, kind: l.kind, soDong: l.lineCount, tongTien: l.totalAmount, taoLuc: l.createdAt }));
  return ra;
}

/** Số hàng chờ chặn của MỌI kỳ chưa khoá trong tầm nhìn — cho pill tab "Kỳ" (06 §4.1: hàng chờ của tab Kỳ = hàng chờ CHẶN). */
export async function demHangChoChanTheoTamNhin(actor: Actor): Promise<number> {
  const sdb = scopedDb(actor);
  const ky = await sdb.commissionPeriod.findMany({ where: { status: { in: ["OPEN", "CALCULATED", "REVIEWING"] } }, select: { id: true } });
  if (ky.length === 0) return 0;
  const theoKy = await demHangChoChanTheoMa(db, ky.map((x) => x.id));
  return [...theoKy.values()].reduce((s, m) => s + tongHangChoChan(m), 0);
}

