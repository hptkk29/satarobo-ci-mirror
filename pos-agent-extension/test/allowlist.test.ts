/**
 * ALLOWLIST CHẶN CỨNG (đặc tả GĐ5 + roadmap §6 GĐ5): content-main chỉ được gọi đúng HAI thứ
 *
 *   GET  https://merchant.techcombank.com/api/auth/session
 *   POST https://merchant.techcombank.com/api/partners/merchant-portal/{merchantCode}/v2/transactions/search
 *
 * với ĐÚNG merchantCode cấu hình. Mọi URL khác — hoàn trả, nhân viên, đổi mật khẩu, đăng
 * xuất, merchant khác, biến thể path/query/encode — bị từ chối TRƯỚC khi chạm mạng.
 *
 * Test chạy trên MÃ THẬT của content-main (biên dịch như lúc đóng gói, nạp vào `node:vm`) và
 * đếm lời gọi tới portal giả: bị chặn nghĩa là `fetch` của trang KHÔNG được gọi lần nào.
 */
import { describe, expect, it } from "vitest";
import { lenhPhien, lenhTimKiem } from "../src/lib/portal";
import { MERCHANT, MERCHANT_KHAC, PORTAL, URL_PHIEN, URL_TIM_KIEM } from "./ho-tro/du-lieu";
import { taoTrangMain } from "./ho-tro/main-don";
import { choTroi } from "./ho-tro/the-gioi";

const THAN_HOP_LE = {
  page_index: 0,
  page_size: 50,
  transaction_time_from: "2026-10-07 08:20:00",
  transaction_time_to: "2026-10-07 10:20:00",
};

function lenh(phuongThuc: string, url: string, merchantCode = MERCHANT, than: unknown = THAN_HOP_LE) {
  return phuongThuc === "GET"
    ? { loai: "GOI", phuongThuc, url, merchantCode }
    : { loai: "GOI", phuongThuc, url, merchantCode, than };
}

const P = `${PORTAL}/api/partners/merchant-portal/${MERCHANT}/v2`;

