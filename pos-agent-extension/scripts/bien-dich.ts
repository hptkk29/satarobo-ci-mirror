/**
 * Biên dịch TypeScript của extension ⇒ JavaScript cho Chrome, bằng `typescript` có sẵn trong repo
 * (không thêm phụ thuộc). Dùng CHUNG cho script đóng gói và cho test — test chạy đúng thứ được gói.
 *
 *   · "module" — service worker (`type: module`), trang options, `lib/*`: giữ `import "./x.js"`.
 *   · "script" — content script: Chrome KHÔNG nạp content script dạng module ⇒ đầu ra phải là
 *     SCRIPT CỔ ĐIỂN. Kiểm bằng `vm.Script` (cú pháp module như `export {}` ⇒ ném ngay lúc đóng gói).
 */
import ts from "typescript";
import vm from "node:vm";

export function bienDichTs(maNguon: string, tenTep: string, kieu: "module" | "script"): string {
  const ra = ts.transpileModule(maNguon, {
    fileName: tenTep,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      removeComments: false,
      sourceMap: false,
    },
  });
  const loi = (ra.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  if (loi.length > 0) throw new Error(`${tenTep}: ${loi.join("; ")}`);
  if (kieu === "script") {
    try {
      new vm.Script(ra.outputText, { filename: tenTep });
    } catch (e) {
      throw new Error(`${tenTep}: content script phải là script cổ điển (không import/export) — ${String(e)}`, {
        cause: e,
      });
    }
  }
  return ra.outputText;
}
