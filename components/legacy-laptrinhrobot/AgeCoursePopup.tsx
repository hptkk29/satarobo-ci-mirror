"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Bot, CheckCircle2, ChevronDown, GraduationCap, Target, X, type LucideIcon } from "lucide-react";
import { ageCourseOptions, selectCourse, type AgeCourseOption } from "./_utils/courseSelection";

const POPUP_SHOWN_KEY = "sata-age-popup-shown";
const SELECTED_COURSE_KEY = "sata-selected-age-course";
const REOPEN_DELAY_MS = 90000;
const ROADMAP_OPEN_DELAY_MS = 600;

interface ExamGoalOption {
  label: string;
  courseName: string;
  productCode: string;
  grade?: string;
  yearIndex?: number;
}

const examGoalOptions: ExamGoalOption[] = [
  { label: "Luyện thi RoboSim / vòng loại", courseName: "Sata1 - Robosim Master", productCode: "Sata1" },
  { label: "Luyện robot Beta cấp khu vực", courseName: "Sata2 - Đấu trường Robot", productCode: "Sata2" },
  { label: "Học trọn gói luyện thi", courseName: "Combo Sata1 + Sata2", productCode: "Combo" },
  { label: "Cam kết Vé Vàng", courseName: "Sata8 - Vé Vàng Chung Kết", productCode: "Sata8" },
];

type GoalId = "exam" | "deep";