/** [mã ca, phương thức, URL] — mọi dòng PHẢI bị chặn. */
const BI_CHAN: ReadonlyArray<readonly [string, string, string]> = [
  ["hoan-tra", "POST", `${P}/transactions/refund`],
  ["hoan-tra-2", "POST", `${P}/refunds`],
  ["huy-giao-dich", "POST", `${P}/transactions/void`],
  ["nhan-vien", "GET", `${P}/employees`],
  ["nhan-vien-them", "POST", `${PORTAL}/api/partners/merchant-portal/${MERCHANT}/staffs`],
  ["doi-mat-khau", "POST", `${PORTAL}/api/auth/change-password`],
  ["doi-mat-khau-2", "POST", `${PORTAL}/api/users/me/password`],
  ["dang-xuat", "POST", `${PORTAL}/api/auth/signout`],
  ["dang-xuat-get", "GET", `${PORTAL}/api/auth/signout`],
  ["csrf", "GET", `${PORTAL}/api/auth/csrf`],
  ["merchant-khac", "POST", `${PORTAL}/api/partners/merchant-portal/${MERCHANT_KHAC}/v2/transactions/search`],
  ["merchant-chu-thuong", "POST", `${PORTAL}/api/partners/merchant-portal/nccph6ke/v2/transactions/search`],
  ["query", "POST", `${URL_TIM_KIEM}?page_size=100000`],
  ["query-rong", "POST", `${URL_TIM_KIEM}?`],
  ["fragment", "POST", `${URL_TIM_KIEM}#x`],
  ["gach-cuoi", "POST", `${URL_TIM_KIEM}/`],
  ["dot-segment", "POST", `${URL_TIM_KIEM}/../refund`],
  ["dot-segment-2", "POST", `${P}/transactions/../transactions/search`],
  ["encode-dot", "POST", `${URL_TIM_KIEM}/%2e%2e/refund`],
  ["encode-slash", "POST", `${PORTAL}/api/partners/merchant-portal/${MERCHANT}%2Fv2%2Ftransactions%2Fsearch`],
  ["encode-chu", "POST", `${P}/transactions/%73earch`],
  ["hai-gach", "POST", `${PORTAL}//api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["gach-nguoc", "POST", `${PORTAL}\\api\\partners\\merchant-portal\\${MERCHANT}\\v2\\transactions\\search`],
  ["host-khac", "POST", `https://evil.example/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["host-gia-mao", "POST", `https://merchant.techcombank.com.evil.example/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["userinfo", "POST", `https://bot@merchant.techcombank.com/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["http", "POST", `http://merchant.techcombank.com/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["cong-443", "POST", `https://merchant.techcombank.com:443/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["host-chu-hoa", "POST", `https://MERCHANT.techcombank.com/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["tuong-doi", "POST", `/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`],
  ["search-sai-phuong-thuc", "GET", URL_TIM_KIEM],
  ["session-sai-phuong-thuc", "POST", URL_PHIEN],
  ["session-query", "GET", `${URL_PHIEN}?update=1`],
  ["phuong-thuc-chu-thuong", "post", URL_TIM_KIEM],
  ["delete", "DELETE", URL_TIM_KIEM],
  ["khoang-trang", "POST", ` ${URL_TIM_KIEM}`],
];

describe("Allowlist chặn cứng của content-main (world MAIN)", () => {
  it("[EXT-AL-01] bảng chặn có ≥ 10 URL và phủ đủ nhóm đặc tả (hoàn trả, nhân viên, đổi mật khẩu, đăng xuất, merchant khác, query, encode)", () => {
    expect(BI_CHAN.length).toBeGreaterThanOrEqual(10);
    const ma = BI_CHAN.map((d) => d[0]);
    for (const nhom of ["hoan-tra", "nhan-vien", "doi-mat-khau", "dang-xuat", "merchant-khac", "query", "encode-dot", "encode-slash"]) {
      expect(ma).toContain(nhom);
    }
  });

  for (const [ma, phuongThuc, url] of BI_CHAN) {
    it(`[EXT-AL-02/${ma}] chặn: ${phuongThuc} ${url} ⇒ URL_BLOCKED, fetch của trang KHÔNG được gọi`, async () => {
      const t = taoTrangMain();
      await t.appTimKiem(); // có header sẵn ⇒ nếu lọt allowlist thì CHẮC CHẮN đã gọi được
      const truoc = t.portal.goi.length;
      const kq = await t.gui(lenh(phuongThuc, url));
      expect(kq).toMatchObject({ loai: "LOI", ma: "URL_BLOCKED" });
      expect(t.portal.goi.length).toBe(truoc);
    });
  }

  it("[EXT-AL-03] merchantCode trong lệnh bị tiêm path (NCCPH6KE/../x) ⇒ chặn dù URL dựng từ chính nó", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    const truoc = t.portal.goi.length;
    const ma = `${MERCHANT}/../x`;
    const kq = await t.gui(lenh("POST", `${PORTAL}/api/partners/merchant-portal/${ma}/v2/transactions/search`, ma));
    expect(kq).toMatchObject({ loai: "LOI", ma: "URL_BLOCKED" });
    expect(t.portal.goi.length).toBe(truoc);
  });

  it("[EXT-AL-04] merchant KHÁC nhưng lệnh khai khớp (giả mạo nhất quán) ⇒ không có header của app cho merchant đó ⇒ không gọi", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    const truoc = t.portal.goi.length;
    const url = `${PORTAL}/api/partners/merchant-portal/${MERCHANT_KHAC}/v2/transactions/search`;
    const kq = await t.gui(lenh("POST", url, MERCHANT_KHAC));
    expect(kq).toMatchObject({ loai: "LOI", ma: "HEADER_NOT_CAPTURED" });
    expect(t.portal.goi.length).toBe(truoc);
  });

  it("[EXT-AL-05] đối chứng DƯƠNG: đúng hai lời gọi được phép thì ĐI, đúng URL + đúng phương thức", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    const truoc = t.portal.goi.length;
    const p = await t.gui(lenh("GET", URL_PHIEN));
    expect(p).toMatchObject({ loai: "PHIEN", coUser: true });
    const s = await t.gui(lenh("POST", URL_TIM_KIEM));
    expect(s).toMatchObject({ loai: "TRANG" });
    const moi = t.portal.goi.slice(truoc);
    expect(moi.map((g) => `${g.method} ${g.url}`)).toEqual([`GET ${URL_PHIEN}`, `POST ${URL_TIM_KIEM}`]);
  });

  it("[EXT-AL-06] lệnh từ nguồn LẠ (khác origin / cửa sổ khác) bị bỏ qua im lặng — không gọi, không trả lời", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    const truoc = t.portal.goi.length;
    const traLoi: unknown[] = [];
    t.chung.dangKy((ev) => {
      const d = ev.data as { huong?: string };
      if (d && d.huong === "ket-qua") traLoi.push(d);
    }, {});
    const tin = { kenh: "satarobo-pos-agent", huong: "lenh", id: "f".repeat(32), lenh: lenh("GET", URL_PHIEN) };
    t.chung.dangTuNgoai(tin, "https://evil.example", t.main); // iframe khác origin
    t.chung.dangTuNgoai(tin, PORTAL, { window: "khac" }); // cửa sổ khác cùng origin
    t.chung.dangTuNgoai({ ...tin, kenh: "kenh-khac" }, PORTAL, t.main); // sai kênh
    await choTroi(20);
    expect(t.portal.goi.length).toBe(truoc);
    expect(traLoi).toEqual([]);
  });

  it("[EXT-AL-07] thân lệnh search lạ (khoá thừa, sai kiểu, sai định dạng giờ) ⇒ BAD_COMMAND, không gọi", async () => {
    const t = taoTrangMain();
    await t.appTimKiem();
    const truoc = t.portal.goi.length;
    const xau: unknown[] = [
      { ...THAN_HOP_LE, extra: 1 },
      { ...THAN_HOP_LE, page_size: "50" },
      { ...THAN_HOP_LE, page_size: 100000 },
      { ...THAN_HOP_LE, transaction_time_from: "2026-10-07T08:20:00Z" },
      { ...THAN_HOP_LE, page_index: -1 },
      null,
    ];
    for (const than of xau) {
      expect(await t.gui(lenh("POST", URL_TIM_KIEM, MERCHANT, than))).toMatchObject({ loai: "LOI", ma: "BAD_COMMAND" });
    }
    // GET session KHÔNG được mang thân
    expect(await t.gui({ loai: "GOI", phuongThuc: "GET", url: URL_PHIEN, merchantCode: MERCHANT, than: {} })).toMatchObject({
      loai: "LOI",
      ma: "BAD_COMMAND",
    });
    expect(await t.gui({ loai: "XOA_HET" })).toMatchObject({ loai: "LOI", ma: "BAD_COMMAND" });
    expect(t.portal.goi.length).toBe(truoc);
  });
});

