"use client";

import { useState, useEffect, useRef } from "react";
import { Lightbulb, FolderOpen, Award, type LucideIcon } from "lucide-react";

interface Method {
  icon: LucideIcon;
  iconBg: string;
  title: string;
  description: string;
}

const methods: Method[] = [
  { icon: Lightbulb, iconBg: "bg-yellow-100 text-yellow-600", title: "ODAMPCA", description: "Quy trình học Robotics theo chu trình quan sát, xác định vấn đề, phân tích, thiết kế giải pháp, thực hành, kiểm thử và cải tiến sản phẩm." },
  { icon: FolderOpen, iconBg: "bg-purple-100 text-primary-purple", title: "PROJECT-BASED LEARNING", description: "Học viên xác định vấn đề, đề xuất giải pháp và thực hiện dự án thực tế với mẫu giải pháp, kiểm thử và hoàn thiện." },
  { icon: Award, iconBg: "bg-orange-100 text-primary-orange", title: "MASTERY LEARNING", description: "Học viên được hỗ trợ đạt mức độ thành thạo cụ thể về kiến thức và kỹ năng trước khi chuyển sang bước tiếp theo." },
];

export default function TeachingMethod() {
  const [activeIdx, setActiveIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const startAuto = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % methods.length);
    }, 3200);
  };

  useEffect(() => {
    startAuto();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setActiveIdx((i) => (i + 1) % methods.length);
      else setActiveIdx((i) => (i - 1 + methods.length) % methods.length);
      startAuto();
    }
    touchStartX.current = null;
  };

  return (
    <section className="section-padding bg-soft-cream">
      <div className="container-site">
        <div className="text-center mb-10 sm:mb-14 max-w-3xl mx-auto">
          <div className="badge-orange mb-4">PHƯƠNG PHÁP ĐỘC QUYỀN</div>
          <h2 className="heading-2 mb-4">
            <span className="text-gradient-orange-purple">PHƯƠNG PHÁP GIẢNG DẠY ĐỘC QUYỀN</span>
          </h2>
          <p className="text-base sm:text-lg text-text-muted">
            Học viện Sata Robo kết hợp <strong>3 phương pháp giảng dạy tiên tiến</strong>,
            giữ ưu điểm của mô hình truyền thống và tích hợp công nghệ hiện đại.
          </p>
        </div>

        <div className="hidden md:grid grid-cols-3 gap-5 sm:gap-6 max-w-6xl mx-auto mb-10">
          {methods.map((method, idx) => {
            const Icon = method.icon;
            return (
              <div key={idx} className="card-base p-6 sm:p-7 text-center">
                <div className={`inline-flex w-16 h-16 rounded-2xl items-center justify-center mb-4 ${method.iconBg}`}>
                  <Icon className="w-8 h-8" strokeWidth={2.5} />
                </div>
                <h3 className="font-extrabold text-base sm:text-lg text-text-dark mb-3">{method.title}</h3>
                <p className="text-sm sm:text-base text-text-muted leading-relaxed">{method.description}</p>
              </div>
            );
          })}
        </div>

        <div className="md:hidden mb-8 relative overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${activeIdx * 100}%)` }}>
            {methods.map((method, idx) => {
              const Icon = method.icon;
              return (
                <div key={idx} className="min-w-full px-1">
                  <div className="card-base p-6 text-center">
                    <div className={`inline-flex w-16 h-16 rounded-2xl items-center justify-center mb-4 ${method.iconBg}`}>
                      <Icon className="w-8 h-8" strokeWidth={2.5} />
                    </div>
                    <h3 className="font-extrabold text-base text-text-dark mb-3">{method.title}</h3>
                    <p className="text-sm text-text-muted leading-relaxed">{method.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center gap-2 mt-4">
            {methods.map((_, idx) => (
              <button
                key={idx}
                onClick={() => { setActiveIdx(idx); startAuto(); }}
                className={`h-2 rounded-full transition-all duration-300 ${idx === activeIdx ? "w-6 bg-primary-orange" : "w-2 bg-gray-300"}`}
              />
            ))}
          </div>
        </div>

        <div className="max-w-3xl mx-auto bg-white rounded-2xl border-2 border-primary-purple/30 p-5 sm:p-6 text-center shadow-card">
          <p className="text-base sm:text-lg text-text-dark leading-relaxed">
            <strong>3 phương pháp này đảm bảo:</strong> Con KHÔNG học để đối phó.<br />
            Con học để <span className="text-primary-orange font-bold">THẬT SỰ HIỂU</span> và{" "}
            <span className="text-primary-purple font-bold">THẬT SỰ LÀM ĐƯỢC.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
