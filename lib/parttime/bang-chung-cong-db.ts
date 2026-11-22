// lib/parttime/bang-chung-cong-db.ts — P4 · ĐỌC theo LÔ cho engine gắn chấm công (`bang-chung-cong.ts`).
//   · `docBangChungCong`   — MỘT cơ sở × khoảng ngày (Control Tower của QLCS): kèm ngoại lệ cấp buổi + lượt không gắn.
//   · `docBangChungCuaToi` — MỘT người × khoảng ngày ("Công việc của tôi"): chỉ phân công + lượt của chính người đó.
// Số câu tra KHÔNG phụ thuộc số phân công (ca `[P4-DB-12]` đo 3 vs 30).
//
// Đọc `db` TRẦN (không `scopedDb`): lượt quẹt nằm trong scope theo cơ sở QUẸT, đọc qua scope sẽ mất lượt ở cơ sở nhà của
// chính người dạy ở cơ sở này. Nơi gọi PHẢI tự kiểm quyền (QLCS: quyền xem cơ sở `centerId`; GV: `userId` lấy từ PHIÊN).
// Lượt quẹt đi qua `LUOT_CON_TINH` (một định nghĩa) — lượt bị từ chối (vd. ngoài vùng) / đã bị thay KHÔNG BAO GIỜ thành bằng
// chứng.
import "server-only";
import type { Prisma, StaffAssignmentStatus, WorkSourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { sessionTimeRange } from "@/lib/classes/slots";
import { LUOT_CON_TINH } from "@/lib/cham-cong/sua-gio-quet";
import { giaoVienDuocQuyCong } from "@/lib/lms/session-ownership";
import { getSetting } from "@/lib/settings/service";
import { CASE_CHO_DUYET } from "@/lib/hoc-bu/duyet-case-thuan";
import { vnYmd } from "@/lib/time/vn";
import { chinhSachTaiNgay, type BanChinhSach } from "./chinh-sach";
import { trongGraceCutover } from "./cutover-luat";
import { docChinhSach } from "./phan-cong-db";
import { daGan, macDinhCuaBuoi, type MacDinhBuoi } from "./phan-cong";
import {
  danhGiaBangChung,
  khoangCoMatTrongNgay,
  luotKhongGan,
  ngoaiLeCapBuoi,
  type BangChungPhanCong,
  type KhoangCoMat,
  type LuotKhongGan,
  type LuotQuetHopLe,
  type NgoaiLeBuoi,
  type NguonNguoiDay,
} from "./bang-chung-cong";

/** Phân công là NGHĨA VỤ đang/đã có — loại DECLINED / REPLACED (không còn ai phải làm). CANCELLED chỉ giữ khi buổi đã đóng. */
const TRANG_THAI_XET: StaffAssignmentStatus[] = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED", "CANCELLED"];

type ThongTinBuoi = MacDinhBuoi & { ngay: string; gioBatDau: string; gioKetThuc: string; nguoiDay: { id: string; nguon: NguonNguoiDay } | null };
/** Tham số theo CƠ SỞ đọc một lượt: dung sai P4 + bấm trùng + mốc grace cutover (Q5, "" = không grace). */
type DungSai = { treVaoPhut: number; veSomPhut: number; bamTrungPhut: number; graceCutoverDen: string };

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const dauNgayVn = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
const mocVn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

const CHON_PC = { acceptances: { select: { assignmentVersion: true, decision: true } } } satisfies Prisma.SessionStaffAssignmentInclude;
const CHON_LOP = {
  id: true,
  date: true,
  status: true,
  actualTeacherId: true,
  substituteTeacherId: true,
  class: { select: { teacherId: true, assistantId: true, status: true, deletedAt: true, startTime: true, endTime: true } },
} satisfies Prisma.ClassSessionSelect;
const CHON_BU = { id: true, date: true, startTime: true, endTime: true, status: true, teacherId: true } satisfies Prisma.MakeupCaseSelect;
const CHON_TRIAL = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  status: true,
  teacherId: true,
  trialClass: { select: { teacherId: true, assistantId: true, status: true } },
} satisfies Prisma.TrialClassSessionSelect;
const CHON_LUOT = { id: true, userId: true, workDate: true, loggedAt: true, direction: true, centerId: true, flags: true } satisfies Prisma.StaffTimeLogSelect;

