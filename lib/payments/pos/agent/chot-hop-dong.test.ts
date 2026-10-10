// Ca [POS4-HD-01..06] — CHỐT HỢP ĐỒNG GĐ4 ↔ GĐ5 (07/10/2026 — `docs/pos-agent-api.md` bản 1.1). THUẦN.
//
// Năm điểm treo giữa máy chủ (GĐ4) và extension (GĐ5) — đề xuất RV5.4 của `docs/pos-gd5-thiet-ke.md`:
//  · [POS4-HD-01] trần độ dài TỪNG trường nằm TRONG hợp đồng §6.1 (cột "Trần · vượt") và máy chủ dùng ĐÚNG trần đó
//    (`TRAN_DONG_AGENT`). Extension so CÙNG cột ([EXT-PL-08], worktree `pos-gd5`) ⇒ hai bên khớp qua MỘT nguồn —
//    tệp hợp đồng trùng sha256 ở hai worktree.
//  · [POS4-HD-02] vượt trần KHÔNG còn là 400 CẢ LÔ (mã TRƯỚC: `z.string().max(n)` trong `dongAgentSchema` ⇒ một dòng
//    dài làm hỏng cả lô, agent gửi lại y hệt mỗi phút ⇒ tê liệt đường agent). Kiểu + tập khoá VẪN strict.
//  · [POS4-HD-03] vượt trần ⇒ từ chối DÒNG `FIELD_TOO_LONG` kèm `field`; dấu từ chối chỉ chụp bản đã CẮT về trần.
//  · [POS4-HD-04] mã giao dịch dài / sai dạng ⇒ không vọng lại chuỗi tuỳ ý dài trong `rejected`.
//  · [POS4-HD-05] `sessionExpiresSource: "SESSION"` ⇒ KHÔNG rõ hạn (07:30 không báo theo nó).
//  · [POS4-HD-06] màn Sức khoẻ tách "nhận lô cuối lúc" (giờ máy chủ) khỏi "dữ liệu đã đọc tới" (`windowTo` lô final).
// (Điểm #3 — job chỉ DONE khi `windowTo` phủ `createdAt` — đã làm ở RV-06: [POS4-RV-06a], [POS4-W8].)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TRAN_DONG_AGENT } from "./hop-dong";
import { dongAgentSchema, KHOA_DONG_AGENT, loGiaoDichSchema, type DongAgentTho } from "./schema";
import { chuanHoaDongAgent, truongVuotTran, type KetQuaChuanHoa } from "./chuan-hoa";
import { mocHetHanTinDuoc } from "./canh-bao-luat";
import { duLieuDocToi } from "./hien-thi";
import type { MayPos } from "./may";

const HOP_DONG = readFileSync(resolve(process.cwd(), "docs/pos-agent-api.md"), "utf8").replace(/\r\n/g, "\n");

/** Bảng §6.1 ⇒ khoá ↦ { trần, cách agent làm vừa } — đọc ô `≤ N · cắt|null` của dòng; dòng không có ô ⇒ null. */
function tranTheoHopDong(): Map<string, { tran: number; cach: string } | null> {
  const bang = HOP_DONG.slice(HOP_DONG.indexOf("### 6.1"), HOP_DONG.indexOf("### 6.2"));
  const ra = new Map<string, { tran: number; cach: string } | null>();
  for (const dong of bang.split("\n")) {
    const khoa = /^\| ((?:`[a-z_]+`(?: · )?)+) \|/.exec(dong);
    if (!khoa) continue;
    const o = /\| ≤ (\d+) · (cắt|null) \|/.exec(dong);
    for (const m of khoa[1]!.matchAll(/`([a-z_]+)`/g)) ra.set(m[1]!, o ? { tran: Number(o[1]), cach: o[2]! } : null);
  }
  return ra;
}

const MERCHANT = "NCCPH6KE";
const MAY: MayPos = {
  maThietBi: "SP_V9E1013322",
  maQuay: "QTT45XWQT",
  maNhaCungCap: MERCHANT,
  maCuaHang: "CH9TSGU9",
  active: true,
  centerId: "cs1",
};
const DONG: DongAgentTho = {
  transaction_id: "TXN20261007000123",
  transaction_type: "PAYMENT",
  transaction_detail_status: "SUCCESS",
  transaction_master_status: "SUCCESS",
  order_description: "Học phí bé An",
  authorization_id: "123456",
  card_transaction_id: "628012345678",
  tcb_transaction_id: "FT26280123456",
  order_amount: 6_732_000,
  transaction_master_amount: 6_732_000,
  transaction_detail_amount: 6_732_000,
  fee: null,
  tax: 0,
  currency: "VND",
  transaction_time: "2026/10/07 10:18:42",
  merchant_code: MERCHANT,
  store_code: "CH9TSGU9",
  terminal_code: "QTT45XWQT",
  payment_method: "CARD",
  service_type: "OMSMARTPOS",
  sender_card_number: "411111******1111",
  sender_card_type: "VISA",
  accounting_reference_id: null,
  settlement_id: null,
  merchant_order_id: "MO-0001",
  transaction_operation_msg: "APPROVED",
};
const ch = (r: Partial<DongAgentTho>): KetQuaChuanHoa =>
  chuanHoaDongAgent({ ...DONG, ...r }, { merchantCode: MERCHANT, danhSachMay: [MAY] });

