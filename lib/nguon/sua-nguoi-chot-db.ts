// lib/nguon/sua-nguoi-chot-db.ts — TẦNG DB của «sửa Lead.convertedById legacy» (người chốt = tài khoản chạy import). Quyết định thuần ở `sua-nguoi-chot.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUY ƯỚC (khuôn `noi-don-db.ts`)
//
//   · Mọi hàm nhận client làm tham số BẮT BUỘC (`PrismaClient` hoặc `Prisma.TransactionClient`) — không import `db` dùng ngầm (luật 7).
//   · Số câu tra CỐ ĐỊNH, không theo số lead (bài học `goiYDon`/P2028). Đọc 1 lần các bảng lớn, gom bằng Map trong bộ nhớ.
//   · Chạy thử nằm trong transaction READ ONLY rồi `throw`; phép GHI nằm trong MỘT transaction duy nhất, và LẬP LẠI kế hoạch TRONG transaction
//     (dưới khoá `FOR UPDATE` trên lead ứng viên) — kế hoạch đọc ngoài tx chỉ để báo sớm.
//   · Phép ghi `updateMany` CÓ ĐIỀU KIỆN `convertedById = <cũ trong kế hoạch>`: lệch ⇒ `throw` (cả batch lùi, KHÔNG skip từng dòng — chứng minh an toàn nhất).
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { pickEffectiveRates } from "@/lib/crm/commission-config";
import { SELECT_HOA_HONG, SELECT_PHAN_CONG, mapButToanHoaHong, thongKe } from "@/lib/crm/commission-run";
import { kyCuaButToan, khoangKy, tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { docKeHoachNoiDon, docTrangThaiKy } from "@/lib/nguon/noi-don-db";
import { vaLeadTrongBoNho, type UngVienLead } from "@/lib/nguon/noi-don";
import type { QuyetDinhOwner } from "@/lib/nguon/sua-nguoi-chot-quyet-dinh";
import {
  HANH_DONG_SUA_LEAD,
  HANH_DONG_SUA_LUOT,
  LOAI_THUC_THE_LUOT,
  dongHoanTacTuAudit,
  dungBanGhiLead,
  dungBanGhiLuotSua,
  khoaLuotChaySua,
  type LuotChaySua,
} from "@/lib/nguon/sua-nguoi-chot-audit";
import {
  LOP_OWNER_DOI,
  LY_DO_IMPORT,
  MA_LY_DO_SUA,
  MA_LY_DO_SUA_OWNER,
  laDongGhi,
  lapKeHoachSuaNguoiChot,
  leadSauKhiSua,
  nguoiChotMoiTheoLead,
  quyetDinhGhiSuaNguoiChot,
  vaNguoiChotTrongBoNho,
  type ChinhSachE2,
  type DauVaoKeHoach,
  type HangHanhDong,
  type DonLienQuan,
  type HangNguoiDung,
  type KeHoachSuaNguoiChot,
} from "@/lib/nguon/sua-nguoi-chot";

export type Client = PrismaClient | Prisma.TransactionClient;

/** Actor cố định của script. */
export const ACTOR_SUA_NGUOI_CHOT = { id: null, name: "Script sửa người chốt legacy (sua-nguoi-chot-legacy)" } as const;

/**
 * Phạm vi BẮT BUỘC (luật 7). Script truyền `"TAT_CA"`; ca test truyền đúng id lead fixture — không bao giờ quét cả DB của bộ test khác.
 */
export type PhamViSuaNguoiChot = "TAT_CA" | { leadIds: readonly string[] };

const locAudit = (phamVi: PhamViSuaNguoiChot): Prisma.AuditLogWhereInput =>
  phamVi === "TAT_CA" ? {} : { entityId: { in: [...phamVi.leadIds] } };

const locLeadTheoPhamVi = (phamVi: PhamViSuaNguoiChot): Prisma.LeadWhereInput =>
  phamVi === "TAT_CA" ? {} : { id: { in: [...phamVi.leadIds] } };

/** Lead ứng viên = lead CÓ dòng AuditLog `BACKFILL_IMPORT` (chuyển ĐÃ ĐĂNG KÝ do công cụ import). Một câu. */
export async function docIdLeadImport(c: Client, phamVi: PhamViSuaNguoiChot): Promise<string[]> {
  const rows = await c.auditLog.findMany({
    where: { module: "enrollment", entityType: "Lead", action: "STATUS_CHANGE", reason: { startsWith: LY_DO_IMPORT }, ...locAudit(phamVi) },
    select: { entityId: true },
    distinct: ["entityId"],
    orderBy: { entityId: "asc" },
  });
  return rows.map((r) => r.entityId);
}

const SELECT_NGUOI_DUNG = {
  id: true,
  name: true,
  role: true,
  roles: true,
  centerId: true,
  isActive: true,
  accountStatus: true,
  deletedAt: true,
  employee: { select: { status: true, employeeCode: true } },
} as const;

type NguoiDungDoc = Prisma.UserGetPayload<{ select: typeof SELECT_NGUOI_DUNG }>;

function mapNguoiDung(u: NguoiDungDoc): HangNguoiDung {
  return {
    id: u.id,
    name: u.name ?? "",
    vaiTro: [...new Set([u.role as string, ...u.roles.map((r) => r as string)])],
    centerId: u.centerId,
    hoatDong: u.isActive && u.accountStatus === "ACTIVE",
    daXoa: u.deletedAt !== null,
    trangThaiNhanSu: u.employee?.status ?? null,
    maNhanVien: u.employee?.employeeCode ?? null,
  };
}

/**
 * Đọc MỌI đầu vào của bộ lập kế hoạch bằng một số câu CỐ ĐỊNH. «Đơn liên quan» của lead = đơn đã nối (`Order.leadId`) ∪ đơn `noi-don` sẽ nối (MOT) —
 * `duong` ghi rõ đường nào, để không ai hiểu nhầm phạm vi phụ thuộc bộ khớp SĐT mà không biết.
 */
export async function docDauVaoSuaNguoiChot(c: Client, phamVi: PhamViSuaNguoiChot, quyetDinh: readonly QuyetDinhOwner[]): Promise<DauVaoKeHoach> {
  const imports = await c.auditLog.findMany({
    where: { module: "enrollment", entityType: "Lead", action: "STATUS_CHANGE", reason: { startsWith: LY_DO_IMPORT }, ...locAudit(phamVi) },
    select: { entityId: true, actorId: true, createdAt: true },
    orderBy: [{ entityId: "asc" }, { createdAt: "asc" }],
  });
  const leadIds = [...new Set(imports.map((x) => x.entityId))].sort();
  // Lead owner đã quyết: đọc THEO ID, độc lập với việc lead đang ở nhóm nào (sau khi ghi, lead ngoài mẫu đã đổi người chốt không còn rơi vào nhóm «ngoài mẫu»).
  const idQuyetDinh = [...new Set(quyetDinh.map((q) => q.leadId))].sort();
  const khoaRong = { leadCoSoMoi: new Set<string>(), leadCoDongKyDaDuyet: new Set<string>(), kyDaDuyet: new Set<string>() };
  if (leadIds.length === 0 && idQuyetDinh.length === 0) {
    return { leads: [], imports: [], lichSu: [], hanhDong: [], leadNgoaiMau: [], nguoiDung: [], don: [], khoa: khoaRong, quyetDinhOwner: [], leadQuyetDinh: [] };
  }
  const leadSet = new Set([...leadIds, ...idQuyetDinh]);
  const idCanKhoa = [...leadSet];

  const SELECT_LEAD = { id: true, convertedById: true, assignedToId: true, centerId: true, note: true, convertedAt: true, createdAt: true, deletedAt: true } as const;
  const leads = await c.lead.findMany({ where: { id: { in: leadIds } }, select: SELECT_LEAD });
  const leadQuyetDinh = await c.lead.findMany({ where: { id: { in: idQuyetDinh } }, select: SELECT_LEAD });

  // «Ngoài mẫu»: lead KHÔNG có BACKFILL_IMPORT mà do một tài khoản người-chạy-import chốt (cùng họ lỗi? — để người xem; không bao giờ ghi).
  const nguoiChayImport = [...new Set(imports.map((x) => x.actorId).filter((x): x is string => x !== null))];
  const ngoaiMau = nguoiChayImport.length
    ? await c.lead.findMany({ where: { deletedAt: null, convertedById: { in: nguoiChayImport }, id: { notIn: leadIds }, ...locLeadTheoPhamVi(phamVi) }, select: SELECT_LEAD })
    : [];
  const ngoaiMauIds = ngoaiMau.map((l) => l.id);
  const mauVaNgoai = [...new Set([...leadIds, ...ngoaiMauIds, ...idQuyetDinh])];
  const mauVaNgoaiSet = new Set(mauVaNgoai);

  // Đơn liên quan: ĐÃ NỐI ∪ noi-don MOT.
  const daNoi = await c.order.findMany({
    where: { deletedAt: null, leadId: { in: mauVaNgoai } },
    select: { id: true, code: true, centerId: true, leadId: true },
  });
  const { keHoach } = await docKeHoachNoiDon(c, "TAT_CA");
  const mot = keHoach.mot.filter((m) => mauVaNgoaiSet.has(m.lead.leadId));
  const donMot = mot.length
    ? await c.order.findMany({ where: { id: { in: mot.map((m) => m.orderId) } }, select: { id: true, code: true, centerId: true } })
    : [];
  const donIds = [...new Set([...daNoi.map((o) => o.id), ...donMot.map((o) => o.id)])];

  const butToan = donIds.length
    ? await c.payment.findMany({ where: { ...WHERE_THUC_THU, orderId: { in: donIds } }, select: { orderId: true, amount: true, paidDate: true } })
    : [];
  const thuTheoDon = new Map<string, { tong: number; ky: Set<string> }>();
  for (const b of butToan) {
    const g = thuTheoDon.get(b.orderId) ?? { tong: 0, ky: new Set<string>() };
    g.tong += b.amount;
    g.ky.add(kyCuaButToan(b.paidDate));
    thuTheoDon.set(b.orderId, g);
  }
  const lienQuan = (o: { id: string; code: string; centerId: string | null }, leadId: string, duong: DonLienQuan["duong"]): DonLienQuan => ({
    orderId: o.id,
    code: o.code,
    centerId: o.centerId,
    leadId,
    duong,
    thuTong: thuTheoDon.get(o.id)?.tong ?? 0,
    ky: [...(thuTheoDon.get(o.id)?.ky ?? [])].sort(),
  });
  const donMotTheoId = new Map(donMot.map((o) => [o.id, o] as const));
  const don: DonLienQuan[] = [
    ...daNoi.filter((o) => o.leadId !== null).map((o) => lienQuan(o, o.leadId as string, "DA_NOI")),
    ...mot.flatMap((m) => {
      const o = donMotTheoId.get(m.orderId);
      return o ? [lienQuan(o, m.lead.leadId, "NOI_DON_MOT")] : [];
    }),
  ];

  const lichSu = await c.leadStatusHistory.findMany({
    where: { leadId: { in: leadIds }, toStatus: "DA_DANG_KY" },
    select: { id: true, leadId: true, changedById: true, toStatus: true, createdAt: true },
  });

  // Dấu vết ĐỘC LẬP với file Excel: chính người đó có hành động trên lead (hoạt động · audit) hoặc có lần gán lead trỏ về họ.
  const [hoatDong, auditLead, ganLichSu, ganNhatKy] = await Promise.all([
    c.leadActivity.findMany({ where: { leadId: { in: leadIds }, actorId: { not: null } }, select: { leadId: true, actorId: true, createdAt: true } }),
    c.auditLog.findMany({ where: { entityType: "Lead", entityId: { in: leadIds }, actorId: { not: null } }, select: { entityId: true, actorId: true, createdAt: true } }),
    c.leadAssignmentHistory.findMany({ where: { leadId: { in: leadIds }, toUserId: { not: null } }, select: { leadId: true, toUserId: true, createdAt: true } }),
    c.leadAssignmentLog.findMany({ where: { leadId: { in: leadIds } }, select: { leadId: true, assignedToId: true, createdAt: true } }), // lọc `assignedToId` null ở dưới (lưới [SRC-ENT-14] cấm mẫu `assignedToId:` trong lib/nguon)
  ]);
  const hanhDong: HangHanhDong[] = [
    ...hoatDong.map((h) => ({ leadId: h.leadId, nguoi: h.actorId as string, luc: h.createdAt, loai: "HOAT_DONG" as const })),
    ...auditLead.map((h) => ({ leadId: h.entityId, nguoi: h.actorId as string, luc: h.createdAt, loai: "AUDIT" as const })),
    ...ganLichSu.map((h) => ({ leadId: h.leadId, nguoi: h.toUserId as string, luc: h.createdAt, loai: "GAN_LICH_SU" as const })),
    ...ganNhatKy.filter((h) => h.leadId !== null && h.assignedToId !== null).map((h) => ({ leadId: h.leadId as string, nguoi: h.assignedToId as string, luc: h.createdAt, loai: "GAN_NHAT_KY" as const })),
  ];

  // Người dùng: toàn bộ tài khoản KHÔNG phải phụ huynh (để tên Excel đối chiếu được cả người đã nghỉ), cộng id treo của người chốt/ gán.
  const nhanSu = await c.user.findMany({ where: { role: { not: "PARENT" } }, select: SELECT_NGUOI_DUNG });
  const co = new Set(nhanSu.map((u) => u.id));
  const thieu = [...new Set([...leads, ...leadQuyetDinh].flatMap((l) => [l.convertedById, l.assignedToId]).filter((x): x is string => x !== null && !co.has(x)))];
  const them = thieu.length ? await c.user.findMany({ where: { id: { in: thieu } }, select: SELECT_NGUOI_DUNG }) : [];

  // Dấu vết hoa hồng đã khoá.
  const soMoi = await c.commissionTransaction.findMany({
    where: { OR: [{ leadId: { in: idCanKhoa } }, ...(donIds.length ? [{ orderId: { in: donIds } }] : [])] },
    select: { leadId: true, orderId: true },
  });
  const leadCuaDon = new Map(don.map((d) => [d.orderId, d.leadId] as const));
  const leadCoSoMoi = new Set<string>();
  for (const t of soMoi) {
    if (t.leadId !== null && leadSet.has(t.leadId)) leadCoSoMoi.add(t.leadId);
    const l = t.orderId !== null ? leadCuaDon.get(t.orderId) : undefined;
    if (l !== undefined) leadCoSoMoi.add(l);
  }
  const dongKyDuyet = await c.commissionLine.findMany({
    where: { leadId: { in: idCanKhoa }, statement: { status: "APPROVED" } },
    select: { leadId: true },
  });
  const kyDuyet = await c.commissionStatement.findMany({ where: { status: "APPROVED" }, select: { period: true } });

  return {
    leads: leads.map((l) => ({ ...l })),
    imports: imports.map((x) => ({ leadId: x.entityId, actorId: x.actorId, luc: x.createdAt })),
    lichSu: lichSu.map((h) => ({ id: h.id, leadId: h.leadId, changedById: h.changedById, toStatus: h.toStatus as string, luc: h.createdAt })),
    hanhDong,
    leadNgoaiMau: ngoaiMau.map((l) => ({ ...l })),
    leadQuyetDinh: leadQuyetDinh.map((l) => ({ ...l })),
    quyetDinhOwner: [...quyetDinh],
    nguoiDung: [...nhanSu, ...them].map(mapNguoiDung),
    don,
    khoa: {
      leadCoSoMoi,
      leadCoDongKyDaDuyet: new Set(dongKyDuyet.map((d) => d.leadId).filter((x): x is string => x !== null)),
      kyDaDuyet: new Set(kyDuyet.map((k) => k.period)),
    },
  };
}

export async function docKeHoachSuaNguoiChot(
  c: Client,
  phamVi: PhamViSuaNguoiChot,
  chinhSachE2: ChinhSachE2,
  quyetDinh: readonly QuyetDinhOwner[],
): Promise<{ kh: KeHoachSuaNguoiChot; dauVao: DauVaoKeHoach }> {
  const dauVao = await docDauVaoSuaNguoiChot(c, phamVi, quyetDinh);
  return { kh: lapKeHoachSuaNguoiChot(dauVao, chinhSachE2), dauVao };
}

// ─── Tác động hoa hồng THẬT theo kỳ ───────────────────────────────────────────────────────

export type DongTacDongSale = { recipientId: string; truoc: number; noiDonNhuCu: number; chiSua: number; suaVaNoi: number };
export type KyTacDong = {
  period: string;
  status: "DRAFT" | "APPROVED" | "REOPENED" | "CHUA_CO";
  sale: DongTacDongSale[];
  treoSale: { truoc: number; noiDonNhuCu: number; chiSua: number; suaVaNoi: number };
};

/**
 * Bốn cột cho tầng SALE của mọi kỳ có tiền của đơn liên quan, dùng ĐÚNG hàm của engine (`mapButToanHoaHong` + `tinhHoaHongTheoKy` + `pickEffectiveRates`),
 * không nhân 4%:
 *   truoc        — hôm nay
 *   noiDonNhuCu  — chỉ nối đơn (noi-don đúng như bản dry-run đã trình: người chốt NGUYÊN trạng)
 *   chiSua       — chỉ sửa người chốt (đơn chưa nối vẫn không có lead ⇒ chưa đổi gì)
 *   suaVaNoi     — sửa người chốt RỒI nối đơn (đích đến)
 */
export async function tinhTacDongKy(c: Client, kh: KeHoachSuaNguoiChot, dauVao: DauVaoKeHoach): Promise<{ ky: KyTacDong[] }> {
  const kyCan = [...new Set(dauVao.don.flatMap((d) => d.ky))].sort();
  if (kyCan.length === 0) return { ky: [] };
  const moi = nguoiChotMoiTheoLead(kh.dong);
  const trangThai = new Map((await docTrangThaiKy(c, kyCan)).map((t) => [t.period, t.status] as const));

  const noi = await docKeHoachNoiDon(c, "TAT_CA");
  const va = new Map<string, UngVienLead>(noi.keHoach.mot.map((m) => [m.orderId, m.lead]));
  const vaSua = new Map<string, UngVienLead>([...va].map(([k, l]) => [k, leadSauKhiSua(l, moi)] as const));

  const rateRows = await c.commissionRateConfig.findMany({ select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true } });
  const phanCong = await c.centerCommissionAssignee.findMany({ select: SELECT_PHAN_CONG });
  const ratesAt = (at: Date) => pickEffectiveRates(rateRows, at);

  const ky: KyTacDong[] = [];
  for (const period of kyCan) {
    const { start, end } = khoangKy(period);
    const rows = await c.payment.findMany({
      where: { ...WHERE_THUC_THU, paidDate: { gte: start, lt: end } },
      select: { ...SELECT_HOA_HONG, orderId: true },
      orderBy: { id: "asc" },
    });
    const kichBan = {
      truoc: rows,
      noiDonNhuCu: vaLeadTrongBoNho(rows, va),
      chiSua: vaNguoiChotTrongBoNho(rows, moi),
      suaVaNoi: vaLeadTrongBoNho(vaNguoiChotTrongBoNho(rows, moi), vaSua),
    };
    const sale = new Map<string, DongTacDongSale>();
    const treo = { truoc: 0, noiDonNhuCu: 0, chiSua: 0, suaVaNoi: 0 };
    for (const ten of ["truoc", "noiDonNhuCu", "chiSua", "suaVaNoi"] as const) {
      const butToan = mapButToanHoaHong(kichBan[ten], phanCong);
      const dong = tinhHoaHongTheoKy({ period, butToan, ratesAt });
      for (const d of dong) {
        if (d.tier !== "SALE") continue;
        const g = sale.get(d.recipientId) ?? { recipientId: d.recipientId, truoc: 0, noiDonNhuCu: 0, chiSua: 0, suaVaNoi: 0 };
        g[ten] += d.amount;
        sale.set(d.recipientId, g);
      }
      treo[ten] = thongKe(period, butToan, dong, ratesAt).chuaCoNguoiHuong.SALE ?? 0;
    }
    ky.push({ period, status: trangThai.get(period) ?? "CHUA_CO", sale: [...sale.values()].sort((a, b) => (a.recipientId < b.recipientId ? -1 : 1)), treoSale: treo });
  }
  return { ky };
}

