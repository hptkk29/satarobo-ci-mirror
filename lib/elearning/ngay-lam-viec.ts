/**
 * NGÀY LÀM VIỆC — nguồn sự thật DUY NHẤT của module.
 *
 * ⚠️ Quy ước 26: hạn ràng buộc MÁY (dọn dữ liệu, hết hiệu lực vé) tính bằng ngày
 * lịch; hạn ràng buộc NGƯỜI tính bằng ngày làm việc. Khiếu nại gửi chiều thứ Sáu
 * cộng 5 ngày lịch ra thứ Tư ⇒ người xử chỉ có 3 ngày làm việc thật, và mỗi lần rơi
 * vào cuối tuần lại ra một con số khác. Họ trễ hạn vì CÁCH TÍNH, không phải vì chậm.
 *
 * ⚠️ Tệp này tồn tại vì phép cộng đó sắp có NGƯỜI DÙNG THỨ HAI (hạn chấm bài tập,
 * EL-15) bên cạnh người dùng thứ nhất (hạn trả lời khiếu nại, EL-13). Chép sang là
 * dựng nguồn sự thật thứ hai, và hai bản chép sẽ trôi khỏi nhau — đúng cách trần độ
 * dài câu hỏi vừa trôi ở EL-14e.
 *
 * ⚠️ Chỉ bỏ thứ Bảy và Chủ nhật. NGÀY LỄ thì đừng đoán: repo không có bảng lịch
 * nghỉ, và chế một danh sách lễ không ai duyệt là dựng nguồn sự thật thứ hai theo
 * một kiểu khác. Hệ quả đã biết và chấp nhận: hạn rơi vào 30/4 hay Tết sẽ tính dôi
 * ra, tức có lợi cho người bị tính hạn — sai về phía an toàn.
 */

/** Thứ Bảy (6) và Chủ nhật (0), tính theo UTC. */
function laCuoiTuan(d: Date): boolean {
  const thu = d.getUTCDay();
  return thu === 0 || thu === 6;
}

/**
 * `moc` cộng thêm `soNgayLam` NGÀY LÀM VIỆC.
 *
 * Đếm từ ngày KẾ TIẾP: nộp bài lúc 16h thứ Sáu với hạn 1 ngày làm việc thì hạn là
 * thứ Hai, không phải chính chiều thứ Sáu đó.
 */
export function congNgayLamViec(moc: Date, soNgayLam: number): Date {
  const d = new Date(moc.getTime());
  let con = Math.max(0, Math.floor(soNgayLam));
  while (con > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!laCuoiTuan(d)) con -= 1;
  }
  return d;
}

/**
 * Số NGÀY LÀM VIỆC đã trôi qua giữa hai mốc, làm tròn xuống.
 *
 * Dùng cho phép bù khi chấm trễ: hạn của người NỘP lùi đúng bằng số ngày người
 * chấm để họ chờ — mà "số ngày chờ" phải đo cùng một thước với "hạn chấm", nếu
 * không thì bù thiếu hoặc bù thừa mỗi khi vắt qua cuối tuần.
 */
export function demNgayLamViec(tu: Date, den: Date): number {
  if (den.getTime() <= tu.getTime()) return 0;
  const d = new Date(tu.getTime());
  let n = 0;
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getTime() > den.getTime()) break;
    if (!laCuoiTuan(d)) n += 1;
  }
  return n;
}
