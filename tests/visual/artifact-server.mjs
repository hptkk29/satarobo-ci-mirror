// Máy chủ tĩnh phục vụ các trang artifact (*.dc.html) của public site để so pixel với bản Next.js.
//
//   node tests/visual/artifact-server.mjs [--port 4800]
//   -> http://localhost:4800/Main , /KhoaHoc-sata3 , /Disc-LamBai?manHinh=banNhap ...
//
// Cách hoạt động: trang .dc.html tải `./support.js` = BỘ RUNTIME THẬT của canvas Design (dc-runtime.js, đã gồm
// React 18) → nó tự dựng `<x-dc>`, `sc-if`, `sc-for`, `DCLogic`. Server chỉ cần:
//   · /support.js              -> tests/visual/vendor/dc-runtime.js
//   · /_blob/<id>              -> ảnh (public/pub, rồi các thư mục đệm) / script (artifact-src/scripts) theo ASSET-MAP
//   · /__cdn/react*.js         -> React 18.3.1 UMD (tải 1 lần từ jsdelivr, lưu .cache/)
//   · /__gf/* , /__gs/*        -> Google Fonts (CSS + woff2) lưu .cache/ ⇒ chạy offline được sau lần đầu
// Hai thứ KHÔNG có trong bản nguồn và bị thay bằng đoạn rỗng (ghi log): three.js / glb base64 / texture 3D
// (`--3d` không dùng được; so-sanh.mjs luôn đặt window.__sataLite = true để cả hai bên chỉ hiện poster).
/* global fetch, URL */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CACHE = path.join(HERE, ".cache");

// ---------- Cấu hình nguồn ----------
const ART_CANDIDATES = [
  process.env.ART_SRC,
  "E:/WebSataRobo/giaodien_v2/giaodien-artifact-src/artifact-src",
].filter(Boolean);
export function artDir() {
  for (const d of ART_CANDIDATES) if (fs.existsSync(path.join(d, "pages"))) return d;
  throw new Error("Không thấy artifact-src. Đặt biến ART_SRC=<thư mục chứa pages/ + scripts/ + ASSET-MAP.txt>.");
}
const RUNTIME_CANDIDATES = [process.env.DC_RUNTIME, path.join(HERE, "vendor", "dc-runtime.js")].filter(Boolean);
function runtimePath() {
  for (const f of RUNTIME_CANDIDATES) if (fs.existsSync(f)) return f;
  throw new Error("Thiếu tests/visual/vendor/dc-runtime.js (runtime canvas Design). Xem tests/visual/README.md.");
}
// Thư mục tìm ảnh theo id, theo thứ tự ưu tiên. Thêm bằng PUB_ASSET_DIRS="dir1;dir2".
const ASSET_DIRS = [
  path.join(REPO, "public", "pub"),
  ...(process.env.PUB_ASSET_DIRS ? process.env.PUB_ASSET_DIRS.split(";") : []),
  // đệm của các phiên làm việc trước (chỉ có khi biến SP trỏ vào thư mục tạm của phiên)
  ...(process.env.SP ? [path.join(process.env.SP, "pub-assets"), path.join(process.env.SP, "pub2-art", "assets")] : []),
].filter(Boolean);

// ---------- ASSET-MAP + chỉ mục tệp ----------
let assetMap = null;
function loadAssetMap() {
  if (assetMap) return assetMap;
  assetMap = new Map();
  const f = path.join(artDir(), "ASSET-MAP.txt");
  if (fs.existsSync(f)) {
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      const p = l.split("|");
      if (p.length >= 2 && /^[0-9a-f]{32}$/.test(p[0].trim())) assetMap.set(p[0].trim(), p[1].trim());
    }
  }
  return assetMap;
}
const SCRIPT_BY_DESC = [
  [/scripts\/fx\.js/, "fx.js"],
  [/scripts\/viewer2\.js/, "viewer2.js"],
  [/scripts\/spacelab\.js/, "spacelab.js"],
];
let fileIndex = null;
function indexFiles() {
  if (fileIndex) return fileIndex;
  fileIndex = new Map();
  for (const d of ASSET_DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      try {
        if (!fs.statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      const id = path.parse(f).name;
      if (!fileIndex.has(id)) fileIndex.set(id, full);
    }
  }
  return fileIndex;
}

function sniff(buf) {
  if (buf.length > 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  const head = buf.slice(0, 200).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}
const EXT_TYPE = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".glb": "model/gltf-binary" };

// 1x1 PNG trong suốt cho ảnh thiếu (không làm vỡ bố cục; thiếu thật thì ghi log).
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const missingLog = new Set();

function serveBlob(id, res) {
  const map = loadAssetMap();
  const desc = map.get(id) || "";
  // 1) script có tệp thật trong artifact-src/scripts
  for (const [re, file] of SCRIPT_BY_DESC) {
    if (re.test(desc)) {
      const f = path.join(artDir(), "scripts", file);
      res.writeHead(200, { "content-type": EXT_TYPE[".js"], "cache-control": "no-store" });
      return res.end(fs.readFileSync(f));
    }
  }
  // 2) ảnh/tệp đã chép
  const found = indexFiles().get(id);
  if (found) {
    const buf = fs.readFileSync(found);
    const ext = path.extname(found).toLowerCase();
    res.writeHead(200, { "content-type": EXT_TYPE[ext] || sniff(buf), "cache-control": "public, max-age=3600" });
    return res.end(buf);
  }
  // 3) script 3D không có trong bản nguồn (three.js, glb base64, ...): đoạn rỗng
  const isJs = /three\.js|\[script\]|mô hình|\[khác\]/i.test(desc);
  if (!missingLog.has(id)) {
    missingLog.add(id);
    console.log(`[artifact-server] THIẾU /_blob/${id} (${desc.slice(0, 60) || "không có trong ASSET-MAP"}) -> ${isJs ? "JS rỗng" : "ảnh 1x1"}`);
  }
  if (isJs) {
    res.writeHead(200, { "content-type": EXT_TYPE[".js"], "cache-control": "no-store" });
    return res.end("/* thiếu trong bản nguồn: harness trả đoạn rỗng */");
  }
  res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "x-harness-missing": "1" });
  res.end(PIXEL);
}

