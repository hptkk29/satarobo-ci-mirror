import "server-only";
// lib/payments/pos/agent/nhan-giao-dich.ts — NHẬN một lô giao dịch của máy đồng bộ (GĐ4 POS). Thiết kế §5.1 + phụ lục
// "RÀ ĐỐI KHÁNG" (07/10/2026).
//
//   ① schema strict (route) ② lô final:true gom các lô final:false ĐÃ XẾP CHỜ của cùng lượt (RV-04) ③ trùng mã ⇒
//   giữ dòng SAU ④ chuẩn hoá từng dòng (THUẦN — `chuanHoaDongAgent`) ⑤ đọc MỘT lần (dòng đã có · dấu nguồn AGENT ·
//   ứng viên gốc VOID) ⑥ SỞ HỮU (RV-01): dòng đã có / dấu nguồn thuộc máy · cơ sở · merchant khác ⇒ MERCHANT_MISMATCH
//   ⑦ lô final:false ⇒ ghi dấu từ chối + XẾP CHỜ dòng nhận, DỪNG ⑧ gốc VOID (T9, chỉ ứng viên của chính agent) +
//   điền gốc cho VOID ĐÃ LƯU khi PAYMENT tới sau ⑨ băm ⇒ bỏ dòng KHÔNG ĐỔI (T11) ⑩ trạng thái "treo" trên giao dịch
//   đã có ⇒ KHÔNG đi lõi (RV-07) ⑪ trộn null (T12) ⑫ CHÍNH `nhapLoPos` nhánh AGENT (T1) ⑬ cột hậu kết toán + dấu
//   nguồn ⑭ sự kiện SYNC / ERROR ⑮ final: job DONE + lastSyncedAt ⑯ kiểm lại phiếu liên quan
//   (`dongBoPhieuPosSauAgent`, nguồn AGENT) ⑰ dấu nguồn của dòng mang TÍN HIỆU HỦY — chỉ khi ⑯ đã kiểm xong phiếu của
//   tín hiệu đó (RV-05).
//
// Gộp GĐ3 × GĐ4 (07/10/2026): mọi luật DÒNG của GĐ3 sống trong thân lõi ⑫ nên áp cho lô agent (ô trống không xoá
// cột kết toán · dòng đã ghi nhận chỉ đổi cột kết toán · tín hiệu hủy đã lưu đơn điệu · "Tự khớp" = chính lượt chia
// tiền); LỆCH của dòng đã ghi nhận do lõi gom ⇒ tệp này báo (audit `POS_AGENT_LECH_DA_GHI_NHAN` + `lech` trong SYNC).
//
// ⚠️ MỘT ĐƯỜNG TIỀN (lưới [POS4-W1]): tệp này KHÔNG gọi `thuTheoPhieuGop(` / `allocateToOrder(` / không ghi
// `bankTransaction` / `payment` — tiền chỉ qua `nhapLoPos(` (đúng MỘT lời gọi). Agent và file hội tụ vào CÙNG một
// `PosCardTransaction` / `BankTransaction{CARD_POS}` / bộ `Payment` cho mỗi `transaction_id`.
// KHÔNG `$transaction` bọc cả lô (như `nhapLoPos`): khoá nằm trong `thuTheoPhieuGop`; một dòng lỗi chỉ dòng đó
// vào `errors` (không dấu nguồn ⇒ lượt sau xử lý lại). Dấu nguồn là CHẨN ĐOÁN — lỗi ghi dấu KHÔNG làm hỏng lô
// (RV-02, khuôn nhánh FILE của `nhapLoPos`).
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import type { DongPos } from "../kieu";
import { nhapLoPos } from "../nhap-lo-pos";
import { demGiaoDichLech, lechDaGhiNhan, type LechDong } from "../lech-da-ghi-nhan";
import { anhTuDong, ghiNguonThay, type DongNguon } from "../nguon-thay";
import { laLoaiThanhToan, laTrangThaiThanhCong, maTrangThaiPos } from "../phan-loai-pos";
import { tachMaPos } from "../tach-ma-pos";
import { dongBoPhieuPosSauAgent } from "../dong-bo-sau-agent";
import { bamDong, type DongDaChuanHoa } from "./bam";
import { chuanHoaDongAgent, tronVoiDongDaCo, type AnhTuChoi, type CotTron, type MaTuChoi } from "./chuan-hoa";
import { ganGocVoid, thanhToanCuaHuyKhongDoc, type UngVienGoc } from "./goc-void";
import { TRAN_DONG_AGENT } from "./hop-dong";
import { danhDauJobXong, mocCuaSoDen } from "./job";
import { chuanMa, type MayPos } from "./may";
import { docNextPollMs } from "./nhip-doc";
import { dongAgentSchema, type DongAgentTho, type ThanLoGiaoDich } from "./schema";
import { ghiLoiGop, ghiSuKien } from "./su-kien";
import { baoLoiAgent } from "./canh-bao";
import { nhanCoSo } from "./canh-bao-luat";
import type { AgentDaXacThuc } from "./agent-chon";

export type KetQuaNhanLo = {
  received: number;
  unchanged: number;
  created: number;
  updated: number;
  matched: number;
  needsReview: number;
  ignored: number;
  /** RV-04 — lô `final:false`: số dòng NHẬN đã xếp chờ (xử lý ở lô final của CÙNG lượt). Lô final: 0. */
  staged: number;
  /** `field` CHỈ với `FIELD_TOO_LONG` (chốt hợp đồng 1.1 — tên khoá §6.1 vượt trần). */
  rejected: { index: number; transaction_id: string | null; code: MaTuChoi; field?: string }[];
  errors: { index: number; transaction_id: string; code: "PROCESSING_ERROR" }[];
  jobsDone: number;
  nextPollMs: number;
  serverTime: number;
};

