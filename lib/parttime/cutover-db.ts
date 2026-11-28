// lib/parttime/cutover-db.ts — ĐỌC buổi cần chuyển đổi + NHẬP phân công (công cụ `scripts/parttime-cutover.ts`).
//
// ĐỌC chạy được trên DB CHƯA có bảng Parttime (prod hôm nay): kiểm `to_regclass` trước, thiếu bảng ⇒ coi như chưa có phân công
// / ghi đè yêu cầu TA nào, chính sách lấy từ tham số của migration nền (bản DUY NHẤT của SR.QD.238).
// NHẬP (`nhapCutover`) chỉ tạo phân công THIẾU qua ĐÚNG bộ đồng bộ (`dongBoPhanCongTheoNguon`, `chiDung`, loại CUTOVER) — cùng
// luật dựng, không viết lại; idempotent nhờ chỉ mục từng phần (một người một vai sống / buổi; một MAIN sống / buổi). KHÔNG BAO
// GIỜ tạo `StaffAssignmentAcceptance` (người được phân tự xác nhận — M-CUT-01).
// KHÔNG `server-only`: chạy bằng tsx.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { sessionTimeRange } from "@/lib/classes/slots";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { vnYmd } from "@/lib/time/vn";
import { chinhSachTaiNgay, docThamSo, type ThamSoChinhSach } from "./chinh-sach";
import { chonBuoiNhap, phanLoaiCutover, type BuoiCutover, type KetQuaCutover } from "./cutover";
import { doiChieuPhanCongCo, phanLoaiLichSu, type DoiChieuPhanCong, type KetQuaLichSu, type ViTriBuoi } from "./cutover-lich-su";
import { docGhiDeDonVi } from "./don-vi-tiet-db";
import { ghiDeChoBuoi, type GhiDeDonVi } from "./don-vi-tiet";
import { dongBoPhanCongTheoNguon, docChinhSach, type NguoiThaoTac, type ThongBaoPhanCong } from "./phan-cong-db";
import { daGan, macDinhCuaBuoi } from "./phan-cong";

async function coBang(ten: string): Promise<boolean> {
  const r = await db.$queryRaw<{ co: boolean }[]>(Prisma.sql`SELECT to_regclass(format('public.%I', ${ten}::text)) IS NOT NULL AS co`);
  return r[0]?.co === true;
}

/** Tham số SR.QD.238 + id bản chính sách: từ DB nếu có bảng, không thì từ migration nền (cùng chuỗi JSON đã seed). */
async function chinhSachTai(ymd: string, coBangCs: boolean): Promise<{ thamSo: ThamSoChinhSach | null; id: string | null }> {
  if (coBangCs) {
    const cs = chinhSachTaiNgay(await docChinhSach(), ymd);
    return { thamSo: cs?.thamSo ?? null, id: cs?.id ?? null };
  }
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
  const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
  if (!m || ymd < "2026-10-15") return { thamSo: null, id: null };
  return { thamSo: docThamSo(JSON.parse(m[1]!)), id: "cpv_sr_qd_238" };
}

/**
 * `homNay` ("YYYY-MM-DD" giờ VN) BẮT BUỘC (luật 7): nó chia phạm vi thành buổi TỪ HÔM NAY (đi đường nhập) và buổi ĐÃ QUA (chỉ đối
 * soát lịch sử — không mời nhận lớp hồi tố, chốt 20/10/2026).
 */
export type PhamViCutover = { tu: string; den: string | null; maCoSo: readonly string[] | null; homNay: string };

export type KetQuaDocCutover = {
  coBangParttime: boolean;
  buoi: BuoiCutover[];
  /** Buổi từ hôm nay (ngày ≥ max(tu, homNay)) — phân loại nhập. */
  ketQua: KetQuaCutover[];
  /** Buổi đã qua trong phạm vi [tu, homNay) — MỌI trạng thái, chỉ đối soát. */
  lichSu: KetQuaLichSu[];
  /** Buổi từ hôm nay đã HUỶ (thống kê riêng, không phân công). */
  huyTuongLai: { sessionId: string; classCode: string | null; ngay: string }[];
  /** Phân công Parttime ĐANG CÓ của các cơ sở trong phạm vi, đếm theo nguồn (không sửa dòng nào). */
  phanCongCo: DoiChieuPhanCong;
};

