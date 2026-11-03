import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ getSetting: vi.fn() }));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.getSetting }));

import {
  KHOA_CONG_TAC_PHAM_VI,
  LOI_PHAM_VI_TAT,
  chanNeuPhamViTat,
  docCauHinhPhamVi,
  docQuyTacBuoiLe,
  docThuTuConMacDinh,
  laThuHocPhiTheoPhamViBat,
} from "./feature";

beforeEach(() => h.getSetting.mockReset());

describe("[FTR] công tắc thu học phí theo phạm vi học", () => {
  it("[FTR-01] hỏi đúng khoá và truyền orgUnitId (không phải centerId)", async () => {
    h.getSetting.mockResolvedValue(true);
    await laThuHocPhiTheoPhamViBat("ou-cs1");
    expect(h.getSetting).toHaveBeenCalledWith("billing.scopePurchaseEnabled", { orgUnitId: "ou-cs1" });
    expect(KHOA_CONG_TAC_PHAM_VI).toBe("billing.scopePurchaseEnabled");
  });

  it("[FTR-02] không truyền cơ sở ⇒ đọc giá trị toàn hệ (orgUnitId = null)", async () => {
    h.getSetting.mockResolvedValue(false);
    await laThuHocPhiTheoPhamViBat();
    expect(h.getSetting).toHaveBeenCalledWith("billing.scopePurchaseEnabled", { orgUnitId: null });
  });

  it("[FTR-03] tắt ⇒ chặn bằng câu từ chối thống nhất; bật ⇒ null", async () => {
    h.getSetting.mockResolvedValue(false);
    expect(await chanNeuPhamViTat("ou-cs1")).toBe(LOI_PHAM_VI_TAT);
    h.getSetting.mockResolvedValue(true);
    expect(await chanNeuPhamViTat("ou-cs1")).toBeNull();
  });

  it("[FTR-04] cơ sở bật không kéo cơ sở khác: mỗi lần hỏi là một lần tra riêng theo orgUnitId", async () => {
    h.getSetting.mockImplementation(async (...a: unknown[]) => (a[1] as { orgUnitId: string | null } | undefined)?.orgUnitId === "ou-cs1");
    expect(await laThuHocPhiTheoPhamViBat("ou-cs1")).toBe(true);
    expect(await laThuHocPhiTheoPhamViBat("ou-cs2")).toBe(false);
    expect(await laThuHocPhiTheoPhamViBat(null)).toBe(false);
    expect(h.getSetting.mock.calls.map((c) => c[1])).toEqual([{ orgUnitId: "ou-cs1" }, { orgUnitId: "ou-cs2" }, { orgUnitId: null }]);
  });

  it("[FTR-05] cấu hình phạm vi đọc theo cơ sở và ghép đúng vào CauHinhPhamVi", async () => {
    h.getSetting.mockImplementation(async (k: string) =>
      ({
        "enrollment.lateEntryMaxLessons": 3,
        "enrollment.catchUpMaxSessions": 8,
        "enrollment.catchUpOverCapPolicy": "KEEP_LATEST",
        "enrollment.graceCountsTowardNextPurchase": false,
      })[k],
    );
    const c = await docCauHinhPhamVi("ou-cs2");
    expect(c).toMatchObject({ lateEntryMaxLessons: 3, catchUpMaxSessions: 8, graceCountsTowardNext: false });
    for (const call of h.getSetting.mock.calls) expect(call[1]).toEqual({ orgUnitId: "ou-cs2" });
  });

  it("[FTR-06] quy tắc buổi lẻ đi qua ánh xạ", async () => {
    h.getSetting.mockResolvedValue("LOWER_TIER");
    expect(await docQuyTacBuoiLe("ou-cs1")).toBe("MOC_THAP_HON");
  });

  it("[FTR-07] CHỈ đúng `true` mới là cờ BẬT: số 50 (mock cũ trả cho mọi khoá lạ), chuỗi 'true', 1, null đều là TẮT", async () => {
    for (const v of [50, 1, "true", "false", null, undefined, {}, [true]]) {
      h.getSetting.mockResolvedValue(v);
      expect(await laThuHocPhiTheoPhamViBat("ou-cs1"), JSON.stringify(v)).toBe(false);
      expect(await chanNeuPhamViTat("ou-cs1"), JSON.stringify(v)).toBe(LOI_PHAM_VI_TAT);
    }
    h.getSetting.mockResolvedValue(true);
    expect(await laThuHocPhiTheoPhamViBat("ou-cs1")).toBe(true);
  });

  it("[FTR-08] thứ tự con mặc định đọc khoá toàn hệ; giá trị lạ rơi về 'thấp trước'", async () => {
    h.getSetting.mockResolvedValue("HIGHER_VALUE_FIRST");
    expect(await docThuTuConMacDinh()).toBe("HIGHER_VALUE_FIRST");
    expect(h.getSetting).toHaveBeenCalledWith("pricing.sameTimeChildOrder");
    for (const v of ["LOWER_VALUE_FIRST", "???", null, 3]) {
      h.getSetting.mockResolvedValue(v);
      expect(await docThuTuConMacDinh(), String(v)).toBe("LOWER_VALUE_FIRST");
    }
  });
});

describe("[FTR-PIN] khoá công tắc chỉ được ĐỌC ở một chỗ", () => {
  const KHOA = "billing.scopePurchaseEnabled";
  // Bỏ chú thích TRƯỚC khi quét: nhiều tệp nhắc tên khoá trong phần giải thích ("cờ TẮT ⇒ đừng gọi hàm này").
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("[FTR-PIN-01] ngoài registry, nhãn vận hành, feature.ts và các test của nó, không tệp MÃ nào dùng chuỗi khoá", () => {
    let ra: string;
    try {
      ra = execFileSync("git", ["grep", "--untracked", "-l", "-F", KHOA, "--", "lib", "app", "components"], { encoding: "utf8" });
    } catch (e) {
      // git grep thoát 1 khi không có kết quả — ở đây luôn có ít nhất registry, nên 1 nghĩa là lưới hỏng
      throw new Error("git grep không tìm thấy gì — lưới này chưa chạm tới mã", { cause: e });
    }
    const tep = ra.split("\n").filter(Boolean).map((t) => t.replace(/\\/g, "/")).sort();
    const choPhep = new Set([
      "lib/entitlements/cai-dat.test.ts",
      "lib/entitlements/feature.test.ts",
      "lib/entitlements/feature.ts",
      "lib/settings/nhan-van-hanh.ts",
      "lib/settings/registry.ts",
    ]);
    // Đối chứng dương: ba nơi được phép phải THẬT SỰ chứa khoá trong mã (lưới không rỗng vì grep hỏng).
    for (const t of ["lib/entitlements/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"]) {
      expect(tep, t).toContain(t);
    }
    const lo = tep.filter((t) => !choPhep.has(t) && boChuThich(readFileSync(resolve(process.cwd(), t), "utf8")).includes(KHOA));
    expect(lo).toEqual([]);
  });
});
