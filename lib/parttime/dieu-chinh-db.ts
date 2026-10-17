// lib/parttime/dieu-chinh-db.ts — P5c · ĐỌC hạn nhận xét + đề xuất điều chỉnh, GHI đề xuất (PROPOSED) và quyết định của QLCS.
//
// Chỉ đơn vị dạy ĐANG HIỆU LỰC (đối soát P5a, `donVi.hieuLuc === "CONFIRMED"`) mới có điều chỉnh. Mức tiền đến từ MỘT bảng
// nháp `deXuatDieuChinh` — chỉ mục DE_XUAT thành dòng; mục chưa chốt luật chỉ hiện (chặn chốt kỳ), không bao giờ có số tiền.
// Không đụng WorkUnit / StaffTimeLog / StudentSessionFeedback (lưới [P5-AW*]).
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { FEEDBACK_ATTENDED_STATUSES } from "@/lib/lms/session-feedback-roster";
import { BANG_NHAP_BLD, chanChotKy, deXuatDieuChinh, kiemQuyetDieuChinh, type MucDieuChinh, type QuyetDieuChinh } from "./dieu-chinh";
import { danhGiaNhanXet, type KetQuaNhanXet } from "./nhan-xet-han";
import type { NguoiThaoTac } from "./phan-cong-db";
import { docDoiSoatThucHien, type DongDoiSoat } from "./workunit-db";

const MODULE = "hr_attendance";
const ENTITY = "CompensationAdjustment";
export const HANH_DONG_DIEU_CHINH = {
  DE_XUAT: "PT_ADJUSTMENT_PROPOSED",
  HUY_TU_DONG: "PT_ADJUSTMENT_WITHDRAWN",
  XAC_NHAN: "PT_ADJUSTMENT_CONFIRMED",
  KHONG_AP: "PT_ADJUSTMENT_REJECTED",
  HUY: "PT_ADJUSTMENT_CANCELLED",
} as const;
const ATTENDED = new Set<string>(FEEDBACK_ATTENDED_STATUSES);
const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

// ─── Nhận xét ──────────────────────────────────────────────────────────────────────────────

/**
 * Trạng thái nhận xét cho các dòng đứng chính (lớp + học bù) — theo LÔ, số câu tra không phụ thuộc số buổi.
 * Lớp: học viên có mặt của buổi × `StudentSessionFeedback` của buổi. Học bù: mục PRESENT của case × nhận xét ở BUỔI GỐC
 * của từng bé (đúng chỗ `saveSessionEvalChoHocBu` ghi). TRIAL và trợ giảng: không xét.
 */
export async function docNhanXet(dong: readonly DongDoiSoat[], now: Date): Promise<Map<string, KetQuaNhanXet>> {
  const main = dong.filter((d) => d.bc.role === "MAIN_TEACHER" && (d.bc.sourceType === "CLASS_SESSION" || d.bc.sourceType === "MAKEUP_CASE"));
  const lopIds = main.filter((d) => d.bc.sourceType === "CLASS_SESSION").map((d) => d.bc.sourceId);
  const buIds = main.filter((d) => d.bc.sourceType === "MAKEUP_CASE").map((d) => d.bc.sourceId);
  const [diemDanh, mucBu] = await Promise.all([
    lopIds.length ? db.attendance.findMany({ where: { sessionId: { in: lopIds } }, select: { sessionId: true, studentId: true, status: true } }) : [],
    buIds.length
      ? db.makeupCaseStudent.findMany({ where: { caseId: { in: buIds }, status: "PRESENT" }, select: { caseId: true, originalSessionId: true, makeupNeed: { select: { studentId: true, missedSessionId: true } } } })
      : [],
  ]);
  const buoiGoc = mucBu.map((m) => m.originalSessionId ?? m.makeupNeed.missedSessionId);
  const nx = await (lopIds.length || buoiGoc.length
    ? db.studentSessionFeedback.findMany({ where: { classSessionId: { in: [...new Set([...lopIds, ...buoiGoc])] } }, select: { classSessionId: true, studentId: true, createdAt: true } })
    : Promise.resolve([] as { classSessionId: string; studentId: string; createdAt: Date }[]));
  const nxCua = (sessionId: string, studentId: string) => nx.find((n) => n.classSessionId === sessionId && n.studentId === studentId);

  const ra = new Map<string, KetQuaNhanXet>();
  for (const d of main) {
    if (d.bc.sourceType === "CLASS_SESSION") {
      const dd = diemDanh.filter((a) => a.sessionId === d.bc.sourceId);
      const coMat = dd.length ? dd.filter((a) => ATTENDED.has(a.status)).map((a) => a.studentId) : null;
      ra.set(d.bc.assignmentId, danhGiaNhanXet({ ngayBuoi: d.bc.workDate, hocVienCoMat: coMat, nhanXet: nx.filter((n) => n.classSessionId === d.bc.sourceId), now }));
    } else {
      const muc = mucBu.filter((m) => m.caseId === d.bc.sourceId);
      // Học bù: mỗi bé có mặt cần MỘT nhận xét ở buổi gốc của chính bé. Khoá theo bé (một case không có hai mục cùng bé sống).
      const coMat = muc.map((m) => m.makeupNeed.studentId);
      const daCo = muc.flatMap((m) => {
        const n = nxCua(m.originalSessionId ?? m.makeupNeed.missedSessionId, m.makeupNeed.studentId);
        return n ? [{ studentId: m.makeupNeed.studentId, createdAt: n.createdAt }] : [];
      });
      ra.set(d.bc.assignmentId, danhGiaNhanXet({ ngayBuoi: d.bc.workDate, hocVienCoMat: coMat, nhanXet: daCo, now }));
    }
  }
  return ra;
}

