/**
 * Cầu chì ngân sách TOÀN CỤC theo ngày cho DISC (S-04): tổng bài mới và tổng OTP claim. Dùng `rateLimit` (Upstash, rơi về bộ nhớ
 * khi Upstash chết — khi đó trần là theo tiến trình, vẫn là lưới thêm chứ không thay trần DB của `luuKetQuaDisc`).
 * Khoá cố định, không chứa dữ liệu cá nhân. Trả `false` = đã chạm trần ⇒ nơi gọi phải trả thông điệp CHUNG (fail-closed).
 */
import { rateLimit } from "@/lib/rate-limit";
import {
  CUA_SO_TRAN_TOAN_CUC_MS,
  TRAN_BAI_MOI_TOAN_CUC_MAC_DINH,
  TRAN_OTP_CLAIM_TOAN_CUC_MAC_DINH,
  docTranToanCuc,
} from "./chinh-sach";

type Env = Record<string, string | undefined>;

export function tranBaiMoiToanCuc(env: Env = process.env): number {
  return docTranToanCuc(env.DISC_TRAN_BAI_MOI_NGAY, TRAN_BAI_MOI_TOAN_CUC_MAC_DINH);
}
export function tranOtpClaimToanCuc(env: Env = process.env): number {
  return docTranToanCuc(env.DISC_TRAN_OTP_CLAIM_NGAY, TRAN_OTP_CLAIM_TOAN_CUC_MAC_DINH);
}

/** Tiêu MỘT lượt "bài mới" của cầu chì toàn cục. `false` ⇒ hết ngân sách hôm nay. */
export async function choPhepBaiMoiToanCuc(env: Env = process.env): Promise<boolean> {
  const r = await rateLimit({ key: "disc:luu:toan-cuc:ngay", max: tranBaiMoiToanCuc(env), windowMs: CUA_SO_TRAN_TOAN_CUC_MS });
  return r.success;
}

/** Tiêu MỘT lượt "OTP claim" của cầu chì toàn cục. Gọi NGAY TRƯỚC khi thật sự gửi OTP (nhánh có gửi). */
export async function choPhepOtpClaimToanCuc(env: Env = process.env): Promise<boolean> {
  const r = await rateLimit({ key: "disc:otp-claim:toan-cuc:ngay", max: tranOtpClaimToanCuc(env), windowMs: CUA_SO_TRAN_TOAN_CUC_MS });
  return r.success;
}
