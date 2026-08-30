import ClaimForm from './claim-form';

export default async function ClaimPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <main className="setup-shell centered"><ClaimForm code={code} /></main>;
}
