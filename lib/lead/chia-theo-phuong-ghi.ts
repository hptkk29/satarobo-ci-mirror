import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import type { Actor } from "@/lib/auth/actor";
import { coQuyenTaiCoSo } from "@/lib/auth/quyen-tai-co-so";
import {
  apDungCapNhat,
  apDungCapNhatTheoCoSo,
  BANG_RONG,
  demPhuongDaDat,
  docBangPhuong,
  PROVIDER_PHUONG_CO_SO,
  type BangPhuongCoSo,
  type DongPhuong,
} from "./chia-theo-phuong";

/** Phần ĐỌC-ĐỂ-SỬA và GHI của màn quản trị «Chia theo phường». Đường nóng (mỗi lead mới) ở `chia-theo-phuong-db.ts`. */

/** Cấu hình hiện có để màn quản trị hiện: công tắc + bảng (kể cả khi đang TẮT). Chưa có dòng ⇒ tắt + bảng rỗng. */
export async function layCauHinhPhuongDeSua(): Promise<{ bat: boolean; bang: BangPhuongCoSo }> {
  const dong = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_PHUONG_CO_SO }, select: { isEnabled: true, settings: true } });
  return dong ? { bat: dong.isEnabled, bang: docBangPhuong(dong.settings) } : { bat: false, bang: BANG_RONG };
}

/** Cơ sở ĐƯỢC PHÉP nhận lead mới: đang hoạt động, không phải Hội sở / đơn vị không ghi danh — cùng tập mà `autoAssignNewLead` dùng. */
export async function layCoSoNhanLead(): Promise<{ id: string; name: string }[]> {
  const [tatCa, khong] = await Promise.all([
    db.center.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { displayOrder: "asc" } }),
    getNonEnrollableCenterIds(),
  ]);
  return tatCa.filter((c) => !khong.includes(c.id));
}

/**
 * Cơ sở mà người này cấu hình được phần phường/xã của (Quản lý cơ sở): cơ sở NHẬN LEAD mà họ giữ ĐÚNG khoá `lead_pool:manage` tại đó.
 * Đo bằng quyền GHI từng cơ sở (`coQuyenTaiCoSo`), không bằng tầm nhìn — người kiêm QLCS@CS1 + Sale@CS2 "thấy" CS2 nhưng chỉ quản lý CS1.
 */
export async function coSoCauHinhPhuongCuaToi(actor: Actor): Promise<{ id: string; name: string }[]> {
  return (await layCoSoNhanLead()).filter((c) => coQuyenTaiCoSo(actor, "lead_pool:manage", c.id));
}

export type KetQuaLuuPhuong = { ok: true; bat: boolean; soPhuongDaDat: number } | { ok: false; error: string };

/** Khoá cố vấn: hai người lưu cùng lúc không đè lên nhau (cả bảng nằm trong MỘT cột JSON). */
const KHOA_BANG = "lead-phuong-co-so";

type TruocSau = { bat: boolean; batSau: boolean; bangTruoc: BangPhuongCoSo; bangSau: BangPhuongCoSo };
type KetQuaTinh = { ok: true; bang: BangPhuongCoSo; bat: boolean } | { ok: false; error: string };

/**
 * Đọc-sửa-ghi bảng DƯỚI KHOÁ: `tinh` nhận cấu hình hiện có (đọc SAU khi giữ khoá) và trả bảng mới, hoặc lỗi — khi đó KHÔNG ghi gì.
 * Thiếu khoá thì người lưu sau đè mất thay đổi của người lưu trước (hai Quản lý cơ sở bấm Lưu cùng lúc).
 */
