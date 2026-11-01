// lib/entitlements/cap-tu-don.ts — TIỀN ĐÃ XÁC NHẬN ⇒ CẤP QUYỀN HỌC cho các dòng đơn SCOPE. DB thật.
//
// 🔴 MỘT điểm vào duy nhất: `xetCapQuyenHocChoDon(orderId, nguon, now)`. Chỉ `lib/entitlements/hich.ts` (vỏ KHÔNG BAO GIỜ NÉM)
// gọi nó; mọi đường tiền / bước Chuyển đổi đi qua vỏ đó — xem `docs/thu-hoc-phi-pham-vi/NOI-DUONG-TIEN.md`.
//
// HÀM TỰ TÍNH LẠI MỌI THỨ — không tin sự kiện gọi nó. Sự kiện chỉ là cái hích; "dòng này đã đủ tiền chưa" luôn được đọc
// lại DƯỚI KHOÁ ĐƠN. Nhờ vậy gọi bao nhiêu lần, từ đâu, theo thứ tự nào cũng ra cùng kết quả (idempotent), và một sự kiện
// đến trễ sau khi kế toán đã gỡ gắn thì thấy tiền đã mất và KHÔNG cấp.
//
// ── THỨ TỰ CỔNG (luật rollback + luật cờ TẮT = hành vi cũ nguyên văn) ────────────────────────────────────────────────
//   NGOÀI transaction, bằng kết nối gốc:
//     1. đọc đơn; không có dấu SCOPE nào trên bất kỳ dòng ⇒ DỪNG (đơn cũ không bao giờ có quyền học);
//     2. cơ sở của đơn → OrgUnit (chưa ánh xạ ⇒ DỪNG, KHÔNG đọc cờ);
//     3. hỏi cờ `billing.scopePurchaseEnabled` của cơ sở ⇒ tắt thì DỪNG.
//   Từ đây trở lên KHÔNG ghi gì: không quyền học, không AuditLog, không DomainEvent.
//   TRONG `db.$transaction` (chỉ dùng `tx`, tuyệt đối không `db.` — một kết nối thứ hai trong lúc transaction giữ kết nối đầu
//   là cách N lượt đồng thời treo nhau; xem [DVU-PIN-07]):
//     4. `khoaDonTrongTx` — CÙNG khoá advisory với mọi đường ghi tiền, TRƯỚC mọi lần đọc số tiền;
//     5. đọc dòng đơn + sổ `Payment` DƯỚI KHOÁ;
//     6. với từng dòng: đã có quyền học? → dấu có khớp tiền thật? → đủ tiền xác nhận? → biết học viên chưa? → cấp.
//   Thứ tự khoá: ĐƠN trước, rồi (bên trong `capQuyenHocTrongTx`) dòng quyền học. Đừng đảo.
//
// ── HAI CHẾ ĐỘ (PR hàng đợi quyền học) ───────────────────────────────────────────────────────────────────────────────
//   `cheDo` BẮT BUỘC (luật 7). `"CAP"` = hành vi từ trước tới nay (đường tiền hích: cấp quyền khi đủ điều kiện). `"CHI_GHI_NHAN"` = cron đối
//   soát: ĐI CÙNG MỘT ĐƯỜNG, cùng định nghĩa "đủ tiền", cùng khoá, cùng vòng đời dòng xử lý — nhưng ở chỗ sẽ gọi `capQuyenHocTrongTx` thì GHI MỘT DÒNG
//   THIEU_QUYEN_HOC rồi đi tiếp. Nhờ vậy cron KHÔNG có bản sao thứ hai của luật "đủ tiền / có học viên chưa" (hai công thức = lớp lỗi CLAUDE.md đã trả giá),
//   và không thể cấp / sửa / thu hồi quyền học nào. Cổng cấu trúc: `[HD-W*]` canh nhánh `CHI_GHI_NHAN` `continue` TRƯỚC lời cấp.
//
// ── "ĐỦ TIỀN" ────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Số tiền: `tienXacNhanTheoDong` (tien-xac-nhan.ts). Vị từ: `dongDuTien` với dung sai 0 — thiếu MỘT đồng là chưa đủ.
//   Cả hai trục `daVe`/`daThu` của `dongDuTien` nhận CÙNG con số đó: chủ dự án đã chốt một định nghĩa duy nhất của "xác nhận
//   thành công" (Q2/Q3), nên khoá cài đặt `enrollment.entitlementTrigger` KHÔNG được đọc ở đường này.
//
// ── DẤU SCOPE KHÔNG PHẢI CHỨNG CHỈ ───────────────────────────────────────────────────────────────────────────────────
//   `docPhamViDong` chỉ kiểm hình dạng. `OrderItem.metadata` đi vào từ payload client, nên trước khi cấp phải đối chiếu dấu
//   với số tiền thật của chính dòng: `unitPrice × quantity − discountAmount` VÀ `totalPrice − discountAmount` đều phải bằng
//   `phamVi.thanhTien`. Lệch ⇒ KHÔNG cấp, báo `dauKhongKhop`.
//
// ── CHƯA CẤP KHI ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   · chưa biết học viên (khách mới chưa Chuyển đổi: `OrderItem.studentId` và `enrollment.studentId` đều NULL, con lead chưa
//     có hồ sơ hoặc khớp nhiều hồ sơ) — KHÔNG ném, KHÔNG đoán: trả vào `chuaCoHocVien` VÀ ghi một dòng CHỜ bền
//     (`StudyEntitlementXuLy`, loại CHO_CHUYEN_DOI, MỘT dòng cho mỗi dòng đơn, lật mở/đóng chứ không chèn thêm). Sau khi có
//     học viên, gọi lại sẽ cấp đúng một lần và ĐÓNG dòng chờ CÙNG transaction. Tiền không còn đủ ⇒ dòng chờ đóng HUY;
//   · MỌI phép ghi dòng chờ nằm SAU khoá đơn, bằng `tx`, và mang `orgUnitId` đã tính TRƯỚC transaction ([DVU-PIN-03]);
//   · đơn nhiều dòng mà tiền không gắn được dòng nào (`Payment.orderItemId` NULL) — KHÔNG đoán, trả vào `chuaXacDinhDuocDong`;
//   · dòng từng có quyền học đã bị VOIDED — không "hồi sinh" bằng một sự kiện tiền về sau đó (người huỷ có lý do của họ).
//   Quyền học sinh ra ở AWAITING_PLACEMENT, KHÔNG tạo `StudyEntitlementUsage`: thanh toán không tiêu thụ buổi nào.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { laKhoanDaXacNhan } from "@/lib/finance/debt";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { docPhamViDong, laDonPhamVi, tienThucDongPhamVi, type PhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import type { KetQuaGia } from "@/lib/pricing/tinh-gia-theo-moc";
import { hanhDongChoChuyenDoi, type HanhDongCho, type TinhHuongCho } from "./cho-chuyen-doi";
import { docDauVanDaQuyet, payloadSauMoLai } from "./da-quyet";
import { daTieuThuBuoi } from "./da-tieu-thu";
import { capQuyenHocTrongTx } from "./dich-vu";
import { dongDuTien } from "./dong-du-tien";
import { laThuHocPhiTheoPhamViBat } from "./feature";
import { chonHocVienChoDong, type KetQuaHocVienCuaDong } from "./hoc-vien-cua-dong";
import { khoaNganHangCuaGiaoDich, khoaNganHangTuNote, tienXacNhanTheoDong, type KhoanTien } from "./tien-xac-nhan";

