// lib/phan-cong/giao-go-db.ts — ĐƯỜNG GHI của màn Phân công gộp (GĐ2, docs/phan-cong-gop/KHAO-SAT.md chốt 1, 6).
//
// Hai thao tác, mỗi thao tác rải theo phạm vi (`CHI_BUOI_NAY` | `CAC_TUAN_SAU`) trong MỘT giao dịch của nơi gọi:
//   · datNguoiVaoBuoi — giao / thay / gỡ giáo viên đứng chính hoặc trợ giảng của buổi;
//   · datTruc         — giao / gỡ ca trực.
// Mỗi ngày đi qua cổng `lyDoKhongGiaoDuoc` (đã qua · kỳ đã chốt): ngày bị chặn được BỎ QUA và báo lại, không làm hỏng cả lô. Lỗi
// nghiệp vụ giữa chừng (buổi trùng lịch, người đã có vai khác…) ⇒ `throw LoiGiaoGo` ⇒ cả lô quay lui (luật rollback).
//
// Ghi qua CỬA GHI DUY NHẤT `lib/parttime/phan-cong-db.ts` (lưới [PT3-W-DG2]) — không `create`/`update` SessionStaffAssignment ở đây:
//   · phân công: `phanCongVaoBuoi` / `thayGiaoVienChinh` (mang `nguonGiao: "TAY"`) · gỡ: `goTayPhanCong`;
//   · đứng chính BUỔI LỚP chính thức: ghi THÊM `ClassSession.substituteTeacherId` qua `adjustSession` (kiểm trùng lịch GV/phòng),
//     cùng giao dịch — chốt 6 "ghi cả hai nơi để màn lớp học không lệch";
//   · đứng chính HỌC BÙ / TRIAL: ghi THÊM cột GV gốc (`MakeupCase.teacherId` / `TrialClassSession.teacherId`) cùng giao dịch, kiểm trùng
//     lịch GV — chốt lượt 2 điểm 2 (27/10): lệch hai nơi là LỖI (điểm danh học bù `diemDanhBu` và tiền Trial đọc cột gốc). Học bù có
//     `teacherId` NOT NULL ⇒ không gỡ trống được, phải chọn người thay (như lớp chính thức);
//   · trực: `giaoTruc` / `huyTruc`.
// Gỡ tay ⇒ dòng CANCELLED mang `nguonGiao: "TAY"` ⇒ đồng bộ một chiều không dựng lại đúng người đó vào vai đó (`keHoachDongBo`).
import "server-only";
import type { Prisma } from "@prisma/client";
import { adjustSession } from "@/lib/classes/adjust";
import { checkScheduleConflicts, khoaLichTrongTx } from "@/lib/lms/schedule-conflict";
import { vnYmd } from "@/lib/time/vn";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import {
  docBuoi,
  dongBoPhanCongTheoNguon,
  goTayPhanCong,
  khoaBuoi,
  phanCongVaoBuoi,
  thayGiaoVienChinh,
  type Nguon,
  type NguoiThaoTac,
  type ThongBaoPhanCong,
} from "@/lib/parttime/phan-cong-db";
import { giaoTruc, huyTruc } from "@/lib/parttime/truc-van-hanh-db";
import { hetThangSau, lyDoKhongGiaoDuoc, ngayTheoPhamVi, type PhamVi } from "./giao-go";

type Tx = Prisma.TransactionClient;

/** Lỗi nghiệp vụ giữa lô — ném để giao dịch quay lui; action dịch thành câu báo. */
export class LoiGiaoGo extends Error {}

export type KetQuaGiaoGo = { soNgay: number; boQua: { ngay: string; lyDo: string }[]; thongBao: ThongBaoPhanCong[] };

const VAI = { MAIN_TEACHER: "đứng chính", TEACHING_ASSISTANT: "trợ giảng" } as const;
const SONG_TRUC = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * Ghi CỘT GV GỐC của buổi học bù / Trial (chốt lượt 2 điểm 2). Trả về sớm khi cột đã đúng. Kiểm trùng lịch GV (mọi nguồn lịch, trừ chính
 * buổi này) trước phép ghi; trùng ⇒ `throw LoiGiaoGo` ⇒ cả lô quay lui cùng phân công. Học bù chỉ ghi khi case còn SCHEDULED (case chờ
 * duyệt có GV do người duyệt chọn — không ghi đè; `tinhTrang` MO của `docBuoi` đã loại case đã chốt / huỷ).
 */
