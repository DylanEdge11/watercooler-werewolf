import { Caveat, Fraunces, IM_Fell_English, Special_Elite } from 'next/font/google';

// Fraunces sets every heading and the wordmark, so it is the only family
// preloaded. Its SOFT, WONK, and optical-size axes and its italic are part of
// the look (the wordmark, headings, and landing marquee), so they stay.
const displayFont = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--ll-font-display',
});

// The other three are small labels and decorative lines, never the largest
// text on a page. Without a preload each downloads only on a page that uses it.
const typewriterFont = Special_Elite({ subsets: ['latin'], weight: '400', variable: '--ll-font-type', preload: false });

const handFont = Caveat({ subsets: ['latin'], variable: '--ll-font-hand', preload: false });

// Italic is used by the landing marquee's pitch line.
const storyFont = IM_Fell_English({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--ll-font-story',
  preload: false,
});

export const landingFontVariables = [displayFont, typewriterFont, handFont, storyFont]
  .map((font) => font.variable)
  .join(' ');
