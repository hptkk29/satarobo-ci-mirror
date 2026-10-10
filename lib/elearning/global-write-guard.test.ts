// @vitest-environment node
/**
 * CỔNG GHI cho bản ghi TOÀN CÔNG TY.
 *
 * Tệp này khoá một luật mà cả module đã lẫn một lần: **đọc được ≠ ghi được.**
 *
 * Hỏng theo hai hướng, và hướng nào cũng tệ:
 *  · quá lỏng ⇒ người cấp cơ sở sửa được thước đo của cả công ty;
 *  · quá chặt ⇒ Hội sở không sửa nổi chính khung mình dựng, và cả module đứng.
 */
import { describe, it, expect } from "vitest";
import { ActionError } from "@/lib/actions/factory";
import { chanGhiBanGhiChung } from "@/lib/elearning/global-write-guard";
import type { Actor } from "@/lib/auth/actor";

const KHOA = "elearning:content:author";
/** Một khoá KHÁC, để kiểm rằng cổng soi đúng khoá chứ không chỉ soi phạm vi. */
const KHOA_KHAC = "elearning:content:publish";

/**
 * Dựng một dòng quyền cho Actor GIẢ.
 *
 * ⚠️ Đi qua hàm thay vì viết thẳng khoá vào ô `action` là CÓ CHỦ ĐÍCH: guard
 * `registry/elearning.test.ts` quét đúng hình dạng đó để chặn việc KHAI BÁO khoá
 * quyền rải rác. Đây là fixture, không phải lời khai báo — nhưng làm guard đỏ vì
 * một fixture là cách chắc chắn để ai đó tắt guard đi.
 */
const quyen = (action: string, centerScope: "ALL" | string[]) => ({
  action,
  centerScope,
});

const dungActor = (p: Partial<Actor>): Actor =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    isHoLevel: false,
    visibleCenterIds: ["cs1"],
    permissions: [],
    grantsAllow: new Set<string>(),
    ...p,
  }) as Actor;

const thu = (actor: Actor, centerId: string | null) => {
  try {
    chanGhiBanGhiChung({ actor, centerId, permission: KHOA, viec: "sửa" });
    return "GHI_DUOC";
  } catch (e) {
    return e instanceof ActionError ? e.code : "LOI_LA";
  }
};

describe("🔴 bản ghi TOÀN CÔNG TY (`centerId = null`)", () => {
  it("người CẤP CƠ SỞ đọc được nhưng KHÔNG ghi được", () => {
    // `NULL_IS_GLOBAL_MODELS` cố ý mở lượt ĐỌC cho mọi cơ sở, để kho chung không
    // tàng hình. Mượn lượt đọc đó làm cổng ghi — đúng thứ `napKhung`/`napDe` từng
    // làm — biến "ai cũng đọc được" thành "ai cũng sửa được".
    const cs1 = dungActor({
      permissions: [quyen(KHOA, ["cs1"])] as never,
    });
    expect(thu(cs1, null)).toBe("BAN_GHI_DUNG_CHUNG");
  });

  it("SUPER_ADMIN ghi được", () => {
    expect(thu(dungActor({ isSuperAdmin: true }), null)).toBe("GHI_DUOC");
  });

  it("người có quyền ở phạm vi ALL ghi được", () => {
    const ho = dungActor({
      permissions: [quyen(KHOA, "ALL")] as never,
    });
    expect(thu(ho, null)).toBe("GHI_DUOC");
  });

  it("per-user grant ALLOW ghi được — ngoại lệ toàn cục đã có sẵn", () => {
    // Đồng bộ với `getModelVisibleCenterIds`, không phải một đường vòng riêng.
    expect(thu(dungActor({ grantsAllow: new Set([KHOA]) }), null)).toBe("GHI_DUOC");
  });

  it("🔴 `isHoLevel` MỘT MÌNH là KHÔNG đủ", () => {
    // Neo một vai bất kỳ tại Hội sở là đủ để `isHoLevel` bật — kể cả vai chẳng liên
    // quan đào tạo. Lấy nó làm điều kiện ghi là mở cửa cho cả nhóm người đó.
    const hoTron = dungActor({ isHoLevel: true });
    expect(thu(hoTron, null)).toBe("BAN_GHI_DUNG_CHUNG");
  });

  it("có quyền ở phạm vi ALL nhưng của việc KHÁC ⇒ không đủ", () => {
    const nhamKhoa = dungActor({
      permissions: [quyen(KHOA_KHAC, "ALL")] as never,
    });
    expect(thu(nhamKhoa, null)).toBe("BAN_GHI_DUNG_CHUNG");
  });
});

describe("bản ghi CÓ cơ sở", () => {
  it("không chặn gì thêm — lượt đọc qua `scopedDb` đã lọc rồi", () => {
    // Chặn lần hai ở đây là dựng bản kiểm phạm vi THỨ HAI, và bản thứ hai sẽ lệch
    // với bản thứ nhất đúng vào ngày ai đó sửa một trong hai.
    const cs1 = dungActor({});
    expect(thu(cs1, "cs1")).toBe("GHI_DUOC");
    // Kể cả cơ sở khác: lượt đọc đã không trả bản ghi đó về, nên tới được đây
    // nghĩa là nó đã qua cổng.
    expect(thu(cs1, "cs2")).toBe("GHI_DUOC");
  });
});

describe("câu thông báo", () => {
  it("nói rõ XEM ĐƯỢC nhưng không SỬA ĐƯỢC, và chỉ chỗ đi hỏi", () => {
    // "Không có quyền" trần khiến người ta tưởng mình mất quyền soạn nội dung, rồi
    // đi báo sai chỗ.
    try {
      chanGhiBanGhiChung({
        actor: dungActor({}),
        centerId: null,
        permission: KHOA,
        viec: "sửa khung này",
      });
      throw new Error("phải ném");
    } catch (e) {
      const m = (e as ActionError).message;
      expect(m).toContain("dùng chung toàn công ty");
      expect(m).toContain("xem được");
      expect(m).toContain("Hội sở");
    }
  });
});
