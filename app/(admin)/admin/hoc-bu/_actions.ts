"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { nguoiHocBu, phamViTuQuyen, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import type { Prisma } from "@prisma/client";
import { LoiDong, chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { docBienLaiLuot } from "@/lib/hoc-bu/bien-lai-luot-db";
import { giaiThichLuot, type DongGiaiThich } from "@/lib/hoc-bu/hien-thi-thuan";
import { LoiTrungLich } from "@/lib/hoc-bu/loi";
import { KHONG_XUNG_DOT } from "@/lib/lms/lich-xung-dot";
import { dungThongDiepXungDot } from "@/lib/lms/schedule-conflict";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { kiemNhomNhieuBai } from "@/lib/hoc-bu/case-nhieu-bai-thuan";
import { caseChoNhom, type DongCase } from "@/lib/hoc-bu/case-doc";
import {
  LoiHocBu,
  gvTrongCa,
  taoCaseVaXep,
  xepVaoCaseCoSan,
  goKhoiCase,
  nangCapCaseTheoYeuCau,
  huyCase,
  diemDanhBe,
  suaDiemDanhBe,
  goBeKhoiCase,
  suaCase,
  ghiDanhGiaMuc,
  taoPhiBu,
  mienPhiBu,
  goMienPhiBu,
  canhBaoPhiKhiHuy,
  type GvTrongCa,
} from "@/lib/hoc-bu/case-db";
import { vnYmd } from "@/lib/time/vn";
import { guiBaiKiemTraBu } from "@/lib/hoc-bu/tai-lieu-bu";

// Học bù đời mới (docs/hoc-bu/DAC-TA.md). Luồng cũ "xếp bé vào buổi của lớp khác" đã GỠ
// (chốt 10). Quyền hỏi ở ĐẦU mỗi action (layout gate chưa đủ — Server Action là endpoint riêng);
// luật nghiệp vụ + phép ghi ở `lib/hoc-bu/case-db.ts`.

/** T16 — xung đột lịch có CẤU TRÚC (giáo viên · phòng · học viên) để màn hiện từng nhóm, thay vì một câu dài. Câu chữ đã qua luật che theo cơ sở của người xem. */
export type XungDotNhom = { nhom: "GIAO_VIEN" | "PHONG" | "HOC_VIEN"; dong: string[] };
type KetQua = { ok: true } | { ok: false; error: string; xungDot?: XungDotNhom[] };
/** Kết quả có LỜI NHẮN cho người bấm (T06): thành công nhưng còn việc phải làm ngoài hệ thống (vd. báo kế toán hoàn phí). */
type KetQuaCoNhac = { ok: true; canhBao?: string } | { ok: false; error: string };

/**
 * `actor` mang theo PHẠM VI (T10): `chiCuaSale` (Sale chỉ học viên mình phụ trách) và, cho điểm danh, `chiGv` (giáo viên thường chỉ case MÌNH dạy). Hai thứ này
 * suy từ quyền, đọc MỘT lần ở đây — mọi dịch vụ ghi nhận `NguoiHocBu` nên không action nào quên được.
 */
type Ngu = { ok: true; actor: NguoiHocBu; session: Session; chiGv: string | undefined } | { ok: false; error: string };

async function cong(quyen: "makeup:manage" | "makeup:waive" | "makeup:attend"): Promise<Ngu> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(quyen))) {
    return {
      ok: false,
      error:
        quyen === "makeup:waive"
          ? "Chỉ Quản lý cơ sở / Admin được làm việc này"
          : quyen === "makeup:attend"
            ? "Chỉ quản lý / giáo viên được điểm danh và nhận xét buổi bù"
            : "Bạn không có quyền xếp học bù",
    };
  }
  const [xemTatCa, quanLy] = await Promise.all([checkPermission("makeup:view-all"), checkPermission("makeup:manage")]);
  // Giáo viên thường (có `makeup:attend` nhưng KHÔNG `makeup:manage`) chỉ điểm danh / đánh giá / gửi bài case do CHÍNH MÌNH dạy — kể cả khi gọi từ
  // action của admin (HB-24). Quản lý (có manage) không bị buộc.
  const { chiCuaSale, chiGv } = phamViTuQuyen({ xemTatCa, quanLy }, session.user.id);
  return { ok: true, actor: nguoiHocBu(await resolveActor(session.user.id), chiCuaSale), session, chiGv };
}

