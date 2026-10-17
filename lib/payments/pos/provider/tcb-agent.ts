import "server-only";
// lib/payments/pos/provider/tcb-agent.ts — `TcbPortalAgentProvider` (GĐ4 POS). Thiết kế: docs/pos-gd4-thiet-ke.md §6.
//
// Provider DUY NHẤT mà `chonPosProvider` trả (T15 — đảo T12 GĐ1). Chọn chế độ THEO DỮ LIỆU cho từng phiếu:
//   · cơ sở của phiếu KHÔNG có agent đang bật (hoặc máy khai merchant mà không agent nào khớp, hoặc ≥ 2 mà máy không
//     chỉ rõ merchant) ⇒ FILE — y GĐ1, kết quả mang `nguonDuLieu: "SMARTPOS"` (nhãn nguồn theo CHẾ ĐỘ — rà đối kháng
//     RV-09: bản đầu gắn TCB_PORTAL cho giao dịch file của cơ sở không hề có agent);
//   · có agent ⇒ AGENT, theo `cheDo` của LƯỢT (rà đối kháng RV-03 — `choDongBo: boolean` cũ ⇒ BA trạng thái):
//       - SALE (sale bấm): gác SỨC KHOẺ (hết phiên / mất > 3′ / chưa sẵn sàng ⇒ PROVIDER_ERROR `AGENT_<sức khoẻ>` —
//         D9: KHÔNG đổi phiếu, KHÔNG mất mã), rồi tạo `PosCheckJob` và chờ ≤ 8″ agent đồng bộ — NGOÀI mọi
//         transaction/khoá (lưới [POS4-W9]); job chưa xong ⇒ CHỈ tin PAID (T6);
//       - MAY (poller · quét sạch · sau lô agent): KHÔNG job, KHÔNG chờ. Agent SẴN SÀNG ⇒ đọc như thường. Agent KHÔNG
//         sẵn sàng ⇒ dữ liệu đã đồng bộ là dữ liệu CŨ (đúng như T6): CHỈ tin PAID* (tiền đã thấy là thật);
//         FAILED / NOT_FOUND ⇒ PROVIDER_ERROR `AGENT_<sức khoẻ>` — giữ câu D9 "ĐỪNG cho quẹt lại", giữ phiếu trên màn
//         sale (KIND_GIU_TREN_MAN) và chặn HET_HAN (`choPhepHetHan`). Bản đầu đọc thẳng ⇒ poller ghi "Khách huỷ
//         trên máy — cho quẹt lại." đè D9 trong ≤ 1 phút (ca [POS4-RV-03a..c]);
//       - IMPORT (đồng bộ sau import file): dữ liệu MỚI vừa về từ đường dự phòng ⇒ đọc như thường, không gác (T5).
//
// KHÔNG gọi `.checkStatus(` của provider khác (lưới [POS2-W2] — một lời gọi provider duy nhất ở `kiemTraPhieuPos`);
// đọc qua `docKetQuaDaDongBo` dùng chung. KHÔNG ghi tiền (lưới [POS4-W1]); KHÔNG ném (hợp đồng provider).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { nhanCoSo } from "../agent/canh-bao-luat";
import { choJobXong, datJobKiem } from "../agent/job";
import { CHO_JOB_TOI_DA_MS, NHIP_HOI_JOB_MS } from "../agent/hop-dong";
import { chonAgentChoPhieu, chonCheDoNguonPos, sucKhoeAgent } from "../agent/suc-khoe";
import { CUA_SO_LUI_MS, docKetQuaDaDongBo, DUNG_SAI_GIO_MAY_MS } from "./doc-du-lieu";
import type { IntentDeKiem, PosCheckResult, PosProvider } from "./kieu";

/** Trần dòng dấu từ chối đọc một lượt — đủ để biết "có hay không" (bảng nhỏ, chỉ dòng trong cửa sổ phiếu). */
const TRAN_DAU_TU_CHOI = 50;

