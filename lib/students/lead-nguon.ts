// lib/students/lead-nguon.ts — ĐỌC liên kết Học viên ↔ Lead (25/09/2026). Server-only.
//
// Ba hàm, ba câu hỏi:
//   · docLeadNguon    — hồ sơ học viên: "em này đến từ phiếu nào, tôi được xem tới đâu?"
//   · timLeadDeGan    — nút "Gắn lead": ô tìm phiếu để nối tay.
//   · hocVienCuaLead  — trang lead: "phiếu này đã thành những học viên nào?"
//
// ⛔ CỔNG ĐỌC LEAD — đừng đi đường tắt (đo ở `lib/db-scope.ts:4-5` + `injectScope`):
// `scopedDb` chỉ cách ly truy vấn TOP-LEVEL; `include`/`select` lồng KHÔNG được scope, và
// `LeadChild` còn không nằm trong `SCOPED_MODELS`. Nên đọc lead xuyên
// `student → enrollments → leadChild → lead` là đọc được phiếu của CƠ SỞ KHÁC mà không
// cổng nào kêu. Luật của file này:
//   1. `db` trần CHỈ dùng để PHÂN GIẢI ID (tìm ra `leadId`/`studentId`) — không bao giờ
//      trả dữ liệu phiếu ra ngoài từ `db` trần.
//   2. Mọi phiếu trả ra đều ĐỌC LẠI TOP-LEVEL qua `scopedDb(actor).lead.findFirst/findMany`
//      (cách ly cơ sở) rồi lọc `canSeeLead` (lead độc quyền của Sale — Q8 22/08).
//   3. Che PII ở `lead-nguon-view.ts` (thuần, có test) — file này không tự che.
// Lưới ghim: `lib/students/lead-nguon.test.ts`.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import {
  canViewLeadPii,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { canSeeLead, leadSharingEnabled } from "@/lib/lead/sharing";
import { leadOwnershipWhere } from "@/lib/lead/ownership";
import { LEAD_OUTREACH_TYPES } from "@/lib/lead/activity-clock";
import { maskPersonName } from "@/lib/lead/pii";
import { phoneSearchTerm, phoneVariants } from "@/lib/phone";
import { tinhTinhTrangHoc } from "@/lib/students/tinh-trang-hoc";
import {
  dungLeadGoiY,
  dungLeadNguonChiTiet,
  type LeadThoChiTiet,
  type LeadThoGoiY,
} from "./lead-nguon-view";
import type {
  HocVienTuLead,
  LeadGoiY,
  LeadNguonKetQua,
} from "./lead-nguon-types";

/** Số gợi ý tối đa trên hồ sơ học viên — nhiều hơn là người dùng không đọc. */
const SO_GOI_Y_TOI_DA = 5;
/** Số kết quả tối đa của ô tìm phiếu. */
const SO_KET_QUA_TIM = 10;
/**
 * Trần số dòng hoạt động đọc để tính "tương tác gần nhất". Chỉ lấy các loại có thể là
 * tiếp cận, mới nhất trước; 200 dòng MÁY ghi liên tiếp mới hơn lần chạm cuối của người
 * là điều không có thật (trang lead chỉ đọc 100 dòng cho cả dòng thời gian).
 */
const SO_HOAT_DONG_TOI_DA = 200;

/** Cột lead cho khối chi tiết + đủ cột để hỏi `canSeeLead`. */
const CHON_LEAD_CHI_TIET = {
  id: true,
  parentName: true,
  phone: true,
  status: true,
  source: true,
  note: true,
  createdAt: true,
  createdById: true,
  assignedToId: true,
  isSharedWithTeam: true,
  course: { select: { name: true } },
  center: { select: { name: true } },
  assignedTo: { select: { name: true } },
  affiliate: { select: { name: true, code: true } },
} satisfies Prisma.LeadSelect;

/** Cột lead cho một dòng gợi ý + đủ cột để hỏi `canSeeLead`. */
const CHON_LEAD_GOI_Y = {
  id: true,
  parentName: true,
  phone: true,
  status: true,
  createdAt: true,
  createdById: true,
  assignedToId: true,
  isSharedWithTeam: true,
  center: { select: { name: true } },
  assignedTo: { select: { name: true } },
  children: { orderBy: { createdAt: "asc" }, select: { id: true, fullName: true } },
} satisfies Prisma.LeadSelect;

type LeadCoChuSo = {
  assignedToId: string | null;
  createdById: string | null;
  isSharedWithTeam: boolean;
};

