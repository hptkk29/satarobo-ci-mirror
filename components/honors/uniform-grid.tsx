import { HonorCard } from "./honor-card";
import type { HonorWithEmployee } from "@/lib/honors/honor-view";

interface HonorUniformGridProps {
  honors: HonorWithEmployee[];
}

export function HonorUniformGrid({ honors }: HonorUniformGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {honors.map((honor) => (
        <HonorCard key={honor.id} honor={honor} variant="compact" />
      ))}
    </div>
  );
}
