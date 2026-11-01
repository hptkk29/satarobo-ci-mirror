// lib/ai-lead/dich-vu/bo-quy-tac.test.ts — schema + engine THUẦN của bộ quy tắc (Rule Builder). Không DB, không đồng hồ thật (mốc thời gian truyền vào — luật 19).
// Mỗi ca tự dựng dữ liệu (luật 18). Phần nối DB/publish/rollback: tests/ai-lead/bo-quy-tac.spec.ts.
import { describe, expect, it } from "vitest";
import { BAC_MAC_DINH, cacBacDenHan, cacBacThongBao, cuaSoQuetPhut, DEM_CUA_SO_QUET_PHUT, hanSlaTheoQuyTac, thuHepTuTao, timQuyTacAuto } from "./bo-quy-tac";
import { luuSlaThongBaoSchema } from "./bo-quy-tac-schema";
import { boQuyTacSchema, chuanHoaBoQuyTac, chuoiChuan, khoaQuyTac, SO_QUY_TAC_TOI_DA, type BoQuyTac, type QuyTac } from "./bo-quy-tac-schema";

const AG = "cm0agentaaaaaaaaaaaaaaaa1";
const CS1 = "cm0coso1aaaaaaaaaaaaaaaaa";
const CS2 = "cm0coso2aaaaaaaaaaaaaaaaa";
const PG = "104500000000777";
const bo = (...rules: QuyTac[]): BoQuyTac => ({ rules });

