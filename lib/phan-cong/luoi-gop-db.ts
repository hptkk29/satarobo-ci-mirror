// lib/phan-cong/luoi-gop-db.ts — ĐỌC màn Phân công gộp (GĐ3) cho một cơ sở × một khoảng ngày (tuần hoặc tháng). CHỈ ĐỌC.
// Số câu tra không phụ thuộc số buổi / số người (đọc theo lô). Ghép + suy mã ở hàm thuần `ghepLuoiGop` (`luoi-gop.ts`).
// Buổi + phân công đọc qua CHÍNH `docTuanPhanCong` của màn cũ (một định nghĩa "buổi nào, ai đứng") — không dựng bộ đọc thứ hai.
// `db` trần: phạm vi đã được trang chốt (VIEW / ASSIGN đúng cơ sở); việc ở cơ sở khác chỉ đọc để báo trùng giờ.
import "server-only";
import { db } from "@/lib/db";
import { docTuanPhanCong } from "@/lib/parttime/bang-phan-cong";
import { chinhSachTaiNgay } from "@/lib/parttime/chinh-sach";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import { docChinhSach } from "@/lib/parttime/phan-cong-db";
import { docGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { ghepLuoiGop, type BuoiVao, type LuoiGop } from "./luoi-gop";
import type { LoaiViec } from "./ma-o";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const LOAI = { CLASS_SESSION: "LOP", MAKEUP_CASE: "BU", TRIAL_SESSION: "TRIAL" } as const satisfies Record<string, LoaiViec>;

/** `lopTrial`: buổi Trial → lớp trial (để màn mở module gốc `/lop-trial/<id>`). */
export async function docLuoiGop(p: { centerId: string; tu: string; den: string }): Promise<LuoiGop & { lopTrial: Record<string, string> }> {
  const ngays: string[] = [];
  for (let d = ngayDate(p.tu); d <= ngayDate(p.den); d = new Date(d.getTime() + 86_400_000)) ngays.push(ymd(d));
  const khoang = { gte: ngayDate(p.tu), lte: ngayDate(p.den) };

  const [buoiRaw, trucRaw, chinhSach, gvCoSo] = await Promise.all([
    docTuanPhanCong({ centerId: p.centerId, tu: p.tu, den: p.den }),
    db.operationsDutyAssignment.findMany({
      where: { centerId: p.centerId, workDate: khoang, status: { in: [...TRANG_THAI_SONG] } },
      select: { id: true, userId: true, workDate: true, shiftCode: true },
    }),
    docChinhSach(),
    docGiaoVienCuaCoSo([p.centerId]),
  ]);

  const buoi: BuoiVao[] = buoiRaw.map((b) => ({
    key: b.key,
    sourceType: b.sourceType as BuoiVao["sourceType"],
    sourceId: b.sourceId,
    ngay: b.ngay,
    gioBatDau: b.gioBatDau,
    gioKetThuc: b.gioKetThuc,
    ten: b.ten,
    phu: b.phu,
    phong: b.phong,
    mo: b.tinhTrang === "MO" && b.apDung,
    main: b.main?.song ? { id: b.main.id, userId: b.main.userId } : null,
    ta: b.ta?.song ? [{ id: b.ta.id, userId: b.ta.userId }] : [],
  }));
  const coViec = new Set([...buoi.flatMap((b) => [b.main?.userId, ...b.ta.map((t) => t.userId)]), ...trucRaw.map((t) => t.userId)].filter((x): x is string => !!x));
  const ids = [...new Set([...gvCoSo.map((g) => g.id), ...coViec])];

  const trialIds = buoi.filter((b) => b.sourceType === "TRIAL_SESSION").map((b) => b.sourceId);
  const [users, noiKhacRaw, trialLop] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, centerId: true } }) : [],
    ids.length
      ? db.sessionStaffAssignment.findMany({
          where: { userId: { in: ids }, centerId: { not: p.centerId }, ngay: khoang, status: { in: [...TRANG_THAI_SONG] }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
          select: { id: true, userId: true, centerId: true, ngay: true, gioBatDau: true, gioKetThuc: true, sourceType: true },
        })
      : [],
    trialIds.length ? db.trialClassSession.findMany({ where: { id: { in: trialIds } }, select: { id: true, trialClassId: true } }) : [],
  ]);
  const nguoi = users
    .map((u) => ({ id: u.id, ten: u.name ?? "(chưa đặt tên)", laMuon: !gvCoSo.some((g) => g.id === u.id) }))
    .sort((a, b) => Number(a.laMuon) - Number(b.laMuon) || a.ten.localeCompare(b.ten, "vi"));

  const luoi = ghepLuoiGop({
    ngays,
    thamSoTai: (ngay) => {
      const cs = chinhSachTaiNgay(chinhSach, ngay);
      return cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
    },
    centerId: p.centerId,
    nguoi,
    buoi,
    truc: trucRaw.map((t) => ({ id: t.id, userId: t.userId, ngay: ymd(t.workDate), shiftCode: t.shiftCode })),
    viecNoiKhac: noiKhacRaw.map((x) => ({ id: x.id, userId: x.userId, ngay: ymd(x.ngay), gioBatDau: x.gioBatDau, gioKetThuc: x.gioKetThuc, coSoId: x.centerId, loai: LOAI[x.sourceType] })),
  });
  return { ...luoi, lopTrial: Object.fromEntries(trialLop.map((x) => [x.id, x.trialClassId])) };
}
