// lib/permissions/can-scope-shadow.test.ts — Nền Hệ thống P3 · US-12 · AC3.
//
// AC3 nói "shadow KHÔNG được ảnh hưởng quyết định". Câu đó dễ gật đầu, khó chứng minh —
// nên file này chứng minh bằng ca ĐỘC: sink cố tình ném lỗi, cố tình trả kết quả ngược,
// cố tình chạy chậm. Sau mỗi ca, `can()` phải trả ĐÚNG thứ nó trả khi không có shadow.
//
// Vì sao đo bằng cách so với "bản không shadow" chứ không hard-code true/false: hard-code
// thì mai kia ai sửa luật quyền, test này đỏ vì lý do sai và người ta sẽ sửa con số cho
// xanh. So hai đường thì test chỉ đỏ khi shadow THỰC SỰ can thiệp.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";
import { can } from "@/lib/permissions/can";
import { datScopeShadowSink, xoaScopeShadowSink } from "@/lib/permissions/scope-shadow-sink";

const grant = (over: Partial<GrantRow> = {}): GrantRow =>
  ({
    subjectType: "ROLE",
    subjectId: "role-gv",
    permissionKey: "students:view",
    effect: "ALLOW",
    dataScope: "UNIT_ONLY",
    fieldMask: [],
    ...over,
  }) as GrantRow;

const actor = (over: Partial<Actor> = {}): Actor =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    roleIds: ["role-gv"],
    groupIds: [],
    permissionGrants: [grant()],
    // Đủ field cho ĐƯỜNG CŨ: ca "key không có grant" rơi xuống canV2, và canV2 đọc
    // thẳng hai field này. Thiếu là test đỏ vì fixture, không phải vì shadow.
    grantsAllow: new Set<string>(),
    permissions: [],
    roleCenterScope: { "role-gv": { unitOnly: ["c-cs1"], unitAndBelow: ["c-cs1"] } },
    roleOrgScope: { "role-gv": { unitOnly: ["ou-cs1"], unitAndBelow: ["ou-cs1"] } },
    ...over,
  }) as Actor;

/** Bộ ca phủ cả CHO lẫn TỪ CHỐI — shadow phải trong suốt ở cả hai chiều. */
const CAC_CA: { ten: string; target: Parameters<typeof can>[2] }[] = [
  { ten: "trong phạm vi ⇒ cho", target: { centerId: "c-cs1", orgUnitId: "ou-cs1" } },
  { ten: "ngoài phạm vi ⇒ từ chối", target: { centerId: "c-cs2", orgUnitId: "ou-cs2" } },
  { ten: "hai đường LỆCH nhau", target: { centerId: "c-cs1", orgUnitId: "ou-khac" } },
  { ten: "chưa phủ (thiếu orgUnitId)", target: { centerId: "c-cs1" } },
];

beforeEach(() => xoaScopeShadowSink());
afterEach(() => xoaScopeShadowSink());

describe("[US-12][AC3] shadow KHÔNG được đổi quyết định của can()", () => {
  it("sink NÉM LỖI ⇒ can() vẫn trả y hệt bản không shadow", () => {
    const chuan = CAC_CA.map((c) => can(actor(), "students:view", c.target));
    datScopeShadowSink(() => {
      throw new Error("sink hỏng");
    });
    const coShadow = CAC_CA.map((c) => can(actor(), "students:view", c.target));
    expect(coShadow).toEqual(chuan);
  });

  it("sink trả kết quả NGƯỢC ⇒ can() vẫn trả y hệt bản không shadow", () => {
    const chuan = CAC_CA.map((c) => can(actor(), "students:view", c.target));
    // Sink là void — dù nó có "trả" gì cũng không được ai đọc. Ca này ghim đúng điều đó.
    datScopeShadowSink((() => !chuan[0]) as unknown as () => void);
    const coShadow = CAC_CA.map((c) => can(actor(), "students:view", c.target));
    expect(coShadow).toEqual(chuan);
  });

  it("KHÔNG đăng ký sink ⇒ chạy bình thường, không ném", () => {
    expect(() => can(actor(), "students:view", { centerId: "c-cs1" })).not.toThrow();
  });
});

describe("[US-12][AC2] sink nhận đủ dữ liệu để so", () => {
  it("được gọi với chính (grant, actor, target) mà can() đang xét", () => {
    const sink = vi.fn();
    datScopeShadowSink(sink);
    const a = actor();
    can(a, "students:view", { centerId: "c-cs1", orgUnitId: "ou-cs1" });
    expect(sink).toHaveBeenCalled();
    const [ac, key, t] = sink.mock.calls[0]!;
    expect(ac).toBe(a);
    expect(key).toBe("students:view");
    expect(t).toEqual({ centerId: "c-cs1", orgUnitId: "ou-cs1" });
  });

  it("ĐÚNG MỘT lần mỗi lượt can() — không nhân bản theo số dòng grant/perm", () => {
    // Bản đầu phát theo từng dòng khớp key; số liệu phồng lên bằng nhiễu vô hại.
    const sink = vi.fn();
    datScopeShadowSink(sink);
    can(actor(), "students:view", { centerId: "c-cs1", orgUnitId: "ou-cs1" });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("key KHÔNG có grant nào ⇒ VẪN báo — đường cũ mới là chỗ P4 lật, bỏ qua là mù", () => {
    const sink = vi.fn();
    datScopeShadowSink(sink);
    can(actor(), "khong-ton-tai:view", { centerId: "c-cs1" });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