// ─── Đọc điều chỉnh ─────────────────────────────────────────────────────────────────────────

export type DongDieuChinh = {
  dong: DongDoiSoat;
  nhanXet: KetQuaNhanXet | null;
  muc: MucDieuChinh[];
  daCo: { id: string; type: string; amount: number; ruleCode: string; status: string; decisionReason: string | null }[];
};

export type KetQuaDieuChinh = { dong: DongDieuChinh[]; chuaGiaiQuyet: (MucDieuChinh & { workUnitId: string; userId: string; workDate: string })[] };

export type KhoanDaCo = { id: string; userId: string; workUnitId: string; assignmentId: string | null; type: string; amount: number; ruleCode: string; status: string; decisionReason: string | null };

/** Khoản điều chỉnh của một cơ sở × khoảng ngày (mọi trạng thái). */
export function docKhoanDaCo(p: { centerId: string; tu: string; den: string }): Promise<KhoanDaCo[]> {
  return db.compensationAdjustment.findMany({
    where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) } },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, workUnitId: true, assignmentId: true, type: true, amount: true, ruleCode: true, status: true, decisionReason: true },
  });
}

/**
 * MỘT phép ghép cho mọi nơi đọc (đối soát điều chỉnh + báo cáo tháng): đơn vị dạy ĐANG HIỆU LỰC × trạng thái nhận xét ⇒ mục
 * đề xuất (`deXuatDieuChinh`) + khoản đã có. Dòng không hiệu lực không có mục điều chỉnh.
 */
export function ghepDieuChinh(dong: readonly DongDoiSoat[], nhanXet: Map<string, KetQuaNhanXet>, daCo: readonly KhoanDaCo[]): KetQuaDieuChinh {
  const ra = dong
    .filter((d) => d.donVi?.hieuLuc === "CONFIRMED")
    .map((d): DongDieuChinh => {
      const nx = nhanXet.get(d.bc.assignmentId) ?? null;
      const muc = deXuatDieuChinh({ role: d.bc.role, treVaoPhut: d.bc.treVaoPhut, diMuon: d.bc.diMuon, raSomPhut: d.bc.raSomPhut, raSom: d.bc.raSom, nhanXet: nx?.trangThai ?? null });
      // Gắn theo PHÂN CÔNG, không theo đơn vị: khoản đã xác nhận của một đơn vị nay đã cũ / bị thay vẫn là khoản của tiết này.
      return { dong: d, nhanXet: nx, muc, daCo: daCo.filter((a) => a.assignmentId === d.bc.assignmentId) };
    });
  const chuaGiaiQuyet = ra.flatMap((x) => chanChotKy(x.muc).map((m) => ({ ...m, workUnitId: x.dong.donVi!.id, userId: x.dong.bc.userId, workDate: x.dong.bc.workDate })));
  return { dong: ra, chuaGiaiQuyet };
}