/** Buổi lớp còn MỞ của lớp ĐANG HOẠT ĐỘNG từ max(`tu`, `homNay`) + đối soát buổi đã qua trong [tu, homNay). Chỉ đọc. */
export async function docCutover(p: PhamViCutover): Promise<KetQuaDocCutover> {
  const [coPc, coYc, coCs, coGd] = await Promise.all([
    coBang("SessionStaffAssignment"),
    coBang("ClassStaffingRequirement"),
    coBang("CompensationPolicyVersion"),
    coBang("TeachingUnitPolicyOverride"),
  ]);
  const centers = await db.center.findMany({ where: p.maCoSo ? { code: { in: [...p.maCoSo] } } : {}, select: { id: true, code: true } });
  const maCua = new Map(centers.map((c) => [c.id, c.code]));
  const ids = centers.map((c) => c.id);
  const tuTuongLai = p.tu > p.homNay ? p.tu : p.homNay;
  const denHet = p.den ? { lt: new Date(new Date(`${p.den}T00:00:00+07:00`).getTime() + 86_400_000) } : {};
  const thuocCoSo = { OR: [{ centerId: { in: ids } }, { centerId: null, class: { centerId: { in: ids } } }] };
  const ss = await db.classSession.findMany({
    where: {
      date: { gte: new Date(`${tuTuongLai}T00:00:00+07:00`), ...denHet },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      class: { status: "ACTIVE", deletedAt: null },
      ...thuocCoSo,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      date: true,
      status: true,
      centerId: true,
      substituteTeacherId: true,
      sessionCategory: { select: { code: true } },
      class: { select: { id: true, classCode: true, centerId: true, courseId: true, course: { select: { name: true } }, teacherId: true, assistantId: true, startTime: true, endTime: true, status: true, deletedAt: true } },
    },
  });
  const classIds = [...new Set(ss.map((s) => s.class.id))];
  const [siSo, yc, pcs] = await Promise.all([
    classIds.length
      ? db.enrollment.groupBy({ by: ["classId"], where: { classId: { in: classIds }, deletedAt: null, status: { in: [...ENROLLMENT_ACTIVE_STATUS_LIST] } }, _count: { _all: true } })
      : [],
    coYc && classIds.length ? db.classStaffingRequirement.findMany({ where: { classId: { in: classIds } }, select: { classId: true, taRequired: true } }) : [],
    coPc && ss.length
      ? db.sessionStaffAssignment.findMany({
          where: { sourceType: "CLASS_SESSION", sourceId: { in: ss.map((s) => s.id) } },
          select: { sourceId: true, userId: true, role: true, status: true, assignmentType: true, assignmentVersion: true, acceptances: { select: { assignmentVersion: true, decision: true } } },
        })
      : [],
  ]);
  const siSoCua = new Map(siSo.map((r) => [r.classId as string, r._count._all]));
  const ycCua = new Map(yc.map((r) => [r.classId, r.taRequired]));
  const ghiDe: GhiDeDonVi[] = coGd ? await docGhiDeDonVi() : [];

  const buoi: BuoiCutover[] = [];
  const ketQua: KetQuaCutover[] = [];
  const csCache = new Map<string, { thamSo: ThamSoChinhSach | null; id: string | null }>();
  for (const s of ss) {
    const centerId = s.centerId ?? s.class.centerId;
    const gio = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
    const md = macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: s.status, substituteTeacherId: s.substituteTeacherId, lop: s.class });
    const b: BuoiCutover = {
      sessionId: s.id,
      centerId,
      centerCode: centerId ? (maCua.get(centerId) ?? null) : null,
      classId: s.class.id,
      classCode: s.class.classCode,
      courseId: s.class.courseId,
      tenKhoa: s.class.course?.name ?? null,
      sessionType: s.sessionCategory?.code ?? null,
      ngay: vnYmd(s.date),
      gioBatDau: gio.start,
      gioKetThuc: gio.end,
      mainId: md.macDinhMainId,
      mainLaDayThay: md.macDinhMainKieu === "SUBSTITUTE",
      taId: md.macDinhTaId,
      soHocVien: siSoCua.get(s.class.id) ?? 0,
      taGhiDe: ycCua.get(s.class.id) ?? null,
      phanCong: pcs
        .filter((x) => x.sourceId === s.id && (x.role === "MAIN_TEACHER" || x.role === "TEACHING_ASSISTANT"))
        .map((x) => ({
          userId: x.userId,
          role: x.role as "MAIN_TEACHER" | "TEACHING_ASSISTANT",
          status: x.status,
          assignmentType: x.assignmentType,
          daNhan: daGan(x),
        })),
    };
    let cs = csCache.get(b.ngay);
    if (!cs) {
      cs = await chinhSachTai(b.ngay, coCs);
      csCache.set(b.ngay, cs);
    }
    buoi.push(b);
    ketQua.push(
      phanLoaiCutover(b, {
        thamSo: cs.thamSo,
        ghiDe: ghiDeChoBuoi(ghiDe, { sessionId: s.id, classId: s.class.id, courseId: s.class.courseId, sessionType: b.sessionType }, b.ngay, cs.id),
      }),
    );
  }
  const [lichSu, huyTuongLai, phanCongCo] = await Promise.all([
    p.tu < p.homNay ? docLichSu(p, ids, maCua, coPc) : Promise.resolve([] as KetQuaLichSu[]),
    db.classSession.findMany({
      where: { date: { gte: new Date(`${tuTuongLai}T00:00:00+07:00`), ...denHet }, status: "CANCELLED", class: { status: "ACTIVE", deletedAt: null }, ...thuocCoSo },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, date: true, class: { select: { classCode: true } } },
    }),
    coPc
      ? db.sessionStaffAssignment.findMany({
          where: { centerId: { in: ids }, ngay: { gte: new Date(`${p.tu}T00:00:00Z`) } },
          select: { sourceType: true, sourceId: true, role: true, status: true, userId: true, ngay: true },
        })
      : Promise.resolve([]),
  ]);
  const viTri = new Map<string, ViTriBuoi>([...ketQua.map((k) => [k.sessionId, "TUONG_LAI"] as const), ...lichSu.map((k) => [k.sessionId, "LICH_SU"] as const)]);
  return {
    coBangParttime: coPc,
    buoi,
    ketQua,
    lichSu,
    huyTuongLai: huyTuongLai.map((s) => ({ sessionId: s.id, classCode: s.class.classCode, ngay: vnYmd(s.date) })),
    phanCongCo: doiChieuPhanCongCo(
      phanCongCo.map((x) => ({ sourceType: x.sourceType, sourceId: x.sourceId, role: x.role, status: x.status, userId: x.userId, ngay: x.ngay.toISOString().slice(0, 10) })),
      viTri,
    ),
  };
}

