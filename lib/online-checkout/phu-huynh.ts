import type { PrismaClient } from "@prisma/client";
import { banDuocLucNay } from "@/lib/elearning-online/danh-muc-cong-khai";
import { quyetDinhCap, trangThaiHieuLuc, type MaLoiCap, type QuyenHienCo, type TrangThaiHieuLuc } from "@/lib/elearning-online/quyen-hoc";
import type { KyHan } from "@/lib/elearning-online/thoi-han";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { KHOAN_DA_GHI_NHAN, sumRecorded } from "@/lib/finance/ghi-nhan";
import { writeAudit } from "@/lib/audit/audit-log";
import { nhaGiuKho } from "@/lib/inventory/giu-kho";
import { docSnapshot } from "./cau-hinh-thanh-toan";
import { gopTrangThaiHoanDon, trangThaiHoanCuaDong, type TrangThaiHoanDon, type TrangThaiHoanDong } from "./hoan-tien-doc";
import { daHoanThanhKhoa } from "./tao-don";

/**
 * WORKSTREAM A — MẶT PHỤ HUYNH/HỌC VIÊN của luồng mua khoá Online: chọn con · xem khoá nào mua được cho con nào · xem/làm mới đơn · huỷ đơn chưa trả tiền.
 *
 * Tất cả nhận `parentUserId` do LỚP GỌI lấy từ PHIÊN (không từ client) và TỰ kiểm sở hữu: sai phụ huynh ⇒ `SAI_PHU_HUYNH`/`null`, không phân biệt
 * "không có" với "không phải của bạn". Phần HỌC (mục lục, bài, tiến độ, đề, kết quả, chứng nhận) KHÔNG nằm ở đây — dùng thẳng các hàm của
 * `lib/elearning-online` (hợp đồng v0.2 mục 3.3–3.7); file này không đọc nội dung bài học nào.
 */

type Db = PrismaClient;

export type ConCuaPhuHuynh = { studentId: string; ten: string; maHocVien: string | null; chiHocOnline: boolean; soKhoaOnline: number };

/** Danh sách con của phụ huynh + số khoá online ĐANG có quyền (không tính thu hồi). `chiHocOnline` = hồ sơ không thuộc cơ sở nào (mã `SR`). */
export async function docConCuaPhuHuynh(db: Db, input: { parentUserId: string; now: Date }): Promise<ConCuaPhuHuynh[]> {
  const con = await db.student.findMany({
    where: { parentUserId: input.parentUserId, deletedAt: null },
    select: { id: true, name: true, studentCode: true, centerId: true, onlEntitlements: { where: { status: "ACTIVE" }, select: { expiresAt: true } } },
    orderBy: { name: "asc" },
  });
  return con.map((c) => ({
    studentId: c.id,
    ten: c.name,
    maHocVien: c.studentCode,
    chiHocOnline: c.centerId === null,
    soKhoaOnline: c.onlEntitlements.filter((q) => trangThaiHieuLuc({ trangThai: "ACTIVE", hetHan: q.expiresAt }, input.now) !== "HET_HAN").length,
  }));
}

export type TrangThaiMua = "MUA_DUOC" | "GIA_HAN_DUOC" | "MUA_LAI_DUOC" | "DANG_HOC_KHONG_GIA_HAN" | "TRON_DOI" | "CHUA_DU_TIEN_QUYET";

export type KhoaMuaDuocChoCon = {
  courseId: string;
  ten: string;
  trangThai: TrangThaiMua;
  /** Số tiền khách sẽ trả nếu mua lúc này (chưa trừ mã giảm). `null` khi không mua được. */
  gia: number | null;
  hetHanHienTai: Date | null;
  trangThaiHieuLuc: TrangThaiHieuLuc | null;
};

