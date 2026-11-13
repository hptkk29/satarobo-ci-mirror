// Lưới ghim DÂY NỐI của hai luật chốt 20/10/2026 (vòng 2) mà test hành vi không với tới:
//   · trần RIÊNG của QLCS (`tranQlcs`) phải được hỏi ở CẢ đường ĐẶT lẫn đường GỠ của `service.ts`;
//   · `approveOrder` phải hỏi `chanTuDuyetDon` TRƯỚC `db.$transaction` (phép ghi đầu tiên).
// Cả hai chạm DB nên không ca hành vi nào ở bộ thuần với tới; gỡ lời gọi là KHÔNG ca nào đỏ (luật 14). Đã cấy thử: bỏ lời gọi ⇒ đỏ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[TQW-01] trần QLCS: đặt VÀ gỡ đều hỏi", () => {
  const svc = doc("lib/settings/service.ts");
  it("setCenterSetting gọi vuotTranQlcs đúng 1 lần, sau validateSettingValue và TRƯỚC upsert", () => {
    expect(dem(svc, /vuotTranQlcs\(actor, def, v\.value\)/g)).toBe(1);
    const iThe = svc.indexOf("vuotTranQlcs(actor, def, v.value)");
    expect(iThe).toBeGreaterThan(svc.indexOf("validateSettingValue(params.key, params.value)"));
    expect(iThe).toBeLessThan(svc.indexOf("db.centerSetting.upsert"));
  });
  it("clearCenterSetting gọi guTranQlcsDuoc đúng 1 lần, TRƯỚC delete (gỡ = nâng vòng qua trần)", () => {
    expect(dem(svc, /guTranQlcsDuoc\(actor, def, /g)).toBe(1);
    expect(svc.indexOf("guTranQlcsDuoc(actor, def, ")).toBeLessThan(svc.indexOf("db.centerSetting.delete"));
  });
});

describe("[TQW-02] tự duyệt: hỏi trước phép ghi, và nút khoá dùng CÙNG hàm", () => {
  const ap = doc("lib/orders/approval.ts");
  it("approveOrder gọi chanTuDuyetDon đúng 1 lần, trước db.$transaction đầu tiên của nó", () => {
    expect(dem(ap, /chanTuDuyetDon\(/g)).toBe(1);
    const iAp = ap.indexOf("export async function approveOrder");
    const iCh = ap.indexOf("chanTuDuyetDon(");
    expect(iCh).toBeGreaterThan(iAp);
    expect(iCh).toBeLessThan(ap.indexOf("db.$transaction", iAp));
  });
  it("rejectOrder KHÔNG bị chặn tự duyệt (tự từ chối đơn mình là huỷ, không phải lách duyệt)", () => {
    const iRj = ap.indexOf("export async function rejectOrder");
    expect(ap.slice(iRj)).not.toContain("chanTuDuyetDon(");
  });
  it("MỘT nguồn vai: máy chủ lấy vai từ resolveActor, thẻ duyệt truyền chính `actor` đã resolve (không đọc session.user.role)", () => {
    expect(dem(ap, /actor: await resolveActor\(params\.actor\.id\)/g)).toBe(1);
    const d = doc("lib/orders/du-lieu-the-duyet.ts");
    expect(dem(d, /lyDoKhongTuDuyet: chanTuDuyetDon\(\{ nguoiTaoId: o\.createdById, actorId: actor\.userId, actor \}\)/g)).toBe(1);
    const tu = doc("lib/orders/tu-duyet.ts");
    expect(tu).not.toMatch(/session|\.roles\b|role\?:/);
  });
});
