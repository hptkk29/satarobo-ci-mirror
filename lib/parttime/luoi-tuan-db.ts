// lib/parttime/luoi-tuan-db.ts — ĐỌC lưới phân công giáo viên một cơ sở × một tuần. CHỈ ĐỌC — không ghi bảng nào.
// Số câu tra KHÔNG phụ thuộc số buổi / số người (đọc theo lô). Ghép + suy mã ở hàm thuần `ghepLuoi` (`luoi-tuan-ghep.ts`).
// `db` trần: phạm vi đã được nơi gọi chốt (trang kiểm `hr_attendance:view` cho đúng cơ sở; phân công nơi khác chỉ đọc để báo trùng giờ).
import "server-only";
import { db } from "@/lib/db";
import { chinhSachTaiNgay, phutTrongNgay } from "./chinh-sach";
import { docChinhSach } from "./phan-cong-db";
import { TRANG_THAI_SONG } from "./phan-cong";
import { docGhiDeDonVi, khoaBuoiCua } from "./don-vi-tiet-db";
import { donViTiet, ghiDeChoBuoi, type DonViTiet, type KhoaBuoi } from "./don-vi-tiet";
import { xetHoTroTrial, type KetQuaTrial } from "./luoi-tuan";
import { ghepLuoi, type DongGiaoVien, type DonViDaXacNhan, type PhanCongVao, type TrucVao } from "./luoi-tuan-ghep";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const mocVn = (ngay: string, hhmm: string) => new Date(`${ngay}T${hhmm}:00+07:00`);
const CHUAN: DonViTiet = { trangThai: "CHUAN", donVi: "1", ghiDeId: null };

export type LuoiTuan = {
  ngays: string[];
  dong: (DongGiaoVien & { ten: string; tenCoSoGoc: string | null })[];
  /** Buổi trial → lớp trial (để màn mở được case nguồn: `/lop-trial/<id>`). */
  lopTrialCuaBuoi: Record<string, string>;
};