export async function ghiGvNguonGoc(tx: Tx, n: Nguon, gvId: string | null, chiKhiDangLa?: string): Promise<void> {
  if (n.sourceType === "CLASS_SESSION") return;
  if (n.sourceType === "MAKEUP_CASE") {
    if (!gvId) throw new LoiGiaoGo("Case học bù phải có giáo viên — chọn người thay thay vì gỡ.");
    const c = await tx.makeupCase.findUnique({ where: { id: n.sourceId }, select: { teacherId: true, status: true, date: true, startTime: true, endTime: true } });
    if (!c || c.teacherId === gvId) return;
    if (c.status !== "SCHEDULED") throw new LoiGiaoGo("Case học bù đang chờ duyệt — đổi giáo viên ở màn Học bù.");
    await kiemTrungGv(tx, { ymd: c.date.toISOString().slice(0, 10), startTime: c.startTime, endTime: c.endTime }, gvId, { type: "MAKEUP_CASE", id: n.sourceId });
    const r = await tx.makeupCase.updateMany({ where: { id: n.sourceId, status: "SCHEDULED", teacherId: c.teacherId }, data: { teacherId: gvId, version: { increment: 1 } } });
    if (r.count !== 1) throw new LoiGiaoGo("Case học bù vừa được người khác sửa — tải lại trang rồi thử lại.");
    return;
  }
  const t = await tx.trialClassSession.findUnique({ where: { id: n.sourceId }, select: { teacherId: true, date: true, startTime: true, endTime: true } });
  if (!t || t.teacherId === gvId || (chiKhiDangLa !== undefined && t.teacherId !== chiKhiDangLa)) return;
  if (gvId) await kiemTrungGv(tx, { ymd: t.date.toISOString().slice(0, 10), startTime: t.startTime, endTime: t.endTime }, gvId, { type: "TRIAL_CLASS_SESSION", id: n.sourceId });
  const r = await tx.trialClassSession.updateMany({ where: { id: n.sourceId, teacherId: t.teacherId }, data: { teacherId: gvId } });
  if (r.count !== 1) throw new LoiGiaoGo("Buổi Trial vừa được người khác sửa — tải lại trang rồi thử lại.");
}

/** Như `ghiGvNguonGoc` nhưng chỉ khi vai là ĐỨNG CHÍNH — chỗ gọi ở tầng action không tự so vai (lint `no-inline-authz`). */
export async function ghiGvNguonGocNeuDungChinh(tx: Tx, n: Nguon, vai: string, gvId: string | null, chiKhiDangLa?: string): Promise<void> {
  if (vai === "MAIN_TEACHER") await ghiGvNguonGoc(tx, n, gvId, chiKhiDangLa);
}

async function kiemTrungGv(
  tx: Tx,
  khung: { ymd: string; startTime: string; endTime: string },
  teacherId: string,
  boQua: { type: "MAKEUP_CASE" | "TRIAL_CLASS_SESSION"; id: string },
): Promise<void> {
  await khoaLichTrongTx(tx, { khung, teacherId });
  const kq = await checkScheduleConflicts({ khung, teacherId, exclude: [boQua] }, tx);
  // Câu chung, không nêu chi tiết việc kia (có thể ở cơ sở ngoài tầm nhìn người thao tác).
  if (kq.coXungDot) throw new LoiGiaoGo(`Buổi ${khung.ymd}: giáo viên đã có lịch dạy khác trùng khung ${khung.startTime}–${khung.endTime}.`);
}

async function trangThaiKy(tx: Tx, centerId: string, ngays: readonly string[]): Promise<Map<string, string>> {
  const ky = [...new Set(ngays.map((n) => n.slice(0, 7)))];
  const rows = await tx.attendancePeriod.findMany({ where: { centerId, periodKey: { in: ky } }, select: { periodKey: true, status: true } });
  return new Map(rows.map((r) => [r.periodKey, r.status]));
}

/** Các buổi mà thao tác chạm tới. `CAC_TUAN_SAU` chỉ có nghĩa với buổi LỚP (học bù / Trial không lặp tuần). */
async function cacBuoi(tx: Tx, nguon: Nguon, ngay: string, classId: string | null, phamVi: PhamVi): Promise<Nguon[]> {
  if (phamVi === "CHI_BUOI_NAY") return [nguon];
  if (nguon.sourceType !== "CLASS_SESSION" || !classId) throw new LoiGiaoGo("“Các tuần sau” chỉ áp cho buổi lớp — học bù / Trial không lặp theo tuần.");
  const ngays = new Set(ngayTheoPhamVi({ ngay, phamVi }));
  const ds = await tx.classSession.findMany({
    where: {
      classId,
      status: { not: "CANCELLED" },
      date: { gte: new Date(`${ngay}T00:00:00+07:00`), lte: new Date(`${hetThangSau(ngay)}T23:59:59+07:00`) },
    },
    select: { id: true, date: true },
    orderBy: { date: "asc" },
  });
  return ds.filter((s) => ngays.has(vnYmd(s.date))).map((s) => ({ sourceType: "CLASS_SESSION" as const, sourceId: s.id }));
}