describe("Phía service worker chỉ DỰNG được hai lệnh hợp lệ", () => {
  it("[EXT-AL-08] lenhPhien / lenhTimKiem ra đúng hai URL của allowlist", () => {
    expect(lenhPhien(MERCHANT)).toEqual({ loai: "GOI", phuongThuc: "GET", url: URL_PHIEN, merchantCode: MERCHANT });
    const l = lenhTimKiem(MERCHANT, { tu: Date.parse("2026-10-07T08:20:00+07:00"), den: Date.parse("2026-10-07T10:20:00+07:00") }, 2, 50);
    expect(l).toEqual({ loai: "GOI", phuongThuc: "POST", url: URL_TIM_KIEM, merchantCode: MERCHANT, than: { ...THAN_HOP_LE, page_index: 2 } });
  });

  it("[EXT-AL-09] merchantCode sai dạng ⇒ KHÔNG dựng lệnh (ném), không có đường tạo URL lạ", () => {
    for (const m of ["nccph6ke", "NCC/PH6KE", "NCCPH6KE?x", "", "NCC PH6KE", "../NCCPH6KE", "NCCPH6KE%2F"]) {
      expect(() => lenhTimKiem(m, { tu: 0, den: 1 }, 0, 50)).toThrow();
      expect(() => lenhPhien(m)).toThrow();
    }
  });
});