// ---------- Proxy có đệm đĩa: React UMD + Google Fonts ----------
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
async function cached(key, url, ua) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, crypto.createHash("sha1").update(key).digest("hex") + ".bin");
  const meta = f + ".json";
  if (fs.existsSync(f) && fs.existsSync(meta)) return { buf: fs.readFileSync(f), type: JSON.parse(fs.readFileSync(meta, "utf8")).type };
  const r = await fetch(url, { headers: ua ? { "user-agent": ua } : {} });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get("content-type") || "application/octet-stream";
  fs.writeFileSync(f, buf);
  fs.writeFileSync(meta, JSON.stringify({ type }));
  return { buf, type };
}
const REACT = {
  "/__cdn/react.js": "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
  "/__cdn/react-dom.js": "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
};
// khoá runtime dùng để tra `window.__resources` (đúng URL CDN nó muốn tải)
const RESOURCES = { [REACT["/__cdn/react.js"]]: "/__cdn/react.js", [REACT["/__cdn/react-dom.js"]]: "/__cdn/react-dom.js" };

// ---------- Biến đổi HTML trang ----------
function pageFile(name) {
  const f = path.join(artDir(), "pages", name + ".dc.html");
  return fs.existsSync(f) ? f : null;
}
export function listPages() {
  return fs.readdirSync(path.join(artDir(), "pages")).filter((f) => f.endsWith(".dc.html")).map((f) => f.replace(/\.dc\.html$/, ""));
}
function transformHtml(html) {
  // Google Fonts qua proxy cục bộ (ổn định, chạy offline được)
  html = html.replace(/https:\/\/fonts\.googleapis\.com\//g, "/__gf/");
  // React UMD + runtime: khai trước support.js để nó KHÔNG tải CDN
  const inject = `<script>window.__resources=${JSON.stringify(RESOURCES)};</script>`;
  html = html.replace(/<script src="\.\/support\.js"><\/script>/, inject + '<script src="/support.js"></script>');
  return html;
}

export function startArtifactServer({ port = 4800, quiet = false } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      const p = decodeURIComponent(u.pathname);
      if (p === "/support.js") {
        res.writeHead(200, { "content-type": EXT_TYPE[".js"], "cache-control": "no-store" });
        return res.end(fs.readFileSync(runtimePath()));
      }
      if (REACT[p]) {
        const { buf } = await cached(p, REACT[p]);
        res.writeHead(200, { "content-type": EXT_TYPE[".js"], "cache-control": "public, max-age=86400" });
        return res.end(buf);
      }
      if (p.startsWith("/__gf/")) {
        const { buf } = await cached("gf" + u.pathname + u.search, "https://fonts.googleapis.com/" + p.slice(6) + u.search, CHROME_UA);
        const css = buf.toString("utf8").replace(/https:\/\/fonts\.gstatic\.com\//g, "/__gs/");
        res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" });
        return res.end(css);
      }
      if (p.startsWith("/__gs/")) {
        const { buf, type } = await cached("gs" + u.pathname, "https://fonts.gstatic.com/" + p.slice(6), CHROME_UA);
        res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" });
        return res.end(buf);
      }
      const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(p);
      if (blob) return serveBlob(blob[1], res);
      if (p === "/" || p === "/index.html") {
        const items = listPages().map((n) => `<li><a href="/${n}.dc.html">${n}</a></li>`).join("");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><meta charset=utf-8><title>Artifact Sata Robo</title><ul>${items}</ul>`);
      }
      // /Main , /Main.dc.html , /pages/Main.dc.html
      const m = /^\/(?:pages\/)?([A-Za-z0-9_-]+?)(\.dc\.html)?$/.exec(p);
      if (m) {
        const f = pageFile(m[1]);
        if (f) {
          if (!m[2]) {
            res.writeHead(302, { location: `/${m[1]}.dc.html${u.search}` });
            return res.end();
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          return res.end(transformHtml(fs.readFileSync(f, "utf8")));
        }
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 " + p);
    } catch (e) {
      console.log("[artifact-server] LỖI", req.url, String(e).slice(0, 200));
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      if (!quiet) console.log(`[artifact-server] http://localhost:${port}/  (artifact-src: ${artDir()})`);
      resolve({ server, port, url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  startArtifactServer({ port: i > 0 ? Number(process.argv[i + 1]) : 4800 }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
