// lib/orders/tin-cho-duyet.ts — SOẠN NỘI DUNG tin báo "đơn chờ duyệt". THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH KHỎI PHẦN GỬI [25/09/2026]
//
// Chủ dự án: *"khi có đơn cần được duyệt thì phải gửi thông báo về ngay cho quản lý để
// duyệt gấp cho KH được thanh toán"*.
//
// Phần GỬI chạm DB (tra người nhận, ghi `StaffNotification`) nên chỉ kiểm được bằng test
// có Postgres. Phần SOẠN CHỮ thì không — mà chữ mới là thứ quyết định người đọc có bấm
// vào hay không. Tách ra để nó có bộ ca chạy trong `test:unit` và có chỗ cấy lỗi.

import type { PhanCanDuyet } from "@/lib/orders/nguong-duyet";

/**
 * Vì sao đơn phải chờ duyệt — quyết định câu chữ, nên nó là dữ liệu chứ không phải chuỗi.
 *
 * ⚠️ BÍ DANH của `PhanCanDuyet`, KHÔNG phải một kiểu thứ hai [25/09/2026]. Trước đó đây là
 * một khai báo riêng trùng hình dạng, và trùng hình dạng thì `tsc` im lặng khi một bên mọc
 * thêm cờ — đúng đường để tin báo nói về hai phần trong khi DB ghi ba.
 */
export type LyDoChoDuyet = PhanCanDuyet;

export type TinChoDuyet = {
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
};

/**
 * Khoá chống trùng — MỘT đơn một khoá, KHÔNG kèm lý do hay số tiền.
 *
 * ⚠️ Đây là quyết định có hệ quả. Khoá phải GIỐNG NHAU giữa lúc GỬI và lúc THU HỒI, nếu
 * không thì duyệt xong tin vẫn nằm trong chuông và người ta bấm vào một đơn đã xong. Nhét
 * lý do vào khoá (`…:<id>:giamGia`) là đúng cái bẫy đó: đơn chờ duyệt cả hai phần sẽ sinh
 * hai tin, mà lượt thu hồi chỉ biết một khoá.
 */
export function khoaTinChoDuyet(orderId: string): string {
  return `don.cho_duyet:${orderId}`;
}

/**
 * Soạn tin.
 *
 * ⚠️ TIÊU ĐỀ NÓI **VIỆC PHẢI LÀM**, không nói sự kiện. "Đơn ORD-… vừa được tạo" là tin
 * tức; "Duyệt đơn ORD-… — khách đang chờ trả tiền" là một việc. Chuông này đã có 30 loại
 * tin, nên tin nào không nói rõ phải làm gì sẽ bị lướt qua.
 *
 * ⚠️ KHÔNG đưa SỐ ĐIỆN THOẠI vào tin. `lib/notifications/pii.ts` có cổng cảnh báo, nhưng
 * cổng ấy là lưới cuối; chỗ soạn chữ mới là chỗ quyết định. Tên khách + mã đơn đã đủ để
 * người duyệt biết đang duyệt cho ai, và tin thông báo thì đi vào bảng, vào bản đẩy, vào
 * màn hình khoá điện thoại — ba nơi không ai kiểm soát được ai đang nhìn.
 */
export function soanTinChoDuyet(input: {
  orderId: string;
  code: string;
  tenKhach: string;
  tongTien: number;
  lyDo: LyDoChoDuyet;
}): TinChoDuyet {
  const phan = phanChoDuyet(input.lyDo);
  return {
    dedupeKey: khoaTinChoDuyet(input.orderId),
    title: `Duyệt đơn ${input.code} — ${phan}`,
    // Câu thứ hai nói HẬU QUẢ CỦA VIỆC CHƯA LÀM. Đó là thứ biến một dòng trong chuông
    // thành một lượt bấm: người duyệt không nợ ai một cú bấm, nhưng họ nợ một khách đang
    // đứng chờ.
    body:
      `${input.tenKhach} · ${input.tongTien.toLocaleString("vi-VN")}đ. ` +
      `Chưa duyệt thì đơn không xuất được mã QR, khách chưa thanh toán được.`,
    // ⚠️ TRỎ THẲNG MỘT ĐƠN, không trỏ danh sách [đổi 25/09/2026].
    //
    // Chủ dự án: *"khi qly thấy thông báo chỉ cần bấm vào xem đơn hàng cần duyệt ĐÓ và
    // duyệt luôn"*. href cũ là `/orders?duyet=1` — cả hàng chờ, nên người duyệt vẫn phải
    // tự dò tìm đúng đơn vừa báo. Cả hai kênh (chuông trong app và Web Push qua
    // `public/sw.js`) đều mở đúng chuỗi này, nên đổi ở đây là đổi cho cả hai.
    href: `/orders/${input.orderId}/duyet`,
  };
}

/**
 * Cụm chữ mô tả phần đang chờ. Xem `nhanChoDuyet` (cùng luật, khác chỗ dùng).
 *
 * ⚠️ DỰNG TỪ DANH SÁCH, KHÔNG if/else [đổi 25/09/2026]. Bản cũ là ba nhánh cho hai cờ;
 * thêm cờ thứ ba là nó trả câu SAI (đơn chỉ vướng số buổi được báo là "vượt mức số đợt")
 * mà không ca nào đỏ. Ba cờ ⇒ 7 tổ hợp; viết tay 7 nhánh là mời con bug ấy quay lại ở lần
 * thêm cờ thứ tư.
 */
const CUM: readonly { khoa: keyof LyDoChoDuyet; chu: string }[] = [
  { khoa: "giamGia", chu: "vượt mức ưu đãi" },
  { khoa: "traGop", chu: "vượt mức số đợt" },
  // KHÔNG nói "vượt": bán 20 buổi không vượt gì cả, nó chỉ không rơi đúng mốc học phần.
  { khoa: "soBuoi", chu: "số buổi không khớp mốc học phần" },
];

function phanChoDuyet(lyDo: LyDoChoDuyet): string {
  const chu = CUM.filter((c) => lyDo[c.khoa]).map((c) => c.chu);
  // Không lý do nào ⇒ chỗ gọi đang gửi nhầm. Trả câu trung tính thay vì ném: một ngoại lệ
  // ở đường thông báo mà làm hỏng lượt tạo đơn thì cái giá lớn hơn nhiều so với một câu
  // chữ chung chung.
  if (chu.length === 0) return "cần duyệt";
  if (chu.length === 1) return chu[0]!;
  // "A, B và C" — dấu phẩy cho các phần đầu, "và" cho phần cuối.
  return `${chu.slice(0, -1).join(", ")} và ${chu[chu.length - 1]}`;
}
