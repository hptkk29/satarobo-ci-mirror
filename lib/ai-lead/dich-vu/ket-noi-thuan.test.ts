// @vitest-environment node
// [AIK-*] Luật trạng thái kết nối — THUẦN, không DB, không đồng hồ thật. Mã ca ổn định để lượt cấy lỗi (luật 14) so ĐÚNG tập ca đỏ.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HASH_HOP_DONG_HIEN_HANH,
  NHAN_XANH,
  kiemHanPass,
  kiemLanChayNhap,
  kiemLyDo,
  CHU_NGUON_BANG_CHUNG,
  nguonBangChung,
  tinhTrangKetNoi,
  type DauVaoTinhTrang,
  type LanChay,
  type LanChayNhap,
  type MucKiemChung,
  type NhanKetNoi,
  type TrangThaiLanChay,
} from "./ket-noi-thuan";

const NOW = Date.parse("2026-11-07T10:00:00.000Z");
const PHUT = 60_000;
const NGAY = 24 * 3_600_000;
const BUILD = "abc1234";
const HASH_AGENT = HASH_HOP_DONG_HIEN_HANH; // agent khai đúng hash hiện hành
const PAGES = ["104500000000777", "104500000000888"];
const CAU_HINH = { nguongMatKetNoiMs: 3 * PHUT, nguongNgatKetNoiMs: NGAY, ttlKiemChungMs: 7 * NGAY };

function run(level: MucKiemChung, status: TrangThaiLanChay, o: Partial<LanChay> & { env?: "TEST" | "PROD"; pageIds?: string[]; signoffBy?: string } = {}): LanChay {
  const { env, pageIds, signoffBy, ...rest } = o;
  return {
    id: `run-${level}-${status}`,
    agentId: level === "L1" ? null : "agt1",
    level,
    status,
    kind: ({ L1: "CONTRACT", L2: "PROBE", L3: "E2E", L4: "PILOT" } as const)[level],
    createdAt: new Date(NOW - 10 * PHUT),
    buildSha: level === "L1" ? null : BUILD,
    contractHash: level === "L1" ? HASH_HOP_DONG_HIEN_HANH : HASH_AGENT,
    correlationId: null,
    evidence: level === "L1" ? { counts: { total: 5, passed: 5, failed: 0 } } : { environment: env ?? "TEST", pageIds: pageIds ?? PAGES, ...(signoffBy ? { signoffBy } : {}) },
    ...rest,
  };
}

function dauVao(o: Omit<Partial<DauVaoTinhTrang>, "agent"> & { agent?: Partial<DauVaoTinhTrang["agent"]> } = {}): DauVaoTinhTrang {
  const { agent, ...rest } = o;
  return {
    now: NOW,
    ...CAU_HINH,
    hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH,
    congProd: { allowed: true, thieu: [] },
    agent: {
      active: true,
      environment: "TEST",
      moiTruongHopLe: true,
      contractStatus: "COMPATIBLE",
      lastHeartbeatAt: new Date(NOW - 30_000),
      lastBuildSha: BUILD,
      lastContractHash: HASH_AGENT,
      ...agent,
    },
    pageIdsHienTai: PAGES,
    lanChay: [],
    suCoMo: { tong: 0, nghiemTrongNhat: null },
    ...rest,
  };
}

describe("[AIK-HASH] hash hợp đồng hiện hành", () => {
  it("[AIK-HASH-01] hằng = SHA-256 (LF-chuẩn hoá) của bản sao hợp đồng ở tests/fixtures", () => {
    const yaml = readFileSync(resolve(process.cwd(), "tests/fixtures/ai-lead/api-contract-v1.yaml"), "utf8");
    expect(createHash("sha256").update(yaml.replace(/\r/g, "")).digest("hex")).toBe(HASH_HOP_DONG_HIEN_HANH);
  });
});

