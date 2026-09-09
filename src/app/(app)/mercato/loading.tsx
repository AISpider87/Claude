import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <PageSkeleton stats={3} rows={6} />;
}
