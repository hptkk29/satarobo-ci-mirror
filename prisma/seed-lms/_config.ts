// prisma/seed-lms/_config.ts — Knob số lượng cho bộ seed. Đọc từ env, 2 scale.
//   SEED_SCALE=smoke  (mặc định — an toàn, ~vài trăm rows, kiểm thử nhanh script)
//   SEED_SCALE=full   (số thật user yêu cầu: 5000 PH, ~10k HV, 1000 lớp, ...)
//   SEED_MODULES=all | staff,parents,content,classes,crm  (chọn phần chạy)

export type SeedConfig = {
  scale: "smoke" | "full";
  staffPerDept: number;
  parents: number;
  /** Trọng số số con/phụ huynh: [số con, trọng số]. */
  childrenWeights: (readonly [number, number])[];
  classes: number;
  studentsPerClass: [number, number]; // [min,max]
  sessionsPerClass: number;
  /** Tỉ lệ buổi đã diễn ra (COMPLETED, có điểm danh) tính từ đầu lịch. */
  pastSessionRatio: number;
  scormPackages: number;
  slidesPerLesson: [number, number];
  lessonsPerCourse: number;
  crmLeads: number;
  /** % lead đã convert (có Student + Enrollment + Order + Payment). */
  crmEnrolledRatio: number;
  password: string;
};

const SCALES: Record<"smoke" | "full", Omit<SeedConfig, "scale" | "password">> = {
  smoke: {
    staffPerDept: 2,
    parents: 40,
    childrenWeights: [[1, 0.4], [2, 0.6]],
    classes: 12,
    studentsPerClass: [8, 10],
    sessionsPerClass: 4,
    pastSessionRatio: 0.5,
    scormPackages: 3,
    slidesPerLesson: [1, 2],
    lessonsPerCourse: 8,
    crmLeads: 30,
    crmEnrolledRatio: 0.2,
  },
  full: {
    staffPerDept: 10,
    parents: 5000,
    // avg ~2.0 con → ~10k HV (user muốn 10-15k; "1-2 con" chặt = ~7.5k, cho phép 3 để đạt mốc)
    childrenWeights: [[1, 0.25], [2, 0.5], [3, 0.25]],
    classes: 1000,
    studentsPerClass: [8, 10],
    sessionsPerClass: 16,
    pastSessionRatio: 0.6,
    scormPackages: 10,
    slidesPerLesson: [2, 4],
    lessonsPerCourse: 24,
    crmLeads: 2000,
    crmEnrolledRatio: 0.2,
  },
};

export function loadConfig(): SeedConfig {
  const scale = (process.env.SEED_SCALE === "full" ? "full" : "smoke") as "smoke" | "full";
  return {
    scale,
    password: process.env.SEED_PASSWORD ?? "Test@2026!",
    ...SCALES[scale],
  };
}

export function enabledModules(): Set<string> {
  const raw = process.env.SEED_MODULES ?? "all";
  if (raw === "all") return new Set(["staff", "parents", "content", "classes", "crm"]);
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}
