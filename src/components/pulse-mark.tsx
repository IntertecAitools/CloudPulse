/** The CloudPulse wordmark glyph — a pulse waveform. Shared by the landing
 *  page and the app sidebar so the brand reads the same in both. */
export function PulseMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 23 17"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M0.8 8.8 H5.2 L7.6 3.2 L11 14 L13.6 8.8 H22.2" />
    </svg>
  );
}
