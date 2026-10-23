// [H1-P*] thuần — "việc hợp lệ hôm nay" + engine không gắn lại CHAM_NGOAI_LICH ở mức ngày. DB: tests/cham-cong/parttime-cham-ngoai-lich.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeDay, DEFAULT_RULES, type EngineLog } from "@/lib/cham-cong/engine";
import { KHONG_CO_DON } from "@/lib/cham-cong/don-trong-ngay";
import { coCongViecHopLeHomNay, tietHopLe, tietLaViecHomNay, trucHopLe } from "./cong-viec-hop-le";

const T = (p: Partial<{ daNhan: boolean; graceCutover: boolean; tinhTrang: "MO" | "DA_CHOT" | "DA_DONG"; trangThai: string; khung: boolean }> = {}) => ({
  daNhan: p.daNhan ?? true,
  graceCutover: p.graceCutover ?? false,
  requiredFrom: p.khung === false ? null : new Date("2026-11-04T10:50:00Z"),
  requiredTo: p.khung === false ? null : new Date("2026-11-04T12:30:00Z"),
  trangThai: (p.trangThai ?? "CHUA_DEN_GIO") as never,
  dongDoi: { tinhTrangBuoi: p.tinhTrang ?? "MO" } as never,
});

describe("[H1-P] định nghĩa việc hợp lệ", () => {
  it("[H1-P1] tiết: phải ĐÃ NHẬN + có khung + buổi không huỷ / đóng", () => {
    expect(tietHopLe(T())).toBe(true);
    expect(tietHopLe(T({ daNhan: false }))).toBe(false);
    expect(tietLaViecHomNay(T({ daNhan: false }))).toBe(true); // màn ngữ cảnh vẫn hiện (kèm cảnh báo chưa nhận)
    expect(tietHopLe(T({ trangThai: "BUOI_DA_HUY" }))).toBe(false);
    expect(tietHopLe(T({ tinhTrang: "DA_DONG" }))).toBe(false);
    expect(tietHopLe(T({ khung: false }))).toBe(false); // ngày LEGACY
  });
  it("[H1-P2] trực: còn sống + nhận ĐÚNG phiên bản hiện tại", () => {
    const nhan = [{ assignmentVersion: 1, decision: "ACCEPTED" }];
    expect(trucHopLe({ status: "ACCEPTED", assignmentVersion: 1, acceptances: nhan })).toBe(true);
    expect(trucHopLe({ status: "WAITING_ACCEPTANCE", assignmentVersion: 2, acceptances: nhan })).toBe(false); // đổi phiên bản ⇒ phải nhận lại
    expect(trucHopLe({ status: "CANCELLED", assignmentVersion: 1, acceptances: nhan })).toBe(false);
    expect(trucHopLe({ status: "DECLINED", assignmentVersion: 1, acceptances: [{ assignmentVersion: 1, decision: "DECLINED" }] })).toBe(false);
  });
  it("[H1-P3] cơ sở: việc ở CS1 không che lượt ở CS2; ca thường che mọi nơi (luật cũ)", () => {
    const cs = new Set(["CS1"]);
    expect(coCongViecHopLeHomNay({ caThuong: false, coSoParttime: cs, centerId: "CS1" })).toBe(true);
    expect(coCongViecHopLeHomNay({ caThuong: false, coSoParttime: cs, centerId: "CS2" })).toBe(false);
    expect(coCongViecHopLeHomNay({ caThuong: true, coSoParttime: new Set(), centerId: "CS2" })).toBe(true);
    expect(coCongViecHopLeHomNay({ caThuong: false, coSoParttime: new Set(), centerId: "CS1" })).toBe(false);
  });
});

