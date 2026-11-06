// The links an admin hands to someone else: they open this instance's
// `/invite/$token` and `/reset/$token` pages.

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

export function resetLink(token: string): string {
  return `${window.location.origin}/reset/${token}`;
}
