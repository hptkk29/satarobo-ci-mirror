/**
 * lib/hoa-hong/vi-sao-ket-qua.ts — KIỂU kết quả của Server Action mở ngăn "Vì sao con số này". THUẦN, chỉ kiểu.
 *
 * Ở đây thay vì trong tệp `"use server"`: tệp đó CHỈ được export hàm async (xem `lib/nguon/ket-qua-action.ts`), và component client cũng import kiểu từ đây.
 */
import type { ViSaoDayDu } from "./vi-sao-day-du";

export type KetQuaMoViSao = { ok: true; du: ViSaoDayDu } | { ok: false; error: string };
