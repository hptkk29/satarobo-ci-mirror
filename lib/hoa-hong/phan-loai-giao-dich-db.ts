// lib/hoa-hong/phan-loai-giao-dich-db.ts — NẠP dữ liệu cho bộ phân loại giao dịch (CHỈ ĐỌC).
//
// Hàm quyết định là `phanLoaiGiaoDich` (thuần). File này chỉ trả lời "dữ liệu nào đáng tin" bằng
// những cột ĐÃ ĐO là có thật (04 §4.4, 01 §156):
//
//   học viên của dòng  : `OrderItem.studentId` → `Enrollment.studentId` (qua `OrderItem.enrollmentId`)
//                        → `Order.leadChildId` ↔ `Student.leadChildId` khi khớp ĐÚNG MỘT.
//                        `Student.leadId` KHÔNG tham gia quyết học viên — nó chỉ để dò phụ huynh hiện hữu.
//   thực thu           : `WHERE_THUC_THU` (A1) — định nghĩa duy nhất, không viết bộ lọc thứ hai. Cùng MỘT truy vấn (`docButToanThucThu`)
//                        nuôi cả lịch sử mua lẫn τ — kèm `paidDate` (ngày thu NGHIỆP VỤ) để so với mốc huỷ/hoàn.
//   τ (luật v2)        : ngày thu dương ĐẦU của ĐƠN chứa dòng (`tinhTau`). Không nhận mốc từ người gọi: ngày thu của khoản vừa quét
//                        KHÔNG được phép quyết NEW/RENEWAL (đó là lỗi v1 — kết quả đổi theo giờ cron).
//   τ máy chủ (luật v4): giờ MÁY CHỦ ghi khoản thu dương đầu của đơn (`tinhTauTheoGioMay`, từ `Payment.createdAt`). `paidDate` là ngày người ghi KHAI nên phép so huỷ / hoàn của tiền lệ với τ
//                        được tính bằng CẢ HAI cách đọc (ngày khai · giờ máy chủ) và khác nhau ⇒ giữ khoản — xem `xepLanMuaTruocAnToan`. Mỗi khoản thu mang `ghiLuc` (= `Payment.createdAt`) cho cách đọc thứ hai.
//   thời điểm mua      : giờ MÁY CHỦ ghi nhận đơn — `Order.createdAt`, hoặc (đơn ghi bù / nhập giao dịch cũ nhận diện bằng AuditLog) giờ của dòng audit tạo đơn (`docDonGioTaoChuaKiem`) kèm cờ `gioTaoChuaKiem`.
//                        KHÔNG BAO GIỜ một ngày do người nhập khai (`Payment.paidDate`, ngày trong audit, ngày trong sheet — luật v3). Hai đơn mà đơn đứng sau chưa kiểm chứng ⇒ không biết thứ tự (`quanHeLanMua`).
//   dòng thêm muộn     : luật v5 — dòng học phí THÊM VÀO ĐƠN CÓ SẴN (`themConVaoDon`) là MỘT LẦN MUA RIÊNG: `taoLuc` = giờ dòng AuditLog `THEM_CON_VAO_DON` (máy chủ ghi cùng transaction, `conMoi.id` = id dòng),
//                        cờ `themMuon`; τ / τ máy chủ của nó chỉ tính từ khoản thu ghi SAU lúc đó. Nhận diện bằng AuditLog chứ KHÔNG đoán theo `OrderItem.createdAt − Order.createdAt`: đường nhập cũ cũng có
//                        dòng tạo muộn hơn đơn rất nhiều (ngày trong sheet ở đơn, giờ NHẬP ở dòng — `[NHH-TRX-D17]`). Hàm chung `gioMuaCuaDong` cho CẢ tiền lệ lẫn dòng đang xét.
//   mốc huỷ            : `OrderStatusHistory(toStatus = CANCELLED)` — sớm nhất; không có dòng ⇒ `huyLuc = null` (huỷ từ đầu).
//   tái tục            : `Enrollment.renewedFromEnrollmentId` (cờ tay).
//   đổi khoá/cơ sở/lớp : `Enrollment.transferredToId` hai chiều + so `courseId`/`centerId`.
//   bảo lưu            : `StudentReserve` của ghi danh.
//   dừng học           : `OrderItem.status = STOPPED`.
//
// ⚠️ KHÔNG ghi gì. Việc lưu kết quả (`StudentTransaction`) là của lớp ghi sổ (PR5) — hàm này trả
// đầu vào cho hàm thuần, và `phanLoaiDongDon` trả luôn kết quả để người gọi lưu.
//
// ⚠️ `client` là tham số BẮT BUỘC, không mặc định (luật 7): cho gọi trong `$transaction` (thấy dữ
// liệu chưa commit) hoặc với client thường. Client ở đây là client KHÔNG scope — engine hoa hồng
// phân loại theo học viên trên toàn hệ thống, không theo tầm nhìn cơ sở của người bấm.
import type { Prisma, PrismaClient } from "@prisma/client";

