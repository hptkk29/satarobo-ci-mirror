// [NCH-*] — «ai bấm» của lệnh GHI backfill quy nguồn: dựng từ biến môi trường mặc định của GitHub Actions. THUẦN (không DB, không đồng hồ).
//
// Vì sao cần (reviewer vòng 2, LOW): audit `DI_TRU_NGUON` ghi `GITHUB_ACTOR` làm người bấm. Nhưng khi một lượt được CHẠY LẠI (Re-run), `GITHUB_ACTOR` vẫn là người dispatch lần ĐẦU;
// người bấm Re-run nằm ở `GITHUB_TRIGGERING_ACTOR`, và `GITHUB_RUN_ATTEMPT` cho biết đây là lần chạy thứ mấy. Chỉ ghi `GITHUB_ACTOR` thì khoản ghi prod của lượt chạy lại bị gán cho người khác.
//
//   [NCH-01]  chạy lại: người dispatch lần đầu (actor) và người bấm chạy lại (triggeringActor) là HAI giá trị riêng; runAttempt đi cùng
//   [NCH-02]  vắng / rỗng / chỉ khoảng trắng ⇒ null từng trường (chạy ngoài Actions: máy dev, test); KHÔNG suy trường này từ trường kia
//   [NCH-03]  cắt 100 ký tự và bỏ khoảng trắng đầu/cuối — audit không nhận chuỗi dài tuỳ ý
//   [NCH-04]  CẢ BỐN trường luôn có mặt trong kết quả (kể cả null) — luật 7: trường bắt buộc, không bao giờ «vắng»
import { describe, expect, it } from "vitest";
import { nguonChayTuEnv } from "./di-tru-nguon-chay";

describe("[NCH] nguonChayTuEnv", () => {
  it("[NCH-01] chạy lại: GITHUB_ACTOR (dispatch lần đầu) ≠ GITHUB_TRIGGERING_ACTOR (người bấm chạy lại); runAttempt đi cùng", () => {
    expect(nguonChayTuEnv({ GITHUB_ACTOR: "nguoi-dispatch", GITHUB_TRIGGERING_ACTOR: "nguoi-chay-lai", GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "2" })).toEqual({
      actor: "nguoi-dispatch",
      triggeringActor: "nguoi-chay-lai",
      runId: "123456789",
      runAttempt: "2",
    });
  });

  it("[NCH-02] vắng / rỗng / toàn khoảng trắng ⇒ null từng trường; không suy triggeringActor từ actor (gán nhầm người còn tệ hơn để trống)", () => {
    expect(nguonChayTuEnv({})).toEqual({ actor: null, triggeringActor: null, runId: null, runAttempt: null });
    expect(nguonChayTuEnv({ GITHUB_ACTOR: "  ", GITHUB_TRIGGERING_ACTOR: "", GITHUB_RUN_ID: undefined, GITHUB_RUN_ATTEMPT: "\t" })).toEqual({
      actor: null,
      triggeringActor: null,
      runId: null,
      runAttempt: null,
    });
    // chỉ có actor (runner cũ không đặt GITHUB_TRIGGERING_ACTOR) ⇒ triggeringActor vẫn null
    expect(nguonChayTuEnv({ GITHUB_ACTOR: "a" }).triggeringActor).toBeNull();
  });

  it("[NCH-03] cắt 100 ký tự, bỏ khoảng trắng đầu/cuối", () => {
    const r = nguonChayTuEnv({ GITHUB_ACTOR: ` ${"x".repeat(150)} `, GITHUB_TRIGGERING_ACTOR: ` ${"y".repeat(150)}`, GITHUB_RUN_ID: " 42 ", GITHUB_RUN_ATTEMPT: " 3 " });
    expect(r.actor).toBe("x".repeat(100));
    expect(r.triggeringActor).toBe("y".repeat(100));
    expect(r.runId).toBe("42");
    expect(r.runAttempt).toBe("3");
  });

  it("[NCH-04] luôn đủ bốn khoá (kể cả khi tất cả null)", () => {
    expect(Object.keys(nguonChayTuEnv({})).sort()).toEqual(["actor", "runAttempt", "runId", "triggeringActor"]);
  });
});
