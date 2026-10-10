import "server-only";

// lib/push/cau-hinh-vapid.ts — đọc + gác cấu hình VAPID từ biến môi trường.
//
// ── VÌ SAO TÁCH RA KHỎI `engine.ts` (13/09/2026) ────────────────────────────────────────
// Màn `/admin/cau-hinh-van-hanh` phải trả lời được câu "chọn xong rồi thì có ai nhận
// không". Câu đó có BA vế: công tắc tổng, khoá VAPID, và danh sách loại. Nếu màn hình tự kiểm
// khoá bằng cách gọi lại ba hàm validate rời rạc thì nó sẽ nói "khoá đã khai ✓" đúng vào ca
// nguy hiểm nhất — hai nửa khoá KHÔNG khớp nhau — vì phép so cặp chỉ nằm trong engine.
//
// Một màn hình nói "mọi thứ sẵn sàng" trong khi push service trả 403 cho mọi thiết bị là đúng
// định nghĩa affordance nói dối (luật 12 của repo). Nên: một hàm, hai nơi gọi.
//
// `server-only`: `VAPID_PRIVATE_KEY` là bí mật runtime, không được để lọt vào bundle trình
// duyệt dù chỉ là đường import chết.

import {
  chuanHoaVapidSubject,
  khoaCongKhaiTuKhoaRieng,
  laKhoaCongKhaiVapidHopLe,
  laKhoaRiengVapidHopLe,
} from "./vapid";

export interface CauHinhVapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Vì sao cấu hình VAPID không dùng được — để màn hình nói đúng chỗ cần sửa. */
export type LoiVapid = "THIEU_KHOA_CONG_KHAI" | "THIEU_KHOA_RIENG" | "THIEU_SUBJECT" | "LECH_CAP";

/**
 * Câu hiện cho NGƯỜI VẬN HÀNH đọc trên màn cấu hình.
 *
 * ⚠️ KHÔNG nhét tên biến môi trường vào đây. Hai lý do, lý do thứ hai mới là lý do thật:
 *  1. Người đọc màn đó là quản trị hệ thống của trung tâm — `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 *     với họ là một chuỗi vô nghĩa, và việc sửa cũng không nằm trong tay họ.
 *  2. Đo ở 320px: chuỗi 28 ký tự không dấu cách KHÔNG xuống dòng được, nó tràn ra ngoài
 *     khung cảnh báo và đẩy cả trang rộng ra. Một câu tiếng Việt bình thường thì không.
 * Tên biến thật vẫn nằm nguyên trong log máy chủ (`kiemVapid`), nơi người sửa sẽ đọc.
 */
export const MO_TA_LOI_VAPID: Readonly<Record<LoiVapid, string>> = {
  THIEU_KHOA_CONG_KHAI: "máy chủ chưa khai khoá gửi thông báo",
  THIEU_KHOA_RIENG: "máy chủ thiếu nửa khoá bí mật",
  THIEU_SUBJECT: "chưa khai địa chỉ liên hệ kỹ thuật cho dịch vụ thông báo",
  LECH_CAP:
    "hai nửa khoá trên máy chủ không khớp nhau — thường là vừa đổi khoá mà chưa cài đặt lại",
};

/**
 * Đọc + gác cấu hình VAPID.
 *
 * Engine gác ở ĐẦU LƯỢT và dừng CẢ LƯỢT nếu hỏng, chứ không để từng dòng tự chết: một lần dán
 * nhầm biến môi trường mà cứ chạy tiếp thì mỗi dòng ăn một lỗi 400/403, tiêu hết `maxAttempts`
 * và chuyển sang `DEAD` — tức một thao tác vận hành sai sẽ ĐỐT SẠCH hàng đợi, và không có
 * đường nào lấy lại. Dừng sạch thì sửa env xong là lượt sau chạy tiếp như chưa có gì.
 *
 * CỐ Ý chỉ ba biến: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (server đọc CHÍNH biến này, không có bản
 * `VAPID_PUBLIC_KEY` riêng), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Hai biến giữ cùng một khoá
 * công khai mà lệch nhau = 403 `VapidPkHashMismatch` cho MỌI thiết bị, và không lint/build nào
 * bắt được — đúng vết `AUTH_SECRET` vs `NEXTAUTH_SECRET` của repo.
 *
 * @param log false = im lặng (dùng cho màn chẩn đoán, nó tự hiển thị lý do; engine thì cần log).
 */
export function docCauHinhVapid(log = true): CauHinhVapid | null {
  return kiemVapid(log).cauHinh;
}

/** Bản đầy đủ: trả cả LÝ DO hỏng, cho màn hình hiển thị. */
export function kiemVapid(log = false): { cauHinh: CauHinhVapid | null; loi: LoiVapid | null } {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = chuanHoaVapidSubject(process.env.VAPID_SUBJECT ?? "");

  const hong = (loi: LoiVapid, cau: string) => {
    if (log) console.error(`[push] ${cau} — bỏ cả lượt`);
    return { cauHinh: null, loi };
  };

  if (!laKhoaCongKhaiVapidHopLe(publicKey)) {
    return hong("THIEU_KHOA_CONG_KHAI", "NEXT_PUBLIC_VAPID_PUBLIC_KEY thiếu hoặc sai hình dạng");
  }
  if (!laKhoaRiengVapidHopLe(privateKey)) {
    return hong("THIEU_KHOA_RIENG", "VAPID_PRIVATE_KEY thiếu hoặc sai hình dạng");
  }
  if (!subject) {
    // Push service dùng địa chỉ này để liên hệ khi hạ tầng ta gây sự cố; thiếu/sai thì một số
    // dịch vụ từ chối thẳng. Đây là lỗi cấu hình, không phải lỗi của dòng nào.
    return hong("THIEU_SUBJECT", "VAPID_SUBJECT phải là mailto: hoặc https:");
  }

  // HAI NỬA CÓ KHỚP NHAU KHÔNG — cổng quan trọng nhất trong hàm này.
  //
  // `VAPID_PRIVATE_KEY` là biến RUNTIME; `NEXT_PUBLIC_VAPID_PUBLIC_KEY` thì bị Next thay bằng
  // CHUỖI LITERAL lúc BUILD, cho cả bundle server. Người vận hành sửa cả hai biến trên Vercel
  // rồi KHÔNG deploy lại — thao tác trông hoàn toàn hợp lý — sẽ có khoá riêng MỚI ghép khoá
  // công khai CŨ. Push service trả 403 `VapidPkHashMismatch` cho MỌI thiết bị, mà 403 là CHẾT
  // ngay lượt đầu ⇒ cả hàng đợi chuyển `DEAD` trong vài phút và triệu chứng duy nhất là im lặng.
  //
  // Suy khoá công khai từ khoá riêng rồi so — biến ca đó thành một dòng lỗi nói thẳng.
  if (khoaCongKhaiTuKhoaRieng(privateKey) !== publicKey) {
    if (log) {
      console.error(
        "[push] VAPID_PRIVATE_KEY và NEXT_PUBLIC_VAPID_PUBLIC_KEY KHÔNG phải một cặp — bỏ cả lượt. " +
          "Thường gặp nhất: vừa xoay khoá trên Vercel mà chưa deploy lại (biến NEXT_PUBLIC_ được " +
          "nhúng lúc BUILD, không đọc lúc chạy). Deploy lại rồi thử.",
      );
    }
    return { cauHinh: null, loi: "LECH_CAP" };
  }

  return { cauHinh: { subject, publicKey, privateKey }, loi: null };
}
