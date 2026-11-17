export default function NoAccess() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="font-sans text-2xl font-semibold">Geen toegang</h1>
      <p className="mt-2 text-sm text-taupe">Uw rol heeft geen toegang tot deze module. Vraag een administrator om de juiste rechten.</p>
    </div>
  );
}
