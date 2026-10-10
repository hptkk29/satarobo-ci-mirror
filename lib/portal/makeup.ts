import "server-only";
import { db } from "@/lib/db";
import { napBuoiCuaLop } from "@/lib/portal/buoi-hoc";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { khoaCapBuoi, ymdSangDmy, type LanBu, type LoaiLanBu, type TrangThaiBu } from "@/lib/hoc-bu/ket-qua-buoi";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { dongPhieu, type DongPhieu } from "@/lib/hoc-bu/phieu-tom-tat";

// Portal v2 — dữ liệu "Yêu cầu học bù" cho con đang chọn (per-child).
// Nguồn: MakeupNeed (buổi lỡ cần bù). PENDING = cần bù · SCHEDULED = đã xếp/chờ ·
// COMPLETED = đã bù xong. Lý do vắng lấy từ Attendance của buổi lỡ.

/** Một lần học bù, đã đổi sang chuỗi đọc được (không mang `Date`/id nội bộ): phụ huynh thấy ngày, giờ, cơ sở, phòng, giáo viên, bài, đánh giá. */
export type ChiTietBuoiBu = {
  loai: LoaiLanBu;
  /** "15/10/2026" */
  ngay: string;
  /** "18:00–19:30" */
  gio: string;
  coSo: string | null;
  phong: string | null;
  giaoVien: string | null;
  /** Nhãn bài ("Buổi 5 - HP2 - Tên bài") */
  bai: string | null;
  /** Đánh giá của giáo viên cho riêng bài này (không phải nhận xét của buổi gốc). */
  danhGia: string | null;
  /** Bảng 9 tiêu chí của CÙNG phiếu (đã chuyển thành hàng đọc được); null = phiếu chỉ có chữ. */
  phieu: DongPhieu[] | null;
};

/** Kết quả học bù của buổi vắng, đọc qua MÔ HÌNH ĐỌC DUY NHẤT (T08) — cổng phụ huynh không tự suy từ trạng thái dòng nữa. */
export type KetQuaCong = {
  trangThai: TrangThaiBu;
  nhan: string;
  hienTai: ChiTietBuoiBu | null;
  /** Mọi lần thử THẬT (không gồm lần bị gỡ khỏi case trước khi diễn ra). */
  lichSu: ChiTietBuoiBu[];
};

export type MakeupItem = {
  id: string;
  /** Kết quả học bù chi tiết (T11). */
  ketQua: KetQuaCong;
  /** Có đơn xin học bù ĐANG MỞ cho buổi này không — màn hình không hiện nút gửi thêm khi đã có. */
  yeuCauMo: boolean;
  lessonTitle: string;
  missedDate: string | null;
  className: string;
  centerName: string | null;
  reason: string;
  status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  /** Thời điểm học bù XONG (MakeupNeed.completedAt) — mốc thời gian cho feed thông báo. */
  completedAt: string | null;
  /**
   * BUỔI ĐƯỢC XẾP ĐỂ BÙ — ngày/giờ và lớp (06/09).
   *
   * `MakeupNeed.makeupSessionId` đã có trong schema và giáo vụ vẫn ghi vào đó khi xếp
   * lịch bù, nhưng portal chưa từng đọc: phụ huynh chỉ thấy trạng thái "Đã xếp lịch"
   * mà không biết bù NGÀY NÀO, LỚP NÀO — nên vẫn phải gọi điện hỏi trung tâm.
   */
  buoiBu: { nhan: string; nhanNgay: string; className: string | null } | null;
};

export type StudentMakeup = {
  centerName: string | null;
  needCount: number;
  pendingCount: number;
  doneCount: number;
  needList: MakeupItem[];
  history: MakeupItem[];
};

function reasonOf(status: string | undefined, note: string | null | undefined): string {
  if (note && note.trim()) return note.trim();
  if (status === "EXCUSED" || status === "ABSENT_EXCUSED") return "Nghỉ có phép";
  if (status === "ABSENT" || status === "ABSENT_UNEXCUSED") return "Vắng không phép";
  return "Nghỉ học";
}

