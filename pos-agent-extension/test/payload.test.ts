/**
 * Payload gửi satarobo CHỈ gồm trường giao dịch của hợp đồng §6.1 (bỏ `sender_card_name`,
 * bỏ `device_id`), KHÔNG BAO GIỜ có header / cookie / token / deviceId của phiên portal (D10).
 *
 * Hai lớp, cả hai đều được kiểm:
 *   1. content-main chỉ NHẶT các khoá whitelist trước khi đưa dòng ra khỏi trang;
 *   2. service worker CHUẨN HOÁ lại theo whitelist + kiểu dữ liệu trước khi ký và gửi.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KHOA_CAM, KHOA_GIAO_DICH, TRAN_GIAO_DICH, cheSoThe, chuanHoaGiaoDich, timKhoaCam } from "../src/lib/payload";
import { CHUOI_CAM, MERCHANT, URL_PHIEN, URL_TIM_KIEM, dongPortal, timChuoiCam } from "./ho-tro/du-lieu";
import { bangTranHopDong } from "./ho-tro/hop-dong";
import { taoTrangMain } from "./ho-tro/main-don";

const HOP_DONG = readFileSync(resolve(process.cwd(), "docs/pos-agent-api.md"), "utf8").replace(/\r\n/g, "\n");

/** Khoá ở cột đầu bảng §6.1 của hợp đồng (tách cả các ô gộp bằng "·"). */
function khoaTheoHopDong(): string[] {
  const batDau = HOP_DONG.indexOf("### 6.1");
  const ketThuc = HOP_DONG.indexOf("### 6.2");
  const bang = HOP_DONG.slice(batDau, ketThuc);
  const ra: string[] = [];
  for (const dong of bang.split("\n")) {
    const m = /^\| ((?:`[a-z_]+`(?: · )?)+) \|/.exec(dong);
    if (!m) continue;
    for (const k of m[1].matchAll(/`([a-z_]+)`/g)) ra.push(k[1]);
  }
  return ra;
}

