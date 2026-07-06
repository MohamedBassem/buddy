export enum DiffMode {
  DEFAULT = 'default', // HEAD^ vs HEAD
  WORKING = 'working', // staged vs working
  STAGED = 'staged', // HEAD vs staged
  DOT = 'dot', // HEAD vs working (all changes)
  SPECIFIC = 'specific', // commit vs commit (no watching)
}

type WatchChangeType = 'file' | 'commit' | 'staging';

interface ConnectedWatchEvent {
  type: 'connected';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface ReloadWatchEvent {
  type: 'reload';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface ErrorWatchEvent {
  type: 'error';
  diffMode: DiffMode;
  changeType: WatchChangeType;
  timestamp: string;
  message?: string;
}

interface CommentsChangedWatchEvent {
  type: 'commentsChanged';
  version: number;
  timestamp: string;
}

/** Emitted when the AI prep pass has a ReviewPlan ready (or its status changed). */
interface AiPlanWatchEvent {
  type: 'aiPlanReady';
  /** Head SHA the plan was produced against. */
  headSha: string;
  timestamp: string;
}

/** Emitted when the set of AI annotations changed (mirrors commentsChanged). */
interface AiAnnotationsChangedWatchEvent {
  type: 'aiAnnotationsChanged';
  headSha: string;
  timestamp: string;
}

export type WatchEvent =
  | ConnectedWatchEvent
  | ReloadWatchEvent
  | ErrorWatchEvent
  | CommentsChangedWatchEvent
  | AiPlanWatchEvent
  | AiAnnotationsChangedWatchEvent;

export interface ClientWatchState {
  isWatchEnabled: boolean;
  diffMode: DiffMode;
  shouldReload: boolean;
  isReloading: boolean;
  lastChangeTime: Date | null;
  lastChangeType: WatchChangeType | null;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
}