describe("[AIK-NHAN] nhãn tổng hợp — ma trận", () => {
  it("[AIK-NHAN-01] chưa từng có nhịp sống ⇒ UNVERIFIED (KHÔNG phải STALE)", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { lastHeartbeatAt: null } }));
    expect(k.nhan).toBe("UNVERIFIED");
    expect(k.nhip.trangThai).toBe("CHUA_TUNG");
    expect(k.xanh).toBe(false);
  });

  it("[AIK-NHAN-02] ĐỐI CHỨNG ÂM: nhịp sống tươi MỘT MÌNH ⇒ UNVERIFIED, không CONNECTED, không xanh", () => {
    const k = tinhTrangKetNoi(dauVao());
    expect(k.nhip.trangThai).toBe("CON_MOI");
    expect(k.nhan).toBe("UNVERIFIED");
    expect(k.xanh).toBe(false);
    expect(k.lyDo).toMatch(/nhịp sống/i);
  });

  it("[AIK-NHAN-03] nhịp tươi + L2 PASS còn hạn ⇒ CONNECTED (đối chứng dương)", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS")] }));
    expect(k.nhan).toBe("CONNECTED");
    expect(k.xanh).toBe(true);
    expect(k.tang.L2.dat).toBe(true);
  });

  it("[AIK-NHAN-04] ĐỐI CHỨNG ÂM: nhịp tươi KHÔNG đủ cho E2E_VERIFIED khi chỉ có L2", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS")] }));
    expect(k.nhan).not.toBe("E2E_VERIFIED");
    expect(k.tang.L3.dat).toBe(false);
  });

  it("[AIK-NHAN-05] L3 PASS còn hạn ⇒ E2E_VERIFIED; thiếu nhịp tươi thì KHÔNG", () => {
    const co = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS"), run("L3", "PASS", { correlationId: "11111111-2222-3333-4444-555555555555" })] }));
    expect(co.nhan).toBe("E2E_VERIFIED");
    const stale = tinhTrangKetNoi(
      dauVao({ agent: { lastHeartbeatAt: new Date(NOW - 5 * PHUT) }, lanChay: [run("L2", "PASS"), run("L3", "PASS")] }),
    );
    expect(stale.nhan).toBe("STALE");
    expect(stale.xanh).toBe(false);
  });

  it("[AIK-NHAN-06] L4: PROD_LIVE_VERIFIED cần PASS + chữ ký; thiếu chữ ký ⇒ KHÔNG", () => {
    const agent = { environment: "PROD" as const };
    const ky = tinhTrangKetNoi(dauVao({ agent, lanChay: [run("L2", "PASS", { env: "PROD" }), run("L4", "PASS", { env: "PROD", signoffBy: "Hồ Đắc Phúc" })] }));
    expect(ky.nhan).toBe("PROD_LIVE_VERIFIED");
    const khongKy = tinhTrangKetNoi(dauVao({ agent, lanChay: [run("L2", "PASS", { env: "PROD" }), run("L4", "PASS", { env: "PROD" })] }));
    expect(khongKy.nhan).toBe("CONNECTED");
    expect(khongKy.tang.L4.muc).toBe("CHO_CHU_KY");
    expect(khongKy.tang.L4.dat).toBe(false);
    const trang = tinhTrangKetNoi(dauVao({ agent, lanChay: [run("L2", "PASS", { env: "PROD" }), run("L4", "PASS", { env: "PROD", signoffBy: "   " })] }));
    expect(trang.tang.L4.dat).toBe(false);
  });

  it("[AIK-NHAN-07] nhịp quá ngưỡng mất ⇒ STALE; quá ngưỡng ngắt ⇒ DISCONNECTED; đúng ngưỡng vẫn CÒN MỚI", () => {
    const luc = (ms: number) => tinhTrangKetNoi(dauVao({ agent: { lastHeartbeatAt: new Date(NOW - ms) }, lanChay: [run("L2", "PASS")] }));
    expect(luc(CAU_HINH.nguongMatKetNoiMs).nhan).toBe("CONNECTED");
    expect(luc(CAU_HINH.nguongMatKetNoiMs + 1).nhan).toBe("STALE");
    expect(luc(CAU_HINH.nguongNgatKetNoiMs).nhan).toBe("STALE");
    expect(luc(CAU_HINH.nguongNgatKetNoiMs + 1).nhan).toBe("DISCONNECTED");
  });

  it("[AIK-NHAN-08] INCOMPATIBLE (công tắc tay) thắng mọi bằng chứng xanh", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { contractStatus: "INCOMPATIBLE" }, lanChay: [run("L2", "PASS"), run("L3", "PASS")] }));
    expect(k.nhan).toBe("INCOMPATIBLE");
    expect(k.xanh).toBe(false);
  });

  it("[AIK-NHAN-09] agent TẮT ⇒ BLOCKED (không xanh dù có bằng chứng)", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { active: false }, lanChay: [run("L2", "PASS")] }));
    expect(k.nhan).toBe("BLOCKED");
    expect(k.xanh).toBe(false);
  });

  it("[AIK-NHAN-10] agent PROD mà cổng PROD đóng ⇒ BLOCKED, nêu khoá còn thiếu", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { environment: "PROD" }, congProd: { allowed: false, thieu: ["ai.consentPolicyStatus"] }, lanChay: [run("L2", "PASS", { env: "PROD" })] }));
    expect(k.nhan).toBe("BLOCKED");
    expect(k.lyDo).toContain("ai.consentPolicyStatus");
    // Agent TEST không đi qua cổng PROD.
    const test = tinhTrangKetNoi(dauVao({ congProd: { allowed: false, thieu: ["ai.prodEnabled"] }, lanChay: [run("L2", "PASS")] }));
    expect(test.nhan).toBe("CONNECTED");
  });

  it("[AIK-NHAN-11] Page PAUSED ⇒ PAUSED khi tính theo Page; nhãn cấp agent không đổi", () => {
    const base = { lanChay: [run("L2", "PASS")] };
    expect(tinhTrangKetNoi(dauVao({ ...base, page: { pageId: PAGES[0]!, state: "PAUSED" } })).nhan).toBe("PAUSED");
    expect(tinhTrangKetNoi(dauVao({ ...base, page: { pageId: PAGES[0]!, state: "ENABLED" } })).nhan).toBe("CONNECTED");
    expect(tinhTrangKetNoi(dauVao(base)).nhan).toBe("CONNECTED");
  });

  it("[AIK-NHAN-12] hash Agent khai LẠ ⇒ DEGRADED (không bao giờ INCOMPATIBLE, không xanh)", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { lastContractHash: "0".repeat(64) }, lanChay: [run("L2", "PASS", { contractHash: "0".repeat(64) })] }));
    expect(k.nhan).toBe("DEGRADED");
    expect(k.hopDong.hash).toBe("LA");
    expect(k.hopDong.contractStatus).toBe("COMPATIBLE");
    expect(k.xanh).toBe(false);
    expect(k.canhBao.join(" ")).toMatch(/hash/i);
  });

  it("[AIK-NHAN-13] DEPRECATED hoặc sự cố HIGH/CRITICAL đang mở ⇒ DEGRADED; MEDIUM thì không", () => {
    const l2 = [run("L2", "PASS")];
    expect(tinhTrangKetNoi(dauVao({ agent: { contractStatus: "DEPRECATED" }, lanChay: l2 })).nhan).toBe("DEGRADED");
    expect(tinhTrangKetNoi(dauVao({ suCoMo: { tong: 1, nghiemTrongNhat: "HIGH" }, lanChay: l2 })).nhan).toBe("DEGRADED");
    expect(tinhTrangKetNoi(dauVao({ suCoMo: { tong: 1, nghiemTrongNhat: "CRITICAL" }, lanChay: l2 })).nhan).toBe("DEGRADED");
    expect(tinhTrangKetNoi(dauVao({ suCoMo: { tong: 1, nghiemTrongNhat: "MEDIUM" }, lanChay: l2 })).nhan).toBe("CONNECTED");
  });

  it("[AIK-NHAN-14] hash Agent chưa biết (chưa có nhịp mang hash) ⇒ CHUA_BIET, không đoán", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { lastContractHash: null } }));
    expect(k.hopDong.hash).toBe("CHUA_BIET");
  });
});

