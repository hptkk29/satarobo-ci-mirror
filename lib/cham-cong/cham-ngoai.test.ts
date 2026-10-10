// Đợt 5–6 đơn từ — được chấm ngoài điểm chấm lúc này không (`quyenChamNgoai`) + engine với ngữ cảnh
// làm từ xa / công tác.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quyenChamNgoai } from "./cham-ngoai";
import type { DonHieuLuc } from "./don-trong-ngay";
import { dungNguCanhDon, KHONG_CO_DON } from "./don-trong-ngay";
import { catalogByCode } from "./catalog";
import { computeDay, DEFAULT_RULES, m, type EngineAssignment } from "./engine";
import { NOI_QUY_MAC_DINH, thongKeNguoi } from "./noi-quy";

const don = (kind: DonHieuLuc["kind"], startTime: string | null = null, endTime: string | null = null): DonHieuLuc => ({
  id: kind,
  kind,
  detail: null,
  startTime,
  endTime,
  approvedStartTime: null,
  approvedEndTime: null,
  leaveDurationType: null,
  leavePaidRatio: null,
  tyLeNghiBu: null,
  loaiNgayNghi: null,
});
const q = (opts: { placeMode?: string | null; don?: DonHieuLuc[]; luc: string }) =>
  quyenChamNgoai({ placeMode: opts.placeMode ?? "AT_UNITS", don: opts.don ?? [], phut: m(opts.luc), dungSaiPhut: 30 });

describe("[CN] quyenChamNgoai", () => {
  it("[CN-01] không ca công tác, không đơn ⇒ KHÔNG được chấm ngoài (luật vị trí bình thường)", () => {
    expect(q({ luc: "09:00" })).toBeNull();
  });

  it("[CN-02] ca OFFSITE (xếp tay) ⇒ được, không gắn cờ mới", () => {
    expect(q({ placeMode: "OFFSITE", luc: "09:00" })).toMatchObject({ lyDo: "CA_CONG_TAC", co: null });
  });

  it("[CN-03] đơn công tác đã duyệt ⇒ cả ngày; cờ lượt CONG_TAC", () => {
    expect(q({ don: [don("BUSINESS_TRIP")], luc: "22:00" })).toMatchObject({ lyDo: "CONG_TAC", co: "CONG_TAC" });
  });

  it("[CN-04] làm từ xa không khai giờ ⇒ cả ngày", () => {
    expect(q({ don: [don("REMOTE")], luc: "07:00" })).toMatchObject({ lyDo: "LAM_TU_XA", co: "LAM_TU_XA" });
  });

  it("[CN-05] làm từ xa 14:00–16:00: trong khung + dung sai 30′ ⇒ được; NGOÀI ⇒ không (không mở cả ngày)", () => {
    const d = [don("REMOTE", "14:00", "16:00")];
    expect(q({ don: d, luc: "13:30" })).not.toBeNull();
    expect(q({ don: d, luc: "16:30" })).not.toBeNull();
    expect(q({ don: d, luc: "09:00" })).toBeNull();
    expect(q({ don: d, luc: "16:31" })).toBeNull();
  });

  it("[CN-06] đơn khác loại (OT, đi muộn) KHÔNG mở chấm ngoài", () => {
    expect(q({ don: [don("OT", "18:00", "21:00"), don("LATE_EARLY", "09:00")], luc: "19:00" })).toBeNull();
  });
});

