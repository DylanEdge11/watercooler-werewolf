import { Caveat, Fraunces, IM_Fell_English, Special_Elite } from 'next/font/google';

export const displayFont = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--ll-font-display',
});

export const typewriterFont = Special_Elite({ subsets: ['latin'], weight: '400', variable: '--ll-font-type' });

export const handFont = Caveat({ subsets: ['latin'], variable: '--ll-font-hand' });

export const storyFont = IM_Fell_English({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--ll-font-story',
});

export const landingFontVariables = [displayFont, typewriterFont, handFont, storyFont]
  .map((font) => font.variable)
  .join(' ');
