import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getBalance, listTransactions } from "@/lib/satacoin/service";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { getStudentAssignmentTrack } from "@/lib/portal/student-assignments";
import { getTeacherEvalBlocks } from "@/lib/portal/student-teacher-eval";
import { getStudentFeedback } from "@/lib/portal/feedback";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentExams, getStudentExamResults } from "@/lib/portal/learning";
import { getStudentPhotos } from "@/lib/portal/photos";
import { GHI_DANH_CO_LICH_SU } from "@/lib/portal/trang-thai-ghi-danh";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import { docLichSuGiaDinh } from "@/lib/disc/portal-doc";
import { isDiscEnabled } from "@/lib/flags";
import { coMaThoat, docNamSinhCacCon, docNhatKy, docTrangThaiKhoa, type DongNhatKy as NhatKyTho } from "@/lib/portal/hv-ma";
import { vnParts } from "@/lib/time/vn";
import { chuVietTat, mauAvatarTheoId, tenGoi } from "@/lib/portal/hv-dieu-huong";
import { mucBaiTapBaiThiDangHien, mucSataCoinDangHien } from "@/lib/portal/muc-tam-an";
import {
  cauChao,
  conBuoiToiDemo,
  nhanConNgayEm,
  nhanHanBai,
  nhanNgayHomNay,
  nhanNgayNgan,
  phanTram,
  noiDungLoiDan,
  thuDayDu,
  viTriHocPhan,
} from "@/lib/portal/hv-hom-nay-thuan";
import {
  chonBaiCanLam,
  dungBaiDaNop,
  kieuBaiThi,
  type BaiNopTho,
  type ThiTho,
} from "@/lib/portal/hv-bai-tap-thuan";
import { dungLuoiThang, thangKe } from "@/lib/portal/hanh-trinh-thuan";
import { chiTietCacNgay, dongLichHoc, dungDanhSachLich, type BuoiLich } from "@/lib/portal/hv-lich-thuan";
import { changMacDinh, dungBanDo, gomKyNang, huyHieuTheoMuc, tinhHuyHieu, type BuoiVaoBanDo } from "@/lib/portal/hv-hanh-trinh-thuan";
import { boLocTinTheoMuc, demTinMoi, docMocDaXem, nhanChuaDoc, sapXepTin, tenCookieDaXem, type TinHv } from "@/lib/portal/hv-thong-bao-thuan";
import { chonRobot, timDiemCuaBe } from "@/lib/portal/hv-tinh-cach-thuan";

// Cổng học sinh — dữ liệu các màn. Mọi hàm nhận `studentId` ĐÃ XÁC MINH (lấy từ `requireActiveStudent({ choHocSinh: true })`,
// tức từ token chế độ học sinh) — KHÔNG nhận id qua URL. Đọc lại các loader đã có trong lib/portal, không đếm lại.
// Nguồn nào hỏng thì nguồn đó rỗng (`.catch`), không làm sập cả trang của một em nhỏ.

export const hvSessions = cache((id: string) => getStudentSessionsView(id));
export const hvSchedule = cache((id: string) => getStudentSchedule(id));
export const hvTrack = cache((id: string) => getStudentAssignmentTrack(id));
export const hvSoDu = cache((id: string) => getBalance(id).catch(() => 0));
export const hvDanhGia = cache((id: string) => getTeacherEvalBlocks(id).catch(() => []));


// ── Thông báo của em ───────────────────────────────────────────────────────────────

