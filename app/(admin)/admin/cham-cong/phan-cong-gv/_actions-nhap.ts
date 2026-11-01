"use server";

// Nhập phân công GV từ Excel — HAI bước, không ghi gì ở bước đầu (đề bài §27: UPLOAD → PARSE → PREVIEW → VALIDATE → CONFIRM → WRITE).
//   · xemTruocNhapAction: đọc tệp → dựng ngữ cảnh theo lô → xét từng dòng → trả bảng kết quả + dấu tệp (sha256).
//   · xacNhanNhapAction: nhận LẠI tệp + dấu đã xem; dấu lệch ⇒ từ chối. Xét LẠI từ đầu trên dữ liệu hiện tại (không tin kế hoạch
//     client gửi), rồi ghi từng dòng qua đúng dịch vụ của màn (`apDungNhap`). Chạy lại cùng tệp ⇒ dòng đã ghi thành KHÔNG ĐỔI.
// Cổng: phiên → `hr_attendance:assign` hỏi TỪNG cơ sở ở server (dòng của cơ sở không có quyền ⇒ LỖI CROSS_CENTER_RBAC, không bỏ
// im lặng) → công tắc STAFFING theo cơ sở (tắt ⇒ STAFFING_OFF). Lõi thuần: `lib/parttime/nhap-phan-cong.ts`.
import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { trangThaiCongTacTai } from "@/lib/parttime/cong-tac";
import { docSheetNhap, xetFileNhap, type DongNhap, type KetQuaDong } from "@/lib/parttime/nhap-phan-cong";
import { apDungNhap, docMoiCoSoId, dungNguCanhNhap, type KetQuaApDung } from "@/lib/parttime/nhap-phan-cong-db";
import { guiThongBaoPhanCong } from "@/lib/parttime/thong-bao";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DONG = 500;

type Res<T> = { ok: true; data: T } | { ok: false; error: string };
export type TongHopNhap = { tong: number; hopLe: number; loi: number; canhBao: number; them: number; capNhat: number; khongDoi: number; canDuyet: number };
export type XemTruocNhap = { dauTep: string; tenTep: string; tongHop: TongHopNhap; dong: KetQuaDong[] };

function tongHop(ds: readonly KetQuaDong[]): TongHopNhap {
  const dem = (k: KetQuaDong["ketQua"]) => ds.filter((d) => d.ketQua === k).length;
  return {
    tong: ds.length,
    hopLe: ds.filter((d) => d.ketQua !== "LOI").length,
    loi: dem("LOI"),
    // Cảnh báo = ghi được nhưng có điều cần để ý (GV mượn cơ sở khác).
    canhBao: ds.filter((d) => d.ketQua === "THEM" && /mượn/.test(d.thongDiep)).length,
    them: dem("THEM"),
    capNhat: dem("HUY"),
    khongDoi: dem("KHONG_DOI"),
    canDuyet: dem("CAN_DUYET"),
  };
}

async function docVaXet(formData: FormData): Promise<Res<{ dauTep: string; tenTep: string; dong: DongNhap[]; ketQua: KetQuaDong[] }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Chưa chọn file .xlsx" };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "Chỉ nhận file .xlsx — dùng file mẫu tải từ màn này." };
  if (file.size > MAX_BYTES) return { ok: false, error: "File quá 2MB — không phải file nhập phân công." };
  const buf = Buffer.from(await file.arrayBuffer());
  const doc = docSheetNhap(buf);
  if (!doc.ok) return { ok: false, error: doc.loi };
  if (doc.dong.length === 0) return { ok: false, error: "Sheet NHAP_PHAN_CONG chưa có dòng nào (điền từ hàng 5)." };
  if (doc.dong.length > MAX_DONG) return { ok: false, error: `Tối đa ${MAX_DONG} dòng một lần nhập.` };

  // Quyền + công tắc hỏi theo TỪNG cơ sở ở server — client không gửi danh sách cơ sở.
  const duocPhan: string[] = [];
  const daBat: string[] = [];
  for (const id of await docMoiCoSoId()) {
    if (!(await checkPermission("hr_attendance:assign", { centerId: id }))) continue;
    duocPhan.push(id);
    if ((await trangThaiCongTacTai("STAFFING", { centerId: id })).dung) daBat.push(id);
  }
  if (duocPhan.length === 0) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở nào." };
  const ngu = await dungNguCanhNhap({ dong: doc.dong, coSoDuocPhan: duocPhan, coSoDaBat: daBat, now: new Date() });
  return { ok: true, data: { dauTep: createHash("sha256").update(buf).digest("hex"), tenTep: file.name, dong: doc.dong, ketQua: xetFileNhap(doc.dong, ngu) } };
}

export async function xemTruocNhapAction(formData: FormData): Promise<Res<XemTruocNhap>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const r = await docVaXet(formData);
  if (!r.ok) return r;
  return { ok: true, data: { dauTep: r.data.dauTep, tenTep: r.data.tenTep, tongHop: tongHop(r.data.ketQua), dong: r.data.ketQua } };
}

const xacNhan = z.object({ dauTep: z.string().regex(/^[0-9a-f]{64}$/) });

export async function xacNhanNhapAction(formData: FormData): Promise<Res<{ tongHop: TongHopNhap; ghi: KetQuaApDung[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = xacNhan.safeParse({ dauTep: formData.get("dauTep") });
  if (!p.success) return { ok: false, error: "Thiếu dấu tệp đã xem trước — xem trước lại." };
  const r = await docVaXet(formData);
  if (!r.ok) return r;
  if (r.data.dauTep !== p.data.dauTep) return { ok: false, error: "Tệp khác tệp đã xem trước — xem trước lại rồi mới xác nhận." };

  const actor = { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" };
  const { ketQua: ghi, thongBao } = await apDungNhap({ ketQua: r.data.ketQua, dong: r.data.dong, actor });
  await guiThongBaoPhanCong(thongBao, actor.id);
  const th = tongHop(r.data.ketQua);
  await writeAudit({
    actor,
    module: "hr_attendance",
    entityType: "SessionStaffAssignment",
    entityId: `import:${r.data.dauTep.slice(0, 16)}`,
    action: "PT_STAFFING_IMPORT_APPLIED",
    newValues: { tenTep: r.data.tenTep, dauTep: r.data.dauTep, tongHop: th, ghiOk: ghi.filter((x) => x.ok).length, ghiLoi: ghi.filter((x) => !x.ok).length },
  });
  revalidatePath("/cham-cong/phan-cong-gv");
  revalidatePath("/cham-cong/phan-cong");
  return { ok: true, data: { tongHop: th, ghi } };
}
