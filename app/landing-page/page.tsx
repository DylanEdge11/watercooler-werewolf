import LandingShell from '../landing/landing-shell';

/** Static landing page served at / to signed-out visitors (see proxy.ts). */
export default function LandingPage() {
  return <LandingShell />;
}