function dichLoi(e: unknown): { ok: false; error: string } {
  if (e instanceof LoiHocBu) return { ok: false, error: e.message };
  console.error("[hoc-bu]", e);
  return { ok: false, error: "Có lỗi khi lưu — thử lại sau ít phút" };
}

/** `LoiTrungLich` → câu chữ chia theo chiều xung đột. Mỗi chiều dựng lại bằng CHÍNH `dungThongDiepXungDot` (luật che tên nguồn ở cơ sở người xem không đọc được). */
async function xungDotCoCauTruc(e: LoiTrungLich, actor: NguoiHocBu): Promise<XungDotNhom[]> {
  const k = e.ketQua;
  const rieng = (p: Partial<typeof k>) => dungThongDiepXungDot({ ...KHONG_XUNG_DOT, ...p, coXungDot: true }, { actor });
  const [gv, phong, hv] = await Promise.all([
    k.teacherConflicts.length ? rieng({ teacherConflicts: k.teacherConflicts }) : Promise.resolve([]),
    k.roomConflicts.length ? rieng({ roomConflicts: k.roomConflicts }) : Promise.resolve([]),
    k.studentConflicts.length ? rieng({ studentConflicts: k.studentConflicts }) : Promise.resolve([]),
  ]);
  return [
    { nhom: "GIAO_VIEN" as const, dong: gv },
    { nhom: "PHONG" as const, dong: phong },
    { nhom: "HOC_VIEN" as const, dong: hv },
  ].filter((g) => g.dong.length > 0);
}

/** Như `dichLoi` nhưng với đường XẾP LỊCH: trùng lịch trả thêm `xungDot` có cấu trúc. */
async function dichLoiXep(e: unknown, actor: NguoiHocBu): Promise<{ ok: false; error: string; xungDot?: XungDotNhom[] }> {
  if (e instanceof LoiTrungLich) return { ok: false, error: e.message, xungDot: await xungDotCoCauTruc(e, actor) };
  return dichLoi(e);
}

function xong(caseId?: string): void {
  revalidatePath("/hoc-bu");
  if (caseId) revalidatePath(`/hoc-bu/case/${caseId}`);
}

// T14: nhật ký học bù ghi TRONG giao dịch của dịch vụ (`lib/hoc-bu/nhat-ky.ts`) — server action không tự ghi sau khi dịch vụ đã commit
// (bản cũ: lỗi giữa chừng để lại phép ghi không dấu vết, và nhiều phép ghi không có dòng nào). Hai đường huỷ/khôi phục DÒNG ở dưới ghi trong
// giao dịch của chính action nên giữ `writeAudit` tại chỗ, dưới tên hành động chuẩn.

// ─── Huỷ không bù ─────────────────────────────────────────────────────────────

const lyDo = z
  .string()
  .trim()
  .min(LY_DO_TOI_THIEU, `Ghi lý do ít nhất ${LY_DO_TOI_THIEU} ký tự`)
  .max(500);
const huySchema = z.object({ id: z.string().min(1), lyDo });

/**
 * HUỶ = buổi đó nghỉ luôn, không bù nữa (chốt 9: QLCS + Admin — "Giám đốc" là vai Admin, chốt 30/09; bắt buộc lý do).
 * Dòng đã huỷ KHÔNG tự hồi sinh khi sửa điểm danh — `createMakeupNeed` tha `waivedAt`.
 */
