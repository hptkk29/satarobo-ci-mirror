// lib/parttime/ngu-canh-cham-cong-db.ts — ĐỌC ngữ cảnh hôm nay cho màn "Chấm công" (một nút). Chỉ ĐỌC, không ghi.
//
// Nguồn — đúng một chỗ cho mỗi loại việc, KHÔNG dựng lại:
//   · tiết dạy / trợ giảng: `docBangChungCuaToi` (P4) — đã có vai, hoạt động, khung phải có mặt, đã nhận đúng phiên bản chưa,
//     tình trạng buổi, và BẰNG CHỨNG (muộn / sớm / thiếu ra / sai người) tính sẵn; chỉ thêm `assignmentType` + nhãn lớp;
//   · trực: `OperationsDutyAssignment` tường minh (khung giờ theo chính sách tại ngày);
//   · ca thường: `ShiftAssignment` ACTIVE hôm nay (tên mẫu ca + các đoạn WORK).
// Số câu tra KHÔNG phụ thuộc số tiết (`[CTX-DB-Q]`). Công tắc TẮT / ngày LEGACY ⇒ `null` ⇒ màn y như cũ.
import "server-only";
import { db } from "@/lib/db";
import { vnDateOnly } from "@/lib/time/vn";
import type { SuyHuongHomNay } from "@/lib/cham-cong/suy-huong-db";
import { docBangChungCuaToi } from "./bang-chung-cong-db";
import { chinhSachTaiNgay } from "./chinh-sach";
import { dungNguCanh, type CaVao, type NguCanhChamCong, type TietVao, type TrucVao } from "./ngu-canh-cham-cong";
import { nhanBangChung } from "./nhan-bang-chung";
import { docChinhSach, phanCongBat } from "./phan-cong-db";

const SONG = ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] as const;

