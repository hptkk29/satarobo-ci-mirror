import { describe, expect, it } from "vitest";
import { catalogByCode } from "./catalog";
import {
  computeDay,
  dedupeTaps,
  ketQuaNgayChuaDienRa,
  pairLogs,
  DEFAULT_RULES,
  m,
  type EngineAssignment,
  type EngineLog,
} from "./engine";
import { KHONG_CO_DON, type NguCanhDon } from "./don-trong-ngay";

// Test viết TRƯỚC hiện thực (luật cứng #5). Nguồn: kế hoạch v3.3 §4 + BA §6.3-bis (7 ví dụ
// dịch sang giờ Sheet: S 07:45–11:30 · C 13:45–17:30 · T 17:15–21:00; dung sai 30′ T-12).

const asg = (code: string, extra: Partial<EngineAssignment> = {}): EngineAssignment => {
  const e = catalogByCode(code)!;
  return {
    templateCode: e.code,
    segments: e.segments,
    attendanceMode: e.attendanceMode,
    // Lấy từ DANH MỤC, không gõ tay — ca test phải đi qua đúng giá trị mã ca thật mang.
    soCapQuetKyVong: e.soCapQuetKyVong,
    dayCredit: e.dayCredit,
    isLeave: e.isLeave,
    nominalMinutes: e.nominalMinutes,
    placeMode: "AT_UNITS",
    isOff: e.code === "X",
    ...extra,
  };
};
let n = 0;
const IN = (t: string, flags?: string[]): EngineLog => ({ id: `l${++n}`, minute: m(t), direction: "CHECK_IN", flags });
const OUT = (t: string): EngineLog => ({ id: `l${++n}`, minute: m(t), direction: "CHECK_OUT" });
const run = (code: string | null, logs: EngineLog[], extra: Partial<Parameters<typeof computeDay>[0]> = {}) =>
  computeDay({ assignment: code ? asg(code) : null, logs, rules: DEFAULT_RULES, nguCanhDon: KHONG_CO_DON, ...extra });

describe("ghép cặp GC-01..05, chống trùng GC-08", () => {
  it("VÀO/RA xen kẽ → cặp đóng; VÀO khi đang mở → cặp cũ THIEU_LUOT_RA; RA lẻ → RA_KHONG_CO_VAO", () => {
    const r = pairLogs([IN("07:40"), IN("09:00"), OUT("11:32"), OUT("12:00")]);
    expect(r.pairs.map((p) => [p.start, p.end, p.open])).toEqual([[m("07:40"), m("07:40"), true], [m("09:00"), m("11:32"), false]]);
    expect(r.flags.sort()).toEqual(["RA_KHONG_CO_VAO", "THIEU_LUOT_RA"]);
  });
  it("hết ngày còn cặp mở → THIEU_LUOT_RA", () => {
    expect(pairLogs([IN("07:40")]).flags).toEqual(["THIEU_LUOT_RA"]);
  });
  it("hai lượt VÀO cách 1′ → lượt sau là bấm trùng, không phá cấu trúc cặp", () => {
    const d = dedupeTaps([IN("07:40"), IN("07:41"), OUT("11:30")], 2);
    expect(d.dupIds).toHaveLength(1);
    expect(pairLogs(d.kept).flags).toEqual([]);
  });
});

