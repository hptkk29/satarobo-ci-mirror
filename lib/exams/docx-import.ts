// lib/exams/docx-import.ts — R7-13 (PR2): parser .docx theo field-template.
//
// Đọc `word/document.xml` của file .docx (ZIP), tách block theo marker
// `QUESTION_CODE:`, parse field (QUESTION_CODE/TYPE/TEXT/IMAGE, OPTION_A..D[_IMAGE],
// CORRECT_ANSWER, SCORE, EXPLANATION?, TAGS?), trích ảnh nhúng từ `word/media/*` map
// qua relationship id. Ảnh đẩy R2 lúc XÁC NHẬN import — preview dùng data-url tạm.
//
// PHÂN TẦNG để test được KHÔNG cần jszip:
//   - parseDocumentXml(documentXml) / buildQuestions(paras)  → THUẦN (Vitest fixture XML).
//   - parseDocx(bytes)  → cần jszip (runtime), gói document.xml + rels + media.
//
// ⚠️ Dependency: `jszip` (CHƯA cài — xem báo cáo R7-13). Import ĐỘNG trong parseDocx
// để module vẫn load được (các hàm THUẦN + test XML chạy) khi jszip chưa cài.

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/** Loại câu hỏi trong template Word (field QUESTION_TYPE). */
export type DocxQuestionType = "SINGLE" | "MULTI" | "TRUE_FALSE";

/** Magic bytes ZIP local-file-header — .docx luôn bắt đầu bằng "PK\x03\x04". */
export const DOCX_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export interface ParsedMedia {
  rId: string;
  /** đuôi suy từ target (vd ".png"). */
  ext: string;
  mime: string;
  /** base64 KHÔNG có prefix "data:". */
  base64: string;
}

export interface ParsedOption {
  /** "A".."D" */
  key: string;
  text: string;
  /** relationship id của ảnh nhúng (chưa resolve sang R2). */
  imageRId: string | null;
}

export interface ParsedQuestion {
  questionCode: string;
  /** giá trị thô của QUESTION_TYPE (chưa map). */
  rawType: string;
  /** đã chuẩn hoá; null = không hợp lệ. */
  type: DocxQuestionType | null;
  text: string;
  questionImageRId: string | null;
  options: ParsedOption[];
  /** thô: "A" hoặc "A,C". */
  correctRaw: string;
  score: number | null;
  explanation: string | null;
  tags: string[];
  /** ảnh chèn bằng link internet (r:link) — SRS cấm → lỗi câu này. */
  hasExternalImage: boolean;
}

/** 1 paragraph (`<w:p>`) đã rút gọn — text + ảnh nhúng/ngoài. */
export interface RawPara {
  text: string;
  /** rId ảnh nhúng (r:embed). */
  embedRIds: string[];
  /** rId ảnh link ngoài (r:link) — đánh dấu lỗi. */
  linkRIds: string[];
}

export interface ParsedDocx {
  questions: ParsedQuestion[];
  /** ảnh theo rId (chỉ những rId thực sự được câu hỏi tham chiếu). */
  media: Record<string, ParsedMedia>;
}

export interface ValidatedQuestion extends ParsedQuestion {
  errors: string[];
  /** code đã tồn tại trong DB → import sẽ UPDATE (không phải lỗi). */
  dbExists: boolean;
  valid: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Magic bytes / mime
// ──────────────────────────────────────────────────────────────────────────

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** True nếu buffer bắt đầu bằng magic ZIP (PK\x03\x04). .doc cũ KHÔNG khớp. */
export function hasDocxMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return DOCX_MAGIC.every((b, i) => bytes[i] === b);
}

