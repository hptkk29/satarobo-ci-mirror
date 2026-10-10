// lib/hoa-hong/khieu-nai-hanh-dong.ts — ĐIỀU PHỐI các thao tác ghi của khiếu nại: tạo · nhận/giao lại · quyết định · đóng.
// Server Action (`app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions.ts`) CHỈ làm: auth → quyền → gọi các hàm này → revalidate.
//
// Vì sao tách ra `lib/`: Server Action phải gọi `auth()`/`revalidatePath` nên khó chạy dưới test; điều đáng canh (map lỗi về ô, thông báo chỉ gửi SAU commit
// và CHỈ khi thành công, engine tắt ⇒ từ chối) nằm ở đây và chạy được trên Postgres thật. Cùng khuôn `chinh-sach-hanh-dong.ts`.
//
// ⚠️ KHÔNG kiểm QUYỀN HÀNH ĐỘNG (`commission:view-self` · `commission_disputes:review`) — đó là việc của Server Action ngay đầu hàm. Service bên dưới kiểm LẠI
// bằng `can()` và tự gác phạm vi + quan hệ + danh tính. Mọi hàm nhận `now` BẮT BUỘC (luật 19).
import type { Actor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { db } from "@/lib/db";

import { dungBoiCanhQuet } from "./boi-canh";
import type { LoiTruong } from "./khieu-nai-dau-vao";
import { baoKetQuaKhieuNai, baoKhieuNaiMoi } from "./khieu-nai-gui-thong-bao";
import { dongKhieuNaiDoiNguon, nhanKhieuNai, quyetDinhKhieuNai, taoKhieuNai, type NguoiKhieuNai } from "./khieu-nai";
import type { KetQuaKhieuNai } from "./khieu-nai-trang-thai";
import { HoaHongError } from "./kieu";

export type KetQuaHanhDong<T extends object = object> = ({ ok: true } & T) | { ok: false; loi: LoiTruong[]; chung: string | null };

type NguoiThaoTac = { id: string; ten: string };
const nguoiTu = (actor: Actor, n: NguoiThaoTac): NguoiKhieuNai => ({ userId: n.id, ten: n.ten, quyen: actor });
const thatBai = (chung: string | null, loi: LoiTruong[] = []): { ok: false; loi: LoiTruong[]; chung: string | null } => ({ ok: false, loi, chung });

/** Lỗi nghiệp vụ → câu trả lời cho người dùng. Lỗi KHÔNG lường trước thì ghi log và trả câu chung (không lộ chi tiết kỹ thuật ra màn hình). */
function anhXaLoi(e: unknown): { ok: false; loi: LoiTruong[]; chung: string | null } {
  if (e instanceof HoaHongError) {
    if (e.ma === "DU_LIEU_KHONG_HOP_LE" && Array.isArray(e.chiTiet)) return thatBai(null, e.chiTiet as LoiTruong[]);
    return thatBai(e.message);
  }
  if (e instanceof PermissionError) return thatBai("Bạn không có quyền thực hiện thao tác này.");
  console.error("[khieu-nai] lỗi không lường trước:", e);
  return thatBai("Không xử lý được yêu cầu — thử lại sau. Nếu lỗi lặp lại, báo bộ phận kỹ thuật.");
}

const ENGINE_TAT = "Tính năng hoa hồng theo nguồn đang tắt hoặc chưa có mốc chuyển đổi — chưa xử lý được khiếu nại.";

export async function hanhDongTao(i: { actor: Actor; nguoi: NguoiThaoTac; dauVao: unknown }): Promise<KetQuaHanhDong<{ disputeId: string }>> {
  try {
    const r = await taoKhieuNai(db, { nguoi: nguoiTu(i.actor, i.nguoi), dauVao: i.dauVao });
    // SAU commit: báo người duyệt. `await` để không bỏ lại promise mồ côi; lỗi gửi đã được nuốt trong hàm gửi (tin là việc phụ).
    await baoKhieuNaiMoi({ disputeId: r.disputeId, centerId: r.centerId, raisedByUserId: i.nguoi.id, ky: r.ky, laKhoanThu: r.dich.loai === "KHOAN" });
    return { ok: true, disputeId: r.disputeId };
  } catch (e) {
    return anhXaLoi(e);
  }
}

export async function hanhDongNhan(i: { actor: Actor; nguoi: NguoiThaoTac; disputeId: string; nguoiNhanId?: string | null; now: Date }): Promise<KetQuaHanhDong<{ disputeId: string; nguoiXuLyId: string }>> {
  try {
    const r = await nhanKhieuNai(db, { disputeId: i.disputeId, nguoi: nguoiTu(i.actor, i.nguoi), nguoiNhanId: i.nguoiNhanId ?? null, now: i.now });
    return { ok: true, disputeId: r.disputeId, nguoiXuLyId: r.nguoiXuLyId };
  } catch (e) {
    return anhXaLoi(e);
  }
}

export async function hanhDongQuyet(i: { actor: Actor; nguoi: NguoiThaoTac; disputeId: string; dauVao: unknown; now: Date }): Promise<KetQuaHanhDong<{ disputeId: string; loai: string }>> {
  try {
    const bc = await dungBoiCanhQuet(db, i.now);
    if (bc.loai === "TAT") return thatBai(ENGINE_TAT);
    const r = await quyetDinhKhieuNai(db, bc.bc, { disputeId: i.disputeId, nguoi: nguoiTu(i.actor, i.nguoi), dauVao: i.dauVao });
    const lyDo = ((i.dauVao ?? {}) as { lyDo?: unknown }).lyDo;
    const ketQua: KetQuaKhieuNai = r.loai === "DA_TU_CHOI" ? "TU_CHOI" : r.loai === "DA_DUYET_DOI_NGUON" ? "DUOC_DUYET_DOI_NGUON" : "DUOC_DUYET_DIEU_CHINH_TIEN";
    await baoKetQuaKhieuNai({ disputeId: r.disputeId, raisedByUserId: r.raisedByUserId, ketQua, lyDoQuyetDinh: typeof lyDo === "string" ? lyDo : "" });
    return { ok: true, disputeId: r.disputeId, loai: r.loai };
  } catch (e) {
    return anhXaLoi(e);
  }
}

export async function hanhDongDong(i: { actor: Actor; nguoi: NguoiThaoTac; disputeId: string; now: Date }): Promise<KetQuaHanhDong<{ disputeId: string }>> {
  try {
    const r = await dongKhieuNaiDoiNguon(db, { disputeId: i.disputeId, nguoi: nguoiTu(i.actor, i.nguoi), now: i.now });
    return { ok: true, disputeId: r.disputeId };
  } catch (e) {
    return anhXaLoi(e);
  }
}