export async function huyBuoiCanBuAction(input: { id: string; lyDo: string }): Promise<KetQuaCoNhac> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) {
    return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được huỷ buổi cần bù" };
  }
  const p = huySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  // Chống IDOR ghi: đọc qua scopedDb — ngoài cơ sở của người bấm thì như không tồn tại.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const need = await sdb.makeupNeed.findUnique({
    where: { id: p.data.id },
    select: { id: true, status: true, waivedAt: true, orgUnitId: true, studentId: true, missedSessionId: true, feeOrderItemId: true },
  });
  if (!need) return { ok: false, error: "Không tìm thấy buổi cần bù" };

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);
  // Chuyển trạng thái CÓ ĐIỀU KIỆN + audit trong CÙNG giao dịch (T05): hai người bấm cùng lúc thì chỉ một lượt ăn, và dòng đã huỷ
  // luôn có vết (bản cũ ghi audit SAU, ngoài giao dịch — lỗi giữa chừng để lại dòng huỷ không dấu vết).
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await chuyenTrangThaiDong(tx, {
        ids: [need.id],
        tu: "PENDING",
        sang: "CANCELLED",
        lyDo: "HUY_KHONG_BU",
        ngoai: { waivedAt: null },
        them: { waivedAt: now, waivedById: session.user.id, waivedReason: p.data.lyDo },
      });
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "hoc-bu",
        entityType: "MakeupNeed",
        entityId: need.id,
        action: "hoc-bu.huy-dong",
        oldValues: { status: need.status },
        newValues: { status: "CANCELLED", waivedAt: now.toISOString() },
        reason: p.data.lyDo,
        orgUnitId: need.orgUnitId,
        tx,
      });
    });
  } catch (e) {
    if (e instanceof LoiDong && e.ma === "DONG_DA_DOI") return { ok: false, error: "Buổi này đã được xử lý rồi — tải lại trang" };
    throw e;
  }

  revalidatePath("/hoc-bu");
  // HB-22 — huỷ KHÔNG tự hoàn tiền (quyết định của chủ dự án), nhưng đã thu phí thì phải NÓI RA: trước đây tiền nằm lại trên một đơn
  // mà không dòng nào còn dùng, không ai thấy. Đọc SAU khi huỷ — phép huỷ không phụ thuộc vào phí, lỗi đọc không được làm hỏng nó.
  const canhBao = await canhBaoPhiKhiHuy(need.feeOrderItemId).catch(() => null);
  return canhBao ? { ok: true, canhBao } : { ok: true };
}

/**
 * KHÔI PHỤC buổi đã huỷ (phụ huynh đổi ý muốn bù) — cùng quyền với huỷ. Lý do huỷ cũ giữ lại
 * trong AuditLog; dòng quay về danh sách cần bù với lượt tính lại như thường.
 */
export async function khoiPhucBuoiCanBuAction(id: string): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) {
    return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được khôi phục buổi đã huỷ" };
  }
  const sdb = scopedDb(await resolveActor(session.user.id));
  const need = await sdb.makeupNeed.findUnique({
    where: { id },
    select: { id: true, waivedReason: true, orgUnitId: true },
  });
  if (!need) return { ok: false, error: "Không tìm thấy buổi đã huỷ" };
  const { actorId, actorName } = getAuditActor(session);
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await chuyenTrangThaiDong(tx, {
        ids: [need.id],
        tu: "CANCELLED",
        sang: "PENDING",
        lyDo: "KHOI_PHUC",
        ngoai: { waivedAt: { not: null } },
        them: { waivedAt: null, waivedById: null, waivedReason: null },
      });
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "hoc-bu",
        entityType: "MakeupNeed",
        entityId: need.id,
        action: "hoc-bu.khoi-phuc-dong",
        oldValues: { status: "CANCELLED", waivedReason: need.waivedReason },
        newValues: { status: "PENDING" },
        reason: "Khôi phục buổi đã huỷ",
        orgUnitId: need.orgUnitId,
        tx,
      });
    });
  } catch (e) {
    if (e instanceof LoiDong && e.ma === "DONG_DA_DOI") return { ok: false, error: "Buổi này đã được xử lý rồi — tải lại trang" };
    throw e;
  }
  revalidatePath("/hoc-bu");
  return { ok: true };
}

// ─── Chọn case cho một nhóm bé ────────────────────────────────────────────────

const idsSchema = z.array(z.string().min(1)).min(1, "Chưa chọn học viên nào").max(50);

