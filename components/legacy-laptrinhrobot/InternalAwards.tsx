"use client";

import { internalAwards as staticAwards, type InternalAwards as InternalAwardsType } from "./_data/awards";
import { Medal, Trophy } from "lucide-react";

export default function InternalAwards({
  internalAwards = staticAwards,
}: {
  internalAwards?: InternalAwardsType;
} = {}) {
  return (
    <section id="awards" className="section-padding bg-soft-cream">
      <div className="container-site">
        <div className="mb-8 text-center sm:mb-14">
          <div className="badge-orange mb-4">
            <Trophy className="h-4 w-4" />
            GIẢI THƯỞNG NỘI BỘ
          </div>
          <h2 className="heading-2 mb-4">
            Sata Robo Championship
            <br className="hidden sm:block" />
            <span className="text-gradient-orange-purple">{internalAwards.totalValue} giải thưởng mỗi năm</span>
          </h2>
          <p className="mx-auto max-w-2xl text-base text-text-muted sm:text-lg">
            {internalAwards.description}
          </p>
        </div>

        <div className="mx-auto mb-8 max-w-2xl rounded-2xl bg-gradient-orange-purple p-5 text-center text-white shadow-xl sm:mb-10 sm:p-10">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider opacity-90 sm:mb-2 sm:text-sm">
            Tổng giá trị giải thưởng / năm
          </div>
          <div className="mb-1 text-3xl font-black drop-shadow sm:mb-2 sm:text-6xl">{internalAwards.totalValue}</div>
          <div className="text-xs opacity-95 sm:text-base">
            {internalAwards.perYear} kỳ x {internalAwards.perEvent} / kỳ - dành riêng cho học viên Sata Robo
          </div>
        </div>

        <div className="card-base mx-auto mb-10 max-w-4xl overflow-hidden sm:mb-14">
          <div className="overflow-x-auto">
            <table className="w-full text-sm sm:text-base">
              <thead>
                <tr className="border-b-2 border-primary-orange/20 bg-soft-yellow">
                  <th className="px-3 py-3 text-left text-xs font-black uppercase text-text-dark sm:px-6 sm:py-4 sm:text-sm">Hạng mục</th>
                  <th className="px-3 py-3 text-left text-xs font-black uppercase text-text-dark sm:px-6 sm:py-4 sm:text-sm">Giải thưởng</th>
                  <th className="hidden px-4 py-4 text-left text-xs font-black uppercase text-text-dark sm:table-cell sm:px-6 sm:text-sm">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {internalAwards.prizes.map((p, idx) => (
                  <tr key={p.rank} className={`border-b border-gray-100 transition hover:bg-soft-cream ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                    <td className="px-3 py-3 sm:px-6 sm:py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl sm:text-3xl">{p.icon}</span>
                        <span className="text-xs font-bold text-text-dark sm:text-base">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 sm:px-6 sm:py-4">
                      <span className="text-sm font-black text-primary-orange sm:text-lg">{p.reward}</span>
                    </td>
                    <td className="hidden px-4 py-4 text-xs text-text-muted sm:table-cell sm:px-6 sm:text-sm">{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mx-auto max-w-3xl rounded-xl border-l-4 border-primary-orange bg-white p-5 shadow-md sm:p-8">
          <div className="flex items-start gap-3">
            <Medal className="mt-1 h-6 w-6 flex-shrink-0 text-primary-orange" />
            <div>
              <p className="mb-2 text-sm leading-relaxed text-text-dark sm:text-base">
                Các giải thưởng này <strong>không phải để khoe</strong>.
              </p>
              <p className="text-sm leading-relaxed text-text-dark sm:text-base">
                Đây là <strong className="text-primary-orange">minh chứng</strong> cho cách Sata Robo tạo động lực học tập và thuyết trình đều đặn cho con.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
