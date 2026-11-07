// lib/parttime/chay-bong-db.ts — CHẠY BÓNG một cơ sở × khoảng ngày. CHỈ ĐỌC: không một lượt ghi nào (M-SHADOW-01).
//   · phía MỚI  = đối soát P5a (`docDoiSoatThucHien` — bằng chứng P4 + ứng viên + Q1) + trực P5b (`docTrucCoSo`), dựng thành dòng
//     bóng TRONG BỘ NHỚ (`chay-bong.ts`);
//   · phía CŨ   = `loadBuoiDay` (nguồn công dạy đang trả lương) lọc đúng cơ sở + ô ca ACTIVE (đối chiếu trực).
// Nơi gọi (công cụ / màn) tự xét công tắc WORKUNIT_SHADOW — hàm này không đổi gì nên không tự chặn.
import "server-only";
import { db } from "@/lib/db";
import { loadBuoiDay } from "@/lib/cham-cong/cong-day-db";
import { CASE_CHO_DUYET } from "@/lib/hoc-bu/duyet-case-thuan";
import { congKhongLech, dongBongDay, dongBongTruc, soSanhBong, type DongBong, type DongCu, type DongSoSanh, type OCaCu } from "./chay-bong";
import { docTrucCoSo } from "./truc-van-hanh-db";
import { docDoiSoatThucHien } from "./workunit-db";

const ngay = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

export type KetQuaChayBong = {
  bong: DongBong[];
  cu: DongCu[];
  soSanh: DongSoSanh[];
  cong: ReturnType<typeof congKhongLech>;
};

export async function chayBong(p: { centerId: string; tu: string; den: string; now: Date; loaiTru?: ReadonlySet<string> }): Promise<KetQuaChayBong> {
  const [ds, truc] = await Promise.all([docDoiSoatThucHien(p), docTrucCoSo(p)]);
  const pcIds = ds.dong.map((d) => d.bc.assignmentId);
  const kieu = pcIds.length
    ? new Map((await db.sessionStaffAssignment.findMany({ where: { id: { in: pcIds } }, select: { id: true, assignmentType: true } })).map((x) => [x.id, x.assignmentType as string]))
    : new Map<string, string>();
  const bong: DongBong[] = [];
  for (const d of ds.dong) {
    const b = dongBongDay({
      assignmentId: d.bc.assignmentId,
      assignmentType: kieu.get(d.bc.assignmentId) ?? "REGULAR",
      userId: d.bc.userId,
      role: d.bc.role,
      activity: d.bc.activity,
      sourceType: d.bc.sourceType,
      sourceId: d.bc.sourceId,
      workDate: d.bc.workDate,
      lop: d.ungVien.lop,
      lyDo: d.ungVien.lyDo,
      donVi: d.ungVien.donViTiet?.donVi ?? null,
    });
    if (b) bong.push(b);
  }
  for (const t of truc) {
    const b = dongBongTruc({ dutyId: t.dutyId, userId: t.userId, ngay: t.ngay, shiftCode: t.shiftCode, lop: t.danhGia.lop, lyDo: t.danhGia.lyDo, donViTra: t.danhGia.donViTra });
    if (b) bong.push(b);
  }

  // Phía CŨ: mọi người có thể nhận công ở các buổi ĐÃ CHỐT của cơ sở này trong khoảng (đứng lớp / dạy thay / thực dạy / TA cấp lớp /
  // GV case bù) — rồi giữ đúng các dòng của cơ sở này (loadBuoiDay đọc theo NGƯỜI, mọi cơ sở).
  const denHet = new Date(ngay(p.den).getTime() + 86_400_000);
  const [lop, bu, oCaRaw] = await Promise.all([
    db.classSession.findMany({
      where: { status: "COMPLETED", date: { gte: new Date(`${p.tu}T00:00:00+07:00`), lt: new Date(new Date(`${p.den}T00:00:00+07:00`).getTime() + 86_400_000) }, OR: [{ centerId: p.centerId }, { centerId: null, class: { centerId: p.centerId } }] },
      select: { actualTeacherId: true, substituteTeacherId: true, class: { select: { teacherId: true, assistantId: true } } },
    }),
    db.makeupCase.findMany({ where: { centerId: p.centerId, date: { gte: ngay(p.tu), lte: ngay(p.den) }, status: { not: CASE_CHO_DUYET } }, select: { teacherId: true } }),
    db.shiftAssignment.findMany({ where: { centerId: p.centerId, workDate: { gte: ngay(p.tu), lt: denHet }, status: "ACTIVE" }, select: { userId: true, workDate: true, templateCode: true } }),
  ]);
  const nguoi = [
    ...new Set(
      [...lop.flatMap((s) => [s.actualTeacherId, s.substituteTeacherId, s.class.teacherId, s.class.assistantId]), ...bu.map((c) => c.teacherId), ...bong.map((b) => b.userId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const buoiCu = await loadBuoiDay(nguoi, ngay(p.tu), ngay(p.den));
  const cu: DongCu[] = buoiCu
    .filter((b) => (b.source === "CLASS" || b.source === "MAKEUP") && b.hienThi?.centerId === p.centerId)
    .map((b) => ({ sourceType: b.source === "CLASS" ? "CLASS_SESSION" : "MAKEUP_CASE", sourceId: b.id, userId: b.userId, workDate: b.ymd, vai: b.role }));
  const oCa: OCaCu[] = oCaRaw.map((o) => ({ userId: o.userId, workDate: o.workDate.toISOString().slice(0, 10), shiftCode: o.templateCode ?? "" }));
  const soSanh = soSanhBong({ bong, cu, oCa });
  return { bong, cu, soSanh, cong: congKhongLech(soSanh, { loaiTru: p.loaiTru ?? new Set() }) };
}
