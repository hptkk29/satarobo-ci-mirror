// lib/_handlers/hoc-bu-case-notif.ts — T13 (08/10/2026): consumer của các DomainEvent học bù theo case.
// Ma trận "sự kiện ⇒ ai nhận ⇒ nói gì" ở `lib/hoc-bu/thong-bao-thuan.ts`; handler chỉ ĐỌC dữ liệu hiện tại rồi ghi thông báo.
//
//   · Idempotent theo khoá của sự kiện (outbox phát lại không nhân đôi).
//   · Tin nói đúng dữ liệu LÚC XỬ LÝ; case đã huỷ / bé đã bị gỡ thì bỏ qua — không báo về một lịch không còn.
//   · Không đi qua kênh trả phí (ZNS): phụ huynh nhận ở cổng, nhân sự nhận ở chuông (kèm Web Push nếu đã bật trong cấu hình đẩy).
import { on, type DomainEventLite } from "@/lib/events/registry";
import { publishEvent } from "@/lib/events/publish";
import { scopedDb } from "@/lib/db-scope";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { quanLyCoSo } from "@/lib/notifications/nguoi-nhan-phia-sale";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import {
  baoNhanSu,
  baoPhuHuynh,
  docCaseDeBao,
  nguoiNhanSaleCuaHocVien,
  type BeDeBao,
  type CaseDeBao,
} from "@/lib/hoc-bu/thong-bao-db";
import {
  khoaSuKien,
  lietKeThayDoi,
  SU_KIEN,
  tinGiaoVienDaXep,
  tinGiaoVienDoiLich,
  tinGiaoVienDoiNguoi,
  tinGiaoVienHuy,
  tinGiaoVienNhac,
  tinPhuHuynhDaXep,
  tinPhuHuynhDoiLich,
  tinPhuHuynhHuy,
  tinPhuHuynhKetQua,
  tinPhuHuynhNhac,
  tinQuaHan,
  tinQuanLyGvKhongConCa,
  tinSaleBeVang,
  tinSaleCanThuPhi,
  type KhungCase,
  type NguCanhCase,
} from "@/lib/hoc-bu/thong-bao-thuan";

const str = (v: unknown): string => (v == null ? "" : String(v));
const so = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const baiCuaBe = (be: BeDeBao): string[] => [...new Set(be.muc.filter((m) => m.result !== "RELEASED").map((m) => m.tenBai))];
const baiCuaBeKeCaDaNha = (be: BeDeBao): string[] => [...new Set(be.muc.map((m) => m.tenBai))];

function nguCanhBe(c: CaseDeBao, be: BeDeBao, baiCua: (b: BeDeBao) => string[] = baiCuaBe): NguCanhCase {
  return { tenBe: be.tenBe, ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, tenGv: c.tenGv, tenPhong: c.tenPhong, tenBai: baiCua(be) };
}
const beDangCho = (c: CaseDeBao): BeDeBao[] => c.be.filter((b) => b.attendanceStatus === "PENDING");

// ─── makeup.case.scheduled → phụ huynh của bé + giáo viên của case ─────────────────────────────────────────────────────────────────
export async function onCaseDaXep(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const participantId = str(event.payload.participantId);
  const mucId = str(event.payload.mucId);
  if (!caseId || !participantId || !mucId) return;
  const c = await docCaseDeBao(caseId);
  if (!c || c.status !== "SCHEDULED") return;
  const be = c.be.find((b) => b.id === participantId);
  if (!be || be.attendanceStatus !== "PENDING") return;

  await baoPhuHuynh({ studentId: be.studentId, centerId: c.centerId, dedupeKey: khoaSuKien.caseDaXep(participantId, mucId), tin: tinPhuHuynhDaXep(nguCanhBe(c, be)) });
  // Giáo viên nhận MỘT tin cho cả case (thêm bé về sau không báo lại — số bé hiện trong màn học bù của giáo viên).
  await baoNhanSu({
    userIds: [c.teacherId],
    dedupeKey: `${SU_KIEN.CASE_DA_XEP}:gv:${c.id}`,
    entityId: c.id,
    tin: tinGiaoVienDaXep({ ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, tenPhong: c.tenPhong, tenBai: c.tenBaiCase, soBe: beDangCho(c).length }),
  });
}