/** Cho từng khoá ĐANG BÁN: con này mua/gia hạn được không, giá bao nhiêu — dùng CÙNG luật với `taoDonOnline` (hàm lõi `quyetDinhCap` + tiên quyết). */
export async function docKhoaMuaDuocChoCon(db: Db, input: { parentUserId: string; studentId: string; now: Date }): Promise<KhoaMuaDuocChoCon[] | null> {
  const sv = await db.student.findFirst({ where: { id: input.studentId, parentUserId: input.parentUserId, deletedAt: null }, select: { id: true } });
  if (!sv) return null;
  const [khoa, quyen] = await Promise.all([
    db.onlCourse.findMany({
      where: { deletedAt: null, publishedVersionId: { not: null } },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, salePrice: true, renewalPrice: true, validityMonths: true, renewalEnabled: true, saleStatus: true, saleOpensAt: true, prerequisiteMode: true, prerequisiteCourseId: true },
    }),
    db.onlEntitlement.findMany({ where: { studentId: input.studentId }, select: { courseId: true, status: true, expiresAt: true, anchorDay: true } }),
  ]);
  const quyenTheoKhoa = new Map(quyen.map((q) => [q.courseId, q]));
  const kq: KhoaMuaDuocChoCon[] = [];
  for (const k of khoa) {
    if (!banDuocLucNay(k.saleStatus, k.saleOpensAt, input.now)) continue;
    const q = quyenTheoKhoa.get(k.id);
    const hienCo: QuyenHienCo | null = q ? { trangThai: q.status, hetHan: q.expiresAt, anchorDay: q.anchorDay } : null;
    const hieuLuc = hienCo ? trangThaiHieuLuc(hienCo, input.now) : null;
    const ky: KyHan = k.validityMonths === null ? { loai: "TRON_DOI" } : { loai: "THANG", soThang: k.validityMonths };
    const qd = quyetDinhCap({ now: input.now, loai: "MUA", quyen: hienCo, ky, choPhepGiaHan: k.renewalEnabled });
    const co = { courseId: k.id, ten: k.name, hetHanHienTai: q?.expiresAt ?? null, trangThaiHieuLuc: hieuLuc };
    if (!qd.ok) {
      const ma: MaLoiCap = qd.ma;
      kq.push({ ...co, trangThai: ma === "DA_TRON_DOI" ? "TRON_DOI" : "DANG_HOC_KHONG_GIA_HAN", gia: null });
      continue;
    }
    if (k.prerequisiteMode === "REQUIRED" && k.prerequisiteCourseId && !(await daHoanThanhKhoa(db, input.studentId, k.prerequisiteCourseId))) {
      kq.push({ ...co, trangThai: "CHUA_DU_TIEN_QUYET", gia: null });
      continue;
    }
    const giaHan = qd.hanhDong === "GIA_HAN";
    kq.push({ ...co, trangThai: giaHan ? "GIA_HAN_DUOC" : hienCo ? "MUA_LAI_DUOC" : "MUA_DUOC", gia: giaHan ? (k.renewalPrice ?? k.salePrice) : k.salePrice });
  }
  return kq;
}

/**
 * Trạng thái cấp quyền của MỘT dòng (V8.17 G4). KHÔNG có «thất bại thanh toán»/«hết hạn thanh toán»: hệ không có tín hiệu thật nào cho hai điều đó
 * (SePay chỉ báo tiền VỀ; đơn không tự hết hạn) — chỉ thêm khi có sự kiện/quy tắc thật.
 *   DANG_CHO_THANH_TOAN   chưa đủ tiền (hoặc đơn đã huỷ mà chưa cấp)
 *   DA_THU_DANG_CAP_QUYEN tiền ĐÃ ĐỦ nhưng quyền CHƯA cấp xong (đang/chờ thử lại) — app hiện «đang kích hoạt», KHÔNG bảo thanh toán lại
 *   DA_CAP_QUYEN          quyền đã cấp (khoá hiện ở API học ngay)
 *   CAN_NHAN_VIEN_XU_LY   đã thu tiền nhưng cấp thất bại/cần người xem (hàng đợi nhân sự) — app báo liên hệ trung tâm
 */
export type TrangThaiCapDong = "DANG_CHO_THANH_TOAN" | "DA_THU_DANG_CAP_QUYEN" | "DA_CAP_QUYEN" | "CAN_NHAN_VIEN_XU_LY";
export type TrangThaiThanhToanDon = "CHO_THANH_TOAN" | "DA_THU_MOT_PHAN" | "DA_THU_DU" | "DA_HUY";
export type TrangThaiCapQuyenDon = "CHUA_CAP" | "DANG_CAP_QUYEN" | "DA_CAP_MOT_PHAN" | "DA_CAP_DU" | "CAN_XU_LY";

