/**
 * Cổng cho chính cái cổng: `thoigian/require-now-in-tests` phải BẮT được hình dạng đã gây
 * đỏ hôm 13/09/2026, và phải KHÔNG bắt những hình dạng lành.
 *
 * Vì sao một rule lint cần test riêng: rule im lặng sai còn tệ hơn không có rule — nó cho
 * cảm giác đã được canh. Chuyện đó vừa xảy ra hai lần trong repo này: hook `block-env-add.sh`
 * "chặn" bằng mã thoát mà Claude Code không coi là chặn (luật 14), và `pnpm lint` không hề
 * quét `tests/` nên MỌI rule nhắm test đều vô hiệu (luật 10) — chính lỗ thứ hai này được
 * phát hiện khi viết rule này, và đã vá trong cùng PR.
 *
 * Dùng ESLint Node API với `filePath` giả, theo mẫu `no-bare-next-response.test.ts`. Cách
 * này kiểm THÊM một điều mà `RuleTester` không kiểm được: rule có được **cắm đúng phạm vi**
 * trong `eslint.config.mjs` hay không.
 */
import { beforeAll, describe, it, expect } from "vitest";
import { ESLint } from "eslint";

const RULE = "thoigian/require-now-in-tests";
const eslint = new ESLint();

/** File test THẬT trong phạm vi rule. */
const TRONG_PHAM_VI = "tests/cham-cong/gia-lap.spec.ts";
/** File mã sản phẩm — rule KHÔNG được áp ở đây. */
const NGOAI_PHAM_VI = "lib/cham-cong/gia-lap.ts";

async function loi(filePath: string, code: string) {
  const [res] = await eslint.lintText(code, { filePath });
  return (res?.messages ?? []).filter((m) => m.ruleId === RULE);
}

