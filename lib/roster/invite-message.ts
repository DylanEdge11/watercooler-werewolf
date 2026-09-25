export interface InviteMessage {
  subject: string;
  text: string;
}

/** One wording for both the emailed invitation and the downloadable CSV. */
export function inviteMessage(displayName: string, claimUrl: string): InviteMessage {
  return {
    subject: 'Your Watercooler Werewolf seat',
    text: `Hi ${displayName},\n\nClaim your private Watercooler Werewolf seat using this link:\n${claimUrl}\n\nChoose a six-digit PIN when you claim. Afterward, sign in with your invitation email and PIN. Do not forward this message.`,
  };
}