export async function docDieuChinh(p: { centerId: string; tu: string; den: string; now: Date }): Promise<KetQuaDieuChinh> {
  const ds = await docDoiSoatThucHien(p);
  const hieuLuc = ds.dong.filter((d) => d.donVi?.hieuLuc === "CONFIRMED");
  const [nhanXet, daCo] = await Promise.all([docNhanXet(hieuLuc, p.now), docKhoanDaCo(p)]);
  return ghepDieuChinh(hieuLuc, nhanXet, daCo);
}

// ─── Ghi: đồng bộ đề xuất ───────────────────────────────────────────────────────────────────

/**
 * Tạo dòng PROPOSED cho mục DE_XUAT chưa có; RÚT (CANCELLED, có audit) dòng PROPOSED không còn được bằng chứng ủng hộ (đơn vị
 * cũ / bị huỷ, hoặc mục đổi luật — vd nhận xét MISSING rồi GV nộp ⇒ LATE). Dòng CONFIRMED / REJECTED: KHÔNG BAO GIỜ tự đổi —
 * đó là quyết định của QLCS. Idempotent.
 */
export async function dongBoDeXuat(p: { centerId: string; tu: string; den: string; now: Date; actor: NguoiThaoTac & { id: string } }): Promise<{ tao: number; rut: number }> {
  const kq = await docDieuChinh(p);
  // Khoá "đã có khoản sống" là (PHÂN CÔNG, loại) — KHÔNG phải (đơn vị, loại): xác nhận lại một tiết sinh đơn vị MỚI, mà khoản đã
  // xác nhận vẫn nằm trên đơn vị cũ ⇒ khoá theo đơn vị là đề xuất khoản thứ hai cho cùng một tiết (`[P5-RDB-06]`).
  const canCo = new Map<string, { d: DongDieuChinh; m: MucDieuChinh }>();
  for (const d of kq.dong) for (const m of d.muc) if (m.trangThai === "DE_XUAT") canCo.set(`${d.dong.bc.assignmentId}|${m.loai}`, { d, m });
  const dangDeXuat = await db.compensationAdjustment.findMany({
    where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: "PROPOSED" },
    select: { id: true, workUnitId: true, assignmentId: true, type: true, ruleCode: true, amount: true, orgUnitId: true },
  });
  const songKhoa = new Set((await db.compensationAdjustment.findMany({
    where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: ["PROPOSED", "CONFIRMED"] } },
    select: { assignmentId: true, type: true },
  })).map((a) => `${a.assignmentId}|${a.type}`));

  return db.$transaction(async (tx) => {
    let rut = 0;
    for (const a of dangDeXuat) {
      const c = canCo.get(`${a.assignmentId}|${a.type}`);
      // Giữ khi bằng chứng vẫn ủng hộ ĐÚNG khoản này trên ĐÚNG đơn vị hiện hành; đơn vị đã đổi ⇒ rút rồi dựng lại trên đơn vị mới.
      if (c && c.m.maLuat === a.ruleCode && c.m.soTien === a.amount && c.d.dong.donVi!.id === a.workUnitId) continue;
      const u = await tx.compensationAdjustment.updateMany({ where: { id: a.id, status: "PROPOSED" }, data: { status: "CANCELLED", decidedAt: p.now, decisionReason: "Rút tự động: bằng chứng không còn ủng hộ đề xuất này" } });
      if (u.count === 0) continue;
      rut++;
      songKhoa.delete(`${a.assignmentId}|${a.type}`);
      await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: a.id, action: HANH_DONG_DIEU_CHINH.HUY_TU_DONG, oldValues: { status: "PROPOSED" }, newValues: { status: "CANCELLED", conLuat: c?.m.maLuat ?? null }, orgUnitId: a.orgUnitId, tx });
    }
    let tao = 0;
    for (const [k, { d, m }] of canCo) {
      if (songKhoa.has(k)) continue;
      const w = d.dong.donVi!;
      const snapshot: Prisma.InputJsonValue = {
        moTa: m.moTa,
        // Dòng dõi THẬT của mức tiền: bảng NHÁP BLĐ chưa ký — policyVersionId chỉ nói tiết thuộc chính sách nào.
        nguonLuat: BANG_NHAP_BLD.nguon,
        treVaoPhut: d.dong.bc.treVaoPhut,
        raSomPhut: d.dong.bc.raSomPhut,
        trangThaiBangChung: d.dong.bc.trangThai,
        dauVan: d.dong.bc.dauVan,
        attendanceInId: d.dong.bc.dongDoi.attendanceInId,
        attendanceOutId: d.dong.bc.dongDoi.attendanceOutId,
        nhanXet: d.nhanXet ? { trangThai: d.nhanXet.trangThai, han: d.nhanXet.han.toISOString(), hoanTatLuc: d.nhanXet.hoanTatLuc?.toISOString() ?? null, canCo: d.nhanXet.canCo, daCo: d.nhanXet.daCo } : null,
      };
      const a = await tx.compensationAdjustment.create({
        data: {
          userId: d.dong.bc.userId,
          centerId: d.dong.bc.centerId,
          workDate: ngayDate(d.dong.bc.workDate),
          workUnitId: w.id,
          assignmentId: d.dong.bc.assignmentId,
          type: m.loai,
          amount: m.soTien!,
          policyVersionId: d.dong.policyVersionId!,
          ruleCode: m.maLuat,
          sourceType: m.loai === "MISSING_SESSION_COMMENT" ? `${d.dong.bc.sourceType}:COMMENT` : "P4_EVIDENCE",
          // Nguồn = buổi / case của đơn vị (nhận xét học bù nằm ở buổi gốc từng bé — đã chụp trong evidenceSnapshot.nhanXet).
          sourceId: d.dong.bc.sourceId,
          evidenceSnapshot: snapshot,
          createdById: p.actor.id,
          createdAt: p.now,
        },
        select: { id: true, orgUnitId: true },
      });
      tao++;
      await writeAudit({ actor: p.actor, module: MODULE, entityType: ENTITY, entityId: a.id, action: HANH_DONG_DIEU_CHINH.DE_XUAT, newValues: { workUnitId: w.id, loai: m.loai, soTien: m.soTien, maLuat: m.maLuat }, orgUnitId: a.orgUnitId, tx });
    }
    return { tao, rut };
  });
}

