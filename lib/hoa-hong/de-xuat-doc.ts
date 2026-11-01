// lib/hoa-hong/de-xuat-doc.ts — ĐỌC ĐỀ XUẤT ĐIỀU CHỈNH cho màn hình: danh sách · chi tiết · "việc tôi làm được". MỘT nơi quyết "ai thấy đề xuất nào" và "ai duyệt được cấp mấy".
//
// Nguồn: yêu cầu chủ dự án 10/10/2026 (hướng B+C): màn hiển thị Số tiền đề xuất · Giao dịch gốc · Lý do · Trạng thái duyệt · Reviewer 1 · Reviewer 2 · Kỳ ghi sổ; nút Duyệt cấp 1/cấp 2 CHỈ vẽ
// khi người xem có ĐÚNG quyền action hỏi + không vi phạm tách nhiệm. docs/source-commission/08 §16.
//
// ── Phạm vi người xem (HỢP của ba tập, fail-closed khi không có tập nào) ───────────────────────────
//   · đề xuất của KHIẾU NẠI: người giữ `commission_disputes:review` trong tầm nhìn cơ sở của nó, và CHÍNH NGƯỜI KHIẾU NẠI (người giữ `commission:view-self`) đọc đề xuất của khiếu nại mình;
//   · đề xuất ĐỔI NGUỒN: người giữ `commission_periods:manage` trong tầm nhìn cơ sở của nó.
// Không gác bằng tiền tố `commission:` của `getModelPrefixes` — tiền tố đó có `commission:view-self` (Sale) nên tầm nhìn cơ sở của nó KHÔNG phải quyền duyệt.
//
// "Việc tôi làm được" (`viec`) tính bằng CÙNG hai hàm với cổng của service duyệt — khoá `KHOA_DUYET_DE_XUAT` + `lyDoKhongDuocDuyet` — nên nút ở màn không thể sáng khi máy chủ sẽ từ chối (luật 12).
import type { Prisma, PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { tamNhinCuaKhoa } from "@/lib/auth/quyen-tai-co-so";
import { kepTrang } from "@/lib/nguon-hoa-hong/url";

import { chuLyDoQuanTri, docGoi } from "./de-xuat-dieu-chinh";
import { capKeTiepCuaDeXuat, type TrangThaiDeXuat } from "./de-xuat-nhan";
import { tachKhoaNguoi } from "./khoa-so";
import { KEY_TAO_KHIEU_NAI } from "./khieu-nai-ma";
import { KHOA_DUYET_DE_XUAT, lyDoKhongDuocDuyet, type LyDoQuanTri, type MucQuanTri, type NguonGocDeXuat } from "./quan-tri-dieu-chinh";
import { dinhDangDong } from "./vi-sao";

type Khach = PrismaClient | Prisma.TransactionClient;

export type NguoiTen = { id: string; ten: string };
export type DauDuyet = { nguoi: NguoiTen; luc: Date; lyDo: string };

export type DongGoiHienThi = { vai: string; nguoiHuong: string; chenh: number; kyVong: number; rong: number };

export type ViecDeXuat = {
  /** Cấp kế tiếp của đề xuất (suy từ trạng thái); `null` = đã kết thúc. */
  cap: 1 | 2 | null;
  /** Người xem duyệt được ở `cap` — đủ quyền ∧ đạt tách nhiệm. Đây là điều kiện VẼ NÚT. */
  duyet: boolean;
  /** Từ chối được ở bất kỳ cấp nào, cùng cổng với duyệt. */
  tuChoi: boolean;
  /** Vì sao KHÔNG làm được (câu cho giao diện); `null` khi làm được hoặc khi đề xuất đã kết thúc. */
  lyDoKhong: string | null;
};

export type DeXuatHienThi = {
  id: string;
  nguonGoc: NguonGocDeXuat;
  trangThai: TrangThaiDeXuat;
  quanTri: MucQuanTri;
  /** Số ĐỀ XUẤT: tổng ròng của gói (dương = trả thêm, âm = đòi lại) và giá trị tuyệt đối dùng để so ngưỡng. */
  soTien: { rong: number; tuyetDoi: number };
  giaoDichGoc: { paymentId: string; maDon: string | null; soTienThu: number; ngayThu: Date };
  goi: DongGoiHienThi[];
  /** Vì sao cần hai người (rỗng khi một người là đủ). */
  lyDoQuanTri: string[];
  canhBao: string[];
  /** Nội dung đề xuất: lý do cấp 1 ghi (khiếu nại) hoặc câu cố định của đổi nguồn. */
  lyDo: string;
  nguoiDeXuat: NguoiTen;
  capMot: DauDuyet | null;
  capHai: DauDuyet | null;
  tuChoi: { nguoi: NguoiTen; luc: Date; lyDo: string } | null;
  lyDoLoiThoi: string | null;
  /** Kỳ hoa hồng mà dòng điều chỉnh đã ghi vào ("2026-11"); `null` khi chưa ghi sổ. */
  kyGhiSo: string | null;
  coSoMa: string;
  coSoTen: string;
  disputeId: string | null;
  leadId: string | null;
  taoLuc: Date;
  viec: ViecDeXuat;
  /** Người xem giữ khoá duyệt của loại này ⇒ mở được tab con "Đề xuất điều chỉnh" (link). Người chỉ GỬI khiếu nại thấy đề xuất của mình trong Sheet nhưng KHÔNG có trang để mở. */
  moDuocTrang: boolean;
};

const LY_DO_DOI_NGUON = "Đổi nguồn của lead sau khi đã thu tiền làm thay đổi người hưởng hoặc tỉ lệ hoa hồng của giao dịch này.";

const SELECT = {
  id: true,
  origin: true,
  status: true,
  governance: true,
  governanceWhy: true,
  goi: true,
  absTotal: true,
  netTotal: true,
  canhBao: true,
  disputeId: true,
  leadId: true,
  paymentId: true,
  requestedById: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  approver1Id: true,
  approver1: { select: { id: true, name: true, email: true } },
  approver1At: true,
  approver1Reason: true,
  approver2: { select: { id: true, name: true, email: true } },
  approver2At: true,
  approver2Reason: true,
  rejectedBy: { select: { id: true, name: true, email: true } },
  rejectedAt: true,
  rejectedReason: true,
  closeReason: true,
  postingPeriod: { select: { period: true } },
  centerId: true,
  createdAt: true,
  payment: { select: { amount: true, paidDate: true, order: { select: { code: true } } } },
} satisfies Prisma.CommissionAdjustmentRequestSelect;

type DongTho = Prisma.CommissionAdjustmentRequestGetPayload<{ select: typeof SELECT }>;

const tenNguoi = (u: { id: string; name: string | null; email: string | null }): NguoiTen => ({ id: u.id, ten: u.name ?? u.email ?? u.id });

/** Điều kiện `where` của phạm vi người xem; `null` = không thấy gì (fail-closed). */
export function phamViDeXuat(actor: Actor): Prisma.CommissionAdjustmentRequestWhereInput | null {
  const phan: Prisma.CommissionAdjustmentRequestWhereInput[] = [];
  // Mỗi nguồn gốc đo tầm nhìn từ CHÍNH khoá duyệt của nó — không gộp theo tiền tố `commission_*:` (khoá view-self/manage ở cơ sở khác không mở đề xuất của người khác ở đó).
  const theoCoSo = (khoa: string): Prisma.CommissionAdjustmentRequestWhereInput => {
    const t = tamNhinCuaKhoa(actor, khoa);
    return t === "ALL" ? {} : { centerId: { in: [...t] } };
  };
  if (can(actor, KHOA_DUYET_DE_XUAT.DISPUTE)) phan.push({ AND: [{ origin: "DISPUTE" }, theoCoSo(KHOA_DUYET_DE_XUAT.DISPUTE)] });
  if (can(actor, KHOA_DUYET_DE_XUAT.SOURCE_CHANGE)) phan.push({ AND: [{ origin: "SOURCE_CHANGE" }, theoCoSo(KHOA_DUYET_DE_XUAT.SOURCE_CHANGE)] });
  if (can(actor, KEY_TAO_KHIEU_NAI)) phan.push({ origin: "DISPUTE", requestedById: actor.userId });
  return phan.length === 0 ? null : { OR: phan };
}

/** Việc người xem làm được với MỘT đề xuất — cùng hàm với cổng của service. Hàm thuần theo dữ liệu đã nạp (test không cần DB). */
export function viecCuaNguoiXem(
  actor: Actor,
  d: { nguonGoc: NguonGocDeXuat; trangThai: TrangThaiDeXuat; quanTri: MucQuanTri; requestedById: string; approver1Id: string | null; nguoiHuongTrongGoi: ReadonlySet<string> },
): ViecDeXuat {
  const cap = capKeTiepCuaDeXuat(d.trangThai);
  if (cap === null) return { cap, duyet: false, tuChoi: false, lyDoKhong: null };
  const khoa = KHOA_DUYET_DE_XUAT[d.nguonGoc];
  if (!can(actor, khoa)) return { cap, duyet: false, tuChoi: false, lyDoKhong: `Bạn không giữ quyền duyệt loại đề xuất này (${khoa}).` };
  const lyDo = lyDoKhongDuocDuyet({
    nguoiDuyetId: actor.userId,
    requestedById: d.requestedById,
    approver1Id: d.approver1Id,
    nguoiHuongTrongGoi: d.nguoiHuongTrongGoi,
    cap,
    quanTri: d.quanTri,
    trangThai: d.trangThai,
  });
  return { cap, duyet: lyDo === null, tuChoi: lyDo === null, lyDoKhong: lyDo };
}

function lyDoQuanTriCauChu(why: unknown): string[] {
  if (typeof why !== "object" || why === null || Array.isArray(why)) return [];
  const ds = (why as Record<string, unknown>).lyDo;
  if (!Array.isArray(ds)) return [];
  return ds.flatMap((l) => (typeof l === "object" && l !== null && typeof (l as { ma?: unknown }).ma === "string" ? [chuLyDoQuanTri(l as LyDoQuanTri, dinhDangDong)] : []));
}

async function anhXa(client: Khach, rows: DongTho[], actor: Actor): Promise<DeXuatHienThi[]> {
  const goiTheoDong = rows.map((r) => docGoi(r.goi));
  const userIds = new Set<string>();
  const affIds = new Set<string>();
  for (const goi of goiTheoDong) {
    for (const g of goi) {
      const t = tachKhoaNguoi(g.key);
      (t.kind === "USER" ? userIds : affIds).add(t.beneficiaryId);
    }
  }
  const coSoIds = [...new Set(rows.map((r) => r.centerId))];
  const [users, affs, cs] = await Promise.all([
    userIds.size ? client.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    affIds.size ? client.affiliate.findMany({ where: { id: { in: [...affIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    coSoIds.length ? client.center.findMany({ where: { id: { in: coSoIds } }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
  ]);
  const tenUser = new Map(users.map((u) => [u.id, tenNguoi(u).ten]));
  const tenAff = new Map(affs.map((a) => [a.id, a.name]));
  const coSo = new Map(cs.map((c) => [c.id, { ten: c.name, ma: c.code ?? c.name }]));

  return rows.map((r, i) => {
    const goi = goiTheoDong[i]!;
    const nguoiHuongTrongGoi = new Set<string>();
    const dongGoi: DongGoiHienThi[] = goi.map((g) => {
      const t = tachKhoaNguoi(g.key);
      if (t.kind === "USER") nguoiHuongTrongGoi.add(t.beneficiaryId);
      return { vai: t.roleCode, nguoiHuong: (t.kind === "USER" ? tenUser.get(t.beneficiaryId) : tenAff.get(t.beneficiaryId)) ?? t.beneficiaryId, chenh: g.chenh, kyVong: g.kyVong, rong: g.rong };
    });
    const trangThai: TrangThaiDeXuat = r.status;
    const lyDoCap1 = r.approver1Reason ?? "";
    return {
      id: r.id,
      nguonGoc: r.origin,
      trangThai,
      quanTri: r.governance,
      soTien: { rong: r.netTotal, tuyetDoi: r.absTotal },
      giaoDichGoc: { paymentId: r.paymentId, maDon: r.payment.order?.code ?? null, soTienThu: r.payment.amount, ngayThu: r.payment.paidDate },
      goi: dongGoi,
      lyDoQuanTri: lyDoQuanTriCauChu(r.governanceWhy),
      canhBao: Array.isArray(r.canhBao) ? (r.canhBao as unknown[]).filter((x): x is string => typeof x === "string") : [],
      lyDo: r.origin === "SOURCE_CHANGE" ? LY_DO_DOI_NGUON : lyDoCap1 || "—",
      nguoiDeXuat: tenNguoi(r.requestedBy),
      capMot: r.approver1 && r.approver1At ? { nguoi: tenNguoi(r.approver1), luc: r.approver1At, lyDo: lyDoCap1 } : null,
      capHai: r.approver2 && r.approver2At ? { nguoi: tenNguoi(r.approver2), luc: r.approver2At, lyDo: r.approver2Reason ?? "" } : null,
      tuChoi: r.rejectedBy && r.rejectedAt ? { nguoi: tenNguoi(r.rejectedBy), luc: r.rejectedAt, lyDo: r.rejectedReason ?? "" } : null,
      lyDoLoiThoi: trangThai === "STALE" ? r.closeReason : null,
      kyGhiSo: r.postingPeriod?.period ?? null,
      coSoMa: coSo.get(r.centerId)?.ma ?? r.centerId,
      coSoTen: coSo.get(r.centerId)?.ten ?? r.centerId,
      disputeId: r.disputeId,
      leadId: r.leadId,
      taoLuc: r.createdAt,
      moDuocTrang: can(actor, KHOA_DUYET_DE_XUAT[r.origin]),
      viec: viecCuaNguoiXem(actor, { nguonGoc: r.origin, trangThai, quanTri: r.governance, requestedById: r.requestedById, approver1Id: r.approver1Id, nguoiHuongTrongGoi }),
    };
  });
}

export type LocDeXuat = "DANG_MO" | "TAT_CA";

/** Cửa sổ trang của danh sách đề xuất: trang bị kẹp vào [1, số trang] (URL gõ bậy không ra trang rỗng) và số hàng phải bỏ qua. THUẦN (`[BCUI-31]`). */
export function cuaSoTrangDeXuat(trangTho: number, soMo: number, coTrang: number): { trang: number; boQua: number; soTrang: number } {
  const trang = kepTrang(trangTho, soMo, coTrang);
  return { trang, boQua: (trang - 1) * coTrang, soTrang: Math.max(1, Math.ceil(soMo / coTrang)) };
}

/**
 * Danh sách đề xuất trong phạm vi người xem, PHÂN TRANG phía máy chủ. Đang mở: cũ nhất lên đầu (chờ lâu nhất phải thấy trước); tất cả: mới nhất lên đầu.
 * `trang` là số THÔ từ URL: hàng đọc song song với phép đếm; chỉ khi trang rơi ngoài cuối (đếm > 0 mà không hàng nào) mới đọc lại đúng trang cuối.
 * Cỡ trang `gioiHan` bị chặn ở 100 — nên `soTrang` tính theo CỠ ĐÃ CHẶN, không theo số người gọi xin.
 */
export async function docDanhSachDeXuat(
  client: Khach,
  actor: Actor,
  boLoc: { loc: LocDeXuat; gioiHan: number; trang: number },
): Promise<{ dong: DeXuatHienThi[]; soDangMo: number; trang: number; soTrang: number }> {
  const pv = phamViDeXuat(actor);
  if (!pv) return { dong: [], soDangMo: 0, trang: 1, soTrang: 1 };
  const dangMo: Prisma.CommissionAdjustmentRequestWhereInput = { status: { in: ["PENDING", "APPROVED_L1"] } };
  const coTrang = Math.min(Math.max(boLoc.gioiHan, 1), 100);
  const doc = (boQua: number) =>
    client.commissionAdjustmentRequest.findMany({
      where: { AND: [pv, boLoc.loc === "DANG_MO" ? dangMo : {}] },
      select: SELECT,
      orderBy: boLoc.loc === "DANG_MO" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      skip: boQua,
      take: coTrang,
    });
  const [thoRows, soDangMo] = await Promise.all([
    doc(cuaSoTrangDeXuat(Math.min(boLoc.trang, 100_000), Number.MAX_SAFE_INTEGER, coTrang).boQua),
    client.commissionAdjustmentRequest.count({ where: { AND: [pv, dangMo] } }),
  ]);
  const cua = cuaSoTrangDeXuat(boLoc.trang, soDangMo, coTrang);
  const rows = thoRows.length === 0 && soDangMo > 0 && cua.boQua > 0 ? await doc(cua.boQua) : thoRows;
  return { dong: await anhXa(client, rows, actor), soDangMo, trang: cua.trang, soTrang: cua.soTrang };
}

/** Số đề xuất ĐANG MỞ trong phạm vi người xem — pill của tab con. `null` khi người xem không thuộc phạm vi nào (pill ẩn, không phải 0). */
export async function demDeXuatDangMo(client: Khach, actor: Actor): Promise<number | null> {
  const pv = phamViDeXuat(actor);
  if (!pv) return null;
  return client.commissionAdjustmentRequest.count({ where: { AND: [pv, { status: { in: ["PENDING", "APPROVED_L1"] } }] } });
}

/** Một đề xuất theo id; ngoài phạm vi ⇒ `null` (cùng câu "không mở được" với id không tồn tại — không lộ). */
export async function docMotDeXuat(client: Khach, actor: Actor, id: string): Promise<DeXuatHienThi | null> {
  const pv = phamViDeXuat(actor);
  if (!pv) return null;
  const r = await client.commissionAdjustmentRequest.findFirst({ where: { AND: [{ id }, pv] }, select: SELECT });
  if (!r) return null;
  return (await anhXa(client, [r], actor))[0] ?? null;
}

/** Đề xuất của MỘT khiếu nại (nếu có) — cho Sheet khiếu nại nói "đang chờ cấp hai". Cùng phạm vi người xem. */
export async function docDeXuatCuaKhieuNai(client: Khach, actor: Actor, disputeId: string): Promise<DeXuatHienThi | null> {
  const pv = phamViDeXuat(actor);
  if (!pv) return null;
  const r = await client.commissionAdjustmentRequest.findFirst({ where: { AND: [{ disputeId }, pv] }, select: SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!r) return null;
  return (await anhXa(client, [r], actor))[0] ?? null;
}
