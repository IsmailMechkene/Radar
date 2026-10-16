import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  findDeadlineSentence,
  guessLanguage,
  guessOpportunityType,
  htmlToText,
  normalizeRemoteType,
  toUtcIso,
} from '../src/core/adapters/normalize';

describe('opportunity type', () => {
  const t = (title: string, extra: Partial<Parameters<typeof guessOpportunityType>[0]> = {}) =>
    guessOpportunityType({ title, ...extra });

  it('word boundaries: "Internal" is not an internship', () => {
    expect(
      t('Senior Full-Stack Engineer, Internal Applications', { employmentType: 'FullTime' }),
    ).toBe('fulltime');
    expect(t('International Sales Manager')).toBe('unknown');
    expect(t('Senior Product Manager, Early-Stage Startups')).toBe('unknown');
    expect(t('Backend Engineer (Seed Stage)')).toBe('unknown');
  });

  it('English, French and German internship keywords', () => {
    for (const title of [
      'Software Engineer Intern (Winter 2027)',
      'Research Internship (Winter 2027)',
      'Machine Learning Intern/Co-op',
      'Stage - Data Scientist',
      'Stagiaire développeur IA',
      'Alternance - Ingénieur backend',
      'Apprenti(e) data engineer',
      'Praktikum Softwareentwicklung',
      'Werkstudent Backend (m/w/d)',
      'Working Student IT Support',
    ]) {
      expect(t(title), title).toBe('internship');
    }
  });

  it('PFE beats internship; employment type first', () => {
    expect(t('PFE - Reinforcement Learning')).toBe('pfe');
    expect(t('Stage de fin d’études : vision par ordinateur')).toBe('pfe');
    expect(t('Applied Scientist', { employmentType: 'Intern' })).toBe('internship');
    expect(t('PFE Data', { employmentType: 'Intern' })).toBe('pfe');
    expect(t('Applied Scientist  (Internship)', { employmentType: 'FullTime' })).toBe('internship');
  });

  it('programs, junior, full-time and unknown', () => {
    expect(t('AI Residency 2027')).toBe('program');
    expect(t('Google Summer of Code contributor')).toBe('program');
    expect(t('Junior Backend Developer')).toBe('junior');
    expect(t('Graduate Software Engineer')).toBe('junior');
    expect(t('Data Engineer', { labels: ['Full Time'] })).toBe('fulltime');
    expect(t('Data Engineer', { employmentType: 'Contract' })).toBe('unknown');
    expect(t('Program Manager')).toBe('unknown'); // "program" alone is not a program
  });

  it('labels (Arbeitnow job_types)', () => {
    expect(t('Product Marketing', { labels: ['Praktikum', 'internship'] })).toBe('internship');
    expect(t('IT-Support', { labels: ['Werkstudent', 'working student'] })).toBe('internship');
    expect(t('Ops', { labels: ['Trainee-programm', 'traineeship'] })).toBe('junior');
    expect(t('Engineer', { labels: ['Permanent employment (unbefristeter arbeitsvertrag)'] })).toBe(
      'fulltime',
    );
  });
});

describe('remote type', () => {
  it('structured values first, then short text', () => {
    expect(normalizeRemoteType({ workplaceType: 'Remote' })).toBe('remote');
    expect(normalizeRemoteType({ workplaceType: 'Hybrid', isRemote: true })).toBe('hybrid');
    expect(normalizeRemoteType({ workplaceType: 'OnSite' })).toBe('onsite');
    expect(normalizeRemoteType({ workplaceType: null, isRemote: true })).toBe('remote');
    expect(normalizeRemoteType({ isRemote: false, text: 'Engineer (Hybrid) Berlin' })).toBe(
      'hybrid',
    );
    expect(normalizeRemoteType({ isRemote: false, text: 'Engineer Berlin' })).toBe('onsite');
    expect(normalizeRemoteType({ text: 'Engineer, Remote (Europe)' })).toBe('remote');
    expect(normalizeRemoteType({ text: 'Engineer' })).toBe('unknown');
  });
});

describe('language', () => {
  it('guesses en, fr, other or unknown', () => {
    expect(
      guessLanguage(
        'We are looking for an intern to join our team and you will work with the ML team for six months.',
      ),
    ).toBe('en');
    expect(
      guessLanguage(
        'Nous recherchons un stagiaire pour rejoindre notre équipe et vous travaillerez avec les ingénieurs dans la data.',
      ),
    ).toBe('fr');
    expect(
      guessLanguage(
        'Wir suchen eine Werkstudentin für das Team und die Arbeit mit der Plattform ist spannend für dich.',
      ),
    ).toBe('other');
    expect(guessLanguage('ML Intern')).toBe('unknown');
  });
});

describe('HTML to text', () => {
  it('keeps structure, drops tags and decodes entities', () => {
    const html =
      '<h2>About</h2><p>We&rsquo;re hiring&nbsp;interns &amp; co-ops.</p><ul><li>Python</li><li>PyTorch</li></ul><script>x()</script>';
    // Blocks are separated by a blank line; list items stay on consecutive lines.
    expect(htmlToText(html)).toBe('About\n\nWe’re hiring interns & co-ops.\n\n• Python\n• PyTorch');
  });

  it('decodes once (Greenhouse double escaping needs a second pass by its adapter)', () => {
    expect(decodeEntities('&lt;p&gt;Hi &#233;t&#xE9;&lt;/p&gt;')).toBe('<p>Hi été</p>');
    expect(htmlToText(decodeEntities('&lt;p&gt;Hello&lt;/p&gt;'))).toBe('Hello');
  });
});

describe('deadline sentence and dates', () => {
  it('finds the first sentence about a deadline (EN/FR/DE)', () => {
    expect(
      findDeadlineSentence(
        'Great team. Applications close on 12 November 2026 at 23:59 CET. Apply now!',
      ),
    ).toBe('Applications close on 12 November 2026 at 23:59 CET.');
    expect(findDeadlineSentence('Date limite de candidature : 31 mars 2027.')).toBe(
      'Date limite de candidature : 31 mars 2027.',
    );
    expect(findDeadlineSentence('Bewerbungsfrist: 15.01.2027')).toBe('Bewerbungsfrist: 15.01.2027');
    expect(findDeadlineSentence('We review on a rolling basis.')).toBe(
      'We review on a rolling basis.',
    );
    expect(findDeadlineSentence('Nothing here.')).toBeNull();
    expect(findDeadlineSentence(null)).toBeNull();
  });

  it('converts dates and epochs to UTC ISO', () => {
    expect(toUtcIso('2026-09-07T14:01:20.637+00:00')).toBe('2026-09-07T14:01:20.637Z');
    expect(toUtcIso(1792144858, 's')).toBe(new Date(1792144858 * 1000).toISOString());
    expect(toUtcIso('not a date')).toBeNull();
    expect(toUtcIso(null)).toBeNull();
  });
});