export async function docLuoiTuan(p: { centerId: string; tu: string; den: string; now: Date }): Promise<LuoiTuan> {
  const ngays: string[] = [];
  for (let d = ngayDate(p.tu); d <= ngayDate(p.den); d = new Date(d.getTime() + 86_400_000)) ngays.push(ymd(d));
  const khoang = { gte: ngayDate(p.tu), lte: ngayDate(p.den) };

  const [pcRaw, trucRaw, chinhSach, ghiDe] = await Promise.all([
    db.sessionStaffAssignment.findMany({ where: { centerId: p.centerId, ngay: khoang, status: { in: [...TRANG_THAI_SONG] } } }),
    db.operationsDutyAssignment.findMany({ where: { centerId: p.centerId, workDate: khoang, status: { in: [...TRANG_THAI_SONG] } } }),
    docChinhSach(),
    docGhiDeDonVi(),
  ]);
  const nguoi = [...new Set([...pcRaw.map((x) => x.userId), ...trucRaw.map((x) => x.userId)])];
  const trialPc = pcRaw.filter((x) => x.sourceType === "TRIAL_SESSION" && x.role === "MAIN_TEACHER");

  const [noiKhacRaw, users, rankRaw, khoa, daXn, trialBuoi] = await Promise.all([
    nguoi.length ? db.sessionStaffAssignment.findMany({ where: { userId: { in: nguoi }, centerId: { not: p.centerId }, ngay: khoang, status: { in: [...TRANG_THAI_SONG] } } }) : [],
    nguoi.length ? db.user.findMany({ where: { id: { in: nguoi } }, select: { id: true, name: true, email: true, centerId: true, center: { select: { name: true } } } }) : [],
    nguoi.length ? db.teacherRankHistory.findMany({ where: { userId: { in: nguoi } }, select: { userId: true, rank: true, effectiveFrom: true } }) : [],
    ghiDe.length ? khoaBuoiCua(pcRaw) : Promise.resolve(new Map<string, KhoaBuoi>()),
    pcRaw.length || trucRaw.length
      ? db.workUnit.findMany({
          where: { assignmentId: { in: [...pcRaw.map((x) => x.id), ...trucRaw.map((x) => x.id)] }, status: "CONFIRMED" },
          select: { assignmentId: true, workUnitType: true, quantity: true, rateSnapshot: true },
        })
      : [],
    trialPc.length
      ? db.trialClassSession.findMany({
          where: { id: { in: trialPc.map((x) => x.sourceId) } },
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            status: true,
            teacherId: true,
            trialClassId: true,
            trialClass: { select: { teacherId: true } },
            attendances: { select: { trialEnrollmentId: true, status: true } },
          },
        })
      : [],
  ]);
  const ghiDanhTrial = trialBuoi.length
    ? await db.trialEnrollment.findMany({
        where: { trialClassId: { in: [...new Set(trialBuoi.map((b) => b.trialClassId))] } },
        select: { id: true, trialClassId: true, scheduledSessionId: true, status: true },
      })
    : [];

  const dvt = (x: (typeof pcRaw)[number]): DonViTiet => {
    if (x.activityType === "TRIAL") return CHUAN; // Trial không phải tiết — không vào phép tiền tiết
    const ngay = ymd(x.ngay);
    const cs = chinhSachTaiNgay(chinhSach, ngay);
    if (!cs || cs.thamSo.loai !== "SR_QD_238") return CHUAN;
    const thoiLuong = phutTrongNgay(x.gioKetThuc) - phutTrongNgay(x.gioBatDau);
    const k = khoa.get(`${x.sourceType}:${x.sourceId}`);
    return donViTiet({ thoiLuongDayPhut: thoiLuong, chuanDayPhut: cs.thamSo.tiet.dayPhut, ghiDe: k ? ghiDeChoBuoi(ghiDe, k, ngay, cs.id) : [] });
  };
  const sangVao = (x: (typeof pcRaw)[number]): PhanCongVao => ({
    id: x.id,
    userId: x.userId,
    centerId: x.centerId,
    sourceType: x.sourceType,
    sourceId: x.sourceId,
    ngay: ymd(x.ngay),
    gioBatDau: x.gioBatDau,
    gioKetThuc: x.gioKetThuc,
    role: x.role,
    activityType: x.activityType,
    assignmentType: x.assignmentType,
    status: x.status,
    donViTiet: dvt(x),
  });

  // Hỗ trợ Trial — cổng thuần `xetHoTroTrial`. Bảng chính sách hỗ trợ Trial + chứng nhận Trial CHƯA có (PR4 của đợt này): tới khi nối,
  // mọi buổi trả TRIAL_POLICY_DISABLED + CERTIFICATE_MISSING (0đ) — đúng nghĩa "chưa có căn cứ trả", không đoán.
  const buoiTheoId = new Map(trialBuoi.map((b) => [b.id, b]));
  const trial = new Map<string, KetQuaTrial>();
  for (const x of trialPc) {
    const b = buoiTheoId.get(x.sourceId);
    if (!b) continue;
    const ngay = ymd(b.date);
    const diem = new Map(b.attendances.map((a) => [a.trialEnrollmentId, a.status]));
    const be = ghiDanhTrial.filter((e) => e.trialClassId === b.trialClassId && (e.scheduledSessionId === b.id || e.scheduledSessionId == null));
    trial.set(
      x.id,
      xetHoTroTrial({
        chinhSach: null,
        chungNhanHieuLuc: false,
        phanCongTaoLuc: x.createdAt,
        batDauBuoi: mocVn(ngay, b.startTime),
        ketThucBuoi: mocVn(ngay, b.endTime),
        nguoiPhanCong: x.userId,
        gvCuaBuoi: b.teacherId ?? b.trialClass.teacherId ?? null,
        buoiHuy: b.status === "CANCELLED",
        hocVien: be.map((e) => ({ ghiDanhId: e.id, hopLe: e.status !== "WITHDRAWN", diemDanh: diem.get(e.id) ?? null })),
        now: p.now,
      }),
    );
  }

  const rank = new Map<string, { rank: number; hieuLucTu: string }[]>();
  for (const r of rankRaw) rank.set(r.userId, [...(rank.get(r.userId) ?? []), { rank: r.rank, hieuLucTu: ymd(r.effectiveFrom) }]);
  const truc: TrucVao[] = trucRaw.map((t) => ({ id: t.id, userId: t.userId, centerId: t.centerId, ngay: ymd(t.workDate), shiftCode: t.shiftCode, status: t.status }));
  const daXacNhan: DonViDaXacNhan[] = daXn.flatMap((d) =>
    d.assignmentId ? [{ assignmentId: d.assignmentId, loai: d.workUnitType, quantity: Number(d.quantity), rateSnapshot: d.rateSnapshot }] : [],
  );

  const dong = ghepLuoi({
    centerId: p.centerId,
    ngays,
    chinhSach,
    phanCong: pcRaw.map(sangVao),
    phanCongNoiKhac: noiKhacRaw.map(sangVao),
    truc,
    rank,
    coSoGoc: new Map(users.map((u) => [u.id, u.centerId])),
    trial,
    daXacNhan,
  });
  const uTheoId = new Map(users.map((u) => [u.id, u]));
  return {
    ngays,
    dong: dong
      .map((d) => {
        const u = uTheoId.get(d.userId);
        return { ...d, ten: u?.name ?? u?.email ?? d.userId, tenCoSoGoc: u?.center?.name ?? null };
      })
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi")),
    lopTrialCuaBuoi: Object.fromEntries(trialBuoi.map((b) => [b.id, b.trialClassId])),
  };
}
