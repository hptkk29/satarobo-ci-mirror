// lib/payments/pos/provider/chon.ts — chọn provider cho phiếu thu thẻ (GĐ1 POS; GĐ4 đảo T12 GĐ1).
//
// GĐ4 (T15): LUÔN `TcbPortalAgentProvider` — provider đó tự chọn chế độ FILE / AGENT THEO DỮ LIỆU cho từng phiếu
// (cơ sở có PosAgent đang bật ⇒ agent; không ⇒ đọc dữ liệu đã import, y GĐ1). Vẫn KHÔNG SystemSetting chọn provider —
// một công tắc chưa nối vào đâu là cờ chết (bài học `PAYMENT_LEDGER_V2`).
//
// `cheDo` BẮT BUỘC (luật 7 — `tsc` liệt kê chỗ gọi; rà đối kháng RV-03 thay `choDongBo: boolean`): `SALE` CHỈ ở lượt
// sale bấm Kiểm tra (gác sức khoẻ + job + chờ ≤ 8″); `IMPORT` CHỈ ở đồng bộ sau import file (dữ liệu dự phòng vừa về —
// đọc như thường, T5); mọi lượt máy khác (poller · quét sạch · sau lô agent) `MAY` (agent không sẵn sàng ⇒ chỉ tin
// PAID, giữ D9). Lưới [POS4-W4].
import type { PosProvider } from "./kieu";
import { TcbPortalAgentProvider, type CheDoKiemPos } from "./tcb-agent";

const nguThat = (ms: number) => new Promise<void>((xong) => setTimeout(xong, ms));

export function chonPosProvider(x: { cheDo: CheDoKiemPos }): PosProvider {
  return new TcbPortalAgentProvider({ cheDo: x.cheDo, ngu: nguThat, dongHoDonDieu: () => performance.now() });
}
