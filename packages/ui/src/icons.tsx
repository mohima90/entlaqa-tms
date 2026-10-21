import {
  Archive,
  Ban,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Image,
  MailCheck,
  Send,
  Server,
  Undo2,
  Upload,
  ArchiveRestore,
  ArrowDown,
  ArrowDownRight,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  CreditCard,
  FileCheck,
  Flag,
  FolderTree,
  Globe,
  History,
  Inbox,
  Info,
  KeyRound,
  Keyboard,
  Layers,
  ListFilter,
  LayoutDashboard,
  Lock,
  LogOut,
  type LucideIcon,
  Mail,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Monitor,
  PanelLeft,
  Moon,
  Palette,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
  TriangleAlert,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { SVGProps } from 'react';
import { cn } from './cn';

/**
 * Line icons: the Kawadir ATS icon set, lucide (ISC; T-M2-43) — 24 × 24 grid, 2 px round stroke, drawn
 * in `currentColor`, 16 px by default. Always decorative (`aria-hidden`): the text next to an icon
 * carries the meaning; an icon-only button gets an `aria-label`. Directional icons (`chevron-start`,
 * `chevron-end`) and the trend arrows are mirrored in RTL here (ADR 0007 §3); none of the others is
 * directional.
 */
const ICONS = {
  home: LayoutDashboard,
  calendar: CalendarDays,
  sessions: ClipboardList,
  courses: BookOpen,
  building: Building2,
  palette: Palette,
  fields: SlidersHorizontal,
  plan: Layers,
  globe: Globe,
  people: Users,
  key: KeyRound,
  shield: ShieldCheck,
  audit: History,
  consent: FileCheck,
  mail: Mail,
  plug: Plug,
  // A note or tip (organization profile, T-M2-22).
  info: Info,
  sync: RefreshCw,
  menu: Menu,
  close: X,
  // Kawadir shell (T-M2-43)
  search: Search,
  settings: Settings,
  billing: CreditCard,
  bell: Bell,
  user: User,
  'user-plus': UserPlus,
  'sign-out': LogOut,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  maximize: Maximize2,
  minimize: Minimize2,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-start': ChevronLeft,
  'chevron-end': ChevronRight,
  inbox: Inbox,
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  // Summary cards (Kawadir KPI and target cards)
  flag: Flag,
  'trend-up': ArrowUpRight,
  'trend-down': ArrowDownRight,
  'trend-flat': Minus,
  // Roles & permissions (EP-ROLES, Kawadir roles table): row actions and the role kinds.
  more: Ellipsis,
  plus: Plus,
  pencil: Pencil,
  trash: Trash2,
  lock: Lock,
  'shield-outline': Shield,
  // Organization → Structure (T-M3-02, EP-ORG; Kawadir's Departments page).
  structure: FolderTree,
  // Course library (T-M3-03): archive and restore a course.
  archive: Archive,
  'archive-restore': ArchiveRestore,
  // Needs forms (T-M3-10, Kawadir application-form library and builder).
  form: FileText,
  copy: Copy,
  star: Star,
  power: Power,
  eye: Eye,
  'eye-off': EyeOff,
  'chevron-up': ChevronUp,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  repeat: Repeat,
  // Direction C shell and patterns (redesign package 1): the menu's collapse toggle, a forward arrow on
  // main buttons, the keyboard shortcuts list, filters and sortable columns.
  sidebar: PanelLeft,
  'arrow-end': ArrowRight,
  keyboard: Keyboard,
  filter: ListFilter,
  sort: ArrowDownUp,
  // Organization settings (redesign package 2): the save bar at rest, sending a test e-mail, uploads,
  // Undo, expand / collapse all, the sender card, image rows and deactivate.
  clock: Clock,
  send: Send,
  upload: Upload,
  undo: Undo2,
  'expand-all': ChevronsUpDown,
  'collapse-all': ChevronsDownUp,
  'mail-check': MailCheck,
  server: Server,
  image: Image,
  ban: Ban,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/* Trend arrows follow the reading direction (time runs right to left in Arabic). */
const MIRRORED: ReadonlySet<IconName> = new Set([
  'chevron-start',
  'chevron-end',
  'sidebar',
  'arrow-end',
  'undo',
  'trend-up',
  'trend-down',
]);

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'ref'> {
  readonly name: IconName;
}

/** A decorative line icon (`aria-hidden`, `focusable="false"`). */
export function Icon({ name, className, ...props }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      className={cn('size-4 shrink-0', MIRRORED.has(name) && 'rtl:-scale-x-100', className)}
      {...props}
    />
  );
}

/**
 * The Jadarat mark: a «J» monogram on the organization tile of the navigation, until an organization's
 * own logo (FR-ADM-07) replaces it, and in «Powered by Jadarat». Decorative: the names are written
 * next to it.
 */
export function JadaratMark({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5', className)}
    >
      <path d="M14.6 5.6v8.2a3.6 3.6 0 0 1-7.2 0" />
    </svg>
  );
}
