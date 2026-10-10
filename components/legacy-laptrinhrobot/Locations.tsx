"use client";

// Phase 4.UI.RESET.1 — grid auto-fits số ops centers (currently 2). Khi mở thêm cơ sở,
// chỉ cần add vào _data/locations.ts; grid sẽ tự rộng ra.

import { locations } from "./_data/locations";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { ArrowRight, MapPin, MessageCircle } from "lucide-react";

export default function Locations() {
  const operational = locations.filter((l) => !l.isUpcoming);
  const upcoming = locations.filter((l) => l.isUpcoming);

  return (
    <section id="locations" className="section-padding bg-white">
      <div className="container-site">
        <div className="text-center mb-10 sm:mb-14 max-w-3xl mx-auto">
          <div className="badge-purple mb-4">
            <MapPin className="w-4 h-4" />
            ĐỊA ĐIỂM HỌC
          </div>
          <h2 className="heading-2 mb-4">
            <span className="text-gradient-orange-purple">
              {operational.length} ĐỊA CHỈ HỌC TẠI ĐÀ NẴNG
            </span>
            <br />
            <span className="text-text-dark text-2xl sm:text-3xl">— CHỌN GẦN NHÀ NHẤT</span>
          </h2>
          <p className="text-base sm:text-lg text-text-muted">
            Bố mẹ chọn trung tâm gần nhà — con không tốn thời gian di chuyển,
            bố mẹ đưa đón thuận tiện hơn.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 mb-8 max-w-3xl mx-auto">
          {operational.map((loc) => (
            <div
              key={loc.id}
              className={`card-base p-5 sm:p-6 border-2 transition flex flex-col ${
                loc.isHQ ? "border-primary-orange shadow-orange-glow" : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-4">
                <div
                  className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                    loc.isHQ ? "bg-primary-orange text-white" : "bg-soft-purple text-primary-purple"
                  }`}
                >
                  <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                {/* Badge "Trụ sở" đã gỡ theo hướng dẫn BCT. Cờ isHQ giữ nguyên. */}
              </div>

              <h3 className="font-extrabold text-base sm:text-lg text-text-dark leading-snug mb-2 flex-1">
                {loc.address}
              </h3>
              {loc.note && (
                <p className="text-sm text-primary-purple mb-4">
                  {loc.note}
                </p>
              )}

              <button
                onClick={() => {
                  const select = document.querySelector<HTMLSelectElement>('select[name="center"]');
                  if (select) {
                    select.value = loc.address;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                  document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="w-full py-2.5 sm:py-3 bg-primary-orange/10 text-primary-orange font-bold text-sm rounded-lg
                  hover:bg-primary-orange hover:text-white transition inline-flex items-center justify-center gap-2 mt-auto"
              >
                Chọn địa chỉ này
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {upcoming.length > 0 && (
          <div className="max-w-5xl mx-auto mb-10">
            <p className="text-center text-xs sm:text-sm text-text-muted mb-3 uppercase tracking-wider font-bold">
              Cơ sở sắp khai trương
            </p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {upcoming.map((loc) => (
                <div
                  key={loc.id}
                  className="card-base p-3 sm:p-4 border-2 border-dashed border-amber-300 bg-amber-50/40 flex flex-col"
                >
                  <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 text-amber-600">
                      <MapPin className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-500 text-white text-[9px] sm:text-xs font-bold rounded-full">
                      Sắp mở
                    </span>
                  </div>
                  <h3 className="font-extrabold text-[11px] sm:text-base text-text-dark leading-snug mb-1">
                    {loc.address}
                  </h3>
                  <p className="text-[10px] sm:text-sm text-amber-700 font-bold">
                    {loc.workingHours}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto bg-soft-purple rounded-2xl p-5 text-center border-2 border-primary-purple/20">
          <p className="text-sm sm:text-base text-text-dark mb-3">
            💡 <strong>Bố mẹ chưa chắc trung tâm nào thuận tiện?</strong>
          </p>
          <p className="text-xs sm:text-sm text-text-muted mb-4">
            Inbox Zalo — Sata Robo gợi ý trung tâm gần nhà nhất theo địa chỉ bố mẹ cho.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={SATA_ROBO_PHONE.zalo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-purple text-white font-bold text-sm rounded-lg
                hover:bg-primary-purple-dark transition"
            >
              <MessageCircle className="w-4 h-4" />
              Chat Zalo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
