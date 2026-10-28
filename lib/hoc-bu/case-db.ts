import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { layCaCuaNhieuNguoi } from "@/lib/trial/gv-kha-dung-db";
import { caPhuTronKhungGio } from "@/lib/trial/gv-kha-dung";
import { themGvMienTru } from "@/lib/hoc-bu/gv-mien-tru";
import { getSetting } from "@/lib/settings/service";
import { generateOrderCode, withUniqueRetry } from "@/lib/orders/code";
import { ensureFullOrderRequest } from "@/lib/payments/payment-request";
import { giaMoiBuoi } from "@/lib/finance/coach-pricing";
import { docDongTheoId, hocVienCuaSale, type DongCanBu } from "@/lib/hoc-bu/danh-sach-db";
import { duocXep, laDongMienPhi } from "@/lib/hoc-bu/xep-case";
import { docDongPendingCuaLo, guiYeuCauThemBe, huyYeuCauKhiHuyCase } from "@/lib/hoc-bu/yeu-cau-them-be-db";
import { beMoiTrongLo, gomTheoLo, quyetDinhThemVaoCase } from "@/lib/hoc-bu/yeu-cau-them-be-thuan";
import { CAU_KHONG_CUA_SALE, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { baoGvCaBu } from "@/lib/hoc-bu/bao-gv-db";
import { caseNhanThemV2, kiemBoBai, kiemNhomNhieuBai, TOI_DA_BAI_MOI_CASE } from "@/lib/hoc-bu/case-nhieu-bai-thuan";
import { nangCapCase } from "@/lib/hoc-bu/case-nang-cap-db";
import { danhDauCanDongBo, dongBoNgay } from "@/lib/parttime/dong-bo";
import { dongBoDungChinhTuNguonGoc } from "@/lib/parttime/phan-cong-db";
import { baoQlcsDuongLui, ghiTuXep, goiYTuXep, tuXepDangBat, type GoiYTuXep } from "@/lib/phan-cong/tu-xep-db";
import { CHON_MUC, doiKetQuaMuc, nhaMucTrongTx } from "@/lib/hoc-bu/case-diem-danh-db";
import { chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";
import { phatBeBiGo, phatCaseBiHuy, phatCaseBiTuChoi, phatCaseChoDuyet, phatCaseDaXep, phatCaseDoi, phatCaseDuocDuyet, phatYeuCauThemBeDuocDuyet } from "@/lib/hoc-bu/su-kien";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { lietKeThayDoi } from "@/lib/hoc-bu/thong-bao-thuan";
import { CASE_CHO_DUYET, kiemDuyetDuoc, trangThaiCaseKhiTao } from "@/lib/hoc-bu/duyet-case-thuan";
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
import { lyDoThieuPhong } from "@/lib/phan-cong/bat-buoc-phong";
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
  // Người trong `trial.gvMienLocTheoCa` luôn chọn được (chủ dự án 22/10: "lấy tương tự học trial"). Ô chọn và cổng ở máy chủ cùng đi qua hàm này.
  const dsDay = themGvMienTru(ds, giaoVien, await getSetting("trial.gvMienLocTheoCa"));
  return {
    ds: dsDay,
    lyDoRong: dsDay.length ? null : "Không giáo viên nào có ca làm phủ trọn khung giờ này ở cơ sở này",
  };
}

/**
 * Đọc lại dòng cần bù ở máy chủ và kiểm đủ luật — màn hình không được tin.
 * T07: các dòng chọn cùng lúc có thể vắng NHIỀU bài khác nhau (tối đa 3 bài khác nhau, cùng cơ sở + khoá) — case dạy cả bộ bài.
 */
async function kiemDongXep(
  actor: NguoiHocBu,
  needIds: string[],
  /** Đường DUYỆT yêu cầu thêm bé (24/10/2026): các dòng ĐANG chờ chính yêu cầu đang duyệt được tính lại `xep` không kể yêu cầu ấy. Mặc định tắt — thêm bé thường bị khoá bởi yêu cầu mở. */
  opts: { boQuaYeuCauMo?: boolean } = {},
): Promise<{ dong: DongCanBu[]; baiCuaDong: string[] }> {
  const ids = [...new Set(needIds)];
  if (ids.length === 0) throw new LoiHocBu("Chưa chọn học viên nào");
  const goc = await docDongTheoId(scopedDb(actor), ids, actor.chiCuaSale);
  const dong = opts.boQuaYeuCauMo ? goc.map((d) => (d.yeuCauThemMo ? { ...d, xep: duocXep(d.phi) } : d)) : goc;
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
 * HB-GOP [13/10/2026] — chủ dự án: "tạo một case nhiều buổi, ví dụ buổi 1 + buổi 2, thì dòng cần bù của buổi 2 phải mất và gộp chung với case của buổi 1".
 *
 * Bé vắng NHIỀU bài mà bộ bài của case dạy cả những bài ấy ⇒ dòng cần bù của CHÍNH bé ở các bài đó đi cùng case, không nằm lại danh sách cần bù như
 * một dòng chờ riêng (trước đây người xếp phải tự tích đủ từng dòng, và dòng quên tích vẫn "chờ bù" dù bé đã học đúng bài ấy trong case).
 *
 * Gom TỐI ĐA CÓ THỂ, không bao giờ làm hỏng lượt xếp chính: từng dòng ứng viên được thử CỘNG vào lô bằng chính `kiemDongXep` (cùng khoá + cơ sở, luật
 * xếp, sổ lượt — HB-20); dòng nào không qua (hết lượt phải thu phí, khoá tắt học bù, đã miễn phí ngoại lệ…) ở LẠI danh sách cần bù như cũ. Chỉ gom dòng
 * của bé ĐÃ được chọn, thuộc tầm nhìn của người xếp (Sale chỉ thấy bé mình phụ trách), mỗi (bé, bài) một dòng. Trả về id các dòng được gom THÊM.
 */
async function gomDongCungBe(actor: NguoiHocBu, dong: DongCanBu[], boBai: readonly string[], daChon: readonly string[]): Promise<string[]> {
  const dau = dong[0];
  if (!dau || boBai.length === 0) return [];
  const ungVien = await scopedDb(actor).makeupNeed.findMany({
    where: {
      id: { notIn: [...daChon] },
      status: "PENDING",
      waivedAt: null,
      studentId: { in: [...new Set(dong.map((d) => d.studentId))] },
      courseId: dau.courseId,
      missedLessonId: { in: [...boBai] },
      ...(actor.chiCuaSale ? { student: hocVienCuaSale(actor.chiCuaSale) } : {}),
    },
    select: { id: true, studentId: true, missedLessonId: true },
    orderBy: [{ studentId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const co = new Set(dong.map((d) => `${d.studentId}|${d.lessonId}`));
  const them: string[] = [];
  for (const u of ungVien) {
    const k = `${u.studentId}|${u.missedLessonId}`;
    if (co.has(k)) continue; // mỗi (bé, bài) chỉ một dòng đi theo case
    try {
      await kiemDongXep(actor, [...daChon, ...them, u.id]);
    } catch (e) {
      if (e instanceof LoiHocBu) continue; // không xếp được ⇒ ở lại danh sách cần bù
      throw e;
    }
    co.add(k);
    them.push(u.id);
  }
  return them;
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

/**
 * Gợi ý tự xếp cho một case học bù — ứng viên = đúng danh sách GV có ca phủ khung giờ (`gvTrongCa`, cổng `kiemGvVaPhong`). Công tắc tắt
 * ⇒ trả ngay, KHÔNG tính danh sách (mọi lượt book khi tắt không tốn thêm câu tra). `dsCoSan`: nơi gọi đã có danh sách thì truyền vào.
 */
export async function goiYTuXepChoCase(
  actor: Actor,
  p: { centerId: string; ymd: string; startTime: string; endTime: string },
  boQuaCaseId: string | null,
  dsCoSan?: readonly GvTrongCa[],
): Promise<GoiYTuXep> {
  if (!(await tuXepDangBat(p.centerId))) return { bat: false };
  const gv = dsCoSan ? { ds: dsCoSan } : await gvTrongCa(actor, p);
  return goiYTuXep({
    centerId: p.centerId,
    ngay: p.ymd,
    gioBatDau: p.startTime,
    gioKetThuc: p.endTime,
    loai: "BU",
    hopLe: gv.ds.map((g) => g.id),
    boQuaNguon: boQuaCaseId ? { sourceType: "MAKEUP_CASE", sourceId: boQuaCaseId } : null,
  });
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
    /**
     * Người tạo CÓ quyền duyệt (`makeup:waive`) không — quyết trạng thái đầu của case: có ⇒ lịch thật ngay (SCHEDULED); không (Sale…) ⇒ CHỜ DUYỆT (20/10/2026).
     * BẮT BUỘC khai, không mặc định (luật 7): mặc định sai là hoặc chặn mọi case của quản lý, hoặc cho Sale bỏ qua bước duyệt. Action tính từ quyền thật.
     */
    coQuyenDuyet: boolean;
  },
): Promise<string> {
  const trangThaiDau = trangThaiCaseKhiTao({ coQuyenDuyet: p.coQuyenDuyet });
  const choDuyet = trangThaiDau === CASE_CHO_DUYET;
  const thieuPhong = lyDoThieuPhong({ taoMoi: true, phongTruoc: null, phongSau: p.roomId });
  if (thieuPhong) throw new LoiHocBu(thieuPhong);
  const { dong: dongChon, baiCuaDong } = await kiemDongXep(actor, p.needIds);
  const dau = dongChon[0]!;
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
  // HB-GOP: dòng cần bù của chính các bé đã chọn ở những bài khác trong bộ bài đi theo case (không để lại một dòng chờ bù riêng).
  const gom = await gomDongCungBe(actor, dongChon, boBai, p.needIds);
  const needIdsDay = gom.length > 0 ? [...new Set([...p.needIds, ...gom])] : p.needIds;
  const dong = gom.length > 0 ? (await kiemDongXep(actor, needIdsDay)).dong : dongChon;
  await kiemGvVaPhong(actor, { centerId, ymd: p.ymd, startTime: p.startTime, endTime: p.endTime, teacherId: p.teacherId, roomId: p.roomId });
  const sessionCategoryId = await phanLoaiBu();
  let canDongBo = false; // Parttime SR.QD.238 (P3a): case mới ⇒ đồng bộ phân công GV đứng chính (MAKEUP) sau commit
  // GĐ5 tự xếp: chỉ case LỊCH THẬT ngay (case chờ duyệt xếp lúc duyệt). Ứng viên lọc theo đúng ô chọn GV của màn (`gvTrongCa`).
  const goiY: GoiYTuXep = choDuyet ? { bat: false } : await goiYTuXepChoCase(actor, { centerId, ymd: p.ymd, startTime: p.startTime, endTime: p.endTime }, null);
  let baoQlcs = false;

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
        status: trangThaiDau,
      },
      select: { id: true, orgUnitId: true },
    });
    await tx.makeupCaseLesson.createMany({ data: boBai.map((lessonId, i) => ({ caseId: c.id, lessonId, order: i + 1 })) });
    // Case chờ duyệt: `ghiBeVaoCase` tự đọc trạng thái của case và KHÔNG phát tin cho phụ huynh / giáo viên (lúc duyệt mới phát — `phatTinCaseVuaDuyet`).
    await ghiBeVaoCase(tx, c, centerId, dong, actor.userId);
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.tao-case",
      orgUnitId: c.orgUnitId,
      newValues: { ymd: p.ymd, startTime: p.startTime, endTime: p.endTime, teacherId: p.teacherId, roomId: p.roomId, lessonIds: boBai, needIds: needIdsDay, status: trangThaiDau, ...(gom.length > 0 ? { gopThem: gom } : {}) },
    });
    // Case chờ duyệt ⇒ báo QUẢN LÝ CƠ SỞ (phụ huynh + giáo viên chưa được báo gì).
    if (choDuyet) await phatCaseChoDuyet(tx, { caseId: c.id });
    // Phân công parttime của giáo viên chỉ sinh khi case là lịch THẬT: case chờ duyệt chưa có phân công (duyệt xong mới đánh dấu — `duyetCase`).
    if (!choDuyet) {
      canDongBo = await danhDauCanDongBo(tx, [{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_TAO", { id: actor.userId, name: "Học bù" });
      baoQlcs = (await ghiTuXep(tx, { nguon: { sourceType: "MAKEUP_CASE", sourceId: c.id }, gvId: p.teacherId, goiY, actor: { id: actor.userId, name: "Học bù" } })).baoQlcs;
    }
    return c.id;
  });
  if (canDongBo) await dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: caseId }], "HOC_BU_TAO", { id: actor.userId, name: "Học bù" });
  if (baoQlcs) await baoQlcsDuongLui({ centerId, nguon: { sourceType: "MAKEUP_CASE", sourceId: caseId }, moTa: `Case học bù ${p.ymd} ${p.startTime}–${p.endTime}` });
  // T13: báo giáo viên khi TẠO ca đi qua DomainEvent `makeup.case.scheduled` (trong giao dịch) — KHÔNG gọi `baoGvCaBu("ca-moi")` nữa kẻo giáo viên nhận hai tin.
  return caseId;
}