describe("[CN-E] engine với ngữ cảnh làm từ xa / công tác", () => {
  const e = catalogByCode("HC")!;
  const asg: EngineAssignment = {
    templateCode: "HC",
    segments: e.segments,
    attendanceMode: e.attendanceMode,
    soCapQuetKyVong: e.soCapQuetKyVong,
    dayCredit: e.dayCredit,
    isLeave: false,
    nominalMinutes: e.nominalMinutes ?? null,
    placeMode: "AT_UNITS",
  };
  const congTac = dungNguCanhDon([don("BUSINESS_TRIP")]);

  it("[CN-E1] làm từ xa: cờ 'Làm từ xa — Đã duyệt' nhưng VẪN đòi quét (không mặc định đủ công)", () => {
    const r = computeDay({ assignment: asg, logs: [], rules: DEFAULT_RULES, nguCanhDon: dungNguCanhDon([don("REMOTE")]) });
    expect(r.flags).toContain("LAM_TU_XA_DUYET");
    expect(r.flags).toContain("KHONG_CO_LUOT");
  });

  it("[CN-E2] công tác chế độ ĐỦ CÔNG: không quét vẫn không cờ thiếu lượt, công = kế hoạch", () => {
    const r = computeDay({ assignment: asg, logs: [], rules: DEFAULT_RULES, nguCanhDon: congTac });
    expect(r.flags).toEqual(expect.arrayContaining(["CONG_TAC_DUYET", "CONG_TAC_DU_CONG"]));
    expect(r.flags).not.toContain("KHONG_CO_LUOT");
    expect(r.dayCreditEarned).toBe(r.dayCreditExpected);
  });

  it("[CN-E3] công tác chế độ VẪN CHẤM: thiếu lượt vẫn báo như ngày thường", () => {
    const r = computeDay({ assignment: asg, logs: [], rules: { ...DEFAULT_RULES, congTacDuCong: false }, nguCanhDon: congTac });
    expect(r.flags).toContain("CONG_TAC_DUYET");
    expect(r.flags).not.toContain("CONG_TAC_DU_CONG");
    expect(r.flags).toContain("KHONG_CO_LUOT");
  });

  it("[CN-E4] công tác ngày KHÔNG ca: lượt quét không bị gọi 'chấm ngoài lịch'; công 0 (Q-9 mặc định bảo thủ)", () => {
    const r = computeDay({
      assignment: null,
      logs: [{ id: "a", minute: m("09:00"), direction: "CHECK_IN" }],
      rules: DEFAULT_RULES,
      nguCanhDon: congTac,
    });
    expect(r.flags).not.toContain("CHAM_NGOAI_LICH");
    expect(r.flags).toContain("CONG_TAC_DUYET");
    expect(r.dayCreditEarned).toBe(0);
    // Đối chứng: không có đơn thì vẫn là chấm ngoài lịch.
    expect(computeDay({ assignment: null, logs: [{ id: "a", minute: m("09:00"), direction: "CHECK_IN" }], rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON }).flags).toContain("CHAM_NGOAI_LICH");
  });

  it("[CN-E5] nội quy: ngày công tác đủ công KHÔNG vào mẫu số 'ca thực tế'", () => {
    const ngay = {
      dayType: "WORK",
      dayCreditExpected: 1,
      arrivalDeltaMinutes: 0,
      lateApprovedMinutes: 0,
      pairs: [],
      absenceStatus: null,
      templateCode: "HC",
    };
    expect(thongKeNguoi([{ ...ngay, flags: ["CONG_TAC_DUYET", "CONG_TAC_DU_CONG"] }], NOI_QUY_MAC_DINH).caQuyDinh).toBe(0);
    expect(thongKeNguoi([{ ...ngay, flags: [] }], NOI_QUY_MAC_DINH).caQuyDinh).toBe(1);
  });
});

describe("[CN-W] dây nối: nút hiện ⇔ bấm được ⇔ luật vị trí cùng MỘT hàm", () => {
  const doc = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8").replace(/\r\n/g, "\n");

  it("[CN-W1] timelog: trong khung đơn đã duyệt, quét ở điểm khác là cờ THÔNG TIN, không phải SAI_NOI_LAM", () => {
    const src = doc("lib/cham-cong/timelog.ts");
    expect(src.match(/quyenChamNgoai\(\{/g)).toHaveLength(1);
    expect(src).toContain('if (!okUnit) flags.add(chamNgoai?.co ?? "SAI_NOI_LAM");');
    // Geofence KHÔNG được nới theo đơn: cổng OUTSIDE_GEOFENCE không nhắc tới chamNgoai.
    const khoiGeofence = src.slice(src.indexOf("if (wl != null && wl.geofenceEnabled"), src.indexOf("// Sai nơi làm"));
    expect(khoiGeofence).not.toMatch(/chamNgoai/);
  });

  it("[CN-W2] cổng của nút (chamCongTac) hỏi quyenChamNgoai, KHÔNG còn so placeMode tại chỗ", () => {
    const src = doc("lib/cham-cong/cong-tac-action.ts");
    expect(src.match(/quyenChamNgoai\(\{/g)).toHaveLength(1);
    expect(src).not.toMatch(/placeMode !== "OFFSITE"/);
  });

  it("[CN-W3] hai trang (site GV + admin) vẽ nút theo quyenChamNgoaiLucNay", () => {
    for (const p of ["app/(teacher)/teacher/cham-cong/page.tsx", "app/(admin)/admin/cham-cong/checkin/page.tsx"]) {
      const src = doc(p);
      expect(src, p).toMatch(/quyenChamNgoaiLucNay\(session\.user\.id, now\)/);
      expect(src, p).toMatch(/<NutChamNgoai/);
    }
  });
});