/** Hai khoá có mã từ chối RIÊNG, kiểm TRƯỚC trần (§7.2): mã GD dài ⇒ BAD_TRANSACTION_ID; merchant dài ⇒ MERCHANT_MISMATCH. */
const KHOA_KIEM_TRUOC = new Set(["transaction_id", "merchant_code"]);

describe("[POS4-HD-01] trần độ dài từng trường: hợp đồng §6.1 = máy chủ", () => {
  it("mọi khoá §6.1 có ô trần; trần = TRAN_DONG_AGENT; tập khoá = schema (26)", () => {
    const hd = tranTheoHopDong();
    expect(hd.size).toBe(26);
    expect([...hd.keys()].sort()).toEqual([...KHOA_DONG_AGENT].sort());
    expect(Object.keys(TRAN_DONG_AGENT).sort()).toEqual([...KHOA_DONG_AGENT].sort());
    for (const [k, v] of hd) {
      expect(v, `${k}: thiếu ô "≤ N · cắt|null"`).not.toBeNull();
      expect(v?.tran, k).toBe(TRAN_DONG_AGENT[k as keyof typeof TRAN_DONG_AGENT]);
    }
  });

  it("ba trần RV5 + bốn trường agent BẮT BUỘC cắt (null = máy chủ bỏ một phép kiểm — fail-open)", () => {
    expect(TRAN_DONG_AGENT).toMatchObject({ currency: 16, transaction_time: 40, order_amount: 32, transaction_master_amount: 32, transaction_detail_amount: 32, fee: 32, tax: 32 });
    const hd = tranTheoHopDong();
    for (const k of ["transaction_detail_status", "transaction_master_status", "currency", "store_code"]) {
      expect(hd.get(k)?.cach, k).toBe("cắt");
    }
    // Mã giao dịch: trần = trần của định dạng `^[0-9A-Za-z]{8,64}$` (vượt ⇒ BAD_TRANSACTION_ID).
    expect(TRAN_DONG_AGENT.transaction_id).toBe(64);
  });
});

describe("[POS4-HD-02] schema lô KHÔNG canh độ dài — vượt trần không còn là 400 CẢ LÔ", () => {
  const dai = {
    transaction_id: "TXN00000001",
    currency: "V".repeat(17),
    store_code: "S".repeat(129),
    order_amount: "1".repeat(33),
    transaction_time: "T".repeat(41),
    order_description: "D".repeat(4_001),
  };
  it("dòng vượt trần ⇒ schema NHẬN (từ chối dòng là việc của tầng chuẩn hoá); lô chứa nó ⇒ NHẬN", () => {
    expect(dongAgentSchema.safeParse(dai).success).toBe(true);
    const lo = { syncId: "s", batchIndex: 0, final: true, windowFrom: "2026-10-07 08:00:00", windowTo: "2026-10-07 09:00:00", jobIds: [], transactions: [dai] };
    expect(loGiaoDichSchema.safeParse(lo).success).toBe(true);
  });
  it("ĐỐI CHỨNG: sai KIỂU / khoá lạ / khoá cấm vẫn 400 (strict)", () => {
    expect(dongAgentSchema.safeParse({ transaction_id: "TXN00000001", order_description: 123 }).success).toBe(false);
    expect(dongAgentSchema.safeParse({ transaction_id: "TXN00000001", store_code: { x: 1 } }).success).toBe(false);
    expect(dongAgentSchema.safeParse({ transaction_id: "TXN00000001", sender_card_name: "A" }).success).toBe(false);
    expect(dongAgentSchema.safeParse({ transaction_id: "TXN00000001", order_amount: true }).success).toBe(false);
  });
});

describe("[POS4-HD-03] vượt trần ⇒ từ chối DÒNG FIELD_TOO_LONG (+ field), dấu chỉ chụp bản đã cắt", () => {
  const cacKhoa = Object.entries(TRAN_DONG_AGENT).filter(([k]) => !KHOA_KIEM_TRUOC.has(k));

  it("lưới không quét rỗng: 24 khoá được soi", () => {
    expect(cacKhoa).toHaveLength(24);
  });

  it.each(cacKhoa)("%s: trần + 1 ⇒ FIELD_TOO_LONG; đúng trần ⇒ KHÔNG phải FIELD_TOO_LONG (biên)", (k, tran) => {
    const dai = "7".repeat(tran + 1);
    const vuot = ch({ [k]: dai });
    expect(vuot).toMatchObject({ loai: "TU_CHOI", code: "FIELD_TOO_LONG", field: k, luuDau: true, maGiaoDich: DONG.transaction_id });
    if (vuot.loai !== "TU_CHOI" || vuot.anh === null) throw new Error("mong dấu từ chối");
    expect(JSON.stringify({ ...vuot.anh, bam: null }), `${k}: dấu mang chuỗi vượt trần`).not.toContain(dai);
    expect(vuot.anh.bam).toMatch(/^[0-9a-f]{64}$/);
    const bien = ch({ [k]: "7".repeat(tran) });
    expect(bien.loai === "TU_CHOI" ? bien.code : "NHAN", k).not.toBe("FIELD_TOO_LONG");
    expect(truongVuotTran({ ...DONG, [k]: dai })).toBe(k);
    expect(truongVuotTran({ ...DONG, [k]: "7".repeat(tran) })).toBeNull();
  });

  it("số dạng NUMBER không chịu trần độ dài (chỉ dạng chuỗi); dòng chuẩn ⇒ không vượt", () => {
    expect(truongVuotTran(DONG)).toBeNull();
    expect(truongVuotTran({ ...DONG, order_amount: 123_456_789_012_345 })).toBeNull();
  });

  it("FIELD_TOO_LONG kiểm TRƯỚC giờ / loại / tiền (dòng vừa dài vừa sai giờ ⇒ báo trần — lỗi hợp đồng của agent)", () => {
    expect(ch({ store_code: "S".repeat(129), transaction_time: "sai" })).toMatchObject({ code: "FIELD_TOO_LONG", field: "store_code" });
  });
});

