// lib/payments/pos/agent/tinh-hinh.ts — "TÌNH HÌNH CHUNG" của màn Sức khoẻ POS Agent (đợt /impeccable 07/10/2026). THUẦN.
//
// Người mở màn là Kế toán HO / Quản trị tối cao vừa nhận chuông `pos.agent-*` hoặc sale báo "Tạm mất kết nối
// Techcombank". Câu đầu tiên họ cần trả lời là "cơ sở NÀO đang chết, và làm gì" — trước bản này thẻ xếp theo ngày tạo
// máy, nên CS2 hết phiên vẫn đứng sau CS1 đang khoẻ và phải đọc từng thẻ mới biết.
//
// Trạng thái từng máy vẫn suy từ MỘT chỗ — `trangThaiThe` (cùng ngưỡng gác sale D9); file này chỉ XẾP và ĐẾM, không
// đặt ngưỡng mới.
import type { PosAgentSessionState } from "@prisma/client";
import { canBaoSang } from "./canh-bao-luat";
import { luc, trangThaiThe, type TheTrangThai, type Tone } from "./hien-thi";

type DauVao = Parameters<typeof trangThaiThe>[0] & { id: string };

/** Mức khẩn: 0 hỏng (đỏ) · 1 phải làm sớm (vàng — gồm "đang làm việc nhưng phiên hết hạn trước 21:00") · 2 chưa cài · 3 khoẻ · 4 đã tắt. */
type Muc = 0 | 1 | 2 | 3 | 4;

function mucCua(active: boolean, tt: TheTrangThai): Muc {
  if (!active) return 4;
  if (tt.tone === "danger") return 0;
  if (tt.lamGi !== null && tt.tone !== "muted") return 1;
  if (tt.lamGi !== null) return 2;
  return 3;
}

const TONE_MUC: Record<Muc, Tone> = { 0: "danger", 1: "warning", 2: "muted", 3: "success", 4: "muted" };

export type TheXep<T extends DauVao> = { a: T; tt: TheTrangThai; muc: Muc; tone: Tone };

/** Máy hỏng lên đầu, máy tắt xuống cuối; cùng mức ⇒ theo tên cơ sở rồi id (thứ tự ổn định giữa hai lượt tải). */
export function xepTheoMucKhan<T extends DauVao>(agents: readonly T[], now: Date): TheXep<T>[] {
  return agents
    .map((a) => {
      const tt = trangThaiThe(a, now);
      const muc = mucCua(a.active, tt);
      // Tone của THẺ giữ nguyên (`tt.tone`); tone ở đây là tone của DÒNG trong tóm tắt — "đang làm việc" mà phiên hết
      // hạn trước 21:00 là việc vàng, không phải xanh.
      return { a, tt, muc, tone: muc === 3 ? tt.tone : TONE_MUC[muc] };
    })
    .sort((x, y) => x.muc - y.muc || x.a.coSo.localeCompare(y.a.coSo, "vi") || x.a.id.localeCompare(y.a.id));
}

export type TinhHinh = {
  tone: "danger" | "warning" | "muted" | "success";
  tieuDe: string;
  /** Dòng phụ (máy đã tắt) — null khi không có gì để nói thêm. */
  phu: string | null;
  /** Máy ĐANG BẬT có việc phải làm, theo thứ tự khẩn. */
  canXuLy: { id: string; coSo: string; nhan: string; tone: Tone; lamGi: string }[];
};

/** Một dòng tóm tắt cho đầu khu "Máy POS Agent". Không có máy ⇒ null (trạng thái rỗng tự nói). */
export function tinhHinhChung<T extends DauVao>(xep: readonly TheXep<T>[]): TinhHinh | null {
  if (xep.length === 0) return null;
  const bat = xep.filter((x) => x.muc !== 4);
  const tat = xep.length - bat.length;
  const canXuLy = bat
    .filter((x) => x.tt.lamGi !== null)
    .map((x) => ({ id: x.a.id, coSo: x.a.coSo, nhan: x.tt.nhan, tone: x.tone, lamGi: x.tt.lamGi! }));
  const mucCao = Math.min(...bat.map((x) => x.muc)) as Muc;
  const tone: TinhHinh["tone"] =
    bat.length === 0 ? "muted" : mucCao === 0 ? "danger" : mucCao === 1 ? "warning" : mucCao === 2 ? "muted" : "success";
  const tieuDe =
    bat.length === 0
      ? "Mọi POS Agent đang tắt"
      : canXuLy.length > 0
        ? `${canXuLy.length}/${bat.length} POS Agent cần xử lý`
        : `${bat.length}/${bat.length} POS Agent đang làm việc`;
  const phu = tat > 0 && bat.length > 0 ? `${tat} máy đã tắt — cơ sở đó đọc file nhập tay` : null;
  return { tone, tieuDe, phu, canXuLy };
}

export type DongPhien = { chu: string; phu: string | null; tone: "danger" | "warning" | null };

/**
 * Ô "Phiên portal" của thẻ. Trước bản này ô in `Hết phiên · hết hạn 08:15 08/10` — một phiên ĐÃ chết kèm một mốc
 * hết hạn ở TƯƠNG LAI (mốc token cũ còn lưu), hai vế nói ngược nhau (luật 12). Hết phiên ⇒ nói lúc hết; còn sống ⇒
 * nói hạn, và nói thẳng khi mốc hạn đã qua mà POS Agent chưa báo lại.
 */
export function dongPhien(
  a: { sessionState: PosAgentSessionState; sessionDoiLuc: Date | null; sessionExpiresAt: Date | null },
  now: Date,
): DongPhien {
  if (a.sessionState === "EXPIRED") {
    return { chu: "Hết phiên", phu: a.sessionDoiLuc ? `từ ${luc(a.sessionDoiLuc, now)}` : null, tone: "danger" };
  }
  if (a.sessionState === "UNKNOWN") return { chu: "Chưa rõ", phu: null, tone: null };
  const exp = a.sessionExpiresAt;
  if (exp === null) return { chu: "Sống", phu: "chưa rõ hạn", tone: null };
  if (exp.getTime() <= now.getTime()) {
    return { chu: "Sống", phu: `mốc hạn đã qua lúc ${luc(exp, now)} — chờ POS Agent báo lại`, tone: "warning" };
  }
  return { chu: "Sống", phu: `hết hạn ${luc(exp, now)}`, tone: canBaoSang(exp, now) ? "warning" : null };
}
