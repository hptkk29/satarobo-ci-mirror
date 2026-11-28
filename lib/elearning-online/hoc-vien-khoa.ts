import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalPhone } from "@/lib/phone";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { trangThaiHieuLuc, type TrangThaiHieuLuc } from "./quyen-hoc";
import { tinhTienDoKhoa, type BaiTrongBan, type TienDoBai } from "./tien-do";

/**
 * E-LEARNING ONLINE — QUẢN LÝ HỌC VIÊN TRONG MỘT KHOÁ (thiết kế QoHocVien/QoHocVienTT): bảng nhóm theo phụ huynh, tìm học viên để cấp, lịch sử quyền.
 *
 * KHÔNG có màn "người mua" toàn cục: mọi thứ đi theo MỘT khoá. KHÔNG tạo học viên ở đây (mã học viên/cơ sở thuộc Workstream A) — chỉ cấp cho `Student` ĐÃ CÓ theo id.
 *
 * Quy ước:
 * - Nhóm theo PHỤ HUYNH bằng khoá ổn định: tài khoản phụ huynh (`parentUserId`) → SĐT chuẩn hoá (`canonicalPhone`) → phiếu lead → riêng từng học viên.
 *   KHÔNG BAO GIỜ nhóm theo tên (hai người trùng tên không được gộp).
 * - "Vào khoá lần mới nhất" = `OnlEntitlement.startsAt` (đặt lúc cấp đầu và lúc MỞ LẠI sau hết hạn/thu hồi; gia hạn khi còn hạn KHÔNG đổi nó). Nhóm xếp theo mốc mới nhất của
 *   bất kỳ con nào, giảm dần; trong nhóm các con vào mới nhất đứng trước.
 * - SĐT phụ huynh chỉ trả đủ khi người xem có `onl:student:pii`; nếu không chỉ còn 3 số cuối.
 */

type Db = PrismaClient;

export const NGUON_QUYEN: Record<string, string> = { PURCHASE: "Mua khoá", FREE_GRANT: "Cấp miễn phí" };

export type DongHocVienKhoa = {
  entitlementId: string;
  studentId: string;
  tenHocVien: string;
  maHocVien: string | null;
  nguon: "PURCHASE" | "FREE_GRANT";
  nguonNhan: string;
  vaoLuc: Date;
  hetHan: Date | null;
  /** Ngày-trong-tháng neo của lần cấp đầu — cần để xem trước hạn mới đúng như máy chủ sẽ tính. */
  anchorDay: number;
  trangThai: TrangThaiHieuLuc;
  phanTram: number | null;
  /** Số bài bắt buộc đã xong / tổng — hiện "9/16" ở bảng. `null` khi khoá chưa phát hành. */
  daXong: number | null;
  tong: number | null;
  hoanThanh: boolean | null;
};

export type NhomPhuHuynh = {
  khoaNhom: string;
  tenPhuHuynh: string | null;
  /** Đủ số khi có `onl:student:pii`; ngược lại `null`. */
  sdt: string | null;
  /** Luôn có (nếu có SĐT): chỉ 3 số cuối, dạng `••• 456`. */
  sdtChe: string | null;
  leadId: string | null;
  vaoMoiNhatLuc: Date;
  hocVien: DongHocVienKhoa[];
};

