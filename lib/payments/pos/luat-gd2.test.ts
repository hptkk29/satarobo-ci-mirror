// Ca [POS2-CD-07] · [POS2-HT-01] · [POS2-HT-02] · [POS2-HT-04] — LUẬT THUẦN của GĐ2 POS: cửa sổ chống bấm
// dồn, thời hạn hiển thị phiếu trên màn sale, mốc hết hạn chung. Không DB.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §2.2 (U1–U3), §4 (U8, U9, U12). Đồng hồ ĐÓNG BĂNG (luật 19): mọi
// mốc là hằng tuyệt đối, không ca nào đọc `Date.now()`.
import { describe, it, expect } from "vitest";
import { PosCheckTrigger, type PosIntentStatus } from "@prisma/client";
import {
  anKhoiManSale,
  apCuaSoChongDon,
  chonPhieuPosHienThi,
  CHONG_BAM_DON_MS,
  dungPhieuPosView,
  HAN_HIEN_THI_PHIEU_POS_MS,
  HAN_PHIEU_POS_MS,
  phieuPosHetHan,
  trongCuaSoChongDon,
  type PhieuPosDeXem,
} from "./phieu-pos-luat";
import { nutThuThe } from "./nut-thu-the";
import type { PosCheckResult } from "./provider/kieu";
import { CAU_DANG_KIEM } from "./thong-diep-pos";

const MOC = new Date("2026-10-06T10:00:00Z");
const sau = (ms: number) => new Date(MOC.getTime() + ms);