// ─── makeup.case.changed → các bé đang chờ + giáo viên (cả giáo viên cũ nếu đổi người) ───────────────────────────────────────────────
export async function onCaseDoi(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const v = so(event.payload.phienBanSau);
  const truoc = event.payload.truoc as KhungCase | undefined;
  const sau = event.payload.sau as KhungCase | undefined;
  if (!caseId || !truoc || !sau) return;
  const doi = lietKeThayDoi(truoc, sau);
  if (doi.length === 0) return;
  const c = await docCaseDeBao(caseId);
  if (!c || c.status !== "SCHEDULED") return;

  for (const be of beDangCho(c)) {
    await baoPhuHuynh({
      studentId: be.studentId,
      centerId: c.centerId,
      dedupeKey: `${khoaSuKien.caseDoi(caseId, v)}:${be.studentId}`,
      tin: tinPhuHuynhDoiLich(nguCanhBe(c, be), doi),
    });
  }
  const ctxGv = { ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, tenPhong: c.tenPhong, tenBai: c.tenBaiCase };
  await baoNhanSu({ userIds: [c.teacherId], dedupeKey: khoaSuKien.caseDoi(caseId, v), entityId: c.id, tin: tinGiaoVienDoiLich(ctxGv, doi) });
  if (truoc.teacherId !== c.teacherId) {
    await baoNhanSu({
      userIds: [truoc.teacherId],
      dedupeKey: `${khoaSuKien.caseDoi(caseId, v)}:cu`,
      entityId: c.id,
      tin: tinGiaoVienDoiNguoi({ ymd: truoc.ymd, gioBatDau: truoc.startTime, gioKetThuc: truoc.endTime, tenBai: c.tenBaiCase }),
    });
  }
}

// ─── makeup.case.cancelled → phụ huynh của bé bị gỡ / giáo viên khi cả case huỷ ──────────────────────────────────────────────────────
export async function onCaseHuy(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  if (!caseId) return;
  const c = await docCaseDeBao(caseId);
  if (!c) return;
  const doiTuong = str(event.payload.doiTuong);

  if (doiTuong === "GIAO_VIEN") {
    // Chỉ khi case THỰC SỰ đã huỷ lúc xử lý (không báo về một huỷ đã được hoàn tác).
    if (c.status !== "CANCELLED") return;
    await baoNhanSu({
      userIds: [str(event.payload.teacherId) || c.teacherId],
      dedupeKey: khoaSuKien.caseHuyGv(caseId),
      entityId: c.id,
      tin: tinGiaoVienHuy({ ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, tenBai: c.tenBaiCase }),
    });
    return;
  }

  const participantId = str(event.payload.participantId);
  const phienBan = so(event.payload.phienBan);
  const be = c.be.find((b) => b.id === participantId);
  // Bé phải THỰC SỰ đã bị gỡ (REMOVED) — nếu đã được xếp lại thì tin "huỷ" là tin sai.
  if (!be || be.attendanceStatus !== "REMOVED") return;
  await baoPhuHuynh({
    studentId: be.studentId,
    centerId: c.centerId,
    dedupeKey: khoaSuKien.caseHuyBe(participantId, phienBan),
    tin: tinPhuHuynhHuy({ tenBe: be.tenBe, ymd: c.ymd, tenBai: baiCuaBeKeCaDaNha(be) }),
  });
}