export async function getStudentMakeup(studentId: string): Promise<StudentMakeup> {
  const needs = await db.makeupNeed.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      missedSessionId: true,
      makeupSessionId: true,
      note: true,
      completedAt: true,
      classId: true,
      class: { select: { name: true, center: { select: { name: true } } } },
    },
  });
  if (needs.length === 0) {
    return { centerName: null, needCount: 0, pendingCount: 0, doneCount: 0, needList: [], history: [] };
  }

  const sessionIds = needs.map((n) => n.missedSessionId).filter(Boolean);
  // Buổi BÙ có thể thuộc LỚP KHÁC (học bù ghép lớp), nên phải nạp riêng theo id chứ
  // không nằm trong `napBuoiCuaLop(classIds)` ở dưới.
  const buoiBuIds = [
    ...new Set(needs.map((n) => n.makeupSessionId).filter((x): x is string => !!x)),
  ];
  // 06/09 — nhãn buổi lấy từ nguồn CHUNG (lib/portal/buoi-hoc.ts) thay vì in
  // `lesson.title` thô: cùng một buổi, trang Học bù và trang Nhận xét phải gọi bằng
  // cùng một tên. Bản cũ in cả ô trống `"Buổi 7"` của giáo trình lẫn tên bài mang sẵn
  // tiền tố `"Buổi 7 — "`.
  const classIds = [...new Set(needs.map((n) => n.classId).filter((x): x is string => !!x))];
  const [buoiList, buoiBuRows, attendances, ketQuaBuoi, donMo] = await Promise.all([
    napBuoiCuaLop(classIds, new Date()),
    buoiBuIds.length
      ? db.classSession.findMany({
          where: { id: { in: buoiBuIds } },
          select: { id: true, classId: true, class: { select: { name: true } } },
        })
      : Promise.resolve([] as { id: string; classId: string; class: { name: string } }[]),
    db.attendance.findMany({
      where: { studentId, sessionId: { in: sessionIds } },
      select: { sessionId: true, status: true, absenceReason: true },
    }),
    docKetQuaBuoi(
      db,
      needs.map((n) => ({ sessionId: n.missedSessionId, studentId })),
    ),
    // Đơn xin bù đang mở — khớp theo khoá mới `makeupNeedId`, hoặc đơn cũ (cùng học viên + buổi gốc).
    db.parentRequest.findMany({
      where: { studentId, type: "MAKEUP", status: "PENDING" },
      select: { makeupNeedId: true, sessionId: true },
    }),
  ]);
  const chiTiet = await dungChiTietBuoiBu(ketQuaBuoi);
  const donMoTheoDong = new Set(donMo.map((d) => d.makeupNeedId).filter((x): x is string => !!x));
  const donMoTheoBuoi = new Set(donMo.filter((d) => d.makeupNeedId === null).map((d) => d.sessionId).filter((x): x is string => !!x));
  const sMap = new Map(buoiList.map((b) => [b.id, b]));
  // Nhãn buổi bù dựng từ CHÍNH lớp của nó — số buổi phải là hạng trong lớp đó.
  const buoiBuCua = new Map(
    (
      await Promise.all(
        [...new Set(buoiBuRows.map((r) => r.classId))].map((cid) =>
          napBuoiCuaLop([cid], new Date()),
        ),
      )
    )
      .flat()
      .map((b) => [b.id, b]),
  );
  const tenLopBu = new Map(buoiBuRows.map((r) => [r.id, r.class.name]));
  const aMap = new Map(attendances.map((a) => [a.sessionId, a]));

  const items: MakeupItem[] = needs.map((n) => {
    const s = sMap.get(n.missedSessionId);
    const a = aMap.get(n.missedSessionId);
    const kq = ketQuaBuoi.get(khoaCapBuoi(n.missedSessionId, studentId))!;
    return {
      id: n.id,
      ketQua: chiTiet(kq),
      yeuCauMo: donMoTheoDong.has(n.id) || donMoTheoBuoi.has(n.missedSessionId),
      lessonTitle: s?.nhanDayDu || "Buổi học",
      missedDate: s?.ngayISO ?? null,
      className: n.class?.name ?? "—",
      centerName: n.class?.center?.name ?? null,
      reason: reasonOf(a?.status, n.note ?? a?.absenceReason),
      status: n.status as MakeupItem["status"],
      completedAt: n.completedAt?.toISOString() ?? null,
      buoiBu: (() => {
        const b = n.makeupSessionId ? buoiBuCua.get(n.makeupSessionId) : undefined;
        if (!b) return null;
        return {
          nhan: b.nhanDayDu || "Buổi học",
          nhanNgay: `${b.nhanThu}, ${b.nhanNgay}`,
          className: tenLopBu.get(b.id) ?? null,
        };
      })(),
    };
  });

  return {
    centerName: items.find((i) => i.centerName)?.centerName ?? null,
    needCount: items.filter((i) => i.status === "PENDING").length,
    pendingCount: items.filter((i) => i.status === "SCHEDULED").length,
    doneCount: items.filter((i) => i.status === "COMPLETED").length,
    needList: items.filter((i) => i.status === "PENDING"),
    history: items.filter((i) => i.status !== "PENDING"),
  };
}