// ─── Ghi: QLCS quyết ────────────────────────────────────────────────────────────────────────

export async function quyetDieuChinh(p: { id: string; quyet: QuyetDieuChinh; lyDo: string | null; actor: NguoiThaoTac & { id: string }; now: Date }): Promise<{ ok: true } | { ok: false; loi: string }> {
  const a = await db.compensationAdjustment.findUnique({ where: { id: p.id }, select: { status: true, userId: true, centerId: true, workDate: true, orgUnitId: true } });
  if (!a) return { ok: false, loi: "Không tìm thấy khoản điều chỉnh." };
  const kyKhoa = (await db.attendancePeriod.count({ where: { centerId: a.centerId, periodKey: a.workDate.toISOString().slice(0, 7), status: "LOCKED" } })) > 0;
  const loi = kiemQuyetDieuChinh({ trangThai: a.status, quyet: p.quyet, lyDo: p.lyDo, nguoiQuyetId: p.actor.id, nguoiBiTruId: a.userId, kyKhoa });
  if (loi) return { ok: false, loi };
  return db.$transaction(async (tx) => {
    const u = await tx.compensationAdjustment.updateMany({ where: { id: p.id, status: a.status }, data: { status: p.quyet, decidedById: p.actor.id, decidedAt: p.now, decisionReason: p.lyDo?.trim() || null } });
    if (u.count === 0) return { ok: false as const, loi: "Khoản này vừa thay đổi — tải lại trang." };
    await writeAudit({
      actor: p.actor,
      module: MODULE,
      entityType: ENTITY,
      entityId: p.id,
      action: p.quyet === "CONFIRMED" ? HANH_DONG_DIEU_CHINH.XAC_NHAN : p.quyet === "REJECTED" ? HANH_DONG_DIEU_CHINH.KHONG_AP : HANH_DONG_DIEU_CHINH.HUY,
      oldValues: { status: a.status },
      newValues: { status: p.quyet },
      reason: p.lyDo ?? undefined,
      orgUnitId: a.orgUnitId,
      tx,
    });
    return { ok: true as const };
  });
}
