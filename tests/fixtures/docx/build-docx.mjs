// tests/fixtures/docx/build-docx.mjs — R7-13
// Tạo file .docx HỢP LỆ bằng Node thuần (KHÔNG cần jszip/dependency): viết ZIP
// store-only (method 0) với CRC32 tự tính. Dùng sinh:
//   - (đã bỏ) file mẫu tải về nay là bản v2 soạn tay: public/templates/mau-de-thi-word-v2.docx
//   - tests/fixtures/docx/chuan-2-cau.docx          (fixture e2e — không ảnh)
//
// Chạy: `node tests/fixtures/docx/build-docx.mjs` (an toàn — chỉ ghi file local).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

// ── CRC32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── ZIP store-only ─────────────────────────────────────────────────────────
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameBuf, dataBuf]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += locals[locals.length - 1].length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBlob.length, 12);
  end.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, end]);
}

// ── OOXML scaffolding ───────────────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function para(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
function document(lines) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${lines.map(para).join("\n")}
</w:body>
</w:document>`;
}

function makeDocx(lines) {
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: document(lines) },
  ]);
}

// ── Nội dung mẫu (field-template — KHÔNG đổi tên field) ──────────────────────
const TEMPLATE_LINES = [
  "HƯỚNG DẪN: Mỗi câu bắt đầu bằng QUESTION_CODE. KHÔNG đổi tên field.",
  "QUESTION_TYPE nhận: SINGLE | MULTI | TRUE_FALSE.",
  "Ảnh: chèn ảnh NHÚNG (không dùng link internet) ngay dưới dòng QUESTION_IMAGE hoặc OPTION_x_IMAGE.",
  "",
  "QUESTION_CODE: R7-13-Q1",
  "QUESTION_TYPE: SINGLE",
  "QUESTION_TEXT: 2 + 3 = ?",
  "OPTION_A: 4",
  "OPTION_B: 5",
  "OPTION_C: 6",
  "OPTION_D: 7",
  "CORRECT_ANSWER: B",
  "SCORE: 1",
  "EXPLANATION: 2 cộng 3 bằng 5.",
  "TAGS: toan, cong",
  "",
  "QUESTION_CODE: R7-13-Q2",
  "QUESTION_TYPE: TRUE_FALSE",
  "QUESTION_TEXT: Robot có thể lập trình được.",
  "OPTION_A: Đúng",
  "OPTION_B: Sai",
  "CORRECT_ANSWER: A",
  "SCORE: 1",
  "TAGS: robot",
];

const FIXTURE_2_LINES = TEMPLATE_LINES;

// Template cong khai da chuyen sang ban v2 soan tay: public/templates/mau-de-thi-word-v2.docx
// (script nay CHI con build fixture test — dung ghi de file mau v2).
const outputs = [
  { rel: "tests/fixtures/docx/chuan-2-cau.docx", lines: FIXTURE_2_LINES },
];

for (const o of outputs) {
  const full = resolve(repoRoot, o.rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, makeDocx(o.lines));
  console.log("wrote", o.rel);
}
