"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Award,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FlaskConical,
  Image as ImageIcon,
  ListOrdered,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Trophy,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { roadmap5Years, type RoadmapModule } from "./_data/roadmap-5-years";
import { examRoadmap, type ExamRoadmapItem } from "./_data/exam-roadmap";
import {
  courseGroups as staticCourseGroups,
  CONTACT_PRICE,
  type Course,
  type CourseGroup,
} from "./_data/courses-pricing";
import {
  readStoredCourseSelection,
  selectCourse,
  type CourseSelectionPayload,
} from "./_utils/courseSelection";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    // Guard SSR — render lần đầu trên server luôn là false.
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

interface CourseMeta {
  Icon: LucideIcon;
  emoji: string;
  iconWrap: string;
  activeWrap: string;
}

const courseMeta: Record<string, CourseMeta> = {
  Sata3: {
    Icon: Sprout,
    emoji: "🌱",
    iconWrap: "bg-emerald-100 text-emerald-700 border-emerald-200",
    activeWrap: "bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/25",
  },
  Sata4: {
    Icon: Rocket,
    emoji: "🚀",
    iconWrap: "bg-indigo-100 text-indigo-700 border-indigo-200",
    activeWrap: "bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-500/25",
  },
  Sata5: {
    Icon: Zap,
    emoji: "⚡",
    iconWrap: "bg-amber-100 text-amber-700 border-amber-200",
    activeWrap: "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/25",
  },
  Sata6: {
    Icon: Trophy,
    emoji: "🏆",
    iconWrap: "bg-orange-100 text-orange-700 border-orange-200",
    activeWrap: "bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/25",
  },
  Sata7: {
    Icon: Bot,
    emoji: "🤖",
    iconWrap: "bg-violet-100 text-violet-700 border-violet-200",
    activeWrap: "bg-violet-500 text-white border-violet-500 shadow-lg shadow-violet-500/25",
  },
};

// Ảnh dự án nằm ở public/laptrinhrobot/ (bản gốc là /image/) — [title, image, caption].
const featuredProjectsByCourse: Record<string, Array<[string, string, string]>> = {
  Sata3: [
    ["Bàn Tay Ma Thuật", "/laptrinhrobot/sata3_1.jpg", "Lắp ráp chuyển động cơ bản và quan sát cơ cấu."],
    ["Siêu Xe Bứt Phá", "/laptrinhrobot/sata3_2.jpg", "Tạo mô hình xe robot đầu tiên."],
    ["Vũ Công Robot", "/laptrinhrobot/sata3_3.jpg", "Điều khiển robot bằng chuỗi lệnh trực quan."],
    ["Thần Long Trỗi Dậy", "/laptrinhrobot/sata3_4.jpg", "Khám phá truyền động và cân bằng mô hình."],
    ["Siêu Xe Chuyên Dụng", "/laptrinhrobot/sata3_5.jpg", "Tối ưu cấu trúc xe theo nhiệm vụ."],
  ],
  Sata4: [
    ["Xe robot di chuyển", "/laptrinhrobot/sata4_1.jpg", "Lập trình robot di chuyển theo nhiệm vụ."],
    ["Cảm biến dò line", "/laptrinhrobot/sata4_2.jpg", "Nhận biết vạch và tín hiệu cảm biến."],
    ["Xe robot tự hành", "/laptrinhrobot/sata4_3.jpg", "Kết hợp cảm biến để robot tự vận hành."],
    ["Dò line nâng cao", "/laptrinhrobot/sata4_4.jpg", "Tinh chỉnh đường chạy và tốc độ."],
    ["Thi đấu nội bộ", "/laptrinhrobot/sata4_5.jpg", "Rèn phản xạ chiến thuật trong sa bàn."],
  ],
  Sata5: [
    ["Máy đập bóng cơ", "/laptrinhrobot/sata5_1.jpg", "Thiết kế cơ cấu chuyển động có lực."],
    ["Cổng quét an ninh", "/laptrinhrobot/sata5_2.jpg", "Ứng dụng cảm biến vào mô hình tự động."],
    ["Cửa nhà thông minh", "/laptrinhrobot/sata5_3.jpg", "Mô phỏng smart-home bằng robot."],
    ["Xe bám mục tiêu", "/laptrinhrobot/sata5_4.jpg", "Robot phản hồi theo tín hiệu môi trường."],
    ["Hệ thống phân loại", "/laptrinhrobot/sata5_5.jpg", "Phân loại vật thể theo quy trình tự động."],
  ],
  Sata6: [
    ["Cảm biến dò line", "/laptrinhrobot/sata6_1.jpg", "Xây nền xử lý cảm biến cho thi đấu."],
    ["Dò line chuyên sâu PID", "/laptrinhrobot/sata6_2.jpg", "Giữ robot ổn định trên đường chạy."],
    ["Tối ưu chương trình", "/laptrinhrobot/sata6_3.jpg", "Rút ngắn thời gian và giảm lỗi vận hành."],
    ["Demo thi đấu", "/laptrinhrobot/sata6_4.jpg", "Thử nghiệm chiến thuật trên sa bàn."],
    ["Thi đấu nội bộ", "/laptrinhrobot/sata6_5.jpg", "Luyện áp lực và phối hợp đội thi."],
  ],
  Sata7: [
    ["AI ra lệnh robot", "/laptrinhrobot/sata7_1.jpg", "Điều khiển robot bằng tín hiệu thông minh."],
    ["AI nhận diện màu", "/laptrinhrobot/sata7_2.jpg", "Ứng dụng thị giác máy tính cơ bản."],
    ["AI robot tự hành", "/laptrinhrobot/sata7_3.jpg", "Robot xử lý môi trường và ra quyết định."],
    ["AI quét mã QR", "/laptrinhrobot/sata7_4.jpg", "Nhận diện dữ liệu bằng camera."],
    ["AI nhận diện mặt", "/laptrinhrobot/sata7_5.jpg", "Mô phỏng bài toán nhận diện trong thực tế."],
  ],
};

