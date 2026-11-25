// lib/ai-lead/cai-dat.test.ts — tham số vận hành `ai.*`: mặc định, cổng PROD (OD-08, fail-closed), giá trị suy ra, và KHÔNG khoá nào cho cơ sở sửa.
// Thuần: `getSetting` được giả (trả mặc định của registry, ghi đè từng ca). Mã ca: [AIL-CD-01..08].
import { describe, it, expect, vi, beforeEach } from "vitest";

const ghiDe = new Map<string, unknown>();
let nem = false;
vi.mock("@/lib/settings/service", async () => {
  const { SETTINGS } = await import("@/lib/settings/registry");
  return {
    getSetting: vi.fn(async (key: string) => {
      if (nem) throw new Error("DB sập — giá trị cột nhạy cảm không được lọt ra");
      return ghiDe.has(key) ? ghiDe.get(key) : (SETTINGS as Record<string, { default: unknown }>)[key]!.default;
    }),
  };
});

import { SETTINGS, validateSettingValue } from "@/lib/settings/registry";
import { nhanCuaKey, TAB_CAU_HINH, QUYEN_TAB } from "@/lib/settings/nhan-van-hanh";
import { AN_TOAN_CUNG, MAC_DINH_CAI_DAT } from "./hop-dong";
import { congProd, docCaiDat, nguongMatKetNoiMs, nonceTtlHieuLucMs, tinhCongProd, tranThanHieuLuc } from "./cai-dat";

beforeEach(() => {
  ghiDe.clear();
  nem = false;
});

const KHOA_AI = Object.keys(SETTINGS).filter((k) => k.startsWith("ai."));

describe("[AIL-CD-01] mặc định = số đề xuất của gói bàn giao (OD-04)", () => {
  it("docCaiDat() không ghi đè ⇒ đúng MAC_DINH_CAI_DAT, từng trường", async () => {
    const c = await docCaiDat();
    expect(c).toEqual(MAC_DINH_CAI_DAT);
  });
  it("có đủ 26 khoá ai.* trong registry, và docCaiDat đọc ĐÚNG từng khoá (ghi đè một khoá ⇒ chỉ trường đó đổi)", async () => {
    expect(KHOA_AI).toHaveLength(26);
    ghiDe.set("ai.slaClaimMinutes", 45);
    ghiDe.set("ai.takeoverNeedsAgentConfirmation", false);
    ghiDe.set("ai.verifyTtlHours", 48);
    const c = await docCaiDat();
    expect(c.verifyTtlHours).toBe(48);
    expect(c.slaClaimMinutes).toBe(45);
    expect(c.takeoverNeedsAgentConfirmation).toBe(false);
    expect({ ...c, slaClaimMinutes: 30, takeoverNeedsAgentConfirmation: true, verifyTtlHours: 168 }).toEqual(MAC_DINH_CAI_DAT);
  });
});

describe("[AIL-CD-02] CỔNG PROD (OD-08): mặc định CHẶN; mở ⇔ prodEnabled === true VÀ consentPolicyStatus === 'APPROVED'", () => {
  it("mặc định ⇒ chặn, thiếu cả hai khoá", async () => {
    expect(await congProd()).toEqual({
      allowed: false,
      reason: "PROD_CHUA_BAT_VA_CHINH_SACH_CHUA_DUYET",
      thieu: ["ai.prodEnabled", "ai.consentPolicyStatus"],
    });
  });
  it("chỉ bật prodEnabled ⇒ chặn (chính sách chưa duyệt)", async () => {
    ghiDe.set("ai.prodEnabled", true);
    expect(await congProd()).toEqual({ allowed: false, reason: "CHINH_SACH_CHUA_DUYET", thieu: ["ai.consentPolicyStatus"] });
  });
  it("chỉ duyệt chính sách ⇒ chặn (chưa bật PROD)", async () => {
    ghiDe.set("ai.consentPolicyStatus", "APPROVED");
    expect(await congProd()).toEqual({ allowed: false, reason: "PROD_CHUA_BAT", thieu: ["ai.prodEnabled"] });
  });
  it("ĐỐI CHỨNG DƯƠNG: bật PROD VÀ chính sách APPROVED ⇒ mở", async () => {
    ghiDe.set("ai.prodEnabled", true);
    ghiDe.set("ai.consentPolicyStatus", "APPROVED");
    expect(await congProd()).toEqual({ allowed: true, reason: "OK", thieu: [] });
  });
  it("giá trị 'gần đúng' KHÔNG mở cổng: 'true', 1, 'APPROVED ' , 'approved', null, undefined", () => {
    for (const p of ["true", 1, "yes", null, undefined, {}]) {
      expect(tinhCongProd({ prodEnabled: p, consentPolicyStatus: "APPROVED" }).allowed, `prod=${String(p)}`).toBe(false);
    }
    for (const c of ["APPROVED ", "approved", "Approved", null, undefined, true, "PENDING_LEGAL", ""]) {
      expect(tinhCongProd({ prodEnabled: true, consentPolicyStatus: c }).allowed, `consent=${String(c)}`).toBe(false);
    }
  });
  it("FAIL-CLOSED: không đọc được cài đặt ⇒ chặn, không ném, không lọt nội dung lỗi", async () => {
    nem = true;
    const r = await congProd();
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("KHONG_DOC_DUOC_CAI_DAT");
    expect(JSON.stringify(r)).not.toContain("DB sập");
  });
});

