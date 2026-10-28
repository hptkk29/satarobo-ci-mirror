// lib/phan-cong/cong-o-db.ts — ĐỌC công Parttime theo Ô cho một cơ sở × một kỳ (GĐ6, chốt 8, 10). CHỈ ĐỌC — công tính KHI ĐỌC.
//
// MỘT loader cho mọi nơi hỏi "ô nào được tính tự động, ô nào cần xem" (luật 12b — site GV đọc số của admin, không dựng lại):
//   · tab "Tổng hợp tự động" + "Phản ánh chờ duyệt" của màn Công parttime tháng (admin);
//   · trang "Ô công cần xem" của site GV (lọc `userId` = chính người xem);
//   · ghi cứng WorkUnit lúc chốt kỳ (GĐ6-D).
// Ô = `docLuoiGop` (cùng lưới màn Phân công: `tinhMaO` + `capQuetKyVong`); lượt quét = lượt còn tính (`LUOT_CON_TINH`) ghép khoảng có mặt
// bằng đúng hàm của bảng công (`khoangCoMatTrongNgay`); đánh giá = `danhGiaCap` + `trangThaiO` (`cong-o.ts`).
// Kỳ đi LUẬT CŨ (≤ 2026-10) ⇒ `{ luat: "CU", o: [] }` — luồng xác nhận P5 giữ nguyên (chốt 8).
// ⚠️ `scripts/do-phan-cong-gop.ts` mục ⑩ còn bản đọc riêng vì nó chạy trên PROD chưa có bảng `PhanAnhCong` / cột `phanAnhId`.
import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { LUOT_CON_TINH } from "@/lib/cham-cong/sua-gio-quet";
import { khoangCoMatTrongNgay } from "@/lib/parttime/bang-chung-cong";
import { chinhSachTaiNgay } from "@/lib/parttime/chinh-sach";
import { docChinhSach } from "@/lib/parttime/phan-cong-db";
import { danhGiaCap, luatKy, trangThaiO, type LyDoO } from "./cong-o";
import { docLuoiGop } from "./luoi-gop-db";
import { docKyLuatMoi } from "./ky-luat-db";

export type OCong = {
  centerId: string;
  userId: string;
  ten: string;
  ngay: string;
  ca: string;
  ma: string;
  tietD: number;
  tietTG: number;
  trucQuyDoi: number;
  coTrial: boolean;
  /** Phân công dạy nằm trong ô (đứng chính / trợ giảng) + dòng trực của ô — để ghi cứng WorkUnit lúc chốt kỳ. */
  assignmentIds: string[];
  trucId: string | null;
  trangThai: "TU_DONG" | "CAN_XEM";
  lyDo: LyDoO[];
  /** Phản ánh MỚI NHẤT của ô (mọi trạng thái), null = chưa phản ánh. */
  phanAnh: { id: string; status: string; lyDo: string; decisionNote: string | null } | null;
};

export type CongOThang = { luat: "MOI" | "CU"; tu: string; den: string; o: OCong[] };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ngayDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** Phút trong ngày theo giờ VN (UTC+7, không có giờ mùa hè). */
const phutVn = (d: Date) => (d.getUTCHours() * 60 + d.getUTCMinutes() + 420) % 1440;
const cuoiThang = (periodKey: string) => {
  const [y, m] = periodKey.split("-").map(Number) as [number, number];
  return ymd(new Date(Date.UTC(y, m, 0)));
};

/**
 * `den` = ngày cuối được tính (thường là hôm qua — hôm nay chưa đủ lượt quét); bị kẹp trong kỳ. BẮT BUỘC (luật 7, 19).
 * `userId` = chỉ một người (site GV); null = cả cơ sở (admin).
 */