describe("Whitelist trường giao dịch (hợp đồng §6.1)", () => {
  it("[EXT-PL-01] KHOA_GIAO_DICH = ĐÚNG tập khoá bảng §6.1 của hợp đồng, cùng thứ tự", () => {
    const hd = khoaTheoHopDong();
    expect(hd.length).toBe(26);
    expect([...KHOA_GIAO_DICH]).toEqual(hd);
    expect(KHOA_GIAO_DICH).not.toContain("sender_card_name");
    expect(KHOA_GIAO_DICH).not.toContain("device_id");
  });

  it("[EXT-PL-02] dòng portal 'nhiễm độc' ⇒ chỉ còn khoá whitelist; không tên chủ thẻ, không device_id, không token", () => {
    const ra = chuanHoaGiaoDich(dongPortal());
    expect(ra).not.toBeNull();
    const khoa = Object.keys(ra ?? {});
    for (const k of khoa) expect(KHOA_GIAO_DICH).toContain(k);
    expect(khoa).not.toContain("sender_card_name");
    expect(khoa).not.toContain("device_id");
    expect(khoa).not.toContain("user");
    expect(timChuoiCam(ra)).toBeNull();
    expect(timKhoaCam(ra)).toBeNull();
  });

  it("[EXT-PL-03] chuẩn hoá kiểu: số→chuỗi cho mã, giữ số tiền hợp lệ, bỏ giá trị lồng, rỗng→null, cắt mô tả", () => {
    const ra = chuanHoaGiaoDich(
      dongPortal({
        authorization_id: 123456,
        card_transaction_id: "  628012345678  ",
        order_amount: "6732000",
        transaction_master_amount: "6732000.0",
        transaction_detail_amount: "6.732.000",
        fee: { so: 1 },
        tax: "0.5",
        currency: 704,
        store_code: "",
        merchant_order_id: ["x"],
        order_description: "A".repeat(4100),
        transaction_operation_msg: "B".repeat(600),
        tcb_transaction_id: "C".repeat(65),
        terminal_code: true,
      }),
    );
    expect(ra).toMatchObject({
      authorization_id: "123456",
      card_transaction_id: "628012345678",
      order_amount: "6732000",
      transaction_master_amount: "6732000.0",
      transaction_detail_amount: null,
      fee: null,
      tax: "0.5",
      currency: "704",
      store_code: null,
      merchant_order_id: null,
      tcb_transaction_id: null,
      terminal_code: null,
    });
    expect(ra?.order_description).toHaveLength(4000);
    expect(ra?.transaction_operation_msg).toHaveLength(500);
  });

  it("[EXT-PL-04] số thẻ: portal đã che thì giữ; lỡ trả số ĐẦY ĐỦ thì che lại 6 đầu + 4 cuối trước khi gửi", () => {
    expect(cheSoThe("411111******1111")).toBe("411111******1111");
    expect(cheSoThe("4111111111111111")).toBe("411111******1111");
    expect(cheSoThe("4111 1111 1111 1111")).toBe("411111******1111");
    expect(cheSoThe("VISA 4111-1111-1111-1111")).toBe("411111******1111");
    expect(chuanHoaGiaoDich(dongPortal({ sender_card_number: "4111111111111111" }))?.sender_card_number).toBe(
      "411111******1111",
    );
  });

  it("[EXT-PL-05] timKhoaCam bắt khoá cấm ở MỌI độ sâu, không phân biệt hoa thường", () => {
    expect(timKhoaCam({ a: [{ b: { "X-API-Auth": "1" } }] })).toBe("a[0].b.X-API-Auth");
    expect(timKhoaCam({ transactions: [{ sender_card_name: "x" }] })).toBe("transactions[0].sender_card_name");
    expect(timKhoaCam({ accessToken: "x" })).toBe("accessToken");
    expect(timKhoaCam({ refreshtoken: "x" })).toBe("refreshtoken");
    expect(timKhoaCam({ ok: 1, list: [1, "a", null] })).toBeNull();
    for (const k of ["sender_card_name", "device_id", "deviceid", "accesstoken", "x-api-payment", "cookie"]) {
      expect(KHOA_CAM).toContain(k);
    }
  });

  it("[EXT-PL-06] dòng không phải object ⇒ null (không ném, không gửi)", () => {
    for (const x of [null, undefined, 1, "x", [dongPortal()]]) expect(chuanHoaGiaoDich(x)).toBeNull();
  });

  it("[EXT-PL-08] HỢP ĐỒNG 1.1 — TRAN_GIAO_DICH = ĐÚNG cột 'Trần · vượt (agent)' bảng §6.1 (đọc thẳng hợp đồng; máy chủ so CÙNG cột: [POS4-HD-01]); vượt ⇒ cắt / null đúng cột; bốn khoá fail-closed luôn CẮT; tiền '.000…' dài ⇒ số nguyên; tiền tệ dài ⇒ KHÔNG thành VND", () => {
    // (1) bảng hợp đồng = hằng của extension — 26 khoá, cùng thứ tự whitelist, mọi khoá có ô "≤ N · cắt|null"
    const hd = bangTranHopDong();
    expect(hd.size).toBe(26);
    expect([...hd.keys()]).toEqual([...KHOA_GIAO_DICH]);
    const tuHopDong: Record<string, { tran: number | undefined; qua: string }> = {};
    for (const k of KHOA_GIAO_DICH) {
      const o = hd.get(k);
      expect(o, `${k}: thiếu ô "≤ N · cắt|null" trong hợp đồng`).not.toBeNull();
      tuHopDong[k] = { tran: o?.tran, qua: o?.cach === "cắt" ? "cat" : "null" };
    }
    expect(TRAN_GIAO_DICH).toEqual(tuHopDong); // so CẢ bảng một lần — lệch khoá nào cũng in ra
    // Bốn khoá mà null = máy chủ BỎ một phép kiểm (fail-open) ⇒ hợp đồng ghi "cắt", extension cắt.
    for (const k of ["transaction_detail_status", "transaction_master_status", "currency", "store_code"] as const) {
      expect(hd.get(k)?.cach, k).toBe("cắt");
      expect(TRAN_GIAO_DICH[k].qua, k).toBe("cat");
    }

    // (2) HÀNH VI từng khoá chuỗi: vượt trần ⇒ đúng cột (cắt giữ N ký tự đầu · null); đúng trần ⇒ giữ nguyên
    const TRUONG_SO = new Set(["order_amount", "transaction_master_amount", "transaction_detail_amount", "fee", "tax"]);
    const chuoi = KHOA_GIAO_DICH.filter((k) => !TRUONG_SO.has(k));
    expect(chuoi).toHaveLength(21);
    for (const k of chuoi) {
      const { tran, qua } = TRAN_GIAO_DICH[k];
      const vuot = chuanHoaGiaoDich({ [k]: `${"A".repeat(tran)}${"B".repeat(7)}` })?.[k];
      expect(vuot, k).toBe(qua === "cat" ? "A".repeat(tran) : null);
      expect(chuanHoaGiaoDich({ [k]: "A".repeat(tran) })?.[k], `${k}: đúng trần phải giữ`).toBe("A".repeat(tran));
    }
    // (3) số dạng chuỗi: luôn ≤ trần; KHÔNG BAO GIỜ cắt chữ số (cột ghi "null")
    for (const k of TRUONG_SO) expect(TRAN_GIAO_DICH[k as keyof typeof TRAN_GIAO_DICH].qua, k).toBe("null");
    const dai: Record<string, unknown> = {};
    for (const k of ["order_amount", "transaction_master_amount", "transaction_detail_amount", "fee"]) dai[k] = `6732000.${"0".repeat(40)}`;
    dai.tax = `0.${"0".repeat(40)}`;
    const ra = chuanHoaGiaoDich(dai) ?? {};
    for (const k of TRUONG_SO) {
      const v = ra[k as keyof typeof ra];
      if (typeof v === "string") expect(v.length, k).toBeLessThanOrEqual(TRAN_GIAO_DICH[k as keyof typeof TRAN_GIAO_DICH].tran);
    }
    expect(ra.order_amount).toBe("6732000");
    expect(ra.fee).toBe("6732000");
    expect(chuanHoaGiaoDich({ order_amount: "9".repeat(40) })?.order_amount).toBeNull();
    // tiền tệ quá dài: KHÔNG được thành null (null = máy chủ bỏ qua kiểm VND ⇒ nhận như VND) — cắt, vẫn ≠ VND/704
    const tt = chuanHoaGiaoDich(dongPortal({ currency: "VND-INTERNATIONAL-X" }))?.currency;
    expect(typeof tt).toBe("string");
    expect(["VND", "704"]).not.toContain(tt);
    expect((tt as string).length).toBeLessThanOrEqual(16);
    expect(chuanHoaGiaoDich(dongPortal({ transaction_time: `2026/10/07 10:18:42 ${"Z".repeat(30)}` }))?.transaction_time).toBeNull();
    // đối chứng dương: giá trị thật giữ nguyên từng ký tự
    expect(chuanHoaGiaoDich(dongPortal({ transaction_master_amount: "6732000.0", currency: "VND" }))).toMatchObject({
      transaction_master_amount: "6732000.0",
      currency: "VND",
      transaction_time: "2026/10/07 10:18:42",
    });
  });
});

