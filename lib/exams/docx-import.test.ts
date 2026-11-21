import { describe, it, expect } from "vitest";
import {
  parseDocumentXml,
  validateQuestions,
  hasDocxMagic,
  assertDocx,
  parseRels,
  toPrismaType,
  DOCX_MIME,
} from "./docx-import";

// ── XML fixtures (paragraph-per-field, không cần jszip) ──────────────────────
function para(text: string, opts?: { embed?: string; link?: string }) {
  const t = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let drawing = "";
  if (opts?.embed)
    drawing = `<w:r><w:drawing><a:blip r:embed="${opts.embed}"/></w:drawing></w:r>`;
  if (opts?.link)
    drawing = `<w:r><w:drawing><a:blip r:link="${opts.link}"/></w:drawing></w:r>`;
  return `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r>${drawing}</w:p>`;
}
function doc(...paras: string[]) {
  return `<w:document><w:body>${paras.join("")}</w:body></w:document>`;
}

const GOOD = doc(
  para("QUESTION_CODE: Q1"),
  para("QUESTION_TYPE: SINGLE"),
  para("QUESTION_TEXT: 2 + 3 = ?"),
  para("QUESTION_IMAGE:", { embed: "rId10" }),
  para("OPTION_A: 4"),
  para("OPTION_B: 5"),
  para("OPTION_B_IMAGE:", { embed: "rId11" }),
  para("CORRECT_ANSWER: B"),
  para("SCORE: 1"),
  para("TAGS: toan, cong"),
  para("QUESTION_CODE: Q2"),
  para("QUESTION_TYPE: TRUE_FALSE"),
  para("QUESTION_TEXT: Robot lập trình được."),
  para("OPTION_A: Đúng"),
  para("OPTION_B: Sai"),
  para("CORRECT_ANSWER: A"),
  para("SCORE: 2"),
);

describe("magic bytes / mime", () => {
  it("nhận PK magic", () => {
    expect(hasDocxMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(hasDocxMagic(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(false); // .doc OLE
  });
  it("reject .doc đổi đuôi", () => {
    const pk = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => assertDocx("a.doc", "", pk)).toThrow();
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(() => assertDocx("a.docx", DOCX_MIME, ole)).toThrow(); // magic sai
    expect(() => assertDocx("a.docx", DOCX_MIME, pk)).not.toThrow();
  });
});

describe("parseDocumentXml", () => {
  const qs = parseDocumentXml(GOOD);

  it("tách đúng 2 block", () => {
    expect(qs).toHaveLength(2);
    expect(qs[0].questionCode).toBe("Q1");
    expect(qs[1].questionCode).toBe("Q2");
  });

  it("parse field cơ bản", () => {
    expect(qs[0].type).toBe("SINGLE");
    expect(qs[0].text).toBe("2 + 3 = ?");
    expect(qs[0].options.map((o) => o.text)).toEqual(["4", "5"]);
    expect(qs[0].correctRaw).toBe("B");
    expect(qs[0].score).toBe(1);
    expect(qs[0].tags).toEqual(["toan", "cong"]);
  });

  it("map ảnh đúng vị trí (đề + đáp án)", () => {
    expect(qs[0].questionImageRId).toBe("rId10");
    const optB = qs[0].options.find((o) => o.key === "B");
    expect(optB?.imageRId).toBe("rId11");
    // option A không có ảnh
    expect(qs[0].options.find((o) => o.key === "A")?.imageRId).toBeNull();
  });
});

describe("validateQuestions", () => {
  it("câu chuẩn → hợp lệ", () => {
    const v = validateQuestions(parseDocumentXml(GOOD));
    expect(v.every((q) => q.valid)).toBe(true);
  });

  it("phát hiện lỗi hỗn hợp, không chặn câu đúng", () => {
    const mixed = doc(
      // OK
      para("QUESTION_CODE: A1"),
      para("QUESTION_TYPE: SINGLE"),
      para("QUESTION_TEXT: ok?"),
      para("OPTION_A: x"),
      para("OPTION_B: y"),
      para("CORRECT_ANSWER: A"),
      para("SCORE: 1"),
      // type sai
      para("QUESTION_CODE: A2"),
      para("QUESTION_TYPE: WRONG"),
      para("QUESTION_TEXT: bad type"),
      para("OPTION_A: x"),
      para("OPTION_B: y"),
      para("CORRECT_ANSWER: A"),
      para("SCORE: 1"),
      // đáp án ma + thiếu text
      para("QUESTION_CODE: A3"),
      para("QUESTION_TYPE: SINGLE"),
      para("OPTION_A: x"),
      para("OPTION_B: y"),
      para("CORRECT_ANSWER: D"),
      para("SCORE: 1"),
      // code trùng A1 + score <=0
      para("QUESTION_CODE: A1"),
      para("QUESTION_TYPE: SINGLE"),
      para("QUESTION_TEXT: dup"),
      para("OPTION_A: x"),
      para("OPTION_B: y"),
      para("CORRECT_ANSWER: A"),
      para("SCORE: 0"),
    );
    const v = validateQuestions(parseDocumentXml(mixed));
    const byCode = (c: string, i = 0) => v.filter((q) => q.questionCode === c)[i];

    expect(v.filter((q) => q.questionCode === "A2")[0].valid).toBe(false); // type
    expect(byCode("A3").valid).toBe(false); // ghost answer + missing text
    expect(byCode("A3").errors.some((e) => e.includes("không tồn tại"))).toBe(true);
    expect(byCode("A3").errors.some((e) => e.includes("QUESTION_TEXT"))).toBe(true);
    // A1 xuất hiện 2 lần → cả 2 bị đánh dấu trùng
    expect(v.filter((q) => q.questionCode === "A1").every((q) => !q.valid)).toBe(true);
  });

  it("ảnh link ngoài → lỗi", () => {
    const ext = doc(
      para("QUESTION_CODE: E1"),
      para("QUESTION_TYPE: SINGLE"),
      para("QUESTION_TEXT: external img"),
      para("QUESTION_IMAGE:", { link: "rId99" }),
      para("OPTION_A: x"),
      para("OPTION_B: y"),
      para("CORRECT_ANSWER: A"),
      para("SCORE: 1"),
    );
    const v = validateQuestions(parseDocumentXml(ext));
    expect(v[0].valid).toBe(false);
    expect(v[0].errors.some((e) => e.includes("link internet"))).toBe(true);
  });

  it("dbExists đánh dấu nhưng KHÔNG là lỗi (idempotent)", () => {
    const v = validateQuestions(parseDocumentXml(GOOD), new Set(["Q1"]));
    const q1 = v.find((q) => q.questionCode === "Q1")!;
    expect(q1.dbExists).toBe(true);
    expect(q1.valid).toBe(true);
  });
});

describe("parseRels + mapping", () => {
  it("parse relationship + external flag", () => {
    const rels = parseRels(
      `<Relationships><Relationship Id="rId10" Target="media/image1.png"/>` +
        `<Relationship Id="rId99" Target="http://x/y.png" TargetMode="External"/></Relationships>`,
    );
    expect(rels.rId10).toEqual({ target: "media/image1.png", external: false });
    expect(rels.rId99.external).toBe(true);
  });

  it("toPrismaType", () => {
    expect(toPrismaType("SINGLE")).toBe("MULTIPLE_CHOICE");
    expect(toPrismaType("MULTI")).toBe("MULTIPLE_CHOICE");
    expect(toPrismaType("TRUE_FALSE")).toBe("TRUE_FALSE");
  });
});
