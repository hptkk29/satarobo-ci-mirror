import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { layCaCuaNhieuNguoi } from "@/lib/trial/gv-kha-dung-db";
import { caPhuTronKhungGio } from "@/lib/trial/gv-kha-dung";
import { generateOrderCode, withUniqueRetry } from "@/lib/orders/code";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { giaMoiBuoi } from "@/lib/finance/coach-pricing";
import { docDongTheoId, hocVienCuaSale, type DongCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { laDongMienPhi } from "@/lib/hoc-bu/xep-case";
import { CAU_KHONG_CUA_SALE, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { baoGvCaBu } from "@/lib/hoc-bu/bao-gv-db";
import { caseNhanThemV2, kiemBoBai, kiemNhomNhieuBai, TOI_DA_BAI_MOI_CASE } from "@/lib/hoc-bu/case-nhieu-bai-thuan";
import { nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";
import { CHON_MUC, doiKetQuaMuc, nhaMucTrongTx } from "@/lib/hoc-bu/case-diem-danh-db";
import { chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";
import { phatBeBiGo, phatCaseBiHuy, phatCaseDaXep, phatCaseDoi } from "@/lib/hoc-bu/su-kien";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { lietKeThayDoi } from "@/lib/hoc-bu/thong-bao-thuan";
import { giuLuot, khoaTaiKhoan } from "@/lib/hoc-bu/so-luot";
import { canhBaoPhiDaThuKhiHuy, docPhiCuaDong, donPhiConSong } from "@/lib/hoc-bu/phi-dong-db";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { voidTienKhiHuyDonTrongTx } from "@/lib/orders/huy-don-tien";
import { checkScheduleConflicts, dungThongDiepXungDot, khoaLichTrongTx, ketQuaAnToan, type KhungYeuCau } from "@/lib/lms/schedule-conflict";
import type { LoaiTru } from "@/lib/lms/lich-xung-dot";

// CASE DẠY BÙ — đường ghi (docs/hoc-bu/DAC-TA.md §2–3). Quyền hỏi ở server action; ở đây là
// LUẬT NGHIỆP VỤ + phép ghi. Mọi cổng đứng TRƯỚC phép ghi đầu tiên, và từ chối trong
// `$transaction` là `throw` (CLAUDE.md, "Luật rollback").

import { LoiHocBu, LoiTrungLich } from "@/lib/hoc-bu/loi";
import { vnYmd } from "@/lib/time/vn";
import { writeAudit } from "@/lib/audit/audit-log";
export { LoiHocBu, LoiTrungLich }; // tên cũ vẫn import được từ đây
// T07: điểm danh hai tầng + sửa điểm danh sống ở `case-diem-danh-db.ts`; tên cũ `diemDanhBu` vẫn import được từ đây.
export { diemDanhBu, diemDanhBe, suaDiemDanhBe, ghiDanhGiaMuc, type KetQuaMucNhapDay, type TuyChonDiemDanh, type TuyChonSuaDiemDanh } from "@/lib/hoc-bu/case-diem-danh-db";

const GIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Nửa đêm UTC của ngày VN — đúng hình dạng cột `@db.Date` và `workDate` của lưới ca. */
export function ngayTuYmd(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new LoiHocBu("Ngày dạy bù không hợp lệ");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export type GvTrongCa = { id: string; name: string; ma: string };

/**
 * Giáo viên CÓ CA LÀM phủ trọn khung giờ bù, ở đúng cơ sở của case (chốt: "phải lấy giáo viên
 * trong ca làm việc"). Dùng CHUNG cho ô chọn và cho cổng ở máy chủ — ô chọn bày ai thì máy chủ
 * nhận đúng người đó (luật 12). Phép "phủ trọn" là `caPhuTronKhungGio` của ô chọn GV trial.
 */
export async function gvTrongCa(
  actor: Actor,
  p: { centerId: string; ymd: string; startTime: string; endTime: string },
): Promise<{ ds: GvTrongCa[]; lyDoRong: string | null }> {
  if (!GIO.test(p.startTime) || !GIO.test(p.endTime) || p.startTime >= p.endTime) {
    return { ds: [], lyDoRong: "Giờ bắt đầu phải trước giờ kết thúc" };
  }
  const giaoVien = await getAssignableTeachers();
  const ca = await layCaCuaNhieuNguoi(
    actor,
    giaoVien.map((g) => g.id),
    ngayTuYmd(p.ymd),
  );
  if (!ca.luoiDaSinh) {
    return { ds: [], lyDoRong: "Lưới ca của ngày này chưa sinh — chưa biết giáo viên nào trong ca" };
  }
  const ds: GvTrongCa[] = [];
  for (const g of giaoVien) {
    const o = ca.theoNguoi[g.id] ?? null;
    if (!o) continue;
    // Ca gắn cơ sở khác ⇒ người đó đang làm ở nơi khác (ca không gắn cơ sở thì không loại).
    if (o.centerId !== null && o.centerId !== p.centerId) continue;
    const phu = caPhuTronKhungGio({
      ca: o,
      khung: { startTime: p.startTime, endTime: p.endTime },
      luoiDaSinh: true,
      coTrongLuoi: ca.coTrongLuoi.has(g.id),
    });
    if (phu === "PHU_TRON") ds.push({ id: g.id, name: g.name ?? "Giáo viên", ma: o.ma });
  }
  ds.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return {
    ds,
    lyDoRong: ds.length ? null : "Không giáo viên nào có ca làm phủ trọn khung giờ này ở cơ sở này",
  };
}

/**
 * Đọc lại dòng cần bù ở máy chủ và kiểm đủ luật — màn hình không được tin.
 * T07: các dòng chọn cùng lúc có thể vắng NHIỀU bài khác nhau (tối đa 3 bài khác nhau, cùng cơ sở + khoá) — case dạy cả bộ bài.
 */
async function kiemDongXep(actor: NguoiHocBu, needIds: string[]): Promise<{ dong: DongCanBu[]; baiCuaDong: string[] }> {
  const ids = [...new Set(needIds)];
  if (ids.length === 0) throw new LoiHocBu("Chưa chọn học viên nào");
  const dong = await docDongTheoId(scopedDb(actor), ids, actor.chiCuaSale);
  if (dong.length !== ids.length) {
    throw new LoiHocBu(
      actor.chiCuaSale ? "Có học viên đã được xếp/huỷ hoặc không thuộc danh sách bạn phụ trách — tải lại trang" : "Có học viên đã được xếp/huỷ — tải lại trang",
    );
  }
  const nhom = kiemNhomNhieuBai(dong.map((d) => ({ centerId: d.centerId, courseId: d.courseId, lessonId: d.lessonId, hocVien: d.hocVien })));
  if (!nhom.ok) throw new LoiHocBu(nhom.lyDo);
  for (const d of dong) {
    if (!d.xep.ok) throw new LoiHocBu(`${d.hocVien}: ${d.xep.lyDo}`);
  }
  // HB-20: mỗi dòng nhìn riêng đều thấy "còn 1 lượt", nhưng ba dòng của CÙNG một bé không xếp hết bằng một lượt. Sổ lượt
  // (`giuLuot`) vẫn là cổng cuối cùng và ném khi hết; kiểm ở đây chỉ để câu lỗi nói đúng thay vì "hết lượt" trơ trọi.
  const dungLuotTheoBe = new Map<string, { n: number; con: number; ten: string }>();
  for (const d of dong) {
    if (!d.xep.ok || !d.xep.dungLuot) continue;
    const k = `${d.studentId}|${d.courseId}`;
    const cu = dungLuotTheoBe.get(k) ?? { n: 0, con: d.luot.con, ten: d.hocVien };
    cu.n += 1;
    dungLuotTheoBe.set(k, cu);
  }
  for (const v of dungLuotTheoBe.values()) {
    if (v.n > v.con) {
      throw new LoiHocBu(`${v.ten}: chọn ${v.n} buổi bằng lượt nhưng chỉ còn ${v.con} lượt — bỏ bớt buổi hoặc thu phí bù`);
    }
  }
  return { dong, baiCuaDong: nhom.lessonIds };
}

/**
 * T10 (HB-23): Sale chỉ thao tác trên học viên MÌNH PHỤ TRÁCH — chặn Ở MÁY CHỦ, không dựa vào việc giao diện ẩn nút. `chiCuaSale = null` (quản lý) không bị chặn.
 * Đọc bằng `db` trần: câu hỏi là "học viên này có thuộc Sale này không" (quan hệ ghi danh / phiếu lead), không phải dữ liệu bày ra.
 */
async function chanNeuKhongCuaSale(actor: NguoiHocBu, studentIds: readonly string[]): Promise<void> {
  if (actor.chiCuaSale === null) return;
  const duy = [...new Set(studentIds)];
  if (duy.length === 0) return;
  const cua = await db.student.count({ where: { id: { in: duy }, ...hocVienCuaSale(actor.chiCuaSale) } });
  if (cua !== duy.length) throw new LoiHocBu(CAU_KHONG_CUA_SALE);
}

/** Sale sửa / huỷ MỘT CASE chỉ khi MỌI bé còn trong case là học viên của mình — case có bé của Sale khác thì chỉ quản lý đụng vào được. */
async function chanNeuCaseCoBeNguoiKhac(actor: NguoiHocBu, caseId: string): Promise<void> {
  if (actor.chiCuaSale === null) return;
  const be = await db.makeupCaseParticipant.findMany({
    where: { caseId, attendanceStatus: { not: "REMOVED" } },
    select: { studentId: true },
  });
  const tuMuc = await db.makeupCaseStudent.findMany({
    where: { caseId, participantId: null, result: { not: "RELEASED" } },
    select: { makeupNeed: { select: { studentId: true } } },
  }); // case đời cũ chưa nâng cấp: bé nằm ở mục, chưa có participant
  await chanNeuKhongCuaSale(actor, [...be.map((b) => b.studentId), ...tuMuc.map((m) => m.makeupNeed.studentId)]);
}

async function phanLoaiBu(): Promise<string | null> {
  const bu = await db.sessionCategory.findUnique({ where: { code: "BU" }, select: { id: true, isActive: true } });
  return bu?.isActive ? bu.id : null;
}

/** Mọi bài phải thuộc giáo trình của đúng khoá của case — bộ bài không được trộn khoá. */
async function kiemBaiThuocKhoa(nguon: Pick<Tx, "lesson">, courseId: string, lessonIds: readonly string[]): Promise<void> {
  const co = await nguon.lesson.findMany({
    where: { id: { in: [...lessonIds] }, curriculum: { courseId } },
    select: { id: true },
  });
  if (co.length !== lessonIds.length) throw new LoiHocBu("Có bài không thuộc khoá của case — bộ bài chỉ gồm bài của cùng một khoá");
}

/**
 * T09 — KHOÁ + KIỂM trùng lịch ngay trước phép ghi, TRONG transaction. Một khoá advisory hẹp mỗi (GV | phòng | học viên) × ngày
 * (`khoaLichTrongTx`) rồi kiểm lại bằng CHÍNH lõi mà lớp chính và lớp trial dùng (`checkScheduleConflicts`): hai người xếp cùng một GV
 * vào cùng ngày xếp hàng và người sau thấy kết quả đã commit của người trước. Trùng ⇒ `LoiTrungLich` (rollback cả lượt, không ghi nửa
 * chừng) với câu nói cụ thể từng trùng. `exclude` dành cho SỬA case (T07): không được trùng với chính nó.
 *
 * Giới hạn đã biết: chỉ đường ghi có gọi hàm này mới xếp hàng. Đường ghi lớp chính dùng cùng khoá ở `adjustSession`; các đường khác
 * (sinh buổi hàng loạt…) chỉ CẢNH BÁO — xem chú thích trong `lib/lms/schedule-conflict.ts`.
 */
export async function kiemLichTrongTx(
  tx: Tx,
  p: { actor: Actor; khung: KhungYeuCau; teacherId?: string | null; roomId?: string | null; studentIds?: readonly string[]; exclude?: readonly LoaiTru[] },
): Promise<void> {
  await khoaLichTrongTx(tx, p);
  const kq = await checkScheduleConflicts(
    { khung: p.khung, teacherId: p.teacherId, roomId: p.roomId, studentIds: p.studentIds, exclude: p.exclude },
    tx,
  );
  if (!kq.coXungDot) return;
  const cau = await dungThongDiepXungDot(kq, { actor: p.actor });
  // `ketQua` đi theo lỗi ra ngoài ⇒ gỡ metadata của nguồn ngoài tầm nhìn; phép kiểm đã BLOCK như thường.
  throw new LoiTrungLich(`Trùng lịch — ${cau.join(" ")}`, ketQuaAnToan(kq, p.actor));
}

async function kiemGvVaPhong(
  actor: Actor,
  p: { centerId: string; ymd: string; startTime: string; endTime: string; teacherId: string; roomId: string | null },
): Promise<void> {
  const gv = await gvTrongCa(actor, { centerId: p.centerId, ymd: p.ymd, startTime: p.startTime, endTime: p.endTime });
  if (!gv.ds.some((g) => g.id === p.teacherId)) {
    throw new LoiHocBu(gv.lyDoRong ?? "Giáo viên này không có ca làm phủ khung giờ bù");
  }
  if (p.roomId) {
    const phong = await scopedDb(actor).room.findFirst({
      where: { id: p.roomId, centerId: p.centerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!phong) throw new LoiHocBu("Phòng không thuộc cơ sở này");
  }
}

export async function taoCaseVaXep(
  actor: NguoiHocBu,
  p: {
    needIds: string[];
    ymd: string;
    startTime: string;
    endTime: string;
    roomId: string | null;
    teacherId: string;
    note: string | null;
    /**
     * Bộ bài của case (1–3 bài, bài ĐẦU là bài chính). Bỏ trống = đúng các bài của các dòng được chọn. Có khai thì PHẢI chứa mọi bài của
     * các dòng được chọn — thêm bài để sau này nhận thêm bé vắng bài khác.
     */
    lessonIds?: string[];
  },
): Promise<string> {
  const { dong, baiCuaDong } = await kiemDongXep(actor, p.needIds);
  const dau = dong[0]!;
  const centerId = dau.centerId!;
  let boBai = baiCuaDong;
  if (p.lessonIds !== undefined) {
    const khai = kiemBoBai(p.lessonIds);
    if (!khai.ok) throw new LoiHocBu(khai.lyDo);
    const thieu = baiCuaDong.filter((b) => !khai.ids.includes(b));
    if (thieu.length > 0) throw new LoiHocBu("Bộ bài của case phải gồm mọi bài mà các bé được chọn đang vắng");
    boBai = khai.ids;
  }
  await kiemBaiThuocKhoa(db, dau.courseId, boBai);
  await kiemGvVaPhong(actor, { centerId, ymd: p.ymd, startTime: p.startTime, endTime: p.endTime, teacherId: p.teacherId, roomId: p.roomId });
  const sessionCategoryId = await phanLoaiBu();

  const caseId = await db.$transaction(async (tx) => {
    // T09: GV + phòng + TỪNG học viên so với lớp chính, lớp trial và case dạy bù khác — trước phép ghi đầu tiên.
    await kiemLichTrongTx(tx, {
      actor,
      khung: { ymd: p.ymd, startTime: p.startTime, endTime: p.endTime },
      teacherId: p.teacherId,
      roomId: p.roomId,
      studentIds: dong.map((d) => d.studentId),
    });
    const c = await tx.makeupCase.create({
      data: {
        centerId,
        courseId: dau.courseId,
        lessonId: boBai[0]!,
        date: ngayTuYmd(p.ymd),
        startTime: p.startTime,
        endTime: p.endTime,
        roomId: p.roomId,
        teacherId: p.teacherId,
        sessionCategoryId,
        note: p.note,
        createdById: actor.userId,
      },
      select: { id: true, orgUnitId: true },
    });
    await tx.makeupCaseLesson.createMany({ data: boBai.map((lessonId, i) => ({ caseId: c.id, lessonId, order: i + 1 })) });
    await ghiBeVaoCase(tx, c, centerId, dong, actor.userId);
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.tao-case",
      orgUnitId: c.orgUnitId,
      newValues: { ymd: p.ymd, startTime: p.startTime, endTime: p.endTime, teacherId: p.teacherId, roomId: p.roomId, lessonIds: boBai, needIds: p.needIds },
    });
    return c.id;
  });
  // T13: báo giáo viên khi TẠO ca đi qua DomainEvent `makeup.case.scheduled` (trong giao dịch) — KHÔNG gọi `baoGvCaBu("ca-moi")` nữa kẻo giáo viên nhận hai tin.
  return caseId;
}

export async function xepVaoCaseCoSan(actor: NguoiHocBu, p: { caseId: string; needIds: string[] }): Promise<void> {
  const { dong } = await kiemDongXep(actor, p.needIds);
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: p.caseId },
    select: {
      id: true,
      orgUnitId: true,
      centerId: true,
      courseId: true,
      lessonId: true,
      status: true,
      date: true,
      startTime: true,
      endTime: true,
      lessons: { select: { lessonId: true } },
    },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  // Case đời cũ chưa có bộ bài: bộ bài = bài chính của nó.
  const lessonIds = c.lessons.length > 0 ? c.lessons.map((l) => l.lessonId) : [c.lessonId];
  const nhan = caseNhanThemV2(
    { status: c.status, centerId: c.centerId, courseId: c.courseId, lessonIds },
    dong.map((d) => ({ centerId: d.centerId, courseId: d.courseId, lessonId: d.lessonId, hocVien: d.hocVien })),
  );
  if (!nhan.ok) throw new LoiHocBu(nhan.lyDo);
  await db.$transaction(async (tx) => {
    // Khoá hàng case: thêm bé và điểm danh / sửa / huỷ case không được chen nhau (đọc trạng thái case trong khoá, không tin lần đọc ngoài).
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    const song = await tx.makeupCase.findUnique({ where: { id: c.id }, select: { status: true } });
    if (song?.status !== "SCHEDULED") throw new LoiHocBu("Case đã điểm danh hoặc đã huỷ — tải lại trang");
    // T09: chỉ THÊM học viên — GV/phòng của case không đổi nên không kiểm lại; kiểm từng bé mới (loại chính case này).
    await kiemLichTrongTx(tx, {
      actor,
      khung: { ymd: c.date.toISOString().slice(0, 10), startTime: c.startTime, endTime: c.endTime },
      studentIds: dong.map((d) => d.studentId),
      exclude: [{ type: "MAKEUP_CASE", id: c.id }],
    });
    await ghiBeVaoCase(tx, c, c.centerId, dong, actor.userId);
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.xep-vao-case",
      orgUnitId: c.orgUnitId,
      newValues: { them: dong.map((d) => ({ makeupNeedId: d.id, studentId: d.studentId, lessonId: d.lessonId })) },
    });
  });
  // Còn lại MỘT đường của `bao-gv`: xếp THÊM bé vào ca có sẵn (T13 báo giáo viên một lần/ca nên không phủ lượt xếp thêm).
  await baoGvCaBu("them-hv", c.id, actor.userId);
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Xuất để test dựng trực tiếp (tạo case qua `taoCaseVaXep` cần lưới ca giáo viên). Đường thật vẫn chỉ qua hai hàm xếp ở trên.
 *
 * T07: tạo / kích hoạt lại `MakeupCaseParticipant` của từng bé và một MỤC cho từng dòng cần bù. TOÀN BỘ kiểm tra (bài ∈ bộ bài, tối đa 3 mục,
 * không trùng bài) đứng TRƯỚC phép ghi đầu tiên — một mục sai là cả lượt thêm không ghi gì (không nửa chừng).
 */
export async function ghiBeVaoCase(
  tx: Tx,
  c: { id: string; orgUnitId: string | null },
  centerId: string,
  dong: DongCanBu[],
  addedById: string,
): Promise<void> {
  // Case đời cũ được nâng tại chỗ (idempotent) để mọi mục của case đều có bé tham gia — rồi mới thêm.
  await nangCapCase(tx, c.id);
  const baiCase = new Set((await tx.makeupCaseLesson.findMany({ where: { caseId: c.id }, select: { lessonId: true } })).map((l) => l.lessonId));
  for (const d of dong) {
    if (!d.lessonId || !baiCase.has(d.lessonId)) throw new LoiHocBu(`${d.hocVien}: bài vắng không nằm trong bộ bài của case`);
  }
  const beDaCo = await tx.makeupCaseParticipant.findMany({
    where: { caseId: c.id, studentId: { in: [...new Set(dong.map((d) => d.studentId))] } },
    select: { id: true, studentId: true, attendanceStatus: true },
  });
  const theoBe = new Map(beDaCo.map((b) => [b.studentId, b]));
  for (const d of dong) {
    const b = theoBe.get(d.studentId);
    if (b && (b.attendanceStatus === "PRESENT" || b.attendanceStatus === "ABSENT")) {
      throw new LoiHocBu(`${d.hocVien}: đã được điểm danh trong case này — không thêm buổi bù được nữa`);
    }
  }
  const mucSong = await tx.makeupCaseStudent.findMany({
    where: { participantId: { in: beDaCo.map((b) => b.id) }, result: { not: "RELEASED" } },
    select: { participantId: true, lessonId: true },
  });
  // Tối đa 3 mục mỗi bé trong một case (bằng số bài tối đa của case). Đếm cả mục đã có lẫn mục sắp thêm — cả lượt không ghi gì nếu vượt.
  const demTheoBe = new Map<string, number>();
  for (const m of mucSong) {
    const k = beDaCo.find((b) => b.id === m.participantId)!.studentId;
    demTheoBe.set(k, (demTheoBe.get(k) ?? 0) + 1);
  }
  for (const d of dong) {
    const n = (demTheoBe.get(d.studentId) ?? 0) + 1;
    demTheoBe.set(d.studentId, n);
    if (n > TOI_DA_BAI_MOI_CASE) throw new LoiHocBu(`${d.hocVien}: một bé học tối đa ${TOI_DA_BAI_MOI_CASE} bài trong một case`);
  }

  // Cổng chống đua đứng TRƯỚC: chỉ dòng còn PENDING (và chưa bị huỷ tay) mới chuyển; lệch số ⇒ throw ⇒ rollback cả case.
  // Cạnh PENDING→SCHEDULED/XEP_CASE ở bảng `dong-trang-thai.ts` — mọi đổi trạng thái đi qua `chuyenTrangThaiDong` (T05).
  await chuyenTrangThaiDong(tx, {
    ids: dong.map((d) => d.id),
    tu: "PENDING",
    sang: "SCHEDULED",
    lyDo: "XEP_CASE",
    ngoai: { waivedAt: null },
  });
  // Khởi tạo tài khoản (nếu chưa có) TRƯỚC khi tạo mục case: phát lại dữ liệu cũ phải chỉ thấy những mục đã có từ trước. Nếu để sau,
  // chính mục vừa tạo bị tính là "đã giữ từ trước" và một sổ mới có thể tự bù thêm lượt cho nó (ADJUSTMENT) thay vì từ chối.
  const khoiTao = new Map<string, DongCanBu>();
  for (const d of dong) if (d.xep.ok && d.xep.dungLuot) khoiTao.set(`${d.studentId}|${d.courseId}`, d);
  for (const d of [...khoiTao.values()].sort((a, b) => a.studentId.localeCompare(b.studentId))) {
    await khoaTaiKhoan(tx, { studentId: d.studentId, courseId: d.courseId, classId: d.classId }, addedById);
  }

  // Bé tham gia: kích hoạt lại bé đã bị gỡ, tạo mới cho bé chưa có.
  const bi = new Map<string, string>(); // studentId → participantId
  for (const b of beDaCo) {
    if (b.attendanceStatus === "REMOVED") {
      await tx.makeupCaseParticipant.update({
        where: { id: b.id },
        data: { attendanceStatus: "PENDING", version: { increment: 1 }, generalComment: null, attendedAt: null, processedById: null },
      });
    }
    bi.set(b.studentId, b.id);
  }
  const bePhaiTao = [...new Set(dong.map((d) => d.studentId))].filter((s) => !bi.has(s));
  for (const studentId of bePhaiTao.sort()) {
    const b = await tx.makeupCaseParticipant.create({
      data: { caseId: c.id, studentId, centerId, orgUnitId: c.orgUnitId },
      select: { id: true },
    });
    bi.set(studentId, b.id);
  }

  const needs = await tx.makeupNeed.findMany({
    where: { id: { in: dong.map((d) => d.id) } },
    select: { id: true, missedSessionId: true, originalAttendanceId: true },
  });
  const nguon = new Map(needs.map((n) => [n.id, n]));
  const moi = await tx.makeupCaseStudent.createManyAndReturn({
    data: dong.map((d) => ({
      caseId: c.id,
      makeupNeedId: d.id,
      centerId,
      orgUnitId: c.orgUnitId,
      dungLuot: d.xep.ok && d.xep.dungLuot,
      addedById,
      participantId: bi.get(d.studentId)!,
      lessonId: d.lessonId,
      originalSessionId: nguon.get(d.id)?.missedSessionId ?? null,
      originalAttendanceId: nguon.get(d.id)?.originalAttendanceId ?? null,
    })),
    select: { id: true, makeupNeedId: true, dungLuot: true, participantId: true },
  });
  // T06 — xếp bằng lượt ⇒ GIỮ lượt NGAY trong giao dịch này (sổ khoá hàng tài khoản: hai lượt đồng thời cho cùng một bé xếp hàng).
  // Hết lượt ⇒ `giuLuot` ném ⇒ cả case rollback. Thứ tự theo học viên để hai lượt đồng thời khoá hàng cùng thứ tự (không khoá vòng).
  const theoNeed = new Map(dong.map((d) => [d.id, d]));
  const canGiu = moi.filter((m) => m.dungLuot).sort((a, b) => theoNeed.get(a.makeupNeedId)!.studentId.localeCompare(theoNeed.get(b.makeupNeedId)!.studentId));
  for (const m of canGiu) {
    const d = theoNeed.get(m.makeupNeedId)!;
    await giuLuot(tx, {
      studentId: d.studentId,
      courseId: d.courseId,
      classId: d.classId,
      makeupNeedId: d.id,
      caseStudentId: m.id,
      actorId: addedById,
    });
  }
  // T13 — báo phụ huynh + giáo viên: bé này vừa được xếp. Khoá theo MỤC đầu tiên mới thêm cho bé ⇒ xếp thêm một bài cho bé đã có trong case là một
  // sự việc mới (báo lại), còn outbox phát lại cùng sự kiện thì không nhân đôi.
  const mucDauTheoBe = new Map<string, string>();
  for (const m of moi) if (!mucDauTheoBe.has(m.participantId!)) mucDauTheoBe.set(m.participantId!, m.id);
  const be = await tx.makeupCaseParticipant.findMany({ where: { id: { in: [...mucDauTheoBe.keys()] } }, select: { id: true, studentId: true } });
  for (const b of be.sort((x, y) => x.studentId.localeCompare(y.studentId))) {
    await phatCaseDaXep(tx, { caseId: c.id, participantId: b.id, studentId: b.studentId, mucId: mucDauTheoBe.get(b.id)! });
  }
}

/** Gỡ MỘT mục khỏi case chưa điểm danh ⇒ dòng cần bù quay lại danh sách; mục được GIỮ làm lịch sử (RELEASED), không xoá. */
export async function goKhoiCase(actor: NguoiHocBu, caseStudentId: string, now: Date = new Date()): Promise<void> {
  const cs = await scopedDb(actor).makeupCaseStudent.findUnique({
    where: { id: caseStudentId },
    select: { id: true, status: true, result: true, case: { select: { status: true } }, makeupNeed: { select: { studentId: true } } },
  });
  if (!cs) throw new LoiHocBu("Không tìm thấy học viên trong case");
  await chanNeuKhongCuaSale(actor, [cs.makeupNeed.studentId]);
  if (cs.result !== "PLANNED" || cs.case.status !== "SCHEDULED") {
    throw new LoiHocBu("Học viên đã được điểm danh — không gỡ được");
  }
  await db.$transaction((tx) => nhaMucTrongTx(tx, cs.id, { actorId: actor.userId, lyDoSo: "Gỡ bé khỏi case chưa điểm danh", lyDo: "GO_KHOI", now }));
}

/** Gỡ CẢ BÉ (mọi bài còn sống của bé) khỏi case chưa điểm danh. Hết bé thì case tự huỷ. */
export async function goBeKhoiCase(actor: NguoiHocBu, participantId: string, now: Date = new Date()): Promise<void> {
  const be = await scopedDb(actor).makeupCaseParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, caseId: true, studentId: true, attendanceStatus: true, case: { select: { status: true } } },
  });
  if (!be) throw new LoiHocBu("Không tìm thấy học viên trong case");
  await chanNeuKhongCuaSale(actor, [be.studentId]);
  if (be.attendanceStatus !== "PENDING" || be.case.status !== "SCHEDULED") throw new LoiHocBu("Học viên đã được điểm danh — không gỡ được");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${be.caseId} FOR UPDATE`;
    await nangCapCase(tx, be.caseId);
    const muc = await tx.makeupCaseStudent.findMany({
      where: { participantId: be.id, result: "PLANNED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (muc.length === 0) throw new LoiHocBu("Học viên đã được điểm danh — không gỡ được");
    for (const m of muc) await nhaMucTrongTx(tx, m.id, { actorId: actor.userId, lyDoSo: "Gỡ bé khỏi case chưa điểm danh", lyDo: "GO_KHOI", now });
  });
}

/**
 * Phần GHI của việc gỡ một bé khỏi case chưa điểm danh — dùng chung cho nút "Gỡ" (`goKhoiCase`) và cho đường xét lại khi đơn phí bị
 * huỷ/hoàn (`don-doi-db.ts`, T06). Một chỗ, vì hai đường mà gỡ khác nhau là hai lượt bị nhả khác nhau. (T07: nay chỉ là vỏ của `nhaMucTrongTx`.)
 */
export async function goBeKhoiCaseTrongTx(
  tx: Tx,
  cs: { id: string; makeupNeedId: string; dungLuot: boolean; makeupNeed: { studentId: string; courseId: string; classId: string } },
  p: { actorId: string | null; lyDoNha: string },
): Promise<void> {
  await nhaMucTrongTx(tx, cs.id, { actorId: p.actorId, lyDoSo: p.lyDoNha, lyDo: "GO_KHOI", now: new Date() });
}

/**
 * Huỷ case chưa điểm danh ⇒ mọi bé quay về danh sách cần bù. Mục và bé được GIỮ làm lịch sử (RELEASED / REMOVED), không xoá.
 */
export async function huyCase(actor: NguoiHocBu, caseId: string, now: Date = new Date()): Promise<void> {
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, teacherId: true, participants: { select: { id: true, attendanceStatus: true } } },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  await chanNeuCaseCoBeNguoiKhac(actor, c.id);
  if (c.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
  if (c.participants.some((b) => b.attendanceStatus === "PRESENT" || b.attendanceStatus === "ABSENT")) {
    throw new LoiHocBu("Case đã có bé được điểm danh — không huỷ được, hãy điểm danh nốt");
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    await nangCapCase(tx, c.id);
    const song = await tx.makeupCase.findUnique({
      where: { id: c.id },
      select: { status: true, participants: { select: { attendanceStatus: true } } },
    });
    if (song?.status !== "SCHEDULED") throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    if (song.participants.some((b) => b.attendanceStatus === "PRESENT" || b.attendanceStatus === "ABSENT")) {
      throw new LoiHocBu("Case đã có bé được điểm danh — không huỷ được, hãy điểm danh nốt");
    }
    // Nhả theo thứ tự học viên: hai lượt đồng thời khoá hàng sổ cùng thứ tự (không khoá vòng).
    const muc = await tx.makeupCaseStudent.findMany({
      where: { caseId: c.id, result: "PLANNED" },
      select: CHON_MUC,
    });
    for (const m of [...muc].sort((a, b) => a.makeupNeed.studentId.localeCompare(b.makeupNeed.studentId))) {
      await doiKetQuaMuc(tx, m, "RELEASED", { lyDo: "HUY_CASE", actorId: actor.userId, now, lan: 0, beVang: false, lyDoSo: "Huỷ case chưa điểm danh" });
    }
    const choGo = await tx.makeupCaseParticipant.findMany({
      where: { caseId: c.id, attendanceStatus: "PENDING" },
      select: { id: true, studentId: true },
      orderBy: { studentId: "asc" },
    });
    await tx.makeupCaseParticipant.updateMany({
      where: { caseId: c.id, attendanceStatus: "PENDING" },
      data: { attendanceStatus: "REMOVED", version: { increment: 1 } },
    });
    const doi = await tx.makeupCase.updateMany({ where: { id: c.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
    if (doi.count !== 1) throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    // T13 — báo từng phụ huynh có bé bị gỡ + giáo viên của case (một lần). Cùng giao dịch: rollback thì không có sự kiện.
    const sau = await tx.makeupCaseParticipant.findMany({ where: { id: { in: choGo.map((b) => b.id) } }, select: { id: true, version: true } });
    const phienBan = new Map(sau.map((b) => [b.id, b.version]));
    for (const b of choGo) await phatBeBiGo(tx, { caseId: c.id, participantId: b.id, studentId: b.studentId, phienBan: phienBan.get(b.id)! });
    await phatCaseBiHuy(tx, { caseId: c.id, teacherId: c.teacherId });
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.huy-case",
      oldValues: { status: "SCHEDULED" },
      newValues: { status: "CANCELLED", soBeBiGo: choGo.length },
    });
  });
  // T13: báo giáo viên khi HUỶ ca đi qua `makeup.case.cancelled` (phatCaseBiHuy) — không gọi `baoGvCaBu("huy")` nữa.
}

/**
 * Tạo PHÍ HỌC BÙ khi hết lượt (chốt 6): một đơn một dòng `MAKEUP_FEE`, giá = giá niêm yết
 * MỘT buổi của khoá — cùng phép `giaMoiBuoi` mà màn tạo đơn in "đ/buổi". Đơn có phiếu thu
 * + QR ngay (`ensureFullOrderRequest`), tiền về đi đúng đường đối khớp hiện có.
 */
export async function taoPhiBu(actor: NguoiHocBu, needId: string): Promise<{ orderId: string }> {
  const [d] = await docDongTheoId(scopedDb(actor), [needId], actor.chiCuaSale);
  if (!d) throw new LoiHocBu("Không tìm thấy buổi cần bù");
  if (d.phi.loai !== "CAN_THU") {
    throw new LoiHocBu(d.phi.loai === "CHO_THU" ? "Đã có phí bù đang chờ thu" : "Học viên này chưa cần thu phí bù");
  }
  const [khoa, hv] = await Promise.all([
    db.course.findUnique({ where: { id: d.courseId }, select: { price: true, totalSessions: true, name: true } }),
    db.student.findUnique({ where: { id: d.studentId }, select: { name: true, parentName: true, parentPhone: true } }),
  ]);
  const gia = khoa?.price && khoa.totalSessions ? giaMoiBuoi(khoa.price, khoa.totalSessions) : 0;
  if (gia <= 0) throw new LoiHocBu("Khoá chưa có giá niêm yết hoặc số buổi — không tính được giá một buổi");
  if (!hv) throw new LoiHocBu("Không tìm thấy học viên");

  return db.$transaction(async (tx) => {
    // HB-17 — cổng ở trên đọc NGOÀI transaction nên hai lượt bấm gần nhau cùng qua, rồi cùng tạo một đơn có QR sống
    // (đơn thứ nhất thành mồ côi — phụ huynh trả tiền vào đơn không ai thấy). Khoá hàng dòng cần bù, ĐỌC LẠI trong
    // khoá: lượt sau xếp hàng chờ, thấy đã có đơn phí còn sống thì ném — và `throw` rollback, không đơn nào bị tạo.
    await tx.$queryRaw`SELECT id FROM "MakeupNeed" WHERE id = ${d.id} FOR UPDATE`;
    const dong = await tx.makeupNeed.findUnique({
      where: { id: d.id },
      select: { status: true, freeApprovedAt: true, nguon: true, feeOrderItemId: true },
    });
    if (!dong || dong.status !== "PENDING") throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    if (dong.freeApprovedAt !== null) throw new LoiHocBu("Buổi này vừa được miễn phí — tải lại trang");
    // Buổi bù do PHỤC HỌC (Bảo lưu BR-22) KHÔNG có phí — màn không vẽ nút, server cũng từ chối (luật 12: nút và cổng cùng một luật).
    if (laDongMienPhi(dong)) throw new LoiHocBu("Buổi bù này sinh ra do phục học sau bảo lưu — miễn phí, không thu phí bù");
    if (dong.feeOrderItemId !== null) {
      const cu = await tx.orderItem.findUnique({
        where: { id: dong.feeOrderItemId },
        select: { order: { select: { status: true, deletedAt: true } } },
      });
      // Cùng định nghĩa "đơn phí còn sống" với danh sách (`danh-sach-db.ts`): đã huỷ / hoàn / xoá thì tạo lại được.
      if (cu && cu.order.deletedAt === null && cu.order.status !== "CANCELLED" && cu.order.status !== "REFUNDED") {
        throw new LoiHocBu("Đã có phí bù đang chờ thu — tải lại trang");
      }
    }
    const order = await withUniqueRetry(async () =>
      tx.order.create({
        data: {
          code: await generateOrderCode(tx),
          type: "COURSE",
          status: "PENDING_PAYMENT",
          customerName: hv.parentName ?? hv.name,
          customerPhone: hv.parentPhone ?? "",
          studentId: d.studentId,
          centerId: d.centerId,
          createdById: actor.userId,
          subtotal: gia,
          discountAmount: 0,
          totalAmount: gia,
          internalNote: `Phí học bù — ${d.hocVien} · ${d.buoiVang ?? "buổi vắng"}`,
          items: {
            create: [
              {
                type: "MAKEUP_FEE",
                itemName: `Phí học bù ${khoa?.name ?? ""} — ${d.buoiVang ?? "1 buổi"}`.trim(),
                quantity: 1,
                unitPrice: gia,
                totalPrice: gia,
                studentId: d.studentId,
              },
            ],
          },
        },
        select: { id: true, code: true, totalAmount: true, centerId: true, items: { select: { id: true } } },
      }),
    );
    await ensureFullOrderRequest(tx, order);
    // So-và-đổi: con trỏ phải vẫn là giá trị ta đọc trong khoá — thêm một lớp nữa nếu ai đó ghi mà không qua khoá.
    const gan = await tx.makeupNeed.updateMany({
      where: { id: d.id, status: "PENDING", freeApprovedAt: null, feeOrderItemId: dong.feeOrderItemId },
      data: { feeOrderItemId: order.items[0]!.id },
    });
    if (gan.count !== 1) throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      entityType: "MakeupNeed",
      entityId: d.id,
      action: "hoc-bu.tao-phi",
      newValues: { orderId: order.id, maDon: order.code, soTien: order.totalAmount, itemId: order.items[0]!.id },
    });
    return { orderId: order.id };
  });
}

/**
 * Miễn phí ngoại lệ (QLCS + Admin; "Giám đốc" = vai Admin — quyền hỏi ở action), bắt buộc lý do.
 *
 * T06 (HB-31): đơn phí ĐÃ TẠO mà CHƯA thu đồng nào thì HUỶ nó CÙNG giao dịch với phép miễn — trước đây miễn phí chỉ đặt cờ, đơn phí và mã
 * QR của nó vẫn sống, và phụ huynh còn thể trả tiền vào một khoản đã được miễn (checker TV-06). Đã có tiền (kể cả một phần) thì TỪ CHỐI:
 * hoàn tiền là việc của kế toán, không phải một tác dụng phụ của nút miễn phí.
 * Trả mã đơn phí đã huỷ (nếu có) để action ghi vào audit.
 */
export async function mienPhiBu(actor: NguoiHocBu, p: { needId: string; lyDo: string; ten: string }): Promise<{ donPhiDaHuy: string | null }> {
  const [d] = await docDongTheoId(scopedDb(actor), [p.needId], actor.chiCuaSale);
  if (!d) throw new LoiHocBu("Không tìm thấy buổi cần bù");
  if (d.phi.loai === "LUOT" || d.phi.loai === "DA_THU" || d.phi.loai === "MIEN_PHI") {
    throw new LoiHocBu("Học viên này không cần miễn phí (còn lượt hoặc đã thu)");
  }
  const donPhiCho = d.phi.loai === "CHO_THU" ? d.phi.orderId : null;
  return db.$transaction(async (tx) => {
    // Khoá ĐƠN trước (câu đầu tiên của mọi đường huỷ đơn — lưới `[KDK-W4]`), rồi khoá dòng cần bù. Đường huỷ đơn thường không khoá dòng
    // cần bù nên không có vòng chờ; đường tạo phí khoá dòng rồi mới tạo đơn mới (không đụng đơn cũ).
    if (donPhiCho) await khoaDonTrongTx(tx, donPhiCho);
    await tx.$queryRaw`SELECT id FROM "MakeupNeed" WHERE id = ${d.id} FOR UPDATE`;
    const dong = await tx.makeupNeed.findUnique({
      where: { id: d.id },
      select: { status: true, waivedAt: true, freeApprovedAt: true, nguon: true, feeOrderItemId: true },
    });
    if (!dong || dong.status !== "PENDING" || dong.waivedAt !== null || dong.freeApprovedAt !== null) {
      throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    }
    // Buổi bù do PHỤC HỌC đã miễn phí theo quy chế — "miễn phí ngoại lệ" không có nghĩa gì ở đây (và sẽ không gỡ được).
    if (laDongMienPhi(dong)) throw new LoiHocBu("Buổi bù này sinh ra do phục học sau bảo lưu — đã miễn phí theo quy chế");
    let donPhiDaHuy: string | null = null;
    const phi = await docPhiCuaDong(tx, dong.feeOrderItemId);
    if (phi && donPhiConSong(phi)) {
      if (phi.orderId !== donPhiCho) throw new LoiHocBu("Đơn phí vừa đổi — tải lại trang");
      if (phi.daThu > 0) {
        throw new LoiHocBu(`Đơn phí ${phi.orderCode} đã có ${phi.daThu.toLocaleString("vi-VN")}đ về — xử lý hoàn/đối soát đơn phí trước khi miễn`);
      }
      if (phi.orderStatus !== "PENDING_PAYMENT") {
        throw new LoiHocBu(`Đơn phí ${phi.orderCode} đang ở trạng thái ${phi.orderStatus} — không huỷ tự động được`);
      }
      const huy = await tx.order.updateMany({
        where: { id: phi.orderId, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED" },
      });
      if (huy.count !== 1) throw new LoiHocBu("Đơn phí vừa đổi trạng thái — tải lại trang");
      await tx.orderStatusHistory.create({
        data: {
          orderId: phi.orderId,
          fromStatus: "PENDING_PAYMENT",
          toStatus: "CANCELLED",
          changedByUserId: actor.userId,
          changedByName: p.ten,
          reason: `Miễn phí học bù: ${p.lyDo}`,
        },
      });
      await voidTienKhiHuyDonTrongTx(tx, phi.orderId);
      donPhiDaHuy = phi.orderCode;
    }
    const doi = await tx.makeupNeed.updateMany({
      where: { id: d.id, status: "PENDING", freeApprovedAt: null, waivedAt: null },
      data: { freeApprovedAt: new Date(), freeApprovedById: actor.userId, freeReason: p.lyDo },
    });
    if (doi.count !== 1) throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupNeed",
      entityId: d.id,
      action: "hoc-bu.mien-phi",
      newValues: { freeApproved: true, donPhiDaHuy },
      reason: p.lyDo,
    });
    return { donPhiDaHuy };
  });
}

/**
 * GỠ miễn phí (T06): người duyệt đổi ý. Chỉ khi dòng còn PENDING — đã xếp vào case bằng suất miễn phí thì phải gỡ bé khỏi case trước
 * (không thì suất ngồi học đã được cấp còn cờ cấp nó thì mất). Quyền hỏi ở action.
 */
export async function goMienPhiBu(actor: Actor, p: { needId: string; lyDo: string; ten: string }): Promise<void> {
  const dong = await scopedDb(actor).makeupNeed.findUnique({
    where: { id: p.needId },
    select: { id: true, status: true, freeApprovedAt: true },
  });
  if (!dong || dong.freeApprovedAt === null) throw new LoiHocBu("Buổi này không có miễn phí để gỡ");
  if (dong.status !== "PENDING") {
    throw new LoiHocBu("Buổi này đã xếp vào case bằng suất miễn phí — gỡ bé khỏi case trước rồi mới gỡ miễn phí");
  }
  await db.$transaction(async (tx) => {
    const doi = await tx.makeupNeed.updateMany({
      where: { id: dong.id, status: "PENDING", freeApprovedAt: { not: null } },
      data: { freeApprovedAt: null, freeApprovedById: null, freeReason: null },
    });
    if (doi.count !== 1) throw new LoiHocBu("Buổi cần bù vừa đổi trạng thái — tải lại trang");
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupNeed",
      entityId: dong.id,
      action: "hoc-bu.go-mien-phi",
      newValues: { freeApproved: false },
      reason: p.lyDo,
    });
  });
}

/** HB-22 — câu cảnh báo khi huỷ không bù một dòng mà phụ huynh đã trả phí (null = không có gì phải nói). */
export const canhBaoPhiKhiHuy = (feeOrderItemId: string | null): Promise<string | null> =>
  canhBaoPhiDaThuKhiHuy(db, feeOrderItemId);

/**
 * SỬA case chưa điểm danh (T07): ngày · giờ · giáo viên · phòng · bộ bài · ghi chú. Khoá lạc quan theo `phienBan` của case (mở màn sửa lúc
 * nào thì mang phiên bản lúc đó — lệch ⇒ có người sửa trước, từ chối). Chạy lại kiểm GV có ca + trùng lịch (T09) cho bộ giá trị MỚI, loại
 * chính case này. KHÔNG được bỏ một bài còn mục sống (bé vẫn đang chờ học bài đó). Case có bé đã điểm danh thì không sửa nữa.
 */
export async function suaCase(
  actor: NguoiHocBu,
  p: {
    caseId: string;
    phienBan: number;
    ymd?: string;
    startTime?: string;
    endTime?: string;
    teacherId?: string;
    /** `undefined` = giữ phòng; `null` = bỏ phòng. */
    roomId?: string | null;
    lessonIds?: string[];
    note?: string | null;
    ten: string;
    /** Đồng hồ — mặc định giờ thật; test truyền vào (luật 19). */
    now?: Date;
  },
): Promise<void> {
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: p.caseId },
    select: {
      id: true,
      status: true,
      version: true,
      centerId: true,
      courseId: true,
      lessonId: true,
      date: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      roomId: true,
      note: true,
      lessons: { select: { lessonId: true }, orderBy: { order: "asc" } },
    },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  await chanNeuCaseCoBeNguoiKhac(actor, c.id);
  if (c.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ — không sửa được");

  const ymdCu = c.date.toISOString().slice(0, 10);
  const ymd = p.ymd ?? ymdCu;
  const startTime = p.startTime ?? c.startTime;
  const endTime = p.endTime ?? c.endTime;
  const teacherId = p.teacherId ?? c.teacherId;
  const roomId = p.roomId === undefined ? c.roomId : p.roomId;
  const note = p.note === undefined ? c.note : p.note;
  if (!GIO.test(startTime) || !GIO.test(endTime) || startTime >= endTime) throw new LoiHocBu("Giờ bắt đầu phải trước giờ kết thúc");
  if (ymd !== ymdCu && ymd < vnYmd(p.now ?? new Date())) throw new LoiHocBu("Ngày dạy bù không được ở quá khứ");
  const baiCu = c.lessons.length > 0 ? c.lessons.map((l) => l.lessonId) : [c.lessonId];
  let baiMoi = baiCu;
  if (p.lessonIds !== undefined) {
    const khai = kiemBoBai(p.lessonIds);
    if (!khai.ok) throw new LoiHocBu(khai.lyDo);
    baiMoi = khai.ids;
    await kiemBaiThuocKhoa(db, c.courseId, baiMoi);
  }
  if (ymd !== ymdCu || startTime !== c.startTime || endTime !== c.endTime || teacherId !== c.teacherId || roomId !== c.roomId) {
    await kiemGvVaPhong(actor, { centerId: c.centerId, ymd, startTime, endTime, teacherId, roomId });
  }

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    await nangCapCase(tx, c.id);
    const song = await tx.makeupCase.findUnique({
      where: { id: c.id },
      select: { status: true, version: true, participants: { select: { studentId: true, attendanceStatus: true } } },
    });
    if (song?.status !== "SCHEDULED") throw new LoiHocBu("Case đã chốt hoặc đã huỷ — tải lại trang");
    if (song.version !== p.phienBan) throw new LoiHocBu("Case vừa được người khác sửa — tải lại trang rồi sửa lại");
    if (song.participants.some((b) => b.attendanceStatus === "PRESENT" || b.attendanceStatus === "ABSENT")) {
      throw new LoiHocBu("Case đã có bé được điểm danh — không sửa được nữa");
    }
    // Không bỏ bài còn bé đang chờ học.
    const muc = await tx.makeupCaseStudent.findMany({ where: { caseId: c.id, result: "PLANNED" }, select: { lessonId: true } });
    const bai = new Set(baiMoi);
    const biBo = [...new Set(muc.map((m) => m.lessonId).filter((x): x is string => !!x && !bai.has(x)))];
    if (biBo.length > 0) throw new LoiHocBu("Không bỏ được bài đang có bé chờ học — gỡ bé khỏi case trước");
    const hocVien = song.participants.filter((b) => b.attendanceStatus === "PENDING").map((b) => b.studentId);
    // T09: bộ giá trị MỚI so với mọi nguồn khác, loại chính case này.
    await kiemLichTrongTx(tx, {
      actor,
      khung: { ymd, startTime, endTime },
      teacherId,
      roomId,
      studentIds: hocVien,
      exclude: [{ type: "MAKEUP_CASE", id: c.id }],
    });
    const doi = await tx.makeupCase.updateMany({
      where: { id: c.id, status: "SCHEDULED", version: p.phienBan },
      data: {
        date: ngayTuYmd(ymd),
        startTime,
        endTime,
        teacherId,
        roomId,
        note,
        lessonId: baiMoi[0]!,
        version: { increment: 1 },
      },
    });
    if (doi.count !== 1) throw new LoiHocBu("Case vừa được người khác sửa — tải lại trang rồi sửa lại");
    if (p.lessonIds !== undefined) {
      await tx.makeupCaseLesson.deleteMany({ where: { caseId: c.id, lessonId: { notIn: baiMoi } } });
      for (const [i, lessonId] of baiMoi.entries()) {
        await tx.makeupCaseLesson.upsert({
          where: { caseId_lessonId: { caseId: c.id, lessonId } },
          create: { caseId: c.id, lessonId, order: i + 1 },
          update: { order: i + 1 },
        });
      }
    }
    // T13 — đổi NGÀY / GIỜ / GIÁO VIÊN / PHÒNG thì báo phụ huynh các bé đang chờ + giáo viên (cả giáo viên cũ nếu đổi người). Chỉ đổi ghi chú / bộ bài
    // thì không báo: không đổi giờ giấc của ai.
    const truoc = { ymd: ymdCu, startTime: c.startTime, endTime: c.endTime, teacherId: c.teacherId, roomId: c.roomId };
    const sauKhung = { ymd, startTime, endTime, teacherId, roomId };
    if (lietKeThayDoi(truoc, sauKhung).length > 0) {
      await phatCaseDoi(tx, { caseId: c.id, phienBanSau: p.phienBan + 1, truoc, sau: sauKhung });
    }
    await writeAudit({
      actor: { id: actor.userId, name: p.ten },
      module: "hoc-bu",
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.sua-case",
      oldValues: { ymd: ymdCu, startTime: c.startTime, endTime: c.endTime, teacherId: c.teacherId, roomId: c.roomId, lessonIds: baiCu },
      newValues: { ymd, startTime, endTime, teacherId, roomId, lessonIds: baiMoi },
      tx,
    });
  });
}
