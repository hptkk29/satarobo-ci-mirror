// Ca [POS1-PRV-06..08] + FakePosProvider + chonPosProvider — tầng PROVIDER của phiếu thu thẻ. THUẦN
// (giả lập `@/lib/db` — chạy trong `pnpm test:unit` không Postgres).
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §2. Hợp đồng: provider KHÔNG NÉM (lỗi ⇒ PROVIDER_ERROR có
// mã), và mọi kết quả đi qua `posCheckResultSchema` trước khi được tin — trường hỏng ⇒
// PROVIDER_ERROR `KET_QUA_HONG`, số thẻ đầy đủ ⇒ bị che (lưới cuối, như `dongPosSchema`).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  intentFindMany: vi.fn(),
  batchFindFirst: vi.fn(),
  aggregate: vi.fn(),
  // GĐ4: provider máy đồng bộ đọc agent của cơ sở + máy của phiếu trước khi chọn chế độ.
  agentFindMany: vi.fn(async (_a: unknown): Promise<unknown[]> => []),
  terminalFindUnique: vi.fn(async (_a: unknown): Promise<unknown> => null),
}));

vi.mock("@/lib/db", () => ({
  db: {
    posCardTransaction: { findMany: h.findMany, aggregate: h.aggregate },
    posPaymentIntent: { findMany: h.intentFindMany },
    posImportBatch: { findFirst: h.batchFindFirst },
    posAgent: { findMany: h.agentFindMany },
    posTerminal: { findUnique: h.terminalFindUnique },
  },
}));

import { docKetQuaPos, posCheckResultSchema, type IntentDeKiem } from "./kieu";
import { FakePosProvider } from "./fake";
import { TcbApiProvider } from "./tcb-api";
import { TcbFileImportProvider } from "./tcb-file";
import { chonPosProvider } from "./chon";
import { sinhMa } from "@/lib/payments/ma-phieu";

