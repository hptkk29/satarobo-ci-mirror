// Phần TÍNH TOÁN thuần của cron nhắc buổi trải nghiệm — tách khỏi `route.ts` để test
// được mà không phải dựng Prisma/Next. Không import gì chạm DB, mạng hay `server-only`.

import { vnParts } from "@/lib/time/vn";

/**
 * Mốc bắt đầu THẬT của một buổi.
 *
 * ⚠️ Hai nửa dữ liệu nằm ở hai quy ước khác nhau, ghép sai là lệch 7 tiếng:
 *   - `date` là cột `@db.Date` ⇒ Prisma trả về **UTC 00:00 của NGÀY VN** (vd buổi ngày
 *     26/08 giờ VN → `2026-08-26T00:00:00.000Z`), KHÔNG phải nửa đêm giờ VN;
 *   - `startTime` là chuỗi "HH:mm" đọc theo ĐỒNG HỒ VN.
 * Nên: lấy mốc UTC-midnight, cộng giờ-phút VN, rồi trừ 7 tiếng để về UTC thật.
 * Kết quả trùng đúng `vnDateAt(y, m, d, hh, mm)`.
 *
 * Trả `null` khi `startTime` sai định dạng — buổi hỏng dữ liệu thì bỏ qua, không đoán.
 */
export function mocBatDau(date: Date, startTime: string): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (!m) return null;
  const ms =
    date.getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60_000 - 7 * 3_600_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type TenMoc = "1-ngay" | "2-gio" | "1-gio";

/**
 * Ai là người nhận chuông của mốc này.
 *
 * ⚠️ ĐÂY LÀ TRƯỜNG RẼ NHÁNH, và nó là TRƯỜNG DỮ LIỆU chứ không phải tên mốc — có chủ đích.
 * Nơi chạy phải hỏi `moc.nhan`, TUYỆT ĐỐI không so `moc.ten === "1-gio"`. Lý do: so theo tên
 * thì thêm một mốc GV thứ hai (vd "30-phut") là lập tức rơi vào nhánh Sale, và triệu chứng là
 * Sale ăn thêm một chuông lạ chứ không phải GV mất chuông — tức lỗi hiện ra ở NGƯỜI KHÔNG LIÊN
 * QUAN, đúng loại mất công dò nhất.
 */
export type NhanMoc = "sale" | "giao-vien";

/** Cửa sổ nhắc, tính bằng GIỜ còn lại tới lúc buổi bắt đầu: `[tuGio, denGio)`. */
export interface Moc {
  ten: TenMoc;
  tuGio: number;
  denGio: number;
  nhan: NhanMoc;
}