describe("[POS4-HD-04] mã giao dịch dài / sai dạng ⇒ KHÔNG vọng lại chuỗi dài", () => {
  it("mã ngắn sai dạng vẫn vọng (agent đối chiếu được); mã > 64 ký tự ⇒ null", () => {
    expect(ch({ transaction_id: "TXN-1" })).toMatchObject({ code: "BAD_TRANSACTION_ID", maGiaoDich: "TXN-1" });
    expect(ch({ transaction_id: "x".repeat(65) })).toMatchObject({ code: "BAD_TRANSACTION_ID", maGiaoDich: null });
    expect(ch({ merchant_code: "NCCQYY4D", transaction_id: "y".repeat(500) })).toMatchObject({ code: "MERCHANT_MISMATCH", maGiaoDich: null });
    expect(ch({ merchant_code: "M".repeat(129) })).toMatchObject({ code: "MERCHANT_MISMATCH", maGiaoDich: DONG.transaction_id });
  });
});

describe("[POS4-HD-05] sessionExpiresSource SESSION ⇒ KHÔNG rõ hạn", () => {
  const iso = "2026-10-07T20:00:00+07:00";
  it("SESSION ⇒ null; ACCESS_TOKEN / vắng / null ⇒ mốc như gửi; mốc null ⇒ null", () => {
    expect(mocHetHanTinDuoc({ sessionExpiresAt: iso, sessionExpiresSource: "SESSION" })).toBeNull();
    expect(mocHetHanTinDuoc({ sessionExpiresAt: iso, sessionExpiresSource: "ACCESS_TOKEN" })?.toISOString()).toBe("2026-10-07T13:00:00.000Z");
    expect(mocHetHanTinDuoc({ sessionExpiresAt: iso })?.toISOString()).toBe("2026-10-07T13:00:00.000Z");
    expect(mocHetHanTinDuoc({ sessionExpiresAt: iso, sessionExpiresSource: null })?.toISOString()).toBe("2026-10-07T13:00:00.000Z");
    expect(mocHetHanTinDuoc({ sessionExpiresAt: null, sessionExpiresSource: "ACCESS_TOKEN" })).toBeNull();
  });
});

describe("[POS4-HD-06] 'dữ liệu đã đọc tới' tách khỏi 'nhận lô cuối lúc'", () => {
  const nhan = new Date("2026-10-07T03:20:05Z");
  it("cửa sổ phủ tới (hoặc quá) lúc nhận ⇒ KIP, mốc = lúc nhận (không in giờ TƯƠNG LAI của biên 2′)", () => {
    expect(duLieuDocToi(nhan, new Date("2026-10-07T03:22:00Z"))).toEqual({ loai: "KIP", luc: nhan });
  });
  it("cửa sổ dừng SỚM hơn lúc nhận ≤ 60″ ⇒ vẫn KIP (mốc = cửa sổ); > 60″ ⇒ TRE kèm độ trễ (biên đúng 60″)", () => {
    expect(duLieuDocToi(nhan, new Date("2026-10-07T03:19:05Z"))).toEqual({ loai: "KIP", luc: new Date("2026-10-07T03:19:05Z") });
    expect(duLieuDocToi(nhan, new Date("2026-10-07T03:19:04.999Z"))).toEqual({
      loai: "TRE",
      luc: new Date("2026-10-07T03:19:04.999Z"),
      treMs: 60_001,
    });
  });
  it("chưa có mốc cửa sổ (lô final trước bản 1.1, hoặc chưa đồng bộ lần nào) ⇒ CHUA_CO", () => {
    expect(duLieuDocToi(nhan, null)).toEqual({ loai: "CHUA_CO" });
    expect(duLieuDocToi(null, null)).toEqual({ loai: "CHUA_CO" });
    expect(duLieuDocToi(null, new Date("2026-10-07T03:22:00Z"))).toEqual({ loai: "CHUA_CO" });
  });
});
