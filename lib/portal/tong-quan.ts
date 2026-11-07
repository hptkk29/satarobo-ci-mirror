import "server-only";
import { db } from "@/lib/db";
import { getParentDashboard } from "@/lib/portal/dashboard";
import { getStudentFeedback, type FeedbackItem } from "@/lib/portal/feedback";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentPhotos, type PhotoItem } from "@/lib/portal/photos";
import { getStudentSchedule, type ScheduleSession } from "@/lib/portal/schedule";
import { getStudentSessionsView, type StudentSessionItem } from "@/lib/portal/student-sessions";
import { getStudentBilling } from "@/lib/portal/billing-student";
import { getCenterSurveys } from "@/lib/portal/surveys";
import { listConversationsForUser } from "@/lib/chat/queries";
import { vnParts } from "@/lib/time/vn";
import {
  demNgayLich,
  gomHocPhan,
  nhanConNgay,
  nhanHocPhan,
  NHAN_DA_NOP,
  nhanHomNay,
  soSanhNangLuc,
  tenDayDu,
  tomTatDiHoc,
  tomTatHocPhi,
  trangThaiKhoanHocPhi,
  type BuoiChoHanhTrinh,
  type DiHocTomTat,
  type HocPhanTomTat,
  type HocPhiTomTat,
  type NangLucTomTat,
} from "@/lib/portal/tong-quan-thuan";

// Cổng phụ huynh — dữ liệu màn "Tổng quan" theo artifact Main.dc.html.
//
// KHÔNG tự đếm lại: mỗi con số lấy từ đúng loader mà các màn khác đang dùng
// (`getStudentSessionsView` cho buổi + chuyên cần, `getStudentBilling` cho học phí…), rồi chỉ
// diễn đạt lại bằng các hàm thuần ở `tong-quan-thuan.ts`. Mọi loader bên dưới đã tự gác
// ownership qua `requireActiveStudent()` ở trang gọi — hàm này chỉ nhận `studentId` đã xác minh.

export type TiepTheo = {
  nhanDemNgay: string;
  dongPhu: string;
  tieuDe: string;
  nhanBuoi: string;
  ngayNhan: string;
  gio: string | null;
  phong: string | null;
  giaoVien: string | null;
  mucTieu: string | null;
};

export type SanPhamGanNhat =
  | { loai: "KHOA"; lyDo: "CHUA_BAT" }
  | { loai: "TRONG" }
  | {
      loai: "CO";
      tieuDe: string;
      ngay: string;
      anh: PhotoItem[];
      tong: number;
      moTa: string | null;
    };

export type NhanXetNoiBat = {
  giaoVien: string | null;
  vietTat: string;
  nhan: string;
  noiDung: string;
  khenLuyen: { khen: string | null; luyen: string | null };
  moi: boolean;
};

export type ViecCanLam = {
  id: string;
  tieuDe: string;
  phu: string;
  nhanNut: string;
  href: string;
  noiBat: boolean;
};

export type TongQuan = {
  homNay: string;
  tenCon: string;
  soThongBao: number;
  giaoVienNhan: string | null;
  tiepTheo: TiepTheo | null;
  sanPham: SanPhamGanNhat;
  diHoc: DiHocTomTat & { href: string };
  nhanXetThe: { tieuDe: string; phu: string };
  hocPhi: HocPhiTomTat;
  daHoc: { tieuDe: string; phu: string };
  hanhTrinh: {
    tenKhoa: string | null;
    dongTieuDe: string;
    tong: number;
    hocPhan: HocPhanTomTat[];
    sapToi: { id: string; nhan: string; tieuDe: string; ngay: string; noiBat: boolean }[];
  };
  nhanXet: NhanXetNoiBat | null;
  nangLuc: NangLucTomTat | null;
  viecCanLam: ViecCanLam[];
  hocPhiChiTiet: { id: string; ten: string; trangThai: string; phu: string | null; sac: "ok" | "warn" }[];
  nhomLop: { ten: string; tinNhan: string | null; chuaDoc: number } | null;
};