interface Project {
  title: string;
  image: string;
  caption: string;
}

interface LightboxState {
  projects: Project[];
  idx: number;
}

const toProjects = (productCode: string): Project[] =>
  (featuredProjectsByCourse[productCode] ?? []).map(([title, image, caption]) => ({
    title,
    image,
    caption,
  }));

const scrollToForm = () => {
  document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

function chooseCourse(productCode: string, extra: Record<string, unknown> = {}) {
  selectCourse(productCode, extra);
  // Chờ form kịp nhận event rồi mới cuộn, tránh nhảy tới vị trí cũ.
  setTimeout(scrollToForm, 50);
}

function PriceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-text-dark">
      <span>{label}</span>
      <strong className="text-primary-purple">{value}</strong>
    </div>
  );
}

interface CourseCardProps {
  item: ExamRoadmapItem;
  course: Course;
  isOpen: boolean;
  onToggle: () => void;
}

function ExamCourseCard({ item, course, isOpen, onToggle }: CourseCardProps) {
  return (
    <article className="rounded-3xl border border-gray-100 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex rounded-full bg-soft-purple px-3 py-1 text-xs font-black text-primary-purple">
            {course.id}
          </span>
          <h3 className="mt-3 text-xl font-black leading-tight text-text-dark">{course.displayName}</h3>
          <p className="mt-1 text-sm font-black text-primary-orange">{course.hook}</p>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-text-muted">{course.note || item.description}</p>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {[
          ["Lớp", course.grade],
          ["Số buổi", `${course.sessions} buổi`],
          ["Thời lượng", `${course.durationPerSession}/buổi`],
          ["Tổng", course.totalDuration],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-gray-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">{label}</div>
            <div className="mt-1 text-sm font-bold leading-tight text-text-dark">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-2xl border border-primary-orange/15 bg-soft-cream p-4">
        <PriceLine label="Học phí" value={CONTACT_PRICE} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => chooseCourse(course.id)} className="btn-primary flex-1 px-4 py-3 text-sm">
          Chọn khóa này
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="btn-outline flex-1 px-4 py-3 text-sm"
          aria-expanded={isOpen}
        >
          {isOpen ? "Thu gọn" : "Xem nội dung chi tiết"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-5 rounded-2xl border border-primary-orange/20 bg-soft-cream/70 p-4 animate-fade-in">
          <div className="mb-3 flex items-center gap-2 font-black text-text-dark">
            <ListOrdered className="h-4 w-4 text-primary-orange" />
            Nội dung {course.sessions} buổi
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(item.lessons ?? []).map((lesson, index) => (
              <div key={lesson} className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm text-text-dark">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-orange/10 text-xs font-black text-primary-orange">
                  {index + 1}
                </span>
                <span>{lesson}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function FocusCourseBox({ item, course, isOpen, onToggle }: CourseCardProps) {
  const isCombo = course.id === "Combo";
  const Icon = isCombo ? Trophy : ShieldCheck;

  return (
    <article
      className={`relative flex h-full flex-col rounded-3xl border-2 p-5 sm:p-6 ${
        isCombo
          ? "border-primary-orange bg-gradient-to-br from-orange-100 via-yellow-50 to-white shadow-xl shadow-primary-orange/25"
          : "border-primary-purple bg-gradient-to-br from-purple-100 via-purple-50 to-orange-50 shadow-xl shadow-primary-purple/20"
      }`}
    >
      <div
        className={`-mx-5 -mt-5 mb-5 rounded-t-3xl px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-white sm:-mx-6 sm:-mt-6 sm:px-6 ${
          isCombo ? "bg-primary-orange" : "bg-primary-purple"
        }`}
      >
        {isCombo ? "⭐ Gói đề xuất — Trọn lộ trình" : "💎 Cam kết hoàn tiền 100%"}
        <div className="animate-hot-pulse absolute right-3 top-1 z-20 flex flex-col items-center gap-1">
          <span className="animate-fire-glow select-none text-7xl leading-none">🔥</span>
          <span
            className="rounded-full px-3 py-1 text-sm font-black uppercase tracking-widest text-white"
            style={{
              background: "linear-gradient(160deg, #ff6500 0%, #ff1a00 55%, #ff8c00 100%)",
              boxShadow:
                "0 0 10px rgba(255,60,0,0.95), 0 0 22px rgba(255,40,0,0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
              textShadow: "0 1px 3px rgba(0,0,0,0.5)",
            }}
          >
            HOT
          </span>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-3">
        <span
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${
            isCombo ? "bg-primary-orange" : "bg-primary-purple"
          }`}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <span className="mb-2 inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-black text-primary-orange shadow-sm">
            {course.badge}
          </span>
          <h3 className="text-xl font-black leading-tight text-text-dark sm:text-2xl">{course.displayName}</h3>
          <p className="mt-1 text-sm font-black text-primary-purple">
            {isCombo ? "Học trọn từ RoboSim đến robot Beta" : "Sata Robo cùng con cam kết đến cùng"}
          </p>
        </div>
      </div>

      <div className="mb-5 flex-1 grid gap-2 text-sm text-text-dark">
        {isCombo ? (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> Bao gồm Robosim Master + Đấu trường Robot
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> {course.sessions} buổi - 90 phút/buổi - Tổng{" "}
              {course.totalDuration}
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> Học trọn gói thay vì mua lẻ từng khóa
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <PriceLine label="Học phí combo" value={CONTACT_PRICE} />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> 5 buổi chuyên sâu
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> 90 phút/buổi - Tổng 7,5 giờ
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <PriceLine label="Học phí" value={CONTACT_PRICE} />
            </div>
            <div className="rounded-2xl bg-white/80 p-4 text-sm font-semibold leading-relaxed text-text-dark">
              Hoàn 100% học phí gói Sata8 nếu đủ điều kiện nhưng không vượt vòng loại.
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => chooseCourse(course.id)}
          className="btn-primary flex-1 px-4 py-3 text-sm"
        >
          {isCombo ? "Chọn gói Combo" : "Tư vấn Sata8"}
        </button>
        <button type="button" onClick={onToggle} className="btn-outline flex-1 px-4 py-3 text-sm" aria-expanded={isOpen}>
          {isCombo ? (isOpen ? "Thu gọn" : "Combo gồm gì?") : isOpen ? "Thu gọn" : "Xem điều kiện"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-5 rounded-2xl border border-white/70 bg-white/85 p-4 animate-fade-in">
          {isCombo ? (
            <div className="grid gap-2">
              {(item.highlights ?? []).map((text) => (
                <div key={text} className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-text-dark">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              {[
                "Điều kiện: phụ huynh đã đăng ký Combo hoặc Robosim Master.",
                "Phạm vi: vòng loại quốc gia / vòng loại cuộc thi Robotics 2026.",
                "Học sinh đi đủ 5/5 buổi chuyên sâu.",
                "Hoàn thành học liệu E-learning được giao.",
                "Nếu đã đi đủ lộ trình mà vẫn không vượt vòng loại, Sata Robo hoàn 100% học phí gói Sata8.",
              ].map((text) => (
                <div key={text} className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-text-dark">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

interface FeaturedProjectsProps {
  productCode: string;
  onOpen: (state: LightboxState) => void;
  paused?: boolean;
}

function FeaturedProjects({ productCode, onOpen, paused = false }: FeaturedProjectsProps) {
  const projects = useMemo(() => toProjects(productCode), [productCode]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (paused || !projects.length) return undefined;
    const timer = setInterval(() => {
      setActive((current) => (current + 1) % projects.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [paused, projects.length]);

  useEffect(() => {
    setActive(0);
  }, [productCode]);

  if (!projects.length) return null;

  const go = (index: number) => {
    const next = (index + projects.length) % projects.length;
    setActive(next);
  };
  const project = projects[active];
  if (!project) return null;

  return (
    <div className="mt-3 rounded-2xl border border-primary-purple/20 bg-white p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-soft-purple text-primary-purple">
          <ImageIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="line-clamp-1 text-xs font-black text-text-dark">Dự án tiêu biểu trong khóa học</div>
          <div className="text-[11px] font-semibold text-text-muted">{active + 1}/5 sản phẩm</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen({ projects, idx: active })}
        className="group relative w-full overflow-hidden rounded-2xl text-left"
        aria-label={`Mở ảnh ${project.title}`}
      >
        {/* `relative` bắt buộc cho <Image fill> — bản gốc dùng <img> nên không có */}
        <div className="relative aspect-[16/10] overflow-hidden bg-gradient-cream">
          <Image
            src={project.image}
            alt={project.title}
            fill
            sizes="(max-width: 1024px) 100vw, 360px"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
          <span className="translate-y-2 rounded-full bg-white px-4 py-2 text-xs font-black text-primary-purple opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100 sm:text-sm">
            Xem chi tiết
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
          <div className="line-clamp-1 text-sm font-black">{project.title}</div>
          <div className="line-clamp-1 text-[11px] text-white/85">{project.caption}</div>
        </div>
      </button>

      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {projects.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onClick={() => go(index)}
            className={`aspect-square overflow-hidden rounded-lg border-2 transition ${
              index === active ? "border-primary-orange shadow-sm" : "border-transparent opacity-70 hover:opacity-100"
            }`}
            aria-label={`Xem dự án ${index + 1}`}
          >
            <Image src={item.image} alt="" width={96} height={96} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onOpen({ projects, idx: active })}
        className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-primary-purple/25 bg-soft-purple px-3 py-2 text-xs font-black text-primary-purple transition hover:bg-primary-purple hover:text-white sm:hidden"
      >
        Xem chi tiết
      </button>
    </div>
  );
}

interface ProjectLightboxProps {
  projects: Project[];
  startIdx: number;
  onClose: () => void;
}

function ProjectLightbox({ projects, startIdx, onClose }: ProjectLightboxProps) {
  // Chỉ mount khi thực sự mở (xem chỗ gọi) — nhờ vậy `useState(startIdx)` chạy lại
  // mỗi lần mở. Bản gốc render vô điều kiện nên lightbox luôn bật ở ảnh 1 dù bấm
  // thumbnail thứ mấy.
  const [idx, setIdx] = useState(startIdx);
  const total = projects.length;
  const project = projects[idx];

  const prev = () => setIdx((i) => (i - 1 + total) % total);
  const next = () => setIdx((i) => (i + 1) % total);

  useEffect(() => {
    if (!total) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setIdx((i) => (i - 1 + total) % total);
      if (event.key === "ArrowRight") setIdx((i) => (i + 1) % total);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [total, onClose]);

  if (!total || !project) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div className="min-w-0">
            <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-primary-orange">
              Dự án {idx + 1} / {total}
            </div>
            <h3 className="line-clamp-1 text-base font-black text-text-dark">{project.title}</h3>
            <p className="line-clamp-1 text-xs text-text-muted">{project.caption}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 transition hover:bg-gray-200"
            aria-label="Đóng ảnh"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Image area */}
        <div className="relative flex-1 overflow-hidden bg-gray-950">
          {/* width/height là kích thước nội tại để Next tính tỉ lệ; chiều cao thật do
              `max-h-[62vh]` quyết định — giữ đúng hành vi co giãn của bản gốc, khung
              cố định sẽ letterbox ảnh thấp. */}
          <Image
            key={project.image}
            src={project.image}
            alt={project.title}
            width={1200}
            height={800}
            sizes="(max-width: 768px) 100vw, 768px"
            className="mx-auto block h-auto max-h-[62vh] w-full object-contain"
          />

          {/* Prev / Next */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/75 active:scale-95"
            aria-label="Ảnh trước"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/75 active:scale-95"
            aria-label="Ảnh tiếp"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>

        {/* Thumbnail strip + dots */}
        <div className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center justify-center gap-1.5 overflow-x-auto">
            {projects.map((item, i) => (
              <button
                key={item.title}
                type="button"
                onClick={() => setIdx(i)}
                className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl border-2 transition ${
                  i === idx
                    ? "border-primary-orange shadow-sm shadow-primary-orange/30"
                    : "border-transparent opacity-50 hover:opacity-90"
                }`}
                aria-label={`Xem dự án ${i + 1}`}
              >
                <Image src={item.image} alt="" width={96} height={96} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-text-muted">← → để điều hướng · Esc để đóng</p>
        </div>
      </div>
    </div>
  );
}

const countModuleProjects = (mod: RoadmapModule): number => {
  const projectSessionNums = new Set([1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  const count = mod.sessionList.filter((session) => projectSessionNums.has(Number(session.num))).length;
  return count || projectSessionNums.size;
};

type TrackId = "exam" | "deep";
type ExamItem = ExamRoadmapItem & { course: Course };

export default function Roadmap5Years({
  courseGroups = staticCourseGroups,
}: { courseGroups?: CourseGroup[] } = {}) {
  const [activeTrack, setActiveTrack] = useState<TrackId>("exam");
  const [openExamIds, setOpenExamIds] = useState<string[]>([]);
  const [openFocusIds, setOpenFocusIds] = useState<string[]>([]);
  const isTabletUp = useMediaQuery("(min-width: 768px)");
  const [yearIdx, setYearIdx] = useState(0);
  const [moduleIdx, setModuleIdx] = useState(0);
  const [lightboxState, setLightboxState] = useState<LightboxState | null>(null);
  const [mobileDropdownOpen, setMobileDropdownOpen] = useState(false);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  const currentYear = roadmap5Years[yearIdx];
  const currentModule = currentYear.modules[moduleIdx];
  const currentMeta = courseMeta[currentYear.productCode] ?? courseMeta.Sata3;
  const CurrentIcon = currentMeta.Icon;

  // courseGroups là prop nên phải tính trong component, không để module scope.
  const examItems = useMemo<ExamItem[]>(() => {
    const allCourses = courseGroups.flatMap((group) => group.courses);
    const getCourse = (id: string): Course | undefined => allCourses.find((course) => course.id === id);
    return examRoadmap
      .map((item) => ({ ...item, course: getCourse(item.id) }))
      .filter((item): item is ExamItem => Boolean(item.course));
  }, [courseGroups]);

  const shortItems = examItems.filter((item) => item.id === "Sata1" || item.id === "Sata2");
  const focusItems = examItems.filter((item) => item.id === "Combo" || item.id === "Sata8");
  const shortOpenIds = isTabletUp && openExamIds.length ? shortItems.map((item) => item.id) : openExamIds;
  const focusOpenIds = isTabletUp && openFocusIds.length ? focusItems.map((item) => item.id) : openFocusIds;

  useEffect(() => {
    const storedYear = readStoredCourseSelection()?.yearIndex;
    if (typeof storedYear === "number" && Number.isInteger(storedYear)) {
      setActiveTrack("deep");
      setYearIdx(storedYear);
      setModuleIdx(0);
    }

    const handleCourseSelected = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CourseSelectionPayload>>).detail;
      const productCode = detail?.productCode;
      const yearIndex = detail?.yearIndex;

      if (
        typeof yearIndex === "number" &&
        Number.isInteger(yearIndex) &&
        yearIndex >= 0 &&
        yearIndex < roadmap5Years.length
      ) {
        setActiveTrack("deep");
        setYearIdx(yearIndex);
        setModuleIdx(0);
        return;
      }

      if (productCode && examRoadmap.some((course) => course.id === productCode)) {
        setActiveTrack("exam");
        setOpenExamIds([]);
        setOpenFocusIds(productCode === "Combo" || productCode === "Sata8" ? [productCode] : []);
      }
    };

    window.addEventListener("sata-course-selected", handleCourseSelected);
    return () => window.removeEventListener("sata-course-selected", handleCourseSelected);
  }, []);

  useEffect(() => {
    if (!mobileDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (mobileDropdownRef.current && !mobileDropdownRef.current.contains(e.target as Node | null))
        setMobileDropdownOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [mobileDropdownOpen]);

  const goPrevModule = () => {
    if (moduleIdx > 0) setModuleIdx(moduleIdx - 1);
    else if (yearIdx > 0) {
      setYearIdx(yearIdx - 1);
      setModuleIdx(roadmap5Years[yearIdx - 1].modules.length - 1);
    }
  };

  const goNextModule = () => {
    if (moduleIdx < currentYear.modules.length - 1) setModuleIdx(moduleIdx + 1);
    else if (yearIdx < roadmap5Years.length - 1) {
      setYearIdx(yearIdx + 1);
      setModuleIdx(0);
    }
  };

  const visibleSkills = currentYear.yearSkills.slice(0, 6);
  const currentModuleProjects = countModuleProjects(currentModule);

  const tabs: Array<{ id: TrackId; title: string; subtitle: string }> = [
    { id: "exam", title: "Khóa luyện thi", subtitle: "RoboSim, Beta, Combo, Vé Vàng" },
    { id: "deep", title: "Khóa chuyên sâu 48 buổi", subtitle: "Lộ trình 5 năm Sata3-Sata7" },
  ];

  return (
    <section id="roadmap" className="section-padding bg-white">
      <div className="container-site">
        <div className="mx-auto mb-8 max-w-4xl text-center sm:mb-10">
          <div className="badge-purple mb-4">
            <Trophy className="h-4 w-4" />
            LỘ TRÌNH ĐÀO TẠO
          </div>
          <h2 className="heading-2 mb-4 text-text-dark">
            Lộ trình học Robotics tại <span className="text-gradient-orange-purple">Sata Robo</span>
          </h2>
          <p className="mx-auto max-w-3xl text-base leading-relaxed text-text-muted sm:text-lg">
            Phụ huynh có thể chọn khóa luyện thi Robotics 2026 hoặc lộ trình chuyên sâu 48 buổi theo lớp của con.
          </p>
        </div>

        <div className="mx-auto mb-8 grid max-w-3xl grid-cols-1 gap-3 rounded-2xl bg-gray-50 p-2 sm:grid-cols-2">
          {tabs.map((tab) => {
            const active = activeTrack === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTrack(tab.id)}
                className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                  active
                    ? "border-primary-orange bg-gradient-orange-purple text-white shadow-orange-glow"
                    : "border-transparent bg-white text-text-dark hover:border-primary-orange/40"
                }`}
              >
                <div className="text-base font-black">{tab.title}</div>
                <div className={`text-xs font-semibold ${active ? "text-white/85" : "text-text-muted"}`}>
                  {tab.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {activeTrack === "exam" && (
          <div className="animate-fade-in">
            <div className="mx-auto mb-6 max-w-3xl text-center">
              <h3 className="mb-2 text-2xl font-black text-text-dark">Khóa luyện thi Robotics 2026</h3>
              <p className="text-sm leading-relaxed text-text-muted sm:text-base">
                Dành cho học sinh cần luyện thi ngắn hạn, tập trung vào RoboSim, robot Beta và chiến thuật thi đấu.
              </p>
            </div>

            <div className="mb-5 grid items-start gap-5 lg:grid-cols-2">
              {shortItems.map((item) => (
                <ExamCourseCard
                  key={item.id}
                  item={item}
                  course={item.course}
                  isOpen={shortOpenIds.includes(item.id)}
                  onToggle={() =>
                    setOpenExamIds((current) => {
                      if (isTabletUp) return current.length ? [] : shortItems.map((courseItem) => courseItem.id);
                      return current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id];
                    })
                  }
                />
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {focusItems.map((item) => (
                <FocusCourseBox
                  key={item.id}
                  item={item}
                  course={item.course}
                  isOpen={focusOpenIds.includes(item.id)}
                  onToggle={() =>
                    setOpenFocusIds((current) => {
                      if (isTabletUp) return current.length ? [] : focusItems.map((courseItem) => courseItem.id);
                      return current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id];
                    })
                  }
                />
              ))}
            </div>
          </div>
        )}

        {activeTrack === "deep" && (
          <div className="animate-fade-in">
            {/* Mobile: custom dropdown */}
            <div className="relative mb-6 md:hidden" ref={mobileDropdownRef}>
              {/* Trigger */}
              <button
                type="button"
                onClick={() => setMobileDropdownOpen((v) => !v)}
                className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3.5 text-left transition-all ${
                  mobileDropdownOpen
                    ? "border-primary-orange bg-soft-cream shadow-orange-glow"
                    : "border-primary-orange/40 bg-soft-cream hover:border-primary-orange"
                }`}
                aria-haspopup="listbox"
                aria-expanded={mobileDropdownOpen}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${currentMeta.activeWrap}`}
                  >
                    <CurrentIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wider text-primary-orange">
                      Đang xem · Sata{currentYear.year + 2}
                    </div>
                    <div className="text-base font-black leading-tight text-text-dark">{currentYear.productName}</div>
                    <div className="text-xs text-text-muted">{currentYear.grade}</div>
                  </div>
                </div>
                <ChevronDown
                  className={`h-5 w-5 flex-shrink-0 text-primary-orange transition-transform duration-200 ${
                    mobileDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Panel */}
              {mobileDropdownOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-fade-in"
                >
                  <div className="border-b border-gray-100 px-4 py-2.5">
                    <p className="text-xs font-bold text-text-muted">Chọn khóa học — 5 cấp độ từ lớp 1 đến lớp 8</p>
                  </div>
                  {roadmap5Years.map((year, i) => {
                    const meta = courseMeta[year.productCode] ?? courseMeta.Sata3;
                    const Icon = meta.Icon;
                    const active = i === yearIdx;
                    return (
                      <button
                        key={year.productCode}
                        role="option"
                        aria-selected={active}
                        type="button"
                        onClick={() => {
                          setYearIdx(i);
                          setModuleIdx(0);
                          setMobileDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                          active ? "bg-soft-cream" : "hover:bg-gray-50"
                        } ${i < roadmap5Years.length - 1 ? "border-b border-gray-100" : ""}`}
                      >
                        <span
                          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
                            active ? meta.activeWrap : meta.iconWrap
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase text-primary-orange">Sata{year.year + 2}</span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-text-muted">
                              {year.grade}
                            </span>
                          </div>
                          <div
                            className={`text-sm font-black leading-tight ${
                              active ? "text-primary-orange" : "text-text-dark"
                            }`}
                          >
                            {year.productName}
                          </div>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Desktop: horizontal scroll */}
            <div className="mb-8 hidden justify-center overflow-x-auto py-2 md:flex">
              <div className="flex min-w-max gap-3 px-1">
                {roadmap5Years.map((year, idx) => {
                  const meta = courseMeta[year.productCode] ?? courseMeta.Sata3;
                  const Icon = meta.Icon;
                  return (
                    <button
                      key={year.productCode}
                      type="button"
                      onClick={() => {
                        setYearIdx(idx);
                        setModuleIdx(0);
                      }}
                      className={`min-w-[170px] rounded-2xl border-2 p-3 text-left transition ${
                        idx === yearIdx
                          ? "border-primary-orange bg-soft-cream shadow-orange-glow"
                          : "border-gray-200 bg-white hover:border-primary-orange/50"
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-lg ${
                            idx === yearIdx ? meta.activeWrap : meta.iconWrap
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="text-xs font-black uppercase text-primary-orange">Sata{year.year + 2}</span>
                      </div>
                      <div className="text-sm font-black leading-tight text-text-dark">{year.productName}</div>
                      <div className="mt-1 text-xs text-text-muted">{year.grade}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-8 rounded-3xl border-2 border-primary-orange/20 bg-gradient-to-br from-white via-soft-cream to-soft-purple/60 p-5 shadow-card sm:p-7 lg:p-8">
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${currentMeta.activeWrap}`}>
                      <CurrentIcon className="h-6 w-6" />
                    </span>
                    <span className="badge-orange">Sata{currentYear.year + 2}</span>
                    <span className="text-sm font-semibold text-text-muted">{currentYear.grade}</span>
                  </div>
                  <h3 className="mb-3 text-2xl font-black leading-tight text-text-dark sm:text-3xl">
                    {currentYear.productName}
                  </h3>
                  <div className="mb-4 inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-black text-primary-orange shadow-sm">
                    {currentYear.totalSessions} buổi - {currentYear.durationPerSession}/buổi - Tổng{" "}
                    {currentYear.totalDuration}
                  </div>
                  <p className="mb-5 text-sm leading-relaxed text-text-dark/80 sm:text-base">{currentYear.description}</p>

                  <div className="mb-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-primary-orange/20 bg-white/90 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-primary-orange">
                        <FlaskConical className="h-4 w-4" />
                        Thiết bị học cụ
                      </div>
                      <p className="text-sm leading-relaxed text-text-dark">{currentYear.device}</p>
                    </div>
                    <div className="rounded-2xl border border-primary-purple/20 bg-white/90 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-primary-purple">
                        <Sparkles className="h-4 w-4" />
                        Sứ mệnh khóa học
                      </div>
                      <p className="text-sm leading-relaxed text-text-dark">{currentYear.mission}</p>
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary-orange" />
                      <span className="text-sm font-black text-text-dark sm:text-base">
                        Kỹ năng con đạt được sau năm học
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {visibleSkills.map((skill) => (
                        <span
                          key={skill}
                          className="flex items-center gap-1.5 rounded-2xl border border-primary-purple/20 bg-white px-3 py-2 text-[11px] font-bold leading-tight text-primary-purple shadow-sm sm:text-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-success" />
                          <span className="line-clamp-1">{skill}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => chooseCourse(currentYear.productCode, { yearIndex: yearIdx })}
                    className="btn-primary w-full sm:w-auto"
                  >
                    Chọn khóa này
                  </button>
                </div>

                <aside className="h-fit rounded-3xl border border-primary-purple/20 bg-white/95 p-5 shadow-card lg:col-span-4">
                  <div className="mb-4 text-xs font-black uppercase tracking-wider text-primary-purple">Học phí</div>
                  <div className="space-y-2 rounded-2xl bg-gray-50 p-4">
                    <PriceLine label="Học phí khóa học" value={CONTACT_PRICE} />
                  </div>
                  <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm">
                    <div className="font-black text-success">Hỗ trợ trả góp</div>
                    <div className="mt-1 text-text-dark">
                      <strong>{CONTACT_PRICE}</strong> cho Sata3-Sata7
                    </div>
                  </div>
                  <FeaturedProjects
                    productCode={currentYear.productCode}
                    onOpen={setLightboxState}
                    paused={Boolean(lightboxState)}
                  />
                </aside>
              </div>
            </div>

            <div className="mb-6 flex items-center justify-between px-2">
              {currentYear.modules.map((mod, idx) => (
                <div key={mod.id} className="flex flex-1 items-center last:flex-initial">
                  <button
                    type="button"
                    onClick={() => setModuleIdx(idx)}
                    className={`flex flex-col items-center transition ${
                      idx === moduleIdx ? "scale-110" : "opacity-65 hover:opacity-100"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-black sm:h-12 sm:w-12 ${
                        idx === moduleIdx
                          ? "bg-primary-orange text-white shadow-orange-glow"
                          : idx < moduleIdx
                            ? "bg-success text-white"
                            : "bg-gray-200 text-text-muted"
                      }`}
                    >
                      {idx < moduleIdx ? "✓" : idx + 1}
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-text-dark sm:text-xs">HP{idx + 1}</div>
                  </button>
                  {idx < currentYear.modules.length - 1 && (
                    <div className={`mx-1 h-0.5 flex-1 sm:mx-2 ${idx < moduleIdx ? "bg-success" : "bg-gray-200"}`} />
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
              <div className="hidden space-y-3 lg:col-span-4 lg:block">
                {currentYear.modules.map((mod, idx) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setModuleIdx(idx)}
                    className={`block w-full rounded-xl border-2 p-4 text-left transition ${
                      idx === moduleIdx
                        ? "border-primary-orange bg-soft-cream shadow-orange-glow"
                        : "border-gray-200 bg-white hover:border-primary-orange/50"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="badge-orange text-xs">HP {idx + 1}</span>
                      <span className="text-xs font-semibold text-text-muted">
                        {mod.sessions} buổi - {mod.durationPerSession}/buổi
                      </span>
                    </div>
                    <h4 className="mb-2 font-black leading-tight text-text-dark">{mod.name}</h4>
                    <p className="line-clamp-2 text-xs text-text-muted">{mod.description}</p>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-8" key={`${yearIdx}-${moduleIdx}`}>
                <div className="card-base border-2 border-primary-orange/20 p-5 sm:p-7">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="badge-orange">
                      <Target className="h-3 w-3" /> {currentModule.id}
                    </span>
                    <span className="badge-purple">
                      Năm {currentYear.year} - {currentYear.grade}
                    </span>
                  </div>
                  <h4 className="mb-3 text-xl font-black text-text-dark sm:text-2xl">{currentModule.name}</h4>
                  <p className="mb-5 text-sm leading-relaxed text-text-muted sm:text-base">{currentModule.description}</p>

                  <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="rounded-xl bg-soft-cream p-3 text-center">
                      <BookOpen className="mx-auto mb-1 h-5 w-5 text-primary-orange" />
                      <div className="text-base font-black text-text-dark sm:text-lg">{currentModule.sessions}</div>
                      <div className="text-[11px] text-text-muted">Buổi học</div>
                    </div>
                    <div className="rounded-xl bg-soft-purple p-3 text-center">
                      <Clock className="mx-auto mb-1 h-5 w-5 text-primary-purple" />
                      <div className="text-base font-black text-text-dark sm:text-lg">{currentModule.hours}</div>
                      <div className="text-[11px] text-text-muted">Giờ học</div>
                    </div>
                    <div className="rounded-xl bg-yellow-50 p-3 text-center">
                      <Bot className="mx-auto mb-1 h-5 w-5 text-violet-600" />
                      <div className="text-base font-black text-text-dark sm:text-lg">{currentModuleProjects}</div>
                      <div className="text-[11px] text-text-muted">Dự án</div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-2">
                      <ListOrdered className="h-4 w-4 text-primary-orange" />
                      <span className="text-sm font-bold text-text-dark sm:text-base">Nội dung chi tiết 12 buổi</span>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {currentModule.sessionList.map((session, index) => (
                        <div
                          key={`${session.num}-${session.content}`}
                          className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${
                            index % 2 === 0 ? "bg-gray-50" : "bg-white"
                          }`}
                        >
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-orange/10 text-xs font-black text-primary-orange">
                            {session.num}
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-text-dark">{session.content}</span>
                          <span className="flex-shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-bold text-text-muted sm:text-xs">
                            {session.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border-2 border-yellow-200 bg-gradient-to-r from-yellow-50 to-orange-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-yellow-400">
                        <Award className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-bold text-yellow-800">
                          Sản phẩm / thành tích cuối học phần
                        </div>
                        <div className="text-sm leading-relaxed text-text-dark">{currentModule.achievement}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-2 border-t border-gray-200 pt-5">
                    <button
                      type="button"
                      onClick={goPrevModule}
                      disabled={yearIdx === 0 && moduleIdx === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl border-2 border-gray-200 bg-soft-cream px-4 py-2.5 text-sm font-bold text-text-dark transition hover:border-primary-orange hover:text-primary-orange disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Trước
                    </button>
                    <span className="px-2 text-xs font-semibold text-text-muted">HP {moduleIdx + 1} / 4</span>
                    <button
                      type="button"
                      onClick={goNextModule}
                      disabled={yearIdx === 4 && moduleIdx === 3}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary-orange px-4 py-2.5 text-sm font-bold text-white shadow-orange-glow transition hover:bg-primary-orange-dark disabled:opacity-30"
                    >
                      Tiếp theo
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {lightboxState && (
        <ProjectLightbox
          projects={lightboxState.projects}
          startIdx={lightboxState.idx}
          onClose={() => setLightboxState(null)}
        />
      )}
    </section>
  );
}