/**
 * Rà đối kháng bản gộp GĐ3 × GĐ4 (RVG-01) — máy đồng bộ của phiếu có dòng BỊ TỪ CHỐI (dấu nguồn AGENT `tuChoi` ≠ null —
 * lệch hợp đồng `FIELD_TOO_LONG`, hoặc dữ liệu portal lạ `AMOUNT_*` / `BAD_TIME` / …) trong cửa sổ đọc của phiếu mà CHƯA
 * có dòng POS nào cùng mã giao dịch (file / lượt agent sau chưa đưa nó vào sổ dưới dạng đọc được).
 *
 * Vì sao cần: dòng bị từ chối KHÔNG chặn đóng job (chốt hợp đồng 1.1, C1) ⇒ job DONE ⇒ dữ liệu "tươi" nhưng THIẾU đúng
 * dòng đó — mà nó có thể CHÍNH là lần quẹt sale đang hỏi. Mã TRƯỚC: "Chưa thấy giao dịch…" (không câu cấm khi cơ sở đã có
 * giao dịch khác sau lúc tạo phiếu) hoặc "Giao dịch thất bại — cho quẹt lại." (lần 1 thất bại, lần quẹt lại thành công
 * bị từ chối) ⇒ trừ thẻ khách lần hai (ca [POS4-RVG-01], [POS4-RVG-01b]). Extension GĐ5 đã tự chặn đúng lớp lỗi này ở
 * đường "bỏ dòng" (`dong-bo.ts`: lượt có dòng bị bỏ KHÔNG mang jobIds) — đường "máy chủ từ chối dòng" thì chưa ai chặn.
 * Cửa sổ = cửa sổ đọc của `docKetQuaDaDongBo` (lùi 5′ từ lúc tạo phiếu → lúc đọc + 5′); dòng không đọc được giờ ⇒ theo
 * lúc agent thấy LẦN ĐẦU.
 *
 * VIỆC 3 (09/10/2026) — EXPORT + nhận `client` (mặc định `db`, nên chỗ gọi cũ không đổi một chữ): nút "Tôi nhập sai mã"
 * (`sai-ma-doc.ts`) hỏi CÙNG câu này DƯỚI KHOÁ bằng `tx`. Gọi bằng `db` trần từ trong transaction là xin kết nối thứ hai khi
 * đang giữ một kết nối — nhiều lượt cùng lúc là cạn pool và chờ nhau.
 */
export async function coDongTuChoiChuaGiai(
  x: { agentId: string; tu: Date; den: Date },
  client: Pick<Prisma.TransactionClient, "posTxnSource" | "posCardTransaction"> = db,
): Promise<boolean> {
  const tuChoi = await client.posTxnSource.findMany({
    where: {
      nguon: "AGENT",
      posAgentId: x.agentId,
      tuChoi: { not: null },
      OR: [
        { thoiGianGiaoDich: { gte: x.tu, lte: x.den } },
        { thoiGianGiaoDich: null, lanDauThay: { gte: x.tu, lte: x.den } },
      ],
    },
    select: { maGiaoDich: true },
    take: TRAN_DAU_TU_CHOI,
  });
  if (tuChoi.length === 0) return false;
  const daVaoSo = await client.posCardTransaction.count({ where: { maGiaoDich: { in: tuChoi.map((t) => t.maGiaoDich) } } });
  return daVaoSo < tuChoi.length;
}

/** Chế độ của MỘT lượt kiểm (rà đối kháng RV-03). Thêm chế độ ⇒ `tsc` liệt kê mọi chỗ gọi `chonPosProvider`. */
export type CheDoKiemPos = "SALE" | "MAY" | "IMPORT";

export type TuyChonAgentProvider = {
  /** BẮT BUỘC (luật 7): SALE CHỈ ở lượt sale bấm; IMPORT CHỈ ở đồng bộ sau import; lượt máy khác MAY. */
  cheDo: CheDoKiemPos;
  /** Ngủ giữa hai lượt hỏi job — tiêm vào (test không đọc đồng hồ thật — luật 19). */
  ngu: (ms: number) => Promise<void>;
  /** Đồng hồ ĐƠN ĐIỆU (ms) — chỉ đo thời lượng chờ. */
  dongHoDonDieu: () => number;
};

export class TcbPortalAgentProvider implements PosProvider {
  readonly ten = "TCB_AGENT" as const;
  // Nhãn `rawPayload.nguon` MẶC ĐỊNH (chế độ AGENT). Chế độ FILE trả `nguonDuLieu: "SMARTPOS"` trong kết quả và
  // `kiemTraPhieuPos` dùng nhãn đó. Nguồn thật của từng giao dịch nằm ở `PosTxnSource` (T13).
  readonly nguonDuLieu = "TCB_PORTAL" as const;

  constructor(private readonly o: TuyChonAgentProvider) {}

