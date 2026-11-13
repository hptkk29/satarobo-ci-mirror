// lib/parttime/rank-don-gia-db.ts — ĐỌC cho màn Rank giáo viên, khối "Rank lương" trong hồ sơ GV và danh mục "Đơn giá Parttime". CHỈ ĐỌC, theo lô.
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
  /** User.centerId — cổng mở hồ sơ GV (`lib/teachers/quyen-ho-so.ts`) hỏi quyền tại cơ sở này. */
  coSoGocId: string | null;
  coSo: string[];
  /** id các cơ sở GV thuộc về (cùng `docGiaoVienCuaCoSo`). */
  coSoIds: string[];
  rank: number;
  nguonRank: "LICH_SU" | "MAC_DINH";
  rankTuNgay: string | null;
  /** Rank đã duyệt có hiệu lực SAU hôm nay (đã lên lịch). */
  rankSapToi: { rank: number; tuNgay: string } | null;
  chungNhan: { id: string; code: string | null; tuNgay: string; denNgay: string | null; hieuLucHomNay: boolean; daThuHoi: boolean } | null;
};

export type TrangRankDonGia = {
  homNay: string;
  giaoVien: DongRankGv[];
};

export async function docTrangRankDonGia(p: { centerIds: readonly string[]; now: Date }): Promise<TrangRankDonGia> {
  const homNay = vnYmd(p.now);
  const gv = await docGiaoVienCuaCoSo(p.centerIds, p.now);
  const ids = gv.map((g) => g.id);
  const [users, lichSu, chungNhan, chinhSach, centers] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, centerId: true } }) : [],
    ids.length ? db.teacherRankHistory.findMany({ where: { userId: { in: ids } }, select: { userId: true, rank: true, effectiveFrom: true } }) : [],
    ids.length ? db.trialCertificate.findMany({ where: { userId: { in: ids } }, orderBy: { effectiveFrom: "desc" } }) : [],
    docChinhSach(),
    db.center.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const tenCoSo = new Map(centers.map((c) => [c.id, c.code ?? c.name]));
  const ten = new Map(gv.map((g) => [g.id, g.name ?? g.id]));

  const cs = chinhSachTaiNgay(chinhSach, homNay);
  const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
  const macDinh = ts?.rankMacDinh ?? 1;
  const goc = new Map(users.map((u) => [u.id, u.centerId]));

  const giaoVien: DongRankGv[] = gv.map((g) => {
    const ls = lichSu.filter((r) => r.userId === g.id).map((r) => ({ rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) }));
    const r = rankTaiNgay(ls, homNay, macDinh);
    const dangApTu = r.nguon === "LICH_SU" ? ls.filter((x) => x.hieuLucTu <= homNay).sort((a, b) => b.hieuLucTu.localeCompare(a.hieuLucTu))[0]!.hieuLucTu : null;
    const sapToi = ls.filter((x) => x.hieuLucTu > homNay).sort((a, b) => a.hieuLucTu.localeCompare(b.hieuLucTu))[0] ?? null;
    const cn = chungNhan.filter((c) => c.userId === g.id);
    const moiNhat = cn[0] ?? null;
    const khoang = cn.map((c) => ({ effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }));
    const gocId = goc.get(g.id) ?? null;
    return {
      userId: g.id,
      ten: ten.get(g.id) ?? g.id,
      coSoGoc: gocId ? (tenCoSo.get(gocId) ?? null) : null,
      coSoGocId: gocId,
      coSo: g.coSo.map((c) => tenCoSo.get(c) ?? c),
      coSoIds: g.coSo,
      rank: r.rank,
      nguonRank: r.nguon,
      rankTuNgay: dangApTu,
      rankSapToi: sapToi ? { rank: sapToi.rank, tuNgay: sapToi.hieuLucTu } : null,
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

  return { homNay, giaoVien };
}

// ─── Danh mục tính lương "Đơn giá Parttime" (Chấm công → Cấu hình) ──────────────────────────────────────────────────────────────

export type TrangDonGia = {
  homNay: string;
  /** Mọi phiên bản chính sách thù lao (LEGACY · SR.QD.238 · …), mới nhất trước. */
  phienBan: { code: string; tu: string; den: string | null; laSrQd238: boolean; dangAp: boolean }[];
  /** Tham số SR.QD.238 đang áp hôm nay; null khi hôm nay không thuộc SR.QD.238. */
  donGia: { banChinhSach: string; hieuLucTu: string; thamSo: ThamSoSrQd238 } | null;
  chinhSachTrial: { id: string; phamVi: string; centerId: string | null; enabled: boolean; amountPerStudent: number; effectiveFrom: string; effectiveTo: string | null; reason: string; nguoiDuyet: string; dangAp: boolean }[];
  /** Chính sách hỗ trợ Trial ĐANG áp hôm nay theo từng cơ sở trong phạm vi. */
  trialHomNay: { centerId: string; tenCoSo: string; bat: boolean; muc: number; chong: boolean }[];
};

export async function docDanhMucDonGia(p: { centerIds: readonly string[]; now: Date }): Promise<TrangDonGia> {
  const homNay = vnYmd(p.now);
  const [chinhSach, csTrial, centers] = await Promise.all([
    docChinhSach(),
    db.trialSupportPolicy.findMany({ orderBy: [{ effectiveFrom: "desc" }, { centerId: "asc" }] }),
    db.center.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const tenCoSo = new Map(centers.map((c) => [c.id, c.code ?? c.name]));
  const nguoiIds = [...new Set(csTrial.map((c) => c.approvedById))];
  const ten = new Map(
    (nguoiIds.length ? await db.user.findMany({ where: { id: { in: nguoiIds } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email ?? u.id]),
  );
  const cs = chinhSachTaiNgay(chinhSach, homNay);
  const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
  const dongTrial = csTrial.map((c) => ({ id: c.id, centerId: c.centerId, enabled: c.enabled, amountPerStudent: c.amountPerStudent, effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }));
  const trialHomNay = p.centerIds.map((centerId) => {
    // Cấu hình chồng ngày ⇒ coi như chưa có chính sách (khớp `docNguonHoTroTrial` của lưới) — không đoán dòng nào thắng; màn nói rõ.
    let r: { bat: boolean; mucMoiHocVien: number } | null;
    let chong = false;
    try {
      r = chinhSachTrialTai(dongTrial, centerId, homNay);
    } catch {
      r = null;
      chong = true;
    }
    return { centerId, tenCoSo: tenCoSo.get(centerId) ?? centerId, bat: r?.bat ?? false, muc: r?.mucMoiHocVien ?? 0, chong };
  });
  return {
    homNay,
    phienBan: [...chinhSach]
      .sort((a, b) => b.hieuLucTu.localeCompare(a.hieuLucTu))
      .map((b) => ({ code: b.code, tu: b.hieuLucTu, den: b.hieuLucDen, laSrQd238: b.thamSo.loai === "SR_QD_238", dangAp: cs?.id === b.id })),
    donGia: cs && ts ? { banChinhSach: cs.code, hieuLucTu: cs.hieuLucTu, thamSo: ts } : null,
    chinhSachTrial: dongTrial.map((c) => ({
      id: c.id,
      phamVi: c.centerId ? (tenCoSo.get(c.centerId) ?? c.centerId) : "Toàn hệ thống",
      centerId: c.centerId,
      enabled: c.enabled,
      amountPerStudent: c.amountPerStudent,
      effectiveFrom: c.effectiveFrom,
      effectiveTo: c.effectiveTo,
      reason: csTrial.find((x) => x.id === c.id)!.reason,
      nguoiDuyet: ten.get(csTrial.find((x) => x.id === c.id)!.approvedById) ?? "",
      dangAp: c.effectiveFrom <= homNay && (c.effectiveTo == null || c.effectiveTo >= homNay),
    })),
    trialHomNay,
  };
}

/** Mọi cơ sở (id + nhãn) — trang lọc theo `parttime_rank:view` từng cơ sở. Hội sở không có giáo viên Parttime nên vẫn liệt kê để quyền quyết. */
export async function docDanhSachCoSo(): Promise<{ id: string; nhan: string }[]> {
  const rows = await db.center.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } });
  return rows.map((c) => ({ id: c.id, nhan: c.code ? `${c.code} · ${c.name}` : c.name }));
}

// ─── Một giáo viên (khối "Rank lương" trong hồ sơ GV) ────────────────────────────────────────────────────────────────────────────

export type RankCuaGv = {
  homNay: string;
  userId: string;
  /** id cơ sở GV thuộc về — trang dùng để hỏi quyền xem ĐÚNG cơ sở của GV. */
  coSoIds: string[];
  rank: number;
  nguonRank: "LICH_SU" | "MAC_DINH";
  rankTuNgay: string | null;
  rankSapToi: { rank: number; tuNgay: string } | null;
  /** Đơn giá tiết đứng chính ở Rank hiện tại theo chính sách đang áp; null khi hôm nay không thuộc SR.QD.238. */
  donGiaHomNay: number | null;
  /** Đơn giá tiết đứng chính theo từng Rank ("1".."4") của chính sách đang áp — thang R1–R4 in giá mỗi bậc. */
  bangGia: Record<string, number> | null;
  /** Lịch sử Rank đã DUYỆT, mới nhất trước (gồm cả dòng lên lịch tương lai). */
  lichSu: { id: string; rank: number; tuNgay: string; lyDo: string; nguoiDuyet: string | null; tuongLai: boolean }[];
  /** Mọi chứng nhận Trial, mới nhất trước. */
  chungNhan: { id: string; code: string | null; tuNgay: string; denNgay: string | null; daThuHoi: boolean; lyDoThuHoi: string | null; hieuLucHomNay: boolean; nguoiCap: string }[];
};

/** Rank + chứng nhận của MỘT giáo viên. Nơi gọi đã kiểm `parttime_rank:view` ở cơ sở của GV. Cùng luật với `docTrangRankDonGia`. */
export async function docRankCuaGv(p: { userId: string; now: Date }): Promise<RankCuaGv> {
  const homNay = vnYmd(p.now);
  const [lichSu, chungNhan, chinhSach, gvCs] = await Promise.all([
    db.teacherRankHistory.findMany({ where: { userId: p.userId }, orderBy: { effectiveFrom: "desc" } }),
    db.trialCertificate.findMany({ where: { userId: p.userId }, orderBy: { effectiveFrom: "desc" } }),
    docChinhSach(),
    db.center.findMany({ select: { id: true } }).then((cs) => docGiaoVienCuaCoSo(cs.map((c) => c.id), p.now)),
  ]);
  const nguoiIds = [...new Set([...lichSu.map((l) => l.decidedById ?? ""), ...chungNhan.map((c) => c.issuedById)].filter(Boolean))];
  const ten = new Map((nguoiIds.length ? await db.user.findMany({ where: { id: { in: nguoiIds } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const cs = chinhSachTaiNgay(chinhSach, homNay);
  const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
  const ls = lichSu.map((r) => ({ rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) }));
  const r = rankTaiNgay(ls, homNay, ts?.rankMacDinh ?? 1);
  const dangAp = r.nguon === "LICH_SU" ? ls.filter((x) => x.hieuLucTu <= homNay).sort((a, b) => b.hieuLucTu.localeCompare(a.hieuLucTu))[0]!.hieuLucTu : null;
  const sapToi = ls.filter((x) => x.hieuLucTu > homNay).sort((a, b) => a.hieuLucTu.localeCompare(b.hieuLucTu))[0] ?? null;
  const khoang = chungNhan.map((c) => ({ effectiveFrom: ymd(c.effectiveFrom), effectiveTo: c.effectiveTo ? ymd(c.effectiveTo) : null }));
  return {
    homNay,
    userId: p.userId,
    coSoIds: gvCs.find((g) => g.id === p.userId)?.coSo ?? [],
    rank: r.rank,
    nguonRank: r.nguon,
    rankTuNgay: dangAp,
    rankSapToi: sapToi ? { rank: sapToi.rank, tuNgay: sapToi.hieuLucTu } : null,
    donGiaHomNay: ts ? (ts.donGia.mainTheoRank[String(r.rank)] ?? null) : null,
    bangGia: ts ? ts.donGia.mainTheoRank : null,
    lichSu: lichSu.map((l) => ({ id: l.id, rank: l.rank, tuNgay: ymd(l.effectiveFrom), lyDo: l.reason, nguoiDuyet: l.decidedById ? (ten.get(l.decidedById) ?? null) : null, tuongLai: ymd(l.effectiveFrom) > homNay })),
    chungNhan: chungNhan.map((c, i) => ({
      id: c.id,
      code: c.code,
      tuNgay: ymd(c.effectiveFrom),
      denNgay: c.effectiveTo ? ymd(c.effectiveTo) : null,
      daThuHoi: c.revokedAt != null,
      lyDoThuHoi: c.revokeReason,
      hieuLucHomNay: chungNhanHieuLucTai([khoang[i]!], homNay),
      nguoiCap: ten.get(c.issuedById) ?? "",
    })),
  };
}

/** Rank hiện hành theo lô cho danh sách GV (`/teachers`) — MỘT câu đọc lịch sử, cùng `rankTaiNgay` với lưới và hồ sơ. */
export async function rankHomNayCua(userIds: readonly string[], now: Date): Promise<Map<string, { rank: number; nguon: "LICH_SU" | "MAC_DINH" }>> {
  const homNay = vnYmd(now);
  const [lichSu, chinhSach] = await Promise.all([
    userIds.length ? db.teacherRankHistory.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, rank: true, effectiveFrom: true } }) : [],
    docChinhSach(),
  ]);
  const cs = chinhSachTaiNgay(chinhSach, homNay);
  const macDinh = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo.rankMacDinh : 1;
  const theo = new Map<string, { rank: number; hieuLucTu: string }[]>();
  for (const l of lichSu) theo.set(l.userId, [...(theo.get(l.userId) ?? []), { rank: l.rank, hieuLucTu: ymd(l.effectiveFrom) }]);
  return new Map(userIds.map((u) => [u, rankTaiNgay(theo.get(u) ?? [], homNay, macDinh)]));
}

/**
 * Cơ sở của MỘT giáo viên (nơi người đó dạy + cơ sở gốc) — action đổi Rank kiểm kỳ công đã khoá ở mọi nơi này. null = không có người dùng.
 * Cùng `docGiaoVienCuaCoSo` với danh sách Rank và hồ sơ GV.
 */
export async function coSoCuaGiaoVien(userId: string, now: Date): Promise<string[] | null> {
  const [u, cs] = await Promise.all([db.user.findUnique({ where: { id: userId }, select: { centerId: true } }), db.center.findMany({ select: { id: true } })]);
  if (!u) return null;
  const gv = await docGiaoVienCuaCoSo(
    cs.map((c) => c.id),
    now,
  );
  return [...new Set([...(gv.find((g) => g.id === userId)?.coSo ?? []), ...(u.centerId ? [u.centerId] : [])])];
}
