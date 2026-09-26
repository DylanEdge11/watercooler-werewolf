'use client';

import { announcementChatCopy, announcementEmailCopy } from '../../lib/game/moderator-copy';
import type { FeedbackSummary } from '../../lib/game/feedback';
import CopyButton from './copy-button';

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
  createdAt: string;
}

function siteUrl(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Every published announcement with ready-to-send email and chat copy. The newest is open. */
export function AnnouncementCopies({ announcements, highlightId }: { announcements: AnnouncementRecord[]; highlightId: string | null }) {
  if (!announcements.length) return null;
  return <div className="ops-block announcement-copies">
    <p className="eyebrow accent">Announcement copy</p>
    <p className="field-help">Players see announcements in the app. Copy them into an email or your group chat so nobody misses one.</p>
    {announcements.map((announcement, index) => {
      const email = announcementEmailCopy(announcement);
      const chat = announcementChatCopy(announcement, siteUrl());
      return <details key={announcement.id} className="announcement-copy" open={announcement.id === highlightId || (highlightId === null && index === 0)}>
        <summary><strong>{announcement.title}</strong> <small suppressHydrationWarning>{new Date(announcement.createdAt).toLocaleString()}</small></summary>
        <p className="copy-label">Email</p>
        <pre className="copy-preview">{email}</pre>
        <div className="button-row"><CopyButton text={email} label="Copy email" accessibleLabel={`Copy email for ${announcement.title}`} /></div>
        <p className="copy-label">Chat</p>
        <pre className="copy-preview">{chat}</pre>
        <div className="button-row"><CopyButton text={chat} label="Copy for chat" accessibleLabel={`Copy ${announcement.title} for chat`} /></div>
      </details>;
    })}
  </div>;
}

function respondentLabel(type: string): string {
  return type === 'MODERATOR' ? 'Moderator' : 'Player';
}

/** Ratings and comments from this game. The list shows whether a player or a moderator sent each one; the sender is kept in the audit log. */
export function FeedbackBlock({ feedback }: { feedback: FeedbackSummary | null }) {
  return <div className="ops-block feedback-summary">
    <div className="ops-heading">
      <div><p className="eyebrow accent">Feedback</p><p className="field-help">What players and moderators sent from the feedback card. Names are never recorded.</p></div>
      <div className="feedback-average"><strong>{feedback?.average ?? '–'}</strong><small>{feedback?.count ? `average of ${feedback.count}` : 'no ratings yet'}</small></div>
    </div>
    {feedback?.entries.length
      ? <ul className="feedback-list">{feedback.entries.map((entry, index) => <li key={`${entry.createdAt}-${index}`}>
          <span className="feedback-rating" aria-label={`Rating ${entry.rating} of 5`}>{entry.rating}/5</span>
          <span className="feedback-meta">{respondentLabel(entry.respondentType)} · <span suppressHydrationWarning>{new Date(entry.createdAt).toLocaleString()}</span></span>
          {entry.comment ? <p>{entry.comment}</p> : <p className="empty-note">No comment.</p>}
        </li>)}</ul>
      : <p className="empty-note">No feedback yet.</p>}
  </div>;
}