/** Ai hích. Chỉ để ghi nhật ký/audit; KHÔNG đổi luật. */
export type NguonCapQuyenHoc =
  | "PHIEU_GOP" // sự kiện phieu-gop.da-chia
  | "KE_TOAN_XAC_NHAN" // sự kiện payment.confirmed
  | "WEBHOOK_CU" // allocateToOrder (webhook đời cũ + đối soát tay /bien-dong-so-du)
  | "GAN_TAY" // action gắn / tách / chuyển / gỡ tiền theo con
  | "CHUYEN_DOI" // sau bước Chuyển đổi: khách mới vừa có học viên
  | "DIEU_CHINH" // adjustPayment: bút toán điều chỉnh đổi số tiền xác nhận
  | "TIEN_BI_TU_CHOI" // sự kiện payment.rejected (chiều ngược)
  | "TIEN_BI_HOAN" // sự kiện payment.refunded (chiều ngược)
  | "DON_BI_LOAI" // sự kiện order.voided: đơn huỷ / hoàn (chiều ngược)
  | "DUNG_HOC" // action dừng học một bé: tiền chuyển ra khỏi dòng (chiều ngược)
  | "DOI_SOAT_DEM" // cron quyen-hoc-doi-soat (chỉ ở chế độ CHI_GHI_NHAN)
  | "HANG_DOI_THU_LAI"; // nút "Thử cấp lại" ở hàng đợi quyền học (người có entitlements:manage)

/** `CAP`: đường tiền hích — cấp quyền khi đủ điều kiện. `CHI_GHI_NHAN`: cron đối soát — mọi thứ như `CAP` NGOẠI TRỪ không bao giờ cấp. */
export type CheDoXetCap = "CAP" | "CHI_GHI_NHAN";

/**
 * Chế độ CHI_GHI_NHAN: khoản tiền vừa xác nhận chưa tới ngưỡng này thì chưa kết luận "lượt hích bị lỡ" — dispatcher sự kiện chạy mỗi phút, handler cấp quyền
 * chạy SAU commit nên sẽ có vài phút một khoản đã xác nhận mà quyền học chưa kịp ra đời. Quá ngưỡng mà vẫn chưa có thì mới là lỡ.
 */
export const DO_TRE_CHO_HICH_MS = 30 * 60_000;

const LY_DO_THIEU_QUYEN =
  "Tiền xác nhận đã đủ và đã biết học viên nhưng dòng CHƯA có quyền học và không có dòng chờ nào — lượt cấp quyền khi tiền về đã bị lỡ. Người có quyền bấm 'Thử cấp lại'.";

export type LyDoBoQua = "KHONG_CO_DON" | "KHONG_PHAI_DON_PHAM_VI" | "DON_DA_HUY" | "KHONG_CO_CO_SO" | "CO_SO_DOI" | "CO_TAT";

export interface DongQuyenHoc {
  readonly orderItemId: string;
  readonly quyenHocId: string;
}

