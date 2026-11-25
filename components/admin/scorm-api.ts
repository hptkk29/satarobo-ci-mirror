// components/admin/scorm-api.ts — R7-12: SCORM 1.2 API adapter (delivery tracking GV).
// Nội dung SCORM 1.2 tìm `window.API` đi LÊN parent; player là parent của iframe nên
// adapter set window.API trên window player TRƯỚC khi iframe load. Giữ cmi model in-memory,
// SEED từ ScormAttempt sẵn có (resume), POST tới /api/scorm/runtime trên Commit/Finish.
//
// RÀNG BUỘC SCOPE: learner = GV (session.user.id), KHÔNG studentId; theo dõi GV hoàn thành
// GIẢNG, KHÔNG ghi điểm/tiến độ HV, KHÔNG nối học bạ. Mọi lỗi FAIL-OPEN (không chặn dạy).

export interface ScormSeed {
  /** "passed" | "completed" | "failed" | "browsed" | "incomplete" | "not attempted" */
  lessonStatus: string;
  lessonLocation: string;
  suspendData: string;
  scoreRaw: string;
}

export interface Scorm12ApiOptions {
  packageId: string;
  classSessionId: string | null;
  seed: ScormSeed;
  /** Định danh GV (KHÔNG phải HV) cho cmi.core.student_id/name nếu content cần. */
  learnerId: string;
  learnerName: string;
}

/** Hàm SCORM 1.2 — nhận 0/1/2 đối số chuỗi (LMSSetValue dùng 2), trả chuỗi. */
type ScormFn = (...args: string[]) => string;

/** Đối tượng SCORM 1.2 API + teardown để gỡ window.API khi unmount. */
export interface Scorm12Api {
  api: Record<string, ScormFn>;
  /** Gỡ khỏi window + flush lần cuối (gọi khi unmount player). */
  destroy: () => void;
}

const PAD = (n: number) => String(n).padStart(2, "0");