import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { phoneVariants } from "@/lib/phone";

import { thanhPhanTheoLoaiDong } from "./loai-giao-dich";
import {
  phanLoaiGiaoDich,
  tinhPhuHuynhHienHuu,
  type DauVaoPhanLoai,
  type GhiDanhPhanLoai,
  type KetQuaPhanLoai,
  type KhoanThuLanMua,
  type LanMuaTruoc,
} from "./phan-loai-giao-dich";
import { quyKhoanTheoDong, quyThucThuTheoDong, type DongCuaDon } from "./quy-thuc-thu";

export type KhachDoc = PrismaClient | Prisma.TransactionClient;

const LOAI_DONG_HOC_PHI = ["COURSE_ENROLLMENT", "COURSE_PACKAGE"] as const;

/** Bút toán thực thu của các đơn (có NGÀY THU) — MỘT chỗ duy nhất áp `WHERE_THUC_THU` trong tệp này. */
async function docButToanThucThu(client: KhachDoc, orderIds: readonly string[]) {
  return client.payment.findMany({
    where: { ...WHERE_THUC_THU, orderId: { in: [...orderIds] } },
    // `createdAt` = giờ MÁY CHỦ ghi khoản (người ghi không đặt được) — nguồn của cách đọc thứ hai (luật v4); `paidDate` là ngày người ghi khai.
    select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, createdAt: true },
  });
}

/**
 * Giá trị `newValues.source` của dòng AuditLog (entityType `Payment`) mà `createBackfillOrderPaymentInTx` (lib/crm/backfill-order.ts) ghi CÙNG transaction với đơn ghi bù. Lưới `[NHH-TRX-W8]` canh hai đầu khớp nhau.
 * Đây là dấu hiệu PHÍA SERVER nhận diện đơn ghi bù: `Payment.note` / `Payment.method` là chuỗi người ghi tự gõ (recordPaymentAction), nên marker ở đó giả được.
 */
export const AUDIT_NGUON_DON_GHI_BU = "bulk-convert-backfill";

/**
 * Giá trị `newValues.source` của dòng AuditLog (entityType `Order`) mà `ghiGiaoDichCuChoHocVienInTx` (lib/finance/ghi-giao-dich-cu.ts) ghi CÙNG transaction với đơn nhập giao dịch cũ.
 * Đường này đặt `Order.createdAt` = NGÀY TRONG SHEET do người nhập khai (quyền `payments:record` — vai Sale hưởng hoa hồng có) nên `Order.createdAt` của nó KHÔNG phải dấu thời gian máy chủ. Lưới `[NHH-TRX-W8]` canh hai đầu.
 */
export const AUDIT_NGUON_DON_NHAP_CU = "nhap-giao-dich-cu";