describe("[BQT-SCH] schema: chỉ BỐN loại, strict, không userId, không trùng khoá", () => {
  const ok: QuyTac[] = [
    { kind: "ROUTE_PAGE_TO_CAMPUS", agentId: AG, pageId: PG, centerId: CS1 },
    { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, requireConsent: true, campusCenterIds: [CS1] },
    { kind: "SLA", scope: { type: "PAGE", pageId: PG }, claimMinutes: 30, resolveMinutes: 240 },
    { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: CS1, afterMinutes: 60, to: ["HO_REVIEWERS"] },
  ];
  it("[BQT-SCH-01] bộ hợp lệ đủ bốn loại ⇒ qua", () => {
    expect(boQuyTacSchema.safeParse(bo(...ok)).success).toBe(true);
    expect(boQuyTacSchema.safeParse({ rules: [] }).success).toBe(true);
  });
  it("[BQT-SCH-02] loại lạ · khoá thừa ở bất kỳ tầng nào · thiếu khoá bắt buộc ⇒ từ chối", () => {
    const hong: unknown[] = [
      { kind: "RUN_SCRIPT", code: "x" },
      { ...ok[0], extra: 1 },
      { ...ok[1], campusCenterIds: [CS1], thua: true },
      { ...ok[2], scope: { type: "PAGE", pageId: PG, thua: 1 } },
      { ...ok[3], to: ["HO_REVIEWERS"], userIds: ["u1"] },
      { kind: "AUTO_CREATE", agentId: AG, pageId: PG },
    ];
    for (const r of hong) expect(boQuyTacSchema.safeParse({ rules: [r] }).success, JSON.stringify(r)).toBe(false);
    expect(boQuyTacSchema.safeParse({ rules: [], thua: 1 }).success).toBe(false);
  });
  it("[BQT-SCH-03] người nhận là enum ĐÓNG: không userId, không rỗng, không nhóm lạ", () => {
    const n = ok[3] as Extract<QuyTac, { kind: "NOTIFY" }>;
    for (const to of [[], ["u_123"], ["ADMIN"], ["CENTER_MANAGER", "u_123"]]) expect(boQuyTacSchema.safeParse(bo({ ...n, to: to as never })).success, JSON.stringify(to)).toBe(false);
  });
  it("[BQT-SCH-04] SLA: hạn nhận > hạn xử lý ⇒ từ chối; biên 5/10080/43200 qua, ngoài biên không", () => {
    const sla = (claimMinutes: number, resolveMinutes: number) => boQuyTacSchema.safeParse(bo({ kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes, resolveMinutes })).success;
    expect(sla(5, 5)).toBe(true);
    expect(sla(10_080, 43_200)).toBe(true);
    expect(sla(240, 30)).toBe(false);
    expect(sla(4, 30)).toBe(false);
    expect(sla(30, 43_201)).toBe(false);
    expect(sla(10.5, 30)).toBe(false);
  });
  it("[BQT-SCH-05] trùng khoá ⇒ từ chối cả bộ (không âm thầm đè); khác khoá ⇒ qua", () => {
    const a = ok[0] as Extract<QuyTac, { kind: "ROUTE_PAGE_TO_CAMPUS" }>;
    expect(boQuyTacSchema.safeParse(bo(a, { ...a, centerId: CS2 })).success).toBe(false);
    expect(boQuyTacSchema.safeParse(bo(a, { ...a, pageId: "104500000000778" })).success).toBe(true);
    const n = ok[3] as Extract<QuyTac, { kind: "NOTIFY" }>;
    expect(boQuyTacSchema.safeParse(bo(n, { ...n, afterMinutes: 120 })).success).toBe(true); // hai bậc khác nhau của cùng sự kiện
    expect(boQuyTacSchema.safeParse(bo(n, { ...n, to: ["CENTER_MANAGER"] })).success).toBe(false); // cùng bậc
  });
  it("[BQT-SCH-06b] quá trần ⇒ câu lỗi TIẾNG VIỆT nêu con số (không phải câu Zod tiếng Anh), ở cả hai schema", () => {
    const nhieu = Array.from({ length: SO_QUY_TAC_TOI_DA + 1 }, (_, i) => ({ kind: "SLA", scope: { type: "PAGE", pageId: `p${String(i).padStart(5, "0")}` }, claimMinutes: 30, resolveMinutes: 240 }));
    const r1 = boQuyTacSchema.safeParse({ rules: nhieu });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.error.issues[0]!.message).toMatch(/tối đa 300 quy tắc/);
    const r2 = luuSlaThongBaoSchema.safeParse({ baseVersion: 0, rules: nhieu, lyDo: "Lý do đủ dài để ghi nhật ký" });
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.error.issues[0]!.message).toMatch(/tối đa 300 quy tắc/);
  });
  it("[BQT-SCH-06] quá SO_QUY_TAC_TOI_DA ⇒ từ chối; mảng cơ sở > 50 ⇒ từ chối", () => {
    const nhieu = Array.from({ length: SO_QUY_TAC_TOI_DA + 1 }, (_, i) => ({ kind: "SLA", scope: { type: "PAGE", pageId: `p${String(i).padStart(6, "0")}` }, claimMinutes: 30, resolveMinutes: 60 }));
    expect(boQuyTacSchema.safeParse({ rules: nhieu }).success).toBe(false);
    const cs = Array.from({ length: 51 }, (_, i) => `cm0coso${String(i).padStart(14, "0")}x`);
    expect(boQuyTacSchema.safeParse(bo({ ...(ok[1] as QuyTac), campusCenterIds: cs } as QuyTac)).success).toBe(false);
  });
  it("[BQT-SCH-07] dạng CHUẨN: cùng nội dung khác thứ tự/khác trùng lặp ⇒ cùng chuỗi; khác nội dung ⇒ khác chuỗi", () => {
    const a = boQuyTacSchema.parse(bo(...ok));
    const dao = boQuyTacSchema.parse(bo(...[...ok].reverse()));
    expect(chuoiChuan(dao)).toBe(chuoiChuan(a));
    const n = ok[3] as Extract<QuyTac, { kind: "NOTIFY" }>;
    const lap = boQuyTacSchema.parse(bo({ ...n, to: ["HO_REVIEWERS", "CENTER_MANAGER", "HO_REVIEWERS"] }));
    const khong = boQuyTacSchema.parse(bo({ ...n, to: ["CENTER_MANAGER", "HO_REVIEWERS"] }));
    expect(chuoiChuan(lap)).toBe(chuoiChuan(khong));
    expect(chuoiChuan(boQuyTacSchema.parse(bo({ ...n, afterMinutes: 61 })))).not.toBe(chuoiChuan(boQuyTacSchema.parse(bo(n))));
    // `requireConsent:false` và `campusCenterIds:[]` là KHÔNG thu hẹp ⇒ chuẩn hoá bỏ đi (không tạo phiên bản "khác" vô nghĩa)
    const a1 = boQuyTacSchema.parse(bo({ kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, requireConsent: false, campusCenterIds: [] }));
    const a2 = boQuyTacSchema.parse(bo({ kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true }));
    expect(chuoiChuan(a1)).toBe(chuoiChuan(a2));
    expect(chuanHoaBoQuyTac(a1).rules).toHaveLength(1);
  });
  it("[BQT-SCH-09] MÃ CƠ SỞ thật là SLUG (PROD: co-so-nguyen-huu-tho · co-so-hoang-dieu · hoi-so — đo chỉ-đọc 28/10/2026): mọi loại quy tắc nhận slug; ký tự lạ / rỗng / quá dài bị từ chối", () => {
    for (const cs of ["co-so-hoang-dieu", "co-so-nguyen-huu-tho", "hoi-so", "cm0coso1aaaaaaaaaaaaaaaaa", "CS_2"]) {
      const bo2: QuyTac[] = [
        { kind: "ROUTE_PAGE_TO_CAMPUS", agentId: AG, pageId: PG, centerId: cs },
        { kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, campusCenterIds: [cs] },
        { kind: "SLA", scope: { type: "CAMPUS", centerId: cs }, claimMinutes: 30, resolveMinutes: 60 },
        { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: cs, afterMinutes: 0, to: ["CENTER_MANAGER"] },
      ];
      expect(boQuyTacSchema.safeParse(bo(...bo2)).success, cs).toBe(true);
    }
    for (const xau of ["", " co-so", "co so", "../x", "-co-so", "co-so;drop", "x".repeat(65), "co-so/1"]) {
      expect(boQuyTacSchema.safeParse(bo({ kind: "SLA", scope: { type: "CAMPUS", centerId: xau }, claimMinutes: 30, resolveMinutes: 60 })).success, JSON.stringify(xau)).toBe(false);
      expect(boQuyTacSchema.safeParse(bo({ kind: "ROUTE_PAGE_TO_CAMPUS", agentId: AG, pageId: PG, centerId: xau })).success, JSON.stringify(xau)).toBe(false);
    }
    // agentId vẫn là cuid do Gateway sinh — slug KHÔNG được làm agentId.
    expect(boQuyTacSchema.safeParse(bo({ kind: "ROUTE_PAGE_TO_CAMPUS", agentId: "co-so-hoang-dieu", pageId: PG, centerId: null })).success).toBe(false);
  });
  it("[BQT-SCH-08] khoaQuyTac phân biệt đúng từng loại", () => {
    expect(new Set(ok.map(khoaQuyTac)).size).toBe(4);
  });
});