describe("[AIL-CD-03] giá trị suy ra", () => {
  it("trần thân: tham số nhưng KHÔNG vượt trần cứng tuyệt đối", () => {
    expect(tranThanHieuLuc({ bodyMaxBytes: 8192 })).toBe(8192);
    expect(tranThanHieuLuc({ bodyMaxBytes: 10_000_000 })).toBe(AN_TOAN_CUNG.tranThanTuyetDoiByte);
  });
  it("giữ nonce ≥ 2 × lệch giờ: nonceTtl=5 phút, skew=300 000 ms ⇒ nâng lên 10 phút; mặc định (15 phút) giữ nguyên", () => {
    expect(nonceTtlHieuLucMs({ nonceTtlMinutes: 15, clockSkewMs: 300_000 })).toBe(15 * 60_000);
    expect(nonceTtlHieuLucMs({ nonceTtlMinutes: 5, clockSkewMs: 300_000 })).toBe(600_000);
    expect(nonceTtlHieuLucMs({ nonceTtlMinutes: 15, clockSkewMs: 900_000 })).toBe(1_800_000);
  });
  it("ngưỡng mất kết nối = nhịp × số nhịp: mặc định 180 000 ms (3 × 60 giây)", () => {
    expect(nguongMatKetNoiMs({ heartbeatSeconds: 60, staleMultiplier: 3 })).toBe(180_000);
    expect(nguongMatKetNoiMs({ heartbeatSeconds: 15, staleMultiplier: 10 })).toBe(150_000);
  });
});

describe("[AIL-CD-04] registry: ranh giới giá trị", () => {
  const ok = (k: string, v: unknown) => validateSettingValue(k, v).ok;
  it("nhịp heartbeat: 15 và 90 qua; 14 và 91 không (khớp nextHeartbeatSeconds 15..90 của hợp đồng)", () => {
    expect(ok("ai.heartbeatSeconds", 15)).toBe(true);
    expect(ok("ai.heartbeatSeconds", 90)).toBe(true);
    expect(ok("ai.heartbeatSeconds", 14)).toBe(false);
    expect(ok("ai.heartbeatSeconds", 91)).toBe(false);
    expect(ok("ai.heartbeatSeconds", 60.5)).toBe(false);
  });
  it("catalogMaxAge 30..3600 (khớp maxAgeSeconds); bodyMaxBytes ≤ trần cứng", () => {
    expect(ok("ai.catalogMaxAgeSeconds", 29)).toBe(false);
    expect(ok("ai.catalogMaxAgeSeconds", 3601)).toBe(false);
    expect(ok("ai.catalogMaxAgeSeconds", 3600)).toBe(true);
    expect(ok("ai.bodyMaxBytes", AN_TOAN_CUNG.tranThanTuyetDoiByte)).toBe(true);
    expect(ok("ai.bodyMaxBytes", AN_TOAN_CUNG.tranThanTuyetDoiByte + 1)).toBe(false);
    expect(ok("ai.bodyMaxBytes", 512)).toBe(false);
  });
  it("[AIL-CD-04b] ba khoá thay hằng cứng (TTL kiểm chứng · ngưỡng ngắt · giữ idempotency): biên và mặc định đúng với hằng cũ (168 giờ · 24 giờ · 7 ngày)", () => {
    expect([MAC_DINH_CAI_DAT.verifyTtlHours, MAC_DINH_CAI_DAT.disconnectHours, MAC_DINH_CAI_DAT.requestRetentionDays]).toEqual([168, 24, 7]);
    for (const [k, min, max] of [["ai.verifyTtlHours", 1, 720], ["ai.disconnectHours", 1, 168], ["ai.requestRetentionDays", 1, 30]] as const) {
      expect(ok(k, min), `${k} biên dưới`).toBe(true);
      expect(ok(k, max), `${k} biên trên`).toBe(true);
      expect(ok(k, min - 1), `${k} dưới biên`).toBe(false);
      expect(ok(k, max + 1), `${k} trên biên`).toBe(false);
      expect(ok(k, 1.5), `${k} số lẻ`).toBe(false);
      expect(ok(k, "24"), `${k} chuỗi`).toBe(false);
    }
  });
  it("[AIL-CD-04c] bộ đếm từ chối: MẶC ĐỊNH TẮT (bật là quyết định của Owner), giữ 30 ngày (số tạm), nhận 1–90 ngày, chỉ nhận boolean cho cờ", () => {
    expect([MAC_DINH_CAI_DAT.rejectLogEnabled, MAC_DINH_CAI_DAT.rejectLogRetentionDays]).toEqual([false, 30]);
    expect(ok("ai.rejectLogEnabled", true)).toBe(true);
    expect(ok("ai.rejectLogEnabled", false)).toBe(true);
    expect(ok("ai.rejectLogEnabled", "true")).toBe(false);
    expect(ok("ai.rejectLogEnabled", 1)).toBe(false);
    for (const [v, qua] of [[1, true], [90, true], [0, false], [91, false], [1.5, false], ["30", false]] as const) {
      expect(ok("ai.rejectLogRetentionDays", v), `giữ ${String(v)} ngày`).toBe(qua);
    }
  });
  it("consentPolicyStatus chỉ nhận hai giá trị", () => {
    expect(ok("ai.consentPolicyStatus", "PENDING_LEGAL")).toBe(true);
    expect(ok("ai.consentPolicyStatus", "APPROVED")).toBe(true);
    expect(ok("ai.consentPolicyStatus", "approved")).toBe(false);
    expect(ok("ai.consentPolicyStatus", true)).toBe(false);
  });
  it("prodEnabled / takeoverNeedsAgentConfirmation chỉ nhận boolean thật", () => {
    for (const k of ["ai.prodEnabled", "ai.takeoverNeedsAgentConfirmation"]) {
      expect(ok(k, true)).toBe(true);
      expect(ok(k, "true")).toBe(false);
      expect(ok(k, 1)).toBe(false);
    }
  });
  it("inboxLinkTemplate: rỗng và mẫu facebook.com hợp lệ; mẫu lạ bị từ chối ngay ở tầng ghi cấu hình", () => {
    expect(ok("ai.inboxLinkTemplate", "")).toBe(true);
    expect(ok("ai.inboxLinkTemplate", "https://business.facebook.com/latest/inbox/all?thread_id={threadId}")).toBe(true);
    for (const x of ["https://evil.example/{threadId}", "http://facebook.com/{threadId}", "https://facebook.com/x", "https://{threadId}.facebook.com/"]) {
      expect(ok("ai.inboxLinkTemplate", x), x).toBe(false);
    }
  });
});

