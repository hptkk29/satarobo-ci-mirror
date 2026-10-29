"use server";

// Thao tác giao / gỡ của màn Phân công GỘP (GĐ2, docs/phan-cong-gop/KHAO-SAT.md chốt 1, 6). Mỗi action:
//   auth → `hr_attendance:assign` Ở ĐÚNG CƠ SỞ (buổi: tra từ DB; trực: cơ sở trên form) → công tắc STAFFING tại cơ sở đó → người
//   được giao phải là giáo viên của cơ sở mình quản lý → dịch vụ `lib/phan-cong/giao-go-db.ts` trong MỘT giao dịch → thông báo SAU
//   commit → revalidate. `homNay` do MÁY CHỦ tính (giờ VN) — không nhận từ client.
// Không có bước "chờ nhận": giao là có hiệu lực (chốt 1).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { congThaoTacParttime } from "@/lib/parttime/cong-tac";
import { guiThongBaoPhanCong } from "@/lib/parttime/thong-bao";
import { coSoCuaNguon, trongGiaoDich } from "@/lib/parttime/thao-tac";
import { loadModuleScope } from "@/lib/cham-cong/module-scope";
import { laGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { vnYmd } from "@/lib/time/vn";
import { datNguoiVaoBuoi, datTruc, LoiGiaoGo, type KetQuaGiaoGo } from "@/lib/phan-cong/giao-go-db";
import { apKhung, thuHaiCua } from "@/lib/phan-cong/ap-khung-db";

type Res = { ok: true; message: string; boQua: { ngay: string; lyDo: string }[] } | { ok: false; error: string };

const ASSIGN = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong";
const CHUA_BAT = "Phân công theo buổi chưa bật ở cơ sở này — màn chỉ xem. Quản trị bật ở Cấu hình vận hành → Chấm công.";
const phamVi = z.enum(["CHI_BUOI_NAY", "CAC_TUAN_SAU"]);
const lyDo = z.string().trim().max(300).optional();

async function cong(centerId: string | null): Promise<{ ok: true; actor: { id: string; name: string } } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!centerId) return { ok: false, error: "Không tìm thấy buổi / cơ sở." };
  if (!(await checkPermission(ASSIGN, { centerId }))) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở này." };
  const ct = await congThaoTacParttime("STAFFING", { centerId }, CHUA_BAT);
  if (!ct.ok) return { ok: false, error: ct.error };
  return { ok: true, actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" } };
}

/** Cùng luật với `phanCongAction`: người được giao là GV của cơ sở buổi hoặc của cơ sở người thao tác quản lý (điều chuyển). */
async function kiemNguoi(userId: string, centerId: string, actorId: string): Promise<boolean> {
  const quanLy = (await loadModuleScope(actorId)).blocksWith(ASSIGN).map((b) => b.id);
  return laGiaoVienCuaCoSo(userId, [centerId, ...quanLy]);
}

async function chay(fn: Parameters<typeof trongGiaoDich<KetQuaGiaoGo>>[0], actorId: string, viec: string): Promise<Res> {
  try {
    const kq = await trongGiaoDich(fn);
    await guiThongBaoPhanCong(kq.thongBao, actorId);
    revalidatePath(BASE);
    const message = kq.soNgay === 0 ? `Không ${viec} được buổi nào.` : `Đã ${viec} ${kq.soNgay} buổi.`;
    return { ok: true, message: kq.boQua.length ? `${message} Bỏ qua ${kq.boQua.length} ngày.` : message, boQua: kq.boQua };
  } catch (e) {
    if (e instanceof LoiGiaoGo) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Không thực hiện được — thử lại." };
  }
}