/**
 * `moRongBai` [20/10/2026 — chủ dự án: "sau khi tạo case vẫn có thể sửa thêm các buổi khác, hoặc thêm học viên khác vào chung case"]: các dòng được thêm vắng bài mà case CHƯA dạy ⇒ bài đó
 * được THÊM vào bộ bài của case NGAY TRONG CÙNG giao dịch với việc xếp bé (một bài không có bé nào vắng thì dạy không ai nên KHÔNG có đường thêm bài trần). Không bật ⇒ như cũ: bài vắng phải
 * đã nằm trong bộ bài. Mở rộng bộ bài là SỬA case nên chịu cùng luật với `suaCase`: tối đa 3 bài, chưa bé nào điểm danh, Sale không đụng case có bé của người khác, bài phải cùng khoá.
 * Tăng `version` của case để hộp "Sửa case" đang mở bị từ chối thay vì ghi đè bộ bài mới bằng bộ bài cũ.
 *
 * [24/10/2026 — chủ dự án: "mỗi lần thêm học viên khác vào case có sẵn cũng phải qua qlcs duyệt"] `coQuyenDuyet` (quyền `makeup:waive`, đọc thật ở action — BẮT BUỘC khai, không mặc định):
 *   · có quyền ⇒ thêm NGAY như cũ;
 *   · không có quyền VÀ lô có ít nhất một bé chưa là người tham gia đang học của case ⇒ KHÔNG đụng case: ghi YÊU CẦU chờ quản lý cơ sở duyệt (`choDuyet: true`). Duyệt xong mới chạy đường xếp này
 *     (`duyetYeuCauThemBe`), kiểm lại toàn bộ luật ở thời điểm duyệt;
 *   · không có quyền nhưng lô chỉ gồm bé ĐÃ trong case (thêm buổi vắng khác của họ) ⇒ thêm ngay — đó không phải "học viên khác".
 * Cổng nằm Ở ĐÂY (lớp thấp nhất): `thucHienXepVaoCase` từ chối bé mới khi không có quyền duyệt, kể cả khi ai đó gọi thẳng nó.
 */