describe("[AIL-CD-05] KHÔNG khoá ai.* nào cho cơ sở tự sửa (cổng máy là của cả công ty; cổng PROD là của Quản trị tối cao)", () => {
  it.each(KHOA_AI)("%s: toàn hệ thống, QLCS không sửa, không ghi qua action riêng", (k) => {
    const d = SETTINGS[k as keyof typeof SETTINGS] as { centerOverridable: boolean; qlcsSuaDuoc?: boolean; tranQlcs?: number; group: string; ghiQuaActionRieng?: boolean };
    expect(d.centerOverridable).toBe(false);
    expect(d.qlcsSuaDuoc ?? false).toBe(false);
    expect(d.tranQlcs).toBeUndefined();
    expect(d.group).toBe("ai-lead");
    expect(d.ghiQuaActionRieng ?? false).toBe(false);
  });
  it("tab 'AI Lead' mở bằng settings:view (thực tế chỉ Quản trị tối cao), KHÔNG nới cho cấp cơ sở", () => {
    expect(TAB_CAU_HINH.some((t) => t.id === "ai-lead")).toBe(true);
    expect(QUYEN_TAB["ai-lead"]).toBe("settings:view");
  });
});

describe("[AIL-CD-06] nhãn vận hành: số TẠM phải ghi '(tạm)', hai khoá cổng PROD mang dấu cân nhắc", () => {
  it("mọi khoá có mặc định kiểu SỐ có nhãn chứa '(tạm)' và có đơn vị", () => {
    for (const k of KHOA_AI) {
      const def = (SETTINGS as Record<string, { default: unknown }>)[k]!;
      if (typeof def.default !== "number") continue;
      const n = nhanCuaKey(k as never);
      expect(n.ten, k).toContain("(tạm)");
      expect(n.donVi, k).toBeTruthy();
    }
  });
  it("ai.prodEnabled / ai.consentPolicyStatus / ai.takeoverNeedsAgentConfirmation đánh dấu canThan", () => {
    for (const k of ["ai.prodEnabled", "ai.consentPolicyStatus", "ai.takeoverNeedsAgentConfirmation"] as const) expect(nhanCuaKey(k).canThan, k).toBe(true);
  });
});
