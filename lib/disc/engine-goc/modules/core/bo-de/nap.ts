// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/bo-de/nap.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NẠP BỘ ĐỀ — cửa duy nhất để phần còn lại của ứng dụng lấy câu hỏi.
 *
 * Ghép hai file cấu hình lại: nội dung câu (`disc-cau-hoi.ts`) và thứ tự hiển thị đã
 * chốt cứng (`disc-thu-tu.ts`). Không nơi nào khác được đọc thẳng hai file đó — nếu
 * không, sẽ có chỗ hiển thị theo thứ tự trong bảng, tức là bốn câu cùng trục nằm liền
 * nhau và người làm đọc ra ngay bài đang đo gì.
 *
 * Thuộc TẦNG LÕI (ADR-004): không React, không DOM.
 */

import { NGAN_HANG, PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";

import { MA_BO_DE, type BoDe, type CauHoi, type MaBoDe } from "./kieu";

export { PHIEN_BAN_BO_DE };

export class LoiBoDe extends Error {
  constructor(thongDiep: string) {
    super(thongDiep);
    this.name = "LoiBoDe";
  }
}

export function laMaBoDe(giaTri: unknown): giaTri is MaBoDe {
  return typeof giaTri === "string" && (MA_BO_DE as readonly string[]).includes(giaTri);
}

const boNho = new Map<MaBoDe, BoDe>();

/**
 * Trả về bộ đề với `cau` đã xếp theo ĐÚNG THỨ TỰ HIỂN THỊ.
 *
 * Ném `LoiBoDe` khi mã sai — cố ý ném thay vì trả `undefined`: một bộ đề thiếu sẽ thành
 * `undefined.cau` ở tận nơi khác, và lúc đó không ai đọc ra nguyên nhân.
 */
export function napBoDe(ma: MaBoDe): BoDe {
  const daCo = boNho.get(ma);
  if (daCo) return daCo;

  const goc = NGAN_HANG[ma];
  if (!goc) throw new LoiBoDe(`Không có bộ đề mã "${ma}" trong ngân hàng câu hỏi.`);

  const thuTu = THU_TU[ma];
  if (!thuTu) throw new LoiBoDe(`Bộ đề "${ma}" chưa có thứ tự hiển thị. Chạy: node scripts/sinh-thu-tu.mjs`);

  const theoMa = new Map<string, CauHoi>(goc.cau.map((c) => [c.ma, c]));
  const cau: CauHoi[] = [];
  for (const maCau of thuTu) {
    const c = theoMa.get(maCau);
    if (!c) {
      throw new LoiBoDe(
        `Thứ tự hiển thị của bộ "${ma}" trỏ tới câu "${maCau}" không có trong ngân hàng. ` +
          `Ngân hàng vừa đổi mà chưa chạy lại: node scripts/sinh-thu-tu.mjs`,
      );
    }
    cau.push(c);
  }
  if (cau.length !== goc.cau.length) {
    throw new LoiBoDe(
      `Bộ "${ma}": thứ tự hiển thị có ${cau.length} câu nhưng ngân hàng có ${goc.cau.length}.`,
    );
  }

  const ketQua: BoDe = { ...goc, cau };
  boNho.set(ma, ketQua);
  return ketQua;
}

/** Dùng ở biên (URL, localStorage): mã lạ thì trả `null`, không ném. */
export function napBoDeAnToan(giaTri: unknown): BoDe | null {
  return laMaBoDe(giaTri) ? napBoDe(giaTri) : null;
}

export function danhSachBoDe(): readonly BoDe[] {
  return MA_BO_DE.map(napBoDe);
}

/** Tra một câu theo mã, tìm trong mọi bộ. Dùng cho vùng lệch (soi gương). */
export function timCau(maCau: string): { boDe: MaBoDe; cau: CauHoi } | null {
  for (const ma of MA_BO_DE) {
    const c = NGAN_HANG[ma].cau.find((x) => x.ma === maCau);
    if (c) return { boDe: ma, cau: c };
  }
  return null;
}