describe("[AIK-TANG] bốn tầng", () => {
  it("[AIK-TANG-01] MOCK_ONLY KHÔNG BAO GIỜ đạt — ở cả bốn tầng", () => {
    for (const t of ["L1", "L2", "L3", "L4"] as const) {
      const k = tinhTrangKetNoi(dauVao({ agent: { environment: "PROD" }, lanChay: [run(t, "MOCK_ONLY", { env: "PROD" })] }));
      expect(k.tang[t].dat, t).toBe(false);
      expect(k.tang[t].coGiaLap, t).toBe(true);
      expect(k.xanh, t).toBe(false);
    }
  });

  it("[AIK-TANG-02] NOT_RUN / BLOCKED / FAIL / STALE không bao giờ đạt", () => {
    for (const st of ["NOT_RUN", "BLOCKED", "FAIL", "STALE"] as const) {
      for (const t of ["L1", "L2", "L3"] as const) {
        expect(tinhTrangKetNoi(dauVao({ lanChay: [run(t, st)] })).tang[t].dat, `${t}/${st}`).toBe(false);
      }
    }
  });

  it("[AIK-TANG-03] L2/L3 chưa có lần chạy THẬT ⇒ BLOCKED_BY_AGENT_TEAM (kể cả khi chỉ có giả lập)", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "MOCK_ONLY"), run("L3", "NOT_RUN")] }));
    expect(k.tang.L2.muc).toBe("BLOCKED_BY_AGENT_TEAM");
    expect(k.tang.L2.coGiaLap).toBe(true);
    expect(k.tang.L3.muc).toBe("BLOCKED_BY_AGENT_TEAM");
  });

  it("[AIK-TANG-04] L1 không có lần chạy ⇒ CHUA_CHAY; chỉ giả lập ⇒ CHI_GIA_LAP", () => {
    expect(tinhTrangKetNoi(dauVao()).tang.L1.muc).toBe("CHUA_CHAY");
    expect(tinhTrangKetNoi(dauVao({ lanChay: [run("L1", "MOCK_ONLY")] })).tang.L1.muc).toBe("CHI_GIA_LAP");
  });

  it("[AIK-TANG-05] L4 không áp dụng cho agent TEST; PROD chưa có lần chạy ⇒ BLOCKED_BY_OWNER", () => {
    expect(tinhTrangKetNoi(dauVao()).tang.L4.muc).toBe("KHONG_AP_DUNG");
    expect(tinhTrangKetNoi(dauVao({ agent: { environment: "PROD" } })).tang.L4.muc).toBe("BLOCKED_BY_OWNER");
  });

  it("[AIK-TANG-06] một lần chạy giả lập MỚI HƠN không xoá một PASS thật còn hạn", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS", { id: "that" }), run("L2", "MOCK_ONLY", { id: "gia", createdAt: new Date(NOW - PHUT) })] }));
    expect(k.tang.L2.dat).toBe(true);
    expect(k.tang.L2.runId).toBe("that");
    expect(k.tang.L2.coGiaLap).toBe(true);
  });

  it("[AIK-TANG-07] FAIL MỚI HƠN PASS cũ ⇒ tầng THAT_BAI (lần chạy thật gần nhất thắng)", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS", { createdAt: new Date(NOW - 30 * PHUT) }), run("L2", "FAIL", { createdAt: new Date(NOW - 5 * PHUT) })] }));
    expect(k.tang.L2.muc).toBe("THAT_BAI");
    expect(k.nhan).toBe("UNVERIFIED");
  });

  it("[AIK-TANG-08] tầng mang lastChecked + nguồn + lý do (ô nào cũng giải thích được)", () => {
    const k = tinhTrangKetNoi(dauVao({ lanChay: [run("L2", "PASS", { correlationId: "11111111-2222-3333-4444-555555555555" })] }));
    expect(k.tang.L2.lanKiemCuoi).toEqual(new Date(NOW - 10 * PHUT));
    expect(k.tang.L2.nguon).toContain("PROBE");
    expect(k.tang.L2.nguon).toContain("11111111-2222-3333-4444-555555555555");
    expect(k.tang.L2.lyDo.length).toBeGreaterThan(5);
    for (const t of ["L1", "L2", "L3", "L4"] as const) expect(tinhTrangKetNoi(dauVao()).tang[t].lyDo.length, t).toBeGreaterThan(5);
  });
});