export interface KetQuaCapTuDon {
  readonly nguon: NguonCapQuyenHoc;
  /** Khác `null` ⇒ dừng trước mọi phép ghi; các mảng dưới đều rỗng. */
  readonly boQua: LyDoBoQua | null;
  readonly daCap: readonly DongQuyenHoc[];
  /** Đã có quyền học còn hiệu lực — không ghi gì. */
  readonly daCo: readonly DongQuyenHoc[];
  readonly chuaDuTien: readonly { readonly orderItemId: string; readonly conThieu: number }[];
  /** Đủ tiền nhưng chưa xác định được học viên (khách mới chưa Chuyển đổi). Mỗi dòng đã có một dòng CHỜ CHO_CHUYEN_DOI. */
  readonly chuaCoHocVien: readonly string[];
  /** Dòng CHỜ vừa tạo / mở lại / đổi lý do ở lượt này (gọi lại không đổi gì ⇒ không có mặt). */
  readonly choChuyenDoi: readonly { readonly orderItemId: string; readonly lyDo: string }[];
  /** Dòng CHỜ vừa đóng ở lượt này: DA_XU_LY (đã cấp quyền) hoặc HUY (tiền không còn đủ / dòng không còn hợp lệ). */
  readonly daDongCho: readonly { readonly orderItemId: string; readonly trangThai: "DA_XU_LY" | "HUY" }[];
  /**
   * CHIỀU NGƯỢC: dòng xử lý vừa mở / mở lại / đổi lý do ở lượt này vì tiền đã cấp quyền học nay THIẾU (hoặc đơn bị huỷ/hoàn).
   * `CAN_THU_HOI` = chưa buổi nào tiêu thụ; `TREO_DUYET_TAY` = đã có buổi tiêu thụ. KHÔNG BAO GIỜ xoá / huỷ quyền học.
   */
  readonly chieuNguoc: readonly { readonly orderItemId: string; readonly loai: "CAN_THU_HOI" | "TREO_DUYET_TAY"; readonly lyDo: string }[];
  /** Dòng xử lý chiều ngược vừa đóng (HUY: tiền đã đủ lại / đã chuyển sang loại kia / quyền học đã bị huỷ). */
  readonly daDongChieuNguoc: readonly { readonly orderItemId: string; readonly loai: "CAN_THU_HOI" | "TREO_DUYET_TAY"; readonly trangThai: "DA_XU_LY" | "HUY" }[];
  /** Tiền mơ hồ (đơn nhiều dòng, khoản không gắn dòng) nên không kết luận được. */
  readonly chuaXacDinhDuocDong: readonly string[];
  /** Dấu SCOPE không khớp số tiền thật của dòng, hoặc dòng không còn ACTIVE, hoặc thiếu dữ liệu để cấp. */
  readonly dauKhongKhop: readonly string[];
  /** Từng có quyền học nhưng đã VOIDED. */
  readonly daBiHuy: readonly string[];
  /** Chỉ CHI_GHI_NHAN: dòng THIEU_QUYEN_HOC vừa tạo / mở lại / đổi lý do (đủ tiền + có học viên + chưa có quyền học + không có dòng chờ). */
  readonly thieuQuyen: readonly { readonly orderItemId: string; readonly lyDo: string }[];
  /** Dòng THIEU_QUYEN_HOC vừa đóng (DA_XU_LY: đã có quyền học; HUY: điều kiện không còn). */
  readonly daDongThieuQuyen: readonly { readonly orderItemId: string; readonly trangThai: "DA_XU_LY" | "HUY" }[];
  /** Dòng xử lý ĐANG MỞ mà điều kiện vẫn như cũ — bỏ qua, không ghi gì (trùng). Cho báo cáo cron. */
  readonly giuNguyen: readonly { readonly orderItemId: string; readonly loai: "CHO_CHUYEN_DOI" | "THIEU_QUYEN_HOC" | "CAN_THU_HOI" | "TREO_DUYET_TAY" }[];
}

const RONG = (nguon: NguonCapQuyenHoc, boQua: LyDoBoQua | null): KetQuaCapTuDon => ({
  nguon,
  boQua,
  daCap: [],
  daCo: [],
  chuaDuTien: [],
  chuaCoHocVien: [],
  choChuyenDoi: [],
  daDongCho: [],
  chieuNguoc: [],
  daDongChieuNguoc: [],
  chuaXacDinhDuocDong: [],
  dauKhongKhop: [],
  daBiHuy: [],
  thieuQuyen: [],
  daDongThieuQuyen: [],
  giuNguyen: [],
});

const DON_DA_HUY = ["CANCELLED", "REFUNDED"] as const;

const laSo = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * `KetQuaGia` của quyền học dựng từ dấu SCOPE. Thiếu trường nào của snapshot ⇒ `null` (không bịa số 0).
 *
 * `giamThem` [20/10/2026] = khoản Sale thêm trên dòng (`OrderItem.discountAmount`): cộng vào `giamGia` và trừ khỏi `thanhTien` để quyền học ghi
 * `netAmount` = số tiền khách THỰC trả và giữ đẳng thức `niemYet − giamGia = thanhTien` mà `kiemDauVaoCap` đòi. BẮT BUỘC (luật 7): quên truyền là
 * quyền học ghi giá chính sách trong khi khách trả ít hơn — lệch đúng bằng khoản thêm và `doi-soat-lech` bắt `QUYEN_LECH_SO_TIEN`.
 */
function ketQuaGiaTuDau(pv: PhamViDong, giamThem: number): KetQuaGia | null {
  const s: Record<string, unknown> = pv.pricingSnapshot as unknown as Record<string, unknown>;
  const { phanTramNen, phanTramCongThem, phanTramApDung, biCatTran } = s;
  if (!laSo(phanTramNen) || !laSo(phanTramCongThem) || !laSo(phanTramApDung) || typeof biCatTran !== "boolean") return null;
  return {
    loai: pv.loaiMua,
    soBuoi: pv.soBuoiMua,
    niemYet: pv.niemYet,
    phanTramNen,
    phanTramCongThem,
    phanTramApDung,
    biCatTran,
    giamGia: pv.giamGia + giamThem,
    thanhTien: pv.thanhTien - giamThem,
  };
}