// ─── GHI ──────────────────────────────────────────────────────────────────────────────────

export type DauVaoGhiSuaNguoiChot = {
  /** Phạm vi BẮT BUỘC (luật 7): script truyền `"TAT_CA"`, ca test truyền id lead fixture. */
  phamVi: PhamViSuaNguoiChot;
  /** Chính sách E2 một nguồn — BẮT BUỘC (luật 7); đã nằm trong dòng PLAN nên artifact ký cho chính sách nào thì chỉ ghi được với chính sách đó. */
  chinhSachE2: ChinhSachE2;
  /** Quyết định của owner cho từng lead — BẮT BUỘC (luật 7). Script truyền `QUYET_DINH_OWNER_2310`; ca test truyền `[]` hoặc bảng fixture. Nằm trong dòng ký (qua kết quả kế hoạch). */
  quyetDinh: readonly QuyetDinhOwner[];
  /** `--expect` (số dòng GHI). `null` = không truyền. */
  soDuyet: number | null;
  /** `--expect-review` (số dòng XEM TAY). `null` = không truyền. */
  soDuyetXemTay: number | null;
  /** `--ke-hoach-sha`. `null` = không truyền. */
  keHoachSha: string | null;
  /** `has_table_privilege(…"Lead"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  /** BẮT BUỘC (luật 7). */
  luotChay: LuotChaySua;
  /** Cổng ghi Wave 1 — BẮT BUỘC khai (luật 7): không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiSua = { daGhi: number; daDoi: number; daXoa: number };

/** GHI — trước transaction chỉ BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiSuaNguoiChotTrongTx`). Một transaction duy nhất cho cả lượt. */
export async function ghiSuaNguoiChot(c: PrismaClient, input: DauVaoGhiSuaNguoiChot): Promise<KetQuaGhiSua> {
  const { kh } = await docKeHoachSuaNguoiChot(c, input.phamVi, input.chinhSachE2, input.quyetDinh);
  const truoc = quyetDinhGhiSuaNguoiChot({ soDuyet: input.soDuyet, soDuyetXemTay: input.soDuyetXemTay, keHoachSha: input.keHoachSha, kh, ghiDuoc: input.ghiDuoc });
  if (!truoc.ok) throw new Error(truoc.loi);
  return c.$transaction((tx) => ghiSuaNguoiChotTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/**
 * Phần TRONG transaction (export riêng để ca DB gọi THẲNG). Thứ tự: khoá lead ứng viên + khoá bảng kê → lập lại kế hoạch → cổng số đếm/sha → cổng Wave 1 (artifact) →
 * CLAIM nonce (PHÉP GHI ĐẦU TIÊN) → `updateMany` có điều kiện từng lead → audit → đọc lại kiểm hậu điều kiện. Từ chối LUÔN là `throw` (luật rollback).
 */
export async function ghiSuaNguoiChotTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiSuaNguoiChot): Promise<KetQuaGhiSua> {
  // 1) KHOÁ (không phải phép ghi): lead ứng viên FOR UPDATE (chặn convert/sửa lead xen giữa) + bảng kê FOR SHARE (chặn duyệt bảng kê xen giữa).
  const idUngVien = [...new Set([...(await docIdLeadImport(tx, input.phamVi)), ...input.quyetDinh.map((q) => q.leadId)])].sort();
  if (idUngVien.length > 0) {
    await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ANY(${idUngVien}::text[]) ORDER BY "id" FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "period" FROM "CommissionStatement" ORDER BY "period" FOR SHARE`;

  // 2) LẬP LẠI kế hoạch trong tx, dưới khoá: bằng chứng/người nhận/khoá hoa hồng đều đọc lại — kế hoạch cũ (đã duyệt) phải khớp sha.
  const { kh } = await docKeHoachSuaNguoiChot(tx, input.phamVi, input.chinhSachE2, input.quyetDinh);
  const quyetDinh = quyetDinhGhiSuaNguoiChot({ soDuyet: input.soDuyet, soDuyetXemTay: input.soDuyetXemTay, keHoachSha: input.keHoachSha, kh, ghiDuoc: input.ghiDuoc });
  if (!quyetDinh.ok) throw new Error(quyetDinh.loi);
  const dongGhi = kh.dong.filter(laDongGhi);
  if (dongGhi.length === 0) return { daGhi: 0, daDoi: 0, daXoa: 0 };
  if (input.soDuyet === null || input.soDuyetXemTay === null || input.keHoachSha === null) {
    throw new Error("ghiSuaNguoiChotTrongTx: thiếu số duyệt sau khi cổng đã qua — không ghi.");
  }

  // 3) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng từ kế hoạch lập lại ở bước 2. Claim nonce là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.suaNguoiChot, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.dongDauRa.length, runRef: input.congGhi.runRef });
  const pd = { nonce: duoc.payload.nonce, inputDigest: duoc.payload.inputDigest, keyId: duoc.payload.keyId };

  // 4) Ghi. Mọi dòng PHẢI đổi đúng 1 lead (điều kiện `convertedById = cũ`); khác ⇒ throw ⇒ cả lượt lùi.
  let daDoi = 0;
  let daXoa = 0;
  for (const d of dongGhi) {
    const r = await tx.lead.updateMany({
      where: { id: d.leadId, convertedById: d.oldConvertedById, deletedAt: null },
      data: { convertedById: d.newConvertedById },
    });
    if (r.count !== 1) {
      throw new Error(`Lead ${d.leadId}: người chốt hiện tại không còn là giá trị trong kế hoạch (trôi trạng thái) — KHÔNG ghi gì, cả lượt lùi.`);
    }
    if (d.loai === "REASSIGN") daDoi++;
    else daXoa++;
    const { oldValues, newValues } = dungBanGhiLead(d, pd, input.congGhi.runRef);
    await writeAudit({
      actor: input.actor,
      module: "nguon-hoa-hong",
      entityType: "Lead",
      entityId: d.leadId,
      action: HANH_DONG_SUA_LEAD,
      oldValues,
      newValues,
      changedFields: ["convertedById"],
      reason:
        d.evidenceClass === LOP_OWNER_DOI
          ? `${MA_LY_DO_SUA_OWNER}: owner quyết định đổi người chốt sang Sale chỉ định (${d.reasonCode})`
          : `${MA_LY_DO_SUA}: người chốt bị ghi là tài khoản chạy import — ${d.loai === "REASSIGN" ? "đổi sang Sale thật có bằng chứng" : "bỏ trống để xem tay"} (${d.reasonCode})`,
      orgUnitId: null,
      tx,
    });
  }

  // 5) Hậu điều kiện: đọc lại trong tx — mỗi lead GHI phải đang mang đúng giá trị mới.
  const sau = await tx.lead.findMany({ where: { id: { in: dongGhi.map((d) => d.leadId) } }, select: { id: true, convertedById: true } });
  const saiSau = sau.filter((l) => dongGhi.find((d) => d.leadId === l.id)?.newConvertedById !== l.convertedById);
  if (sau.length !== dongGhi.length || saiSau.length > 0) {
    throw new Error("Hậu điều kiện không đạt: có lead không mang đúng người chốt mới sau khi ghi — cả lượt lùi.");
  }

  // 6) Bản ghi MỨC LƯỢT — cùng transaction.
  await writeAudit({
    actor: input.actor,
    module: "nguon-hoa-hong",
    entityType: LOAI_THUC_THE_LUOT,
    entityId: khoaLuotChaySua(input.luotChay.nguonChay),
    action: HANH_DONG_SUA_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotSua({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soDuyetXemTay: input.soDuyetXemTay,
      keHoachSha: input.keHoachSha,
      daGhi: dongGhi.length,
      daDoi,
      daXoa,
      nonce: pd.nonce,
    }),
    changedFields: ["expectedCount", "expectedReview", "actualCount"],
    reason: `Lượt chạy ${MA_LY_DO_SUA}: người bấm · số đã duyệt (ghi/xem tay) · sha kế hoạch · số thực ghi`,
    tx,
  });
  return { daGhi: dongGhi.length, daDoi, daXoa };
}

// ─── KIỂM SAU GHI (chỉ đọc) ───────────────────────────────────────────────────────────────

export type KetQuaKiemSauGhi = {
  /** Số dòng GHI còn lại trong kế hoạch lập lại — phải 0 (idempotent). */
  conLaiCanGhi: number;
  banGhiAudit: number;
  /** Lead mà `convertedById` hiện tại ≠ giá trị mới trong audit (bị ai đó đổi lại sau khi ghi). */
  troiTraiAudit: string[];
  /** Dòng ngược để hoàn tác (leadId, hiện tại mong đợi, hoàn về) — CHỈ DỰNG, không ghi. */
  hoanTac: { leadId: string; hienTaiMongDoi: string | null; hoanVe: string | null }[];
  hong: number;
};

export async function kiemSauGhi(c: Client, phamVi: PhamViSuaNguoiChot, chinhSachE2: ChinhSachE2, quyetDinh: readonly QuyetDinhOwner[]): Promise<KetQuaKiemSauGhi> {
  const { kh } = await docKeHoachSuaNguoiChot(c, phamVi, chinhSachE2, quyetDinh);
  const audit = await c.auditLog.findMany({
    where: { module: "nguon-hoa-hong", entityType: "Lead", action: HANH_DONG_SUA_LEAD, ...locAudit(phamVi) },
    select: { entityId: true, oldValues: true, newValues: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  // Mỗi lead lấy bản ghi MỚI NHẤT.
  const moiNhat = new Map(audit.map((a) => [a.entityId, a] as const));
  const { dong: hoanTac, hong } = dongHoanTacTuAudit([...moiNhat.values()].map((a) => ({ entityId: a.entityId, oldValues: a.oldValues, newValues: a.newValues })));
  const leads = hoanTac.length
    ? await c.lead.findMany({ where: { id: { in: hoanTac.map((h) => h.leadId) } }, select: { id: true, convertedById: true } })
    : [];
  const hienTai = new Map(leads.map((l) => [l.id, l.convertedById] as const));
  const troi = hoanTac.filter((h) => hienTai.get(h.leadId) !== h.hienTaiMongDoi).map((h) => h.leadId);
  return { conLaiCanGhi: kh.soGhi, banGhiAudit: audit.length, troiTraiAudit: troi, hoanTac, hong };
}
