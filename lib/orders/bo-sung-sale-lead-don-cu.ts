// lib/orders/bo-sung-sale-lead-don-cu.ts — BỔ SUNG sale phụ trách + liên kết lead cho đơn ĐÃ chuyển đổi trước 21/10/2026.
//
// Từ 21/10 `chuyenDoiDonAction` ghi `Enrollment.saleId = Lead.assignedToId` và nối học viên về lead (`Student.leadId/leadChildId`).
// Đơn chuyển đổi TRƯỚC ngày đó không có hai thứ ấy ⇒ học viên không thuộc "học viên của sale" (hocVienCuaSale) ⇒ sale không tự chuyển lớp được.
//
// Cùng luật với đường ghi mới, KHÔNG rộng hơn:
//   · chỉ đơn có `leadId`; sale = `Lead.assignedToId` (lead chưa có người chăm ⇒ bỏ qua, KHÔNG rơi về người tạo đơn);
//   · KHÔNG đè `Enrollment.saleId` đã có; KHÔNG đè `Student.leadId` đã có;
//   · `Student.leadChildId` chỉ nối khi dòng đơn khai `metadata.leadChildId` VÀ đứa trẻ ấy thật sự thuộc đúng lead đó;
//   · KHÔNG ghi `Enrollment.leadChildId` (tín hiệu "đã chốt" của báo cáo trial-sale);
//   · một học viên gặp hai lead khác nhau qua các dòng đơn ⇒ MƠ HỒ, bỏ qua và báo.
//
// Mặc định DRY-RUN (không ghi). Ghi thật chỉ khi `commit: true`. Chạy lại nhiều lần an toàn (điều kiện `saleId/leadId IS NULL` nằm trong `where` của phép ghi).
// Người vận hành chạy tay — luật cứng Nền Hệ thống #4. Không phụ thuộc "server-only" để script chạy được bằng tsx.
import type { PrismaClient } from "@prisma/client";

const KICH_THUOC_LO = 500;

export type BaoCaoBoSung = {
  commit: boolean;
  /** Dòng đơn có ghi danh + đơn có lead — tập xét. */
  dongXet: number;
  sale: { ungVien: number; daCoSale: number; leadChuaCoNguoiCham: number; ghiDanhDaXoa: number; mau: { enrollmentId: string; saleId: string }[]; daGhi: number };
  hocVien: { ungVien: number; daCoLead: number; moHo: number; noiDuocCon: number; mau: { studentId: string; leadId: string; leadChildId: string | null }[]; daGhi: number };
};

const chia = <T>(mang: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < mang.length; i += n) r.push(mang.slice(i, i + n));
  return r;
};

const idTreTuMetadata = (m: unknown): string | null => {
  if (!m || typeof m !== "object") return null;
  const v = (m as Record<string, unknown>).leadChildId;
  return typeof v === "string" && v.length > 0 ? v : null;
};

