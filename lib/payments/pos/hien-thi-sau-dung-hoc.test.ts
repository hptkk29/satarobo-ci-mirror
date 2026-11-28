// lib/payments/pos/hien-thi-sau-dung-hoc.test.ts — VIỆC 6 (chốt, rà đối kháng): MÀN CỦA SALE SAU "DỪNG HỌC / ĐỔI KHOÁ" huỷ kèm phiếu thẻ. THUẦN (không DB).
//
// ── LỖ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mục 3 làm dừng học HUỶ kèm phiếu thẻ MỞ của phiếu gộp, cùng transaction. Hệ quả ở màn đơn (đo ở Postgres thật, rà đối kháng chốt):
//   · phiếu thẻ giờ là `HUY` còn phiếu gộp là VOID/CLOSED ⇒ `chonPhieuPosHienThi` loại `HUY` khi không thuộc phiếu gộp ĐANG MỞ ⇒ màn không vẽ gì;
//   · khách quẹt theo mã cũ SAU đó ⇒ giao dịch rơi hàng chờ gắn tay (`PHIEU_KHONG_MO`) — đúng như chủ dự án chốt — nhưng sale ở quầy KHÔNG còn thấy dòng nào báo "có giao dịch
//     thẻ mang mã này đang chờ kế toán". Trước mục 3 phiếu thẻ ở lại CHO_QUET rồi sang CAN_XU_LY nên hộp có câu ấy ⇒ mục 3 làm MẤT một tín hiệu, và sale có thể phát mã mới
//     + mở thẻ mới cho phần còn nợ ⇒ khách bị quẹt lần hai.
//   · hộp thẻ sale đang mở lúc đó (props mất phiếu) rơi sang bước "Tạo phiếu thu thẻ" của một đợt đã VOID.
// ── VÁ (tầng HIỂN THỊ, không đổi cổng T21 ⇒ `moPhieuPos`/`taoPhieuGop` giữ nguyên) ────────────────────────────────────────────────────────────────
//   · `chonPhieuPosHienThi`: không có phiếu nào khác ⇒ lùi về phiếu `HUY` CÓ `coGiaoDichChoTay` (tự giới hạn: kế toán xử lý xong thì cờ tắt, phiếu biến mất);
//   · `huyPhieuThe.DA_HUY`: bỏ "(vẫn dùng mã cũ)" — mã có thể đã chết.
// Ca hành vi trên Postgres thật (dừng học thật → file về → màn) ở `tests/finance/pos-dung-hoc-huy-the.test.ts` [HN6-DH-12]. Ca RTL của hộp tự đóng ở
// `app/(admin)/admin/orders/_components/payment-requests-hop-the-dong.test.tsx`.
import { describe, expect, it } from "vitest";
import type { PosIntentStatus } from "@prisma/client";
import { chonPhieuPosHienThi, dungPhieuPosChoDon, type PhieuPosDeXem } from "./phieu-pos-luat";
import { CAU_PHIEU_THE_DA_HUY, CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN, CAU_TU_CHOI_HUY_PHIEU_THE } from "./huy-phieu-the-cau";

const PHUT = 60_000;
const NOW = new Date("2026-10-09T03:00:00.000Z");
const TAO = new Date(NOW.getTime() - 5 * PHUT);

function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "H6WR4",
    amount: 800_000,
    status: "HUY",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: null,
    bankTransaction: null,
    // Phiếu gộp đã bị dừng học huỷ/đóng ⇒ KHÔNG còn OPEN.
    paymentBill: { status: "VOID", lines: [{ paymentRequestId: "pr1" }] },
    coGiaoDichChoTay: false,
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false,
    donDaCoVetBac: false,
    ...p,
  };
}

const p = (id: string, status: PosIntentStatus, o: { bill?: string; tuoiPhut?: number; choTay?: boolean } = {}) => ({
  id,
  paymentBillId: o.bill ?? "b1",
  status,
  createdAt: new Date(NOW.getTime() - (o.tuoiPhut ?? 5) * PHUT),
  lastResultKind: null,
  coGiaoDichChoTay: o.choTay ?? false,
  saiMaYeuCau: [] as readonly { trangThai: "CHO_DUYET" | "DANG_GHI" | "DA_GHI_NHAN" | "TU_CHOI" }[],
});