describe("7 ví dụ BA §6.3-bis theo giờ Sheet", () => {
  it("VD-1 S: VÀO 07:43 · RA 11:32 → 3h45, không cờ", () => {
    const r = run("S", [IN("07:43"), OUT("11:32")]);
    expect(r.workedMinutes).toBe(225);
    expect(r.flags).toEqual([]);
    expect(r.dayCreditEarned).toBe(0.5);
  });
  it("VD-2 SC: 2 cặp → 7h30 (lỗ trưa không tính)", () => {
    const r = run("SC", [IN("07:43"), OUT("11:35"), IN("13:40"), OUT("17:33")]);
    expect(r.workedMinutes).toBe(450);
    expect([r.amWorked, r.pmWorked]).toEqual([225, 225]);
    expect(r.flags).toEqual([]);
  });
  it("VD-3 CT (liền 13:45–21:00): 1 cặp 13:40→21:05 → 7h15, không phải 3h45+3h45", () => {
    const r = run("CT", [IN("13:40"), OUT("21:05")]);
    expect(r.workedMinutes).toBe(435);
    expect(r.expectedMinutes).toBe(435);
    expect(r.flags).toEqual([]);
  });
  it("VD-4 CT: 2 cặp 13:40→16:00, 16:50→21:05 → 2h15 + 4h10 = 6h25", () => {
    const r = run("CT", [IN("13:40"), OUT("16:00"), IN("16:50"), OUT("21:05")]);
    expect(r.workedMinutes).toBe(135 + 250);
  });
  it("VD-5 S: VÀO 07:43 · VÀO 09:00 · RA 11:32 → cặp 09:00→11:32 = 2h30, cờ THIEU_LUOT_RA; muộn theo lượt đầu 07:43 nên không DI_MUON", () => {
    const r = run("S", [IN("07:43"), IN("09:00"), OUT("11:32")]);
    expect(r.workedMinutes).toBe(150);
    expect(r.flags).toContain("THIEU_LUOT_RA");
    expect(r.flags).not.toContain("DI_MUON");
  });
  it("VD-6 S: chỉ VÀO 07:43 → 0 giờ, có cờ, vẫn 1 công theo kế hoạch (T-01)", () => {
    const r = run("S", [IN("07:43")]);
    expect(r.workedMinutes).toBe(0);
    expect(r.flags).toContain("THIEU_LUOT_RA");
    expect(r.dayCreditEarned).toBe(0.5);
  });
  it("VD-7 không ca: VÀO 08:00 · RA 12:00 → 0 giờ trong ca, CHAM_NGOAI_LICH, 0 công", () => {
    const r = run(null, [IN("08:00"), OUT("12:00")]);
    expect(r.dayType).toBe("UNSCHEDULED");
    expect(r.workedMinutes).toBe(0);
    expect(r.rawPairedMinutes).toBe(240);
    expect(r.flags).toEqual(["CHAM_NGOAI_LICH"]);
    expect(r.dayCreditEarned).toBe(0);
  });
});

describe("giờ công theo mã (§4.4)", () => {
  it("CG: lỗ trưa 11:30–14:00 KHÔNG tính → 6h15 dù ở lại suốt", () => {
    const r = run("CG", [IN("08:55"), OUT("17:50")]);
    expect(r.workedMinutes).toBe(375);
  });
  it("CS: nghỉ 16:30–17:00 TÍNH (PAID_BREAK) → 7h00, paidBreakMinutes 30", () => {
    const r = run("CS", [IN("13:58"), OUT("21:02")]);
    expect(r.workedMinutes).toBe(420);
    expect(r.paidBreakMinutes).toBe(30);
  });
  it("CCT: 7h45; HC: 7h30 chia 3h30 sáng / 4h chiều", () => {
    expect(run("CCT", [IN("07:40"), OUT("11:30"), IN("13:45"), OUT("17:45")]).workedMinutes).toBe(465);
    const hc = run("HC", [IN("07:55"), OUT("11:30"), IN("13:30"), OUT("17:30")]);
    expect([hc.expectedMinutes, hc.amExpected, hc.pmExpected, hc.workedMinutes]).toEqual([450, 210, 240, 450]);
  });
  it("hai cặp liền kề (ra 09:00 rồi vào lại 09:00) → gộp, không tính đôi, không hụt", () => {
    const r = run("S", [IN("07:45"), OUT("09:00"), IN("09:00"), OUT("11:30")]);
    expect(r.workedMinutes).toBe(225);
    expect(r.flags).toEqual([]);
  });
});

