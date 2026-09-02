import { redirect } from 'next/navigation';
import { findCuratedTranslation } from '../../../../lib/bible/config';

export default async function TranslationRedirect({
  params,
}: {
  params: Promise<{ translation: string }>;
}) {
  const { translation } = await params;
  const curated = findCuratedTranslation(translation);
  // Preserve the canonical case (BSB, eng_kjv, tgl_ulb…) and fall back to raw input.
  redirect(`/bible?translation=${encodeURIComponent(curated?.id ?? translation)}`);
}