/**
 * Cột của dòng POS đã có mà tầng nhận lô cần: trộn null (T12) + ứng viên gốc VOID + sở hữu (RV-01) + treo (RV-07).
 * KHÔNG đọc Mã hạch toán / Phí: trộn null thôi trộn hai cột đó (gộp GĐ3, G9) — đọc ảnh chụp của chúng ở đây chính là
 * nguồn của lần ghi đè lượt song song (`[POS4-G3-06]`).
 * Rà đối kháng bản gộp: `soTien` · `trangThai` · trạng thái giao dịch — báo LỆCH cho dòng treo đã ghi nhận (RVG-03);
 * `matchReason` — nối lý do khi bật cảnh báo cho dòng hủy/hoàn không đọc được (RVG-02b). Không cột nào trong số đó bị
 * tầng này GHI lại từ ảnh chụp (khác Mã hạch toán / Phí — G9).
 */
const CHON_DA_CO = {
  maGiaoDich: true,
  loaiGiaoDich: true,
  thoiGianGiaoDich: true,
  maChuanChi: true,
  maGiaoDichThe: true,
  maGiaoDichGoc: true,
  trangThaiHoanHuy: true,
  maDonHang: true,
  maQuay: true,
  maThietBi: true,
  soTheMasked: true,
  loaiThe: true,
  dienGiai: true,
  hinhThuc: true,
  centerId: true,
  bankTransactionId: true,
  soTien: true,
  trangThai: true,
  matchReason: true,
  bankTransaction: { select: { status: true } },
} as const;

/** Dòng ĐÃ CÓ — phần luật sở hữu đọc. */
type DongCoChu = { centerId: string | null; maThietBi: string | null; maQuay: string | null };

/** `index` = vị trí trong lô HIỆN TẠI; `null` = dòng tới từ lô final:false đã xếp chờ (không báo theo vị trí). */
type Vao = { index: number | null; row: DongAgentTho };
type DongNhan = { index: number | null; ma: string; dong: DongDaChuanHoa; may: MayPos | null; bam: string; quay: string | null };
/** `rrn` — `card_transaction_id` ĐÃ GỬI (trim) khi ≤ trần hợp đồng; vượt / trống ⇒ null (không ghép theo mã cắt cụt). */
type DongTuChoiDau = {
  index: number | null;
  ma: string;
  code: MaTuChoi;
  anh: AnhTuChoi;
  quay: string | null;
  rrn: string | null;
  field?: string;
};
type TuChoi = { index: number | null; transaction_id: string | null; code: MaTuChoi; field?: string };

/** Nối lý do mới vào lý do cũ, không lặp (khuôn `noiLyDo` của lõi). */
function noiLyDo(cu: string | null, moi: string): string {
  if (!cu) return moi;
  return cu.includes(moi) ? cu : `${cu} · ${moi}`;
}

/** Dòng xếp chờ — đọc lại qua CHÍNH schema strict của route (không tin JSON trong DB hơn tin request). */
const loChoSchema = z.array(dongAgentSchema);

/**
 * R9 — tín hiệu hủy/hoàn BỊ TỪ CHỐI (không đọc được) mà bước ⑥b dùng để GIỮ LẠI thanh toán cùng RRN. Lô `final:false`
 * lưu chúng cùng lô chờ (cột `huyTuChoi`) để lô FINAL của lượt — nơi PAYMENT đã xếp chờ ở lô KHÁC được xử lý — biết
 * VOID đã bị từ chối. CHỈ những gì phép ghép cần: không số thẻ, không ghi chú, không token.
 */
type HuyCanXet = { ma: string; code: string; rrn: string | null; quay: string | null; thoiGian: Date | null };
const huyChoSchema = z.array(
  z.object({
    ma: z.string().min(1),
    code: z.string().min(1),
    rrn: z.string().min(1).nullable(),
    quay: z.string().nullable(),
    gio: z.string().nullable(),
  }),
);

/** Ảnh chụp dòng BỊ TỪ CHỐI cho bảng nguồn — chỉ những gì đọc được. */
function dauTuChoi(t: DongTuChoiDau, centerIdAgent: string): DongNguon {
  return {
    maGiaoDich: t.ma,
    bam: t.anh.bam,
    anh: {
      loaiGiaoDich: t.anh.loaiGiaoDich,
      trangThai: t.anh.trangThai,
      soTien: t.anh.soTien,
      thoiGianGiaoDich: t.anh.thoiGian,
      bamDienGiai: t.anh.bamDienGiai,
      trangThaiHoanHuy: null,
      maHachToan: null,
      phiGiaoDich: null,
      maKetToan: null,
      maThietBi: t.anh.maThietBi,
      maQuay: t.anh.maQuay,
    },
    tuChoi: t.code,
    // T25 — theo MÁY; không suy được máy ⇒ cơ sở của agent (agent chỉ đọc merchant của cơ sở mình).
    centerId: t.anh.centerIdMay ?? centerIdAgent,
  };
}

/** Dấu nguồn là chẩn đoán (T13): lỗi ghi ⇒ log, KHÔNG làm hỏng lô (RV-02); thiếu dấu ⇒ lượt sau xử lý lại. */
async function ghiDauAnToan(agent: AgentDaXacThuc, dong: DongNguon[], now: Date): Promise<void> {
  if (dong.length === 0) return;
  try {
    await ghiNguonThay({ nguon: "AGENT", posAgentId: agent.id, importBatchId: null, dong, now });
  } catch (err) {
    console.error(`[pos-agent] ghi dấu nguồn AGENT lỗi (agent ${agent.id}):`, err);
  }
}