type PcDoc = Prisma.SessionStaffAssignmentGetPayload<{ include: typeof CHON_PC }>;
type LopDoc = Prisma.ClassSessionGetPayload<{ select: typeof CHON_LOP }>;
type BuDoc = Prisma.MakeupCaseGetPayload<{ select: typeof CHON_BU }>;
type TrialDoc = Prisma.TrialClassSessionGetPayload<{ select: typeof CHON_TRIAL }>;
type LuotDoc = Prisma.StaffTimeLogGetPayload<{ select: typeof CHON_LUOT }>;

function nguonNguoiDayLop(s: { actualTeacherId: string | null; substituteTeacherId: string | null; class: { teacherId: string | null } }): NguonNguoiDay | null {
  return s.actualTeacherId ? "actualTeacherId" : s.substituteTeacherId ? "substituteTeacherId" : s.class.teacherId ? "class.teacherId" : null;
}

/** Ba nguồn buổi → MỘT bảng tra (CÙNG `macDinhCuaBuoi` với bộ đồng bộ / Control Tower). */
function bangBuoi(lop: LopDoc[], bu: BuDoc[], trial: TrialDoc[]): Map<string, ThongTinBuoi> {
  const buoi = new Map<string, ThongTinBuoi>();
  for (const s of lop) {
    const gio = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
    const dl = giaoVienDuocQuyCong(s);
    buoi.set(`CLASS_SESSION:${s.id}`, {
      ...macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: s.status, substituteTeacherId: s.substituteTeacherId, lop: s.class }),
      ngay: vnYmd(s.date),
      gioBatDau: gio.start,
      gioKetThuc: gio.end ?? gio.start,
      nguoiDay: dl ? { id: dl, nguon: nguonNguoiDayLop(s) ?? "class.teacherId" } : null,
    });
  }
  for (const c of bu) {
    buoi.set(`MAKEUP_CASE:${c.id}`, {
      ...macDinhCuaBuoi({ sourceType: "MAKEUP_CASE", trangThai: c.status, teacherId: c.teacherId }),
      ngay: c.date.toISOString().slice(0, 10),
      gioBatDau: c.startTime,
      gioKetThuc: c.endTime,
      nguoiDay: c.teacherId ? { id: c.teacherId, nguon: "makeup.teacherId" } : null,
    });
  }
  for (const t of trial) {
    const gv = t.teacherId ?? t.trialClass.teacherId;
    buoi.set(`TRIAL_SESSION:${t.id}`, {
      ...macDinhCuaBuoi({ sourceType: "TRIAL_SESSION", trangThai: t.status, teacherId: t.teacherId, lopTrial: t.trialClass }),
      ngay: t.date.toISOString().slice(0, 10),
      gioBatDau: t.startTime,
      gioKetThuc: t.endTime,
      nguoiDay: gv ? { id: gv, nguon: t.teacherId ? "trial.teacherId" : "trialClass.teacherId" } : null,
    });
  }
  return buoi;
}

