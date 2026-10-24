// lib/parttime/rank-don-gia-db.ts — ĐỌC cho màn "Rank & Đơn giá giáo viên" (lưới phân công GV · PR4). CHỈ ĐỌC, theo lô.
// Phạm vi cơ sở do TRANG quyết (`parttime_rank:view` theo từng cơ sở) và truyền vào — hàm này không tự nới.
import "server-only";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { docGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { docChinhSach } from "./phan-cong-db";
import { chinhSachTaiNgay, type ThamSoSrQd238 } from "./chinh-sach";
import { rankTaiNgay } from "./rank";
import { chinhSachTrialTai, chungNhanHieuLucTai } from "./rank-trial-luat";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type DongRankGv = {
  userId: string;
  ten: string;
  coSoGoc: string | null;
  coSo: string[];
  /** id các cơ sở GV thuộc về (cùng `docGiaoVienCuaCoSo` mà action kiểm) — form đề xuất chỉ cho chọn trong tập này. */
  coSoIds: string[];
  rank: number;
  nguonRank: "LICH_SU" | "MAC_DINH";
  rankTuNgay: string | null;
  /** Rank đã duyệt có hiệu lực SAU hôm nay (đã lên lịch). */
  rankSapToi: { rank: number; tuNgay: string } | null;
  deXuatDangCho: { id: string; proposedRank: number; effectiveFrom: string; basis: string; proposedById: string; nguoiDeXuat: string; centerId: string } | null;
  chungNhan: { id: string; code: string | null; tuNgay: string; denNgay: string | null; hieuLucHomNay: boolean; daThuHoi: boolean } | null;
};

export type TrangRankDonGia = {
  homNay: string;
  giaoVien: DongRankGv[];
  lichSuDeXuat: { id: string; ten: string; currentRank: number; proposedRank: number; effectiveFrom: string; status: string; nguoiQuyet: string | null; decisionNote: string | null; decidedAt: string | null }[];
  donGia: { banChinhSach: string; hieuLucTu: string; thamSo: ThamSoSrQd238 } | null;
  chinhSachTrial: { id: string; phamVi: string; centerId: string | null; enabled: boolean; amountPerStudent: number; effectiveFrom: string; effectiveTo: string | null; reason: string; nguoiDuyet: string }[];
  /** Chính sách hỗ trợ Trial ĐANG áp hôm nay theo từng cơ sở trong phạm vi. */
  trialHomNay: { centerId: string; tenCoSo: string; bat: boolean; muc: number } [];
};

export async function docTrangRankDonGia(p: { centerIds: readonly string[]; now: Date }): Promise<TrangRankDonGia> {
  const homNay = vnYmd(p.now);
  const gv = await docGiaoVienCuaCoSo(p.centerIds, p.now);
  const ids = gv.map((g) => g.id);
  const [users, lichSu, deXuat, chungNhan, chinhSach, csTrial, centers] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, centerId: true } }) : [],
    ids.length ? db.teacherRankHistory.findMany({ where: { userId: { in: ids } }, select: { userId: true, rank: true, effectiveFrom: true } }) : [],
    db.teacherRankProposal.findMany({ where: { centerId: { in: [...p.centerIds] } }, orderBy: { proposedAt: "desc" }, take: 200 }),
    ids.length ? db.trialCertificate.findMany({ where: { userId: { in: ids } }, orderBy: { effectiveFrom: "desc" } }) : [],
    docChinhSach(),
    db.trialSupportPolicy.findMany({ orderBy: [{ centerId: "asc" }, { effectiveFrom: "desc" }] }),
    db.center.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const tenCoSo = new Map(centers.map((c) => [c.id, c.code ?? c.name]));
  const nguoiIds = [...new Set([...deXuat.flatMap((d) => [d.userId, d.proposedById, d.decidedById ?? ""]), ...csTrial.map((c) => c.approvedById)].filter(Boolean))];
  const ten = new Map(
    (nguoiIds.length ? await db.user.findMany({ where: { id: { in: nguoiIds } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email ?? u.id]),
  );
  for (const g of gv) if (!ten.has(g.id)) ten.set(g.id, g.name ?? g.id);

  const cs = chinhSachTaiNgay(chinhSach, homNay);
  const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
  const macDinh = ts?.rankMacDinh ?? 1;
  const goc = new Map(users.map((u) => [u.id, u.centerId]));

  const giaoVien: DongRankGv[] = gv.map((g) => {
    const ls = lichSu.filter((r) => r.userId === g.id).map((r) => ({ rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) }));
    const r = rankTaiNgay(ls, homNay, macDinh);
    const dangApTu = r.nguon === "LICH_SU" ? ls.filter((x) => x.hieuLucTu <= homNay).sort((a, b) => b.hieuLucTu.localeCompare(a.hieuLucTu))[0]!.hieuLucTu : null;
    const sapToi = ls.filter((x) => x.hieuLucTu > homNay).sort((a, b) => a.hieuLucTu.localeCompare(b.hieuLucTu))[0] ?? null;
    const dx = deXuat.find((d) => d.userId === g.id && d.status === "PROPOSED") ?? null;
    const cn = chungNhan.filter((c) => c.userId === g.id);
    const moiNhat = cn[0] ?? null;
    const khoang = cn.map((c) => ({ effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }));
    const gocId = goc.get(g.id) ?? null;
    return {
      userId: g.id,
      ten: ten.get(g.id) ?? g.id,
      coSoGoc: gocId ? (tenCoSo.get(gocId) ?? null) : null,
      coSo: g.coSo.map((c) => tenCoSo.get(c) ?? c),
      coSoIds: g.coSo,
      rank: r.rank,
      nguonRank: r.nguon,
      rankTuNgay: dangApTu,
      rankSapToi: sapToi ? { rank: sapToi.rank, tuNgay: sapToi.hieuLucTu } : null,
      deXuatDangCho: dx
        ? { id: dx.id, proposedRank: dx.proposedRank, effectiveFrom: ymd(dx.effectiveFrom), basis: dx.basis, proposedById: dx.proposedById, nguoiDeXuat: ten.get(dx.proposedById) ?? "", centerId: dx.centerId }
        : null,
      chungNhan: moiNhat
        ? {
            id: moiNhat.id,
            code: moiNhat.code,
            tuNgay: ymd(moiNhat.effectiveFrom),
            denNgay: moiNhat.effectiveTo ? ymd(moiNhat.effectiveTo) : null,
            hieuLucHomNay: chungNhanHieuLucTai(khoang, homNay),
            daThuHoi: moiNhat.revokedAt != null,
          }
        : null,
    };
  });
  giaoVien.sort((a, b) => a.ten.localeCompare(b.ten, "vi"));

  const dongTrial = csTrial.map((c) => ({ id: c.id, centerId: c.centerId, enabled: c.enabled, amountPerStudent: c.amountPerStudent, effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }));
  const trialHomNay = p.centerIds.map((centerId) => {
    // Cấu hình chồng ngày ⇒ coi như chưa có chính sách (khớp `docNguonHoTroTrial` của lưới) — không đoán dòng nào thắng.
    let r: { bat: boolean; mucMoiHocVien: number } | null;
    try {
      r = chinhSachTrialTai(dongTrial, centerId, homNay);
    } catch {
      r = null;
    }
    return { centerId, tenCoSo: tenCoSo.get(centerId) ?? centerId, bat: r?.bat ?? false, muc: r?.mucMoiHocVien ?? 0 };
  });

  return {
    homNay,
    giaoVien,
    lichSuDeXuat: deXuat.map((d) => ({
      id: d.id,
      ten: ten.get(d.userId) ?? d.userId,
      currentRank: d.currentRank,
      proposedRank: d.proposedRank,
      effectiveFrom: ymd(d.effectiveFrom),
      status: d.status,
      nguoiQuyet: d.decidedById ? (ten.get(d.decidedById) ?? null) : null,
      decisionNote: d.decisionNote,
      decidedAt: d.decidedAt ? vnYmd(d.decidedAt) : null,
    })),
    donGia: cs && ts ? { banChinhSach: cs.code, hieuLucTu: cs.hieuLucTu, thamSo: ts } : null,
    chinhSachTrial: csTrial.map((c) => ({
      id: c.id,
      phamVi: c.centerId ? (tenCoSo.get(c.centerId) ?? c.centerId) : "Toàn hệ thống",
      centerId: c.centerId,
      enabled: c.enabled,
      amountPerStudent: c.amountPerStudent,
      effectiveFrom: ymd(c.effectiveFrom),
      effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null,
      reason: c.reason,
      nguoiDuyet: ten.get(c.approvedById) ?? "",
    })),
    trialHomNay,
  };
}

/** Mọi cơ sở (id + nhãn) — trang lọc theo `parttime_rank:view` từng cơ sở. Hội sở không có giáo viên Parttime nên vẫn liệt kê để quyền quyết. */
export async function docDanhSachCoSo(): Promise<{ id: string; nhan: string }[]> {
  const rows = await db.center.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } });
  return rows.map((c) => ({ id: c.id, nhan: c.code ? `${c.code} · ${c.name}` : c.name }));
}
