// Nhóm mục của THANH BÊN QUẢN TRỊ theo thiết kế `03-quan-tri/QtKhoaHoc.html` (`.side`): một thanh bên duy nhất, các mục chia nhóm có nhãn nhỏ
// ("Khoá nội bộ · nhân viên" · "Ngân hàng" · "Chấm bài" · "Báo cáo" · "Cài đặt") — KHÔNG còn bộ chuyển "khu làm việc".
//
// HÀM THUẦN, chỉ SẮP XẾP lại các mục mà `menuElearning` đã lọc theo quyền: không thêm mục nào người này không thấy, không đổi `href`. Quyền vẫn là
// `can()` ở layout/trang (menu chỉ quyết định VẼ lối vào nào). Mục thiết kế có mà ta chưa có route ("Khoá online · học viên", "Xem video và cờ" nếu chưa
// có màn) KHÔNG được vẽ (luật 12).
import type { BieuTuong, KhuMenu } from "./menu";

export type MucThanhBen = { href: string; nhan: string; bieuTuong: BieuTuong };
export type NhomThanhBen = { nhan: string | null; muc: MucThanhBen[] };

/** Tên nhóm trong thiết kế, theo thứ tự hiển thị. `null` = mục đứng riêng đầu thanh (không có nhãn nhóm). */
export const THU_TU_NHOM: readonly (string | null)[] = [null, "Khoá nội bộ · nhân viên", "Khoá online · bán cho học viên", "Ngân hàng", "Chấm bài", "Báo cáo", "Cài đặt"];

/** Nhóm rơi về khi có mục mới chưa khai ở đây — hiện ở CUỐI thanh để không lọt mất lối vào (lưới `nhom-thanh-ben.test.ts` đòi khai đủ). */
export const NHOM_KHAC = "Khác";

/** href → [nhóm, nhãn theo thiết kế, thứ tự trong nhóm]. Nhãn `null` = giữ nhãn của menu (vd. "Báo cáo đội" của quản lý cơ sở). */
const BANG: Readonly<Record<string, readonly [string | null, string | null, number]>> = {
  "/elearning/dao-tao": [null, "Tổng quan", 0],
  "/elearning/chuong-trinh": ["Khoá nội bộ · nhân viên", "Chương trình", 0],
  "/elearning/soan-khoa": ["Khoá nội bộ · nhân viên", "Khoá học", 1],
  "/elearning/giao-bai": ["Khoá nội bộ · nhân viên", "Giao khoá", 2],
  "/elearning/luot-giao": ["Khoá nội bộ · nhân viên", "Lượt giao", 3],
  "/elearning/yeu-cau": ["Khoá nội bộ · nhân viên", "Yêu cầu đào tạo", 4],
  "/elearning/ma-tran": ["Khoá nội bộ · nhân viên", "Ma trận đào tạo", 5],
  "/elearning/online": ["Khoá online · bán cho học viên", "Khoá online", 0],
  "/elearning/online/danh-muc": ["Khoá online · bán cho học viên", "Danh mục khoá", 1],
  "/elearning/kho-cau-hoi": ["Ngân hàng", "Câu hỏi", 0],
  "/elearning/de-thi": ["Ngân hàng", "Đề thi", 1],
  "/elearning/khung-cham": ["Ngân hàng", "Khung chấm", 2],
  "/elearning/cham-bai-tap": ["Chấm bài", "Bài tập và sản phẩm", 0],
  "/elearning/cham-bai": ["Chấm bài", "Bài thi tự luận", 1],
  "/elearning/bao-cao": ["Báo cáo", null, 0],
  "/elearning/bao-cao-r4": ["Báo cáo", "Theo phòng ban", 1],
  // Thiết kế (QtNguoiHoc) đặt đường dẫn "Quản trị / Khoá nội bộ / Người học" ⇒ nằm cùng nhóm Khoá nội bộ, sau Ma trận.
  "/elearning/nguoi-hoc": ["Khoá nội bộ · nhân viên", "Người học", 6],
  "/elearning/bao-cao-r5": ["Báo cáo", "Kết quả thi", 2],
  "/elearning/bao-cao-r7": ["Báo cáo", "Hiệu quả đào tạo", 3],
  "/elearning/chung-nhan": ["Báo cáo", "Chứng nhận", 5],
  "/elearning/tu-dong-hoa": ["Cài đặt", "Tự động hoá", 0],
  "/elearning/muc-danh-gia": ["Cài đặt", "Mức gắn đánh giá", 1],
};

/** Các href đã có chỗ trong thanh bên — lưới test đối chiếu với MỌI mục của khu quản trị. */
export const HREF_DA_KHAI: readonly string[] = Object.keys(BANG);

/** Gom các khu QUẢN TRỊ (mọi khu trừ "Học tập") thành nhóm theo thiết kế. Nhóm rỗng không xuất hiện; không trùng `href`. */
export function nhomThanhBen(khuQuanTri: readonly KhuMenu[]): NhomThanhBen[] {
  const gap = new Map<string, { thuTu: number; muc: MucThanhBen }[]>();
  const daCo = new Set<string>();
  for (const k of khuQuanTri) {
    for (const m of k.muc) {
      if (daCo.has(m.href)) continue;
      daCo.add(m.href);
      const b = BANG[m.href];
      const nhom = b ? b[0] : NHOM_KHAC;
      const khoa = nhom ?? "";
      const ds = gap.get(khoa) ?? [];
      // `/elearning/bao-cao` có HAI nhãn theo quyền: người xem toàn hệ = "Tuân thủ hạn chót" (thiết kế); quản lý cơ sở giữ "Báo cáo đội".
      const nhan = m.href === "/elearning/bao-cao" && m.nhan === "Tổng quan báo cáo" ? "Tuân thủ hạn chót" : (b?.[1] ?? m.nhan);
      ds.push({ thuTu: b ? b[2] : 99, muc: { href: m.href, nhan, bieuTuong: m.bieuTuong } });
      gap.set(khoa, ds);
    }
  }
  const ra: NhomThanhBen[] = [];
  for (const nhan of [...THU_TU_NHOM, NHOM_KHAC]) {
    const ds = gap.get(nhan ?? "");
    if (!ds || ds.length === 0) continue;
    ra.push({ nhan, muc: ds.sort((a, b) => a.thuTu - b.thuTu).map((x) => x.muc) });
  }
  return ra;
}

/** Nhóm + nhãn của mục đang mở — cho đường dẫn "Quản trị / Khoá nội bộ · nhân viên / Khoá học". `null` nếu mục không thuộc thanh bên. */
export function viTriTrongThanhBen(nhom: readonly NhomThanhBen[], href: string): { nhom: string | null; nhan: string } | null {
  for (const g of nhom) {
    const m = g.muc.find((x) => x.href === href);
    if (m) return { nhom: g.nhan, nhan: m.nhan };
  }
  return null;
}
