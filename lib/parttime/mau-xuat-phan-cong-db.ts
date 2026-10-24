// lib/parttime/mau-xuat-phan-cong-db.ts — ĐỌC cho file mẫu nhập + tệp xuất phân công GV (lưới phân công GV · PR5). CHỈ ĐỌC, theo lô.
// Phạm vi cơ sở do ROUTE quyết (quyền theo từng cơ sở) và truyền vào — hàm không tự nới.
import "server-only";
import { db } from "@/lib/db";
import { docGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { docBangChungCong } from "./bang-chung-cong-db";
import { docTuanThu } from "./tuan-thu-buoi-db";
import { nhanBangChung } from "./nhan-bang-chung";
import { docLuoiTuan } from "./luoi-tuan-db";
import { docChinhSach } from "./phan-cong-db";
import { TRANG_THAI_SONG } from "./phan-cong";
import { chinhSachTaiNgay } from "./chinh-sach";
import { xepVaoCa } from "./luoi-tuan";
import { docNguonHoTroTrial } from "./rank-trial-db";
import type { DauVaoMauNhap } from "./mau-nhap-phan-cong";
import type { CoSoXuat } from "./xuat-phan-cong";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const NHAN_NGUON: Record<string, string> = { CLASS_SESSION: "Lớp", MAKEUP_CASE: "Học bù", TRIAL_SESSION: "Trial" };

/** null khi ngày `tu` không thuộc SR.QD.238 (không có ca / đơn giá để in). */
export async function docDauVaoMauNhap(p: { centerIds: readonly string[]; tu: string; den: string; now: Date }): Promise<DauVaoMauNhap | null> {
  const [centers, chinhSach, gv, ssa] = await Promise.all([
    db.center.findMany({ where: { id: { in: [...p.centerIds] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    docChinhSach(),
    docGiaoVienCuaCoSo(p.centerIds, p.now),
    db.sessionStaffAssignment.findMany({
      where: { centerId: { in: [...p.centerIds] }, ngay: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: [...TRANG_THAI_SONG] }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      select: { sourceType: true, sourceId: true, centerId: true, ngay: true, gioBatDau: true, gioKetThuc: true, role: true, userId: true },
      orderBy: [{ ngay: "asc" }, { gioBatDau: "asc" }],
    }),
  ]);
  const cs = chinhSachTaiNgay(chinhSach, p.tu);
  if (!cs || cs.thamSo.loai !== "SR_QD_238") return null;
  const ts = cs.thamSo;
  const maCoSo = new Map(centers.map((c) => [c.id, c.code ?? c.name]));

  const nguoiIds = [...new Set([...gv.map((g) => g.id), ...ssa.map((s) => s.userId)])];
  const lopIds = [...new Set(ssa.filter((s) => s.sourceType === "CLASS_SESSION").map((s) => s.sourceId))];
  const buIds = [...new Set(ssa.filter((s) => s.sourceType === "MAKEUP_CASE").map((s) => s.sourceId))];
  const [users, lop, bu, trial] = await Promise.all([
    nguoiIds.length ? db.user.findMany({ where: { id: { in: nguoiIds } }, select: { id: true, name: true, email: true, employee: { select: { employeeCode: true } } } }) : [],
    lopIds.length ? db.classSession.findMany({ where: { id: { in: lopIds } }, select: { id: true, class: { select: { name: true } } } }) : [],
    buIds.length ? db.makeupCase.findMany({ where: { id: { in: buIds } }, select: { id: true, courseId: true } }) : [],
    docNguonHoTroTrial([]),
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const khoaIds = [...new Set(bu.map((b) => b.courseId))];
  const khoa = new Map((khoaIds.length ? await db.course.findMany({ where: { id: { in: khoaIds } }, select: { id: true, name: true } }) : []).map((k) => [k.id, k.name]));
  const tenLop = new Map<string, string>([...lop.map((l) => [l.id, l.class.name] as const), ...bu.map((b) => [b.id, `Bù · ${khoa.get(b.courseId) ?? ""}`] as const)]);

  const buoi = new Map<string, DauVaoMauNhap["buoi"][number]>();
  for (const s of ssa) {
    const b = buoi.get(s.sourceId) ?? {
      sessionId: s.sourceId,
      loai: NHAN_NGUON[s.sourceType] ?? s.sourceType,
      coSo: maCoSo.get(s.centerId) ?? s.centerId,
      ngay: ymd(s.ngay),
      ca: xepVaoCa(ts, s.gioBatDau, s.gioKetThuc),
      gio: `${s.gioBatDau}–${s.gioKetThuc}`,
      lop: tenLop.get(s.sourceId) ?? (s.sourceType === "TRIAL_SESSION" ? "Trial" : ""),
      gvChinh: "",
      troGiang: "",
    };
    const ten = u.get(s.userId)?.name ?? "";
    if (s.role === "MAIN_TEACHER") b.gvChinh = [b.gvChinh, ten].filter(Boolean).join(", ");
    else b.troGiang = [b.troGiang, ten].filter(Boolean).join(", ");
    buoi.set(s.sourceId, b);
  }

  const muc = centers.map((c) => trial.chinhSachTai(c.id, p.tu)).find((x) => x?.bat)?.mucMoiHocVien ?? 0;
  return {
    tu: p.tu,
    den: p.den,
    // Thứ tự theo `centerIds` (route đặt cơ sở đang xem lên ĐẦU) — dropdown của sheet nhập mở ra đúng cơ sở người dùng đang làm.
    coSo: [...centers].sort((x, y) => p.centerIds.indexOf(x.id) - p.centerIds.indexOf(y.id)).map((c) => ({ ma: c.code ?? c.name, ten: c.name })),
    thamSo: ts,
    mucTrial: muc,
    giaoVien: gv
      .map((g) => ({ maGV: u.get(g.id)?.employee?.employeeCode ?? null, ten: u.get(g.id)?.name ?? g.name ?? g.id, email: u.get(g.id)?.email ?? null, coSo: g.coSo.map((c) => maCoSo.get(c) ?? c) }))
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi")),
    buoi: [...buoi.values()],
  };
}

/** Một cơ sở × khoảng ngày cho tệp xuất: lưới (đúng hàm màn dùng) + bằng chứng chấm công + tuân thủ buổi theo assignmentId. */
export async function docCoSoXuat(p: { centerId: string; ma: string; tu: string; den: string; now: Date }): Promise<CoSoXuat> {
  const [luoi, bc] = await Promise.all([docLuoiTuan({ centerId: p.centerId, tu: p.tu, den: p.den, now: p.now }), docBangChungCong({ centerId: p.centerId, tu: p.tu, den: p.den, now: p.now })]);
  const tt = await docTuanThu(bc.phanCong, p.now);
  return {
    ma: p.ma,
    luoi,
    bangChung: new Map(bc.phanCong.map((x) => [x.assignmentId, nhanBangChung(x)?.nhan ?? x.trangThai])),
    tuanThu: new Map([...tt].map(([k, v]) => [k, v.overallStatus])),
  };
}
