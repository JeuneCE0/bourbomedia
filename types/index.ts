// Shared types across client (onboarding/portal) and admin (dashboard) views.
// Import from here instead of redefining interfaces in pages.

export type ClientStatus =
  | 'lead'
  | 'onboarding'
  | 'script'
  | 'validated'
  | 'filming'
  | 'editing'
  | 'delivered'
  | 'published'
  | 'archived'
  | 'churned';

export type ScriptStatus =
  | 'draft'
  | 'preparation'
  | 'proposition'
  | 'modifications'
  | 'modified'
  | 'confirmed'
  | 'archived';

export interface Client {
  id: string;
  business_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  status?: ClientStatus | string | null;
  tags?: string[] | null;
  notes?: string | null;
  filming_date?: string | null;
  publication_deadline?: string | null;
  created_at?: string;
  updated_at?: string;
  portal_token?: string | null;
  onboarding_token?: string | null;
}

export interface Script {
  id: string;
  client_id: string;
  status?: ScriptStatus | string | null;
  version?: number | null;
  content?: any;
  pdf_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Comment {
  id: string;
  script_id?: string | null;
  client_id?: string | null;
  author_type: 'client' | 'team';
  author_name?: string | null;
  body: string;
  created_at: string;
}

export interface Video {
  id: string;
  client_id: string;
  title?: string | null;
  url?: string | null;
  embed_url?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface Payment {
  id: string;
  client_id: string;
  amount?: number | null;
  currency?: string | null;
  status?: 'paid' | 'pending' | 'failed' | string | null;
  invoice_url?: string | null;
  receipt_url?: string | null;
  created_at?: string;
}

export interface Notification {
  id: string;
  client_id?: string | null;
  type?: string | null;
  title: string;
  body?: string | null;
  read_at?: string | null;
  created_at: string;
  link?: string | null;
}

export interface Task {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  done: boolean;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  type: string;
  message?: string | null;
  meta?: Record<string, any> | null;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name?: string | null;
  role?: 'admin' | 'editor' | 'viewer' | string;
  active?: boolean;
  created_at?: string;
}

export interface SatisfactionFeedback {
  id?: string;
  client_id?: string;
  rating: number;
  comment?: string | null;
  testimonial_consent?: boolean;
  created_at?: string;
}

export interface FilmingSlot {
  id: string;
  client_id: string;
  start_at: string;
  end_at?: string | null;
  status?: string | null;
  notes?: string | null;
}