export async function boSungSaleLeadDonCu(db: PrismaClient, opt: { commit: boolean; soMau?: number; /** Giới hạn theo mã đơn (kiểm thử / chạy thử từng đơn). Bỏ trống = mọi đơn có lead. */ donIds?: string[] }): Promise<BaoCaoBoSung> {
  const soMau = opt.soMau ?? 10;
  const dong = await db.orderItem.findMany({
    where: { enrollmentId: { not: null }, order: { leadId: { not: null } }, ...(opt.donIds ? { orderId: { in: opt.donIds } } : {}) },
    select: {
      id: true,
      enrollmentId: true,
      studentId: true,
      metadata: true,
      order: { select: { leadId: true, lead: { select: { assignedToId: true } } } },
    },
    orderBy: { id: "asc" },
  });

  const bao: BaoCaoBoSung = {
    commit: opt.commit,
    dongXet: dong.length,
    sale: { ungVien: 0, daCoSale: 0, leadChuaCoNguoiCham: 0, ghiDanhDaXoa: 0, mau: [], daGhi: 0 },
    hocVien: { ungVien: 0, daCoLead: 0, moHo: 0, noiDuocCon: 0, mau: [], daGhi: 0 },
  };
  if (dong.length === 0) return bao;

  // ── 1) Sale phụ trách trên ghi danh ──
  const idGhiDanh = [...new Set(dong.map((d) => d.enrollmentId!))];
  const ghiDanh = new Map<string, { saleId: string | null; deletedAt: Date | null }>();
  for (const lo of chia(idGhiDanh, KICH_THUOC_LO)) {
    for (const g of await db.enrollment.findMany({ where: { id: { in: lo } }, select: { id: true, saleId: true, deletedAt: true } })) {
      ghiDanh.set(g.id, { saleId: g.saleId, deletedAt: g.deletedAt });
    }
  }
  const theoSale = new Map<string, string[]>(); // saleId → [enrollmentId]
  const daXet = new Set<string>();
  for (const d of dong) {
    const eid = d.enrollmentId!;
    if (daXet.has(eid)) continue;
    daXet.add(eid);
    const g = ghiDanh.get(eid);
    if (!g || g.deletedAt) { bao.sale.ghiDanhDaXoa++; continue; }
    if (g.saleId) { bao.sale.daCoSale++; continue; }
    const sale = d.order.lead?.assignedToId ?? null;
    if (!sale) { bao.sale.leadChuaCoNguoiCham++; continue; }
    bao.sale.ungVien++;
    if (bao.sale.mau.length < soMau) bao.sale.mau.push({ enrollmentId: eid, saleId: sale });
    theoSale.set(sale, [...(theoSale.get(sale) ?? []), eid]);
  }

  // ── 2) Học viên nối về lead ──
  const idHocVien = [...new Set(dong.map((d) => d.studentId).filter((x): x is string => !!x))];
  const hocVien = new Map<string, { leadId: string | null }>();
  for (const lo of chia(idHocVien, KICH_THUOC_LO)) {
    for (const s of await db.student.findMany({ where: { id: { in: lo } }, select: { id: true, leadId: true } })) hocVien.set(s.id, { leadId: s.leadId });
  }
  // học viên → tập lead gặp qua các dòng đơn; học viên → con khai trên dòng đơn (theo lead)
  const leadCuaHv = new Map<string, Set<string>>();
  const conKhai = new Map<string, { leadId: string; leadChildId: string }[]>();
  for (const d of dong) {
    if (!d.studentId || !d.order.leadId) continue;
    (leadCuaHv.get(d.studentId) ?? leadCuaHv.set(d.studentId, new Set()).get(d.studentId)!).add(d.order.leadId);
    const con = idTreTuMetadata(d.metadata);
    if (con) conKhai.set(d.studentId, [...(conKhai.get(d.studentId) ?? []), { leadId: d.order.leadId, leadChildId: con }]);
  }
  const idCon = [...new Set([...conKhai.values()].flat().map((c) => c.leadChildId))];
  const conThuocLead = new Set<string>(); // `${leadId}:${leadChildId}`
  for (const lo of chia(idCon, KICH_THUOC_LO)) {
    for (const c of await db.leadChild.findMany({ where: { id: { in: lo } }, select: { id: true, leadId: true } })) conThuocLead.add(`${c.leadId}:${c.id}`);
  }
  const keHoachHv: { studentId: string; leadId: string; leadChildId: string | null }[] = [];
  for (const [sid, leads] of leadCuaHv) {
    const hv = hocVien.get(sid);
    if (!hv) continue;
    if (hv.leadId) { bao.hocVien.daCoLead++; continue; }
    if (leads.size > 1) { bao.hocVien.moHo++; continue; }
    const leadId = [...leads][0]!;
    const con = (conKhai.get(sid) ?? []).find((c) => c.leadId === leadId && conThuocLead.has(`${c.leadId}:${c.leadChildId}`));
    keHoachHv.push({ studentId: sid, leadId, leadChildId: con?.leadChildId ?? null });
  }
  bao.hocVien.ungVien = keHoachHv.length;
  bao.hocVien.noiDuocCon = keHoachHv.filter((k) => k.leadChildId).length;
  bao.hocVien.mau = keHoachHv.slice(0, soMau);

  if (!opt.commit) return bao;

  // ── Ghi thật. Điều kiện `IS NULL` nằm trong where: chạy lại / đua với người khác không đè được gì. ──
  for (const [saleId, ids] of theoSale) {
    for (const lo of chia(ids, KICH_THUOC_LO)) {
      const r = await db.enrollment.updateMany({ where: { id: { in: lo }, saleId: null }, data: { saleId } });
      bao.sale.daGhi += r.count;
    }
  }
  for (const k of keHoachHv) {
    const r = await db.student.updateMany({ where: { id: k.studentId, leadId: null }, data: { leadId: k.leadId, leadChildId: k.leadChildId } });
    bao.hocVien.daGhi += r.count;
  }
  return bao;
}