export async function xepVaoCaseCoSan(
  actor: NguoiHocBu,
  p: { caseId: string; needIds: string[]; moRongBai?: boolean; coQuyenDuyet: boolean },
): Promise<{ choDuyet: boolean }> {
  const kq = await chuanBiXepVaoCase(actor, p);
  const quyet = quyetDinhThemVaoCase({ coQuyenDuyet: p.coQuyenDuyet, soBeMoi: kq.beMoi.length });
  if (quyet === "CHO_DUYET") {
    // Chưa đụng case ⇒ không có gì để khoá hay hoàn tác. Luật xếp đã kiểm ở `chuanBiXepVaoCase` (người gửi không gửi một lô mà chính họ đã không xếp được), và sẽ được KIỂM LẠI lúc duyệt.
    await guiYeuCauThemBe(actor, { c: kq.c, dong: kq.dong.map((d) => ({ id: d.id, studentId: d.studentId, hocVien: d.hocVien })), moRongBai: !!p.moRongBai });
    return { choDuyet: true };
  }
  // Sale không đụng bộ bài của case có bé của người khác — luật của lượt thêm TRỰC TIẾP (yêu cầu chờ duyệt thì quản lý quyết, nên không áp ở nhánh trên).
  if (kq.baiThem.length > 0) await chanNeuCaseCoBeNguoiKhac(actor, kq.c.id);
  await thucHienXepVaoCase(actor, kq, { choPhepBeMoi: p.coQuyenDuyet });
  return { choDuyet: false };
}