describe("muộn / sớm / thiếu buổi (§4.5)", () => {
  it("vào 08:20 với ca S (07:45): quá 30′ → DI_MUON 35′", () => {
    const r = run("S", [IN("08:20"), OUT("11:30")]);
    expect(r.flags).toContain("DI_MUON");
    expect(r.lateMinutes).toBe(35);
  });
  it("vào 08:10 (25′) → không DI_MUON nhưng DEN_SAT_GIO (chỉ nhắc)", () => {
    const r = run("S", [IN("08:10"), OUT("11:30")]);
    expect(r.flags).not.toContain("DI_MUON");
    expect(r.flags).toContain("DEN_SAT_GIO");
    expect(r.lateMinutes).toBe(0);
  });
  it("vào 07:30 (trước ca 15′) → không cờ", () => {
    expect(run("S", [IN("07:30"), OUT("11:30")]).flags).toEqual([]);
  });
  it("ra 10:30 với S (11:30) → VE_SOM 60′", () => {
    const r = run("S", [IN("07:40"), OUT("10:30")]);
    expect(r.flags).toContain("VE_SOM");
    expect(r.earlyLeaveMinutes).toBe(60);
  });

  // ── Đơn ĐI MUỘN / VỀ SỚM ĐÃ DUYỆT (đợt 2 đơn từ, chốt Q-5 08/10/2026 "miễn trừ") ─────────
  // Ca S 07:45–11:30. Miễn trừ TRONG khung đã xin; vượt khung thì vẫn là vi phạm.
  describe("[MSD] khung đi muộn / về sớm đã duyệt", () => {
    const duyet = (denLuc: string | null, veLuc: string | null): { nguCanhDon: NguCanhDon } => ({
      nguCanhDon: { ...KHONG_CO_DON, muonSom: { denLuc: denLuc ? m(denLuc) : null, veLuc: veLuc ? m(veLuc) : null } },
    });

    it("[MSD-01] xin đến 08:30, tới 08:20 ⇒ DI_MUON_DA_DUYET (không DI_MUON); vẫn ghi đủ phút muộn", () => {
      const r = run("S", [IN("08:20"), OUT("11:30")], duyet("08:30", null));
      expect(r.flags).toContain("DI_MUON_DA_DUYET");
      expect(r.flags).not.toContain("DI_MUON");
      expect(r.lateMinutes).toBe(35); // BA 4.6: không xoá dữ liệu đi muộn
      expect(r.lateApprovedMinutes).toBe(35);
    });

    it("[MSD-02] xin đến 08:30, tới 09:10 ⇒ VẪN DI_MUON; phần được miễn = 45′ (07:45→08:30)", () => {
      const r = run("S", [IN("09:10"), OUT("11:30")], duyet("08:30", null));
      expect(r.flags).toContain("DI_MUON");
      expect(r.flags).not.toContain("DI_MUON_DA_DUYET");
      expect(r.lateMinutes).toBe(85);
      expect(r.lateApprovedMinutes).toBe(45);
    });

    it("[MSD-03] trong dung sai + có đơn ⇒ không nhắc DEN_SAT_GIO", () => {
      const r = run("S", [IN("08:05"), OUT("11:30")], duyet("08:30", null));
      expect(r.flags).not.toContain("DEN_SAT_GIO");
      expect(r.lateApprovedMinutes).toBe(20);
    });

    it("[MSD-04] xin về 10:00, về 10:15 ⇒ VE_SOM_DA_DUYET; phần được miễn = 75′ (10:15→11:30)", () => {
      const r = run("S", [IN("07:40"), OUT("10:15")], duyet(null, "10:00"));
      expect(r.flags).toContain("VE_SOM_DA_DUYET");
      expect(r.flags).not.toContain("VE_SOM");
      expect(r.earlyLeaveMinutes).toBe(75);
      expect(r.earlyLeaveApprovedMinutes).toBe(75);
    });

    it("[MSD-05] xin về 10:00, về 09:20 (sớm hơn giờ xin 40′ > dung sai 30′) ⇒ VẪN VE_SOM; phần được miễn = 90′", () => {
      const r = run("S", [IN("07:40"), OUT("09:20")], duyet(null, "10:00"));
      expect(r.flags).toContain("VE_SOM");
      expect(r.earlyLeaveMinutes).toBe(130);
      expect(r.earlyLeaveApprovedMinutes).toBe(90);
    });

    // ── Giờ đã xin là MỐC MỚI, dung sai 30′ tính từ đó (cố vấn bắt 08/10/2026) ──────────────
    // Không đơn: đến 08:14 (ca 07:45, muộn 29′) ⇒ KHÔNG cờ. Bản đầu so đúng phút với giờ xin, nên
    // có đơn đến 08:30 mà tới 08:32 lại ăn cờ đỏ — XIN PHÉP bị phạt nặng hơn KHÔNG xin.
    it("[MSD-08] không bao giờ tệ hơn không xin: đơn đến 08:30, tới 08:32 / 08:40 ⇒ DI_MUON_DA_DUYET", () => {
      expect(run("S", [IN("08:14"), OUT("11:30")]).flags).not.toContain("DI_MUON"); // đối chứng: không đơn
      for (const t of ["08:32", "08:40", "09:00"]) {
        const r = run("S", [IN(t), OUT("11:30")], duyet("08:30", null));
        expect(r.flags, t).toContain("DI_MUON_DA_DUYET");
        expect(r.flags, t).not.toContain("DI_MUON");
        expect(r.lateApprovedMinutes, t).toBe(45); // phần miễn vẫn chỉ tới giờ đã xin
      }
    });

    it("[MSD-09] về sớm đối xứng: đơn về 10:00, về 09:30 (đúng 30′ dung sai) ⇒ VE_SOM_DA_DUYET", () => {
      // Không đơn, về 11:00 (sớm đúng 30′ so với 11:30) ⇒ không cờ — mốc mới cũng vậy.
      expect(run("S", [IN("07:40"), OUT("11:00")]).flags).not.toContain("VE_SOM");
      const r = run("S", [IN("07:40"), OUT("09:30")], duyet(null, "10:00"));
      expect(r.flags).toContain("VE_SOM_DA_DUYET");
      expect(r.flags).not.toContain("VE_SOM");
      expect(r.earlyLeaveApprovedMinutes).toBe(90);
    });

    it("[MSD-06] đơn đi muộn KHÔNG miễn về sớm (và ngược lại) — khác chiều là khác vi phạm", () => {
      const r = run("S", [IN("07:40"), OUT("10:00")], duyet("08:30", null));
      expect(r.flags).toContain("VE_SOM");
      expect(r.earlyLeaveApprovedMinutes).toBe(0);
      const r2 = run("S", [IN("08:30"), OUT("11:30")], duyet(null, "10:00"));
      expect(r2.flags).toContain("DI_MUON");
      expect(r2.lateApprovedMinutes).toBe(0);
    });

    it("[MSD-07] không có đơn ⇒ hành vi cũ nguyên vẹn", () => {
      const r = run("S", [IN("08:20"), OUT("10:30")]);
      expect(r.flags).toEqual(expect.arrayContaining(["DI_MUON", "VE_SOM"]));
      expect(r.lateApprovedMinutes).toBe(0);
      expect(r.earlyLeaveApprovedMinutes).toBe(0);
    });
  });
  // 🔴 ĐỔI HÀNH VI 15/09/2026 cùng `soCapQuetKyVong` — đọc kỹ trước khi "sửa cho xanh".
  //
  // `SC` khai **1 cặp quét** trong bảng chốt. Người quét vào 07:40 và ra 11:30 ĐÃ ĐƯA ĐỦ
  // một cặp — họ không thiếu lượt, họ VỀ SỚM. Bản cũ lặp trên từng đoạn WORK nên đoạn
  // chiều "không ai phủ" và ra `THIEU_BUOI_CHIEU`, đọc thành "quên quét buổi chiều".
  //
  // Hai cờ mới nói đúng sự việc hơn: `VE_SOM` (về lúc 11:30 thay vì 17:30) + `THIEU_GIO`.
  //
  // ⚠️ Hệ quả trên dữ liệu THẬT: ngày cũ mang `THIEU_BUOI_CHIEU` ở các mã 1-cụm sẽ MẤT cờ
  // đó và NHẬN `VE_SOM` khi có lượt tính lại. Đây là đổi có chủ đích, không phải hồi quy.
  it("SC (1 cụm) chỉ chấm buổi sáng → KHÔNG phải thiếu lượt, mà là VỀ SỚM", () => {
    const r = run("SC", [IN("07:40"), OUT("11:30")]);
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
    expect(r.flags).toContain("VE_SOM");
    expect(r.earlyLeaveMinutes).toBe(360); // 11:30 → 17:30
    expect(r.flags).toContain("THIEU_GIO");
    expect(r.dayCreditEarned).toBe(1); // engine KHÔNG tự trừ công (luật T-01)
  });

  // Vế đối xứng: mã 2 CỤM thì thiếu một cụm VẪN là thiếu lượt — luật 16, nửa CHO QUA.
  it("ST (2 cụm) chỉ chấm cụm sáng → THIEU_BUOI_CHIEU, đúng nghĩa thiếu CỤM", () => {
    const r = run("ST", [IN("07:40"), OUT("11:30")]);
    expect(r.flags).toContain("THIEU_BUOI_CHIEU");
    expect(r.dayCreditEarned).toBe(1);
  });
  it("ST thiếu cụm SÁNG (chỉ chấm tối) → THIEU_BUOI_SANG — cờ theo THỨ TỰ CỤM", () => {
    const r = run("ST", [IN("17:10"), OUT("21:00")]);
    expect(r.flags).toContain("THIEU_BUOI_SANG");
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
  });

  // 🔑 Ca một CỤM không bao giờ mang cờ "thiếu cụm" — bảng chốt: cờ ấy chỉ có nghĩa khi ≥ 2.
  // `T` (17:15–21:00) là ca chiều/tối: mốc "trước 12h ⇒ SÁNG" của bản cũ sẽ in ra
  // `THIEU_BUOI_CHIEU` cho cụm DUY NHẤT, còn đánh theo chỉ số cụm thì ra `THIEU_BUOI_SANG`
  // cho một ca không có buổi sáng nào. Cả hai đều vô nghĩa ⇒ KHÔNG cờ nào.
  it("T (1 cụm) có lượt nhưng không phủ ca → KHÔNG cờ thiếu cụm nào", () => {
    const r = run("T", [IN("09:00"), OUT("09:30")]);
    expect(r.flags).not.toContain("THIEU_BUOI_SANG");
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
    expect(r.flags).toContain("THIEU_GIO"); // tín hiệu KHÔNG mất, chỉ nói đúng chuyện hơn
  });

  // Mã khai 0 cặp quét thì KHÔNG kiểm gì — kể cả khi `attendanceMode` là REQUIRED.
  it("soCapQuetKyVong = 0 ⇒ không KHONG_CO_LUOT, không cờ thiếu cụm", () => {
    const r = run("S", [], { assignment: asg("S", { soCapQuetKyVong: 0 }) });
    expect(r.flags).not.toContain("KHONG_CO_LUOT");
    expect(r.flags).not.toContain("THIEU_BUOI_SANG");
    expect(r.dayCreditEarned).toBe(0.5); // công vẫn theo kế hoạch
  });

  // `arrivalDeltaMinutes` đo ở CỤM ĐẦU. Bản cũ so `blk === planned[0]`; nay cụm là object
  // MỚI nên phép so địa chỉ ấy không bao giờ đúng — ca này canh đúng chỗ đó.
  it("đến muộn ở cụm đầu → arrivalDeltaMinutes ghi THÔ, không chịu dung sai", () => {
    const r = run("HC", [IN("08:20"), OUT("17:30")]);
    expect(r.arrivalDeltaMinutes).toBe(20);
  });
  it("ca REQUIRED không lượt nào → KHONG_CO_LUOT, VẪN đủ công theo kế hoạch", () => {
    const r = run("T", []);
    expect(r.flags).toEqual(["KHONG_CO_LUOT"]);
    expect(r.dayCreditEarned).toBe(0.5);
    expect(r.workedMinutes).toBe(0);
  });
  it("C/T chồng 15′ trên Sheet: CT vào 17:20 ra 21:00 sau khi đã làm 13:45–17:20 → 1 cụm, không DI_MUON lần hai", () => {
    const r = run("CT", [IN("13:44"), OUT("17:20"), IN("17:21"), OUT("21:00")]);
    expect(r.flags).toEqual([]);
    expect(r.workedMinutes).toBe(434); // hụt đúng 1′ giữa 17:20 và 17:21 — không có cờ vì < 60′
  });
});