/**
 * ⚠️ VÌ SAO CỬA SỔ RỘNG HƠN MỐC DANH NGHĨA — nhưng chỉ rộng hơn MỘT CHÚT (lỗi #21):
 *
 * Cron chạy nhịp cố định `0 * * * *` (mỗi giờ, `vercel.json`) và Vercel Cron không đảm
 * bảo đúng phút — có thể trễ vài phút. Cửa sổ HẸP HƠN nhịp cron sẽ để buổi rơi vào khe
 * giữa hai lần chạy và KHÔNG BAO GIỜ được nhắc. Nên cửa sổ phải ≥ 1h, đặt ĐỐI XỨNG
 * quanh mốc danh nghĩa: "1 ngày" lấy 23h–25h (2h, có dự phòng), "2 giờ" lấy 1,5h–2,5h
 * (đúng 1h — biên tối thiểu; nới rộng nữa thì chuông "sắp bắt đầu" phát từ 3,5h trước,
 * mất hết ý nghĩa của mốc này).
 *
 * Ngược lại, rộng quá cũng sai: bản cũ để 12h–36h và 1h–3h. Vì `dedupeKey` là vĩnh viễn,
 * chuông phát ở LẦN CHẠM MÉP TRÊN ĐẦU TIÊN — tức ~36 tiếng trước buổi cho mốc "1 ngày",
 * trong khi nội dung lại in "ngày mai" còn buổi thật ở NGÀY KIA.
 *
 * Hệ quả có chủ đích: một buổi có thể lọt vào cửa sổ ở HAI lần chạy liên tiếp. Không sao —
 * `dedupeKey` gồm cả tên mốc nên lần thứ hai chỉ chạm lại bản ghi cũ, không kêu hai lần.
 *
 * ── MỐC "1-gio" (V2-d, 17/09/2026) — NHẮC GIÁO VIÊN, KHÔNG NHẮC SALE ───────────────────
 * PHÉP TÍNH ra đúng hai con số `[0.4, 1.5)`, ghi lại ở đây để lần sau đừng ai "làm tròn
 * cho đẹp" thành `[0.5, 1.5)` (= 60′, hụt) hay `[1, 2)` (= chồng mốc "2-gio"):
 *
 *   1. Bề rộng TỐI THIỂU. Lưới lấy mẫu là các lượt cron. Nhịp danh nghĩa 60′, nhưng Vercel
 *      Cron trễ vài phút KHÔNG ĐỀU, nên khoảng cách giữa HAI LƯỢT LIÊN TIẾP có thể tới
 *      ~65′. Một cửa sổ nửa mở rộng W phút chắc chắn bắt được ≥1 lượt khi và chỉ khi
 *      W ≥ khoảng cách lớn nhất giữa hai lượt ⇒ **W ≥ 65′**. Cửa sổ 60′ là KHÔNG ĐỦ:
 *      đo được pha trượt hẳn (xem ca "phủ kín lưới" trong `_moc.test.ts`, mốc lệch 0,4h).
 *
 *   2. Mép TRÊN bị chặn CỨNG ở 1.5 — không phải chọn, mà là ràng buộc. `chonMoc` dùng
 *      `.find`, tức trả mốc ĐẦU TIÊN khớp theo THỨ TỰ MẢNG, và "2-gio" (mép dưới 1.5)
 *      đứng trước. Nới "1-gio" LÊN quá 1.5 ⇒ mọi lượt trong phần chồng bị "2-gio" nuốt và
 *      mốc mới không bao giờ bắn — hỏng CÂM, vì cả hai mốc đều "vẫn chạy".
 *
 *   3. Nên phải nới XUỐNG DƯỚI: 1.5 − 65/60 = 1.4167 ⇒ lấy **0.4** cho tròn số người đọc
 *      được. Bề rộng thật = 1.1h = **66′ ≥ 65′**, dư đúng 1 phút.
 *
 * HỆ QUẢ, NÓI THẲNG (đây là đánh đổi, không phải chi tiết kỹ thuật):
 *   · Tên mốc là "1 tiếng trước" nhưng đó là MỤC TIÊU TRUNG BÌNH. Trường hợp xấu nhất —
 *     lượt cron rơi sát mép dưới — giáo viên chỉ được báo trước **~24 phút** (0.4h).
 *     Muốn chặt hơn thì phải đổi nhịp cron trong `vercel.json`, và chủ dự án đã chốt
 *     KHÔNG đổi.
 *   · Buổi được TẠO khi chỉ còn dưới 24 phút thì **KHÔNG BAO GIỜ** nhận chuông của mốc
 *     này: lượt cron kế tiếp thấy nó đã dưới mép dưới, `chonMoc` trả `undefined`, và
 *     không có mốc nào ở dưới nữa. Không im lặng hoàn toàn — người xếp buổi vẫn nhận
 *     chuông "được phân buổi trải nghiệm" ngay lúc tạo (`trial-session.assigned:`).
 */
export const MOC: readonly Moc[] = [
  { ten: "1-ngay", tuGio: 23, denGio: 25, nhan: "sale" },
  { ten: "2-gio", tuGio: 1.5, denGio: 2.5, nhan: "sale" },
  // Đặt CUỐI mảng là an toàn (ba cửa sổ đôi một rời nhau nên thứ tự không đổi kết quả),
  // nhưng đừng dựa vào điều đó: ca "đôi một không chồng" trong `_moc.test.ts` mới là thứ
  // giữ cho `.find` không nuốt mốc nào.
  { ten: "1-gio", tuGio: 0.4, denGio: 1.5, nhan: "giao-vien" },
];

/** Mốc khớp với số giờ còn lại, hoặc `undefined` nếu buổi chưa/đã qua cửa sổ. */
export function chonMoc(conBaoLauGio: number): Moc | undefined {
  return MOC.find((m) => conBaoLauGio >= m.tuGio && conBaoLauGio < m.denGio);
}

/**
 * Nhãn thời điểm THẬT theo đồng hồ VN, thay cho chữ tương đối ("ngày mai", "2 tiếng nữa").
 * Chữ tương đối luôn có nguy cơ lệch với cửa sổ cron; ngày-giờ thật thì không bao giờ sai.
 */
export function nhanThoiDiem(batDau: Date): { gio: string; ngay: string } {
  const p = vnParts(batDau);
  return {
    gio: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
    ngay: `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}`,
  };
}