/**
 * Buổi ĐÃ QUA trong [tu, homNay) của lớp chưa xoá — MỌI trạng thái (đã dạy · đã huỷ · chưa chốt). Đọc bằng chứng sẵn có (người
 * thực dạy, số dòng điểm danh, số phiếu nhận xét) + phân công đang có. Không ghi gì.
 */
async function docLichSu(p: PhamViCutover, ids: string[], maCua: Map<string, string | null>, coPc: boolean): Promise<KetQuaLichSu[]> {
  const ss = await db.classSession.findMany({
    where: {
      date: { gte: new Date(`${p.tu}T00:00:00+07:00`), lt: new Date(`${p.homNay}T00:00:00+07:00`) },
      class: { deletedAt: null },
      OR: [{ centerId: { in: ids } }, { centerId: null, class: { centerId: { in: ids } } }],
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      date: true,
      status: true,
      centerId: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      _count: { select: { attendances: true, studentFeedbacks: true } },
      class: { select: { classCode: true, centerId: true, teacherId: true, startTime: true, endTime: true } },
    },
  });
  const pcs =
    coPc && ss.length
      ? await db.sessionStaffAssignment.findMany({
          where: { sourceType: "CLASS_SESSION", sourceId: { in: ss.map((s) => s.id) } },
          select: { sourceId: true, userId: true, role: true, status: true, assignmentType: true },
        })
      : [];
  return ss.map((s) => {
    const centerId = s.centerId ?? s.class.centerId;
    const gio = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
    return phanLoaiLichSu({
      sessionId: s.id,
      centerCode: centerId ? (maCua.get(centerId) ?? null) : null,
      classCode: s.class.classCode,
      ngay: vnYmd(s.date),
      gio: gio.start && gio.end ? `${gio.start}–${gio.end}` : null,
      trangThai: s.status,
      gvLopId: s.class.teacherId,
      dayThayId: s.substituteTeacherId,
      thucDayId: s.actualTeacherId,
      soDiemDanh: s._count.attendances,
      soNhanXet: s._count.studentFeedbacks,
      phanCong: pcs
        .filter((x) => x.sourceId === s.id && (x.role === "MAIN_TEACHER" || x.role === "TEACHING_ASSISTANT"))
        .map((x) => ({ userId: x.userId, role: x.role as "MAIN_TEACHER" | "TEACHING_ASSISTANT", status: x.status, assignmentType: x.assignmentType, daNhan: false })),
    });
  });
}