/** Mọi thứ cần ĐỌC + KIỂM trước khi quyết "thêm ngay hay chờ duyệt" — chưa ghi gì. Dùng chung cho lượt thêm trực tiếp và cho lượt DUYỆT yêu cầu. */
async function chuanBiXepVaoCase(actor: NguoiHocBu, p: { caseId: string; needIds: string[]; moRongBai?: boolean }, opts: { boQuaYeuCauMo?: boolean } = {}) {
  const { dong: dongChon } = await kiemDongXep(actor, p.needIds, opts);
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
      participants: { select: { studentId: true, attendanceStatus: true } },
    },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  // Case đời cũ chưa có bộ bài: bộ bài = bài chính của nó.
  const lessonIds = c.lessons.length > 0 ? c.lessons.map((l) => l.lessonId) : [c.lessonId];
  const baiThem = p.moRongBai ? [...new Set(dongChon.map((d) => d.lessonId).filter((x): x is string => !!x && !lessonIds.includes(x)))] : [];
  let boBaiSau = lessonIds;
  if (baiThem.length > 0) {
    const khai = kiemBoBai([...lessonIds, ...baiThem]);
    if (!khai.ok) throw new LoiHocBu(khai.lyDo);
    await kiemBaiThuocKhoa(db, c.courseId, baiThem);
    boBaiSau = khai.ids;
  }
  const nhan = caseNhanThemV2(
    { status: c.status, centerId: c.centerId, courseId: c.courseId, lessonIds: boBaiSau },
    dongChon.map((d) => ({ centerId: d.centerId, courseId: d.courseId, lessonId: d.lessonId, hocVien: d.hocVien })),
  );
  if (!nhan.ok) throw new LoiHocBu(nhan.lyDo);
  const beMoi = beMoiTrongLo(
    dongChon.map((d) => d.studentId),
    c.participants,
  );
  return { c, dong: dongChon, baiThem, beMoi };
}

type KqChuanBi = Awaited<ReturnType<typeof chuanBiXepVaoCase>>;

/**
 * Phép GHI của việc thêm bé / buổi vào case có sẵn. `choPhepBeMoi` BẮT BUỘC: false ⇒ trong khoá hàng case, đọc lại người tham gia và TỪ CHỐI nếu lô có bé chưa là người tham gia đang học
 * (lần đọc ngoài giao dịch có thể đã cũ: bé vừa bị gỡ khỏi case ⇒ thêm lại là thêm học viên khác, phải qua duyệt).
 * `lo` khai ⇒ đây là lượt DUYỆT một lô yêu cầu: các dòng yêu cầu được nhận (PENDING → APPROVED) TRONG CÙNG giao dịch — hai người duyệt cùng lúc thì người sau thấy 0 dòng và rollback.
 */