const hvDocTin = cache(async (studentId: string): Promise<TinHv[]> => {
  const now = new Date();
  // «Bài tập & bài thi» tạm ẩn (03/11/2026): không nạp bài đã chấm / nhắc hạn nộp — tin không được dẫn tới trang đã 404.
  const coBai = mucBaiTapBaiThiDangHien();
  // «SataCoin» tạm ẩn (04/11/2026): không đọc giao dịch ⇒ không có tin «Em nhận +N coin».
  const coCoin = mucSataCoinDangHien();
  const [feedback, daCham, soDu, track, sess, blocks, anh] = await Promise.all([
    getStudentFeedback(studentId, 3).catch(() => []),
    coBai
      ? db.assignmentSubmission
          .findMany({
            where: { studentId, status: "GRADED", gradedAt: { not: null }, score: { not: null } },
            orderBy: { gradedAt: "desc" },
            take: 3,
            select: { id: true, gradedAt: true, score: true, assignment: { select: { title: true, totalPoints: true } } },
          })
          .catch(() => [])
      : Promise.resolve([]),
    coCoin ? listTransactions(studentId, 6).catch(() => []) : Promise.resolve([]),
    coBai ? hvTrack(studentId).catch(() => null) : Promise.resolve(null),
    hvSessions(studentId).catch(() => null),
    hvDanhGia(studentId),
    anhMoiCuaBe(studentId).catch(() => []),
  ]);
  const tin: TinHv[] = [];

  for (const f of feedback) {
    tin.push({
      id: `nx-${f.id}`,
      loc: "khac",
      ten: f.order ? `Thầy cô đã nhận xét buổi ${f.order} của em` : "Thầy cô đã nhận xét buổi học của em",
      luc: f.chamLucISO || f.dateISO,
      href: "/portal/hoc-sinh",
      ky: "✎",
      sac: "nen",
    });
  }
  for (const s of daCham) {
    const tong = s.assignment.totalPoints;
    const diem = tong === 10 ? String(s.score).replace(".", ",") : `${s.score}/${tong}`;
    tin.push({
      id: `cham-${s.id}`,
      loc: "bt",
      ten: `Thầy cô đã chấm bài “${s.assignment.title}” của em: ${diem}${tong === 10 ? "/10" : ""}`,
      luc: (s.gradedAt as Date).toISOString(),
      href: "/portal/hoc-sinh/bai-tap",
      ky: String(s.score).replace(".", ",").slice(0, 3),
      sac: "xanh",
    });
  }
  for (const t of soDu) {
    if (t.amount <= 0 || t.type === "REVERSAL") continue;
    tin.push({
      id: `coin-${t.id}`,
      loc: "huy",
      ten: `Em nhận +${t.amount} coin${t.note ? ` · ${t.note}` : ""}`,
      luc: t.createdAt.toISOString(),
      href: "/portal/hoc-sinh/hanh-trinh",
      ky: "★",
      sac: "cam",
    });
  }
  // Nhắc hạn bài: coi như "tin" xuất hiện từ 2 ngày trước hạn.
  const baiGan = track ? chonBaiCanLam(track.items, track.ngoaiLoTrinh, now) : [];
  for (const b of baiGan) {
    if (!b.dueAt) continue;
    const luc = new Date(Date.parse(b.dueAt) - 2 * 86_400_000);
    if (luc.getTime() > now.getTime()) continue;
    tin.push({
      id: `han-${b.id}`,
      loc: "bt",
      ten: `Nhắc: hạn nộp “${b.ten}” là ${nhanNgayNgan(b.dueAt)}`,
      luc: luc.toISOString(),
      href: "/portal/hoc-sinh/bai-tap",
      ky: "!",
      sac: "cam",
    });
  }
  for (const a of anh) {
    const b = sess?.sessions.find((s) => s.id === a.sessionId);
    tin.push({
      id: `anh-${a.sessionId}`,
      loc: "huy",
      ten: b ? `Ảnh sản phẩm buổi ${b.order} đã lên Góc sản phẩm` : "Có ảnh sản phẩm mới trong Góc sản phẩm",
      luc: a.luc,
      href: "/portal/hoc-sinh/san-pham",
      ky: "▣",
      sac: "tim",
    });
  }
  // Nhắc buổi học kế tiếp (trong 3 ngày) — nhắc từ 2 ngày trước buổi học.
  const tiep = sess?.sessions.find((s) => !s.past && s.attendance !== "CANCELLED");
  if (tiep) {
    const luc = new Date(Date.parse(tiep.date) - 2 * 86_400_000);
    if (luc.getTime() <= now.getTime()) {
      tin.push({
        id: `lich-${tiep.id}`,
        loc: "lich",
        ten: `Nhắc: buổi ${tiep.order} học vào ${nhanNgayNgan(tiep.date)}`,
        luc: luc.toISOString(),
        href: "/portal/hoc-sinh/lich",
        ky: "▦",
        sac: "nen",
      });
    }
  }
  if (blocks.length > 0) {
    const rounds = await db.evaluationRound
      .findMany({ where: { id: { in: blocks.map((b) => b.roundId) } }, select: { id: true, opensAt: true, createdAt: true } })
      .catch(() => []);
    for (const r of rounds) {
      tin.push({
        id: `dg-${r.id}`,
        loc: "khac",
        ten: "Đợt đánh giá thầy cô đã mở",
        luc: (r.opensAt ?? r.createdAt).toISOString(),
        href: "/portal/hoc-sinh/danh-gia-gv",
        ky: "☺",
        sac: "tim",
      });
    }
  }
  return sapXepTin(tin).slice(0, 14);
});