export type LuaChonCase =
  | {
      ok: true;
      coSo: string;
      khoa: string;
      buoi: string;
      be: { id: string; hocVien: string; cachXep: "Lượt bù" | "Đã thu phí" | "Miễn phí" }[];
      caseCoSan: DongCase[];
      phong: { id: string; name: string; sucChua: number }[];
      /** Bộ bài tối thiểu của case = các bài vắng của nhóm bé đã chọn (T07: case dạy cả bộ bài, tối đa 3). */
      baiCuaNhom: { id: string; ten: string }[];
      /** Bài khác cùng khoá có thể THÊM vào bộ bài (còn chỗ khi bộ bài chưa đủ 3). Rỗng khi bộ bài đã đủ 3. */
      baiCoTheThem: { id: string; ten: string }[];
      homNay: string;
    }
  | { ok: false; error: string };

export async function layLuaChonCaseAction(needIds: string[]): Promise<LuaChonCase> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = idsSchema.safeParse(needIds);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const sdb = scopedDb(n.actor);
  const dong = await docDongTheoId(sdb, p.data, n.actor.chiCuaSale);
  if (dong.length !== new Set(p.data).size) return { ok: false, error: "Có học viên đã được xếp/huỷ — tải lại trang" };
  const nhom = kiemNhomNhieuBai(dong.map((d) => ({ centerId: d.centerId, courseId: d.courseId, lessonId: d.lessonId, hocVien: d.hocVien })));
  if (!nhom.ok) return { ok: false, error: nhom.lyDo };
  const chan = dong.find((d) => !d.xep.ok);
  if (chan && !chan.xep.ok) return { ok: false, error: `${chan.hocVien}: ${chan.xep.lyDo}` };

  const homNay = vnYmd(new Date());
  const [caseCoSan, phong, coSo] = await Promise.all([
    caseChoNhom(sdb, { centerId: nhom.centerId, courseId: nhom.courseId, lessonIds: nhom.lessonIds }, new Date(`${homNay}T00:00:00Z`)),
    sdb.room.findMany({
      where: { centerId: nhom.centerId, status: "ACTIVE" },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, capacity: true },
    }),
    sdb.center.findUnique({ where: { id: nhom.centerId }, select: { code: true, name: true } }),
  ]);
  const dau = dong[0]!;
  const baiCuaNhom = [...new Map(dong.filter((d) => d.lessonId).map((d) => [d.lessonId!, { id: d.lessonId!, ten: d.buoiVang ?? "Bài chưa gắn tên" }])).values()];
  const conCho = 3 - baiCuaNhom.length;
  const baiKhoa =
    conCho > 0
      ? await sdb.lesson.findMany({
          where: { curriculum: { courseId: nhom.courseId }, id: { notIn: baiCuaNhom.map((b) => b.id) } },
          orderBy: [{ order: "asc" }],
          take: 200,
          select: { id: true, order: true, title: true, moduleCode: true },
        })
      : [];
  return {
    ok: true,
    coSo: coSo?.code || coSo?.name || "—",
    khoa: dau.khoa,
    buoi: dau.buoiVang ?? "—",
    be: dong.map((d) => ({
      id: d.id,
      hocVien: d.hocVien,
      cachXep: d.phi.loai === "LUOT" ? "Lượt bù" : d.phi.loai === "DA_THU" ? "Đã thu phí" : "Miễn phí",
    })),
    caseCoSan,
    phong: phong.map((r) => ({ id: r.id, name: r.name, sucChua: r.capacity })),
    baiCuaNhom,
    baiCoTheThem: baiKhoa.map((b) => ({ id: b.id, ten: deriveSessionLabel({ lessonOrder: b.order, lessonTitle: b.title, moduleCode: b.moduleCode }) || `Bài ${b.order}` })),
    homNay,
  };
}

const khungSchema = z.object({
  needIds: idsSchema,
  ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày dạy bù"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ bắt đầu không hợp lệ"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ kết thúc không hợp lệ"),
});

export async function layGvChoCaseAction(
  input: z.input<typeof khungSchema>,
): Promise<{ ok: true; ds: GvTrongCa[]; lyDoRong: string | null } | { ok: false; error: string }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = khungSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Cơ sở suy từ CHÍNH các dòng cần bù (không nhận centerId từ trình duyệt).
  const [dau] = await docDongTheoId(scopedDb(n.actor), [p.data.needIds[0]!], n.actor.chiCuaSale);
  if (!dau?.centerId) return { ok: false, error: "Không xác định được cơ sở của học viên" };
  try {
    return { ok: true, ...(await gvTrongCa(n.actor, { centerId: dau.centerId, ...p.data })) };
  } catch (e) {
    return dichLoi(e);
  }
}

