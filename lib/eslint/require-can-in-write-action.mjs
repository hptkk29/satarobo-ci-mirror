// TS-03 tầng (b) — no-inline-authz: Server Action GHI dữ liệu phải kiểm quyền
// qua can()/assertCan() (lib/permissions/can) hoặc helper check*/assert*Permission
// hiện hành. Plugin local cho flat config (eslint.config.mjs đăng ký dưới tên `authz`).
//
// Heuristic AST trên thân function (vá 09/08 — bỏ text-match vì comment chứa
// "can (" từng TẮT rule im lặng): duyệt CallExpression trong body — exported async
// function có lời gọi ghi `.create(`/`.update(`/`.delete(`/`.upsert(`/`.createMany(`/
// `.updateMany(`/`.deleteMany(` (member call, kể cả computed literal `x["delete"]`)
// mà body KHÔNG có call `can(`/`assertCan(`/`checkPermission(`/`assertPermission(`/
// `checkAnyPermission(`/`assertAnyPermission(` (callee Identifier hoặc member) →
// report tại TÊN function. Bắt cả `export { fn }` / `export default fn` (resolve
// tên local về function ở module scope).
//
// Wrapper cục bộ MỘT CẤP (trả nợ NỢ 3, 09/08): thân action gọi identifier là function
// khai báo NGAY trong file (FunctionDeclaration / const fn = arrow|function ở module
// scope, kể cả dưới export) mà THÂN wrapper đó chứa call kiểm quyền trực tiếp
// (danh sách CHECK_NAMES) → coi là đã kiểm quyền. Giới hạn CỨNG ghi nhận chủ đích:
//   - KHÔNG xuyên import từ file khác (ngoài tầm AST 1 file) — wrapper import vẫn report;
//   - KHÔNG đệ quy sâu hơn 1 cấp (wrapper gọi wrapper khác không tính) — thân wrapper
//     chỉ được quét tìm call check TRỰC TIẾP, không resolve tiếp identifier.
//
// Giới hạn biết trước (GIỮ CHỦ ĐÍCH — ưu tiên giảm false-negative): mọi member call
// `.delete(`/`.create(`... đều tính là GHI, kể cả không phải Prisma (vd `map.delete(key)`,
// `formData.delete("x")`, `set.add` thì không nhưng `searchParams.delete` thì có) —
// action đụng mấy API đó mà không ghi DB → eslint-disable-next-line kèm lý do, hoặc
// grandfather ở lib/eslint/inline-authz-allowlist.mjs (trả nợ dần, cấm thêm file mới).

const WRITE_METHODS = new Set([
  "create",
  "update",
  "delete",
  "upsert",
  "createMany",
  "updateMany",
  "deleteMany",
]);
const CHECK_NAMES = new Set([
  "can",
  "assertCan",
  "checkPermission",
  "assertPermission",
  "checkAnyPermission",
  "assertAnyPermission",
]);

/**
 * Tên method của member call: `obj.foo(...)` → "foo", `obj["foo"](...)` → "foo".
 * @param {import('estree').Expression | import('estree').Super} callee
 * @returns {string | null}
 */
