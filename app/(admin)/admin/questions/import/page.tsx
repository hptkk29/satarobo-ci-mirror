"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { precheckUpsert } from "@/components/admin/import-precheck";
import { ExcelImporter, type ImportResult } from "@/components/admin/ExcelImporter";
import { docLoiPhanHoi } from "@/lib/ui/loi-phan-hoi";

const VALID_TYPES = new Set([
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "CODE",
]);
const VALID_DIFFICULTY = new Set(["EASY", "MEDIUM", "HARD", "EXPERT"]);

interface QuestionRow {
  questionCode?: string;
  type: string;
  text: string;
  difficulty?: string;
  tags?: string;
  courseSlug?: string;
  curriculumVersion?: string;
  points?: string;
  timeLimitSec?: string;
  correctAnswer?: string;
  choice1?: string;
  choice1_correct?: string;
  choice2?: string;
  choice2_correct?: string;
  choice3?: string;
  choice3_correct?: string;
  choice4?: string;
  choice4_correct?: string;
  explanation?: string;
  isPublic?: string;
  notes?: string;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

export default function ImportQuestionsPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/questions"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Câu hỏi từ Excel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <code>questionCode</code> = khoá upsert. Tối đa <strong>4 choices/row</strong>;
          câu hỏi cần &gt;4 lựa chọn phải dùng admin form.
        </p>
        {/* QA 21/07 — tester link khung CT TAY TỪNG CÂU sau import vì tưởng import
            không hỗ trợ (chỉ lesson mới defer). Nêu rõ ngay đầu trang. */}
        <p className="mt-2 rounded-lg border border-primary-soft bg-primary-soft px-3 py-2 text-sm text-primary">
          💡 Muốn gắn <strong>khung chương trình hàng loạt</strong> ngay khi import
          (để lọc được khi soạn bài tập): điền cột <code>courseSlug</code> (vd{" "}
          <code>laptrinhrobot</code>) + <code>curriculumVersion</code> (số) cho từng
          dòng — không cần sửa tay từng câu sau import. Chỉ <em>bài học (lesson)</em>{" "}
          mới phải gắn sau qua form.
        </p>
      </div>

