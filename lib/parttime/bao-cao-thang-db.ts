// lib/parttime/bao-cao-thang-db.ts — P5d · ĐỌC tháng công Parttime (QLCS theo cơ sở; giáo viên theo chính mình).
//
// KHÔNG tính lại gì: ghép đúng các lớp đọc đã có — đối soát P5a (`docDoiSoatThucHien`), nhận xét + điều chỉnh P5c
// (`docNhanXet` + `ghepDieuChinh`), trực P5b (`docTrucCoSo`) — rồi đưa vào bộ tổng hợp thuần `tongHopThang`. Số câu tra không
// phụ thuộc số buổi (mỗi lớp đọc tự theo lô; nhãn đọc một lô cuối).
import "server-only";
import { db } from "@/lib/db";
import { tongHopThang, type DongTongHop, type DonViMoCoi, type KhoanMoCoi } from "./bao-cao-thang";
import type { DongDieuChinhThang } from "./bao-cao-thang-kieu";
import { docKhoanDaCo, docNhanXet, ghepDieuChinh } from "./dieu-chinh-db";
import type { MucDieuChinh } from "./dieu-chinh";
import { docTrucCoSo, type DongTruc } from "./truc-van-hanh-db";
import { docDoiSoatThucHien } from "./workunit-db";

export type BaoCaoThang = {
  thang: string;
  tu: string;
  den: string;
  tongHop: DongTongHop[];
  day: DongDieuChinhThang[];
  truc: DongTruc[];
  /** Đơn vị / khoản trừ mà phân công không còn trong tập đọc (bị thay / huỷ) — vẫn hiện ở ô "Cũ" / khoản trừ. */
  moCoi: DonViMoCoi[];
  khoanMoCoi: KhoanMoCoi[];
  /** Số đơn vị (dạy + trực) đang CŨ khi đọc mà DB vẫn ghi CONFIRMED — nút "Đánh dấu cũ" ghi lại cho đúng. */
  chuaDanhDauCu: number;
  chuaGiaiQuyet: (MucDieuChinh & { workUnitId: string; userId: string; workDate: string })[];
  /** userId → tên; `${sourceType}:${sourceId}` → nhãn buổi. */
  ten: Record<string, string>;
  nhanBuoi: Record<string, string>;
};

