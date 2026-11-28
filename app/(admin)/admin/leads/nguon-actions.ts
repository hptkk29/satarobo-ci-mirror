"use server";

// ĐỔI NGUỒN lead — Server Action MỎNG (03 §3). Toàn bộ luật nằm ở `lib/nguon/doi-nguon-lead.ts` (ghi) và `lib/nguon/doi-nguon.ts`
// (quyết định thuần): action này chỉ làm ba việc — xác thực, nối đường hỏi quyền thật (`checkPermission` → `can()`), làm mới trang.
//
// Vì sao KHÔNG gác quyền ở đầu hàm bằng một khoá cố định: quyền đổi nguồn phụ thuộc lead (cơ sở nào, đã thu tiền chưa, nguồn
// có đang khoá không) nên `doiNguonLead` hỏi `checkPermission(action, { centerId, orgUnitId })` THEO TỪNG LEAD, sau khi lấy
// lead qua `scopedDb(actor)` + `passesScope`. Gác sớm bằng khoá không kèm đối tượng là từ chối oan người có quyền cấp cơ sở.
//
// PR7 thêm HAI action ĐỌC cho Sheet "Gán nguồn" và ô chọn người (`moGanNguonAction`, `timNguoiGioiThieuAction`). Hai action đó
// gác quyền Ở ĐẦU HÀM bằng đúng khoá mà nút vẽ (luật 12): mở Sheet = `sources:view` (cổng của tab Nguồn); tìm người = một trong
// bốn khoá cho phép GHI nguồn. Chúng KHÔNG đổi gì trong DB.
//
// ⚠️ File `"use server"` ⇒ CHỈ export hàm async. Kiểu trả về đặt ở `lib/nguon/doi-nguon-lead.ts`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { canViewLeadPii, checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { DO_DAI_TIM_TOI_DA, type LoaiNguoi } from "@/lib/nguon/chon-nguon";
import { docChoGanNguon } from "@/lib/nguon/doc-gan-nguon";
import { boSungSaleTheoNhanSu } from "@/lib/nguon/bo-sung-sale-db";
import { doiNguonLead } from "@/lib/nguon/doi-nguon-lead";
import { layCuaSoGhiCongNgay, laQuanLyNguonBat } from "@/lib/nguon/feature";
import type { KetQuaDoiNguonAction, KetQuaMoGanNguon, KetQuaTimNguoi } from "@/lib/nguon/ket-qua-action";
import { timNguoiGioiThieu } from "@/lib/nguon/tim-nguoi-gioi-thieu";

// Biểu mẫu gửi chuỗi RỖNG cho ô để trống: coi như không chọn, không phải lỗi "tối thiểu 1 ký tự".
const chuoiRong = z.string().max(64).nullish().transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const doiNguonSchema = z.object({
  leadId: z.string().trim().min(1).max(64),
  groupId: z.string().trim().min(1).max(64),
  employeeId: chuoiRong,
  parentUserId: chuoiRong,
  studentId: chuoiRong,
  affiliateId: chuoiRong,
  giaiTrinh: z.string().max(2000).nullish().transform((v) => v ?? null),
  lyDo: z.string().max(2000).nullish().transform((v) => v ?? null),
  /** ISO của `ChoGanNguon.nguon.capNhatLuc` — mốc màn hình mà người dùng đã nhìn (xem `daThayCapNhatLuc`). Vắng ⇒ không kiểm. */
  expectedUpdatedAt: z.string().datetime().nullish().transform((v) => (v ? new Date(v) : undefined)),
});

