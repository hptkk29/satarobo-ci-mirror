import Image from "next/image";
import Link from "next/link";
import { CATEGORY_META } from "@/lib/honors/category-meta";
import { getHonorView, type HonorWithEmployee } from "@/lib/honors/honor-view";

interface HonorCardProps {
  honor: HonorWithEmployee;
  variant?: "compact" | "tall";
}

export function HonorCard({ honor, variant = "compact" }: HonorCardProps) {
  const meta = CATEGORY_META[honor.category];
  const Icon = meta.icon;
  const view = getHonorView(honor);

  return (
    <Link
      href={`/vinh-danh/${honor.slug}`}
      className="group block bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all border border-gray-100"
    >
      <div
        className={`relative w-full bg-gradient-to-br from-purple-100 to-orange-100 ${
          variant === "tall" ? "aspect-[3/4]" : "aspect-square"
        }`}
      >
        {view.avatarUrl ? (
          <Image
            src={view.avatarUrl}
            alt={view.fullName}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-7xl font-bold text-white"
            style={{ backgroundColor: meta.accentColor }}
          >
            {view.fullName.charAt(0)}
          </div>
        )}

        <div
          className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm"
          style={{ backgroundColor: `${meta.bgColor}E6`, color: meta.textColor }}
        >
          <Icon className="w-3.5 h-3.5" />
          {meta.title}
        </div>
      </div>

      <div className="p-5">
        <p className="text-xs text-orange-600 font-semibold mb-1 uppercase tracking-wider">
          {honor.awardName}
        </p>
        <h3 className="text-lg font-bold mb-1 group-hover:text-orange-600 transition-colors line-clamp-1">
          {view.fullName}
        </h3>
        <p className="text-sm text-gray-600 line-clamp-1">{view.jobTitle}</p>
        {honor.shortBio && (
          <p className="text-sm text-gray-700 mt-3 line-clamp-3 leading-relaxed">
            {honor.shortBio}
          </p>
        )}
      </div>
    </Link>
  );
}