/** Tien do giao cua MOT dong hoc cu (anh xa tu `OrderItemFulfillmentStatus`; app khong thay enum noi bo). */
export type TienDoGiao = "CHO_THANH_TOAN" | "DA_THANH_TOAN" | "DANG_CHUAN_BI" | "DANG_GIAO" | "DA_GIAO" | "GIAO_THAT_BAI" | "DA_HUY" | "DA_TRA_HANG" | "CAN_NHAN_VIEN_XU_LY";
export const TIEN_DO_GIAO: Record<string, TienDoGiao> = { AWAITING_PAYMENT: "CHO_THANH_TOAN", PAID: "DA_THANH_TOAN", PACKING: "DANG_CHUAN_BI", SHIPPED: "DANG_GIAO", DELIVERED: "DA_GIAO", FAILED: "GIAO_THAT_BAI", CANCELLED: "DA_HUY", RETURNED: "DA_TRA_HANG", NEEDS_STAFF: "CAN_NHAN_VIEN_XU_LY" };

export type DonOnlineCuaPhuHuynh = {
  orderId: string;
  orderCode: string;
  trangThaiDon: string;
  tongTien: number;
  daThu: number;
  taoLuc: Date;
  /** Tóm tắt cấp độ ĐƠN (app hiện một dòng trạng thái). */
  trangThaiThanhToan: TrangThaiThanhToanDon;
  trangThaiCapQuyen: TrangThaiCapQuyenDon;
  /** Cần người xử lý tiền/quyền (có dòng CAN_NHAN_VIEN_XU_LY, hoặc đơn ĐÃ HUỶ mà có tiền về) — app báo «liên hệ trung tâm», không tự thử lại. */
  canDoiSoat: boolean;
  /** Các khoản ĐÃ GHI NHẬN của đơn (cùng điều kiện với «đã thu» — không gồm khoản bị kế toán từ chối). KHÔNG có số tài khoản/tên người chuyển. */
  lichSuThanhToan: { paymentId: string; soTien: number; ngay: Date; phuongThuc: string }[];
  /** V8.40 — khoản HOÀN đã ghi sổ (dòng Payment âm). `lichSuThanhToan` CHỈ có khoản thu dương. */
  lichSuHoan: { soTien: number; ngay: Date; phuongThuc: string }[];
  /** V8.40 — tiền ĐÃ HOÀN (đồng, ≥ 0) và số dòng đã hoàn. Bảo đảm `daHoan > 0` ⇔ `soDongDaHoan > 0`. `daThu` = tiền ĐANG GIỮ (đã thu − đã hoàn). */
  daHoan: number;
  soDongDaHoan: number;
  hoanTien: { trangThai: TrangThaiHoanDon; yeuCauMo: { id: string; trangThai: string; lyDo: string; taoLuc: Date } | null; choPhepGuiYeuCau: boolean };
  /**
   * Biên nhận/phiếu thu ĐÃ PHÁT HÀNH cho các khoản của đơn (do Kế toán xác nhận khoản ⇒ `Receipt` gắn thẳng Payment, KHÔNG cần ghi danh Offline). Chỉ mã + ngày; chưa có tải PDF cho đơn Online.
   * Khoản mới ghi nhận mà kế toán chưa xác nhận thì CHƯA có biên nhận — «biên nhận hiển thị trong app» KHÔNG thay phiếu thu kế toán.
   */
  bienNhan: { paymentId: string; maPhieu: string; phatHanhLuc: Date }[];
  /** Hoá đơn điện tử của đơn (chỉ trạng thái; tải tệp CHƯA hỗ trợ cho đơn Online). Quyền học KHÔNG phụ thuộc hoá đơn. */
  hoaDon: { trangThai: "CHUA_PHAT_HANH" | "DANG_XU_LY" | "DA_PHAT_HANH"; ghiChu: string };
  /** Đơn vị BÁN / nhận tiền / xuất hoá đơn của đơn (pháp nhân SataRobo, chụp lúc tạo đơn). null = đơn tạo trước khi có cấu hình thu tiền Online. */
  donViBan: { tenPhapLy: string; maSoThue: string } | null;
  /** V8.43 - phi giao (0 neu don khong co hoc cu) */
  phiVanChuyen: number;
  /** V8.43 - anh chup giao hang luc dat; null = don khong co hoc cu */
  giaoHang: { phuongThuc: string; phi: number; nguoiNhan: string; soDienThoai: string; diaChi: string } | null;
  /** V8.43 - giu kho cua don: DANG_GIU (han som nhat) | HET_HAN (qua han / da bi quet). null = khong co / da tieu thu / da nha / don da huy. */
  giuKho: { trangThai: "DANG_GIU" | "HET_HAN"; hanGiuLuc: Date } | null;
  /** V8.43 - cac dong HOC CU (tien do giao theo tung dong). Rong voi don chi khoa. */
  dongHocCu: { orderItemId: string; productId: string; sku: string; ten: string; soLuong: number; donGia: number; thanhTien: number; tienDo: TienDoGiao; maVanDon: string | null; donViVanChuyen: string | null }[];
  dong: { orderItemId: string; courseId: string; tenKhoa: string; studentId: string; donGia: number; giam: number; trangThai: TrangThaiCapDong; hetHan: Date | null; thuLaiLuc: Date | null; hoanTien: TrangThaiHoanDong; soTienDaHoan: number; hoanHet: boolean; quyenDaThuHoi: boolean; canXuLyQuyen: boolean }[];
};

