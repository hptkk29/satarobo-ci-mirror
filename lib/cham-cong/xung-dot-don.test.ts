// Đợt 11–12 đơn từ — bộ kiểm xung đột (thuần) + lưới ghim dây nối của luồng HUỶ đơn đã duyệt.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORK_REQUEST_KINDS, TRANG_THAI_CHO_QUAN_LY, type WorkRequestKindV } from "@/lib/work-request";
import { TRANG_THAI_CON_HIEU_LUC } from "./don-trong-ngay-db";
import { coTheXinHuy, khiDuyetHuySe } from "./huy-don-mo-ta";
import { lyDoTrung, timXungDot, type DonXet } from "./xung-dot-don";

const NGAY = new Date(Date.UTC(2026, 9, 12));
let n = 0;
const d = (kind: WorkRequestKindV, over: Partial<DonXet> = {}): DonXet => ({
  id: `d${++n}`,
  kind,
  status: "APPROVED",
  fromDate: NGAY,
  toDate: NGAY,
  startTime: null,
  endTime: null,
  approvedStartTime: null,
  approvedEndTime: null,
  leaveDurationType: null,
  classId: null,
  detail: null,
  ...over,
});
const gio = (startTime: string, endTime: string) => ({ startTime, endTime });

describe("[XD] bộ kiểm xung đột", () => {
  it("[XD-01] nghỉ cả ngày chặn tăng ca / từ xa / chỉnh công / nghỉ một phần cùng ngày", () => {
    const nghi = d("LEAVE", { leaveDurationType: "FULL_DAY" });
    for (const k of [d("OT", gio("18:00", "20:00")), d("REMOTE"), d("TIMESHEET_FIX"), d("COMP_LEAVE", { leaveDurationType: "HALF_DAY_AM" })]) {
      expect(lyDoTrung(k, nghi), k.kind).toMatch(/nghỉ cả ngày/);
    }
    // Đơn cũ không khai thời lượng = cả ngày.
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("LEAVE"))).not.toBeNull();
  });

  it("[XD-02] ĐỐI CHỨNG DƯƠNG: làm từ xa + tăng ca được (BA cho phép); hai khung nghỉ theo giờ không chồng được", () => {
    expect(lyDoTrung(d("REMOTE"), d("OT", gio("18:00", "20:00")))).toBeNull();
    expect(lyDoTrung(d("LEAVE", { leaveDurationType: "HOURLY", ...gio("08:00", "09:00") }), d("LEAVE", { leaveDurationType: "HOURLY", ...gio("15:00", "16:00") }))).toBeNull();
    expect(lyDoTrung(d("LEAVE", { leaveDurationType: "HALF_DAY_AM" }), d("COMP_LEAVE", { leaveDurationType: "HALF_DAY_PM" }))).toBeNull();
  });

  it("[XD-03] chồng giờ thì trùng: hai OT chồng · nghỉ theo giờ chồng OT · nửa sáng × nửa sáng", () => {
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("OT", gio("19:00", "21:00")))).toMatch(/trùng khung giờ/);
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("OT", gio("20:00", "21:00")))).toBeNull(); // chạm mép không chồng
    expect(lyDoTrung(d("LEAVE", { leaveDurationType: "HOURLY", ...gio("16:00", "18:30") }), d("OT", gio("18:00", "20:00")))).toMatch(/vừa nghỉ vừa làm/);
    expect(lyDoTrung(d("LEAVE", { leaveDurationType: "HALF_DAY_AM" }), d("COMP_LEAVE", { leaveDurationType: "HALF_DAY_AM" }))).not.toBeNull();
  });

  it("[XD-04] công tác × từ xa / chấm ngoài; tăng ca × làm ngày nghỉ", () => {
    expect(lyDoTrung(d("BUSINESS_TRIP"), d("REMOTE"))).toMatch(/công tác/);
    expect(lyDoTrung(d("OUTSIDE_ATTENDANCE", gio("14:00", "16:00")), d("BUSINESS_TRIP"))).toMatch(/công tác/);
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("HOLIDAY_WORK", gio("08:00", "12:00")))).not.toBeNull();
    expect(lyDoTrung(d("BUSINESS_TRIP"), d("OT", gio("18:00", "20:00")))).toBeNull();
  });

  it("[XD-05] đơn lớp chỉ trùng cùng loại + cùng lớp; khác ngày không bao giờ trùng", () => {
    expect(lyDoTrung(d("CLASS_OFF", { classId: "a" }), d("CLASS_OFF", { classId: "b" }))).toBeNull();
    expect(lyDoTrung(d("CLASS_OFF", { classId: "a" }), d("CLASS_OFF", { classId: "a" }))).not.toBeNull();
    expect(lyDoTrung(d("SUB_TEACH", { classId: "a" }), d("LEAVE"))).toBeNull();
    const homSau = new Date(Date.UTC(2026, 9, 13));
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("LEAVE", { fromDate: homSau, toDate: homSau }))).toBeNull();
  });

  it("[XD-06] khoảng nhiều ngày: nghỉ 10–14 chặn tăng ca ngày 12; đơn cũ toDate null so theo ngày đầu", () => {
    const nghi = d("LEAVE", { fromDate: new Date(Date.UTC(2026, 9, 10)), toDate: new Date(Date.UTC(2026, 9, 14)) });
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), nghi)).not.toBeNull();
    expect(lyDoTrung(d("OT", gio("18:00", "20:00")), d("LEAVE", { toDate: null }))).not.toBeNull();
  });

  it("[XD-07] đối xứng, và timXungDot bỏ qua chính nó", () => {
    const a = d("OT", gio("18:00", "20:00"));
    const b = d("OT", gio("19:00", "21:00"));
    expect(lyDoTrung(a, b) !== null).toBe(lyDoTrung(b, a) !== null);
    expect(timXungDot(a, [a])).toBeNull();
    expect(timXungDot(a, [a, b])?.don.id).toBe(b.id);
  });
});

