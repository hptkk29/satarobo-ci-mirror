import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhieuPhatHanh } from "./cong";
import type { CauHinhHsm } from "./cau-hinh";
import { _xoaBoNhoTokenChoTest, giaiMaTep, taoCongHsm, type FetchLike } from "./http";
import { congHoaDonTuEnv } from "./index";

const MAT_KHAU = "Mk-bi-mat-9f3a7c";
const APP_ID = "app-bi-mat-77d1";
const TOKEN_1 = "jwt.token.mot";
const TOKEN_2 = "jwt.token.hai";
const REF = "7d3c1e2a-5b4f-4c8e-9a01-2b3c4d5e6f70";
const MST = "0402145678";
const BASE = "https://testapi.meinvoice.vn/api/v3";

const cauHinh: CauHinhHsm = {
  cheDo: "sandbox",
  baseUrl: BASE,
  appId: APP_ID,
  username: "ketoan@satarobo.vn",
  password: MAT_KHAU,
  loaiHoaDon: "co-ma",
};

function phieuMau(ghiDe: Partial<PhieuPhatHanh> = {}): PhieuPhatHanh {
  return {
    refId: REF,
    kyHieu: "1C26TSR",
    mstNguoiBan: MST,
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: "Đà Nẵng", email: null },
    hinhThucThanhToan: "TM/CK",
    dong: [
      { stt: 1, ten: "Học phí Sata 4", donViTinh: "Khoá", soLuong: 1, donGia: 18518518.52, thanhTien: 18518519, thueSuat: 8, tienThue: 1481481 },
    ],
    tongTruocThue: 18518519,
    tongThue: 1481481,
    tongThanhToan: 20000000,
    soTienBangChu: "Hai mươi triệu đồng.",
    ...ghiDe,
  };
}

type Goi = { url: string; headers: Record<string, string>; body: string };
type TraLoi = (g: Goi, signal: AbortSignal | undefined) => Promise<Response> | Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const tokenOk = (t: string) => json(200, { Success: true, ErrorCode: null, Data: t });
const phOk = (ref = REF) =>
  json(200, {
    Success: true,
    ErrorCode: null,
    Errors: [],
    Data: JSON.stringify([
      { RefID: ref, TransactionID: "QWIGTN63E_", InvTemplateNo: "1", InvSeries: "C26TSR", InvNo: "00000321", InvDate: "2026-09-30T00:00:00+07:00", ErrorCode: "" },
    ]),
  });