/**
 * Một đơn online của phụ huynh + trạng thái cấp quyền từng dòng — màn "làm mới sau thanh toán" gọi hàm này.
 * `DA_CAP_QUYEN` ⇒ khoá đã hiện trong `docKhoaOnlineCuaHocVien` NGAY. `CAN_NHAN_VIEN_XU_LY` = đã thu tiền nhưng cấp quyền thất bại (hàng đợi ops).
 */
export async function docDonOnlineCuaPhuHuynh(db: Db, input: { parentUserId: string; orderId: string; /** kênh gửi yêu cầu hoàn từ app đang mở? (tham số do người gọi đọc) */ choPhepGuiYeuCauHoan?: boolean }): Promise<DonOnlineCuaPhuHuynh | null> {
  const don = await db.order.findFirst({
    where: { id: input.orderId, type: "ONLINE", createdById: input.parentUserId, deletedAt: null },
    select: {
      id: true, code: true, status: true, totalAmount: true, createdAt: true, onlinePaymentSnapshot: true, shippingFee: true, shippingMethodCode: true, shippingAddress: true,
      items: { select: { id: true, type: true, productId: true, quantity: true, totalPrice: true, metadata: true, fulfillment: { select: { status: true, trackingCode: true, carrier: true } }, onlineCourseId: true, studentId: true, itemName: true, unitPrice: true, discountAmount: true, onlineGrant: { select: { status: true, entitlementId: true, nextRetryAt: true } } } },
    },
  });
  if (!don) return null;
  const itemsHang = don.items.filter((i) => i.type === "PRODUCT" && i.productId);
  don.items = don.items.filter((i) => i.type !== "PRODUCT"); // `dong` chi la dong KHOA; hoc cu di rieng o `dongHocCu`
  // Giữ kho còn ACTIVE ⇒ hạn sớm nhất (quá hạn mà reaper chưa quét ⇒ HET_HAN); đã EXPIRED (reaper đã quét) ⇒ HET_HAN; CONSUMED/RELEASED ⇒ không còn «giữ kho» để hiện.
  const giuHienCo = itemsHang.length ? await db.productReservation.findMany({ where: { orderItemId: { in: itemsHang.map((i) => i.id) }, status: { in: ["ACTIVE", "EXPIRED"] } }, select: { status: true, expiresAt: true } }) : [];
  const conHieuLuc = giuHienCo.filter((r) => r.status === "ACTIVE");
  const hanGiu = conHieuLuc.length ? new Date(Math.min(...conHieuLuc.map((r) => r.expiresAt.getTime()))) : giuHienCo.length ? new Date(Math.max(...giuHienCo.map((r) => r.expiresAt.getTime()))) : null;
  const dc = don.shippingAddress as { hoTen?: string; soDienThoai?: string; diaChiMotDong?: string } | null;
  const entIds = don.items.map((i) => i.onlineGrant?.entitlementId).filter((x): x is string => !!x);
  const quyen = entIds.length ? await db.onlEntitlement.findMany({ where: { id: { in: entIds } }, select: { id: true, expiresAt: true } }) : [];
  const hanTheoQuyen = new Map(quyen.map((q) => [q.id, q.expiresAt]));
  const daThu = await sumRecorded(don.id);
  const yeuCauHoan = don.items.length ? await db.refundRequest.findMany({ where: { kenh: "ONLINE", orderItemId: { in: don.items.map((i) => i.id) } }, orderBy: { createdAt: "desc" }, select: { id: true, orderItemId: true, status: true, reason: true, lyDoTuChoi: true, createdAt: true, approvedAmount: true, quyenDaThuHoiLuc: true, canXuLyQuyen: true } }) : [];
  const khoan = await db.payment.findMany({ where: { orderId: don.id, ...KHOAN_DA_GHI_NHAN }, orderBy: { paidDate: "asc" }, select: { id: true, amount: true, paidDate: true, method: true } });
  // Chỉ ĐỌC trạng thái hoá đơn nếu kế toán đã tạo (engine hoá đơn gắn theo cơ sở của đơn; đơn Online không có cơ sở ⇒ thường chưa có). Không tạo, không ký, không tải tệp.
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: don.id, trangThai: { in: ["DA_XAC_NHAN", "DANG_PHAT_HANH", "NHAP"] } }, select: { trangThai: true } });
  const hoaDon: DonOnlineCuaPhuHuynh["hoaDon"] = hd.some((h) => h.trangThai === "DA_XAC_NHAN")
    ? { trangThai: "DA_PHAT_HANH", ghiChu: "Hoá đơn đã phát hành; tải tệp cho đơn Online chưa hỗ trợ trong app — liên hệ trung tâm." }
    : hd.length > 0
      ? { trangThai: "DANG_XU_LY", ghiChu: "Kế toán đang xử lý hoá đơn. Quyền học không phụ thuộc hoá đơn." }
      : { trangThai: "CHUA_PHAT_HANH", ghiChu: "Chưa có hoá đơn điện tử cho đơn này. Quyền học không phụ thuộc hoá đơn." };
  const bn = await db.receipt.findMany({ where: { status: "ACTIVE", deletedAt: null, payment: { orderId: don.id } }, orderBy: { issuedAt: "asc" }, select: { paymentId: true, code: true, issuedAt: true } });
  const daHuy = don.status === "CANCELLED";
  // V8.40 — «đã thu» để suy TRẠNG THÁI là tiền thu GỘP (không trừ hoàn): đã hoàn hết vẫn DA_THU_DU, không lùi về CHO_THANH_TOAN; `daThu` trả ra là tiền ĐANG GIỮ (net).
  const thuDuong = khoan.filter((k) => k.amount > 0);
  const hoanSo = khoan.filter((k) => k.amount < 0);
  const daThuGop = thuDuong.reduce((s, k) => s + k.amount, 0);
  const daHoan = hoanSo.reduce((s, k) => s - k.amount, 0);
  const duTien = !daHuy && daThuGop >= don.totalAmount;
  const dong = don.items.map((i) => {
    const g = i.onlineGrant?.status;
    const trangThai: TrangThaiCapDong =
      g === "GRANTED" ? "DA_CAP_QUYEN" : g === "REJECTED" || g === "NEEDS_REVIEW" ? "CAN_NHAN_VIEN_XU_LY" : duTien ? "DA_THU_DANG_CAP_QUYEN" : "DANG_CHO_THANH_TOAN";
    const yc = yeuCauHoan.filter((y) => y.orderItemId === i.id);
    const th = trangThaiHoanCuaDong({ yeuCau: yc, thucTra: i.unitPrice * 1 - i.discountAmount });
    return {
      orderItemId: i.id,
      courseId: i.onlineCourseId ?? "",
      tenKhoa: i.itemName,
      studentId: i.studentId ?? "",
      donGia: i.unitPrice,
      giam: i.discountAmount,
      trangThai,
      hetHan: i.onlineGrant?.entitlementId ? (hanTheoQuyen.get(i.onlineGrant.entitlementId) ?? null) : null,
      thuLaiLuc: trangThai === "DA_THU_DANG_CAP_QUYEN" ? (i.onlineGrant?.nextRetryAt ?? null) : null,
      hoanTien: th.trangThai,
      soTienDaHoan: th.soTienDaHoan,
      hoanHet: th.hoanHet,
      quyenDaThuHoi: th.quyenDaThuHoi,
      canXuLyQuyen: yc.some((y) => y.status === "PAID" && y.canXuLyQuyen),
    };
  });
  const soDongDaHoan = dong.filter((d) => d.soTienDaHoan > 0).length;
  const mo = yeuCauHoan.find((y) => y.status === "PENDING" || y.status === "APPROVED") ?? null;
  const hoanTien: DonOnlineCuaPhuHuynh["hoanTien"] = {
    trangThai: gopTrangThaiHoanDon(dong.map((d) => ({ trangThai: d.hoanTien, soTienDaHoan: d.soTienDaHoan, hoanHet: d.hoanHet, coTien: daThuGop > 0 }))),
    yeuCauMo: mo ? { id: mo.id, trangThai: mo.status, lyDo: mo.reason, taoLuc: mo.createdAt } : null,
    choPhepGuiYeuCau: (input.choPhepGuiYeuCauHoan ?? false) && daThuGop - daHoan > 0 && !daHuy && don.status !== "REFUNDED",
  };
  const soCap = dong.filter((d) => d.trangThai === "DA_CAP_QUYEN").length;
  const coXuLy = dong.some((d) => d.trangThai === "CAN_NHAN_VIEN_XU_LY");
  const trangThaiCapQuyen: TrangThaiCapQuyenDon = coXuLy ? "CAN_XU_LY" : soCap === dong.length && dong.length > 0 ? "DA_CAP_DU" : soCap > 0 ? "DA_CAP_MOT_PHAN" : duTien ? "DANG_CAP_QUYEN" : "CHUA_CAP";
  return {
    orderId: don.id,
    orderCode: don.code,
    trangThaiDon: don.status,
    tongTien: don.totalAmount,
    daThu,
    taoLuc: don.createdAt,
    trangThaiThanhToan: daHuy ? "DA_HUY" : daThuGop <= 0 ? "CHO_THANH_TOAN" : daThuGop < don.totalAmount ? "DA_THU_MOT_PHAN" : "DA_THU_DU",
    trangThaiCapQuyen,
    canDoiSoat: coXuLy || (daHuy && daThu > 0),
    donViBan: ((sn) => (sn ? { tenPhapLy: sn.phapNhan.tenPhapLy, maSoThue: sn.phapNhan.maSoThue } : null))(docSnapshot(don.onlinePaymentSnapshot)),
    bienNhan: bn.map((r) => ({ paymentId: r.paymentId, maPhieu: r.code, phatHanhLuc: r.issuedAt })),
    lichSuThanhToan: thuDuong.map((k) => ({ paymentId: k.id, soTien: k.amount, ngay: k.paidDate, phuongThuc: k.method })),
    lichSuHoan: hoanSo.map((k) => ({ soTien: -k.amount, ngay: k.paidDate, phuongThuc: k.method })),
    daHoan,
    soDongDaHoan,
    hoanTien,
    hoaDon,
    phiVanChuyen: don.shippingFee,
    giaoHang: itemsHang.length && dc ? { phuongThuc: don.shippingMethodCode ?? "", phi: don.shippingFee, nguoiNhan: dc.hoTen ?? "", soDienThoai: dc.soDienThoai ?? "", diaChi: dc.diaChiMotDong ?? "" } : null,
    giuKho: hanGiu && !daHuy ? { trangThai: hanGiu > new Date() ? "DANG_GIU" : "HET_HAN", hanGiuLuc: hanGiu } : null,
    dongHocCu: itemsHang.map((i) => ({ orderItemId: i.id, productId: i.productId!, sku: (i.metadata as { sku?: string } | null)?.sku ?? "", ten: i.itemName, soLuong: i.quantity, donGia: i.unitPrice, thanhTien: i.totalPrice, tienDo: TIEN_DO_GIAO[i.fulfillment?.status ?? "AWAITING_PAYMENT"] ?? "CAN_NHAN_VIEN_XU_LY", maVanDon: i.fulfillment?.trackingCode ?? null, donViVanChuyen: i.fulfillment?.carrier ?? null })),
    dong,
  };
}