describe("[POS2-CD-07] cửa sổ chống bấm dồn — 5 giây, nguồn nào chịu", () => {
  it("CHONG_BAM_DON_MS = 5000 (GĐ1 đặt 3 giây — đặc tả GĐ2 nâng lên 5)", () => {
    expect(CHONG_BAM_DON_MS).toBe(5_000);
  });

  it("bảng apCuaSoChongDon phủ ĐỦ mọi giá trị enum — nguồn mới phải quyết có chịu cửa sổ hay không", () => {
    // [TỰ QUYẾT U3] IMPORT / QUET_SACH do SỰ KIỆN DỮ LIỆU kích (vừa nhập file / chốt cuối ngày) ⇒ luôn
    // hỏi provider; trả câu cũ cho chúng là làm mất đúng thông tin mới vừa về.
    const mongDoi: Record<PosCheckTrigger, boolean> = {
      SALE: true,
      POLLER: true,
      AGENT: true,
      IMPORT: false,
      QUET_SACH: false,
    };
    expect(Object.keys(mongDoi).sort()).toEqual(Object.values(PosCheckTrigger).sort());
    for (const [nguon, coAp] of Object.entries(mongDoi)) {
      expect(apCuaSoChongDon(nguon as PosCheckTrigger), nguon).toBe(coAp);
    }
  });

  it("trongCuaSoChongDon: chưa kiểm lần nào · 4,999 giây · đúng 5 giây · now sớm hơn lastCheckAt", () => {
    expect(trongCuaSoChongDon(null, MOC), "chưa kiểm lần nào ⇒ ngoài cửa sổ").toBe(false);
    expect(trongCuaSoChongDon(MOC, sau(0)), "cùng mốc (hai lượt chen nhau)").toBe(true);
    expect(trongCuaSoChongDon(MOC, sau(4_999))).toBe(true);
    expect(trongCuaSoChongDon(MOC, sau(5_000)), "đúng 5 giây ⇒ được hỏi lại (biên `<`)").toBe(false);
    // Lượt khác vừa kiểm "sau" mình (chen dưới khoá) ⇒ vẫn là bấm dồn.
    expect(trongCuaSoChongDon(MOC, sau(-1_000))).toBe(true);
    expect(trongCuaSoChongDon(MOC, sau(-4_999))).toBe(true);
    // [TỰ QUYẾT bổ sung] lệch ≥ 5 giây về phía TRƯỚC không còn là "bấm dồn" — đó là một `now` cũ (lượt
    // đồng bộ cầm một mốc cho cả lô), hỏi lại provider là vô hại (đường tiền có khoá riêng).
    expect(trongCuaSoChongDon(MOC, sau(-5_000))).toBe(false);
  });

  it("CAU_DANG_KIEM — lượt bị chặn khi lượt đầu còn đang bay: không bịa kết quả, không mời quẹt lại", () => {
    expect(CAU_DANG_KIEM).toBe("Đang có một lượt kiểm tra khác cho phiếu này — xem lại sau vài giây.");
    expect(CAU_DANG_KIEM).not.toMatch(/quẹt lại/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THỜI HẠN HIỂN THỊ (U8, U9) + MỐC HẾT HẠN CHUNG (U12)
// ─────────────────────────────────────────────────────────────────────────────

type PhieuAn = {
  status: PosIntentStatus;
  createdAt: Date;
  lastResultKind: PosCheckResult["kind"] | null;
  coGiaoDichChoTay: boolean;
};
const tuoi = (ms: number, o: Partial<PhieuAn> = {}): PhieuAn => ({
  status: "CHO_QUET",
  createdAt: new Date(MOC.getTime() - ms),
  lastResultKind: "NOT_FOUND",
  coGiaoDichChoTay: false,
  ...o,
});
const PHUT = 60_000;

describe("[POS2-HT-01] anKhoiManSale — phiếu bỏ dở rời màn sale sau 30 phút, cảnh báo tiền thì KHÔNG", () => {
  it("HAN_HIEN_THI_PHIEU_POS_MS = 30 phút — HẰNG, không SystemSetting (U8)", () => {
    expect(HAN_HIEN_THI_PHIEU_POS_MS).toBe(30 * 60_000);
  });

  it("bảng: tuổi × trạng thái × kết quả gần nhất × giao dịch chờ tay", () => {
    const ca: [string, PhieuAn, boolean][] = [
      ["CHO_QUET 29′59″ ⇒ hiện", tuoi(30 * PHUT - 1_000), false],
      ["CHO_QUET đúng 30′ ⇒ ẩn", tuoi(30 * PHUT), true],
      ["THAT_BAI 31′ ⇒ ẩn", tuoi(31 * PHUT, { status: "THAT_BAI", lastResultKind: "FAILED" }), true],
      ["HET_HAN 25 giờ ⇒ ẩn", tuoi(25 * 60 * PHUT, { status: "HET_HAN" }), true],
      ["CHO_QUET 31′ chưa kiểm lần nào ⇒ ẩn", tuoi(31 * PHUT, { lastResultKind: null }), true],
      ["DA_THU 2 giờ ⇒ hiện (phiếu ĐÓNG không bao giờ ẩn)", tuoi(120 * PHUT, { status: "DA_THU", lastResultKind: "PAID" }), false],
      ["LECH_TIEN 2 giờ ⇒ hiện", tuoi(120 * PHUT, { status: "LECH_TIEN", lastResultKind: "PAID" }), false],
      ["CAN_XU_LY 2 giờ ⇒ hiện", tuoi(120 * PHUT, { status: "CAN_XU_LY", lastResultKind: "PAID" }), false],
      ["CHO_QUET 31′ lỗi kết nối ⇒ hiện ('đã báo admin')", tuoi(31 * PHUT, { lastResultKind: "PROVIDER_ERROR" }), false],
      ["CHO_QUET 31′ PAID (pha tiền ném — ĐỪNG cho quẹt lại) ⇒ hiện", tuoi(31 * PHUT, { lastResultKind: "PAID" }), false],
      ["CHO_QUET 31′ PAID_AMOUNT_MISMATCH ⇒ hiện", tuoi(31 * PHUT, { lastResultKind: "PAID_AMOUNT_MISMATCH" }), false],
      ["CHO_QUET 31′ còn giao dịch chờ tay (T21) ⇒ hiện", tuoi(31 * PHUT, { coGiaoDichChoTay: true }), false],
      ["HET_HAN còn giao dịch chờ tay ⇒ hiện", tuoi(25 * 60 * PHUT, { status: "HET_HAN", coGiaoDichChoTay: true }), false],
      // Cấy lại (luật 14) tìm ra: mọi ca ĐÓNG ở trên mang `PAID` ⇒ ngoại lệ "giữ trên màn theo kết quả"
      // che mất vế "phiếu ĐÓNG không bao giờ ẩn" — gỡ vế đó mà bảng vẫn xanh. Hai ca dưới mang kết quả
      // KHÔNG thuộc tập giữ-trên-màn (D7 huỷ sau thu) nên chỉ vế trạng thái giữ được chúng.
      ["DA_THU 2 giờ, huỷ sau thu (D7) ⇒ hiện", tuoi(120 * PHUT, { status: "DA_THU", lastResultKind: "CANCELLED_AFTER_PAID" }), false],
      ["CAN_XU_LY 2 giờ, huỷ sau thu (D7) ⇒ hiện", tuoi(120 * PHUT, { status: "CAN_XU_LY", lastResultKind: "CANCELLED_AFTER_PAID" }), false],
    ];
    for (const [ten, p, an] of ca) expect(anKhoiManSale(p, MOC), ten).toBe(an);
  });
});

describe("[POS2-HT-02] chonPhieuPosHienThi lọc phiếu bị ẩn TRƯỚC cả hai bước chọn", () => {
  const p = (id: string, paymentBillId: string, o: Partial<PhieuAn> & { tuoiMs: number }) => ({
    id,
    paymentBillId,
    ...tuoi(o.tuoiMs, o),
  });

  it("phiếu mới nhất của phiếu gộp ĐANG MỞ bị ẩn ⇒ phiếu cũ hơn KHÔNG ẩn của chính phiếu gộp đó", () => {
    const ds = [p("i2", "b1", { tuoiMs: 31 * PHUT }), p("i1", "b1", { tuoiMs: 120 * PHUT, status: "LECH_TIEN", lastResultKind: "PAID" })];
    expect(chonPhieuPosHienThi(ds, "b1", MOC)?.id).toBe("i1");
  });

  it("phiếu bị ẩn KHÔNG quay lại qua bước 2 (cửa sau 'mới nhất không phải HUY/HET_HAN')", () => {
    expect(chonPhieuPosHienThi([p("i2", "b1", { tuoiMs: 31 * PHUT })], "b1", MOC)).toBeNull();
    expect(chonPhieuPosHienThi([p("i2", "b1", { tuoiMs: 31 * PHUT })], null, MOC)).toBeNull();
    // Đối chứng dương: phiếu trẻ vẫn lên qua cả hai bước.
    expect(chonPhieuPosHienThi([p("i2", "b1", { tuoiMs: 5 * PHUT })], "b1", MOC)?.id).toBe("i2");
    expect(chonPhieuPosHienThi([p("i2", "b1", { tuoiMs: 5 * PHUT })], null, MOC)?.id).toBe("i2");
  });

  it("không còn phiếu nào hiện ⇒ ô dòng đợt về nút 'Thẻ POS' (TAO) — không treo 'Thẻ · đang chờ' cả ngày", () => {
    const chon = chonPhieuPosHienThi([p("i2", "b1", { tuoiMs: 31 * PHUT })], "b1", MOC);
    expect(chon).toBeNull();
    const nut = nutThuThe({
      duocThuThePos: true,
      bat: true,
      tt: { kieu: "MOI_CUA_DOT_NAY" },
      paymentRequestId: "pr1",
      rowStatus: "PENDING",
      conThieu: 3_564_000,
      lyDoChuaDuyet: null,
      soMay: 1,
      phieuPos: null,
    });
    expect(nut.kieu).toBe("TAO");
  });
});

describe("[POS2-HT-04] phieuPosHetHan — MỘT mốc cho view, tạo phiếu và poller (biên `≤`)", () => {
  const HAN = new Date(MOC.getTime() + HAN_PHIEU_POS_MS);

  it("expiresAt = now ⇒ hết hạn; now − 1ms ⇒ còn; quá 1ms ⇒ hết", () => {
    expect(phieuPosHetHan(HAN, HAN)).toBe(true);
    expect(phieuPosHetHan(HAN, new Date(HAN.getTime() - 1))).toBe(false);
    expect(phieuPosHetHan(HAN, new Date(HAN.getTime() + 1))).toBe(true);
  });

  it("dungPhieuPosView ở ĐÚNG mốc hết hạn ⇒ HET_HAN (GĐ1 lệch 1 ms: `now > expiresAt`)", () => {
    const deXem: PhieuPosDeXem = {
      id: "i1",
      code5: "K7M2N",
      amount: 6_732_000,
      status: "CHO_QUET",
      createdAt: MOC,
      expiresAt: HAN,
      lastCheckAt: null,
      lastResultKind: null,
      lastResultMessage: null,
      paymentBillId: "b1",
      posTerminal: null,
      bankTransaction: null,
      paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }] },
      coGiaoDichChoTay: false,
    };
    expect(dungPhieuPosView({ intent: deXem, phieuMo: null, now: HAN }).hienThi).toBe("HET_HAN");
    expect(dungPhieuPosView({ intent: deXem, phieuMo: null, now: new Date(HAN.getTime() - 1) }).hienThi).toBe("CHO_QUET");
  });
});