  async checkStatus(intent: IntentDeKiem, now: Date): Promise<PosCheckResult> {
    try {
      const [agents, may] = await Promise.all([
        db.posAgent.findMany({
          where: { centerId: intent.centerId, active: true },
          select: {
            id: true,
            merchantCode: true,
            active: true,
            sessionState: true,
            lastHeartbeatAt: true,
            center: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        intent.posTerminalId
          ? db.posTerminal.findUnique({ where: { id: intent.posTerminalId }, select: { maNhaCungCap: true } })
          : Promise.resolve(null),
      ]);
      const agent = chonAgentChoPhieu({ agentsCuaCoSo: agents, maNhaCungCapCuaMay: may?.maNhaCungCap ?? null });
      if (agent === null || chonCheDoNguonPos(agent) === "FILE") {
        const kqFile = await docKetQuaDaDongBo(intent, now, { cheDo: "FILE" });
        return { ...kqFile, nguonDuLieu: "SMARTPOS" };
      }

      const sk = sucKhoeAgent(agent, now);
      const loiD9: PosCheckResult = { kind: "PROVIDER_ERROR", reasonCode: `AGENT_${sk}`, coSo: nhanCoSo(agent.center).slice(0, 32) };
      const laSale = this.o.cheDo === "SALE";
      if (laSale && sk !== "SAN_SANG") return loiD9;

      const t0 = this.o.dongHoDonDieu();
      let xong = true;
      if (laSale) {
        const job = await datJobKiem({ intent, agentId: agent.id, now });
        xong = await choJobXong(job.id, {
          hanMs: CHO_JOB_TOI_DA_MS,
          nhipMs: NHIP_HOI_JOB_MS,
          ngu: this.o.ngu,
          dongHoDonDieu: this.o.dongHoDonDieu,
        });
      }
      // Đọc SAU khi chờ: mốc đọc = now + thời gian đã chờ (agent có thể vừa đồng bộ giao dịch mới hơn `now`).
      const docLuc = new Date(now.getTime() + Math.max(0, Math.round(this.o.dongHoDonDieu() - t0)));
      const dongBo = await db.posAgent.findUnique({ where: { id: agent.id }, select: { lastSyncedAt: true } });
      const kq = await docKetQuaDaDongBo(intent, docLuc, { cheDo: "AGENT", lastSyncedAt: dongBo?.lastSyncedAt ?? null });
      const chuaKetLuanDuoc = kq.kind === "FAILED" || kq.kind === "NOT_FOUND";
      // T6 — job chưa xong ⇒ dữ liệu chưa tươi: CHỈ tin PAID; FAILED / NOT_FOUND ⇒ "chưa trả lời kịp — ĐỪNG cho
      // quẹt lại" ("Thất bại — cho quẹt lại" lúc này có thể là trừ thẻ khách lần hai). Lỗi DB đi nguyên.
      if (laSale && !xong && chuaKetLuanDuoc) {
        return {
          kind: "NOT_FOUND",
          dongBoChuaXong: true,
          cheDoNguon: "AGENT",
          duLieuCapNhatLuc: kq.duLieuCapNhatLuc ?? null,
          gdMoiNhatLuc: kq.gdMoiNhatLuc ?? null,
        };
      }
      // RV-03 — lượt MÁY khi agent không sẵn sàng: dữ liệu CŨ ⇒ không kết luận thất bại / chưa thấy (giữ D9).
      if (this.o.cheDo === "MAY" && sk !== "SAN_SANG" && chuaKetLuanDuoc) return loiD9;
      // RVG-01 — mọi chế độ của nguồn máy: có dòng BỊ TỪ CHỐI chưa giải trong cửa sổ ⇒ không kết luận "thất bại" /
      // "chưa thấy" (PAID vẫn tin — tiền đã thấy là thật).
      if (
        chuaKetLuanDuoc &&
        (await coDongTuChoiChuaGiai({
          agentId: agent.id,
          tu: new Date(intent.createdAt.getTime() - CUA_SO_LUI_MS),
          den: new Date(docLuc.getTime() + DUNG_SAI_GIO_MAY_MS),
        }))
      ) {
        return {
          kind: "NOT_FOUND",
          dongBiTuChoi: true,
          cheDoNguon: "AGENT",
          duLieuCapNhatLuc: kq.duLieuCapNhatLuc ?? null,
          gdMoiNhatLuc: kq.gdMoiNhatLuc ?? null,
        };
      }
      return kq;
    } catch (err) {
      console.error("[pos-provider:tcb-agent]", err);
      return { kind: "PROVIDER_ERROR", reasonCode: "TCB_AGENT_DB" };
    }
  }
}