async function anhMoiCuaBe(studentId: string): Promise<{ sessionId: string; luc: string }[]> {
  if (!(await hasMediaConsent(studentId))) return [];
  const enr = await db.enrollment.findMany({
    where: { studentId, status: { in: [...GHI_DANH_CO_LICH_SU] }, deletedAt: null },
    select: { classId: true },
  });
  if (enr.length === 0) return [];
  const media = await db.classSessionMedia.findMany({
    where: {
      classId: { in: enr.map((e) => e.classId) },
      status: "APPROVED",
      classSessionId: { not: null },
      OR: [{ tags: { some: { studentId } } }, { isClassWide: true }],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { classSessionId: true, createdAt: true },
  });
  const thay = new Map<string, string>();
  for (const m of media) if (m.classSessionId && !thay.has(m.classSessionId)) thay.set(m.classSessionId, m.createdAt.toISOString());
  return [...thay.entries()].slice(0, 2).map(([sessionId, luc]) => ({ sessionId, luc }));
}

async function docMocDaXemCuaBe(studentId: string): Promise<number | null> {
  return docMocDaXem((await cookies()).get(tenCookieDaXem(studentId))?.value, new Date());
}

// ── Vỏ (menu bên / thanh trên) ────────────────────────────────────────────────────

export type HvVo = {
  ten: string;
  tat: string;
  /** `Student.avatarUrl` — ảnh đại diện admin/phụ huynh đặt; null = vẽ chữ viết tắt. */
  anhUrl: string | null;
  phu: string;
  mauAv: 0 | 1 | 2;
  /** Số dư SataCoin; `null` = mục «SataCoin» đang tạm ẩn (04/11/2026) ⇒ vỏ không vẽ chip coin. BẮT BUỘC khai. */
  coin: number | null;
  tinMoi: number;
  baiTap: number;
  danhGia: number;
  /** «Bài tập & bài thi» đang hiện không (tạm ẩn 03/11/2026) — vỏ dùng để bỏ mục khỏi menu + thanh tab. */
  coBaiTap: boolean;
};

export async function docHvVo(studentId: string, ten: string): Promise<HvVo> {
  const coBaiTap = mucBaiTapBaiThiDangHien();
  const [sched, coin, track, blocks, tin, moc, anh] = await Promise.all([
    hvSchedule(studentId).catch(() => null),
    mucSataCoinDangHien() ? hvSoDu(studentId) : Promise.resolve(null),
    coBaiTap ? hvTrack(studentId).catch(() => null) : Promise.resolve(null),
    hvDanhGia(studentId),
    hvDocTin(studentId),
    docMocDaXemCuaBe(studentId),
    db.student.findUnique({ where: { id: studentId }, select: { avatarUrl: true } }).catch(() => null),
  ]);
  const phu = [sched?.courseName, sched?.className].filter((x): x is string => !!x).join(" · ");
  return {
    ten,
    tat: chuVietTat(ten),
    anhUrl: anh?.avatarUrl ?? null,
    phu: phu || "Cổng học sinh",
    mauAv: mauAvatarTheoId(studentId),
    coin,
    tinMoi: demTinMoi(tin, moc, new Date()),
    baiTap: coBaiTap && track ? chonBaiCanLam(track.items, track.ngoaiLoTrinh, new Date()).length : 0,
    danhGia: blocks.reduce((n, b) => n + b.pairs.length, 0),
    coBaiTap,
  };
}

// ── Hôm nay ───────────────────────────────────────────────────────────────────────────

export type HvHomNay = {
  ten: string;
  nhanHomNay: string;
  chao: string;
  xong: number;
  huyHieu: number;
  huyHieuTong: number;
  /** Số dư SataCoin; `null` = đang tạm ẩn ⇒ «Hôm nay» chỉ vẽ hai ô (buổi đã học · huy hiệu). */
  coin: number | null;
  tiep: null | {
    so: number | null;
    ten: string | null;
    ngayNhan: string;
    gio: string | null;
    conNgay: string;
    giaoVien: string | null;
    noi: string | null;
  };
  baiTap: null | { id: string; buoi: number | null; ten: string; han: string; gap: boolean; thieuBai: number };
  /** «Bài tập & bài thi» đang hiện không — ẩn thì thẻ «Bài về nhà» (và lời "đã nộp hết bài") không vẽ. */
  coBaiTap: boolean;
  danhGia: null | { giaoVien: string; dot: string };
  loiDan: null | { noiDung: string; giaoVien: string | null; buoi: number | null };
  tienDo: { pct: number; hocPhan: number; trong: number; o: boolean[]; conLai: string | null };
  tin: TinHv[];
  tinMoi: number;
};

export async function docHvHomNay(studentId: string, ten: string): Promise<HvHomNay> {
  const now = new Date();
  const coBaiTap = mucBaiTapBaiThiDangHien();
  const [sched, sess, soDu, track, blocks, feedback, tin, moc, huy] = await Promise.all([
    hvSchedule(studentId),
    hvSessions(studentId),
    mucSataCoinDangHien() ? hvSoDu(studentId) : Promise.resolve(null),
    coBaiTap ? hvTrack(studentId) : Promise.resolve(null),
    hvDanhGia(studentId),
    getStudentFeedback(studentId, 1).catch(() => []),
    hvDocTin(studentId),
    docMocDaXemCuaBe(studentId),
    docHuyHieu(studentId),
  ]);
  const baiCan = track ? chonBaiCanLam(track.items, track.ngoaiLoTrinh, now) : [];
  const next = sched?.next ?? null;
  const gioTiep = next?.time ? next.time.replace(" - ", "–") : null;
  const tienDo = viTriHocPhan(sess.done, sess.total);
  const demo = conBuoiToiDemo(
    sess.sessions.map((s) => ({ order: s.order, title: s.title })),
    sess.done,
  );
  const dot = blocks[0];
  const nx = feedback[0];
  const b0 = baiCan[0];
  return {
    ten: tenGoi(ten),
    nhanHomNay: nhanNgayHomNay(now),
    chao: cauChao({ tiep: next ? { homNay: next.homNay, ngayISO: next.dateISO, so: next.order } : null, soBaiChuaNop: baiCan.length }),
    xong: sess.done,
    huyHieu: huy.da,
    huyHieuTong: huy.tong,
    coin: soDu,
    tiep: next
      ? {
          so: next.order,
          ten: next.title === "Buổi học" ? null : next.title,
          ngayNhan: nhanNgayNgan(next.dateISO),
          gio: gioTiep,
          conNgay: nhanConNgayEm(next.dateISO, now),
          giaoVien: next.teacher,
          noi: next.room,
        }
      : null,
    coBaiTap,
    baiTap: b0 ? { id: b0.id, buoi: b0.buoi, ten: b0.ten, han: b0.han.nhan, gap: b0.han.gap, thieuBai: baiCan.length } : null,
    danhGia: dot && dot.pairs[0] ? { giaoVien: dot.pairs[0].teacherName, dot: dot.name } : null,
    loiDan: nx ? { noiDung: noiDungLoiDan(nx.comment, 280), giaoVien: nx.teacher, buoi: nx.order } : null,
    tienDo: {
      pct: phanTram(sess.done, sess.total),
      hocPhan: tienDo.hocPhan,
      trong: tienDo.trong,
      o: tienDo.o,
      conLai: demo === null ? null : demo === 0 ? "Buổi tới là buổi demo sản phẩm!" : `Còn ${demo} buổi nữa là tới buổi demo sản phẩm!`,
    },
    tin: tin.slice(0, 2),
    tinMoi: demTinMoi(tin, moc, now),
  };
}

// ── Lịch ───────────────────────────────────────────────────────────────────────────────

export type HvLich = {
  tenKhoa: string | null;
  tenLop: string | null;
  dongLich: string | null;
  tiepNhan: string | null;
  y: number;
  m0: number;
  truoc: { y: number; m0: number };
  sau: { y: number; m0: number };
  o: { key: string; ngay: number; trongThang: boolean; homNay: boolean; kieu: "xong" | "tiep" | "sap" | "khong" }[];
  chiTiet: Record<string, { key: string; n: number; ten: string | null; nhanNgay: string; ghi: string }>;
  sapToi: ReturnType<typeof dungDanhSachLich>["sapToi"];
  daHoc: ReturnType<typeof dungDanhSachLich>["daHoc"];
  soBuoiVang: number;
};

export async function docHvLich(studentId: string, y: number, m0: number): Promise<HvLich> {
  const now = new Date();
  const [sched, sess, makeup] = await Promise.all([hvSchedule(studentId), hvSessions(studentId), getStudentMakeup(studentId).catch(() => null)]);
  const lop = sched?.next?.className ?? sess.sessions.find((s) => s.className)?.className ?? null;
  const cua = sess.sessions.filter((s) => lop === null || s.className === lop);
  const buoi: BuoiLich[] = cua.map((s) => ({
    id: s.id,
    order: s.order,
    title: s.title,
    dateISO: s.date,
    past: s.past,
    attendance: s.attendance,
  }));
  const tiepId = sched?.next?.id ?? null;
  const gio = sched?.next?.time ?? null;
  const ds = dungDanhSachLich(buoi, tiepId, now);
  return {
    tenKhoa: sess.courseName,
    tenLop: lop ?? sess.className,
    dongLich: dongLichHoc({ thuDayDu: sched?.next ? thuDayDu(sched.next.dateISO) : null, gio, phong: sched?.next?.room ?? null }),
    tiepNhan: sched?.next ? nhanNgayNgan(sched.next.dateISO) : null,
    y,
    m0,
    truoc: thangKe(y, m0, -1),
    sau: thangKe(y, m0, 1),
    o: dungLuoiThang(
      y,
      m0,
      buoi.map((b) => ({ id: b.id, dateISO: b.dateISO, past: b.past, huy: b.attendance === "CANCELLED" })),
      tiepId,
      now,
    ),
    chiTiet: chiTietCacNgay(buoi, tiepId, gio),
    sapToi: ds.sapToi,
    daHoc: ds.daHoc,
    soBuoiVang: makeup?.needCount ?? 0,
  };
}

// ── Hành trình & huy hiệu ─────────────────────────────────────────────────────────────

async function docHuyHieu(studentId: string) {
  // Hai huy hiệu cần bài tập (đúng hẹn · điểm 10) ẩn cùng mục «Bài tập & bài thi» (03/11/2026) ⇒ khỏi đọc bài nộp.
  const coBaiTap = mucBaiTapBaiThiDangHien();
  const [sess, dung, tuyetDoi, nhom] = await Promise.all([
    hvSessions(studentId).catch(() => null),
    coBaiTap
      ? db.assignmentSubmission
          .findMany({
            where: { studentId, status: { in: ["SUBMITTED", "GRADED"] }, submittedAt: { not: null }, assignment: { dueAt: { not: null } } },
            select: { submittedAt: true, assignment: { select: { dueAt: true } } },
            take: 200,
          })
          .catch(() => [])
      : Promise.resolve([]),
    coBaiTap
      ? db.assignmentSubmission
          .findMany({ where: { studentId, status: "GRADED", score: { not: null } }, select: { score: true, assignment: { select: { totalPoints: true } } }, take: 200 })
          .catch(() => [])
      : Promise.resolve([]),
    db.studentSkillAssessment
      .findFirst({ where: { studentId, skill: "TEAMWORK" }, orderBy: { assessedAt: "desc" }, select: { level: true } })
      .catch(() => null),
  ]);
  const sapTheoBuoi = [...(sess?.sessions ?? [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const tinh = tinhHuyHieu({
    daHoc: sess?.done ?? 0,
    tong: sess?.total ?? 0,
    baiDungHan: dung.filter((d) => d.submittedAt && d.assignment.dueAt && d.submittedAt.getTime() <= d.assignment.dueAt.getTime() && d.assignment.dueAt.getUTCFullYear() > 1971).length,
    coBaiDiemToiDa: tuyetDoi.some((d) => d.assignment.totalPoints > 0 && (d.score ?? 0) >= d.assignment.totalPoints),
    diemDanh: sapTheoBuoi.map((s) => s.attendance),
    nhom: nhom?.level ?? null,
  });
  const ds = huyHieuTheoMuc(tinh, coBaiTap);
  return { ds, da: ds.filter((h) => h.da).length, tong: ds.length };
}

export async function docHvHanhTrinh(studentId: string, ten: string) {
  const [sess, sched, soDu, huy, ky, giaoDich, anh] = await Promise.all([
    hvSessions(studentId),
    hvSchedule(studentId),
    mucSataCoinDangHien() ? hvSoDu(studentId) : Promise.resolve(null),
    docHuyHieu(studentId),
    db.studentSkillAssessment.findMany({ where: { studentId }, orderBy: { assessedAt: "desc" }, select: { skill: true, level: true } }).catch(() => []),
    mucSataCoinDangHien() ? listTransactions(studentId, 6).catch(() => []) : Promise.resolve([]),
    anhTheoBuoi(studentId).catch(() => new Set<string>()),
  ]);
  const lop = sched?.next?.className ?? sess.sessions.find((s) => s.className)?.className ?? null;
  const cua = sess.sessions.filter((s) => lop === null || s.className === lop);
  const buoi: BuoiVaoBanDo[] = cua.map((s) => ({
    id: s.id,
    order: s.order,
    title: s.title,
    ngayNgan: nhanNgayNgan(s.date),
    past: s.past,
    attendance: s.attendance,
  }));
  const banDo = dungBanDo(buoi, sched?.next?.id ?? null, sess.total, anh);
  return {
    ten,
    tenKhoa: sess.courseName,
    soHocPhan: banDo.length,
    soChang: banDo.reduce((n, h) => n + h.chang.length, 0),
    xong: sess.done,
    pct: phanTram(sess.done, sess.total),
    banDo,
    changMo: changMacDinh(banDo),
    huyHieu: huy.ds,
    huyHieuDa: huy.da,
    kyNang: gomKyNang(ky),
    coin: soDu,
    giaoDich: giaoDich.map((t) => ({
      id: t.id,
      ten: t.note || (t.type === "SPEND" ? "Đổi quà" : t.type === "REVERSAL" ? "Điều chỉnh coin" : "Nhận coin"),
      luc: t.createdAt.toISOString(),
      so: t.amount,
    })),
  };
}

async function anhTheoBuoi(studentId: string): Promise<Set<string>> {
  if (!(await hasMediaConsent(studentId))) return new Set();
  const enr = await db.enrollment.findMany({
    where: { studentId, status: { in: [...GHI_DANH_CO_LICH_SU] }, deletedAt: null },
    select: { classId: true },
  });
  if (enr.length === 0) return new Set();
  const m = await db.classSessionMedia.findMany({
    where: {
      classId: { in: enr.map((e) => e.classId) },
      status: "APPROVED",
      classSessionId: { not: null },
      OR: [{ tags: { some: { studentId } } }, { isClassWide: true }],
    },
    select: { classSessionId: true },
    distinct: ["classSessionId"],
    take: 200,
  });
  return new Set(m.flatMap((x) => (x.classSessionId ? [x.classSessionId] : [])));
}

// ── Bài tập & bài thi ──────────────────────────────────────────────────────────────────

export async function docHvBaiTap(studentId: string) {
  const now = new Date();
  const [track, sess, nop, exams] = await Promise.all([
    hvTrack(studentId),
    hvSessions(studentId),
    db.assignmentSubmission
      .findMany({
        where: { studentId, status: { in: ["SUBMITTED", "LATE", "GRADED"] } },
        orderBy: { submittedAt: "desc" },
        take: 30,
        select: { status: true, score: true, feedback: true, submittedAt: true, assignment: { select: { id: true, title: true, totalPoints: true } } },
      })
      .catch(() => []),
    getStudentExams(studentId).catch(() => []),
  ]);
  const canLam = chonBaiCanLam(track.items, track.ngoaiLoTrinh, now);
  const buoiCua = new Map<string, number>();
  for (const it of track.items) if (it.assignment) buoiCua.set(it.assignment.id, it.order);
  const rows: BaiNopTho[] = nop.map((s) => ({
    id: s.assignment.id,
    title: s.assignment.title,
    status: s.status as BaiNopTho["status"],
    score: s.score,
    tong: s.assignment.totalPoints,
    feedback: s.feedback,
    submittedAt: s.submittedAt?.toISOString() ?? null,
  }));
  const thi = exams.map((e): ThiTho & { lop: string | null; kieu: ReturnType<typeof kieuBaiThi> } => {
    const t: ThiTho = {
      id: e.id,
      title: e.title,
      durationMinutes: e.durationMinutes,
      isOpen: e.isOpen,
      closeAt: e.closeAt,
      maxAttempts: e.maxAttempts,
      attemptsUsed: e.attemptsUsed,
      attemptStatus: e.attemptStatus,
      totalScore: e.totalScore,
    };
    return { ...t, lop: e.className, kieu: kieuBaiThi(t, now) };
  });
  return {
    tenKhoa: sess.courseName,
    canLam,
    daNop: dungBaiDaNop(rows, buoiCua),
    thi,
    soCanLam: canLam.length,
  };
}

export async function docHvBaiTapChiTiet(studentId: string, assignmentId: string) {
  const { getAssignmentDetail } = await import("@/lib/portal/learning");
  const a = await getAssignmentDetail(studentId, assignmentId);
  if (!a) return null;
  const track = await hvTrack(studentId);
  const buoi = track.items.find((i) => i.assignment?.id === assignmentId)?.order ?? null;
  return { a, buoi, hanBai: a.dueAt ? nhanHanBai(a.dueAt, new Date()) : { nhan: "", gap: false } };
}

export async function docHvKetQuaThi(studentId: string) {
  return getStudentExamResults(studentId).catch(() => []);
}

// ── Sản phẩm & tính cách ───────────────────────────────────────────────────────────────

export async function docHvSanPham(studentId: string, parentUserId: string, tenBe: string) {
  const [anh, sess] = await Promise.all([getStudentPhotos(studentId), hvSessions(studentId).catch(() => null)]);
  const lichSu = isDiscEnabled() ? await docLichSuGiaDinh(parentUserId).catch(() => []) : [];
  const diem = timDiemCuaBe(lichSu, tenBe);
  const robot = diem ? chonRobot(diem) : null;
  const sp = anh.groups.map((g) => ({
    sessionId: g.sessionId,
    buoi: g.order,
    ten: g.title.replace(/^Buổi\s+\d+\s*[-–—]\s*/i, "").replace(/^HP\d+\s*[-–—]\s*/i, "").trim() || null,
    nhanNgay: g.nhanNgay,
    anh: g.photos,
  }));
  return { dongY: anh.consentGranted, sp, tong: anh.total, robot, tenKhoa: sess?.courseName ?? null };
}

// ── Tin ────────────────────────────────────────────────────────────────────────────────

export async function docHvThongBao(studentId: string) {
  const [tin, moc] = await Promise.all([hvDocTin(studentId), docMocDaXemCuaBe(studentId)]);
  const now = new Date();
  const soMoi = demTinMoi(tin, moc, now);
  return { tin, moc, soMoi, nhan: nhanChuaDoc(soMoi), boLoc: boLocTinTheoMuc(mucBaiTapBaiThiDangHien()) };
}

// ── Đánh giá ───────────────────────────────────────────────────────────────────────────

export async function docHvDanhGia(studentId: string) {
  const [blocks, sched] = await Promise.all([hvDanhGia(studentId), hvSchedule(studentId).catch(() => null)]);
  return { blocks, tenKhoa: sched?.courseName ?? null, tenLop: sched?.className ?? null };
}

/** Trang "Thêm" của điện thoại cần số đếm — gom lại một chỗ. */
export async function docHvThem(studentId: string) {
  const [vo, sched] = await Promise.all([docHvVo(studentId, ""), hvSchedule(studentId).catch(() => null)]);
  return { vo, khoa: sched?.courseName ?? null };
}

// ── Vào / Mã thoát / Thoát (chế độ BA MẸ) ───────────────────────────────────────────

export async function docHvVao(parentUserId: string, children: { id: string; name: string }[]) {
  const now = new Date();
  const coBaiTap = mucBaiTapBaiThiDangHien();
  const [coMa, namSinhCon, con] = await Promise.all([
    coMaThoat(parentUserId),
    docNamSinhCacCon(parentUserId),
    Promise.all(
      children.map(async (c) => {
        const [sched, track, blocks] = await Promise.all([
          hvSchedule(c.id).catch(() => null),
          coBaiTap ? hvTrack(c.id).catch(() => null) : Promise.resolve(null),
          hvDanhGia(c.id),
        ]);
        const bai = track ? chonBaiCanLam(track.items, track.ngoaiLoTrinh, now).length : 0;
        const dot = blocks.reduce((n, b) => n + b.pairs.length, 0);
        const viec = [
          bai > 0 ? `${bai} bài về nhà chưa nộp` : null,
          dot > 0 ? "đợt đánh giá thầy cô đang mở" : null,
          sched?.next ? `buổi tới ${nhanNgayNgan(sched.next.dateISO)}` : null,
        ].filter((x): x is string => !!x);
        return {
          id: c.id,
          ten: c.name,
          tat: chuVietTat(c.name),
          mauAv: mauAvatarTheoId(c.id),
          khoa: sched?.courseName ?? null,
          lop: sched?.className ?? null,
          xong: sched?.done ?? 0,
          tong: sched?.total ?? 0,
          viec: viec.length ? viec.join(" · ") : "Chưa có việc nào cần làm",
        };
      }),
    ),
  ]);
  return { coMa, namSinhCon, namNay: vnParts(now).year, con };
}

const KY_NHAT_KY: Record<NhatKyTho["loai"], { ky: string; sac: "xanh" | "do" | "tim" | "nen" }> = {
  VAO: { ky: "→", sac: "tim" },
  THOAT_DUNG_MA: { ky: "↩", sac: "xanh" },
  NHAP_SAI: { ky: "!", sac: "do" },
  KHOA: { ky: "!", sac: "do" },
  TAO_MA: { ky: "✓", sac: "xanh" },
  DOI_MA: { ky: "✓", sac: "xanh" },
  DAT_LAI_MA: { ky: "✓", sac: "xanh" },
  XAC_MINH_SAI: { ky: "!", sac: "do" },
};

function chuNhatKy(l: NhatKyTho, ten: string): string {
  switch (l.loai) {
    case "VAO":
      return `Cho ${ten} vào Cổng học sinh`;
    case "THOAT_DUNG_MA":
      return l.chiTiet ? `${ten} về chế độ ba mẹ · ba mẹ xác minh bằng mật khẩu` : `${ten} về chế độ ba mẹ · nhập đúng mã`;
    case "NHAP_SAI":
      return "Có người nhập sai mã thoát";
    case "KHOA":
      return "Màn thoát tạm khoá 5 phút sau 5 lần nhập sai";
    case "TAO_MA":
      return "Ba mẹ tạo mã thoát";
    case "DOI_MA":
      return "Ba mẹ đổi mã thoát";
    case "DAT_LAI_MA":
      return "Ba mẹ đặt lại mã thoát bằng mật khẩu";
    default:
      return "Nhập sai mật khẩu khi đặt lại mã";
  }
}

export async function docHvMa(parentUserId: string, children: { id: string; name: string }[], coMatKhau: boolean) {
  const [coMa, namSinhCon, nk] = await Promise.all([coMaThoat(parentUserId), docNamSinhCacCon(parentUserId), docNhatKy(parentUserId, 8)]);
  const ten = new Map(children.map((c) => [c.id, tenGoi(c.name)]));
  return {
    coMa,
    coMatKhau,
    namSinhCon,
    namNay: vnParts(new Date()).year,
    nhatKy: nk.map((l) => ({
      id: l.id,
      ky: KY_NHAT_KY[l.loai].ky,
      sac: KY_NHAT_KY[l.loai].sac,
      ten: chuNhatKy(l, l.studentId ? (ten.get(l.studentId) ?? "Con") : "Con"),
      luc: l.luc.toISOString(),
    })),
  };
}

export async function docHvThoat(parentUserId: string) {
  const [t, u] = await Promise.all([
    docTrangThaiKhoa(parentUserId, new Date()),
    db.user.findUnique({ where: { id: parentUserId }, select: { password: true } }),
  ]);
  return { giayKhoa: t.giayKhoa, coMatKhau: !!u?.password };
}

export async function docCoMatKhau(parentUserId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: parentUserId }, select: { password: true } });
  return !!u?.password;
}
