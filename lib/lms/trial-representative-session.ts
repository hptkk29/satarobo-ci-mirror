/**
 * Chọn "buổi đại diện" cho một ghi danh Trial trên bảng của site giáo viên.
 *
 * VÌ SAO CÓ FILE NÀY (sự cố 04/09/2026 — GV không thấy suất Trial nào để nhập phiếu):
 * hai thay đổi đúng riêng lẻ kéo ngược chiều nhau.
 *  · 28/08 gỡ auto-gán buổi ⇒ mọi ghi danh tạo qua giao diện admin mang
 *    `scheduledSessionId = null`, nghĩa là "em học CẢ LỚP" (`lib/trial/service.ts:322-334`).
 *  · 26/08 chốt bảng Trial site GV chỉ bày ghi danh ĐÃ GẮN BUỔI.
 * Giao nhau: bảng lọc `scheduledSessionId: { in: [...] }` — `in` không bao giờ khớp
 * null ⇒ bảng LUÔN rỗng.
 *
 * Cách vá KHÔNG phạm chốt 26/08: chốt đó cấm bày dòng KHÔNG CÓ NGÀY GIỜ, không cấm bày
 * em học cả lớp. Nên thay vì in dòng trống ngày, ta suy một buổi đại diện từ chính lịch
 * của giáo viên; lớp không có buổi nào trong cửa sổ thì KHÔNG sinh dòng.
 *
 * ⚠️ Buổi đại diện chỉ để XẾP BẢNG và nhét vào link mở phiếu. TUYỆT ĐỐI không ghi ngược
 * vào `TrialEnrollment.scheduledSessionId`: cột đó nay mang nghĩa "xếp RIÊNG một buổi",
 * ghi vào là đảo ngầm chốt 28/08 và làm bảng điểm danh thôi hiểu "em học mọi buổi".
 */

/** Buổi tối thiểu cần để chọn — khớp phần select của `getTeacherTrialTable`. */
export type BuoiUngVien = {
  id: string;
  /** `@db.Date` → UTC 00:00 của ngày VN. */
  date: Date;
  startTime: string;
};

/**
 * Buổi gần nhất CHƯA qua; không còn buổi tương lai thì buổi CUỐI đã qua; không có buổi
 * nào thì `null` (⇒ gọi bên ngoài phải BỎ dòng, đừng in dòng không ngày).
 *
 * Vì sao ưu tiên buổi tương lai: dòng rơi vào bảng "Các suất sắp Trial" — đúng nghĩa
 * "buổi sắp tới tôi phải dạy em này". Hết buổi tương lai thì việc còn lại là NHẬP PHIẾU
 * cho buổi vừa dạy, nên lấy buổi cuối đã qua và để nó rơi xuống bảng "Đã Trial".
 *
 * `ungVien` KHÔNG cần sắp trước — hàm tự chọn theo (date, startTime) nên gọi ở đâu cũng
 * ra một kết quả; dựa vào thứ tự mảng đầu vào là mời một bug im lặng khi người sau đổi
 * `orderBy` của câu truy vấn.
 */
export function chonBuoiDaiDien<T extends BuoiUngVien>(
  ungVien: readonly T[],
  todayMs: number,
): T | null {
  let sapToi: T | null = null;
  let daQua: T | null = null;
  for (const b of ungVien) {
    if (b.date.getTime() >= todayMs) {
      if (!sapToi || truoc(b, sapToi)) sapToi = b;
    } else if (!daQua || truoc(daQua, b)) {
      daQua = b;
    }
  }
  return sapToi ?? daQua;
}

/** a đứng trước b theo (ngày, giờ bắt đầu)? */
function truoc(a: BuoiUngVien, b: BuoiUngVien): boolean {
  const d = a.date.getTime() - b.date.getTime();
  if (d !== 0) return d < 0;
  return a.startTime.localeCompare(b.startTime) < 0;
}