export default function AgeCoursePopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [goal, setGoal] = useState<GoalId>("exam");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState("");
  const [useFallbackMascot, setUseFallbackMascot] = useState(false);
  const [hasStartedPrompting, setHasStartedPrompting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasSelectedCourse = () =>
    typeof window !== "undefined" && Boolean(sessionStorage.getItem(SELECTED_COURSE_KEY));

  const closePopup = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(POPUP_SHOWN_KEY, String(Date.now()));
    }
    setIsOpen(false);
  };

  const currentOptions: (ExamGoalOption | AgeCourseOption)[] = goal === "exam" ? examGoalOptions : ageCourseOptions;
  const selectedOption = selectedIdx !== null ? currentOptions[selectedIdx] : null;

  const handleConfirm = () => {
    if (selectedIdx === null) {
      setError(goal === "exam" ? "Bố/Mẹ vui lòng chọn mục tiêu luyện thi." : "Bố/Mẹ vui lòng chọn lớp của con.");
      return;
    }
    const selected = currentOptions[selectedIdx];
    selectCourse(selected.productCode, {
      yearIndex: (selected as AgeCourseOption).yearIndex,
      goal,
    });
    setIsOpen(false);
    // Scroll xuống section Lộ trình để PH thấy khoá học vừa chọn — delay nhẹ
    // cho Roadmap5Years kịp re-render với tab/year đúng.
    setTimeout(() => {
      document
        .getElementById("roadmap")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  useEffect(() => {
    if (hasSelectedCourse()) return;
    sessionStorage.removeItem(POPUP_SHOWN_KEY);
    const roadmapEl = document.getElementById("roadmap");
    if (!roadmapEl) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasSelectedCourse()) return;
        timer = setTimeout(() => {
          if (hasSelectedCourse()) return;
          sessionStorage.setItem(POPUP_SHOWN_KEY, String(Date.now()));
          setHasStartedPrompting(true);
          setIsOpen(true);
        }, ROADMAP_OPEN_DELAY_MS);
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(roadmapEl);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!hasStartedPrompting || hasSelectedCourse()) return;
    const interval = setInterval(() => {
      if (hasSelectedCourse()) {
        clearInterval(interval);
        return;
      }
      sessionStorage.setItem(POPUP_SHOWN_KEY, String(Date.now()));
      setIsOpen(true);
    }, REOPEN_DELAY_MS);
    return () => clearInterval(interval);
  }, [hasStartedPrompting]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dropdownOpen) setDropdownOpen(false);
        else closePopup();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [dropdownOpen]);

  useEffect(() => {
    setSelectedIdx(null);
    setDropdownOpen(false);
    setError("");
  }, [goal]);

  if (!isOpen) return null;

  const goalOptions: { id: GoalId; title: string; text: string; Icon: LucideIcon }[] = [
    { id: "exam", title: "Mục tiêu luyện thi", text: "RoboSim, robot Beta, Combo hoặc Vé Vàng", Icon: Target },
    { id: "deep", title: "Học chuyên sâu dài hạn", text: "Chọn theo lớp cho Sata3–Sata7", Icon: GraduationCap },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={closePopup}>
      <div
        className="w-full max-w-lg animate-slide-up rounded-3xl border border-white/50 bg-white p-5 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="age-course-popup-title"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-primary-orange/20 bg-gradient-cream">
              {useFallbackMascot ? (
                <Bot className="h-10 w-10 text-primary-purple" />
              ) : (
                <Image
                  src="/laptrinhrobot/LinhVat.png"
                  alt="Linh vật Sata Robo"
                  className="h-full w-full object-contain p-1"
                  width={64}
                  height={64}
                  onError={() => setUseFallbackMascot(true)}
                />
              )}
            </div>
            <div>
              <div className="badge-orange mb-1.5">Chọn lộ trình</div>
              <h2 id="age-course-popup-title" className="text-lg font-black leading-tight text-text-dark sm:text-xl">
                Bố/Mẹ muốn con học theo mục tiêu nào?
              </h2>
            </div>
          </div>

          <button type="button" onClick={closePopup} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 transition hover:bg-gray-200" aria-label="Đóng popup">
            <X className="h-4 w-4 text-text-dark" />
          </button>
        </div>

        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {goalOptions.map((item) => {
            const active = goal === item.id;
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setGoal(item.id)}
                className={`group rounded-2xl border-2 p-3.5 text-left transition-all ${
                  active
                    ? "border-primary-purple bg-gradient-to-br from-primary-purple to-primary-orange text-white shadow-purple-glow"
                    : "border-gray-200 bg-gray-50 text-text-dark hover:border-primary-purple/50 hover:bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${active ? "bg-white/20 text-white" : "bg-white text-primary-purple shadow-sm group-hover:text-primary-orange"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className={`block text-sm font-black ${active ? "text-white" : "text-text-dark"}`}>{item.title}</span>
                    <span className={`block text-[11px] ${active ? "text-white/80" : "text-text-muted"}`}>{item.text}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mb-1" ref={dropdownRef}>
          <div className="mb-2 text-sm font-black text-text-dark">
            {goal === "exam" ? "Chọn mục tiêu luyện thi" : "Chọn lớp của con"}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-all ${
                dropdownOpen
                  ? "border-primary-orange bg-soft-cream shadow-orange-glow"
                  : selectedOption
                    ? "border-primary-orange/50 bg-soft-cream/60 hover:border-primary-orange"
                    : "border-gray-200 bg-white hover:border-primary-orange/50 hover:bg-soft-cream/30"
              }`}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              {selectedOption ? (
                <span className="min-w-0">
                  <span className="block font-black text-text-dark">{selectedOption.label}</span>
                  <span className="block text-xs text-text-muted">{selectedOption.courseName}</span>
                </span>
              ) : (
                <span className="text-sm text-text-muted">
                  {goal === "exam" ? "Chọn mục tiêu..." : "Chọn lớp của con..."}
                </span>
              )}
              <ChevronDown className={`h-5 w-5 flex-shrink-0 text-primary-orange transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {dropdownOpen && (
              <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-56 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl animate-fade-in">
                {currentOptions.map((option, idx) => {
                  const active = selectedIdx === idx;
                  const grade = (option as AgeCourseOption).grade;
                  return (
                    <li key={option.courseName} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIdx(idx);
                          setDropdownOpen(false);
                          setError("");
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ${active ? "bg-soft-cream" : "hover:bg-gray-50"} ${idx < currentOptions.length - 1 ? "border-b border-gray-100" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className={`block text-sm font-black ${active ? "text-primary-orange" : "text-text-dark"}`}>
                            {option.label}
                          </span>
                          {grade && (
                            <span className="block text-[11px] font-bold text-primary-purple">{grade}</span>
                          )}
                          <span className="block text-xs text-text-muted">{option.courseName}</span>
                        </span>
                        {active && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {error && <p className="mt-2 text-sm font-semibold text-urgent">{error}</p>}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={closePopup} className="btn-outline sm:py-3">Để sau</button>
          <button type="button" onClick={handleConfirm} className="btn-primary sm:py-3">
            Chọn khóa phù hợp cho con
          </button>
        </div>
      </div>
    </div>
  );
}