/** Giây → CMITimespan SCORM 1.2 "HH:MM:SS". */
function fmtTimespan(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${PAD(Math.floor(s / 3600))}:${PAD(Math.floor((s % 3600) / 60))}:${PAD(s % 60)}`;
}

/** Tạo adapter SCORM 1.2 (chưa gắn window). Gọi mountScorm12Api để set window.API. */
export function createScorm12Api(opts: Scorm12ApiOptions): Scorm12Api {
  // cmi model in-memory — flat map theo key chấm (cmi.core.lesson_status, ...).
  const entry =
    opts.seed.suspendData || opts.seed.lessonLocation ? "resume" : "ab-initio";
  const cmi: Record<string, string> = {
    "cmi.core.student_id": opts.learnerId || "",
    "cmi.core.student_name": opts.learnerName || "",
    "cmi.core.lesson_location": opts.seed.lessonLocation || "",
    "cmi.core.credit": "credit",
    "cmi.core.lesson_status": opts.seed.lessonStatus || "not attempted",
    "cmi.core.entry": entry,
    "cmi.core.score.raw": opts.seed.scoreRaw || "",
    "cmi.core.score.max": "",
    "cmi.core.score.min": "",
    "cmi.core.total_time": "00:00:00",
    "cmi.core.lesson_mode": "normal",
    "cmi.core.exit": "",
    "cmi.core.session_time": "00:00:00",
    "cmi.suspend_data": opts.seed.suspendData || "",
    "cmi.launch_data": "",
    "cmi.comments": "",
    "cmi.student_data.mastery_score": "",
    "cmi.student_data.max_time_allowed": "",
    "cmi.student_data.time_limit_action": "",
  };

  let initialized = false;
  let finished = false;
  let lastError = "0";
  let mountSec = 0; // mốc thời gian phiên (giây)
  let lastPostSec = 0; // mốc lần POST gần nhất (để tính delta thời gian)
  let firstPostDone = false; // để cộng sessionCount đúng 1 lần/phiên
  let commitTimer: number | undefined;

  const nowSec = () => Date.now() / 1000;

  /** Gửi snapshot cmi tới runtime. delta thời gian từ lần post trước → session_time. */
  function post(isFinish: boolean): void {
    try {
      const delta = Math.max(0, Math.round(nowSec() - lastPostSec));
      lastPostSec = nowSec();
      const sessionStart = !firstPostDone;
      firstPostDone = true;
      const payload = {
        packageId: opts.packageId,
        classSessionId: opts.classSessionId,
        sessionStart,
        finished: isFinish,
        cmi: {
          lesson_status: cmi["cmi.core.lesson_status"],
          lesson_location: cmi["cmi.core.lesson_location"],
          suspend_data: cmi["cmi.suspend_data"],
          score_raw: cmi["cmi.core.score.raw"],
          session_time: fmtTimespan(delta),
        },
      };
      void fetch("/api/scorm/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        /* fail-open: lỗi mạng không chặn dạy */
      });
    } catch {
      /* fail-open */
    }
  }

  function scheduleCommit(): void {
    if (commitTimer) window.clearTimeout(commitTimer);
    // Debounce 2s — gộp nhiều LMSCommit/LMSSetValue liên tiếp.
    commitTimer = window.setTimeout(() => post(false), 2000);
  }

  function flushNow(isFinish: boolean): void {
    if (commitTimer) {
      window.clearTimeout(commitTimer);
      commitTimer = undefined;
    }
    post(isFinish);
  }

  const ok = (): string => {
    lastError = "0";
    return "true";
  };

  const api: Record<string, ScormFn> = {
    LMSInitialize: () => {
      initialized = true;
      finished = false;
      mountSec = nowSec();
      lastPostSec = mountSec;
      firstPostDone = false;
      return ok();
    },
    LMSFinish: () => {
      if (!initialized) {
        lastError = "301";
        return "false";
      }
      // Tổng thời gian phiên về total_time (hiển thị nội bộ) + flush ngay (keepalive).
      cmi["cmi.core.session_time"] = fmtTimespan(nowSec() - mountSec);
      flushNow(true);
      initialized = false;
      finished = true;
      return ok();
    },
    LMSGetValue: (key) => {
      lastError = "0";
      // _children/_count: trả rỗng (content thường tự fallback) — đủ cho delivery.
      return cmi[key ?? ""] ?? "";
    },
    // SCORM 1.2 LMSSetValue(element, value) — 2 đối số.
    LMSSetValue: (key, value) => {
      lastError = "0";
      if (typeof key === "string") cmi[key] = value == null ? "" : String(value);
      return "true";
    },
    LMSCommit: () => {
      scheduleCommit();
      return ok();
    },
    LMSGetLastError: () => lastError,
    LMSGetErrorString: (code) => {
      switch (code) {
        case "0":
          return "No error";
        case "201":
          return "Invalid argument error";
        case "301":
          return "Not initialized";
        default:
          return "";
      }
    },
    LMSGetDiagnostic: () => "",
  };

  const onUnload = () => {
    if (initialized && !finished) flushNow(false);
  };

  function destroy(): void {
    try {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      if (initialized && !finished) flushNow(false);
      const w = window as unknown as Record<string, unknown>;
      if (w.API === api) delete w.API;
    } catch {
      /* fail-open */
    }
  }

  // Flush khi đóng tab/điều hướng (best-effort, keepalive).
  try {
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
  } catch {
    /* fail-open */
  }

  return { api, destroy };
}

/** Gắn adapter vào window.API (SCORM 1.2). Trả teardown. */
export function mountScorm12Api(opts: Scorm12ApiOptions): () => void {
  const built = createScorm12Api(opts);
  const w = window as unknown as Record<string, unknown>;
  w.API = built.api; // content tìm window.parent.API → đây là parent của iframe
  return built.destroy;
}
