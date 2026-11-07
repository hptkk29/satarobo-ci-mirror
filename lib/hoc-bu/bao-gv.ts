// lib/hoc-bu/bao-gv.ts — nội dung thông báo cho GIÁO VIÊN của case dạy bù (THUẦN, test không cần DB).
//
// 07/10/2026 — chủ dự án: "thiếu thông báo lịch dạy bù cho giáo viên". Đo trên `origin/test`:
// module học bù (lib/hoc-bu/**) KHÔNG gọi `notifyStaff` ở đâu cả — giáo viên được xếp một ca bù
// chỉ biết khi tự mở /teacher/hoc-bu. Ba thời điểm chạm tới ca của giáo viên, và là ba hàm GHI
// duy nhất trong `case-db.ts` đụng ca của họ: tạo ca (`taoCaseVaXep` — chỗ DUY NHẤT đặt
// `teacherId`), xếp thêm học viên (`xepVaoCaseCoSan`), huỷ ca (`huyCase`).
//
// Luật giống luồng trial (`lib/trial/service.ts` — "không tự báo mình"): người bấm chính là
// giáo viên của ca thì KHÔNG báo.

export type LoaiBaoGv = "ca-moi" | "them-hv" | "huy";

export type ThongTinCaBu = {
  caseId: string;
  teacherId: string;
  /** Cột `@db.Date` — nửa đêm UTC của ngày VN. */
  date: Date;
  startTime: string;
  endTime: string;
  tenKhoa: string | null;
  tenPhong: string | null;
  /** Số học viên ĐANG xếp trong ca (sau phép ghi). */
  soHocVien: number;
};

export type ThongBaoCaBu = {
  userIds: string[];
  dedupeKey: string;
  title: string;
  body: string;
  /** Đường ADMIN clean-URL — `teacherHref()` đổi sang /teacher/hoc-bu/<id> trên site GV. */
  href: string;
  entityId: string;
};

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

/** "T4 08/10/2026 18:00–19:30" — đọc ngày theo UTC vì cột là `@db.Date`. */
export function moTaGioCaBu(i: Pick<ThongTinCaBu, "date" | "startTime" | "endTime">): string {
  const d = i.date;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${THU[d.getUTCDay()]} ${dd}/${mm}/${d.getUTCFullYear()} ${i.startTime}–${i.endTime}`;
}

/**
 * Dựng thông báo cho giáo viên của ca. `null` = không báo (người bấm là chính giáo viên đó).
 *
 * `moc` (ms) chỉ dùng cho `them-hv`: mỗi lượt xếp thêm là một việc mới đáng xem lại — khoá
 * theo ca thôi thì lượt thứ hai bị nuốt (cùng lý do với `trial-case.moved-in:`).
 */
export function thongBaoCaBu(
  loai: LoaiBaoGv,
  i: ThongTinCaBu,
  nguoiBamId: string,
  moc: number,
): ThongBaoCaBu | null {
  if (!i.teacherId || i.teacherId === nguoiBamId) return null;
  const gio = moTaGioCaBu(i);
  const khoa = i.tenKhoa ? ` · ${i.tenKhoa}` : "";
  const phong = i.tenPhong ? ` · phòng ${i.tenPhong}` : "";
  const hv = ` · ${i.soHocVien} học viên`;
  const coBan = { userIds: [i.teacherId], entityId: i.caseId };

  switch (loai) {
    case "ca-moi":
      return {
        ...coBan,
        dedupeKey: `hoc-bu.ca-moi:${i.caseId}`,
        title: "Bạn có ca dạy bù mới",
        body: `${gio}${khoa}${phong}${hv}.`,
        href: `/hoc-bu/case/${i.caseId}`,
      };
    case "them-hv":
      return {
        ...coBan,
        dedupeKey: `hoc-bu.them-hv:${i.caseId}:${moc}`,
        title: "Ca dạy bù của bạn có thêm học viên",
        body: `${gio}${khoa}${phong} — nay có${hv.replace(" · ", " ")}.`,
        href: `/hoc-bu/case/${i.caseId}`,
      };
    case "huy":
      return {
        ...coBan,
        dedupeKey: `hoc-bu.huy:${i.caseId}`,
        title: "Ca dạy bù của bạn đã bị huỷ",
        body: `${gio}${khoa}${phong}. Không cần lên lớp ca này.`,
        // Ca đã huỷ thì trang chi tiết không còn việc gì để làm — về danh sách.
        href: `/hoc-bu`,
      };
  }
}