/** Throw nếu không phải .docx (sai mime hoặc magic bytes). */
export function assertDocx(filename: string, mime: string, bytes: Uint8Array): void {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
    throw new Error("File .doc (Word 97-2003) không được hỗ trợ. Lưu lại dạng .docx.");
  }
  if (!lower.endsWith(".docx")) {
    throw new Error("Chỉ chấp nhận file .docx.");
  }
  if (!hasDocxMagic(bytes)) {
    throw new Error("File không phải .docx hợp lệ (magic bytes sai — có thể là .doc đổi đuôi).");
  }
  // mime có thể rỗng từ một số browser — chỉ chặn khi rõ ràng sai.
  if (mime && mime !== DOCX_MIME && mime !== "application/zip" && !mime.includes("octet-stream")) {
    throw new Error(`MIME không hợp lệ cho .docx: ${mime}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// XML helpers (THUẦN — test được)
// ──────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Tách document.xml thành mảng paragraph. Giữ nguyên xuống dòng (`<w:br/>`),
 * tab, và gom text trong cùng `<w:p>`. Trích rId ảnh (r:embed / r:link).
 */
export function splitParagraphs(documentXml: string): RawPara[] {
  const paras: RawPara[] = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(documentXml)) !== null) {
    const inner = pm[1];
    // Text: nối các <w:t>, chèn \n cho <w:br/> và \t cho <w:tab/>.
    let text = "";
    const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(inner)) !== null) {
      if (tm[1] !== undefined) text += decodeXmlEntities(tm[1]);
      else if (tm[0].startsWith("<w:br")) text += "\n";
      else text += "\t";
    }
    const embedRIds: string[] = [];
    const linkRIds: string[] = [];
    const embedRe = /r:embed="([^"]+)"/g;
    let em: RegExpExecArray | null;
    while ((em = embedRe.exec(inner)) !== null) embedRIds.push(em[1]);
    const linkRe = /r:link="([^"]+)"/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(inner)) !== null) linkRIds.push(lm[1]);
    paras.push({ text, embedRIds, linkRIds });
  }
  return paras;
}

/** Parse word/_rels/document.xml.rels → { rId: { target, external } }. */
export function parseRels(
  relsXml: string,
): Record<string, { target: string; external: boolean }> {
  const out: Record<string, { target: string; external: boolean }> = {};
  const re = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    const mode = /TargetMode="([^"]+)"/.exec(tag)?.[1];
    if (id && target) {
      out[id] = { target, external: mode === "External" };
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Field parsing (THUẦN)
// ──────────────────────────────────────────────────────────────────────────

const FIELD_RE =
  /^(QUESTION_CODE|QUESTION_TYPE|QUESTION_TEXT|QUESTION_IMAGE|OPTION_([A-D])_IMAGE|OPTION_([A-D])|CORRECT_ANSWER|SCORE|EXPLANATION|TAGS)\s*[:：]\s*([\s\S]*)$/i;

function emptyQuestion(code: string): ParsedQuestion {
  return {
    questionCode: code,
    rawType: "",
    type: null,
    text: "",
    questionImageRId: null,
    options: [],
    correctRaw: "",
    score: null,
    explanation: null,
    tags: [],
    hasExternalImage: false,
  };
}

function ensureOption(q: ParsedQuestion, key: string): ParsedOption {
  let opt = q.options.find((o) => o.key === key);
  if (!opt) {
    opt = { key, text: "", imageRId: null };
    q.options.push(opt);
    q.options.sort((a, b) => a.key.localeCompare(b.key));
  }
  return opt;
}

export function normalizeType(raw: string): DocxQuestionType | null {
  const t = raw.trim().toUpperCase();
  if (t === "SINGLE" || t === "MULTI" || t === "TRUE_FALSE") return t;
  return null;
}

/**
 * Xây danh sách câu hỏi từ paragraphs. Marker `QUESTION_CODE` bắt đầu block mới.
 * Ảnh nhúng gán theo field hiện tại (OPTION_x → option image; còn lại → question image).
 */
export function buildQuestions(paras: RawPara[]): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  let cur: ParsedQuestion | null = null;
  // field hiện tại: 'QUESTION_TEXT' | 'OPTION_A' ... | 'EXPLANATION' | ...
  let field = "";
  let curOptionKey: string | null = null;

  const assignImage = (rId: string) => {
    if (!cur) return;
    if (curOptionKey) ensureOption(cur, curOptionKey).imageRId = rId;
    else cur.questionImageRId = rId;
  };

  for (const para of paras) {
    const line = para.text.trim();
    const m = line.match(FIELD_RE);

    if (m) {
      const keyRaw = m[1].toUpperCase();
      const optLetterImg = m[2]?.toUpperCase() ?? null; // OPTION_X_IMAGE
      const optLetter = m[3]?.toUpperCase() ?? null; // OPTION_X
      const value = (m[4] ?? "").trim();

      if (keyRaw === "QUESTION_CODE") {
        if (cur) questions.push(cur);
        cur = emptyQuestion(value);
        field = "QUESTION_CODE";
        curOptionKey = null;
      } else if (cur) {
        if (keyRaw === "QUESTION_TYPE") {
          cur.rawType = value;
          cur.type = normalizeType(value);
          field = "QUESTION_TYPE";
          curOptionKey = null;
        } else if (keyRaw === "QUESTION_TEXT") {
          cur.text = value;
          field = "QUESTION_TEXT";
          curOptionKey = null;
        } else if (keyRaw === "QUESTION_IMAGE") {
          field = "QUESTION_IMAGE";
          curOptionKey = null;
        } else if (optLetterImg) {
          curOptionKey = optLetterImg;
          ensureOption(cur, optLetterImg);
          field = "OPTION_IMAGE";
        } else if (optLetter) {
          curOptionKey = optLetter;
          ensureOption(cur, optLetter).text = value;
          field = "OPTION";
        } else if (keyRaw === "CORRECT_ANSWER") {
          cur.correctRaw = value;
          field = "CORRECT_ANSWER";
          curOptionKey = null;
        } else if (keyRaw === "SCORE") {
          const n = parseFloat(value.replace(",", "."));
          cur.score = Number.isFinite(n) ? n : null;
          field = "SCORE";
          curOptionKey = null;
        } else if (keyRaw === "EXPLANATION") {
          cur.explanation = value || null;
          field = "EXPLANATION";
          curOptionKey = null;
        } else if (keyRaw === "TAGS") {
          cur.tags = value
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);
          field = "TAGS";
          curOptionKey = null;
        }
      }
    } else if (cur && line) {
      // Dòng tiếp nối (không phải marker) — multiline.
      if (field === "QUESTION_TEXT") cur.text += "\n" + line;
      else if (field === "OPTION" && curOptionKey) {
        const opt = ensureOption(cur, curOptionKey);
        opt.text += "\n" + line;
      } else if (field === "EXPLANATION") {
        cur.explanation = (cur.explanation ? cur.explanation + "\n" : "") + line;
      }
    }

    // Ảnh trong paragraph hiện tại.
    if (cur) {
      for (const rId of para.embedRIds) assignImage(rId);
      if (para.linkRIds.length > 0) cur.hasExternalImage = true;
    }
  }
  if (cur) questions.push(cur);
  return questions;
}

/** parse document.xml → câu hỏi (THUẦN, dùng cho Vitest với XML fixture). */
export function parseDocumentXml(documentXml: string): ParsedQuestion[] {
  return buildQuestions(splitParagraphs(documentXml));
}

// ──────────────────────────────────────────────────────────────────────────
// Validation (THUẦN)
// ──────────────────────────────────────────────────────────────────────────

const CORRECT_RE = /^[A-D](\s*,\s*[A-D])*$/i;

function correctLetters(raw: string): string[] {
  return raw
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Validate từng câu (không chặn câu khác). `existingCodes` = code đã có trong DB
 * (chỉ để đánh dấu dbExists — KHÔNG phải lỗi, vì upsert idempotent).
 */
export function validateQuestions(
  questions: ParsedQuestion[],
  existingCodes: Set<string> = new Set(),
): ValidatedQuestion[] {
  const seen = new Map<string, number>(); // code → số lần trong file
  for (const q of questions) {
    if (q.questionCode) seen.set(q.questionCode, (seen.get(q.questionCode) ?? 0) + 1);
  }

  return questions.map((q) => {
    const errors: string[] = [];

    if (!q.questionCode) errors.push("Thiếu QUESTION_CODE.");
    else if ((seen.get(q.questionCode) ?? 0) > 1)
      errors.push(`QUESTION_CODE "${q.questionCode}" trùng trong file.`);

    if (!q.type) errors.push(`QUESTION_TYPE không hợp lệ ("${q.rawType}"). Dùng SINGLE/MULTI/TRUE_FALSE.`);
    if (!q.text.trim()) errors.push("Thiếu QUESTION_TEXT.");
    if (q.score == null || q.score <= 0) errors.push("SCORE phải là số dương.");
    if (q.hasExternalImage)
      errors.push("Ảnh chèn bằng link internet không được hỗ trợ — chèn ảnh nhúng vào file.");

    const letters = correctLetters(q.correctRaw);
    if (q.type === "TRUE_FALSE") {
      if (q.options.length !== 2) errors.push("TRUE_FALSE cần đúng 2 lựa chọn.");
    }
    if (q.type === "SINGLE" || q.type === "MULTI" || q.type === "TRUE_FALSE") {
      if (q.options.length < 2) errors.push("Cần ít nhất 2 lựa chọn (OPTION_A, OPTION_B...).");
      if (!q.correctRaw.trim()) errors.push("Thiếu CORRECT_ANSWER.");
      else if (!CORRECT_RE.test(q.correctRaw.trim()))
        errors.push(`CORRECT_ANSWER sai định dạng ("${q.correctRaw}"). Dùng "A" hoặc "A,C".`);
      else {
        const keys = new Set(q.options.map((o) => o.key));
        const ghost = letters.filter((l) => !keys.has(l));
        if (ghost.length > 0)
          errors.push(`CORRECT_ANSWER trỏ tới lựa chọn không tồn tại: ${ghost.join(", ")}.`);
        if (q.type === "SINGLE" && letters.length !== 1)
          errors.push("SINGLE cần đúng 1 đáp án đúng.");
        if (q.type === "TRUE_FALSE" && letters.length !== 1)
          errors.push("TRUE_FALSE cần đúng 1 đáp án đúng.");
        if (q.type === "MULTI" && letters.length < 1)
          errors.push("MULTI cần ít nhất 1 đáp án đúng.");
      }
    }

    const dbExists = q.questionCode ? existingCodes.has(q.questionCode) : false;
    return { ...q, errors, dbExists, valid: errors.length === 0 };
  });
}

/** Map loại docx → Prisma QuestionType. */
export function toPrismaType(t: DocxQuestionType): "MULTIPLE_CHOICE" | "TRUE_FALSE" {
  return t === "TRUE_FALSE" ? "TRUE_FALSE" : "MULTIPLE_CHOICE";
}

// ──────────────────────────────────────────────────────────────────────────
// .docx unzip (runtime — cần jszip)
// ──────────────────────────────────────────────────────────────────────────

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".emf": "image/emf",
  ".wmf": "image/wmf",
};

function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : "";
}

/**
 * Unzip .docx → ParsedDocx. Đọc word/document.xml + rels, resolve ảnh nhúng
 * (chỉ những rId được câu hỏi tham chiếu) sang base64.
 */
export async function parseDocx(bytes: Uint8Array): Promise<ParsedDocx> {
  if (!hasDocxMagic(bytes)) {
    throw new Error("File không phải .docx hợp lệ (magic bytes).");
  }
  // Import động + specifier biến + @vite-ignore: KHÔNG phụ thuộc type jszip, và
  // không vỡ khi jszip chưa cài (vite/test bỏ qua phân giải tĩnh).
  type JSZipLike = {
    loadAsync(data: Uint8Array): Promise<{
      file(path: string): { async(type: "string" | "base64"): Promise<string> } | null;
    }>;
  };
  const pkg = "jszip";
  const mod = (await import(/* @vite-ignore */ pkg)) as { default: JSZipLike };
  const zip = await mod.default.loadAsync(bytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Không tìm thấy word/document.xml — file .docx không hợp lệ.");
  const documentXml = await docFile.async("string");

  const relsFile = zip.file("word/_rels/document.xml.rels");
  const rels = relsFile ? parseRels(await relsFile.async("string")) : {};

  const questions = parseDocumentXml(documentXml);
  if (questions.length === 0) {
    throw new Error("Không tìm thấy block hợp lệ (thiếu marker QUESTION_CODE). Tải file mẫu để đối chiếu.");
  }

  // Gom rId ảnh thực sự dùng.
  const usedRIds = new Set<string>();
  for (const q of questions) {
    if (q.questionImageRId) usedRIds.add(q.questionImageRId);
    for (const o of q.options) if (o.imageRId) usedRIds.add(o.imageRId);
  }

  const media: Record<string, ParsedMedia> = {};
  for (const rId of usedRIds) {
    const rel = rels[rId];
    if (!rel || rel.external) continue;
    // Target tương đối với thư mục word/.
    const target = rel.target.replace(/^\/?word\//, "").replace(/^\//, "");
    const mediaFile = zip.file(`word/${target}`);
    if (!mediaFile) continue;
    const base64 = await mediaFile.async("base64");
    const ext = extOf(target);
    media[rId] = { rId, ext, mime: EXT_MIME[ext] ?? "application/octet-stream", base64 };
  }

  return { questions, media };
}