/** `canSeeLead` với đủ ba vế — cùng cách trang lead gọi. */
function xemDuocLead(lead: LeadCoChuSo, userId: string, canViewAll: boolean): boolean {
  return canSeeLead({
    canViewAll,
    isOwner: lead.assignedToId === userId,
    isCreator: !!lead.createdById && lead.createdById === userId,
    isShared: lead.isSharedWithTeam,
    sharingEnabled: leadSharingEnabled(),
  });
}

/**
 * Được TÌM/SO theo SĐT không — cùng cổng với ô tìm của `/admin/leads` (NỢ #11): thấy
 * SĐT thật (`leads:view-pii`) VÀ không bị DENY cấp trường `phone`. Thiếu quyền mà vẫn so
 * SĐT là dò được số qua kết quả.
 */
async function duocSoSdt(canViewPii: boolean): Promise<boolean> {
  if (!canViewPii) return false;
  const { fieldMask } = await checkPermissionDetail("leads:view-pii");
  return !fieldMask.includes("phone");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Hồ sơ học viên → lead nguồn
// ─────────────────────────────────────────────────────────────────────────────

export async function docLeadNguon(input: {
  actor: Actor;
  userId: string;
  student: {
    id: string;
    leadId: string | null;
    leadChildId: string | null;
    parentPhone: string | null;
  };
  /**
   * SĐT phụ huynh của học viên đang bị CHE cho người xem (fieldMask `parentPhone` của
   * `students:view-all`, US-03). BẮT BUỘC, không mặc định (luật 7): true ⇒ không so lead
   * theo SĐT (gợi ý "Cùng SĐT" là tiết lộ số) và che SĐT lead ở mọi chỗ in.
   */
  parentPhoneMasked: boolean;
}): Promise<LeadNguonKetQua> {
  const { actor, userId, student, parentPhoneMasked } = input;
  const sdb = scopedDb(actor);
  const [canViewAll, canViewPii, canEditStudent] = await Promise.all([
    checkPermission("leads:view-all"),
    canViewLeadPii(),
    checkPermission("students:edit"),
  ]);

  if (student.leadId) {
    const lead = await sdb.lead.findFirst({
      where: { id: student.leadId, deletedAt: null },
      select: CHON_LEAD_CHI_TIET,
    });

    if (!lead) {
      // Không thấy qua cổng cách ly: phân biệt "phiếu còn, ở cơ sở khác" với "phiếu đã
      // xoá". Chỉ hỏi CÓ/KHÔNG (select id) — không lấy dữ liệu phiếu từ `db` trần.
      const conTonTai = await db.lead.findFirst({
        where: { id: student.leadId, deletedAt: null },
        select: { id: true },
      });
      if (conTonTai) return { kind: "KHONG_DUOC_XEM", lyDo: "CO_SO_KHAC" };
      // Phiếu đã xoá ⇒ coi như chưa nối, để người dùng gắn lại được.
      return docGoiY({
        actor,
        userId,
        student,
        canViewAll,
        canViewPii,
        canEditStudent,
        parentPhoneMasked,
      });
    }

    if (!xemDuocLead(lead, userId, canViewAll)) {
      return { kind: "KHONG_DUOC_XEM", lyDo: "SALE_KHAC" };
    }

    // Phiếu đã qua CẢ HAI cổng ⇒ từ đây đọc phần phụ của CHÍNH phiếu này.
    const [hoatDong, nguoiNhap, con] = await Promise.all([
      sdb.leadActivity.findMany({
        where: { leadId: lead.id, type: { in: [...LEAD_OUTREACH_TYPES] } },
        orderBy: { createdAt: "desc" },
        take: SO_HOAT_DONG_TOI_DA,
        select: { type: true, createdAt: true, metadata: true },
      }),
      // Người nhập chỉ tra khi được xem (leads:view-all) — không đọc thứ sẽ không in.
      canViewAll && lead.createdById
        ? sdb.user.findFirst({
            where: { id: lead.createdById },
            select: { name: true, employee: { select: { employeeCode: true } } },
          })
        : Promise.resolve(null),
      // Con phải THUỘC phiếu này (`leadId` trong where) — không thì một `leadChildId`
      // lệch sẽ in tên con của phiếu khác dưới tên phiếu này.
      student.leadChildId
        ? sdb.leadChild.findFirst({
            where: { id: student.leadChildId, leadId: lead.id },
            select: { id: true, fullName: true, classId: true, interestedCourseId: true },
          })
        : Promise.resolve(null),
    ]);

    const [tenLop, khoaCuaCon] = await Promise.all([
      con?.classId
        ? sdb.class.findFirst({
            where: { id: con.classId, deletedAt: null },
            select: { name: true },
          })
        : Promise.resolve(null),
      // Khoá của con chỉ cần khi phiếu chưa có khoá (`Lead.course` đi trước).
      !lead.course && con?.interestedCourseId
        ? sdb.course.findFirst({ where: { id: con.interestedCourseId }, select: { name: true } })
        : Promise.resolve(null),
    ]);

    const leadTho: LeadThoChiTiet = lead;
    return {
      kind: "CO_LEAD",
      lead: dungLeadNguonChiTiet({
        lead: leadTho,
        nguoiNhap: nguoiNhap
          ? { name: nguoiNhap.name, employeeCode: nguoiNhap.employee?.employeeCode ?? null }
          : null,
        khoaQuanTamCuaCon: khoaCuaCon?.name ?? null,
        hoatDong,
        con: con ? { id: con.id, fullName: con.fullName, tenLop: tenLop?.name ?? null } : null,
        canViewPii,
        canViewAll,
        sdtHocVienBiChe: parentPhoneMasked,
      }),
      coTheSua: canEditStudent,
    };
  }

  return docGoiY({
    actor,
    userId,
    student,
    canViewAll,
    canViewPii,
    canEditStudent,
    parentPhoneMasked,
  });
}

/**
 * Học viên CHƯA nối lead: đề xuất phiếu để gắn.
 *   (a) VET_GHI_DANH — một ghi danh của em mang `leadChildId` (vết convert v2) ⇒ chắc chắn.
 *   (b) CUNG_SDT     — phiếu có SĐT trùng SĐT phụ huynh ⇒ chỉ là gợi ý.
 */
async function docGoiY(input: {
  actor: Actor;
  userId: string;
  student: { id: string; parentPhone: string | null };
  canViewAll: boolean;
  canViewPii: boolean;
  canEditStudent: boolean;
  parentPhoneMasked: boolean;
}): Promise<LeadNguonKetQua> {
  const { actor, userId, student, canViewAll, canViewPii, canEditStudent, parentPhoneMasked } =
    input;
  const sdb = scopedDb(actor);

  // (a) Phân giải ID bằng `db` trần: ghi danh là model SCOPED + soft-delete, còn đây chỉ
  // là đi tìm `leadId`. Nhắc `deletedAt` ở where TOP-LEVEL để tầng soft-delete không tự
  // chèn `deletedAt: null` (lib/soft-delete.ts) — ghi danh đã huỷ vẫn là vết "em đến từ
  // phiếu này". `undefined` = Prisma bỏ qua điều kiện, nhưng khoá vẫn "có mặt".
  const vet = await db.enrollment.findMany({
    where: { studentId: student.id, leadChildId: { not: null }, deletedAt: undefined },
    orderBy: { createdAt: "asc" },
    select: { leadChild: { select: { leadId: true } } },
  });
  const idTuVet = [
    ...new Set(vet.map((e) => e.leadChild?.leadId).filter((v): v is string => !!v)),
  ];

  // (b) SĐT: MỘT số ⇒ `phoneVariants` (cả dạng `84…` mới lẫn `0…` cũ). `expandPhoneVariants`
  // là bản cho DANH SÁCH số — ở đây chỉ có một. `phoneVariants("")` trả `[]` nên HV chưa
  // có SĐT không khớp với mọi lead SĐT rỗng.
  // SĐT học viên đang bị che ⇒ KHÔNG so: một gợi ý "Cùng SĐT" là nói thẳng số bị che.
  const bienThe =
    !parentPhoneMasked && (await duocSoSdt(canViewPii)) ? phoneVariants(student.parentPhone) : [];

  const [tuVet, cungSdt] = await Promise.all([
    idTuVet.length
      ? sdb.lead.findMany({
          where: { id: { in: idTuVet }, deletedAt: null },
          select: CHON_LEAD_GOI_Y,
        })
      : Promise.resolve([]),
    bienThe.length
      ? sdb.lead.findMany({
          where: {
            deletedAt: null,
            phone: { in: bienThe },
            ...(canViewAll ? {} : { AND: [leadOwnershipWhere(userId)] }),
          },
          orderBy: { createdAt: "desc" },
          take: SO_GOI_Y_TOI_DA,
          select: CHON_LEAD_GOI_Y,
        })
      : Promise.resolve([]),
  ]);

  const goiY: LeadGoiY[] = [];
  const daCo = new Set<string>();
  const them = (rows: (LeadThoGoiY & LeadCoChuSo)[], lyDo: LeadGoiY["lyDo"]) => {
    for (const l of rows) {
      if (goiY.length >= SO_GOI_Y_TOI_DA || daCo.has(l.id)) continue;
      if (!xemDuocLead(l, userId, canViewAll)) continue;
      daCo.add(l.id);
      goiY.push(dungLeadGoiY({ lead: l, lyDo, canViewPii, sdtHocVienBiChe: parentPhoneMasked }));
    }
  };
  // Vết ghi danh đứng TRƯỚC: nó chắc chắn, SĐT chỉ là trùng số.
  them(tuVet, "VET_GHI_DANH");
  them(cungSdt, "CUNG_SDT");

  return { kind: "CHUA_NOI", goiY, coTheGan: canEditStudent };
}

/**
 * Người đang thao tác có được GỠ/ĐỔI liên kết đang trỏ vào `leadId` không.
 *
 * Được khi MỘT trong ba:
 *   · có `leads:view-all` (quản lý — sửa liên kết của học viên trong tầm nhìn mình);
 *   · MỞ ĐƯỢC chính phiếu đó (qua cách ly cơ sở + `canSeeLead`);
 *   · phiếu ĐÃ XOÁ / không còn — liên kết mồ côi, không còn ai để "bảo vệ"; màn học viên
 *     cũng đang coi nó là "chưa nối" (docLeadNguon) nên phải gắn lại được.
 *
 * Không được: Sale A gỡ liên kết học viên khỏi phiếu của Sale B mà A không mở được —
 * thao tác đó xoá dấu vết nguồn của người khác mà người làm không nhìn thấy gì.
 */
export async function duocDoiLienKetCu(input: {
  actor: Actor;
  userId: string;
  leadId: string;
  canViewAll: boolean;
}): Promise<boolean> {
  if (input.canViewAll) return true;
  const lead = await scopedDb(input.actor).lead.findFirst({
    where: { id: input.leadId, deletedAt: null },
    select: { assignedToId: true, createdById: true, isSharedWithTeam: true },
  });
  if (lead) return xemDuocLead(lead, input.userId, false);
  // Không thấy qua cổng: còn tồn tại (ở cơ sở khác) thì KHÔNG; đã xoá thì được.
  const conTonTai = await db.lead.findFirst({
    where: { id: input.leadId, deletedAt: null },
    select: { id: true },
  });
  return !conTonTai;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Ô tìm phiếu để gắn tay
// ─────────────────────────────────────────────────────────────────────────────

export async function timLeadDeGan(input: {
  actor: Actor;
  userId: string;
  q: string;
  /** SĐT phụ huynh của học viên đang mở bị che ⇒ không tìm theo số, che số ở kết quả. BẮT BUỘC. */
  sdtHocVienBiChe: boolean;
}): Promise<LeadGoiY[]> {
  const q = input.q.trim();
  if (q.length < 2) return [];

  const [canViewAll, canViewPii] = await Promise.all([
    checkPermission("leads:view-all"),
    canViewLeadPii(),
  ]);
  const soSdt = !input.sdtHocVienBiChe && (await duocSoSdt(canViewPii));

  // Cùng cách ô tìm của `/admin/leads`: SĐT tìm theo PHẦN LÕI (khớp cả `0…` lẫn `84…`),
  // tên tìm `contains` không phân biệt hoa thường. Không bỏ dấu phía DB — danh sách lead
  // cũng không (cần extension `unaccent`), để hai ô tìm trả cùng một kết quả.
  const loiSdt = soSdt ? phoneSearchTerm(q) : null;
  const dieuKienTim: Prisma.LeadWhereInput[] = [
    { parentName: { contains: q, mode: "insensitive" } },
    { childName: { contains: q, mode: "insensitive" } },
    { children: { some: { fullName: { contains: q, mode: "insensitive" } } } },
    ...(loiSdt ? [{ phone: { contains: loiSdt } }] : []),
  ];

  const rows = await scopedDb(input.actor).lead.findMany({
    where: {
      deletedAt: null,
      // Hai nhóm OR sống chung nên gói trong AND (như trang danh sách lead).
      AND: [
        { OR: dieuKienTim },
        ...(canViewAll ? [] : [leadOwnershipWhere(input.userId)]),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: SO_KET_QUA_TIM,
    select: CHON_LEAD_GOI_Y,
  });

  return rows
    .filter((l) => xemDuocLead(l, input.userId, canViewAll))
    .map((l) =>
      dungLeadGoiY({ lead: l, lyDo: "TIM_KIEM", canViewPii, sdtHocVienBiChe: input.sdtHocVienBiChe }),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Trang lead → học viên đã thành
// ─────────────────────────────────────────────────────────────────────────────

/** Nhãn cho học viên nằm ngoài tầm nhìn cơ sở của người xem — chỉ in tên, không link. */
export const NHAN_HV_NGOAI_PHAM_VI = "Ở cơ sở khác";

export async function hocVienCuaLead(input: {
  actor: Actor;
  leadId: string;
  childIds: string[];
}): Promise<HocVienTuLead[]> {
  const { actor, leadId } = input;
  const sdb = scopedDb(actor);

  // Tự gác, không tin chỗ gọi: hàm này trả tên học viên nên phải chắc người xem mở được
  // phiếu. Trang lead đã gác, nhưng một chỗ gọi mới thì chưa chắc.
  const [canViewAll, canViewPii, canEditStudent] = await Promise.all([
    checkPermission("leads:view-all"),
    canViewLeadPii(),
    checkPermission("students:edit"),
  ]);
  const lead = await sdb.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      isSharedWithTeam: true,
      children: { select: { id: true } },
    },
  });
  if (!lead || !xemDuocLead(lead, actor.userId, canViewAll)) return [];

  // Chỉ nhận con THUỘC phiếu này — `childIds` là tham số, không phải sự thật.
  const conCuaPhieu = new Set(lead.children.map((c) => c.id));
  const childIds = input.childIds.filter((id) => conCuaPhieu.has(id));

  // Phân giải ID bằng `db` trần (chưa trả dữ liệu gì ra).
  const [lienKet, vet] = await Promise.all([
    db.student.findMany({
      where: {
        deletedAt: null,
        OR: [{ leadId }, ...(childIds.length ? [{ leadChildId: { in: childIds } }] : [])],
      },
      select: { id: true },
    }),
    childIds.length
      ? db.enrollment.findMany({
          where: { leadChildId: { in: childIds } },
          select: { studentId: true },
        })
      : Promise.resolve([]),
  ]);
  const noiQua = new Map<string, HocVienTuLead["noiQua"]>();
  for (const s of lienKet) noiQua.set(s.id, "LIEN_KET");
  for (const e of vet) if (!noiQua.has(e.studentId)) noiQua.set(e.studentId, "VET_GHI_DANH");
  const ids = [...noiQua.keys()];
  if (ids.length === 0) return [];

  // Tầm nhìn: đọc lại TOP-LEVEL qua scopedDb. Ai không lọt cổng thì chỉ còn tên.
  const thay = await sdb.student.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      name: true,
      studentCode: true,
      status: true,
      // Lồng ⇒ không có tầng soft-delete tự chèn — tự lọc (lib/soft-delete.ts).
      enrollments: { where: { deletedAt: null }, select: { status: true } },
    },
  });
  const thayIds = new Set(thay.map((s) => s.id));
  const anIds = ids.filter((id) => !thayIds.has(id));
  const an = anIds.length
    ? await db.student.findMany({
        where: { id: { in: anIds }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];

  // Trên trang LEAD, tên học viên theo luật PII của lead: trang đó che tên con khi thiếu
  // `leads:view-pii`, nên khối này không được in lộ đúng cái tên vừa che ở ngay trên.
  const ten = (name: string) => (canViewPii ? name : maskPersonName(name));

  const out: HocVienTuLead[] = [
    ...thay.map((s) => ({
      studentId: s.id,
      ten: ten(s.name),
      maHocVien: s.studentCode,
      trangThai: tinhTinhTrangHoc({
        status: s.status,
        enrollmentStatuses: s.enrollments.map((e) => e.status),
      }).label,
      href: canEditStudent ? `/students/${s.id}/edit` : null,
      noiQua: noiQua.get(s.id) ?? "LIEN_KET",
    })),
    // Ngoài tầm nhìn: không mã, không trạng thái, không link — chỉ tên (đã theo luật PII).
    ...an.map((s) => ({
      studentId: s.id,
      ten: ten(s.name),
      maHocVien: null,
      trangThai: NHAN_HV_NGOAI_PHAM_VI,
      href: null,
      noiQua: noiQua.get(s.id) ?? "LIEN_KET",
    })),
  ];

  // Nối chắc (LIEN_KET) lên trước, rồi theo tên.
  return out.sort((a, b) => {
    if (a.noiQua !== b.noiQua) return a.noiQua === "LIEN_KET" ? -1 : 1;
    return a.ten.localeCompare(b.ten, "vi");
  });
}
