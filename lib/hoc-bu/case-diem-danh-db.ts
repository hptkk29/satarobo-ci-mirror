// lib/hoc-bu/case-diem-danh-db.ts — ĐIỂM DANH HAI TẦNG của case dạy bù + nhả mục + chốt case (T07, 08/10/2026).
//
//   TẦNG 1  bé có tới buổi bù không ............ `diemDanhBe` (lần đầu) / `suaDiemDanhBe` (sửa, đảo được)
//   TẦNG 2  từng bài: học xong hay chưa .......... kết quả nhập CÙNG LÚC — không bao giờ tự suy "có mặt ⇒ xong"
//
// Mọi phép ghi nằm trong MỘT giao dịch, dưới khoá hàng case (`SELECT … FOR UPDATE`) — hai giáo viên bấm đồng thời cho hai bé của cùng case
// xếp hàng và đều thấy kết quả đã commit của nhau, nên case luôn chốt đúng một lần (checker TV-11). Cổng đứng TRƯỚC phép ghi đầu tiên;
// từ chối trong giao dịch là `throw` (CLAUDE.md, "Luật rollback").
//
// Bảng chuyển trạng thái của MỘT mục (lượt, dòng cần bù) ở `case-nhieu-bai-thuan.ts` — file này chỉ làm theo bảng.
import "server-only";
import type { MakeupItemResult, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { cuaSoDiemDanhBu } from "@/lib/hoc-bu/cua-so-diem-danh";
import { chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";
import { daoTieuLuot, giuLuot, nhaLuot, tieuLuot } from "@/lib/hoc-bu/so-luot";
import { khoaTieuMuc } from "@/lib/hoc-bu/so-luot-thuan";
import { nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";
import { phatBeBiGo, phatBeVang, phatCaseBiHuy, phatHoanThanh } from "@/lib/hoc-bu/su-kien";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import {
  chotCase,
  chuyenMuc,
  guongTrangThai,
  keHoachDiemDanhBe,
  trangThaiCaseSauChot,
  type KetQuaMucNhap,
  type LyDoNha,
} from "@/lib/hoc-bu/case-nhieu-bai-thuan";

type Tx = Prisma.TransactionClient;

/** Kết quả nhập cho từng mục: id mục → (xong / chưa xong, đánh giá của giáo viên cho riêng bài đó). */
export type KetQuaMucNhapDay = Record<string, { ketQua: KetQuaMucNhap; danhGia: string | null }>;

export const CHON_MUC = {
  id: true,
  caseId: true,
  participantId: true,
  makeupNeedId: true,
  dungLuot: true,
  result: true,
  status: true,
  lessonId: true,
  centerId: true,
  orgUnitId: true,
  addedById: true,
  makeupNeed: { select: { id: true, studentId: true, courseId: true, classId: true, missedSessionId: true, status: true } },
} satisfies Prisma.MakeupCaseStudentSelect;

export type MucDay = Prisma.MakeupCaseStudentGetPayload<{ select: typeof CHON_MUC }>;

const dinhDanhLuot = (m: MucDay, actorId: string | null) => ({
  studentId: m.makeupNeed.studentId,
  courseId: m.makeupNeed.courseId,
  classId: m.makeupNeed.classId,
  makeupNeedId: m.makeupNeedId,
  caseStudentId: m.id,
  actorId,
});

// ── MỘT mục đổi kết quả ─────────────────────────────────────────────────────────────────────────────────────────────
export type NguCanhDoiMuc = {
  lyDo: LyDoNha;
  actorId: string | null;
  now: Date;
  /** Lần điểm danh của bé (participant.version SAU khi tăng) — đưa vào khoá chống lặp của bút toán tiêu / đảo. */
  lan: number;
  /** Bé VẮNG buổi bù (⇒ bản gương `status` = ABSENT) hay mục bị gỡ (⇒ RELEASED). */
  beVang: boolean;
  /** Lý do ghi vào bút toán nhả / đảo. */
  lyDoSo: string;
  /** Đánh giá của giáo viên cho bài này; `undefined` = không đụng. */
  danhGia?: string | null;
};

/**
 * Đổi kết quả của MỘT mục theo bảng `chuyenMuc`: sổ lượt → mục → dòng cần bù → nhãn điểm danh gốc. Thứ tự này có chủ ý (T06): sổ lượt
 * đứng TRƯỚC khi mục đổi, để lần đầu một bé có tài khoản thì sổ phát lại thấy mục còn ở trạng thái cũ và nhả / tiêu đúng lượt đang giữ.
 */
export async function doiKetQuaMuc(tx: Tx, m: MucDay, den: MakeupItemResult, ctx: NguCanhDoiMuc): Promise<void> {
  const c = chuyenMuc(m.result, den, m.dungLuot, ctx.lyDo);
  if (!c) throw new LoiHocBu(`Không chuyển được mục từ ${m.result} sang ${den}`);

  const dd = dinhDanhLuot(m, ctx.actorId);
  switch (c.luot) {
    case "NHA":
      await nhaLuot(tx, { ...dd, lyDo: ctx.lyDoSo });
      break;
    case "TIEU_TU_GIU":
      await tieuLuot(tx, { ...dd, daGiu: true, khoa: khoaTieuMuc(m.makeupNeedId, m.id, ctx.lan) });
      break;
    case "TIEU_KHONG_GIU":
      await tieuLuot(tx, { ...dd, daGiu: false, khoa: khoaTieuMuc(m.makeupNeedId, m.id, ctx.lan) });
      break;
    case "DAO_TIEU":
      await daoTieuLuot(tx, { ...dd, lan: ctx.lan, lyDo: ctx.lyDoSo });
      break;
    case "KHONG":
      break;
  }

  const coDanhGia = ctx.danhGia !== undefined;
  const doi = await tx.makeupCaseStudent.updateMany({
    where: { id: m.id, result: m.result },
    data: {
      result: den,
      status: guongTrangThai(den, ctx.beVang),
      completedAt: den === "COMPLETED" ? ctx.now : m.result === "COMPLETED" ? null : undefined,
      releasedAt: den === "RELEASED" ? ctx.now : undefined,
      ...(coDanhGia
        ? { teacherEvaluation: ctx.danhGia, evaluatedById: ctx.actorId, evaluatedAt: ctx.danhGia ? ctx.now : null }
        : {}),
    },
  });
  if (doi.count !== 1) throw new LoiHocBu("Mục vừa được người khác xử lý — tải lại trang");

  if (c.dong) {
    const them =
      c.dong.sang === "COMPLETED"
        ? { completedAt: ctx.now, usedQuota: m.dungLuot }
        : { completedAt: null, usedQuota: false };
    await chuyenTrangThaiDong(tx, { ids: [m.makeupNeedId], tu: c.dong.tu, sang: c.dong.sang, lyDo: c.dong.lyDo, them });
  }

  // QUYẾT ĐỊNH 07/10/2026 (HB-13): điểm danh GỐC giữ nguyên VẮNG — chỉ đổi dấu `makeupStatus`. Hai chiều, có điều kiện trạng thái cũ.
  if (den === "COMPLETED" && m.result !== "COMPLETED") {
    await tx.attendance.updateMany({
      where: { sessionId: m.makeupNeed.missedSessionId, studentId: m.makeupNeed.studentId },
      data: { makeupStatus: "MADE_UP" },
    });
  } else if (m.result === "COMPLETED" && den !== "COMPLETED") {
    await tx.attendance.updateMany({
      where: { sessionId: m.makeupNeed.missedSessionId, studentId: m.makeupNeed.studentId, makeupStatus: "MADE_UP" },
      data: { makeupStatus: "NEEDS_MAKEUP" },
    });
  }
}

// ── Chốt lại case ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Tính lại trạng thái case từ các bé của nó (`chotCase`) và ghi. Gọi sau MỌI thay đổi tầng 1 / gỡ bé — gồm cả sửa điểm danh, nên một case
 * đã COMPLETED có thể chuyển NO_SHOW (và ngược lại). Case đã CANCELLED không bao giờ được chốt lại. Trả trạng thái mới (null = giữ SCHEDULED).
 */
export async function chotLaiCaseTrongTx(tx: Tx, caseId: string, now: Date, actorId: string | null): Promise<"COMPLETED" | "CANCELLED" | "NO_SHOW" | null> {
  const c = await tx.makeupCase.findUnique({
    where: { id: caseId },
    select: { status: true, completedAt: true, centerId: true, date: true, participants: { select: { attendanceStatus: true } } },
  });
  if (!c || c.status === "CANCELLED") return null;
  const moi = trangThaiCaseSauChot(chotCase(c.participants));
  if (moi === null) {
    // Còn bé chờ điểm danh. Case đã chốt mà có bé quay lại PENDING là không xảy ra (không có đường đưa bé về PENDING) — giữ nguyên.
    return null;
  }
  const dangChot = moi === "COMPLETED" || moi === "NO_SHOW";
  await tx.makeupCase.update({
    where: { id: caseId },
    data: { status: moi, completedAt: dangChot ? (c.completedAt ?? now) : null },
  });
  // T14 — case đổi trạng thái là một sự kiện có dấu vết (hoàn thành · không ai đến · huỷ vì hết bé · ĐẢO khi sửa điểm danh).
  if (moi !== c.status) {
    await ghiNhatKy(tx, {
      actorId,
      entityType: "MakeupCase",
      entityId: caseId,
      action: "hoc-bu.doi-trang-thai-case",
      oldValues: { status: c.status },
      newValues: { status: moi },
      reason: `Chốt lại từ điểm danh các bé (${c.status} → ${moi})`,
    });
    // T12→T14: case có công dạy hoàn thành SAU khi kỳ công của tháng đó đã chốt — công chưa nằm trong bản chốt; kỳ KHÔNG bị sửa, chỉ ghi vết (checker TV-93).
    if (dangChot && c.status !== "COMPLETED" && c.status !== "NO_SHOW") {
      const ky = c.date.toISOString().slice(0, 7);
      const kyChot = await tx.attendancePeriod.findUnique({ where: { centerId_periodKey: { centerId: c.centerId, periodKey: ky } }, select: { status: true } });
      if (kyChot?.status === "LOCKED") {
        await ghiNhatKy(tx, {
          actorId,
          entityType: "MakeupCase",
          entityId: caseId,
          action: "hoc-bu.cong-day-sau-chot-ky",
          newValues: { ky, status: moi },
          reason: `Case hoàn thành sau khi kỳ công ${ky} đã chốt — công dạy bù chưa nằm trong bản chốt (cần kế toán/BLĐ quyết: mở lại kỳ hoặc bù ở kỳ đang mở).`,
        });
      }
    }
  }
  return moi;
}

// ── Gỡ mục / gỡ bé khỏi case chưa điểm danh ─────────────────────────────────────────────────────────────────────────
/**
 * Nhả MỘT mục đang PLANNED: lượt (nếu giữ) được nhả, dòng cần bù về PENDING, mục thành RELEASED (KHÔNG xoá — lịch sử). Hết mục sống thì bé
 * thành REMOVED; hết bé thì case tự CANCELLED NGAY (HB-07 / HB-15: không còn case "sắp dạy" mà không ai học). Gọi trong giao dịch người gọi.
 */
export async function nhaMucTrongTx(
  tx: Tx,
  itemId: string,
  p: { actorId: string | null; lyDoSo: string; lyDo: LyDoNha; now: Date },
): Promise<{ caseId: string; caseMoi: "COMPLETED" | "CANCELLED" | "NO_SHOW" | null }> {
  const sau = await tx.makeupCaseStudent.findUnique({ where: { id: itemId }, select: { caseId: true } });
  if (!sau) throw new LoiHocBu("Không tìm thấy mục trong case");
  await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${sau.caseId} FOR UPDATE`;
  await nangCapCase(tx, sau.caseId);
  const m = await tx.makeupCaseStudent.findUnique({
    where: { id: itemId },
    select: { ...CHON_MUC, participant: { select: { id: true, studentId: true, attendanceStatus: true } }, case: { select: { status: true, teacherId: true } } },
  });
  if (!m || !m.participant) throw new LoiHocBu("Không tìm thấy mục trong case");
  if (m.result !== "PLANNED" || m.participant.attendanceStatus !== "PENDING" || m.case.status !== "SCHEDULED") {
    throw new LoiHocBu("Học viên đã được điểm danh — không gỡ được");
  }
  await doiKetQuaMuc(tx, m, "RELEASED", {
    lyDo: p.lyDo,
    actorId: p.actorId,
    now: p.now,
    lan: 0,
    beVang: false,
    lyDoSo: p.lyDoSo,
  });
  // Bé còn mục sống nào không?
  const con = await tx.makeupCaseStudent.count({ where: { participantId: m.participant.id, result: { not: "RELEASED" } } });
  if (con === 0) {
    const be = await tx.makeupCaseParticipant.update({
      where: { id: m.participant.id },
      data: { attendanceStatus: "REMOVED", version: { increment: 1 } },
      select: { version: true },
    });
    // T13: bé bị gỡ khỏi case ⇒ báo phụ huynh của bé (cùng giao dịch — rollback thì không có sự kiện).
    await phatBeBiGo(tx, { caseId: m.caseId, participantId: m.participant.id, studentId: m.participant.studentId, phienBan: be.version });
  }
  // T14 — gỡ một mục là một phép ghi có dấu vết (lượt đã nhả, dòng đã về PENDING, mục giữ làm lịch sử).
  await ghiNhatKy(tx, {
    actorId: p.actorId,
    entityType: "MakeupCaseStudent",
    entityId: itemId,
    action: "hoc-bu.go-muc-khoi-case",
    oldValues: { result: "PLANNED" },
    newValues: { result: "RELEASED", makeupNeedId: m.makeupNeedId, caseId: m.caseId, dungLuot: m.dungLuot },
    reason: p.lyDoSo,
  });
  const caseMoi = await chotLaiCaseTrongTx(tx, m.caseId, p.now, p.actorId);
  // Hết bé ⇒ case tự huỷ: giáo viên không còn buổi dạy này nữa.
  if (caseMoi === "CANCELLED") await phatCaseBiHuy(tx, { caseId: m.caseId, teacherId: m.case.teacherId });
  return { caseId: m.caseId, caseMoi };
}

// ── Điểm danh ───────────────────────────────────────────────────────────────────────────────────────────────────────
type VaiGoi = { actor: Actor | null; chiGiaoVien?: string };

export type TuyChonDiemDanh = {
  participantId: string;
  coMat: boolean;
  /** Kết quả từng bài — BẮT BUỘC khai (rỗng khi bé vắng). Bé có mặt mà thiếu một bài ⇒ từ chối, không suy. */
  ketQuaMuc: KetQuaMucNhapDay;
  nhanXetChung: string | null;
  chiGiaoVien?: string;
  /** Đồng hồ — mặc định giờ thật; test truyền vào (luật 19). */
  now?: Date;
  /** Ghi đè cửa sổ giờ khi quá hạn (người gọi ĐÃ kiểm quyền `makeup:waive`); cần lý do ≥ 10 ký tự, ghi audit. */
  ghiDe?: { lyDo: string; ten: string };
};

const CHON_BE = {
  id: true,
  caseId: true,
  studentId: true,
  attendanceStatus: true,
  version: true,
  case: { select: { status: true, teacherId: true, date: true, startTime: true, centerId: true } },
} satisfies Prisma.MakeupCaseParticipantSelect;

async function docBe(v: VaiGoi, participantId: string) {
  const sel = { where: { id: participantId }, select: CHON_BE } as const;
  // Admin đọc qua scopedDb (cách ly cơ sở). Site GV (`actor = null`): đọc trần, cổng `chiGiaoVien` chốt "đúng giáo viên của case" —
  // GV dạy case ở cơ sở khác cơ sở neo vai vẫn phải điểm danh được (cùng lý do bản vá site GV 68f9b0c5).
  const be = v.actor ? await scopedDb(v.actor).makeupCaseParticipant.findUnique(sel) : await db.makeupCaseParticipant.findUnique(sel);
  if (!be) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (!v.actor && v.chiGiaoVien === undefined) throw new LoiHocBu("Thiếu người điểm danh");
  if (v.chiGiaoVien !== undefined && be.case.teacherId !== v.chiGiaoVien) throw new LoiHocBu("Bạn không phải giáo viên của buổi bù này");
  return be;
}

function kiemGhiDe(actor: Actor | null, ghiDe: TuyChonDiemDanh["ghiDe"]): boolean {
  const dung = actor !== null && ghiDe !== undefined;
  if (dung && ghiDe!.lyDo.trim().length < 10) throw new LoiHocBu("Ghi đè điểm danh quá hạn cần lý do (ít nhất 10 ký tự)");
  return dung;
}

/**
 * Phần chung của điểm danh lần đầu và sửa điểm danh. `kieu = "SUA"` đòi `phienBan` khớp, và cho phép đảo (xem bảng `chuyenMuc`).
 */
async function ganDiemDanhBeTrongTx(
  tx: Tx,
  p: {
    kieu: "LAN_DAU" | "SUA";
    participantId: string;
    coMat: boolean;
    ketQuaMuc: KetQuaMucNhapDay;
    nhanXetChung: string | null;
    actorId: string | null;
    now: Date;
    phienBan?: number;
    lyDoSua?: string;
  },
): Promise<{ caseId: string; truoc: string; sau: string; caseMoi: "COMPLETED" | "CANCELLED" | "NO_SHOW" | null; viec: { id: string; tu: string; den: string }[] }> {
  const sau = await tx.makeupCaseParticipant.findUnique({ where: { id: p.participantId }, select: { caseId: true } });
  if (!sau) throw new LoiHocBu("Không tìm thấy học viên trong case");
  // Khoá hàng CASE trước mọi phép ghi (HB-02 / TV-11): không khoá thì hai bé của cùng case điểm danh ĐỒNG THỜI cùng đếm "còn ai chờ"
  // trước khi commit của nhau, KHÔNG bên nào chốt case, và case kẹt SCHEDULED mãi.
  await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${sau.caseId} FOR UPDATE`;
  await nangCapCase(tx, sau.caseId);

  const be = await tx.makeupCaseParticipant.findUnique({
    where: { id: p.participantId },
    select: { id: true, caseId: true, studentId: true, attendanceStatus: true, version: true, case: { select: { status: true } } },
  });
  if (!be) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (be.case.status === "CANCELLED") throw new LoiHocBu("Case đã huỷ");
  if (p.kieu === "LAN_DAU") {
    if (be.case.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
    if (be.attendanceStatus !== "PENDING") throw new LoiHocBu("Học viên này đã được điểm danh");
  } else {
    if (be.attendanceStatus !== "PRESENT" && be.attendanceStatus !== "ABSENT") throw new LoiHocBu("Học viên này chưa được điểm danh — hãy điểm danh trước");
    if (p.phienBan === undefined || be.version !== p.phienBan) throw new LoiHocBu("Điểm danh của bé vừa được người khác sửa — tải lại trang");
  }
  const lan = be.version + 1;

  // Các mục để xét: mục còn sống; riêng bé đang VẮNG (sửa sang CÓ MẶT) thì các mục đã nhả vì vắng được "hồi sinh" thành mục mới.
  const muc = await tx.makeupCaseStudent.findMany({ where: { participantId: be.id }, select: CHON_MUC, orderBy: { createdAt: "asc" } });
  let xet = muc.filter((m) => m.result !== "RELEASED");
  const hoiSinh: { cu: MucDay }[] = [];
  if (p.kieu === "SUA" && be.attendanceStatus === "ABSENT" && p.coMat) {
    for (const m of muc.filter((x) => x.result === "RELEASED" && x.status === "ABSENT")) hoiSinh.push({ cu: m });
  }

  const ketQua: Record<string, KetQuaMucNhap | undefined> = {};
  for (const [id, v] of Object.entries(p.ketQuaMuc)) ketQua[id] = v.ketQua;

  // Hồi sinh: dựng MỤC MỚI cho từng mục đã nhả vì bé vắng (không sống lại mục cũ — khoá chống lặp của sổ lượt gắn với id mục).
  // Dòng cần bù phải còn PENDING (chưa xếp chỗ khác), và lượt phải còn đủ — `giuLuot` ném khi hết.
  const doiTen = new Map<string, string>();
  for (const h of hoiSinh) {
    const moi = await tx.makeupCaseStudent.create({
      data: {
        caseId: h.cu.caseId,
        makeupNeedId: h.cu.makeupNeedId,
        centerId: h.cu.centerId,
        orgUnitId: h.cu.orgUnitId,
        participantId: be.id,
        lessonId: h.cu.lessonId,
        originalSessionId: h.cu.makeupNeed.missedSessionId,
        dungLuot: h.cu.dungLuot,
        addedById: p.actorId ?? h.cu.addedById,
      },
      select: { id: true },
    });
    await chuyenTrangThaiDong(tx, { ids: [h.cu.makeupNeedId], tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE", ngoai: { waivedAt: null } });
    if (h.cu.dungLuot) {
      await giuLuot(tx, { ...dinhDanhLuot(h.cu, p.actorId), caseStudentId: moi.id });
    }
    doiTen.set(h.cu.id, moi.id);
    if (ketQua[h.cu.id] !== undefined) ketQua[moi.id] = ketQua[h.cu.id];
    if (p.ketQuaMuc[h.cu.id]) p.ketQuaMuc[moi.id] = p.ketQuaMuc[h.cu.id]!;
  }
  if (hoiSinh.length > 0) {
    const ids = hoiSinh.map((h) => doiTen.get(h.cu.id)!);
    const moi = await tx.makeupCaseStudent.findMany({ where: { id: { in: ids } }, select: CHON_MUC });
    xet = [...xet, ...moi];
  }

  const kh = keHoachDiemDanhBe({
    sau: p.coMat ? "PRESENT" : "ABSENT",
    muc: xet.map((m) => ({ id: m.id, result: m.result, dungLuot: m.dungLuot })),
    ketQua,
  });
  if (!kh.ok) throw new LoiHocBu(kh.lyDo);

  const theoId = new Map(xet.map((m) => [m.id, m]));
  const tuTruoc = be.attendanceStatus;
  const lyDoSo = p.kieu === "SUA" ? `Sửa điểm danh buổi bù: ${p.lyDoSua ?? ""}`.trim() : p.coMat ? "Bé có mặt nhưng chưa học xong bài này" : "Bé vắng buổi bù — không tiêu lượt";
  for (const v of kh.viec) {
    const m = theoId.get(v.id)!;
    await doiKetQuaMuc(tx, m, v.den, {
      lyDo: "BE_VANG",
      actorId: p.actorId,
      now: p.now,
      lan,
      beVang: !p.coMat,
      lyDoSo,
      danhGia: p.coMat ? (p.ketQuaMuc[v.id]?.danhGia ?? null) : undefined,
    });
  }
  // Đánh giá của mục KHÔNG đổi kết quả (sửa lại chỉ chữa lời đánh giá).
  if (p.coMat) {
    for (const m of xet) {
      const nhap = p.ketQuaMuc[m.id];
      if (!nhap || kh.viec.some((v) => v.id === m.id)) continue;
      await tx.makeupCaseStudent.update({
        where: { id: m.id },
        data: { teacherEvaluation: nhap.danhGia, evaluatedById: p.actorId, evaluatedAt: nhap.danhGia ? p.now : null },
      });
    }
  }

  const doi = await tx.makeupCaseParticipant.updateMany({
    where: { id: be.id, version: be.version, attendanceStatus: be.attendanceStatus },
    data: {
      attendanceStatus: p.coMat ? "PRESENT" : "ABSENT",
      attendedAt: p.now,
      processedById: p.actorId,
      generalComment: p.coMat ? p.nhanXetChung : null,
      version: { increment: 1 },
    },
  });
  if (doi.count !== 1) throw new LoiHocBu("Học viên vừa được điểm danh — tải lại trang");

  const caseMoi = await chotLaiCaseTrongTx(tx, be.caseId, p.now, p.actorId);
  // T13: kết quả buổi bù — có mặt ⇒ báo phụ huynh (kèm đánh giá); vắng ⇒ báo Sale. Khoá theo phiên bản bé nên SỬA điểm danh là sự việc mới.
  const sk = { caseId: be.caseId, participantId: be.id, studentId: be.studentId, phienBan: lan, sua: p.kieu === "SUA" };
  if (p.coMat) await phatHoanThanh(tx, sk);
  else await phatBeVang(tx, sk);
  return { caseId: be.caseId, truoc: tuTruoc, sau: p.coMat ? "PRESENT" : "ABSENT", caseMoi, viec: kh.viec.map((v) => ({ id: v.id, tu: v.tu, den: v.den })) };
}

/**
 * Điểm danh LẦN ĐẦU một bé ở buổi bù — tầng 1 (có mặt / vắng) và tầng 2 (từng bài) trong MỘT giao dịch.
 *   · Vắng ⇒ mọi bài được nhả (không tiêu lượt, dòng về PENDING; phí đã thu vẫn giữ — chốt 5).
 *   · Có mặt ⇒ MỖI bài phải có kết quả: xong (tiêu lượt, dòng COMPLETED) hoặc chưa xong (nhả lượt, dòng về PENDING).
 * Khi không còn bé nào chờ điểm danh, case tự chốt (`chotCase`).
 */
export async function diemDanhBe(actor: Actor | null, p: TuyChonDiemDanh): Promise<void> {
  const be = await docBe({ actor, chiGiaoVien: p.chiGiaoVien }, p.participantId);
  if (be.case.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
  if (be.attendanceStatus !== "PENDING") throw new LoiHocBu("Học viên này đã được điểm danh");
  // Cổng THỜI GIAN (HB-03) — đứng trước phép ghi đầu tiên; ghi đè quá hạn cần lý do và để lại dấu vết.
  const now = p.now ?? new Date();
  const ghiDe = kiemGhiDe(actor, p.ghiDe);
  const cuaSo = cuaSoDiemDanhBu({ now, ngay: be.case.date, startTime: be.case.startTime, vai: actor ? "QUAN_LY" : "GIAO_VIEN", ghiDe });
  if (!cuaSo.ok) throw new LoiHocBu(cuaSo.thongBao);
  const actorId = actor?.userId ?? p.chiGiaoVien ?? null;

  await db.$transaction(async (tx) => {
    const kq = await ganDiemDanhBeTrongTx(tx, {
      kieu: "LAN_DAU",
      participantId: be.id,
      coMat: p.coMat,
      ketQuaMuc: { ...p.ketQuaMuc },
      nhanXetChung: p.nhanXetChung,
      actorId,
      now,
    });
    // T14 — điểm danh lần đầu một bé là phép ghi có dấu vết (trước đây chỉ phép GHI ĐÈ quá hạn mới có).
    await ghiNhatKy(tx, {
      actorId,
      entityType: "MakeupCaseParticipant",
      entityId: be.id,
      action: "hoc-bu.diem-danh-be",
      newValues: { coMat: p.coMat, viec: kq.viec, caseMoi: kq.caseMoi },
    });
    if (cuaSo.dungGhiDe) {
      await writeAudit({
        actor: { id: actor!.userId, name: p.ghiDe!.ten },
        module: "hoc-bu",
        entityType: "MakeupCaseParticipant",
        entityId: be.id,
        action: "hoc-bu.diem-danh-ghi-de-qua-han",
        newValues: { coMat: p.coMat, ngayCase: be.case.date.toISOString().slice(0, 10), gioCase: be.case.startTime, caseMoi: kq.caseMoi },
        reason: p.ghiDe!.lyDo.trim(),
        tx,
      });
    }
  });
}

export type TuyChonSuaDiemDanh = Omit<TuyChonDiemDanh, "ghiDe"> & {
  /** Phiên bản của bé lúc người dùng MỞ màn sửa — lệch ⇒ có người sửa trước, từ chối. */
  phienBan: number;
  /** Lý do sửa — bắt buộc (≥ 10 ký tự), ghi vào audit và vào bút toán đảo. */
  lyDo: string;
  ghiDe?: { lyDo: string; ten: string };
  /** Tên người sửa — cho audit. */
  ten: string;
};

/**
 * SỬA điểm danh đã chốt, ĐẢO được và có audit. Cửa sổ giờ như điểm danh lần đầu (giáo viên đến hết 23:59 ngày dạy; quản lý 3 ngày; quá thì
 * ghi đè kèm lý do). Mọi đảo xảy ra trong MỘT giao dịch: lượt đã tiêu được TRẢ bằng bút toán ADJUSTMENT (sổ chỉ-thêm, không xoá lịch sử),
 * dòng cần bù COMPLETED → PENDING, nhãn "đã bù" trên điểm danh gốc về NEEDS_MAKEUP, case chốt lại.
 */
export async function suaDiemDanhBe(actor: Actor | null, p: TuyChonSuaDiemDanh): Promise<void> {
  const lyDo = p.lyDo.trim();
  if (lyDo.length < 10) throw new LoiHocBu("Sửa điểm danh cần lý do (ít nhất 10 ký tự)");
  const be = await docBe({ actor, chiGiaoVien: p.chiGiaoVien }, p.participantId);
  if (be.case.status === "CANCELLED") throw new LoiHocBu("Case đã huỷ");
  if (be.attendanceStatus !== "PRESENT" && be.attendanceStatus !== "ABSENT") throw new LoiHocBu("Học viên này chưa được điểm danh — hãy điểm danh trước");
  const now = p.now ?? new Date();
  const ghiDe = kiemGhiDe(actor, p.ghiDe);
  const cuaSo = cuaSoDiemDanhBu({ now, ngay: be.case.date, startTime: be.case.startTime, vai: actor ? "QUAN_LY" : "GIAO_VIEN", ghiDe });
  if (!cuaSo.ok) throw new LoiHocBu(cuaSo.thongBao);
  const actorId = actor?.userId ?? p.chiGiaoVien ?? null;

  await db.$transaction(async (tx) => {
    const truoc = await tx.makeupCaseStudent.findMany({
      where: { participantId: be.id },
      select: { id: true, result: true, teacherEvaluation: true },
      orderBy: { createdAt: "asc" },
    });
    const kq = await ganDiemDanhBeTrongTx(tx, {
      kieu: "SUA",
      participantId: be.id,
      coMat: p.coMat,
      ketQuaMuc: { ...p.ketQuaMuc },
      nhanXetChung: p.nhanXetChung,
      actorId,
      now,
      phienBan: p.phienBan,
      lyDoSua: lyDo,
    });
    await writeAudit({
      actor: { id: actorId, name: p.ten },
      module: "hoc-bu",
      entityType: "MakeupCaseParticipant",
      entityId: be.id,
      action: "hoc-bu.sua-diem-danh-be",
      oldValues: { diemDanh: kq.truoc, muc: truoc.map((m) => ({ id: m.id, ketQua: m.result, danhGia: m.teacherEvaluation })) },
      newValues: { diemDanh: kq.sau, viec: kq.viec, caseMoi: kq.caseMoi, quaHan: cuaSo.dungGhiDe },
      reason: cuaSo.dungGhiDe ? `${lyDo} [ghi đè quá hạn: ${p.ghiDe!.lyDo.trim()}]` : lyDo,
      tx,
    });
  });
}

/**
 * Tương thích cũ: điểm danh MỘT mục (bé chỉ có một bài). Bé có nhiều bài phải điểm danh theo bé (`diemDanhBe`) vì phải nhập kết quả từng bài.
 * Có mặt ⇒ bài đó XONG (đúng nghĩa cũ "có mặt ⇒ đã bù"); vắng ⇒ nhả.
 */
export async function diemDanhBu(
  actor: Actor | null,
  p: {
    caseStudentId: string;
    coMat: boolean;
    chiGiaoVien?: string;
    now?: Date;
    ghiDe?: { lyDo: string; ten: string };
  },
): Promise<void> {
  const sel = { where: { id: p.caseStudentId }, select: { id: true, participantId: true, caseId: true } } as const;
  let m = actor ? await scopedDb(actor).makeupCaseStudent.findUnique(sel) : await db.makeupCaseStudent.findUnique(sel);
  if (!m) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (!m.participantId) {
    // Case đời cũ chưa nâng cấp: nâng (trong giao dịch riêng, idempotent) rồi đọc lại.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${m!.caseId} FOR UPDATE`;
      await nangCapCase(tx, m!.caseId);
    });
    m = await db.makeupCaseStudent.findUnique(sel);
    if (!m?.participantId) throw new LoiHocBu("Không tìm thấy học viên trong case");
  }
  const song = await db.makeupCaseStudent.findMany({ where: { participantId: m.participantId, result: { not: "RELEASED" } }, select: { id: true } });
  if (song.length !== 1) {
    throw new LoiHocBu("Bé này học nhiều bài trong case — điểm danh theo bé để chọn từng bài đã xong hay chưa");
  }
  await diemDanhBe(actor, {
    participantId: m.participantId,
    coMat: p.coMat,
    ketQuaMuc: p.coMat ? { [m.id]: { ketQua: "COMPLETED", danhGia: null } } : {},
    nhanXetChung: null,
    chiGiaoVien: p.chiGiaoVien,
    now: p.now,
    ghiDe: p.ghiDe,
  });
}

/**
 * Đánh giá của giáo viên cho RIÊNG MỘT bài trong case (tầng 2) — lưu ở chính mục (`teacherEvaluation`), KHÔNG ghi vào nhận xét / phiếu của
 * buổi vắng gốc (T07: buổi gốc giữ nguyên điểm danh VẮNG và nhận xét của nó). Chỉ cho mục của bé đã CÓ MẶT (xong hoặc chưa xong).
 * `chiGiaoVien` (site GV) chốt "đúng giáo viên của case"; admin đọc qua scopedDb. Trả mã case để người gọi làm mới đúng trang.
 */
export async function ghiDanhGiaMuc(
  actor: Actor | null,
  p: { caseStudentId: string; danhGia: string; chiGiaoVien?: string; ten: string; now?: Date },
): Promise<{ caseId: string }> {
  const chon = {
    id: true,
    caseId: true,
    result: true,
    teacherEvaluation: true,
    case: { select: { status: true, teacherId: true } },
  } as const;
  const m = actor
    ? await scopedDb(actor).makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon })
    : await db.makeupCaseStudent.findUnique({ where: { id: p.caseStudentId }, select: chon });
  if (!m) throw new LoiHocBu("Không tìm thấy học viên trong case");
  if (!actor && p.chiGiaoVien === undefined) throw new LoiHocBu("Thiếu người nhận xét");
  if (p.chiGiaoVien !== undefined && m.case.teacherId !== p.chiGiaoVien) throw new LoiHocBu("Bạn không phải giáo viên của buổi bù này");
  if (m.case.status === "CANCELLED") throw new LoiHocBu("Case đã huỷ");
  if (m.result !== "COMPLETED" && m.result !== "NOT_COMPLETED") {
    throw new LoiHocBu("Chỉ đánh giá bài của bé đã có mặt ở buổi bù — điểm danh trước");
  }
  const danhGia = p.danhGia.trim();
  if (danhGia.length === 0) throw new LoiHocBu("Chưa nhập đánh giá");
  const now = p.now ?? new Date();
  const actorId = actor?.userId ?? p.chiGiaoVien ?? null;
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupCaseStudent.updateMany({
      where: { id: m.id, result: m.result },
      data: { teacherEvaluation: danhGia, evaluatedById: actorId, evaluatedAt: now },
    });
    if (doi.count !== 1) throw new LoiHocBu("Bài vừa được người khác xử lý — tải lại trang");
    await writeAudit({
      actor: { id: actorId, name: p.ten },
      module: "hoc-bu",
      entityType: "MakeupCaseStudent",
      entityId: m.id,
      action: "hoc-bu.danh-gia-muc",
      oldValues: { danhGia: m.teacherEvaluation },
      newValues: { danhGia },
      tx,
    });
  });
  return { caseId: m.caseId };
}