/** fetch giả: `token` trả lời /auth/token, `khac` trả lời mọi đường khác theo thứ tự gọi. */
function fetchGia(token: TraLoi[], khac: TraLoi[]) {
  const calls: Goi[] = [];
  let iT = 0;
  let iK = 0;
  const f: FetchLike = async (url, init) => {
    const g: Goi = { url, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") };
    calls.push(g);
    const signal = init?.signal ?? undefined;
    if (url.endsWith("/auth/token")) {
      const h = token[iT++];
      if (!h) throw new Error(`gọi token quá số lần dự kiến (${iT})`);
      return h(g, signal);
    }
    const h = khac[iK++];
    if (!h) throw new Error(`gọi API quá số lần dự kiến (${iK}): ${url}`);
    return h(g, signal);
  };
  return { f, calls, api: () => calls.filter((c) => !c.url.endsWith("/auth/token")), tok: () => calls.filter((c) => c.url.endsWith("/auth/token")) };
}

/** Không bao giờ trả lời — chỉ kết thúc khi bị huỷ (mô phỏng MISA im lặng tới timeout). */
const treo: TraLoi = (_g, signal) =>
  new Promise<Response>((_res, rej) => {
    signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

let logs: string[];
beforeEach(() => {
  _xoaBoNhoTokenChoTest();
  logs = [];
});
afterEach(() => vi.restoreAllMocks());

function cong(f: FetchLike, now?: () => number) {
  return taoCongHsm({ cauHinh, fetchImpl: f, now, log: (s) => logs.push(s), thoiGianCho: { phatHanh: 30, khac: 30 } });
}

describe("[MEI-HT] cổng HSM qua HTTP (fetch giả)", () => {
  it("[MEI-HT-01] phát hành thành công: token rồi publishhsm (có mã), header CompanyTaxCode = MST người bán", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => phOk()]);
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq).toMatchObject({ loai: "DA_PHAT_HANH", soHoaDon: "00000321", maTraCuu: "QWIGTN63E_", kyHieu: "1C26TSR" });
    const tok = fg.tok()[0]!;
    expect(tok.url).toBe(`${BASE}/auth/token`);
    expect(JSON.parse(tok.body)).toEqual({ appid: APP_ID, taxcode: MST, username: "ketoan@satarobo.vn", password: MAT_KHAU });
    const ph = fg.api()[0]!;
    expect(ph.url).toBe(`${BASE}/code/itg/invoicepublishing/publishhsm`);
    expect(ph.headers.CompanyTaxCode).toBe(MST);
    expect(ph.headers.Authorization).toBe(`Bearer ${TOKEN_1}`);
    const body = JSON.parse(ph.body) as Array<{ RefID: string; IsSendEmail: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.RefID).toBe(REF);
    expect(body[0]!.IsSendEmail).toBe(false);
  });

  it("[MEI-HT-02] timeout ⇒ KHONG_RO và KHÔNG gửi lại", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [treo]);
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq.loai).toBe("KHONG_RO");
    expect(fg.api()).toHaveLength(1);
  });

  it("[MEI-HT-03] lỗi mạng ⇒ KHONG_RO, không gửi lại", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => Promise.reject(new TypeError("fetch failed"))]);
    expect((await cong(fg.f).phatHanh(phieuMau())).loai).toBe("KHONG_RO");
    expect(fg.api()).toHaveLength(1);
  });

  it("[MEI-HT-04] 5xx ⇒ KHONG_RO, không gửi lại; 400 cũng KHONG_RO", async () => {
    for (const st of [500, 502, 503, 400]) {
      _xoaBoNhoTokenChoTest();
      const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => json(st, { Success: false })]);
      expect((await cong(fg.f).phatHanh(phieuMau())).loai, String(st)).toBe("KHONG_RO");
      expect(fg.api()).toHaveLength(1);
    }
  });

  it("[MEI-HT-05] 401 ⇒ làm mới token MỘT lần rồi gửi lại, dùng token mới", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)], [() => json(401, {}), () => phOk()]);
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq.loai).toBe("DA_PHAT_HANH");
    expect(fg.tok()).toHaveLength(2);
    expect(fg.api().map((c) => c.headers.Authorization)).toEqual([`Bearer ${TOKEN_1}`, `Bearer ${TOKEN_2}`]);
  });

  it("[MEI-HT-06] 401 hai lần ⇒ dừng sau một lần làm mới (TU_CHOI đăng nhập), không vòng lặp", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)], [() => json(401, {}), () => json(401, {})]);
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "MISA_DANG_NHAP" });
    expect(fg.api()).toHaveLength(2);
  });

  it("[MEI-HT-07] TokenExpiredCode trong thân (HTTP 200) ⇒ cũng làm mới một lần", async () => {
    const fg = fetchGia(
      [() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)],
      [() => json(200, { Success: false, ErrorCode: "TokenExpiredCode" }), () => phOk()],
    );
    expect((await cong(fg.f).phatHanh(phieuMau())).loai).toBe("DA_PHAT_HANH");
    expect(fg.tok()).toHaveLength(2);
  });

  it("[MEI-HT-08] token cache theo thời hạn: hai lượt ⇒ một lần lấy token; quá hạn ⇒ lấy lại", async () => {
    let t = 1_000_000;
    const fg = fetchGia([() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)], [() => phOk(), () => phOk(), () => phOk()]);
    const c = cong(fg.f, () => t);
    await c.phatHanh(phieuMau());
    await c.phatHanh(phieuMau());
    expect(fg.tok()).toHaveLength(1);
    t += 15 * 24 * 60 * 60 * 1000;
    await c.phatHanh(phieuMau());
    expect(fg.tok()).toHaveLength(2);
    expect(fg.api()[2]!.headers.Authorization).toBe(`Bearer ${TOKEN_2}`);
  });

  it("[MEI-HT-09] token cache theo MST: pháp nhân khác ⇒ token riêng, CompanyTaxCode theo phiếu", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)], [() => phOk(), () => phOk()]);
    const c = cong(fg.f);
    await c.phatHanh(phieuMau());
    await c.phatHanh(phieuMau({ mstNguoiBan: "0401111111" }));
    expect(fg.tok()).toHaveLength(2);
    expect(fg.api().map((x) => x.headers.CompanyTaxCode)).toEqual([MST, "0401111111"]);
  });

  it("[MEI-HT-10] lấy token thất bại ⇒ TU_CHOI đăng nhập, publishhsm KHÔNG được gọi", async () => {
    const fg = fetchGia([() => json(200, { Success: false, ErrorCode: "UnAuthorize" })], []);
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "MISA_DANG_NHAP" });
    expect(fg.api()).toHaveLength(0);
  });

  it("[MEI-HT-11] InvoiceDuplicated ⇒ tự tra cứu; tra ra số ⇒ DA_PHAT_HANH", async () => {
    const fg = fetchGia(
      [() => tokenOk(TOKEN_1)],
      [
        () => json(200, { Success: true, Data: JSON.stringify([{ RefID: REF, ErrorCode: "InvoiceDuplicated" }]) }),
        () =>
          json(200, {
            Success: true,
            Data: JSON.stringify([{ RefID: REF, InvNo: "00000009", InvDate: "2026-09-30T00:00:00+07:00", InvSeries: "C26TSR", InvTempl: "1", TransactionID: "TC9", EInvoiceStatus: 1 }]),
          }),
      ],
    );
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq).toMatchObject({ loai: "DA_PHAT_HANH", soHoaDon: "00000009", maTraCuu: "TC9" });
    expect(fg.api()[1]!.url).toBe(`${BASE}/code/invoicepublished/invoice-status/refid`);
    expect(JSON.parse(fg.api()[1]!.body)).toEqual([REF]);
  });

  it("[MEI-HT-12] InvoiceDuplicated mà tra cứu không ra ⇒ KHONG_RO (không bao giờ CHUA_CO/TU_CHOI)", async () => {
    const fg = fetchGia(
      [() => tokenOk(TOKEN_1)],
      [() => json(200, { Success: true, Data: JSON.stringify([{ RefID: REF, ErrorCode: "InvoiceDuplicated" }]) }), () => json(200, { Success: true, Data: "[]" })],
    );
    const kq = await cong(fg.f).phatHanh(phieuMau());
    expect(kq.loai).toBe("KHONG_RO");
    expect(kq.loai === "KHONG_RO" ? kq.thongDiep : "").toMatch(/đã tồn tại, cần tra cứu/);
  });

  it("[MEI-HT-13] phiếu sai / ký hiệu lệch loại cấu hình ⇒ TU_CHOI, KHÔNG gọi mạng", async () => {
    const fg = fetchGia([], []);
    const c = cong(fg.f);
    expect((await c.phatHanh(phieuMau({ tongThanhToan: 1 }))).loai).toBe("TU_CHOI");
    expect((await c.phatHanh(phieuMau({ kyHieu: "1K26TSR" }))).loai).toBe("TU_CHOI");
    expect(fg.calls).toHaveLength(0);
  });

  it("[MEI-HT-14] không mã ⇒ đường dẫn không có /code", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => phOk()]);
    const c = taoCongHsm({ cauHinh: { ...cauHinh, loaiHoaDon: "khong-ma" }, fetchImpl: fg.f, log: () => {} });
    await c.phatHanh(phieuMau({ kyHieu: "1K26TSR" }));
    expect(fg.api()[0]!.url).toBe(`${BASE}/itg/invoicepublishing/publishhsm`);
  });

  it("[MEI-HT-15] tra cứu: timeout / 5xx ⇒ KHONG_RO; mảng rỗng ⇒ CHUA_CO", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [treo, () => json(503, {}), () => json(200, { Success: true, Data: "[]" })]);
    const c = cong(fg.f);
    expect((await c.traCuu(REF, MST)).loai).toBe("KHONG_RO");
    expect((await c.traCuu(REF, MST)).loai).toBe("KHONG_RO");
    expect(await c.traCuu(REF, MST)).toEqual({ loai: "CHUA_CO" });
  });

  it("[MEI-HT-16] tải PDF: base64 ⇒ byte bắt đầu %PDF; URL downloadDataType=PDF, body [mã tra cứu]", async () => {
    const pdf = Buffer.from("%PDF-1.4\n...", "latin1").toString("base64");
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => json(200, { Success: true, Data: JSON.stringify([{ TransactionID: "TC9", Data: pdf, ErrorCode: "" }]) })]);
    const bytes = await cong(fg.f).taiTep("TC9", "pdf", MST);
    expect(Buffer.from(bytes).subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(fg.api()[0]!.url).toBe(`${BASE}/code/itg/invoicepublished/downloadinvoice?downloadDataType=PDF`);
    expect(JSON.parse(fg.api()[0]!.body)).toEqual(["TC9"]);
  });

  it("[MEI-HT-17] giải mã tệp: XML thô / XML base64 nhận; PDF hỏng ⇒ ném", () => {
    expect(Buffer.from(giaiMaTep("<HDon/>", "xml")).toString()).toBe("<HDon/>");
    expect(Buffer.from(giaiMaTep(Buffer.from("<HDon/>").toString("base64"), "xml")).toString()).toBe("<HDon/>");
    expect(() => giaiMaTep(Buffer.from("khong phai pdf").toString("base64"), "pdf")).toThrow(/PDF/);
  });

  it("[MEI-HT-18] KHÔNG lộ mật khẩu/appid/token ra console.* và log (mọi nhánh lỗi)", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const kichBan: Array<[TraLoi[], TraLoi[]]> = [
      [[() => tokenOk(TOKEN_1)], [treo]],
      [[() => tokenOk(TOKEN_1)], [() => json(500, { Errors: ["x"] })]],
      [[() => tokenOk(TOKEN_1), () => tokenOk(TOKEN_2)], [() => json(401, {}), () => json(401, {})]],
      [[() => json(200, { Success: false, ErrorCode: "UnAuthorize" })], []],
      [[() => tokenOk(TOKEN_1)], [() => json(200, { Success: true, Data: JSON.stringify([{ RefID: REF, ErrorCode: "InvalidTaxCode" }]) })]],
    ];
    for (const [t, k] of kichBan) {
      _xoaBoNhoTokenChoTest();
      const fg = fetchGia(t, k);
      // log mặc định (console.warn) — không tiêm log
      const c = taoCongHsm({ cauHinh, fetchImpl: fg.f, thoiGianCho: { phatHanh: 30, khac: 30 } });
      const kq = await c.phatHanh(phieuMau());
      const s = JSON.stringify(kq);
      for (const bi of [MAT_KHAU, APP_ID, TOKEN_1, TOKEN_2]) expect(s).not.toContain(bi);
    }
    const tatCa = spies.flatMap((s) => s.mock.calls.map((a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
    expect(tatCa.length).toBeGreaterThan(0); // đối chứng dương: log CÓ được ghi
    for (const dong of tatCa) {
      for (const bi of [MAT_KHAU, APP_ID, TOKEN_1, TOKEN_2]) expect(dong).not.toContain(bi);
    }
  });

  it("[MEI-HT-19] congHoaDonTuEnv dùng fetch tiêm vào", async () => {
    const fg = fetchGia([() => tokenOk(TOKEN_1)], [() => phOk()]);
    const c = congHoaDonTuEnv(
      {
        MISA_EINVOICE_MODE: "sandbox",
        MISA_EINVOICE_BASE_URL: BASE,
        MISA_EINVOICE_APP_ID: APP_ID,
        MISA_EINVOICE_USERNAME: "u",
        MISA_EINVOICE_PASSWORD: MAT_KHAU,
        MISA_EINVOICE_LOAI_HOA_DON: "co-ma",
      },
      fg.f,
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await c!.phatHanh(phieuMau())).loai).toBe("DA_PHAT_HANH");
  });
});
