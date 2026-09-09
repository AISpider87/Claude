import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <PageSkeleton stats={4} rows={8} />;
}
