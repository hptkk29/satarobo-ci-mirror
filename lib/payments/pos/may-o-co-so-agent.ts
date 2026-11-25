// lib/payments/pos/may-o-co-so-agent.ts — dòng trạng thái POS Agent cạnh MỖI máy ở màn Cơ sở (Việc 2, V34). THUẦN.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §2.3. Đặc tả: "nếu đã có hàm đọc trạng thái agent theo máy/merchant, in một dòng
// trạng thái cạnh mỗi máy; không có sẵn thì bỏ qua, KHÔNG dựng mới". Hàm ĐỌC có sẵn (`docSucKhoeAgent`) và hai hàm dựng CHỮ có
// sẵn (`trangThaiThe`, `dongPhien`) — đúng những gì màn Sức khoẻ POS Agent dùng, nên màn Cơ sở và màn đó không thể nói khác nhau.
// Phần DUY NHẤT mới ở đây là phép GHÉP máy → agent.
//
// ── GHÉP CHẶT, KHÔNG DỰ PHÒNG ────────────────────────────────────────────────────────────────────────────────────
// Một máy chỉ được in trạng thái của một agent khi giao dịch của máy QUY ĐƯỢC về agent đó: CÙNG cơ sở, CÙNG merchant
// (`chuanMa`) và máy có `maQuay` — đúng điều kiện `mayKhaiDu` (`suc-khoe-doc.ts`) / `phanGiaiMay` (`may.ts`) dùng để gán cơ sở
// cho dòng agent gửi về.
//
// Cố ý KHÔNG dùng `chonAgentChoPhieu`: hàm đó có nhánh dự phòng "máy chưa khai merchant ⇒ agent đang bật DUY NHẤT của cơ sở" —
// ĐÚNG cho việc chọn nguồn đọc của một phiếu thẻ, nhưng in "Đang làm việc" cạnh một máy mà dòng agent gửi về sẽ KHÔNG quy
// được về nó (thiếu merchant/quầy ⇒ "Thiết bị chưa gán cơ sở") là nói dối. Ca `[HN2-MP-A05]` đặt hai hàm cạnh nhau.
import { trangThaiThe } from "./agent/hien-thi";
import { chuanMa } from "./agent/may";
import { dongPhien } from "./agent/tinh-hinh";
import type { DongAgentMay } from "./may-o-co-so";

/** Phần của một máy mà phép ghép cần. */
export type MayChoDongAgent = {
  centerId: string;
  active: boolean;
  maNhaCungCap: string | null;
  maQuay: string | null;
};

/** Phần của một agent mà phép ghép + hai hàm dựng chữ cần. `TheAgent` (`suc-khoe-doc.ts`) thoả cấu trúc này. */
export type AgentChoMay = Parameters<typeof trangThaiThe>[0] & {
  id: string;
  centerId: string;
  merchantCode: string;
};

/**
 * `null` = không có gì để nói: máy đã tắt (không còn được khớp giao dịch), hoặc cơ sở này chưa có POS Agent nào (không có gì để
 * khớp — đừng báo "chưa khớp" cho một cơ sở chưa dùng agent). `agentsCuaCoSo` do người gọi lọc theo cơ sở; hàm vẫn tự loại
 * agent của cơ sở khác (phòng thủ chiều sâu — agent của cơ sở khác không bao giờ được ghép, dù trùng merchant).
 */
export function dongAgentCuaMay(
  may: MayChoDongAgent,
  agentsCuaCoSo: readonly AgentChoMay[],
  now: Date,
): DongAgentMay | null {
  if (!may.active) return null;
  const agents = agentsCuaCoSo.filter((a) => a.centerId === may.centerId);
  if (agents.length === 0) return null;

  const merchant = chuanMa(may.maNhaCungCap);
  const quay = chuanMa(may.maQuay);

  if (merchant !== "" && quay !== "") {
    const khop = agents.find((a) => chuanMa(a.merchantCode) === merchant);
    if (khop) {
      const tt = trangThaiThe(khop, now);
      // Agent TẮT: phiên cũ còn lưu là dữ liệu cũ — in "Sống · hết hạn …" cạnh nhãn "Đã tắt" là hai vế nói ngược nhau.
      if (!khop.active) {
        return { kieu: "KHOP", agentId: khop.id, nhan: tt.nhan, tone: tt.tone, phien: "", phienTone: null };
      }
      const ph = dongPhien(khop, now);
      return {
        kieu: "KHOP",
        agentId: khop.id,
        nhan: tt.nhan,
        tone: tt.tone,
        phien: ph.phu ? `${ph.chu} · ${ph.phu}` : ph.chu,
        phienTone: ph.tone,
      };
    }
    return {
      kieu: "CHUA_KHOP",
      cau: `POS Agent chưa khớp máy này — cơ sở này chưa có POS Agent nào mang merchant ${merchant}.`,
    };
  }

  const thieu = [merchant === "" ? "mã nhà cung cấp" : null, quay === "" ? "mã quầy" : null].filter(
    (x): x is string => x !== null,
  );
  return { kieu: "CHUA_KHOP", cau: `POS Agent chưa khớp máy này — máy thiếu ${thieu.join(" và ")}.` };
}