/**
 * Khoá marker → Σ tiền giao dịch ngân hàng MATCHED đã phân bổ vào các phiếu thu CỦA ĐƠN NÀY.
 * Chỉ tra khi có khoản mang marker ngân hàng (đa số đơn tiền mặt: không tra gì thêm).
 */
async function docNganHangThat(tx: Prisma.TransactionClient, orderId: string, khoan: readonly KhoanTien[]): Promise<Map<string, number>> {
  const maTheoNhanh: { providerTxnIds: string[]; bankTransactionIds: string[] } = { providerTxnIds: [], bankTransactionIds: [] };
  for (const k of khoan) {
    const khoa = khoaNganHangTuNote(k.note);
    if (khoa === null) continue;
    const i = khoa.indexOf("|");
    const [loai, ma] = [khoa.slice(0, i), khoa.slice(i + 1)];
    (loai === "gan-tay" ? maTheoNhanh.bankTransactionIds : maTheoNhanh.providerTxnIds).push(ma);
  }
  const ketQua = new Map<string, number>();
  const dieuKien: Prisma.BankTransactionWhereInput[] = [];
  if (maTheoNhanh.providerTxnIds.length > 0) dieuKien.push({ providerTxnId: { in: maTheoNhanh.providerTxnIds } });
  if (maTheoNhanh.bankTransactionIds.length > 0) dieuKien.push({ id: { in: maTheoNhanh.bankTransactionIds } });
  if (dieuKien.length === 0) return ketQua;

  const giaoDich = await tx.bankTransaction.findMany({
    where: { status: "MATCHED", OR: dieuKien },
    select: {
      id: true,
      provider: true,
      providerTxnId: true,
      allocations: { where: { paymentRequest: { orderId } }, select: { amount: true } },
    },
  });
  for (const g of giaoDich) {
    const daPhanBo = g.allocations.reduce((s, a) => s + a.amount, 0);
    if (daPhanBo <= 0) continue;
    for (const khoa of khoaNganHangCuaGiaoDich(g)) ketQua.set(khoa, daPhanBo);
  }
  return ketQua;
}

/**
 * Học viên của MỘT dòng đơn, đọc bằng `tx` (đã giữ khoá đơn). Chỉ tra cầu nối con lead khi dòng CHƯA có học viên trực tiếp:
 * đa số dòng (khách cũ, đã Chuyển đổi) không tốn thêm câu nào. Quyết định chọn nằm ở hàm thuần `chonHocVienChoDong`.
 */
async function timHocVienChoDong(
  tx: Prisma.TransactionClient,
  d: { studentId: string | null; enrollment: { studentId: string } | null; metadata: unknown },
  courseId: string,
): Promise<KetQuaHocVienCuaDong> {
  const leadChildId = docConLeadTuMetadata(d.metadata);
  const coTrucTiep = Boolean(d.studentId ?? d.enrollment?.studentId);
  let tuGhiDanh: string[] = [];
  let tuHoSo: string[] = [];
  if (!coTrucTiep && leadChildId) {
    const [gd, hs] = await Promise.all([
      tx.enrollment.findMany({ where: { leadChildId, courseId, deletedAt: null }, select: { studentId: true }, take: 10 }),
      tx.student.findMany({ where: { leadChildId, deletedAt: null }, select: { id: true }, take: 10 }),
    ]);
    tuGhiDanh = gd.map((g) => g.studentId);
    tuHoSo = hs.map((h) => h.id);
  }
  return chonHocVienChoDong({
    studentIdDong: d.studentId,
    studentIdGhiDanhCuaDong: d.enrollment?.studentId ?? null,
    leadChildId,
    hocVienTuGhiDanhCuaCon: tuGhiDanh,
    hocVienTuHoSoCuaCon: tuHoSo,
  });
}