const vietTat = (ten: string | null): string => {
  const t = (ten ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return "GV";
  if (t.length === 1) return t[0]!.slice(0, 2).toUpperCase();
  return (t[t.length - 2]![0]! + t[t.length - 1]![0]!).toUpperCase();
};

const NGAY_MOI_NHAN_XET = 14;

function tachKhenLuyen(n: FeedbackItem["notes"]): { khen: string | null; luyen: string | null } {
  if (!n) return { khen: null, luyen: null };
  const khen = n.attitude?.trim() || n.knowledge?.trim() || null;
  const luyen = n.proposal?.trim() || null;
  return { khen, luyen };
}

function dungTiepTheo(
  next: ScheduleSession | null,
  buoi: StudentSessionItem | undefined,
  tong: number,
  hocPhanMa: string | null,
  mucTieu: string | null,
  now: Date,
): TiepTheo | null {
  if (!next) return null;
  const hp = nhanHocPhan(hocPhanMa);
  const so = next.order ?? buoi?.order ?? null;
  return {
    nhanDemNgay: nhanConNgay(demNgayLich(next.dateISO, now)),
    dongPhu: `${next.nhanThu}, ${next.nhanNgayNgan}`,
    tieuDe: next.title,
    nhanBuoi: [so ? `Buổi ${so}${tong > 0 ? ` / ${tong}` : ""}` : null, hp].filter(Boolean).join(" · ") || "Buổi học",
    ngayNhan: `${next.nhanThu}, ${next.nhanNgayNgan}`,
    gio: next.time || null,
    phong: next.room,
    giaoVien: next.teacher,
    mucTieu,
  };
}

export async function getTongQuan(
  studentId: string,
  parentUserId: string,
  now: Date = new Date(),
): Promise<TongQuan> {
  const [sched, view, feedback, photos, billing, makeup, surveys, dash, convs] = await Promise.all([
    getStudentSchedule(studentId, now),
    getStudentSessionsView(studentId, now),
    getStudentFeedback(studentId, 60),
    getStudentPhotos(studentId),
    getStudentBilling(studentId, now),
    getStudentMakeup(studentId),
    getCenterSurveys(studentId, { withQuestions: false }),
    getParentDashboard(parentUserId),
    // Chuông chat không được làm sập trang: lỗi hội thoại ⇒ bỏ thẻ "Nhóm lớp", giữ cả trang.
    listConversationsForUser(parentUserId, { limit: 5, now, withPreview: true }).catch(() => []),
  ]);

  // Học phần + mục tiêu: nằm ở Lesson, nạp riêng theo id buổi (cùng cách `getStudentSessionsView`).
  const ids = view.sessions.map((s) => s.id);
  const lesson = ids.length
    ? await db.classSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, lesson: { select: { moduleCode: true, objectives: true } } },
      })
    : [];
  const hocPhanCua = new Map(lesson.map((l) => [l.id, l.lesson?.moduleCode ?? null]));
  const mucTieuCua = new Map(lesson.map((l) => [l.id, l.lesson?.objectives?.[0]?.trim() || null]));

  const tenCon = tenDayDu(sched?.studentName);

  // Con học nhiều lớp: hành trình bám lớp có buổi tiếp theo (nếu không có thì lớp đầu tiên).
  const lopHanhTrinh = sched?.next?.className ?? view.sessions.find((s) => s.className)?.className ?? null;
  const buoiLop = view.sessions.filter((s) => s.className === lopHanhTrinh || lopHanhTrinh === null);
  const tiepTheoId = sched?.next?.id ?? null;
  const buoiTho: BuoiChoHanhTrinh[] = buoiLop.map((s) => ({
    id: s.id,
    order: s.order,
    title: s.title,
    dateISO: s.date,
    past: s.past,
    cancelled: s.attendance === "CANCELLED",
    hocPhan: hocPhanCua.get(s.id) ?? null,
  }));

  const buoiTiep = view.sessions.find((s) => s.id === tiepTheoId);
  const tiepTheo = dungTiepTheo(
    sched?.next ?? null,
    buoiTiep,
    view.total,
    tiepTheoId ? hocPhanCua.get(tiepTheoId) ?? null : null,
    tiepTheoId ? mucTieuCua.get(tiepTheoId) ?? null : null,
    now,
  );

  // ── Đi học / đã học ────────────────────────────────────────────────────────
  const diHoc = {
    ...tomTatDiHoc({
      daHoc: view.done,
      coMat: view.present,
      vang: view.absent,
      chuaCham: view.chuaCham,
      canBu: makeup.needCount,
    }),
    href: "/portal/ket-qua",
  };
  const conLai = Math.max(0, view.total - view.done);
  const daHoc = {
    tieuDe: view.total > 0 ? `${view.done}/${view.total} buổi` : "Chưa xếp lịch",
    phu:
      view.total === 0
        ? "Trung tâm sẽ báo khi có lịch"
        : conLai === 0
          ? `Đã học hết các buổi${view.courseName ? ` của khoá ${view.courseName}` : " đã xếp lịch"}`
          : `Còn ${conLai} buổi${view.courseName ? ` đến hết khoá ${view.courseName}` : ""}`,
  };

  // ── Sản phẩm của buổi gần nhất ─────────────────────────────────────────────
  let sanPham: SanPhamGanNhat;
  if (!photos.consentGranted) sanPham = { loai: "KHOA", lyDo: "CHUA_BAT" };
  else if (photos.groups.length === 0) sanPham = { loai: "TRONG" };
  else {
    const g = photos.groups[0]!;
    sanPham = {
      loai: "CO",
      tieuDe: g.title,
      ngay: g.nhanNgay,
      anh: g.photos.slice(0, 3),
      tong: photos.total,
      moTa: g.photos.find((p) => p.caption?.trim())?.caption?.trim() ?? null,
    };
  }

  // ── Nhận xét ───────────────────────────────────────────────────────────────
  const moiNhat = feedback[0] ?? null;
  const moi =
    moiNhat && moiNhat.dateISO
      ? demNgayLich(moiNhat.dateISO, now) >= -NGAY_MOI_NHAN_XET
      : false;
  const nhanXet: NhanXetNoiBat | null = moiNhat
    ? {
        giaoVien: moiNhat.teacher,
        vietTat: vietTat(moiNhat.teacher),
        nhan: [
          moiNhat.order ? `Buổi ${moiNhat.order}` : null,
          moiNhat.projectName,
          moiNhat.dateISO
            ? `${vnParts(new Date(moiNhat.dateISO)).day}/${vnParts(new Date(moiNhat.dateISO)).month + 1}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        noiDung: moiNhat.comment || moiNhat.notes?.overall || "",
        khenLuyen: tachKhenLuyen(moiNhat.notes),
        moi,
      }
    : null;
  const nhanXetThe = moiNhat
    ? {
        tieuDe: moi ? "Có nhận xét mới" : "Nhận xét gần nhất",
        phu: `${moiNhat.teacher ? `Từ ${moiNhat.teacher}` : "Từ giáo viên"}${moiNhat.order ? ` · buổi ${moiNhat.order}` : ""}`,
      }
    : { tieuDe: "Chưa có nhận xét", phu: "Giáo viên sẽ gửi sau mỗi buổi học" };

  // ── Hành trình ─────────────────────────────────────────────────────────────
  const sapToi = view.sessions
    .filter((s) => !s.past && s.attendance !== "CANCELLED" && (lopHanhTrinh === null || s.className === lopHanhTrinh))
    .slice(0, 5)
    .map((s, i) => ({
      id: s.id,
      nhan: i === 0 && demNgayLich(s.date, now) <= 7 ? `BUỔI ${s.order} · TUẦN NÀY` : `BUỔI ${s.order}`,
      tieuDe: s.title,
      ngay: s.nhanNgay.slice(0, 5),
      noiBat: i === 0,
    }));
  const hienTai = tiepTheo ? (buoiTiep?.order ?? view.done + 1) : view.done;

  // ── Học phí ────────────────────────────────────────────────────────────────
  const hocPhi = tomTatHocPhi({
    rows: billing.rows,
    outstanding: billing.outstanding,
    nextDueDate: billing.nextDueDate,
    tamHoanThu: billing.tamHoanThu,
    paid: billing.paid,
  });
  // Chỉ HAI nhãn «Đã nộp» / «Chưa nộp» (03/11/2026) — số còn nợ đi ở `phu`, không phải nhãn.
  const hocPhiChiTiet = billing.rows.map((r) => {
    const tt = trangThaiKhoanHocPhi(r);
    return {
      id: r.enrollmentId,
      ten: [r.courseName, r.className].filter(Boolean).join(" · ") || "Khoá học",
      trangThai: tt.nhan,
      phu: tt.phu,
      sac: (tt.nhan === NHAN_DA_NOP ? "ok" : "warn") as "ok" | "warn",
    };
  });

  // ── Việc ba mẹ cần làm — chỉ những thứ CÓ THẬT ───────────────────────────────
  const viecCanLam: ViecCanLam[] = [];
  const chuaBu = makeup.needList.find((m) => m.status === "PENDING" && !m.yeuCauMo);
  if (makeup.needCount > 0) {
    viecCanLam.push({
      id: "hoc-bu",
      tieuDe: chuaBu ? `Chọn giờ học bù ${chuaBu.lessonTitle}` : "Xem lịch học bù của con",
      phu: `${makeup.needCount} buổi cần bù`,
      nhanNut: "Chọn",
      href: "/portal/yeu-cau",
      noiBat: true,
    });
  }
  // «Học phí còn …» KHÔNG còn là việc cần làm (chủ dự án 03/11/2026: không hiện thông báo «học phí cần đóng»).
  if (surveys.todoCount > 0) {
    const kh = surveys.cards.find((c) => !c.done);
    viecCanLam.push({
      id: "gop-y",
      tieuDe: kh?.title ?? "Góp ý cho trung tâm",
      phu: `${kh?.minutes ?? 2} phút · giúp trung tâm làm tốt hơn`,
      nhanNut: "Làm",
      href: "/portal/khao-sat",
      noiBat: false,
    });
  }

  // ── Nhóm lớp (chat) ────────────────────────────────────────────────────────
  const nhom = convs.find((c) => c.type === "CLASS_GROUP" && !c.isArchived) ?? convs.find((c) => !c.isArchived) ?? null;
  const nhomLop = nhom
    ? { ten: nhom.displayName, tinNhan: nhom.lastMessage && !nhom.lastMessage.deleted ? nhom.lastMessage.text : null, chuaDoc: nhom.unreadCount }
    : null;

  return {
    homNay: nhanHomNay(now),
    tenCon,
    soThongBao: dash.notificationCount,
    giaoVienNhan: sched?.next?.teacher ?? null,
    tiepTheo,
    sanPham,
    diHoc,
    nhanXetThe,
    hocPhi,
    daHoc,
    hanhTrinh: {
      tenKhoa: view.courseName,
      dongTieuDe:
        view.total === 0
          ? "Chưa có lộ trình"
          : conLai === 0
            ? `Con đã học hết ${view.total} buổi`
            : `Con đang ở buổi ${Math.max(hienTai, 1)} trên ${view.total}`,
      tong: view.total,
      hocPhan: gomHocPhan(buoiTho, tiepTheoId),
      sapToi,
    },
    nhanXet,
    nangLuc: soSanhNangLuc(feedback.map((f) => ({ dateISO: f.dateISO, rubric: f.rubric }))),
    viecCanLam,
    hocPhiChiTiet,
    nhomLop,
  };
}