/**
 * Giao / thay / gỡ người ở MỘT vai của buổi, rải theo phạm vi.
 *   · `userId` khác null ⇒ GIAO (vai đã có người khác ⇒ THAY; với trợ giảng phải nói thay ai qua `boUserId`, không thì thêm người).
 *   · `userId` null ⇒ GỠ `boUserId` (bắt buộc). Buổi lớp chính thức không gỡ trống được GV đứng chính của lớp — phải chọn người thay.
 * `homNay` BẮT BUỘC (luật 7): ngày ≤ hôm qua bị bỏ qua, không bao giờ suy từ đồng hồ ở đây.
 */
export async function datNguoiVaoBuoi(
  tx: Tx,
  p: {
    nguon: Nguon;
    role: "MAIN_TEACHER" | "TEACHING_ASSISTANT";
    userId: string | null;
    boUserId: string | null;
    phamVi: PhamVi;
    homNay: string;
    lyDo: string;
    actor: NguoiThaoTac & { id: string };
    /** TAY = QLCS giao trên màn · AP_KHUNG = áp khung lịch (GĐ4). BẮT BUỘC (luật 7). */
    nguonGiao: "TAY" | "AP_KHUNG";
  },
): Promise<KetQuaGiaoGo> {
  if (!p.userId && !p.boUserId) throw new LoiGiaoGo("Chọn người để giao, hoặc người cần gỡ.");
  if (p.userId && p.userId === p.boUserId) throw new LoiGiaoGo("Người thay trùng người đang giữ vai.");
  const goc = await docBuoi(tx, p.nguon);
  if (!goc) throw new LoiGiaoGo("Không tìm thấy buổi.");
  const ds = await cacBuoi(tx, p.nguon, goc.ngay, goc.classId, p.phamVi);
  const ky = await trangThaiKy(tx, goc.centerId, [goc.ngay, ...(p.phamVi === "CAC_TUAN_SAU" ? ngayTheoPhamVi({ ngay: goc.ngay, phamVi: p.phamVi }) : [])]);
  const kq: KetQuaGiaoGo = { soNgay: 0, boQua: [], thongBao: [] };

  for (const n of ds) {
    await khoaBuoi(tx, n);
    const b = n.sourceId === p.nguon.sourceId ? goc : await docBuoi(tx, n);
    if (!b) continue;
    const chan = lyDoKhongGiaoDuoc({ ngay: b.ngay, homNay: p.homNay, trangThaiKy: ky.get(b.ngay.slice(0, 7)) ?? null });
    if (chan) {
      kq.boQua.push({ ngay: b.ngay, lyDo: chan });
      continue;
    }
    if (b.tinhTrang !== "MO") {
      kq.boQua.push({ ngay: b.ngay, lyDo: b.lyDoDong ?? "Buổi đã kết thúc" });
      continue;
    }
    const song = await tx.sessionStaffAssignment.findMany({
      where: { sourceType: n.sourceType, sourceId: n.sourceId, role: p.role, status: { in: [...TRANG_THAI_SONG] } },
      select: { id: true, userId: true, role: true, status: true },
    });
    const lop =
      n.sourceType === "CLASS_SESSION"
        ? await tx.classSession.findUnique({ where: { id: n.sourceId }, select: { substituteTeacherId: true, class: { select: { teacherId: true } } } })
        : null;
    const ghiDayThay = async (dayThay: string | null) => {
      if (!lop || lop.substituteTeacherId === dayThay) return;
      const r = await adjustSession({ sessionId: n.sourceId, teacherId: dayThay, actorId: p.actor.id, actorName: p.actor.name, tx, dongBoPhanCong: false });
      if (!r.ok) throw new LoiGiaoGo(`Buổi ${b.ngay}: ${r.error ?? "không ghi được giáo viên dạy thay của buổi"}`);
    };

    if (p.userId) {
      if (p.role === "MAIN_TEACHER") {
        // Lớp chính thức: GV của lớp ⇒ xoá người dạy thay; người khác ⇒ người dạy thay của buổi (cùng giao dịch, kiểm trùng lịch).
        if (lop) await ghiDayThay(p.userId === lop.class.teacherId ? null : p.userId);
        else await ghiGvNguonGoc(tx, n, p.userId);
        const r = await thayGiaoVienChinh(tx, { nguon: n, gvMoiId: p.userId, actor: p.actor, sourceWorkRequestId: null, lyDo: p.lyDo, nguonKhongDon: p.nguonGiao });
        if (!r.ok) throw new LoiGiaoGo(`Buổi ${b.ngay}: ${r.loi}`);
        kq.thongBao.push(...r.thongBao);
      } else {
        const cu = p.boUserId ? song.find((s) => s.userId === p.boUserId) : undefined;
        if (cu) {
          const t = await goTayPhanCong(tx, { ...cu, actor: p.actor, lyDo: p.lyDo, moTa: `${VAI[p.role]} ngày ${b.ngay}` });
          if (t) kq.thongBao.push(t);
        }
        const r = await phanCongVaoBuoi(tx, { nguon: n, userId: p.userId, role: p.role, assignmentType: "MANUAL", nguonGiao: p.nguonGiao, actor: p.actor, note: p.lyDo, replacesAssignmentId: cu?.id ?? null });
        if (!r.ok) throw new LoiGiaoGo(`Buổi ${b.ngay}: ${r.loi}`);
        kq.thongBao.push(...r.thongBao);
      }
    } else {
      const cu = song.filter((s) => s.userId === p.boUserId);
      if (!cu.length) {
        kq.boQua.push({ ngay: b.ngay, lyDo: "Người này không giữ vai đó ở buổi này" });
        continue;
      }
      if (p.role === "MAIN_TEACHER" && lop) {
        if (lop.substituteTeacherId !== p.boUserId && lop.class.teacherId === p.boUserId) {
          throw new LoiGiaoGo(`Buổi ${b.ngay}: buổi lớp chính thức phải có giáo viên đứng chính — chọn người thay thay vì gỡ.`);
        }
        if (lop.substituteTeacherId === p.boUserId) await ghiDayThay(null);
      }
      if (p.role === "MAIN_TEACHER" && !lop) await ghiGvNguonGoc(tx, n, null, p.boUserId!);
      for (const c of cu) {
        const t = await goTayPhanCong(tx, { ...c, actor: p.actor, lyDo: p.lyDo, moTa: `${VAI[p.role]} ngày ${b.ngay}` });
        if (t) kq.thongBao.push(t);
      }
      // Buổi lớp gỡ người dạy thay ⇒ GV của lớp đứng lại: đồng bộ dựng dòng DONG_BO ngay trong giao dịch (không chờ cron).
      if (p.role === "MAIN_TEACHER" && lop) {
        const r = await dongBoPhanCongTheoNguon(tx, n, { actor: p.actor, nguonKichHoat: "GO_TAY", congTacTai: () => true });
        kq.thongBao.push(...r.thongBao);
      }
    }
    kq.soNgay++;
  }
  return kq;
}