async function thucHienXepVaoCase(
  actor: NguoiHocBu,
  kq: KqChuanBi,
  opts: { choPhepBeMoi: boolean; lo?: { batchId: string; soDong: number; nguoiGuiId: string; ten: string; now: Date } },
): Promise<void> {
  const { c, dong, baiThem } = kq;
  // KHÔNG gom ở đường này (HB-GOP chỉ áp cho lúc TẠO case): quản lý có thể đã CỐ Ý gỡ các mục khác của bé khỏi case rồi chỉ thêm lại một mục —
  // tự kéo các dòng còn lại về là đi ngược ý người thao tác (đo bằng [CNBD-13]).
  await db.$transaction(async (tx) => {
    // Khoá hàng case: thêm bé và điểm danh / sửa / huỷ case không được chen nhau (đọc trạng thái case trong khoá, không tin lần đọc ngoài).
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    const song = await tx.makeupCase.findUnique({ where: { id: c.id }, select: { status: true, participants: { select: { studentId: true, attendanceStatus: true } } } });
    if (song?.status !== "SCHEDULED") throw new LoiHocBu("Case đã điểm danh hoặc đã huỷ — tải lại trang");
    if (!opts.choPhepBeMoi && beMoiTrongLo(dong.map((d) => d.studentId), song.participants).length > 0) {
      throw new LoiHocBu("Thêm học viên khác vào case phải qua quản lý cơ sở duyệt — tải lại trang rồi gửi duyệt");
    }
    if (opts.lo) {
      const nhan = await tx.makeupCaseAddRequest.updateMany({
        where: { batchId: opts.lo.batchId, caseId: c.id, status: "PENDING" },
        data: { status: "APPROVED", decidedById: actor.userId, decidedAt: opts.lo.now },
      });
      if (nhan.count !== opts.lo.soDong) throw new LoiHocBu("Yêu cầu vừa được người khác xử lý — tải lại trang");
    }
    if (baiThem.length > 0) {
      // Bộ bài ĐỌC LẠI trong khoá (lần đọc ngoài giao dịch có thể đã cũ: có người sửa case chen vào) rồi mới nới; case đời cũ được nâng trước để bài chính có dòng trong bộ bài.
      await nangCapCase(tx, c.id);
      const hienTai = (await tx.makeupCaseLesson.findMany({ where: { caseId: c.id }, orderBy: { order: "asc" }, select: { lessonId: true } })).map((l) => l.lessonId);
      const moi = baiThem.filter((b) => !hienTai.includes(b));
      const sau = kiemBoBai([...hienTai, ...moi]);
      if (!sau.ok) throw new LoiHocBu(sau.lyDo);
      const daDiemDanh = await tx.makeupCaseParticipant.count({ where: { caseId: c.id, attendanceStatus: { in: ["PRESENT", "ABSENT"] } } });
      if (daDiemDanh > 0) throw new LoiHocBu("Case đã có bé được điểm danh — không thêm bài mới được nữa (vẫn thêm được bé vắng các bài case đang dạy)");
      for (const [i, lessonId] of moi.entries()) await tx.makeupCaseLesson.create({ data: { caseId: c.id, lessonId, order: hienTai.length + i + 1 } });
      const doi = await tx.makeupCase.updateMany({ where: { id: c.id, status: "SCHEDULED" }, data: { version: { increment: 1 } } });
      if (doi.count !== 1) throw new LoiHocBu("Case vừa được người khác sửa — tải lại trang");
    }
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
      newValues: {
        them: dong.map((d) => ({ makeupNeedId: d.id, studentId: d.studentId, lessonId: d.lessonId })),
        ...(baiThem.length > 0 ? { baiThem } : {}),
        ...(opts.lo ? { theoYeuCau: opts.lo.batchId } : {}),
      },
    });
    if (opts.lo) {
      // Người gửi tự duyệt (quản lý gửi rồi tự bấm) không có nghĩa phải báo chính mình.
      if (opts.lo.nguoiGuiId !== actor.userId) await phatYeuCauThemBeDuocDuyet(tx, { caseId: c.id, batchId: opts.lo.batchId, nguoiGuiId: opts.lo.nguoiGuiId });
      await ghiNhatKy(tx, {
        actorId: actor.userId,
        ten: opts.lo.ten,
        entityType: "MakeupCaseAddRequest",
        entityId: opts.lo.batchId,
        action: "hoc-bu.duyet-them-be",
        orgUnitId: c.orgUnitId,
        oldValues: { status: "PENDING" },
        newValues: { status: "APPROVED", caseId: c.id, soDong: opts.lo.soDong },
      });
    }
  });
  // Còn lại MỘT đường của `bao-gv`: xếp THÊM bé vào ca có sẵn (T13 báo giáo viên một lần/ca nên không phủ lượt xếp thêm).
  await baoGvCaBu("them-hv", c.id, actor.userId);
}

/**
 * DUYỆT một lô yêu cầu thêm học viên vào case (24/10/2026). Quyền `makeup:waive` hỏi ở action. Đi ĐÚNG đường xếp trực tiếp (`thucHienXepVaoCase`) với `choPhepBeMoi: true`: lượt bù, trùng lịch,
 * tối đa 3 bài, bé đã điểm danh… đều kiểm lại Ở THỜI ĐIỂM DUYỆT — lần kiểm lúc xin có thể đã cũ. Không qua được ⇒ ném, lô GIỮ NGUYÊN trạng thái chờ (quản lý từ chối kèm lý do, hoặc xử lý nguyên nhân rồi duyệt lại).
 */
export async function duyetYeuCauThemBe(actor: NguoiHocBu, p: { batchId: string; ten: string; now?: Date }): Promise<void> {
  const now = p.now ?? new Date();
  const dong = await docDongPendingCuaLo(scopedDb(actor), p.batchId);
  if (dong.length === 0) throw new LoiHocBu("Yêu cầu này không còn chờ duyệt — tải lại trang");
  const lo = gomTheoLo(dong)[0]!;
  const kq = await chuanBiXepVaoCase(actor, { caseId: lo.caseId, needIds: lo.needIds, moRongBai: lo.moRongBai }, { boQuaYeuCauMo: true });
  if (kq.baiThem.length > 0) await chanNeuCaseCoBeNguoiKhac(actor, kq.c.id);
  await thucHienXepVaoCase(actor, kq, { choPhepBeMoi: true, lo: { batchId: p.batchId, soDong: dong.length, nguoiGuiId: lo.proposedById, ten: p.ten, now } });
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
  // Trạng thái ĐỌC TỪ HÀNG (không nhận qua tham số — không có gì để quên): case chờ duyệt chưa phải lịch thật nên phụ huynh / giáo viên CHƯA được báo.
  const trangThaiCase = (await tx.makeupCase.findUnique({ where: { id: c.id }, select: { status: true } }))?.status;
  const choDuyet = trangThaiCase === CASE_CHO_DUYET;
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
  if (choDuyet) return;
  const mucDauTheoBe = new Map<string, string>();
  for (const m of moi) if (!mucDauTheoBe.has(m.participantId!)) mucDauTheoBe.set(m.participantId!, m.id);
  const be = await tx.makeupCaseParticipant.findMany({ where: { id: { in: [...mucDauTheoBe.keys()] } }, select: { id: true, studentId: true } });
  for (const b of be.sort((x, y) => x.studentId.localeCompare(y.studentId))) {
    await phatCaseDaXep(tx, { caseId: c.id, participantId: b.id, studentId: b.studentId, mucId: mucDauTheoBe.get(b.id)! });
  }
}

/**
 * Case vừa được DUYỆT ⇒ báo phụ huynh từng bé + giáo viên (đúng các tin mà lúc xếp một case thường được phát — lúc case còn chờ duyệt không phát gì).
 * Khoá theo MỤC chờ đầu tiên của từng bé (cùng cách `ghiBeVaoCase` chọn): outbox phát lại không nhân đôi.
 */