// ─── makeup.case.reminder → các bé đang chờ + giáo viên (do cron `hoc-bu-nhac` phát) ──────────────────────────────────────────────────
export async function onCaseNhac(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const ymd = str(event.payload.ymd);
  if (!caseId || !ymd) return;
  const c = await docCaseDeBao(caseId);
  // Nhắc theo ngày đã chốt lúc phát: case bị dời sang ngày khác thì lời nhắc cũ không còn đúng.
  if (!c || c.status !== "SCHEDULED" || c.ymd !== ymd) return;
  const cho = beDangCho(c);
  for (const be of cho) {
    await baoPhuHuynh({ studentId: be.studentId, centerId: c.centerId, dedupeKey: `${khoaSuKien.caseNhac(caseId, ymd)}:${be.studentId}`, tin: tinPhuHuynhNhac(nguCanhBe(c, be)) });
  }
  if (cho.length > 0) {
    await baoNhanSu({
      userIds: [c.teacherId],
      dedupeKey: khoaSuKien.caseNhac(caseId, ymd),
      entityId: c.id,
      tin: tinGiaoVienNhac({ ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, tenPhong: c.tenPhong, tenBai: c.tenBaiCase, soBe: cho.length }),
    });
  }
}

// ─── makeup.completed → phụ huynh: kết quả từng bài + đánh giá của giáo viên ──────────────────────────────────────────────────────────
export async function onHoanThanh(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const participantId = str(event.payload.participantId);
  const phienBan = so(event.payload.phienBan);
  if (!caseId || !participantId) return;
  const c = await docCaseDeBao(caseId);
  const be = c?.be.find((b) => b.id === participantId);
  // Bé phải còn ở trạng thái CÓ MẶT (điểm danh có thể đã bị sửa lại thành vắng sau đó — tin "kết quả" khi đó là tin sai).
  if (!c || !be || be.attendanceStatus !== "PRESENT") return;
  const ketQua = be.muc.flatMap((m) => (m.result === "COMPLETED" || m.result === "NOT_COMPLETED" ? [{ tenBai: m.tenBai, ketQua: m.result, danhGia: m.danhGia }] : []));
  if (ketQua.length === 0) return;
  await baoPhuHuynh({
    studentId: be.studentId,
    centerId: c.centerId,
    dedupeKey: khoaSuKien.hoanThanh(participantId, phienBan),
    tin: tinPhuHuynhKetQua({ tenBe: be.tenBe, ymd: c.ymd, ketQua, nhanXetChung: be.nhanXetChung, sua: event.payload.sua === true }),
  });
}

// ─── makeup.absent → Sale của học viên ────────────────────────────────────────────────────────────────────────────────────────────────
export async function onBeVang(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const participantId = str(event.payload.participantId);
  const phienBan = so(event.payload.phienBan);
  if (!caseId || !participantId) return;
  const c = await docCaseDeBao(caseId);
  const be = c?.be.find((b) => b.id === participantId);
  if (!c || !be || be.attendanceStatus !== "ABSENT") return;
  await baoNhanSu({
    userIds: await nguoiNhanSaleCuaHocVien(be.studentId, c.centerId),
    dedupeKey: khoaSuKien.beVang(participantId, phienBan),
    entityId: c.id,
    tin: tinSaleBeVang({ tenBe: be.tenBe, ymd: c.ymd }),
  });
}

// ─── makeup.requested → (chuỗi) makeup.payment-required khi học viên đã HẾT LƯỢT ────────────────────────────────────────────────────────
// Không nhồi phép tính lượt/phí vào giao dịch điểm danh (100 học viên × vài câu): tính ở đây, SAU commit, bằng ĐÚNG hàm màn hình dùng
// (`docDongTheoId` → `phi.loai`) — màn nói "cần thu phí" thì tin cũng nói đúng như vậy.
export async function onYeuCauKiemPhi(event: DomainEventLite): Promise<void> {
  const makeupNeedId = str(event.payload.makeupNeedId);
  if (!makeupNeedId) return;
  const [d] = await docDongTheoId(scopedDb(SYSTEM_ACTOR), [makeupNeedId], null);
  if (!d || d.phi.loai !== "CAN_THU") return;
  await publishEvent(
    SU_KIEN.CAN_THU_PHI,
    { makeupNeedId, studentId: d.studentId, centerId: d.centerId },
    { dedupeKey: khoaSuKien.canThuPhi(makeupNeedId) },
  );
}

