import { BackgroundGradient } from "@/components/aceternity/background-gradient";
import { ShimmerButton } from "@/components/magic/shimmer-button";

// /test-ui — Sata Robo UI library smoke test page (F-UI-1).
// Will be removed (or repurposed as internal style guide) once F-UI-2/3/4
// ship real client sections built on these foundations.
export const dynamic = "force-static";

export const metadata = {
  title: "Sata Robo — UI Library Test",
  robots: { index: false, follow: false },
};

export default function TestUiPage() {
  return (
    <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <div className="mx-auto max-w-5xl space-y-12">
        <header>
          <p className="text-xs uppercase tracking-wider text-zinc-400">
            F-UI-1 · foundation smoke test
          </p>
          <h1 className="mt-2 text-3xl font-bold text-gradient-warm">
            Sata Robo UI Library Test
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Verifying Aceternity-style BackgroundGradient · existing Magic UI
            ShimmerButton · HyperUI stat cards · Sata gradient utilities. No
            production traffic — robots blocked via metadata.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            1. Aceternity — BackgroundGradient (Sata palette)
          </h2>
          <div className="max-w-sm">
            <BackgroundGradient className="rounded-3xl bg-white p-6">
              <p className="text-base font-semibold text-neutral-900">
                Khoá học Lập trình Robot
              </p>
              <p className="mt-2 text-sm text-neutral-600">
                2 cơ sở Đà Nẵng · 60 buổi · Cam kết hoàn 100% nếu HS không hài
                lòng.
              </p>
              <p className="mt-3 text-xl font-bold text-gradient-warm">
                Liên hệ
              </p>
            </BackgroundGradient>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            2. Magic UI — ShimmerButton (Sata warm gradient)
          </h2>
          <div className="flex flex-wrap gap-3">
            <ShimmerButton
              background="linear-gradient(135deg, #F97316 0%, #EAB308 100%)"
              className="px-6 py-3 shadow-2xl"
            >
              <span className="whitespace-pre-wrap text-center text-sm font-medium leading-none tracking-tight text-white">
                Đăng ký tư vấn
              </span>
            </ShimmerButton>
            <ShimmerButton
              background="linear-gradient(135deg, #F97316 0%, #A855F7 100%)"
              className="px-6 py-3 shadow-2xl"
            >
              <span className="whitespace-pre-wrap text-center text-sm font-medium leading-none tracking-tight text-white">
                Khám phá khoá học
              </span>
            </ShimmerButton>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            3. HyperUI — Stat cards (inline, no extra dep)
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <article className="rounded-lg border border-zinc-200 bg-white p-6">
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-orange-100 p-3 text-2xl">
                  🎓
                </span>
                <div>
                  <p className="text-2xl font-bold text-neutral-900">1,000+</p>
                  <p className="text-sm text-neutral-500">Học viên</p>
                </div>
              </div>
            </article>
            <article className="rounded-lg border border-zinc-200 bg-white p-6">
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-purple-100 p-3 text-2xl">
                  🏫
                </span>
                <div>
                  <p className="text-2xl font-bold text-neutral-900">2</p>
                  <p className="text-sm text-neutral-500">Cơ sở Đà Nẵng</p>
                </div>
              </div>
            </article>
            <article className="rounded-lg border border-zinc-200 bg-white p-6">
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-yellow-100 p-3 text-2xl">
                  ⭐
                </span>
                <div>
                  <p className="text-2xl font-bold text-neutral-900">4.9/5</p>
                  <p className="text-sm text-neutral-500">Đánh giá PH</p>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            4. Gradient utilities
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="bg-gradient-sata-warm rounded-xl p-6 text-white">
              <p className="text-xs uppercase tracking-wider opacity-90">
                bg-gradient-sata-warm
              </p>
              <p className="mt-1 text-lg font-bold">Orange → Yellow</p>
            </div>
            <div className="bg-gradient-sata-tech rounded-xl p-6 text-white">
              <p className="text-xs uppercase tracking-wider opacity-90">
                bg-gradient-sata-tech
              </p>
              <p className="mt-1 text-lg font-bold">Orange → Purple</p>
            </div>
            <div className="bg-gradient-sata-cool rounded-xl p-6 text-white">
              <p className="text-xs uppercase tracking-wider opacity-90">
                bg-gradient-sata-cool
              </p>
              <p className="mt-1 text-lg font-bold">Violet → Purple</p>
            </div>
          </div>
          <div className="space-y-2 text-3xl font-bold">
            <p className="text-gradient-warm">text-gradient-warm: SATA ROBO</p>
            <p className="text-gradient-tech">text-gradient-tech: ROBOTICS</p>
          </div>
        </section>

        <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          Mobile responsive: open DevTools, force 375px. All sections should
          stack and remain readable. Remove this page once F-UI-2/3/4 ship.
        </footer>
      </div>
    </main>
  );
}
