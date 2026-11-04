#!/usr/bin/env node
// CANARY — secret có lọt vào bundle client không?
//
// docs/chat-realtime/variables.md liệt đây là cổng BẮT BUỘC trước go-live, nhưng tới
// 09/08/2026 chưa có bước nào thực thi. Chốt chặn duy nhất khi đó là `import "server-only"`
// ở các file server (broadcast.ts / chat-storage.ts …): nó bắt được lỗi import từ Client
// Component, nhưng KHÔNG bắt được người vô tình đặt secret vào biến `NEXT_PUBLIC_*` hay dán
// thẳng chuỗi khoá vào code chạy ở trình duyệt.
//
// Hậu quả nếu lọt: ai mở trang web cũng đọc/ghi được toàn bộ DB, bỏ qua sạch RLS. Không có
// đường sửa êm — phải xoay key, redeploy, rồi rà log xem đã bị dùng chưa.
//
// ⚠️ 28/09/2026: chat realtime Supabase đã GỠ (không còn `@supabase/supabase-js`, không còn
// khoá Supabase nào trong app). Canary giữ lại vì rẻ và vẫn bắt được mọi JWT `service_role` /
// khoá `sb_secret_` lỡ lọt vào bundle (project Supabase cũ còn tồn tại tới khi bị huỷ).
//
// ── VÌ SAO KHÔNG DÙNG `grep -r 'service_role'` ─────────────────────────────────────────
// Đã thử và nó ĐỎ NGAY trên bản build sạch: `@supabase/supabase-js` (hồi còn dùng) có sẵn dòng
// `e.startsWith("sb_publishable_") || e.startsWith("sb_secret_")` để tự nhận dạng định dạng
// khoá. Một canary kêu oan ngay lần đầu là canary sẽ bị tắt trong tuần đầu tiên.
//
// Ngược lại, khoá service role ĐỜI CŨ là một JWT — chuỗi "service_role" nằm trong phần
// payload đã base64url, nên grep chữ thường KHÔNG BAO GIỜ thấy nó. Tức là cách grep thô vừa
// kêu oan vừa bỏ lọt đúng thứ nguy hiểm nhất.
//
// Nên ở đây dò theo HÌNH DẠNG KHOÁ THẬT:
//   1. Khoá đời mới: `sb_secret_` + ít nhất 20 ký tự khoá (chuỗi trần trong code thư viện
//      không kèm phần thân nên không dính).
//   2. Khoá đời cũ: mọi JWT trong bundle đều được GIẢI MÃ payload rồi soi `role`. `anon` là
//      hợp lệ và phải có trong bundle; `service_role` là sự cố.
//
// ⚠️ TÊN FILE: đừng đổi thành `...-secret...` — `.gitignore:60` có luật `*-secret*` (chặn
// commit nhầm file khoá) và nó sẽ nuốt luôn file này, CI đỏ vì "không tìm thấy script".
//
// Chạy tay: node scripts/canary-client-bundle-keys.mjs [thư mục]  (mặc định .next/static)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".next/static";

/** Khoá đời mới: `sb_secret_` phải KÈM phần thân, nếu không chỉ là tiền tố trong code thư viện. */
const NEW_SECRET_RE = /sb_secret_[A-Za-z0-9_-]{20,}/g;
/** JWT: header.payload.signature — chỉ cần bắt được payload để giải mã. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{16,})\.[A-Za-z0-9_-]{8,}/g;

/** Vai bị cấm xuất hiện trong bundle client. `anon` hợp lệ — nó vốn để dùng ở trình duyệt. */
const FORBIDDEN_ROLES = new Set(["service_role"]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|cjs|json|txt|map)$/.test(name)) out.push(p);
  }
  return out;
}

function decodeJwtPayload(segment) {
  try {
    const json = Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null; // Không phải JWT thật — chuỗi ngẫu nhiên trông giống. Bỏ qua.
  }
}

const files = walk(root);
if (files.length === 0) {
  console.error(`CANARY LỖI: không đọc được file nào trong "${root}" — chạy \`pnpm build\` trước đã.`);
  console.error("Thoát với mã lỗi thay vì báo OK: một canary im lặng vì không có gì để soi là canary vô dụng.");
  process.exit(2);
}

const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");

  for (const m of text.matchAll(NEW_SECRET_RE)) {
    findings.push({ file, loai: "khoá bí mật đời mới (sb_secret_…)", chiTiet: `${m[0].slice(0, 14)}… (đã che)` });
  }

  for (const m of text.matchAll(JWT_RE)) {
    const payload = decodeJwtPayload(m[1]);
    if (!payload || typeof payload !== "object") continue;
    const role = typeof payload.role === "string" ? payload.role : null;
    if (role && FORBIDDEN_ROLES.has(role)) {
      findings.push({ file, loai: `JWT có role="${role}"`, chiTiet: `iss=${payload.iss ?? "?"} ref=${payload.ref ?? "?"}` });
    }
  }
}

if (findings.length > 0) {
  console.error(`\n⛔ SECRET LỌT BUNDLE CLIENT — ${findings.length} phát hiện trong "${root}":\n`);
  for (const f of findings) console.error(`  ${f.file}\n    ${f.loai} — ${f.chiTiet}`);
  console.error(
    "\nViệc phải làm NGAY, theo thứ tự: xoay khoá ở nơi phát hành → build + deploy lại → rà log xem" +
      "\nkhoá cũ đã bị dùng chưa. Sửa code rồi build lại là CHƯA đủ: khoá đã phát ra internet.\n",
  );
  process.exit(1);
}

console.log(`OK — soi ${files.length} file trong "${root}", không có khoá service role nào lọt.`);