describe(RULE, () => {
  /**
   * LÀM NÓNG ESLint một lần ở hook — KHÔNG để ca đầu tiên trả tiền hộ.
   *
   * ── Vì sao (chẩn 15/09/2026) ──
   * `new ESLint()` ở trên rẻ; đắt là LẦN `lintText` ĐẦU TIÊN, vì lúc đó ESLint mới đi
   * phân giải flat-config của repo (typescript-eslint + toàn bộ plugin + parser).
   *
   * Đo thật: ca đầu **1177ms**, tám ca sau 2–6ms. Dưới tải máy (dev server + vừa xong
   * cả bộ test) ca đầu thành **7433ms** ⇒ vượt trần 5s ⇒ ĐỎ với "Test timed out",
   * không phải vì rule sai. Cùng hình dạng với `tests/cham-cong/requests.spec.ts` đã vá
   * cùng ngày: chi phí KHỞI TẠO MỘT LẦN bị tính vào ngân sách của phép khẳng định.
   *
   * ⚠️ ĐỪNG nới trần của ca. Trần là để đo rule; nới nó vì chi phí nạp cấu hình là bỏ
   * luôn khả năng thấy một rule thật sự chạy lâu. Hook có ngân sách riêng.
   */
  beforeAll(async () => {
    await eslint.lintText("", { filePath: TRONG_PHAM_VI });
  }, 60_000);
  // ⬆ Ngân sách RIÊNG cho hook — hoàn nốt ý đồ đã ghi ngay trên ("Hook có ngân sách
  // riêng"), thứ trước nay vẫn dùng mặc định 10s của vitest.
  //
  // Đo 24/09/2026: chạy MỘT MÌNH hook mất ~2,2s; trong bộ đầy đủ (675 tệp song song) mất
  // **12,7s** ⇒ vượt mặc định ⇒ `Hook timed out in 10000ms` và CẢ TỆP đỏ với
  // "9 tests | 9 skipped" — không ca nào chạy, nên đọc log rất dễ tưởng rule hỏng.
  //
  // Đây KHÔNG phải nới trần của ca: trần từng ca giữ nguyên, nên một rule thật sự chạy
  // lâu vẫn lộ ra. Thứ được nới là chi phí NẠP CẤU HÌNH một lần, vốn không nói gì về
  // rule và chỉ phụ thuộc máy đang bận đến đâu.

  it("[CAY-LAI] bắt ĐÚNG lời gọi đã gây đỏ 13/09/2026", async () => {
    // Nguyên văn hình dạng cũ của `requests.spec.ts > LEAVE 2 ngày duyệt`.
    const ms = await loi(
      TRONG_PHAM_VI,
      `const l = await requests.submitAttendanceRequest({ ...base, requesterId: tv, kind: "LEAVE", fromDate: d11, toDate: d12, leaveTypeId: leaveId });`,
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]!.message).toContain("spread");
  });

  it("bắt lời gọi thiếu now không có spread, kèm thông điệp khác", async () => {
    const ms = await loi(
      TRONG_PHAM_VI,
      `submitAttendanceRequest({ requesterId: tv, kind: "LEAVE", fromDate: d11 });`,
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]!.message).toContain("TƯỜNG MINH");
  });

  it("bắt decideRequest thiếu now", async () => {
    const ms = await loi(
      TRONG_PHAM_VI,
      `await requests.decideRequest({ requestId: l.id, decision: "APPROVED", note: "ok", actor });`,
    );
    expect(ms).toHaveLength(1);
  });

  it("chốt now tường minh thì SẠCH — cả `now: X` lẫn shorthand", async () => {
    expect(
      await loi(
        TRONG_PHAM_VI,
        `submitAttendanceRequest({ now: NOW_TEST, requesterId: tv, fromDate: d11 });`,
      ),
    ).toHaveLength(0);
    expect(
      await loi(TRONG_PHAM_VI, `submitAttendanceRequest({ ...base, now, requesterId: tv });`),
    ).toHaveLength(0);
    expect(await loi(TRONG_PHAM_VI, `decideRequest({ "now": NOW_TEST, requestId: x });`)).toHaveLength(
      0,
    );
  });

  it("`...spread` KHÔNG tính là đã chốt, dù object được spread có now", async () => {
    // Cố ý: mục đích của luật là mốc thời gian HIỆN RA ngay tại lời gọi, không ẩn ở đầu file.
    const ms = await loi(TRONG_PHAM_VI, `submitAttendanceRequest({ ...baseCoNow, requesterId: tv });`);
    expect(ms).toHaveLength(1);
  });

  it("khoá tính toán `[k]` không đọc được ⇒ vẫn coi là thiếu", async () => {
    expect(await loi(TRONG_PHAM_VI, `decideRequest({ [k]: NOW, requestId: x });`)).toHaveLength(1);
  });

  it("hàm KHÁC không bị soi — recordTimeLog cố ý nằm ngoài danh sách", async () => {
    // 5 lời gọi của nó trong timelog.spec.ts không truyền ngày nào, nên bắt là dương tính giả.
    // Xem khối ghi chú trong `require-now-in-tests.mjs`.
    expect(
      await loi(TRONG_PHAM_VI, `mod.recordTimeLog({ userId, workLocationId: wlId, direction: "CHECK_IN" });`),
    ).toHaveLength(0);
    expect(await loi(TRONG_PHAM_VI, `issueTicket({ userId });`)).toHaveLength(0);
  });

  it("đối số không phải object literal ⇒ ngoài hình dạng soi được", async () => {
    expect(await loi(TRONG_PHAM_VI, `submitAttendanceRequest(payload);`)).toHaveLength(0);
    expect(await loi(TRONG_PHAM_VI, `decideRequest();`)).toHaveLength(0);
  });

  it("KHÔNG áp cho mã sản phẩm — chỉ tests/** và *.test.ts/*.spec.ts", async () => {
    // Mã sản phẩm gọi hàm này với `now` mặc định là hợp lệ: đó chính là đường chạy thật.
    expect(
      await loi(NGOAI_PHAM_VI, `submitAttendanceRequest({ requesterId: u, fromDate: d });`),
    ).toHaveLength(0);
  });
});
