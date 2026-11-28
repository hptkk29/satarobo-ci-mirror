import type { ScopedDb } from "@/lib/actions/factory";
import { dieuKienSchema, xetLuat, type DieuKien, type DoiTuong, KICH_HOAT, type KichHoat } from "@/lib/elearning/automation";

/**
 * P7 — CHẠY THỬ một luật tự động hoá trên dữ liệu N ngày qua (nút "Chạy thử trên dữ liệu 7 ngày" của `QtLuatMoi`).
 *
 * ⚠️ CHỈ ĐỌC: không giao khoá, không gửi nhắc, không ghi nhật ký thi hành, không ghi AuditLog. Dùng ĐÚNG `xetLuat` (hàm thuần mà cỗ máy thật gọi) nên
 * "sẽ thi hành / bỏ qua" ở đây là câu trả lời của chính luật chạy thật, kèm lý do bằng tiếng Việt.
 * ⚠️ Đối tượng lấy theo MỐC NGHIỆP VỤ của từng kích hoạt (vào làm · hoàn thành khoá · chứng nhận hết hạn) trong cửa sổ N ngày, qua `scopedDb`.
 * ⚠️ `YEU_CAU_MOI_AP_DUNG` KHÔNG chạy thử được: người bị áp một yêu cầu mới chỉ được tính lúc yêu cầu được khai (không có mốc "đã áp cho ai" để đọc lại) —
 * trả `khongHoTro` thay vì bịa danh sách.
 */

export const SO_NGAY_CHAY_THU = 7;
export const TRAN_DONG_CHAY_THU = 50;

export type DongChayThu = { ten: string; moTa: string; khop: boolean; lyDo: string };
export type KetQuaChayThu =
  | { ok: true; dong: DongChayThu[]; soKhop: number; soBoQua: number; biCat: boolean }
  | { ok: false; khongHoTro: string };

const ngayVn = (d: Date) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(d);

/** THUẦN: xét một danh sách đối tượng (đã đọc) bằng `xetLuat`; không khớp xếp sau, giữ thứ tự gốc trong từng nhóm. */
export function xetDanhSach(
  trigger: KichHoat,
  dieuKien: DieuKien,
  nguoi: readonly { ten: string; moTa: string; doiTuong: DoiTuong }[],
  now: Date,
): { dong: DongChayThu[]; soKhop: number; soBoQua: number; biCat: boolean } {
  const kq = nguoi.map((n) => {
    const r = xetLuat({ trigger, conditionJson: dieuKien }, n.doiTuong, now);
    return { ten: n.ten, moTa: n.moTa, khop: r.khop, lyDo: r.lyDo };
  });
  const soKhop = kq.filter((x) => x.khop).length;
  const sapXep = [...kq.filter((x) => x.khop), ...kq.filter((x) => !x.khop)];
  return { dong: sapXep.slice(0, TRAN_DONG_CHAY_THU), soKhop, soBoQua: kq.length - soKhop, biCat: sapXep.length > TRAN_DONG_CHAY_THU };
}

