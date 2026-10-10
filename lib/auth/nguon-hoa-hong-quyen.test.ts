// [NHH-SEC-01..03] — QUYỀN module "Nguồn lead & Chính sách hoa hồng" (nền dùng chung, 08/10/2026).
// Nguồn đặc tả: docs/source-commission/05-quyen-co-kiem-thu-trien-khai.md §1.2, §1.3, §1.5, §1.6, §5.3.
// Test viết TRƯỚC hiện thực (luật cứng Nền hệ thống #5): commit đầu của đợt này là ĐỎ.
//
// MA TRẬN BÊN DƯỚI GÕ TAY, KHÔNG ĐỌC TỪ `ROLE_SEED` — nếu suy từ seed thì test chỉ kiểm seed bằng chính
// nó. Muốn đổi ai-được-gì thì sửa Ở ĐÂY và ở §1.3 của tài liệu cùng lúc, đừng sửa riêng một bên.
//
// ⚠️ Key mới ⇒ sau khi `test` → `main` PHẢI bấm `seed-prod-roles.yml` (RBAC v2 đọc quyền từ DB).
import { describe, it, expect } from "vitest";
import { PERMISSIONS, ALL_ACTIONS, can as canV1, type Action } from "@/lib/auth/permissions";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";
import type { Role } from "@prisma/client";

/** Chín key MỚI của đợt này (05 §1.2). `commission_periods:manage` + `leads:overwrite` ĐÃ CÓ — không nằm ở đây. */
const KEY_MOI = [
  "sources:view",
  "sources:manage",
  "sources:override-after-payment",
  "commission_policies:view",
  "commission_policies:manage",
  "commission_policies:activate",
  "commission:view-self",
  "commission:view-center",
  "commission_disputes:review",
] as const satisfies readonly Action[];
type KeyMoi = (typeof KEY_MOI)[number];

/**
 * Ma trận vai (v2, RoleDef.code) × key — ĐÚNG bảng 05 §1.3, cộng hai vai ngoài bảng mà ghi chú H14 cấp
 * `view-self` (TRAINING, CENTER_CLASS_MANAGER). `TEACHER` KHÔNG có gì tới PR12 (site GV riêng).
 */
const MA_TRAN: Record<KeyMoi, readonly string[]> = {
  "sources:view": ["SUPER_ADMIN", "GIAM_DOC", "HO_ACCOUNTANT", "HO_MARKETING", "CENTER_MANAGER"],
  "sources:manage": ["SUPER_ADMIN", "HO_MARKETING"],
  "sources:override-after-payment": ["SUPER_ADMIN"],
  "commission_policies:view": [
    "SUPER_ADMIN",
    "GIAM_DOC",
    "HO_ACCOUNTANT",
    "HO_HR",
    "HO_MARKETING",
    "CENTER_MANAGER",
  ],
  "commission_policies:manage": ["SUPER_ADMIN", "HO_HR"],
  "commission_policies:activate": ["SUPER_ADMIN", "GIAM_DOC"],
  "commission:view-self": [
    "SUPER_ADMIN",
    "GIAM_DOC",
    "HO_ACCOUNTANT",
    "CENTER_ACCOUNTANT",
    "HO_HR",
    "CENTER_HR",
    "HO_MARKETING",
    "CENTER_MANAGER",
    "CENTER_SALES_CSM",
    "HO_SALE",
    "TRAINING",
    "CENTER_CLASS_MANAGER",
  ],
  "commission:view-center": [
    "SUPER_ADMIN",
    "GIAM_DOC",
    "HO_ACCOUNTANT",
    "CENTER_ACCOUNTANT",
    "HO_HR",
    "CENTER_HR",
    "CENTER_MANAGER",
  ],
  "commission_disputes:review": ["SUPER_ADMIN", "HO_HR"],
};