describe("[HN6-CH-01] chonPhieuPosHienThi — phiếu HUY còn giao dịch chờ tay vẫn lên màn khi phiếu gộp của nó đã đóng", () => {
  it("[HN6-CH-01a] phiếu gộp KHÔNG còn mở (dừng học) + phiếu thẻ HUY có giao dịch chờ tay ⇒ lên màn", () => {
    expect(chonPhieuPosHienThi([p("i1", "HUY", { choTay: true })], null, NOW)?.id).toBe("i1");
    // Có một phiếu gộp KHÁC đang mở (sale đã phát mã mới cho bé còn lại) — phiếu HUY của phiếu gộp CŨ vẫn phải thấy, đó chính là kịch bản nguy hiểm.
    expect(chonPhieuPosHienThi([p("i1", "HUY", { choTay: true })], "b-moi", NOW)?.id).toBe("i1");
  });

  it("[HN6-CH-01b] ĐỐI CHỨNG DƯƠNG — cùng cảnh, tắt ĐÚNG MỘT yếu tố: không còn giao dịch chờ tay ⇒ phiếu HUY biến mất khỏi màn (kế toán xử lý xong thì hết cảnh báo)", () => {
    expect(chonPhieuPosHienThi([p("i1", "HUY", { choTay: false })], null, NOW)).toBeNull();
    expect(chonPhieuPosHienThi([p("i1", "HUY", { choTay: false })], "b-moi", NOW)).toBeNull();
  });

  it("[HN6-CH-01c] không làm đổi luật cũ: có phiếu KHÁC HUY/HET_HAN thì nó đứng TRƯỚC; HET_HAN vẫn bị loại dù có giao dịch chờ tay", () => {
    expect(chonPhieuPosHienThi([p("i2", "DA_THU", { bill: "b2" }), p("i1", "HUY", { choTay: true })], null, NOW)?.id).toBe("i2");
    expect(chonPhieuPosHienThi([p("i1", "HET_HAN", { choTay: true })], null, NOW)).toBeNull();
  });
});

describe("[HN6-CH-02] màn nói đúng khi phiếu thẻ HUY nằm trên phiếu gộp đã đóng", () => {
  it("[HN6-CH-02a] hộp có câu 'ĐỪNG cho khách quẹt lại, chờ kế toán', tông cảnh báo, choKeToan = true", () => {
    const v = dungPhieuPosChoDon({ ds: [raw({ coGiaoDichChoTay: true })], phieuMo: null, now: NOW });
    expect(v, "phiếu lên màn").not.toBeNull();
    expect(v?.hienThi).toBe("HUY");
    expect(v?.thongDiep).toBe(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN);
    expect(v?.mucDo).toBe("canh_bao");
    expect(v?.choKeToan).toBe(true);
  });

  it("[HN6-CH-02b] ĐỐI CHỨNG DƯƠNG — không giao dịch chờ tay ⇒ không có hộp nào (phiếu HUY thường không lên màn khi phiếu gộp đã đóng)", () => {
    expect(dungPhieuPosChoDon({ ds: [raw({ coGiaoDichChoTay: false })], phieuMo: null, now: NOW })).toBeNull();
  });

  it("[HN6-CH-02c] câu của phiếu HUY không hứa 'mở phiếu mới' khi có giao dịch chờ tay (cặp câu cũ, giữ nguyên)", () => {
    expect(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN).not.toBe(CAU_PHIEU_THE_DA_HUY);
    expect(CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN).toMatch(/ĐỪNG cho khách quẹt lại/);
  });
});

describe("[HN6-CH-03] câu từ chối huỷ cho phiếu ĐÃ HUỶ không hứa một mã có thể đã chết", () => {
  it("[HN6-CH-03a] DA_HUY không còn '(vẫn dùng mã cũ)' — mã có thể đã chết sau dừng học; vẫn chỉ đường mở phiếu mới khi mã còn dùng được", () => {
    const c = CAU_TU_CHOI_HUY_PHIEU_THE.DA_HUY;
    expect(c.viecNenLam).not.toMatch(/vẫn dùng mã cũ/);
    expect(c.viecNenLam, "vẫn nói điều kiện: mã còn dùng được").toMatch(/mã (vẫn )?còn dùng được|chưa đóng|đã đóng/);
    expect(c.viecNenLam, "vẫn chỉ nút Thẻ POS").toMatch(/Thẻ POS/);
  });
});
