/**
 * The form is one JSON document per version, not a table of rows.
 *
 * A row-per-block table cannot answer "what did this form look like when that
 * response was written", and every response has to stay readable after an admin
 * edits the form. A whole-document version gives that for free: a response
 * records the version it was filled under, and the viewer reads the same
 * document the respondent saw.
 */

export const DOC_SCHEMA_VERSION = 2

/** The 16 questions that drive typed columns on `visits`. Never deletable. */
export const CORE_KEYS = [
  'store_id', 'width_m', 'height_m', 'open_from', 'open_to',
  'placement', 'facing', 'shelf_heights', 'photos',
  'present_books', 'stale_books', 'visit_result', 'no_order_reason',
  'debt_status', 'cash_collected', 'note',
] as const
export type CoreKey = (typeof CORE_KEYS)[number]

export type QuestionType =
  | 'short_answer' | 'paragraph'
  | 'multiple_choice' | 'checkboxes' | 'dropdown'
  | 'file_upload'
  | 'linear_scale' | 'rating'
  | 'grid_radio' | 'grid_checkbox'
  | 'date' | 'time'

export type Option = {
  id: string
  label: string
  /** free-text "Boshqa…" option; only one per question */
  other?: boolean
  /** answer-based routing, single-choice types only */
  goTo?: string          // section id, or 'continue' / 'submit'
}

export type GridRow = { id: string; label: string }

export type Validation = {
  kind?: 'none' | 'number' | 'integer' | 'email' | 'url' | 'length'
  min?: number | null
  max?: number | null
  message?: string
}

export type ScaleCfg = { min: number; max: number; minLabel?: string; maxLabel?: string }
export type RatingCfg = { max: number; icon: 'star' | 'heart' | 'circle' }
export type GridCfg = { rows: GridRow[]; cols: GridRow[]; requireAllRows?: boolean }
export type UploadCfg = { maxFiles: number; maxMb: number; accept: string[] }

export type QuestionBlock = {
  id: string
  kind: 'question'
  /** set only on the 16 originals; fixes the widget and forbids delete/retype */
  coreKey?: CoreKey
  type: QuestionType
  title: string
  description?: string
  required: boolean
  hidden: boolean
  imageKey?: string | null
  options?: Option[]
  validation?: Validation
  scale?: ScaleCfg
  rating?: RatingCfg
  grid?: GridCfg
  upload?: UploadCfg
}

export type TextBlock = {
  id: string
  kind: 'text'
  title: string
  description?: string
}

export type MediaBlock = {
  id: string
  kind: 'image' | 'video'
  title: string           // caption
  description?: string
  imageKey?: string | null   // kind='image': a MinIO object key
  url?: string               // kind='video': YouTube / Vimeo
}

export type Block = QuestionBlock | TextBlock | MediaBlock

export type SectionNext =
  | { type: 'continue' }
  | { type: 'submit' }
  | { type: 'goto'; sectionId: string }

export type Section = {
  id: string
  title: string
  description?: string
  next: SectionNext
  blocks: Block[]
}

export type FormSettings = {
  /** 'sections' gives Next/Back pages; 'single' scrolls the whole form. */
  pagination: 'single' | 'sections'
  showProgress: boolean
  confirmText: string
}

export type FormDoc = {
  schemaVersion: number
  title: string
  description: string
  settings: FormSettings
  sections: Section[]
}

export type VersionMeta = {
  id: number
  version: number
  status: 'draft' | 'published' | 'archived'
  updated_at: string
  published_at: string | null
  updated_by: string | null
}

/* ---------- type metadata, shared by editor / renderer / validator ---------- */

export type TypeMeta = {
  label: string          // Uzbek label in the type dropdown
  icon: string
  options?: boolean      // has an option list
  single?: boolean       // single-choice: can carry per-option routing
  grid?: boolean
  group: 'text' | 'choice' | 'scale' | 'grid' | 'datetime' | 'file'
}

export const TYPE_META: Record<QuestionType, TypeMeta> = {
  short_answer:    { label: 'Qisqa javob',            icon: '▭', group: 'text' },
  paragraph:       { label: 'Uzun javob',             icon: '☰', group: 'text' },
  multiple_choice: { label: 'Bitta tanlov',           icon: '◉', group: 'choice', options: true, single: true },
  checkboxes:      { label: "Ko'p tanlov",            icon: '☑', group: 'choice', options: true },
  dropdown:        { label: "Ochiluvchi ro'yxat",     icon: '▼', group: 'choice', options: true, single: true },
  file_upload:     { label: 'Fayl yuklash',           icon: '⇪', group: 'file' },
  linear_scale:    { label: 'Chiziqli shkala',        icon: '⇹', group: 'scale' },
  rating:          { label: 'Baholash',               icon: '★', group: 'scale' },
  grid_radio:      { label: 'Bitta tanlovli jadval',  icon: '▦', group: 'grid', grid: true },
  grid_checkbox:   { label: "Ko'p tanlovli jadval",   icon: '▩', group: 'grid', grid: true },
  date:            { label: 'Sana',                   icon: '▤', group: 'datetime' },
  time:            { label: 'Vaqt',                   icon: '◔', group: 'datetime' },
}

export const QUESTION_TYPES = Object.keys(TYPE_META) as QuestionType[]

/** Core questions keep bespoke widgets; this only labels them in the editor. */
export const CORE_LABEL: Record<CoreKey, string> = {
  store_id: "Do'kon ro'yxati",
  width_m: 'Raqam (m)',
  height_m: 'Raqam (m)',
  open_from: 'Vaqt',
  open_to: 'Vaqt',
  placement: "Ko'p tanlov",
  facing: 'Bitta tanlov',
  shelf_heights: "Ko'p tanlov",
  photos: 'Rasm yuklash',
  present_books: "Kitoblar ro'yxati",
  stale_books: "Kitoblar ro'yxati",
  visit_result: "Ko'p tanlov",
  no_order_reason: 'Bitta tanlov',
  debt_status: 'Bitta tanlov',
  cash_collected: 'Raqam (so\'m)',
  note: 'Uzun javob',
}
