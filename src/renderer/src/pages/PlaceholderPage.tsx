import { PageTitle } from './PageTitle';

/** Empty page for a nav item whose screen is built in a later step. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageTitle title={title} subtitle={description} />
      <p className="mt-6 text-body text-fg-3">This page is built in a later step.</p>
    </div>
  );
}
