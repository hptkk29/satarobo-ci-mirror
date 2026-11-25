// lib/finance/hoa-don/nap-con-nguoi-mua.ts — NẠP dữ kiện «con làm người mua» cho một/nhiều đơn. Phần KHÔNG thuần của `nguoi-mua-theo-con.ts`.
//
// Vì sao tách khỏi `nguoiMuaChoDon` (thuần): chọn con cần những thứ không nằm trên bản ghi đơn — mốc áp dụng (cài đặt), hồ sơ học viên (tên/CCCD khi đơn chưa lưu), học viên của từng DÒNG đơn,
// và «đơn đã có chứng từ phát hành TRƯỚC mốc chưa» (phiếu thu / hoá đơn). Hàm này chỉ GOM DỮ KIỆN (`ThongTinConDon`); `conChoChungTu` (thuần) quyết «bé của chứng từ» là ai.
//
// MỖI CHỨNG TỪ MỘT BÉ (chủ dự án 17/11, đơn nhiều con): nơi nào dựng người mua cho MỘT hoá đơn / phiếu thu thì truyền các DÒNG ĐƠN của khoản trong chứng từ đó (`orderItemIds`) — xem `orderItemIdsCuaKhoan`.
// Nơi không có chứng từ cụ thể (màn đơn) không truyền ⇒ cả đơn: đơn một con ra con, đơn nhiều con ra ba/mẹ.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { docMocNguoiMuaTheoCon } from "./feature";
import { conChoChungTu, type BenNguoiMua, type HocVienCuaDon, type QuyetNguoiMua, type ThongTinConDon } from "./nguoi-mua-theo-con";

type Client = Pick<Prisma.TransactionClient, "order" | "payment">;

const HO_SO = { select: { id: true, name: true, nationalId: true } } as const;

/**
 * Rỗng ⇒ `Map` rỗng; mỗi `orderId` ĐƯỢC HỎI đều có mặt trong kết quả (luật TẮT / không có đơn ⇒ `null`).
 * `boQuaMoc` (kế toán CHỌN TAY, 24/11/2026): nạp dữ kiện kể cả khi luật tự động đang TẮT hoặc đơn đã có chứng từ trước mốc — người đứng tên là quyết định của kế toán, không còn là của luật.
 */
export async function napThongTinCon(orderIds: readonly string[], client: Client = db, opts?: { boQuaMoc?: boolean }): Promise<Map<string, ThongTinConDon | null>> {
  const ra = new Map<string, ThongTinConDon | null>(orderIds.map((id) => [id, null]));
  if (orderIds.length === 0) return ra;
  const boQuaMoc = opts?.boQuaMoc === true;
  const moc = boQuaMoc ? null : await docMocNguoiMuaTheoCon();
  if (!boQuaMoc && moc === null) return ra; // luật TẮT — không tốn thêm câu tra nào
  // Chọn tay: không xét «chứng từ trước mốc» ⇒ mốc giả `new Date(0)` (không chứng từ nào cũ hơn) để hai câu tra dưới trả rỗng.
  const mocXet = moc ?? new Date(0);

  const don = await client.order.findMany({
    where: { id: { in: [...new Set(orderIds)] } },
    select: {
      id: true,
      invoiceStudentName: true,
      invoiceStudentCccd: true,
      invoiceHocVienThem: true,
      student: HO_SO,
      items: { select: { id: true, student: HO_SO } },
      // Chứng từ phát hành TRƯỚC mốc — chỉ cần biết CÓ hay không (take 1), không cần danh sách.
      hoaDonDienTu: { where: { createdAt: { lt: mocXet } }, select: { id: true }, take: 1 },
      payments: { where: { receipts: { some: { issuedAt: { lt: mocXet } } } }, select: { id: true }, take: 1 },
    },
  });

  for (const d of don) {
    const hocVien: Record<string, HocVienCuaDon> = {};
    const hocVienCuaDong: Record<string, string | null> = {};
    if (d.student) hocVien[d.student.id] = { ten: d.student.name, cccd: d.student.nationalId };
    for (const i of d.items) {
      hocVienCuaDong[i.id] = i.student?.id ?? null;
      if (i.student) hocVien[i.student.id] = { ten: i.student.name, cccd: i.student.nationalId };
    }
    ra.set(d.id, {
      apDung: true,
      chungTuTruocMoc: d.hoaDonDienTu.length > 0 || d.payments.length > 0,
      tenTrenDon: d.invoiceStudentName,
      cccdTrenDon: d.invoiceStudentCccd,
      khaiThem: docKhaiThem(d.invoiceHocVienThem),
      hocVienCuaDon: d.student?.id ?? null,
      hocVien,
      hocVienCuaDong,
    });
  }
  return ra;
}

/** `Order.invoiceHocVienThem` (JSON) → danh sách {ten, cccd}. Phần tử sai hình dạng bị bỏ (không ném: đây là cột JSON người dùng nhập). */
function docKhaiThem(v: unknown): { ten: string; cccd: string | null }[] {
  if (!Array.isArray(v)) return [];
  const ra: { ten: string; cccd: string | null }[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const ten = typeof o.ten === "string" ? o.ten.trim() : "";
    if (ten === "") continue;
    ra.push({ ten, cccd: typeof o.cccd === "string" && o.cccd.trim() !== "" ? o.cccd.trim() : null });
  }
  return ra;
}

/** Các DÒNG ĐƠN của một tập khoản thu (`Payment.orderItemId`; `null` = khoản chưa gắn dòng). Dùng để hỏi «bé của chứng từ». */
export async function orderItemIdsCuaKhoan(paymentIds: readonly string[], client: Client = db): Promise<(string | null)[]> {
  if (paymentIds.length === 0) return [];
  const ps = await client.payment.findMany({ where: { id: { in: [...paymentIds] } }, select: { orderItemId: true } });
  return ps.map((p) => p.orderItemId);
}

/** «Con ứng viên» của MỘT chứng từ (hoặc cả đơn khi không truyền `orderItemIds`). */
export async function napConChoMotDon(orderId: string, client: Client = db, orderItemIds?: readonly (string | null)[], opts?: { boQuaMoc?: boolean }): Promise<BenNguoiMua | null> {
  return conChoChungTu((await napThongTinCon([orderId], client, opts)).get(orderId) ?? null, orderItemIds, opts);
}

/**
 * Gắn `conChoNguoiMua` vào bản ghi đơn đã nạp — để chuyển thẳng cho `nguoiMuaChoDon` / `DonChoHoaDon`.
 * `nguoiMuaChon` (24/11/2026): kế toán đã CHỌN TAY — gắn luôn vào khối đơn (`DonChoHoaDon.nguoiMuaChon`) và với «CON» thì nạp con bỏ qua mốc. Không truyền ⇒ luật tự động như cũ.
 */
export async function ganConChoDon<T extends object>(
  orderId: string,
  don: T,
  client: Client = db,
  orderItemIds?: readonly (string | null)[],
  nguoiMuaChon?: QuyetNguoiMua,
): Promise<T & { conChoNguoiMua: BenNguoiMua | null; nguoiMuaChon?: QuyetNguoiMua }> {
  if (nguoiMuaChon === undefined) return { ...don, conChoNguoiMua: await napConChoMotDon(orderId, client, orderItemIds) };
  // Chọn ba/mẹ: không cần nạp con (không có con ⇒ `quyetNguoiMuaTheoCon` trả ba/mẹ).
  const con = nguoiMuaChon === "CON" ? await napConChoMotDon(orderId, client, orderItemIds, { boQuaMoc: true }) : null;
  return { ...don, conChoNguoiMua: con, nguoiMuaChon };
}
