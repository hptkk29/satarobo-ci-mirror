"use server";

// Người ĐƯỢC PHÂN tự quyết (SR.QD.238 · P2/P3b). `userId` lấy từ PHIÊN, không bao giờ từ client; dịch vụ còn kiểm lại
// "đúng người được phân" ngay trong giao dịch (`quyetDinhNhanLop`). Không có quyền RBAC riêng: quyền là QUAN HỆ —
// chỉ chủ phân công mới quyết được phân công đó.
//
// P3b: mỗi lần nhận / từ chối mang PHIÊN BẢN người bấm đang nhìn. Lịch vừa đổi giữa lúc xem và lúc bấm ⇒ dịch vụ từ chối
// mục đó (không "nhận" một nghĩa vụ chưa đọc). "Nhận cả lớp" trả KẾT QUẢ TỪNG MỤC — không im lặng nuốt mục bị từ chối.
import { headers } from "next/headers";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { quyetDinhNhanLop, type ThongBaoPhanCong } from "@/lib/parttime/phan-cong-db";
import { guiThongBaoPhanCong } from "@/lib/parttime/thong-bao";
import { trongGiaoDich } from "@/lib/parttime/thao-tac";

type Res = { ok: true; message: string } | { ok: false; error: string };
export type KetQuaMuc = { assignmentId: string; ok: boolean; loi: string | null };
type ResNhieu = { ok: true; message: string; ketQua: KetQuaMuc[] } | { ok: false; error: string; ketQua: KetQuaMuc[] };
const PATH = "/teacher/phan-cong";

async function nguoiBam() {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, name: session.user.name ?? session.user.email ?? "Giáo viên" };
}

const phienBan = z.number().int().min(1);
const schemaQuyet = z.discriminatedUnion("quyetDinh", [
  z.object({ assignmentId: z.string().min(1), phienBan, quyetDinh: z.literal("ACCEPTED") }),
  z.object({ assignmentId: z.string().min(1), phienBan, quyetDinh: z.literal("DECLINED"), lyDo: z.string().trim().min(5, "Ghi lý do từ chối (tối thiểu 5 ký tự)").max(500) }),
]);

export async function quyetDinhAction(input: unknown): Promise<Res> {
  const ai = await nguoiBam();
  if (!ai) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = schemaQuyet.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const ua = (await headers()).get("user-agent");
  try {
    const r = await trongGiaoDich((tx) =>
      quyetDinhNhanLop(tx, {
        assignmentId: p.data.assignmentId,
        nguoiBam: ai,
        quyetDinh: p.data.quyetDinh,
        phienBanDaXem: p.data.phienBan,
        lyDo: p.data.quyetDinh === "DECLINED" ? p.data.lyDo : null,
        userAgent: ua,
      }),
    );
    if (!r.ok) return { ok: false, error: r.loi };
    await guiThongBaoPhanCong(r.thongBao, ai.id);
    revalidatePath(PATH);
    return { ok: true, message: p.data.quyetDinh === "ACCEPTED" ? "Đã nhận phân công." : "Đã từ chối — quản lý cơ sở sẽ xếp người khác." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được — thử lại." };
  }
}

/** Nhận nhiều buổi một lượt (cả một lớp). Mỗi buổi một giao dịch + phiên bản đã xem riêng; trả kết quả TỪNG MỤC. */
export async function nhanNhieuAction(input: unknown): Promise<ResNhieu> {
  const ai = await nguoiBam();
  if (!ai) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại.", ketQua: [] };
  const p = z.object({ muc: z.array(z.object({ assignmentId: z.string().min(1), phienBan })).min(1).max(100) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ", ketQua: [] };
  const ua = (await headers()).get("user-agent");
  const ketQua: KetQuaMuc[] = [];
  const thongBao: ThongBaoPhanCong[] = [];
  for (const m of p.data.muc) {
    try {
      const r = await trongGiaoDich((tx) =>
        quyetDinhNhanLop(tx, { assignmentId: m.assignmentId, nguoiBam: ai, quyetDinh: "ACCEPTED", phienBanDaXem: m.phienBan, userAgent: ua }),
      );
      if (r.ok) {
        thongBao.push(...r.thongBao);
        ketQua.push({ assignmentId: m.assignmentId, ok: true, loi: null });
      } else ketQua.push({ assignmentId: m.assignmentId, ok: false, loi: r.loi });
    } catch (e) {
      ketQua.push({ assignmentId: m.assignmentId, ok: false, loi: e instanceof Error ? e.message : "lỗi không rõ" });
    }
  }
  await guiThongBaoPhanCong(thongBao, ai.id);
  revalidatePath(PATH);
  const nhan = ketQua.filter((k) => k.ok).length;
  const hong = ketQua.filter((k) => !k.ok);
  if (nhan === 0) return { ok: false, error: hong[0]?.loi ?? "Không nhận được buổi nào.", ketQua };
  return { ok: true, message: hong.length ? `Đã nhận ${nhan} buổi; ${hong.length} buổi chưa nhận được — xem từng dòng.` : `Đã nhận ${nhan} buổi.`, ketQua };
}