describe("[BQT-SLA] hạn SLA: CAMPUS > PAGE > DEFAULT > tham số", () => {
  const TS = { slaClaimMinutes: 15, slaResolveMinutes: 120 };
  const bSla = bo(
    { kind: "SLA", scope: { type: "DEFAULT" }, claimMinutes: 60, resolveMinutes: 600 },
    { kind: "SLA", scope: { type: "PAGE", pageId: PG }, claimMinutes: 40, resolveMinutes: 400 },
    { kind: "SLA", scope: { type: "CAMPUS", centerId: CS1 }, claimMinutes: 20, resolveMinutes: 200 },
  );
  it("[BQT-SLA-01] đúng thứ tự ưu tiên", () => {
    expect(hanSlaTheoQuyTac(bSla, { pageId: PG, centerId: CS1 }, TS)).toEqual({ claimMinutes: 20, resolveMinutes: 200, nguon: "CAMPUS" });
    expect(hanSlaTheoQuyTac(bSla, { pageId: PG, centerId: CS2 }, TS)).toEqual({ claimMinutes: 40, resolveMinutes: 400, nguon: "PAGE" });
    expect(hanSlaTheoQuyTac(bSla, { pageId: "104500000000888", centerId: CS2 }, TS)).toEqual({ claimMinutes: 60, resolveMinutes: 600, nguon: "DEFAULT" });
  });
  it("[BQT-SLA-02] chưa biết cơ sở ⇒ bỏ bậc CAMPUS; không quy tắc / không bộ ⇒ tham số ai.* (hành vi cũ KHÔNG đổi)", () => {
    expect(hanSlaTheoQuyTac(bSla, { pageId: PG, centerId: null }, TS).nguon).toBe("PAGE");
    expect(hanSlaTheoQuyTac(bo(), { pageId: PG, centerId: CS1 }, TS)).toEqual({ claimMinutes: 15, resolveMinutes: 120, nguon: "THAM_SO" });
    expect(hanSlaTheoQuyTac(null, { pageId: PG, centerId: CS1 }, TS)).toEqual({ claimMinutes: 15, resolveMinutes: 120, nguon: "THAM_SO" });
  });
});