// ─── makeup.payment-required → Sale của học viên ─────────────────────────────────────────────────────────────────────────────────────────
export async function onCanThuPhi(event: DomainEventLite): Promise<void> {
  const makeupNeedId = str(event.payload.makeupNeedId);
  const studentId = str(event.payload.studentId);
  if (!makeupNeedId || !studentId) return;
  // Đọc lại LÚC XỬ LÝ: dòng đã được xếp / miễn phí / huỷ thì không còn việc thu phí.
  const [d] = await docDongTheoId(scopedDb(SYSTEM_ACTOR), [makeupNeedId], null);
  // CAN_THU = hết lượt chưa có phí; CHO_THU = có phí nhưng chưa thu đủ (T14: phí thu thiếu sau khi hoàn một phần). Đã thu đủ / miễn phí / còn lượt ⇒ hết việc.
  if (!d || (d.phi.loai !== "CAN_THU" && d.phi.loai !== "CHO_THU")) return;
  const moc = typeof event.payload.moc === "string" && event.payload.moc ? event.payload.moc : null;
  const thieu = typeof event.payload.thieu === "number" && Number.isFinite(event.payload.thieu) ? event.payload.thieu : null;
  await baoNhanSu({
    userIds: await nguoiNhanSaleCuaHocVien(studentId, d.centerId),
    dedupeKey: khoaSuKien.canThuPhi(makeupNeedId, moc),
    entityId: makeupNeedId,
    tin: tinSaleCanThuPhi({ tenBe: d.hocVien, tenBai: d.buoiVang, conThieu: thieu }),
  });
}

// ─── makeup.teacher-unavailable → quản lý cơ sở ─────────────────────────────────────────────────────────────────────────────────────────
export async function onGvKhongConCa(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  const teacherId = str(event.payload.teacherId);
  const ymd = str(event.payload.ymd);
  if (!caseId || !teacherId || !ymd) return;
  const c = await docCaseDeBao(caseId);
  if (!c || c.status !== "SCHEDULED" || c.teacherId !== teacherId || c.ymd !== ymd) return;
  await baoNhanSu({
    userIds: await quanLyCoSo(c.centerId),
    dedupeKey: khoaSuKien.gvKhongConCa(caseId, teacherId, ymd),
    entityId: c.id,
    tin: tinQuanLyGvKhongConCa({ tenGv: c.tenGv, ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, soBe: beDangCho(c).length }),
  });
}

// ─── makeup.overdue → quản lý cơ sở + giáo viên của case ────────────────────────────────────────────────────────────────────────────────
export async function onQuaHan(event: DomainEventLite): Promise<void> {
  const caseId = str(event.payload.caseId);
  if (!caseId) return;
  const c = await docCaseDeBao(caseId);
  if (!c || c.status !== "SCHEDULED") return;
  const cho = beDangCho(c);
  if (cho.length === 0) return;
  const tin = tinQuaHan({ ymd: c.ymd, gioBatDau: c.startTime, gioKetThuc: c.endTime, soBeChoDiemDanh: cho.length });
  const ql = await quanLyCoSo(c.centerId);
  await baoNhanSu({ userIds: [...new Set([...ql, c.teacherId])], dedupeKey: khoaSuKien.quaHan(caseId), entityId: c.id, tin });
}

export function registerHocBuCaseNotifHandlers(): void {
  on(SU_KIEN.CASE_DA_XEP, onCaseDaXep);
  on(SU_KIEN.CASE_DOI, onCaseDoi);
  on(SU_KIEN.CASE_HUY, onCaseHuy);
  on(SU_KIEN.CASE_NHAC, onCaseNhac);
  on(SU_KIEN.HOAN_THANH, onHoanThanh);
  on(SU_KIEN.BE_VANG, onBeVang);
  on(SU_KIEN.CAN_THU_PHI, onCanThuPhi);
  on(SU_KIEN.GV_KHONG_CON_CA, onGvKhongConCa);
  on(SU_KIEN.QUA_HAN, onQuaHan);
  on("makeup.requested", onYeuCauKiemPhi);
}