describe("[AIK-HAN] PASS hết hạn khi bối cảnh đổi", () => {
  const boi = (lastBuildSha: string | null = BUILD, lastContractHash: string | null = HASH_AGENT) => ({
    now: NOW,
    ttlKiemChungMs: CAU_HINH.ttlKiemChungMs,
    hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH,
    pageIdsHienTai: PAGES,
    agent: { environment: "TEST" as const, lastBuildSha, lastContractHash },
  });

  it("[AIK-HAN-01] đối chứng dương: cùng build/hash/môi trường/Page, trong TTL ⇒ còn hạn", () => {
    expect(kiemHanPass(run("L2", "PASS"), boi()).conHan).toBe(true);
  });

  it("[AIK-HAN-02] ĐỔI BUILD ⇒ hết hạn (L2, L3, L4)", () => {
    for (const t of ["L2", "L3", "L4"] as const) {
      const r = kiemHanPass(run(t, "PASS", { env: "TEST" }), boi("ffff999"));
      expect(r.conHan, t).toBe(false);
      if (!r.conHan) expect(r.lyDo).toMatch(/build/i);
    }
  });

  it("[AIK-HAN-03] ĐỔI hash Agent khai ⇒ hết hạn", () => {
    const r = kiemHanPass(run("L2", "PASS"), boi(BUILD, "1".repeat(64)));
    expect(r.conHan).toBe(false);
  });

  it("[AIK-HAN-04] ĐỔI môi trường ⇒ hết hạn", () => {
    expect(kiemHanPass(run("L2", "PASS", { env: "PROD" }), boi()).conHan).toBe(false);
  });

  it("[AIK-HAN-05] ĐỔI tập Page (thêm hoặc bớt) ⇒ hết hạn; thứ tự khác thì không", () => {
    expect(kiemHanPass(run("L2", "PASS", { pageIds: [PAGES[0]!] }), boi()).conHan).toBe(false);
    expect(kiemHanPass(run("L2", "PASS", { pageIds: [...PAGES, "104500000000999"] }), boi()).conHan).toBe(false);
    expect(kiemHanPass(run("L2", "PASS", { pageIds: [PAGES[1]!, PAGES[0]!] }), boi()).conHan).toBe(true);
  });

  it("[AIK-HAN-06] QUÁ TTL ⇒ hết hạn; đúng TTL vẫn còn", () => {
    expect(kiemHanPass(run("L2", "PASS", { createdAt: new Date(NOW - CAU_HINH.ttlKiemChungMs) }), boi()).conHan).toBe(true);
    expect(kiemHanPass(run("L2", "PASS", { createdAt: new Date(NOW - CAU_HINH.ttlKiemChungMs - 1) }), boi()).conHan).toBe(false);
  });

  it("[AIK-HAN-07] thiếu trường để so (buildSha null, thiếu environment/pageIds) ⇒ hết hạn, không đoán", () => {
    expect(kiemHanPass(run("L2", "PASS", { buildSha: null }), boi()).conHan).toBe(false);
    expect(kiemHanPass(run("L2", "PASS", { evidence: {} }), boi()).conHan).toBe(false);
    expect(kiemHanPass(run("L2", "PASS", { evidence: "xyz" }), boi()).conHan).toBe(false);
    expect(kiemHanPass(run("L2", "PASS"), boi(null)).conHan).toBe(false);
  });

  it("[AIK-HAN-10] bằng chứng L2 do route nhịp sống ghi (chỉ {agentId, buildSha, contractHash, probeId}, THIẾU environment/pageIds) ⇒ hết hạn VÀ lý do nói đúng là thiếu thông tin, không nói \"môi trường không khớp\"", () => {
    const kieuNhip = run("L2", "PASS", { evidence: { agentId: "agt1", buildSha: BUILD, contractHash: HASH_AGENT, probeId: "prb_abcdefghijkl" } });
    const r = kiemHanPass(kieuNhip, boi());
    expect(r.conHan).toBe(false);
    if (!r.conHan) {
      expect(r.lyDo).toMatch(/thiếu môi trường/);
      expect(r.lyDo).not.toMatch(/không khớp/);
    }
    const k = tinhTrangKetNoi(dauVao({ lanChay: [kieuNhip] }));
    expect(k.xanh).toBe(false);
    expect(k.tang.L2.muc).toBe("HET_HAN");
  });

  it("[AIK-HAN-08] L1: hợp đồng đổi (hash khác hash hiện hành) ⇒ hết hạn; L1 không phụ thuộc build", () => {
    expect(kiemHanPass(run("L1", "PASS"), boi(null, null)).conHan).toBe(true);
    expect(kiemHanPass(run("L1", "PASS", { contractHash: "2".repeat(64) }), boi()).conHan).toBe(false);
  });

  it("[AIK-HAN-09] hết hạn phản ánh lên tầng: nhãn tổng KHÔNG xanh dù từng PASS", () => {
    const k = tinhTrangKetNoi(dauVao({ agent: { lastBuildSha: "ffff999" }, lanChay: [run("L2", "PASS"), run("L3", "PASS")] }));
    expect(k.tang.L2.muc).toBe("HET_HAN");
    expect(k.tang.L3.muc).toBe("HET_HAN");
    expect(k.xanh).toBe(false);
    expect(k.nhan).toBe("UNVERIFIED");
  });
});