export async function doiNguonLeadAction(input: unknown): Promise<KetQuaDoiNguonAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = doiNguonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  // Cờ master TẮT ⇒ chưa có quy nguồn nào để đổi; đường sửa `source` cũ còn nguyên (không đổi hành vi hôm nay).
  if (!(await laQuanLyNguonBat())) {
    return { ok: false, error: "Quản lý nguồn chưa được bật." };
  }

  const actor = await resolveActor(session.user.id);
  const kq = await doiNguonLead({
    actor,
    actorName: session.user.name ?? session.user.email ?? "Nhân viên",
    kiemQuyen: (action, target) => checkPermission(action, target),
    leadId: d.leadId,
    groupId: d.groupId,
    thamChieu:
      d.employeeId || d.parentUserId || d.studentId || d.affiliateId
        ? { employeeId: d.employeeId, parentUserId: d.parentUserId, studentId: d.studentId, affiliateId: d.affiliateId }
        : null,
    giaiTrinh: d.giaiTrinh,
    lyDo: d.lyDo,
    daThayCapNhatLuc: d.expectedUpdatedAt,
    bayGio: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };

  // Đường THẬT trong app dir là `/admin/leads` (clean URL `/leads` chỉ do `decideRoute` rewrite).
  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${d.leadId}`);
  return { ok: true, canDieuChinh: kq.canDieuChinh };
}

/**
 * BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH — đường thoát của hold `THIEU_SALE_PHU_HUYNH`. Mỏng như `doiNguonLeadAction`: toàn bộ luật ở `boSungSalePhuHuynh`
 * (cổng cơ sở → quyền → lý do ≥ 10 ký tự → TU_CLAIM → D13 → first-claim → audit `BO_SUNG_NGUOI`), action chỉ xác thực + nối `checkPermission` thật.
 * Ngoại lệ có chủ đích của luật «gác quyền ở đầu hàm» (cùng lý do `doiNguonLeadAction`): quyền phụ thuộc TỪNG lead (cơ sở nào, đã thu tiền chưa) nên cổng nằm trong
 * service qua `kiemQuyen`. Nút ở khối Nguồn chỉ vẽ khi `quyenDoiNguon` cho phép — CÙNG hàm với cổng ấy (`docChoGanNguon.boSungSale`).
 */
const boSungSaleSchema = z.object({
  leadId: z.string().trim().min(1).max(64),
  /** `Employee.id` của nhân sự được chọn ở ô tìm (ReferrerPicker, loại NHAN_SU). */
  saleEmployeeId: z.string().trim().min(1).max(64),
  lyDo: z.string().max(2000).nullish().transform((v) => v ?? null),
  expectedUpdatedAt: z.string().datetime().nullish().transform((v) => (v ? new Date(v) : undefined)),
});

export async function boSungSalePhuHuynhAction(input: unknown): Promise<KetQuaDoiNguonAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = boSungSaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  const actor = await resolveActor(session.user.id);
  const kq = await boSungSaleTheoNhanSu({
    actor,
    actorName: session.user.name ?? session.user.email ?? "Nhân viên",
    kiemQuyen: (action, target) => checkPermission(action, target),
    leadId: d.leadId,
    saleEmployeeId: d.saleEmployeeId,
    lyDo: d.lyDo,
    daThayCapNhatLuc: d.expectedUpdatedAt,
    bayGio: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };

  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${d.leadId}`);
  revalidatePath("/admin/nguon-hoa-hong", "layout"); // hàng chờ của tab Nguồn: hold «thiếu Sale» đóng khi quét lại
  return { ok: true, canDieuChinh: kq.canDieuChinh };
}

// ── Sheet "Gán nguồn": ĐỌC ───────────────────────────────────────────────────────────────────────────────────

/**
 * Dữ liệu cho Sheet "Gán nguồn" và khối "Nguồn" của MỘT lead. Gác Ở ĐẦU HÀM bằng `sources:view` — đúng khoá cổng của tab
 * Nguồn (`PAGE_GATES`) và của khối trên lead. Cách ly cơ sở do `docChoGanNguon` (scopedDb + passesScope); lead ngoài tầm
 * nhìn ⇒ cùng một câu "không tồn tại" như lead không có thật.
 */
export async function moGanNguonAction(input: unknown): Promise<KetQuaMoGanNguon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:view"))) return { ok: false, error: "Không có quyền xem nguồn lead (sources:view)." };

  const parsed = z.object({ leadId: z.string().trim().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  const actor = await resolveActor(session.user.id);
  const [canViewPii, cuaSoNgay] = await Promise.all([canViewLeadPii(), layCuaSoGhiCongNgay()]);
  const du = await docChoGanNguon({
    actor,
    leadId: parsed.data.leadId,
    kiemQuyen: (action, target) => checkPermission(action, target),
    canViewPii,
    cuaSoNgay,
    now: new Date(),
  });
  if (!du) return { ok: false, error: "Lead không tồn tại." };
  return { ok: true, du };
}

// ── ReferrerPicker: TÌM người giới thiệu ─────────────────────────────────────────────────────────────────────

/** Bốn khoá cho phép GHI nguồn: tạo lead (form nhập), đổi nguồn trước/sau thu, quản lý nguồn. Thiếu cả bốn ⇒ không có ô nào để tìm cho. */
const KHOA_TIM_NGUOI = ["leads:create", "leads:overwrite", "sources:override-after-payment", "sources:manage"] as const;

const timNguoiSchema = z.object({
  loai: z.enum(["NHAN_SU", "PHU_HUYNH", "DOI_TAC"]),
  q: z.string().max(DO_DAI_TIM_TOI_DA * 2),
});

export async function timNguoiGioiThieuAction(input: unknown): Promise<KetQuaTimNguoi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkAnyPermission(KHOA_TIM_NGUOI))) return { ok: false, error: "Không có quyền chọn nguồn lead." };

  const parsed = timNguoiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  const actor = await resolveActor(session.user.id);
  const canViewPii = await canViewLeadPii();
  const loai: LoaiNguoi = parsed.data.loai;
  const ketQua = await timNguoiGioiThieu(actor, {
    loai,
    q: parsed.data.q,
    gioiHan: 8,
    coTheTimTheoSdt: canViewPii,
    canViewPii,
    now: new Date(),
  });
  return { ok: true, ketQua };
}
