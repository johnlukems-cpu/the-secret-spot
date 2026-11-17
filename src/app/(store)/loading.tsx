export default function Loading() {
  return (
    <div className="container py-10" aria-busy="true" aria-label="Laden">
      <div className="h-10 w-64 animate-pulse bg-cream" />
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse bg-cream" />)}
      </div>
    </div>
  );
}