describe("[AIK-BAT-BIEN] xanh luôn đi cùng bằng chứng (quét lưới đầu vào)", () => {
  it("[AIK-BAT-BIEN-01] mọi tổ hợp: nhãn xanh ⇒ nhịp CÒN MỚI, agent bật, không INCOMPATIBLE, tầng tương ứng ĐẠT", () => {
    const trangThai: TrangThaiLanChay[] = ["PASS", "FAIL", "BLOCKED", "NOT_RUN", "MOCK_ONLY", "STALE"];
    const moiTruong = ["TEST", "PROD"] as const;
    const nhip = [null, 30_000, 5 * PHUT, 2 * NGAY];
    let soXanh = 0;
    let tong = 0;
    for (const env of moiTruong)
      for (const l2 of [undefined, ...trangThai])
        for (const l3 of [undefined, ...trangThai])
          for (const l4 of [undefined, ...trangThai])
            for (const hb of nhip)
              for (const active of [true, false])
                for (const cs of ["COMPATIBLE", "DEPRECATED", "INCOMPATIBLE"] as const)
                  for (const ky of [false, true])
                    for (const cong of [true, false]) {
                      const lanChay: LanChay[] = [];
                      if (l2) lanChay.push(run("L2", l2, { env }));
                      if (l3) lanChay.push(run("L3", l3, { env }));
                      if (l4) lanChay.push(run("L4", l4, { env, ...(ky ? { signoffBy: "Chủ dự án" } : {}) }));
                      const k = tinhTrangKetNoi(
                        dauVao({
                          agent: { environment: env, active, contractStatus: cs, lastHeartbeatAt: hb === null ? null : new Date(NOW - hb) },
                          congProd: { allowed: cong, thieu: cong ? [] : ["ai.prodEnabled"] },
                          lanChay,
                        }),
                      );
                      tong++;
                      expect(k.xanh).toBe(NHAN_XANH.has(k.nhan));
                      if (!k.xanh) continue;
                      soXanh++;
                      expect(k.nhip.trangThai).toBe("CON_MOI");
                      expect(active).toBe(true);
                      expect(cs).not.toBe("INCOMPATIBLE");
                      expect(cs).not.toBe("DEPRECATED");
                      if (env === "PROD") expect(cong).toBe(true);
                      const can: Record<NhanKetNoi, MucKiemChung | null> = {
                        CONNECTED: "L2",
                        E2E_VERIFIED: "L3",
                        PROD_LIVE_VERIFIED: "L4",
                        UNVERIFIED: null, STALE: null, DEGRADED: null, DISCONNECTED: null, INCOMPATIBLE: null, PAUSED: null, BLOCKED: null,
                      };
                      const tang = can[k.nhan] as MucKiemChung;
                      expect(k.tang[tang].dat).toBe(true);
                      expect(k.tang[tang].muc).toBe("DAT");
                      // Chỉ lần chạy PASS mới có thể làm tầng đạt.
                      const status = { L2: l2, L3: l3, L4: l4 }[tang as "L2" | "L3" | "L4"];
                      expect(status).toBe("PASS");
                    }
    expect(tong).toBeGreaterThan(5000);
    // Lưới không rỗng: có những tổ hợp xanh thật (nếu bằng 0 thì lưới vô nghĩa).
    expect(soXanh).toBeGreaterThan(50);
  });
});

