/**
 * What people read on the public sign-up page, in the emails sent to approved
 * moderators, and on the moderator setup page. Kept in one place so the wording
 * can be reviewed and changed without touching the rules.
 */

export const JOIN_COPY = {
  invalidLink: 'This sign-up link isn’t valid.',
  playerHeading: (gameName: string) => `Join ${gameName}`,
  playerSubline: (startDate: string) => `Sign up to play. The game starts ${startDate}.`,
  nameLabel: 'Your name (other players will see this)',
  emailLabel: 'Your email (your private seat link is sent here)',
  playerSubmit: 'Sign me up',
  playerSubmitting: 'Signing up…',
  playerDone: 'You’re on the list. When the moderator confirms the roster, your private seat link will arrive by email. Check your spam folder if you don’t see it.',
  closed: (gameName: string) => `Sign-ups for ${gameName} are closed. Ask the moderator if you’d still like to play.`,
  listFull: 'The sign-up list is full. Ask the moderator if you’d still like to play.',
  moderatorHeading: 'Help run this game',
  moderatorIntro: 'Want to co-moderate? Tell the owner a little about yourself. If they approve, a private link to set up your moderator sign-in arrives by email.',
  moderatorNameLabel: 'Your name',
  moderatorEmailLabel: 'Your email (your setup link is sent here)',
  moderatorNoteLabel: 'Why you’d like to help (optional)',
  moderatorSubmit: 'Send my application',
  moderatorSubmitting: 'Sending…',
  moderatorDone: 'Application sent. If the owner approves it, a private setup link will arrive by email. Check your spam folder if you don’t see it.',
  applicationsClosed: (gameName: string) => `${gameName} isn’t taking moderator applications right now.`,
  applicationsFull: 'The owner has all the applications they can review right now. Try again later.',
  noneOpen: (gameName: string) => `${gameName} isn’t taking sign-ups or moderator applications right now. Ask the moderator if you’d still like to take part.`,
  botFailure: 'Something went wrong. Please try again.',
} as const;

/** The email an approved applicant receives with their one-time setup link. */
export function moderatorSetupMessage(displayName: string, gameName: string, setupUrl: string): { subject: string; text: string } {
  return {
    subject: `You’re approved to moderate ${gameName}`,
    text: `Hi ${displayName},\n\nThe owner of ${gameName} approved your application to co-moderate it. Set up your moderator sign-in with this private link:\n${setupUrl}\n\nThe link works once and expires after 7 days. Do not forward this message.`,
  };
}

/** The email an approved applicant who already has a moderator account receives. */
export function moderatorAddedMessage(displayName: string, gameName: string, consoleUrl: string): { subject: string; text: string } {
  return {
    subject: `You’re approved to moderate ${gameName}`,
    text: `Hi ${displayName},\n\nThe owner of ${gameName} approved your application to co-moderate it. Sign in with your usual moderator email and password, and the game will be in your list:\n${consoleUrl}`,
  };
}

export const MODERATOR_SETUP_COPY = {
  invalidLink: 'This setup link isn’t valid. It may have been used already or have expired. Ask the game owner to approve you again.',
  heading: 'Set up your moderator sign-in',
  intro: (gameName: string) => `You’re approved to moderate ${gameName}. Choose a password of at least 12 characters.`,
  submit: 'Create my sign-in',
  submitting: 'Creating…',
  doneHeading: 'You’re in.',
  recoveryCodes: 'Save these one-time recovery codes now. They’re the only way back in if you forget your password, and they are not shown again.',
  openConsole: 'Open the moderator console',
} as const;