export async function docDanhSachDonOnline(db: Db, input: { parentUserId: string; take?: number }): Promise<{ orderId: string; orderCode: string; trangThaiDon: string; tongTien: number; taoLuc: Date; soDong: number }[]> {
  const ds = await db.order.findMany({
    where: { type: "ONLINE", createdById: input.parentUserId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.take ?? 20, 1), 100),
    select: { id: true, code: true, status: true, totalAmount: true, createdAt: true, _count: { select: { items: true } } },
  });
  return ds.map((o) => ({ orderId: o.id, orderCode: o.code, trangThaiDon: o.status, tongTien: o.totalAmount, taoLuc: o.createdAt, soDong: o._count.items }));
}

export type KetQuaHuyDon = { ok: true; daHuyTruocDo: boolean } | { ok: false; ma: "KHONG_TIM_THAY" | "DA_CO_TIEN" | "DA_CAP_QUYEN" | "SAI_TRANG_THAI"; thongBao: string };

/**
 * Phụ huynh tự HUỶ đơn online CHƯA có đồng nào: đơn → CANCELLED, phiếu thu → VOID, trả lượt dùng mã giảm giá. Có tiền (dù một phần) hoặc đã cấp quyền
 * ⇒ từ chối (hoàn tiền là việc của kế toán/quản trị, không phải nút của phụ huynh). Không bắn `order.voided` (các handler đó là của đơn offline).
 * Vì sao cần: một đơn bị bỏ dở giữ chỗ cặp (khoá × con) ⇒ `taoDonOnline` trả `DA_CO_DON_DANG_CHO` cho giỏ hàng trùng một phần.
 */