describe("[AIK-NHAP] luật nhập tay một lần chạy", () => {
  const goc: LanChayNhap = {
    agentId: "agtxxxxxxxxxxxxxxxxxxxxx",
    level: "L3",
    status: "PASS",
    kind: "E2E",
    contractHash: "a".repeat(64),
    buildSha: "abc1234",
    correlationId: "11111111-2222-3333-4444-555555555555",
    bangChung: { environment: "TEST", pageIds: ["104500000000777"] },
    lyDo: "Đội Agent nộp evidence pack INT-A04",
  };
  it("[AIK-NHAP-01] hợp lệ ⇒ null (đối chứng dương)", () => {
    expect(kiemLanChayNhap(goc)).toBeNull();
  });
  it("[AIK-NHAP-02] thiếu lý do / lý do ngắn bị từ chối", () => {
    expect(kiemLanChayNhap({ ...goc, lyDo: "ngắn" })).toMatch(/lý do/i);
    expect(kiemLyDo("   ")).not.toBeNull();
    expect(kiemLyDo("x".repeat(501))).not.toBeNull();
  });
  it("[AIK-NHAP-03] L2 không nhập tay; STALE không nhập tay", () => {
    expect(kiemLanChayNhap({ ...goc, level: "L2", kind: "PROBE" })).toMatch(/thăm dò/i);
    expect(kiemLanChayNhap({ ...goc, status: "STALE" })).toMatch(/STALE/);
  });
  it("[AIK-NHAP-04] L3/L4 PASS thiếu correlationId hoặc buildSha bị từ chối", () => {
    expect(kiemLanChayNhap({ ...goc, correlationId: undefined })).toMatch(/correlationId/);
    expect(kiemLanChayNhap({ ...goc, buildSha: undefined })).toMatch(/buildSha/);
    expect(kiemLanChayNhap({ ...goc, contractHash: undefined })).toMatch(/contractHash/);
  });
  it("[AIK-NHAP-05] không PASS thì không đòi evidence đầy đủ (MOCK_ONLY ghi được, vẫn hiển thị là giả lập)", () => {
    expect(kiemLanChayNhap({ ...goc, status: "MOCK_ONLY", correlationId: undefined, buildSha: undefined, contractHash: undefined })).toBeNull();
  });
  it("[AIK-NHAP-06] L4 PASS cần PROD + người ký", () => {
    const l4: LanChayNhap = { ...goc, level: "L4", kind: "PILOT", bangChung: { environment: "PROD", pageIds: ["104500000000777"], signoffBy: "Hồ Đắc Phúc" } };
    expect(kiemLanChayNhap(l4)).toBeNull();
    expect(kiemLanChayNhap({ ...l4, bangChung: { environment: "TEST", pageIds: [], signoffBy: "Hồ Đắc Phúc" } })).toMatch(/PROD/);
    expect(kiemLanChayNhap({ ...l4, bangChung: { environment: "PROD", pageIds: [] } })).toMatch(/ký/);
  });
  it("[AIK-NHAP-07] L1 PASS cần contractHash; loại không khớp tầng bị từ chối; định dạng hash/sha/uuid sai bị từ chối", () => {
    const l1: LanChayNhap = { ...goc, agentId: null, level: "L1", kind: "CONTRACT", correlationId: undefined, buildSha: undefined };
    expect(kiemLanChayNhap(l1)).toBeNull();
    expect(kiemLanChayNhap({ ...l1, contractHash: undefined })).toMatch(/contractHash/);
    expect(kiemLanChayNhap({ ...goc, kind: "PILOT" })).toMatch(/loại/);
    expect(kiemLanChayNhap({ ...goc, buildSha: "XYZ" })).toMatch(/buildSha/);
    expect(kiemLanChayNhap({ ...goc, contractHash: "abc" })).toMatch(/contractHash/);
    expect(kiemLanChayNhap({ ...goc, correlationId: "khong-phai-uuid" })).toMatch(/correlationId/);
    expect(kiemLanChayNhap({ ...goc, agentId: null })).toMatch(/Agent/);
  });
});