/** Dung sai theo CƠ SỞ (setting cho phép cơ sở ghi đè). Số câu = 1 + 3 × số cơ sở — bị chặn bởi số cơ sở, không theo phân công. */
export async function dungSaiTheoCoSo(centerIds: readonly string[]): Promise<Map<string, DungSai>> {
  const don = centerIds.length ? await db.orgUnit.findMany({ where: { centerId: { in: [...centerIds] }, deletedAt: null }, select: { id: true, centerId: true } }) : [];
  const ouCua = new Map(don.map((d) => [d.centerId, d.id]));
  const ra = new Map<string, DungSai>();
  await Promise.all(
    centerIds.map(async (c) => {
      const o = { orgUnitId: ouCua.get(c) ?? null };
      const [treVaoPhut, veSomPhut, bamTrungPhut, graceCutoverDen] = await Promise.all([
        getSetting("shift.parttimeTreVaoPhut", o),
        getSetting("shift.parttimeVeSomPhut", o),
        getSetting("shift.duplicateTapMinutes", o),
        // Q5 — mốc grace cutover của cơ sở (cùng gói tham số theo cơ sở; rỗng = không grace).
        getSetting("shift.parttimeCutoverGraceDen", o),
      ]);
      ra.set(c, { treVaoPhut, veSomPhut, bamTrungPhut, graceCutoverDen });
    }),
  );
  return ra;
}

/** Lõi chung: phân công + buổi + lượt + chính sách + dung sai ⇒ kết quả từng phân công. */
function tinh(p: {
  pcs: PcDoc[];
  buoi: Map<string, ThongTinBuoi>;
  luot: LuotDoc[];
  chinhSach: BanChinhSach[];
  dungSai: Map<string, DungSai>;
  now: Date;
}): { ketQua: BangChungPhanCong[]; khoangCua: (userId: string, ngay: string, bamTrung: number) => KhoangCoMat[]; luotTheoNgay: Map<string, LuotQuetHopLe[]> } {
  const luotTheoNgay = new Map<string, LuotQuetHopLe[]>();
  for (const l of p.luot) {
    const k = `${l.userId}|${l.workDate.toISOString().slice(0, 10)}`;
    luotTheoNgay.set(k, [...(luotTheoNgay.get(k) ?? []), { id: l.id, loggedAt: l.loggedAt, direction: l.direction, centerId: l.centerId, flags: l.flags }]);
  }
  const cache = new Map<string, KhoangCoMat[]>();
  const khoangCua = (userId: string, ngay: string, bamTrung: number) => {
    const k = `${userId}|${ngay}|${bamTrung}`;
    let v = cache.get(k);
    if (!v) {
      v = khoangCoMatTrongNgay(luotTheoNgay.get(`${userId}|${ngay}`) ?? [], bamTrung);
      cache.set(k, v);
    }
    return v;
  };

  const ketQua: BangChungPhanCong[] = [];
  for (const x of p.pcs) {
    const b = p.buoi.get(`${x.sourceType}:${x.sourceId}`);
    if (!b) continue; // nguồn ngoài cơ sở / ngoài khoảng (phân công lệch nguồn — việc của bộ đồng bộ)
    if (x.status === "CANCELLED" && b.tinhTrang !== "DA_DONG") continue; // huỷ khi buổi vẫn mở = bị đổi người, không phải nghĩa vụ
    const ngay = x.ngay.toISOString().slice(0, 10);
    const cs = chinhSachTaiNgay(p.chinhSach, ngay);
    const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
    const ds = p.dungSai.get(x.centerId) ?? { treVaoPhut: 0, veSomPhut: 0, bamTrungPhut: 2, graceCutoverDen: "" };
    ketQua.push(
      danhGiaBangChung({
        phanCong: {
          id: x.id,
          phienBan: x.assignmentVersion,
          userId: x.userId,
          role: x.role,
          status: x.status,
          activity: x.activityType,
          sourceType: x.sourceType,
          sourceId: x.sourceId,
          centerId: x.centerId,
          ngay,
          gioBatDau: x.gioBatDau,
          gioKetThuc: x.gioKetThuc,
        },
        daNhan: daGan(x),
        graceCutover: trongGraceCutover({ assignmentType: x.assignmentType, status: x.status, ngay, graceDen: ds.graceCutoverDen }),
        buoi: { tinhTrang: b.tinhTrang, apDung: ts != null, nguoiDay: b.nguoiDay },
        chuanBiPhut: ts?.tiet.chuanBiPhut ?? null,
        chinhSach: cs?.code ?? null,
        khoang: khoangCua(x.userId, ngay, ds.bamTrungPhut),
        dungSai: { treVaoPhut: ds.treVaoPhut, veSomPhut: ds.veSomPhut },
        now: p.now,
      }),
    );
  }
  return { ketQua, khoangCua, luotTheoNgay };
}