describe("[HUY] trạng thái + câu hứa của luồng huỷ", () => {
  it("[HUY-01] chờ duyệt huỷ VẪN hiệu lực; việc chờ quản lý gồm cả chờ duyệt huỷ", () => {
    expect([...TRANG_THAI_CON_HIEU_LUC].sort()).toEqual(["APPROVED", "CANCEL_REQUESTED"]);
    expect([...TRANG_THAI_CHO_QUAN_LY].sort()).toEqual(["CANCEL_REQUESTED", "PENDING"]);
  });

  it("[HUY-02] nút xin huỷ: chỉ đơn ĐÃ DUYỆT theo luật mới, trừ loại không tự hoàn tác được", () => {
    const x = (status: string, effectVersion: number | null, kind: WorkRequestKindV) =>
      coTheXinHuy({ status, effectVersion, kind, leaveDurationType: null, appliedEffect: {} });
    expect(x("APPROVED", 1, "OT")).toBe(true);
    expect(x("APPROVED", null, "OT")).toBe(false);
    expect(x("PENDING", 1, "OT")).toBe(false);
    expect(x("CANCEL_REQUESTED", 1, "OT")).toBe(false);
    expect(x("APPROVED", 1, "CLASS_OFF")).toBe(false); // thiếu ảnh chụp buổi bù / phiên bản
    expect(coTheXinHuy({ status: "APPROVED", effectVersion: 1, kind: "CLASS_OFF", leaveDurationType: null, appliedEffect: { buoiBu: "b", phienBan: {} } })).toBe(true);
  });

  it("[HUY-02b] đơn ghi lưới / lượt quét / buổi học: thiếu ảnh chụp hoàn tác ⇒ KHÔNG hiện nút (đơn duyệt đợt 1–3 trên test)", () => {
    const x = (kind: WorkRequestKindV, appliedEffect: unknown, leaveDurationType: "FULL_DAY" | "HOURLY" | null = null) =>
      coTheXinHuy({ status: "APPROVED", effectVersion: 1, kind, leaveDurationType, appliedEffect });
    expect(x("SHIFT_SWAP", { ca: [] })).toBe(false);
    expect(x("SHIFT_SWAP", { ca: [], o: [] })).toBe(true);
    expect(x("LEAVE", { ngay: [] }, "FULL_DAY")).toBe(false);
    expect(x("LEAVE", { ngay: [] }, "HOURLY")).toBe(true); // một phần ca: qua ngữ cảnh, không cần ảnh chụp ô
    expect(x("TIMESHEET_FIX", { cheDo: "GHI_DE" })).toBe(false);
    expect(x("TIMESHEET_FIX", { soDongMoi: 2, thayThe: [] })).toBe(true);
    expect(x("SUB_TEACH", null)).toBe(false);
    expect(x("SUB_TEACH", { sessionId: "s" })).toBe(true);
  });

  it("[HUY-03] mọi loại có câu 'Khi duyệt huỷ sẽ'", () => {
    for (const k of WORK_REQUEST_KINDS) expect(khiDuyetHuySe({ kind: k, leaveDurationType: null }).length, k).toBeGreaterThan(20);
  });
});