describe("[AIK-NG] nguồn của bằng chứng: hệ thống đo hay người ghi tay", () => {
  it("[AIK-NG-01] L2 luôn HỆ THỐNG (chỉ sinh từ thăm dò hai chiều); L1/L3/L4 mặc định NGƯỜI GHI TAY; dấu `HE_THONG` trong evidence chỉ được tin ở tầng không phải L2", () => {
    expect(nguonBangChung("L2", {})).toBe("HE_THONG");
    expect(nguonBangChung("L2", { nguon: "THU_CONG" })).toBe("HE_THONG");
    for (const lv of ["L1", "L3", "L4"] as const) {
      expect(nguonBangChung(lv, {}), lv).toBe("THU_CONG");
      expect(nguonBangChung(lv, null), lv).toBe("THU_CONG");
      expect(nguonBangChung(lv, { nguon: "THU_CONG" }), lv).toBe("THU_CONG");
      expect(nguonBangChung(lv, { nguon: "gi-do-la" }), lv).toBe("THU_CONG");
      expect(nguonBangChung(lv, { nguon: "HE_THONG" }), lv).toBe("HE_THONG");
    }
  });
  it("[AIK-NG-02] nhãn người ghi tay nói rõ Admin không quan sát được; nhãn xanh E2E/PROD nói nguồn ngay trong lý do", () => {
    expect(CHU_NGUON_BANG_CHUNG.THU_CONG).toMatch(/Admin không quan sát được/);
    expect(CHU_NGUON_BANG_CHUNG.HE_THONG).toBe("Hệ thống đo");
  });
});
