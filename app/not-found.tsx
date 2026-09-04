export default function NotFound() {
  return (
    <div className="min-h-[70vh] grid place-items-center px-6 pt-24 text-center">
      <div>
        <p className="font-display font-bold text-[26vw] sm:text-[10rem] leading-none text-stroke select-none">404</p>
        <h1 className="font-display font-bold text-2xl sm:text-3xl -mt-3">This wall fell off.</h1>
        <p className="mt-3 text-white/45 text-sm">The wallpaper you&apos;re after doesn&apos;t exist (anymore).</p>
        <a
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-accent hover:bg-accent2 text-black font-display font-semibold text-sm px-7 py-3 transition-colors"
        >
          Back to the vault
        </a>
      </div>
    </div>
  );
}
