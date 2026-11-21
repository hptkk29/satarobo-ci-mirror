// [HN3-L1..L6] — phần ĐỌC của Việc 3 "sale nhập sai mã" (`sai-ma-doc.ts`): điều kiện truy vấn, cổng bước TÌM, và hàng chờ của kế toán.
// THUẦN — client là bản giả ghi lại đối số; hành vi trên Postgres thật đo ở `tests/finance/pos-hai-nut-sai-ma.test.ts`.
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi mốc tính từ `NOW`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PosIntentStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";

const h = vi.hoisted(() => ({
  docPhieuGopDangMo: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/finance/phieu-gop", () => ({ docPhieuGopDangMo: h.docPhieuGopDangMo }));

import {
  bonSoCuoi,
  docGiaoDichDaBiBac,
  docHangChoSaiMa,
  dungDieuKienUngVien,
  timUngVienSaiMa,
  TRAN_HAU_KIEM,
} from "./sai-ma-doc";
import { CAU_KHONG_UNG_VIEN, DANG_GHI_KET_SAU_MS, ghepLyDo } from "./sai-ma";

const PHUT = 60_000;
const NOW = new Date("2026-10-09T05:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// L5 · ĐIỀU KIỆN TRUY VẤN — từng vế
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN3-L5] dungDieuKienUngVien — đúng SỐ PHẢI THU · đúng MÁY · trong cửa sổ · giao dịch còn tự do", () => {
  const tu = new Date("2026-10-09T03:55:00Z");
  const den = new Date("2026-10-09T05:00:00Z");

  it("hình dạng ĐẦY ĐỦ (toEqual): bỏ hay đổi bất kỳ vế nào đều đỏ", () => {
    expect(dungDieuKienUngVien({ conPhaiThu: 3_168_000, maThietBi: ["SP_A", "SP_B"], tu, den })).toEqual({
      matchStatus: "CAN_XU_LY",
      soTien: 3_168_000,
      maThietBi: { in: ["SP_A", "SP_B"] },
      thoiGianGiaoDich: { gte: tu, lte: den },
      bankTransaction: {
        is: {
          status: "UNMATCHED",
          provider: "CARD_POS",
          posPaymentIntent: { is: null },
          posSaiMaYeuCau: { none: { trangThai: { not: "TU_CHOI" } } },
        },
      },
    });
  });

  it("số tiền là ĐẲNG THỨC (không `gte`/`lte`/khoảng) — lệch 1 đồng là loại", () => {
    const w = dungDieuKienUngVien({ conPhaiThu: 3_168_000, maThietBi: ["SP_A"], tu, den });
    expect(w.soTien).toBe(3_168_000);
    expect(typeof w.soTien).toBe("number");
  });

  it("máy: CHỈ các máy truyền vào (không rỗng-nghĩa-là-tất-cả); mảng đầu vào không bị chia sẻ tham chiếu", () => {
    const may = ["SP_A"];
    const w = dungDieuKienUngVien({ conPhaiThu: 1, maThietBi: may, tu, den });
    expect(w.maThietBi).toEqual({ in: ["SP_A"] });
    may.push("SP_B");
    expect(w.maThietBi, "sao chép, không giữ tham chiếu").toEqual({ in: ["SP_A"] });
    // Đối chứng: mảng rỗng ⇒ `in: []` (không khớp dòng nào) chứ KHÔNG bỏ vế máy.
    expect(dungDieuKienUngVien({ conPhaiThu: 1, maThietBi: [], tu, den }).maThietBi).toEqual({ in: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L6 · 4 số cuối
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN3-L6] bonSoCuoi — chỉ BỐN chữ số cuối của số đã che", () => {
  it.each([
    ["411111******1234", "1234"],
    ["411111******1234 ", "1234"],
    ["**** **** **** 0042", "0042"],
    ["******12", null],
    ["", null],
    [null, null],
    ["abcd", null],
  ])("%j → %j", (vao, ra) => {
    expect(bonSoCuoi(vao as string | null)).toBe(ra);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L2 · CỔNG của bước TÌM (trước khi đọc ứng viên)
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN3-L2] timUngVienSaiMa — mỗi cổng một câu riêng; vượt hết thì mới tới bước đọc ứng viên", () => {
  type Phieu = {
    id: string;
    code5: string;
    createdAt: Date;
    expiresAt: Date;
    centerId: string;
    posTerminalId: string | null;
    paymentBillId: string;
    status: string;
    bankTransactionId: string | null;
    lastResultKind: string | null;
  };
  const phieuTot = (p: Partial<Phieu> = {}): Phieu => ({
    id: "i1",
    code5: "K7M2N",
    createdAt: new Date(NOW.getTime() - 40 * PHUT),
    expiresAt: new Date(NOW.getTime() + 20 * 60 * PHUT),
    centerId: "cs1",
    posTerminalId: null,
    paymentBillId: "b1",
    status: "CHO_QUET",
    bankTransactionId: null,
    lastResultKind: "NOT_FOUND",
    ...p,
  });

  function dung(phieu: Phieu | null, mo: { billId: string; ma: string; tongTien: number } | null = { billId: "b1", ma: "K7M2N", tongTien: 3_168_000 }) {
    const posTerminalFindMany = vi.fn().mockResolvedValue([]);
    const sdb = {
      posPaymentIntent: { findFirst: vi.fn().mockResolvedValue(phieu) },
      posTerminal: { findMany: posTerminalFindMany },
      posCardTransaction: { findMany: vi.fn().mockResolvedValue([]) },
    };
    h.docPhieuGopDangMo.mockResolvedValue(mo);
    return { sdb, posTerminalFindMany };
  }
  const chay = (sdb: unknown) =>
    timUngVienSaiMa({ sdb: sdb as Parameters<typeof timUngVienSaiMa>[0]["sdb"], orderId: "o1", intentId: "i1", now: NOW });

  beforeEach(() => vi.clearAllMocks());

  const BANG: ReadonlyArray<[string, Phieu | null, { billId: string; ma: string; tongTien: number } | null | undefined, string]> = [
    ["phiếu POS không thuộc đơn / ngoài tầm nhìn", null, undefined, "Không tìm thấy phiếu POS"],
    ["phiếu đã nhận giao dịch (DA_THU)", phieuTot({ status: "DA_THU" }), undefined, "Phiếu thu thẻ không còn chờ quẹt"],
    ["phiếu đang chờ kế toán (CAN_XU_LY)", phieuTot({ status: "CAN_XU_LY" }), undefined, "Phiếu thu thẻ không còn chờ quẹt"],
    ["phiếu hết hạn đúng mốc (≤)", phieuTot({ expiresAt: NOW }), undefined, "Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu"],
    ["phiếu đã gắn giao dịch", phieuTot({ bankTransactionId: "bt1" }), undefined, "Phiếu thẻ này đã nhận một giao dịch"],
    [
      "chưa bấm Kiểm tra (chưa NOT_FOUND)",
      phieuTot({ lastResultKind: null }),
      undefined,
      "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'",
    ],
    [
      "kết quả kiểm gần nhất KHÔNG phải NOT_FOUND",
      phieuTot({ lastResultKind: "PROVIDER_ERROR" }),
      undefined,
      "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'",
    ],
    ["phiếu gộp đã đóng", phieuTot(), null, "Phiếu gộp không còn mở — tải lại trang"],
    ["phiếu gộp mở nhưng KHÁC phiếu gộp của phiếu thẻ", phieuTot(), { billId: "b2", ma: "K7M2N", tongTien: 3_168_000 }, "Phiếu gộp không còn mở — tải lại trang"],
    ["phiếu gộp mở nhưng KHÁC mã", phieuTot(), { billId: "b1", ma: "W9GXT", tongTien: 3_168_000 }, "Phiếu gộp không còn mở — tải lại trang"],
  ];

  it.each(BANG)("từ chối: %s", async (_ten, phieu, mo, loi) => {
    const { sdb, posTerminalFindMany } = dung(phieu, mo === undefined ? undefined : mo);
    const kq = await chay(sdb);
    expect(kq).toEqual({ ok: false, error: loi });
    expect(posTerminalFindMany, "chưa đọc ứng viên khi cổng từ chối").not.toHaveBeenCalled();
  });

  it("[HNC-03] MỌI trạng thái phiếu thẻ khác CHO_QUET — kể cả HUY (huỷ tay, Việc 4) — bị cổng bước TÌM chặn bằng CÙNG một câu; đối chứng dương: CHO_QUET vượt cổng", async () => {
    // Cấy lỗi C14 (ghép Việc 4 lên Việc 3, 10/10/2026) SỐNG SÓT: bảng trên chỉ thử DA_THU và CAN_XU_LY; THAT_BAI chỉ có ở ca DB `[HN3-DB-25]`, còn HUY — trạng
    // thái MỚI mà Việc 4 thêm vào enum SAU KHI cổng này được viết — không ca nào thử. Cổng là phép PHỦ ĐỊNH `!== "CHO_QUET"` nên chặn trạng thái mới "miễn phí",
    // và ca này giữ nó như vậy: lặp theo CHÍNH enum Prisma (thêm trạng thái mới là tự được thử), không theo danh sách gõ tay.
    const khac = Object.values(PosIntentStatus).filter((s) => s !== "CHO_QUET");
    expect(khac, "enum phải có HUY — kẻo vòng lặp thiếu đúng trạng thái cần canh").toContain("HUY");
    for (const status of khac) {
      const { sdb, posTerminalFindMany } = dung(phieuTot({ status }));
      expect(await chay(sdb), status).toEqual({ ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" });
      expect(posTerminalFindMany, `${status}: chưa đọc ứng viên`).not.toHaveBeenCalled();
    }
    const { sdb, posTerminalFindMany } = dung(phieuTot({ status: "CHO_QUET" }));
    await chay(sdb);
    expect(posTerminalFindMany, "đối chứng dương: CHO_QUET vượt cổng, tới bước đọc ứng viên").toHaveBeenCalledTimes(1);
  });

  it("phiếu tìm qua `paymentBill: { orderId }` — id phiếu của đơn KHÁC không thấy được (cổng IDOR)", async () => {
    const { sdb } = dung(phieuTot());
    await chay(sdb);
    expect(sdb.posPaymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "i1", paymentBill: { orderId: "o1" } } }),
    );
  });

  it("ĐỐI CHỨNG DƯƠNG: vượt mọi cổng ⇒ TỚI bước đọc ứng viên (ở đây cơ sở chưa có máy ⇒ câu riêng, khác mọi câu cổng)", async () => {
    const { sdb, posTerminalFindMany } = dung(phieuTot());
    const kq = await chay(sdb);
    expect(posTerminalFindMany).toHaveBeenCalledTimes(1);
    expect(kq).toEqual({ ok: false, error: "Cơ sở chưa có máy POS nào đang bật — báo kế toán." });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L1 · HÀNG CHỜ của kế toán
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN3-L1] docHangChoSaiMa — phân loại, che đơn ngoài tầm nhìn, trần hậu kiểm", () => {
  const CS1 = "cs1";
  const actorCs1 = {
    userId: "kt",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:manage", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [CS1] }],
    visibleCenterIds: [CS1],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;

  type Dong = {
    id: string;
    kieu: "TU_GHI_NHAN" | "CHO_KE_TOAN";
    trangThai: "CHO_DUYET" | "DANG_GHI" | "DA_GHI_NHAN" | "TU_CHOI";
    lyDo: string;
    createdAt: Date;
    dangGhiLuc: Date | null;
    nguoiGuiId: string;
    nguoiGui: { name: string | null; email: string | null };
    nguoiQuyet: { name: string | null; email: string | null } | null;
    quyetLuc: Date | null;
    lyDoTuChoi: string | null;
    bankTransactionId: string;
    bankTransaction: {
      status: "MATCHED" | "UNMATCHED" | "IGNORED";
      unmatchedNote: string | null;
      posCardTransaction: { thoiGianGiaoDich: Date; soTien: number; soTheMasked: string | null; dienGiai: string | null } | null;
    };
    intent: {
      code5: string;
      posTerminal: { maQuay: string | null; ten: string | null; maThietBi: string } | null;
      paymentBill: { order: { id: string; code: string; centerId: string } | null };
    };
  };

  let dem = 0;
  const dong = (p: Partial<Dong> = {}): Dong => {
    dem += 1;
    return {
      id: `y${dem}`,
      kieu: "CHO_KE_TOAN",
      trangThai: "CHO_DUYET",
      lyDo: ghepLyDo(["NHIEU_UNG_VIEN"]),
      createdAt: new Date(NOW.getTime() - dem * PHUT),
      dangGhiLuc: null,
      nguoiGuiId: "sale1",
      nguoiGui: { name: "Sale Một", email: "s1@test.local" },
      nguoiQuyet: null,
      quyetLuc: null,
      lyDoTuChoi: null,
      bankTransactionId: `bt${dem}`,
      bankTransaction: {
        status: "UNMATCHED",
        unmatchedNote: null,
        posCardTransaction: {
          thoiGianGiaoDich: new Date(NOW.getTime() - 30 * PHUT),
          soTien: 3_168_000,
          soTheMasked: "411111******1234",
          dienGiai: "Huynh ‮gnah ZDZ4X",
        },
      },
      intent: {
        code5: "K7M2N",
        posTerminal: { maQuay: "QTT45XWQT", ten: null, maThietBi: "SP_A" },
        paymentBill: { order: { id: "o1", code: "ORD-1", centerId: CS1 } },
      },
      ...p,
    };
  };
  const chay = async (rows: Dong[]) => {
    const findMany = vi.fn().mockResolvedValue(rows);
    const sdb = { posSaiMaYeuCau: { findMany } };
    const kq = await docHangChoSaiMa(sdb as unknown as Parameters<typeof docHangChoSaiMa>[0], actorCs1, NOW);
    return { kq, findMany };
  };

  it("đọc MỘT câu: mới nhất trước, trần 200, điều kiện = đang chờ/đang ghi HOẶC tạo/quyết trong 7 ngày", async () => {
    const { findMany } = await chay([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const a = findMany.mock.calls[0]![0] as { where: unknown; orderBy: unknown; take: number };
    const tu = new Date(NOW.getTime() - 7 * 24 * 60 * PHUT);
    expect(a.orderBy).toEqual({ createdAt: "desc" });
    expect(a.take).toBe(200);
    expect(a.where).toEqual({
      OR: [{ trangThai: { in: ["CHO_DUYET", "DANG_GHI"] } }, { createdAt: { gte: tu } }, { quyetLuc: { gte: tu } }],
    });
  });

  it("CHỜ DUYỆT → `cho` + `theoGiaoDich`; ĐANG GHI (<2′) → `cho` DANG_GHI; ĐANG GHI (≥2′) → `cho` KET (thử lại)", async () => {
    const cd = dong({ trangThai: "CHO_DUYET" });
    const dg = dong({ trangThai: "DANG_GHI", kieu: "TU_GHI_NHAN", dangGhiLuc: new Date(NOW.getTime() - 30_000) });
    const ket = dong({ trangThai: "DANG_GHI", kieu: "TU_GHI_NHAN", dangGhiLuc: new Date(NOW.getTime() - DANG_GHI_KET_SAU_MS) });
    const { kq } = await chay([cd, dg, ket]);
    expect(kq.cho.map((d) => [d.id, d.hieuLuc])).toEqual([
      [cd.id, "CHO_DUYET"],
      [dg.id, "DANG_GHI"],
      [ket.id, "KET"],
    ]);
    expect(kq.hauKiem).toEqual([]);
    expect(kq.theoGiaoDich).toEqual({
      [cd.bankTransactionId]: { hieuLuc: "CHO_DUYET", kieu: "CHO_KE_TOAN" },
      [dg.bankTransactionId]: { hieuLuc: "DANG_GHI", kieu: "TU_GHI_NHAN" },
      [ket.bankTransactionId]: { hieuLuc: "KET", kieu: "TU_GHI_NHAN" },
    });
    // Băng cảnh báo chỉ đếm việc CẦN NGƯỜI: chờ duyệt + kẹt = 2; dòng "đang ghi" (máy đang tự xử lý) KHÔNG tính.
    expect(kq.soCanXuLy).toBe(2);
  });

  it("ĐÃ GHI NHẬN · TỪ CHỐI · ĐÃ XỬ LÝ Ở NƠI KHÁC (giao dịch đã MATCHED) ⇒ `hauKiem`, KHÔNG vào `cho` và KHÔNG chip ở bảng giao dịch", async () => {
    const ghi = dong({ trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN", nguoiQuyet: null, quyetLuc: null });
    const choi = dong({
      trangThai: "TU_CHOI",
      nguoiQuyet: { name: "Kế Toán", email: null },
      quyetLuc: new Date(NOW.getTime() - 5 * PHUT),
      lyDoTuChoi: "Giao dịch của khách khác",
    });
    const ngoai = dong({ trangThai: "CHO_DUYET", bankTransaction: { ...dong().bankTransaction, status: "MATCHED" } });
    const { kq } = await chay([ghi, choi, ngoai]);
    expect(kq.cho).toEqual([]);
    expect(kq.theoGiaoDich).toEqual({});
    expect(kq.soCanXuLy, "hậu kiểm không phải việc cần làm").toBe(0);
    expect(kq.hauKiem.map((d) => [d.id, d.hieuLuc])).toEqual([
      [ghi.id, "DA_GHI_NHAN"],
      [choi.id, "TU_CHOI"],
      [ngoai.id, "DA_XU_LY_NGOAI"],
    ]);
    const c = kq.hauKiem.find((d) => d.id === choi.id)!;
    expect(c).toMatchObject({ nguoiQuyet: "Kế Toán", lyDoTuChoi: "Giao dịch của khách khác" });
  });

  it("gỡ gắn (`unmatchedNote` mang tiền tố gỡ gắn) cũng là 'đã xử lý ở nơi khác' dù giao dịch lại UNMATCHED", async () => {
    const goGan = dong({ bankTransaction: { ...dong().bankTransaction, unmatchedNote: `${TIEN_TO_GO_GAN}nhầm đơn` } });
    const { kq } = await chay([goGan]);
    expect(kq.cho, "rời hàng chờ").toEqual([]);
    expect(kq.hauKiem.map((d) => d.hieuLuc)).toEqual(["DA_XU_LY_NGOAI"]);
    // ĐỐI CHỨNG DƯƠNG: cùng cảnh, giao dịch UNMATCHED KHÔNG có ghi chú gỡ gắn ⇒ vẫn chờ duyệt.
    const thuong = await chay([dong()]);
    expect(thuong.kq.cho.map((d) => d.hieuLuc)).toEqual(["CHO_DUYET"]);
    // Ghi chú UNMATCHED bình thường (không phải tiền tố gỡ gắn) cũng không làm yêu cầu rời hàng chờ.
    const ghiChuKhac = await chay([dong({ bankTransaction: { ...dong().bankTransaction, unmatchedNote: "Chờ kế toán xác nhận" } })]);
    expect(ghiChuKhac.kq.cho.map((d) => d.hieuLuc)).toEqual(["CHO_DUYET"]);
  });

  it("CHỈ đọc CHỮ ĐÃ LÀM SẠCH: ghi chú không mang ký tự điều hướng; không số thẻ đầy đủ; không tên phụ huynh", async () => {
    const { kq } = await chay([dong()]);
    const d = kq.cho[0]!;
    expect(d.ghiChu).toBe("Huynh gnah ZDZ4X");
    expect(d.soTheCuoi).toBe("1234");
    expect(JSON.stringify(kq)).not.toMatch(/411111|‮/);
    expect(Object.keys(d).sort()).toEqual(
      [
        "bankTransactionId", "ghiChu", "gioQuet", "guiLuc", "hieuLuc", "id", "kieu", "lyDo", "lyDoTuChoi", "maDon", "maPhieu", "nguoiGui",
        "nguoiGuiId", "nguoiQuyet", "orderId", "quyetLuc", "soTheCuoi", "soTien", "tenMay", "trangThai",
      ].sort(),
    );
  });

  it("ĐƠN NGOÀI TẦM NHÌN ⇒ che HẾT dữ liệu của đơn: không mã đơn/phiếu/máy/giờ/thẻ/ghi chú, không link — vẫn có dòng để biết 'có việc'", async () => {
    const ngoai = dong({
      intent: {
        code5: "K7M2N",
        posTerminal: { maQuay: "QTT45XWQT", ten: null, maThietBi: "SP_A" },
        paymentBill: { order: { id: "o9", code: "ORD-9", centerId: "cs2" } },
      },
    });
    const trong = dong();
    const { kq } = await chay([ngoai, trong]);
    const n = kq.cho.find((d) => d.id === ngoai.id)!;
    expect(n).toMatchObject({
      orderId: null,
      maDon: "Đơn ở cơ sở khác",
      maPhieu: "—",
      tenMay: null,
      gioQuet: null,
      soTheCuoi: null,
      ghiChu: "",
    });
    expect(JSON.stringify(n), "không rò mã đơn / mã phiếu / mã máy").not.toMatch(/ORD-9|K7M2N|QTT45XWQT|SP_A|o9/);
    // ĐỐI CHỨNG DƯƠNG: đơn trong tầm nhìn có đủ.
    const t = kq.cho.find((d) => d.id === trong.id)!;
    expect(t).toMatchObject({ orderId: "o1", maDon: "ORD-1", maPhieu: "K7M2N", tenMay: "QTT45XWQT", soTheCuoi: "1234" });
  });

  it("đơn KHÔNG tồn tại (null) ⇒ cũng che, không ném", async () => {
    const { kq } = await chay([dong({ intent: { code5: "K7M2N", posTerminal: null, paymentBill: { order: null } } })]);
    expect(kq.cho[0]).toMatchObject({ orderId: null, maDon: "Đơn ở cơ sở khác" });
  });

  it("hậu kiểm: chỉ trong 7 ngày VÀ tối đa 20 dòng; yêu cầu CŨ hơn 7 ngày không vào dù DB trả về", async () => {
    // Ghim CON SỐ chứ không chỉ tham chiếu hằng: ca dưới dựng `TRAN_HAU_KIEM + 5` dòng nên nếu chỉ so với chính hằng thì đổi hằng không đỏ.
    expect(TRAN_HAU_KIEM, "trần hậu kiểm theo thiết kế (§5.3.9)").toBe(20);
    const moi = Array.from({ length: TRAN_HAU_KIEM + 5 }, () => dong({ trangThai: "DA_GHI_NHAN", kieu: "TU_GHI_NHAN" }));
    const cu = dong({
      trangThai: "TU_CHOI",
      createdAt: new Date(NOW.getTime() - 9 * 24 * 60 * PHUT),
      quyetLuc: new Date(NOW.getTime() - 8 * 24 * 60 * PHUT),
      nguoiQuyet: { name: "KT", email: null },
      lyDoTuChoi: "xa lắm rồi",
    });
    const { kq } = await chay([...moi, cu]);
    expect(kq.hauKiem).toHaveLength(TRAN_HAU_KIEM);
    expect(kq.hauKiem.map((d) => d.id)).not.toContain(cu.id);
    // Đối chứng dương: một yêu cầu CHỜ cũ hơn 7 ngày VẪN nằm ở `cho` (việc chưa xong không có hạn).
    const choCu = dong({ trangThai: "CHO_DUYET", createdAt: new Date(NOW.getTime() - 9 * 24 * 60 * PHUT) });
    const { kq: kq2 } = await chay([choCu]);
    expect(kq2.cho.map((d) => d.id)).toEqual([choCu.id]);
  });

  it("tên người gửi: tên → email → '—'", async () => {
    const { kq } = await chay([
      dong({ nguoiGui: { name: null, email: "a@b.c" } }),
      dong({ nguoiGui: { name: null, email: null } }),
    ]);
    expect(kq.cho.map((d) => d.nguoiGui)).toEqual(["a@b.c", "—"]);
  });

  it("lý do chờ kế toán được tách ra danh sách mã (thứ tự cố định)", async () => {
    const { kq } = await chay([dong({ lyDo: ghepLyDo(["GHI_CHU_LECH_NHIEU", "NHIEU_UNG_VIEN"]) })]);
    expect(kq.cho[0]!.lyDo).toEqual(["NHIEU_UNG_VIEN", "GHI_CHU_LECH_NHIEU"]);
  });

  it("CAU_KHONG_UNG_VIEN được dùng làm nguyên văn (đặc tả) — hằng không đổi", () => {
    expect(CAU_KHONG_UNG_VIEN).toBe(
      "Không thấy giao dịch nào đúng số tiền trên máy này từ lúc mở phiếu. Kiểm tra biên lai: giao dịch có THÀNH CÔNG không, đúng máy không.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HN5-L1 · BỘ NHỚ "KẾ TOÁN ĐÃ BÁC" — PHẠM VI ĐƠN (Việc 5)
// ─────────────────────────────────────────────────────────────────────────────

describe("[HN5-L1] docGiaoDichDaBiBac — vết bác khoá theo ĐƠN (phiếu thẻ → phiếu gộp → đơn), không theo phiếu thẻ, không theo phiếu gộp, không toàn hệ thống", () => {
  const dung = (rows: { bankTransactionId: string }[]) => {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { chan: { posSaiMaYeuCau: { findMany } } as unknown as Parameters<typeof docGiaoDichDaBiBac>[0], findMany };
  };

  it("hỏi ĐÚNG MỘT câu, bộ lọc ĐẦY ĐỦ (toEqual): TU_CHOI ∧ phiếu thẻ thuộc phiếu gộp thuộc ĐƠN — không `intentId`, không `paymentBillId`, không `centerId`", async () => {
    // Mã TRƯỚC Việc 5: `where: { intentId: intent.id, trangThai: "TU_CHOI" }` ở HAI nơi (đếm · lấy tập) — phiếu thẻ mới (hết hạn · huỷ · phiếu gộp đổi mã) "chưa từng bị bác".
    const { chan, findMany } = dung([]);
    await docGiaoDichDaBiBac(chan, "o1");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toEqual({
      where: { trangThai: "TU_CHOI", intent: { paymentBill: { orderId: "o1" } } },
      select: { bankTransactionId: true },
    });
  });

  it("đếm DÒNG (`soLan`) và gom GIAO DỊCH khác nhau (`giaoDich`): hai dòng bác cùng một giao dịch ⇒ soLan 2, một phần tử", async () => {
    const { chan } = dung([{ bankTransactionId: "bt1" }, { bankTransactionId: "bt2" }, { bankTransactionId: "bt1" }]);
    const kq = await docGiaoDichDaBiBac(chan, "o1");
    expect(kq.soLan).toBe(3);
    expect([...kq.giaoDich].sort()).toEqual(["bt1", "bt2"]);
  });

  it("ĐỐI CHỨNG: đơn chưa từng có vết bác ⇒ soLan 0, tập rỗng (không bao giờ `undefined`/null)", async () => {
    const { chan } = dung([]);
    const kq = await docGiaoDichDaBiBac(chan, "o-sach");
    expect(kq).toEqual({ soLan: 0, giaoDich: new Set() });
  });

  it("truyền đúng `orderId` được hỏi — hai đơn, hai câu, không dùng lại kết quả (không bộ nhớ đệm)", async () => {
    const { chan, findMany } = dung([]);
    await docGiaoDichDaBiBac(chan, "o1");
    await docGiaoDichDaBiBac(chan, "o2");
    expect(findMany.mock.calls.map((c) => (c[0] as { where: { intent: { paymentBill: { orderId: string } } } }).where.intent.paymentBill.orderId)).toEqual(["o1", "o2"]);
  });
});
