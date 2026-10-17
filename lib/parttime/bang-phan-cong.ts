// lib/parttime/bang-phan-cong.ts — ĐỌC cho hai màn phân công (SR.QD.238 · P2): tuần của QLCS + việc chờ của người được phân.
//
// Đọc theo LÔ (không N+1): ba nguồn buổi → mọi phân công của các buổi đó → xác nhận → ghi đè TA → sĩ số → tên người.
// Mọi PHÁN ĐOÁN đi qua hàm thuần ở `phan-cong.ts` (trạng thái nhân lực, yêu cầu TA, xác nhận còn hiệu lực) — cùng
// hàm dịch vụ ghi dùng, nên màn hình không thể nói khác thứ server sẽ chặn.
//
// Phạm vi: nơi gọi đã kiểm quyền cho `centerId` (màn QLCS) hoặc chỉ hỏi phân công CỦA CHÍNH người đăng nhập (màn GV).
import "server-only";
import type { StaffAssignmentStatus, StaffAssignmentType, WorkActivityType, WorkRole, WorkSourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { sessionTimeRange } from "@/lib/classes/slots";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { vnYmd } from "@/lib/time/vn";
import { phongCuaBuoi } from "@/lib/lms/schedule-conflict";
import { giaoVienDuocQuyCong } from "@/lib/lms/session-ownership";
import { loaiHoatDong } from "./buoi";
import { chinhSachTaiNgay } from "./chinh-sach";
import { docChinhSach } from "./phan-cong-db";
import {
  keHoachDongBo,
  laTaBatBuoc,
  macDinhCuaBuoi,
  TRANG_THAI_SONG,
  trangThaiNhanLuc,
  xacNhanConHieuLuc,
  yeuCauTroGiangThuan,
  type BuocDongBo,
  type TinhTrangBuoi,
  type TrangThaiNhanLuc,
  type YeuCauTroGiang,
} from "./phan-cong";

export type DongPhanCong = {
  id: string;
  userId: string;
  ten: string;
  role: WorkRole;
  status: StaffAssignmentStatus;
  assignmentType: StaffAssignmentType;
  phienBan: number;
  daNhan: boolean;
  /** Lý do của lượt TỪ CHỐI gần nhất (để QLCS biết vì sao phải xếp lại). */
  lyDoTuChoi: string | null;
  song: boolean;
};

export type BuoiTrongTuan = {
  key: string;
  sourceType: WorkSourceType;
  sourceId: string;
  ngay: string;
  gioBatDau: string;
  gioKetThuc: string;
  ten: string;
  phu: string | null;
  activity: WorkActivityType;
  trangThaiBuoi: string;
  /** MO / DA_CHOT / DA_DONG — CÙNG hàm với bộ đồng bộ (`macDinhCuaBuoi`). */
  tinhTrang: TinhTrangBuoi;
  lyDoDong: string | null;
  /** = tinhTrang !== "MO" (đã chốt hoặc đã đóng ⇒ không phân công). */
  daDong: boolean;
  classId: string | null;
  siSo: number | null;
  phong: string | null;
  /** Ngày thuộc SR.QD.238 không (LEGACY ⇒ không phân công mới). */
  apDung: boolean;
  yeuCauTA: YeuCauTroGiang;
  trangThai: TrangThaiNhanLuc;
  main: DongPhanCong | null;
  ta: DongPhanCong | null;
  /** Phân công đã kết thúc (từ chối · huỷ · bị thay) — mới nhất trước. */
  lichSu: DongPhanCong[];
  macDinhMainId: string | null;
  macDinhMainKieu: "SYSTEM" | "SUBSTITUTE";
  macDinhTaId: string | null;
  nguoiDayThay: string | null;
  /** Người ĐƯỢC QUY CÔNG của buổi lớp (`giaoVienDuocQuyCong`) — so với MAIN đã nhận để báo "cần đối soát". */
  nguoiDungLop: string | null;
  /**
   * Bộ đồng bộ SẼ làm gì với buổi này nếu công tắc bật — CHÍNH `keHoachDongBo`, chạy thử trên dữ liệu đã đọc (không
   * ghi). Cho ra: ngoại lệ (phân tay lệch · trùng vai · đã chốt mà buổi đóng), lượng "dựng trước" và ảnh chụp lệch.
   */
  keHoach: BuocDongBo[];
};

type BuoiDoc = Omit<BuoiTrongTuan, "apDung" | "yeuCauTA" | "trangThai" | "main" | "ta" | "lichSu" | "siSo" | "phong" | "keHoach"> & {
  tenKhoa: string | null;
  centerId: string;
  phongId: string | null;
};

/** Ngày "YYYY-MM-DD" theo giờ VN → mốc đầu ngày (UTC). */
const dauNgayVn = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function docBuoiTho(centerId: string, tu: string, den: string): Promise<BuoiDoc[]> {
  const sau = new Date(dauNgayVn(den).getTime() + 86_400_000);
  const [lop, bu, trial] = await Promise.all([
    db.classSession.findMany({
      where: {
        date: { gte: dauNgayVn(tu), lt: sau },
        OR: [{ centerId }, { centerId: null, class: { centerId } }],
        class: { deletedAt: null },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        status: true,
        roomId: true,
        actualRoomId: true,
        substituteRoomId: true,
        actualTeacherId: true,
        substituteTeacherId: true,
        sessionCategory: { select: { code: true } },
        class: {
          select: { id: true, name: true, status: true, deletedAt: true, roomId: true, teacherId: true, assistantId: true, startTime: true, endTime: true, course: { select: { name: true } } },
        },
      },
    }),
    db.makeupCase.findMany({
      where: { centerId, date: { gte: ngayDate(tu), lte: ngayDate(den) } },
      select: { id: true, date: true, startTime: true, endTime: true, status: true, teacherId: true, roomId: true, sessionCategoryId: true, courseId: true },
    }),
    db.trialClassSession.findMany({
      where: { trialClass: { centerId }, date: { gte: ngayDate(tu), lte: ngayDate(den) } },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        teacherId: true,
        roomId: true,
        seq: true,
        trialClass: { select: { name: true, teacherId: true, assistantId: true, status: true, roomId: true } },
      },
    }),
  ]);
  const [phanLoai, khoa] = await Promise.all([
    bu.some((c) => c.sessionCategoryId)
      ? db.sessionCategory.findMany({ where: { id: { in: bu.map((c) => c.sessionCategoryId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })
      : [],
    bu.length ? db.course.findMany({ where: { id: { in: [...new Set(bu.map((c) => c.courseId))] } }, select: { id: true, name: true } }) : [],
  ]);
  const maPhanLoai = new Map(phanLoai.map((p) => [p.id, p.code]));
  const tenKhoa = new Map(khoa.map((k) => [k.id, k.name]));

  const ra: BuoiDoc[] = [];
  for (const s of lop) {
    const gio = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
    const md = macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: s.status, substituteTeacherId: s.substituteTeacherId, lop: s.class });
    ra.push({
      key: `CLASS_SESSION:${s.id}`,
      sourceType: "CLASS_SESSION",
      sourceId: s.id,
      centerId,
      ngay: vnYmd(s.date),
      gioBatDau: gio.start,
      gioKetThuc: gio.end ?? gio.start,
      ten: s.class.name,
      phu: s.class.course?.name ?? null,
      activity: loaiHoatDong("CLASS_SESSION", s.sessionCategory?.code),
      trangThaiBuoi: s.status,
      daDong: md.tinhTrang !== "MO",
      classId: s.class.id,
      tenKhoa: s.class.course?.name ?? null,
      phongId: phongCuaBuoi(s),
      nguoiDungLop: giaoVienDuocQuyCong(s),
      ...md,
    });
  }
  for (const c of bu) {
    const pl = c.sessionCategoryId ? maPhanLoai.get(c.sessionCategoryId) : undefined;
    const act = loaiHoatDong("MAKEUP_CASE", pl);
    const md = macDinhCuaBuoi({ sourceType: "MAKEUP_CASE", trangThai: c.status, teacherId: c.teacherId });
    ra.push({
      key: `MAKEUP_CASE:${c.id}`,
      sourceType: "MAKEUP_CASE",
      sourceId: c.id,
      centerId,
      ngay: c.date.toISOString().slice(0, 10),
      gioBatDau: c.startTime,
      gioKetThuc: c.endTime,
      ten: act === "ADVANCE" ? "Học vượt" : "Dạy bù",
      phu: tenKhoa.get(c.courseId) ?? null,
      activity: act,
      trangThaiBuoi: c.status,
      daDong: md.tinhTrang !== "MO",
      classId: null,
      tenKhoa: tenKhoa.get(c.courseId) ?? null,
      phongId: c.roomId,
      nguoiDungLop: null,
      ...md,
    });
  }
  for (const t of trial) {
    const md = macDinhCuaBuoi({ sourceType: "TRIAL_SESSION", trangThai: t.status, teacherId: t.teacherId, lopTrial: t.trialClass });
    ra.push({
      key: `TRIAL_SESSION:${t.id}`,
      sourceType: "TRIAL_SESSION",
      sourceId: t.id,
      centerId,
      ngay: t.date.toISOString().slice(0, 10),
      gioBatDau: t.startTime,
      gioKetThuc: t.endTime,
      ten: t.trialClass?.name ?? "Lớp trải nghiệm",
      phu: `Buổi trải nghiệm ${t.seq}`,
      activity: "TRIAL",
      trangThaiBuoi: t.status,
      daDong: md.tinhTrang !== "MO",
      classId: null,
      tenKhoa: null,
      phongId: t.roomId ?? t.trialClass.roomId,
      nguoiDungLop: null,
      ...md,
    });
  }
  return ra.sort((a, b) => (a.ngay + a.gioBatDau).localeCompare(b.ngay + b.gioBatDau) || a.ten.localeCompare(b.ten, "vi"));
}

/** Tên hiển thị cho một tập người — một câu. */
export async function tenNguoi(ids: readonly string[]): Promise<Map<string, string>> {
  const u = ids.length ? await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(u.map((x) => [x.id, x.name ?? x.email ?? x.id]));
}

/**
 * Tuần phân công của MỘT cơ sở: mọi buổi trong [tu, den] (ngày VN) kèm đội hình, trạng thái nhân lực và kế hoạch đồng bộ
 * chạy thử. Số câu tra KHÔNG phụ thuộc số buổi (ca `[PT3B-Q1]` đo). Bằng chứng chấm công: `docBangChungCong` (P4).
 */
export async function docTuanPhanCong(p: { centerId: string; tu: string; den: string }): Promise<BuoiTrongTuan[]> {
  const buoi = await docBuoiTho(p.centerId, p.tu, p.den);
  if (buoi.length === 0) return [];
  const classIds = [...new Set(buoi.map((b) => b.classId).filter((x): x is string => !!x))];
  const phongIds = [...new Set(buoi.map((b) => b.phongId).filter((x): x is string => !!x))];
  const [pcs, ghiDe, siSo, chinhSach, phong] = await Promise.all([
    db.sessionStaffAssignment.findMany({
      where: { OR: (["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"] as const).map((t) => ({ sourceType: t, sourceId: { in: buoi.filter((b) => b.sourceType === t).map((b) => b.sourceId) } })) },
      orderBy: { createdAt: "desc" },
      include: { acceptances: { select: { assignmentVersion: true, decision: true, decisionNote: true }, orderBy: { decidedAt: "desc" } } },
    }),
    classIds.length ? db.classStaffingRequirement.findMany({ where: { classId: { in: classIds } }, select: { classId: true, taRequired: true } }) : [],
    classIds.length
      ? db.enrollment.groupBy({ by: ["classId"], where: { classId: { in: classIds }, deletedAt: null, status: { in: [...ENROLLMENT_ACTIVE_STATUS_LIST] } }, _count: { _all: true } })
      : [],
    docChinhSach(),
    phongIds.length ? db.room.findMany({ where: { id: { in: phongIds } }, select: { id: true, name: true } }) : [],
  ]);
  // Bằng chứng chấm công KHÔNG đọc ở đây nữa (P4b): một định nghĩa duy nhất ở `docBangChungCong` (`bang-chung-cong-db.ts`) —
  // bản P3b đo "muộn" từ giờ BẮT ĐẦU với dung sai 30', P4 đo từ giờ PHẢI CÓ MẶT; hai định nghĩa trên một màn là nói dối.
  const ten = await tenNguoi(pcs.map((x) => x.userId));
  const ghiDeCua = new Map(ghiDe.map((g) => [g.classId, g.taRequired]));
  const siSoCua = new Map(siSo.map((g) => [g.classId, g._count._all]));
  const tenPhong = new Map(phong.map((r) => [r.id, r.name]));
  const pcCua = new Map<string, typeof pcs>();
  for (const x of pcs) {
    const k = `${x.sourceType}:${x.sourceId}`;
    pcCua.set(k, [...(pcCua.get(k) ?? []), x]);
  }

  return buoi.map(({ tenKhoa, centerId, phongId, ...b }) => {
    const cs = chinhSachTaiNgay(chinhSach, b.ngay);
    const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
    const n = b.classId ? (siSoCua.get(b.classId) ?? 0) : null;
    const yeuCauTA = yeuCauTroGiangThuan({ ghiDe: b.classId ? (ghiDeCua.get(b.classId) ?? null) : null, tenKhoa, soHocVien: n ?? 0, nguong: ts?.nguongTroGiang ?? null });
    const ds = pcCua.get(b.key) ?? [];
    const rows: DongPhanCong[] = ds.map((x) => {
      const song = TRANG_THAI_SONG.includes(x.status);
      return {
        id: x.id,
        userId: x.userId,
        ten: ten.get(x.userId) ?? x.userId,
        role: x.role,
        status: x.status,
        assignmentType: x.assignmentType,
        phienBan: x.assignmentVersion,
        daNhan: xacNhanConHieuLuc(x.acceptances, x.assignmentVersion) != null,
        lyDoTuChoi: x.acceptances.find((a) => a.decision === "DECLINED")?.decisionNote ?? null,
        song,
      };
    });
    const keHoach = keHoachDongBo(
      {
        tinhTrang: b.tinhTrang,
        lyDoDong: b.lyDoDong,
        apDung: ts != null,
        congTacBat: true, // chạy thử: "nếu bật thì đồng bộ sẽ làm gì" — không ghi gì
        lich: { sourceType: b.sourceType, sourceId: b.sourceId, centerId, ngay: b.ngay, gioBatDau: b.gioBatDau, gioKetThuc: b.gioKetThuc },
        main: b.macDinhMainId ? { userId: b.macDinhMainId, kieu: b.macDinhMainKieu } : null,
        ta: b.macDinhTaId ? { userId: b.macDinhTaId } : null,
        nguoiDayThay: b.nguoiDayThay,
      },
      ds.map((x) => ({
        id: x.id,
        userId: x.userId,
        role: x.role,
        status: x.status,
        assignmentType: x.assignmentType,
        nghiaVu: { sourceType: x.sourceType, sourceId: x.sourceId, centerId: x.centerId, role: x.role, ngay: x.ngay.toISOString().slice(0, 10), gioBatDau: x.gioBatDau, gioKetThuc: x.gioKetThuc },
      })),
    );
    return {
      ...b,
      siSo: n,
      phong: phongId ? (tenPhong.get(phongId) ?? null) : null,
      apDung: ts != null,
      yeuCauTA,
      trangThai: trangThaiNhanLuc(rows, laTaBatBuoc(yeuCauTA)),
      main: rows.find((r) => r.song && r.role === "MAIN_TEACHER") ?? null,
      ta: rows.find((r) => r.song && r.role === "TEACHING_ASSISTANT") ?? null,
      lichSu: rows.filter((r) => !r.song),
      keHoach,
    };
  });
}

// ─── Công việc của tôi (người được phân · P3b) ───────────────────────────────────────────────

export type ThayDoiLich = { truoc: { ngay: string; gioBatDau: string; gioKetThuc: string }; sau: { ngay: string; gioBatDau: string; gioKetThuc: string } };

export type PhanCongCuaToi = {
  id: string;
  sourceType: WorkSourceType;
  ngay: string;
  gioBatDau: string;
  gioKetThuc: string;
  /** "Có mặt trước HH:MM" = giờ bắt đầu − `tiet.chuanBiPhut` của chính sách tại ngày buổi. null với ngày LEGACY. */
  coMatTruoc: string | null;
  role: WorkRole;
  assignmentType: StaffAssignmentType;
  activity: WorkActivityType;
  status: StaffAssignmentStatus;
  phienBan: number;
  /** Phiên bản > 1 ⇒ lịch đã đổi so với lần mình xem trước — phải xác nhận lại. */
  doiLich: boolean;
  /** Trước / sau của lần đổi gần nhất (từ audit `PT_ASSIGNMENT_CHANGED`) — chỉ có khi đang chờ nhận lại. */
  thayDoi: ThayDoiLich | null;
  nhom: string;
  tenNhom: string;
  phu: string | null;
  tenCoSo: string | null;
  phong: string | null;
  nguoiPhan: string | null;
  /** Buổi lớp ĐÃ QUA: người được quy công (`giaoVienDuocQuyCong`) — khác mình thì vào tab Đối soát. */
  nguoiDungLop: { id: string; ten: string } | null;
  trangThaiBuoi: string | null;
};

const cong = (ymd: string, n: number) => new Date(ngayDate(ymd).getTime() + n * 86_400_000);

/** "HH:mm" − phút (không vượt qua nửa đêm — buổi học không bắt đầu trước 00:xx). */
function truPhut(hhmm: string, phut: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.max(0, h * 60 + m - phut);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * MỌI phân công của CHÍNH `userId` trong cửa sổ [hôm nay − `soNgayDaQua`, hôm nay + `soNgaySapToi`] + mọi phân công đang
 * chờ nhận từ hôm nay. Chia tab ở hàm thuần `chiaTab` (`cong-viec.ts`). Số câu tra không phụ thuộc số phân công.
 */
export async function docCongViecCuaToi(p: { userId: string; homNay: string; soNgayDaQua: number; soNgaySapToi: number }): Promise<PhanCongCuaToi[]> {
  const pcs = await db.sessionStaffAssignment.findMany({
    where: {
      userId: p.userId,
      OR: [
        { status: "WAITING_ACCEPTANCE", ngay: { gte: ngayDate(p.homNay) } },
        { status: { in: ["ACCEPTED", "ACTIVE", "COMPLETED"] }, ngay: { gte: cong(p.homNay, -p.soNgayDaQua), lte: cong(p.homNay, p.soNgaySapToi) } },
      ],
    },
    orderBy: [{ ngay: "asc" }, { gioBatDau: "asc" }],
    take: 500,
  });
  const ids = (t: WorkSourceType) => pcs.filter((x) => x.sourceType === t).map((x) => x.sourceId);
  const doiLich = pcs.filter((x) => x.status === "WAITING_ACCEPTANCE" && x.assignmentVersion > 1).map((x) => x.id);
  const [lop, bu, trial, coSo, nguoiPhan, chinhSach, audit] = await Promise.all([
    ids("CLASS_SESSION").length
      ? db.classSession.findMany({
          where: { id: { in: ids("CLASS_SESSION") } },
          select: {
            id: true,
            status: true,
            roomId: true,
            actualRoomId: true,
            substituteRoomId: true,
            actualTeacherId: true,
            substituteTeacherId: true,
            sessionCategory: { select: { code: true } },
            class: { select: { id: true, name: true, roomId: true, teacherId: true, course: { select: { name: true } } } },
          },
        })
      : [],
    ids("MAKEUP_CASE").length ? db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: { id: true, courseId: true, roomId: true, status: true } }) : [],
    ids("TRIAL_SESSION").length
      ? db.trialClassSession.findMany({ where: { id: { in: ids("TRIAL_SESSION") } }, select: { id: true, roomId: true, status: true, trialClass: { select: { id: true, name: true, roomId: true } } } })
      : [],
    db.center.findMany({ where: { id: { in: [...new Set(pcs.map((x) => x.centerId))] } }, select: { id: true, name: true } }),
    tenNguoi(pcs.map((x) => x.assignedById).filter((x): x is string => !!x)),
    docChinhSach(),
    doiLich.length
      ? db.auditLog.findMany({
          where: { entityType: "SessionStaffAssignment", entityId: { in: doiLich }, action: "PT_ASSIGNMENT_CHANGED" },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, oldValues: true, newValues: true },
        })
      : [],
  ]);
  const phongIds = [
    ...lop.map((s) => phongCuaBuoi(s)),
    ...bu.map((c) => c.roomId),
    ...trial.map((t) => t.roomId ?? t.trialClass.roomId),
  ].filter((x): x is string => !!x);
  const dungLop = lop.map((s) => giaoVienDuocQuyCong(s)).filter((x): x is string => !!x && x !== p.userId);
  const [khoa, phong, tenDungLop] = await Promise.all([
    bu.length ? db.course.findMany({ where: { id: { in: [...new Set(bu.map((c) => c.courseId))] } }, select: { id: true, name: true } }) : [],
    phongIds.length ? db.room.findMany({ where: { id: { in: [...new Set(phongIds)] } }, select: { id: true, name: true } }) : [],
    tenNguoi(dungLop),
  ]);
  const tenKhoa = new Map(khoa.map((k) => [k.id, k.name]));
  const tenPhong = new Map(phong.map((r) => [r.id, r.name]));
  const lopCua = new Map(lop.map((s) => [s.id, s]));
  const buCua = new Map(bu.map((c) => [c.id, c]));
  const trialCua = new Map(trial.map((t) => [t.id, t]));
  const tenCoSo = new Map(coSo.map((c) => [c.id, c.name]));
  const thayDoiCua = new Map<string, ThayDoiLich>();
  for (const a of audit) {
    if (thayDoiCua.has(a.entityId)) continue; // mới nhất trước
    const o = (a.oldValues ?? {}) as Partial<ThayDoiLich["truoc"]>;
    const n = (a.newValues ?? {}) as Partial<ThayDoiLich["sau"]>;
    if (o.ngay && o.gioBatDau && n.ngay && n.gioBatDau) {
      thayDoiCua.set(a.entityId, {
        truoc: { ngay: o.ngay, gioBatDau: o.gioBatDau, gioKetThuc: o.gioKetThuc ?? "" },
        sau: { ngay: n.ngay, gioBatDau: n.gioBatDau, gioKetThuc: n.gioKetThuc ?? "" },
      });
    }
  }

  return pcs.map((x): PhanCongCuaToi => {
    const ngay = x.ngay.toISOString().slice(0, 10);
    const cs = chinhSachTaiNgay(chinhSach, ngay);
    const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
    let nhom = `${x.sourceType}:${x.sourceId}`;
    let tenNhom = "Buổi học";
    let phu: string | null = null;
    let phongId: string | null = null;
    let nguoiDungLop: PhanCongCuaToi["nguoiDungLop"] = null;
    let trangThaiBuoi: string | null = null;
    if (x.sourceType === "CLASS_SESSION") {
      const s = lopCua.get(x.sourceId);
      if (s) {
        nhom = `LOP:${s.class.id}`;
        tenNhom = s.class.name;
        phu = s.class.course?.name ?? null;
        phongId = phongCuaBuoi(s);
        trangThaiBuoi = s.status;
        const dl = giaoVienDuocQuyCong(s);
        nguoiDungLop = dl ? { id: dl, ten: dl === p.userId ? "Bạn" : (tenDungLop.get(dl) ?? dl) } : null;
      }
    } else if (x.sourceType === "MAKEUP_CASE") {
      const c = buCua.get(x.sourceId);
      nhom = "HOC_BU";
      tenNhom = x.activityType === "ADVANCE" ? "Học vượt" : "Dạy bù";
      phu = c ? (tenKhoa.get(c.courseId) ?? null) : null;
      phongId = c?.roomId ?? null;
      trangThaiBuoi = c?.status ?? null;
    } else {
      const t = trialCua.get(x.sourceId);
      nhom = t?.trialClass ? `TRIAL:${t.trialClass.id}` : "TRIAL";
      tenNhom = t?.trialClass?.name ?? "Lớp trải nghiệm";
      phu = "Trải nghiệm";
      phongId = t ? (t.roomId ?? t.trialClass.roomId) : null;
      trangThaiBuoi = t?.status ?? null;
    }
    return {
      id: x.id,
      sourceType: x.sourceType,
      ngay,
      gioBatDau: x.gioBatDau,
      gioKetThuc: x.gioKetThuc,
      coMatTruoc: ts ? truPhut(x.gioBatDau, ts.tiet.chuanBiPhut) : null,
      role: x.role,
      assignmentType: x.assignmentType,
      activity: x.activityType,
      status: x.status,
      phienBan: x.assignmentVersion,
      doiLich: x.status === "WAITING_ACCEPTANCE" && x.assignmentVersion > 1,
      thayDoi: thayDoiCua.get(x.id) ?? null,
      nhom,
      tenNhom,
      phu,
      tenCoSo: tenCoSo.get(x.centerId) ?? null,
      phong: phongId ? (tenPhong.get(phongId) ?? null) : null,
      nguoiPhan: x.assignedById ? (nguoiPhan.get(x.assignedById) ?? null) : null,
      nguoiDungLop,
      trangThaiBuoi,
    };
  });
}

/** Số phân công đang chờ `userId` xác nhận (huy hiệu menu). */
export function demChoXacNhan(userId: string, homNay: string): Promise<number> {
  return db.sessionStaffAssignment.count({ where: { userId, status: "WAITING_ACCEPTANCE", ngay: { gte: ngayDate(homNay) } } });
}
