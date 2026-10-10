"use client";

// FL4 (R4) — GV điền phiếu đánh giá BUỔI HỌC cho LỚP TRẢI NGHIỆM (TrialClassSession).
// Tái dùng SessionEvalEditor (chung với lớp chính) qua callback action lớp trải nghiệm.
// Có dropdown chọn buổi; đổi buổi → remount editor (key) để nạp lại phiếu của buổi đó.
import { useState } from "react";
import { SessionEvalEditor, type StudentLite } from "./session-eval-fill";
import { loadTrialSessionEvalAction, saveTrialSessionEvalAction } from "@/lib/eval/session-eval-actions";

export type TrialSessionLite = { id: string; label: string };

export function TrialSessionEvalFill({
  trialSessions,
  students,
  canEdit,
}: {
  trialSessions: TrialSessionLite[];
  students: StudentLite[];
  canEdit: boolean;
}) {
  const [sessionId, setSessionId] = useState(trialSessions[0]?.id ?? "");
  if (trialSessions.length === 0) {
    return <p className="text-sm text-muted-foreground">Lớp chưa có buổi nào.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">Buổi:</label>
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-sm"
        >
          {trialSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {sessionId && (
        <SessionEvalEditor
          key={sessionId}
          students={students}
          canEdit={canEdit}
          load={() => loadTrialSessionEvalAction(sessionId)}
          save={(roundId, submissions) =>
            saveTrialSessionEvalAction({ trialSessionId: sessionId, roundId, submissions })
          }
        />
      )}
    </div>
  );
}
