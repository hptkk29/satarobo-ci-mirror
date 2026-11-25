// @vitest-environment node
/**
 * CẤU HÌNH THEO ORG cho đường webhook. Ba câu hỏi, và câu nào trả lời sai cũng hỏng
 * theo kiểu KHÔNG ai nhìn thấy:
 *
 *  1. Bí mật HMAC của org này là gì? — để ở **env** `ZALOCRM_WEBHOOK_SECRETS`, KHÔNG
 *     ở `IntegrationConfig.settings`: `settings` là cột `Json` lưu PLAINTEXT, đi vào
 *     mọi bản `pg_dump` và mọi bản sao DB dev/test (luật cứng #9).
 *  2. org này có thật không? — org lạ phải 404 nhưng PHẢI để lại vết, vì triệu chứng
 *     của "gõ sai một ký tự trong webhook_url" là **hộp thư trống**, không phải lỗi.
 *  3. org này thuộc cơ sở nào? — quyết định `orgUnitId` của mọi hội thoại đi vào,
 *     tức quyết định luôn ai đọc được chúng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  cauHinh: { isEnabled: boolean; settings: unknown } | null;
  center: { id: string } | null;
  orgCodes: Record<string, string>;
  orgUnitId: string | null;
} = { cauHinh: null, center: null, orgCodes: {}, orgUnitId: null };

vi.mock("@/lib/db", () => ({
  db: {
    integrationConfig: { findUnique: vi.fn(async () => state.cauHinh) },
    center: { findFirst: vi.fn(async () => state.center) },
  },
}));

vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async () => state.orgCodes),
}));

vi.mock("@/lib/org/org-service", () => ({
  orgUnitIdForCenter: vi.fn(async () => state.orgUnitId),
}));

import { docBangBiMat, KHUON_ORG_CODE, providerKeyForOrg, traCauHinhOrg } from "./config";

const ENV_CU = process.env.ZALOCRM_WEBHOOK_SECRETS;

beforeEach(() => {
  state.cauHinh = null;
  state.center = null;
  state.orgCodes = {};
  state.orgUnitId = null;
  process.env.ZALOCRM_WEBHOOK_SECRETS = JSON.stringify({ cs1: "bi-mat-cs1", cs2: "bi-mat-cs2" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ENV_CU === undefined) delete process.env.ZALOCRM_WEBHOOK_SECRETS;
  else process.env.ZALOCRM_WEBHOOK_SECRETS = ENV_CU;
  vi.restoreAllMocks();
});

describe("providerKeyForOrg + khuôn orgCode", () => {
  it("khoá `IntegrationConfig.provider` là `ZALOCRM:<org>` — cột đó @unique TOÀN CỤC", () => {
    // Bảng không có `centerId`; cách ly cơ sở nằm TRONG CHÍNH CHUỖI provider.
    expect(providerKeyForOrg("cs1")).toBe("ZALOCRM:cs1");
    expect(providerKeyForOrg("cs2")).not.toBe(providerKeyForOrg("cs1"));
  });

  it("khuôn orgCode giống hệt ô cấu hình `zalocrm.orgCodes` và vé SSO", () => {
    // Ba nơi nói cùng một câu thì khai sai ở đâu cũng lộ ngay tại chỗ khai.
    expect(KHUON_ORG_CODE.test("cs1")).toBe(true);
    expect(KHUON_ORG_CODE.test("test-2")).toBe(true);
    expect(KHUON_ORG_CODE.test("CS1")).toBe(false);
    expect(KHUON_ORG_CODE.test("cs 1")).toBe(false);
    expect(KHUON_ORG_CODE.test("../etc")).toBe(false);
    expect(KHUON_ORG_CODE.test("x".repeat(33))).toBe(false);
  });
});

describe("docBangBiMat — bí mật CHỈ ở env", () => {
  it("đọc JSON theo org", () => {
    const kq = docBangBiMat();
    expect(kq.ok).toBe(true);
    if (!kq.ok) throw new Error("phải ok");
    expect(kq.bang.cs1).toBe("bi-mat-cs1");
  });

  it("env vắng ⇒ {ok:false} THIEU_BI_MAT (fail-closed, không có chế độ stub)", () => {
    // 🔴 ĐẢO nhánh của OmiCall: `lib/calls/webhook.ts:53-59` (OmiCall — đã gỡ 06/10/2026) cho qua khi thiếu secret
    // ở dev/test. Chép sang đây là mở toang cửa cho bất kỳ ai POST vào — và "dev" là
    // đúng môi trường mà người ta hay quên bật lại.
    delete process.env.ZALOCRM_WEBHOOK_SECRETS;
    expect(docBangBiMat()).toEqual({ ok: false, ma: "THIEU_BI_MAT" });
    process.env.ZALOCRM_WEBHOOK_SECRETS = "";
    expect(docBangBiMat()).toEqual({ ok: false, ma: "THIEU_BI_MAT" });
  });

  it("JSON hỏng / không phải object ⇒ THIEU_BI_MAT, và KHÔNG log giá trị", () => {
    for (const gt of ["{khong-phai-json", '"chuoi"', "[1,2]", "123"]) {
      process.env.ZALOCRM_WEBHOOK_SECRETS = gt;
      expect(docBangBiMat(), gt).toEqual({ ok: false, ma: "THIEU_BI_MAT" });
    }
    // Luật cứng #9: không bao giờ đưa giá trị secret vào log.
    const daLog = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .map(String)
      .join(" ");
    expect(daLog).not.toContain("bi-mat-cs1");
  });

  it("mục có giá trị rỗng bị loại — khoá rỗng không phải là 'có khoá'", () => {
    process.env.ZALOCRM_WEBHOOK_SECRETS = JSON.stringify({ cs1: "", cs2: "  ", cs3: "ok" });
    const kq = docBangBiMat();
    if (!kq.ok) throw new Error("phải ok");
    expect(Object.keys(kq.bang)).toEqual(["cs3"]);
  });
});

describe("traCauHinhOrg", () => {
  it("org sai khuôn ⇒ ORG_KHONG_HOP_LE, và KHÔNG tra DB", async () => {
    const { db } = await import("@/lib/db");
    const kq = await traCauHinhOrg("../../etc/passwd");
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("ORG_KHONG_HOP_LE");
    // Đừng ném chuỗi của người lạ thẳng vào `findUnique`.
    expect(db.integrationConfig.findUnique).not.toHaveBeenCalled();
  });

  it("thiếu env bí mật ⇒ THIEU_BI_MAT (nơi gọi trả 503, KHÔNG tạo bản ghi nào)", async () => {
    delete process.env.ZALOCRM_WEBHOOK_SECRETS;
    const kq = await traCauHinhOrg("cs1");
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_BI_MAT");
  });

  it("org không có trong bảng bí mật ⇒ ORG_KHONG_KHAI (404) + console.warn", async () => {
    const kq = await traCauHinhOrg("cs9");
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("ORG_KHONG_KHAI");
    // Vết bắt buộc: nếu không, gõ sai một ký tự trong webhook_url ⇒ mọi tin rơi vào
    // 404 câm và triệu chứng là "hộp thư trống", không phải "lỗi".
    expect(console.warn).toHaveBeenCalled();
  });

  it("có dòng IntegrationConfig nhưng `isEnabled=false` ⇒ ORG_TAT (tắt riêng một cơ sở)", async () => {
    state.cauHinh = { isEnabled: false, settings: {} };
    const kq = await traCauHinhOrg("cs1");
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("ORG_TAT");
  });

  it("chưa có dòng IntegrationConfig ⇒ VẪN chạy (màn Tích hợp là việc của L9)", async () => {
    state.cauHinh = null;
    state.orgCodes = { CS1: "cs1" };
    state.center = { id: "center-cs1" };
    state.orgUnitId = "ou-cs1";

    const kq = await traCauHinhOrg("cs1");
    expect(kq.ok).toBe(true);
    if (!kq.ok) throw new Error("phải ok");
    // Cổng thật là BÍ MẬT trong env, không phải dòng cấu hình trong DB. Bắt buộc có
    // dòng DB trước mới nhận tin sẽ chặn cả đường nghiệm thu ở GĐ0.
    expect(kq.cauHinh.secret).toBe("bi-mat-cs1");
    expect(kq.cauHinh.centerId).toBe("center-cs1");
    expect(kq.cauHinh.orgUnitId).toBe("ou-cs1");
  });

  it("orgCode chưa ánh xạ cơ sở ⇒ centerId/orgUnitId = null, KHÔNG đoán", async () => {
    // Đoán nhầm cơ sở kéo theo gán nhầm đơn vị cho MỌI hội thoại của nick đó — tức
    // rò chéo cơ sở, và không có gì báo. Giữ `null` thì hội thoại ở nhóm mồ côi:
    // ai cũng thấy, nhưng đó là trạng thái ĐÃ BIẾT và có hàng đợi xử lý.
    state.orgCodes = { CS2: "cs2" };
    const kq = await traCauHinhOrg("cs1");
    if (!kq.ok) throw new Error("phải ok");
    expect(kq.cauHinh.centerId).toBeNull();
    expect(kq.cauHinh.orgUnitId).toBeNull();
  });

  it("ánh xạ tra theo GIÁ TRỊ (orgCode), không phải theo khoá", async () => {
    // Hợp đồng của `zalocrm.orgCodes`: khoá = `Center.code`, giá trị = orgCode bên
    // ZaloCRM. Đảo chiều lúc tra là ánh xạ về cơ sở khác — im lặng.
    state.orgCodes = { CS1: "cs1", CS2: "cs2" };
    state.center = { id: "center-cs2" };
    const kq = await traCauHinhOrg("cs2");
    if (!kq.ok) throw new Error("phải ok");
    const { db } = await import("@/lib/db");
    expect(db.center.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: "CS2" }) }),
    );
  });

  it("setting đọc hỏng ⇒ vẫn nhận tin, chỉ là chưa biết cơ sở (không nuốt tin)", async () => {
    const { getSetting } = await import("@/lib/settings/service");
    (getSetting as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error("DB setting hỏng"),
    );
    const kq = await traCauHinhOrg("cs1");
    expect(kq.ok).toBe(true);
    if (!kq.ok) throw new Error("phải ok");
    expect(kq.cauHinh.orgUnitId).toBeNull();
  });
});