/** Giao (`giao: true`) / gỡ ca trực của một người, rải theo phạm vi. `homNay` BẮT BUỘC (luật 7). */
export async function datTruc(
  tx: Tx,
  p: { centerId: string; userId: string; ngay: string; shiftCode: string; giao: boolean; phamVi: PhamVi; homNay: string; lyDo: string; actor: NguoiThaoTac & { id: string } },
): Promise<KetQuaGiaoGo> {
  const ngays = ngayTheoPhamVi({ ngay: p.ngay, phamVi: p.phamVi });
  const ky = await trangThaiKy(tx, p.centerId, ngays);
  const kq: KetQuaGiaoGo = { soNgay: 0, boQua: [], thongBao: [] };
  for (const ngay of ngays) {
    const chan = lyDoKhongGiaoDuoc({ ngay, homNay: p.homNay, trangThaiKy: ky.get(ngay.slice(0, 7)) ?? null });
    if (chan) {
      kq.boQua.push({ ngay, lyDo: chan });
      continue;
    }
    if (p.giao) {
      const daCo = await tx.operationsDutyAssignment.findFirst({ where: { userId: p.userId, workDate: ngayDb(ngay), shiftCode: p.shiftCode, status: { in: [...SONG_TRUC] } }, select: { id: true } });
      if (daCo) {
        kq.boQua.push({ ngay, lyDo: "Đã giao trực ca này rồi" });
        continue;
      }
      const r = await giaoTruc(tx, { userId: p.userId, centerId: p.centerId, ngay, shiftCode: p.shiftCode, note: p.lyDo, nguonGiao: "TAY", actor: p.actor });
      if (!r.ok) throw new LoiGiaoGo(`Ngày ${ngay}: ${r.loi}`);
    } else {
      const d = await tx.operationsDutyAssignment.findFirst({
        where: { userId: p.userId, centerId: p.centerId, workDate: ngayDb(ngay), shiftCode: p.shiftCode, status: { in: [...SONG_TRUC] } },
        select: { id: true },
      });
      if (!d) {
        kq.boQua.push({ ngay, lyDo: "Không có ca trực này để gỡ" });
        continue;
      }
      const r = await huyTruc(tx, { dutyId: d.id, lyDo: p.lyDo, actor: p.actor });
      if (!r.ok) throw new LoiGiaoGo(`Ngày ${ngay}: ${r.loi}`);
    }
    kq.soNgay++;
  }
  return kq;
}
