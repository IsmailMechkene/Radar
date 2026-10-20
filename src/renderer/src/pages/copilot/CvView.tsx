import { Download, FileText, RotateCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CopilotItem, CopilotStatus, StoredCv } from '../../../../shared/ipc';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { jobState, reviewedLine } from '../../lib/copilot';
import { cleanIpcError } from '../../lib/settings-helpers';

/** The tailored CV of one posting: a preview of what the PDF holds, Save PDF and Make again. */
export function CvView({
  item,
  status,
  ready,
  timeZone,
  act,
  onStatus,
}: {
  item: CopilotItem;
  status: CopilotStatus | null;
  ready: boolean;
  timeZone: string;
  act: (what: string, call: () => Promise<unknown>) => Promise<void>;
  onStatus: (s: CopilotStatus) => void;
}) {
  // undefined: loading; null: none yet.
  const [stored, setStored] = useState<StoredCv | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const job = jobState('cv', item.id, status);

  useEffect(() => {
    let live = true;
    window.radar.copilot.getCv(item.id).then(
      (cv) => {
        if (!live) return;
        setStored(cv);
        setError(null);
      },
      (err: unknown) => {
        console.error('[copilot] tailored CV load failed', err);
        if (live) {
          setStored(null);
          setError(cleanIpcError(err));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [item.id, item.cvAt]);

  const make = () =>
    act('Tailored CV', async () => onStatus(await window.radar.copilot.makeCv([item.id])));
  const savePdf = () =>
    act('Save PDF', async () => {
      const saved = await window.radar.copilot.saveCvPdf(item.id);
      if (saved) toast({ message: `Saved ${saved.file.split(/[\\/]/).pop() ?? 'the PDF'}` });
    });

  const busy = job?.state === 'running' || job?.state === 'queued';
  const makeButton = (
    <Button
      size="sm"
      variant={stored ? 'secondary' : 'primary'}
      icon={stored ? RotateCw : Sparkles}
      disabled={!ready || busy}
      onClick={() => void make()}
    >
      {stored ? 'Make again' : 'Make tailored CV'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 px-5 py-4.5">
      {job?.state === 'failed' && (
        <Banner title="The tailored CV failed." description={job.problem} />
      )}
      {error && <Banner title="The tailored CV could not be loaded." description={error} />}

      {stored === undefined ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : stored === null ? (
        <div className="grid place-items-center px-6 py-14 text-center">
          <Icon icon={FileText} size={18} className="text-fg-3" />
          <div className="mt-2 text-headline font-semibold">
            {job?.state === 'running'
              ? 'Claude Code is writing this CV…'
              : job?.state === 'queued'
                ? 'Queued'
                : 'No tailored CV yet'}
          </div>
          <p className="mt-1 mb-4 max-w-110 text-subhead text-fg-2">
            Rewritten from your master CV for this posting: reordered and reworded, never invented.
            Postings graded A or B get one automatically.
          </p>
          {makeButton}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-footnote text-fg-3">
              {reviewedLine(stored.createdAt, stored.model, timeZone).replace('Reviewed', 'Made')}
              {job?.state === 'running' && ' · writing a new one…'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {makeButton}
              <Button size="sm" variant="primary" icon={Download} onClick={() => void savePdf()}>
                Save PDF
              </Button>
            </div>
          </div>

          {stored.cv.changes.length > 0 && (
            <section className="rounded-lg bg-accent-soft px-3.5 py-2.75">
              <h3 className="m-0 text-footnote font-semibold text-accent">
                What was tailored (check before sending)
              </h3>
              <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4.5 text-subhead">
                {stored.cv.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          <article
            aria-label="Tailored CV preview"
            className="rounded-xl bg-surface px-7 py-6 hairline border-line shadow-card"
          >
            <h1 className="m-0 text-title-2 font-semibold">{stored.cv.name}</h1>
            {stored.cv.headline && <div className="text-body text-fg-2">{stored.cv.headline}</div>}
            {stored.cv.contact.length > 0 && (
              <div className="mt-1 text-footnote text-fg-3">{stored.cv.contact.join(' · ')}</div>
            )}
            {stored.cv.summary && (
              <p className="m-0 mt-3 text-body leading-relaxed">{stored.cv.summary}</p>
            )}
            {stored.cv.skills.length > 0 && (
              <section className="mt-4">
                <h2 className="m-0 mb-1.5 pb-1 text-caption-2 font-semibold tracking-wide text-fg-2 uppercase hairline-b border-line">
                  Skills
                </h2>
                {stored.cv.skills.map((g, i) => (
                  <div key={i} className="text-subhead">
                    <b className="font-semibold">{g.group}:</b> {g.items.join(', ')}
                  </div>
                ))}
              </section>
            )}
            {stored.cv.sections.map((s, i) => (
              <section key={i} className="mt-4">
                <h2 className="m-0 mb-1.5 pb-1 text-caption-2 font-semibold tracking-wide text-fg-2 uppercase hairline-b border-line">
                  {s.title}
                </h2>
                {s.entries.map((e, j) => (
                  <div key={j} className="mb-2.5">
                    <div className="flex justify-between gap-3 text-subhead">
                      <span className="font-semibold">{e.heading}</span>
                      {e.dates && <span className="whitespace-nowrap text-fg-3">{e.dates}</span>}
                    </div>
                    {e.detail && <div className="text-footnote text-fg-2">{e.detail}</div>}
                    {e.bullets.length > 0 && (
                      <ul className="m-0 mt-0.5 flex list-disc flex-col gap-0.5 pl-4.5 text-subhead">
                        {e.bullets.map((b, k) => (
                          <li key={k}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </article>
        </>
      )}
    </div>
  );
}
