// @vitest-environment node
/**
 * [DNS-07] — "đổi nguồn của khiếu nại 'sửa nguồn' đã XỬ LÝ XONG chưa" (THUẦN). MỘT hàm cho service đóng VÀ cho nút ở màn (luật 12b): hai chỗ tự đếm là hai luật.
 * Bài học của bản trước: chỉ nhận "đã có dòng SOURCE_CORRECTION" — nay dòng đó sinh SAU khi duyệt, còn đề xuất bị TỪ CHỐI hay đổi nguồn không đổi tiền thì sẽ KHÔNG BAO GIỜ có dòng ⇒ khiếu nại kẹt vĩnh viễn.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { doiNguonDaXuLyXong, type DemDoiNguon } from "./khieu-nai-dich";

const dem = (p: Partial<DemDoiNguon> = {}): DemDoiNguon => ({ soDong: 0, khongAnhHuongTien: 0, dangChoDuyet: 0, daTuChoi: 0, ...p });

describe("[DNS-07] doiNguonDaXuLyXong", () => {
  it("chưa có gì ⇒ CHƯA xong; mỗi cách xử lý xong (đã duyệt ghi sổ · không ảnh hưởng tiền · bị từ chối) ⇒ xong", () => {
    expect(doiNguonDaXuLyXong(dem())).toBe(false);
    expect(doiNguonDaXuLyXong(dem({ soDong: 1 }))).toBe(true);
    expect(doiNguonDaXuLyXong(dem({ khongAnhHuongTien: 1 }))).toBe(true);
    expect(doiNguonDaXuLyXong(dem({ daTuChoi: 1 }))).toBe(true);
  });

  it("còn đề xuất ĐANG CHỜ ⇒ KHÔNG xong dù đã có cách xử lý khác (đề xuất trước bị từ chối rồi đổi nguồn lần nữa)", () => {
    expect(doiNguonDaXuLyXong(dem({ dangChoDuyet: 1, daTuChoi: 1 }))).toBe(false);
    expect(doiNguonDaXuLyXong(dem({ dangChoDuyet: 1, soDong: 2 }))).toBe(false);
    expect(doiNguonDaXuLyXong(dem({ dangChoDuyet: 0, daTuChoi: 1 }))).toBe(true); // đối chứng
  });

  it("[DXD-W7] service đóng và màn khiếu nại cùng gọi hàm này — không ai tự đếm", () => {
    const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    expect(doc("lib/hoa-hong/khieu-nai.ts")).toMatch(/doiNguonDaXuLyXong\(dem\)/);
    expect(doc("lib/hoa-hong/khieu-nai-doc.ts")).toMatch(/doiNguonDaXuLyXong\(await demDongDoiNguonSauKhiGui\(client, d\)\)/);
  });
});
