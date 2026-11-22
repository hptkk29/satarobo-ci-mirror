// [KPT-*] — `khoiParttime`: hai màn Parttime của QLCS và tab điều hướng chọn khối bằng MỘT phép. Sai ở đây là nhãn "Chưa bật" trên
// tab nói một khối còn màn mở khối khác (luật 12), hoặc mở khối người dùng không có quyền.
import { describe, expect, it } from "vitest";
import type { ModuleAction, ModuleScope, ScopeBlock } from "./module-scope";
import { khoiParttime } from "./khoi-parttime";

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";

function scope(spec: Record<string, ModuleAction[]>, bat: string[] = []): ModuleScope {
  const blocks: ScopeBlock[] = Object.entries(spec).map(([id, a]) => ({
    id,
    code: id,
    label: id,
    perms: { [VIEW]: a.includes(VIEW), [ASSIGN]: a.includes(ASSIGN) } as ScopeBlock["perms"],
    parttimeStaffing: bat.includes(id),
    parttimeShadow: false,
  }));
  return {
    blocks,
    has: (a, c) => blocks.some((b) => b.id === c && b.perms[a]),
    blocksWith: (a) => blocks.filter((b) => b.perms[a]),
    any: (a) => blocks.some((b) => b.perms[a]),
    pick: () => null,
  };
}

describe("[KPT] khoiParttime", () => {
  it("[KPT-01] không VIEW / ASSIGN ở đâu ⇒ null (trang vẽ 'không có quyền', tab ẩn)", () => {
    expect(khoiParttime(scope({ cs1: [] }), null)).toBeNull();
  });
  it("[KPT-02] không nêu cơ sở ⇒ khối ĐANG BẬT trước; không khối nào bật ⇒ khối đầu", () => {
    expect(khoiParttime(scope({ cs1: [VIEW], cs2: [VIEW] }, ["cs2"]), null)?.block.id).toBe("cs2");
    expect(khoiParttime(scope({ cs1: [VIEW], cs2: [VIEW] }), null)?.block.id).toBe("cs1");
  });
  it("[KPT-03] nêu cơ sở hợp lệ ⇒ đúng khối đó kể cả khi nó TẮT và khối khác bật (đa cơ sở: chọn gì mở nấy)", () => {
    expect(khoiParttime(scope({ cs1: [VIEW], cs2: [VIEW] }, ["cs2"]), "cs1")?.block.id).toBe("cs1");
  });
  it("[KPT-04] nêu cơ sở KHÔNG có quyền ⇒ không mở nó; rơi về khối bật trong phạm vi, không mở bừa khối đầu", () => {
    const r = khoiParttime(scope({ cs1: [VIEW], cs2: [], cs3: [VIEW] }, ["cs3"]), "cs2");
    expect(r?.block.id).toBe("cs3");
    expect(r?.khoi.map((b) => b.id)).toEqual(["cs1", "cs3"]);
  });
  it("[KPT-05] chỉ ASSIGN (không VIEW ở đâu) ⇒ vẫn xem được, danh sách = khối có ASSIGN", () => {
    expect(khoiParttime(scope({ cs1: [ASSIGN], cs2: [] }), null)?.khoi.map((b) => b.id)).toEqual(["cs1"]);
  });
});