async function capNhatDuoiKhoa(tinh: (hienCo: { bat: boolean; bang: BangPhuongCoSo }) => KetQuaTinh): Promise<{ ok: true; c: TruocSau } | { ok: false; error: string }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${KHOA_BANG}))`;
    const dong = await tx.integrationConfig.findUnique({ where: { provider: PROVIDER_PHUONG_CO_SO }, select: { isEnabled: true, settings: true } });
    const hienCo = dong ? { bat: dong.isEnabled, bang: docBangPhuong(dong.settings) } : { bat: false, bang: BANG_RONG };
    const kq = tinh(hienCo);
    if (!kq.ok) return kq; // từ chối TRƯỚC phép ghi đầu tiên
    await tx.integrationConfig.upsert({
      where: { provider: PROVIDER_PHUONG_CO_SO },
      create: { provider: PROVIDER_PHUONG_CO_SO, isEnabled: kq.bat, settings: kq.bang },
      update: { isEnabled: kq.bat, settings: kq.bang },
    });
    return { ok: true as const, c: { bat: hienCo.bat, batSau: kq.bat, bangTruoc: hienCo.bang, bangSau: kq.bang } };
  });
}

async function ghiVet(p: { actor: AuditActor; action: string; thanhPho: string; c: TruocSau; them?: Record<string, unknown> }): Promise<void> {
  await writeAudit({
    actor: p.actor,
    module: "LEAD",
    entityType: "IntegrationConfig",
    entityId: PROVIDER_PHUONG_CO_SO,
    action: p.action,
    oldValues: { bat: p.c.bat, soPhuongDaDat: demPhuongDaDat(p.c.bangTruoc, p.thanhPho) },
    newValues: { bat: p.c.batSau, soPhuongDaDat: demPhuongDaDat(p.c.bangSau, p.thanhPho), ...(p.them ?? {}) },
    changedFields: [...(p.c.bat !== p.c.batSau ? ["bat"] : []), ...(JSON.stringify(p.c.bangTruoc) !== JSON.stringify(p.c.bangSau) ? ["map"] : [])],
  }).catch(() => undefined); // dấu vết hỏng không làm mất thao tác đã lưu (cùng khuôn các action chia lead khác)
}

/**
 * Lưu công tắc + các dòng «phường → cơ sở» của một thành phố. NGUYÊN KHỐI (xem `apDungCapNhat`) và có dấu vết kiểm toán.
 * Quyền kiểm ở Server Action (đây là lib, không biết người gọi) — đừng gọi hàm này từ chỗ chưa qua cổng quyền.
 */
export async function luuCauHinhPhuong(p: { bat: boolean; thanhPho: string; dong: readonly DongPhuong[]; actor: AuditActor }): Promise<KetQuaLuuPhuong> {
  const hopLe = new Set((await layCoSoNhanLead()).map((c) => c.id));
  const kq = await capNhatDuoiKhoa((hienCo) => {
    const r = apDungCapNhat(hienCo.bang, p.thanhPho, p.dong, hopLe);
    return r.ok ? { ok: true, bang: r.bang, bat: p.bat } : { ok: false, error: r.loi.slice(0, 3).join(" ") };
  });
  if (!kq.ok) return kq;
  await ghiVet({ actor: p.actor, action: "lead.chia-theo-phuong.luu", thanhPho: p.thanhPho, c: kq.c });
  return { ok: true, bat: p.bat, soPhuongDaDat: demPhuongDaDat(kq.c.bangSau, p.thanhPho) };
}

/**
 * QUẢN LÝ CƠ SỞ lưu phần của CƠ SỞ MÌNH (06/11/2026). Chỉ đổi được phường trống hoặc phường của chính cơ sở mình (xem `apDungCapNhatTheoCoSo`);
 * KHÔNG đụng công tắc — bật/tắt chia theo phường là việc của Quản trị, nên `bat` giữ nguyên giá trị hiện có.
 * `coSoCuaToi` do Server Action tính từ quyền GHI thật (`lead_pool:manage` tại từng cơ sở), không lấy từ client.
 */
export async function luuPhuongCuaCoSo(p: { thanhPho: string; dong: readonly DongPhuong[]; coSoCuaToi: readonly string[]; actor: AuditActor }): Promise<KetQuaLuuPhuong> {
  const hopLe = new Set((await layCoSoNhanLead()).map((c) => c.id));
  const cuaToi = new Set(p.coSoCuaToi);
  let soDongDoi = 0;
  const kq = await capNhatDuoiKhoa((hienCo) => {
    const r = apDungCapNhatTheoCoSo(hienCo.bang, p.thanhPho, p.dong, cuaToi, hopLe);
    if (!r.ok) return { ok: false, error: r.loi.slice(0, 3).join(" ") };
    soDongDoi = r.soDongDoi;
    return { ok: true, bang: r.bang, bat: hienCo.bat };
  });
  if (!kq.ok) return kq;
  if (soDongDoi > 0) await ghiVet({ actor: p.actor, action: "lead.chia-theo-phuong.luu-co-so", thanhPho: p.thanhPho, c: kq.c, them: { coSo: [...cuaToi].sort(), soDongDoi } });
  return { ok: true, bat: kq.c.batSau, soPhuongDaDat: demPhuongDaDat(kq.c.bangSau, p.thanhPho) };
}
