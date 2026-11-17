import GroupDetailsSkeleton from "@/components/GroupDetailsSkeleton";

export default function Loading() {
  return (
    <main className="manemi-detail-page">
      <div className="manemi-detail-content">
        <GroupDetailsSkeleton />
      </div>
    </main>
  );
}