/** Trạng thái đã chuẩn hoá là "Thành công" hoặc "Thất bại" RÕ RÀNG (không phải mã ghép "treo" của T7). */
function trangThaiRoRang(trangThai: string): boolean {
  return laTrangThaiThanhCong(trangThai) || maTrangThaiPos(trangThai) === "THAT_BAI";
}

export async function nhanGiaoDichAgent(x: {
  agent: AgentDaXacThuc;
  than: ThanLoGiaoDich;
  now: Date;
  /** BẮT BUỘC (luật 19) — mỗi phiếu kiểm lại sau lô một mốc mới. */
  dongHo: () => Date;
}): Promise<KetQuaNhanLo> {
  const { agent, than, now } = x;
  const kq: KetQuaNhanLo = {
    received: than.transactions.length,
    unchanged: 0,
    created: 0,
    updated: 0,
    matched: 0,
    needsReview: 0,
    ignored: 0,
    staged: 0,
    rejected: [],
    errors: [],
    jobsDone: 0,
    nextPollMs: 0,
    serverTime: now.getTime(),
  };
  const merchantAgent = chuanMa(agent.merchantCode);

  // MỌI máy (bảng nhỏ) — kể cả đang TẮT: luật sở hữu đọc máy của dòng ĐÃ CÓ. `phanGiaiMay` tự chỉ nhận máy đang bật.
  const danhSachMay: MayPos[] = await db.posTerminal.findMany({
    select: { maThietBi: true, maQuay: true, maNhaCungCap: true, maCuaHang: true, active: true, centerId: true },
  });
  const mayTheoMa = new Map(danhSachMay.map((m) => [m.maThietBi.trim(), m]));

  // ② RV-04 — lô final:true: các lô final:false của CÙNG lượt đã xếp chờ đi TRƯỚC (cả lượt = MỘT file ⇒ cặp
  // PAYMENT + VOID rơi vào hai lô vẫn thấy nhau). Thiếu lô nào (0..batchIndex−1) ⇒ `loThieu`: vẫn ghi phần đã có
  // (lõi idempotent) nhưng KHÔNG đóng job / đẩy lastSyncedAt — lượt sau của agent gửi lại cả cửa sổ.
  const vao: Vao[] = than.transactions.map((row, index) => ({ index, row }));
  let loThieu = false;
  /** R9 — dòng hủy/hoàn bị từ chối ở các lô `final:false` ĐÃ XẾP CHỜ của cùng lượt. */
  const huyTruoc: HuyCanXet[] = [];
  if (than.final) {
    const cho = await db.posAgentLoCho.findMany({
      where: { agentId: agent.id, syncId: than.syncId, batchIndex: { lt: than.batchIndex } },
      orderBy: { batchIndex: "asc" },
      select: { batchIndex: true, dong: true, huyTuChoi: true },
    });
    loThieu = cho.length !== than.batchIndex || cho.some((c, i) => c.batchIndex !== i);
    const truoc: Vao[] = [];
    for (const c of cho) {
      const r = loChoSchema.safeParse(c.dong);
      if (r.success) for (const row of r.data) truoc.push({ index: null, row });
      else loThieu = true;
      if (c.huyTuChoi === null) continue; // lô chờ trước bản vá R9 / lô không có dòng hủy bị từ chối
      const h = huyChoSchema.safeParse(c.huyTuChoi);
      if (!h.success) {
        loThieu = true;
        continue;
      }
      for (const x of h.data) {
        const gio = x.gio === null ? null : new Date(x.gio);
        huyTruoc.push({ ma: x.ma, code: x.code, rrn: x.rrn, quay: x.quay, thoiGian: gio !== null && !Number.isNaN(gio.getTime()) ? gio : null });
      }
    }
    vao.unshift(...truoc);
  }

  // ③ + ④ — chuẩn hoá; trùng mã ⇒ dòng xuất hiện SAU thắng (lô hiện tại thắng lô đã xếp chờ).
  const theoMa = new Map<string, DongNhan>();
  const tuChoiTheoMa = new Map<string, DongTuChoiDau>();
  const tuChoiKhongDau: TuChoi[] = [];
  for (const { index, row } of vao) {
    const k = chuanHoaDongAgent(row, { merchantCode: agent.merchantCode, danhSachMay });
    const quay = row.terminal_code?.trim() || null;
    if (k.loai === "NHAN") {
      tuChoiTheoMa.delete(k.dong.d.maGiaoDich);
      theoMa.set(k.dong.d.maGiaoDich, { index, ma: k.dong.d.maGiaoDich, dong: k.dong, may: k.may, bam: "", quay });
    } else if (k.luuDau && k.maGiaoDich && k.anh) {
      theoMa.delete(k.maGiaoDich);
      const rrnGui = row.card_transaction_id?.trim() || null;
      const rrn = rrnGui !== null && rrnGui.length <= TRAN_DONG_AGENT.card_transaction_id ? rrnGui : null;
      tuChoiTheoMa.set(k.maGiaoDich, {
        index,
        ma: k.maGiaoDich,
        code: k.code,
        anh: k.anh,
        quay,
        rrn,
        ...(k.field ? { field: k.field } : {}),
      });
    } else {
      // T29 — MERCHANT_MISMATCH / BAD_TRANSACTION_ID: không lưu gì của dòng. Mã vọng lại do tầng chuẩn hoá quyết
      // (chốt 1.1: mã dài hơn trần ⇒ null — không vọng chuỗi tuỳ ý dài; [POS4-HD-04]).
      tuChoiKhongDau.push({ index, transaction_id: k.maGiaoDich, code: k.code });
    }
  }

  // ⑤ — dòng đã có · ứng viên gốc theo RRN · dấu nguồn AGENT (kèm agent đã đóng dấu — luật sở hữu).
  const maCoDau = [...theoMa.keys(), ...tuChoiTheoMa.keys()];
  // RRN của dòng nhận (ứng viên gốc VOID) ∪ của dòng BỊ TỪ CHỐI (ghép với thanh toán nó có thể hủy — RVG-02, ⑥b).
  const rrnCuaLo = [
    ...new Set(
      [...[...theoMa.values()].map((r) => r.dong.d.maGiaoDichThe?.trim() ?? ""), ...[...tuChoiTheoMa.values()].map((t) => t.rrn ?? "")].filter(
        (v) => v !== "",
      ),
    ),
  ];
  const [daCoRows, theoRrnRows] = await Promise.all([
    maCoDau.length ? db.posCardTransaction.findMany({ where: { maGiaoDich: { in: maCoDau } }, select: CHON_DA_CO }) : Promise.resolve([]),
    rrnCuaLo.length
      ? db.posCardTransaction.findMany({ where: { maGiaoDichThe: { in: rrnCuaLo } }, select: { ...CHON_DA_CO, id: true } })
      : Promise.resolve([]),
  ]);
  const maCanDau = [...new Set([...maCoDau, ...theoRrnRows.map((r) => r.maGiaoDich)])];
  const dauRows = maCanDau.length
    ? await db.posTxnSource.findMany({
        where: { nguon: "AGENT", maGiaoDich: { in: maCanDau } },
        select: { maGiaoDich: true, bam: true, posAgent: { select: { centerId: true, merchantCode: true } } },
      })
    : [];
  const daCo = new Map(daCoRows.map((r) => [r.maGiaoDich, r]));
  const dauTheoMa = new Map(dauRows.map((r) => [r.maGiaoDich, r]));

  // ⑥ RV-01 — SỞ HỮU. T29 ("merchant khác ⇒ không lưu gì") chỉ soát trường TỰ KHAI `merchant_code`; một bí mật lộ
  // là ghi chéo được dòng ĐÃ CÓ của cơ sở khác theo `transaction_id` (trộn null thừa hưởng máy của họ ⇒ Q-E cho
  // qua). Dòng chỉ thuộc agent khi: dấu nguồn AGENT (nếu có) là của agent CÙNG cơ sở + merchant; dòng đã có (nếu
  // có) không mang cơ sở khác, máy của nó (nếu có) là máy của CÙNG cơ sở + merchant, và quầy không mâu thuẫn quầy
  // agent khai. Không thuộc ⇒ MERCHANT_MISMATCH, KHÔNG lưu gì (như T29).
  const dauCuaAgentKhac = (ma: string): boolean => {
    const a = dauTheoMa.get(ma)?.posAgent;
    return !!a && (a.centerId !== agent.centerId || chuanMa(a.merchantCode) !== merchantAgent);
  };
  const dongThuocAgent = (cu: DongCoChu, quayKhai: string | null): boolean => {
    if (cu.centerId !== null && cu.centerId !== agent.centerId) return false;
    const tb = (cu.maThietBi ?? "").trim();
    if (tb !== "") {
      const m = mayTheoMa.get(tb);
      if (!m || m.centerId !== agent.centerId || chuanMa(m.maNhaCungCap) !== merchantAgent) return false;
    }
    if (quayKhai !== null && chuanMa(cu.maQuay) !== "" && chuanMa(cu.maQuay) !== chuanMa(quayKhai)) return false;
    return true;
  };
  const thuocAgent = (ma: string, quayKhai: string | null): boolean => {
    if (dauCuaAgentKhac(ma)) return false;
    const cu = daCo.get(ma);
    return !cu || dongThuocAgent(cu, quayKhai);
  };
  for (const [ma, r] of [...theoMa.entries()]) {
    if (thuocAgent(ma, r.quay)) continue;
    theoMa.delete(ma);
    tuChoiKhongDau.push({ index: r.index, transaction_id: ma, code: "MERCHANT_MISMATCH" });
  }
  for (const [ma, t] of [...tuChoiTheoMa.entries()]) {
    if (thuocAgent(ma, t.quay)) continue;
    tuChoiTheoMa.delete(ma);
    tuChoiKhongDau.push({ index: t.index, transaction_id: ma, code: "MERCHANT_MISMATCH" });
  }
  const nhan = [...theoMa.values()];
  const bamCu = new Map(dauRows.map((r) => [r.maGiaoDich, r.bam]));
  const tuChoiMoi = [...tuChoiTheoMa.values()].filter((t) => bamCu.get(t.ma) !== t.anh.bam);
  const tatCaTuChoi: TuChoi[] = [
    ...tuChoiKhongDau,
    ...tuChoiMoi.map((t) => ({ index: t.index, transaction_id: t.ma, code: t.code, ...(t.field ? { field: t.field } : {}) })),
  ];
  kq.rejected = tatCaTuChoi
    .filter((r): r is TuChoi & { index: number } => r.index !== null)
    .sort((a, b) => a.index - b.index);
  const ghiLoiTuChoi = async () => {
    for (const ma of new Set(tatCaTuChoi.map((r) => r.code))) {
      const { moi } = await ghiLoiGop({ agent, ma, detail: { lo: tatCaTuChoi.filter((r) => r.code === ma).length }, now });
      // Chốt hợp đồng 1.1: FIELD_TOO_LONG = extension LỆCH hợp đồng (agent đúng hợp đồng làm vừa trần trước khi gửi) ⇒
      // MÁY CHỦ báo admin MỘT chuông / cơ sở / ngày ngay khi thấy — không chờ extension tự báo: `/status ERROR` cùng mã
      // rơi vào CÙNG dòng gộp (`moi = false`) nên không rung lần hai, và extension cũ có thể không báo ([POS4-CHOT-05]).
      // Mã từ chối vì DỮ LIỆU portal (BAD_TIME, AMOUNT_*…) giữ như cũ: chỉ sự kiện. Chuông là chẩn đoán — lỗi gửi chuông
      // KHÔNG làm hỏng lô (khuôn `ghiDauAnToan`).
      if (moi && ma === "FIELD_TOO_LONG") {
        await baoLoiAgent({ centerId: agent.centerId, coSo: nhanCoSo(agent.center), ma, now }).catch((err: unknown) =>
          console.error(`[pos-agent] chuông FIELD_TOO_LONG lỗi (agent ${agent.id}):`, err),
        );
      }
    }
  };

  // Ứng viên THANH TOÁN cho dòng hủy/hoàn (⑥b + ⑧): PAYMENT trong lô ∪ PAYMENT đã lưu CỦA CHÍNH agent (RV-01).
  const rrnCuaAgent = theoRrnRows.filter((r) => !dauCuaAgentKhac(r.maGiaoDich) && dongThuocAgent(r, null));
  const luuTheoMa = new Map(rrnCuaAgent.map((r) => [r.maGiaoDich, r]));
  const ungVien: UngVienGoc[] = [
    ...nhan.map((r) => ({
      maGiaoDich: r.ma,
      maGiaoDichThe: r.dong.d.maGiaoDichThe,
      maQuay: r.dong.d.maQuay,
      thoiGian: new Date(r.dong.d.thoiGian),
      laThanhToan: laLoaiThanhToan(r.dong.d.loaiGiaoDich),
    })),
    ...rrnCuaAgent.map((r) => ({
      maGiaoDich: r.maGiaoDich,
      maGiaoDichThe: r.maGiaoDichThe,
      maQuay: r.maQuay,
      thoiGian: r.thoiGianGiaoDich,
      laThanhToan: laLoaiThanhToan(r.loaiGiaoDich),
    })),
  ];

  // ⑥b Rà đối kháng bản gộp (RVG-02) — dòng KHÔNG phải thanh toán (VOID / REFUND / loại lạ hoặc không đọc được loại)
  // BỊ TỪ CHỐI = tín hiệu hủy/hoàn KHÔNG đọc được. Thanh toán cùng RRN (+ quầy) mà nó có thể hủy:
  //   · đang trong lượt này ⇒ GIỮ LẠI — không đi lõi (không tự ghi tiền), không xếp chờ, không dấu nguồn ⇒ lượt sau xét
  //     lại; dòng hủy đọc được (hoặc file nhập cặp) thì cặp về đúng chỗ như file. Mã TRƯỚC: thanh toán đi lõi một mình
  //     ⇒ THU ⇒ Payment + phiếu "Đã thu" cho lần quẹt ĐÃ HỦY trên máy (ca [POS4-RVG-02]); file thì không bao giờ như vậy
  //     (một dòng hỏng ⇒ từ chối CẢ file);
  //   · đã ghi nhận từ trước (giao dịch MATCHED) ⇒ CẢNH BÁO kế toán trên dòng gốc (D7 — không tự đảo tiền), MỘT lần cho
  //     mỗi dòng hủy: phép ghi CÓ ĐIỀU KIỆN "lý do chưa nhắc mã dòng hủy" (khuôn `xetDongHuy` của lõi) ⇒ agent gửi lại y
  //     hệt không mở lại cảnh báo kế toán đã đóng. Mã TRƯỚC: không ai được báo (ca [POS4-RVG-02b]).
  // Sale bấm Kiểm tra trong lúc đó ⇒ provider thấy dòng bị từ chối trong cửa sổ ⇒ "không đọc được — ĐỪNG cho quẹt lại".
  // Tín hiệu hủy bị từ chối: của lô HIỆN TẠI ∪ của các lô final:false đã xếp chờ (cột `huyTuChoi` — R9: cặp rơi hai lô) —
  // xem docs/pos-gd4-thiet-ke.md Phụ lục RVG + R9.
  // R9 — tín hiệu hủy bị từ chối = của lô HIỆN TẠI ∪ của các lô final:false ĐÃ XẾP CHỜ (cặp rơi hai lô). Dòng cùng mã được
  // NHẬN ở lô hiện tại thì dòng SAU thắng (như bước ③ + ④) ⇒ không còn tín hiệu; được nhận ở lô chờ (không rõ trước/sau) ⇒
  // GIỮ tín hiệu (an toàn: giữ thanh toán một lượt rồi lượt sau xét lại, còn hơn ghi tiền cho lần quẹt đã hủy).
  const huyHienTai: HuyCanXet[] = [...tuChoiTheoMa.values()]
    .filter((h) => !laLoaiThanhToan(h.anh.loaiGiaoDich))
    .map((h) => ({ ma: h.ma, code: h.code, rrn: h.rrn, quay: h.quay, thoiGian: h.anh.thoiGian }));
  const huyCanXet: HuyCanXet[] = [
    ...huyHienTai,
    ...huyTruoc.filter((h) => !tuChoiTheoMa.has(h.ma) && (theoMa.get(h.ma)?.index ?? null) === null),
  ];
  const giuLai = new Set<string>();
  for (const h of huyCanXet) {
    const ds = thanhToanCuaHuyKhongDoc({
      huy: { maGiaoDichThe: h.rrn, maQuay: h.quay, thoiGian: h.thoiGian },
      ungVien: ungVien.filter((u) => u.maGiaoDich !== h.ma),
    });
    for (const ma of ds) {
      if (theoMa.has(ma)) giuLai.add(ma);
      const cu = daCo.get(ma) ?? luuTheoMa.get(ma);
      if (cu === undefined || cu.bankTransaction?.status !== "MATCHED") continue;
      const lyDo = `Có dòng hủy/hoàn sau khi đã ghi nhận mà POS Agent không đọc được (${h.ma}, ${h.code}) — kiểm với Techcombank`;
      await db.posCardTransaction.updateMany({
        where: { maGiaoDich: ma, OR: [{ matchReason: null }, { NOT: { matchReason: { contains: h.ma } } }] },
        data: {
          canhBaoHuy: true,
          canhBaoDaXuLyLuc: null,
          canhBaoDaXuLyBoiId: null,
          canhBaoGhiChu: null,
          matchReason: noiLyDo(cu.matchReason, lyDo),
        },
      });
    }
  }

  // ⑦ RV-04 — lô final:false: báo từ chối như thường (dấu nguồn + sự kiện), XẾP CHỜ dòng nhận (trừ dòng GIỮ LẠI ở ⑥b);
  // KHÔNG đi lõi.
  if (!than.final) {
    kq.unchanged += tuChoiTheoMa.size - tuChoiMoi.length;
    await ghiDauAnToan(agent, tuChoiMoi.map((t) => dauTuChoi(t, agent.centerId)), now);
    await ghiLoiTuChoi();
    const xepCho = nhan.filter((r) => !giuLai.has(r.ma)).map((r) => vao.find((v) => v.index === r.index)!.row);
    const dong = xepCho as unknown as Prisma.InputJsonArray;
    // R9 — giữ tín hiệu hủy bị từ chối của lô NÀY (đã qua luật sở hữu ⑥, có RRN) cho lô final của lượt. Không có ⇒ NULL
    // (gửi lại lô: `update` cũng đặt lại NULL — lô chờ luôn phản ánh đúng lô gửi sau cùng).
    const huyGiu = huyHienTai
      .filter((h) => h.rrn !== null)
      .map((h) => ({ ma: h.ma, code: h.code, rrn: h.rrn, quay: h.quay, gio: h.thoiGian === null ? null : h.thoiGian.toISOString() }));
    const huyTuChoi = huyGiu.length > 0 ? (huyGiu as Prisma.InputJsonArray) : Prisma.DbNull;
    await db.posAgentLoCho.upsert({
      where: { agentId_syncId_batchIndex: { agentId: agent.id, syncId: than.syncId, batchIndex: than.batchIndex } },
      create: { agentId: agent.id, syncId: than.syncId, batchIndex: than.batchIndex, dong, huyTuChoi, createdAt: now },
      update: { dong, huyTuChoi, createdAt: now },
    });
    kq.staged = xepCho.length;
    kq.nextPollMs = await docNextPollMs(agent, now);
    return kq;
  }

  // ⑧ — gốc VOID (T9): ứng viên (dựng ở trên) cùng RRN + cùng quầy, giờ ≤ VOID.
  for (const r of nhan) {
    const d = r.dong.d;
    if (laLoaiThanhToan(d.loaiGiaoDich) || d.maGiaoDichGoc) continue;
    const goc = ganGocVoid({
      void: { maGiaoDichThe: d.maGiaoDichThe, maQuay: d.maQuay, thoiGian: new Date(d.thoiGian) },
      ungVien: ungVien.filter((u) => u.maGiaoDich !== r.ma),
    });
    if (goc) r.dong = { ...r.dong, d: { ...d, maGiaoDichGoc: goc } };
  }

  // ⑨ — băm (gồm máy suy ra + gốc suy ra + cột hậu kết toán). Trùng băm lần agent gửi trước ⇒ KHÔNG xử lý, KHÔNG ghi.
  for (const r of nhan) r.bam = bamDong(r.dong);
  const doi = nhan.filter((r) => bamCu.get(r.ma) !== r.bam);
  kq.unchanged += nhan.length - doi.length;
  kq.unchanged += tuChoiTheoMa.size - tuChoiMoi.length;
  // ⑥b — dòng GIỮ LẠI không xử lý ở lượt này (không đếm, không dấu nguồn ⇒ lượt sau xét lại).
  const xuLy = doi.filter((r) => !giuLai.has(r.ma));

  // ⑧b — PAYMENT tới SAU VOID: điền gốc cho VOID ĐÃ LƯU (của chính agent) đang thiếu gốc (CÓ ĐIỀU KIỆN
  // `maGiaoDichGoc IS NULL`), TRƯỚC khi gọi lõi ⇒ vòng "XÉT LẠI dòng hủy ĐÃ LƯU" của `nhapLoPos` tự đưa cả cặp về đúng chỗ.
  const maThanhToanXuLy = new Set(xuLy.filter((r) => laLoaiThanhToan(r.dong.d.loaiGiaoDich)).map((r) => r.ma));
  if (maThanhToanXuLy.size > 0) {
    for (const v of rrnCuaAgent) {
      if (laLoaiThanhToan(v.loaiGiaoDich) || v.maGiaoDichGoc || theoMa.has(v.maGiaoDich)) continue;
      const goc = ganGocVoid({
        void: { maGiaoDichThe: v.maGiaoDichThe, maQuay: v.maQuay, thoiGian: v.thoiGianGiaoDich },
        ungVien: ungVien.filter((u) => u.maGiaoDich !== v.maGiaoDich),
      });
      if (goc && maThanhToanXuLy.has(goc)) {
        await db.posCardTransaction.updateMany({ where: { id: v.id, maGiaoDichGoc: null }, data: { maGiaoDichGoc: goc } });
      }
    }
  }

  // ⑩ RV-07 — trạng thái "treo" (T7: lẫn lộn / lạ — KHÔNG phải "Thành công" / "Thất bại" rõ ràng) trên giao dịch ĐÃ
  // CÓ trong sổ ⇒ KHÔNG đi lõi: luật 1 của lõi xếp nó BO_QUA ⇒ giao dịch đang ở hàng chờ tay bị đẩy IGNORED vĩnh viễn
  // (tiền khách đã trả rời hàng chờ). Chỉ cột hậu kết toán + dấu nguồn (như dòng đã khoá của luật import).
  const treo = xuLy.filter((r) => !trangThaiRoRang(r.dong.d.trangThai) && (daCo.get(r.ma)?.bankTransactionId ?? null) !== null);
  const maTreo = new Set(treo.map((r) => r.ma));
  const vaoLoi = xuLy.filter((r) => !maTreo.has(r.ma));
  kq.updated += treo.length;
  // Rà đối kháng bản gộp (RVG-03): dòng treo KHÔNG đi lõi nên phép so lệch của lõi (GĐ3 V5–V7) không chạy cho nó —
  // giao dịch ĐÃ GHI NHẬN (MATCHED) mà agent báo số tiền / trạng thái khác vẫn phải được BÁO (cùng phép so, cùng điều
  // kiện MATCHED của nhánh đã khoá). Mã TRƯỚC: 0 dòng audit (ca [POS4-RVG-03]).
  const lechTreo: LechDong[] = [];
  for (const r of treo) {
    const cu = daCo.get(r.ma);
    if (cu?.bankTransaction?.status !== "MATCHED") continue;
    lechTreo.push(...lechDaGhiNhan(r.ma, { soTien: cu.soTien, trangThai: cu.trangThai }, r.dong.d));
  }

  // ⑪ + ⑫ — trộn null rồi đổ vào CHÍNH `nhapLoPos` (nhánh AGENT: TẠO dòng không lô).
  const dongVaoLoi: DongPos[] = vaoLoi.map((r) => {
    const cu = daCo.get(r.ma);
    const tron: CotTron | null = cu ?? null;
    return tronVoiDongDaCo(r.dong.d, tron);
  });
  const loiMa = new Set<string>();
  let lechLo: LechDong[] = [];
  if (dongVaoLoi.length > 0) {
    const lo = await nhapLoPos({ posAgentId: agent.id, now, dong: dongVaoLoi, dongHuyCuaFile: [] });
    kq.created += lo.moi;
    kq.updated += lo.capNhat;
    kq.matched += lo.tuKhop;
    kq.needsReview += lo.canXuLy;
    kq.ignored += lo.boQua;
    const viTri = new Map(vaoLoi.map((r) => [r.ma, r.index]));
    for (const l of lo.loi) {
      loiMa.add(l.maGiaoDich);
      const index = viTri.get(l.maGiaoDich);
      if (index !== undefined && index !== null) kq.errors.push({ index, transaction_id: l.maGiaoDich, code: "PROCESSING_ERROR" });
    }
    lechLo = lo.lech;
  }
  if (lechTreo.length > 0) lechLo = [...lechLo, ...lechTreo];

  // Gộp GĐ3 × GĐ4 — LỆCH (GĐ3 V5–V7 áp cho lô AGENT): giao dịch ĐÃ GHI NHẬN mà máy đồng bộ báo số tiền / trạng
  // thái KHÁC ⇒ sổ + dòng KHÔNG đổi (lõi chỉ đổi cột kết toán), chỉ BÁO: MỘT dòng `AuditLog` / lô (khuôn
  // `POS_IMPORT_LECH_DA_GHI_NHAN` của lô file; entity = agent, actor hệ thống) + số giao dịch lệch trong sự kiện SYNC
  // (màn Sức khoẻ). Ghi SAU lõi, ngoài transaction; lỗi ghi nhật ký KHÔNG làm hỏng lô (V6). Lô gửi lại y hệt đi
  // nhánh băm `unchanged` (T11) ⇒ không báo lần hai.
  if (lechLo.length > 0) {
    await writeAudit({
      actor: { id: null, name: `POS Agent ${agent.merchantCode}` },
      module: "finance",
      entityType: "PosAgent",
      entityId: agent.id,
      action: "POS_AGENT_LECH_DA_GHI_NHAN",
      newValues: { syncId: than.syncId, batchIndex: than.batchIndex, lech: lechLo },
    }).catch((err) => console.error(`[pos-agent] ghi nhật ký lệch lỗi (agent ${agent.id}):`, err));
  }
  const xuLyOk = xuLy.filter((r) => !loiMa.has(r.ma));

  // ⑬ — cột hậu kết toán agent mới biết (T14): CÓ ĐIỀU KIỆN, chỉ khi giá trị agent ≠ null và khác. Dòng treo (⑩) thêm
  // mã hạch toán + phí (lõi không chạy cho nó).
  for (const r of xuLyOk) {
    const { maKetToan, maLyDoThatBai } = r.dong;
    const cot: { ten: "maKetToan" | "maLyDoThatBai" | "maHachToan" | "phiGiaoDich"; gt: string | number | null }[] = [
      { ten: "maKetToan", gt: maKetToan },
      { ten: "maLyDoThatBai", gt: maLyDoThatBai },
      ...(maTreo.has(r.ma)
        ? [
            { ten: "maHachToan" as const, gt: r.dong.d.maHachToan },
            { ten: "phiGiaoDich" as const, gt: r.dong.d.phiGiaoDich },
          ]
        : []),
    ];
    for (const c of cot) {
      if (c.gt === null) continue;
      await db.posCardTransaction.updateMany({
        where: { maGiaoDich: r.ma, OR: [{ [c.ten]: null }, { [c.ten]: { not: c.gt } }] },
        data: { [c.ten]: c.gt },
      });
    }
  }

  // Tín hiệu hủy/hoàn của lô (gốc của VOID · dòng mang cột Hoàn/Hủy) ⇒ giao dịch nào phiếu nào phải kiểm lại (⑯).
  const gocCuaTinHieu = new Map<string, string>();
  for (const d of dongVaoLoi) {
    if (!laLoaiThanhToan(d.loaiGiaoDich) && d.maGiaoDichGoc) gocCuaTinHieu.set(d.maGiaoDich, d.maGiaoDichGoc);
    if ((d.trangThaiHoanHuy ?? "").trim() !== "") gocCuaTinHieu.set(d.maGiaoDich, d.maGiaoDich);
  }

  // Dấu nguồn AGENT (T13) — dòng đi qua lõi KHÔNG lỗi + dòng treo + dòng từ chối CÓ dấu (T30). Ảnh chụp = điều AGENT
  // nói (trước trộn null). Dòng mang TÍN HIỆU HỦY ghi SAU ⑯ (⑰).
  const dauDong = (r: DongNhan): DongNguon => ({
    maGiaoDich: r.ma,
    bam: r.bam,
    anh: anhTuDong(r.dong.d, r.dong.maKetToan),
    tuChoi: null,
    centerId: r.may?.centerId ?? agent.centerId,
  });
  await ghiDauAnToan(
    agent,
    [...xuLyOk.filter((r) => !gocCuaTinHieu.has(r.ma)).map(dauDong), ...tuChoiMoi.map((t) => dauTuChoi(t, agent.centerId))],
    now,
  );

  // ⑭ — sự kiện: ERROR gộp (agent, mã, ngày) cho từ chối MỚI; SYNC chỉ khi lô có thay đổi / từ chối mới.
  await ghiLoiTuChoi();
  if (kq.created + kq.updated + tatCaTuChoi.length + loiMa.size > 0) {
    const treNhat = xuLyOk.reduce((m, r) => Math.max(m, now.getTime() - new Date(r.dong.d.thoiGian).getTime()), 0);
    await ghiSuKien({
      agent,
      type: "SYNC",
      ma: null,
      detail: {
        syncId: than.syncId,
        batchIndex: than.batchIndex,
        final: than.final,
        received: kq.received,
        unchanged: kq.unchanged,
        created: kq.created,
        updated: kq.updated,
        matched: kq.matched,
        needsReview: kq.needsReview,
        ignored: kq.ignored,
        rejected: tatCaTuChoi.length,
        errors: loiMa.size,
        // Gộp GĐ3: số GIAO DỊCH đã ghi nhận mà agent báo khác (chi tiết ở audit `POS_AGENT_LECH_DA_GHI_NHAN`).
        lech: demGiaoDichLech(lechLo),
        loThieu,
        treNhatPhut: Math.max(0, Math.round(treNhat / 60_000)),
      },
      now,
    });
  }

  // ⑮ — lô CUỐI ĐỦ lô: DONE job (chỉ job PENDING của CHÍNH agent, tạo ≤ cận trên cửa sổ đã quét — RV-06; SAU khi cả
  // lô đã ghi: lưới [POS4-W8]) + lastSyncedAt. Lô xếp chờ của lượt đã dùng xong ⇒ xoá.
  // Chốt hợp đồng 1.1 (RV5.4 #4): CÙNG phép ghi đó lưu `duLieuDenLuc` = `windowTo` của lô final (mốc DỮ LIỆU agent đã
  // đọc tới, theo đồng hồ đã hiệu chỉnh của máy agent) — tách khỏi `lastSyncedAt` (giờ MÁY CHỦ nhận lô). Màn Sức khoẻ
  // in cả hai ([POS4-HD-06]); hai mốc chỉ trùng nhau khi đồng hồ máy agent đúng.
  if (than.final && !loThieu) {
    kq.jobsDone = await danhDauJobXong(agent.id, than.jobIds, than.windowTo, now);
    await db.posAgent.update({ where: { id: agent.id }, data: { lastSyncedAt: now, duLieuDenLuc: mocCuaSoDen(than.windowTo) } });
  }
  await db.posAgentLoCho.deleteMany({ where: { agentId: agent.id, syncId: than.syncId } });

  // ⑯ — có dòng đi qua lõi ⇒ kiểm lại phiếu liên quan (T26): mã trong lô (mọi cơ sở — bắt quẹt chéo Q-E) +
  // phiếu đang giữ giao dịch vừa có tín hiệu hủy (đi TRƯỚC, không chịu cửa sổ chống bấm dồn — RV-05).
  if (vaoLoi.length > 0) {
    const maPhieu = [...new Set(dongVaoLoi.flatMap((d) => tachMaPos(d.dienGiai)))];
    const gocCanTra = [...new Set(gocCuaTinHieu.values())];
    const btGoc = gocCanTra.length
      ? await db.posCardTransaction.findMany({
          where: { maGiaoDich: { in: gocCanTra } },
          select: { maGiaoDich: true, bankTransactionId: true },
        })
      : [];
    const btTheoGoc = new Map(btGoc.map((b) => [b.maGiaoDich, b.bankTransactionId]));
    const sau = await dongBoPhieuPosSauAgent({
      centerId: agent.centerId,
      maPhieu,
      btIdCoTinHieuHuy: btGoc.map((b) => b.bankTransactionId).filter((v): v is string => !!v),
      dongHo: x.dongHo,
    });
    // ⑰ — dấu nguồn của dòng mang tín hiệu: CHỈ khi phiếu của tín hiệu đã kiểm xong. Không xong ⇒ không dấu ⇒ lần
    // agent gửi lại, dòng KHÔNG bị coi là `unchanged` và tín hiệu được phát lại.
    const chuaXong = new Set(sau.btIdChuaXong);
    await ghiDauAnToan(
      agent,
      xuLyOk
        .filter((r) => {
          const goc = gocCuaTinHieu.get(r.ma);
          if (goc === undefined) return false;
          const bt = btTheoGoc.get(goc) ?? null;
          return bt === null || !chuaXong.has(bt);
        })
        .map(dauDong),
      now,
    );
  }

  kq.nextPollMs = await docNextPollMs(agent, now);
  return kq;
}