export async function xetCapQuyenHocChoDon(orderId: string, nguon: NguonCapQuyenHoc, now: Date, cheDo: CheDoXetCap): Promise<KetQuaCapTuDon> {
  // ── 1 · DẤU SCOPE (đọc ngoài transaction) ────────────────────────────────────────────────────────────────────────
  const don = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, centerId: true, items: { select: { metadata: true } } },
  });
  if (!don) return RONG(nguon, "KHONG_CO_DON");
  if (!laDonPhamVi(don.items)) return RONG(nguon, "KHONG_PHAI_DON_PHAM_VI");
  // Đơn đã huỷ/hoàn KHÔNG dừng ở đây: quyền học đã cấp cho đơn đó cần được ĐÁNH DẤU (chiều ngược) — việc ghi nằm sau cờ, dưới khoá.

  // ── 2 · CƠ SỞ → ORGUNIT (cờ khoá theo OrgUnit; chưa ánh xạ thì không đọc cờ — cùng luật ap-dung.ts) ──────────────
  const centerId = don.centerId;
  if (!centerId) return RONG(nguon, "KHONG_CO_CO_SO");
  const orgUnitId = await orgUnitIdForCenter(centerId);
  if (!orgUnitId) return RONG(nguon, "KHONG_CO_CO_SO");

  // ── 3 · CỜ ───────────────────────────────────────────────────────────────────────────────────────────────────────
  if (!(await laThuHocPhiTheoPhamViBat(orgUnitId))) return RONG(nguon, "CO_TAT");

  // ── 4+ · TRONG TRANSACTION, DƯỚI KHOÁ ĐƠN ────────────────────────────────────────────────────────────────────────
  return db.$transaction(
    async (tx): Promise<KetQuaCapTuDon> => {
      await khoaDonTrongTx(tx, orderId);

      const hienTai = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, centerId: true, hocBong100: true } });
      if (!hienTai) return RONG(nguon, "KHONG_CO_DON");
      if (hienTai.centerId !== centerId) return RONG(nguon, "CO_SO_DOI");
      const donHuy = (DON_DA_HUY as readonly string[]).includes(hienTai.status);
      const hocBong100 = hienTai.hocBong100;

      const [dong, khoanTho] = await Promise.all([
        tx.orderItem.findMany({
          where: { orderId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            status: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            discountAmount: true,
            metadata: true,
            studentId: true,
            enrollment: { select: { studentId: true } },
          },
        }),
        tx.payment.findMany({
          where: { orderId, deletedAt: null },
          select: { id: true, orderItemId: true, amount: true, adjustmentOfId: true, accountantStatus: true, deletedAt: true, note: true, updatedAt: true },
        }),
      ]);

      const khoan: KhoanTien[] = khoanTho.map((p) => ({
        id: p.id,
        orderItemId: p.orderItemId,
        amount: p.amount,
        adjustmentOfId: p.adjustmentOfId,
        accountantStatus: p.accountantStatus,
        daXacNhan: laKhoanDaXacNhan(p),
        note: p.note,
      }));
      // Marker trong `note` là chuỗi tự do (Sale gõ được) — chỉ tin khi có giao dịch ngân hàng THẬT chống lưng. Đọc DƯỚI KHOÁ, bằng `tx`.
      const tien = tienXacNhanTheoDong({
        dongIds: dong.map((d) => d.id),
        khoan,
        nganHangThat: await docNganHangThat(tx, orderId, khoan),
      });

      const quyenCu = await tx.studyEntitlement.findMany({
        where: { orderItemId: { in: dong.map((d) => d.id) } },
        select: { id: true, orderItemId: true, status: true, studentId: true, consumedSessions: true },
      });
      // Hàng đợi xử lý (CHO_CHUYEN_DOI + hai loại chiều ngược) — đọc SAU khoá đơn, bằng `tx`. Mọi phép ghi nó cũng nằm dưới khoá này.
      const xuLyCu = await tx.studyEntitlementXuLy.findMany({
        where: { orderItemId: { in: dong.map((d) => d.id) } },
        select: { id: true, orderItemId: true, loai: true, trangThai: true, lyDo: true, payload: true },
      });

      const daCap: DongQuyenHoc[] = [];
      const daCo: DongQuyenHoc[] = [];
      const chuaDuTien: { orderItemId: string; conThieu: number }[] = [];
      const chuaCoHocVien: string[] = [];
      const choChuyenDoi: { orderItemId: string; lyDo: string }[] = [];
      const daDongCho: { orderItemId: string; trangThai: "DA_XU_LY" | "HUY" }[] = [];
      const chieuNguoc: { orderItemId: string; loai: "CAN_THU_HOI" | "TREO_DUYET_TAY"; lyDo: string }[] = [];
      const daDongChieuNguoc: { orderItemId: string; loai: "CAN_THU_HOI" | "TREO_DUYET_TAY"; trangThai: "DA_XU_LY" | "HUY" }[] = [];
      const chuaXacDinhDuocDong: string[] = [];
      const dauKhongKhop: string[] = [];
      const daBiHuy: string[] = [];
      const thieuQuyen: { orderItemId: string; lyDo: string }[] = [];
      const daDongThieuQuyen: { orderItemId: string; trangThai: "DA_XU_LY" | "HUY" }[] = [];
      const giuNguyen: { orderItemId: string; loai: "CHO_CHUYEN_DOI" | "THIEU_QUYEN_HOC" | "CAN_THU_HOI" | "TREO_DUYET_TAY" }[] = [];
      const moiNhatCuaTien = khoanTho.reduce((m, p) => Math.max(m, p.updatedAt.getTime()), 0);
      const actor = { id: null, name: `Hệ thống — cấp quyền học khi tiền về (${nguon})` };

      type LoaiXuLy = "CHO_CHUYEN_DOI" | "CAN_THU_HOI" | "TREO_DUYET_TAY" | "THIEU_QUYEN_HOC";
      type LoaiChieuNguoc = "CAN_THU_HOI" | "TREO_DUYET_TAY";
      /**
       * Thi hành lời khuyên của `hanhDongChoChuyenDoi` lên dòng xử lý (orderItemId, loai). Không gọi `db.`; `orgUnitId` đã tính trước tx.
       * Một dòng cho mỗi (orderItemId, loai): mở lại thì lật trạng thái, KHÔNG chèn dòng mới.
       */
      const xuLy = async (
        loai: LoaiXuLy,
        orderItemId: string,
        tinhHuong: TinhHuongCho,
        ngCanh: { courseId: string | null; leadChildId: string | null; studentId?: string | null; entitlementId?: string | null },
      ): Promise<void> => {
        const ghiNhan = (lyDo: string): void => {
          if (loai === "CHO_CHUYEN_DOI") choChuyenDoi.push({ orderItemId, lyDo });
          else if (loai === "THIEU_QUYEN_HOC") thieuQuyen.push({ orderItemId, lyDo });
          else chieuNguoc.push({ orderItemId, loai, lyDo });
        };
        const cho = xuLyCu.find((c) => c.orderItemId === orderItemId && c.loai === loai) ?? null;
        // `daQuyetDauVan`: người xử lý đã đóng dòng này ở ĐÚNG điều kiện này ⇒ hàm thuần trả KHONG_LAM_GI (không mở lại mỗi lượt hích / mỗi đêm).
        const viec: HanhDongCho = hanhDongChoChuyenDoi(
          cho ? { trangThai: cho.trangThai, lyDo: cho.lyDo, daQuyetDauVan: docDauVanDaQuyet(cho.payload) } : null,
          tinhHuong,
        );
        if (viec.viec === "KHONG_LAM_GI") {
          if (cho?.trangThai === "OPEN" && tinhHuong.kieu === "PHAI_CHO") giuNguyen.push({ orderItemId, loai });
          return;
        }
        if (viec.viec === "TAO_MOI") {
          await tx.studyEntitlementXuLy.create({
            data: {
              loai,
              trangThai: "OPEN",
              orderId,
              orderItemId,
              courseId: ngCanh.courseId,
              leadChildId: ngCanh.leadChildId,
              studentId: ngCanh.studentId ?? null,
              entitlementId: ngCanh.entitlementId ?? null,
              centerId,
              orgUnitId,
              lyDo: viec.lyDo,
            },
          });
          ghiNhan(viec.lyDo);
          return;
        }
        if (!cho) return; // các việc còn lại đều có dòng hiện có (hàm thuần bảo đảm); chặn kiểu cho tsc
        if (viec.viec === "MO_LAI") {
          await tx.studyEntitlementXuLy.update({
            where: { id: cho.id },
            data: {
              trangThai: "OPEN",
              lyDo: viec.lyDo,
              resolvedAt: null,
              resolvedNote: null,
              studentId: ngCanh.studentId ?? null,
              entitlementId: ngCanh.entitlementId ?? null,
              // Mở lại vì điều kiện ĐỔI ⇒ quyết định cũ của người không còn áp (và một dòng do máy đóng về sau không được thừa hưởng nó).
              ...payloadSauMoLai(cho.payload),
            },
          });
          ghiNhan(viec.lyDo);
        } else if (viec.viec === "CAP_NHAT_LY_DO") {
          await tx.studyEntitlementXuLy.update({ where: { id: cho.id }, data: { lyDo: viec.lyDo } });
          ghiNhan(viec.lyDo);
        } else {
          await tx.studyEntitlementXuLy.update({
            where: { id: cho.id },
            data: {
              trangThai: viec.trangThai,
              resolvedAt: now,
              resolvedNote: viec.lyDo,
              studentId: ngCanh.studentId ?? null,
              entitlementId: ngCanh.entitlementId ?? null,
            },
          });
          if (loai === "CHO_CHUYEN_DOI") daDongCho.push({ orderItemId, trangThai: viec.trangThai });
          else if (loai === "THIEU_QUYEN_HOC") daDongThieuQuyen.push({ orderItemId, trangThai: viec.trangThai });
          else daDongChieuNguoc.push({ orderItemId, loai, trangThai: viec.trangThai });
        }
      };
      const xuLyCho = (orderItemId: string, tinhHuong: TinhHuongCho, ngCanh: Parameters<typeof xuLy>[3]): Promise<void> =>
        xuLy("CHO_CHUYEN_DOI", orderItemId, tinhHuong, ngCanh);

      /** Số tiền xác nhận của một dòng so với thành tiền. Khoản mơ hồ (âm lạc dòng / không gắn được dòng) ⇒ MO_HO, KHÔNG kết luận. */
      const danhGiaTien = (orderItemId: string, phaiThu: number): { loai: "DU" } | { loai: "THIEU"; conThieu: number } | { loai: "MO_HO" } => {
        // HỌC BỔNG 100% [chủ dự án chốt 28/10/2026: "đơn học bổng cũng làm tương tự luôn"]: Quản trị tối cao đã đánh dấu đơn (`Order.hocBong100`, lý do + audit)
        // ⇒ MỌI dòng của đơn coi là đủ điều kiện cấp quyền học KHÔNG cần tiền. TUYỆT ĐỐI không tạo `Payment` giả (làm sai công nợ / hoa hồng / đối soát) — nên
        // MỘT hàm này phải trả "đủ" cho CẢ đường cấp lẫn đường chiều ngược (cùng hàm; trả "thiếu" ở chiều ngược là đánh dấu thu hồi một quyền học vừa cấp đúng luật).
        if (hocBong100) return { loai: "DU" };
        const daXacNhan = Math.max(0, tien.theoDong.get(orderItemId) ?? 0);
        if (tien.chuaGanDong < 0) return { loai: "MO_HO" };
        const du = dongDuTien(
          { loai: "COURSE_ENROLLMENT", phaiThu, daVe: daXacNhan, daThu: daXacNhan },
          { truc: "ACCOUNTANT_CONFIRMED", dungSai: 0, khiPhaiThuBangKhong: "KHONG_DU" },
        );
        if (du.du) return { loai: "DU" };
        return tien.chuaGanDong > 0 ? { loai: "MO_HO" } : { loai: "THIEU", conThieu: du.conThieu };
      };

      /**
       * CHIỀU NGƯỢC — quyền học ĐÃ cấp, tiền nay thiếu (đảo / hoàn / từ chối / điều chỉnh giảm) hoặc đơn bị huỷ.
       * KHÔNG xoá, KHÔNG huỷ quyền học: chỉ ĐÁNH DẤU để người có quyền quyết. Chưa buổi nào tiêu thụ ⇒ CAN_THU_HOI; đã có buổi ⇒ TREO_DUYET_TAY.
       * `lyDoThieu === null` ⇒ tiền đã đủ lại ⇒ đóng cả hai loại. Mỗi (dòng, loại) một dòng; đổi loại thì đóng loại kia.
       */
      const danhDauChieuNguoc = async (
        q: { id: string; studentId: string; consumedSessions: number },
        lyDoThieu: string | null,
        ngCanh: { courseId: string | null; leadChildId: string | null },
        orderItemId: string,
      ): Promise<void> => {
        const nc = { ...ngCanh, studentId: q.studentId, entitlementId: q.id };
        if (lyDoThieu === null) {
          const dongLai: TinhHuongCho = { kieu: "KHONG_CON_HOP_LE", lyDo: "Tiền xác nhận đã đủ lại — không còn gì phải xử lý." };
          await xuLy("CAN_THU_HOI", orderItemId, dongLai, nc);
          await xuLy("TREO_DUYET_TAY", orderItemId, dongLai, nc);
          return;
        }
        const daHoc = await daTieuThuBuoi(tx, q.id, q.consumedSessions);
        const can: LoaiChieuNguoc = daHoc ? "TREO_DUYET_TAY" : "CAN_THU_HOI";
        const kia: LoaiChieuNguoc = daHoc ? "CAN_THU_HOI" : "TREO_DUYET_TAY";
        const lyDo = daHoc
          ? `${lyDoThieu} Quyền học ĐÃ có buổi tiêu thụ — treo chờ người có quyền duyệt tay (không tự thu hồi).`
          : `${lyDoThieu} Quyền học CHƯA tiêu thụ buổi nào — cần thu hồi.`;
        await xuLy(can, orderItemId, { kieu: "PHAI_CHO", lyDo }, nc);
        await xuLy(kia, orderItemId, { kieu: "KHONG_CON_HOP_LE", lyDo: `Đã chuyển sang ${can} theo số buổi tiêu thụ hiện tại.` }, nc);
      };

      for (const d of dong) {
        const pv = d.type === "COURSE_ENROLLMENT" ? docPhamViDong(d.metadata) : null;
        if (!pv) continue; // không phải dòng SCOPE: đường cũ, không liên quan

        const hinhThuc = docHinhThucLop(d.metadata);
        const ngCanh = { courseId: hinhThuc.courseId, leadChildId: docConLeadTuMetadata(d.metadata) };
        // Tiền THỰC của dòng = giá chính sách − khoản Sale thêm [20/10/2026]. `null` = dòng không còn nhất quán về tiền (xem `tienThucDongPhamVi`).
        const tienThuc = tienThucDongPhamVi(pv, d);
        const phaiThuDong = tienThuc?.thanhTienThuc ?? pv.thanhTien;
        /** Đóng dòng THIEU_QUYEN_HOC (nếu đang mở) vì điều kiện của nó không còn. Dòng đang đóng ⇒ không làm gì. */
        const huyThieu = (lyDo: string, nc: Parameters<typeof xuLy>[3] = ngCanh): Promise<void> =>
          xuLy("THIEU_QUYEN_HOC", d.id, { kieu: "KHONG_CON_HOP_LE", lyDo }, nc);

        // a · đã có quyền học còn hiệu lực ⇒ không đụng; chỉ toàn VOIDED ⇒ không hồi sinh
        const cuaDong = quyenCu.filter((q) => q.orderItemId === d.id);
        const conSong = cuaDong.find((q) => q.status !== "VOIDED");

        // Đơn đã huỷ/hoàn: KHÔNG cấp, KHÔNG chờ. Quyền học đã cấp ⇒ đánh dấu chiều ngược; dòng CHỜ đang mở ⇒ đóng HUY.
        if (donHuy) {
          if (conSong) {
            await danhDauChieuNguoc(conSong, `Đơn đã ${hienTai.status === "REFUNDED" ? "hoàn tiền" : "huỷ"}.`, ngCanh, d.id);
          } else {
            await xuLyCho(d.id, { kieu: "KHONG_CON_HOP_LE", lyDo: "Đơn đã huỷ/hoàn — không còn gì để chờ." }, ngCanh);
          }
          await huyThieu("Đơn đã huỷ/hoàn — không còn thiếu quyền học.");
          continue;
        }

        if (conSong) {
          daCo.push({ orderItemId: d.id, quyenHocId: conSong.id });
          await xuLyCho(d.id, { kieu: "DA_CO_QUYEN" }, { ...ngCanh, studentId: conSong.studentId, entitlementId: conSong.id });
          await xuLy("THIEU_QUYEN_HOC", d.id, { kieu: "DA_CO_QUYEN" }, { ...ngCanh, studentId: conSong.studentId, entitlementId: conSong.id });
          // Chiều ngược: tiền nay còn đủ không? Mơ hồ ⇒ KHÔNG đổi gì (không kết luận khi không chứng minh được).
          const dg = danhGiaTien(d.id, phaiThuDong);
          if (dg.loai === "DU") await danhDauChieuNguoc(conSong, null, ngCanh, d.id);
          else if (dg.loai === "THIEU") await danhDauChieuNguoc(conSong, `Tiền xác nhận của dòng không còn đủ (thiếu ${dg.conThieu}đ).`, ngCanh, d.id);
          continue;
        }
        if (cuaDong.length > 0) {
          daBiHuy.push(d.id);
          await xuLyCho(d.id, { kieu: "KHONG_CON_HOP_LE", lyDo: "Quyền học của dòng đã bị huỷ — không còn gì để chờ." }, ngCanh);
          await huyThieu("Quyền học của dòng đã bị huỷ — không còn thiếu quyền học.");
          continue;
        }

        // b · dấu SCOPE phải khớp số tiền thật của chính dòng
        const gia = tienThuc ? ketQuaGiaTuDau(pv, tienThuc.giamThem) : null;
        const khop =
          d.status === "ACTIVE" &&
          hinhThuc.coachFormat === "GROUP" &&
          hinhThuc.courseId !== null &&
          gia !== null &&
          tienThuc !== null;
        if (!khop || !gia || !hinhThuc.courseId) {
          dauKhongKhop.push(d.id);
          await xuLyCho(d.id, { kieu: "KHONG_CON_HOP_LE", lyDo: "Dấu SCOPE không khớp số tiền thật của dòng, hoặc dòng không còn hiệu lực." }, ngCanh);
          await huyThieu("Dấu SCOPE không khớp số tiền thật của dòng, hoặc dòng không còn hiệu lực.");
          continue;
        }

        // c · đủ tiền xác nhận chưa (dưới khoá). Khoản âm không gắn được dòng nào ⇒ không chứng minh được dòng này còn đủ.
        const dg = danhGiaTien(d.id, phaiThuDong);
        if (dg.loai === "MO_HO") {
          chuaXacDinhDuocDong.push(d.id);
          continue;
        }
        if (dg.loai === "THIEU") {
          chuaDuTien.push({ orderItemId: d.id, conThieu: dg.conThieu });
          // Tiền KHÔNG còn đủ (bị đảo / gỡ gắn / hoàn) ⇒ lời "đã thu đủ, chờ Chuyển đổi" không còn đúng. Mơ hồ (nhánh trên) thì GIỮ.
          await xuLyCho(d.id, { kieu: "KHONG_CON_HOP_LE", lyDo: `Tiền xác nhận không còn đủ cho dòng (còn thiếu ${dg.conThieu}đ).` }, ngCanh);
          await huyThieu(`Tiền xác nhận không còn đủ cho dòng (còn thiếu ${dg.conThieu}đ).`);
          continue;
        }

        // d · biết học viên chưa. Không biết / mơ hồ ⇒ KHÔNG cấp, ghi dòng CHỜ (idempotent) — không ném, không đoán.
        const hv = await timHocVienChoDong(tx, d, hinhThuc.courseId);
        if (hv.kieu !== "CO") {
          chuaCoHocVien.push(d.id);
          await xuLyCho(d.id, { kieu: "PHAI_CHO", lyDo: hv.lyDo }, ngCanh);
          await huyThieu("Chưa xác định được học viên — dòng đã nằm trong hàng chờ Chuyển đổi, không còn là 'thiếu quyền học'.");
          continue;
        }
        const studentId = hv.studentId;

        // CHI_GHI_NHAN (cron): đến đây là ĐỦ TIỀN + ĐÃ BIẾT HỌC VIÊN + CHƯA có quyền học còn sống ⇒ lượt cấp quyền khi tiền về đã bị lỡ. Ghi một dòng
        // THIEU_QUYEN_HOC và ĐI TIẾP — TUYỆT ĐỐI không cấp. Khoản tiền mới xác nhận trong ngưỡng DO_TRE_CHO_HICH_MS thì chưa kết luận (handler còn đang chạy).
        if (cheDo === "CHI_GHI_NHAN") {
          const dangTre = now.getTime() - moiNhatCuaTien < DO_TRE_CHO_HICH_MS;
          if (!dangTre) await xuLy("THIEU_QUYEN_HOC", d.id, { kieu: "PHAI_CHO", lyDo: LY_DO_THIEU_QUYEN }, { ...ngCanh, studentId });
          continue;
        }

        // e · cấp. KHÔNG truyền closedBySaleId/firstPurchaseSaleId/commission*: hoa hồng thuộc phiên khác.
        const { quyenHoc, daCo: trung } = await capQuyenHocTrongTx(
          tx,
          {
            studentId,
            courseId: hinhThuc.courseId,
            orderId,
            orderItemId: d.id,
            centerId,
            gia,
            pricingSnapshot: pv.pricingSnapshot as unknown as Prisma.InputJsonValue,
            paidAt: now,
            actor,
          },
          { centerId, bat: true },
          orgUnitId,
        );
        (trung ? daCo : daCap).push({ orderItemId: d.id, quyenHocId: quyenHoc.id });
        // Đã có quyền học ⇒ dòng CHỜ (nếu có) đóng CÙNG transaction: không có khe "đã cấp mà vẫn còn trong hàng chờ".
        await xuLyCho(d.id, { kieu: "DA_CO_QUYEN" }, { ...ngCanh, studentId, entitlementId: quyenHoc.id });
        await xuLy("THIEU_QUYEN_HOC", d.id, { kieu: "DA_CO_QUYEN" }, { ...ngCanh, studentId, entitlementId: quyenHoc.id });
      }

      return {
        nguon,
        boQua: donHuy ? "DON_DA_HUY" : null,
        daCap,
        daCo,
        chuaDuTien,
        chuaCoHocVien,
        choChuyenDoi,
        daDongCho,
        chieuNguoc,
        daDongChieuNguoc,
        chuaXacDinhDuocDong,
        dauKhongKhop,
        daBiHuy,
        thieuQuyen,
        daDongThieuQuyen,
        giuNguyen,
      };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}