describe("content-main chỉ nhặt khoá whitelist trước khi đưa dữ liệu RA KHỎI trang", () => {
  it("[EXT-PL-07] dòng search đi qua postMessage chỉ mang đúng KHOA_GIAO_DICH; mọi tin MAIN đăng không chứa token/header/cookie/tên chủ thẻ", async () => {
    const t = taoTrangMain();
    t.portal.giaoDich = [dongPortal(), dongPortal({ transaction_id: "TXN20261007000124" })];
    await t.appTimKiem();
    const phien = await t.gui({ loai: "GOI", phuongThuc: "GET", url: URL_PHIEN, merchantCode: MERCHANT });
    expect(phien).toMatchObject({ loai: "PHIEN", coUser: true });
    const kq = (await t.gui({
      loai: "GOI",
      phuongThuc: "POST",
      url: URL_TIM_KIEM,
      merchantCode: MERCHANT,
      than: {
        page_index: 0,
        page_size: 50,
        transaction_time_from: "2026-10-07 00:00:00",
        transaction_time_to: "2026-10-07 23:59:59",
      },
    })) as { loai: string; rows: Array<Record<string, unknown>> };
    expect(kq.loai).toBe("TRANG");
    expect(kq.rows).toHaveLength(2);
    for (const r of kq.rows) expect(Object.keys(r).sort()).toEqual([...KHOA_GIAO_DICH].sort());
    // Quét MỌI tin đã postMessage trên cửa sổ (cả lệnh lẫn kết quả)
    for (const tin of t.chung.daDang) expect(timChuoiCam(tin.data)).toBeNull();
    expect(CHUOI_CAM.length).toBeGreaterThan(5);
  });
});