describe("mã không giờ, nghỉ, lễ, miễn công", () => {
  it("LD (T-03): 1 công, 0 giờ, không cờ dù không lượt; có lượt thì ghi giờ thô", () => {
    const r = run("LD", []);
    expect([r.dayCreditEarned, r.expectedMinutes, r.workedMinutes, r.flags]).toEqual([1, 0, 0, []]);
    expect(run("LD", [IN("09:00"), OUT("12:00")]).rawPairedMinutes).toBe(180);
  });
  // 🔴 ĐẢO 15/09/2026 (phần A). Cũ: NG OPTIONAL ⇒ đi công tác không cần lượt nào, không cờ.
  // Nay: NG REQUIRED + 1 cặp quét ⇒ không bấm Check in/out thì CÓ cờ `KHONG_CO_LUOT`.
  //
  // Công VẪN 1 và giờ kế hoạch VẪN 450 — engine không tự trừ công (luật T-01). Cú đảo đổi
  // TÍN HIỆU (có đi không, có bấm không), KHÔNG đổi TIỀN.
  it("NG: REQUIRED, không bấm nút nào → KHONG_CO_LUOT, nhưng VẪN 1 công", () => {
    const r = run("NG", []);
    expect([r.dayCreditEarned, r.expectedMinutes]).toEqual([1, 450]);
    expect(r.flags).toContain("KHONG_CO_LUOT");
  });
  it("NG: bấm đủ một cặp vào–ra → KHÔNG cờ thiếu lượt nào", () => {
    // Đây là vế CHO QUA của luật 16: đảo mà chỉ kiểm vế "thiếu thì có cờ" là không biết
    // người làm ĐÚNG có sạch cờ hay không.
    const r = run("NG", [IN("08:00"), OUT("17:30")]);
    expect(r.flags).not.toContain("KHONG_CO_LUOT");
    expect(r.flags).not.toContain("THIEU_BUOI_SANG");
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
    expect(r.dayCreditEarned).toBe(1);
  });
  it("D1: LOCATION_ONLY, 1 công 0 giờ", () => {
    expect(run("D1", []).dayCreditEarned).toBe(1);
  });
  it("X: WEEKLY_OFF, 0 công; có lượt → CHAM_NGOAI_LICH", () => {
    const r = run("X", [IN("08:00"), OUT("12:00")]);
    expect(r.dayType).toBe("WEEKLY_OFF");
    expect(r.dayCreditEarned).toBe(0);
    expect(r.flags).toEqual(["CHAM_NGOAI_LICH"]);
  });
  it("P: LEAVE, 0 công, leaveUnits 1", () => {
    const r = run("P", []);
    expect([r.dayType, r.dayCreditEarned, r.leaveUnits]).toEqual(["LEAVE", 0, 1]);
  });
  it("lễ (T-04): SC ngày lễ hệ số 3 → holidayPaidUnits 3, dayCreditEarned 0, không cờ thiếu; có lượt → LAM_NGAY_LE", () => {
    const r = run("SC", [], { holiday: { coefficient: 3, effect: "PAID_LEAVE" } });
    expect([r.dayType, r.holidayPaidUnits, r.dayCreditEarned, r.flags]).toEqual(["HOLIDAY", 3, 0, []]);
    expect(run("SC", [IN("08:00"), OUT("11:00")], { holiday: { coefficient: 1, effect: "PAID_LEAVE" } }).flags).toEqual(["LAM_NGAY_LE"]);
    expect(run("SC", [], { holiday: { coefficient: 2, effect: "UNPAID_OFF" } }).holidayPaidUnits).toBe(0);
  });
  it("lễ INFO_ONLY không đổi cách tính", () => {
    const r = run("S", [IN("07:43"), OUT("11:32")], { holiday: { coefficient: 1, effect: "INFO_ONLY" } });
    expect(r.dayType).toBe("WORK");
  });
  it("miễn công (T-02): exempt=true, không công, không cờ", () => {
    const r = run("SC", [IN("07:43")], { exempt: true });
    expect(r.exempt).toBe(true);
    expect(r.dayCreditEarned).toBe(0);
    expect(r.flags).toEqual([]);
  });
});

