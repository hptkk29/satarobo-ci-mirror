// @vitest-environment node
// [AUTH-8FPG] Lưới chặn TÁI PHÁT cho GHSA-8fpg-xm3f-6cx3 — xem đầu `quet-auth-truthy.ts`. Hai phần:
//   (1) hàm quét chạy trên chuỗi GIẢ: ca nguy hiểm PHẢI bị bắt, ca an toàn KHÔNG được bị bắt (đối chứng cả hai phía — lưới chưa cấy thử là lưới chưa chứng minh, CLAUDE.md luật 14);
//   (2) quét toàn bộ cây mã nguồn thật: số chỗ gọi `auth()` có phép thử «có đối tượng phiên» trần = 0.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { timAuthTruthy } from "./quet-auth-truthy";

describe("[AUTH-8FPG-01] hàm quét — ca NGUY HIỂM phải bị bắt", () => {
  const NGUY_HIEM: [string, string][] = [
    ["!session rồi dùng ?.user?. (đúng mẫu advisory)", `const session = await auth();\nif (!session) return null;\nreturn session?.user?.id;`],
    ["if (session) coi là đã đăng nhập", `const session = await auth();\nif (session) { cho(); }`],
    ["!!session", `const session = await auth();\nconst ok = !!session;\nreturn ok;`],
    ["session ? … : …", `const s = await auth();\nconst vai = s ? "nhan-vien" : "khach";`],
    ["session && …", `const s = await auth();\nconst cho = s && quyen(s);`],
    ["=== null", `const s = await auth();\nif (s === null) return;\nlam(s?.user?.id);`],
    ["điều kiện nhiều dòng chỉ !session", `const session = await auth();\nif (\n  !session\n) {\n  return;\n}\nlam(session?.user?.id);`],
    ["không dùng await", `const session = auth();\nif (!session) return;\nlam(session?.user?.id);`],
  ];
  for (const [ten, ma] of NGUY_HIEM) {
    it(ten, () => expect(timAuthTruthy(ma).length, ma).toBe(1));
  }
});

describe("[AUTH-8FPG-02] hàm quét — ca AN TOÀN không bị bắt (không báo động giả làm người ta tắt lưới)", () => {
  const AN_TOAN: [string, string][] = [
    ["session?.user", `const session = await auth();\nif (!session?.user) return null;`],
    ["session?.user?.id", `const session = await auth();\nif (!session?.user?.id) return null;`],
    ["!session || !session.user (cùng điều kiện đòi .user)", `const session = await auth();\nif (!session || !session.user) return null;`],
    ["điều kiện nhiều dòng có .user", `const session = await auth();\nif (\n  !session ||\n  !session.user\n) {\n  return;\n}`],
    ["!session rồi truy cập CỨNG session.user.id (object lỗi ⇒ TypeError, đóng cửa)", `const session = await auth();\nif (!session) redirect("/login");\nconst id = session.user.id;`],
    ["!!session?.user", `const session = await auth();\nconst ok = !!session?.user;`],
    ["không thử trần gì cả (chỉ lấy thuộc tính)", `const session = await auth();\nconst id = session?.user?.id;`],
    ["requireLiveSession (trả null trừ khi có session?.user?.id)", `const session = await requireLiveSession();\nif (!session) return null;`],
    ["chú thích chứa mẫu nguy hiểm", `// const s = await auth(); if (!s) return;\nconst x = 1;`],
  ];
  for (const [ten, ma] of AN_TOAN) {
    it(ten, () => expect(timAuthTruthy(ma), ma).toEqual([]));
  }
});

describe("[AUTH-8FPG-03] cây mã nguồn thật", () => {
  const GOC = resolve(process.cwd());
  const THU_MUC = ["app", "lib", "components", "scripts"];
  const BO_QUA = new Set(["node_modules", ".next", ".git", "coverage", "dist"]);
  function tep(dir: string, ra: string[]): string[] {
    for (const ten of readdirSync(dir)) {
      if (BO_QUA.has(ten)) continue;
      const p = join(dir, ten);
      const st = statSync(p);
      if (st.isDirectory()) tep(p, ra);
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
    }
    return ra;
  }

  it("[AUTH-8FPG-03a] chống rỗng: quét đủ nhiều tệp và gặp đủ nhiều chỗ gọi `auth()` (lưới không xanh vì không quét gì)", () => {
    const tatCa = [...THU_MUC.flatMap((d) => tep(join(GOC, d), [])), join(GOC, "proxy.ts")];
    expect(tatCa.length).toBeGreaterThan(1500);
    const goi = tatCa.reduce((n, f) => n + (readFileSync(f, "utf8").match(/=\s*(?:await\s+)?auth\(\s*\)/g)?.length ?? 0), 0);
    expect(goi).toBeGreaterThan(200); // đo 29/10/2026: ~870 chỗ gọi auth()/requireLiveSession(); riêng `auth()` thô còn nhiều trăm
  });

  it("[AUTH-8FPG-03b] KHÔNG có chỗ nào kiểm `auth()` theo «có đối tượng phiên» trần (cho phép: cùng điều kiện đòi `.user`)", () => {
    const tatCa = [...THU_MUC.flatMap((d) => tep(join(GOC, d), [])), join(GOC, "proxy.ts")];
    const phatHien: string[] = [];
    for (const f of tatCa) {
      const ma = readFileSync(f, "utf8");
      for (const p of timAuthTruthy(ma)) phatHien.push(`${f.slice(GOC.length + 1).replace(/\\/g, "/")}:${p.dong} (${p.ten}) :: ${p.noiDung}`);
    }
    expect(phatHien, `Phát hiện kiểm auth() trần — sửa thành session?.user / session?.user?.id:\n${phatHien.join("\n")}`).toEqual([]);
  });
});