async function phatTinCaseVuaDuyet(tx: Tx, caseId: string): Promise<void> {
  const muc = await tx.makeupCaseStudent.findMany({
    where: { caseId, result: "PLANNED", participantId: { not: null } },
    select: { id: true, participantId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const dau = new Map<string, string>();
  for (const m of muc) if (!dau.has(m.participantId!)) dau.set(m.participantId!, m.id);
  const be = await tx.makeupCaseParticipant.findMany({ where: { id: { in: [...dau.keys()] } }, select: { id: true, studentId: true } });
  for (const b of be.sort((x, y) => x.studentId.localeCompare(y.studentId))) {
    await phatCaseDaXep(tx, { caseId, participantId: b.id, studentId: b.studentId, mucId: dau.get(b.id)! });
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
  await db.$transaction(async (tx) => {
    const kq = await nhaMucTrongTx(tx, cs.id, { actorId: actor.userId, lyDoSo: "Gỡ bé khỏi case chưa điểm danh", lyDo: "GO_KHOI", now });
    if (kq.caseMoi === null) await donBaiKhongAiHoc(tx, kq.caseId);
  });
}

/**
 * [21/10/2026] Mỗi bé trong case học buổi RIÊNG ⇒ gỡ một buổi của một bé có thể làm bài đó hết người học. Bài trong bộ bài mà không còn mục sống nào thì BỎ khỏi bộ bài (giữ thứ tự, bài chính
 * = bài đầu bộ còn lại, tăng version) — nếu không, bài chết vẫn chiếm một trong 3 chỗ và người xếp không thêm buổi mới được dù case chỉ còn 2 bài thật. "Sống" = `status` khác RELEASED, đúng định
 * nghĩa của checker TV-42 (mục RELEASED là lịch sử, không bị đòi bài nằm trong bộ bài). Chỉ làm khi CHƯA bé nào điểm danh (cùng luật `suaCase`: sau điểm danh bộ bài là bằng chứng của buổi đã dạy).
 * Gọi trong giao dịch người gọi, SAU khi nhả mục; case đã tự huỷ/chốt thì thôi.
 */
async function donBaiKhongAiHoc(tx: Tx, caseId: string): Promise<void> {
  const daDiemDanh = await tx.makeupCaseParticipant.count({ where: { caseId, attendanceStatus: { in: ["PRESENT", "ABSENT"] } } });
  if (daDiemDanh > 0) return;
  const bai = (await tx.makeupCaseLesson.findMany({ where: { caseId }, orderBy: { order: "asc" }, select: { lessonId: true } })).map((l) => l.lessonId);
  const dangHoc = new Set((await tx.makeupCaseStudent.findMany({ where: { caseId, status: { not: "RELEASED" }, lessonId: { not: null } }, select: { lessonId: true } })).map((m) => m.lessonId!));
  const giu = bai.filter((l) => dangHoc.has(l));
  if (giu.length === 0 || giu.length === bai.length) return; // không còn gì để dọn (hoặc không còn mục nào — case sắp tự huỷ)
  await tx.makeupCaseLesson.deleteMany({ where: { caseId, lessonId: { notIn: giu } } });
  for (const [i, lessonId] of giu.entries()) await tx.makeupCaseLesson.update({ where: { caseId_lessonId: { caseId, lessonId } }, data: { order: i + 1 } });
  await tx.makeupCase.update({ where: { id: caseId }, data: { lessonId: giu[0]!, version: { increment: 1 } } });
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
    let caseMoi: Awaited<ReturnType<typeof nhaMucTrongTx>>["caseMoi"] = null;
    for (const m of muc) caseMoi = (await nhaMucTrongTx(tx, m.id, { actorId: actor.userId, lyDoSo: "Gỡ bé khỏi case chưa điểm danh", lyDo: "GO_KHOI", now })).caseMoi;
    if (caseMoi === null) await donBaiKhongAiHoc(tx, be.caseId);
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
 *
 * Case CHỜ DUYỆT (20/10/2026) cũng huỷ được: người tạo RÚT LẠI, hoặc quản lý cơ sở TỪ CHỐI (`tuChoi` — có lý do, hiện cho Sale ở màn case). Case chưa duyệt chưa từng là lịch thật nên
 * không có gì để báo ai: không tin phụ huynh, không tin giáo viên, không đánh dấu phân công parttime (chưa từng có). Lượt của các bé được nhả y như huỷ thường.
 */
export async function huyCase(actor: NguoiHocBu, caseId: string, now: Date = new Date(), tuChoi?: { lyDo: string; ten: string }): Promise<void> {
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, teacherId: true, createdById: true, participants: { select: { id: true, attendanceStatus: true } } },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  await chanNeuCaseCoBeNguoiKhac(actor, c.id);
  if (c.status !== "SCHEDULED" && c.status !== CASE_CHO_DUYET) throw new LoiHocBu("Case đã chốt hoặc đã huỷ");
  if (tuChoi && c.status !== CASE_CHO_DUYET) throw new LoiHocBu("Case này không còn chờ duyệt — tải lại trang");
  if (c.participants.some((b) => b.attendanceStatus === "PRESENT" || b.attendanceStatus === "ABSENT")) {
    throw new LoiHocBu("Case đã có bé được điểm danh — không huỷ được, hãy điểm danh nốt");
  }
  let canDongBo = false;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    await nangCapCase(tx, c.id);
    const song = await tx.makeupCase.findUnique({
      where: { id: c.id },
      select: { status: true, participants: { select: { attendanceStatus: true } } },
    });
    if (song?.status !== "SCHEDULED" && song?.status !== CASE_CHO_DUYET) throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    const choDuyet = song.status === CASE_CHO_DUYET;
    if (tuChoi && !choDuyet) throw new LoiHocBu("Case này không còn chờ duyệt — tải lại trang");
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
    const doi = await tx.makeupCase.updateMany({
      where: { id: c.id, status: song.status },
      data: choDuyet ? { status: "CANCELLED", rejectReason: tuChoi?.lyDo ?? "Người tạo rút lại" } : { status: "CANCELLED" },
    });
    if (doi.count !== 1) throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    // Yêu cầu thêm bé đang chờ của case này mất nghĩa: đóng cùng giao dịch (nếu không, các dòng cần bù bị khoá "đang chờ duyệt" vào một case không còn).
    await huyYeuCauKhiHuyCase(tx, { caseId: c.id, actorId: actor.userId, now });
    if (!choDuyet) {
      canDongBo = await danhDauCanDongBo(tx, [{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_HUY", { id: actor.userId, name: "Học bù" });
      // T13 — báo từng phụ huynh có bé bị gỡ + giáo viên của case (một lần). Cùng giao dịch: rollback thì không có sự kiện.
      const sau = await tx.makeupCaseParticipant.findMany({ where: { id: { in: choGo.map((b) => b.id) } }, select: { id: true, version: true } });
      const phienBan = new Map(sau.map((b) => [b.id, b.version]));
      for (const b of choGo) await phatBeBiGo(tx, { caseId: c.id, participantId: b.id, studentId: b.studentId, phienBan: phienBan.get(b.id)! });
      await phatCaseBiHuy(tx, { caseId: c.id, teacherId: c.teacherId });
    } else if (tuChoi && c.createdById !== actor.userId) {
      // Quản lý TỪ CHỐI ⇒ báo người tạo (kèm lý do). Người tạo tự rút lại thì không báo (chính họ vừa bấm); quản lý tự từ chối case của chính mình cũng vậy.
      await phatCaseBiTuChoi(tx, { caseId: c.id, nguoiTaoId: c.createdById });
    }
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ...(tuChoi ? { ten: tuChoi.ten } : {}),
      entityType: "MakeupCase",
      entityId: c.id,
      action: !choDuyet ? "hoc-bu.huy-case" : tuChoi ? "hoc-bu.tu-choi-case" : "hoc-bu.rut-case",
      oldValues: { status: song.status },
      newValues: { status: "CANCELLED", soBeBiGo: choGo.length },
      ...(tuChoi ? { reason: tuChoi.lyDo } : {}),
    });
  });
  if (canDongBo) await dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_HUY", { id: actor.userId, name: "Học bù" });
  // T13: báo giáo viên khi HUỶ ca đi qua `makeup.case.cancelled` (phatCaseBiHuy) — không gọi `baoGvCaBu("huy")` nữa.
}

/**
 * DUYỆT một case chờ duyệt ⇒ LỊCH THẬT (20/10/2026). Quyền `makeup:waive` hỏi ở action; ở đây là luật + phép ghi.
 *
 * Người duyệt có thể ĐỔI giáo viên / phòng NGAY LÚC DUYỆT (hai thứ họ hay phải sửa nhất) — vẫn trong CÙNG giao dịch với việc đổi trạng thái, nên giáo viên chỉ nhận MỘT tin với
 * đúng thông tin đã duyệt, không có tin "đổi lịch" cho một lịch họ chưa từng thấy. Khoá hàng case + kiểm lại trạng thái / phiên bản; kiểm lại GV có ca + KHÔNG trùng lịch với
 * mọi nguồn khác (kể cả case chờ duyệt khác đang giữ chỗ) trước phép ghi đầu tiên; trùng ⇒ `LoiTrungLich`, rollback cả lượt.
 */
export async function duyetCase(
  actor: NguoiHocBu,
  p: { caseId: string; phienBan: number; teacherId?: string; roomId?: string | null; ten: string; now?: Date },
): Promise<void> {
  const now = p.now ?? new Date();
  const c = await scopedDb(actor).makeupCase.findUnique({
    where: { id: p.caseId },
    select: { id: true, status: true, version: true, centerId: true, date: true, startTime: true, endTime: true, teacherId: true, roomId: true, createdById: true },
  });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  const ymd = c.date.toISOString().slice(0, 10);
  const kq = kiemDuyetDuoc({ status: c.status, ymd, startTime: c.startTime, endTime: c.endTime, now });
  if (!kq.ok) throw new LoiHocBu(kq.lyDo);
  const teacherId = p.teacherId ?? c.teacherId;
  const roomId = p.roomId === undefined ? c.roomId : p.roomId;
  const thieuPhong = lyDoThieuPhong({ taoMoi: false, phongTruoc: c.roomId, phongSau: roomId });
  if (thieuPhong) throw new LoiHocBu(thieuPhong);
  await kiemGvVaPhong(actor, { centerId: c.centerId, ymd, startTime: c.startTime, endTime: c.endTime, teacherId, roomId });
  let canDongBo = false;
  // GĐ5 tự xếp: case chờ duyệt thành lịch thật ở đây ⇒ xếp người trực lúc này (không phải lúc Sale tạo).
  const goiY = await goiYTuXepChoCase(actor, { centerId: c.centerId, ymd, startTime: c.startTime, endTime: c.endTime }, c.id);
  let baoQlcs = false;

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    await nangCapCase(tx, c.id);
    const song = await tx.makeupCase.findUnique({
      where: { id: c.id },
      select: { status: true, version: true, participants: { select: { studentId: true, attendanceStatus: true } } },
    });
    if (song?.status !== CASE_CHO_DUYET) throw new LoiHocBu("Case vừa đổi trạng thái — tải lại trang");
    if (song.version !== p.phienBan) throw new LoiHocBu("Case vừa được người khác sửa — tải lại trang rồi duyệt lại");
    const hocVien = song.participants.filter((b) => b.attendanceStatus === "PENDING").map((b) => b.studentId);
    if (hocVien.length === 0) throw new LoiHocBu("Case không còn bé nào — hãy từ chối thay vì duyệt");
    await kiemLichTrongTx(tx, {
      actor,
      khung: { ymd, startTime: c.startTime, endTime: c.endTime },
      teacherId,
      roomId,
      studentIds: hocVien,
      exclude: [{ type: "MAKEUP_CASE", id: c.id }],
    });
    const doi = await tx.makeupCase.updateMany({
      where: { id: c.id, status: CASE_CHO_DUYET, version: p.phienBan },
      data: { status: "SCHEDULED", teacherId, roomId, approvedById: actor.userId, approvedAt: now, rejectReason: null, version: { increment: 1 } },
    });
    if (doi.count !== 1) throw new LoiHocBu("Case vừa được người khác sửa — tải lại trang rồi duyệt lại");
    await phatTinCaseVuaDuyet(tx, c.id);
    // Báo người tạo (Sale…) — trừ khi chính họ duyệt (không có nghĩa với quản lý tự tạo rồi tự duyệt; thực tế quản lý tạo là lịch thật ngay).
    if (c.createdById !== actor.userId) await phatCaseDuocDuyet(tx, { caseId: c.id, nguoiTaoId: c.createdById });
    baoQlcs = (await ghiTuXep(tx, { nguon: { sourceType: "MAKEUP_CASE", sourceId: c.id }, gvId: teacherId, goiY, actor: { id: actor.userId, name: p.ten } })).baoQlcs;
    canDongBo = await danhDauCanDongBo(tx, [{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_TAO", { id: actor.userId, name: p.ten });
    await ghiNhatKy(tx, {
      actorId: actor.userId,
      ten: p.ten,
      entityType: "MakeupCase",
      entityId: c.id,
      action: "hoc-bu.duyet-case",
      oldValues: { status: CASE_CHO_DUYET, teacherId: c.teacherId, roomId: c.roomId },
      newValues: { status: "SCHEDULED", teacherId, roomId },
    });
  });
  if (canDongBo) await dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_TAO", { id: actor.userId, name: p.ten });
  if (baoQlcs) await baoQlcsDuongLui({ centerId: c.centerId, nguon: { sourceType: "MAKEUP_CASE", sourceId: c.id }, moTa: `Case học bù ${ymd} ${c.startTime}–${c.endTime}` });
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
      await voidTienKhiHuyDonTrongTx(tx, phi.orderId, { id: actor.userId, name: p.ten });
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
  const thieuPhong = lyDoThieuPhong({ taoMoi: false, phongTruoc: c.roomId, phongSau: roomId });
  if (thieuPhong) throw new LoiHocBu(thieuPhong);
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
  let canDongBo = false; // Parttime (P3a): đổi ngày / giờ / GV ⇒ phân công lên phiên bản mới hoặc đổi người, sau commit

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
      canDongBo = await danhDauCanDongBo(tx, [{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_SUA", { id: actor.userId, name: p.ten });
      // Chốt lượt 2 điểm 2: đổi GV ở đây ⇒ dòng đứng chính giao tay (màn Phân công) đổi theo NGAY trong giao dịch — không lệch hai nơi.
      if (teacherId !== c.teacherId) await dongBoDungChinhTuNguonGoc(tx, { nguon: { sourceType: "MAKEUP_CASE", sourceId: c.id }, gvMoiId: teacherId, actor: { id: actor.userId, name: p.ten }, lyDo: "Đổi giáo viên ở màn Học bù" });
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
  if (canDongBo) await dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "HOC_BU_SUA", { id: actor.userId, name: p.ten });
}

/**
 * Nâng MỘT case đời cũ lên mô hình nhiều bài NGAY (nút "Nâng cấp case này" ở màn chi tiết, T16). Cùng luật với phép nâng lười của mọi đường ghi và với script
 * hàng loạt (`nangCapCase`) — idempotent; case đã nâng thì không đổi gì và không ghi nhật ký. Màn hình KHÔNG ghi trong lúc render: việc nâng là một hành động có người
 * bấm, có quyền, có dấu vết.
 */
export async function nangCapCaseTheoYeuCau(actor: NguoiHocBu, caseId: string): Promise<{ daNangCap: boolean }> {
  const c = await scopedDb(actor).makeupCase.findUnique({ where: { id: caseId }, select: { id: true, orgUnitId: true } });
  if (!c) throw new LoiHocBu("Không tìm thấy case dạy bù");
  await chanNeuCaseCoBeNguoiKhac(actor, c.id);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${c.id} FOR UPDATE`;
    const kq = await nangCapCase(tx, c.id);
    if (kq.daNangCap) {
      await ghiNhatKy(tx, {
        actorId: actor.userId,
        entityType: "MakeupCase",
        entityId: c.id,
        action: "hoc-bu.nang-cap-case",
        orgUnitId: c.orgUnitId,
        newValues: { boBaiTao: kq.lessonTao, beTao: kq.beTao, mucNoi: kq.mucNoi },
      });
    }
    return { daNangCap: kq.daNangCap };
  });
}