// ══ HC CHẤM SÁNG/CHIỀU RIÊNG (chốt 22/09/2026) ═══════════════════════════════════════════
//
// `HC` đảo `soCapQuetKyVong` 1 → 2. Ba ca dưới đo ĐÚNG ba đường ra của một ngày HC, vì đặt
// `2` MỘT MÌNH không bịt được lỗ: cổng `covered` tha cặp dài phủ chồng cả hai cụm.
describe("HC 2 cặp quét — đòi đủ 4 lượt", () => {
  it("mã HC mang 2 cặp quét (đọc từ DANH MỤC, không gõ tay)", () => {
    // Neo vào nguồn: ca dưới vô nghĩa nếu ai đó lặng lẽ hạ HC về 1.
    expect(catalogByCode("HC")!.soCapQuetKyVong).toBe(2);
  });

  it("quét đủ 4 lượt ⇒ SẠCH cờ, đủ 450′", () => {
    const r = run("HC", [IN("08:00"), OUT("11:30"), IN("13:30"), OUT("17:30")]);
    expect(r.flags).toEqual([]);
    expect(r.workedMinutes).toBe(450);
  });

  it("làm thẳng qua trưa, chỉ 2 lượt ⇒ THIEU_LUOT_GIUA_CA (đây là lỗ cũ)", () => {
    // TRƯỚC bản vá 22/09 ca này ra `flags: []` — `soCapQuetKyVong: 2` không đủ, vì cặp
    // [08:00, 17:30] phủ chồng cụm chiều nên `covered` bỏ qua nó.
    const r = run("HC", [IN("08:00"), OUT("17:30")]);
    expect(r.flags).toContain("THIEU_LUOT_GIUA_CA");
    // KHÔNG mượn cờ "thiếu nửa ngày": họ có mặt cả hai buổi. `noi-quy.thieuNuaNgay()` đọc
    // hai cờ đó để loại ngày khỏi `caThucTe` — mượn là phạt sai người.
    expect(r.flags).not.toContain("THIEU_BUOI_SANG");
    expect(r.flags).not.toContain("THIEU_BUOI_CHIEU");
    // Engine CHỈ gắn cờ, không tự trừ (luật §5 đầu file) — công và giờ giữ nguyên.
    expect(r.workedMinutes).toBe(450);
    expect(r.dayCreditEarned).toBe(r.dayCreditExpected);
  });

  it("quét sáng rồi về luôn ⇒ THIEU_BUOI_CHIEU, và KHÔNG chồng cờ mới", () => {
    const r = run("HC", [IN("08:00"), OUT("11:30")]);
    expect(r.flags).toContain("THIEU_BUOI_CHIEU");
    expect(r.flags).not.toContain("THIEU_LUOT_GIUA_CA");
  });

  it("cờ mới có CHỖ ĐỌC: nằm trong cả tập admin và tập site GV (luật 10)", async () => {
    const { CO_CANH_BAO } = await import("./tong-hop-cong");
    const { CO_CAN_XU_LY } = await import("./bang-cong-gv");
    const { flagInfo, countsAsIssue } = await import("./flag-labels");
    expect(CO_CANH_BAO.has("THIEU_LUOT_GIUA_CA")).toBe(true);
    expect(CO_CAN_XU_LY.has("THIEU_LUOT_GIUA_CA")).toBe(true);
    // Có nhãn tiếng Việt thật, không in ra mã trần cho người dùng đọc.
    expect(flagInfo("THIEU_LUOT_GIUA_CA").text).toBe("Thiếu lượt giữa ca");
    expect(countsAsIssue("THIEU_LUOT_GIUA_CA")).toBe(true);
  });
});

