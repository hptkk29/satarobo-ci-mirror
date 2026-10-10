/**
 * lib/nguon/ket-qua-action.ts — KIỂU kết quả của các Server Action tab Nguồn (PR7). THUẦN, chỉ kiểu.
 *
 * Vì sao ở đây mà không `export type` ngay trong tệp action: file `"use server"` CHỈ được export hàm async — loader của Next sinh
 * export GIÁ TRỊ cho mọi export ở đó, nên một `export type` có thể giết cả module action lúc chạy (E352, xem
 * `lib/validators/internal-lead.ts`). Giao diện (client) cũng import kiểu từ đây thay vì từ tệp action.
 *
 * Hình dạng giữ NGUYÊN họ của `doiNguonLeadAction` (PR2): `{ ok: true, … } | { ok: false, error, field? }` — `field` là tên ô để giao
 * diện đặt lỗi CẠNH ô (không phải `ActionResult<T>` của `lib/actions/factory`, vốn dành cho action đi qua pipeline factory).
 */
import type { NguoiDaChon } from "./chon-nguon";
import type { ChoGanNguon } from "./doc-gan-nguon";

export type KetQuaDoiNguonAction =
  | { ok: true; canDieuChinh: boolean }
  | { ok: false; error: string; field?: string };

export type KetQuaMoGanNguon = { ok: true; du: ChoGanNguon } | { ok: false; error: string };

export type KetQuaTimNguoi = { ok: true; ketQua: NguoiDaChon[] } | { ok: false; error: string };

export type KetQuaLuuPageAction = { ok: true; doi: boolean } | { ok: false; error: string; field?: string };

/** Ghi danh mục nguồn (SPEC nguồn động §4). `field` = tên ô để giao diện đặt lỗi CẠNH ô (`code` · `name` · `lyDo` · `vuaDoi` …). */
export type KetQuaTaoNguonAction = { ok: true; id: string; code: string; updatedAt: string; canhBao: string[] } | { ok: false; error: string; field?: string };

export type KetQuaSuaNguonAction = { ok: true; doi: boolean; updatedAt: string; canhBao: string[] } | { ok: false; error: string; field?: string };

export type KetQuaDoiTrangThaiAction =
  | { ok: true; den: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED"; updatedAt: string }
  | { ok: false; error: string; field?: string };

/** Chụp lại chủ nguồn cho lead cũ (W3) — MỘT LÔ mỗi lượt gọi; giao diện lặp theo `conTro` cho tới `hetLead`. */
export type KetQuaChupLaiAction =
  | {
      ok: true;
      daChup: number;
      boQua: number;
      conTro: string | null;
      hetLead: boolean;
      theoLyDo: { THIEU_CHU: number; CHU_NGHI_VIEC: number; CHU_KHONG_CON_HO_SO: number };
    }
  | { ok: false; error: string; field?: string };