/**
 * Các đơn mà GIỜ TẠO KHÔNG NÓI ĐƯỢC LÚC MUA THẬT (khoản đã đóng trước khi lên hệ thống, nhập sau) → giờ MÁY CHỦ ghi nhận đơn. Mọi đơn khác không có mục (dùng `Order.createdAt`, bất biến).
 *
 * Luật v3 (chủ dự án chốt 2026-10-17): KHÔNG BAO GIỜ lấy ngày do người nhập khai làm thời điểm mua — không `Payment.paidDate`, không `newValues.paidDate` trong audit, không ngày trong sheet. Ở đây chỉ lấy
 * `AuditLog.createdAt` (máy chủ đặt, audit không update/delete) — và giá trị đó chỉ là CẬN TRÊN của lúc mua thật, nên `quanHeLanMua` coi quan hệ với đơn khác là KHÔNG BIẾT khi đơn này đứng sau.
 *
 * Nhận diện bằng AuditLog do máy chủ ghi, không bằng chuỗi người gõ. Người nhập tự tạo được dấu này (chính họ đi qua đường nhập) nhưng dấu chỉ làm TĂNG số khoản bị giữ ⇒ giả mạo không đem lại lợi.
 * Khoản của đơn được tra KHÔNG lọc trạng thái (đơn ghi bù vẫn là đơn ghi bù dù khoản bị từ chối / xoá mềm; thừa dấu chỉ ra hold nhiều hơn, không ra tiền sai). Thiếu audit (dữ liệu cũ không còn dấu) ⇒ không có
 * mục ⇒ `Order.createdAt` — coverage trên prod CHƯA đo, xem 08 §17.v4.
 */
async function docDonGioTaoChuaKiem(client: KhachDoc, orderIds: readonly string[]): Promise<Map<string, Date>> {
  const kq = new Map<string, Date>();
  if (orderIds.length === 0) return kq;
  const khoan = await client.payment.findMany({ where: { orderId: { in: [...orderIds] } }, select: { id: true, orderId: true } });
  const donCuaKhoan = new Map(khoan.map((k) => [k.id, k.orderId]));
  const dau = await client.auditLog.findMany({
    where: {
      module: "finance",
      action: "CREATE",
      OR: [
        { entityType: "Payment", entityId: { in: [...donCuaKhoan.keys()] }, newValues: { path: ["source"], equals: AUDIT_NGUON_DON_GHI_BU } },
        { entityType: "Order", entityId: { in: [...orderIds] }, newValues: { path: ["source"], equals: AUDIT_NGUON_DON_NHAP_CU } },
      ],
    },
    select: { entityType: true, entityId: true, createdAt: true },
  });
  for (const a of dau) {
    const orderId = a.entityType === "Payment" ? donCuaKhoan.get(a.entityId) : a.entityId;
    if (!orderId) continue;
    const cu = kq.get(orderId);
    if (!cu || a.createdAt.getTime() < cu.getTime()) kq.set(orderId, a.createdAt);
  }
  return kq;
}

/** Mốc huỷ SỚM NHẤT của từng đơn (đơn huỷ là trạng thái cuối nên chỉ có một lần). Đơn không có dòng lịch sử thì không có mục. */
async function docMocHuyTheoDon(client: KhachDoc, orderIds: readonly string[]): Promise<Map<string, Date>> {
  const ls = await client.orderStatusHistory.findMany({
    where: { orderId: { in: [...orderIds] }, toStatus: "CANCELLED" },
    select: { orderId: true, createdAt: true },
  });
  const kq = new Map<string, Date>();
  for (const l of ls) {
    const cu = kq.get(l.orderId);
    if (!cu || l.createdAt.getTime() < cu.getTime()) kq.set(l.orderId, l.createdAt);
  }
  return kq;
}

/**
 * Giá trị `AuditLog.action` mà `themConVaoDon` (lib/finance/them-con-vao-don.ts) ghi CÙNG transaction với dòng mới; `newValues.conMoi.id` = id dòng vừa thêm. Lưới `[NHH-TRX-W12]` canh hai đầu khớp nhau.
 */
export const AUDIT_HANH_DONG_THEM_CON_VAO_DON = "THEM_CON_VAO_DON";