describe("cờ chuyển tiếp + trần lượt (GC-07)", () => {
  it("cờ NGOAI_VUNG trên lượt được đưa lên ngày", () => {
    expect(run("S", [IN("07:43", ["NGOAI_VUNG"]), OUT("11:30")]).flags).toContain("NGOAI_VUNG");
  });
  it("11 lượt → VUOT_TRAN nhưng các cặp hợp lệ vẫn tính", () => {
    const logs: EngineLog[] = [];
    for (let i = 0; i < 6; i += 1) logs.push(IN(`${8 + i}:00`), OUT(`${8 + i}:30`));
    const r = run("HC", logs.slice(0, 11));
    expect(r.flags).toContain("VUOT_TRAN");
    expect(r.workedMinutes).toBeGreaterThan(0);
  });
  it("ruleSnapshot ghi tham số đã dùng", () => {
    expect(run("S", []).ruleSnapshot).toMatchObject({ rules: DEFAULT_RULES, templateCode: "S" });
  });
});

// ══ NGÀY CHƯA DIỄN RA (sự cố 16/09/2026) ═════════════════════════════════════════════════
//
// Chủ dự án bắt trên localhost: bảng in "Không có lượt" cho 17/09 → 30/09 kèm đường dẫn
// "Nộp đơn chỉnh công" — màn bảo người ta xin bổ sung giờ cho NGÀY MAI. Đo prod hôm ấy:
// 250 dòng ngày chưa diễn ra, 196 cờ oan, 185 công.
//
// Chốt của chủ dự án: giữ KẾ HOẠCH, bỏ CỜ và CÔNG THỰC NHẬN.
describe("ketQuaNgayChuaDienRa — giữ kế hoạch, xoá vế đã xảy ra", () => {
  // Đúng hình dạng dòng prod sinh ra: ca REQUIRED, không lượt quét nào.
  const ngayChuaToi = () => run("HC", []);

  it("bản GỐC (ngày đã khép) đúng là có cờ và có công — nếu không thì ca dưới vô nghĩa", () => {
    // Vế này phải xanh TRƯỚC, kẻo ca chính chỉ chứng minh "0 bằng 0".
    const r = ngayChuaToi();
    expect(r.flags).toContain("KHONG_CO_LUOT");
    expect(r.dayCreditEarned).toBeGreaterThan(0);
  });

  it("xoá HẾT cờ, không lọc riêng nhóm thiếu-quét", () => {
    const r = ketQuaNgayChuaDienRa(ngayChuaToi());
    expect(r.flags).toEqual([]);
  });

  it("xoá cả BỐN vế đã nhận — kể cả leaveUnits/holidayPaidUnits", () => {
    // `buildPeriodSummary` của màn Kỳ công cộng thẳng hai cột sau. Bỏ sót chúng là vá được
    // màn cá nhân mà màn Kỳ công vẫn cộng ngày chưa tới — cùng bug, chỗ khác.
    const r = ketQuaNgayChuaDienRa({
      ...ngayChuaToi(),
      dayCreditEarned: 1,
      hourCredit: 0.5,
      leaveUnits: 1,
      holidayPaidUnits: 1,
    });
    expect([r.dayCreditEarned, r.hourCredit, r.leaveUnits, r.holidayPaidUnits]).toEqual([0, 0, 0, 0]);
  });

  it("GIỮ NGUYÊN kế hoạch — đây là thứ màn Kỳ công cần để chốt sổ", () => {
    const goc = ngayChuaToi();
    const r = ketQuaNgayChuaDienRa(goc);
    expect(r.dayCreditExpected).toBe(goc.dayCreditExpected);
    expect(r.dayCreditExpected).toBeGreaterThan(0); // fixture phải có kế hoạch thật
    expect(r.expectedMinutes).toBe(goc.expectedMinutes);
    expect(r.amExpected).toBe(goc.amExpected);
    expect(r.pmExpected).toBe(goc.pmExpected);
    expect(r.dayType).toBe(goc.dayType);
  });

  it("KHÔNG giấu lượt quét có thật của ngày tương lai", () => {
    // Nếu một ngày chưa tới mà lại CÓ mốc quét thì đó là tín hiệu thật (ai đó quét nhầm
    // ngày, hoặc đồng hồ lệch) — hàm này không được xoá dấu vết ấy đi.
    const goc = run("HC", [IN("07:45"), OUT("11:30")]);
    const r = ketQuaNgayChuaDienRa(goc);
    expect(r.workedMinutes).toBe(goc.workedMinutes);
    expect(r.workedMinutes).toBeGreaterThan(0);
    expect(r.pairs).toEqual(goc.pairs);
  });
});