export type KetQuaBangChungCong = {
  phanCong: BangChungPhanCong[];
  buoi: NgoaiLeBuoi[];
  luotKhongGan: LuotKhongGan[];
};

/** MỘT cơ sở × khoảng ngày — Control Tower. Nơi gọi đã kiểm quyền xem cơ sở. */
export async function docBangChungCong(p: { centerId: string; tu: string; den: string; now: Date }): Promise<KetQuaBangChungCong> {
  const sau = new Date(dauNgayVn(p.den).getTime() + 86_400_000);
  const [pcs, lop, bu, trial, chinhSach, dungSai, lopCuaCoSo] = await Promise.all([
    db.sessionStaffAssignment.findMany({
      where: { centerId: p.centerId, ngay: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: TRANG_THAI_XET }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      include: CHON_PC,
    }),
    db.classSession.findMany({ where: { date: { gte: dauNgayVn(p.tu), lt: sau }, OR: [{ centerId: p.centerId }, { centerId: null, class: { centerId: p.centerId } }] }, select: CHON_LOP }),
    db.makeupCase.findMany({ where: { centerId: p.centerId, date: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { not: CASE_CHO_DUYET } }, select: CHON_BU }),
    db.trialClassSession.findMany({ where: { trialClass: { centerId: p.centerId }, date: { gte: ngayDate(p.tu), lte: ngayDate(p.den) } }, select: CHON_TRIAL }),
    docChinhSach(),
    dungSaiTheoCoSo([p.centerId]),
    db.class.findMany({ where: { centerId: p.centerId, deletedAt: null }, select: { teacherId: true, assistantId: true } }),
  ]);
  const buoi = bangBuoi(lop, bu, trial);
  // Nhóm DẠY HỌC của cơ sở = người được phân + người mặc định / thực dạy của mọi buổi + GV/TA của lớp ở cơ sở. CHỈ đọc lượt
  // của nhóm này: nhân sự toàn thời gian (sale, CSKH, kế toán) quẹt ở cơ sở không thuộc miền parttime — đo prod 05–11/10/2026:
  // CS1 11 người có lượt, 5 không phải GV; CS2 10 / 3. Đọc cả họ là "Có mặt ngoài phân công" thành một bức tường tên vô can.
  const nhomDayHoc = new Set<string>(pcs.map((x) => x.userId));
  for (const b of buoi.values()) for (const id of [b.macDinhMainId, b.macDinhTaId, b.nguoiDay?.id]) if (id) nhomDayHoc.add(id);
  for (const l of lopCuaCoSo) for (const id of [l.teacherId, l.assistantId]) if (id) nhomDayHoc.add(id);
  const luot = nhomDayHoc.size
    ? await db.staffTimeLog.findMany({
        where: { workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, ...LUOT_CON_TINH, userId: { in: [...nhomDayHoc] } },
        select: CHON_LUOT,
      })
    : [];
  const { ketQua, khoangCua, luotTheoNgay } = tinh({ pcs, buoi, luot, chinhSach, dungSai, now: p.now });
  const bamTrung = dungSai.get(p.centerId)?.bamTrungPhut ?? 2;

  // ── Ngoại lệ cấp buổi (kể cả buổi KHÔNG có phân công nào) ──
  const theoBuoi = new Map<string, BangChungPhanCong[]>();
  for (const r of ketQua) {
    const k = `${r.sourceType}:${r.sourceId}`;
    theoBuoi.set(k, [...(theoBuoi.get(k) ?? []), r]);
  }
  const ngoaiLe: NgoaiLeBuoi[] = [];
  for (const [key, b] of buoi) {
    const [sourceType, sourceId] = key.split(":") as [WorkSourceType, string];
    const cs = chinhSachTaiNgay(chinhSach, b.ngay);
    const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
    if (!ts) continue;
    const ds = theoBuoi.get(key) ?? [];
    const batDau = mocVn(b.ngay, b.gioBatDau);
    ngoaiLe.push(
      ...ngoaiLeCapBuoi({
        sourceType,
        sourceId,
        centerId: p.centerId,
        tinhTrang: b.tinhTrang,
        apDung: true,
        requiredFrom: new Date(batDau.getTime() - ts.tiet.chuanBiPhut * 60_000),
        requiredTo: mocVn(b.ngay, b.gioKetThuc),
        coMainDaNhan: ds.some((r) => r.role === "MAIN_TEACHER" && r.daNhan),
        coTaSong: ds.some((r) => r.role === "TEACHING_ASSISTANT"),
        macDinhTaId: b.macDinhTaId,
        khoangTaMacDinh: b.macDinhTaId ? khoangCua(b.macDinhTaId, b.ngay, bamTrung) : [],
        now: p.now,
      }),
    );
  }

  // ── Có mặt ở cơ sở này mà không gắn với phân công nào (ngữ cảnh, không phải lỗi) ──
  const khungTheoNgay = new Map<string, { tu: Date; den: Date }[]>();
  for (const r of ketQua) {
    if (!r.requiredFrom || !r.requiredTo) continue;
    const k = `${r.userId}|${r.workDate}`;
    khungTheoNgay.set(k, [...(khungTheoNgay.get(k) ?? []), { tu: r.requiredFrom, den: r.requiredTo }]);
  }
  const khongGan: LuotKhongGan[] = [];
  for (const k of luotTheoNgay.keys()) {
    const [userId, workDate] = k.split("|");
    if (chinhSachTaiNgay(chinhSach, workDate)?.thamSo.loai !== "SR_QD_238") continue; // ngày LEGACY (trước 15/10) bỏ qua
    khongGan.push(...luotKhongGan({ userId, workDate, centerId: p.centerId, khoang: khoangCua(userId, workDate, bamTrung), khungPhanCong: khungTheoNgay.get(k) ?? [], now: p.now }));
  }

  return { phanCong: ketQua, buoi: ngoaiLe, luotKhongGan: khongGan };
}

