// lib/entitlements/dich-vu.ts — TẦNG GHI/ĐỌC quyền học. DB thật. 🔴 CHƯA CÓ LUỒNG NÀO GỌI (08/10/2026).
//
// HAI LỚP HÀM GHI, cùng một ruột:
//   · `xTrongTx(tx, vao, co, …)` — chạy TRONG transaction của NGƯỜI GỌI (tiền, điểm danh, xếp lớp…).
//     Không mở transaction, không hỏi cờ, không tra OrgUnit: mọi thứ cần đọc bằng kết nối GỐC đã được người
//     gọi đọc TRƯỚC khi mở transaction và truyền vào (`co` = cờ, `orgUnitId`). Một kết nối thứ hai trong lúc
//     transaction đang giữ kết nối đầu là cách N lượt đồng thời ≥ cỡ bể treo nhau (đo 08/10).
//   · `x(vao, dep)` — vỏ mỏng giữ NGUYÊN HÀNH VI cũ: hỏi cờ → (tự mở) transaction → gọi `xTrongTx`.
//
// Mọi hàm GHI đều:
//   1. kiểm công tắc `billing.scopePurchaseEnabled` của cơ sở TRƯỚC phép ghi đầu tiên (tắt ⇒ ném `TAT`);
//   2. khoá dòng quyền học (`FOR UPDATE`) hoặc khoá advisory rồi mới đọc-quyết-ghi;
//   3. TỪ CHỐI bằng `throw` đứng TRƯỚC phép ghi đầu tiên (luật rollback trong CLAUDE.md: `return` không
//      rollback). Ngoại lệ có chủ đích: `ghiNhanBai`/`huyGhiNhanBai` trả KẾT QUẢ (không ném) khi bài bị từ chối
//      hoặc công tắc tắt — chúng nằm trong transaction điểm danh của người khác và không được làm hỏng nó;
//   4. ghi `AuditLog` (`module = "entitlements"`) trong cùng transaction.
//
// Phép ghi `consumedSessions` CHỈ nằm trong `ganLaiTieuThu` (tính lại từ sổ cái, không cộng dồn) — lưới
// `[DVU-PIN]` canh. Hàm đọc nhận `client` để người gọi truyền `scopedDb(actor)`; tầng này không tự bypass.
//
// ⚠️ Thứ tự khoá khi nhúng vào luồng tiền: khoá ĐƠN của người gọi TRƯỚC, khoá quyền học (advisory theo
// `orderItemId` / `FOR UPDATE` theo dòng) SAU. Đừng lấy khoá quyền học trước khoá đơn ở bất kỳ nơi nào.
import "server-only";
import type { Prisma, StudyEntitlement } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import type { KetQuaGia } from "@/lib/pricing/tinh-gia-theo-moc";
import { LOI_PHAM_VI_TAT, laThuHocPhiTheoPhamViBat } from "./feature";
import { tinhBatDauKhiXepLop, type KetQuaXepLop } from "./bat-dau-khi-xep-lop";
import { CAU_HINH_PHAM_VI_MAC_DINH, type CauHinhPhamVi, type LanMuaTruoc } from "./pham-vi-hoc";
import {
  baiBoQuaTuSo,
  quyetDinhGhiNhan,
  tinhAnHanDaDung,
  tinhConLai,
  tinhDaTieuThu,
  type DongSoCai,
  type QuyenHocTomTat,
} from "./tieu-thu";
import { chuyenTrangThai, coTheBaoLuu, type TrangThaiQuyenHoc } from "./trang-thai";

type Tx = Prisma.TransactionClient;

export type MaLoiQuyenHoc = "TAT" | "KHONG_TIM_THAY" | "TRANG_THAI" | "DAU_VAO";

export class LoiQuyenHoc extends Error {
  constructor(
    public readonly ma: MaLoiQuyenHoc,
    message: string,
  ) {
    super(message);
    this.name = "LoiQuyenHoc";
  }
}

export interface PhuThuoc {
  /** Công tắc theo CƠ SỞ (centerId). Tiêm được để test không cần bảng cài đặt. */
  batChoCoSo: (centerId: string) => Promise<boolean>;
}

export const PHU_THUOC_MAC_DINH: PhuThuoc = {
  // `CenterSetting` khoá theo OrgUnit.id: đổi Center.id → OrgUnit.id trước khi hỏi (xem feature.ts).
  batChoCoSo: async (centerId) => laThuHocPhiTheoPhamViBat(await orgUnitIdForCenter(centerId)),
};

async function canBat(dep: PhuThuoc, centerId: string): Promise<void> {
  if (!(await dep.batChoCoSo(centerId))) {
    throw new LoiQuyenHoc("TAT", LOI_PHAM_VI_TAT);
  }
}

// ── CỜ ĐỌC NGOÀI TRANSACTION (cho các hàm *TrongTx) ─────────────────────────────────────────

/**
 * Công tắc phạm vi của MỘT cơ sở, ĐÃ ĐỌC trước khi người gọi mở transaction. Mang kèm `centerId` để hàm
 * `*TrongTx` đối chiếu với cơ sở của quyền học thật sự bị ghi: cờ của cơ sở A không được phép mở cửa cho
 * quyền học của cơ sở B (cờ bật theo TỪNG cơ sở).
 */
export interface CoPhamVi {
  readonly centerId: string;
  readonly bat: boolean;
}

/** Đọc cờ bằng kết nối GỐC. GỌI TRƯỚC `db.$transaction(…)` của người gọi, không bao giờ trong nó. */
export async function docCoPhamVi(centerId: string, dep: PhuThuoc = PHU_THUOC_MAC_DINH): Promise<CoPhamVi> {
  return { centerId, bat: await dep.batChoCoSo(centerId) };
}

