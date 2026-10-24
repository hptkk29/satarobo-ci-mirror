/**
 * PHIÊN H — bộ nạp "cài riêng theo cơ sở", phần THUẦN.
 *
 * Bộ này canh ba thứ mà một bản hiện thực "hợp lý" rất dễ làm hỏng:
 *
 *  1. **`false` và `0` là giá trị ĐÃ CÀI, không phải "chưa cài".** Ai viết
 *     `giaTriRieng: dong?.valueJson || undefined` sẽ biến "tắt riêng" thành "theo toàn hệ"
 *     trên màn hình — và với một công tắc thì hai thứ đó trông y hệt nhau lúc toàn hệ đang
 *     tắt, chỉ khác nhau vào ngày ai đó bật mức toàn hệ.
 *  2. **Khoá không `centerOverridable` thì KHÔNG dựng hàng nào.** `setCenterSetting` từ
 *     chối thẳng những khoá đó, nên một khối hiện ra ở đó là một khối mà mọi lần bấm đều
 *     báo lỗi (luật 12 — affordance phải nói thật).
 *  3. **Giá trị không được gán nhầm sang cơ sở khác** khi có nhiều khoá × nhiều cơ sở.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ghepCaiRieng } from "./co-so-cau-hinh";
import { SETTINGS } from "./registry";

const CS1 = { orgUnitId: "ou_cs1", ten: "CS1 — Nguyễn Hữu Thọ" };
const CS2 = { orgUnitId: "ou_cs2", ten: "CS2 — Hoàng Diệu" };
const CO_SO = [CS1, CS2];

/** Khoá THẬT, cho cài riêng — cùng khoá mà runbook pilot đang bật bằng SQL tay. */
const CHO = "billing.flexV1Enabled";
/** Khoá THẬT, KHÔNG cho cài riêng. */
const KHONG = "enrollment.suspendMaxMonths";

describe("ghepCaiRieng", () => {
  it("[CSC-01] hai khoá thử phải đúng như bộ này giả định", () => {
    // Ca MẪU SỐ. Nếu registry đổi `centerOverridable` của một trong hai khoá thì mọi ca dưới
    // đây vẫn xanh nhưng không còn kiểm cái nó nói — đúng lớp "lưới xanh vì không chạm tới
    // mã" mà luật 14 cảnh báo.
    expect(SETTINGS[CHO].centerOverridable).toBe(true);
    expect(SETTINGS[KHONG].centerOverridable).toBe(false);
  });

  it("[CSC-02] không có dòng nào ⇒ mọi cơ sở THEO TOÀN HỆ (trường vắng mặt)", () => {
    const ra = ghepCaiRieng([CHO], CO_SO, []);
    expect(ra[CHO]).toHaveLength(2);
    for (const c of ra[CHO]!) expect("giaTriRieng" in c).toBe(false);
  });

  it("[CSC-03] dòng `false` ⇒ TẮT RIÊNG, KHÔNG rơi về 'theo toàn hệ'", () => {
    // Chỗ bug sống. `|| undefined` / `?? undefined` / `Boolean(...)` đều làm ca này đỏ.
    const ra = ghepCaiRieng([CHO], CO_SO, [
      { orgUnitId: CS1.orgUnitId, key: CHO, valueJson: false },
    ]);
    const cs1 = ra[CHO]!.find((c) => c.orgUnitId === CS1.orgUnitId)!;
    expect("giaTriRieng" in cs1).toBe(true);
    expect(cs1.giaTriRieng).toBe(false);
    // Cơ sở kia KHÔNG được lây.
    expect("giaTriRieng" in ra[CHO]!.find((c) => c.orgUnitId === CS2.orgUnitId)!).toBe(false);
  });

  it("[CSC-04] số 0 cũng là giá trị đã cài", () => {
    const ra = ghepCaiRieng([CHO], CO_SO, [
      { orgUnitId: CS2.orgUnitId, key: CHO, valueJson: 0 },
    ]);
    expect(ra[CHO]!.find((c) => c.orgUnitId === CS2.orgUnitId)!.giaTriRieng).toBe(0);
  });

  it("[CSC-05] khoá KHÔNG cho cài riêng ⇒ VẮNG MẶT khỏi map, không phải mảng rỗng", () => {
    // Màn hỏi `caiRieng[key]` có hay không để quyết định vẽ khối. Trả mảng rỗng thì khối vẫn
    // không vẽ (độ dài 0), nhưng bộ nạp lúc ấy đang KHẲNG ĐỊNH một điều nó không biết —
    // "khoá này cho cài riêng, chỉ là chưa cơ sở nào cài". Hai câu khác nhau.
    const ra = ghepCaiRieng([CHO, KHONG], CO_SO, []);
    expect(CHO in ra).toBe(true);
    expect(KHONG in ra).toBe(false);
  });

  it("[CSC-06] dòng của khoá KHÁC không được tràn sang khoá đang hỏi", () => {
    // Một bản tra theo `orgUnitId` mà quên ghép `key` sẽ xanh mọi ca trên (chúng chỉ có một
    // khoá) và đỏ đúng ở đây.
    const ra = ghepCaiRieng([CHO, "class.maxStudents.default"], CO_SO, [
      { orgUnitId: CS1.orgUnitId, key: "class.maxStudents.default", valueJson: 25 },
    ]);
    expect("giaTriRieng" in ra[CHO]!.find((c) => c.orgUnitId === CS1.orgUnitId)!).toBe(false);
    expect(
      ra["class.maxStudents.default"]!.find((c) => c.orgUnitId === CS1.orgUnitId)!.giaTriRieng,
    ).toBe(25);
  });

  it("[CSC-07] giữ nguyên THỨ TỰ cơ sở được truyền vào", () => {
    // Thứ tự do `docCaiRiengTheoCoSo` quyết định (theo `code`: CS1 → CS2). Xáo ở tầng ghép
    // là danh sách nhảy chỗ giữa hai lần tải trang, và người vận hành bấm nhầm hàng.
    const ra = ghepCaiRieng([CHO], CO_SO, []);
    expect(ra[CHO]!.map((c) => c.orgUnitId)).toEqual([CS1.orgUnitId, CS2.orgUnitId]);
  });
});

