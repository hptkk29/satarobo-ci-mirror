/**
 * scripts/_cho-phep-server-only.ts — cho `tsx` nhập được module có `import "server-only"`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CẦN
 *
 * `server-only` là package do **Next cấp lúc build**, KHÔNG có trong `node_modules`. Mọi
 * file `lib/lms/*` dùng nó để chặn chính mình lọt xuống client — đúng và nên giữ. Nhưng
 * script chạy dưới `tsx` thì chết `MODULE_NOT_FOUND` ngay ở dòng import đầu tiên.
 *
 * Trỏ nó về đúng stub mà vitest đang dùng (`tests/stubs/server-only.ts`, một no-op).
 *
 * ⚠️ CÁCH DÙNG — thứ tự QUAN TRỌNG:
 *
 *     import "./_cho-phep-server-only";                    // ← phải TRƯỚC
 *     const { completeSession } = await import("../lib/lms/session-lifecycle");
 *
 * `import` tĩnh bị HOIST lên đầu module, nên một `import { completeSession } from …` tĩnh
 * sẽ chạy TRƯỚC bản vá này và vẫn chết. Module nào cần `server-only` thì phải nhập ĐỘNG.
 *
 * Tách thành file dùng chung vì đây là lần thứ ba trong repo — hai lần trước chép tay ở
 * `scripts/_zztest-chat-*.ts`.
 */
import Module from "node:module";
import path from "node:path";

type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;
const loader = Module as unknown as { _resolveFilename: ResolveFn };
const original = loader._resolveFilename;
const stub = path.resolve(process.cwd(), "tests/stubs/server-only.ts");

loader._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (request === "server-only") return stub;
  return original.call(this, request, ...rest);
};