const taoCaseSchema = khungSchema.extend({
  /** Bộ bài của case (1–3). Bỏ trống = đúng các bài vắng của các bé được chọn. */
  lessonIds: z.array(z.string().min(1)).min(1).max(3).optional(),
  roomId: z.string().min(1).nullable(),
  teacherId: z.string().min(1, "Chọn giáo viên"),
  note: z.string().trim().max(500).nullable(),
});

export async function taoCaseAction(
  input: z.input<typeof taoCaseSchema>,
): Promise<{ ok: true; caseId: string } | { ok: false; error: string; xungDot?: XungDotNhom[] }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = taoCaseSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (p.data.ymd < vnYmd(new Date())) return { ok: false, error: "Ngày dạy bù không được ở quá khứ" };
  try {
    const caseId = await taoCaseVaXep(n.actor, { ...p.data, note: p.data.note || null });
    xong(caseId);
    return { ok: true, caseId };
  } catch (e) {
    return dichLoiXep(e, n.actor);
  }
}

export async function xepVaoCaseAction(input: { caseId: string; needIds: string[] }): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = z.object({ caseId: z.string().min(1), needIds: idsSchema }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await xepVaoCaseCoSan(n.actor, p.data);
    xong(p.data.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoiXep(e, n.actor);
  }
}

// ─── Trong case ───────────────────────────────────────────────────────────────