describe("clearCenterSetting — lưới ghim mã nguồn", () => {
  // LƯỚI GHIM MÃ NGUỒN (CLAUDE.md): luật ở đây có dạng "lời gọi này phải gọi hàm kia", và
  // test hành vi KHÔNG chứng minh được — `safeCache` rơi về gọi thẳng khi chạy ngoài request
  // context, nên mọi ca tích hợp đều xanh dù có xoá cache hay không.
  //
  // Bỏ `clearSettingsCache()` đi thì: gỡ mức riêng xong, cơ sở VẪN chạy theo mức riêng cũ tới
  // 300 giây (`revalidate: 300`). Với một cờ tiền đang pilot, đó là 5 phút sale vẫn bấm được
  // sau khi người vận hành tưởng đã gỡ. Không lỗi nào báo.
  const src = readFileSync(resolve(process.cwd(), "lib/settings/service.ts"), "utf8");
  const than = /export async function clearCenterSetting[\s\S]*?\n\}/.exec(src)?.[0] ?? "";

  it("[CSC-08] đọc được thân hàm", () => {
    // Regex hỏng ⇒ `than` rỗng ⇒ hai ca dưới XANH VĨNH VIỄN và trông y hệt lưới đang làm
    // việc. Đây là bài học đã trả giá ở `docSchema()` (luật 11).
    expect(than).not.toBe("");
    expect(than).toContain("centerSetting.delete");
  });

  it("[CSC-09] thân hàm PHẢI gọi `clearSettingsCache()` đúng một lần", () => {
    expect(than.match(/clearSettingsCache\(\)/g) ?? []).toHaveLength(1);
  });

  it("[CSC-11] TRANG phải nạp và TRUYỀN `coSo` xuống từng dòng", () => {
    // DÂY NỐI — lớp lỗi CÂM của repo (CLAUDE.md luật 11): `coSo` là prop TUỲ CHỌN, nên gỡ
    // một trong hai dòng dưới đây KHÔNG gây lỗi biên dịch, KHÔNG làm ca nào đỏ, và triệu
    // chứng là "khối cài riêng biến mất" — trông y hệt lỗi phân quyền. Đúng hình dạng của
    // mục "Zalo CRM" đã khai cờ từ 06/09 mà chưa từng hiện được với ai.
    const trang = readFileSync(
      resolve(process.cwd(), "app/(admin)/admin/cau-hinh-van-hanh/page.tsx"),
      "utf8",
    );
    expect(trang.match(/docCaiRiengTheoCoSo\(/g) ?? []).toHaveLength(1);
    expect(trang.match(/coSo:\s*caiRieng\[key\]/g) ?? []).toHaveLength(1);

    const editor = readFileSync(
      resolve(
        process.cwd(),
        "app/(admin)/admin/cau-hinh-van-hanh/_components/settings-editor.tsx",
      ),
      "utf8",
    );
    expect(editor.match(/<CaiRiengTheoCoSo/g) ?? []).toHaveLength(1);
  });

  it("[CSC-10] phép XOÁ đứng SAU cổng quyền và cổng lý do", () => {
    // Luật rollback của repo: mọi cổng đứng TRƯỚC phép ghi đầu tiên. Ở đây không có
    // `$transaction` để `throw` mà cứu, nên một cổng đặt sau `delete` là xoá thật rồi mới
    // trả `ok:false` — người vận hành đọc câu từ chối và tin rằng không có gì đổi.
    const viTriXoa = than.indexOf("centerSetting.delete");
    const viTriQuyen = than.indexOf("FORBIDDEN");
    const viTriLyDo = than.indexOf("Lý do thay đổi là bắt buộc");
    expect(viTriQuyen).toBeGreaterThan(-1);
    expect(viTriLyDo).toBeGreaterThan(-1);
    expect(viTriQuyen).toBeLessThan(viTriXoa);
    expect(viTriLyDo).toBeLessThan(viTriXoa);
  });
});
