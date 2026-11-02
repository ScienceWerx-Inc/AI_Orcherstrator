export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-white/5" />
      <div className="h-4 w-96 rounded bg-white/5" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl border border-white/10 bg-white/[0.03]" />
        ))}
      </div>
      <div className="h-72 rounded-xl border border-white/10 bg-white/[0.03]" />
      <div className="h-52 rounded-xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}