/**
 * MỘT người × khoảng ngày — "Công việc của tôi". `userId` PHẢI lấy từ phiên (nơi gọi). Chỉ đọc phân công + lượt của chính người
 * đó; buổi đọc theo id của các phân công (mọi cơ sở). Dung sai theo cơ sở của TỪNG phân công.
 */
export async function docBangChungCuaToi(p: { userId: string; tu: string; den: string; now: Date }): Promise<BangChungPhanCong[]> {
  const [pcs, chinhSach, luot] = await Promise.all([
    db.sessionStaffAssignment.findMany({
      where: { userId: p.userId, ngay: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: TRANG_THAI_XET }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      include: CHON_PC,
    }),
    docChinhSach(),
    db.staffTimeLog.findMany({ where: { userId: p.userId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, ...LUOT_CON_TINH }, select: CHON_LUOT }),
  ]);
  if (pcs.length === 0) return [];
  const ids = (t: WorkSourceType) => pcs.filter((x) => x.sourceType === t).map((x) => x.sourceId);
  const [lop, bu, trial, dungSai] = await Promise.all([
    ids("CLASS_SESSION").length ? db.classSession.findMany({ where: { id: { in: ids("CLASS_SESSION") } }, select: CHON_LOP }) : [],
    ids("MAKEUP_CASE").length ? db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: CHON_BU }) : [],
    ids("TRIAL_SESSION").length ? db.trialClassSession.findMany({ where: { id: { in: ids("TRIAL_SESSION") } }, select: CHON_TRIAL }) : [],
    dungSaiTheoCoSo([...new Set(pcs.map((x) => x.centerId))]),
  ]);
  return tinh({ pcs, buoi: bangBuoi(lop, bu, trial), luot, chinhSach, dungSai, now: p.now }).ketQua;
}