export async function docNguCanhChamCong(p: {
  userId: string;
  /** Điểm chấm đang quét (null = lượt công tác) — cơ sở của nó dùng để nói "tiết này ở cơ sở khác". */
  workLocationId: string | null;
  /** Kết quả `suyHuongHomNay` cho ĐÚNG lượt này — hướng không bao giờ tính lại ở đây. */
  huong: SuyHuongHomNay;
  now: Date;
}): Promise<NguCanhChamCong | null> {
  if (!(await phanCongBat())) return null;
  const workDate = vnDateOnly(p.now);
  const ymd = workDate.toISOString().slice(0, 10);
  const chinhSach = await docChinhSach();
  const cs = chinhSachTaiNgay(chinhSach, ymd);
  if (!cs || cs.thamSo.loai !== "SR_QD_238") return null;
  const ts = cs.thamSo;

  const [bc, trucRaw, ca, wl] = await Promise.all([
    docBangChungCuaToi({ userId: p.userId, tu: ymd, den: ymd, now: p.now }),
    db.operationsDutyAssignment.findMany({
      where: { userId: p.userId, workDate, status: { in: [...SONG] } },
      select: { id: true, shiftCode: true, centerId: true, assignmentVersion: true, acceptances: { select: { assignmentVersion: true, decision: true } } },
    }),
    db.shiftAssignment.findFirst({ where: { userId: p.userId, workDate, status: "ACTIVE" }, select: { segments: true, template: { select: { name: true } } } }),
    p.workLocationId ? db.workLocation.findUnique({ where: { id: p.workLocationId }, select: { centerId: true } }) : Promise.resolve(null),
  ]);
  // Buổi đã huỷ / lớp đã đóng / ngày LEGACY không phải việc hôm nay.
  const day = bc.filter((r) => r.requiredFrom && r.requiredTo && r.dongDoi.tinhTrangBuoi !== "DA_DONG" && r.trangThai !== "BUOI_DA_HUY");
  const ids = (t: string) => [...new Set(day.filter((r) => r.sourceType === t).map((r) => r.sourceId))];
  const coSo = [...new Set([...day.map((r) => r.centerId), ...trucRaw.map((t) => t.centerId)])];
  const [pcs, lop, bu, trial, centers] = await Promise.all([
    day.length ? db.sessionStaffAssignment.findMany({ where: { id: { in: day.map((r) => r.assignmentId) } }, select: { id: true, assignmentType: true } }) : [],
    ids("CLASS_SESSION").length ? db.classSession.findMany({ where: { id: { in: ids("CLASS_SESSION") } }, select: { id: true, class: { select: { classCode: true, name: true } } } }) : [],
    ids("MAKEUP_CASE").length ? db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: { id: true, courseId: true } }) : [],
    ids("TRIAL_SESSION").length ? db.trialClassSession.findMany({ where: { id: { in: ids("TRIAL_SESSION") } }, select: { id: true, trialClass: { select: { name: true } } } }) : [],
    coSo.length ? db.center.findMany({ where: { id: { in: coSo } }, select: { id: true, code: true } }) : [],
  ]);
  const khoa = bu.length ? await db.course.findMany({ where: { id: { in: [...new Set(bu.map((c) => c.courseId))] } }, select: { id: true, name: true } }) : [];
  const nhan = new Map<string, string>([
    ...lop.map((s) => [`CLASS_SESSION:${s.id}`, s.class.classCode ?? s.class.name] as const),
    ...bu.map((c) => [`MAKEUP_CASE:${c.id}`, khoa.find((k) => k.id === c.courseId)?.name ?? "Học bù"] as const),
    ...trial.map((t) => [`TRIAL_SESSION:${t.id}`, t.trialClass.name] as const),
  ]);
  const maCoSo = new Map(centers.map((c) => [c.id, c.code]));
  const kieu = new Map(pcs.map((x) => [x.id, x.assignmentType]));

  const tiet: TietVao[] = day.map((r) => {
    const n = nhanBangChung(r);
    // Đang trong buổi (chưa ra) mà đã muộn ⇒ nói luôn số phút — đọc từ P4 (`diMuon`/`treVaoPhut`), không tính lại.
    const bangChung = n ? (r.trangThai === "DA_VAO" && r.diMuon ? `${n.nhan} · muộn ${r.treVaoPhut}'` : n.nhan) : null;
    return {
      assignmentId: r.assignmentId,
      role: r.role,
      activity: r.activity,
      assignmentType: kieu.get(r.assignmentId) ?? "REGULAR",
      nhanLop: nhan.get(`${r.sourceType}:${r.sourceId}`) ?? "Buổi học",
      centerId: r.centerId,
      centerCode: maCoSo.get(r.centerId) ?? null,
      batDau: new Date(r.requiredFrom!.getTime() + ts.tiet.chuanBiPhut * 60_000),
      ketThuc: r.requiredTo!,
      requiredFrom: r.requiredFrom!,
      daNhan: r.daNhan,
      bangChung,
    };
  });
  const truc: TrucVao[] = trucRaw.flatMap((t) => {
    const k = ts.ca.find((c) => c.ma === t.shiftCode);
    if (!k) return [];
    return [{ dutyId: t.id, shiftCode: t.shiftCode, tu: new Date(`${ymd}T${k.tu}:00+07:00`), den: new Date(`${ymd}T${k.den}:00+07:00`), centerId: t.centerId, centerCode: maCoSo.get(t.centerId) ?? null, daNhan: t.acceptances.some((a) => a.assignmentVersion === t.assignmentVersion && a.decision === "ACCEPTED") }];
  });
  const segs = Array.isArray(ca?.segments) ? (ca.segments as { start?: unknown; end?: unknown; kind?: unknown }[]) : [];
  const caThuong: CaVao | null = ca
    ? { ten: ca.template?.name ?? null, timeLabel: segs.filter((s) => s.kind === "WORK" && typeof s.start === "string" && typeof s.end === "string").map((s) => `${s.start}–${s.end}`).join(" · ") }
    : null;
  return dungNguCanh({ huong: p.huong, caThuong, tiet, truc, centerHienTai: wl?.centerId ?? null, now: p.now });
}

/** Bản AN TOÀN cho màn chấm công: lỗi bất kỳ ⇒ `null` (thẻ cũ, chấm công vẫn chạy) + ghi log. Không bao giờ ném. */
export async function docNguCanhAnToan(p: Parameters<typeof docNguCanhChamCong>[0]): Promise<NguCanhChamCong | null> {
  try {
    return await docNguCanhChamCong(p);
  } catch (e) {
    console.error("[docNguCanhChamCong] lỗi — màn chấm công dùng thẻ cũ", e);
    return null;
  }
}