/** Bỏ chú thích trước khi soi — chú thích giải thích bản vá hay chứa đúng chuỗi đang tìm (luật 11). */
const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

describe("[HUY-W] lưới ghim dây nối", () => {
  const hoanTac = doc("lib/cham-cong/don/hoan-tac.ts");
  const handlerOf = new Map([...hoanTac.matchAll(/^\s+([A-Z_]+): ([\w(.)]+),$/gm)].map((m) => [m[1], m[2]]));

  it("[HUY-W1] bảng hoàn tác phủ đủ loại; KHÔNG loại nào có handler chỉ ném lỗi (nghỉ buổi dạy hoàn tác được từ đợt 11 bổ sung)", () => {
    expect([...handlerOf.keys()].sort()).toEqual([...WORK_REQUEST_KINDS].sort());
    expect(handlerOf.get("CLASS_OFF")).toBe("huyNghiBuoiDay");
    expect(hoanTac).not.toMatch(/async \(\) => \{\s*throw new DecideError/);
    // Buổi bù được tìm theo LIÊN KẾT NGUỒN, không đoán "buổi cuối của lớp".
    expect(hoanTac).toContain("if (bu.sourceWorkRequestId !== don.id) throw new DecideError(DOI_LICH);");
    expect(doc("lib/cham-cong/don/lop-hoc.ts")).toContain("sourceWorkRequestId: don.id,");
  });

  it("[HUY-W2] server và HAI màn 'Đơn của tôi' cùng hỏi coTheXinHuy (nút hiện ⇔ server nhận)", () => {
    expect(doc("lib/cham-cong/huy-don.ts").match(/coTheXinHuy\(/g)).toHaveLength(1);
    expect(doc("app/(admin)/admin/don-tu/cua-toi/page.tsx").match(/coTheXinHuy\(/g)).toHaveLength(1);
    expect(doc("app/(teacher)/teacher/don-tu/page.tsx").match(/coTheXinHuy\(/g)).toHaveLength(1);
  });

  it("[HUY-W3] duyệt đơn và duyệt huỷ dùng CHUNG cổng kỳ đã chốt", () => {
    expect(doc("lib/cham-cong/requests.ts").match(/loiKyDaChotCuaDon\(/g)).toHaveLength(2); // định nghĩa + duyệt đơn
    expect(doc("lib/cham-cong/huy-don.ts").match(/loiKyDaChotCuaDon\(/g)).toHaveLength(2); // xin huỷ + duyệt huỷ
  });

  it("[HUY-W4] các chỗ đọc 'đơn còn hiệu lực' / 'việc chờ quản lý' đi qua hằng chung, không so chuỗi APPROVED/PENDING", () => {
    expect(doc("app/(admin)/admin/cham-cong/page.tsx")).toContain("status: { in: [...TRANG_THAI_CON_HIEU_LUC] }");
    expect(doc("app/(admin)/admin/cham-cong/lich-ca/page.tsx")).not.toMatch(/r\.status === "APPROVED"/);
    expect(doc("lib/pending-tasks.ts")).toContain("status: { in: [...TRANG_THAI_CHO_QUAN_LY] }");
    expect(doc("app/(admin)/admin/cham-cong/ky-cong/page.tsx")).toContain("status: { in: [...TRANG_THAI_CHO_QUAN_LY] }");
  });

  it("[XD-W1] bộ kiểm xung đột được gọi ở CẢ lúc nộp lẫn lúc duyệt", () => {
    const src = doc("lib/cham-cong/requests.ts");
    expect(src.match(/timXungDot\(/g)).toHaveLength(2);
    // Lúc DUYỆT: đọc đơn còn hiệu lực TRONG giao dịch (qua `tx`), NGAY sau khoá theo người nộp — kiểm
    // ngoài giao dịch thì hai lượt duyệt đồng thời lọt cả hai.
    expect(src).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{`don-tu:\$\{req\.requesterId\}`\}\)\)`;\s+const ton = await donPhuKhoang\(tx,/);
  });
});