export async function docCongOThang(p: { centerId: string; periodKey: string; den: string; userId: string | null }): Promise<CongOThang> {
  const tu = `${p.periodKey}-01`;
  const den = [cuoiThang(p.periodKey), p.den].sort()[0]!;
  const luat = luatKy(p.periodKey, await docKyLuatMoi());
  if (luat !== "MOI" || den < tu) return { luat, tu, den, o: [] };

  const ou = await db.orgUnit.findFirst({ where: { centerId: p.centerId, type: "CENTER" }, select: { id: true } });
  const [luoi, chinhSach, treVao, veSom, bamTrung] = await Promise.all([
    docLuoiGop({ centerId: p.centerId, tu, den }),
    docChinhSach(),
    getSetting("shift.parttimeTreVaoPhut", { orgUnitId: ou?.id ?? null }),
    getSetting("shift.parttimeVeSomPhut", { orgUnitId: ou?.id ?? null }),
    getSetting("shift.duplicateTapMinutes", { orgUnitId: ou?.id ?? null }),
  ]);
  const dong = luoi.dong.filter((d) => !p.userId || d.userId === p.userId);
  const ids = dong.map((d) => d.userId);
  const [luot, phanAnh] = await Promise.all([
    ids.length
      ? db.staffTimeLog.findMany({
          where: { userId: { in: ids }, workDate: { gte: ngayDate(tu), lte: ngayDate(den) }, ...LUOT_CON_TINH },
          select: { id: true, userId: true, loggedAt: true, direction: true, centerId: true, flags: true, workDate: true },
        })
      : [],
    ids.length
      ? db.phanAnhCong.findMany({
          where: { centerId: p.centerId, periodKey: p.periodKey, userId: { in: ids } },
          select: { id: true, userId: true, ngay: true, ca: true, status: true, lyDo: true, decisionNote: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);
  const dungSai = { treVaoPhut: treVao, veSomPhut: veSom };
  const o: OCong[] = [];
  for (const d of dong) {
    for (const n of luoi.ngays) {
      const cs = chinhSachTaiNgay(chinhSach, n);
      const ts = cs && cs.thamSo.loai === "SR_QD_238" ? cs.thamSo : null;
      const oNgay = d.o[n];
      if (!ts || !oNgay) continue;
      const khoang = khoangCoMatTrongNgay(
        luot
          .filter((l) => l.userId === d.userId && ymd(l.workDate) === n)
          .map((l) => ({ id: l.id, loggedAt: l.loggedAt, direction: l.direction as "CHECK_IN" | "CHECK_OUT", centerId: l.centerId, flags: l.flags })),
        bamTrung,
      ).map((k) => ({ tu: phutVn(k.tu), den: k.den ? phutVn(k.den) : null }));
      const cap = d.cap[n] ?? [];
      const danhGia = danhGiaCap({ cap, khoang, dungSai, chuanBiPhut: ts.tiet.chuanBiPhut });
      for (const [ca, x] of Object.entries(oNgay)) {
        const t = trangThaiO({ ca, o: x, cap, danhGia });
        if (t.trangThai === "KHONG_CO_VIEC") continue;
        const pa = phanAnh.find((r) => r.userId === d.userId && ymd(r.ngay) === n && r.ca === ca) ?? null;
        o.push({
          centerId: p.centerId,
          userId: d.userId,
          ten: d.ten,
          ngay: n,
          ca,
          ma: x.ma,
          tietD: x.tietD,
          tietTG: x.tietTG,
          trucQuyDoi: x.trucId ? x.trucQuyDoi : 0,
          coTrial: x.coTrial,
          assignmentIds: x.viec.map((v) => v.assignmentId),
          trucId: x.trucId,
          trangThai: t.trangThai,
          lyDo: t.lyDo,
          phanAnh: pa ? { id: pa.id, status: pa.status, lyDo: pa.lyDo, decisionNote: pa.decisionNote } : null,
        });
      }
    }
  }
  return { luat: "MOI", tu, den, o };
}

/** Phản ánh đang CHỜ DUYỆT của một cơ sở × kỳ (tab admin). */
export async function docPhanAnhChoDuyet(p: { centerId: string; periodKey: string }) {
  const ds = await db.phanAnhCong.findMany({
    where: { centerId: p.centerId, periodKey: p.periodKey, status: "CHO_DUYET" },
    select: { id: true, userId: true, ngay: true, ca: true, lyDo: true, moc: true, createdAt: true },
    orderBy: [{ ngay: "asc" }, { createdAt: "asc" }],
  });
  const ten = new Map(
    (ds.length ? await db.user.findMany({ where: { id: { in: [...new Set(ds.map((x) => x.userId))] } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name ?? "(chưa đặt tên)"]),
  );
  return ds.map((x) => ({
    id: x.id,
    userId: x.userId,
    ten: ten.get(x.userId) ?? "(chưa đặt tên)",
    ngay: ymd(x.ngay),
    ca: x.ca,
    lyDo: x.lyDo,
    moc: (Array.isArray(x.moc) ? x.moc : []).map((m) => (typeof m === "string" ? m : null)),
  }));
}

/** Cơ sở của một phản ánh — action tra từ DB để hỏi quyền ĐÚNG cơ sở (không tin client). */
export async function coSoCuaPhanAnh(id: string): Promise<string | null> {
  return (await db.phanAnhCong.findUnique({ where: { id }, select: { centerId: true } }))?.centerId ?? null;
}

/**
 * Ô công của MỘT người trong kỳ, ở MỌI cơ sở người đó có việc (site GV). Cùng loader với admin (luật 12b) — chỉ lọc `userId`.
 */
export async function docCongOCuaNguoi(p: { userId: string; periodKey: string; den: string }): Promise<CongOThang & { coSo: { id: string; ten: string }[] }> {
  const tu = new Date(`${p.periodKey}-01T00:00:00.000Z`);
  const [y, m] = p.periodKey.split("-").map(Number) as [number, number];
  const het = new Date(Date.UTC(y, m, 0));
  const [pc, truc] = await Promise.all([
    db.sessionStaffAssignment.findMany({ where: { userId: p.userId, ngay: { gte: tu, lte: het } }, select: { centerId: true }, distinct: ["centerId"] }),
    db.operationsDutyAssignment.findMany({ where: { userId: p.userId, workDate: { gte: tu, lte: het } }, select: { centerId: true }, distinct: ["centerId"] }),
  ]);
  const ids = [...new Set([...pc, ...truc].map((x) => x.centerId))];
  const coSo = ids.length ? await db.center.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const ketQua = await Promise.all(ids.map((centerId) => docCongOThang({ centerId, periodKey: p.periodKey, den: p.den, userId: p.userId })));
  return {
    luat: luatKy(p.periodKey, await docKyLuatMoi()),
    tu: `${p.periodKey}-01`,
    den: [ymd(het), p.den].sort()[0]!,
    o: ketQua.flatMap((k) => k.o),
    coSo: coSo.map((c) => ({ id: c.id, ten: c.name })),
  };
}