/** "YYYY-MM" → ngày đầu / cuối tháng ("YYYY-MM-DD"). */
export function khoangThang(thang: string): { tu: string; den: string } {
  if (!/^\d{4}-\d{2}$/.test(thang)) throw new Error(`Tháng phải dạng YYYY-MM: ${thang}`);
  const [y, m] = thang.split("-").map(Number);
  return { tu: `${thang}-01`, den: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** MỘT cơ sở × một tháng. Nơi gọi đã kiểm quyền xem cơ sở. */
export async function docBaoCaoThang(p: { centerId: string; thang: string; now: Date }): Promise<BaoCaoThang> {
  const { tu, den } = khoangThang(p.thang);
  const [ds, truc, daCo] = await Promise.all([docDoiSoatThucHien({ centerId: p.centerId, tu, den, now: p.now }), docTrucCoSo({ centerId: p.centerId, tu, den, now: p.now }), docKhoanDaCo({ centerId: p.centerId, tu, den })]);
  // Giữ dòng không áp dụng CHỈ khi nó mang đơn vị / khoản trừ (buổi huỷ sau khi đã xác nhận) — bỏ là làm biến mất sự thật.
  const coKhoan = new Set(daCo.map((a) => a.assignmentId));
  const dongDay = ds.dong.filter((d) => d.ungVien.lop !== "KHONG_AP_DUNG" || d.donVi != null || coKhoan.has(d.bc.assignmentId));
  const [nhanXet, pcs] = await Promise.all([
    docNhanXet(dongDay, p.now),
    dongDay.length ? db.sessionStaffAssignment.findMany({ where: { id: { in: dongDay.map((d) => d.bc.assignmentId) } }, select: { id: true, assignmentType: true, sourceWorkRequestId: true } }) : [],
  ]);
  const dc = ghepDieuChinh(dongDay, nhanXet, daCo);
  const theoDv = new Map(dc.dong.map((x) => [x.dong.bc.assignmentId, x]));
  const pcCua = new Map(pcs.map((x) => [x.id, x]));
  const day: DongDieuChinhThang[] = dongDay.map((d) => ({
    dong: d,
    assignmentType: pcCua.get(d.bc.assignmentId)?.assignmentType ?? "REGULAR",
    sourceWorkRequestId: pcCua.get(d.bc.assignmentId)?.sourceWorkRequestId ?? null,
    nhanXet: nhanXet.get(d.bc.assignmentId) ?? null,
    muc: theoDv.get(d.bc.assignmentId)?.muc ?? [],
    // Gắn MỌI khoản của phân công (không chỉ của đơn vị đang hiệu lực) — khoản đã xác nhận trên đơn vị nay cũ vẫn phải hiện.
    dieuChinh: daCo.filter((a) => a.assignmentId === d.bc.assignmentId),
  }));
  const coDong = new Set(dongDay.map((d) => d.bc.assignmentId));
  const moCoi: DonViMoCoi[] = ds.donViMoCoi.map((w) => ({ id: w.id, userId: w.userId, assignmentId: w.assignmentId, workUnitType: w.workUnitType, quantity: w.quantity, standardMinutes: w.standardMinutes, hieuLuc: w.hieuLuc }));
  const khoanMoCoi: KhoanMoCoi[] = daCo.filter((a) => !a.assignmentId || !coDong.has(a.assignmentId)).map((a) => ({ id: a.id, userId: a.userId, amount: a.amount, status: a.status }));
  const chuaDanhDauCu =
    [...dongDay.flatMap((d) => (d.donVi ? [d.donVi] : [])), ...ds.donViMoCoi].filter((w) => w.status === "CONFIRMED" && w.hieuLuc === "STALE").length +
    truc.filter((t) => t.donVi?.hieuLuc === "STALE").length;
  const nhan = await docNhan(day, truc);
  return { thang: p.thang, tu, den, tongHop: tongHopThang(day, truc, moCoi, khoanMoCoi), day, truc, moCoi, khoanMoCoi, chuaDanhDauCu, chuaGiaiQuyet: dc.chuaGiaiQuyet, ...nhan };
}

/**
 * MỘT người × một tháng, mọi cơ sở người đó có phân công / trực. `userId` PHẢI lấy từ phiên ở nơi gọi. Đọc theo TỪNG CƠ SỞ
 * (số cơ sở, không phải số buổi) rồi lọc về đúng người — cùng lớp đọc với QLCS, nên giáo viên và QLCS thấy cùng một con số.
 */
export async function docBaoCaoCuaToi(p: { userId: string; thang: string; now: Date }): Promise<BaoCaoThang> {
  const { tu, den } = khoangThang(p.thang);
  const [coSoDay, coSoTruc] = await Promise.all([
    db.sessionStaffAssignment.findMany({ where: { userId: p.userId, ngay: { gte: new Date(`${tu}T00:00:00Z`), lte: new Date(`${den}T00:00:00Z`) } }, select: { centerId: true }, distinct: ["centerId"] }),
    db.operationsDutyAssignment.findMany({ where: { userId: p.userId, workDate: { gte: new Date(`${tu}T00:00:00Z`), lte: new Date(`${den}T00:00:00Z`) } }, select: { centerId: true }, distinct: ["centerId"] }),
  ]);
  const coSo = [...new Set([...coSoDay, ...coSoTruc].map((x) => x.centerId))];
  const tung = await Promise.all(coSo.map((c) => docBaoCaoThang({ centerId: c, thang: p.thang, now: p.now })));
  const day = tung.flatMap((b) => b.day.filter((x) => x.dong.bc.userId === p.userId));
  const truc = tung.flatMap((b) => b.truc.filter((t) => t.userId === p.userId));
  const moCoi = tung.flatMap((b) => b.moCoi.filter((w) => w.userId === p.userId));
  const khoanMoCoi = tung.flatMap((b) => b.khoanMoCoi.filter((a) => a.userId === p.userId));
  return {
    thang: p.thang,
    tu,
    den,
    tongHop: tongHopThang(day, truc, moCoi, khoanMoCoi),
    day,
    truc,
    moCoi,
    khoanMoCoi,
    chuaDanhDauCu: 0,
    chuaGiaiQuyet: tung.flatMap((b) => b.chuaGiaiQuyet.filter((m) => m.userId === p.userId)),
    ten: Object.assign({}, ...tung.map((b) => b.ten)),
    nhanBuoi: Object.assign({}, ...tung.map((b) => b.nhanBuoi)),
  };
}

async function docNhan(day: readonly DongDieuChinhThang[], truc: readonly DongTruc[]): Promise<{ ten: Record<string, string>; nhanBuoi: Record<string, string> }> {
  const nguoi = new Set<string>();
  for (const x of day) {
    nguoi.add(x.dong.bc.userId);
    if (x.dong.bc.dongDoi.nguoiDayId) nguoi.add(x.dong.bc.dongDoi.nguoiDayId);
  }
  for (const t of truc) nguoi.add(t.userId);
  const ids = (t: string) => [...new Set(day.filter((x) => x.dong.bc.sourceType === t).map((x) => x.dong.bc.sourceId))];
  const [users, lop, bu, trial] = await Promise.all([
    nguoi.size ? db.user.findMany({ where: { id: { in: [...nguoi] } }, select: { id: true, name: true, email: true } }) : [],
    ids("CLASS_SESSION").length ? db.classSession.findMany({ where: { id: { in: ids("CLASS_SESSION") } }, select: { id: true, class: { select: { name: true, classCode: true } } } }) : [],
    ids("MAKEUP_CASE").length ? db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: { id: true, courseId: true } }) : [],
    ids("TRIAL_SESSION").length ? db.trialClassSession.findMany({ where: { id: { in: ids("TRIAL_SESSION") } }, select: { id: true, trialClass: { select: { name: true } } } }) : [],
  ]);
  const khoa = bu.length ? await db.course.findMany({ where: { id: { in: [...new Set(bu.map((c) => c.courseId))] } }, select: { id: true, name: true } }) : [];
  const tenKhoa = new Map(khoa.map((k) => [k.id, k.name]));
  const nhanBuoi: Record<string, string> = {};
  for (const s of lop) nhanBuoi[`CLASS_SESSION:${s.id}`] = s.class.classCode ?? s.class.name;
  for (const c of bu) nhanBuoi[`MAKEUP_CASE:${c.id}`] = `Học bù — ${tenKhoa.get(c.courseId) ?? "khoá"}`;
  for (const t of trial) nhanBuoi[`TRIAL_SESSION:${t.id}`] = `Học thử — ${t.trialClass.name}`;
  return { ten: Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email ?? u.id])), nhanBuoi };
}