describe("[H1-E] engine — cờ mức ngày", () => {
  const L = (minute: number, direction: "CHECK_IN" | "CHECK_OUT", centerId?: string, flags?: string[]): EngineLog => ({ id: `${minute}`, minute, direction, centerId, flags });
  const ngay = (logs: EngineLog[], coSo: string[], extra: Partial<Parameters<typeof computeDay>[0]> = {}) =>
    computeDay({ assignment: null, logs, rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON, coSoViecParttime: new Set(coSo), ...extra }).flags;

  it("[H1-E1] không ca, mọi lượt ở cơ sở có việc ⇒ KHÔNG cờ; tập rỗng ⇒ cờ (luật cũ)", () => {
    expect(ngay([L(1067, "CHECK_IN", "CS1"), L(1175, "CHECK_OUT", "CS1")], ["CS1"])).not.toContain("CHAM_NGOAI_LICH");
    expect(ngay([L(1067, "CHECK_IN", "CS1"), L(1175, "CHECK_OUT", "CS1")], [])).toContain("CHAM_NGOAI_LICH");
  });
  it("[H1-E2] một lượt ở cơ sở KHÔNG có việc ⇒ ngày vẫn cờ (bảo thủ); lượt thiếu centerId ⇒ coi là không có việc", () => {
    expect(ngay([L(1067, "CHECK_IN", "CS2"), L(1175, "CHECK_OUT", "CS1")], ["CS2"])).toContain("CHAM_NGOAI_LICH");
    expect(ngay([L(1067, "CHECK_IN")], ["CS1"])).toContain("CHAM_NGOAI_LICH");
  });
  it("[H1-E3] cờ trên LƯỢT (gắn trước khi nhận lớp) bị bỏ khi cơ sở của lượt nay có việc; ở cơ sở khác thì giữ", () => {
    expect(ngay([L(1067, "CHECK_IN", "CS1", ["CHAM_NGOAI_LICH"])], ["CS1"])).not.toContain("CHAM_NGOAI_LICH");
    expect(ngay([L(1067, "CHECK_IN", "CS2", ["CHAM_NGOAI_LICH"])], ["CS1"])).toContain("CHAM_NGOAI_LICH");
  });
  it("[H1-E4] ô OFF / nghỉ + lượt ở cơ sở có việc ⇒ không cờ; không có việc ⇒ cờ (luật cũ)", () => {
    const off = { templateCode: "X", segments: [], attendanceMode: "NONE" as const, soCapQuetKyVong: 0 as const, dayCredit: 0, isLeave: false, nominalMinutes: 0, placeMode: "ANYWHERE" as const, isOff: true };
    expect(ngay([L(1067, "CHECK_IN", "CS1")], ["CS1"], { assignment: off })).not.toContain("CHAM_NGOAI_LICH");
    expect(ngay([L(1067, "CHECK_IN", "CS1")], [], { assignment: off })).toContain("CHAM_NGOAI_LICH");
  });
});

describe("[H1-W] dây nối — HAI đường gắn cờ cùng MỘT nguồn", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\/.*$/gm, "");
  it("[H1-W1] recordTimeLog: cờ chỉ gắn sau khi hỏi coCongViecHopLeHomNay với tập từ coSoCoViecParttimeAnToan, đúng cơ sở của lượt", () => {
    const s = doc("lib/cham-cong/timelog.ts");
    expect(s.match(/flags\.add\("CHAM_NGOAI_LICH"\)/g)?.length).toBe(1);
    expect(s).toMatch(/const coSoParttime = await coSoCoViecParttimeAnToan\(\{ userId: input\.userId, workDate, now \}\);/);
    expect(s).toMatch(/if \(!coCongViecHopLeHomNay\(\{ caThuong: false, coSoParttime, centerId: wl\?\.centerId \?\? home\.centerId \}\)\) flags\.add\("CHAM_NGOAI_LICH"\);/);
  });
  it("[H1-W2] recompute: truyền tập vào engine (trường BẮT BUỘC) và log mang centerId", () => {
    const s = doc("lib/cham-cong/recompute.ts");
    expect(s).toMatch(/await coSoCoViecParttimeAnToan\(\{ userId, workDate, now: opts\.now \?\? new Date\(\) \}\)/);
    expect(s).toMatch(/^\s+coSoViecParttime,$/m);
    expect(s).toMatch(/centerId: l\.centerId \}\)\);/);
  });
  it("[H1-W3] màn ngữ cảnh lọc tiết bằng CÙNG định nghĩa (không chép điều kiện)", () => {
    const s = doc("lib/parttime/ngu-canh-cham-cong-db.ts");
    expect(s).toMatch(/bc\.filter\(tietLaViecHomNay\)/);
    expect(s).not.toMatch(/tinhTrangBuoi !== "DA_DONG"/);
  });
});