describe("[BQT-AUTO] ràng buộc tự tạo lead CHỈ THU HẸP", () => {
  const R = (x: Partial<Extract<QuyTac, { kind: "AUTO_CREATE" }>>): Extract<QuyTac, { kind: "AUTO_CREATE" }> => ({ kind: "AUTO_CREATE", agentId: AG, pageId: PG, enabled: true, ...x });
  it("[BQT-AUTO-01] không quy tắc / không khai ràng buộc ⇒ không thu hẹp (kể cả hồ sơ chưa có đồng ý / chưa cơ sở)", () => {
    for (const r of [null, R({})]) expect(thuHepTuTao(r, { consentAllowed: false, campusCenterId: null })).toEqual({ allowed: true, lyDo: "KHONG_THU_HEP" });
  });
  it("[BQT-AUTO-02] requireConsent: có đồng ý ⇒ qua; chưa ⇒ CAN_DONG_Y", () => {
    expect(thuHepTuTao(R({ requireConsent: true }), { consentAllowed: true, campusCenterId: CS1 }).allowed).toBe(true);
    expect(thuHepTuTao(R({ requireConsent: true }), { consentAllowed: false, campusCenterId: CS1 })).toEqual({ allowed: false, lyDo: "CAN_DONG_Y" });
  });
  it("[BQT-AUTO-03] danh sách cơ sở: trong ⇒ qua; ngoài hoặc chưa có cơ sở ⇒ NGOAI_DANH_SACH_CO_SO (không đoán)", () => {
    const r = R({ campusCenterIds: [CS1] });
    expect(thuHepTuTao(r, { consentAllowed: true, campusCenterId: CS1 }).allowed).toBe(true);
    expect(thuHepTuTao(r, { consentAllowed: true, campusCenterId: CS2 })).toEqual({ allowed: false, lyDo: "NGOAI_DANH_SACH_CO_SO" });
    expect(thuHepTuTao(r, { consentAllowed: true, campusCenterId: null }).allowed).toBe(false);
  });
  it("[BQT-AUTO-04] hai ràng buộc cộng dồn (VÀ): thiếu một vế là từ chối", () => {
    const r = R({ requireConsent: true, campusCenterIds: [CS1] });
    expect(thuHepTuTao(r, { consentAllowed: true, campusCenterId: CS1 }).allowed).toBe(true);
    expect(thuHepTuTao(r, { consentAllowed: false, campusCenterId: CS1 }).allowed).toBe(false);
    expect(thuHepTuTao(r, { consentAllowed: true, campusCenterId: CS2 }).allowed).toBe(false);
  });
  it("[BQT-AUTO-05] timQuyTacAuto khớp ĐÚNG (agent, page); không khớp ⇒ null", () => {
    const b = bo(R({ requireConsent: true }));
    expect(timQuyTacAuto(b, AG, PG)).not.toBeNull();
    expect(timQuyTacAuto(b, "cm0agentbbbbbbbbbbbbbbbb2", PG)).toBeNull();
    expect(timQuyTacAuto(b, AG, "104500000000999")).toBeNull();
    expect(timQuyTacAuto(null, AG, PG)).toBeNull();
  });
});