/** `newValues.conMoi.id` của dòng audit thêm-con-vào-đơn; `null` khi hình dạng không đúng (không đoán). */
function idDongMoiTuAudit(v: Prisma.JsonValue | null): string | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const conMoi = (v as Record<string, unknown>)["conMoi"];
  if (conMoi === null || typeof conMoi !== "object" || Array.isArray(conMoi)) return null;
  const id = (conMoi as Record<string, unknown>)["id"];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Các DÒNG được THÊM MUỘN vào đơn có sẵn → giờ MÁY CHỦ lúc thêm (`AuditLog.createdAt`, audit không update/delete). Mọi dòng khác không có mục.
 * Chỉ HỎI audit theo (module, entityType, entityId, action) — id dòng đọc từ `newValues.conMoi.id` bằng phép rút có kiểm tra, không từ cột người dùng gõ.
 * EXPORT để ca hành vi của bên GHI (`tests/finance/them-con-vao-don.test.ts` [TCD-15b]) chạy đường ghi thật rồi hỏi chính hàm này: lưới grep `[NHH-TRX-W12]` chỉ ghim hai chuỗi khớp nhau.
 */
export async function docDongThemMuon(client: KhachDoc, orderIds: readonly string[]): Promise<Map<string, Date>> {
  const kq = new Map<string, Date>();
  if (orderIds.length === 0) return kq;
  const dau = await client.auditLog.findMany({
    where: { module: "finance", entityType: "Order", entityId: { in: [...orderIds] }, action: AUDIT_HANH_DONG_THEM_CON_VAO_DON },
    select: { createdAt: true, newValues: true },
  });
  for (const a of dau) {
    const id = idDongMoiTuAudit(a.newValues);
    if (id === null) continue;
    const cu = kq.get(id);
    if (!cu || a.createdAt.getTime() < cu.getTime()) kq.set(id, a.createdAt);
  }
  return kq;
}

/**
 * THỜI ĐIỂM MUA của MỘT dòng — chỗ DUY NHẤT dựng `taoLuc` + `themMuon` + `gioTaoChuaKiem` cho cả tiền lệ lẫn dòng đang xét (hai bên lệch nhau là khoá K sai ngay trong một phép so).
 * `coSo` = giờ máy chủ của ĐƠN (`donChuaKiem.get(orderId) ?? Order.createdAt`). Dòng thêm muộn (có mục ở `themLuc` VÀ muộn hơn `coSo`) mua lúc `themLuc` — một giờ máy chủ đã kiểm chứng nên
 * `gioTaoChuaKiem = false` dù đơn gốc là đơn chưa kiểm chứng. `themLuc ≤ coSo` là bất thường (đồng hồ lệch / đơn bị lùi giờ) ⇒ KHÔNG tin dấu, coi như dòng thường.
 */
function gioMuaCuaDong(p: { coSo: Date; donChuaKiem: boolean; themLuc: Date | undefined }): { taoLuc: Date; themMuon: boolean; gioTaoChuaKiem: boolean } {
  if (p.themLuc !== undefined && p.themLuc.getTime() > p.coSo.getTime()) return { taoLuc: p.themLuc, themMuon: true, gioTaoChuaKiem: false };
  return { taoLuc: p.coSo, themMuon: false, gioTaoChuaKiem: p.donChuaKiem };
}

/** τ của một đơn = ngày thu dương đầu tiên trong các bút toán thực thu của đơn; chưa có khoản dương nào ⇒ `null`. */
function tinhTau(butToanCuaDon: readonly { amount: number; paidDate: Date }[]): Date | null {
  let min: Date | null = null;
  for (const b of butToanCuaDon) if (b.amount > 0 && (min === null || b.paidDate.getTime() < min.getTime())) min = b.paidDate;
  return min;
}

/**
 * τ THEO GIỜ MÁY CHỦ (luật v4) = giờ ghi (`Payment.createdAt`) SỚM NHẤT trong các bút toán thực thu DƯƠNG của đơn; chưa có khoản dương nào ⇒ `null`. Cùng tập khoản với `tinhTau` nên
 * `null` ⇔ `null`. Không đọc `paidDate` — đó là ngày người ghi khai.
 */
function tinhTauTheoGioMay(butToanCuaDon: readonly { amount: number; createdAt: Date }[]): Date | null {
  let min: Date | null = null;
  for (const b of butToanCuaDon) if (b.amount > 0 && (min === null || b.createdAt.getTime() < min.getTime())) min = b.createdAt;
  return min;
}