export async function chayThuLuat(
  sdb: ScopedDb,
  p: { trigger: string; conditionJson: unknown; now: Date; soNgay?: number },
): Promise<KetQuaChayThu | { ok: false; loi: string }> {
  if (!(KICH_HOAT as readonly string[]).includes(p.trigger)) return { ok: false, loi: "Kích hoạt không hợp lệ" };
  const dk = dieuKienSchema.safeParse(p.conditionJson ?? {});
  if (!dk.success) return { ok: false, loi: dk.error.issues[0]?.message ?? "Điều kiện không hợp lệ" };
  const trigger = p.trigger as KichHoat;
  const tu = new Date(p.now.getTime() - (p.soNgay ?? SO_NGAY_CHAY_THU) * 86_400_000);

  if (trigger === "YEU_CAU_MOI_AP_DUNG") {
    return { ok: false, khongHoTro: "Kích hoạt này chỉ tính lúc một yêu cầu đào tạo được khai — không có dữ liệu cũ để chạy thử." };
  }

  if (trigger === "NHAN_SU_MOI") {
    const ds = await sdb.employee.findMany({
      where: { isActive: true, status: "ACTIVE", joinedAt: { gte: tu, lte: p.now }, userAccount: { is: {} } },
      select: { fullName: true, employeeCode: true, joinedAt: true, departmentId: true, userAccount: { select: { id: true } } },
      orderBy: { joinedAt: "desc" },
      take: 500,
    });
    return {
      ok: true,
      ...xetDanhSach(
        trigger,
        dk.data,
        ds.map((e: { fullName: string; employeeCode: string; joinedAt: Date | null; departmentId: string | null; userAccount: { id: string } | null }) => ({
          ten: e.fullName,
          moTa: e.joinedAt ? `vào làm ${ngayVn(e.joinedAt)}` : "chưa có ngày vào làm",
          doiTuong: { userId: e.userAccount?.id ?? e.employeeCode, departmentId: e.departmentId, joinedAt: e.joinedAt },
        })),
        p.now,
      ),
    };
  }

  if (trigger === "KHOA_HOAN_THANH") {
    const ds = await sdb.trnEnrollment.findMany({
      where: { status: { in: ["COMPLETED", "COMPLETED_LATE"] }, completedAt: { gte: tu, lte: p.now } },
      select: { userId: true, courseId: true, completedAt: true, snapDepartmentId: true },
      orderBy: { completedAt: "desc" },
      take: 500,
    });
    const nguoi = await tenNguoi(sdb, ds.map((x: { userId: string }) => x.userId));
    const khoa = await tenKhoa(sdb, ds.map((x: { courseId: string }) => x.courseId));
    return {
      ok: true,
      ...xetDanhSach(
        trigger,
        dk.data,
        ds.map((e: { userId: string; courseId: string; completedAt: Date | null; snapDepartmentId: string | null }) => ({
          ten: nguoi.get(e.userId) ?? "(không rõ tên)",
          moTa: `${khoa.get(e.courseId) ?? "khoá"} · xong ${e.completedAt ? ngayVn(e.completedAt) : "?"}`,
          doiTuong: { userId: e.userId, departmentId: e.snapDepartmentId, joinedAt: null, courseId: e.courseId },
        })),
        p.now,
      ),
    };
  }

  // CHUNG_NHAN_HET_HAN
  const cn = await sdb.trnCertificate.findMany({
    where: { validUntil: { gte: tu, lte: p.now } },
    select: { userId: true, courseId: true, validUntil: true },
    orderBy: { validUntil: "desc" },
    take: 500,
  });
  const nguoi = await tenNguoi(sdb, cn.map((x: { userId: string }) => x.userId));
  const khoa = await tenKhoa(sdb, cn.map((x: { courseId: string }) => x.courseId));
  return {
    ok: true,
    ...xetDanhSach(
      trigger,
      dk.data,
      cn.map((c: { userId: string; courseId: string; validUntil: Date | null }) => ({
        ten: nguoi.get(c.userId) ?? "(không rõ tên)",
        moTa: `${khoa.get(c.courseId) ?? "khoá"} · hết hạn ${c.validUntil ? ngayVn(c.validUntil) : "?"}`,
        doiTuong: { userId: c.userId, departmentId: null, joinedAt: null, courseId: c.courseId },
      })),
      p.now,
    ),
  };
}

async function tenNguoi(sdb: ScopedDb, ids: string[]): Promise<Map<string, string>> {
  const u = [...new Set(ids)];
  if (u.length === 0) return new Map();
  const r = await sdb.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, employee: { select: { fullName: true } } } });
  return new Map(r.map((x: { id: string; name: string | null; employee: { fullName: string } | null }) => [x.id, x.employee?.fullName ?? x.name ?? "(không rõ tên)"]));
}
async function tenKhoa(sdb: ScopedDb, ids: string[]): Promise<Map<string, string>> {
  const u = [...new Set(ids)];
  if (u.length === 0) return new Map();
  const r = await sdb.trnCourse.findMany({ where: { id: { in: u } }, select: { id: true, title: true } });
  return new Map(r.map((x: { id: string; title: string }) => [x.id, x.title]));
}