export async function goKhoiCaseAction(input: { caseId: string; caseStudentId: string }): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await goKhoiCase(n.actor, input.caseStudentId);
    xong(input.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

/** PHIẾU nhận xét một bài (T16b): đánh giá chung ≤ 2000 ký tự (được trống nếu có bảng năng lực) + bảng 9 tiêu chí mức 1–5. */
const phieuSchema = z.object({
  caseId: z.string().min(1),
  caseStudentId: z.string().min(1),
  danhGia: z.string().trim().max(2000),
  rubric: z.record(z.string().min(1), z.number().int().min(1).max(5)).optional(),
});

/**
 * PHIẾU nhận xét một bài của bé ở buổi bù — lưu ở MỤC của case (T07), cho cả bé đã được điểm danh (sửa lời đánh giá không cần sửa điểm danh). Giáo viên thường chỉ case MÌNH dạy
 * (`chiGv`). Chỉ bài đã có kết quả mới đánh giá được — luật ở `ghiDanhGiaMuc`.
 */
export async function danhGiaMucAction(input: z.input<typeof phieuSchema>): Promise<KetQua> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  const p = phieuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await ghiDanhGiaMuc(n.actor, {
      caseStudentId: p.data.caseStudentId,
      danhGia: p.data.danhGia,
      rubric: p.data.rubric,
      chiGiaoVien: n.chiGv,
      ten: n.session.user.name ?? n.session.user.email ?? n.session.user.id,
    });
    xong(p.data.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

const ketQuaMucSchema = z.record(
  z.string().min(1),
  z.object({ ketQua: z.enum(["COMPLETED", "NOT_COMPLETED"]), danhGia: z.string().trim().max(2000).nullable() }),
);

async function ghiDeTuInput(n: Extract<Ngu, { ok: true }>, ghiDe: { lyDo: string } | undefined) {
  if (!ghiDe) return { ok: true as const, ghiDe: undefined };
  // Ghi đè là quyền RIÊNG (quản lý cơ sở trở lên), không phải quyền điểm danh thường.
  if (!(await checkPermission("makeup:waive"))) return { ok: false as const, error: "Bạn không có quyền ghi đè điểm danh quá hạn" };
  return { ok: true as const, ghiDe: { lyDo: ghiDe.lyDo, ten: n.session.user.name ?? n.session.user.email ?? n.session.user.id } };
}

const diemDanhBeSchema = z.object({
  caseId: z.string().min(1),
  participantId: z.string().min(1),
  coMat: z.boolean(),
  ketQuaMuc: ketQuaMucSchema,
  nhanXetChung: z.string().trim().max(2000).nullable(),
  ghiDe: z.object({ lyDo: z.string() }).optional(),
});

/** Điểm danh LẦN ĐẦU một bé ở buổi bù — tầng 1 (có mặt / vắng) + tầng 2 (từng bài xong hay chưa) trong một lần lưu. */
export async function diemDanhBeAction(input: z.input<typeof diemDanhBeSchema>): Promise<KetQua> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  const p = diemDanhBeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const gd = await ghiDeTuInput(n, p.data.ghiDe);
  if (!gd.ok) return gd;
  try {
    await diemDanhBe(n.actor, {
      participantId: p.data.participantId,
      coMat: p.data.coMat,
      ketQuaMuc: p.data.coMat ? p.data.ketQuaMuc : {},
      nhanXetChung: p.data.nhanXetChung,
      ghiDe: gd.ghiDe,
      chiGiaoVien: n.chiGv,
    });
    xong(p.data.caseId);
    revalidatePath("/attendance");
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

const suaDiemDanhBeSchema = diemDanhBeSchema.extend({ phienBan: z.number().int().min(0), lyDo: z.string() });

/** SỬA điểm danh một bé (đảo được, có audit) — kể cả chuyển từ có mặt sang vắng: lượt đã tiêu được trả lại. */
export async function suaDiemDanhBeAction(input: z.input<typeof suaDiemDanhBeSchema>): Promise<KetQua> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  const p = suaDiemDanhBeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const gd = await ghiDeTuInput(n, p.data.ghiDe);
  if (!gd.ok) return gd;
  try {
    await suaDiemDanhBe(n.actor, {
      participantId: p.data.participantId,
      coMat: p.data.coMat,
      ketQuaMuc: p.data.coMat ? p.data.ketQuaMuc : {},
      nhanXetChung: p.data.nhanXetChung,
      phienBan: p.data.phienBan,
      lyDo: p.data.lyDo,
      ghiDe: gd.ghiDe,
      chiGiaoVien: n.chiGv,
      ten: n.session.user.name ?? n.session.user.email ?? n.session.user.id,
    });
    xong(p.data.caseId);
    revalidatePath("/attendance");
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

/** Gỡ CẢ BÉ (mọi bài còn sống) khỏi case chưa điểm danh. */
export async function goBeKhoiCaseAction(input: { caseId: string; participantId: string }): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await goBeKhoiCase(n.actor, input.participantId);
    xong(input.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

const suaCaseSchema = z.object({
  caseId: z.string().min(1),
  phienBan: z.number().int().min(0),
  ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  teacherId: z.string().min(1).optional(),
  roomId: z.string().min(1).nullable().optional(),
  lessonIds: z.array(z.string().min(1)).min(1).max(3).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** SỬA case chưa điểm danh: ngày · giờ · giáo viên · phòng · bộ bài (khoá lạc quan theo phiên bản). */
export async function suaCaseAction(input: z.input<typeof suaCaseSchema>): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = suaCaseSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await suaCase(n.actor, { ...p.data, ten: n.session.user.name ?? n.session.user.email ?? n.session.user.id });
    xong(p.data.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoiXep(e, n.actor);
  }
}

/** Quản lý gửi bài kiểm tra bù thay giáo viên (cùng quyền điểm danh/nhận xét bù). */
export async function guiBaiKiemTraBuAction(p: {
  caseId: string;
  examId: string;
}): Promise<{ ok: true; soBe: number } | { ok: false; error: string }> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  // Case phải nằm trong tầm nhìn cơ sở của người bấm.
  const c = await scopedDb(n.actor).makeupCase.findUnique({ where: { id: p.caseId }, select: { id: true } });
  if (!c) return { ok: false, error: "Không tìm thấy case dạy bù" };
  try {
    const r = await guiBaiKiemTraBu({ caseId: p.caseId, examId: p.examId, byUserId: n.actor.userId, chiGiaoVien: n.chiGv ?? null, now: new Date() });
    xong(p.caseId);
    return { ok: true, soBe: r.soBe };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function huyCaseAction(caseId: string): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await huyCase(n.actor, caseId);
    xong(caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

// ─── Phí bù / miễn phí ngoại lệ ────────────────────────────────────────────────

export async function taoPhiBuAction(needId: string): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  // T10: phí bù là MỘT ĐƠN HÀNG (đơn + phiếu thu + mã QR) — ai tạo được đơn mới được tạo phí. Dùng quyền có sẵn `orders:create` (không quyền mới):
  // quản lý lớp có `makeup:manage` nhưng không có quyền tạo đơn thì không còn tự tạo được phí (nhờ Sale / quản lý cơ sở).
  if (!(await checkPermission("orders:create"))) return { ok: false, error: "Bạn không có quyền tạo đơn hàng — nhờ quản lý cơ sở hoặc tư vấn tạo phí bù" };
  try {
    const r = await taoPhiBu(n.actor, needId);
    xong();
    return { ok: true, orderId: r.orderId };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function mienPhiBuAction(input: { needId: string; lyDo: string }): Promise<KetQua> {
  const n = await cong("makeup:waive");
  if (!n.ok) return n;
  const p = z.object({ needId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const { actorName } = getAuditActor(n.session);
    await mienPhiBu(n.actor, { ...p.data, ten: actorName });
    xong();
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

/** GỠ miễn phí (T06) — người duyệt đổi ý; cùng quyền với miễn phí. Dòng đã xếp vào case thì phải gỡ khỏi case trước. */
export async function goMienPhiBuAction(input: { needId: string; lyDo: string }): Promise<KetQua> {
  const n = await cong("makeup:waive");
  if (!n.ok) return n;
  const p = z.object({ needId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const { actorName } = getAuditActor(n.session);
    await goMienPhiBu(n.actor, { needId: p.data.needId, lyDo: p.data.lyDo, ten: actorName });
    xong();
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

// ─── "Vì sao còn x/y lượt?" ────────────────────────────────────────────────────────────────────────────────────────────

export type BienLaiLuotView =
  | { ok: true; coSo: boolean; tomTat: string; dong: DongGiaiThich[]; biCat: boolean }
  | { ok: false; error: string };

/**
 * Giải thích số lượt của một dòng cần bù bằng CHÍNH sổ lượt (bút toán thật), không bằng công thức suy ngược. Phạm vi như danh sách: Sale chỉ học viên mình phụ trách;
 * dòng ngoài phạm vi hiện như không tồn tại (không lộ sổ của học viên ngoài tầm).
 */
export async function layBienLaiLuotAction(needId: string): Promise<BienLaiLuotView> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:view"))) return { ok: false, error: "Bạn không có quyền xem học bù" };
  const xemTatCa = await checkPermission("makeup:view-all");
  const id = z.string().min(1).safeParse(needId);
  if (!id.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const [d] = await docDongTheoId(scopedDb(await resolveActor(session.user.id)), [id.data], xemTatCa ? null : session.user.id);
  if (!d) return { ok: false, error: "Không tìm thấy buổi cần bù" };
  const bl = await docBienLaiLuot({ studentId: d.studentId, courseId: d.courseId });
  if (!bl.coSo) {
    return {
      ok: true,
      coSo: false,
      tomTat: `Chưa mở sổ lượt cho ${d.hocVien}: số lượt đang tính theo công thức của khoá — còn ${d.luot.con}/${d.luot.tong}. Sổ được mở ngay khi bé được xếp vào case đầu tiên.`,
      dong: [],
      biCat: false,
    };
  }
  const g = giaiThichLuot(bl.so, bl.bieuGhi);
  return { ok: true, coSo: true, tomTat: g.tomTat, dong: g.dong, biCat: bl.biCat };
}

// ─── Nâng cấp case đời cũ ──────────────────────────────────────────────────────────────────────────────────────────────

/** Nâng MỘT case đời cũ lên mô hình nhiều bài (nút ở màn chi tiết). Idempotent; case đã nâng thì không đổi gì. */
export async function nangCapCaseAction(caseId: string): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await nangCapCaseTheoYeuCau(n.actor, caseId);
    xong(caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}
