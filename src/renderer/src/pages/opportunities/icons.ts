import {
  ArrowLeftRight,
  Braces,
  Building2,
  CircleHelp,
  Globe,
  GraduationCap,
  Mail,
  PencilLine,
  Rss,
  type LucideIcon,
} from 'lucide-react';
import type { OpportunityListItem } from '../../../../shared/ipc';

/** Remote-type icons from the design (`remI`). */
export const REMOTE_ICONS: Record<OpportunityListItem['remote_type'], LucideIcon> = {
  remote: Globe,
  hybrid: ArrowLeftRight,
  onsite: Building2,
  unknown: CircleHelp,
};

/** Source icon by how the source is read; programs use the graduation cap, as in the design. */
export function sourceIcon(
  access: OpportunityListItem['source_access_method'],
  type?: OpportunityListItem['opportunity_type'],
): LucideIcon {
  if (type === 'program') return GraduationCap;
  switch (access) {
    case 'api':
      return Braces;
    case 'rss':
      return Rss;
    case 'public_html':
      return Globe;
    case 'email_alert':
      return Mail;
    case 'manual':
      return PencilLine;
  }
}