export async function huyDonOnlineChuaThanhToan(db: Db, input: { parentUserId: string; orderId: string; now: Date }): Promise<KetQuaHuyDon> {
  const cuaMinh = { id: input.orderId, type: "ONLINE" as const, createdById: input.parentUserId, deletedAt: null };
  // Kiểm SỞ HỮU trước khi lấy khoá: `orderId` do app gửi — không để người ngoài giữ khoá đơn nhà khác (cùng khoá với tiền vào). Vẫn đọc LẠI dưới khoá.
  if (!(await db.order.findFirst({ where: cuaMinh, select: { id: true } }))) return { ok: false, ma: "KHONG_TIM_THAY", thongBao: "Không tìm thấy đơn" };
  return db.$transaction(async (tx) => {
    // THỨ TỰ KHOÁ của một đơn (câu ĐẦU của giao dịch là khoá tư vấn theo đơn):
    //   1. `khoaDonTrongTx` — CÙNG khoá với tiền vào (`allocateToOrder`, `recordPayment`), hoàn tiền (`hoan-tien-online`, `chiHoanTien`) và đổi trạng thái đơn ở admin
    //      ⇒ huỷ không chạy chồng lên rót tiền/hoàn: tiền vào trước thì huỷ thấy tiền (DA_CO_TIEN); huỷ trước thì lượt rót đọc lại đơn dưới khoá, thấy đã huỷ ⇒ giữ giao dịch ở hàng chờ đối soát (`tien-ve-don-het-nhan.ts`).
    //   2. rồi mới tới khoá dòng do chính các phép ghi tự lấy: Order → PaymentRequest → ProductReservation → OrderItemFulfillment → Voucher.
    // KHÔNG `SELECT … FOR UPDATE` trên dòng Order: mức đó xung đột với FOR KEY SHARE mà mọi INSERT có khoá ngoại tới Order (vd `Payment`) tự lấy ⇒ vòng chờ (40P01, ca `[DUA-02]`).
    // `UPDATE status` chỉ lấy FOR NO KEY UPDATE, không chặn khoá ngoại. Cầu nối học cụ (`hoanTatHangSauThanhToan`) khoá fulfillment → sản phẩm → giữ kho, ngược chiều ở đây,
    // nhưng chỉ chạy khi đơn đã THU ĐỦ — mà đơn có tiền thì lượt huỷ dừng ở cổng tiền bên dưới, trước phép ghi đầu tiên.
    await khoaDonTrongTx(tx, input.orderId);
    const don = await tx.order.findFirst({ where: cuaMinh, select: { id: true, code: true, status: true } });
    if (!don) return { ok: false, ma: "KHONG_TIM_THAY", thongBao: "Không tìm thấy đơn" } as const;
    if (don.status === "CANCELLED") return { ok: true, daHuyTruocDo: true } as const;
    if (don.status !== "PENDING_PAYMENT") return { ok: false, ma: "SAI_TRANG_THAI", thongBao: "Đơn không còn ở trạng thái chờ thanh toán" } as const;
    if ((await tx.orderOnlineGrant.count({ where: { orderId: don.id, status: "GRANTED" } })) > 0) return { ok: false, ma: "DA_CAP_QUYEN", thongBao: "Đơn đã được cấp quyền học" } as const;
    // Có tiền (phân bổ vào phiếu hoặc khoản đã ghi) ⇒ không huỷ: tiền đã vào mà huỷ là mất dấu.
    const phieu = await tx.paymentRequest.findMany({ where: { orderId: don.id }, select: { id: true } });
    const phanBo = phieu.length ? await tx.paymentAllocation.count({ where: { paymentRequestId: { in: phieu.map((p) => p.id) } } }) : 0;
    if (phanBo > 0 || (await sumRecorded(don.id, tx)) > 0) return { ok: false, ma: "DA_CO_TIEN", thongBao: "Đơn đã có tiền thu — liên hệ nhân viên để được hoàn/xử lý" } as const;

    // PHÉP GHI ĐẦU TIÊN, có điều kiện: đường đổi trạng thái không giữ khoá đơn (vd chốt đơn sau commit) mà thắng thì dừng sạch, chưa ghi gì.
    const doi = await tx.order.updateMany({ where: { id: don.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });
    if (doi.count === 0) return { ok: false, ma: "SAI_TRANG_THAI", thongBao: "Đơn không còn ở trạng thái chờ thanh toán" } as const;
    await tx.orderStatusHistory.create({ data: { orderId: don.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", changedByUserId: input.parentUserId, changedByName: "Phụ huynh (tự huỷ)", reason: "Phụ huynh huỷ đơn khoá online chưa thanh toán" } });
    await tx.paymentRequest.updateMany({ where: { orderId: don.id, status: { in: ["PENDING", "PARTIAL"] } }, data: { status: "VOID" } });

    // V8.43 — đơn có học cụ: NHẢ giữ kho + đóng fulfillment trong CÙNG giao dịch huỷ (idempotent; không chạm dòng đã bán).
    const dongHang = await tx.orderItem.findMany({ where: { orderId: don.id, type: "PRODUCT" }, select: { id: true } });
    if (dongHang.length > 0) {
      await nhaGiuKho(tx, { orderItemIds: dongHang.map((d) => d.id), lyDo: "Phụ huynh huỷ đơn", now: input.now });
      await tx.orderItemFulfillment.updateMany({ where: { orderItemId: { in: dongHang.map((d) => d.id) }, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
    }

    // Trả lượt mã: xoá dấu đã dùng + giảm `usedCount` (không xuống dưới 0).
    const luot = await tx.voucherRedemption.findMany({ where: { orderId: don.id }, select: { id: true, voucherId: true } });
    for (const l of luot) {
      await tx.voucherRedemption.delete({ where: { id: l.id } });
      await tx.voucher.updateMany({ where: { id: l.voucherId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
    }
    await writeAudit({ tx, actor: { id: input.parentUserId, name: "Phụ huynh" }, module: "online-checkout", entityType: "Order", entityId: don.id, action: "CANCEL", newValues: { code: don.code, traLuotMa: luot.length }, orgUnitId: null });
    return { ok: true, daHuyTruocDo: false } as const;
  });
}
