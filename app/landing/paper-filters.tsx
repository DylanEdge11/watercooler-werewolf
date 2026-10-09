/**
 * Shared SVG filter for the landing page, rendered once by the shell. Scene
 * art references it as `filter="url(#pc-glow)"`: a soft light bloom for
 * windows, eyes, bulbs and the moon.
 */
export default function PaperFilters() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <filter id="pc-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