describe("[BQT-TB] bậc thông báo + leo thang", () => {
  const N = (o: Partial<Extract<QuyTac, { kind: "NOTIFY" }>>): QuyTac => ({ kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"], ...o });
  it("[BQT-TB-01] không quy tắc ⇒ mặc định đúng hành vi cũ cho cả bốn sự kiện", () => {
    for (const ev of Object.keys(BAC_MAC_DINH) as (keyof typeof BAC_MAC_DINH)[]) expect(cacBacThongBao(null, ev, CS1)).toEqual(BAC_MAC_DINH[ev].map((x) => ({ afterMinutes: x.afterMinutes, to: [...x.to] })));
    expect(cacBacThongBao(bo(), "INCIDENT", null)[0]!.to).toEqual(["INTEGRATION_VIEWERS"]);
  });
  it("[BQT-TB-02] quy tắc chung áp cho mọi cơ sở; quy tắc RIÊNG của cơ sở thay HOÀN TOÀN quy tắc chung của sự kiện đó", () => {
    const b = bo(N({ afterMinutes: 0 }), N({ afterMinutes: 60, to: ["HO_REVIEWERS"] }), N({ centerId: CS2, afterMinutes: 30, to: ["HO_CONFIGURERS"] }));
    expect(cacBacThongBao(b, "SLA_CLAIM_OVERDUE", CS1).map((x) => x.afterMinutes)).toEqual([0, 60]);
    // CS2 chỉ khai bậc +30 ⇒ bậc 0 MẶC ĐỊNH được giữ (xem [BQT-TB-06]); quy tắc chung (0, 60) KHÔNG trộn vào.
    expect(cacBacThongBao(b, "SLA_CLAIM_OVERDUE", CS2)).toEqual([{ afterMinutes: 0, to: ["CENTER_MANAGER"] }, { afterMinutes: 30, to: ["HO_CONFIGURERS"] }]);
    expect(cacBacThongBao(b, "SLA_CLAIM_OVERDUE", null).map((x) => x.afterMinutes)).toEqual([0, 60]); // chưa biết cơ sở ⇒ chỉ quy tắc chung
  });
  it("[BQT-TB-03] sự kiện không có quy tắc vẫn dùng mặc định dù sự kiện khác đã có quy tắc", () => {
    const b = bo(N({ event: "SLA_RESOLVE_OVERDUE", to: ["HO_REVIEWERS"] }));
    expect(cacBacThongBao(b, "SLA_CLAIM_OVERDUE", CS1)).toEqual([{ afterMinutes: 0, to: ["CENTER_MANAGER"] }]);
  });
  it("[BQT-TB-04] cùng mốc ⇒ gộp nhóm người nhận (bỏ trùng, sắp xếp); các bậc sắp theo afterMinutes", () => {
    const b = parseBo(N({ afterMinutes: 90, to: ["HO_REVIEWERS"] }), N({ afterMinutes: 0, to: ["CENTER_MANAGER"] }));
    const dup = parseBo(N({ afterMinutes: 0, to: ["HO_REVIEWERS"] }), N({ afterMinutes: 0, to: ["CENTER_MANAGER"] }));
    expect(cacBacThongBao(b, "SLA_CLAIM_OVERDUE", CS1).map((x) => x.afterMinutes)).toEqual([0, 90]);
    expect(cacBacThongBao(dup, "SLA_CLAIM_OVERDUE", CS1)).toEqual([{ afterMinutes: 0, to: ["CENTER_MANAGER", "HO_REVIEWERS"] }]);
  });
  it("[BQT-TB-06] THÊM bậc leo thang KHÔNG được gỡ người đang nhận ngay (review độc lập 28/10): thiếu bậc 0 ⇒ giữ bậc 0 mặc định của sự kiện; có bậc 0 tường minh ⇒ quy tắc của Admin thắng", () => {
    for (const ev of ["DRAFT_NEEDS_STAFF", "SLA_CLAIM_OVERDUE", "SLA_RESOLVE_OVERDUE", "INCIDENT"] as const) {
      const chiLeoThang = parseBo(N({ event: ev, afterMinutes: 30, to: ["HO_REVIEWERS"] }));
      const bacs = cacBacThongBao(chiLeoThang, ev, CS1);
      expect(bacs.map((x) => x.afterMinutes), ev).toEqual([0, 30]);
      expect(bacs[0]!.to, ev).toEqual([...BAC_MAC_DINH[ev][0]!.to]);
      const doiBac0 = parseBo(N({ event: ev, afterMinutes: 0, to: ["HO_REVIEWERS"] }));
      expect(cacBacThongBao(doiBac0, ev, CS1), ev).toEqual([{ afterMinutes: 0, to: ["HO_REVIEWERS"] }]);
    }
  });
  it("[BQT-TB-07] cửa sổ quét cron = bậc LỚN NHẤT của sự kiện (mọi cơ sở) + 24 giờ; không quy tắc ⇒ chỉ 24 giờ; sự kiện khác không ảnh hưởng", () => {
    expect(cuaSoQuetPhut(null, "SLA_CLAIM_OVERDUE")).toBe(DEM_CUA_SO_QUET_PHUT);
    const b = parseBo(N({ afterMinutes: 90, to: ["HO_REVIEWERS"] }), N({ centerId: CS2, afterMinutes: 600, to: ["HO_CONFIGURERS"] }), N({ event: "INCIDENT", afterMinutes: 5000, to: ["HO_CONFIGURERS"] }));
    expect(cuaSoQuetPhut(b, "SLA_CLAIM_OVERDUE")).toBe(600 + DEM_CUA_SO_QUET_PHUT);
    expect(cuaSoQuetPhut(b, "SLA_RESOLVE_OVERDUE")).toBe(DEM_CUA_SO_QUET_PHUT);
  });
  it("[BQT-TB-08] nhãn nhóm người nhận không lộ mã quyền kỹ thuật (nhãn đọc được bởi người vận hành)", async () => {
    const { CAU_NHOM_NGUOI_NHAN } = await import("./bo-quy-tac-schema");
    for (const nhan of Object.values(CAU_NHOM_NGUOI_NHAN)) expect(nhan).not.toMatch(/[a-z-]+:[a-z-]+/);
  });
  it("[BQT-TB-05] cacBacDenHan: biên ĐÓNG ở mốc + afterMinutes (đúng mốc thì đến hạn); mốc tương lai chưa đến; chiSo ổn định", () => {
    const bacs = [
      { afterMinutes: 0, to: ["CENTER_MANAGER"] },
      { afterMinutes: 60, to: ["HO_REVIEWERS"] },
    ] as const;
    const moc = Date.UTC(2026, 10, 9, 3, 0, 0);
    expect(cacBacDenHan(bacs, moc, moc - 1)).toEqual([]);
    expect(cacBacDenHan(bacs, moc, moc).map((x) => x.chiSo)).toEqual([0]);
    expect(cacBacDenHan(bacs, moc, moc + 60 * 60_000 - 1).map((x) => x.chiSo)).toEqual([0]);
    expect(cacBacDenHan(bacs, moc, moc + 60 * 60_000).map((x) => x.chiSo)).toEqual([0, 1]);
  });
});

/** Dựng bộ qua zod (gộp bậc trùng khoá sẽ bị từ chối nên ca dup ở trên dùng parse từng cái). */
function parseBo(...rules: QuyTac[]): BoQuyTac {
  const r = boQuyTacSchema.safeParse({ rules });
  if (r.success) return r.data;
  // Bộ có khoá trùng chỉ để thử gộp ở engine: dựng thẳng, engine không phụ thuộc schema.
  return { rules };
}