/** Vai nội bộ vào được host admin (H14). `TEACHER`/`ASSISTANT_TEACHER` đi site GV, `AUDITOR`/`PARENT` ngoài module. */
const VAI_VAO_HOST_ADMIN = ROLE_SEED.map((r) => r.code).filter(
  (c) => !["TEACHER", "ASSISTANT_TEACHER", "AUDITOR", "PARENT"].includes(c),
);

const giu = (code: string): string[] => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => p.action);
};
const aiGiu = (key: string): string[] =>
  ROLE_SEED.filter((r) => r.perms.some((p) => p.action === key)).map((r) => r.code);

describe("[NHH-SEC-01] ROLE_SEED khớp ma trận 05 §1.3", () => {
  for (const key of KEY_MOI) {
    it(`${key}: đúng tập vai, không hơn không kém`, () => {
      expect(aiGiu(key).sort()).toEqual([...MA_TRAN[key]].sort());
    });
  }

  it("mọi dòng seed của 9 key mới là GLOBAL (key gác trang, gọi trần — CENTER sẽ FALSE trên prod)", () => {
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms
        .filter((p) => (KEY_MOI as readonly string[]).includes(p.action) && p.scopeType !== "GLOBAL")
        .map((p) => `${r.code}·${p.action}=${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });

  it("không vai nào khai MỘT key hai lần (seed trùng dòng là rác khó thấy)", () => {
    const trung = ROLE_SEED.flatMap((r) => {
      const dem = new Map<string, number>();
      for (const p of r.perms) {
        if ((KEY_MOI as readonly string[]).includes(p.action)) {
          dem.set(p.action, (dem.get(p.action) ?? 0) + 1);
        }
      }
      return [...dem].filter(([, n]) => n > 1).map(([k]) => `${r.code}·${k}`);
    });
    expect(trung).toEqual([]);
  });

  it("(i) `leads:overwrite` giữ nguyên tập {SUPER_ADMIN, CENTER_MANAGER} — nới nó là nới quyền đổi người hưởng hoa hồng (Q-03)", () => {
    expect([...PERMISSIONS["leads:overwrite"]].sort()).toEqual(["CENTER_MANAGER", "SUPER_ADMIN"]);
    // v2: SUPER_ADMIN đi bằng bypass nên có thể không có dòng; CENTER_MANAGER PHẢI có (đối chứng dương).
    const trongSeed = aiGiu("leads:overwrite");
    expect(trongSeed).toContain("CENTER_MANAGER");
    expect(trongSeed.filter((c) => c !== "SUPER_ADMIN" && c !== "CENTER_MANAGER")).toEqual([]);
  });

  it("`commission_periods:manage` ĐÃ CÓ: không bị nhân đôi, tập vai không đổi", () => {
    expect(aiGiu("commission_periods:manage").sort()).toEqual(["HO_ACCOUNTANT", "SUPER_ADMIN"]);
    expect(ALL_ACTIONS.filter((a) => a === "commission_periods:manage")).toHaveLength(1);
  });

  it("(ii) vai nào có một key hoa hồng bất kỳ cũng có `view-self` hoặc `view-center` (mục sidebar trỏ tab Sổ)", () => {
    const tienTo = ["commission:", "commission_policies:", "commission_periods:", "commission_disputes:"];
    const thieu = ROLE_SEED.filter((r) => r.perms.some((p) => tienTo.some((t) => p.action.startsWith(t))))
      .filter(
        (r) =>
          !r.perms.some((p) => p.action === "commission:view-self" || p.action === "commission:view-center"),
      )
      .map((r) => r.code);
    expect(thieu).toEqual([]);
  });

  it("(iii) mọi vai nội bộ vào host admin có `view-self` (H14) — đối chứng dương VÀ âm", () => {
    for (const code of VAI_VAO_HOST_ADMIN) {
      expect(giu(code), `${code} phải có commission:view-self`).toContain("commission:view-self");
    }
    // Đối chứng âm: PARENT không vào module; TEACHER chờ PR12; AUDITOR ngoài module.
    for (const code of ["PARENT", "TEACHER", "AUDITOR"]) {
      expect(giu(code), `${code} KHÔNG được có commission:view-self`).not.toContain("commission:view-self");
    }
  });

  it("đối chứng: Sale chỉ có `view-self`, KHÔNG có `view-center` (đọc thêm của người khác là lộ hoa hồng đồng nghiệp)", () => {
    expect(giu("CENTER_SALES_CSM")).toContain("commission:view-self");
    expect(giu("CENTER_SALES_CSM")).not.toContain("commission:view-center");
    expect(giu("HO_SALE")).not.toContain("commission:view-center");
  });

  it("đối chứng: kích hoạt chính sách CHỈ SUPER_ADMIN + GIAM_DOC; soạn nháp KHÔNG kéo theo kích hoạt", () => {
    expect(giu("HO_HR")).toContain("commission_policies:manage");
    expect(giu("HO_HR")).not.toContain("commission_policies:activate");
  });

  it("đổi nguồn SAU thực thu chỉ SUPER_ADMIN (sinh Adjustment — việc của người quyết định cuối)", () => {
    expect(aiGiu("sources:override-after-payment")).toEqual(["SUPER_ADMIN"]);
  });
});

describe("[NHH-SEC-01] khai đủ BẢY chỗ (05 §1.6) cho 9 key mới", () => {
  it("(1) `Action` union + map `PERMISSIONS` (v1)", () => {
    for (const k of KEY_MOI) {
      expect(ALL_ACTIONS, `ALL_ACTIONS thiếu ${k}`).toContain(k);
      expect(PERMISSIONS, `PERMISSIONS thiếu ${k}`).toHaveProperty(k);
    }
  });

  it("(2) registry descriptor — `sources:` ở module crm, ba prefix hoa hồng ở module finance", () => {
    const mo = collectDescriptors(ALL_MODULE_DECLS);
    for (const k of KEY_MOI) {
      const row = mo.get(k);
      expect(row, `registry thiếu ${k}`).toBeDefined();
      expect(row?.action).toBe(k.split(":")[1]);
      expect(row?.module, `${k} sai module`).toBe(k.startsWith("sources:") ? "crm" : "finance");
      expect(row?.description ?? "", `${k} thiếu mô tả`).not.toBe("");
    }
  });

  it("(2b) mỗi prefix `resource:` của 9 key chỉ thuộc MỘT module", () => {
    const mo = collectDescriptors(ALL_MODULE_DECLS);
    const tien = new Map<string, Set<string>>();
    for (const row of mo.values()) {
      const p = row.key.split(":")[0];
      tien.set(p, (tien.get(p) ?? new Set()).add(row.module));
    }
    for (const p of ["sources", "commission", "commission_policies", "commission_disputes"]) {
      expect([...(tien.get(p) ?? [])], `prefix ${p} ở nhiều module`).toHaveLength(1);
    }
  });

  it("(3) seed vai — mọi key mới có người giữ trong ROLE_SEED", () => {
    for (const k of KEY_MOI) expect(aiGiu(k).length, `${k}: seed không vai nào`).toBeGreaterThan(0);
  });
});

describe("[NHH-SEC-02] v1 (chạy ở local/dev/CI) cho CÙNG câu trả lời với v2 ở các vai v1", () => {
  /** Vai v1 → RoleDef.code mà `LEGACY_TO_ROLEDEF` ánh xạ tới (neo HO/mặc định). */
  const V1_SANG_V2: ReadonlyArray<readonly [Role, string]> = [
    ["SUPER_ADMIN", "SUPER_ADMIN"],
    ["ACCOUNTANT", "HO_ACCOUNTANT"],
    ["HR", "HO_HR"],
    ["MARKETING", "HO_MARKETING"],
    ["CENTER_MANAGER", "CENTER_MANAGER"],
    ["SALES_CSM", "CENTER_SALES_CSM"],
    ["TRAINING", "TRAINING"],
    ["TEACHER", "TEACHER"],
  ];

  for (const [v1, v2] of V1_SANG_V2) {
    it(`${v1} ↔ ${v2}: mọi key trong 9 key mới trả lời giống nhau`, () => {
      const lech = KEY_MOI.filter((k) => canV1(v1, k) !== giu(v2).includes(k)).map(
        (k) => `${k}: v1=${canV1(v1, k)} v2=${giu(v2).includes(k)}`,
      );
      expect(lech, `${v1} lệch v1/v2:\n  - ${lech.join("\n  - ")}`).toEqual([]);
    });
  }

  it("`GIAM_DOC` không có trong enum v1 ⇒ ở local chỉ SUPER_ADMIN kích hoạt được (đã ghi ở §1.3)", () => {
    expect([...PERMISSIONS["commission_policies:activate"]]).toEqual(["SUPER_ADMIN"]);
  });
});

describe("[NHH-SEC-03] key gác trang GLOBAL, menu ≡ gate", () => {
  const GATE_NGUON_HOA_HONG = {
    "/nguon-hoa-hong/nguon": ["sources:view"],
    "/nguon-hoa-hong/chinh-sach": ["commission_policies:view"],
    "/nguon-hoa-hong/so": ["commission:view-self", "commission:view-center"],
    "/nguon-hoa-hong/ky": ["commission:view-center", "commission_periods:manage"],
    "/nguon-hoa-hong/khieu-nai": [
      "commission:view-self",
      "commission:view-center",
      "commission_disputes:review",
    ],
  } as const;

  it("5 route tab khai đúng gate của 05 §1.5", () => {
    for (const [href, gate] of Object.entries(GATE_NGUON_HOA_HONG)) {
      const that = (PAGE_GATES as Record<string, readonly string[]>)[href];
      expect(that, `PAGE_GATES thiếu ${href}`).toBeDefined();
      expect([...that].sort(), href).toEqual([...gate].sort());
    }
  });

  it("route gốc `/nguon-hoa-hong` = HỢP mọi key của năm tab", () => {
    const hop = new Set<string>(Object.values(GATE_NGUON_HOA_HONG).flat());
    const goc = (PAGE_GATES as Record<string, readonly string[]>)["/nguon-hoa-hong"];
    expect(goc, "PAGE_GATES thiếu /nguon-hoa-hong").toBeDefined();
    expect([...goc].sort()).toEqual([...hop].sort());
  });

  it("mọi key trong gate của module là GLOBAL ở MỌI RoleDef giữ nó (gate gọi trần, không target)", () => {
    const duoc = new Set<string>(
      Object.entries(PAGE_GATES)
        .filter(([h]) => h.startsWith("/nguon-hoa-hong"))
        .flatMap(([, g]) => [...g]),
    );
    expect(duoc.size).toBeGreaterThan(0);
    const viPham = ROLE_SEED.flatMap((r) =>
      r.perms.filter((p) => duoc.has(p.action) && p.scopeType !== "GLOBAL").map((p) => `${r.code}·${p.action}=${p.scopeType}`),
    );
    expect(viPham).toEqual([]);
  });

  it("đối chứng dương theo vai: Sale vào được tab Sổ, Marketing vào được tab Nguồn, PARENT không vào tab nào", () => {
    const vao = (code: string, href: keyof typeof GATE_NGUON_HOA_HONG) =>
      GATE_NGUON_HOA_HONG[href].some((a) => giu(code).includes(a));
    expect(vao("CENTER_SALES_CSM", "/nguon-hoa-hong/so")).toBe(true);
    expect(vao("CENTER_SALES_CSM", "/nguon-hoa-hong/nguon")).toBe(false);
    expect(vao("HO_MARKETING", "/nguon-hoa-hong/nguon")).toBe(true);
    for (const href of Object.keys(GATE_NGUON_HOA_HONG) as (keyof typeof GATE_NGUON_HOA_HONG)[]) {
      expect(vao("PARENT", href), `PARENT vào ${href}`).toBe(false);
    }
  });
});