/** Giao / thay / gỡ giáo viên đứng chính hoặc trợ giảng của một buổi (và các tuần sau). */
export async function datNguoiAction(input: unknown): Promise<Res> {
  const p = z
    .object({
      sourceType: z.enum(["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]),
      sourceId: z.string().min(1),
      role: z.enum(["MAIN_TEACHER", "TEACHING_ASSISTANT"]),
      userId: z.string().min(1).nullable(),
      boUserId: z.string().min(1).nullable(),
      phamVi,
      lyDo,
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const nguon = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const centerId = await coSoCuaNguon(nguon);
  const g = await cong(centerId);
  if (!g.ok) return g;
  if (p.data.userId && !(await kiemNguoi(p.data.userId, centerId!, g.actor.id))) {
    return { ok: false, error: "Người này không phải giáo viên của cơ sở bạn quản lý — chọn người trong danh sách." };
  }
  const homNay = vnYmd(new Date());
  return chay(
    (tx) =>
      datNguoiVaoBuoi(tx, {
        nguon,
        role: p.data.role,
        userId: p.data.userId,
        boUserId: p.data.boUserId,
        phamVi: p.data.phamVi,
        homNay,
        lyDo: p.data.lyDo || "Giao trên màn Phân công",
        nguonGiao: "TAY",
        actor: g.actor,
      }),
    g.actor.id,
    p.data.userId ? "giao" : "gỡ",
  );
}

/** Giao / gỡ ca trực (và các tuần sau). */
export async function datTrucAction(input: unknown): Promise<Res> {
  const p = z
    .object({
      centerId: z.string().min(1),
      userId: z.string().min(1),
      ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      shiftCode: z.string().min(1).max(10),
      giao: z.boolean(),
      phamVi,
      lyDo,
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(p.data.centerId);
  if (!g.ok) return g;
  if (p.data.giao && !(await kiemNguoi(p.data.userId, p.data.centerId, g.actor.id))) {
    return { ok: false, error: "Người này không phải giáo viên của cơ sở bạn quản lý — chọn người trong danh sách." };
  }
  const homNay = vnYmd(new Date());
  return chay(
    (tx) => datTruc(tx, { ...p.data, homNay, lyDo: p.data.lyDo || (p.data.giao ? "Giao trực trên màn Phân công" : "Gỡ trực trên màn Phân công"), actor: g.actor }),
    g.actor.id,
    p.data.giao ? "giao trực" : "gỡ trực",
  );
}

type ResApKhung =
  | {
      ok: true;
      message: string;
      xemTruoc: boolean;
      soBuoc: { giaoTruc: number; goTruc: number; datNguoi: number };
      boQuaNgay: number;
      xungDot: { ngay: string; userId: string; lyDo: string }[];
      tuan: { thuHai: string; soBuoc: number; ms: number }[];
    }
  | { ok: false; error: string };

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/**
 * ÁP KHUNG LỊCH (GĐ4): chép tuần mẫu sang khoảng ngày đích. `ghiThat: false` = xem trước (chạy thật rồi quay lui — không để lại dòng
 * nào); `true` = ghi. Cùng cổng với giao / gỡ. `homNay` do máy chủ tính.
 */
export async function apKhungAction(input: unknown): Promise<ResApKhung> {
  const ngay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const p = z
    .object({
      centerId: z.string().min(1),
      tuanMau: ngay,
      tu: ngay,
      den: ngay,
      cheDo: z.enum(["BO_SUNG", "GHI_DE"]),
      giaoVien: z.array(z.string().min(1)).max(200).nullable(),
      ghiThat: z.boolean(),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(p.data.centerId);
  if (!g.ok) return g;
  const homNay = vnYmd(new Date());
  try {
    const kq = await apKhung({ ...p.data, tuanMau: thuHaiCua(p.data.tuanMau), homNay, actor: g.actor });
    const soBuoc = {
      giaoTruc: kq.buoc.filter((b) => b.loai === "GIAO_TRUC").length,
      goTruc: kq.buoc.filter((b) => b.loai === "GO_TRUC").length,
      datNguoi: kq.buoc.filter((b) => b.loai === "DAT_NGUOI").length,
    };
    // Tuần đã commit thì báo người được giao + làm mới màn — kể cả khi tuần sau lỗi (mỗi tuần một giao dịch).
    if (!kq.xemTruoc && kq.tuan.length > 0) {
      await guiThongBaoPhanCong(kq.thongBao, g.actor.id);
      revalidatePath(BASE);
    }
    if (kq.loi) {
      const da = kq.loi.daApToi ? `${kq.xemTruoc ? "Xem trước chạy được" : "Đã áp"} tới hết tuần ${dm(kq.loi.daApToi)} (${kq.tuan.length} tuần). ` : "Chưa áp được tuần nào. ";
      return { ok: false, error: `${da}Dừng ở tuần ${dm(kq.loi.thuHai)}: ${kq.loi.thongDiep}` };
    }
    const tong = soBuoc.giaoTruc + soBuoc.goTruc + soBuoc.datNguoi;
    return {
      ok: true,
      xemTruoc: kq.xemTruoc,
      soBuoc,
      boQuaNgay: kq.boQuaNgay.length,
      xungDot: kq.xungDot.map(({ ngay: n, userId, lyDo: l }) => ({ ngay: n, userId, lyDo: l })),
      tuan: kq.tuan,
      message: kq.xemTruoc ? `Xem trước: ${tong} thay đổi — chưa ghi gì.` : `Đã áp khung: ${tong} thay đổi.`,
    };
  } catch (e) {
    if (e instanceof LoiGiaoGo) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Không áp được khung — thử lại." };
  }
}