/**
 * Dựng `LanMuaTruoc[]` cho một tập học viên: mọi dòng học phí của họ + thực thu quy về từng dòng.
 * Trả `Map<studentId, LanMuaTruoc[]>`. Một câu cho dòng + một câu cho dòng-cùng-đơn + một câu cho
 * bút toán — không N+1.
 */
export async function docLanMuaTheoHocVien(
  client: KhachDoc,
  studentIds: readonly string[],
): Promise<Map<string, LanMuaTruoc[]>> {
  const ketQua = new Map<string, LanMuaTruoc[]>();
  for (const id of studentIds) ketQua.set(id, []);
  if (studentIds.length === 0) return ketQua;

  const dongs = await client.orderItem.findMany({
    where: {
      type: { in: [...LOAI_DONG_HOC_PHI] },
      OR: [{ studentId: { in: [...studentIds] } }, { enrollment: { studentId: { in: [...studentIds] } } }],
    },
    select: {
      id: true,
      orderId: true,
      studentId: true,
      enrollment: { select: { studentId: true } },
      // Mốc "lần mua" = giờ máy chủ ghi nhận ĐƠN (`Order.createdAt`, hoặc giờ audit của đơn chưa kiểm chứng). `OrderItem.createdAt` là lúc dòng được GHI: đường nhập đơn lịch sử (`ghi-giao-dich-cu`) đặt
      // `Order.createdAt` = ngày thật trong sheet nhưng không truyền `createdAt` cho dòng lồng bên trong ⇒ dòng mang giờ nhập.
      order: { select: { status: true, createdAt: true } },
    },
  });
  if (dongs.length === 0) return ketQua;

  const orderIds = [...new Set(dongs.map((d) => d.orderId))];
  const [tatCaDong, butToan, mocHuy, donChuaKiem, themMuon] = await Promise.all([
    client.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true, type: true, enrollmentId: true },
    }),
    docButToanThucThu(client, orderIds),
    docMocHuyTheoDon(client, orderIds),
    docDonGioTaoChuaKiem(client, orderIds),
    docDongThemMuon(client, orderIds),
  ]);

  const dongCuaDon: DongCuaDon[] = tatCaDong.map((d) => ({
    orderItemId: d.id,
    orderId: d.orderId,
    laHocPhi: (LOAI_DONG_HOC_PHI as readonly string[]).includes(d.type),
    enrollmentId: d.enrollmentId,
  }));
  const quy = quyThucThuTheoDong(dongCuaDon, butToan);
  const khoanTheoDong = quyKhoanTheoDong(dongCuaDon, butToan);

  for (const d of dongs) {
    const sid = d.studentId ?? d.enrollment?.studentId ?? null;
    if (sid === null || !ketQua.has(sid)) continue;
    const daHuy = d.order.status === "CANCELLED";
    const khoanThu: KhoanThuLanMua[] = (khoanTheoDong.get(d.id) ?? []).map((b) => ({ id: b.id, paidDate: b.paidDate, amount: b.amount, ghiLuc: b.createdAt }));
    const mua = gioMuaCuaDong({ coSo: donChuaKiem.get(d.orderId) ?? d.order.createdAt, donChuaKiem: donChuaKiem.has(d.orderId), themLuc: themMuon.get(d.id) });
    ketQua.get(sid)!.push({
      orderItemId: d.id,
      orderId: d.orderId,
      taoLuc: mua.taoLuc,
      gioTaoChuaKiem: mua.gioTaoChuaKiem,
      themMuon: mua.themMuon,
      daHuy,
      trangThaiDon: d.order.status,
      huyLuc: daHuy ? (mocHuy.get(d.orderId) ?? null) : null,
      khoanThu,
      moHo: quy.get(d.id)?.moHo ?? false,
    });
  }
  return ketQua;
}

/**
 * Học viên của một dòng đơn — 04 §4.4 bước 1, 2, 4 (bước 3 "đơn có đúng một dòng học phí" là của
 * khoản thu, không phải của dòng). Trả `null` khi không ra, hoặc khi ra HAI học viên (mơ hồ).
 */