function memberCallName(callee) {
  if (callee.type !== "MemberExpression") return null;
  if (!callee.computed && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  if (
    callee.computed &&
    callee.property.type === "Literal" &&
    typeof callee.property.value === "string"
  ) {
    return callee.property.value;
  }
  return null;
}

/**
 * Duyệt AST (không qua text nên comment KHÔNG ảnh hưởng) tìm call GHI + call KIỂM QUYỀN.
 * Kèm danh sách identifier được GỌI (`foo()`) để tầng trên resolve wrapper một cấp.
 * @param {object} root — node body của function
 * @returns {{ hasWrite: boolean, hasCheck: boolean, calledIdents: Set<string> }}
 */
function scanCalls(root) {
  let hasWrite = false;
  let hasCheck = false;
  /** @type {Set<string>} */
  const calledIdents = new Set();
  /** @type {unknown[]} */
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (typeof (/** @type {{type?: unknown}} */ (node).type) !== "string") continue;
    const n = /** @type {import('estree').Node & Record<string, unknown>} */ (node);
    if (n.type === "CallExpression") {
      const callee = /** @type {import('estree').CallExpression} */ (n).callee;
      const member = memberCallName(callee);
      if (member !== null) {
        if (WRITE_METHODS.has(member)) hasWrite = true;
        if (CHECK_NAMES.has(member)) hasCheck = true;
      } else if (callee.type === "Identifier") {
        if (CHECK_NAMES.has(callee.name)) hasCheck = true;
        else calledIdents.add(callee.name);
      }
      // Early-return CHỈ khi đã check — calledIdents dở dang lúc đó không sao vì
      // wrapper chỉ cần xét khi hasCheck=false (khi đó đã duyệt hết cây).
      if (hasWrite && hasCheck) return { hasWrite, hasCheck, calledIdents };
    }
    for (const key of Object.keys(n)) {
      if (key === "parent") continue; // ESLint gắn parent ngược lên — đừng đi vòng
      const value = n[key];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return { hasWrite, hasCheck, calledIdents };
}

/** @type {import('eslint').Rule.RuleModule} */
const requireCanInWriteAction = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Server Action ghi dữ liệu phải gọi can()/assertCan() — no-inline-authz tầng (b), TS-03/US-02 AC5",
    },
    schema: [],
    messages: {
      missingCan:
        '❌ no-inline-authz (TS-03): Server Action "{{name}}" có lời gọi GHI dữ liệu ' +
        "(.create/.update/.delete/.upsert/...) nhưng thân function không thấy can()/assertCan() " +
        "(lib/permissions/can) hay checkPermission()/assertPermission() — kể cả qua wrapper " +
        "cục bộ MỘT CẤP trong cùng file (wrapper import từ file khác KHÔNG được nhận). " +
        "Mọi action ghi PHẢI " +
        "kiểm quyền qua can(actor, permissionKey, target). Trường hợp đặc biệt (self-service " +
        "đã gate bằng session...) → eslint-disable-next-line kèm lý do.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    // 1 function có thể được export qua nhiều đường (`export { f as g }` + `export default f`)
    // → chỉ check + report 1 lần.
    const checked = new Set();

    /**
     * @param {import('estree').Node & { async?: boolean, body?: import('estree').Node }} fnNode
     * @param {import('estree').Node} reportNode — nút mang TÊN function (report tại đây)
     * @param {string} name
     */
    function checkFunction(fnNode, reportNode, name) {
      // Server Action luôn async — function sync không phải action, bỏ qua.
      if (!fnNode.async || !fnNode.body) return;
      if (checked.has(fnNode)) return;
      checked.add(fnNode);
      const { hasWrite, hasCheck, calledIdents } = scanCalls(fnNode.body);
      if (!hasWrite || hasCheck) return;
      // Wrapper cục bộ MỘT CẤP (xem header): identifier được gọi resolve về function
      // module scope CÙNG FILE — thân wrapper có call check TRỰC TIẾP là đủ.
      // Không đệ quy tiếp (scanCalls trên wrapper không resolve identifier lần nữa).
      for (const ident of calledIdents) {
        const wrapper = resolveModuleLevelFunction(ident);
        if (wrapper && wrapper.fn.body && scanCalls(wrapper.fn.body).hasCheck) return;
      }
      context.report({ node: reportNode, messageId: "missingCan", data: { name } });
    }

    /**
     * Resolve tên local (từ `export { fn }` / `export default fn`) về function
     * khai báo ở module scope: FunctionDeclaration hoặc const fn = async () => {}.
     * @param {string} name
     */
    function resolveModuleLevelFunction(name) {
      for (const stmt of sourceCode.ast.body) {
        // `export async function f() {}` rồi `export { f as g }` — nhìn xuyên wrapper export.
        const target =
          stmt.type === "ExportNamedDeclaration" && stmt.declaration
            ? stmt.declaration
            : stmt;
        if (target.type === "FunctionDeclaration" && target.id && target.id.name === name) {
          return { fn: target, report: target.id, name };
        }
        if (target.type === "VariableDeclaration") {
          for (const d of target.declarations) {
            if (
              d.id.type === "Identifier" &&
              d.id.name === name &&
              d.init &&
              (d.init.type === "ArrowFunctionExpression" ||
                d.init.type === "FunctionExpression")
            ) {
              return { fn: d.init, report: d.id, name };
            }
          }
        }
      }
      return null;
    }

    /** @param {import('estree').Node | null} decl */
    function visitExported(decl) {
      if (!decl) return;
      if (decl.type === "FunctionDeclaration") {
        checkFunction(decl, decl.id ?? decl, decl.id ? decl.id.name : "(default)");
      } else if (decl.type === "VariableDeclaration") {
        // export const fooAction = async (...) => {...}
        for (const d of decl.declarations) {
          const init = d.init;
          if (
            init &&
            (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
          ) {
            checkFunction(init, d.id, d.id.type === "Identifier" ? d.id.name : "(anonymous)");
          }
        }
      } else if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        // export default async () => {...}
        checkFunction(decl, decl, "(default)");
      } else if (decl.type === "Identifier") {
        // export default fooAction — resolve về khai báo module scope.
        const resolved = resolveModuleLevelFunction(decl.name);
        if (resolved) checkFunction(resolved.fn, resolved.report, resolved.name);
      }
    }

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          visitExported(node.declaration);
          return;
        }
        // `export { fn, other as alias }` — declaration=null, đi qua specifiers.
        // `export { x } from "./y"` (có source) là re-export module khác — không resolve được.
        if (node.source) return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ExportSpecifier" || spec.local.type !== "Identifier") continue;
          const resolved = resolveModuleLevelFunction(spec.local.name);
          if (resolved) checkFunction(resolved.fn, resolved.report, resolved.name);
        }
      },
      ExportDefaultDeclaration(node) {
        visitExported(node.declaration);
      },
    };
  },
};

export default {
  rules: {
    "require-can-in-write-action": requireCanInWriteAction,
  },
};
