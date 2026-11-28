import { afterEach, describe, expect, it } from "vitest";

import { datKhoTepRieng, type KhoTepRieng } from "./kho-tep-rieng";
import { khoaAnhDeRieng, kyUrlTepMacDinh } from "./dich-vu/hoc-tap";

/**
 * [ANHDE] V8.4 (B-UPLOAD-R2) — ảnh đề thi (HOTSPOT) nằm KHO RIÊNG, tham chiếu `private:exam-img/<tên>`:
 *   [ANHDE-01] chỉ nhận tiền tố exam-img/ + ký tự an toàn; không `..`, không khoá của kho tệp nộp bài, không khoảng trắng, không rỗng
 *   [ANHDE-02] ký qua kho riêng với TTL 900; không có kho ⇒ null (fail-closed); khoá sai ⇒ null và KHÔNG gọi kho; lỗi kho ⇒ null
 *   [ANHDE-03] URL không phải `private:` vẫn đi đường cũ (không bị chặn bởi nhánh mới)
 */
const kho = (goi: string[], loi = false): KhoTepRieng => ({
  ten: "gia",
  async kyPut() { throw new Error("khong dung"); },
  async dau() { return null; },
  async docByteDau() { return null; },
  async kyGet(key, ttl) {
    goi.push(`${key}|${ttl}`);
    if (loi) throw new Error("kho loi");
    return `fake://get/${key}`;
  },
  async xoa() {},
});

describe("[ANHDE] ảnh đề thi trong kho riêng", () => {
  afterEach(() => datKhoTepRieng(null));

  it("[ANHDE-01] khoá hợp lệ", () => {
    expect(khoaAnhDeRieng("private:exam-img/uat-robot-hotspot.png")).toBe("exam-img/uat-robot-hotspot.png");
    for (const x of ["private:exam-img/", "private:exam-img/../mobile/x.png", "private:exam-img/a b.png", "private:exam-img//x.png", "private:mobile/bai_nop/abc.jpg", "private:EXAM-IMG/x.png", "https://x/y.png", "exam-img/x.png", "private:exam-img/a/b.png", `private:exam-img/${"a".repeat(200)}`]) {
      expect(khoaAnhDeRieng(x), x).toBeNull();
    }
  });

  it("[ANHDE-02] ký qua kho riêng; fail-closed", async () => {
    const goi: string[] = [];
    expect(await kyUrlTepMacDinh("private:exam-img/a.png")).toBeNull(); // chưa có kho
    datKhoTepRieng(kho(goi));
    expect(await kyUrlTepMacDinh("private:exam-img/a.png")).toBe("fake://get/exam-img/a.png");
    expect(goi).toEqual(["exam-img/a.png|900"]);
    expect(await kyUrlTepMacDinh("private:mobile/bai_nop/x.jpg")).toBeNull();
    expect(await kyUrlTepMacDinh("private:exam-img/../x.png")).toBeNull();
    expect(goi).toHaveLength(1); // khoá sai KHÔNG chạm kho
    datKhoTepRieng(kho([], true));
    expect(await kyUrlTepMacDinh("private:exam-img/a.png")).toBeNull(); // kho lỗi
  });

  it("[ANHDE-03] URL thường vẫn đi đường cũ", async () => {
    datKhoTepRieng(kho([]));
    expect(await kyUrlTepMacDinh("https://nguoi-la.example/a.png")).toBeNull(); // ngoài kho của app, không ký được ⇒ null
  });
});