const NOW = new Date("2026-10-06T10:40:00Z");
const INTENT: IntentDeKiem = {
  id: "i1",
  code5: "K7M2N",
  amount: 6_732_000,
  createdAt: new Date("2026-10-06T10:00:00Z"),
  expiresAt: new Date("2026-10-07T10:00:00Z"),
  centerId: "cs1",
  posTerminalId: null,
  bankTransactionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[POS1-PRV] provider", () => {
  it("[POS1-PRV-06] TcbFileImportProvider: DB ném ⇒ PROVIDER_ERROR TCB_FILE_DB, KHÔNG ném ra ngoài", async () => {
    h.findMany.mockRejectedValue(new Error("connection reset"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kq = await new TcbFileImportProvider().checkStatus(INTENT, NOW);
    expect(kq).toEqual({ kind: "PROVIDER_ERROR", reasonCode: "TCB_FILE_DB" });
    spy.mockRestore();
  });

  it("[POS1-PRV-07] TcbApiProvider (stub) ⇒ PROVIDER_ERROR CHUA_CAP_API; nguồn TCB_API", async () => {
    const p = new TcbApiProvider();
    expect(p.ten).toBe("TCB_API");
    expect(p.nguonDuLieu).toBe("TCB_API");
    expect(await p.checkStatus(INTENT, NOW)).toEqual({ kind: "PROVIDER_ERROR", reasonCode: "CHUA_CAP_API" });
  });

  it("[POS1-PRV-08] schema: số thẻ ĐẦY ĐỦ bị che; kết quả hỏng ⇒ PROVIDER_ERROR KET_QUA_HONG", () => {
    const ok = posCheckResultSchema.parse({ kind: "PAID", providerTxnId: "FT26279000001", amount: 1, cardMasked: "4111111111111111" });
    expect(ok.cardMasked).toBe("411111******1111");
    expect(docKetQuaPos({ kind: "PAID", providerTxnId: "x!" })).toEqual({ kind: "PROVIDER_ERROR", reasonCode: "KET_QUA_HONG" });
    expect(docKetQuaPos({ kind: "LA_LAM" })).toEqual({ kind: "PROVIDER_ERROR", reasonCode: "KET_QUA_HONG" });
    expect(docKetQuaPos(null)).toEqual({ kind: "PROVIDER_ERROR", reasonCode: "KET_QUA_HONG" });
    expect(docKetQuaPos({ kind: "PAID", providerTxnId: "FT26279000001", amount: 1.5 })).toEqual({
      kind: "PROVIDER_ERROR",
      reasonCode: "KET_QUA_HONG",
    });
    // Không có `raw` / tên chủ thẻ trong hợp đồng (T13): trường lạ bị bỏ, không lọt ra.
    const lot = posCheckResultSchema.parse({ kind: "NOT_FOUND", tenChuThe: "NGUYEN VAN A" } as unknown);
    expect(lot).toEqual({ kind: "NOT_FOUND" });
  });

  // ── Rà đối kháng 06/10/2026 ────────────────────────────────────────────────
  // Hai mock `findMany`: câu ỨNG VIÊN (theo mã) và câu DÒNG HỦY ĐÃ LƯU (theo `maGiaoDichGoc`).
  // Mã THẬT (qua checksum — D2): `tachMaPos` bỏ token không hợp lệ.
  const MA = sinhMa(1234);
  const PHIEU: IntentDeKiem = { ...INTENT, code5: MA };
  const dongFile = (p: Record<string, unknown>) => ({
    loaiGiaoDich: "Thanh toán",
    trangThai: "Thành công",
    soTien: 6_732_000,
    thoiGianGiaoDich: new Date("2026-10-06T10:31:35Z"),
    dienGiai: `Hoc phi ${MA}`,
    maChuanChi: "123456",
    soTheMasked: "411111******1111",
    maThietBi: "SP_GINI_X990",
    bankTransactionId: null,
    trangThaiHoanHuy: null,
    matchStatus: "TU_KHOP",
    matchReason: null,
    ...p,
  });
  function datFile(ungVien: unknown[], huy: unknown[] = []) {
    h.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      "maGiaoDichGoc" in args.where ? huy : ungVien,
    );
    h.intentFindMany.mockResolvedValue([]);
    h.batchFindFirst.mockResolvedValue(null);
    h.aggregate.mockResolvedValue({ _max: { thoiGianGiaoDich: null } });
  }

  it("[POS1-PRV-09] dòng 'Đang xử lý' / trạng thái lạ ⇒ KHÔNG FAILED (fail-closed: NOT_FOUND + trangThaiTreo); 'Thất bại' ⇒ FAILED", async () => {
    const p = new TcbFileImportProvider();
    for (const trangThai of ["Đang xử lý", "Chờ duyệt"]) {
      datFile([dongFile({ maGiaoDich: "FT26279000001", trangThai })]);
      const kq = await p.checkStatus(PHIEU, NOW);
      expect(kq.kind, trangThai).toBe("NOT_FOUND");
      expect(kq.trangThaiTreo, trangThai).toBeTruthy();
    }
    datFile([dongFile({ maGiaoDich: "FT26279000001", trangThai: "Đang xử lý" })]);
    expect((await p.checkStatus(PHIEU, NOW)).trangThaiTreo).toBe("DANG_XU_LY");
    // Đối chứng dương: "Thất bại" là thất bại THẬT ⇒ FAILED, mã THAT_BAI.
    datFile([dongFile({ maGiaoDich: "FT26279000001", trangThai: "Thất bại" })]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "FAILED", reasonCode: "THAT_BAI" });
    // Một dòng treo + một dòng thất bại ⇒ treo thắng (chưa ngã ngũ thì chưa mời quẹt lại).
    datFile([
      dongFile({ maGiaoDich: "FT26279000001", trangThai: "Thất bại" }),
      dongFile({ maGiaoDich: "FT26279000002", trangThai: "Đang xử lý" }),
    ]);
    expect((await p.checkStatus(PHIEU, NOW)).kind).toBe("NOT_FOUND");
  });

  it("[POS1-PRV-10] lần quẹt SỚM NHẤT đã bị HỦY TOÀN PHẦN mà còn lần quẹt khác ⇒ trả lần quẹt CÒN HIỆU LỰC", async () => {
    const p = new TcbFileImportProvider();
    const X = dongFile({ maGiaoDich: "FT26279000001", thoiGianGiaoDich: new Date("2026-10-06T10:31:35Z") });
    const Y = dongFile({ maGiaoDich: "FT26279000003", thoiGianGiaoDich: new Date("2026-10-06T10:35:00Z") });
    // (a) cột Hoàn/Hủy của gốc nói "Hủy toàn phần" (hình dạng file thật 29/09).
    datFile([{ ...X, trangThaiHoanHuy: "Hủy toàn phần" }, Y]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000003", giaoDichKhac: 0 });
    // (b) cột trống, nhưng dòng Hủy ĐÃ LƯU trỏ vào X, đúng số ⇒ toàn phần.
    const H = {
      maGiaoDich: "FT26279000002",
      loaiGiaoDich: "Hủy",
      trangThai: "Thành công",
      soTien: -6_732_000,
      maGiaoDichGoc: "FT26279000001",
      trangThaiHoanHuy: null,
    };
    datFile([X, Y], [H]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000003", giaoDichKhac: 0 });
    // Đối chứng: dòng hủy LỆCH số (một phần) ⇒ X KHÔNG bị coi là đã hủy toàn phần ⇒ X sớm nhất, thu đôi = 1.
    datFile([X, Y], [{ ...H, soTien: -1_000_000 }]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000001", giaoDichKhac: 1 });
    // (c) lượt import đã kết luận BO_QUA vì hủy toàn phần (dòng Hủy nằm ở lô SAU, chưa lưu; cột trống).
    datFile([{ ...X, matchStatus: "BO_QUA", matchReason: "Giao dịch đã bị hủy/hoàn" }, Y]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000003", giaoDichKhac: 0 });
    // Chỉ còn X (đã hủy) ⇒ vẫn trả X để pha tiền kết luận "đã hủy trên máy".
    datFile([{ ...X, trangThaiHoanHuy: "Hủy toàn phần" }]);
    expect(await p.checkStatus(PHIEU, NOW)).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000001", giaoDichKhac: 0 });
  });

  it("FakePosProvider: trả theo HÀNG của từng phiếu, hết hàng ⇒ NOT_FOUND, ghi lại `now` đã hỏi", async () => {
    const f = new FakePosProvider();
    expect(f.ten).toBe("FAKE");
    expect(f.nguonDuLieu).toBe("FAKE");
    f.datKetQua("i1", { kind: "FAILED", reasonCode: "51" }, { kind: "PAID", providerTxnId: "FT26279000001", amount: 1 });
    expect((await f.checkStatus(INTENT, NOW)).kind).toBe("FAILED");
    expect((await f.checkStatus(INTENT, NOW)).kind).toBe("PAID");
    expect((await f.checkStatus(INTENT, NOW)).kind).toBe("NOT_FOUND");
    expect((await f.checkStatus({ ...INTENT, id: "khac" }, NOW)).kind).toBe("NOT_FOUND");
    expect(f.daHoi).toHaveLength(4);
    expect(f.daHoi[0]).toEqual({ intentId: "i1", now: NOW });
  });

  // GĐ4 (07/10/2026) — T15 ĐẢO T12 GĐ1: `chonPosProvider` trả provider máy đồng bộ, provider đó tự chọn FILE /
  // AGENT theo DỮ LIỆU. Mã TRƯỚC: `chonPosProvider()` luôn `TcbFileImportProvider` (ca "GĐ1 luôn đọc dữ liệu đã
  // import"). Đối chứng: cơ sở KHÔNG có agent ⇒ kết quả y hệt provider file (chế độ FILE byte-cho-byte GĐ1).
  // [Rà đối kháng GĐ4 — RV-03/RV-09] `choDongBo: boolean` ⇒ `cheDo: SALE | MAY | IMPORT`; chế độ FILE trả thêm
  // `nguonDuLieu: "SMARTPOS"` (nhãn nguồn theo CHẾ ĐỘ đã chọn — mã TRƯỚC gắn TCB_PORTAL cho giao dịch file).
  it("[POS4-CHON-03] chonPosProvider({ cheDo }) ⇒ TcbPortalAgentProvider; cơ sở không agent ⇒ y provider file + nhãn SMARTPOS", async () => {
    for (const cheDo of ["SALE", "MAY", "IMPORT"] as const) {
      const p = chonPosProvider({ cheDo });
      expect(p.ten).toBe("TCB_AGENT");
      expect(p.nguonDuLieu).toBe("TCB_PORTAL");
    }
    datFile([dongFile({ maGiaoDich: "FT26279000001" })]);
    h.agentFindMany.mockResolvedValue([]);
    const quaAgent = await chonPosProvider({ cheDo: "SALE" }).checkStatus(PHIEU, NOW);
    const quaFile = await new TcbFileImportProvider().checkStatus(PHIEU, NOW);
    expect(quaAgent).toEqual({ ...quaFile, nguonDuLieu: "SMARTPOS" });
    expect(quaAgent).toMatchObject({ kind: "PAID", providerTxnId: "FT26279000001" });
    expect(quaAgent).not.toHaveProperty("cheDoNguon");
  });
});