/**
 * Đổi `KetQuaBuoi` (id + Date) sang dạng phụ huynh đọc được. MỘT lượt tra tên cho cả lô (giáo viên, phòng, cơ sở, bài) — không N+1.
 * Phụ huynh chỉ thấy các lần học bù của CON MÌNH (đầu vào đã là dòng của con); lần bị gỡ khỏi case trước khi diễn ra không phải một lần thử thật nên ẩn.
 */
async function dungChiTietBuoiBu(
  ketQua: Map<string, import("@/lib/hoc-bu/ket-qua-buoi").KetQuaBuoi>,
): Promise<(kq: import("@/lib/hoc-bu/ket-qua-buoi").KetQuaBuoi) => KetQuaCong> {
  const lan = [...ketQua.values()].flatMap((k) => k.lichSu);
  const duy = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => !!x))];
  const [gv, phong, coSo, bai] = await Promise.all([
    db.user.findMany({ where: { id: { in: duy(lan.map((l) => l.giaoVienId)) } }, select: { id: true, name: true } }),
    db.room.findMany({ where: { id: { in: duy(lan.map((l) => l.phongId)) } }, select: { id: true, name: true } }),
    db.center.findMany({ where: { id: { in: duy(lan.map((l) => l.coSoId)) } }, select: { id: true, name: true } }),
    db.lesson.findMany({
      where: { id: { in: duy(lan.map((l) => l.lessonId)) } },
      select: { id: true, order: true, title: true, moduleCode: true },
    }),
  ]);
  const tenGv = new Map(gv.map((u) => [u.id, u.name]));
  const tenPhong = new Map(phong.map((r) => [r.id, r.name]));
  const tenCoSo = new Map(coSo.map((c) => [c.id, c.name]));
  const nhanBai = new Map(
    bai.map((b) => [b.id, deriveSessionLabel({ lessonOrder: b.order, lessonTitle: b.title, moduleCode: b.moduleCode }) || `Bài ${b.order}`]),
  );
  const chuyen = (l: LanBu): ChiTietBuoiBu => ({
    loai: l.loai,
    ngay: ymdSangDmy(l.ngay),
    gio: `${l.gioBatDau}–${l.gioKetThuc}`,
    coSo: tenCoSo.get(l.coSoId) ?? null,
    phong: l.phongId ? (tenPhong.get(l.phongId) ?? null) : null,
    giaoVien: tenGv.get(l.giaoVienId) ?? null,
    bai: l.lessonId ? (nhanBai.get(l.lessonId) ?? null) : null,
    danhGia: l.danhGia,
    phieu: dongPhieu(l.phieu),
  });
  return (kq) => ({
    trangThai: kq.trangThai,
    nhan: kq.nhan,
    hienTai: kq.hienTai ? chuyen(kq.hienTai) : null,
    lichSu: kq.lichSu.filter((l) => l.loai !== "DA_GO").map(chuyen),
  });
}
