import "server-only";
// lib/chatbot/khoa-api.ts — API KEY Anthropic của chatbot website: quản trị dán trên màn Cấu hình vận hành
// (chủ dự án chốt 06/11/2026: "để admin hệ thống tự sửa, không cần dev").
//
// Không phá Nền #9 ("secret chỉ trong env"): DB chỉ giữ BẢN MÃ HOÁ (AES-256-GCM, `lib/security/hop-bi-mat.ts`
// — cùng phương án (b) chủ dự án duyệt 03/11 cho mật khẩu hoá đơn điện tử); KHOÁ GỐC vẫn ở env
// (`HOA_DON_KHOA_BI_MAT`, đọc qua `docKhoaBiMat`). Mục đích HKDF riêng (`chatbot.anthropic`) ⇒ khoá dẫn xuất
// không dùng chéo được với mật khẩu hoá đơn dù chung khoá gốc. Thiếu khoá gốc ⇒ không lưu được (fail-closed),
// không bao giờ rơi về lưu thô. Không log giá trị key ở bất cứ đâu.

import { db } from "@/lib/db";
import { docKhoaBiMat } from "@/lib/finance/hoa-don/ket-noi/khoa-bi-mat";
import { giaiMaBiMat, maHoaBiMat } from "@/lib/security/hop-bi-mat";

export const PROVIDER_KHOA_CHATBOT = "ANTHROPIC_CHATBOT";
const MUC_DICH = "chatbot.anthropic";
const NGU_CANH = `integration:${PROVIDER_KHOA_CHATBOT}`;

type LuuTru = { banMa: string; duoi: string; capNhatLuc: string; capNhatBoi: string };

export type TrangThaiKhoa =
  | { coKhoa: false; luuDuoc: boolean; lyDoKhongLuuDuoc: string | null }
  | { coKhoa: true; luuDuoc: boolean; lyDoKhongLuuDuoc: string | null; duoi: string; capNhatLuc: string; capNhatBoi: string };

function docLuuTru(settings: unknown): LuuTru | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  return typeof s.banMa === "string" && typeof s.duoi === "string"
    ? { banMa: s.banMa, duoi: s.duoi, capNhatLuc: String(s.capNhatLuc ?? ""), capNhatBoi: String(s.capNhatBoi ?? "") }
    : null;
}

/** Hình dạng một API key Anthropic: `sk-ant-…`, không khoảng trắng. Chỉ chặn dán nhầm — Anthropic mới là nơi xác thực. */
export function laKhoaHopLe(khoa: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(khoa);
}

/** Cho màn quản trị: có key chưa + 4 ký tự cuối. KHÔNG bao giờ trả bản rõ hay bản mã. */
export async function docTrangThaiKhoa(): Promise<TrangThaiKhoa> {
  const kb = docKhoaBiMat();
  const luuDuoc = kb.ok;
  const lyDoKhongLuuDuoc = kb.ok ? null : kb.lyDo;
  const dong = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_KHOA_CHATBOT }, select: { settings: true } });
  const lt = docLuuTru(dong?.settings);
  return lt
    ? { coKhoa: true, luuDuoc, lyDoKhongLuuDuoc, duoi: lt.duoi, capNhatLuc: lt.capNhatLuc, capNhatBoi: lt.capNhatBoi }
    : { coKhoa: false, luuDuoc, lyDoKhongLuuDuoc };
}

/** API key ở dạng rõ để gọi Anthropic, hoặc `null` (chưa khai / không giải mã được — chatbot coi như tắt). */
export async function layKhoaApi(): Promise<string | null> {
  const kb = docKhoaBiMat();
  if (!kb.ok) return null;
  const dong = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_KHOA_CHATBOT }, select: { settings: true } });
  const lt = docLuuTru(dong?.settings);
  if (!lt) return null;
  try {
    return giaiMaBiMat(lt.banMa, { cacKhoaGoc: kb.cacKhoa, mucDich: MUC_DICH, nguCanh: NGU_CANH });
  } catch {
    return null;
  }
}

export type KetQuaLuu = { ok: true } | { ok: false; loi: string };

/** Mã hoá rồi lưu. Người gọi (server action) đã kiểm quyền + ghi nhật ký. */
export async function luuKhoaApi(khoa: string, nguoiCapNhat: string, luc: Date): Promise<KetQuaLuu> {
  const k = khoa.trim();
  if (!laKhoaHopLe(k)) return { ok: false, loi: "Key không đúng dạng — key Anthropic bắt đầu bằng sk-ant-" };
  const kb = docKhoaBiMat();
  if (!kb.ok) return { ok: false, loi: kb.lyDo };
  const luuTru: LuuTru = {
    banMa: maHoaBiMat(k, { khoaGoc: kb.hienHanh, mucDich: MUC_DICH, nguCanh: NGU_CANH }),
    duoi: k.slice(-4),
    capNhatLuc: luc.toISOString(),
    capNhatBoi: nguoiCapNhat,
  };
  await db.integrationConfig.upsert({
    where: { provider: PROVIDER_KHOA_CHATBOT },
    create: { provider: PROVIDER_KHOA_CHATBOT, isEnabled: true, settings: luuTru },
    update: { isEnabled: true, settings: luuTru },
  });
  return { ok: true };
}

/** Gỡ key (chatbot tự tắt). */
export async function xoaKhoaApi(): Promise<void> {
  await db.integrationConfig.deleteMany({ where: { provider: PROVIDER_KHOA_CHATBOT } });
}
