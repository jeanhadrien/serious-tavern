import {
  History,
  MessageSquare,
  ScrollText,
  Server,
  Settings,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { IconId } from './state.js';

/** Header icon and name of every list, editor and the chat. */
export const VIEW_INFO: Record<IconId, { icon: LucideIcon; label: string }> = {
  chat: { icon: MessageSquare, label: 'Chat' },
  chats: { icon: History, label: 'Chats' },
  workflows: { icon: Workflow, label: 'Workflows' },
  presets: { icon: ScrollText, label: 'Presets' },
  providers: { icon: Server, label: 'Providers' },
  settings: { icon: Settings, label: 'Settings' },
  characters: { icon: Users, label: 'Characters' },
  personas: { icon: UserRound, label: 'Personas' },
};