export type KetQuaNhap = { soBuoi: number; soTao: number; loi: { sessionId: string; loi: string }[]; thongBao: ThongBaoPhanCong[] };

/**
 * NHẬP phân công còn thiếu cho các buổi được phép (READY_TO_IMPORT / PENDING_ACCEPTANCE có `seNhap`). Mỗi buổi một giao dịch;
 * buổi hỏng không kéo buổi khác (chạy lại = tiếp tục từ chỗ hỏng — idempotent). Audit mỗi phân công (bộ đồng bộ) + một dòng tổng.
 */
export async function nhapCutover(p: { ketQua: readonly KetQuaCutover[]; actor: NguoiThaoTac; maLo: string; homNay: string }): Promise<KetQuaNhap> {
  const chon = chonBuoiNhap(p.ketQua, p.homNay);
  const ra: KetQuaNhap = { soBuoi: chon.length, soTao: 0, loi: [], thongBao: [] };
  for (const k of chon) {
    try {
      const r = await db.$transaction(
        (tx) =>
          dongBoPhanCongTheoNguon(tx, { sourceType: "CLASS_SESSION", sourceId: k.sessionId }, {
            actor: p.actor,
            nguonKichHoat: `CUTOVER_IMPORT:${p.maLo}`,
            congTacTai: () => true,
            chiDung: true,
            kieuTao: "CUTOVER",
          }),
        { timeout: 20_000 },
      );
      ra.soTao += r.soTao;
      ra.thongBao.push(...r.thongBao);
    } catch (e) {
      ra.loi.push({ sessionId: k.sessionId, loi: e instanceof Error ? e.message : String(e) });
    }
  }
  await writeAudit({
    actor: p.actor,
    module: "hr_attendance",
    entityType: "SessionStaffAssignment",
    entityId: `cutover:${p.maLo}`,
    action: "PT_CUTOVER_IMPORT_BATCH",
    newValues: { soBuoi: ra.soBuoi, soTao: ra.soTao, soLoi: ra.loi.length },
    reason: `Nhập phân công chuyển đổi (lô ${p.maLo})`,
  });
  return ra;
}