async function hocVienCuaDong(
  client: KhachDoc,
  dong: { studentId: string | null; enrollment: { studentId: string } | null; order: { leadChildId: string | null } },
): Promise<string | null> {
  if (dong.studentId) return dong.studentId;
  if (dong.enrollment?.studentId) return dong.enrollment.studentId;
  const leadChildId = dong.order.leadChildId;
  if (!leadChildId) return null;
  const khop = await client.student.findMany({
    where: { leadChildId, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  return khop.length === 1 ? khop[0]!.id : null;
}

/** Nạp đầu vào cho `phanLoaiGiaoDich`. `null` = không có dòng đơn này. */
export async function docDauVaoPhanLoai(
  client: KhachDoc,
  input: { orderItemId: string },
): Promise<DauVaoPhanLoai | null> {
  const dong = await client.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: {
      id: true,
      orderId: true,
      type: true,
      status: true,
      studentId: true,
      enrollmentId: true,
      order: { select: { leadId: true, leadChildId: true, createdAt: true } },
      enrollment: {
        select: {
          id: true,
          studentId: true,
          courseId: true,
          centerId: true,
          renewedFromEnrollmentId: true,
          transferredTo: { select: { id: true, courseId: true, centerId: true } },
          transferredFrom: { select: { id: true, courseId: true, centerId: true } },
          reserves: { select: { startedAt: true, endedAt: true } },
        },
      },
    },
  });
  if (!dong) return null;

  // Chưa biết loại dòng ⇒ coi là NGOÀI học phí (không tự coi là học phí).
  const thanhPhan = thanhPhanTheoLoaiDong(dong.type) ?? "OTHER";
  const studentId = await hocVienCuaDong(client, dong);
  // τ: dữ kiện của ĐƠN (mọi dòng, mọi khoản thu của đơn dùng chung) — KHÔNG phải ngày thu của khoản đang được quét.
  const [butToanDon, donChuaKiem, themMuonCuaDon] = await Promise.all([
    docButToanThucThu(client, [dong.orderId]),
    docDonGioTaoChuaKiem(client, [dong.orderId]),
    docDongThemMuon(client, [dong.orderId]),
  ]);
  // Thời điểm mua của dòng đang xét: CÙNG hàm với tiền lệ (`docLanMuaTheoHocVien`) — hai bên lệch nhau là khoá K sai ngay trong một phép so.
  const mua = gioMuaCuaDong({ coSo: donChuaKiem.get(dong.orderId) ?? dong.order.createdAt, donChuaKiem: donChuaKiem.has(dong.orderId), themLuc: themMuonCuaDon.get(dong.id) });
  const muaLuc = mua.taoLuc;
  const gioTaoChuaKiem = mua.gioTaoChuaKiem;
  // Dòng thêm muộn: khoản thu ghi TRƯỚC lúc dòng tồn tại (của anh/chị em trong cùng đơn) không phải tiền của lần mua này ⇒ τ / τ máy chủ chỉ tính từ khoản ghi từ lúc đó (giờ máy chủ, người ghi không đặt được).
  const butToanTinhTau = mua.themMuon ? butToanDon.filter((b) => b.createdAt.getTime() >= muaLuc.getTime()) : butToanDon;
  const tau = tinhTau(butToanTinhTau);
  const tauMay = tinhTauTheoGioMay(butToanTinhTau);

  const e = dong.enrollment;
  const ghiDanh: GhiDanhPhanLoai | null = e
    ? {
        id: e.id,
        courseId: e.courseId,
        centerId: e.centerId,
        renewedFromEnrollmentId: e.renewedFromEnrollmentId,
        chuyenTu: e.transferredFrom.map((x) => ({ enrollmentId: x.id, courseId: x.courseId, centerId: x.centerId })),
        chuyenDen: e.transferredTo
          ? { enrollmentId: e.transferredTo.id, courseId: e.transferredTo.courseId, centerId: e.transferredTo.centerId }
          : null,
        baoLuu: e.reserves.map((r) => ({ batDau: r.startedAt, ketThuc: r.endedAt })),
      }
    : null;

  let lanMuaTruoc: LanMuaTruoc[] = [];
  let ghiDanhMoCoi: { enrollmentId: string; taoLuc: Date }[] = [];
  let hocVien: { leadId: string | null; parentPhone: string | null } | null = null;
  let phuHuynh = { hienHuu: null as boolean | null, can: null as "CUNG_LEAD" | "CUNG_SDT" | null };

  if (studentId) {
    const [lanMua, moCoi, sv] = await Promise.all([
      docLanMuaTheoHocVien(client, [studentId]),
      client.enrollment.findMany({
        where: {
          studentId,
          deletedAt: null,
          orderItems: { none: {} },
          // Ghi danh đích/đã chuyển đi của một lượt chuyển CŨNG tính là "đã học mà chưa có đơn" — không
          // đoán là nó đã được nhận diện: dòng đang xét mà dính chuyển đã dừng ở bước 2 (PENDING/xem tay)
          // từ trước khi tới bước này, còn ca khác thì thà xem tay còn hơn gọi nhầm "lần mua đầu".
        },
        select: { id: true, createdAt: true },
      }),
      client.student.findUnique({ where: { id: studentId }, select: { leadId: true, parentPhone: true } }),
    ]);
    lanMuaTruoc = (lanMua.get(studentId) ?? []).filter((l) => l.orderItemId !== dong.id);
    ghiDanhMoCoi = moCoi.map((x) => ({ enrollmentId: x.id, taoLuc: x.createdAt }));
    hocVien = sv;

    const leadIds = [...new Set([sv?.leadId, dong.order.leadId].filter((x): x is string => !!x))];
    const sdt = phoneVariants(sv?.parentPhone ?? null);
    const coDinhDanh = leadIds.length > 0 || sdt.length > 0;
    const ungVien =
      coDinhDanh
        ? await client.student.findMany({
            where: {
              id: { not: studentId },
              deletedAt: null,
              OR: [
                ...(leadIds.length > 0 ? [{ leadId: { in: leadIds } }] : []),
                ...(sdt.length > 0 ? [{ parentPhone: { in: sdt } }] : []),
              ],
            },
            select: { id: true, leadId: true, parentPhone: true },
            take: 50,
          })
        : [];
    const lanMuaUngVien = await docLanMuaTheoHocVien(
      client,
      ungVien.map((u) => u.id),
    );
    const sdtChuan = new Set(sdt);
    phuHuynh = tinhPhuHuynhHienHuu({
      tau,
      tauMay,
      dong: { orderItemId: dong.id, orderId: dong.orderId, gioTaoChuaKiem, themMuon: mua.themMuon, taoLuc: muaLuc },
      ungVien: ungVien.map((u) => ({
        studentId: u.id,
        cungLead: u.leadId !== null && leadIds.includes(u.leadId),
        cungSdt: u.parentPhone !== null && phoneVariants(u.parentPhone).some((v) => sdtChuan.has(v)),
        lanMua: lanMuaUngVien.get(u.id) ?? [],
      })),
      coDinhDanh,
    });
  }

  return {
    dong: {
      orderItemId: dong.id,
      orderId: dong.orderId,
      thanhPhan,
      trangThai: dong.status,
      gioTaoChuaKiem,
      themMuon: mua.themMuon,
      taoLuc: muaLuc,
    },
    studentId,
    ghiDanh,
    lanMuaTruoc,
    ghiDanhMoCoi,
    phuHuynh,
    coLead: dong.order.leadId !== null || hocVien?.leadId != null,
    tau,
    tauMay,
  };
}

/** Nạp + phân loại MỘT dòng đơn. `null` = không có dòng đơn. Không nhận mốc thời gian nào — xem `docDauVaoPhanLoai`. */
export async function phanLoaiDongDon(
  client: KhachDoc,
  input: { orderItemId: string },
): Promise<KetQuaPhanLoai | null> {
  const dau = await docDauVaoPhanLoai(client, input);
  return dau ? phanLoaiGiaoDich(dau) : null;
}