export const locHocVienSchema = z
  .object({
    courseId: z.string().min(1),
    q: z.string().trim().max(100).optional(),
    trangThai: z.enum(["CON_HAN", "SAP_HET_HAN", "HET_HAN", "THU_HOI"]).optional(),
    nguon: z.enum(["PURCHASE", "FREE_GRANT"]).optional(),
    sapXep: z.enum(["VAO_MOI_NHAT", "TEN_PHU_HUYNH"]).optional(),
    trang: z.number().int().min(1).max(10_000).optional(),
    coTrang: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type LocHocVien = z.infer<typeof locHocVienSchema>;

/** Phần số quốc nội của một SĐT bất kỳ dạng: bỏ ký tự trình bày, bỏ đầu 84 hoặc 0. Rỗng nếu không còn số nào. */
export const soNoiDia = (s: string): string => s.replace(/\D/g, "").replace(/^(84|0)/, "");

/** `84905412118` / `+84 905…` / `0905412118` → `0905 412 118` (dạng người Việt đọc). Không nhận ra SĐT di động VN ⇒ trả nguyên văn đã trim. */
export function dinhDangSdtVn(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const c = canonicalPhone(raw);
  if (!c) return raw.trim();
  const n = `0${c.slice(2)}`;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

const che = (sdt: string | null | undefined) => {
  const c = canonicalPhone(sdt);
  return c ? `••• ${c.slice(-3)}` : null;
};

/** Dạng KHÔNG đảo ngược được của khoá nhóm — thứ duy nhất ra khỏi hàm (khoá thô chứa SĐT chuẩn hoá, không được lọt vào dữ liệu người không có quyền PII xem). */
const khoaCongKhai = (khoaTho: string) => createHash("sha256").update(khoaTho).digest("hex").slice(0, 16);

/** Khoá nhóm phụ huynh — ổn định, không dùng tên. CHỈ dùng nội bộ (chứa SĐT chuẩn hoá); ra ngoài phải qua `khoaCongKhai`. */
export function khoaNhomPhuHuynh(s: { id: string; parentUserId: string | null; parentPhone: string | null; leadId: string | null }): string {
  if (s.parentUserId) return `u:${s.parentUserId}`;
  const p = canonicalPhone(s.parentPhone);
  if (p) return `p:${p}`;
  if (s.leadId) return `l:${s.leadId}`;
  return `s:${s.id}`;
}

export async function docHocVienTrongKhoa(db: Db, loc: LocHocVien, o: { now: Date; xemPii: boolean }): Promise<{ nhom: NhomPhuHuynh[]; tongNhom: number; tongHocVien: number }> {
  const coTrang = loc.coTrang ?? 20;
  const trang = loc.trang ?? 1;
  const q = loc.q?.trim();
  // SĐT lưu ở nhiều dạng ("0905…", "+84 905 …", "905…") nên KHÔNG so chuỗi trong SQL: lấy ứng viên rồi so phần số quốc nội bằng `soNoiDia`.
  const soQ = q ? soNoiDia(q) : "";
  let idTheoSdt: string[] = [];
  if (q && soQ.length >= 3) {
    const ung = await db.onlEntitlement.findMany({ where: { courseId: loc.courseId, student: { parentPhone: { not: null } } }, select: { id: true, student: { select: { parentPhone: true } } } });
    idTheoSdt = ung.filter((u) => soNoiDia(u.student.parentPhone ?? "").includes(soQ)).map((u) => u.id);
  }
  const where: Prisma.OnlEntitlementWhereInput = {
    courseId: loc.courseId,
    ...(loc.nguon ? { source: loc.nguon } : {}),
    ...(q
      ? {
          OR: [
            { student: { name: { contains: q, mode: "insensitive" } } },
            { student: { studentCode: { contains: q, mode: "insensitive" } } },
            { student: { parentName: { contains: q, mode: "insensitive" } } },
            ...(idTheoSdt.length ? [{ id: { in: idTheoSdt } }] : []),
          ],
        }
      : {}),
  };
  const quyen = await db.onlEntitlement.findMany({
    where,
    select: {
      id: true, studentId: true, source: true, status: true, startsAt: true, expiresAt: true, anchorDay: true,
      student: { select: { id: true, name: true, studentCode: true, parentName: true, parentPhone: true, parentUserId: true, leadId: true } },
    },
  });

  // Tiến độ khoá từng người (một lượt đọc tiến độ cho cả danh sách).
  const khoa = await db.onlCourse.findUnique({ where: { id: loc.courseId }, select: { publishedVersionId: true } });
  let cay: BaiTrongBan[] | null = null;
  let cd: ReturnType<typeof docCaiDatHocTap> | null = null;
  if (khoa?.publishedVersionId) {
    const ban = await db.onlCourseVersion.findUnique({
      where: { id: khoa.publishedVersionId },
      select: {
        settingsJson: true,
        chapters: { select: { id: true, stableId: true, orderIndex: true, hidden: true } },
        lessons: { select: { stableId: true, chapterId: true, kind: true, required: true, hidden: true, orderIndex: true } },
      },
    });
    if (ban) {
      cd = docCaiDatHocTap(ban.settingsJson);
      const ch = new Map(ban.chapters.map((c) => [c.id, c]));
      cay = [...ban.lessons]
        .sort((a, b) => (ch.get(a.chapterId)?.orderIndex ?? 0) - (ch.get(b.chapterId)?.orderIndex ?? 0) || a.orderIndex - b.orderIndex)
        .map((b, i) => ({ stableId: b.stableId, chapterStableId: ch.get(b.chapterId)?.stableId ?? "", kind: b.kind, required: b.required, hidden: b.hidden || !!ch.get(b.chapterId)?.hidden, thuTu: i, thuTuChuong: ch.get(b.chapterId)?.orderIndex ?? 0 }));
    }
  }
  const tienDoRows = quyen.length && cay ? await db.onlLessonProgress.findMany({ where: { entitlementId: { in: quyen.map((x) => x.id) } }, select: { entitlementId: true, lessonStableId: true, status: true } }) : [];
  const tdTheoQuyen = new Map<string, TienDoBai>();
  for (const r of tienDoRows) (tdTheoQuyen.get(r.entitlementId) ?? tdTheoQuyen.set(r.entitlementId, {}).get(r.entitlementId)!)[r.lessonStableId] = r.status;

  const nhomMap = new Map<string, NhomPhuHuynh>();
  for (const x of quyen) {
    const t = trangThaiHieuLuc({ trangThai: x.status, hetHan: x.expiresAt }, o.now);
    // Quyền ĐÃ THU HỒI chỉ hiện khi lọc đúng "Đã thu hồi" (thiết kế QoHocVien) — mặc định không lẫn vào danh sách đang học.
    if (loc.trangThai ? t !== loc.trangThai : t === "THU_HOI") continue;
    const td = cay && cd?.ok ? tinhTienDoKhoa(cay, tdTheoQuyen.get(x.id) ?? {}, cd.caiDat) : null;
    const dong: DongHocVienKhoa = {
      entitlementId: x.id,
      studentId: x.studentId,
      tenHocVien: x.student.name,
      maHocVien: x.student.studentCode,
      nguon: x.source,
      nguonNhan: NGUON_QUYEN[x.source] ?? x.source,
      vaoLuc: x.startsAt,
      hetHan: x.expiresAt,
      anchorDay: x.anchorDay,
      trangThai: t,
      phanTram: td ? td.phanTram : null,
      daXong: td ? td.daXongBatBuoc : null,
      tong: td ? td.tongBaiBatBuoc : null,
      hoanThanh: td ? td.hoanThanh : null,
    };
    const k = khoaNhomPhuHuynh(x.student);
    const g = nhomMap.get(k);
    if (g) {
      g.hocVien.push(dong);
      if (dong.vaoLuc > g.vaoMoiNhatLuc) g.vaoMoiNhatLuc = dong.vaoLuc;
    } else {
      nhomMap.set(k, {
        khoaNhom: khoaCongKhai(k),
        tenPhuHuynh: x.student.parentName,
        sdt: o.xemPii ? dinhDangSdtVn(x.student.parentPhone) : null,
        sdtChe: che(x.student.parentPhone),
        leadId: x.student.leadId,
        vaoMoiNhatLuc: dong.vaoLuc,
        hocVien: [dong],
      });
    }
  }
  const tatCa = [...nhomMap.values()].sort((a, b) =>
    loc.sapXep === "TEN_PHU_HUYNH"
      ? (a.tenPhuHuynh ?? "").localeCompare(b.tenPhuHuynh ?? "", "vi") || a.khoaNhom.localeCompare(b.khoaNhom)
      : b.vaoMoiNhatLuc.getTime() - a.vaoMoiNhatLuc.getTime() || a.khoaNhom.localeCompare(b.khoaNhom),
  );
  for (const g of tatCa) g.hocVien.sort((a, b) => b.vaoLuc.getTime() - a.vaoLuc.getTime() || a.studentId.localeCompare(b.studentId));
  return { nhom: tatCa.slice((trang - 1) * coTrang, trang * coTrang), tongNhom: tatCa.length, tongHocVien: tatCa.reduce((s, g) => s + g.hocVien.length, 0) };
}

// ───────── Tìm học viên để cấp ─────────

export type UngVienCap = { studentId: string; tenHocVien: string; maHocVien: string | null; tenPhuHuynh: string | null; sdtChe: string | null; daCoQuyen: boolean };

/** Tìm `Student` ĐÃ CÓ để cấp quyền (không tạo học viên mới ở đây). Chỉ trả tối đa 20; thiếu từ khoá ⇒ rỗng (không liệt kê cả cơ sở dữ liệu). */
export async function timHocVienDeCap(db: Db, input: { courseId: string; q: string }): Promise<UngVienCap[]> {
  const q = input.q.trim();
  if (q.length < 2) return [];
  const so = soNoiDia(q);
  const chon = { id: true, name: true, studentCode: true, parentName: true, parentPhone: true, onlEntitlements: { where: { courseId: input.courseId }, select: { status: true } } } as const;
  const theoChu = await db.student.findMany({
    where: { deletedAt: null, OR: [{ name: { contains: q, mode: "insensitive" } }, { studentCode: { contains: q, mode: "insensitive" } }, { parentName: { contains: q, mode: "insensitive" } }] },
    orderBy: { name: "asc" },
    take: 20,
    select: chon,
  });
  let theoSdt: typeof theoChu = [];
  if (so.length >= 6) {
    const ung = await db.student.findMany({ where: { deletedAt: null, parentPhone: { not: null } }, select: chon, take: 5000 });
    theoSdt = ung.filter((s) => soNoiDia(s.parentPhone ?? "").includes(so)).slice(0, 20);
  }
  const gop = new Map([...theoChu, ...theoSdt].map((s) => [s.id, s]));
  const ds = [...gop.values()].slice(0, 20);
  return ds.map((s) => ({
    studentId: s.id,
    tenHocVien: s.name,
    maHocVien: s.studentCode,
    tenPhuHuynh: s.parentName,
    sdtChe: che(s.parentPhone),
    daCoQuyen: s.onlEntitlements.some((e) => e.status === "ACTIVE"),
  }));
}

// ───────── Lịch sử quyền học ─────────

export type DongLichSuQuyen = {
  id: string;
  kind: string;
  nguon: string | null;
  thangThem: number | null;
  tuHan: Date | null;
  denHan: Date | null;
  lyDo: string | null;
  nguoiThucHien: string | null;
  donHang: string | null;
  luc: Date;
};

export async function lichSuQuyenHoc(db: Db, input: { courseId: string; studentId: string }): Promise<DongLichSuQuyen[] | null> {
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  if (!q) return null;
  const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: q.id }, orderBy: { createdAt: "desc" } });
  const ids = [...new Set(ev.flatMap((e) => (e.actorUserId ? [e.actorUserId] : [])))];
  const nguoi = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const ten = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  return ev.map((e) => ({
    id: e.id,
    kind: e.kind,
    nguon: e.source ? (NGUON_QUYEN[e.source] ?? e.source) : null,
    thangThem: e.monthsAdded,
    tuHan: e.fromExpiresAt,
    denHan: e.toExpiresAt,
    lyDo: e.reason,
    nguoiThucHien: e.actorUserId ? (ten.get(e.actorUserId) ?? e.actorUserId) : null,
    donHang: e.orderId,
    luc: e.createdAt,
  }));
}