/** Cờ + `orgUnitId` cho `capQuyenHocTrongTx`: cả hai cần kết nối gốc nên phải đọc TRƯỚC transaction. */
export async function chuanBiCapQuyenHoc(
  centerId: string,
  dep: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<{ co: CoPhamVi; orgUnitId: string | null }> {
  const co = await docCoPhamVi(centerId, dep);
  return { co, orgUnitId: await orgUnitIdForCenter(centerId) };
}

/** Công tắc tắt ⇒ ném `TAT`. Đứng ĐẦU mọi hàm `*TrongTx` ghi, trước cả lời gọi `tx.` đầu tiên. */
function canCoDaBat(co: CoPhamVi): void {
  if (!co.bat) throw new LoiQuyenHoc("TAT", LOI_PHAM_VI_TAT);
}

/** Cờ đọc cho cơ sở nào thì chỉ ghi được quyền học của cơ sở đó. */
function canCoDungCoSo(co: CoPhamVi, centerIdCuaQuyen: string): void {
  if (co.centerId !== centerIdCuaQuyen) {
    throw new LoiQuyenHoc("DAU_VAO", "Cờ phạm vi đã đọc cho cơ sở khác với cơ sở của quyền học này.");
  }
}

/** Dùng chung giữa vỏ và bản `TrongTx` — hai bản chép tay sẽ lệch nhau. */
function kiemDauVaoCap(vao: Pick<CapQuyenHocInput, "gia" | "orderId" | "orderItemId">): void {
  const { gia } = vao;
  if (!Number.isInteger(gia.soBuoi) || gia.soBuoi < 1 || gia.niemYet - gia.giamGia !== gia.thanhTien) {
    throw new LoiQuyenHoc("DAU_VAO", "Kết quả giá không nhất quán (niêm yết − giảm ≠ thành tiền).");
  }
  if (!vao.orderId || !vao.orderItemId) throw new LoiQuyenHoc("DAU_VAO", "Thiếu đơn hoặc dòng đơn.");
}

function kiemLyDo(lyDo: string, viec: string): void {
  if (!lyDo.trim()) throw new LoiQuyenHoc("DAU_VAO", `${viec} phải có lý do.`);
}

function kiemHanBang(frozenUntil: Date, now: Date): void {
  if (frozenUntil.getTime() <= now.getTime()) {
    throw new LoiQuyenHoc("DAU_VAO", "Ngày kết thúc bảo lưu phải ở tương lai (thiếu ngày thì không thực thi được trần thời hạn).");
  }
}

function chuyenTrangThaiHopLe(tu: TrangThaiQuyenHoc, suKien: Parameters<typeof chuyenTrangThai>[1], truocBaoLuu?: TrangThaiQuyenHoc | null): TrangThaiQuyenHoc {
  try {
    return chuyenTrangThai(tu, suKien, truocBaoLuu);
  } catch (e) {
    throw new LoiQuyenHoc("TRANG_THAI", e instanceof Error ? e.message : String(e));
  }
}

/** Khoá dòng quyền học cho đến hết transaction. Không có dòng ⇒ `KHONG_TIM_THAY`. */
async function khoaVaDoc(tx: Tx, id: string): Promise<StudyEntitlement> {
  await tx.$queryRaw`SELECT "id" FROM "StudyEntitlement" WHERE "id" = ${id} FOR UPDATE`;
  const e = await tx.studyEntitlement.findUnique({ where: { id } });
  if (!e) throw new LoiQuyenHoc("KHONG_TIM_THAY", "Không tìm thấy quyền học.");
  return e;
}

/** Cơ sở của quyền học, đọc bằng kết nối gốc — CHỈ cho vỏ mỏng, trước khi hỏi cờ. */
async function coSoCuaQuyen(entitlementId: string): Promise<string> {
  const truoc = await db.studyEntitlement.findUnique({ where: { id: entitlementId }, select: { centerId: true } });
  if (!truoc) throw new LoiQuyenHoc("KHONG_TIM_THAY", "Không tìm thấy quyền học.");
  return truoc.centerId;
}

function tomTat(e: StudyEntitlement): QuyenHocTomTat {
  if (e.startLessonOrder === null || e.endLessonOrder === null) {
    throw new LoiQuyenHoc("TRANG_THAI", "Quyền học chưa chốt phạm vi bài (chưa xếp lớp).");
  }
  return {
    purchaseSessions: e.purchaseSessions,
    startLessonOrder: e.startLessonOrder,
    endLessonOrder: e.endLessonOrder,
    baiBoQua: baiBoQuaTuSo(e.startLessonOrder, e.skippedSessions),
    freeMakeupSessions: e.freeMakeupSessions,
    graceSessionsGranted: e.graceSessionsGranted,
  };
}

const soCaiCua = async (tx: Tx, entitlementId: string): Promise<DongSoCai[]> =>
  (await tx.studyEntitlementUsage.findMany({ where: { entitlementId }, select: { lessonOrder: true, source: true, voidedAt: true } })).map((u) => ({
    lessonOrder: u.lessonOrder,
    source: u.source,
    voidedAt: u.voidedAt,
  }));

/**
 * Tính lại CACHE `consumedSessions` + `graceSessionsUsed` từ sổ cái. NƠI DUY NHẤT ghi hai cột này.
 * Trả về số liệu mới. Không cộng dồn: gọi bao nhiêu lần cũng ra cùng kết quả.
 */
export async function ganLaiTieuThu(tx: Tx, entitlementId: string): Promise<{ daTieuThu: number; anHanDaDung: number }> {
  const soCai = await soCaiCua(tx, entitlementId);
  const daTieuThu = tinhDaTieuThu(soCai);
  const anHanDaDung = tinhAnHanDaDung(soCai);
  await tx.studyEntitlement.update({
    where: { id: entitlementId },
    data: { consumedSessions: daTieuThu, graceSessionsUsed: anHanDaDung },
  });
  return { daTieuThu, anHanDaDung };
}

// ── CẤP QUYỀN HỌC ───────────────────────────────────────────────────────────────────────────

export interface CapQuyenHocInput {
  studentId: string;
  courseId: string;
  orderId: string;
  orderItemId: string;
  centerId: string;
  /** Kết quả `tinhGiaTheoMoc` — server tính, không tin số từ client. */
  gia: KetQuaGia;
  pricingSnapshot: Prisma.InputJsonValue;
  discountSnapshot?: Prisma.InputJsonValue;
  configSnapshot?: Prisma.InputJsonValue;
  customerKind?: "NEW" | "RENEWAL";
  purchaseOrdinal?: number;
  courseOrdinal?: number;
  closedBySaleId?: string | null;
  firstPurchaseSaleId?: string | null;
  priceIncludesVat?: boolean;
  invoiceLabel?: string | null;
  paidAt?: Date | null;
  actor: AuditActor;
}

/**
 * Cấp quyền học cho MỘT dòng đơn, TRONG transaction của người gọi. Idempotent theo `orderItemId`: dòng đã có
 * (chưa VOIDED) ⇒ trả lại nó, `daCo = true`, KHÔNG ghi gì. Chống đua bằng khoá advisory theo `orderItemId` +
 * chỉ mục duy nhất từng phần.
 *
 * `co` và `orgUnitId` do người gọi lấy từ `chuanBiCapQuyenHoc(centerId)` TRƯỚC khi mở transaction. `orgUnitId`
 * BẮT BUỘC có mặt trong `create` ngay cả khi `null`: ghi kép tự động (`lib/org/dual-write.ts`) chỉ bỏ qua việc
 * tra OrgUnit khi khoá này `!== undefined`, còn thiếu khoá là nó tra bằng `db` GỐC — một kết nối thứ hai.
 *
 * Không bắt `P2002` trong transaction của người gọi (lỗi SQL làm hỏng cả transaction, 25P02): chỉ mục duy nhất
 * từng phần `StudyEntitlement_orderItemId_active_key` là lưới cuối.
 */
export async function capQuyenHocTrongTx(
  tx: Tx,
  vao: CapQuyenHocInput,
  co: CoPhamVi,
  orgUnitId: string | null,
): Promise<{ quyenHoc: StudyEntitlement; daCo: boolean }> {
  canCoDaBat(co);
  canCoDungCoSo(co, vao.centerId);
  kiemDauVaoCap(vao);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"quyen-hoc:" + vao.orderItemId}))`;
  const daCo = await tx.studyEntitlement.findFirst({ where: { orderItemId: vao.orderItemId, status: { not: "VOIDED" } } });
  if (daCo) return { quyenHoc: daCo, daCo: true };

  const { gia } = vao;
  const e = await tx.studyEntitlement.create({
    data: {
      studentId: vao.studentId,
      courseId: vao.courseId,
      orderId: vao.orderId,
      orderItemId: vao.orderItemId,
      centerId: vao.centerId,
      orgUnitId,
      purchaseKind: gia.loai,
      purchaseSessions: gia.soBuoi,
      listAmount: gia.niemYet,
      discountAmount: gia.giamGia,
      netAmount: gia.thanhTien,
      priceIncludesVat: vao.priceIncludesVat ?? true,
      pricingSnapshot: vao.pricingSnapshot,
      discountSnapshot: vao.discountSnapshot,
      configSnapshot: vao.configSnapshot,
      customerKind: vao.customerKind ?? "NEW",
      purchaseOrdinal: vao.purchaseOrdinal ?? 1,
      courseOrdinal: vao.courseOrdinal ?? 1,
      closedBySaleId: vao.closedBySaleId ?? null,
      firstPurchaseSaleId: vao.firstPurchaseSaleId ?? null,
      invoiceLabel: vao.invoiceLabel ?? null,
      paidAt: vao.paidAt ?? null,
      createdById: vao.actor.id,
      origin: "PAYMENT",
    },
  });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "CREATE",
    newValues: { purchaseKind: e.purchaseKind, purchaseSessions: e.purchaseSessions, netAmount: e.netAmount, orderItemId: e.orderItemId },
    orgUnitId: vao.centerId,
    tx,
  });
  return { quyenHoc: e, daCo: false };
}

/** Vỏ mỏng: tự hỏi cờ, tự suy `orgUnitId`, tự mở transaction rồi gọi `capQuyenHocTrongTx`. */
export async function capQuyenHoc(
  vao: CapQuyenHocInput,
  dep: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<{ quyenHoc: StudyEntitlement; daCo: boolean }> {
  await canBat(dep, vao.centerId);
  kiemDauVaoCap(vao);

  // ⚠️ Tự suy `orgUnitId` TRƯỚC khi mở transaction (xem chú thích ở `capQuyenHocTrongTx`). Với N lượt cấp đồng
  // thời ≥ cỡ bể, mọi kết nối bị giữ bởi transaction đang chờ khoá mà người giữ khoá lại cần kết nối mới ⇒ treo
  // tới hết hạn transaction (đo 08/10: 5 lượt đồng thời, bể 5s).
  const orgUnitId = await orgUnitIdForCenter(vao.centerId);

  return await db.$transaction((tx) => capQuyenHocTrongTx(tx, vao, { centerId: vao.centerId, bat: true }, orgUnitId));
}

// ── XẾP LỚP: CHỐT PHẠM VI BÀI ───────────────────────────────────────────────────────────────

/** Số bài tối đa một buổi học vượt khi người gọi không truyền (`enrollment.catchUpMaxLessonsPerSession` mặc định 3). Chỉ ảnh hưởng cách CHIA `catchupSessions`. */
export const BAI_MOI_BUOI_HOC_VUOT_MAC_DINH = 3;

export interface XepLopInput {
  entitlementId: string;
  enrollmentId: string;
  classId: string;
  /** Bài KẾ TIẾP lớp sẽ dạy: `baiKeTiepCuaLop` (thuần) / `docBaiKeTiepCuaLop` (một câu DB) — `plan.order + 1` của buổi chưa huỷ, sớm nhất. */
  baiKeTiepCuaLop: number;
  truoc?: LanMuaTruoc | null;
  cauHinh?: CauHinhPhamVi;
  /** `enrollment.catchUpMaxLessonsPerSession`; thiếu ⇒ BAI_MOI_BUOI_HOC_VUOT_MAC_DINH. */
  baiMoiBuoiHocVuot?: number;
  /** Số buổi ân hạn chụp lúc cấp (`enrollment.renewalGraceSessions`). */
  graceSessionsGranted?: number;
  curriculumId?: string | null;
  curriculumVersion?: number | null;
  actor: AuditActor;
  now: Date;
}

/**
 * Chốt phạm vi bài cho một quyền học, TRONG transaction của người gọi. Người gọi tự kiểm quyền quyết định của
 * QLCS (`canQuyetDinhCuaQLCS`) — tầng này không biết actor có quyền gì, chỉ biết cờ.
 */
export async function xepLopTrongTx(
  tx: Tx,
  vao: XepLopInput,
  co: CoPhamVi,
): Promise<{ quyenHoc: StudyEntitlement; phamVi: KetQuaXepLop }> {
  canCoDaBat(co);
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  // Cổng đứng TRƯỚC phép ghi đầu tiên: đúng trạng thái mới được chốt phạm vi.
  const tiepTheo: TrangThaiQuyenHoc = chuyenTrangThaiHopLe(e.status, "XEP_LOP");
  const cauHinh = vao.cauHinh ?? CAU_HINH_PHAM_VI_MAC_DINH;
  // MỘT công thức xếp lớp: `tinhBatDauKhiXepLop` (quyết định chủ dự án 12/10/2026 — gói không trọn bắt đầu ở bài kế tiếp của lớp, gói trọn
  // vào trễ quá ngưỡng thì học vượt có trần). Ném `LoiPhamVi` TRƯỚC phép ghi đầu tiên; người gọi biến nó thành "treo review", không đoán.
  const phamVi = tinhBatDauKhiXepLop({
    loai: e.purchaseKind,
    soBuoi: e.purchaseSessions,
    baiKeTiepCuaLop: vao.baiKeTiepCuaLop,
    truoc: vao.truoc ?? null,
    cauHinh,
    baiMoiBuoiHocVuot: vao.baiMoiBuoiHocVuot ?? BAI_MOI_BUOI_HOC_VUOT_MAC_DINH,
  });
  // Ảnh chụp bền của lần xếp lớp — nơi DUY NHẤT lưu bài trước start, bài học vượt, chế độ bù (không có cột riêng; không thêm bảng).
  const cu = e.configSnapshot && typeof e.configSnapshot === "object" && !Array.isArray(e.configSnapshot) ? (e.configSnapshot as Record<string, Prisma.InputJsonValue>) : {};
  const anhChup: Prisma.InputJsonValue = {
    ...cu,
    xepLop: {
      at: vao.now.toISOString(),
      baiKeTiepCuaLop: vao.baiKeTiepCuaLop,
      lateEntryMaxLessons: cauHinh.lateEntryMaxLessons,
      catchUpMaxSessions: cauHinh.catchUpMaxSessions,
      catchUpOverCapPolicy: cauHinh.catchUpOverCapPolicy,
      catchupMode: phamVi.catchupMode,
      lessonsBeforeStart: [...phamVi.lessonsBeforeStart],
      freeMakeupLessons: [...phamVi.freeMakeupLessons],
      skippedLessons: [...phamVi.skippedLessons],
      requiredCatchupLessons: [...phamVi.requiredCatchupLessons],
      catchupSessions: phamVi.catchupSessions.map((b) => [...b]),
    },
  };
  const capNhat = await tx.studyEntitlement.update({
    where: { id: e.id },
    data: {
      enrollmentId: vao.enrollmentId,
      classId: vao.classId,
      startLessonOrder: phamVi.startLesson,
      endLessonOrder: phamVi.endLesson,
      // Chỉ đếm bài bỏ qua TRONG [start,end] (liền từ start — `baiBoQuaTuSo`). Bài trước start KHÔNG đếm vào đây.
      skippedSessions: phamVi.skippedLessons.length,
      // Học bù MIỄN PHÍ (quyết định 1): trong phạm vi nhưng KHÔNG trừ quyền chính. Cùng quy ước tiền tố với `skippedSessions`; CHECK SQL cấm cả hai cùng > 0.
      freeMakeupSessions: phamVi.freeMakeupLessons.length,
      scopeLockedAt: vao.now,
      configSnapshot: anhChup,
      effectiveFrom: vao.now,
      status: tiepTheo,
      graceSessionsGranted: vao.graceSessionsGranted ?? 0,
      curriculumId: vao.curriculumId ?? null,
      curriculumVersion: vao.curriculumVersion ?? null,
    },
  });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "PLACE",
    oldValues: { status: e.status, startLessonOrder: e.startLessonOrder, endLessonOrder: e.endLessonOrder },
    newValues: {
      status: capNhat.status,
      startLessonOrder: phamVi.startLesson,
      endLessonOrder: phamVi.endLesson,
      skippedSessions: phamVi.skippedLessons.length,
      freeMakeupSessions: phamVi.freeMakeupLessons.length,
      catchupMode: phamVi.catchupMode,
      baiKeTiepCuaLop: vao.baiKeTiepCuaLop,
    },
    orgUnitId: e.centerId,
    tx,
  });
  return { quyenHoc: capNhat, phamVi };
}

export async function xepLop(
  vao: XepLopInput,
  dep: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<{ quyenHoc: StudyEntitlement; phamVi: KetQuaXepLop }> {
  const centerId = await coSoCuaQuyen(vao.entitlementId);
  await canBat(dep, centerId);
  return await db.$transaction((tx) => xepLopTrongTx(tx, vao, { centerId, bat: true }));
}

// ── GHI NHẬN MỘT BÀI ĐÃ HỌC ─────────────────────────────────────────────────────────────────

export interface GhiNhanBaiInput {
  entitlementId: string;
  lessonOrder: number;
  nguon: "CLASS" | "MAKEUP" | "CATCH_UP";
  sessionId?: string | null;
  makeupCaseStudentId?: string | null;
  attendanceId?: string | null;
  /** `seatHoldDays` chụp vào `seatHoldUntil` khi ân hạn dùng hết. */
  soNgayGiuCho?: number;
  actor: AuditActor;
  now: Date;
}

export type KetQuaGhiNhanBai =
  | { ghi: true; loai: "TIEU_THU" | "AN_HAN"; trangThai: TrangThaiQuyenHoc; daTieuThu: number; conLai: number }
  // `HOC_BO_SUNG`: bài học bù MIỄN PHÍ (FREE_MAKEUP) — KHÔNG vào sổ cái của quyền chính (không `StudyEntitlementUsage`, không đổi consumed/status); đã ghi RIÊNG
  // một dòng AuditLog `BONUS_LEARN`. `ghi: false` vì "ghi" ở đây nghĩa là sổ cái.
  | { ghi: false; lyDo: "HOC_BO_SUNG" }
  | { ghi: false; lyDo: "DA_CO" | "NGOAI_PHAM_VI" | "BO_QUA" | "HET_BUOI" | "HET_AN_HAN" | "CHUA_HET_QUYEN" | "KHONG_NHAN_BAI" | "TAT" };

const TRANG_THAI_NHAN_BAI: ReadonlySet<TrangThaiQuyenHoc> = new Set(["ACTIVE", "EXHAUSTED"]);

/**
 * Ghi nhận một bài đã học, TRONG transaction của người gọi (điểm danh, học bù…). KHÔNG BAO GIỜ ném vì công tắc:
 * tắt ⇒ `{ ghi: false, lyDo: "TAT" }` mà chưa đụng DB — một sự kiện sổ cái không được làm cuộn ngược điểm danh.
 * Cờ tắt = bỏ qua im lặng, nên người gọi PHẢI đọc cờ theo đúng cơ sở của quyền học (`co.centerId`); cờ đúng
 * cơ sở nhưng lệch với quyền học thật vẫn ném `DAU_VAO` (lỗi lập trình, không im lặng).
 */
export async function ghiNhanBaiTrongTx(tx: Tx, vao: GhiNhanBaiInput, co: CoPhamVi): Promise<KetQuaGhiNhanBai> {
  if (!co.bat) return { ghi: false as const, lyDo: "TAT" as const };
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  // Đang bảo lưu / chưa xếp lớp / giữ chỗ / đã đóng ⇒ KHÔNG nhận bài. Trả KẾT QUẢ chứ không ném: chưa ghi
  // gì, và một sự kiện điểm danh tới muộn không được làm hỏng đường lưu điểm danh của người gọi.
  if (!TRANG_THAI_NHAN_BAI.has(e.status)) return { ghi: false as const, lyDo: "KHONG_NHAN_BAI" as const };
  const q = tomTat(e);
  const soCai = await soCaiCua(tx, e.id);
  const qd = quyetDinhGhiNhan(q, soCai, vao.lessonOrder, vao.nguon);
  if (qd.loai === "DA_CO") return { ghi: false as const, lyDo: "DA_CO" as const };
  if (qd.loai === "TU_CHOI") return { ghi: false as const, lyDo: qd.lyDo };
  if (qd.loai === "BO_SUNG") {
    // Ghi RIÊNG, không đụng sổ cái: một dòng audit (module entitlements) là dấu vết bền duy nhất — không bảng mới, không Usage.
    await writeAudit({
      actor: vao.actor,
      module: "entitlements",
      entityType: "StudyEntitlement",
      entityId: e.id,
      action: "BONUS_LEARN",
      newValues: { lessonOrder: vao.lessonOrder, nguon: vao.nguon, sessionId: vao.sessionId ?? null, makeupCaseStudentId: vao.makeupCaseStudentId ?? null, attendanceId: vao.attendanceId ?? null },
      orgUnitId: e.centerId,
      tx,
    });
    return { ghi: false as const, lyDo: "HOC_BO_SUNG" as const };
  }
  // Ân hạn chỉ mở SAU khi quyền đã hết; còn buổi mà gặp bài trong dải ân hạn ⇒ chưa phải lúc.
  if (qd.loai === "AN_HAN" && e.status !== "EXHAUSTED") return { ghi: false as const, lyDo: "CHUA_HET_QUYEN" as const };

  const nguon = qd.loai === "AN_HAN" ? ("GRACE" as const) : qd.nguon;
  const du = {
    source: nguon,
    sessionId: vao.sessionId ?? null,
    makeupCaseStudentId: vao.makeupCaseStudentId ?? null,
    attendanceId: vao.attendanceId ?? null,
    usedAt: vao.now,
    voidedAt: null,
    voidReason: null,
  };
  // Khoá duy nhất (entitlementId, lessonOrder): có dòng cũ bị vô hiệu ⇒ BẬT LẠI, không chèn dòng thứ hai.
  await tx.studyEntitlementUsage.upsert({
    where: { entitlementId_lessonOrder: { entitlementId: e.id, lessonOrder: vao.lessonOrder } },
    create: { entitlementId: e.id, studentId: e.studentId, lessonOrder: vao.lessonOrder, ...du },
    update: du,
  });
  const { daTieuThu, anHanDaDung } = await ganLaiTieuThu(tx, e.id);
  const conLai = tinhConLai(q, daTieuThu);

  let trangThai: TrangThaiQuyenHoc = e.status;
  const capNhat: Prisma.StudyEntitlementUpdateInput = {};
  if (e.status === "ACTIVE" && conLai === 0) {
    trangThai = chuyenTrangThaiHopLe(e.status, "HET_BUOI");
    capNhat.status = trangThai;
    if (e.graceSessionsGranted > 0) capNhat.graceStartedAt = vao.now;
  }
  if (trangThai === "EXHAUSTED" && qd.loai === "AN_HAN" && anHanDaDung >= e.graceSessionsGranted) {
    trangThai = chuyenTrangThaiHopLe(trangThai, "HET_AN_HAN");
    capNhat.status = trangThai;
    const ngay = vao.soNgayGiuCho ?? 14;
    capNhat.seatHoldUntil = new Date(vao.now.getTime() + ngay * 24 * 3600 * 1000);
  }
  if (Object.keys(capNhat).length > 0) await tx.studyEntitlement.update({ where: { id: e.id }, data: capNhat });

  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: qd.loai === "AN_HAN" ? "GRACE_USE" : "CONSUME",
    newValues: { lessonOrder: vao.lessonOrder, nguon, daTieuThu, conLai, status: trangThai },
    orgUnitId: e.centerId,
    tx,
  });
  return { ghi: true as const, loai: qd.loai, trangThai, daTieuThu, conLai };
}

export async function ghiNhanBai(
  vao: GhiNhanBaiInput,
  dep: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<KetQuaGhiNhanBai> {
  const centerId = await coSoCuaQuyen(vao.entitlementId);
  await canBat(dep, centerId);
  return await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, vao, { centerId, bat: true }));
}

export interface HuyGhiNhanBaiInput {
  entitlementId: string;
  lessonOrder: number;
  lyDo: string;
  actor: AuditActor;
  now: Date;
}

export type KetQuaHuyGhiNhan =
  | { daHuy: false; trangThai: null; lyDo: "TAT" }
  | { daHuy: boolean; trangThai: TrangThaiQuyenHoc };

/**
 * Điểm danh bị sửa/gỡ ⇒ vô hiệu dòng sổ cái của bài đó, TRONG transaction của người gọi. Không có dòng còn hiệu
 * lực ⇒ `daHuy = false`, không ghi. Công tắc tắt ⇒ bỏ qua im lặng (như `ghiNhanBaiTrongTx`).
 *
 * ⚠️ Huỷ THEO `(entitlementId, lessonOrder)`, không nhìn con trỏ nguồn — giữ NGUYÊN ngữ nghĩa hàm cũ. Lưu lại
 * lưới sau khi bù xong sẽ huỷ nhầm dòng MAKEUP; quyết định "còn bằng chứng nào cho bài này không" thuộc người
 * gọi (hàm quyết định hội tụ ở PR điểm danh), không thuộc tầng ghi.
 */
export async function huyGhiNhanBaiTrongTx(tx: Tx, vao: HuyGhiNhanBaiInput, co: CoPhamVi): Promise<KetQuaHuyGhiNhan> {
  kiemLyDo(vao.lyDo, "Huỷ ghi nhận bài");
  if (!co.bat) return { daHuy: false as const, trangThai: null, lyDo: "TAT" as const };
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  const dong = await tx.studyEntitlementUsage.findUnique({
    where: { entitlementId_lessonOrder: { entitlementId: e.id, lessonOrder: vao.lessonOrder } },
  });
  if (!dong || dong.voidedAt !== null) return { daHuy: false, trangThai: e.status };

  await tx.studyEntitlementUsage.update({ where: { id: dong.id }, data: { voidedAt: vao.now, voidReason: vao.lyDo } });
  const { daTieuThu } = await ganLaiTieuThu(tx, e.id);
  let trangThai: TrangThaiQuyenHoc = e.status;
  if (e.status === "EXHAUSTED" && tinhConLai(tomTat(e), daTieuThu) > 0) {
    trangThai = chuyenTrangThaiHopLe(e.status, "MO_LAI");
    await tx.studyEntitlement.update({ where: { id: e.id }, data: { status: trangThai, graceStartedAt: null } });
  }
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "USAGE_VOID",
    newValues: { lessonOrder: vao.lessonOrder, daTieuThu, status: trangThai },
    reason: vao.lyDo,
    orgUnitId: e.centerId,
    tx,
  });
  return { daHuy: true, trangThai };
}

export async function huyGhiNhanBai(
  vao: HuyGhiNhanBaiInput,
  dep: PhuThuoc = PHU_THUOC_MAC_DINH,
): Promise<{ daHuy: boolean; trangThai: TrangThaiQuyenHoc }> {
  kiemLyDo(vao.lyDo, "Huỷ ghi nhận bài");
  const centerId = await coSoCuaQuyen(vao.entitlementId);
  await canBat(dep, centerId);
  const r = await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, vao, { centerId, bat: true }));
  // Nhánh không thể xảy ra (cờ đã bật ở trên) — nhưng thu hẹp kiểu bằng một cổng thật, không bằng `!`.
  if (r.trangThai === null) throw new LoiQuyenHoc("TAT", LOI_PHAM_VI_TAT);
  return { daHuy: r.daHuy, trangThai: r.trangThai };
}

// ── DỪNG HỌC / HUỶ HOÀN (đóng quyền học) ────────────────────────────────────────────────────

export interface DungQuyenHocInput {
  entitlementId: string;
  /** Bắt buộc: dừng học là đóng quyền lợi đã mua — phải truy được vì sao. */
  lyDo: string;
  actor: AuditActor;
  now: Date;
}

/**
 * Đóng một quyền học vì đơn dừng học / huỷ hoàn, TRONG transaction của người gọi:
 *   · chưa xếp lớp (AWAITING_PLACEMENT)        → `HUY_HOAN` → VOIDED (nhả `orderItemId` để cấp lại được);
 *   · ACTIVE / FROZEN / EXHAUSTED              → `DUNG_HOC` → STOPPED (ghi `effectiveTo = now`);
 *   · còn lại (kể cả SEAT_HOLD, đã đóng)        → ném `TRANG_THAI` — máy trạng thái chưa có cạnh, và thêm
 *     cạnh là quyết định nghiệp vụ, không phải việc của tầng ghi.
 *
 * ⚠️ KHÔNG nhận `CoPhamVi` — CỐ Ý. Đây là bước ĐÓNG, đi một chiều về trạng thái cuối, và chỉ chạy trên dòng
 * đã tồn tại. Bắt nó chờ cờ nghĩa là tắt cờ sau khi đã cấp quyền học sẽ làm đơn dừng học KHÔNG đóng được quyền
 * học, hoặc ném `TAT` và cuộn ngược cả việc hoàn tiền (nên hoàn theo quyền học vẫn phải chạy sau khi tắt cờ).
 * Người gọi muốn "cờ tắt ⇒ không đụng quyền học" thì tự không gọi hàm này. Khung dữ liệu `frozen*` được giữ nguyên
 * làm dấu vết; đọc "đang bảo lưu" phải theo `status`, không theo `frozenUntil`.
 */
export async function dungQuyenHocTrongTx(
  tx: Tx,
  vao: DungQuyenHocInput,
): Promise<{ quyenHoc: StudyEntitlement; suKien: "DUNG_HOC" | "HUY_HOAN" }> {
  kiemLyDo(vao.lyDo, "Dừng quyền học");
  const e = await khoaVaDoc(tx, vao.entitlementId);
  const suKien = e.status === "AWAITING_PLACEMENT" ? ("HUY_HOAN" as const) : ("DUNG_HOC" as const);
  const den = chuyenTrangThaiHopLe(e.status, suKien);
  const moi = await tx.studyEntitlement.update({
    where: { id: e.id },
    data: { status: den, ...(den === "STOPPED" ? { effectiveTo: vao.now } : {}) },
  });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: suKien === "HUY_HOAN" ? "VOID" : "STOP",
    oldValues: { status: e.status },
    newValues: { status: moi.status },
    reason: vao.lyDo,
    orgUnitId: e.centerId,
    tx,
  });
  return { quyenHoc: moi, suKien };
}

// ── BẢO LƯU / PHỤC HỌC ──────────────────────────────────────────────────────────────────────

export interface DongBangQuyenHocInput {
  entitlementId: string;
  reserveId: string;
  frozenUntil: Date;
  actor: AuditActor;
  now: Date;
}

export async function dongBangQuyenHocTrongTx(tx: Tx, vao: DongBangQuyenHocInput, co: CoPhamVi): Promise<StudyEntitlement> {
  kiemHanBang(vao.frozenUntil, vao.now);
  canCoDaBat(co);
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  if (!coTheBaoLuu(e.status)) throw new LoiQuyenHoc("TRANG_THAI", `Quyền học đang ${e.status}, không bảo lưu được.`);
  const moi = await tx.studyEntitlement.update({
    where: { id: e.id },
    data: {
      status: chuyenTrangThaiHopLe(e.status, "BAO_LUU"),
      statusBeforeFreeze: e.status,
      frozenAt: vao.now,
      frozenUntil: vao.frozenUntil,
      frozenReserveId: vao.reserveId,
    },
  });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "FREEZE",
    oldValues: { status: e.status },
    newValues: { status: moi.status, frozenUntil: vao.frozenUntil.toISOString(), reserveId: vao.reserveId },
    orgUnitId: e.centerId,
    tx,
  });
  return moi;
}

export async function dongBangQuyenHoc(vao: DongBangQuyenHocInput, dep: PhuThuoc = PHU_THUOC_MAC_DINH): Promise<StudyEntitlement> {
  kiemHanBang(vao.frozenUntil, vao.now);
  const centerId = await coSoCuaQuyen(vao.entitlementId);
  await canBat(dep, centerId);
  return await db.$transaction((tx) => dongBangQuyenHocTrongTx(tx, vao, { centerId, bat: true }));
}

export interface MoBangQuyenHocInput {
  entitlementId: string;
  actor: AuditActor;
  now: Date;
}

export async function moBangQuyenHocTrongTx(tx: Tx, vao: MoBangQuyenHocInput, co: CoPhamVi): Promise<StudyEntitlement> {
  canCoDaBat(co);
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  const den = chuyenTrangThaiHopLe(e.status, "PHUC_HOC", e.statusBeforeFreeze);
  const moi = await tx.studyEntitlement.update({
    where: { id: e.id },
    data: { status: den, statusBeforeFreeze: null, frozenAt: null, frozenUntil: null, frozenReserveId: null },
  });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "UNFREEZE",
    oldValues: { status: e.status },
    newValues: { status: moi.status },
    orgUnitId: e.centerId,
    tx,
  });
  return moi;
}

export async function moBangQuyenHoc(vao: MoBangQuyenHocInput, dep: PhuThuoc = PHU_THUOC_MAC_DINH): Promise<StudyEntitlement> {
  const centerId = await coSoCuaQuyen(vao.entitlementId);
  await canBat(dep, centerId);
  return await db.$transaction((tx) => moBangQuyenHocTrongTx(tx, vao, { centerId, bat: true }));
}

/**
 * Dời hạn bảo lưu khi hồ sơ bảo lưu được gia hạn. Nguồn sự thật của hạn là hồ sơ bảo lưu; `frozenUntil` chỉ là
 * bản sao, nên phải đổi CÙNG transaction với hồ sơ — kẻo hai nơi lệch hạn. Chỉ nhận quyền học ĐANG đóng băng
 * đúng bởi hồ sơ `reserveId` (đóng băng bởi hồ sơ khác ⇒ `DAU_VAO`, không dời hạn của người khác).
 */
export async function capNhatHanBangTrongTx(
  tx: Tx,
  vao: { entitlementId: string; reserveId: string; frozenUntil: Date; actor: AuditActor; now: Date },
  co: CoPhamVi,
): Promise<StudyEntitlement> {
  kiemHanBang(vao.frozenUntil, vao.now);
  canCoDaBat(co);
  const e = await khoaVaDoc(tx, vao.entitlementId);
  canCoDungCoSo(co, e.centerId);
  if (e.status !== "FROZEN") throw new LoiQuyenHoc("TRANG_THAI", `Quyền học đang ${e.status}, không có hạn bảo lưu để dời.`);
  if (e.frozenReserveId !== vao.reserveId) throw new LoiQuyenHoc("DAU_VAO", "Quyền học đang đóng băng bởi hồ sơ bảo lưu khác.");
  const moi = await tx.studyEntitlement.update({ where: { id: e.id }, data: { frozenUntil: vao.frozenUntil } });
  await writeAudit({
    actor: vao.actor,
    module: "entitlements",
    entityType: "StudyEntitlement",
    entityId: e.id,
    action: "FREEZE_EXTEND",
    oldValues: { frozenUntil: e.frozenUntil?.toISOString() ?? null },
    newValues: { frozenUntil: vao.frozenUntil.toISOString(), reserveId: vao.reserveId },
    orgUnitId: e.centerId,
    tx,
  });
  return moi;
}

// ── ĐỌC ─────────────────────────────────────────────────────────────────────────────────────
// `client` là `scopedDb(actor)` (admin/teacher) hoặc `portalDb` (portal) — tầng này KHÔNG tự bypass cách ly.
// Hàm đọc nhận kiểu CẤU TRÚC tối thiểu để cả `db` trần (cron, chỉ trong lib/entitlements) lẫn `scopedDb` đều vừa.
// Kiểu CẤU TRÚC tối thiểu (một hàm `findMany`), không phải `Pick<PrismaClient["studyEntitlement"], …>`: client
// đã `$extends` (scopedDb) có kiểu delegate khác nên `Pick` không nhận.
export type DocQuyenHoc = {
  studyEntitlement: { findMany: (args: Prisma.StudyEntitlementFindManyArgs) => PromiseLike<StudyEntitlement[]> };
};

const TRANG_THAI_DANG_MO: TrangThaiQuyenHoc[] = ["ACTIVE", "EXHAUSTED", "SEAT_HOLD", "FROZEN", "AWAITING_PLACEMENT"];

export function docQuyenHocDangMo(client: DocQuyenHoc, studentId: string, courseId?: string) {
  return client.studyEntitlement.findMany({
    where: { studentId, ...(courseId ? { courseId } : {}), status: { in: TRANG_THAI_DANG_MO } },
    orderBy: [{ startLessonOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Quyền học của NHIỀU học viên trong MỘT câu (roster, sĩ số, điểm danh theo lô — tránh N+1).
 *
 * Lấy MỌI trạng thái trừ VOIDED, khác `docQuyenHocDangMo` (chỉ trạng thái "đang mở"): người gọi roster phải
 * phân biệt "chưa từng có quyền học" (danh sách rỗng = LEGACY, giữ đường cũ) với "có quyền học nhưng đã hết"
 * (COMPLETED/EXPIRED/STOPPED ⇒ không phải LEGACY). Lọc bớt trạng thái ở đây là biến cái sau thành cái trước —
 * học viên hết quyền bị đọc như học viên cũ và vào roster như chưa có gì xảy ra.
 *
 * Trả về `Map` có ĐỦ mọi `studentId` được hỏi (không có quyền học ⇒ `[]`), để người gọi không phải phân biệt
 * "không có khoá" với "danh sách rỗng". `courseId = null` ⇒ mọi khoá; BẮT BUỘC truyền để không quên lọc khoá.
 */
export async function docQuyenHocTheoHocVien(
  client: DocQuyenHoc,
  studentIds: readonly string[],
  courseId: string | null,
): Promise<Map<string, StudyEntitlement[]>> {
  const ids = [...new Set(studentIds)];
  const ra = new Map<string, StudyEntitlement[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return ra;
  const ds = await client.studyEntitlement.findMany({
    where: { studentId: { in: ids }, ...(courseId ? { courseId } : {}), status: { not: "VOIDED" } },
    orderBy: [{ startLessonOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  for (const e of ds) ra.get(e.studentId)?.push(e);
  return ra;
}

/** Quyền học (đang dạy được) mà phạm vi hoặc dải ân hạn CHỨA bài này. `null` = không quyền học nào. */
export async function timQuyenHocChoBai(
  client: DocQuyenHoc,
  vao: { studentId: string; courseId: string; lessonOrder: number },
): Promise<StudyEntitlement | null> {
  const ds = await client.studyEntitlement.findMany({
    where: { studentId: vao.studentId, courseId: vao.courseId, status: { in: ["ACTIVE", "EXHAUSTED"] }, startLessonOrder: { not: null } },
    orderBy: { startLessonOrder: "asc" },
  });
  return (
    ds.find(
      (e) =>
        e.startLessonOrder !== null &&
        e.endLessonOrder !== null &&
        vao.lessonOrder >= e.startLessonOrder &&
        vao.lessonOrder <= e.endLessonOrder + e.graceSessionsGranted,
    ) ?? null
  );
}
