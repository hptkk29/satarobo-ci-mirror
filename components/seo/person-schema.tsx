import { getHonorView, type HonorWithEmployee } from "@/lib/honors/honor-view";
import { jsonLdScript } from '@/lib/seo/jsonld'

const BASE_URL = "https://satarobo.vn";

export function PersonSchema({ honor }: { honor: HonorWithEmployee }) {
  const view = getHonorView(honor);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: view.fullName,
    jobTitle: view.jobTitle,
    worksFor: {
      "@type": "Organization",
      name: "Sata Robo",
      url: BASE_URL,
    },
    award: [honor.awardName],
    description: honor.shortBio ?? undefined,
    url: `${BASE_URL}/vinh-danh/${honor.slug}`,
  };
  if (view.avatarUrl) schema.image = view.avatarUrl;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(schema) }}
    />
  );
}
