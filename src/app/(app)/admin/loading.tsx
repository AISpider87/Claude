import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <PageSkeleton stats={0} rows={6} />;
}