      <ExcelImporter<QuestionRow>
        title="Import Câu hỏi"
        templateUrl="/templates/mau-ngan-hang-cau-hoi-v2.xlsx"
        templateFilename="mau-ngan-hang-cau-hoi-v2.xlsx"
        duplicateLabel="Mã câu hỏi"
        duplicateKey={(raw) => String(raw.questionCode ?? "").trim() || null}
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "questions",
            raws.map((r) => String(r.questionCode ?? "").trim() || null),
            nos,
            "Mã câu hỏi",
          )
        }
        columnHints={[
          { key: "questionCode", label: "Mã (upsert key)" },
          { key: "type", label: "Loại", required: true },
          { key: "text", label: "Đề bài", required: true },
          { key: "difficulty", label: "Độ khó (EASY/MEDIUM/HARD/EXPERT)" },
          { key: "tags", label: "Tags (cách ,)" },
          { key: "courseSlug", label: "Khoá (slug) — khung CT" },
          { key: "curriculumVersion", label: "Khung phiên bản (số)" },
          { key: "points", label: "Điểm/câu" },
          { key: "timeLimitSec", label: "Thời gian/câu (giây)" },
          { key: "correctAnswer", label: "Đáp án (SA/CODE/ESSAY)" },
          { key: "choice1", label: "Lựa chọn A" },
          { key: "choice1_correct", label: "A đúng? (TRUE/FALSE)" },
          { key: "choice2", label: "Lựa chọn B" },
          { key: "choice2_correct", label: "B đúng?" },
          { key: "choice3", label: "Lựa chọn C" },
          { key: "choice3_correct", label: "C đúng?" },
          { key: "choice4", label: "Lựa chọn D" },
          { key: "choice4_correct", label: "D đúng?" },
          { key: "explanation", label: "Giải thích" },
          { key: "isPublic", label: "Public (TRUE/FALSE, default TRUE)" },
          { key: "notes", label: "Ghi chú" },
        ]}
        parseRow={(row) => {
          const type = asString(row.type);
          const text = asString(row.text);

          if (!type) return { error: "Thiếu type" };
          if (!VALID_TYPES.has(type)) {
            return {
              error: `Loại sai. Hợp lệ: ${[...VALID_TYPES].join(" / ")}`,
            };
          }
          if (!text || text.trim() === "") {
            return { error: "Thiếu đề bài (text)" };
          }
          const difficulty = asString(row.difficulty);
          if (difficulty && !VALID_DIFFICULTY.has(difficulty)) {
            return {
              error: `Difficulty sai. Hợp lệ: ${[...VALID_DIFFICULTY].join(" / ")}`,
            };
          }
          return {
            questionCode: asString(row.questionCode),
            type,
            text,
            difficulty,
            tags: asString(row.tags),
            courseSlug: asString(row.courseSlug),
            curriculumVersion: asString(row.curriculumVersion),
            points: asString(row.points),
            timeLimitSec: asString(row.timeLimitSec),
            correctAnswer: asString(row.correctAnswer),
            choice1: asString(row.choice1),
            choice1_correct: asString(row.choice1_correct),
            choice2: asString(row.choice2),
            choice2_correct: asString(row.choice2_correct),
            choice3: asString(row.choice3),
            choice3_correct: asString(row.choice3_correct),
            choice4: asString(row.choice4),
            choice4_correct: asString(row.choice4_correct),
            explanation: asString(row.explanation),
            isPublic: asString(row.isPublic),
            notes: asString(row.notes),
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) {
            // Route tra loi theo HAI hinh dang; `docLoiPhanHoi` doc du ca hai.
            const than = (await res.json().catch(() => null)) as {
              error?: string;
              errors?: { row: number; error: string }[];
            } | null;
            throw new Error(docLoiPhanHoi(res.status, than));
          }
          const result = (await res.json()) as ImportResult;
          setTimeout(() => router.refresh(), 1000);
          return result;
        }}
      />

      <div className="text-sm text-muted-foreground mt-4 space-y-1 rounded-xl border border-border bg-muted p-4">
        <p className="font-semibold text-foreground">Lưu ý:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <code>type</code>: <code>MULTIPLE_CHOICE</code> /{" "}
            <code>TRUE_FALSE</code> / <code>SHORT_ANSWER</code> /{" "}
            <code>ESSAY</code> / <code>CODE</code>.
          </li>
          <li>
            Boolean fields (<code>choice*_correct</code>, <code>isPublic</code>)
            chấp nhận: <code>TRUE</code> / <code>FALSE</code> / <code>1</code> /{" "}
            <code>0</code> / <code>YES</code> / <code>NO</code> /{" "}
            <code>ĐÚNG</code>.
          </li>
          <li>
            <strong>MULTIPLE_CHOICE</strong>: ≥2 choices + ≥1{" "}
            <code>isCorrect=TRUE</code>.
          </li>
          <li>
            <strong>TRUE_FALSE</strong>: đúng 2 choices (Đúng / Sai) + đúng 1{" "}
            <code>isCorrect=TRUE</code>.
          </li>
          <li>
            <strong>SHORT_ANSWER</strong>: bắt buộc{" "}
            <code>correctAnswer</code>; <strong>ESSAY/CODE</strong>: tuỳ chọn.
          </li>
          <li>
            <code>questionCode</code> trùng → UPDATE (choices được tái tạo); mới
            → CREATE; để trống → luôn CREATE.
          </li>
          <li>
            <code>isPublic</code> để trống → mặc định <code>TRUE</code>.
          </li>
          <li>
            <strong>Khung chương trình</strong>: điền <code>courseSlug</code>{" "}
            (slug khoá dạy) để gắn theo khoá; thêm <code>curriculumVersion</code>{" "}
            (số) để gắn đúng khung CT. Bỏ trống nếu không gắn.
          </li>
          <li>
            <code>points</code> (số ≥ 0) · <code>timeLimitSec</code> (số nguyên
            giây ≥ 1) — tuỳ chọn.
          </li>
          <li>
            <strong>Lesson linking</strong>: defer — edit từng câu qua admin
            form sau import (tránh lookup composite curriculumId + lessonOrder).
          </li>
          <li>
            Câu hỏi cần &gt;4 lựa chọn phải dùng admin form thay vì Excel.
          </li>
        </ul>
      </div>
    </div>
  );
}
